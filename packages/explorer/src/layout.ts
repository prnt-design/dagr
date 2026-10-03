import { Graph } from '@prnt/dagr-graph';
import { layout } from '@prnt/dagr-layout';
import { shapeEdgePath } from '@prnt/dagr-render/core';
import type { Vec2 } from '@prnt/dagr-render/core';

import { ExplorerDataError } from './errors.js';
import { resolveNodeSize } from './size.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView, Size } from './types.js';
import { validateView } from './validate.js';

/** Gap between neighbors across the flow, when the view does not say. */
export const DEFAULT_NODE_SEP = 40;
/** Gap between ranks along the flow, when the view does not say. */
export const DEFAULT_RANK_SEP = 120;
// The four constants below are exported for this package's tests and are NOT
// re-exported from the entry. They are fixed values today. Publishing them
// would make a change to any one a silent behavior break for whoever read it.

/** How far the content sits from the world origin, and from the far edges. */
export const WORLD_PADDING = 40;
/** Space between a group's outline and its members. `NodeGroup`'s default. */
export const GROUP_PADDING = 24;
/** Extra space above a group's members, for its label. */
export const GROUP_LABEL_BAND = 24;
/** Distance between neighboring edges that join the same pair of nodes. */
export const PARALLEL_EDGE_GAP = 16;

/** An axis-aligned rectangle in world space. `x`, `y` is its top-left corner. */
export interface ExplorerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ExplorerGroupBox extends ExplorerBox {
  readonly id: string;
}

/**
 * A view, placed. World space is y-down CSS pixels at zoom 1, and the content
 * is padded {@link WORLD_PADDING} off the origin, so `width` and `height`
 * describe a plane that starts at (0, 0).
 */
export interface ExplorerLayout {
  /** One box per node, in the order the view lists its nodes. */
  readonly boxes: ReadonlyMap<string, ExplorerBox>;
  /**
   * One route per edge, in the order the view lists its edges, running from
   * the edge's source to its target. A self loop has an empty route.
   */
  readonly routes: ReadonlyMap<string, readonly Vec2[]>;
  readonly groups: readonly ExplorerGroupBox[];
  readonly width: number;
  readonly height: number;
}

export interface LayoutViewOptions {
  /** Throw when a group's outline would enclose a node that is not a member. */
  readonly strictGroups?: boolean | undefined;
}

/**
 * The key two edges share when they join the same two nodes, whichever way
 * each one points. JSON rather than a joined string, because ids are the
 * caller's and may contain any separator: joined with a comma, 'a,b' with 'c'
 * and 'a' with 'b,c' are one pair.
 */
const pairKey = (a: string, b: string): string => JSON.stringify(a < b ? [a, b] : [b, a]);

/**
 * Gives a two-point route a middle point, moved sideways across the flow, so
 * two edges the router drew on one line can be told apart. Both ends stay
 * where they are.
 */
function bow(points: readonly Vec2[], offset: number, right: boolean): Vec2[] {
  const first = points[0];
  const last = points[1];
  if (first === undefined || last === undefined) return [...points];
  const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  return [first, right ? { x: mid.x, y: mid.y + offset } : { x: mid.x + offset, y: mid.y }, last];
}

/**
 * Places a view: a box per node, a route per edge, a rectangle per group.
 *
 * `@prnt/dagr-layout` lays out top-down and has no direction option, so
 * flowing right is a transpose done here, once: sizes go in with width and
 * height swapped, and every coordinate comes out with x and y swapped.
 *
 * Three things the layout engine does not do are done here:
 *
 * - **Parallel edges.** The router draws edges between one pair of nodes on
 *   the same line only when they span one rank. Those are given a middle point
 *   and moved apart, symmetrically about that line, so each can be seen. Both
 *   ends stay on their nodes. A pair that spans more ranks is left alone: the
 *   engine already routes each through its own dummy nodes.
 * - **Self loops.** The router gives an edge from a node to itself a
 *   zero-length line. Such an edge is left out of layout and has an empty
 *   route. It stays in the data, and drawing a loop is a later slice.
 * - **Groups.** A group is an annotation over the finished layout: the hull
 *   of its members, padded, with a band above for its label. It moves no node.
 *
 * @throws {ExplorerDataError} for a malformed view, and under `strictGroups`
 * when a group's outline would enclose a node that is not a member.
 */
export function layoutView<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
  options: LayoutViewOptions = {},
): ExplorerLayout {
  validateView(view);
  const right = (view.layout?.direction ?? 'right') === 'right';

  const sizes = new Map<string, Size>();
  const graph = new Graph();
  for (const node of view.nodes) {
    sizes.set(node.id, resolveNodeSize(view.layout, node));
    graph.addNode({ id: node.id });
  }

  const siblings = new Map<string, string[]>();
  for (const edge of view.edges) {
    if (edge.source === edge.target) continue;
    graph.addEdge({ id: edge.id, source: edge.source, target: edge.target });
    const key = pairKey(edge.source, edge.target);
    const list = siblings.get(key);
    if (list === undefined) siblings.set(key, [edge.id]);
    else list.push(edge.id);
  }

  // Each edge's place among the edges that join its pair, looked up once here
  // so the route loop below does not search a list per edge.
  const siblingOf = new Map<string, { readonly index: number; readonly count: number }>();
  for (const list of siblings.values()) {
    list.forEach((id, index) => siblingOf.set(id, { index, count: list.length }));
  }

  const sizeOf = (id: string): Size => {
    const size = sizes.get(id);
    if (size === undefined) throw new Error(`layoutView lost the size of node "${id}"`);
    return size;
  };

  const result = layout({
    graph,
    config: {
      nodeSep: view.layout?.nodeSep ?? DEFAULT_NODE_SEP,
      rankSep: view.layout?.rankSep ?? DEFAULT_RANK_SEP,
      nodeSize: (node) => {
        const size = sizeOf(node.id);
        return right ? { width: size.height, height: size.width } : size;
      },
    },
  });

  const toWorld = (p: Vec2): Vec2 => (right ? { x: p.y, y: p.x } : { x: p.x, y: p.y });

  const boxes = new Map<string, ExplorerBox>();
  for (const node of view.nodes) {
    const placed = result.nodes.get(node.id);
    if (placed === undefined) throw new Error(`layout returned no position for node "${node.id}"`);
    const size = sizeOf(node.id);
    const center = toWorld(placed);
    boxes.set(node.id, {
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
      width: size.width,
      height: size.height,
    });
  }

  const style = view.layout?.edgeStyle ?? 'smooth';
  const routes = new Map<string, Vec2[]>();
  for (const edge of view.edges) {
    if (edge.source === edge.target) {
      routes.set(edge.id, []);
      continue;
    }
    const routed = result.edges.get(edge.id);
    if (routed === undefined) throw new Error(`layout returned no route for edge "${edge.id}"`);
    let points = routed.points.map(toWorld);
    // Only a route of two points needs separating. That is a pair spanning one
    // rank, which the router draws on one line. A longer route already has its
    // own dummy nodes, a nodeSep from its siblings', and moving those would
    // undo an ordering the engine chose. See `route.ts` in `@prnt/dagr-layout`.
    const place = siblingOf.get(edge.id);
    if (place !== undefined && points.length === 2) {
      const offset = (place.index - (place.count - 1) / 2) * PARALLEL_EDGE_GAP;
      if (offset !== 0) points = bow(points, offset, right);
    }
    routes.set(
      edge.id,
      shapeEdgePath(points, { style, direction: right ? 'horizontal' : 'vertical' }),
    );
  }

  const groups: ExplorerGroupBox[] = (view.groups ?? []).map((group) => {
    const members = new Set(group.nodeIds);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of members) {
      const member = boxes.get(id);
      if (member === undefined) continue;
      minX = Math.min(minX, member.x);
      minY = Math.min(minY, member.y);
      maxX = Math.max(maxX, member.x + member.width);
      maxY = Math.max(maxY, member.y + member.height);
    }
    const rect: ExplorerGroupBox = {
      id: group.id,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING - GROUP_LABEL_BAND,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_BAND,
    };
    if (options.strictGroups === true) {
      for (const [id, other] of boxes) {
        if (members.has(id)) continue;
        const overlaps =
          other.x < rect.x + rect.width &&
          other.x + other.width > rect.x &&
          other.y < rect.y + rect.height &&
          other.y + other.height > rect.y;
        if (overlaps) {
          throw new ExplorerDataError(
            'GROUP_ENCLOSES_NON_MEMBER',
            `Group "${group.id}" in view "${view.id}" would enclose non-member node "${id}"`,
            group.id,
            view.id,
          );
        }
      }
    }
    return rect;
  });

  // Everything above is in the layout engine's frame, which is centered on
  // nothing in particular. Move it so the hull of every box, group and route
  // point starts WORLD_PADDING in from the origin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const b of boxes.values()) grow(b.x, b.y, b.x + b.width, b.y + b.height);
  for (const g of groups) grow(g.x, g.y, g.x + g.width, g.y + g.height);
  for (const points of routes.values()) for (const p of points) grow(p.x, p.y, p.x, p.y);

  if (minX === Infinity) {
    return { boxes: new Map(), routes: new Map(), groups: [], width: 0, height: 0 };
  }

  const dx = WORLD_PADDING - minX;
  const dy = WORLD_PADDING - minY;
  return {
    boxes: new Map([...boxes].map(([id, b]) => [id, { ...b, x: b.x + dx, y: b.y + dy }])),
    routes: new Map(
      [...routes].map(([id, points]) => [id, points.map((p) => ({ x: p.x + dx, y: p.y + dy }))]),
    ),
    groups: groups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    width: maxX - minX + WORLD_PADDING * 2,
    height: maxY - minY + WORLD_PADDING * 2,
  };
}

/**
 * A string that is equal for two views exactly when they lay out the same.
 *
 * It holds what moves the layout and nothing else: direction, edge style and
 * spacing, each node's id and resolved size, each edge's id and endpoints,
 * each group's id and members. Labels, colors and descriptions are absent, so
 * changing one never relayouts, and data re-created on every render with the
 * same shape keeps its layout.
 *
 * JSON, for the reason `pairKey` gives: ids are the caller's.
 *
 * Internal: the root uses it to memoize, and the entry does not export it.
 */
export function layoutKey<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
): string {
  return JSON.stringify([
    view.layout?.direction ?? 'right',
    view.layout?.edgeStyle ?? 'smooth',
    view.layout?.nodeSep ?? DEFAULT_NODE_SEP,
    view.layout?.rankSep ?? DEFAULT_RANK_SEP,
    view.nodes.map((node) => {
      const size = resolveNodeSize(view.layout, node);
      return [node.id, size.width, size.height];
    }),
    view.edges.map((edge) => [edge.id, edge.source, edge.target]),
    (view.groups ?? []).map((group) => [group.id, group.nodeIds]),
  ]);
}
