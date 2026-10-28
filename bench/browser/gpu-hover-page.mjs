/**
 * The page `gpu-hover.mjs` drives: `DagrCanvas` over a generated graph of
 * `?nodes=` nodes with `hitTesting="gpu"`, filling the viewport.
 *
 * This file runs in the BROWSER. The runner bundles it with esbuild against
 * the built `packages/react/dist`, as `explorer-check.mjs` bundles its page.
 * Plain `createElement`, so it needs no transform and stays inside `pnpm lint`.
 *
 * Every third node is a circle, so both pick families are under the pointer.
 * The page records what the canvas reports and answers the runner's question
 * of which node the shapes put under a point, from the CPU index over the same
 * scene nodes the canvas drew.
 */

import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from '@prnt/dagr-graph';
import {
  DagrCanvas,
  createNodeHitIndex,
  toSceneNodes,
  useDagrCanvas,
} from '@prnt/dagr-react';

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

/** `count` nodes in about `sqrt(0.8 * count)` layers, each joined to a near node in the layer before. */
function layeredGraph(count, seed = 2026) {
  const layers = Math.max(1, Math.round(Math.sqrt(0.8 * count)));
  const perLayer = Math.ceil(count / layers);
  const random = mulberry32(seed);
  const graph = new Graph();
  let made = 0;
  for (let layer = 0; layer < layers && made < count; layer += 1) {
    for (let slot = 0; slot < perLayer && made < count; slot += 1) {
      graph.addNode(`n${String(layer)}-${String(slot)}`);
      made += 1;
      if (layer === 0) continue;
      const near = Math.min(perLayer - 1, Math.max(0, slot + Math.floor(random() * 5) - 2));
      graph.addEdge(`n${String(layer - 1)}-${String(near)}`, `n${String(layer)}-${String(slot)}`);
    }
  }
  return graph;
}

const params = new URLSearchParams(window.location.search);
const count = Number(params.get('nodes') ?? '10000');
const graph = layeredGraph(count);
const isCircle = (id) => Number(id.slice(id.indexOf('-') + 1)) % 3 === 0;
const CIRCLE = { shape: 'circle' };
const CIRCLE_SIZE = { width: 56, height: 56 };
const config = {
  defaultNodeSize: { width: 160, height: 56 },
  nodeSize: (node) => (isCircle(node.id) ? CIRCLE_SIZE : undefined),
  nodeSep: 24,
  rankSep: 96,
};
const appearance = (id) => (isCircle(id) ? CIRCLE : undefined);

const record = { hovered: null, hovers: [], clicks: [], backgroundClicks: [], lastMoveAt: 0, errors: [] };
window.record = record;

function Expose() {
  const canvas = useDagrCanvas();
  useEffect(() => {
    const index = createNodeHitIndex(toSceneNodes(canvas.result, appearance));
    const ratio = window.devicePixelRatio;
    const { renderer } = canvas;
    const pickNode = renderer.pickNode.bind(renderer);
    record.picks = 0;
    renderer.pickNode = (pointer) => {
      record.picks += 1;
      return pickNode(pointer);
    };
    window.stage = {
      backend: canvas.renderer.backend,
      ids: [...canvas.result.nodes.keys()],
      zoom: () => renderer.camera.zoom,
      /** Screen positions of the given node ids' centres, in CSS pixels from the canvas's corner. */
      centres(ids) {
        return ids.map((id) => {
          const node = canvas.result.nodes.get(id);
          return canvas.renderer.camera.worldToScreen({ x: node.x, y: -node.y });
        });
      },
      /**
       * The node the shapes put under a CSS point, or `ambiguous` when the
       * corners of the device pixel under it disagree, since a pick answers for
       * that pixel and the CPU index for one point in it.
       */
      expected(css) {
        const px = Math.floor(css.x * ratio) / ratio;
        const py = Math.floor(css.y * ratio) / ratio;
        const step = 1 / ratio;
        const answers = new Set();
        for (const [dx, dy] of [[0, 0], [step, 0], [0, step], [step, step]]) {
          answers.add(index.hit(canvas.renderer.camera.screenToWorld({ x: px + dx, y: py + dy })));
        }
        return answers.size === 1 ? { id: [...answers][0], ambiguous: false } : { id: null, ambiguous: true };
      },
    };
    return () => {
      renderer.pickNode = pickNode;
    };
  }, [canvas]);
  return null;
}

const host = document.getElementById('stage');
host.addEventListener(
  'pointermove',
  () => {
    record.lastMoveAt = window.performance.now();
  },
  { capture: true },
);

createRoot(host).render(
  createElement(
    DagrCanvas,
    {
      graph,
      config,
      hitTesting: 'gpu',
      nodeAppearance: appearance,
      style: { width: '100%', height: '100%' },
      onNodeHover: (id) => {
        record.hovered = id;
        record.hovers.push({ id, at: window.performance.now(), afterMove: window.performance.now() - record.lastMoveAt });
      },
      onNodeClick: (id) => record.clicks.push(id),
      onBackgroundClick: () => record.backgroundClicks.push(window.performance.now()),
      onError: (error) => record.errors.push(String(error)),
    },
    createElement(Expose),
  ),
);
