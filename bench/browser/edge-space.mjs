/**
 * Which heap space edge motion's per-frame objects are allocated in, on the
 * real WebGPU frame profile. Needs V8's natives syntax in the renderer, so the
 * relay must be started with it:
 * DAGR_JS_FLAGS='--allow-natives-syntax' node bench/browser/windows-chrome.mjs --headless
 * DAGR_CDP=http://127.0.0.1:9445 node bench/browser/edge-space.mjs /tmp/edge-space
 * Add `--no-allocation-site-pretenuring` to DAGR_JS_FLAGS for the control.
 * Every moving edge is checked as soon as its frame objects exist, before a
 * second scavenge could promote them, so an object in old space there was
 * allocated there. These runs are for allocation spaces, never frame times.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
const root = process.cwd();
const out = process.argv[2];
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
  // Counts per advance: moving edges; old-space points arrays, first points
  // and velocity arrays just allocated; whether the edge list and its first
  // record are old; then the same three for the previous advance's objects,
  // which are old by now if they were allocated old or promoted since.
  js = js.replace(seams[0], `
    const epoch = globalThis.spaceEpoch = (globalThis.spaceEpoch ?? 0) + 1;
    const space = [epoch, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    performance.mark('space:advance:start:' + epoch);
    const step = springStep(w, dtSeconds);
  `);
  js = js.replace(seams[1], `
    space[1] += 1;
    if (!%InYoungGeneration(points)) space[2] += 1;
    if (points.length > 0 && !%InYoungGeneration(points[0])) space[3] += 1;
    if (!%InYoungGeneration(nextVelocities)) space[4] += 1;
    if (!%InYoungGeneration(from)) space[7] += 1;
    if (from.length > 0 && !%InYoungGeneration(from[0])) space[8] += 1;
    if (!%InYoungGeneration(velocities)) space[9] += 1;
    entry.velocities = nextVelocities;
  `);
  js = js.replace(seams[2], `
    space[5] = %InYoungGeneration(edges) ? 0 : 1;
    space[6] = edges.length > 0 && !%InYoungGeneration(edges[0]) ? 1 : 0;
    (globalThis.spaceLog ??= []).push(space);
    performance.mark('space:advance:end:' + epoch);
    return { edges, settled };
  `);
  await page.route('**/edge-motion.js', (route) => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.goto('http://127.0.0.1:8733/bench/browser/frame-profile.html');
  await page.waitForFunction(() => window.ready);
  const natives = await page.evaluate(() => {
    try {
      return new Function('return %InYoungGeneration({})')();
    } catch (error) {
      return String(error);
    }
  });
  if (natives !== true) throw new Error(`Natives syntax is not enabled in the renderer: ${natives}`);
  const adapter = await page.evaluate(() => window.adapter());
  if (adapter.adapter?.isFallbackAdapter !== false) throw new Error('A real adapter is required');
  textlog({ cpu: cpus()[0].model, load: loadavg(), version: browser.version(), adapter });
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.send('Tracing.start', {
    categories: 'v8,disabled-by-default-v8.gc,blink.user_timing', transferMode: 'ReportEvents',
  });
  const row = await page.evaluate(() => window.profile(
    10000, 60, 1200, null, 'smooth', 'shapes', false, 'all', 'springs', 1, false,
  ));
  if (row.backend !== 'webgpu') throw new Error('WebGPU backend required');
  const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await completed;
  const log = await page.evaluate(() => window.spaceLog ?? []);
  if (log.length === 0) throw new Error('No advances were checked');
  writeFileSync(out + '/space.json', JSON.stringify(log));
  writeFileSync(out + '/trace.json', JSON.stringify(events));
  textlog({ backend: row.backend, springs: row.springs, zoom: row.zoom, advances: log.length, summary: summarise(log) });
} finally {
  try {
    await page?.close();
  } finally {
    await browser.close();
  }
}

function summarise(log) {
  const windows = [];
  for (let start = 0; start < log.length; start += 100) {
    const sum = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const space of log.slice(start, start + 100)) for (let i = 1; i < 10; i++) sum[i - 1] += space[i];
    const [moving, points, point, velocities, edgeLists, records, previousPoints, previousPoint, previousVelocities] = sum;
    windows.push({
      advances: [log[start][0], log[Math.min(start + 99, log.length - 1)][0]],
      moving, points, point, velocities, edgeLists, records, previousPoints, previousPoint, previousVelocities,
    });
  }
  return windows;
}

function textlog(value) {
  report.push(value);
  writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(value));
}
