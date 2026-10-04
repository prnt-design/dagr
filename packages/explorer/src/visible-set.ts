/**
 * Which nodes get a DOM element, which are left to the base layer, and which
 * edges are in view: the explorer's virtualization, as one pure function.
 *
 * A node's tier comes from its width on screen in CSS pixels, with half-open
 * gates, the rule `@prnt/dagr-render`'s rich nodes use. Below the `summary`
 * gate it is a mark and has NO element: the base layer draws it.
 *
 * **The scan is linear on purpose.** Testing 10,000 boxes costs tens of
 * microseconds. The renderer's overlay scans the same way and names a spatial
 * index as the fix if a measurement ever asks for one.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import type { ExplorerBox, ExplorerLayout } from './layout.js';
import type { Vec2 } from '@prnt/dagr-render/core';
import { visibleWorld } from './camera.js';
import type { ExplorerCamera, ExplorerViewportSize } from './camera.js';

export type ExplorerTier = 'summary' | 'rich';
export interface ExplorerTiers {
  readonly summary: number;
  readonly rich: number;
}
export const DEFAULT_TIERS: ExplorerTiers = Object.freeze({ summary: 56, rich: 200 });
export const DEFAULT_MAX_OVERLAY_NODES = 200;
export const OVERSCAN = 0.25;

export interface LayoutIndex {
  readonly nodeIds: readonly string[];
  readonly nodeBoxes: readonly ExplorerBox[];
  readonly edgeIds: readonly string[];
  /** `null` for an edge with no route, which is never in view. */
  readonly edgeBounds: readonly (ExplorerBox | null)[];
}

export function indexLayout(layout: ExplorerLayout): LayoutIndex {
  const edgeIds: string[] = [];
  const edgeBounds: (ExplorerBox | null)[] = [];
  for (const [id, points] of layout.routes) {
    edgeIds.push(id);
    if (points.length === 0) {
      edgeBounds.push(null);
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    edgeBounds.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }
  return {
    nodeIds: [...layout.boxes.keys()],
    nodeBoxes: [...layout.boxes.values()],
    edgeIds,
    edgeBounds,
  };
}

export interface VisibleSetOptions {
  readonly tiers?: ExplorerTiers | undefined;
  readonly maxOverlayNodes?: number | undefined;
  /** Node ids that are always overlay nodes, exempt from the cap. */
  readonly pinned?: readonly string[] | undefined;
}

export interface ExplorerVisibleSet {
  /** Overlay nodes and their tier, in data order. */
  readonly overlay: ReadonlyMap<string, ExplorerTier>;
  /** Nodes in view that the base layer draws as marks, in data order. */
  readonly baseNodes: readonly string[];
  /** Edges whose route is in view, in data order. */
  readonly edges: readonly string[];
}

/** Inclusive: boxes that only touch count, so a hairline route is not culled. */
function intersects(a: ExplorerBox, b: ExplorerBox): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function computeVisibleSet(
  index: LayoutIndex,
  camera: ExplorerCamera,
  viewport: ExplorerViewportSize,
  options: VisibleSetOptions = {},
): ExplorerVisibleSet {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  const cap = options.maxOverlayNodes ?? DEFAULT_MAX_OVERLAY_NODES;
  const pinned = new Set(options.pinned ?? []);
  const world = visibleWorld(camera, viewport);
  const view: ExplorerBox = {
    x: world.x - world.width * OVERSCAN,
    y: world.y - world.height * OVERSCAN,
    width: world.width * (1 + OVERSCAN * 2),
    height: world.height * (1 + OVERSCAN * 2),
  };
  const centerX = world.x + world.width / 2;
  const centerY = world.y + world.height / 2;

  const tierOf = new Map<number, ExplorerTier>();
  const candidates: { readonly i: number; readonly distance: number }[] = [];
  const inView: number[] = [];
  index.nodeBoxes.forEach((box, i) => {
    const id = index.nodeIds[i] as string;
    const screenWidth = box.width * camera.scale;
    const natural: ExplorerTier | null =
      screenWidth >= tiers.rich ? 'rich' : screenWidth >= tiers.summary ? 'summary' : null;
    if (pinned.has(id)) {
      tierOf.set(i, natural ?? 'summary');
      return;
    }
    if (!intersects(box, view)) return;
    inView.push(i);
    if (natural === null) return;
    tierOf.set(i, natural);
    const dx = box.x + box.width / 2 - centerX;
    const dy = box.y + box.height / 2 - centerY;
    candidates.push({ i, distance: dx * dx + dy * dy });
  });

  if (candidates.length > cap) {
    candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        ((index.nodeIds[a.i] as string) < (index.nodeIds[b.i] as string) ? -1 : 1),
    );
    for (const dropped of candidates.slice(Math.max(0, cap))) tierOf.delete(dropped.i);
  }

  const overlay = new Map<string, ExplorerTier>();
  index.nodeIds.forEach((id, i) => {
    const tier = tierOf.get(i);
    if (tier !== undefined) overlay.set(id, tier);
  });
  const baseNodes = inView.filter((i) => !tierOf.has(i)).map((i) => index.nodeIds[i] as string);
  const edges: string[] = [];
  index.edgeBounds.forEach((bounds, i) => {
    if (bounds !== null && intersects(bounds, view)) edges.push(index.edgeIds[i] as string);
  });
  return { overlay, baseNodes, edges };
}

/**
 * Whether two sets hold the same nodes at the same tiers, and the same marks
 * and edges in the same order. Overlay order is not compared:
 * `computeVisibleSet` always emits the overlay in the index's data order, so
 * two sets over one index cannot differ in order alone.
 */
export function sameVisibleSet(a: ExplorerVisibleSet, b: ExplorerVisibleSet): boolean {
  if (a === b) return true;
  if (
    a.overlay.size !== b.overlay.size ||
    a.baseNodes.length !== b.baseNodes.length ||
    a.edges.length !== b.edges.length
  ) {
    return false;
  }
  for (const [id, tier] of a.overlay) {
    if (b.overlay.get(id) !== tier) return false;
  }
  for (let i = 0; i < a.baseNodes.length; i += 1) {
    if (a.baseNodes[i] !== b.baseNodes[i]) return false;
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    if (a.edges[i] !== b.edges[i]) return false;
  }
  return true;
}

export function nearestToCenter(
  index: LayoutIndex,
  camera: ExplorerCamera,
  viewport: ExplorerViewportSize,
): string | null {
  const world = visibleWorld(camera, viewport);
  const centerX = world.x + world.width / 2;
  const centerY = world.y + world.height / 2;
  let best: string | null = null;
  let bestDistance = Infinity;
  index.nodeBoxes.forEach((box, i) => {
    const dx = box.x + box.width / 2 - centerX;
    const dy = box.y + box.height / 2 - centerY;
    const distance = dx * dx + dy * dy;
    const id = index.nodeIds[i] as string;
    if (distance < bestDistance || (distance === bestDistance && best !== null && id < best)) {
      best = id;
      bestDistance = distance;
    }
  });
  return best;
}

export function nodeAtPoint(index: LayoutIndex, point: Vec2): string | null {
  for (let i = index.nodeBoxes.length - 1; i >= 0; i -= 1) {
    const box = index.nodeBoxes[i] as ExplorerBox;
    if (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    ) {
      return index.nodeIds[i] as string;
    }
  }
  return null;
}
