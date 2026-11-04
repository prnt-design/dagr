/**
 * One touch sequence replayed on DagrCanvas and Explorer at phone/tablet sizes,
 * portrait and landscape, plus which of page and camera a one-finger swipe
 * moves under each surface's scroll policy, whether focusNode flies or,
 * under reduced motion, lands at once, what keys do on a focused graph, that a
 * controlled Explorer selection changes only when its owner's prop does, that
 * a pinch or drag survives a resize under it, and what each surface does when
 * a drag or pinch contact's pointer capture is taken away.
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

      const finite = (state) => [state.scale, state.center.x, state.center.y].every(Number.isFinite);
      // The canvas took the new size mid-gesture, rather than drawing the old
      // camera stretched into the new box.
      const sizedToHost = async (state, stem) => {
        const box = await page.locator(SURFACES.canvas.selector).boundingBox();
        assert.ok(Math.abs(state.viewport.width - box.width) < 1 && Math.abs(state.viewport.height - box.height) < 1,
          `${stem}: the camera viewport follows the resize`);
      };
      const isDragging = () => page.evaluate((selector) => document.querySelector(selector).hasAttribute('data-dragging'), SURFACES.explorer.selector);
      const nodeOnScreen = async (surface) => {
        const { host } = await centre(surface);
        const box = await host.boundingBox();
        const inside = (point) => point.x > box.x + 12 && point.x < box.x + box.width - 12
          && point.y > box.y + 12 && point.y < box.y + box.height - 12;
        let points;
        if (surface === 'canvas') {
          const origin = await page.locator('#canvas canvas').first().boundingBox();
          points = (await page.evaluate(() => window.__dagrMobile.canvasNodes()))
            .map(({ id, x, y }) => ({ id, x: origin.x + x, y: origin.y + y }));
        } else {
          points = await page.locator('#explorer [data-dagr-explorer="node"]').evaluateAll((elements) => elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { id: element.getAttribute('data-node-id'), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }));
        }
        const selected = surface === 'explorer' ? (await read('explorer')).selectedId : null;
        return points.find((point) => inside(point) && point.id !== selected);
      };
      // An Explorer zoomed in past its graph may show no node at all; it then
      // flies to one first, and the report says so.
      const tapNodeUnder = async (surface, stem, pause) => {
        let hit = await nodeOnScreen(surface);
        let flown = false;
        if (!hit && surface === 'explorer') {
          const selected = (await read('explorer')).selectedId;
          await page.evaluate((id) => window.__dagrMobile.explorerFocus(id), selected === 'c' ? 'b' : 'c');
          flown = true;
          hit = await nodeOnScreen(surface);
        }
        assert.ok(hit, `${stem}: a node is on screen to tap`);
        const clicks = surface === 'canvas' ? (await page.evaluate(() => window.__dagrMobile.canvasClicks())).length : 0;
        // Tapped at once after a drag that spanned a rotation, Chromium 148 at
        // 320x568 delivered pointerdown and pointerup to the node, and no
        // click reached the window. After a 400 ms pause it does.
        if (pause) await sleep(400);
        await tap(hit.x, hit.y);
        if (surface === 'canvas') {
          assert.deepEqual((await page.evaluate(() => window.__dagrMobile.canvasClicks())).slice(clicks), [hit.id], `${stem}: a tap afterwards hits node ${hit.id}`);
        } else {
          assert.equal((await read('explorer')).selectedId, hit.id, `${stem}: a tap afterwards selects node ${hit.id}`);
          // Closes the details the selection opened.
          await page.keyboard.press('Escape');
          await settle();
        }
        return { id: hit.id, flown };
      };
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-resize-pinch-${size}`;
        const section = page.locator(surface === 'canvas' ? '#canvas' : '#explorer');
        const { host, x, y } = await centre(surface);
        await host.focus();
        const touch = (id, px) => ({ id, x: px, y });
        const page0 = await scrollY();
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 70)]);
        const before = (await section.boundingBox()).width;
        await section.evaluate((element, next) => { element.style.width = `${next}px`; }, Math.round(before * 0.75));
        await settle();
        const shrunk = (await section.boundingBox()).width;
        const resized = await read(surface);
        if (surface === 'canvas') await sizedToHost(resized, stem);
        // Closing, since the spread before the resize may have reached
        // Explorer's maximum zoom.
        await send('touchMove', [touch(1, x - 30), touch(2, x + 50)]);
        await settle();
        const after = await read(surface);
        assert.ok(finite(resized) && finite(after), `${stem}: the camera stays finite`);
        // Explorer's zoom limits follow its area, so the resize itself may move
        // its scale and the pinch can stop at the new minimum.
        if (surface === 'canvas') assert.ok(Math.abs(after.scale / resized.scale - 80 / 100) < 0.01, `${stem}: the pinch keeps zooming after the container shrinks`);
        else assert.ok(after.scale < resized.scale && await isDragging(), `${stem}: the pinch keeps zooming out after the container shrinks`);
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
        await send('touchEnd', []);
        await settle();
        if (surface === 'explorer') assert.equal(await isDragging(), false, `${stem}: the drag state clears`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        const tapped = await tapNodeUnder(surface, stem, false);
        await section.evaluate((element) => { element.style.width = ''; });
        await settle();
        report.scenarios.push({ kind: 'resize-pinch', surface, width, height, orientation, deviceScaleFactor,
          sectionWidth: [before, shrunk], resized, after, tapped, result: 'pass' });
      }
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-resize-drag-${size}`;
        const { host, x, y } = await centre(surface);
        await host.focus();
        await send('touchStart', [{ id: 1, x, y }]);
        for (let step = 1; step <= 3; step += 1) await send('touchMove', [{ id: 1, x, y: y - 10 * step }]);
        await page.setViewportSize({ width: height, height: width });
        await settle();
        const page0 = await scrollY();
        const rotated = await read(surface);
        if (surface === 'canvas') await sizedToHost(rotated, stem);
        for (let step = 4; step <= 6; step += 1) await send('touchMove', [{ id: 1, x, y: y - 10 * step }]);
        await settle();
        const after = await read(surface);
        assert.ok(finite(rotated) && finite(after), `${stem}: the camera stays finite`);
        // Explorer clamps a pan of a graph that fits, as in the swipe rows.
        if (surface === 'canvas') assert.ok(Math.abs(Math.abs(after.center.y - rotated.center.y) * after.scale - 30) < 0.5, `${stem}: the drag keeps panning with the finger after the viewport rotates`);
        else assert.equal(await isDragging(), true, `${stem}: the graph keeps the drag after the viewport rotates`);
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
        await send('touchEnd', []);
        await settle();
        if (surface === 'explorer') assert.equal(await isDragging(), false, `${stem}: the drag state clears`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        const tapped = await tapNodeUnder(surface, stem, true);
        await page.setViewportSize({ width, height });
        await settle();
        report.scenarios.push({ kind: 'resize-drag', surface, width, height, orientation, deviceScaleFactor,
          rotated, after, tapped, result: 'pass' });
      }

      await page.evaluate(() => {
        window.__dagrPointers = [];
        window.addEventListener('pointerdown', (event) => window.__dagrPointers.push(event.pointerId), true);
      });
      // Hands a contact's capture (the newest, or the nth from last) to the
      // page body, with no pointercancel, and says which element of the
      // surface held it.
      const takeCapture = (surface, nth = 1) => page.evaluate(({ selector, nth }) => {
        const id = window.__dagrPointers.at(-nth);
        const root = document.querySelector(selector);
        const section = root.closest('section');
        const holder = [section, ...section.querySelectorAll('*')].find((element) => element.hasPointerCapture(id));
        if (holder === undefined) return null;
        document.body.setPointerCapture(id);
        return holder === root ? 'surface' : holder.tagName.toLowerCase();
      }, { selector: SURFACES[surface].selector, nth });
      const dragState = (surface) => page.evaluate(({ selector, attribute }) => document.querySelector(selector).hasAttribute(attribute),
        { selector: SURFACES[surface].selector, attribute: surface === 'canvas' ? 'data-dagr-dragging' : 'data-dragging' });
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-lost-capture-drag-${size}`;
        const { host, x, y } = await centre(surface);
        await host.focus();
        const page0 = await scrollY();
        const drag = async () => {
          await send('touchStart', [{ id: 1, x, y }]);
          for (let step = 1; step <= 3; step += 1) await send('touchMove', [{ id: 1, x, y: y - 10 * step }]);
        };
        await drag();
        assert.equal(await dragState(surface), true, `${stem}: the drag starts`);
        const holder = await takeCapture(surface);
        assert.equal(holder, 'surface', `${stem}: the surface holds the drag's capture`);
        const lost = await read(surface);
        // The browser reports the lost capture with the next event.
        for (let step = 4; step <= 6; step += 1) await send('touchMove', [{ id: 1, x, y: y - 10 * step }]);
        await settle();
        const after = await read(surface);
        assert.equal(await dragState(surface), false, `${stem}: losing the capture ends the drag`);
        assert.ok(finite(after), `${stem}: the camera stays finite`);
        // Explorer clamps a pan of a graph that fits, as in the swipe rows.
        if (surface === 'canvas') assert.ok(at(after, lost), `${stem}: the finger no longer moves the camera`);
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
        await send('touchEnd', []);
        await settle();
        await drag();
        const fresh = await dragState(surface);
        const moved = await read(surface);
        await send('touchEnd', []);
        await settle();
        assert.ok(fresh && !await dragState(surface), `${stem}: a fresh drag starts and ends`);
        if (surface === 'canvas') assert.ok(!at(moved, after), `${stem}: a fresh drag pans`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        report.scenarios.push({ kind: 'lost-capture-drag', surface, width, height, orientation, deviceScaleFactor,
          holder, lost, after, moved, result: 'pass' });
      }
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-lost-capture-pinch-${size}`;
        // From focusNode's zoom, landed at once, so the closing pinch below
        // has room before Explorer's minimum.
        await flight(surface, 'reduce', 'b');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const { host, x, y } = await centre(surface);
        await host.focus();
        const touch = (id, px) => ({ id, x: px, y });
        const page0 = await scrollY();
        const start = await read(surface);
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 20)]);
        const lost = await read(surface);
        assert.ok(!at(lost, start), `${stem}: the pinch moves the camera`);
        const holder = await takeCapture(surface);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 10)]);
        await settle();
        const after = await read(surface);
        assert.ok(finite(after), `${stem}: the camera stays finite`);
        if (surface === 'explorer') {
          assert.equal(holder, 'surface', `${stem}: Explorer holds the second contact's capture`);
          assert.ok(at(after, lost) && !await dragState(surface), `${stem}: losing a contact's capture ends the pinch`);
        } else {
          // See touchLost in DagrCanvas.tsx: a child losing capture is a handover.
          assert.equal(holder, 'canvas', `${stem}: the canvas element holds the contact's implicit capture`);
          assert.ok(Math.abs(after.scale / lost.scale - 40 / 50) < 0.01, `${stem}: the pinch keeps following the contact`);
        }
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
        await send('touchEnd', []);
        await settle();
        assert.equal(await dragState(surface), false, `${stem}: no drag state remains`);
        // Spreading, and still below where the closing pinch began, so
        // Explorer's maximum cannot stop it.
        await send('touchStart', [touch(1, x - 30)]);
        await send('touchStart', [touch(1, x - 30), touch(2, x + 30)]);
        await send('touchMove', [touch(1, x - 30), touch(2, x + 36)]);
        const fresh = await read(surface);
        await send('touchEnd', []);
        await settle();
        assert.ok(Math.abs(fresh.scale / after.scale - 1.1) < 0.01, `${stem}: a fresh pinch zooms`);
        assert.equal(await dragState(surface), false, `${stem}: and its drag state clears`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        report.scenarios.push({ kind: 'lost-capture-pinch', surface, width, height, orientation, deviceScaleFactor,
          holder, start, lost, after, fresh, result: 'pass' });
      }
      for (const surface of ['canvas', 'explorer']) {
        const stem = `${surface}-lost-capture-drag-pinch-${size}`;
        await flight(surface, 'reduce', 'b');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const { host, x, y } = await centre(surface);
        await host.focus();
        const page0 = await scrollY();
        // The first finger drags before the second lands, so the surface's
        // root, not the <canvas>, holds the first contact's capture.
        await send('touchStart', [{ id: 1, x: x - 30, y }]);
        for (let step = 1; step <= 3; step += 1) await send('touchMove', [{ id: 1, x: x - 30, y: y - 10 * step }]);
        const one = { id: 1, x: x - 30, y: y - 30 };
        assert.equal(await dragState(surface), true, `${stem}: the drag starts`);
        await send('touchStart', [one, { id: 2, x: x + 30, y: y - 30 }]);
        const start = await read(surface);
        await send('touchMove', [one, { id: 2, x: x + 20, y: y - 30 }]);
        await settle();
        const lost = await read(surface);
        assert.ok(!at(lost, start), `${stem}: the pinch moves the camera`);
        const holder = await takeCapture(surface, 2);
        assert.equal(holder, 'surface', `${stem}: the surface holds the dragging contact's capture`);
        // The browser reports the lost capture with that contact's next
        // event, so the first finger moves before the second does.
        const nudged = { ...one, y: y - 32 };
        await send('touchMove', [nudged, { id: 2, x: x + 20, y: y - 30 }]);
        await settle();
        await send('touchMove', [nudged, { id: 2, x: x + 10, y: y - 30 }]);
        await send('touchMove', [nudged, { id: 2, x, y: y - 50 }]);
        await settle();
        const after = await read(surface);
        assert.ok(finite(after), `${stem}: the camera stays finite`);
        assert.ok(at(after, lost), `${stem}: losing the root-held capture ends the pinch`);
        assert.equal(await dragState(surface), false, `${stem}: and the drag`);
        assert.equal(await scrollY(), page0, `${stem}: page stays`);
        await send('touchEnd', []);
        await settle();
        await send('touchStart', [{ id: 1, x: x - 30, y }]);
        await send('touchStart', [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }]);
        await send('touchMove', [{ id: 1, x: x - 30, y }, { id: 2, x: x + 36, y }]);
        const fresh = await read(surface);
        await send('touchEnd', []);
        await settle();
        assert.ok(Math.abs(fresh.scale / after.scale - 1.1) < 0.01, `${stem}: a fresh pinch zooms`);
        assert.equal(await dragState(surface), false, `${stem}: and its drag state clears`);
        await page.screenshot({ path: join(OUT, `${stem}.png`) });
        report.scenarios.push({ kind: 'lost-capture-drag-pinch', surface, width, height, orientation, deviceScaleFactor,
          holder, start, lost, after, fresh, result: 'pass' });
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
