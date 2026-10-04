import { describe, expect, it } from 'vitest';
import type { ExplorerBox, ExplorerLayout } from '../src/layout.js';
import { nearestInDirection } from '../src/navigation.js';
import { computeVisibleSet, indexLayout } from '../src/visible-set.js';
import type { LayoutIndex } from '../src/visible-set.js';

/** A layout of 40 by 20 boxes centered on the given points, laid out by hand. */
function at(centers: Record<string, readonly [number, number]>): LayoutIndex {
  const boxes = new Map<string, ExplorerBox>();
  for (const [id, [x, y]] of Object.entries(centers)) {
    boxes.set(id, { x: x - 20, y: y - 10, width: 40, height: 20 });
  }
  const layout: ExplorerLayout = { boxes, routes: new Map(), groups: new Map(), width: 2000, height: 2000 };
  return indexLayout(layout);
}

/**
 * A 3 by 3 grid, 100 apart, named by row and column:
 *
 *     nw  n  ne
 *     w   m  e
 *     sw  s  se
 */
const grid = at({
  nw: [100, 100],
  n: [200, 100],
  ne: [300, 100],
  w: [100, 200],
  m: [200, 200],
  e: [300, 200],
  sw: [100, 300],
  s: [200, 300],
  se: [300, 300],
});

describe('nearestInDirection', () => {
  it('moves to the straight neighbor in each of the four directions, in a y-down world', () => {
    expect(nearestInDirection(grid, 'm', 'up')).toBe('n');
    expect(nearestInDirection(grid, 'm', 'down')).toBe('s');
    expect(nearestInDirection(grid, 'm', 'left')).toBe('w');
    expect(nearestInDirection(grid, 'm', 'right')).toBe('e');
    expect(nearestInDirection(grid, 'nw', 'right')).toBe('n');
    expect(nearestInDirection(grid, 'se', 'up')).toBe('e');
  });

  it('excludes nodes level with the focused one: the half-plane is strict', () => {
    // Only `b` is beside `a`, level with it on the vertical axis and very near.
    const level = at({ a: [100, 100], b: [110, 100], c: [100, 400] });
    expect(nearestInDirection(level, 'a', 'up')).toBeNull();
    expect(nearestInDirection(level, 'a', 'down')).toBe('c');
    // And the other axis: `c` is directly below, so neither left nor right of `a`.
    expect(nearestInDirection(at({ a: [100, 100], c: [100, 110] }), 'a', 'right')).toBeNull();
  });

  it('weighs distance across the axis twice, so a straight neighbor beats a nearer diagonal one', () => {
    // `diagonal` is about 67 away and `straight` 100, but across the axis
    // `diagonal` scores 60 + 2 * 30 = 120 against 100.
    const index = at({ from: [100, 100], straight: [200, 100], diagonal: [160, 130] });
    expect(nearestInDirection(index, 'from', 'right')).toBe('straight');
  });

  it('breaks a tie by id', () => {
    const index = at({ from: [100, 100], zeta: [200, 150], beta: [200, 50] });
    expect(nearestInDirection(index, 'from', 'right')).toBe('beta');
    const reversed = at({ from: [100, 100], beta: [200, 50], zeta: [200, 150] });
    expect(nearestInDirection(reversed, 'from', 'right')).toBe('beta');
  });

  it('returns null with no candidate, and for an id the index does not have', () => {
    expect(nearestInDirection(grid, 'nw', 'up')).toBeNull();
    expect(nearestInDirection(grid, 'nw', 'left')).toBeNull();
    expect(nearestInDirection(grid, 'se', 'down')).toBeNull();
    expect(nearestInDirection(grid, 'se', 'right')).toBeNull();
    expect(nearestInDirection(at({ only: [0, 0] }), 'only', 'right')).toBeNull();
    expect(nearestInDirection(grid, 'nowhere', 'right')).toBeNull();
  });

  it('finds a node that is not mounted: it scans the layout, not the visible set', () => {
    const index = at({ here: [100, 100], far: [1900, 100] });
    // The premise: a camera on `here` leaves `far` out of the visible set.
    const visible = computeVisibleSet(index, { x: 0, y: 0, scale: 2 }, { width: 400, height: 300 });
    expect(visible.overlay.has('far')).toBe(false);
    expect(visible.baseNodes).not.toContain('far');
    expect(nearestInDirection(index, 'here', 'right')).toBe('far');
  });
});
