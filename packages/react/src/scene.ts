/**
 * The conversion `@dagr/render` refused: a `LayoutResult` into a drawable scene.
 *
 * `@dagr/render`'s own index says why it is not there. `setNodes` deliberately
 * does not take a `LayoutResult`, because naming one would make `@dagr/layout`
 * a dependency of the renderer, and the y-down to y-up conversion belongs to
 * whoever owns the layout. This package owns both, which is the whole reason it
 * can exist: it is the first place in the workspace where a graph, a layout and
 * a renderer are all in scope at once.
 *
 * **The flip is one subtraction and it is the easiest thing here to get half
 * right.** A layout runs y-down, ranks increasing downwards, exactly as dagre
 * does. The renderer's world is y-up, because its camera is. Nodes, route
 * points and bounds are three separate expressions, and flipping two of the
 * three draws a picture that is half upside down with every unit test on the
 * flipped halves still green. `test/scene.test.ts` runs a real layout through
 * all three and asserts they agree, which is the check a hand-built fixture
 * cannot make.
 *
 * Nothing here touches React, and nothing here reads a `Graph`. Both are
 * deliberate. No React means the whole conversion is testable without a DOM,
 * which is where most of the arithmetic in this package lives. No `Graph` means
 * the appearance callbacks take an ID rather than a `Node`: a layout result is
 * keyed by ID, the caller already holds the graph, and a callback taking a
 * `Node` would make this module do a `Map` lookup the caller can do better.
 * Styling usually comes off a consumer's own store rather than off the graph's
 * attribute bag, and a signature that assumes otherwise is a signature that
 * makes the common case go the long way round.
 */

import type { EdgeId, NodeId } from '@dagr/graph';
import type { LayoutResult, PositionedNode, Rect } from '@dagr/layout';
import type { NodeShape, SceneEdge, SceneNode, WorldBounds } from '@dagr/render';

/**
 * What a caller may say about how one node is drawn.
 *
 * Every field is optional and missing fields come from
 * {@link DEFAULT_NODE_APPEARANCE}, per field rather than wholesale: a callback
 * that only wants to recolour one node should not have to restate the shape,
 * the corner radius and both halo fields to do it.
 *
 * Geometry is absent on purpose. A node's centre and size are the layout's
 * answer, and a caller who could override them here would be drawing a picture
 * that disagrees with the bounds, the routes and every stability guarantee M3
 * makes. Size belongs to `LayoutConfig.nodeSize`, upstream, where the layout
 * can account for it.
 */
export interface NodeAppearance {
  readonly shape?: NodeShape;
  readonly cornerRadius?: number;
  readonly fillColor?: number;
  readonly glowColor?: number;
  readonly glowWorld?: number;
}

/** How a caller says what a node looks like. `undefined` takes the defaults. */
export type NodeAppearanceOf = (id: NodeId) => NodeAppearance | undefined;

/** How a caller says what colour an edge is. `undefined` takes the default. */
export type EdgeColorOf = (id: EdgeId) => number | undefined;

/**
 * What a node looks like when nobody has said.
 *
 * A rounded rect with no halo, in two greys that read on both a light and a
 * dark page. This is a starting picture rather than a design: the moment a
 * consumer has an opinion about node appearance they pass a callback, and M6's
 * toolkit is where an opinion about which nodes look like what belongs.
 */
export const DEFAULT_NODE_APPEARANCE: Required<NodeAppearance> = Object.freeze({
  shape: 'roundedRect',
  cornerRadius: 4,
  fillColor: 0x3d4450,
  glowColor: 0x3d4450,
  glowWorld: 0,
});

/** The colour of an edge nobody has coloured. */
export const DEFAULT_EDGE_COLOR = 0x6b7280;

/**
 * A layout's y-down rectangle as the renderer's y-up box.
 *
 * `Rect.x` and `Rect.y` are the MINIMUM corner in layout space, so the flip
 * swaps which end of the y range is the minimum: the rectangle's top becomes
 * the box's `maxY`. Getting that backwards produces a box with `maxY` below
 * `minY`, which `@dagr/render` rejects by name rather than normalising, for
 * exactly this reason.
 */
export function toWorldBounds(rect: Rect): WorldBounds {
  return {
    minX: rect.x,
    maxX: rect.x + rect.width,
    minY: -(rect.y + rect.height),
    maxY: -rect.y,
  };
}

/** One positioned node's y-up box, which is what an overlay placement wants. */
export function nodeWorldBounds(node: PositionedNode): WorldBounds {
  return {
    minX: node.x - node.width / 2,
    maxX: node.x + node.width / 2,
    minY: -node.y - node.height / 2,
    maxY: -node.y + node.height / 2,
  };
}

/**
 * Every node in the result, flipped and dressed, in the result's own order.
 *
 * The order is the graph's insertion order, because a `LayoutResult`'s maps
 * are. It matters more than it looks: a node keeps its instance handle across
 * `setNodes` calls, keyed by ID rather than by slot, so the order is not what
 * identifies a node to the renderer. What it does decide is draw order within
 * a shape family, and a stable one means an edit does not reshuffle which
 * overlapping node is on top.
 */
export function toSceneNodes(result: LayoutResult, appearanceOf?: NodeAppearanceOf): SceneNode[] {
  const scene: SceneNode[] = [];
  for (const node of result.nodes.values()) {
    const said = appearanceOf?.(node.id);
    scene.push({
      id: node.id,
      center: { x: node.x, y: -node.y },
      size: { width: node.width, height: node.height },
      shape: said?.shape ?? DEFAULT_NODE_APPEARANCE.shape,
      cornerRadius: said?.cornerRadius ?? DEFAULT_NODE_APPEARANCE.cornerRadius,
      fillColor: said?.fillColor ?? DEFAULT_NODE_APPEARANCE.fillColor,
      glowColor: said?.glowColor ?? DEFAULT_NODE_APPEARANCE.glowColor,
      glowWorld: said?.glowWorld ?? DEFAULT_NODE_APPEARANCE.glowWorld,
    });
  }
  return scene;
}

/**
 * Every edge in the result as a ribbon centreline, flipped point by point.
 *
 * The point order is left alone. `RoutedEdge.points` runs source to target
 * whatever the ranker reversed, which is a contract `@dagr/layout` states
 * because getting it wrong is silent, and `SceneEdge.points` is the same
 * contract on the other side: it is what makes a flowing dash mean "towards
 * the target". A flip that reversed the array as well would satisfy every
 * geometric assertion and animate every cycle-breaking edge backwards.
 */
export function toSceneEdges(result: LayoutResult, colorOf?: EdgeColorOf): SceneEdge[] {
  const scene: SceneEdge[] = [];
  for (const edge of result.edges.values()) {
    scene.push({
      id: edge.id,
      points: edge.points.map((point) => ({ x: point.x, y: -point.y })),
      color: colorOf?.(edge.id) ?? DEFAULT_EDGE_COLOR,
    });
  }
  return scene;
}
