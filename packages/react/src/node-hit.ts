import type { SceneNode } from '@prnt/dagr-render';

/**
 * Exact CPU hit testing against the nodes the renderer was last handed.
 *
 * **Why this is exact where a bounding-box hover is not.** A circle's box has
 * four corners that are not the circle, and a rounded rectangle's corners are
 * cut. The test here evaluates each node's own silhouette, the same shapes the
 * shader draws: a circle of radius `width / 2`, and a rounded rectangle whose
 * corner radius is clamped to half its shorter side. Edges, ports, glow halos
 * and HTML tier content are not hit targets here; HTML content is the DOM's to
 * hit.
 *
 * **Draw order decides overlaps.** The renderer draws every rounded rectangle
 * first and every circle over them, and within one shape family a later node
 * over an earlier one. {@link NodeHitIndex.hit} returns the topmost under that
 * rule. Nodes from one layout do not overlap, so this only matters for a
 * caller who overlaps them on purpose, and within a family the renderer may
 * reuse a freed slot, so for overlapping nodes added after removals the order
 * is the array order and is not a promise about the GPU's.
 *
 * **Cost.** A uniform grid, built in O(n) and queried in O(nodes in a few
 * cells), so a pointer move on 10,000 nodes is a handful of shape tests rather
 * than 10,000. The cell is the median node extent, so one huge node does not
 * make every cell a crowd; a node larger than 16 cells is spread over at most
 * 17 per axis by raising the cell to a sixteenth of the largest node.
 */
export interface NodeHitIndex {
  /**
   * The id of the topmost node whose silhouette contains the world point, else
   * `null`.
   *
   * With `toleranceWorld` above zero, a point that is inside no silhouette
   * returns the node whose CENTRE is nearest within that many world units. This
   * is the touch-target rule: at an overview zoom a node is a few pixels wide
   * and an exact hit is not something a fingertip can make. Pass
   * `cssPixels / camera.zoom`. An exact hit always wins over a near one.
   */
  hit(world: { readonly x: number; readonly y: number }, toleranceWorld?: number): string | null;
  /** How many nodes the index holds. */
  readonly size: number;
}

interface Entry {
  readonly id: string;
  readonly order: number;
  readonly layer: number;
  readonly cx: number;
  readonly cy: number;
  readonly hw: number;
  readonly hh: number;
  readonly radius: number;
  readonly circle: boolean;
}

function contains(entry: Entry, x: number, y: number): boolean {
  const dx = Math.abs(x - entry.cx);
  const dy = Math.abs(y - entry.cy);
  if (dx > entry.hw || dy > entry.hh) return false;
  if (entry.circle) return dx * dx + dy * dy <= entry.hw * entry.hw;
  const r = entry.radius;
  if (r <= 0) return true;
  const qx = dx - (entry.hw - r);
  const qy = dy - (entry.hh - r);
  if (qx <= 0 || qy <= 0) return true;
  return qx * qx + qy * qy <= r * r;
}

/** A numeric key for a cell, so the grid is a `Map<number, ...>` and no string is built per query. */
const OFFSET = 1 << 24;
const SPAN = 1 << 25;
function cellKey(i: number, j: number): number {
  return (i + OFFSET) * SPAN + (j + OFFSET);
}

/** Builds a hit index over a scene's nodes. Nodes with a non-positive size are not targets. */
export function createNodeHitIndex(nodes: readonly SceneNode[]): NodeHitIndex {
  const entries: Entry[] = [];
  const extents: number[] = [];
  let largest = 0;
  for (const [order, node] of nodes.entries()) {
    const { width, height } = node.size;
    if (!(width > 0) || !(height > 0)) continue;
    const circle = node.shape === 'circle';
    const hw = width / 2;
    const hh = circle ? hw : height / 2;
    entries.push({
      id: node.id,
      order,
      layer: circle ? 1 : 0,
      cx: node.center.x,
      cy: node.center.y,
      hw,
      hh,
      radius: circle ? hw : Math.min(Math.max(node.cornerRadius ?? 0, 0), hw, hh),
      circle,
    });
    const extent = Math.max(width, height);
    extents.push(extent);
    largest = Math.max(largest, extent);
  }
  extents.sort((a, b) => a - b);
  const median = extents.length > 0 ? (extents[extents.length >> 1] ?? 1) : 1;
  const cell = Math.max(median, largest / 16, Number.MIN_VALUE);
  const grid = new Map<number, Entry[]>();
  for (const entry of entries) {
    const i0 = Math.floor((entry.cx - entry.hw) / cell);
    const i1 = Math.floor((entry.cx + entry.hw) / cell);
    const j0 = Math.floor((entry.cy - entry.hh) / cell);
    const j1 = Math.floor((entry.cy + entry.hh) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = cellKey(i, j);
        const bucket = grid.get(k);
        if (bucket === undefined) grid.set(k, [entry]);
        else bucket.push(entry);
      }
    }
  }
  return {
    size: entries.length,
    hit(world, toleranceWorld = 0) {
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return null;
      const exact = grid.get(cellKey(Math.floor(world.x / cell), Math.floor(world.y / cell)));
      let best: Entry | null = null;
      if (exact !== undefined) {
        for (const entry of exact) {
          if (!contains(entry, world.x, world.y)) continue;
          if (
            best === null ||
            entry.layer > best.layer ||
            (entry.layer === best.layer && entry.order > best.order)
          ) {
            best = entry;
          }
        }
      }
      if (best !== null) return best.id;
      if (!(toleranceWorld > 0)) return null;
      // Nearest centre within the tolerance, over every cell the tolerance
      // square touches. Ties go to the topmost.
      const i0 = Math.floor((world.x - toleranceWorld) / cell);
      const i1 = Math.floor((world.x + toleranceWorld) / cell);
      const j0 = Math.floor((world.y - toleranceWorld) / cell);
      const j1 = Math.floor((world.y + toleranceWorld) / cell);
      let bestDistance = toleranceWorld * toleranceWorld;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          for (const entry of grid.get(cellKey(i, j)) ?? []) {
            const d = (entry.cx - world.x) ** 2 + (entry.cy - world.y) ** 2;
            if (
              d < bestDistance ||
              (d === bestDistance &&
                best !== null &&
                (entry.layer > best.layer || (entry.layer === best.layer && entry.order > best.order)))
            ) {
              bestDistance = d;
              best = entry;
            }
          }
        }
      }
      return best === null ? null : best.id;
    },
  };
}
