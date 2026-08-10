import type { NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks } from './acyclic.js';
import { splitLongEdges } from './chains.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError } from './errors.js';
import type { RankStage } from './types.js';

/**
 * The default rank stage: least-squares feedback-arc-set cycle breaking, then
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
 * What longest path does not give is a minimum total edge length. It pins each
 * node as high as its predecessors allow and never looks at what the node
 * points at, so `e -> d` alongside `a -> b -> c -> d` leaves `e` at rank 0 with
 * its one edge spanning three ranks when rank 2 was free. `a -> d` alongside
 * that same chain is NOT that case, though it looks like it: `d` sits three
 * ranks below `a` in every feasible ranking, so a shortcut edge spanning three
 * ranks is a shape longest path cannot avoid rather than a total it gets wrong.
 * Either way it is a quality problem and not a correctness one, and M2.4b's
 * dummy chains make it a cost in dummy nodes. `networkSimplexRankStage` is the
 * stage that minimises that sum, and it buys the saving with height rather than
 * for free: see its docstring, which is where the two objectives are compared.
 *
 * ## How
 *
 * The view and the sweep both come from `acyclic.ts`, which is where the
 * self-loop rule, the reversal rule and the O(V + E) Kahn sweep live, because
 * the simplex ranker starts from exactly the same view and the same ranking.
 * This stage is the two of them and a map back to the caller's ids.
 *
 * ## Dummy chains
 *
 * An edge whose endpoints are more than one rank apart is then split into a
 * chain of virtual nodes, one per rank strictly between them, by
 * {@link splitLongEdges}, which is where all of that is argued: what a chain
 * buys, why a dummy is `#dummy:<edgeId>:<index>` rather than named for its
 * rank, and what happens when a caller's own graph holds an id that looks like
 * one. Shared with `networkSimplexRankStage` since M2.4c, so the two rankers
 * split alike and neither lets a multi-rank edge reach the order stage. It was
 * this stage's own code until then, which is the shape of the bug that made it
 * shared: a splitter that lives inside one ranker is a splitter the other one
 * does not have.
 *
 * On the 1k bench corpus this stage mints 14,746 dummies and on the 10k
 * 174,222, which is one dummy per rank per edge beyond the first. That is the
 * `totalSpan` of `layout.cycles.quality.test.ts`, which sums `span - 1` per
 * edge and pins the same two figures from the ranking's end, and it is the
 * TOTAL EDGE LENGTH the simplex stage minimises MINUS THE EDGE COUNT, which
 * sums `span`. The two differ by the 4,000 and 40,000 edges of the corpora, so
 * the term matters: the total edge length of this ranking on the 1k is 18,746.
 * Both dummy counts are pinned in `test/layout.chains.test.ts`, beside the
 * simplex ranker's counts over the same two corpora.
 *
 * Frozen, for the reason `defaultStages` is: it is one object shared by every
 * run in the process, and a stage's `name` is quoted in every
 * `StageContractError` the runner raises against it, so an assignment to it
 * anywhere would be an assignment to it everywhere.
 *
 * @throws {StageContractError} when the graph already holds an id the splitter
 * would mint, naming this stage. The `#dummy:` namespace is reserved and the
 * caller's own node is the thing to rename.
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the acyclic view still had a cycle. That is a bug in this stage rather
 * than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export const longestPathRankStage: RankStage = Object.freeze<RankStage>({
  name: 'longest-path-rank',
  run(input) {
    const { graph } = input;
    const reversedEdges = feedbackArcSet(graph);
    const view = acyclicView(graph, reversedEdges);
    const rankOf = longestPathRanks(view);

    const ranks = new Map<NodeId, number>();
    for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rankOf, number));

    // Split every edge that spans more than one rank into a chain of dummies,
    // one per rank strictly between its endpoints. `splitLongEdges` ranks each
    // dummy it mints into the map it was handed, and returns `undefined` when
    // there was nothing to split, which is what a graph with no long edge has
    // always got from this stage and what its tests pin: both fields omitted
    // rather than handed back empty.
    const split = splitLongEdges('longest-path-rank', graph, ranks);
    if (split === undefined) return { ranks, reversedEdges };
    return { ranks, reversedEdges, ...split };
  },
});
