// Generates the landing page's performance figure: the 1k bench corpus
// (`smallCorpus` from `bench/src/corpus.ts`, 1,000 nodes and 4,000 edges,
// the same spec the committed baseline gates on), laid out by `layout` and
// drawn to two static SVGs, one per theme. Run after a `pnpm build`, either
// as `pnpm --filter docs generate:perf` or directly:
//
//   node --experimental-strip-types docs/scripts/generate-perf-graph.mjs
//
// Static files rather than inline JSX because a 4,000 edge drawing is data,
// not markup: each SVG holds one path for the edges and one for the nodes,
// which keeps them about 218KB each where element-per-edge markup would be
// megabytes. Colors are the muslin token values by hand, one file per theme,
// because a static SVG cannot read the page's custom properties.
//
// The timing written to perfStats.json is a median of 15 runs on whatever
// machine ran this script, and the machine is recorded beside it, because a
// number without its machine is how benchmark folklore starts.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Graph } = await import(join(here, '../../packages/graph/dist/index.js'));
const { layout } = await import(join(here, '../../packages/layout/dist/index.js'));
const { smallCorpus } = await import(join(here, '../../bench/src/corpus.ts'));

const spec = smallCorpus();
const g = new Graph();
for (const id of spec.nodes) g.addNode(id);
for (const [source, target] of spec.edges) g.addEdge(source, target);

const config = {
  defaultNodeSize: { width: 8, height: 8 },
  rankSep: 42,
  nodeSep: 4,
};

const RUNS = 15;
const times = [];
let result;
for (let i = 0; i < RUNS; i++) {
  const start = process.hrtime.bigint();
  result = layout({ graph: g, config });
  times.push(Number(process.hrtime.bigint() - start) / 1e6);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(RUNS / 2)];

// Landscape: the rank axis runs left to right, so x and y swap.
const r = (v) => Math.round(v);
let edgePath = '';
for (const e of result.edges.values()) {
  edgePath += `M${e.points.map((p) => `${r(p.y)} ${r(p.x)}`).join('L')}`;
}
let nodePath = '';
for (const n of result.nodes.values()) {
  nodePath += `M${r(n.y - n.height / 2)} ${r(n.x - n.width / 2)}h${n.height}v${n.width}h-${n.height}z`;
}

const PAD = 16;
const viewBox = [
  r(result.bounds.y) - PAD,
  r(result.bounds.x) - PAD,
  r(result.bounds.height) + PAD * 2,
  r(result.bounds.width) + PAD * 2,
].join(' ');

// Muslin values by hand: the achromatic ramp over each theme's background,
// nodes in the theme's primary. The drawing is the pattern on screen, so it
// is the one thing here allowed to carry the seed.
const THEMES = {
  light: { edge: 'oklch(0.13 0 0 / 0.2)', node: 'oklch(0.46 0.08 161)' },
  dark: { edge: 'oklch(1 0 0 / 0.17)', node: 'oklch(0.68 0.08 161)' },
};

for (const [name, c] of Object.entries(THEMES)) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<path d="${edgePath}" fill="none" stroke="${c.edge}" stroke-width="0.7"/>` +
    `<path d="${nodePath}" fill="${c.node}"/>` +
    `</svg>\n`;
  writeFileSync(join(here, `../static/img/bench-1k-${name}.svg`), svg);
}

const stats = {
  nodes: result.nodes.size,
  edges: result.edges.size,
  medianMs: Math.round(median * 10) / 10,
  runs: RUNS,
  machine: cpus()[0]?.model.trim() ?? 'unknown',
  node: process.version,
  generated: new Date().toISOString().slice(0, 10),
};
writeFileSync(
  join(here, '../src/components/perfStats.json'),
  JSON.stringify(stats, null, 2) + '\n',
);
console.log(stats);
