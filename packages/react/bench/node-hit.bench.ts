import { bench, describe } from 'vitest';

import { registerControl } from '@dagr/bench';
import type { SceneNode } from '@prnt/dagr-render';
import { createNodeHitIndex } from '../src/node-hit.js';

registerControl();

/** A grid of mixed circles and rounded rectangles, the way a laid-out graph tiles. */
function scene(count: number): SceneNode[] {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => {
    const circle = index % 3 === 0;
    return {
      id: `node-${String(index)}`,
      shape: circle ? 'circle' : 'roundedRect',
      center: { x: (index % columns) * 120, y: Math.floor(index / columns) * 90 },
      size: circle ? { width: 60, height: 60 } : { width: 100, height: 60 },
      cornerRadius: 12,
      fillColor: 0,
      glowColor: 0,
      glowWorld: 0,
    } satisfies SceneNode;
  });
}

function query(count: number): () => void {
  const nodes = scene(count);
  const index = createNodeHitIndex(nodes);
  const columns = Math.ceil(Math.sqrt(count));
  const last = nodes[count - 1]!;
  // A hit on the last node, a corner miss on a circle's box, and open space.
  const points = [
    { x: last.center.x, y: last.center.y },
    { x: 0 + 28, y: 0 + 28 },
    { x: columns * 120 + 500, y: -500 },
    { x: 120, y: 0 },
  ] as const;
  let sample = 0;
  return () => {
    index.hit(points[sample]!);
    sample = (sample + 1) % points.length;
  };
}

describe('CPU shape-aware node hit (M5.2b)', () => {
  bench('100 nodes', query(100));
  bench('1k nodes', query(1_000));
  bench('10k nodes', query(10_000));
});

describe('node hit index build', () => {
  const nodes = scene(10_000);
  bench('10k nodes', () => {
    createNodeHitIndex(nodes);
  });
});
