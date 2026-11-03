/**
 * One touch sequence replayed on DagrCanvas and Explorer at phone/tablet sizes,
 * portrait and landscape, plus which of page and camera a one-finger swipe
 * moves under each surface's scroll policy, whether focusNode flies or,
 * under reduced motion, lands at once, what keys do on a focused graph, and
 * that a controlled Explorer selection changes only when its owner's prop does.
 * Build first. DAGR_BROWSER_DEPS points to a directory with playwright-core and
 * esbuild installed in node_modules; DAGR_CHROMIUM can override the executable.
 * Launched, it is headless correctness only; software rendering is allowed, not
 * a performance or real-device/backend-parity claim. DAGR_CDP attaches to a
 * running Chrome instead (see windows-chrome.mjs), and then the run fails
 * unless both canvases drew on WebGPU and the page's default adapter is not a
 * fallback.
 * Writes screenshots and report.json.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const deps = createRequire(join(process.env.DAGR_BROWSER_DEPS ?? join(ROOT, 'bench/browser'), 'package.json'));
const { build } = deps('esbuild');
const { chromium } = deps('playwright-core');
const CDP = process.env.DAGR_CDP;
// Requests to this origin are answered by route handlers, not a server, so a
// Chrome on another host (Windows, from WSL2) loads the same files. Loopback,
// because WebGPU exists only in a secure context.
const ORIGIN = 'http://127.0.0.1:8734';
const OUT = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? join(tmpdir(), `dagr-mobile-core-${Date.now()}`);
// Portrait sizes; each also runs rotated to landscape.
const DEVICES = [
  { width: 320, height: 568, deviceScaleFactor: 1 },
  { width: 390, height: 844, deviceScaleFactor: 3 },
  { width: 768, height: 1024, deviceScaleFactor: 2 },
];
const SURFACES = {
  canvas: { selector: '#canvas [role="group"]', probe: 'canvas' },
  canvasTwoFinger: { selector: '#canvas-two-finger [role="group"]', probe: 'canvasTwoFinger' },
  explorer: { selector: '#explorer [data-dagr-explorer="viewport"]', probe: 'explorer' },
  controlled: { selector: '#explorer-controlled [data-dagr-explorer="viewport"]', probe: 'controlled' },
};
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
let browser;
const report = {
  mode: CDP ? `attached Chrome touch emulation at ${CDP}, WebGPU required` : 'headless Chromium touch emulation, correctness only',
  backends: [],
  scenarios: [],
};
try {
  browser = CDP ? await chromium.connectOverCDP(CDP) : await chromium.launch({
    headless: true,
    ...(process.env.DAGR_CHROMIUM ? { executablePath: process.env.DAGR_CHROMIUM } : {}),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  report.browser = browser.version();
  for (const device of DEVICES) for (const orientation of ['portrait', 'landscape']) {
    const { deviceScaleFactor } = device;
    const [width, height] = orientation === 'portrait' ? [device.width, device.height] : [device.height, device.width];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, isMobile: true, hasTouch: true });
    try {
      await context.route(`${ORIGIN}/**`, async (route) => {
        const file = files[new URL(route.request().url()).pathname];
        if (!file) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: file[1], body: await readFile(join(OUT, file[0])) });
      });
      const page = await context.newPage();
      await page.goto(ORIGIN);
      await page.waitForFunction(() => window.__dagrMobile?.error || (window.__dagrMobile?.canvas?.().scale > 0
        && window.__dagrMobile?.canvasTwoFinger?.().scale > 0 && window.__dagrMobile?.explorer?.().scale > 0
        && window.__dagrMobile?.controlled?.().scale > 0));
      const error = await page.evaluate(() => window.__dagrMobile.error);
      assert.equal(error, undefined, 'renderer initialized');
      const size = `${width}x${height}-dpr${deviceScaleFactor}`;
      const drawn = await page.evaluate(async () => {
        const found = await window.navigator.gpu?.requestAdapter();
        const { vendor, architecture, device, description, isFallbackAdapter } = found?.info ?? {};
        const adapter = found ? { vendor, architecture, device, description, isFallbackAdapter: isFallbackAdapter ?? found.isFallbackAdapter } : null;
        return { canvas: window.__dagrMobile.canvas().backend, canvasTwoFinger: window.__dagrMobile.canvasTwoFinger().backend, adapter };
      });
      report.backends.push({ width, height, orientation, deviceScaleFactor, ...drawn });
      if (CDP) {
        assert.ok(drawn.canvas === 'webgpu' && drawn.canvasTwoFinger === 'webgpu', `${size}: both canvases drew on webgpu`);
        assert.equal(drawn.adapter?.isFallbackAdapter, false, `${size}: the adapter is not a fallback`);
      }
      const session = await context.newCDPSession(page);
      const send = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const read = (surface) => page.evaluate((name) => window.__dagrMobile[name](), SURFACES[surface].probe);
      const scrollY = () => page.evaluate(() => window.scrollY);
      // Puts the surface's centre mid-viewport, with the page and the camera at rest.
      const centre = async (surface) => {
        const host = page.locator(SURFACES[surface].selector);
        await host.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        await settle();
        await page.waitForFunction((probe) => new Promise((resolve) => {
          const before = JSON.stringify([window.scrollY, window.__dagrMobile[probe]().center]);
          window.setTimeout(() => resolve(JSON.stringify([window.scrollY, window.__dagrMobile[probe]().center]) === before), 100);
        }), SURFACES[surface].probe);
        const box = await host.boundingBox();
        assert.ok(box);
        return { host, x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      // Returns whether the Explorer viewport marked itself as dragging mid-swipe.
      const swipe = async (x, y, dy, surface) => {
        await send('touchStart', [{ id: 1, x, y }]);
        for (let step = 1; step <= 6; step += 1) await send('touchMove', [{ id: 1, x, y: y - (dy * step) / 6 }]);
        // Held still before lifting, so a page scroll ends without a fling
        // that would still be moving the page during the next scenario.
        await sleep(150);
        await send('touchMove', [{ id: 1, x, y: y - dy }]);
        const dragging = surface === 'explorer'
          ? await page.evaluate((selector) => document.querySelector(selector).hasAttribute('data-dragging'), SURFACES.explorer.selector)
          : undefined;
        await send('touchEnd', []);
        await settle();
        return dragging;
      };
      const tap = async (x, y) => {
        await send('touchStart', [{ id: 1, x, y }]);
        await send('touchEnd', []);
        await settle();
      };

      const scroll = async (surface, policy, owner) => {
        const { x, y } = await centre(surface);
        const stem = `${surface}-scroll-${policy}-${size}`;
        const page0 = await scrollY();
        const camera0 = await read(surface);
        const dragging = await swipe(x, y, 80, surface);
        const page1 = await scrollY();
        const camera1 = await read(surface);
        const cameraMoved = camera1.center.x !== camera0.center.x || camera1.center.y !== camera0.center.y;
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        if (owner === 'camera') {
          // Explorer clamps a pan that would push a graph which fits away from
          // the middle, so its own drag state is the evidence there.
          if (surface === 'explorer') assert.ok(dragging, `${stem}: graph takes the drag`);
          else assert.ok(cameraMoved, `${stem}: camera pans`);
          assert.equal(page1, page0, `${stem}: page stays`);
        } else {
          assert.ok(page1 > page0, `${stem}: page scrolls`);
          assert.ok(!cameraMoved && !dragging, `${stem}: camera stays`);
        }
        report.scenarios.push({ kind: 'scroll', surface, policy, owner, width, height, orientation, deviceScaleFactor,
          scrollY: [page0, page1], center: [camera0.center, camera1.center], dragging, result: 'pass' });
      };

      const node = page.locator('#explorer [data-dagr-explorer="node"]').first();
      const nodeId = await node.getAttribute('data-node-id');
      const tapNode = async () => {
        await centre('explorer');
        const box = await node.boundingBox();
        assert.ok(box);
        await tap(box.x + box.width / 2, box.y + box.height / 2);
      };
      const focused = () => page.evaluate((selector) => document.querySelector(selector).contains(document.activeElement), SURFACES.explorer.selector);
      assert.equal(await focused(), false, `explorer-focus-${size}: starts unfocused`);
      await tapNode();
      assert.equal(await focused(), true, `explorer-focus-${size}: first tap focuses`);
      assert.equal((await read('explorer')).selectedId, null, `explorer-focus-${size}: first tap selects nothing`);
      await tapNode();
      const selectedId = (await read('explorer')).selectedId;
      assert.equal(selectedId, nodeId, `explorer-focus-${size}: second tap selects the tapped node`);
      report.scenarios.push({ kind: 'focus-gate', surface: 'explorer', width, height, orientation, deviceScaleFactor, selectedId, result: 'pass' });
      // The tap selected a node and may have opened details; close them before the swipes.
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      await scroll('canvas', 'drag', 'camera');
      await scroll('canvasTwoFinger', 'two-finger', 'page');
      await scroll('explorer', 'unfocused', 'page');
      await page.locator(SURFACES.explorer.selector).focus();
      await scroll('explorer', 'focused', 'camera');

      for (const surface of ['canvas', 'explorer']) {
        const { host, x, y } = await centre(surface);
        await host.focus();
        const touch = (id, px) => ({ id, x: px, y });
        const before = await read(surface);
        const stem = `${surface}-pinch-${size}`;
        await page.screenshot({ path: join(OUT, `${stem}-before.png`) });
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30), touch(3, x + 100)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 70), touch(3, x + 100)]);
        const after = await read(surface);
        assert.ok(Math.abs(after.scale / before.scale - 100 / 60) < 0.01, `${stem}: first pair keeps zooming`);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 70), touch(3, x + 110)]);
        assert.deepEqual(await read(surface), after, `${stem}: ignored contact does not move camera`);
        await send('touchCancel', []);
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 36)]);
        const resumed = await read(surface);
        assert.ok(Math.abs(resumed.scale / after.scale - 1.1) < 0.01, `${stem}: cancellation permits a fresh pair`);
        await send('touchEnd', []);
        if (surface === 'explorer') assert.equal(after.selectedId, before.selectedId, `${stem}: pinch did not activate a node`);
        await page.screenshot({ path: join(OUT, `${stem}-after.png`) });
        report.scenarios.push({ kind: 'pinch', surface, width, height, orientation, deviceScaleFactor, before, after, resumed, result: 'pass' });
      }

      // Returns the camera two frames after focusNode, and once it has settled.
      const flight = async (surface, motion, id) => {
        await page.emulateMedia({ reducedMotion: motion });
        const result = await page.evaluate(async ({ probe, id }) => {
          const read = () => window.__dagrMobile[probe]();
          const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
          if (!window.__dagrMobile[`${probe}Focus`](id)) return null;
          await frame();
          await frame();
          const early = read();
          let late = read();
          for (let waited = 0; waited < 3000; waited += 150) {
            await new Promise((resolve) => window.setTimeout(resolve, 150));
            const next = read();
            if (JSON.stringify(next) === JSON.stringify(late)) break;
            late = next;
          }
          return { early, late };
        }, { probe: SURFACES[surface].probe, id });
        assert.ok(result, `${surface}-reduced-motion-${size}: focusNode found node ${id}`);
        return result;
      };
      const at = (one, two) => Math.abs(one.scale - two.scale) < 1e-9
        && Math.abs(one.center.x - two.center.x) < 1e-6 && Math.abs(one.center.y - two.center.y) < 1e-6;
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-reduced-motion-${size}`;
        await centre(surface);
        const toA = await flight(surface, 'no-preference', 'a');
        assert.ok(!at(toA.early, toA.late), `${stem}: focusNode flies over several frames`);
        const toD = await flight(surface, 'no-preference', 'd');
        assert.ok(!at(toD.early, toD.late), `${stem}: focusNode flies back over several frames`);
        const reduced = await flight(surface, 'reduce', 'a');
        assert.ok(at(reduced.early, toA.late), `${stem}: under reduced motion focusNode has landed two frames after the call`);
        assert.ok(at(reduced.late, reduced.early), `${stem}: and stays there`);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        report.scenarios.push({ kind: 'reduced-motion', surface, width, height, orientation, deviceScaleFactor,
          flying: toA, back: toD, reduced, result: 'pass' });
      }

      // A key that scrolls the page by default must move only the graph. Long
      // enough for a smooth keyboard scroll to have shown up.
      const pageStays = async (page0, stem) => {
        await sleep(300);
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
      };
      {
        const stem = `canvas-keyboard-${size}`;
        const { host } = await centre('canvas');
        await host.focus();
        const page0 = await scrollY();
        const before = await read('canvas');
        await page.keyboard.press('ArrowRight');
        await settle();
        const panned = await read('canvas');
        assert.ok(panned.center.x !== before.center.x && panned.scale === before.scale, `${stem}: ArrowRight pans`);
        await page.keyboard.press('ArrowLeft');
        await settle();
        const back = await read('canvas');
        assert.ok(back.center.x !== panned.center.x && back.scale === panned.scale, `${stem}: ArrowLeft pans`);
        await page.keyboard.press('ArrowDown');
        await settle();
        const zoomed = await read('canvas');
        assert.ok(zoomed.scale < back.scale, `${stem}: ArrowDown zooms out`);
        await pageStays(page0, stem);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        report.scenarios.push({ kind: 'keyboard', surface: 'canvas', width, height, orientation, deviceScaleFactor,
          before, panned, back, zoomed, result: 'pass' });
      }
      const activeNode = (section) => page.evaluate((selector) => document.activeElement?.closest(selector)
        ? document.activeElement.getAttribute('data-node-id') : null, section);
      {
        const stem = `explorer-keyboard-${size}`;
        await centre('explorer');
        const first = page.locator('#explorer [data-dagr-explorer="node"][tabindex="0"]');
        const from = await first.getAttribute('data-node-id');
        await first.focus();
        // The chain a-b-c-d lays out left to right.
        const arrow = from === 'd' ? 'ArrowLeft' : 'ArrowRight';
        await page.keyboard.press(arrow);
        await settle();
        const to = await activeNode('#explorer');
        assert.ok(to !== null && to !== from, `${stem}: ${arrow} moves focus from node ${from} to another node`);
        await centre('explorer');
        // Out first: the focusNode flight above may have left the camera at
        // its maximum zoom, where + has nowhere to go.
        const before = await read('explorer');
        await page.keyboard.press('-');
        await centre('explorer');
        const out = await read('explorer');
        assert.ok(out.scale < before.scale, `${stem}: - zooms out`);
        await page.keyboard.press('+');
        await centre('explorer');
        const zoomed = await read('explorer');
        assert.ok(zoomed.scale > out.scale, `${stem}: + zooms in`);
        // No node lies below in the chain, so ArrowDown moves nothing; it
        // would scroll the page if the node did not take it.
        const page0 = await scrollY();
        await page.keyboard.press('ArrowDown');
        await pageStays(page0, stem);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        assert.equal(await focused(), true, `${stem}: the graph still has focus`);
        await page.keyboard.press('Escape');
        await settle();
        assert.equal(await focused(), false, `${stem}: Escape leaves the graph`);
        report.scenarios.push({ kind: 'keyboard', surface: 'explorer', width, height, orientation, deviceScaleFactor,
          focus: [from, to], scale: [before.scale, out.scale, zoomed.scale], result: 'pass' });
      }
      {
        const stem = `explorer-controlled-${size}`;
        const requests = () => page.evaluate(() => window.__dagrMobile.controlledRequests());
        const pressed = () => page.locator('#explorer-controlled [aria-pressed="true"]').count();
        const owner = async (id) => {
          await page.evaluate((next) => window.__dagrMobile.controlledSelect(next), id);
          await settle();
        };
        await centre('controlled');
        const first = page.locator('#explorer-controlled [data-dagr-explorer="node"][tabindex="0"]');
        const id = await first.getAttribute('data-node-id');
        await first.focus();
        await page.keyboard.press('Enter');
        await settle();
        assert.deepEqual(await requests(), [id], `${stem}: Enter asks the owner for node ${id}`);
        const unselected = async (step) => {
          const state = await read('controlled');
          assert.ok(state.selectedId === null && !state.detailsOpen && await pressed() === 0, `${stem}: ${step}, and nothing is selected yet`);
        };
        await unselected('Enter');
        // Fitted, these nodes are small enough that only the focused one has an
        // element, so the arrow key moves focus to the node the tap lands on.
        await page.keyboard.press(id === 'd' ? 'ArrowLeft' : 'ArrowRight');
        await settle();
        const otherId = await activeNode('#explorer-controlled');
        assert.ok(otherId !== null && otherId !== id, `${stem}: focus moves to another node`);
        await centre('controlled');
        const box = await page.locator(`#explorer-controlled [data-node-id="${otherId}"]`).boundingBox();
        assert.ok(box);
        await tap(box.x + box.width / 2, box.y + box.height / 2);
        assert.deepEqual(await requests(), [id, otherId], `${stem}: a tap asks the owner for node ${otherId}`);
        await unselected('tap');
        await owner(otherId);
        const given = await read('controlled');
        assert.ok(given.selectedId === otherId && given.detailsOpen && await pressed() === 1, `${stem}: the owner's prop selects it and opens details`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        await owner(null);
        const cleared = await read('controlled');
        assert.ok(cleared.selectedId === null && !cleared.detailsOpen && await pressed() === 0, `${stem}: the owner clears it`);
        assert.equal((await requests()).length, 2, `${stem}: with no callback back to the owner`);
        report.scenarios.push({ kind: 'controlled', surface: 'explorer', width, height, orientation, deviceScaleFactor,
          requests: await requests(), result: 'pass' });
      }
    } finally { await context.close(); }
  }
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (browser) await browser.close();
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ out: OUT, scenarios: report.scenarios.length, browser: report.browser, backends: [...new Set(report.backends.flatMap((one) => [one.canvas, one.canvasTwoFinger]))] }));
