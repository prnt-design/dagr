import type { NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks } from './acyclic.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError } from './errors.js';
import type { RankStage } from './types.js';

/**
 * The default rank stage: greedy feedback-arc-set cycle breaking, then
 * longest-path ranking over the acyclic view that leaves behind.
 */

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node number `acyclicView` minted. Absence is a bug here
 * rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
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
 * What longest path does not give is a minimum total edge length: `a -> d`
 * alongside `a -> b -> c -> d` leaves `a -> d` spanning three ranks when `d`
 * could not be anywhere else, but a node with slack elsewhere in the graph is
 * pinned as far down as it can go rather than as far up. That is a quality
 * problem, not a correctness one, and M2.4b's dummy chains make it a cost in
 * dummy nodes. `networkSimplexRankStage` is the stage that minimises that sum,
 * and it buys the saving with height rather than for free: see its docstring,
 * which is where the two objectives are compared.
 *
 * ## How
 *
 * The view and the sweep both come from `acyclic.ts`, which is where the
 * self-loop rule, the reversal rule and the O(V + E) Kahn sweep live, because
 * the simplex ranker starts from exactly the same view and the same ranking.
 * This stage is the two of them and a map back to the caller's ids.
 *
 * It returns the ranks and the reversals and nothing else. `virtualNodes` is
 * omitted rather than handed back empty: dummy chains for edges that span
 * several ranks are M2.4b, and nothing before then needs a node the caller did
 * not add, so this stage has nothing to say about the field. The runner puts an
 * empty set in the record and leaves `PreparedState.sizes` exactly as it found
 * it, because nothing has been added to size.
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
    const view = acyclicView(graph, reversedEdges);
    const rankOf = longestPathRanks(view);

    const ranks = new Map<NodeId, number>();
    for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rankOf, number));
    return { ranks, reversedEdges };
  },
};
