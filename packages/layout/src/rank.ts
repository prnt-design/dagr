import type { NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks, warmLongestPathRanks } from './acyclic.js';
import { authored } from './authorship.js';
import { splitLongEdges } from './chains.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
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
 * The largest share of the roster a warm run may recompute before it gives up
 * and sweeps the whole view instead.
 *
 * 0.01, AND IT IS THE CROSSOVER THIS TASK MEASURED RATHER THAN A ROUND NUMBER
 * SOMEBODY LIKED. M3.7b's entry asked for the fraction to be named here rather
 * than left as "an agreed fraction" for whoever needs to pass it, which is
 * M3.6's rule about a tolerance applied to a budget.
 *
 * WHY IT IS SO SMALL. A confined sweep reads its neighbours off the graph, one
 * node at a time, because the alternative is the O(V + E) index a cold sweep
 * builds and building that is most of what a cold sweep costs. Asking the graph
 * is far dearer per node than walking an index, so the confined sweep is
 * cheaper only while there are few enough nodes to ask about. Measured on
 * 2026-08-24 by nudging one node per rank and sweeping the region size from 1
 * to three quarters of the roster: the warm run costs the detection pass plus
 * about 3.9 microseconds per region node on the 1k corpus and 9.5 on the 10k,
 * against cold sweeps of 0.093ms and 1.61ms IN THAT SAME RUN. The two meet at
 * about 7 nodes of 1,000 and 91 of 10,000, which is 0.7% and 0.9%. One percent
 * is the round number just above both.
 *
 * WHAT THE SHARE IS NOT is a claim that a bigger region is wrong. A confined
 * sweep is exact at any share, so this number trades one kind of work for
 * another and never trades correctness for either, which is what makes it safe
 * to be a default a caller may raise to 1 or drop to 0.
 *
 * AND IT IS NOT WHERE THIS STAGE'S TIME GOES, which is the measurement worth
 * carrying out of this task, taken in a SECOND run on the same box and the same
 * day: the two runs put the 10k cold sweep at 1.61ms and 1.505ms, which is the
 * spread to expect of any figure here. Of the 10k corpus's 307ms in this stage,
 * the cycle break is 32ms, the acyclic view 12ms, the ranking sweep 1.5ms, and the
 * remaining 260ms is the ranks map and the 174,222 dummy nodes
 * {@link splitLongEdges} mints on every single run. Incremental ranking takes
 * the 1.5ms to 0.93ms and can never take anything else, so the honest reading
 * of this whole task is that it makes a third of half a percent disappear. The
 * fast path M3.9 is looking for is not a faster sweep: it is not re-minting a
 * chain the ranks it was derived from did not move.
 */
const DEFAULT_MAX_WARM_SHARE = 0.01;

/** What {@link longestPathRank} takes. */
export interface LongestPathRankOptions {
  /**
   * The largest share of the roster a warm run may recompute, in `[0, 1]`.
   *
   * Zero sweeps cold whenever anything moved at all, which is the honest off
   * switch and what an A/B measurement wants; it does NOT turn off the check
   * that finds nothing moved, because that check is what makes an unchanged
   * graph free and it is not a sweep. One admits every region, at which point
   * a patch that inverts a rank order pays the walk and then the sweep anyway.
   * Defaults to {@link DEFAULT_MAX_WARM_SHARE}.
   */
  readonly maxWarmShare?: number | undefined;
}

/**
 * The warm share, checked at the call that named it: a share of the roster
 * between zero and one.
 *
 * Not `requireRankWindow`'s rule and not `resolveBudget`'s. A window counts
 * ranks and a budget counts pivots, so both refuse a fraction; this one IS a
 * fraction, so what it refuses instead is a number outside the unit interval,
 * where the two ends both mean something and 1.5 means nothing at all.
 *
 * @throws {InvalidConfigError} naming `maxWarmShare` with `subject: 'option'`.
 */
function resolveWarmShare(maxWarmShare: number | undefined): number {
  if (maxWarmShare === undefined) return DEFAULT_MAX_WARM_SHARE;
  if (!Number.isFinite(maxWarmShare) || maxWarmShare < 0 || maxWarmShare > 1) {
    throw new InvalidConfigError(
      'maxWarmShare',
      maxWarmShare,
      'option',
      'a share of the roster between 0 and 1',
    );
  }
  return maxWarmShare;
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
 * ## The warm start
 *
 * BOTH HALVES OF THE RUN ARE WARM AS OF M3.7b. The cycle breaker is handed
 * `previous.reversedEdges`, which is M3.7a: what that buys is not speed, since
 * the breaker does the same work either way, but that the set this stage
 * records is then a fact about the graph's cycles rather than about where a
 * numerical solve landed. See the warm start section of `cycles.ts` for the
 * rule, the proof and what the seed is not allowed to do.
 *
 * The ranks are handed `previous.ranks`, and what THAT buys is the sweep. A
 * seeded ranking is checked node by node against the view it is supposed to
 * rank, and a seed every node agrees with IS the answer, so an edit that moved
 * no rank is priced at two walks of a typed array rather than at an index build
 * and a Kahn queue. An edit that moved some is swept over the region it
 * reaches and no further. Neither can return anything but the ranking a cold
 * sweep returns: see {@link warmLongestPathRanks}, which is where all of it is
 * argued, including why a seed here needs no validation and the floor
 * `networkSimplexRankStage` passes for the same field does.
 *
 * WHAT IT IS NOT IS A DIFFERENT ANSWER, WHICH IS WHY NOTHING DOWNSTREAM MOVES.
 * The ranks are contiguous from zero and the drawing is of minimum height on a
 * warm run because they are the same numbers, so the order stage's cohorts, the
 * dummy chains and the two properties above are untouched by this being here.
 * The one thing that does change is HOW OFTEN a node is a newcomer to the order
 * stage's constraint, which M3.6's entry predicted and asked to stay at zero
 * escapes rather than to improve.
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
 * @throws {InvalidConfigError} when `maxWarmShare` is not a share of the roster
 * between zero and one.
 * @throws {StageContractError} when the graph already holds an id the splitter
 * would mint, naming this stage. The `#dummy:` namespace is reserved and the
 * caller's own node is the thing to rename.
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the acyclic view still had a cycle. That is a bug in this stage rather
 * than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export function longestPathRank(options?: LongestPathRankOptions): RankStage {
  const share = resolveWarmShare(options?.maxWarmShare);
  return authored({
    name: 'longest-path-rank',
    run(input) {
      const { graph } = input;
      const reversedEdges = feedbackArcSet(graph, input.previous?.reversedEdges);
      const view = acyclicView(graph, reversedEdges);
      const seed = input.previous?.ranks;
      const rankOf =
        seed === undefined
          ? longestPathRanks(view)
          : warmLongestPathRanks({ view, graph, reversedEdges, seed, maxWarmShare: share }).ranks;

      const ranks = new Map<NodeId, number>();
      for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rankOf, number));

      // Split every edge that spans more than one rank into a chain of dummies,
      // one per rank strictly between its endpoints. `splitLongEdges` ranks each
      // dummy it mints into the map it was handed, and returns `undefined` when
      // there was nothing to split, which is what a graph with no long edge has
      // always got from this stage and what its tests pin: both fields omitted
      // rather than handed back empty.
      //
      // Run on a warm ranking exactly as on a cold one, and it has to be: the
      // chains are named for their edge and their index rather than for a rank,
      // so a chain a warm run keeps is a chain it re-mints under the same ids,
      // and the alternative is a second inventory of dummies to keep in step
      // with the first. What a warm run saves is the sweep, not the split.
      const split = splitLongEdges('longest-path-rank', graph, ranks);
      if (split === undefined) return { ranks, reversedEdges };
      return { ranks, reversedEdges, ...split };
    },
  });
}

/**
 * The default rank stage: a 1% warm share. See {@link longestPathRank}, which
 * is where the number is argued.
 *
 * Frozen, for the reason `defaultStages` is: it is one object shared by every
 * run in the process, and a stage's `name` is quoted in every
 * `StageContractError` the runner raises against it, so an assignment to it
 * anywhere would be an assignment to it everywhere.
 */
export const longestPathRankStage: RankStage = Object.freeze(longestPathRank());
