/**
 * Public input and result types.
 *
 * The input types are deliberately structural: `@dagr/layout` never imports
 * `@dagr/graph`, so any graph model that can produce a list of sized nodes
 * and a list of edges can be laid out. An adapter from `@dagr/graph` lands
 * later, on top of these types, not underneath them.
 *
 * All coordinates and sizes are in abstract layout units, the same space
 * node `width` and `height` are given in.
 */

/** A node to lay out, identified by a caller-owned stable id. */
export interface LayoutNodeInput {
  /** Stable identity, unique across the input. Must not be empty. */
  readonly id: string;
  /** Node width in layout units. Finite and non-negative. */
  readonly width: number;
  /** Node height in layout units. Finite and non-negative. */
  readonly height: number;
}

/**
 * An edge to route.
 *
 * Edges carry their own id (matching `@dagr/graph`), so parallel edges
 * between the same pair of nodes and self loops (`source === target`) are
 * both legal: the input is a multi-digraph.
 */
export interface LayoutEdgeInput {
  /** Stable identity, unique across the input. */
  readonly id: string;
  /** Id of the node the edge leaves. Must name a node in the same input. */
  readonly source: string;
  /** Id of the node the edge enters. Must name a node in the same input. */
  readonly target: string;
}

/** One layout request: the nodes to place and the edges to route. */
export interface LayoutInput {
  /** Nodes in insertion order. Output order matches this order. */
  readonly nodes: readonly LayoutNodeInput[];
  /** Edges in insertion order. Output order matches this order. */
  readonly edges: readonly LayoutEdgeInput[];
}

/** A point in layout space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A placed node.
 *
 * `x` and `y` are the node CENTER, not its top-left corner. This matches
 * dagre and keeps rotation and rank-direction flips cheap. A renderer that
 * wants a top-left origin subtracts half the size: `x - width / 2`.
 */
export interface PositionedNode {
  /** The input node id, unchanged. */
  readonly id: string;
  /** Center x in layout units. */
  readonly x: number;
  /** Center y in layout units. */
  readonly y: number;
  /** The input width, unchanged. */
  readonly width: number;
  /** The input height, unchanged. */
  readonly height: number;
}

/**
 * A routed edge.
 *
 * `points[0]` lies on the source node and the last point lies on the target
 * node. Everything between them is the route. A route always has at least
 * two points, including a self loop, which the pass-through router emits as
 * a degenerate two point line at the node center.
 */
export interface RoutedEdge {
  /** The input edge id, unchanged. */
  readonly id: string;
  /** The input source node id, unchanged. */
  readonly source: string;
  /** The input target node id, unchanged. */
  readonly target: string;
  /** Polyline from source to target, source end first. */
  readonly points: readonly Point[];
}

/**
 * The result of one layout run.
 *
 * `nodes` and `edges` are in input order, and both hold what the caller
 * supplied: nodes a stage synthesized and the pieces an edge was split into
 * stay inside the pipeline.
 *
 * The drawing occupies the rectangle `minX, minY, width, height`. It is NOT
 * guaranteed to start at the origin, and the engine deliberately does not
 * move it there:
 *
 * - Margins belong to the position stage. The built in one starts the
 *   content at (`marginX`, `marginY`), which puts `minX` and `minY` at 0. A
 *   third-party position stage owes the caller nothing, so it may ignore the
 *   margins or emit negative coordinates, and then `minX` and `minY` say so
 *   instead of the size quietly not matching the content.
 * - Normalizing to the origin, the way dagre's `translateGraph` does, would
 *   shift the whole drawing whenever the extreme node changes, so adding one
 *   node off to the left would animate every other node sideways. Incremental
 *   relayout (roadmap M3) promises the opposite: nodes that did not change
 *   do not move. Reporting the origin keeps that promise and costs the caller
 *   one offset.
 *
 * So a caller that wants a top-left origin translates by `-minX, -minY`, or
 * hands the four numbers to a viewport (an SVG `viewBox`, a camera) as they
 * are.
 */
export interface LayoutResult {
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly RoutedEdge[];
  /**
   * Left edge of the drawing: the leftmost node edge minus `marginX`.
   *
   * `0` for an empty graph, which has no content to measure.
   */
  readonly minX: number;
  /**
   * Top edge of the drawing: the topmost node edge minus `marginY`.
   *
   * `0` for an empty graph, which has no content to measure.
   */
  readonly minY: number;
  /** Content width plus `2 * marginX`, in layout units. */
  readonly width: number;
  /** Content height plus `2 * marginY`, in layout units. */
  readonly height: number;
}
