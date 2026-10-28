/**
 * Hover and click at 10,000 nodes through `DagrCanvas`'s `hitTesting="gpu"`,
 * on a real adapter: M4.8b's device demonstration.
 *
 * `backend-probe.mjs --pick` checks `Renderer.pickNode` on a five-node scene.
 * This checks the path a consumer gets: the component, its picked hit provider
 * and real mouse events, over a laid-out graph of `--nodes` nodes at the fit
 * zoom, where a node is a few CSS pixels tall. For each sample the mouse rests
 * on a node's centre (or on empty canvas), and the run waits for `onNodeHover`
 * to name the node the shapes put there, then clicks and waits for
 * `onNodeClick` (or `onBackgroundClick`). The reference is the CPU index over
 * the same scene nodes; a point whose device pixel straddles a boundary, or a
 * node centre with no node there, is skipped. Between samples the mouse goes somewhere with the other answer, so
 * every sample is a change the canvas has to report.
 *
 * ```
 * pnpm build
 * npm --prefix bench/browser install --no-save playwright-core esbuild
 * node bench/browser/windows-chrome.mjs --headless          # on WSL2, leave running
 * DAGR_CDP=http://127.0.0.1:9445 node bench/browser/gpu-hover.mjs
 *   # [--nodes=10000] [--samples=200] [--dpr=1,2] [--control]
 * ```
 *
 * `--control` takes the reference from 9 CSS pixels right of the pointer, and
 * exits non-zero unless that run fails, so a pass is not a check that cannot
 * fail.
 *
 * Otherwise it exits non-zero unless the canvas came up on `webgpu` on an
 * adapter that is not a fallback adapter, with no page error, `pickNode` ran
 * at least once per sample, and every sample was answered correctly. The
 * latency it prints is from the `pointermove` to the `onNodeHover` call: what
 * a user waits for, not what a pick costs a frame.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPS = process.env.DAGR_BROWSER_DEPS ?? fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(DEPS, 'package.json'));
const { chromium } = require('playwright-core');
const esbuild = require('esbuild');

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ORIGIN = 'http://127.0.0.1:8733';
const CDP = process.env.DAGR_CDP;
const EXECUTABLE = process.env.DAGR_CHROMIUM;
const LAUNCH_ARGS = (process.env.DAGR_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean);
const VIEWPORT = { width: 1280, height: 720 };
const ANSWER_MS = 3_000;

const option = (name, fallback) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const nodes = Number(option('nodes', '10000'));
const samples = Number(option('samples', '200'));
const ratios = option('dpr', '1,2').split(',').map(Number);
const headless = !process.argv.includes('--headed');
const control = process.argv.includes('--control');
// The control reads the reference this far right of the pointer: about one
// rounded rect's pitch within a rank at the fit zoom, so it expects a neighbour.
const CONTROL_OFFSET = control ? 9 : 0;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function bundlePage() {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'bench', 'browser', 'gpu-hover-page.mjs')],
    bundle: true,
    write: false,
    format: 'esm',
    alias: {
      '@prnt/dagr-react': join(ROOT, 'packages', 'react', 'dist', 'index.js'),
      '@prnt/dagr-graph': join(ROOT, 'packages', 'graph', 'dist', 'index.js'),
    },
    nodePaths: [join(ROOT, 'packages', 'react', 'node_modules'), join(ROOT, 'packages', 'render', 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  return result.outputFiles[0].text;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const round = (value) => Math.round(value * 10) / 10;

/**
 * Moves the mouse to `point` and waits for `onNodeHover` to report `id`; the
 * latency, or null on a timeout. A reset may move to where the hover already
 * is, which reports nothing, so it waits for no report.
 */
async function hoverTo(page, point, id, isReset = false) {
  const [before, current] = await page.evaluate(() => [window.record.hovers.length, window.record.hovered]);
  await page.mouse.move(point.x, point.y);
  if (isReset && current === id) return 0;
  try {
    await page.waitForFunction(
      ([count, want]) => window.record.hovers.length > count && window.record.hovered === want,
      [before, id],
      { timeout: ANSWER_MS },
    );
  } catch {
    return null;
  }
  return page.evaluate(() => window.record.hovers.at(-1).afterMove);
}

async function clickHere(page, id) {
  const before = await page.evaluate(() => [window.record.clicks.length, window.record.backgroundClicks.length]);
  await page.mouse.down();
  await page.mouse.up();
  try {
    await page.waitForFunction(
      ([clicks, background, want]) =>
        want === null
          ? window.record.backgroundClicks.length > background
          : window.record.clicks.length > clicks && window.record.clicks.at(-1) === want,
      [...before, id],
      { timeout: ANSWER_MS },
    );
    return true;
  } catch {
    return false;
  }
}

async function run(browser, bundle, ratio) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: ratio });
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  page.on('pageerror', (error) => warnings.push(`pageerror: ${String(error)}`));
  await page.route(`${ORIGIN}/__hover/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__hover/bundle.js') {
      return route.fulfill({ contentType: 'text/javascript', body: bundle });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta charset="utf-8"><title>gpu hover</title>
<style>html,body{margin:0;height:100%;overflow:hidden} #stage{width:100vw;height:100vh}</style></head>
<body><div id="stage"></div><script type="module" src="/__hover/bundle.js"></script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/__hover/?nodes=${String(nodes)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.stage !== undefined || window.record?.errors.length > 0, null, {
    timeout: 120_000,
  });
  // The canvas fits on its first drawable frame, after the layout `stage` waits for.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const step = () => (++frames >= 30 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
  );
  const errors = await page.evaluate(() => window.record.errors);
  if (errors.length > 0) throw new Error(`the canvas failed: ${errors.join('; ')}`);
  const adapter = await page.evaluate(async () => {
    if (!('gpu' in window.navigator)) return null;
    const found = await window.navigator.gpu.requestAdapter();
    if (found === null) return null;
    const { vendor, architecture, device, description } = found.info;
    return { vendor, architecture, device, description, isFallbackAdapter: found.info.isFallbackAdapter ?? found.isFallbackAdapter };
  });
  const { backend, ids, zoom } = await page.evaluate(() => ({
    backend: window.stage.backend,
    ids: window.stage.ids,
    zoom: window.stage.zoom(),
  }));

  const random = mulberry32(ratio * 7919);
  const nodeSamples = [];
  const backgroundSamples = [];
  const skipped = { ambiguous: 0, empty: 0 };
  let draws = 0;
  while (nodeSamples.length < samples) {
    if (++draws > samples * 20) throw new Error(`found ${String(nodeSamples.length)} of ${String(samples)} node samples`);
    const id = ids[Math.floor(random() * ids.length)];
    const [centre] = await page.evaluate((one) => window.stage.centres([one]), id);
    const point = { x: Math.round(centre.x), y: Math.round(centre.y) };
    if (point.x < 1 || point.y < 1 || point.x >= VIEWPORT.width - 1 || point.y >= VIEWPORT.height - 1) continue;
    const expected = await page.evaluate((p) => window.stage.expected(p), { x: point.x + CONTROL_OFFSET, y: point.y });
    if (expected.ambiguous) skipped.ambiguous += 1;
    else if (expected.id === null) skipped.empty += 1;
    else nodeSamples.push({ point, id: expected.id });
  }
  while (backgroundSamples.length < Math.ceil(samples / 4)) {
    const point = { x: 1 + Math.floor(random() * (VIEWPORT.width - 2)), y: 1 + Math.floor(random() * (VIEWPORT.height - 2)) };
    const expected = await page.evaluate((p) => window.stage.expected(p), { x: point.x + CONTROL_OFFSET, y: point.y });
    if (expected.ambiguous || expected.id !== null) continue;
    backgroundSamples.push({ point, id: null });
  }

  const latencies = [];
  const failures = [];
  const resetToBackground = backgroundSamples[0];
  const resetToNode = nodeSamples[0];
  for (const sample of [...nodeSamples, ...backgroundSamples]) {
    const reset = sample.id === null ? resetToNode : resetToBackground;
    if ((await hoverTo(page, reset.point, reset.id, true)) === null) {
      failures.push({ ...sample, stage: 'reset', got: await page.evaluate(() => window.record.hovered) });
      continue;
    }
    const latency = await hoverTo(page, sample.point, sample.id);
    if (latency === null) {
      failures.push({ ...sample, stage: 'hover', got: await page.evaluate(() => window.record.hovered) });
      continue;
    }
    latencies.push(latency);
    if (!(await clickHere(page, sample.id))) failures.push({ ...sample, stage: 'click' });
  }
  const picks = await page.evaluate(() => window.record.picks);
  await page.close();

  latencies.sort((a, b) => a - b);
  return {
    dpr: ratio,
    backend,
    adapter,
    nodes: ids.length,
    zoom: round(zoom * 1000) / 1000,
    samples: { node: nodeSamples.length, background: backgroundSamples.length, skipped },
    picks,
    failures,
    hoverLatencyMs: {
      p50: round(percentile(latencies, 0.5)),
      p95: round(percentile(latencies, 0.95)),
      max: round(latencies.at(-1)),
    },
    warnings,
  };
}

const bundle = await bundlePage();
const browser =
  CDP === undefined
    ? await chromium.launch({
        headless,
        args: LAUNCH_ARGS,
        ...(EXECUTABLE === undefined ? {} : { executablePath: EXECUTABLE }),
      })
    : await chromium.connectOverCDP(CDP);
const runs = [];
for (const ratio of ratios) runs.push(await run(browser, bundle, ratio));
const launch = {
  browserVersion: browser.version(),
  ...(CDP === undefined ? { mode: headless ? 'headless' : 'headed', args: LAUNCH_ARGS } : { attached: CDP }),
};
console.log(JSON.stringify({ launch, viewport: VIEWPORT, control, runs }, null, 1));
for (const one of runs) {
  if (one.backend !== 'webgpu' || one.adapter === null || one.adapter.isFallbackAdapter === true) {
    console.error(`dpr ${String(one.dpr)}: not a WebGPU result (backend ${one.backend}, adapter ${JSON.stringify(one.adapter)})`);
    process.exitCode = 1;
  }
  if (control) {
    if (one.failures.length === 0) {
      console.error(`dpr ${String(one.dpr)}: the control passed, so this check cannot tell a wrong answer`);
      process.exitCode = 1;
    }
  } else if (
    one.failures.length > 0 ||
    one.picks < one.samples.node + one.samples.background ||
    one.warnings.some((warning) => warning.startsWith('pageerror'))
  ) {
    console.error(`dpr ${String(one.dpr)}: ${String(one.failures.length)} failures, ${String(one.picks)} picks`);
    process.exitCode = 1;
  }
}
await browser.close();
