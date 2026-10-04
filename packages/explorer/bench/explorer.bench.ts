import { largeCorpus, registerControl, smallCorpus } from '@dagr/bench';
import type { GraphSpec } from '@dagr/bench';
import { bench, describe } from 'vitest';

import { createCameraLimits, fitCamera } from '../src/camera.js';
import type { ExplorerCamera, ExplorerViewportSize } from '../src/camera.js';
import { layoutView } from '../src/layout.js';
import type { ExplorerLayout } from '../src/layout.js';
import type { ExplorerView } from '../src/types.js';
import { computeVisibleSet, indexLayout } from '../src/visible-set.js';
import type { ExplorerVisibleSet, LayoutIndex } from '../src/visible-set.js';

/**
 * `@prnt/dagr-explorer`'s two costs that grow with the graph: the visible
 * set, computed on a camera frame that can change it, and the layout,
 * computed once per view shape.
 *
 * The visible set is a linear scan over every node box and every edge's
 * bounds, on purpose: the spec names this bench as the measurement that
 * would ask for a spatial index instead. Two cameras. At fit every node is a
 * mark and the whole graph is in view, so no node is a candidate but every
 * node and edge lands in the base set: the scan plus the largest output.
 * Zoomed in, to the zoom where a default node is rich, most boxes miss the
 * view and a screenful near the center are candidates, under the cap, so
 * nothing is sorted: the frame a user reading the graph pays.
 *
 * One call is well under a millisecond at 1,000 nodes, so each iteration
 * sweeps a pan of SWEEP cameras across the graph, the frames a drag would
 * produce. That keeps one iteration in the milliseconds the harness wants,
 * and every call does real work: each camera is a different place.
 *
 * The corpora are the bench kit's, so these graphs are the ones the layout
 * package's own pipeline bench lays out.
 */

registerControl();

const HEAVY = { time: 3_000 };
const SWEEP = 16;
const VIEWPORT: ExplorerViewportSize = { width: 1280, height: 800 };

function viewOf(spec: GraphSpec): ExplorerView {
  return {
    id: spec.name,
    label: spec.name,
    nodes: spec.nodes.map((id) => ({ id, label: id })),
    edges: spec.edges.map(([source, target], i) => ({ id: `e${String(i)}`, source, target })),
  };
}

/** SWEEP cameras at `scale`, panning left to right along the middle of the layout. */
function sweep(layout: ExplorerLayout, scale: number): readonly ExplorerCamera[] {
  return Array.from({ length: SWEEP }, (_, i) => {
    const worldX = (layout.width * (i + 0.5)) / SWEEP;
    const worldY = layout.height / 2;
    return { x: VIEWPORT.width / 2 - worldX * scale, y: VIEWPORT.height / 2 - worldY * scale, scale };
  });
}

function fitSweep(layout: ExplorerLayout): readonly ExplorerCamera[] {
  const limits = createCameraLimits(layout, VIEWPORT);
  if (limits === null) throw new Error('the bench layout has no size');
  const fit = fitCamera(layout, VIEWPORT, limits);
  // Fit is one place, so the sweep nudges it a pixel at a time: the same
  // frame a user at fit would produce, never a repeated identical call.
  return Array.from({ length: SWEEP }, (_, i) => ({ ...fit, x: fit.x + i }));
}

let sink: ExplorerVisibleSet | undefined;
function scan(index: LayoutIndex, cameras: readonly ExplorerCamera[]): () => void {
  return () => {
    for (const camera of cameras) sink = computeVisibleSet(index, camera, VIEWPORT);
  };
}

const smallView = viewOf(smallCorpus());
const smallLayout = layoutView(smallView);
const largeLayout = layoutView(viewOf(largeCorpus()));
const smallIndex = indexLayout(smallLayout);
const largeIndex = indexLayout(largeLayout);

describe(`visible set, ${String(SWEEP)} cameras`, () => {
  bench('1k nodes, fit', scan(smallIndex, fitSweep(smallLayout)));
  bench('1k nodes, zoomed in', scan(smallIndex, sweep(smallLayout, 1)));
  bench('10k nodes, fit', scan(largeIndex, fitSweep(largeLayout)));
  bench('10k nodes, zoomed in', scan(largeIndex, sweep(largeLayout, 1)));
});

let layoutSink: ExplorerLayout | undefined;
describe('layoutView', () => {
  bench(
    '1k nodes, 4k edges',
    () => {
      layoutSink = layoutView(smallView);
    },
    HEAVY,
  );
});

// Read the sinks once, so neither loop's result is provably dead.
export const sinks = (): readonly unknown[] => [sink, layoutSink];
