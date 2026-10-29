import { describe, expect, it } from 'vitest';
import { createEdgeHitIndex } from '../src/edge-hit.js';

type Point = { x: number; y: number };
type Edge = { id: string; points: Point[] };

function edge(id: string, ...coords: number[]): Edge {
  const points: Point[] = [];
  for (let k = 0; k + 1 < coords.length; k += 2) points.push({ x: coords[k] ?? 0, y: coords[k + 1] ?? 0 });
  return { id, points };
}

function segmentDistanceSquared(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0), 1) : 0;
  const ex = p.x - a.x - t * dx;
  const ey = p.y - a.y - t * dy;
  return ex * ex + ey * ey;
}

function scan(edges: readonly Edge[], p: Point, tolerance: number): string | null {
  let best: string | null = null;
  let bestDistance = tolerance * tolerance;
  for (const e of edges) {
    for (let k = 1; k < e.points.length; k++) {
      const d = segmentDistanceSquared(e.points[k - 1] as Point, e.points[k] as Point, p);
      if (d <= bestDistance) {
        bestDistance = d;
        best = e.id;
      }
    }
  }
  return best;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('createEdgeHitIndex', () => {
  it('hits within the tolerance of a centreline and misses beyond it', () => {
    const index = createEdgeHitIndex([edge('a', 0, 0, 100, 0)]);
    expect(index.hit({ x: 50, y: 3 }, 4)).toBe('a');
    expect(index.hit({ x: 50, y: 5 }, 4)).toBeNull();
    expect(index.hit({ x: 103, y: 0 }, 4)).toBe('a');
    expect(index.hit({ x: 105, y: 0 }, 4)).toBeNull();
  });

  it('follows every segment of a bent route', () => {
    const index = createEdgeHitIndex([edge('bent', 0, 0, 0, 100, 100, 100)]);
    expect(index.hit({ x: 2, y: 50 }, 3)).toBe('bent');
    expect(index.hit({ x: 50, y: 98 }, 3)).toBe('bent');
    expect(index.hit({ x: 50, y: 50 }, 3)).toBeNull();
  });

  it('gives a crossing or a fan to the nearer centreline, and an exact tie to the later edge', () => {
    const fan = createEdgeHitIndex([edge('upper', 0, 10, 100, 10), edge('lower', 0, 0, 100, 0)]);
    expect(fan.hit({ x: 50, y: 7 }, 6)).toBe('upper');
    expect(fan.hit({ x: 50, y: 3 }, 6)).toBe('lower');
    expect(fan.hit({ x: 50, y: 5 }, 6)).toBe('lower');
    const reversed = createEdgeHitIndex([edge('lower', 0, 0, 100, 0), edge('upper', 0, 10, 100, 10)]);
    expect(reversed.hit({ x: 50, y: 5 }, 6)).toBe('upper');
    const apart = createEdgeHitIndex([
      edge('left', -1000, -1000, -1000, 1000),
      edge('right', 1000, -1000, 1000, 1000),
      ...Array.from({ length: 400 }, (_, i) => edge(`short${String(i)}`, i * 3, 5000, i * 3 + 1, 5000)),
    ]);
    expect(apart.hit({ x: 0, y: 0 }, 1000)).toBe('right');
  });

  it('answers for the routes it was built from: a rebuilt index misses a removed edge and hits a rerouted one', () => {
    const before = createEdgeHitIndex([edge('kept', 0, 0, 100, 0), edge('moved', 0, 50, 100, 50)]);
    expect(before.hit({ x: 50, y: 50 }, 2)).toBe('moved');
    const after = createEdgeHitIndex([edge('moved', 0, 200, 100, 200)]);
    expect(after.hit({ x: 50, y: 0 }, 2)).toBeNull();
    expect(after.hit({ x: 50, y: 50 }, 2)).toBeNull();
    expect(after.hit({ x: 50, y: 200 }, 2)).toBe('moved');
  });

  it('misses with no tolerance, a non-finite point or tolerance, and on an empty scene', () => {
    const index = createEdgeHitIndex([edge('a', 0, 0, 100, 0)]);
    expect(index.hit({ x: 50, y: 0 }, 0)).toBeNull();
    expect(index.hit({ x: 50, y: 0 }, -1)).toBeNull();
    expect(index.hit({ x: 50, y: 0 }, Number.NaN)).toBeNull();
    expect(index.hit({ x: 50, y: 0 }, Number.POSITIVE_INFINITY)).toBeNull();
    expect(index.hit({ x: Number.NaN, y: 0 }, 4)).toBeNull();
    expect(createEdgeHitIndex([]).hit({ x: 0, y: 0 }, 4)).toBeNull();
  });

  it('skips edges with fewer than two points and segments with a non-finite end', () => {
    const index = createEdgeHitIndex([
      edge('lone', 0, 0),
      edge('broken', 0, 0, Number.NaN, 0, 100, 100),
      edge('whole', 0, 300, 100, 300),
    ]);
    expect(index.size).toBe(1);
    expect(index.hit({ x: 0, y: 0 }, 4)).toBeNull();
    expect(index.hit({ x: 50, y: 300 }, 4)).toBe('whole');
  });

  it('treats a zero-length segment as a point', () => {
    const index = createEdgeHitIndex([edge('dot', 10, 10, 10, 10)]);
    expect(index.hit({ x: 12, y: 10 }, 3)).toBe('dot');
    expect(index.hit({ x: 14, y: 10 }, 3)).toBeNull();
  });

  it('agrees with a linear scan over random routes and points, through the grid and the scan fallback', () => {
    const next = random(7);
    const edges: Edge[] = Array.from({ length: 1500 }, (_, i) => {
      const coords: number[] = [];
      let x = next() * 4000 - 2000;
      let y = next() * 4000 - 2000;
      const count = 2 + Math.floor(next() * 4);
      for (let k = 0; k < count; k++) {
        coords.push(x, y);
        const long = next() < 0.05;
        x += (next() - 0.5) * (long ? 3000 : 200);
        y += (next() - 0.5) * (long ? 3000 : 200);
      }
      return edge(`e${String(i)}`, ...coords);
    });
    const index = createEdgeHitIndex(edges);
    for (const [tolerance, fewestHits] of [[4, 300], [40, 1500], [5000, 2000]] as const) {
      let hits = 0;
      for (let q = 0; q < 2000; q++) {
        const p = { x: next() * 4000 - 2000, y: next() * 4000 - 2000 };
        const expected = scan(edges, p, tolerance);
        expect(index.hit(p, tolerance)).toBe(expected);
        if (expected !== null) hits++;
      }
      expect(hits).toBeGreaterThanOrEqual(fewestHits);
    }
  });

  it('finds edges on a 10,000-node scene for a per-pointer-move query', () => {
    const edges: Edge[] = [];
    for (let i = 0; i < 10_000; i++) {
      const x = (i % 100) * 120;
      const y = Math.floor(i / 100) * 80;
      if (i % 100 !== 99) edges.push(edge(`r${String(i)}`, x, y, x + 120, y));
      if (i < 9_900) edges.push(edge(`d${String(i)}`, x, y, x, y + 80));
    }
    const index = createEdgeHitIndex(edges);
    expect(index.size).toBe(edges.length);
    expect(index.hit({ x: 5 * 120 + 60, y: 7 * 80 + 1 }, 2)).toBe('r705');
    expect(index.hit({ x: 5 * 120 + 1, y: 7 * 80 + 40 }, 2)).toBe('d705');
    expect(index.hit({ x: 5 * 120 + 60, y: 7 * 80 + 40 }, 2)).toBeNull();
  });
});
