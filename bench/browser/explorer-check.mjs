/**
 * The explorer in real browsers: a check of the docs demos, and a
 * measurement of the SVG base's ceiling.
 *
 * **Check mode** (the default) serves the built docs site and drives
 * `/docs/explorer` in Chromium and WebKit, at 1440 by 900 and at 390 by 844
 * with touch and `isMobile`. Every check is an assertion, the script exits
 * non-zero if any fails, and it writes screenshots of both demos (at rest,
 * zoomed and with the drawer open, light and dark) and `report.json` to the
 * output directory. A check that cannot run on a profile (a mouse wheel on a
 * phone that has none) is reported as `n/a` with the reason, never as a pass.
 *
 * **Ceiling mode** (`ceiling` as the first argument) bundles
 * `explorer-ceiling-page.mjs` against the built explorer and measures frame
 * intervals while dragging the camera across generated graphs of 500 to 8,000
 * nodes in headless Chromium. See `README.md` beside this file for what the
 * numbers mean and the ones it produced.
 *
 * Neither is part of `pnpm test`, `pnpm bench:ci` or CI, for the reason
 * everything in this directory is outside them: this repo has no browser on
 * CI. It is committed so `pnpm lint` reads it and so the checks can be run
 * again and disagreed with.
 *
 * ```
 * pnpm build                                   # the docs site and every dist
 * npm --prefix bench/browser install --no-save playwright-core esbuild
 * node bench/browser/explorer-check.mjs        # [--out=DIR] [--browsers=chromium,webkit]
 * node bench/browser/explorer-check.mjs ceiling  # [--out=DIR] [--sizes=500,1000]
 * ```
 *
 * `playwright-core` and `esbuild` are not workspace dependencies. Install them
 * anywhere and set `DAGR_BROWSER_DEPS` to the directory whose `node_modules`
 * holds them, if not `bench/browser`. The browsers are Playwright's own, from
 * its cache (`npx playwright-core install chromium webkit` fills it); set
 * `DAGR_CHROMIUM` to use another Chromium executable.
 *
 * The page-side helpers below run in the BROWSER: `page.addInitScript` and
 * `page.evaluate` serialise the function and evaluate it there, which is why
 * they reach browser globals through `window`.
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SITE = join(ROOT, 'docs', 'build');
const DEPS = process.env.DAGR_BROWSER_DEPS ?? fileURLToPath(new URL('.', import.meta.url));
const requireDep = createRequire(join(DEPS, 'package.json'));

const args = process.argv.slice(2);
const mode = args[0] === 'ceiling' ? 'ceiling' : 'check';
const flag = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = flag('out', join(tmpdir(), `dagr-explorer-${mode}-${stamp}`));

const PROFILES = [
  { name: '1440', options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, resizeTo: { width: 1100, height: 900 } },
  {
    name: '390',
    options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    // A phone turned on its side.
    resizeTo: { width: 844, height: 390 },
  },
];

// ---------------------------------------------------------------------------
// A static server for the docs build, and for the ceiling page.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The docs build's file for a URL path, the way a static host resolves Docusaurus's clean URLs. */
async function siteFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const base = join(SITE, safe);
  if (!base.startsWith(SITE)) return null;
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function serve(extra) {
  const server = createServer((request, response) => {
    void (async () => {
      const { pathname } = new URL(request.url ?? '/', 'http://localhost');
      const own = extra?.get(pathname);
      if (own !== undefined) {
        response.writeHead(200, { 'content-type': own.type, 'cache-control': 'no-store' });
        response.end(own.body);
        return;
      }
      const file = await siteFile(pathname);
      if (file === null) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(await readFile(file));
    })().catch((error) => {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end(String(error));
    });
  });
  // Port 0: the system picks a free one.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ---------------------------------------------------------------------------
// Page-side helpers, installed before the page's own scripts.

function installHelpers() {
  const demo = (name) => document.querySelector(`[data-demo="${name}"]`);
  const viewport = (name) => demo(name)?.querySelector('[data-dagr-explorer="viewport"]') ?? null;
  const plane = (name) => demo(name)?.querySelector('[data-dagr-explorer="plane"]') ?? null;
  const camera = (name) => {
    const element = plane(name);
    if (element === null) return null;
    const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(element.style.transform);
    return match === null ? null : { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
  };
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  };
  const within = (inner, outer) =>
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5;
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const wheels = [];
  window.addEventListener('wheel', (event) => {
    wheels.push({ ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented, deltaY: event.deltaY });
  });
  const counters = { details: 0, nodeClicks: 0, watching: null };
  document.addEventListener(
    'click',
    (event) => {
      if (counters.watching === null) return;
      const target = event.target instanceof window.Element ? event.target.closest('[data-dagr-explorer="node"]') : null;
      if (target !== null && demo(counters.watching)?.contains(target)) counters.nodeClicks += 1;
    },
    true,
  );
  let detailsObserver = null;

  window.__dagr = {
    camera,
    rect: (name) => {
      const element = viewport(name);
      return element === null ? null : rect(element);
    },
    ready() {
      for (const name of ['architecture', 'large']) {
        const element = plane(name);
        if (element === null || element.style.visibility !== 'visible') return false;
      }
      const mounted = document.querySelector('[data-demo="large"] [data-mounted]');
      return mounted !== null && Number(mounted.getAttribute('data-mounted')) >= 1;
    },
    frame,
    async frames(count) {
      for (let i = 0; i < count; i += 1) await frame();
    },
    /** Resolves once the plane's transform has held for ten frames and the plane is not composited. */
    async settle(name, timeout = 5000) {
      const start = window.performance.now();
      let last = null;
      let stable = 0;
      while (window.performance.now() - start < timeout) {
        await frame();
        const element = plane(name);
        const transform = element?.style.transform ?? '';
        const resting = element !== null && element.style.willChange === '';
        stable = transform === last && resting ? stable + 1 : 0;
        last = transform;
        if (stable >= 10) return true;
      }
      return false;
    },
    scrollTo(name) {
      viewport(name)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    blur() {
      const active = document.activeElement;
      if (active instanceof window.HTMLElement) active.blur();
    },
    focusInGraph(name) {
      const element = viewport(name);
      return element !== null && element.contains(document.activeElement);
    },
    activeNode(name) {
      const element = viewport(name);
      const active = document.activeElement;
      if (element === null || !(active instanceof window.HTMLElement) || !element.contains(active)) return null;
      return active.matches('[data-dagr-explorer="node"]') ? active.dataset.nodeId ?? null : 'viewport';
    },
    activeDescription() {
      const active = document.activeElement;
      if (!(active instanceof window.HTMLElement)) return 'none';
      const hook = active.getAttribute('data-dagr-explorer');
      return `${active.tagName.toLowerCase()}${hook === null ? '' : `[${hook}]`}${active.dataset.nodeId === undefined ? '' : `#${active.dataset.nodeId}`}`;
    },
    overflow() {
      const root = document.documentElement;
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    },
    scrollY: () => window.scrollY,
    pageScale: () => window.visualViewport?.scale ?? 1,
    drawerOpen: (name) => demo(name)?.querySelector('[data-dagr-explorer="details"]') !== null,
    drawerText: (name) => demo(name)?.querySelector('[data-dagr-explorer="details"]')?.textContent ?? '',
    selected(name) {
      const element = viewport(name);
      const found = element?.querySelector('[data-dagr-explorer="node"][data-selected="true"]');
      return found instanceof window.HTMLElement ? found.dataset.nodeId ?? null : null;
    },
    tabStops(name) {
      return viewport(name)?.querySelectorAll('[data-dagr-explorer="node"][tabindex="0"]').length ?? 0;
    },
    willChange(name) {
      const element = plane(name);
      return element === null ? null : { inline: element.style.willChange, computed: window.getComputedStyle(element).willChange };
    },
    /** How far the camera can pan from where it is, each way, if centered: half the overflow past 90% of the viewport. */
    panRoom(name) {
      const element = viewport(name);
      const surface = plane(name);
      if (element === null || surface === null) return { x: 0, y: 0 };
      const outer = rect(element);
      const inner = rect(surface);
      return { x: (inner.width - outer.width * 0.9) / 2, y: (inner.height - outer.height * 0.9) / 2 };
    },
    nodeInView(name, id) {
      const element = viewport(name);
      if (element === null) return false;
      for (const node of element.querySelectorAll('[data-dagr-explorer="node"]')) {
        if (node.dataset.nodeId === id) return within(rect(node), rect(element));
      }
      return false;
    },
    /**
     * Nodes wholly inside the viewport and the window, buttons and base marks
     * both, nearest the viewport's center first, with their centers in client
     * coordinates.
     */
    nodeTargets(name) {
      const element = viewport(name);
      if (element === null) return [];
      const outer = rect(element);
      const page = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const cx = (outer.left + outer.right) / 2;
      const cy = (outer.top + outer.bottom) / 2;
      const found = [];
      for (const node of element.querySelectorAll('[data-dagr-explorer="node"], svg rect[data-node-id]')) {
        const box = rect(node);
        if (box.width < 4 || !within(box, outer) || !within(box, page)) continue;
        const x = (box.left + box.right) / 2;
        const y = (box.top + box.bottom) / 2;
        found.push({ id: node.getAttribute('data-node-id'), button: node.tagName === 'BUTTON', x, y, distance: Math.hypot(x - cx, y - cy) });
      }
      return found.sort((a, b) => a.distance - b.distance);
    },
    /** A point in the viewport and the window where no node is, nearest the viewport's center. */
    emptyPoint(name) {
      const element = viewport(name);
      if (element === null) return null;
      const outer = rect(element);
      const cx = (outer.left + outer.right) / 2;
      const cy = (outer.top + outer.bottom) / 2;
      const points = [];
      for (let i = 1; i < 24; i += 1) {
        for (let j = 1; j < 16; j += 1) {
          const x = outer.left + (outer.width * i) / 24;
          const y = outer.top + (outer.height * j) / 16;
          if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) continue;
          points.push({ x, y, distance: Math.hypot(x - cx, y - cy) });
        }
      }
      points.sort((a, b) => a.distance - b.distance);
      for (const point of points) {
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit === null || !element.contains(hit)) continue;
        if (hit.closest('[data-node-id], button, [data-dagr-explorer="details"]') !== null) continue;
        // Clear of every node by 8 pixels, so a rounding of the layout cannot land on one.
        let clear = true;
        for (const node of element.querySelectorAll('[data-dagr-explorer="node"], svg rect[data-node-id]')) {
          const box = rect(node);
          if (point.x > box.left - 8 && point.x < box.right + 8 && point.y > box.top - 8 && point.y < box.bottom + 8) {
            clear = false;
            break;
          }
        }
        if (clear) return { x: point.x, y: point.y };
      }
      return null;
    },
    lastWheel: () => wheels[wheels.length - 1] ?? null,
    clearWheels() {
      wheels.length = 0;
    },
    watch(name) {
      counters.details = 0;
      counters.nodeClicks = 0;
      counters.watching = name;
      detailsObserver?.disconnect();
      detailsObserver = new window.MutationObserver((records) => {
        for (const record of records) {
          for (const added of record.addedNodes) {
            if (added instanceof window.Element && added.matches('[data-dagr-explorer="details"]')) counters.details += 1;
          }
        }
      });
      const element = demo(name);
      if (element !== null) detailsObserver.observe(element, { childList: true, subtree: true });
    },
    watched: () => ({ details: counters.details, nodeClicks: counters.nodeClicks }),
    /** Two synthesized touch pointers that start `from` apart and end `to` apart, about `point`. */
    async syntheticPinch(name, point, from, to, steps = 12) {
      const element = viewport(name);
      if (element === null) return;
      const send = (type, id, x, y, primary) => {
        const target = document.elementFromPoint(x, y) ?? element;
        target.dispatchEvent(
          new window.PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: primary,
            clientX: x,
            clientY: y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      };
      send('pointerdown', 11, point.x - from / 2, point.y, true);
      send('pointerdown', 12, point.x + from / 2, point.y, false);
      for (let i = 1; i <= steps; i += 1) {
        const half = (from + ((to - from) * i) / steps) / 2;
        send('pointermove', 11, point.x - half, point.y, true);
        send('pointermove', 12, point.x + half, point.y, false);
        await frame();
      }
      send('pointerup', 12, point.x + to / 2, point.y, false);
      send('pointerup', 11, point.x - to / 2, point.y, true);
    },
    /**
     * Dispatches `key` on the focused viewport and reads the camera at once,
     * after one frame and after `wait` milliseconds.
     */
    async keyTiming(name, key, wait) {
      const element = viewport(name);
      if (element === null) return null;
      const before = camera(name);
      element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const now = camera(name);
      await frame();
      const oneFrame = camera(name);
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      return { before, now, oneFrame, later: camera(name) };
    },
    /**
     * Counts node elements in the large demo on every DOM change and checks
     * each count against the cap plus the pins it had at that moment.
     */
    /**
     * Counts node elements in the large demo on every DOM change, against
     * the cap plus the four pins the explorer can hold: the selected node,
     * the node in the tab order, the focused node and an arrow's target on
     * its way to focus. The last is not visible in the DOM, so the bound is
     * the documented most rather than the pins of the moment. Samples over
     * the cap plus the pins the DOM does show are kept, with the step, so
     * the report says what the extra elements were.
     */
    startCapWatch(name) {
      const element = demo(name);
      const cap = Number(document.querySelector(`[data-demo="${name}"] [data-cap]`)?.getAttribute('data-cap'));
      const state = { cap, bound: cap + 4, samples: 0, max: 0, step: 'start', violations: [], overVisiblePins: [] };
      const sample = () => {
        const nodes = element.querySelectorAll('[data-dagr-explorer="node"]');
        const pins = new Set();
        for (const node of nodes) {
          if (node.getAttribute('tabindex') === '0' || node.getAttribute('data-selected') === 'true' || node === document.activeElement) {
            pins.add(node.dataset.nodeId);
          }
        }
        state.samples += 1;
        state.max = Math.max(state.max, nodes.length);
        if (nodes.length > cap + pins.size && state.overVisiblePins.length < 10) {
          const active = document.activeElement;
          state.overVisiblePins.push({
            count: nodes.length,
            visiblePins: [...pins],
            active: active instanceof window.HTMLElement ? (active.dataset.nodeId ?? active.tagName) : 'none',
            step: state.step,
          });
        }
        if (nodes.length > state.bound && state.violations.length < 20) state.violations.push({ count: nodes.length, step: state.step });
      };
      const observer = new window.MutationObserver(sample);
      observer.observe(element, { childList: true, subtree: true });
      sample();
      window.__capWatch = { state, stop: () => observer.disconnect() };
    },
    capStep(label) {
      if (window.__capWatch !== undefined) window.__capWatch.state.step = label;
    },
    stopCapWatch() {
      window.__capWatch?.stop();
      const element = document.querySelector('[data-demo="large"]');
      const readout = Number(element?.querySelector('[data-mounted]')?.getAttribute('data-mounted'));
      const counted = element?.querySelectorAll('[data-dagr-explorer="node"]').length ?? 0;
      return { ...window.__capWatch?.state, readoutAtRest: readout, countedAtRest: counted };
    },
    setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
    },
  };
}

// ---------------------------------------------------------------------------
// The checks.

class NotApplicable extends Error {}

const close = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
const sameCamera = (a, b) => a !== null && b !== null && close(a.x, b.x) && close(a.y, b.y) && Math.abs(a.scale - b.scale) <= 1e-6 * a.scale;
const round = (value) => Math.round(value * 100) / 100;
const cameraText = (c) => (c === null ? 'none' : `(${String(round(c.x))}, ${String(round(c.y))}) x${String(round(c.scale * 1000) / 1000)}`);

/** Throws if `condition` is false, with the detail that says why. */
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function wheelOrNotApplicable(page, dx, dy) {
  try {
    await page.mouse.wheel(dx, dy);
  } catch (error) {
    if (/not supported/i.test(String(error))) throw new NotApplicable(`mouse.wheel: ${String(error).split('\n')[0]}`);
    throw error;
  }
}

async function clickToolbar(page, name, action, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.locator(`[data-demo="${name}"] [data-action="${action}"]`).click();
  }
  await page.evaluate((demo) => window.__dagr.settle(demo), name);
}

async function focusGraph(page, name) {
  await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
  await page.evaluate(() => window.__dagr.frames(3));
  const point = await page.evaluate((demo) => window.__dagr.emptyPoint(demo), name);
  expect(point !== null, `no empty point found in the ${name} graph to click`);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => window.__dagr.frames(2));
  expect(await page.evaluate((demo) => window.__dagr.focusInGraph(demo), name), `a click on an empty point did not focus the ${name} graph`);
  return point;
}

const camOf = (page, name) => page.evaluate((demo) => window.__dagr.camera(demo), name);
const settle = (page, name) => page.evaluate((demo) => window.__dagr.settle(demo), name);

const CHECKS = [
  {
    name: 'mount, no overflow',
    async run(page) {
      const architecture = await page.locator('[data-demo="architecture"] [data-dagr-explorer="node"]').count();
      const mounted = await page.locator('[data-demo="large"] [data-mounted]').getAttribute('data-mounted');
      expect(architecture >= 1, 'the architecture demo mounted no node element');
      expect(Number(mounted) >= 1, 'the large demo mounted no node element');
      const widths = [];
      for (const where of ['top', 'architecture', 'large']) {
        if (where !== 'top') {
          await page.evaluate((demo) => window.__dagr.scrollTo(demo), where);
          await page.evaluate(() => window.__dagr.frames(3));
        }
        const { scrollWidth, clientWidth } = await page.evaluate(() => window.__dagr.overflow());
        widths.push(`${where} ${String(scrollWidth)}/${String(clientWidth)}`);
        expect(scrollWidth <= clientWidth, `horizontal overflow at ${where}: scrollWidth ${String(scrollWidth)} > clientWidth ${String(clientWidth)}`);
      }
      return `architecture ${String(architecture)} node elements, large readout ${String(mounted)}; scrollWidth/clientWidth ${widths.join(', ')}`;
    },
  },
  {
    name: 'wheel is focus-gated',
    async run(page) {
      const name = 'architecture';
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await page.evaluate(() => window.__dagr.blur());
      const box = await page.evaluate((demo) => window.__dagr.rect(demo), name);
      const y0 = await page.evaluate(() => window.__dagr.scrollY());
      const c0 = await camOf(page, name);
      await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
      await wheelOrNotApplicable(page, 0, 200);
      await sleep(500);
      const y1 = await page.evaluate(() => window.__dagr.scrollY());
      const c1 = await camOf(page, name);
      expect(y1 > y0, `an unfocused wheel did not scroll the page (scrollY ${String(y0)} to ${String(y1)})`);
      expect(sameCamera(c0, c1), `an unfocused wheel moved the camera: ${cameraText(c0)} to ${cameraText(c1)}`);

      const point = await focusGraph(page, name);
      const y2 = await page.evaluate(() => window.__dagr.scrollY());
      const c2 = await camOf(page, name);
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, -200);
      await settle(page, name);
      const y3 = await page.evaluate(() => window.__dagr.scrollY());
      const c3 = await camOf(page, name);
      expect(y3 === y2, `a focused wheel scrolled the page (scrollY ${String(y2)} to ${String(y3)})`);
      expect(c3 !== null && c2 !== null && c3.scale > c2.scale, `a focused wheel did not zoom in: ${cameraText(c2)} to ${cameraText(c3)}`);
      expect(!(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name)), 'the focusing click opened the drawer');
      return `unfocused: scrollY ${String(y0)} to ${String(y1)}, camera unchanged; focused: scrollY unchanged, scale ${String(round(c2.scale * 1000) / 1000)} to ${String(round(c3.scale * 1000) / 1000)}`;
    },
  },
  {
    name: 'drag pans 1:1, no click',
    async run(page) {
      const name = 'architecture';
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      const dx = -60;
      const dy = -40;
      // In until the graph overflows the viewport by more than the drag on
      // both axes, so the limits leave it room and a 1:1 drag is visible
      // whole. The camera keeps 5% of the viewport clear on each side.
      let clicks = 0;
      for (; clicks < 14; clicks += 1) {
        const room = await page.evaluate((demo) => window.__dagr.panRoom(demo), name);
        if (room.x > Math.abs(dx) + 8 && room.y > Math.abs(dy) + 8) break;
        await clickToolbar(page, name, 'zoom-in');
      }
      const targets = await page.evaluate((demo) => window.__dagr.nodeTargets(demo), name);
      const start = targets.find((t) => t.button);
      expect(start !== undefined, 'no node element in view to start the drag on');
      const c0 = await camOf(page, name);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
      const mid = await camOf(page, name);
      await page.mouse.up();
      await sleep(400);
      const c1 = await camOf(page, name);
      expect(close(mid.x - c0.x, dx) && close(mid.y - c0.y, dy), `the drag moved the camera (${String(round(mid.x - c0.x))}, ${String(round(mid.y - c0.y))}) for a pointer move of (${String(dx)}, ${String(dy)})`);
      expect(sameCamera(mid, c1), `the camera moved after the release: ${cameraText(mid)} to ${cameraText(c1)}`);
      expect(!(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name)), 'the click that ended the drag opened the drawer');
      expect((await page.evaluate((demo) => window.__dagr.selected(demo), name)) === null, 'the click that ended the drag selected a node');
      return `zoomed in ${String(clicks)} times; dragged from node ${String(start.id)} by (${String(dx)}, ${String(dy)}), camera moved (${String(round(c1.x - c0.x))}, ${String(round(c1.y - c0.y))}); no drawer, no selection`;
    },
  },
  {
    name: 'ctrl wheel (pinch) is focus-gated',
    async run(page) {
      const name = 'architecture';
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await page.evaluate(() => window.__dagr.frames(3));
      await page.evaluate(() => window.__dagr.blur());
      const box = await page.evaluate((demo) => window.__dagr.rect(demo), name);
      const c0 = await camOf(page, name);
      await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
      await page.evaluate(() => window.__dagr.clearWheels());
      await page.keyboard.down('Control');
      try {
        await wheelOrNotApplicable(page, 0, -100);
      } finally {
        await page.keyboard.up('Control');
      }
      await sleep(400);
      const unfocused = await page.evaluate(() => window.__dagr.lastWheel());
      const c1 = await camOf(page, name);
      expect(unfocused !== null && unfocused.ctrlKey, `the wheel did not arrive with ctrlKey: ${JSON.stringify(unfocused)}`);
      expect(!unfocused.defaultPrevented, 'an unfocused Ctrl wheel was prevented, so the page never got it');
      expect(sameCamera(c0, c1), `an unfocused Ctrl wheel moved the camera: ${cameraText(c0)} to ${cameraText(c1)}`);

      const point = await focusGraph(page, name);
      const y2 = await page.evaluate(() => window.__dagr.scrollY());
      const c2 = await camOf(page, name);
      await page.mouse.move(point.x, point.y);
      await page.evaluate(() => window.__dagr.clearWheels());
      await page.keyboard.down('Control');
      try {
        await page.mouse.wheel(0, -100);
      } finally {
        await page.keyboard.up('Control');
      }
      await settle(page, name);
      const focused = await page.evaluate(() => window.__dagr.lastWheel());
      const c3 = await camOf(page, name);
      const y3 = await page.evaluate(() => window.__dagr.scrollY());
      expect(focused !== null && focused.ctrlKey && focused.defaultPrevented, `a focused Ctrl wheel was not taken: ${JSON.stringify(focused)}`);
      expect(c3.scale > c2.scale, `a focused Ctrl wheel did not zoom in: ${cameraText(c2)} to ${cameraText(c3)}`);
      expect(y3 === y2, 'a focused Ctrl wheel scrolled the page');
      return `unfocused: not prevented, camera unchanged; focused: prevented, scale ${String(round(c2.scale * 1000) / 1000)} to ${String(round(c3.scale * 1000) / 1000)}`;
    },
  },
  {
    name: 'touch: first tap focuses, pinch zooms',
    touchOnly: true,
    async run(page, { browserName }) {
      const name = 'architecture';
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await page.evaluate(() => window.__dagr.frames(3));
      await page.evaluate(() => window.__dagr.blur());
      const targets = await page.evaluate((demo) => window.__dagr.nodeTargets(demo), name);
      const target = targets[0];
      expect(target !== undefined, 'no node in view to tap');
      await page.touchscreen.tap(target.x, target.y);
      await sleep(400);
      expect(await page.evaluate((demo) => window.__dagr.focusInGraph(demo), name), 'the first tap did not focus the graph');
      expect(!(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name)), 'the first tap opened the drawer');
      expect((await page.evaluate((demo) => window.__dagr.selected(demo), name)) === null, 'the first tap selected a node');

      const box = await page.evaluate((demo) => window.__dagr.rect(demo), name);
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const c0 = await camOf(page, name);
      await page.evaluate(([demo, point]) => window.__dagr.syntheticPinch(demo, point, 60, 180), [name, center]);
      await settle(page, name);
      const c1 = await camOf(page, name);
      expect(c1.scale > c0.scale * 1.5, `a synthesized two-finger pinch did not zoom in: ${cameraText(c0)} to ${cameraText(c1)}`);
      const notes = [`synthesized pointer pinch 60 to 180 px: scale x${String(round((c1.scale / c0.scale) * 100) / 100)}`];

      if (browserName === 'chromium') {
        // Real touch input through the protocol, in the browser that has it.
        const client = await page.context().newCDPSession(page);
        const at = (half) => [
          { x: center.x - half, y: center.y, id: 1 },
          { x: center.x + half, y: center.y, id: 2 },
        ];
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(90) });
        for (let i = 1; i <= 12; i += 1) {
          await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(90 - (60 * i) / 12) });
          await sleep(16);
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page, name);
        const c2 = await camOf(page, name);
        const pageScale = await page.evaluate(() => window.__dagr.pageScale());
        expect(c2.scale < c1.scale / 1.5, `a protocol touch pinch did not zoom out: ${cameraText(c1)} to ${cameraText(c2)}`);
        expect(pageScale === 1, `the protocol pinch zoomed the page too (visual viewport scale ${String(pageScale)})`);
        notes.push(`protocol touch pinch 180 to 60 px: scale x${String(round((c2.scale / c1.scale) * 100) / 100)}, page scale ${String(pageScale)}`);
      }

      // The control: the same tap, with the graph focused, does open the node.
      const again = (await page.evaluate((demo) => window.__dagr.nodeTargets(demo), name))[0];
      await page.touchscreen.tap(again.x, again.y);
      await sleep(400);
      expect(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name), 'the control failed: a tap on a node in a focused graph did not open it');
      return `first tap on ${String(target.id)} focused only; ${notes.join('; ')}; a second tap opened ${String(again.id)}`;
    },
  },
  {
    name: 'keyboard: one tab stop, arrows, Enter, Space, Escape',
    async run(page) {
      const name = 'architecture';
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await clickToolbar(page, name, 'zoom-in', 3);
      await page.locator(`[data-demo="${name}"] input[type="search"]`).focus();
      const path = [];
      let reached = null;
      for (let i = 0; i < 15 && reached === null; i += 1) {
        await page.keyboard.press('Tab');
        path.push(await page.evaluate(() => window.__dagr.activeDescription()));
        const node = await page.evaluate((demo) => window.__dagr.activeNode(demo), name);
        if (node !== null && node !== 'viewport') reached = node;
      }
      expect(reached !== null, `Tab from the search field never reached a node: ${path.join(' > ')}`);
      expect((await page.evaluate((demo) => window.__dagr.tabStops(demo), name)) === 1, 'the graph has more or less than one node with tabIndex 0');
      await page.keyboard.press('Tab');
      const after = await page.evaluate((demo) => window.__dagr.activeNode(demo), name);
      expect(after === null, `a second Tab stayed in the graph, on ${String(after)}`);
      await page.keyboard.press('Shift+Tab');
      const back = await page.evaluate((demo) => window.__dagr.activeNode(demo), name);
      expect(back === reached, `Shift+Tab came back to ${String(back)}, not ${reached}`);

      const moves = [];
      let current = reached;
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
        await page.keyboard.press(key);
        await settle(page, name);
        const next = await page.evaluate((demo) => window.__dagr.activeNode(demo), name);
        expect(next !== null && next !== 'viewport', `${key} left node focus (${String(next)})`);
        const shown = await page.evaluate(([demo, id]) => window.__dagr.nodeInView(demo, id), [name, next]);
        expect(shown, `${key} moved focus to ${next}, which the camera did not reveal`);
        moves.push(`${key.replace('Arrow', '')} ${next === current ? '(stayed)' : next}`);
        current = next;
      }
      expect(moves.filter((m) => !m.includes('(stayed)')).length >= 4, `the arrows moved focus too rarely: ${moves.join(', ')}`);

      const opener = current;
      const keys = [];
      for (const key of ['Enter', ' ']) {
        await page.evaluate((demo) => window.__dagr.watch(demo), name);
        await page.keyboard.press(key === ' ' ? 'Space' : key);
        await sleep(300);
        const seen = await page.evaluate(() => window.__dagr.watched());
        const label = key === ' ' ? 'Space' : key;
        expect(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name), `${label} did not open the drawer`);
        expect(seen.details === 1, `${label} mounted the drawer ${String(seen.details)} times`);
        expect(seen.nodeClicks === 0, `${label} also fired ${String(seen.nodeClicks)} click(s) on the node, a second activation`);
        expect((await page.evaluate((demo) => window.__dagr.selected(demo), name)) === opener, `${label} inspected another node than the focused one`);
        await page.keyboard.press('Escape');
        await sleep(300);
        expect(!(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name)), `Escape did not close the drawer after ${label}`);
        const focus = await page.evaluate(() => window.__dagr.activeDescription());
        const focusedNode = await page.evaluate((demo) => window.__dagr.activeNode(demo), name);
        expect(focusedNode === opener, `after Escape, focus is on ${focus}, not the opener ${opener}`);
        keys.push(`${label} opened once, Escape closed, focus on ${opener}`);
      }
      return `Tab path: ${path.join(' > ')}; arrows: ${moves.join(', ')}; ${keys.join('; ')}`;
    },
  },
  {
    name: 'search: Enter inspects, more-matches line',
    async run(page) {
      const name = 'architecture';
      const input = page.locator(`[data-demo="${name}"] input[type="search"]`);
      await input.scrollIntoViewIfNeeded();
      await input.fill('store');
      const first = page.locator(`[data-demo="${name}"] [data-dagr-explorer="search-results"] button`).first();
      const firstId = await first.getAttribute('data-node-id');
      const firstLabel = (await first.textContent()) ?? '';
      await input.press('Enter');
      await settle(page, name);
      expect(await page.evaluate((demo) => window.__dagr.drawerOpen(demo), name), 'Enter in search did not open the drawer');
      const selected = await page.evaluate((demo) => window.__dagr.selected(demo), name);
      expect(selected === firstId, `Enter selected ${String(selected)}, not the first match ${String(firstId)}`);
      expect((await page.evaluate((demo) => window.__dagr.drawerText(demo), name)).includes(firstLabel), 'the drawer does not show the first match');
      const flown = await page.evaluate(([demo, id]) => window.__dagr.nodeInView(demo, id), [name, firstId]);
      expect(flown, `the camera did not bring ${String(firstId)} into view`);

      const large = page.locator('[data-demo="large"] input[type="search"]');
      await large.scrollIntoViewIfNeeded();
      await large.fill('1');
      const more = page.locator('[data-demo="large"] [data-dagr-explorer="search-more"]');
      await more.waitFor({ timeout: 5000 });
      const moreText = (await more.textContent()) ?? '';
      const listed = await page.locator('[data-demo="large"] [data-dagr-explorer="search-results"] button').count();
      const count = (await page.locator('[data-demo="large"] [data-dagr-explorer="search-count"]').textContent()) ?? '';
      expect(listed === 50, `the large demo listed ${String(listed)} results for '1', not 50`);
      return `'store': Enter inspected ${String(firstId)} (${firstLabel}) and flew to it; large '1': ${count.trim()}, ${String(listed)} listed, '${moreText.trim()}'`;
    },
  },
  {
    name: 'mounted nodes stay within the cap plus pins',
    async run(page, { hasWheel }) {
      const name = 'large';
      await focusGraph(page, name);
      await page.evaluate((demo) => window.__dagr.startCapWatch(demo), name);
      const box = await page.evaluate((demo) => window.__dagr.rect(demo), name);
      const at = (fx, fy) => ({ x: box.left + box.width * fx, y: box.top + box.height * fy });
      const drag = async (from, dx, dy) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
        await page.mouse.up();
        await settle(page, name);
      };
      const steps = [];
      const step = async (label, action) => {
        await page.evaluate((value) => window.__dagr.capStep(value), label);
        await action();
        await settle(page, name);
        steps.push(label);
      };
      // In until node elements arrive, which takes more presses on a narrow
      // screen, where the fitted graph is smaller.
      const readout = () => page.locator('[data-demo="large"] [data-mounted]').getAttribute('data-mounted');
      let presses = 0;
      await step('= until elements', async () => {
        while (presses < 30 && Number(await readout()) <= 50) {
          await page.keyboard.press('=');
          presses += 1;
          await settle(page, name);
        }
      });
      steps[steps.length - 1] = `= x${String(presses)}`;
      await step('drag x2', async () => {
        await drag(at(0.7, 0.5), -Math.min(300, box.width * 0.5), 0);
        await drag(at(0.5, 0.7), 0, -Math.min(200, box.height * 0.3));
      });
      if (hasWheel) {
        await step('wheel in x4', async () => {
          await page.mouse.move(at(0.3, 0.4).x, at(0.3, 0.4).y);
          for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, -150);
        });
      } else {
        await step('= x3', async () => {
          for (let i = 0; i < 3; i += 1) await page.keyboard.press('=');
        });
      }
      await step('drag', () => drag(at(0.2, 0.5), Math.min(400, box.width * 0.6), Math.min(120, box.height * 0.2)));
      // On the node the drag began on, if the browser focused it on press,
      // these move focus from node to node; on the surface they pan.
      await step('arrows x5', async () => {
        for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowUp']) await page.keyboard.press(key);
      });
      await step('-', () => page.keyboard.press('-'));
      await step('drag', () => drag(at(0.6, 0.3), -Math.min(250, box.width * 0.4), Math.min(150, box.height * 0.25)));
      await step('= x4', async () => {
        for (let i = 0; i < 4; i += 1) await page.keyboard.press('=');
      });
      await step('drag', () => drag(at(0.5, 0.5), Math.min(200, box.width * 0.3), -Math.min(200, box.height * 0.3)));
      await step('0 (fit)', () => page.keyboard.press('0'));
      await page.evaluate(() => window.__dagr.frames(4));
      const result = await page.evaluate(() => window.__dagr.stopCapWatch());
      expect(result.violations.length === 0, `the node count passed the cap plus the four pins: ${JSON.stringify(result.violations)}`);
      expect(result.max > 50, `the sequence never mounted more than ${String(result.max)} node elements, so it tested nothing`);
      expect(result.readoutAtRest === result.countedAtRest, `the readout says ${String(result.readoutAtRest)}, the page has ${String(result.countedAtRest)}`);
      const over = result.overVisiblePins.length === 0
        ? 'never over the cap plus the pins visible in the DOM'
        : `over the cap plus the visible pins ${String(result.overVisiblePins.length)} time(s): ${JSON.stringify(result.overVisiblePins.slice(0, 3))}`;
      return `${steps.join(', ')}: ${String(result.samples)} DOM samples, max ${String(result.max)} node elements against ${String(result.bound)} (cap ${String(result.cap)} plus four pins), ${over}; readout ${String(result.readoutAtRest)} at rest`;
    },
  },
  {
    name: 'reduced motion: a zoom applies in one frame',
    async run(page, { reducedPage }) {
      const name = 'architecture';
      const measure = async (target) => {
        await focusGraph(target, name);
        await settle(target, name);
        return target.evaluate((demo) => window.__dagr.keyTiming(demo, '=', 600), name);
      };
      const reduced = await measure(reducedPage);
      expect(reduced.now.scale > reduced.before.scale, `under reduced motion the zoom did not apply at once: ${cameraText(reduced.before)} to ${cameraText(reduced.now)}`);
      expect(sameCamera(reduced.now, reduced.later), `under reduced motion the camera kept moving: ${cameraText(reduced.now)} to ${cameraText(reduced.later)}`);
      // The control: without the preference, the same zoom eases over frames.
      const normal = await measure(page);
      expect(!sameCamera(normal.oneFrame, normal.later), `the control failed: without reduced motion the zoom also landed in one frame`);
      return `reduced: x${String(round((reduced.now.scale / reduced.before.scale) * 1000) / 1000)} in the key's own event, unchanged after 600 ms; control: after one frame x${String(round((normal.oneFrame.scale / normal.before.scale) * 1000) / 1000)}, settles at x${String(round((normal.later.scale / normal.before.scale) * 1000) / 1000)}`;
    },
  },
  {
    name: 'resize keeps the place unless at fit',
    async run(page, { profile }) {
      const name = 'architecture';
      const original = profile.options.viewport;
      const centerOf = async () => {
        const c = await camOf(page, name);
        const box = await page.evaluate((demo) => window.__dagr.rect(demo), name);
        return { camera: c, world: { x: (box.width / 2 - c.x) / c.scale, y: (box.height / 2 - c.y) / c.scale }, width: box.width };
      };
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      // Far enough in to stay above the fit of the new size too, which the
      // limits would otherwise raise the zoom to.
      await clickToolbar(page, name, 'zoom-in', 5);
      const a0 = await centerOf();
      await page.setViewportSize(profile.resizeTo);
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await settle(page, name);
      const a1 = await centerOf();
      const drift = Math.hypot(a1.world.x - a0.world.x, a1.world.y - a0.world.y) * a1.camera.scale;
      expect(a1.width !== a0.width, 'the resize did not change the graph width, so it tested nothing');
      expect(Math.abs(a1.camera.scale - a0.camera.scale) <= 1e-6 * a0.camera.scale, `a resize changed the zoom: ${cameraText(a0.camera)} to ${cameraText(a1.camera)}`);
      expect(drift <= 1, `a resize moved the world point at the center by ${String(round(drift))} screen px`);

      await page.setViewportSize(original);
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await settle(page, name);
      await clickToolbar(page, name, 'fit');
      const f0 = await camOf(page, name);
      await page.setViewportSize(profile.resizeTo);
      await page.evaluate((demo) => window.__dagr.scrollTo(demo), name);
      await settle(page, name);
      const f1 = await camOf(page, name);
      await clickToolbar(page, name, 'fit');
      const f2 = await camOf(page, name);
      await page.setViewportSize(original);
      expect(sameCamera(f1, f2), `after a resize at fit the camera is not the new fit: ${cameraText(f1)}, fit is ${cameraText(f2)}`);
      expect(!sameCamera(f0, f1), 'the fit did not change with the size, so the at-fit case tested nothing');
      return `zoomed: graph ${String(round(a0.width))} to ${String(round(a1.width))} px wide, zoom kept, center drift ${String(round(drift))} px; at fit: refitted to ${cameraText(f1)}`;
    },
  },
  {
    name: 'crisp at rest (no will-change)',
    async run(page, { hasWheel }) {
      const seen = [];
      for (const name of ['architecture', 'large']) {
        const point = await focusGraph(page, name);
        if (hasWheel) {
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(0, -240);
        } else {
          await page.keyboard.press('=');
        }
        const moving = await page.evaluate(async (demo) => {
          await window.__dagr.frame();
          return window.__dagr.willChange(demo);
        }, name);
        expect(moving.inline === 'transform', `the ${name} plane was not composited while the camera moved (${JSON.stringify(moving)}), so this check could not fail`);
        await settle(page, name);
        await sleep(200);
        const resting = await page.evaluate((demo) => window.__dagr.willChange(demo), name);
        expect(resting.inline === '' && resting.computed === 'auto', `the ${name} plane kept will-change at rest: ${JSON.stringify(resting)}`);
        seen.push(`${name}: '${moving.inline}' moving, '${resting.computed}' at rest`);
      }
      return seen.join('; ');
    },
  },
];

// ---------------------------------------------------------------------------
// Running them.

async function openExplorer(context, origin, errors, label) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${String(error)}`));
  await page.goto(`${origin}/docs/explorer`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dagr.ready(), null, { timeout: 30_000 });
  return page;
}

async function screenshots(context, origin, errors, browserName, profile, out) {
  const names = [];
  const page = await openExplorer(context, origin, errors, 'screenshots');
  const queries = { architecture: 'store', large: 'Ledger 307' };
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => window.__dagr.setTheme(value), theme);
    for (const name of ['architecture', 'large']) {
      const demo = page.locator(`[data-demo="${name}"]`);
      const shot = async (state) => {
        await page.evaluate((d) => window.__dagr.scrollTo(d), name);
        await settle(page, name);
        await sleep(150);
        const file = `${browserName}-${profile.name}-${name}-${theme}-${state}.png`;
        await demo.screenshot({ path: join(out, file) });
        names.push(file);
      };
      await clickToolbar(page, name, 'fit');
      await shot('rest');
      // Far enough that node elements show: further on a phone, where the
      // fitted graph is smaller.
      await clickToolbar(page, name, 'zoom-in', name === 'large' ? (profile.name === '390' ? 11 : 6) : 3);
      await shot('zoomed');
      const input = page.locator(`[data-demo="${name}"] input[type="search"]`);
      await input.fill(queries[name]);
      await input.press('Enter');
      await shot('drawer');
      await input.press('Escape');
      await input.press('Escape');
      await page.evaluate(() => window.__dagr.blur());
    }
  }
  await page.close();
  return names;
}

async function runChecks() {
  const { chromium, webkit } = requireDep('playwright-core');
  const engines = { chromium, webkit };
  const wanted = flag('browsers', 'chromium,webkit').split(',');
  await mkdir(OUT, { recursive: true });
  const server = await serve(null);
  const report = {
    date: new Date().toISOString(),
    machine: machine(),
    origin: server.origin,
    browsers: {},
    results: [],
    screenshots: [],
    launchFailures: [],
  };
  try {
    for (const browserName of wanted) {
      let browser;
      try {
        const executablePath = browserName === 'chromium' ? process.env.DAGR_CHROMIUM : undefined;
        browser = await engines[browserName].launch(executablePath === undefined ? {} : { executablePath });
      } catch (error) {
        report.launchFailures.push({ browser: browserName, error: String(error) });
        console.log(`LAUNCH FAILED ${browserName}: ${String(error).split('\n')[0]}`);
        continue;
      }
      report.browsers[browserName] = browser.version();
      for (const profile of PROFILES) {
        const errors = [];
        const context = await browser.newContext(profile.options);
        const reducedContext = await browser.newContext({ ...profile.options, reducedMotion: 'reduce' });
        await context.addInitScript(installHelpers);
        await reducedContext.addInitScript(installHelpers);
        const hasTouch = profile.options.hasTouch === true;
        for (const check of CHECKS.filter((c) => c.name.includes(flag('only', '')))) {
          const entry = { browser: browserName, viewport: profile.name, check: check.name, status: 'pass', detail: '' };
          const started = Date.now();
          let page = null;
          let reducedPage = null;
          try {
            if (check.touchOnly === true && !hasTouch) throw new NotApplicable('no touch on this profile; the 390 profile runs it');
            page = await openExplorer(context, server.origin, errors, check.name);
            if (check.name.startsWith('reduced')) reducedPage = await openExplorer(reducedContext, server.origin, errors, `${check.name} (reduced)`);
            // A phone in WebKit has no wheel to send: Playwright refuses it there.
            const hasWheel = !(browserName === 'webkit' && hasTouch);
            entry.detail = await check.run(page, { browserName, profile, reducedPage, hasWheel });
          } catch (error) {
            entry.status = error instanceof NotApplicable ? 'n/a' : 'fail';
            entry.detail = String(error instanceof Error ? error.message : error).split('\n')[0];
          } finally {
            await page?.close();
            await reducedPage?.close();
          }
          entry.ms = Date.now() - started;
          report.results.push(entry);
          console.log(`${entry.status.toUpperCase().padEnd(4)} ${browserName} ${profile.name} ${check.name}: ${entry.detail}`);
        }
        try {
          report.screenshots.push(...(await screenshots(context, server.origin, errors, browserName, profile, OUT)));
        } catch (error) {
          report.results.push({ browser: browserName, viewport: profile.name, check: 'screenshots', status: 'fail', detail: String(error).split('\n')[0] });
          console.log(`FAIL ${browserName} ${profile.name} screenshots: ${String(error).split('\n')[0]}`);
        }
        const entry = {
          browser: browserName,
          viewport: profile.name,
          check: 'no console or page errors',
          status: errors.length === 0 ? 'pass' : 'fail',
          detail: errors.length === 0 ? 'none during every check and the screenshots' : errors.slice(0, 10).join(' | '),
        };
        report.results.push(entry);
        console.log(`${entry.status.toUpperCase().padEnd(4)} ${browserName} ${profile.name} ${entry.check}: ${entry.detail}`);
        await context.close();
        await reducedContext.close();
      }
      await browser.close();
    }
  } finally {
    await server.close();
  }
  await writeFile(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const failed = report.results.filter((r) => r.status === 'fail').length + report.launchFailures.length;
  console.log(`\n${String(report.results.length)} results, ${String(failed)} failed. Report and screenshots: ${OUT}`);
  return failed === 0;
}

// ---------------------------------------------------------------------------
// The ceiling.

function machine() {
  const cpu = cpus();
  return {
    cpu: cpu[0]?.model ?? 'unknown',
    cores: cpu.length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}`,
    node: process.version,
  };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

async function bundleCeilingPage() {
  const esbuild = requireDep('esbuild');
  const explorer = join(ROOT, 'packages', 'explorer');
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'bench', 'browser', 'explorer-ceiling-page.mjs')],
    bundle: true,
    write: false,
    format: 'esm',
    minify: true,
    // The built package, as a consumer gets it, and its own React 19.
    alias: { '@prnt/dagr-explorer': join(explorer, 'dist', 'index.js') },
    nodePaths: [join(explorer, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ceiling</title>
<link rel="stylesheet" href="/__ceiling/styles.css">
<style>body{margin:0;font-family:system-ui,sans-serif} #stage{--dagr-explorer-height:600px;padding:0 16px}</style>
</head><body><div id="stage"></div><script type="module" src="/__ceiling/bundle.js"></script></body></html>`;
  return new Map([
    ['/__ceiling/', { type: MIME['.html'], body: html }],
    ['/__ceiling/bundle.js', { type: MIME['.js'], body: result.outputFiles[0].contents }],
    ['/__ceiling/styles.css', { type: MIME['.css'], body: await readFile(join(explorer, 'styles.css')) }],
  ]);
}

/**
 * One drag across the graph while the page records every frame interval.
 *
 * The press is real (Playwright's mouse), so the browser has an active
 * pointer the camera can capture. The moves are not: each frame's
 * `requestAnimationFrame` callback dispatches one `pointermove` for that
 * pointer, the way a browser delivers a frame-aligned drag. Driving the moves
 * from the runner instead made every one a protocol round trip that waits on
 * the page, and the intervals measured that: 67 ms at 500 nodes and at
 * 8,000 alike.
 */
async function dragAndRecord(page, box, durationMs) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const frames = await page.evaluate(
    ({ cx, cy, width, height, durationMs }) =>
      new Promise((resolve) => {
        const viewport = document.querySelector('[data-dagr-explorer="viewport"]');
        const plane = document.querySelector('[data-dagr-explorer="plane"]');
        const times = [];
        const transforms = [];
        let start = null;
        const step = (time) => {
          if (start === null) start = time;
          times.push(time);
          transforms.push(plane.style.transform);
          // A slow figure of eight, 1.6 seconds a lap, within the pan range
          // one and a half times the fit zoom leaves.
          const t = (time - start) / 1600;
          const x = cx + Math.sin(t * 2 * Math.PI) * width * 0.18;
          const y = cy + Math.sin(t * 4 * Math.PI) * height * 0.12;
          viewport.dispatchEvent(
            new window.PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              clientX: x,
              clientY: y,
              buttons: 1,
            }),
          );
          if (time - start < durationMs) requestAnimationFrame(step);
          else resolve({ times, transforms });
        };
        requestAnimationFrame(step);
      }),
    { cx, cy, width: box.width, height: box.height, durationMs },
  );
  await page.mouse.up();
  const intervals = [];
  let moved = 0;
  for (let k = 1; k < frames.times.length; k += 1) {
    intervals.push(frames.times[k] - frames.times[k - 1]);
    if (frames.transforms[k] !== frames.transforms[k - 1]) moved += 1;
  }
  return { intervals, moved };
}

const FRAME_MS = 1000 / 60;

/** Frame-interval statistics, in milliseconds and in display ticks. */
function summarize(intervals, fields) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const ticks = sorted.map((value) => Math.max(1, Math.round(value / FRAME_MS)));
  return {
    ...fields,
    frames: sorted.length,
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1]),
    p95Frames: percentile(ticks, 0.95),
    droppedShare: round(ticks.filter((t) => t > 1).length / Math.max(1, ticks.length)),
  };
}

async function runCeiling() {
  const { chromium } = requireDep('playwright-core');
  const sizes = flag('sizes', '500,1000,2000,4000,8000').split(',').map(Number);
  await mkdir(OUT, { recursive: true });
  const server = await serve(await bundleCeilingPage());
  const executablePath = process.env.DAGR_CHROMIUM;
  // Headed by default. Headless Chromium on the machine this was written on
  // paces requestAnimationFrame at 67 to 100 ms on a page holding one moving
  // div, so a headless interval measures the pacing, not the page. The
  // control row below is there to show which of the two a run measured.
  const headless = args.includes('--headless');
  const browser = await chromium.launch({ headless, ...(executablePath === undefined ? {} : { executablePath }) });
  const report = {
    date: new Date().toISOString(),
    machine: machine(),
    browser: `chromium ${browser.version()} ${headless ? 'headless' : 'headed'}`,
    rows: [],
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => console.log(`pageerror: ${String(error)}`));
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    // The control: one div moved every frame, which any browser holds at the
    // display's rate. Its intervals are the floor every row is read against.
    await page.setContent('<div id="d" style="width:100px;height:100px;background:#888"></div>');
    const control = await page.evaluate(
      (durationMs) =>
        new Promise((resolve) => {
          const div = document.getElementById('d');
          const times = [];
          const step = (time) => {
            times.push(time);
            div.style.transform = `translateX(${String(times.length % 400)}px)`;
            if (time - times[0] < durationMs) requestAnimationFrame(step);
            else resolve(times.slice(1).map((value, i) => value - times[i]));
          };
          requestAnimationFrame(step);
        }),
      8000,
    );
    report.control = summarize(control.slice(5), { nodes: 0, edges: 0, baseMarks: 0, baseEdges: 0, nodeElements: 0, movedFrames: control.length });
    console.log(JSON.stringify({ control: true, ...report.control }));
    for (const size of sizes) {
      await page.goto(`${server.origin}/__ceiling/?nodes=${String(size)}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => document.querySelector('[data-dagr-explorer="plane"]')?.style.visibility === 'visible',
        null,
        { timeout: 60_000 },
      );
      const stats = await page.evaluate(() => window.graphStats);
      const box = await page.evaluate(() => {
        const r = document.querySelector('[data-dagr-explorer="viewport"]').getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      // At fit the camera cannot pan at all: the whole graph is in view, so
      // the limits hold the center. 1.25 squared is the least toolbar zoom
      // that frees it, and the overscan still keeps every node in the set.
      for (let k = 0; k < 2; k += 1) await page.locator('[data-action="zoom-in"]').click();
      await page.evaluate(async () => {
        let last = '';
        let stable = 0;
        const plane = document.querySelector('[data-dagr-explorer="plane"]');
        while (stable < 20) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          stable = plane.style.transform === last && plane.style.willChange === '' ? stable + 1 : 0;
          last = plane.style.transform;
        }
      });
      const counts = await page.evaluate(() => ({
        marks: document.querySelectorAll('[data-dagr-explorer="plane"] svg rect[data-node-id]').length,
        paths: document.querySelectorAll('[data-dagr-explorer="plane"] svg path[data-edge-id]').length,
        elements: document.querySelectorAll('[data-dagr-explorer="node"]').length,
      }));
      await dragAndRecord(page, box, 1500);
      const runs = [];
      for (let r = 0; r < 3; r += 1) runs.push(await dragAndRecord(page, box, 4000));
      const intervals = runs.flatMap((run) => run.intervals.slice(5));
      const row = summarize(intervals, {
        nodes: stats.nodes,
        edges: stats.edges,
        baseMarks: counts.marks,
        baseEdges: counts.paths,
        nodeElements: counts.elements,
        movedFrames: runs.reduce((sum, run) => sum + run.moved, 0),
      });
      report.rows.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await browser.close();
    await server.close();
  }
  // Smooth is a 95th percentile of one frame: no more than one frame in
  // twenty runs past its 16.7 ms tick. Counted in ticks rather than read off
  // the milliseconds, because the timestamps jitter by a millisecond or two
  // around the tick, and the control's own 95th percentile in milliseconds
  // sits above 16.7 on a page doing nothing. The sizes are only smooth up to
  // the first one that is not: a later size passing is noise, not headroom.
  let ceiling = null;
  for (const row of report.rows) {
    if (row.p95Frames > 1) break;
    ceiling = row.nodes;
  }
  report.ceiling = ceiling;
  await writeFile(join(OUT, 'ceiling.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nceiling (largest size whose p95 stays within one 16.7 ms frame): ${String(report.ceiling)}. Report: ${join(OUT, 'ceiling.json')}`);
  return true;
}

const ok = mode === 'ceiling' ? await runCeiling() : await runChecks();
process.exit(ok ? 0 : 1);
