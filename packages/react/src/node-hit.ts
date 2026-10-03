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
 * **Cost.** A uniform grid sized to the largest node, built in O(n) and
 * queried in O(nodes in a few cells), so a pointer move on 10,000 nodes is a
 * handful of shape tests rather than 10,000.
 */
export interface NodeHitIndex {
  /** The id of the topmost node whose silhouette contains the world point, else `null`. */
  hit(world: { readonly x: number; readonly y: number }): string | null;
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

/** Builds a hit index over a scene's nodes. Nodes with a non-positive size are not targets. */
export function createNodeHitIndex(nodes: readonly SceneNode[]): NodeHitIndex {
  const entries: Entry[] = [];
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
    largest = Math.max(largest, width, height);
  }
  const cell = largest > 0 ? largest : 1;
  const grid = new Map<string, Entry[]>();
  const key = (i: number, j: number): string => `${String(i)},${String(j)}`;
  for (const entry of entries) {
    const i0 = Math.floor((entry.cx - entry.hw) / cell);
    const i1 = Math.floor((entry.cx + entry.hw) / cell);
    const j0 = Math.floor((entry.cy - entry.hh) / cell);
    const j1 = Math.floor((entry.cy + entry.hh) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const bucket = grid.get(k);
        if (bucket === undefined) grid.set(k, [entry]);
        else bucket.push(entry);
      }
    }
  }
  return {
    size: entries.length,
    hit(world) {
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return null;
      const bucket = grid.get(key(Math.floor(world.x / cell), Math.floor(world.y / cell)));
      if (bucket === undefined) return null;
      let best: Entry | null = null;
      for (const entry of bucket) {
        if (!contains(entry, world.x, world.y)) continue;
        if (
          best === null ||
          entry.layer > best.layer ||
          (entry.layer === best.layer && entry.order > best.order)
        ) {
          best = entry;
        }
      }
      return best === null ? null : best.id;
    },
  };
}
