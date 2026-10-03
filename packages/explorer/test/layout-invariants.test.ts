import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import type { ExplorerBox, ExplorerEdge, ExplorerNode, ExplorerView, Vec2 } from '../src/index.js';

/**
 * Properties that must hold for ANY view, checked on generated graphs.
 *
 * The other layout tests pin exact coordinates on two or three nodes. Those
 * catch a changed constant. They cannot catch a transpose applied to boxes and
 * not to routes on a graph with a fan in it, or a separation that pushes a
 * route out of the plane. These can.
 *
 * The generator is seeded, so a failure names a seed and reproduces.
 */

/** A small seeded generator (mulberry32). Deterministic across platforms. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES = [
  { width: 240, height: 120 },
  { width: 160, height: 80 },
  { width: 320, height: 200 },
];

/** A graph with forward edges, parallel pairs short and long, cycles and a self loop. */
function generate(seed: number): { nodes: ExplorerNode[]; edges: ExplorerEdge[] } {
  const next = random(seed);
  const count = 5 + Math.floor(next() * 8);
  const nodes: ExplorerNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = SIZES[Math.floor(next() * SIZES.length)];
    nodes.push({ id: `n${String(i)}`, label: `N${String(i)}`, ...(size ? { size } : {}) });
  }
  const edges: ExplorerEdge[] = [];
  const add = (source: number, target: number): void => {
    edges.push({ id: `e${String(edges.length)}`, source: `n${String(source)}`, target: `n${String(target)}` });
  };
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (next() < 0.25) {
        add(i, j);
        // A parallel twin. Whether it spans one rank or several is up to the
        // ranker, so both kinds turn up across seeds.
        if (next() < 0.35) add(i, j);
        // An edge back the other way, which makes a cycle.
        if (next() < 0.2) add(j, i);
      }
    }
  }
  if (next() < 0.5) add(0, 0);
  return { nodes, edges };
}

const EPSILON = 1e-6;

function inside(point: Vec2, box: ExplorerBox): boolean {
  return (
    point.x >= box.x - EPSILON &&
    point.x <= box.x + box.width + EPSILON &&
    point.y >= box.y - EPSILON &&
    point.y <= box.y + box.height + EPSILON
  );
}

function overlap(a: ExplorerBox, b: ExplorerBox): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    a.x + a.width > b.x + EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    a.y + a.height > b.y + EPSILON
  );
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
const DIRECTIONS = ['right', 'down'] as const;
const STYLES = ['smooth', 'orthogonal'] as const;

describe('layoutView, invariants on generated graphs', () => {
  for (const direction of DIRECTIONS) {
    for (const edgeStyle of STYLES) {
      it.each(SEEDS)(`holds flowing ${direction}, ${edgeStyle}, seed %i`, (seed) => {
        const { nodes, edges } = generate(seed);
        const view: ExplorerView = {
          id: 'v',
          label: 'View',
          nodes,
          edges,
          layout: { direction, edgeStyle },
        };
        const laid = layoutView(view);

        // Every node has a box and every edge a route.
        expect([...laid.boxes.keys()]).toEqual(nodes.map((node) => node.id));
        expect([...laid.routes.keys()]).toEqual(edges.map((edge) => edge.id));

        // No two boxes overlap.
        const boxes = [...laid.boxes.entries()];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const [idA, a] = boxes[i] as [string, ExplorerBox];
            const [idB, b] = boxes[j] as [string, ExplorerBox];
            expect(overlap(a, b), `${idA} overlaps ${idB}`).toBe(false);
          }
        }

        // Everything lies inside the plane the layout reports.
        const plane: ExplorerBox = { x: 0, y: 0, width: laid.width, height: laid.height };
        for (const [id, box] of boxes) {
          expect(inside({ x: box.x, y: box.y }, plane), `box ${id} top-left`).toBe(true);
          expect(
            inside({ x: box.x + box.width, y: box.y + box.height }, plane),
            `box ${id} bottom-right`,
          ).toBe(true);
        }

        for (const edge of edges) {
          const points = laid.routes.get(edge.id) ?? [];
          if (edge.source === edge.target) {
            expect(points, `self loop ${edge.id}`).toEqual([]);
            continue;
          }
          expect(points.length, `route ${edge.id}`).toBeGreaterThanOrEqual(2);
          const first = points[0] as Vec2;
          const last = points[points.length - 1] as Vec2;
          const source = laid.boxes.get(edge.source) as ExplorerBox;
          const target = laid.boxes.get(edge.target) as ExplorerBox;

          // A route starts on its own source and ends on its own target, even
          // when a cycle made the engine reverse the edge internally.
          expect(inside(first, source), `route ${edge.id} starts on ${edge.source}`).toBe(true);
          expect(inside(last, target), `route ${edge.id} ends on ${edge.target}`).toBe(true);

          // A route never doubles back along the flow.
          const along = (p: Vec2): number => (direction === 'right' ? p.x : p.y);
          let sign = 0;
          for (let i = 1; i < points.length; i += 1) {
            const step = along(points[i] as Vec2) - along(points[i - 1] as Vec2);
            if (Math.abs(step) <= EPSILON) continue;
            const current = Math.sign(step);
            if (sign === 0) sign = current;
            expect(current, `route ${edge.id} doubles back at point ${String(i)}`).toBe(sign);
          }

          for (const point of points) {
            expect(inside(point, plane), `route ${edge.id} leaves the plane`).toBe(true);
          }
        }
      });
    }
  }
});
