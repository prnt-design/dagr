import type { EdgeId, Graph, NodeId } from '@dagr/graph';

/**
 * What a drawing's SEGMENTS are, which is not the same thing as its edges.
 *
 * One rule, in one place, because three callers need it and a second copy would
 * be a second place for it to drift: `order.ts` builds its adjacency from it,
 * `countCrossings` counts over it, and `position.ts` marks conflicts on it. The
 * same argument `acyclic.ts` makes about two rankers sharing one view.
 *
 * An edge the rank stage split into a chain is drawn as the chain: source to
 * the first dummy, dummy to dummy, last dummy to target. An edge with no chain
 * is drawn as itself. So the segments of a graph with no long edge in it are
 * exactly its edges, which is what every stage here saw before M2.4b, and the
 * segments of a split graph are the polyline pieces a router will actually
 * emit.
 *
 * WHY THIS EXISTS AT ALL, since the chains were declared one milestone and
 * consumed the next. M2.4b's ranker split every long edge and nothing read
 * `virtualChains`, so a dummy was an isolated node in every index built here:
 * it joined a layer, took a `nodeSep` gap and a coordinate, and constrained
 * nothing. The stages went on building their adjacency from `graph.edges()`,
 * where a long edge still spanned many layers and was therefore still dropped
 * by the adjacent-layer filter. Measured on the 10k bench corpus at that point,
 * the segment count was 13,131 with the chains and without. This module is what
 * makes the chains mean something.
 */

/**
 * Calls `visit` once per segment of the drawing, in the direction the CALLER
 * authored the edge.
 *
 * A callback rather than a generator of pairs, and that is a measured choice
 * rather than a style one: the 10k bench corpus has 214,222 segments and a
 * generator yielding a tuple per segment allocates one array for each of them,
 * on a path every sweep of every order stage runs. The callback allocates
 * nothing.
 *
 * `edge` is passed as well as the two endpoints because a caller counting
 * per-edge things (a router, a metric that weights by edge) needs to know which
 * edge a segment came from, and recovering it from a dummy id is exactly the
 * parsing `virtualChains` exists to avoid.
 *
 * The direction is the authored one, source to target, so the ranks along a
 * chain descend for an edge the ranker reversed. Callers that want the drawing
 * order rather than the authored one compare layers themselves, which is what
 * "up" and "down" mean in `order.ts` and `position.ts` and is deliberately not
 * decided here: a segment joining two layers crosses what it crosses whichever
 * way the arrow points.
 *
 * A chain member the graph also holds is impossible by the rank contract (the
 * runner rejects a declared id the graph already has), so no de-duplication is
 * needed and none is done.
 */
export function forEachSegment(
  graph: Graph,
  virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]>,
  visit: (from: NodeId, to: NodeId, edge: EdgeId) => void,
): void {
  for (const edge of graph.edges()) {
    const chain = virtualChains.get(edge.id);
    if (chain === undefined || chain.length === 0) {
      visit(edge.source, edge.target, edge.id);
      continue;
    }
    let previous = edge.source;
    for (const id of chain) {
      visit(previous, id, edge.id);
      previous = id;
    }
    visit(previous, edge.target, edge.id);
  }
}
