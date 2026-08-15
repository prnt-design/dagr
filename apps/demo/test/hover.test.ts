import { describe, expect, it } from 'vitest';
import { nodeAtPoint } from '../src/hover.js';
import type { HoverTarget } from '../src/hover.js';

/**
 * Hover, answered from the same boxes the overlay is positioned from.
 *
 * Pure arithmetic, so it is tested as arithmetic: what is inside, what is on an
 * edge, what happens when boxes overlap, and what happens when nothing is
 * under the pointer at all. World y is UP here, as everywhere the demo talks
 * about world space.
 */

const box = (id: string, minX: number, minY: number, maxX: number, maxY: number): HoverTarget => ({
  id,
  bounds: { minX, minY, maxX, maxY },
});

const NODES: readonly HoverTarget[] = [
  box('left', 0, 0, 100, 40),
  box('right', 200, 0, 260, 24),
  box('above', 0, 100, 100, 140),
];

describe('nodeAtPoint', () => {
  it('finds the node whose box holds the point', () => {
    expect(nodeAtPoint({ x: 50, y: 20 }, NODES)).toBe('left');
    expect(nodeAtPoint({ x: 230, y: 12 }, NODES)).toBe('right');
  });

  it('answers null where no node is', () => {
    // The gaps between tiles are most of the campaign's area, so this is the
    // common case rather than the edge one.
    expect(nodeAtPoint({ x: 150, y: 20 }, NODES)).toBeNull();
    expect(nodeAtPoint({ x: 50, y: 70 }, NODES)).toBeNull();
  });

  it('counts the edges as inside', () => {
    // A box's edge is a pixel a reader can be on, and excluding it would make
    // the highlight flicker along every boundary.
    expect(nodeAtPoint({ x: 0, y: 0 }, NODES)).toBe('left');
    expect(nodeAtPoint({ x: 100, y: 40 }, NODES)).toBe('left');
  });

  it('reads world y as up', () => {
    // `above` sits at y 100 to 140, which is ABOVE `left` in world terms. A
    // sign error here would put the highlight on the wrong node in the half of
    // the scene below the origin, which is the half a screenshot rarely shows.
    expect(nodeAtPoint({ x: 50, y: 120 }, NODES)).toBe('above');
    expect(nodeAtPoint({ x: 50, y: -20 }, NODES)).toBeNull();
  });

  it('takes the smallest box when two contain the point', () => {
    // Not "the first in the array": order is a fact about how the scene was
    // built, and the answer should not depend on it.
    const nested: readonly HoverTarget[] = [
      box('hall', 0, 0, 400, 200),
      box('room', 100, 50, 140, 70),
    ];
    expect(nodeAtPoint({ x: 120, y: 60 }, nested)).toBe('room');
    expect(nodeAtPoint({ x: 120, y: 60 }, [...nested].reverse())).toBe('room');
    // Still the hall where only the hall is.
    expect(nodeAtPoint({ x: 300, y: 60 }, nested)).toBe('hall');
  });

  it('answers null for an empty scene rather than throwing', () => {
    expect(nodeAtPoint({ x: 0, y: 0 }, [])).toBeNull();
  });
});
