import type { SceneEdge } from '@prnt/dagr-render';

/**
 * CPU hit testing against the edge centrelines the renderer was last handed.
 *
 * **What it tests.** Each edge is the polyline of its `points`, exactly as
 * `setEdges` received them, so pass the points after any `shapeEdgePath`, and
 * a mid-animation frame's points while edges glide. That is the drawn
 * geometry for a group whose `curve` is `'polyline'`, which is the group
 * `DagrCanvas` declares; a `'smooth'` group is drawn through the points and
 * this index would test the chords instead. Dashes are not gaps here: a point
 * between two dashes is on the edge.
 *
 * **Tolerance is the edge's width.** A centreline has no area, so a query
 * hits only within `toleranceWorld` of it. Pass half the drawn width plus the
 * slop a pointer deserves, in CSS pixels, divided by `camera.zoom`. With no
 * tolerance every query misses.
 *
 * **Nearest wins.** Where two edges are both within tolerance the one whose
 * centreline is nearer the point is the hit, so a crossing or a fan of edges
 * into one node resolves to the edge the pointer is actually on. An exact tie
 * goes to the later edge in the array, which is the drawing order of one
 * group's mesh until a removal reuses a slot, the same limit the node index
 * documents.
 *
 * Nodes are not consulted. A caller that tests both asks the node index first,
 * because nodes are drawn over edges and an edge ends under its nodes.
 *
 * **Cost.** A uniform grid of segments, built in O(segments log segments)
 * with the cell set to the median segment extent (and at least a sixteenth of
 * the longest), and queried over the cells the tolerance square touches, or
 * by a scan when that square covers more cells than there are segments.
 */
export interface EdgeHitIndex {
  /**
   * The id of the edge whose centreline is nearest the world point within
   * `toleranceWorld`, else `null`.
   */
  hit(world: { readonly x: number; readonly y: number }, toleranceWorld: number): string | null;
  /** How many edges the index holds. */
  readonly size: number;
}

interface Segment {
  readonly id: string;
  readonly order: number;
  readonly ax: number;
  readonly ay: number;
  readonly dx: number;
  readonly dy: number;
}

function distanceSquared(segment: Segment, x: number, y: number): number {
  const px = x - segment.ax;
  const py = y - segment.ay;
  const length = segment.dx * segment.dx + segment.dy * segment.dy;
  const t = length > 0 ? Math.min(Math.max((px * segment.dx + py * segment.dy) / length, 0), 1) : 0;
  const ex = px - t * segment.dx;
  const ey = py - t * segment.dy;
  return ex * ex + ey * ey;
}

const NONE: readonly Segment[] = [];
const OFFSET = 1 << 24;
const SPAN = 1 << 25;
function cellKey(i: number, j: number): number {
  return (i + OFFSET) * SPAN + (j + OFFSET);
}

/**
 * Builds a hit index over a group's edges. An edge with fewer than two points
 * is not a target, and a segment with a non-finite end or span is skipped.
 */
export function createEdgeHitIndex(
  edges: readonly Pick<SceneEdge, 'id' | 'points'>[],
): EdgeHitIndex {
  const segments: Segment[] = [];
  const extents: number[] = [];
  let longest = 0;
  let size = 0;
  for (const [order, edge] of edges.entries()) {
    let kept = false;
    for (let k = 1; k < edge.points.length; k++) {
      const a = edge.points[k - 1];
      const b = edge.points[k];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (![a.x, a.y, dx, dy].every(Number.isFinite)) continue;
      segments.push({ id: edge.id, order, ax: a.x, ay: a.y, dx, dy });
      const extent = Math.max(Math.abs(dx), Math.abs(dy));
      extents.push(extent);
      longest = Math.max(longest, extent);
      kept = true;
    }
    if (kept) size++;
  }
  extents.sort((a, b) => a - b);
  const median = extents.length > 0 ? (extents[extents.length >> 1] ?? 1) : 1;
  const spread = Math.max(median, longest / 16);
  const cell = spread > 0 ? spread : 1;
  const grid = new Map<number, Segment[]>();
  let gridUsable = true;
  for (const segment of segments) {
    const i0 = Math.floor(Math.min(segment.ax, segment.ax + segment.dx) / cell);
    const i1 = Math.floor(Math.max(segment.ax, segment.ax + segment.dx) / cell);
    const j0 = Math.floor(Math.min(segment.ay, segment.ay + segment.dy) / cell);
    const j1 = Math.floor(Math.max(segment.ay, segment.ay + segment.dy) / cell);
    // Beyond safe integer cells, incrementing a coordinate can stop advancing.
    // Keep every segment available to the scan rather than risk an endless loop.
    if (![i0, i1, j0, j1].every(Number.isSafeInteger)) {
      gridUsable = false;
      grid.clear();
      break;
    }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = cellKey(i, j);
        const bucket = grid.get(k);
        if (bucket === undefined) grid.set(k, [segment]);
        else bucket.push(segment);
      }
    }
  }
  return {
    size,
    hit(world, toleranceWorld) {
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return null;
      if (!(toleranceWorld > 0) || !Number.isFinite(toleranceWorld)) return null;
      const i0 = Math.floor((world.x - toleranceWorld) / cell);
      const i1 = Math.floor((world.x + toleranceWorld) / cell);
      const j0 = Math.floor((world.y - toleranceWorld) / cell);
      const j1 = Math.floor((world.y + toleranceWorld) / cell);
      let best: Segment | null = null;
      let bestDistance = toleranceWorld * toleranceWorld;
      const consider = (segment: Segment): void => {
        const d = distanceSquared(segment, world.x, world.y);
        if (d < bestDistance || (d === bestDistance && (best === null || segment.order > best.order))) {
          bestDistance = d;
          best = segment;
        }
      };
      // When the tolerance square covers more cells than there are segments,
      // as at a far overview zoom, a scan costs fewer tests than the cell walk.
      if (!gridUsable || ![i0, i1, j0, j1].every(Number.isSafeInteger) ||
          (i1 - i0 + 1) * (j1 - j0 + 1) > segments.length) {
        for (const segment of segments) consider(segment);
      } else {
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            for (const segment of grid.get(cellKey(i, j)) ?? NONE) consider(segment);
          }
        }
      }
      return best === null ? null : (best as Segment).id;
    },
  };
}
