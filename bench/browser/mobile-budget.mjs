/**
 * What a full-screen DagrCanvas costs under phone emulation, with and without
 * `maxPixelRatio`: the drawing buffer it allocates, the JavaScript heap after a
 * collection, and the frame intervals and `render()` call time while a pinch and
 * a one-finger pan run over it. Evidence for choosing a pixel-ratio budget, not
 * a gate, a real-device result or a default.
 * Build first. DAGR_BROWSER_DEPS points to a directory with playwright-core and
 * esbuild installed in node_modules; DAGR_CHROMIUM can override the executable.
 * Launched, it runs headless Chromium on whatever WebGL2 it has. DAGR_CDP
 * attaches to a running Chrome instead (see windows-chrome.mjs), and then the
 * run fails unless the canvas drew on WebGPU and the page's default adapter is
 * not a fallback.
 *
 * ```
 * node bench/browser/mobile-budget.mjs [--nodes=1000] [--out=DIR]
 * ```
 *
 * Writes a screenshot per row and report.json.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const deps = createRequire(join(process.env.DAGR_BROWSER_DEPS ?? join(ROOT, 'bench/browser'), 'package.json'));
const { build } = deps('esbuild');
const { chromium } = deps('playwright-core');
const CDP = process.env.DAGR_CDP;
// Loopback, because WebGPU exists only in a secure context; see mobile-core-check.mjs.
const ORIGIN = 'http://127.0.0.1:8734';
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = option('out') ?? join(tmpdir(), `dagr-mobile-budget-${Date.now()}`);
const NODES = Number(option('nodes') ?? 1000);
assert.ok(Number.isInteger(NODES) && NODES > 0, `--nodes has to be a whole number, got ${option('nodes')}`);
const DEVICES = [
  { width: 390, height: 844, deviceScaleFactor: 3 },
  { width: 320, height: 568, deviceScaleFactor: 1 },
];
const CAPS = [undefined, 2, 1];
const CONTROL_FRAMES = 120;

await mkdir(OUT, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'bench/browser/mobile-budget-page.mjs')],
  outfile: join(OUT, 'app.js'), bundle: true, format: 'iife', platform: 'browser',
  nodePaths: [join(ROOT, 'docs/node_modules'), join(ROOT, 'packages/react/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(join(OUT, 'index.html'), `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;overflow:hidden}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'] };

const quantile = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
const round = (ms) => Math.round(ms * 100) / 100;
const summarise = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, median: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), max: round(sorted.at(-1)) };
};
const gaps = (stamps) => stamps.slice(1).map((at, i) => at - stamps[i]);

let browser;
const report = {
  mode: CDP ? `attached Chrome at ${CDP}, WebGPU required` : 'launched headless Chromium',
  machine: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), platform: `${process.platform} ${process.arch}` },
  nodes: NODES,
  rows: [],
};
try {
  browser = CDP ? await chromium.connectOverCDP(CDP) : await chromium.launch({
    headless: true,
    ...(process.env.DAGR_CHROMIUM ? { executablePath: process.env.DAGR_CHROMIUM } : {}),
  });
  report.browser = browser.version();
  for (const { width, height, deviceScaleFactor } of DEVICES) for (const cap of CAPS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, isMobile: true, hasTouch: true });
    const stem = `${width}x${height}-dpr${deviceScaleFactor}-max${cap ?? 'unset'}`;
    try {
      await context.route(`${ORIGIN}/**`, async (route) => {
        const file = files[new URL(route.request().url()).pathname];
        if (!file) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: file[1], body: await readFile(join(OUT, file[0])) });
      });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/?nodes=${NODES}${cap === undefined ? '' : `&max=${cap}`}`);
      await page.waitForFunction(() => window.__dagrBudget?.error || window.__dagrBudget?.state?.().drawn > 0, null, { timeout: 60_000 });
      assert.equal(await page.evaluate(() => window.__dagrBudget.error), undefined, `${stem}: renderer initialized`);
      // The first draw can come before the first resize measure; two more frames
      // let that measure land.
      await page.evaluate(() => window.__dagrBudget.frames(2));
      const adapter = await page.evaluate(async () => {
        const found = await window.navigator.gpu?.requestAdapter();
        if (!found) return null;
        const { vendor, architecture, description } = found.info ?? {};
        return { vendor, architecture, description, isFallbackAdapter: found.info?.isFallbackAdapter ?? found.isFallbackAdapter };
      });
      const state = await page.evaluate(() => window.__dagrBudget.state());
      if (CDP) {
        assert.equal(state.backend, 'webgpu', `${stem}: the canvas drew on webgpu`);
        assert.equal(adapter?.isFallbackAdapter, false, `${stem}: the adapter is not a fallback`);
      }
      const ratio = Math.min(deviceScaleFactor, cap ?? Infinity);
      assert.equal(state.viewport.devicePixelRatio, ratio, `${stem}: the camera renders at ratio ${ratio}`);
      assert.deepEqual(state.buffer, { width: Math.round(width * ratio), height: Math.round(height * ratio) },
        `${stem}: the drawing buffer is the viewport at ratio ${ratio}`);

      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const control = gaps(await page.evaluate((frames) => window.__dagrBudget.frames(frames), CONTROL_FRAMES));
      const idle = await page.evaluate(() => window.__dagrBudget.state());
      assert.equal(idle.drawn, state.drawn, `${stem}: nothing drew during the control frames`);

      const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      const x = width / 2;
      const y = height / 2;
      const moves = 60;
      const touchEvents = 2 * moves + 5;
      await page.evaluate(() => window.__dagrBudget.record(true));
      const started = performance.now();
      await send('touchStart', [{ id: 1, x: x - 30, y }]);
      await send('touchStart', [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }]);
      for (let step = 1; step <= moves; step += 1) {
        const spread = 30 + (step * (width / 2 - 50)) / moves;
        await send('touchMove', [{ id: 1, x: x - spread, y }, { id: 2, x: x + spread, y }]);
      }
      await send('touchEnd', []);
      await send('touchStart', [{ id: 1, x, y }]);
      for (let step = 1; step <= moves; step += 1) await send('touchMove', [{ id: 1, x: x + step * 2, y: y + step * 3 }]);
      await send('touchEnd', []);
      const inputMs = performance.now() - started;
      await sleep(200);
      const { draws, frames: stamps } = await page.evaluate(() => window.__dagrBudget.record(false));
      const after = await page.evaluate(() => window.__dagrBudget.state());
      assert.ok(after.scale > state.scale, `${stem}: the pinch zoomed in`);
      await page.screenshot({ path: join(OUT, `${stem}.png`) });
      report.rows.push({
        width, height, deviceScaleFactor, maxPixelRatio: cap ?? null, ratio, backend: state.backend, adapter,
        buffer: state.buffer, bufferPixels: state.buffer.width * state.buffer.height,
        heapMb: round(heap.usedSize / 2 ** 20),
        controlIntervalMs: summarise(control),
        gesture: {
          touchEvents, inputMs: Math.round(inputMs), msPerTouchEvent: round(inputMs / touchEvents),
          draws: draws.length, renderMs: summarise(draws.map((draw) => draw.ms)),
          frameIntervalMs: summarise(gaps(stamps)),
          drawIntervalMs: summarise(gaps(draws.map((draw) => draw.at))),
        },
        scale: [state.scale, after.scale],
      });
      console.error(`${stem}: ${state.backend} buffer ${state.buffer.width}x${state.buffer.height}, ${draws.length} draws`);
    } finally { await context.close(); }
  }
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (browser) await browser.close();
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ out: OUT, rows: report.rows.length, browser: report.browser, backends: [...new Set(report.rows.map((row) => row.backend))] }));
