/**
 * Frame-time distribution of `@prnt/dagr-render` on a WebGPU adapter, by graph
 * size, edge style and node mode, optionally with node hit testing, still and
 * animating (M4.10a). With `--memory` it measures instead what each pass holds
 * in GPU buffers and textures and in the JavaScript heap, and what a moving
 * pass allocates per frame. With `--gpu` it adds the GPU time of every pass
 * from timestamp queries (M4.10), and `--parts` draws the nodes or the edges
 * alone so that time can be split between them. `--motion=springs` moves the
 * animated mode through `createSceneMotion` with every spring in flight rather
 * than a sway computed from the clock, and `--moving` retargets only that share
 * of the nodes and the edges touching them, so the edges at rest show what
 * `setEdges` saves by copying an unchanged route. Evidence, not a gate: see the
 * README.
 *
 * ```
 * pnpm --filter @prnt/dagr-render --filter @prnt/dagr-react build   # the page imports from dist
 * npm --prefix bench/browser install --no-save playwright-core
 * python3 -m http.server 8733           # from the REPO ROOT
 * DAGR_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node bench/browser/frame-profile.mjs
 *   # [--sizes=1000,2500] [--edges=straight,dashed,smooth] [--nodes=shapes,rich]
 *   # [--zoom=fit|1] [--dpr=2] [--frames=300] [--warmup=60] [--hit] [--memory] [--headless]
 *   # [--gpu] [--parts=all,nodes,edges] [--motion=sway,springs] [--moving=1,0.1]
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
const PARTS = ['all', 'nodes', 'edges'];
const partsList = option('parts', 'all').split(',');
for (const parts of partsList) {
  if (!PARTS.includes(parts)) throw new Error(`--parts takes ${PARTS.join(', ')}, got ${parts}`);
}
const MOTIONS = ['sway', 'springs'];
const motions = option('motion', 'sway').split(',');
for (const motion of motions) {
  if (!MOTIONS.includes(motion)) throw new Error(`--motion takes ${MOTIONS.join(', ')}, got ${motion}`);
}
const movingList = option('moving', '1')
  .split(',')
  .map((share) => {
    const value = positive('moving', share);
    if (value > 1) throw new Error(`--moving is a share of the nodes, at most 1, got ${share}`);
    return value;
  });
if (movingList.join() !== '1' && motions.join() !== 'springs') {
  throw new Error('--moving chooses which springs are retargeted, so it takes only --motion=springs');
}
if (movingList.join() !== '1' && nodeModes.includes('rich')) {
  throw new Error('--nodes=rich hands every node to the tiers each frame as if all moved, so it takes only --moving=1');
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
const hit = process.argv.includes('--hit');
const memory = process.argv.includes('--memory');
const gpu = process.argv.includes('--gpu');
if (memory && (gpu || partsList.join() !== 'all' || motions.join() !== 'sway' || movingList.join() !== '1')) {
  throw new Error(
    '--memory builds the whole scene and counts every buffer, so it takes none of --gpu, --parts, --motion and --moving',
  );
}
if ((hit || nodeModes.includes('rich')) && partsList.some((parts) => parts !== 'all')) {
  throw new Error('--hit and --nodes=rich work over every node, so they take only --parts=all');
}

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

// Each frame's passes in submission order, summarised by position. A frame
// whose pass count differs from the most common one is counted, not summarised,
// so a pass is never compared with a different pass. A pass without a usable
// pair of timestamps is counted as `noReading`, and a frame with one is left
// out of `sum`.
function gpuPasses({ frames: perFrame, untimed, grainNs }) {
  const why = {};
  for (const { kind, why: reason } of untimed) why[`${kind}: ${reason}`] = (why[`${kind}: ${reason}`] ?? 0) + 1;
  if (perFrame.length === 0) return { frames: 0, untimed: why, grainNs, passes: [] };
  const counts = new Map();
  for (const f of perFrame) counts.set(f.length, (counts.get(f.length) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const kept = perFrame.filter((f) => f.length === usual);
  const passes = kept[0].map(({ kind, encoder, resolves, depth }, i) => {
    const read = kept.map((f) => f[i].ms).filter((ms) => ms !== null);
    return {
      kind,
      encoder,
      resolves,
      depth,
      noReading: kept.length - read.length,
      ms: read.length === 0 ? null : summarise(read),
    };
  });
  const whole = kept.filter((f) => f.every((p) => p.ms !== null));
  return {
    frames: kept.length,
    otherFrames: perFrame.length - kept.length,
    untimed: why,
    grainNs,
    passes,
    sum: whole.length === 0 ? null : summarise(whole.map((f) => f.reduce((total, p) => total + p.ms, 0))),
  };
}

function mode(run, tickMs) {
  return {
    interval: intervals(run.intervals, tickMs),
    steps: Object.fromEntries(Object.entries(run.steps).map(([name, v]) => [name, summarise(v)])),
    ...(gpu && run.gpu !== undefined ? { gpu: gpuPasses(run.gpu) } : {}),
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

if (memory) {
  await page.evaluate(() => window.trackGpu());
  const cdp = await page.context().newCDPSession(page);
  // `usedSize` is the V8 heap alone; typed-array stores and DOM objects are
  // reported beside it.
  const heapAfterGc = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const usage = await cdp.send('Runtime.getHeapUsage');
    return { v8: usage.usedSize, backing: usage.backingStorageSize, embedder: usage.embedderHeapUsedSize };
  };
  const heapChange = (now, before) =>
    Object.fromEntries(Object.keys(now).map((key) => [key, now[key] - before[key]]));
  const measureRow = async (size, style, nodeMode) => {
    const plan = { count: size, frames, zoom, edgeStyle: style };
    const steps = [
      'graph',
      'renderer',
      'nodes',
      'edges',
      ...(nodeMode === 'rich' ? ['rich'] : []),
      ...(hit ? ['hit'] : []),
      'moveNodes',
      'moveEdges',
      'dispose',
    ];
    let previous = { tally: await page.evaluate(() => window.gpuTally()), heap: await heapAfterGc() };
    const row = { count: size, edgeStyle: style, nodeMode, backend: null, steps: {} };
    for (const step of steps) {
      const tally = await page.evaluate(([s, p]) => window.memoryStep(s, p), [step, plan]);
      const heap = await heapAfterGc();
      if (step === 'renderer') row.backend = tally.backend;
      const created = tally.createdBytes - previous.tally.createdBytes;
      row.steps[step] = {
        gpuBuffers: tally.buffers,
        gpuTextures: tally.textures,
        gpuDelta: tally.buffers + tally.textures - previous.tally.buffers - previous.tally.textures,
        createdBytes: created,
        freedBytes: tally.freedBytes - previous.tally.freedBytes,
        createdObjects: tally.created - previous.tally.created,
        heap,
        heapDelta: heapChange(heap, previous.heap),
        ...(step.startsWith('move')
          ? { frames: tally.worked, createdBytesPerFrame: Math.round(created / tally.worked) }
          : {}),
        ...(step === 'renderer' ? { textureFormats: tally.textureFormats } : {}),
        ...(tally.unknownFormats.length > 0 ? { unknownFormats: tally.unknownFormats } : {}),
      };
      previous = { tally, heap };
    }
    return row;
  };
  // The page's first renderer, overlay and hit index also load and compile
  // what every later one reuses, so one row runs first and is not reported.
  await measureRow(sizes[0], edgeStyles[0], nodeModes.includes('rich') ? 'rich' : nodeModes[0]);
  const rows = [];
  for (const size of sizes) {
    for (const style of edgeStyles) {
      for (const nodeMode of nodeModes) rows.push(await measureRow(size, style, nodeMode));
    }
  }
  await browser.close();
  const report = {
    machine,
    launch,
    adapter,
    viewport: { width: 1280, height: 720, devicePixelRatio: dpr },
    plan: { memory: true, frames, zoom: zoomOption, edges: edgeStyles, nodes: nodeModes, hit },
    rows,
    warnings,
  };
  console.log(JSON.stringify(report, null, 1));
  const leftover = rows.filter((row) => row.steps.dispose.gpuBuffers + row.steps.dispose.gpuTextures > 0);
  if (rows.some((row) => row.backend !== 'webgpu')) process.exitCode = 1;
  if (rows.some((row) => Object.values(row.steps).some((step) => step.unknownFormats !== undefined))) {
    console.error('a texture format has no byte size in TEXEL_BYTES; its bytes are not counted');
    process.exitCode = 1;
  }
  if (leftover.length > 0) console.error(`${leftover.length} rows left GPU bytes live after dispose`);
  process.exit();
}

if (gpu) await page.evaluate(() => window.timeGpuPasses());
const runs = [];
for (const size of sizes) {
  for (const style of edgeStyles) {
    for (const nodeMode of nodeModes) {
      for (const parts of partsList) {
        for (const motion of motions) {
          for (const moving of movingList) {
            runs.push(
              await page.evaluate(
                ([n, w, f, z, e, m, h, p, s, v]) => window.profile(n, w, f, z, e, m, h, p, s, v),
                [size, warmup, frames, zoom, style, nodeMode, hit, parts, motion, moving],
              ),
            );
          }
        }
      }
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
  parts: run.parts,
  motion: run.motion,
  moving: run.moving,
  springs: run.springs,
  elements: run.elements,
  hit:
    run.hit === null
      ? null
      : { indexMs: Math.round(run.hit.indexMs * 100) / 100, hits: run.hit.hits },
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
  plan: { warmup, frames, zoom: zoomOption, edges: edgeStyles, nodes: nodeModes, hit, gpu, parts: partsList, motion: motions, moving: movingList },
  tickMs,
  control,
  rows,
  warnings,
};
console.log(JSON.stringify(report, null, 1));
if (rows.some((row) => row.backend !== 'webgpu')) process.exitCode = 1;
if (gpu) {
  const modes = rows.flatMap((row) => [row.still, row.animated]);
  if (modes.some((m) => m.gpu.frames === 0 || Object.keys(m.gpu.untimed).length > 0)) {
    console.error("a row has passes without timestamps; see each mode's gpu.untimed and the warnings");
    process.exitCode = 1;
  }
  if (modes.some((m) => m.gpu.passes.some((p) => p.noReading > 0))) {
    console.error("a pass has frames without a usable reading; see each pass's noReading");
    process.exitCode = 1;
  }
  const coarsest = Math.max(...modes.map((m) => m.gpu.grainNs ?? 0));
  if (coarsest >= 1000) {
    console.error(
      `timestamps are rounded to ${coarsest} ns; DAGR_CHROMIUM_ARGS=--enable-webgpu-developer-features turns that off`,
    );
    process.exitCode = 1;
  }
}
if (![60, 120].some((hz) => Math.abs(tickMs * hz - 1000) <= 100)) {
  console.error(`tick ${tickMs} ms is not a 60 or 120 Hz frame; the control was throttled`);
  process.exitCode = 1;
}
