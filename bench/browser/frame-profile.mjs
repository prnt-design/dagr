/**
 * Frame-time distribution of `@prnt/dagr-render` on a WebGPU adapter, by graph
 * size, edge style and node mode, still and animating (M4.10a). Evidence, not a
 * gate: see the README.
 *
 * ```
 * pnpm --filter @prnt/dagr-render build      # the page imports from dist
 * npm --prefix bench/browser install --no-save playwright-core
 * python3 -m http.server 8733           # from the REPO ROOT
 * DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node bench/browser/frame-profile.mjs
 *   # [--sizes=1000,2500] [--edges=straight,dashed,smooth] [--nodes=shapes,rich]
 *   # [--zoom=fit|1] [--dpr=2] [--frames=300] [--warmup=60] [--headless]
 * ```
 *
 * The page asks for `backend: 'webgpu'`, so a browser without an adapter fails
 * with `BACKEND_UNAVAILABLE` rather than measuring the WebGL2 fallback.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPS = process.env.DAGR_BROWSER_DEPS ?? fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(DEPS, 'package.json'));
const { chromium } = require('playwright-core');

const ROOT = new URL('../..', import.meta.url).pathname;
const ORIGIN = 'http://127.0.0.1:8733';
const PAGE = `${ORIGIN}/bench/browser/frame-profile.html`;

const EXECUTABLE = process.env.DAGR_CHROMIUM;
const LAUNCH_ARGS = (process.env.DAGR_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean);

const option = (name, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg === undefined ? fallback : arg.slice(name.length + 3);
};
const positive = (name, text) => {
  const value = Number(text);
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`--${name} has to be a positive number, got ${text}`);
  return value;
};
const count = (name, text) => {
  const value = positive(name, text);
  if (!Number.isInteger(value)) throw new Error(`--${name} has to be a whole number, got ${text}`);
  return value;
};
const sizes = option('sizes', '1000,2500,5000,10000')
  .split(',')
  .map((size) => count('sizes', size));
const EDGE_STYLES = ['straight', 'dashed', 'smooth'];
const edgeStyles = option('edges', 'straight').split(',');
for (const style of edgeStyles) {
  if (!EDGE_STYLES.includes(style)) throw new Error(`--edges takes ${EDGE_STYLES.join(', ')}, got ${style}`);
}
const NODE_MODES = ['shapes', 'rich'];
const nodeModes = option('nodes', 'shapes').split(',');
for (const nodeMode of nodeModes) {
  if (!NODE_MODES.includes(nodeMode)) throw new Error(`--nodes takes ${NODE_MODES.join(', ')}, got ${nodeMode}`);
}
const frames = count('frames', option('frames', '300'));
const warmup = count('warmup', option('warmup', '60'));
const zoomOption = option('zoom', 'fit');
const zoom = zoomOption === 'fit' ? null : positive('zoom', zoomOption);
const dpr = positive('dpr', option('dpr', '1'));
// Headed by default for the reason the explorer ceiling gives: headless
// Chromium on the Apple M4 paced requestAnimationFrame at 67 to 100 ms on an
// empty page, so a headless interval measures the pacing, not the page.
const headless = process.argv.includes('--headless');

function pageHtml() {
  const fromRender = createRequire(`${ROOT}packages/render/package.json`);
  const served = (specifier) => {
    const resolved = fromRender.resolve(specifier);
    if (!resolved.startsWith(ROOT)) {
      throw new Error(`${specifier} resolved to ${resolved}, outside ${ROOT}`);
    }
    return resolved.slice(ROOT.length - 1);
  };
  return readFileSync(`${ROOT}bench/browser/frame-profile.html`, 'utf8')
    .replace('__THREE_WEBGPU__', served('three/webgpu'))
    .replace('__THREE_TSL__', served('three/tsl'));
}

const quantile = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (ms) => Math.round(ms * 100) / 100;
  return {
    median: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

// Timestamps jitter a millisecond or two around each vsync, so an interval is
// counted in ticks and "past one tick" means at least one frame was missed.
// The tick is the control's median, so a 120 Hz display is counted at 120 Hz.
function intervals(values, tickMs) {
  const missed = values.filter((ms) => Math.round(ms / tickMs) > 1).length;
  return { ...summarise(values), pastOneTick: Math.round((missed / values.length) * 1000) / 10 };
}

function mode(run, tickMs) {
  return {
    interval: intervals(run.intervals, tickMs),
    steps: Object.fromEntries(Object.entries(run.steps).map(([name, v]) => [name, summarise(v)])),
  };
}

const browser = await chromium.launch({
  headless,
  args: LAUNCH_ARGS,
  ...(EXECUTABLE === undefined ? {} : { executablePath: EXECUTABLE }),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
const warnings = [];
page.on('console', (m) => {
  if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
});
page.on('pageerror', (error) => warnings.push(`pageerror: ${String(error)}`));
await page.route(PAGE, (route) => route.fulfill({ contentType: 'text/html', body: pageHtml() }));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });

const machine = {
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  platform: `${process.platform} ${process.arch}`,
};
const launch = {
  browserVersion: browser.version(),
  executable: EXECUTABLE ?? 'playwright default',
  mode: headless ? 'headless' : 'headed',
  args: LAUNCH_ARGS,
};
const adapter = await page.evaluate(() => window.adapter());

const runs = [];
for (const size of sizes) {
  for (const style of edgeStyles) {
    for (const nodeMode of nodeModes) {
      runs.push(
        await page.evaluate(
          ([n, w, f, z, e, m]) => window.profile(n, w, f, z, e, m),
          [size, warmup, frames, zoom, style, nodeMode],
        ),
      );
    }
  }
}
const controlRun = await page.evaluate(([w, f]) => window.control(w, f), [warmup, frames]);
await browser.close();

const tickMs = summarise(controlRun.intervals).median;
const control = mode(controlRun, tickMs);
const rows = runs.map((run) => ({
  count: run.count,
  edges: run.edges,
  edgeStyle: run.edgeStyle,
  nodeMode: run.nodeMode,
  elements: run.elements,
  backend: run.backend,
  zoom: Math.round(run.zoom * 10_000) / 10_000,
  buildMs: Math.round(run.buildMs),
  heapMb: Object.fromEntries(
    Object.entries(run.heap).map(([k, v]) => [k, v === null ? null : Math.round(v / 2 ** 20)]),
  ),
  still: mode(run.still, tickMs),
  animated: mode(run.animated, tickMs),
}));

const report = {
  machine,
  launch,
  adapter,
  viewport: { width: 1280, height: 720, devicePixelRatio: dpr },
  plan: { warmup, frames, zoom: zoomOption, edges: edgeStyles, nodes: nodeModes },
  tickMs,
  control,
  rows,
  warnings,
};
console.log(JSON.stringify(report, null, 1));
if (rows.some((row) => row.backend !== 'webgpu')) process.exitCode = 1;
if (![60, 120].some((hz) => Math.abs(tickMs * hz - 1000) <= 100)) {
  console.error(`tick ${tickMs} ms is not a 60 or 120 Hz frame; the control was throttled`);
  process.exitCode = 1;
}
