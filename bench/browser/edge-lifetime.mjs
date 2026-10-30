/**
 * Diagnostic weak cohorts and heap snapshots on the real WebGPU frame profile.
 * Start the root HTTP server and windows-chrome.mjs first, then run:
 * DAGR_CDP=http://127.0.0.1:9445 node bench/browser/edge-lifetime.mjs /tmp/edge-life
 * No renderer source is changed. Instrumentation is served by Playwright routes.
 * Snapshotting forces major GC; only the results captured before it describe
 * natural collection. These runs are for lifetimes, never frame-time comparisons.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
const root = process.cwd();
const out = process.argv[2];
const tags = process.argv.includes('--tags');
const report = [];
if (!out) throw new Error('Provide an output directory');
if (loadavg()[0] >= 1.5) throw new Error('Wait for 1-minute load below 1.5');
mkdirSync(out, { recursive: true });
const require = createRequire(root + '/bench/browser/package.json');
const { chromium } = require('playwright-core');
const renderRequire = createRequire(root + '/packages/render/package.json');
const browser = await chromium.connectOverCDP(process.env.DAGR_CDP ?? 'http://127.0.0.1:9445');
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const html = readFileSync('bench/browser/frame-profile.html', 'utf8')
    .replace('__THREE_WEBGPU__', renderRequire.resolve('three/webgpu').slice(root.length))
    .replace('__THREE_TSL__', renderRequire.resolve('three/tsl').slice(root.length));
  await page.route('**/frame-profile.html', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  let js = readFileSync('packages/render/dist/edge-motion.js', 'utf8');
  const seams = [
    'const step = springStep(w, dtSeconds);',
    'entry.velocities = nextVelocities;',
    'return { edges, settled };',
  ];
  if (!seams.every((seam) => js.includes(seam))) throw new Error('Instrumentation seams changed');
  js = js.replace(seams[0], `
    const epoch = globalThis.lifeEpoch = (globalThis.lifeEpoch ?? 0) + 1;
    performance.mark('life:advance:start:' + epoch);
    const step = springStep(w, dtSeconds);
  `);
  js = js.replace(seams[1], `
    if (epoch >= 180 && epoch < 400 && /^e(0|5000|9800)-/.test(id)) {
      const age = [1, 2, 4, 8, 16][epoch % 5];
      for (const [kind, obj] of Object.entries({ points, point: points[0], velocities: nextVelocities })) {
        ${tags ? "globalThis.lifeTagged = (globalThis.lifeTagged ?? 0) + 1; obj.__dagrLifetime = epoch + ':' + id + ':' + kind;" : `const ref = new WeakRef(obj);
        ref.label = epoch + ':' + id + ':' + kind;
        (globalThis.lifeRefs ??= []).push({ epoch, age, kind, id, ref });`}
      }
    }
    entry.velocities = nextVelocities;
  `);
  js = js.replace(seams[2], `
    performance.mark('life:advance:end:' + epoch);
    return { edges, settled };
  `);
  await page.route('**/edge-motion.js', (route) => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.goto('http://127.0.0.1:8733/bench/browser/frame-profile.html');
  await page.waitForFunction(() => window.ready);
  const adapter = await page.evaluate(() => window.adapter());
  if (adapter.adapter?.isFallbackAdapter !== false) throw new Error('A real adapter is required');
  textlog({
    cpu: cpus()[0].model, load: loadavg(), version: browser.version(), adapter,
    mode: tags ? 'tags' : 'weakrefs', extraFlags: process.env.DAGR_CHROMIUM_ARGS ?? '',
  });
  await page.evaluate(() => {
    window.lifeResults = [];
    const observe = () => {
      for (const cohort of window.lifeRefs ?? []) {
        if (cohort.checked || window.lifeEpoch < cohort.epoch + cohort.age) continue;
        cohort.checked = true;
        window.lifeResults.push({
          epoch: cohort.epoch, at: window.lifeEpoch, age: cohort.age,
          kind: cohort.kind, id: cohort.id,
          alive: cohort.ref.deref() !== undefined, ms: window.performance.now(),
        });
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.send('Tracing.start', {
    categories: 'v8,disabled-by-default-v8.gc,blink.user_timing', transferMode: 'ReportEvents',
  });
  const result = page.evaluate(() => window.profile(
    10000, 60, 600, null, 'smooth', 'shapes', false, 'all', 'springs', 1, false,
  ));
  await page.waitForFunction(() => window.lifeEpoch >= 300, null, { timeout: 90000 });
  await page.screenshot({ path: out + '/flow.png' });
  const cohorts = await page.evaluate(() => ({
    epoch: window.lifeEpoch, refs: window.lifeRefs?.length, tagged: window.lifeTagged, results: window.lifeResults,
  }));
  if (!(cohorts.refs > 0 || cohorts.tagged > 0)) throw new Error('No sampled targets');
  writeFileSync(out + '/cohorts.json', JSON.stringify(cohorts, null, 2));
  textlog({ epoch: cohorts.epoch, refs: cohorts.refs });

  // Snapshotting forces major GC. The pre-snapshot results above are frozen.
  const chunks = [];
  cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk));
  for (let i = 1; i <= 2; i++) {
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    writeFileSync(out + `/snapshot-${i}.heapsnapshot`, chunks.join(''));
    chunks.length = 0;
    if (i === 1) {
      await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const tick = () => ++n === 4 ? resolve() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      }));
    }
  }
  const row = await result;
  if (row.backend !== 'webgpu') throw new Error('WebGPU backend required');
  textlog({ backend: row.backend, springs: row.springs, zoom: row.zoom });
  const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await completed;
  writeFileSync(out + '/trace.json', JSON.stringify(events));
} finally {
  try {
    await page?.close();
  } finally {
    await browser.close();
  }
}
function textlog(value) {
  report.push(value);
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(value));
}
