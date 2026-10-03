import { describe, expect, it } from 'vitest';
import type { SceneNode } from '@prnt/dagr-render';
import { createNodeHitIndex } from '../src/node-hit.js';

function node(id: string, x: number, y: number, over: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    shape: 'roundedRect',
    center: { x, y },
    size: { width: 100, height: 60 },
    fillColor: 0,
    glowColor: 0,
    glowWorld: 0,
    ...over,
  };
}

describe('createNodeHitIndex', () => {
  it('hits inside a rectangle and misses outside it', () => {
    const index = createNodeHitIndex([node('a', 0, 0)]);
    expect(index.hit({ x: 49, y: 29 })).toBe('a');
    expect(index.hit({ x: 51, y: 0 })).toBeNull();
    expect(index.hit({ x: 0, y: -31 })).toBeNull();
  });

  it('respects a circle silhouette: the box corner is a miss, the rim is a hit', () => {
    const index = createNodeHitIndex([
      node('c', 0, 0, { shape: 'circle', size: { width: 100, height: 100 } }),
    ]);
    expect(index.hit({ x: 45, y: 0 })).toBe('c');
    expect(index.hit({ x: 40, y: 40 })).toBeNull();
    expect(index.hit({ x: 35, y: 35 })).toBe('c');
  });

  it('cuts rounded corners and clamps an oversized radius to half the short side', () => {
    const rounded = createNodeHitIndex([node('r', 0, 0, { cornerRadius: 20 })]);
    expect(rounded.hit({ x: 49, y: 29 })).toBeNull();
    expect(rounded.hit({ x: 40, y: 20 })).toBe('r');
    const pill = createNodeHitIndex([node('p', 0, 0, { cornerRadius: 1000 })]);
    expect(pill.hit({ x: 49, y: 29 })).toBeNull();
    expect(pill.hit({ x: 0, y: 0 })).toBe('p');
    expect(pill.hit({ x: 45, y: 0 })).toBe('p');
  });

  it('returns the later node where two overlap, and a circle over any rectangle', () => {
    const rects = createNodeHitIndex([node('under', 0, 0), node('over', 10, 0)]);
    expect(rects.hit({ x: 5, y: 0 })).toBe('over');
    const mixed = createNodeHitIndex([
      node('circle', 0, 0, { shape: 'circle', size: { width: 60, height: 60 } }),
      node('rect', 0, 0),
    ]);
    expect(mixed.hit({ x: 0, y: 0 })).toBe('circle');
  });

  it('finds nodes across cell boundaries and at negative coordinates', () => {
    const index = createNodeHitIndex([node('far', -1000, 2000), node('near', 0, 0)]);
    expect(index.hit({ x: -1040, y: 2020 })).toBe('far');
    expect(index.hit({ x: -1000, y: 2031 })).toBeNull();
  });

  it('ignores zero-size nodes and non-finite points, and handles an empty scene', () => {
    expect(createNodeHitIndex([]).hit({ x: 0, y: 0 })).toBeNull();
    const index = createNodeHitIndex([node('z', 0, 0, { size: { width: 0, height: 0 } })]);
    expect(index.size).toBe(0);
    expect(createNodeHitIndex([node('a', 0, 0)]).hit({ x: Number.NaN, y: 0 })).toBeNull();
  });

  it('stays fast enough on 10,000 nodes for a per-pointer-move query', () => {
    const nodes = Array.from({ length: 10_000 }, (_, i) => node(`n${String(i)}`, (i % 100) * 120, Math.floor(i / 100) * 80));
    const index = createNodeHitIndex(nodes);
    expect(index.hit({ x: 5 * 120, y: 7 * 80 })).toBe('n705');
    expect(index.hit({ x: 5 * 120 + 60, y: 7 * 80 })).toBeNull();
  });

  it('with a tolerance, picks the nearest centre when no silhouette is hit, and exact hits still win', () => {
    const tiny = (id: string, x: number): SceneNode =>
      node(id, x, 0, { shape: 'circle', size: { width: 2, height: 2 } });
    const index = createNodeHitIndex([tiny('a', 0), tiny('b', 10)]);
    expect(index.hit({ x: 4, y: 0 })).toBeNull();
    expect(index.hit({ x: 4, y: 0 }, 5)).toBe('a');
    expect(index.hit({ x: 6.5, y: 0 }, 5)).toBe('b');
    expect(index.hit({ x: 4, y: 0 }, 3)).toBeNull();
    expect(index.hit({ x: 0.5, y: 0 }, 5)).toBe('a');
    expect(index.hit({ x: 0, y: 40 }, 5)).toBeNull();
  });

  it('sizes the grid from the typical node so one huge node does not make every cell a crowd', () => {
    const small = Array.from({ length: 400 }, (_, i) =>
      node(`s${String(i)}`, (i % 20) * 30, Math.floor(i / 20) * 30, { size: { width: 10, height: 10 } }),
    );
    const huge = node('huge', 5000, 5000, { size: { width: 4000, height: 4000 } });
    const index = createNodeHitIndex([...small, huge]);
    expect(index.hit({ x: 30, y: 30 })).toBe('s21');
    expect(index.hit({ x: 4000, y: 4000 })).toBe('huge');
    expect(index.hit({ x: 7500, y: 5000 })).toBeNull();
  });
});
