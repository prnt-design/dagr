/**
 * One touch sequence replayed on DagrCanvas and Explorer at phone/tablet widths.
 * Build first. DAGR_BROWSER_DEPS points to a directory with playwright-core and
 * esbuild installed in node_modules; DAGR_CHROMIUM can override the executable.
 * Headless correctness only; software rendering is allowed, not a performance
 * or real-device/backend-parity claim. Writes screenshots and report.json.
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
  ?? join(tmpdir(), `dagr-mobile-core-${Date.now()}`);
await mkdir(OUT, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'bench/browser/mobile-core-page.mjs')],
  outfile: join(OUT, 'app.js'), bundle: true, format: 'iife', platform: 'browser',
  nodePaths: [join(ROOT, 'docs/node_modules'), join(ROOT, 'packages/react/node_modules'), join(ROOT, 'packages/explorer/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(join(OUT, 'index.html'), `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/app.css"><style>
body{margin:0;padding:8px;font:14px system-ui}h1{font-size:18px}h2{font-size:16px}
section{border:1px solid #bbb}button{font:inherit}
</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
const server = createServer(async (request, response) => {
  const file = files[request.url];
  if (!file) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { 'content-type': file[1] }).end(await readFile(join(OUT, file[0]))); }
  catch { response.writeHead(500).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const report = { mode: 'headless Chromium touch emulation, correctness only', scenarios: [] };
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DAGR_CHROMIUM ? { executablePath: process.env.DAGR_CHROMIUM } : {}),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  report.browser = browser.version();
  const address = server.address();
  for (const [width, deviceScaleFactor] of [[320, 1], [768, 3]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.waitForFunction(() => window.__dagrMobile?.error || (window.__dagrMobile?.canvas?.().scale > 0 && window.__dagrMobile?.explorer?.().scale > 0));
      const error = await page.evaluate(() => window.__dagrMobile.error);
      assert.equal(error, undefined, 'renderer initialized');
      const session = await context.newCDPSession(page);
      for (const surface of ['canvas', 'explorer']) {
        const selector = surface === 'canvas' ? '#canvas [role="group"]' : '#explorer [data-dagr-explorer="viewport"]';
        const host = page.locator(selector);
        await host.scrollIntoViewIfNeeded();
        await host.focus();
        const box = await host.boundingBox();
        assert.ok(box);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const touch = (id, px) => ({ id, x: px, y });
        const send = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const read = () => page.evaluate((name) => window.__dagrMobile[name](), surface);
        const before = await read();
        const stem = `${surface}-${width}-dpr${deviceScaleFactor}`;
        await page.screenshot({ path: join(OUT, `${stem}-before.png`) });
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30), touch(3, x + 100)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 70), touch(3, x + 100)]);
        const after = await read();
        assert.ok(Math.abs(after.scale / before.scale - 100 / 60) < 0.01, `${stem}: first pair keeps zooming`);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 70), touch(3, x + 110)]);
        assert.deepEqual(await read(), after, `${stem}: ignored contact does not move camera`);
        await send('touchCancel', []);
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 36)]);
        const resumed = await read();
        assert.ok(Math.abs(resumed.scale / after.scale - 1.1) < 0.01, `${stem}: cancellation permits a fresh pair`);
        await send('touchEnd', []);
        if (surface === 'explorer') assert.equal(after.selectedId, null, 'pinch did not activate a node');
        await page.screenshot({ path: join(OUT, `${stem}-after.png`) });
        report.scenarios.push({ surface, width, deviceScaleFactor, before, after, resumed, result: 'pass' });
      }
    } finally { await context.close(); }
  }
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ out: OUT, scenarios: report.scenarios.length, browser: report.browser }));
