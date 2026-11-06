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
 * **Cost.** A uniform grid of segments over their bounds, built in
 * O(segments log segments) into flat typed arrays with the cell set to the
 * median segment extent (and at least a sixteenth of the longest, coarsened
 * until the grid has at most about four cells a segment), and queried over
 * the cells the tolerance square touches, or by a scan when that square covers
 * more cells than there are segments.
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

/** Segment `s` starts at `(ends[4s], ends[4s + 1])` and spans `(ends[4s + 2], ends[4s + 3])`. */
function distanceSquared(ends: Float64Array, s: number, x: number, y: number): number {
  const ax = ends[4 * s] as number;
  const ay = ends[4 * s + 1] as number;
  const dx = ends[4 * s + 2] as number;
  const dy = ends[4 * s + 3] as number;
  const px = x - ax;
  const py = y - ay;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.min(Math.max((px * dx + py * dy) / length, 0), 1) : 0;
  const ex = px - t * dx;
  const ey = py - t * dy;
  return ex * ex + ey * ey;
}

/**
 * Builds a hit index over a group's edges. An edge with fewer than two points
 * is not a target, and a segment with a non-finite end or span is skipped.
 */
export function createEdgeHitIndex(
  edges: readonly Pick<SceneEdge, 'id' | 'points'>[],
): EdgeHitIndex {
  let capacity = 0;
  for (const edge of edges) capacity += Math.max(edge.points.length - 1, 0);
  const ends = new Float64Array(4 * capacity);
  const extents = new Float64Array(capacity);
  const orders = new Int32Array(capacity);
  const ids: string[] = [];
  let count = 0;
  let longest = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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
      ends[4 * count] = a.x;
      ends[4 * count + 1] = a.y;
      ends[4 * count + 2] = dx;
      ends[4 * count + 3] = dy;
      orders[count] = order;
      ids.push(edge.id);
      const extent = Math.max(Math.abs(dx), Math.abs(dy));
      extents[count] = extent;
      longest = Math.max(longest, extent);
      // The far end as the cell spans compute it, which can differ from b by
      // an ulp, so every span lies inside the grid.
      minX = Math.min(minX, a.x, a.x + dx);
      minY = Math.min(minY, a.y, a.y + dy);
      maxX = Math.max(maxX, a.x, a.x + dx);
      maxY = Math.max(maxY, a.y, a.y + dy);
      count++;
      kept = true;
    }
    if (kept) size++;
  }
  const sorted = extents.subarray(0, count).sort();
  const median = count > 0 ? (sorted[count >> 1] ?? 1) : 1;
  const spread = Math.max(median, longest / 16);
  let cell = spread > 0 ? spread : 1;

  // The grid covers the segments' bounds and no more, with at most about four
  // cells a segment: a lone far-off segment coarsens the cells rather than
  // allocating the empty space between it and the rest.
  const limit = 4 * count + 16;
  let i0 = 0;
  let j0 = 0;
  let columns = 0;
  let rows = 0;
  let gridUsable = count > 0;
  while (gridUsable) {
    i0 = Math.floor(minX / cell);
    j0 = Math.floor(minY / cell);
    columns = Math.floor(maxX / cell) - i0 + 1;
    rows = Math.floor(maxY / cell) - j0 + 1;
    if (Number.isSafeInteger(columns) && Number.isSafeInteger(rows) && columns * rows <= limit) break;
    cell *= 2;
    if (!Number.isFinite(cell)) gridUsable = false;
  }

  // Each cell's segment indices sit contiguously in `members`, from
  // `starts[c]` up to `starts[c + 1]`, where `c` is `row * columns + column`.
  const starts = new Int32Array(gridUsable ? columns * rows + 1 : 1);
  const spans = new Int32Array(gridUsable ? 4 * count : 0);
  let members = new Int32Array(0);
  if (gridUsable) {
    for (let s = 0; s < count; s++) {
      const ax = ends[4 * s] as number;
      const ay = ends[4 * s + 1] as number;
      const bx = ax + (ends[4 * s + 2] as number);
      const by = ay + (ends[4 * s + 3] as number);
      const c0 = Math.floor(Math.min(ax, bx) / cell) - i0;
      const c1 = Math.floor(Math.max(ax, bx) / cell) - i0;
      const r0 = Math.floor(Math.min(ay, by) / cell) - j0;
      const r1 = Math.floor(Math.max(ay, by) / cell) - j0;
      spans[4 * s] = c0;
      spans[4 * s + 1] = c1;
      spans[4 * s + 2] = r0;
      spans[4 * s + 3] = r1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) starts[r * columns + c + 1] = (starts[r * columns + c + 1] as number) + 1;
      }
    }
    for (let c = 1; c < starts.length; c++) starts[c] = (starts[c] as number) + (starts[c - 1] as number);
    members = new Int32Array(starts[starts.length - 1] as number);
    const fill = starts.slice(0, -1);
    for (let s = 0; s < count; s++) {
      const c0 = spans[4 * s] as number;
      const c1 = spans[4 * s + 1] as number;
      const r0 = spans[4 * s + 2] as number;
      const r1 = spans[4 * s + 3] as number;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const slot = fill[r * columns + c] as number;
          members[slot] = s;
          fill[r * columns + c] = slot + 1;
        }
      }
    }
  }

  return {
    size,
    hit(world, toleranceWorld) {
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return null;
      if (!(toleranceWorld > 0) || !Number.isFinite(toleranceWorld)) return null;
      let best = -1;
      let bestDistance = toleranceWorld * toleranceWorld;
      const consider = (s: number): void => {
        const d = distanceSquared(ends, s, world.x, world.y);
        if (d < bestDistance || (d === bestDistance && (best < 0 || (orders[s] as number) > (orders[best] as number)))) {
          bestDistance = d;
          best = s;
        }
      };
      if (!gridUsable) {
        for (let s = 0; s < count; s++) consider(s);
        return best < 0 ? null : (ids[best] as string);
      }
      // Every segment lies inside the grid, so a tolerance square that misses
      // the grid is too far from all of them.
      const c0 = Math.max(Math.floor((world.x - toleranceWorld) / cell) - i0, 0);
      const c1 = Math.min(Math.floor((world.x + toleranceWorld) / cell) - i0, columns - 1);
      const r0 = Math.max(Math.floor((world.y - toleranceWorld) / cell) - j0, 0);
      const r1 = Math.min(Math.floor((world.y + toleranceWorld) / cell) - j0, rows - 1);
      if (c0 > c1 || r0 > r1) return null;
      // When the tolerance square covers more cells than there are segments,
      // as at a far overview zoom, a scan costs fewer tests than the cell walk.
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > count) {
        for (let s = 0; s < count; s++) consider(s);
      } else {
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const cellIndex = r * columns + c;
            const end = starts[cellIndex + 1] as number;
            for (let m = starts[cellIndex] as number; m < end; m++) consider(members[m] as number);
          }
        }
      }
      return best < 0 ? null : (ids[best] as string);
    },
  };
}
