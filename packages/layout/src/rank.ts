import type { NodeId } from '@dagr/graph';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError } from './errors.js';
import type { RankStage } from './types.js';

/**
 * The default rank stage: greedy feedback-arc-set cycle breaking, then
 * longest-path ranking over the acyclic view that leaves behind.
 */

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node number this module minted. Absence is a bug here rather
 * than in the caller, so it fails loudly instead of reading as `undefined`
 * through arithmetic that would quietly produce `NaN`.
 */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * Ranks every node by the longest path that reaches it, over the graph with the
 * feedback arc set treated as running the other way.
 *
 * ## What the ranks mean
 *
 * A node with nothing pointing at it in the acyclic view gets rank 0, and every
 * other node sits one below the lowest of the nodes that point at it. Two
 * properties fall out and both are relied on downstream. The ranks are
 * CONTIGUOUS from zero, because a node at rank `r` only got there from a
 * predecessor at rank `r - 1`, so no rank between 0 and the maximum is empty
 * and the order stage cannot produce a layer of nothing. And the drawing is of
 * MINIMUM HEIGHT: the last rank is the number of edges on the longest path in
 * the acyclic view, which is a lower bound for any ranking that sends every
 * edge down at least one rank.
 *
 * What longest path does not give is a minimum total edge length, which is what
 * M2.3's tight-tree pass is for: `a -> d` alongside `a -> b -> c -> d` leaves
 * `a -> d` spanning three ranks when `d` could not be anywhere else, but a node
 * with slack elsewhere in the graph is pinned as far down as it can go rather
 * than as far up. That is a quality problem, not a correctness one, and M2.4's
 * dummy chains make it a cost in dummy nodes.
 *
 * ## How
 *
 * A Kahn-style sweep over the acyclic view: repeatedly take a node whose
 * remaining in-degree is zero, and relax its out-edges. Every node and every
 * edge is visited once, so this is O(V + E) like the cycle breaker it follows.
 * Nodes enter the queue in graph insertion order and are relaxed in
 * `graph.edges()` order, so the run is reproducible, though ranking is far less
 * order-sensitive than cycle breaking: longest path has one answer per acyclic
 * view whatever order the sweep visits it in.
 *
 * Self loops are dropped from the view. A self loop constrains nothing (a node
 * cannot be below itself), it is never in the feedback set, and counting one
 * would give its node an in-degree the sweep could never clear, stalling the
 * whole ranking on an edge that means nothing here.
 *
 * `virtualNodes` is empty: dummy chains for edges that span several ranks are
 * M2.4, and nothing before then needs a node the caller did not add. `sizes`
 * passes straight through, because nothing has been added to size.
 *
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the acyclic view still had a cycle. That is a bug in this stage rather
 * than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export const longestPathRankStage: RankStage = {
  name: 'longest-path-rank',
  run(input) {
    const { graph } = input;
    const reversedEdges = feedbackArcSet(graph);

    const nodes = graph.nodes();
    const count = nodes.length;
    const numbers = new Map<NodeId, number>();
    for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

    // The acyclic view, as adjacency: an edge in the feedback set counts from
    // its target to its source, and a self loop counts not at all.
    const successors: number[][] = [];
    for (let node = 0; node < count; node += 1) successors.push([]);
    const inDegree: number[] = new Array<number>(count).fill(0);
    for (const edge of graph.edges()) {
      if (edge.source === edge.target) continue;
      const reversed = reversedEdges.has(edge.id);
      const from = numbers.get(reversed ? edge.target : edge.source);
      const to = numbers.get(reversed ? edge.source : edge.target);
      // Unreachable: an edge's endpoints are always nodes of the graph.
      if (from === undefined || to === undefined) continue;
      at(successors, from).push(to);
      inDegree[to] = at(inDegree, to) + 1;
    }

    const rankOf: number[] = new Array<number>(count).fill(0);
    // An array walked with a read index rather than `shift`, which is O(n) per
    // call on most engines and would make this O(V^2) on a wide graph.
    const queue: number[] = [];
    for (let node = 0; node < count; node += 1) {
      if (at(inDegree, node) === 0) queue.push(node);
    }
    let read = 0;
    let swept = 0;
    while (read < queue.length) {
      const node = at(queue, read);
      read += 1;
      swept += 1;
      const rank = at(rankOf, node);
      for (const successor of at(successors, node)) {
        // Longest path, not shortest: a node sits below the LOWEST thing that
        // points at it, so a diamond's tail lands one rank under its longer
        // side rather than under whichever side the sweep reached first.
        if (rank + 1 > at(rankOf, successor)) rankOf[successor] = rank + 1;
        inDegree[successor] = at(inDegree, successor) - 1;
        if (at(inDegree, successor) === 0) queue.push(successor);
      }
    }
    if (swept !== count) {
      throw new InternalLayoutError(
        `${String(count - swept)} of ${String(count)} nodes could not be ` +
          'ranked, so the cycle breaker left a cycle in the acyclic view',
      );
    }

    const ranks = new Map<NodeId, number>();
    for (const [number, node] of nodes.entries()) ranks.set(node.id, at(rankOf, number));
    return { ...input, ranks, reversedEdges, virtualNodes: new Set<NodeId>() };
  },
};
