// Synthetic, headless feasibility probe. Run from the Dagr repository root.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
import { Graph } from '../../packages/graph/dist/index.js';
import { createLayout, applyDelta } from '../../packages/layout/dist/index.js';

const graph = new Graph();
graph.batch(() => {
  for (const [id, kind] of [['note:1', 'memory'], ['note:2', 'memory'], ['topic:1', 'topic'], ['source:1', 'source']]) {
    graph.addNode({ id, attrs: { kind, label: `Synthetic ${id}` } });
  }
  graph.addEdge({ id: 'relation:1', source: 'note:1', target: 'topic:1', attrs: {
    predicate: 'mentions', status: 'suggested', confidence: 0.72,
    evidenceIds: ['source:1'], revision: 1,
  } });
  graph.addEdge({ id: 'relation:2', source: 'note:1', target: 'topic:1', attrs: {
    predicate: 'contradicts', status: 'confirmed', confidence: null,
    evidenceIds: ['source:1'], revision: 1,
  } });
  graph.addEdge({ id: 'relation:3', source: 'topic:1', target: 'note:1' });
  graph.addEdge({ id: 'relation:4', source: 'note:1', target: 'note:1' });
});
const engine = createLayout();
let geometry = engine.run(graph);
const initial = graph.toJSON();
let patchCount = 0;
graph.subscribe(patch => {
  patchCount++;
  const next = engine.relayout(patch);
  assert.deepEqual(applyDelta(geometry, next.delta), next.result);
  geometry = next.result;
});

// The domain owns revision checks, corrections, and deletion semantics.
// The renderer receives accepted state; this is an in-memory stand-in only.
function correctRelation(id, revision, predicate) {
  const edge = graph.getEdge(id);
  if (!edge || edge.attrs.revision !== revision) throw new Error('stale relation');
  graph.updateEdgeAttrs(id, { predicate, status: 'confirmed', revision: revision + 1 });
}
correctRelation('relation:1', 1, 'supports');
assert.throws(() => correctRelation('relation:1', 1, 'mentions'), /stale relation/);
assert.equal(graph.getEdge('relation:1').attrs.predicate, 'supports');
assert.deepEqual(graph.getEdge('relation:1').attrs.evidenceIds, ['source:1']);
graph.removeEdge('relation:1');
assert.ok(graph.getEdge('relation:2'), 'parallel relation must survive');
assert.equal(graph.nodes().length, 4, 'unlink must preserve source memories');
graph.removeNode('note:1');
assert.equal(graph.edges().length, 0, 'node removal removes incident edges');
assert.equal(geometry.nodes.size, 3);
assert.equal(patchCount, 3);

function fixture(count) {
  const g = new Graph();
  g.batch(() => {
    for (let i = 0; i < count; i++) g.addNode(`synthetic:${i}`);
    for (let i = 1; i < count; i++) g.addEdge(`synthetic:${Math.floor((i - 1) / 3)}`, `synthetic:${i}`, `edge:${i}`);
  });
  return g;
}
const timings = [];
for (const count of [50, 150, 500]) {
  const samples = [];
  for (let run = 0; run < 12; run++) {
    const g = fixture(count);
    const e = createLayout();
    const start = performance.now();
    const result = e.run(g);
    const elapsed = performance.now() - start;
    assert.equal(result.nodes.size, count);
    assert.equal(result.edges.size, count - 1);
    for (const node of result.nodes.values()) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    if (run >= 2) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  timings.push({ nodes: count, edges: count - 1, samples: samples.length,
    medianMs: +((samples[4] + samples[5]) / 2).toFixed(2), maxMs: +samples.at(-1).toFixed(2) });
}
const result = {
  generatedAt: new Date().toISOString(), syntheticOnly: true,
  runtime: process.version, cpu: os.cpus()[0].model, memoryBytes: os.totalmem(),
  checks: ['parallel edges retained', 'cycle and self-loop accepted', 'revision conflict rejected',
    'correction preserved evidence', 'unlink preserved nodes and other relation',
    'node removal cleared incident edges', 'three incremental delta round trips matched'],
  timings, limitations: 'Node CPU layout only; balanced sparse tree; no rendering, Android, WebView, GPU, motion, worker, or accessibility measurement.',
};
writeFileSync(new URL('./synthetic-fixture.json', import.meta.url), JSON.stringify(initial, null, 2) + '\n');
writeFileSync(new URL('./probe-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
