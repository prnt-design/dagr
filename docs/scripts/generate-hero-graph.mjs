// Generates src/components/heroGraphData.json: the landing page's hero graph,
// laid out by the engine it advertises. Run after a `pnpm build`, either as
// `pnpm --filter docs generate:hero` or directly:
//
//   node docs/scripts/generate-hero-graph.mjs
//
// The output is committed rather than generated during the docs build, so the
// docs build stays independent of the packages building first (the Render
// deploy builds only the docs workspace). Regenerate when the layout engine
// changes enough that the drawing no longer represents it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Graph } = await import(join(here, '../../packages/graph/dist/index.js'));
const { layout } = await import(join(here, '../../packages/layout/dist/index.js'));

// A curated DAG rather than a random one: enough fan-in and fan-out to show
// ordering at work, two edges spanning multiple ranks so the router's bends
// through dummy chains are visible, and one seven-node source-to-sink spine
// the page picks out in the accent color.
const g = new Graph();
const ranks = [
  ['a0'],
  ['b0', 'b1', 'b2'],
  ['c0', 'c1', 'c2', 'c3'],
  ['d0', 'd1', 'd2', 'd3', 'd4'],
  ['e0', 'e1', 'e2', 'e3'],
  ['f0', 'f1'],
  ['g0'],
];
for (const layer of ranks) for (const id of layer) g.addNode({ id });
const edges = [
  ['a0', 'b0'], ['a0', 'b1'], ['a0', 'b2'],
  ['b0', 'c0'], ['b0', 'c1'], ['b1', 'c1'], ['b1', 'c2'], ['b2', 'c2'], ['b2', 'c3'],
  ['c0', 'd0'], ['c0', 'd1'], ['c1', 'd1'], ['c1', 'd2'], ['c2', 'd2'], ['c2', 'd3'],
  ['c3', 'd3'], ['c3', 'd4'],
  ['d0', 'e0'], ['d1', 'e0'], ['d1', 'e1'], ['d2', 'e1'], ['d2', 'e2'], ['d3', 'e2'],
  ['d4', 'e3'], ['d3', 'e3'],
  ['e0', 'f0'], ['e1', 'f0'], ['e2', 'f1'], ['e3', 'f1'],
  ['f0', 'g0'], ['f1', 'g0'],
  // The long edges: rank spans of 3 and 2, so the router has bends to draw.
  ['b1', 'e2'], ['c0', 'e0'], ['d4', 'g0'],
];
for (const [source, target] of edges) g.addEdge({ source, target });

const start = process.hrtime.bigint();
const result = layout({
  graph: g,
  config: { defaultNodeSize: { width: 30, height: 30 }, rankSep: 54, nodeSep: 26 },
});
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

const spineNodes = ['a0', 'b1', 'c2', 'd2', 'e1', 'f0', 'g0'];
const spineEdgeSet = new Set();
for (let i = 0; i < spineNodes.length - 1; i++) {
  spineEdgeSet.add(`${spineNodes[i]}->${spineNodes[i + 1]}`);
}

const round = (v) => Math.round(v * 10) / 10;
const data = {
  bounds: {
    x: round(result.bounds.x),
    y: round(result.bounds.y),
    width: round(result.bounds.width),
    height: round(result.bounds.height),
  },
  nodes: [...result.nodes.values()].map((n) => ({
    id: n.id,
    x: round(n.x),
    y: round(n.y),
    width: n.width,
    height: n.height,
    spine: spineNodes.includes(n.id),
  })),
  edges: [...result.edges.values()].map((e) => ({
    id: e.id,
    spine: spineEdgeSet.has(`${e.source}->${e.target}`),
    points: e.points.map((p) => [round(p.x), round(p.y)]),
  })),
};

const out = join(here, '../src/components/heroGraphData.json');
writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(
  `wrote ${out}: ${data.nodes.length} nodes, ${data.edges.length} edges, ` +
    `${ranks.length} ranks, laid out in ${elapsedMs.toFixed(1)}ms`,
);
