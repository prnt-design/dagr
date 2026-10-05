/**
 * The page `explorer-check.mjs ceiling` measures: `DagrExplorer` over a
 * generated graph of `?nodes=` nodes, filling a fixed stage.
 *
 * This file runs in the BROWSER, not in node. The runner bundles it with
 * esbuild, against the built `packages/explorer/dist` and the React 19 the
 * explorer is developed with, and serves the bundle beside the docs site.
 * Plain `createElement` rather than JSX, so it needs no transform and stays
 * inside `pnpm lint` like the rest of this directory.
 *
 * The graph is the docs demo's generator (`docs/src/components/ExplorerDemo/
 * synthetic.ts`) with the node count as a parameter: layers of nodes, each
 * edge joining a near neighbor in an earlier layer, a few dashed edges
 * skipping one or two. One change, the shape: the layer count grows with the
 * square root of the node count, so every size lays out at about the stage's
 * aspect and fills it at fit. With the demo's 50 per layer an 8,000 node graph
 * would be ten times wider than tall and fill a sliver of the stage, and the
 * sizes would not be comparable.
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DagrExplorer } from '@prnt/dagr-explorer';

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

/** `count` nodes in about `sqrt(0.8 * count)` layers, which lays out near 2.6 to 1, the stage's aspect. */
function syntheticView(count, seed = 2026) {
  const layers = Math.max(1, Math.round(Math.sqrt(0.8 * count)));
  const perLayer = Math.ceil(count / layers);
  const random = mulberry32(seed);
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const idOf = (layer, slot) => `n${String(layer)}-${String(slot)}`;
  const near = (slot, spread) =>
    Math.min(perLayer - 1, Math.max(0, slot + Math.floor(random() * (spread * 2 + 1)) - spread));
  const link = (source, target, dash) => {
    const id = `${source}>${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push(dash ? { id, source, target, dash } : { id, source, target });
  };
  for (let layer = 0; layer < layers; layer += 1) {
    for (let slot = 0; slot < perLayer && nodes.length < count; slot += 1) {
      const id = idOf(layer, slot);
      nodes.push({ id, label: `Node ${String(nodes.length + 1)}` });
      if (layer === 0) continue;
      link(idOf(layer - 1, near(slot, 2)), id, false);
      if (random() < 0.35) link(idOf(layer - 1, near(slot, 4)), id, false);
      if (layer >= 3 && random() < 0.06) {
        const back = 2 + Math.floor(random() * 2);
        link(idOf(layer - back, near(slot, 6)), id, true);
      }
    }
  }
  // The last layer can be short, so an edge may name a slot that was never
  // made. Dropped rather than generated around, which would change the seed's
  // sequence for every size.
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    layout: { direction: 'right', nodeSize: { width: 160, height: 56 }, nodeSep: 24, rankSep: 96 },
  };
}

const count = Number(new URLSearchParams(window.location.search).get('nodes') ?? '1000');
const view = syntheticView(count);
window.graphStats = { nodes: view.nodes.length, edges: view.edges.length };

createRoot(document.getElementById('stage')).render(
  createElement(DagrExplorer, {
    label: 'Ceiling',
    nodes: view.nodes,
    edges: view.edges,
    layout: view.layout,
  }),
);
