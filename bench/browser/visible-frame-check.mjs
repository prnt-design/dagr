/**
 * The visible-frame contract (M5.8b) in a real browser, on DagrCanvas and
 * Explorer embedded mid-page: page scroll, pinch-zoom and its visual pan, a
 * shorter layout viewport, and an emulated 200% zoom. Build first.
 * DAGR_BROWSER_DEPS points to a directory with playwright-core and esbuild in
 * node_modules; DAGR_CHROMIUM can override the executable. Headless Chromium
 * correctness only, software rendering allowed. Writes screenshots and
 * report.json, including what Chromium could not emulate.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const deps = createRequire(join(process.env.DAGR_BROWSER_DEPS ?? join(ROOT, 'bench/browser'), 'package.json'));
const { build } = deps('esbuild');
const { chromium } = deps('playwright-core');
const OUT = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? join(tmpdir(), `dagr-visible-frame-${Date.now()}`);
await mkdir(OUT, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'bench/browser/visible-frame-page.mjs')],
  outfile: join(OUT, 'app.js'), bundle: true, format: 'iife', platform: 'browser',
  nodePaths: [join(ROOT, 'docs/node_modules'), join(ROOT, 'packages/react/node_modules'), join(ROOT, 'packages/explorer/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(join(OUT, 'index.html'), `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app.css"><style>
body{margin:0;padding:8px;font:14px system-ui}h1{font-size:18px;margin:0}section{border:1px solid #bbb}
</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
const server = createServer(async (request, response) => {
  const file = files[request.url];
  if (!file) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { 'content-type': file[1] }).end(await readFile(join(OUT, file[0]))); }
  catch { response.writeHead(500).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const read = (page) => page.evaluate(() => {
  const probe = window.__dagrFrame;
  const events = probe.events.splice(0);
  return { visual: probe.visual(), events, canvas: probe.canvas(), explorer: probe.explorer() };
});
/** Reads until two in a row agree, so an ease or a flight has landed. */
async function settle(page) {
  const { events, ...first } = await read(page);
  let last = JSON.stringify(first);
  for (let tries = 0; tries < 40; tries += 1) {
    await page.waitForTimeout(120);
    const { events: more, ...next } = await read(page);
    events.push(...more);
    const text = JSON.stringify(next);
    if (text === last) return { ...next, events };
    last = text;
  }
  throw new Error('camera did not settle in 4.8s');
}

const cameras = (state) => ({ canvas: { zoom: state.canvas.zoom, center: state.canvas.center }, explorer: state.explorer });
const wholeFrame = (state) => ({ x: 0, y: 0, width: state.canvas.viewport.width, height: state.canvas.viewport.height });
const unmoved = (stem, before, ...states) => {
  for (const state of states) {
    assert.deepEqual(cameras(state), cameras(before), `${stem}: both cameras and the selection unchanged`);
    assert.deepEqual(state.canvas.frame, wholeFrame(state), `${stem}: DagrCanvas frames its whole canvas`);
  }
};

const scenarios = {
  'page-scroll': {
    // A page scroll fires no visualViewport event, so a zoom out and back
    // makes both observers measure while the page is scrolled.
    async run({ page, cdp }) {
      await page.evaluate(() => {
        const top = document.querySelector('#canvas').getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top + 100);
      });
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    },
    check(stem, before, steps, after) {
      assert.ok(after.visual.canvasBox.top < 0, `${stem}: canvas partly above the layout viewport`);
      assert.equal(after.visual.scale, 1, `${stem}: zoom reset`);
      assert.ok(after.events.includes('resize'), `${stem}: visualViewport resize observed while scrolled`);
      unmoved(stem, before, after);
    },
  },
  'pinch-zoom': {
    async run({ page, cdp, steps }) {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      steps.push({ step: 'scale 2', ...(await settle(page)) });
      // On the page above the surfaces, so the drag pans the visual viewport.
      for (const [type, y] of [['touchStart', 200], ['touchMove', 150], ['touchMove', 100], ['touchMove', 60]]) {
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: 20, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      steps.push({ step: 'visual pan', ...(await settle(page)) });
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    },
    check(stem, before, [zoomed, panned], after) {
      assert.equal(zoomed.visual.scale, 2, `${stem}: page pinch-zoomed`);
      assert.ok(zoomed.events.includes('resize'), `${stem}: visualViewport resize observed`);
      assert.ok(zoomed.visual.offsetTop + zoomed.visual.height < zoomed.visual.canvasBox.bottom, `${stem}: zoomed visual viewport hides part of the canvas`);
      assert.ok(panned.visual.offsetTop > 0 && panned.events.includes('scroll'), `${stem}: visualViewport scroll observed`);
      assert.equal(after.visual.scale, 1, `${stem}: zoom reset`);
      unmoved(stem, before, zoomed, panned, after);
    },
  },
  'layout-shrink': {
    async run({ cdp, viewport }) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: Math.round(viewport.height * 0.6), deviceScaleFactor: viewport.dpr, mobile: true,
      });
    },
    check(stem, before, steps, after) {
      assert.ok(after.events.includes('resize'), `${stem}: visualViewport resize observed`);
      assert.ok(after.visual.layout.height < before.visual.layout.height, `${stem}: layout viewport shorter`);
      assert.ok(after.visual.canvasBox.bottom > after.visual.layout.height, `${stem}: canvas partly below the layout viewport`);
      unmoved(stem, before, after);
    },
  },
  'zoom-200-emulated': {
    async run({ cdp, viewport }) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width / 2, height: viewport.height / 2, deviceScaleFactor: viewport.dpr * 2, mobile: true,
      });
    },
    check(stem, before, steps, after) {
      const { viewport, buffer, zoom, center } = after.canvas;
      assert.equal(after.visual.devicePixelRatio, before.visual.devicePixelRatio * 2, `${stem}: pixel ratio doubled`);
      assert.equal(viewport.devicePixelRatio, after.visual.devicePixelRatio, `${stem}: DagrCanvas took the new pixel ratio`);
      assert.equal(buffer.width, Math.round(viewport.width * viewport.devicePixelRatio), `${stem}: drawing buffer resized`);
      assert.deepEqual({ zoom, center }, cameras(before).canvas, `${stem}: DagrCanvas keeps its camera through a resize`);
      assert.deepEqual(after.canvas.frame, wholeFrame(after), `${stem}: DagrCanvas frames its whole canvas`);
      assert.equal(after.explorer.selectedId, before.explorer.selectedId, `${stem}: Explorer keeps the selection`);
    },
  },
  // A software keyboard that overlays the page shrinks the visual viewport at
  // scale 1. Chromium's DevTools protocol has no direct way to do that, so this
  // records whether `setVisibleSize` reproduced it; if not, nothing may move.
  'visual-shrink-attempt': {
    async run({ cdp, viewport }) {
      await cdp.send('Emulation.setVisibleSize', { width: viewport.width, height: Math.round(viewport.height * 0.6) });
    },
    check(stem, before, steps, after) {
      const { scale, height, layout } = after.visual;
      const reproduced = scale === 1 && height < layout.height;
      if (!reproduced) { unmoved(stem, before, after); return { reproduced }; }
      assert.ok(after.visual.canvasBox.bottom > after.visual.offsetTop + height, `${stem}: visual viewport hides part of the canvas`);
      assert.ok(after.canvas.frame.height < after.canvas.viewport.height, `${stem}: hidden part leaves the frame`);
      return { reproduced };
    },
  },
};

let browser;
const report = {
  mode: 'headless Chromium, DevTools mobile and touch emulation, correctness only',
  scenarios: [],
};
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DAGR_CHROMIUM ? { executablePath: process.env.DAGR_CHROMIUM } : {}),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  report.browser = browser.version();
  const address = server.address();
  for (const viewport of [{ width: 390, height: 844, dpr: 3 }, { width: 320, height: 568, dpr: 1 }]) {
    for (const [name, { run, check }] of Object.entries(scenarios)) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr, isMobile: true, hasTouch: true,
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction(() => {
          const probe = window.__dagrFrame;
          return probe?.error || (probe?.canvas?.().zoom > 0 && probe?.explorer?.().camera?.scale > 0);
        });
        assert.equal(await page.evaluate(() => window.__dagrFrame.error), undefined, 'renderer initialized');
        await page.evaluate(() => window.__dagrFrame.select('b'));
        const before = await settle(page);
        const cdp = await context.newCDPSession(page);
        const stem = `${name}-${viewport.width}-dpr${viewport.dpr}`;
        await page.screenshot({ path: join(OUT, `${stem}-before.png`) });
        const steps = [];
        await run({ page, cdp, viewport, steps });
        const after = await settle(page);
        await page.screenshot({ path: join(OUT, `${stem}-after.png`) });
        assert.deepEqual(errors, [], `${stem}: no page errors`);
        const outcome = check(stem, before, steps, after);
        report.scenarios.push({ name, viewport, result: 'pass', ...outcome, before, steps, after });
      } finally { await context.close(); }
    }
  }
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({
  out: OUT, browser: report.browser, backend: report.scenarios[0]?.before.canvas.backend,
  passed: report.scenarios.map(({ name, viewport, reproduced }) => `${name} ${viewport.width}${reproduced === false ? ' (not reproduced)' : ''}`),
}));
