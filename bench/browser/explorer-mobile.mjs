/** Headless mobile regression matrix. See explorer-mobile.md for scope and limitations. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const deps = createRequire(join(process.env.DAGR_BROWSER_DEPS ?? '/tmp/dagr-mobile-deps', 'package.json'));
const { build } = deps('esbuild');
const engines = deps('playwright-core');
const before = process.argv.includes('--before');
const out = process.env.DAGR_MOBILE_OUT ?? '/tmp/dagr-mobile-evidence';
await mkdir(out, { recursive: true });
const result = await build({ plugins: before ? [{ name: 'baseline', setup(builder) {
  builder.onLoad({ filter: /packages\/explorer\/(src\/(explorer-details|explorer-search|use-explorer-camera)\.tsx?|styles\.css)$/ }, args => ({
    contents: execFileSync('git', ['show', `2a653da:${args.path.slice(root.length)}`], { cwd: root, encoding: 'utf8' }),
    loader: args.path.endsWith('.css') ? 'css' : 'tsx', resolveDir: args.path.slice(0, args.path.lastIndexOf('/')),
  }));
} }] : [], entryPoints: [join(root, 'bench/browser/explorer-mobile-page.tsx')], bundle: true,
  write: false, outdir: out, nodePaths: [join(root, 'packages/explorer/node_modules')], format: 'esm', jsx: 'automatic', sourcemap: false });
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px}#app{max-width:100%}</style><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const report = { baseline: '2a653da', phase: before ? 'before' : 'after', results: [], unavailable: [
  'Real iOS/Android devices and screen readers were not available.',
  'Software keyboard cannot be opened by these headless desktop browser engines; viewport shrink is tested separately.',
] };
const hook = name => `[data-dagr-explorer="${name}"]`;
async function gestures(page, context, engine, viewport, name, checks) {
  const surface = page.locator(hook('viewport'));
  await surface.scrollIntoViewIfNeeded();
  await surface.evaluate(el => el.focus({ preventScroll: true }));
  const camera = () => page.locator(hook('plane')).evaluate(el => {
    const matrix = new window.DOMMatrixReadOnly(el.style.transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const next = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await surface.press('0');
  await next();
  const initial = await camera();
  // Under reduced motion the toolbar command reaches its target by the next frame.
  await surface.press('+');
  await next();
  const zoomed = await camera();
  assert(zoomed.scale > initial.scale, 'reduced motion keyboard zoom');
  const still = await camera();
  assert.equal(still.scale, zoomed.scale);
  checks.push({ name: 'reduced motion keyboard zoom', status: 'pass' });
  if (engine === 'chromium') {
    const client = await context.newCDPSession(page);
    try {
      const box = await surface.boundingBox();
      const center = { x: box.x + box.width / 2, y: Math.max(40, Math.min(viewport.height - 80, box.y + box.height / 2)) };
      const at = half => [ { x: center.x - half, y: center.y, id: 1 }, { x: center.x + half, y: center.y, id: 2 } ];
      const start = await camera();
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(25) });
      for (let i = 1; i <= 8; i++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(25 + i * 5) });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await next();
      const pinched = await camera();
      assert(pinched.scale > start.scale * 1.4, 'protocol touch pinch zooms graph');
      assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, id: 1 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + 45, y: center.y + 20, id: 1 }] });
      await next();
      const panned = await camera();
      assert(panned.x !== pinched.x || panned.y !== pinched.y, 'protocol touch pan moves camera');
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await next();
      assert.notEqual(await surface.getAttribute('data-dragging'), 'true', 'cancel releases drag');
      checks.push({ name: 'Chromium protocol touch pinch, pan and cancel', status: 'pass' });
      await page.screenshot({ path: join(out, `${name}-gestures.png`), fullPage: true });
      // Browser visual viewport magnification, not a desktop Ctrl-plus claim.
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      assert.equal(await page.evaluate(() => window.visualViewport.scale), 2);
      await page.screenshot({ path: join(out, `${name}-visual-zoom.png`), fullPage: true });
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      checks.push({ name: 'Chromium browser visual zoom 200%', status: 'pass' });
      await surface.evaluate(el => el.blur());
      await page.evaluate(() => window.scrollTo(0, 0));
      await next();
      const outside = await surface.boundingBox();
      const y = Math.min(viewport.height - 30, outside.y + 180);
      const scroll = await page.evaluate(() => window.scrollY);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: outside.x + 12, y, id: 1 }] });
      for (let i = 1; i <= 8; i++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: outside.x + 12, y: y - i * 12, id: 1 }] });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => window.scrollY) > scroll, 'unfocused graph allows native page swipe');
      checks.push({ name: 'unfocused graph native swipe scrolls page', status: 'pass' });
    } finally { await client.detach(); }
  }
  // Rotation and a keyboard-sized viewport shrink retain the same open reading body.
  await page.locator(hook('search-results') + ' button').first().click();
  const label = await page.locator(hook('details-label')).textContent();
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  assert.equal(await page.locator(hook('details-label')).textContent(), label);
  await page.setViewportSize({ width: viewport.width, height: 320 });
  assert.equal(await page.locator(hook('details-label')).textContent(), label);
  await page.locator(hook('details-close')).click();
  await page.setViewportSize(viewport);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page overflow');
  checks.push({ name: 'rotation and viewport shrink retain details; no horizontal overflow', status: 'pass' });
}

try {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' && process.env.DAGR_CHROMIUM ? { executablePath: process.env.DAGR_CHROMIUM } : {}) }); }
    catch (error) { report.unavailable.push(`${engine}: ${String(error)}`); continue; }
    try {
      for (const width of [320, 358, 390, 768]) for (const landscape of [false, true]) {
        const viewport = { width: landscape ? 844 : width + 32, height: landscape ? 390 : 844 };
        const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const name = `${report.phase}-${engine}-${width}-${landscape ? 'landscape' : 'portrait'}`;
        const checks = [];
        page.setDefaultTimeout(5000);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(String(error)));
        try {
          await page.goto(url);
          // Container width is independent of viewport width, including embedded narrow hosts.
          await page.locator('#app').evaluate((el, w) => { el.style.width = `${w}px`; }, width);
          await page.locator(hook('plane')).waitFor({ state: 'visible' });
          await page.locator(hook('search') + ' input').fill('Booking');
          await page.screenshot({ path: join(out, `${name}-search.png`), fullPage: true });
          const opener = page.locator(hook('search-results') + ' button').first();
          await opener.tap();
          const details = page.locator(hook('details'));
          await details.waitFor();
          await page.waitForTimeout(150);
          const graph = await page.locator(hook('viewport')).boundingBox();
          const panel = await details.boundingBox();
          const close = await page.locator(hook('details-close')).boundingBox();
          const zoom = await page.locator('[data-action="zoom-in"]').boundingBox();
          if (!before) {
            assert(panel.width < graph.width || panel.height <= graph.height * 0.51, 'details must leave usable graph space');
            assert(close.width >= 44 && close.height >= 44 && zoom.width >= 44 && zoom.height >= 44, '44px controls');
          }
          if (!before && width < 720) assert(panel.y < viewport.height && panel.y + panel.height > 0, 'compact reading panel is onscreen after inspect');
          const targets = await page.locator(`${hook('toolbar')} button, ${hook('trace')}, ${hook('search-results')} button, ${hook('connections')} button`).evaluateAll(els => els.map(el => {
            const box = el.getBoundingClientRect(); return { width: box.width, height: box.height };
          }));
          if (!before) assert(targets.every(box => box.width >= 44 && box.height >= 44), 'primary library targets are at least 44px');
          checks.push({ name: 'inspect geometry', graph, panel, close, zoom, targets });
          await page.screenshot({ path: join(out, `${name}-inspect.png`), fullPage: true });
          await page.locator(hook('connections') + ' button').first().tap();
          await page.waitForFunction(() => document.querySelector('#selection').textContent === 'payment');
          checks.push({ name: 'controlled follow', status: 'pass' });
          await page.screenshot({ path: join(out, `${name}-follow.png`), fullPage: true });
          await page.locator(hook('details-close')).tap();
          await details.waitFor({ state: 'detached' });
          assert(await opener.evaluate(el => document.activeElement === el), 'focus returns to search opener');
          await page.screenshot({ path: join(out, `${name}-close.png`), fullPage: true });
          checks.push({ name: 'close and focus return', status: 'pass' });
          await opener.focus();
          await page.keyboard.press('Enter');
          await details.waitFor();
          await page.locator(hook('details-close')).focus();
          await page.keyboard.press('Escape');
          await details.waitFor({ state: 'detached' });
          assert(await opener.evaluate(el => document.activeElement === el));
          checks.push({ name: 'keyboard inspect, Escape and focus return', status: 'pass' });
          // Native wheel outside the graph must continue to scroll the page.
          await page.mouse.move(viewport.width - 3, viewport.height / 2);
          const scroll = await page.evaluate(() => window.scrollY);
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(150);
          assert(await page.evaluate(() => window.scrollY) > scroll, 'page scroll outside graph');
          checks.push({ name: 'page scroll around graph', status: 'pass' });
          await gestures(page, context, engine, viewport, name, checks);
          assert.deepEqual(pageErrors, [], 'no page errors');
          report.results.push({ name, browser: browser.version(), status: 'pass', checks });
        } catch (error) { console.error(name, String(error)); report.results.push({ name, status: 'fail', error: String(error), checks }); }
        finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(out, `${report.phase}-report.json`), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
assert(report.results.length > 0, 'at least one browser must run');
assert(!report.results.some(row => row.status === 'fail'), 'mobile matrix failed');
