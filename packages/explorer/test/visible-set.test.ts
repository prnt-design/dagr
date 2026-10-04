import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import {
  computeVisibleSet,
  indexLayout,
  nearestToCenter,
  nodeAtPoint,
  sameVisibleSet,
} from '../src/visible-set.js';
import type { ExplorerVisibleSet } from '../src/visible-set.js';

/**
 * a -> b -> c with default sizes, plus a self loop on a. Boxes are 240 by 120
 * at x 40, 400 and 760, all at y 40. The plane is 1040 by 200.
 */
const chain = layoutView({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'aa', source: 'a', target: 'a' },
  ],
});
const index = indexLayout(chain);
const viewport = { width: 800, height: 480 };
/** The whole plane in view, a node 166 wide on screen. */
const fit = { x: 40, y: 170.76923076923077, scale: 0.6923076923076924 };
const one = { x: 0, y: 0, scale: 1 };

const show = (set: ExplorerVisibleSet) => ({
  overlay: [...set.overlay],
  base: set.baseNodes,
  edges: set.edges,
});

describe('indexLayout', () => {
  it('lists nodes and edges in data order, with each route bounded', () => {
    expect(index.nodeIds).toEqual(['a', 'b', 'c']);
    expect(index.edgeIds).toEqual(['ab', 'bc', 'aa']);
    expect(index.edgeBounds[0]).toEqual({ x: 280, y: 100, width: 120, height: 0 });
  });

  it('gives an edge with no route no bounds', () => {
    expect(index.edgeBounds[2]).toBeNull();
  });
});

describe('computeVisibleSet, tiers', () => {
  it('shows a node as rich at 200 on screen and over', () => {
    expect(show(computeVisibleSet(index, one, viewport))).toEqual({
      overlay: [
        ['a', 'rich'],
        ['b', 'rich'],
        ['c', 'rich'],
      ],
      base: [],
      edges: ['ab', 'bc'],
    });
  });

  it('shows a node as summary from 56 up to 200', () => {
    expect([...computeVisibleSet(index, fit, viewport).overlay.values()]).toEqual([
      'summary',
      'summary',
      'summary',
    ]);
  });

  it('leaves a node under 56 to the base layer, with no overlay element', () => {
    // 240 * 0.2 is 48.
    expect(show(computeVisibleSet(index, { x: 0, y: 0, scale: 0.2 }, viewport))).toEqual({
      overlay: [],
      base: ['a', 'b', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('has half-open gates: exactly at a gate is the higher tier', () => {
    const exact = { tiers: { summary: 240, rich: 241 } };
    expect([...computeVisibleSet(index, one, viewport, exact).overlay.values()][0]).toBe('summary');
    const rich = { tiers: { summary: 100, rich: 240 } };
    expect([...computeVisibleSet(index, one, viewport, rich).overlay.values()][0]).toBe('rich');
  });
});

describe('computeVisibleSet, culling', () => {
  it('drops nodes and edges outside the viewport and its overscan', () => {
    // At scale 3 the viewport shows 267 world units, plus a quarter each side.
    expect(show(computeVisibleSet(index, { x: 0, y: 0, scale: 3 }, viewport))).toEqual({
      overlay: [['a', 'rich']],
      base: [],
      edges: ['ab'],
    });
  });

  it('is empty when the camera is nowhere near the content', () => {
    expect(show(computeVisibleSet(index, { x: -5000, y: 0, scale: 1 }, viewport))).toEqual({
      overlay: [],
      base: [],
      edges: [],
    });
  });

  it('never lists a self loop, which has no route', () => {
    expect(computeVisibleSet(index, one, viewport).edges).not.toContain('aa');
  });

  it('does not change for a pan inside the overscan margin', () => {
    const before = computeVisibleSet(index, fit, viewport);
    const after = computeVisibleSet(index, { ...fit, x: fit.x + 10 }, viewport);
    expect(sameVisibleSet(before, after)).toBe(true);
  });
});

describe('computeVisibleSet, the cap', () => {
  it('keeps the nodes nearest the viewport center and leaves the rest as marks', () => {
    expect(show(computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 1 }))).toEqual({
      overlay: [['b', 'summary']],
      base: ['a', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('breaks a tie in distance by id', () => {
    // a and c are equally far from the center. With room for two, b and a.
    const set = computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 2 });
    expect([...set.overlay.keys()]).toEqual(['a', 'b']);
  });

  it('treats a cap of zero as no overlay at all', () => {
    expect(computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 0 }).overlay.size).toBe(0);
  });
});

describe('computeVisibleSet, pins', () => {
  it('mounts a pinned node that is too small to read, as summary', () => {
    const tiny = { x: 0, y: 0, scale: 0.2 };
    expect(show(computeVisibleSet(index, tiny, viewport, { pinned: ['b'] }))).toEqual({
      overlay: [['b', 'summary']],
      base: ['a', 'c'],
      edges: ['ab', 'bc'],
    });
  });

  it('mounts a pinned node that is off screen, at the tier its size earns', () => {
    const far = { x: -5000, y: 0, scale: 1 };
    expect(show(computeVisibleSet(index, far, viewport, { pinned: ['c'] }))).toEqual({
      overlay: [['c', 'rich']],
      base: [],
      edges: [],
    });
  });

  it('does not count a pinned node against the cap', () => {
    const set = computeVisibleSet(index, fit, viewport, { maxOverlayNodes: 1, pinned: ['a'] });
    expect([...set.overlay.keys()]).toEqual(['a', 'b']);
    expect(set.baseNodes).toEqual(['c']);
  });

  it('ignores a pinned id the layout does not have', () => {
    expect(computeVisibleSet(index, fit, viewport, { pinned: ['ghost'] }).overlay.has('ghost')).toBe(
      false,
    );
  });
});

describe('sameVisibleSet', () => {
  it('compares membership, tier and order, not identity', () => {
    const a = computeVisibleSet(index, fit, viewport);
    expect(sameVisibleSet(a, a)).toBe(true);
    expect(sameVisibleSet(a, computeVisibleSet(index, fit, viewport))).toBe(true);
    expect(sameVisibleSet(a, computeVisibleSet(index, one, viewport))).toBe(false);
    expect(sameVisibleSet(a, computeVisibleSet(index, { x: 0, y: 0, scale: 0.2 }, viewport))).toBe(
      false,
    );
  });
});

describe('nearestToCenter', () => {
  it('names the node whose center is nearest the middle of the viewport', () => {
    expect(nearestToCenter(index, fit, viewport)).toBe('b');
    expect(nearestToCenter(index, { x: 0, y: 0, scale: 3 }, viewport)).toBe('a');
  });

  it('has nothing to name in an empty layout', () => {
    const empty = indexLayout(layoutView({ id: 'v', label: 'View', nodes: [], edges: [] }));
    expect(nearestToCenter(empty, one, viewport)).toBeNull();
  });
});

describe('nodeAtPoint', () => {
  it('finds the node under a world point, edges of the box included', () => {
    expect(nodeAtPoint(index, { x: 50, y: 50 })).toBe('a');
    expect(nodeAtPoint(index, { x: 280, y: 160 })).toBe('a');
  });

  it('finds nothing between nodes', () => {
    expect(nodeAtPoint(index, { x: 300, y: 100 })).toBeNull();
  });
});
