import { bench, describe } from 'vitest';

import { registerControl } from '@dagr/bench';
import { createGraphInteraction } from '../src/interaction.js';
import type { GraphHitProvider, GraphPointer } from '../src/interaction.js';

registerControl();

interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function pointerQuery(nodeCount: number): () => void {
  const boxes: Box[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${String(index)}`,
    x: index * 20,
    y: (index % 7) * 20,
    width: 10,
    height: 10,
  }));
  const provider: GraphHitProvider<number> = (query) => {
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index]!;
      if (
        query.world.x >= box.x &&
        query.world.x <= box.x + box.width &&
        query.world.y >= box.y &&
        query.world.y <= box.y + box.height
      ) {
        return {
          target: { kind: 'node', nodeId: box.id },
          displayedRevision: query.displayedRevision,
        };
      }
    }
    return { target: null, displayedRevision: query.displayedRevision };
  };
  const machine = createGraphInteraction({
    hitTarget: provider,
    onSelectionChange: () => undefined,
    onPanBy: () => undefined,
  });
  const points = [
    { x: 1, y: 1 },
    { x: 3, y: 4 },
    { x: 6, y: 2 },
    { x: 9, y: 8 },
  ] as const;
  let sample = 0;
  let pointerId = 0;

  return () => {
    const point = points[sample]!;
    sample = (sample + 1) % points.length;
    pointerId += 1;
    const pointer: GraphPointer = {
      pointerId,
      button: 0,
      isPrimary: true,
      css: point,
      world: point,
      devicePixelRatio: 2,
    };
    machine.pointerDown(pointer, 1);
    machine.pointerCancel(pointerId);
  };
}

describe('CPU rectangle pointer query', () => {
  bench('100 nodes', pointerQuery(100));
  bench('1k nodes', pointerQuery(1_000));
  bench('10k nodes', pointerQuery(10_000));
});
