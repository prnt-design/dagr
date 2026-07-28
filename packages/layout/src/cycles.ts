import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';

/**
 * Cycle breaking for the rank stage: the greedy feedback-arc-set heuristic of
 * Eades, Lin and Smyth (1993), usually called GR.
 *
 * The output is a set of edge ids, not a modified graph. Nothing here touches
 * the caller's graph, because not touching it is the pipeline's one hard
 * promise, and the rank stage records the set in `RankedState.reversedEdges`
 * for the router to undo later.
 */

/** The bucket a vertex with no out-arcs left sits in. Emptied before any other. */
const SINK_BIN = 0;

/** The bucket a vertex with no in-arcs left sits in. Emptied after the sinks. */
const SOURCE_BIN = 1;

/** The first bucket holding a vertex by its `outdeg - indeg`. See {@link binFor}. */
const DELTA_BASE = 2;

/** The empty end of a bucket's linked list, and of a vertex's links within it. */
const NONE = -1;

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a vertex number this module minted. Absence is a bug here, so
 * it fails loudly rather than reading as `undefined` through arithmetic that
 * would quietly produce `NaN`.
 */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * The edges that have to be treated as running the other way for the graph to
 * become acyclic. Reversing exactly these, and nothing else, leaves a DAG.
 *
 * ## What it computes
 *
 * GR builds a vertex sequence and then calls every arc that runs backwards in
 * that sequence a feedback arc. The sequence is grown from both ends: a vertex
 * with no remaining out-arcs (a sink) goes to the front of the tail sequence, a
 * vertex with no remaining in-arcs (a source) goes to the back of the head
 * sequence, and when neither exists the vertex maximising `outdeg - indeg` goes
 * to the back of the head sequence. Head then tail is the order.
 *
 * ## What is actually guaranteed
 *
 * The paper proves `|F| <= m/2 - n/6` for a digraph with NO TWO-CYCLES, an
 * oriented graph, which is a stronger hypothesis than being simple and self
 * loop free. A digon breaks it outright, and Dagr's inputs are full of digons:
 * this module's own `breaks a two-node cycle with exactly one edge` test has
 * `n = 2`, `m = 2` and `|F| = 1` against a bound of `2/2 - 2/6 = 0.667`. The
 * `n/6` term is also earned per vertex removed with arcs still attached, so a
 * vertex with no arcs left inflates `n` for free and a sparse graph can miss
 * the bound without a digon anywhere: a 3-cycle plus two isolated vertices is
 * `|F| = 1` against `1.5 - 0.833 = 0.667`. It only starts to say anything once
 * `m >= n/3`.
 *
 * So what is claimed here, and what the tests assert, is the `m/2` half alone.
 * That half survives both the weighting below and every input above, by the
 * argument that carries the proof: the deltas of the remaining vertices always
 * sum to zero, so the greedy pick has `indeg <= outdeg` and adds no more
 * backward arcs than forward ones, and sinks and sources add no backward arcs
 * at all. Half is still worth having, and it is still the difference between
 * this and the DFS back-edge set a naive cycle breaker produces, which has no
 * bound at all: a DFS reverses whatever its traversal order happens to hit.
 *
 * Do not read that as "and therefore DFS reverses more edges here". Measured on
 * the 10k bench corpus, DFS back edges reverse FEWER of them than this does,
 * 1,651 against 6,327, and leave a view 601 ranks deep against 154. The bound
 * is about the count, and the count is not the quality this module's caller
 * buys. The next section is what is.
 *
 * ## What quality actually means here
 *
 * The caller is the rank stage, and what it does with this set is build an
 * acyclic view and rank it. The number it pays for is the TOTAL SPAN of that
 * view, the sum over its edges of `max(0, rank(target) - rank(source) - 1)`,
 * because that is exactly one dummy node per rank an edge crosses beyond the
 * first once M2.4b's splitter exists. Span follows the DEPTH of the view ON THE
 * 10k CORPUS, which is the corpus that decides this rather than a fact about
 * span in general (the corpus paragraph below is the correction, and it is
 * there because the wide version of this sentence is false), and depth runs
 * against the reversal count across every candidate measured so far, on both
 * bench corpora. So the `m/2` bound above is a real guarantee about the
 * wrong quantity, and a change here that cuts the reversal count is not, on its
 * own, an improvement. The ground-truth row below is the one exception, and it
 * is not an algorithm: the two objectives are not inherently opposed, they are
 * just opposed in every heuristic anyone has tried here.
 *
 * The numbers, from the M2.2b measurement run, on the 10k corpus (10,000 nodes,
 * 40,000 edges, 60 authored layers), which is the corpus M2.4b, M2.9, M3.9 and
 * M4.10 all commit against. This module: 6,327 reversals, 154 ranks, 1,414,263
 * dummies. Reversing exactly the edges the corpus authored as back edges, which
 * is knowledge no cycle breaker has and is here only as a bound to argue
 * against: 796 reversals, 60 ranks, 32,050 dummies. So there is a factor of
 * forty on the table and greedy does not find it.
 *
 * Three alternatives are already measured, recorded so that the next reader
 * does not spend a run on them blind. All three figures below are under
 * `longestPathRanks`; the ranker matters and the paragraph after next says how.
 * DFS back edges: 1,651 reversals, 601 ranks, 1,601,415 dummies, so a cut of
 * nearly four times in the reversal count bought 13% MORE of the thing that is
 * actually paid for. Keeping this pass's order and deleting only the reversals
 * whose endpoints lie in different strongly connected components: 4,620
 * reversals, 203 ranks, 1,359,680 dummies, which is the only measured candidate
 * that beats this pass on BOTH reversals and span, on both corpora, and it is
 * the bar M2.2b now states. This same heuristic run per strongly connected
 * component: 61% fewer reversals, 2.1 times the depth, 8% more span (2,454, 320
 * ranks, 1,522,128 dummies). That last one is the instructive failure under
 * this ranker, because the idea behind it is sound as
 * far as it goes. An edge between two components lies on no cycle, so NO CYCLE
 * REQUIRES reversing it, and the sequence built below reverses 1,707 of them
 * anyway out of its 6,327 (348 of 422 on the 1k). Note the exact strength of
 * that: it says a construction avoiding those reversals exists, NOT that they
 * can be dropped from this set, because reversing a set is not deleting it and
 * a reversed arc creates paths the original graph did not have. Dropping them
 * from this set happens to leave a legal view on both corpora, which is a
 * measurement and not a theorem. But a reversal SHORTENS the path it sat on as
 * well as pointing an edge backwards, so taking away reversals nobody needed
 * makes the longest path longer. That tension is the shape of the problem.
 *
 * ## Which ranker those spans assume
 *
 * All of them assume `longestPathRanks`, and the verdicts move under the
 * network simplex ranker M2.3 shipped. At its default 20,000-pivot budget the
 * 10k spans become 423,426 for this pass, 311,179 for the per-component variant
 * and 268,589 for the deletion pass, which reads as though per-component wins.
 * IT DOES NOT: that budget does not converge the 10k, and the rows are not
 * equally far from converged, so the column ranks convergence SPEED. At 200,000
 * pivots this pass is 224,789, the deletion pass 226,676 and the per-component
 * variant 309,732, and the order is back to where longest path had it. Quote a
 * pivot budget beside any simplex figure, and treat a candidate that wins only
 * at a truncated budget as a lead rather than a result. Depth was identical
 * under both rankers in every row measured, at both budgets.
 *
 * State the corpus with any claim made here. On the 1k corpus the depth result
 * is the same (DFS is 86% deeper at a tenth of the reversals) but the span
 * result INVERTS: DFS comes out at 30,954 dummies against this module's 40,430,
 * 24% fewer, and every candidate measured cuts span there. A run that measured
 * only the 1k would have concluded that DFS is an improvement. The 1k has 242
 * intra-component edges out of 4,000 against the 10k's 20,229 out of 40,000, so
 * its cycle structure is nearly trivial and a deeper view has little to span
 * across. See M2.2b in `ROADMAP.md` for both corpora in full, the other two
 * families measured, and the time budget a replacement has: about 2ms on the
 * 10k, which is less than the 4.1ms a Tarjan pass costs there. Note that the
 * word condensation below means the parallel-arc collapse and NOT the
 * components, so there is nothing to read components out of for free. A
 * component-scoped replacement has to pay for itself by REPLACING the work
 * below rather than by running in front of it.
 *
 * ## Complexity
 *
 * O(V + E) time and space. The vertex to pick each round comes from degree
 * buckets rather than from a scan of what is left: each vertex sits in one
 * bucket keyed by its current `outdeg - indeg`, removing a vertex moves only
 * its neighbours between buckets, and the pointer at the highest occupied
 * bucket only ever walks down as far as it was pushed up. A rescan per round
 * would be O(V * E), which is the difference between laying out a 10k-node
 * graph and not.
 *
 * `graph.edges()` is walked twice per call, once to build the condensation and
 * once to collect the feedback set, off one materialised array. Taking the
 * nodes and edges as parameters instead, so that the rank stage could share the
 * arrays it materialises anyway, was considered and deliberately deferred: it
 * buys an unmeasured saving and costs a function that can be handed arrays
 * disagreeing with its own graph. That is the class of bug the pipeline spent
 * M2.4a making unrepresentable at the stage boundary, by having a stage return
 * its own fields and the runner supply the graph, and reintroducing it here as
 * a private convention would be going the other way. M0.2's bench harness is
 * what should decide it, on a measurement rather than on a count of
 * allocations.
 *
 * ## Self loops
 *
 * A self loop is never in the set. Reversing it cannot help, since it is a
 * cycle whichever way it points, and the pipeline already tolerates it: the
 * runner's rank check compares endpoint ranks with `<=` precisely so that both
 * ends of a self loop may share a rank.
 *
 * ## Parallel edges
 *
 * GR runs over the weighted simple condensation, where all arcs from one
 * ordered pair collapse into one arc whose weight is how many there were, and
 * the reversal decision is then taken per pair. Every copy between the same
 * two nodes therefore goes the same way. Deciding per edge instead would let
 * one copy of `a -> b` be reversed and another not, which puts a two-cycle back
 * into the supposedly acyclic view, which is the whole thing this exists to
 * prevent.
 *
 * ## Determinism
 *
 * Same graph, same set, always. Vertices are numbered by `graph.nodes()` and
 * arcs are walked in `graph.edges()` order, both of which `@dagr/graph`
 * guarantees to be insertion order, and every intermediate structure here is an
 * array or an insertion-ordered `Map`. Buckets are FIFO queues seeded in
 * insertion order, so a tie between two vertices neither of which has moved
 * bucket goes to the one added to the graph first, and a tie involving a vertex
 * that has moved goes to whichever arrived in the bucket first, which is itself
 * fixed by the graph's order. M3 re-runs layout on every patch, and a ranker
 * that resolved a tie differently on a re-run would move nodes the user never
 * touched.
 */
export function feedbackArcSet(graph: Graph): ReadonlySet<EdgeId> {
  const nodes = graph.nodes();
  const count = nodes.length;
  // Materialised once and walked twice below. `graph.edges()` builds a fresh
  // array on every call, and the second walk wants the same edges in the same
  // order as the first, so asking twice would pay for a copy to be told the
  // same thing.
  const edges = graph.edges();
  const numbers = new Map<NodeId, number>();
  for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

  // The condensation. `Map` rather than an adjacency array because it collapses
  // parallel arcs as it goes, and it still iterates in insertion order, so the
  // walk over a vertex's neighbours is as reproducible as the walk over edges
  // that built it.
  const outArcs: Map<number, number>[] = [];
  const inArcs: Map<number, number>[] = [];
  for (let vertex = 0; vertex < count; vertex += 1) {
    outArcs.push(new Map<number, number>());
    inArcs.push(new Map<number, number>());
  }
  const outDegree: number[] = new Array<number>(count).fill(0);
  const inDegree: number[] = new Array<number>(count).fill(0);
  // Every arc that is not a self loop, counted once. Bounds how far a delta can
  // travel in either direction, which is what sizes the bucket array.
  let weight = 0;
  for (const edge of edges) {
    const source = numbers.get(edge.source);
    const target = numbers.get(edge.target);
    // Unreachable: an edge's endpoints are always nodes of the graph.
    if (source === undefined || target === undefined) continue;
    // A self loop is skipped, and not only because it is never reversed. It
    // adds one to BOTH of its vertex's degrees, so it leaves `outdeg - indeg`
    // untouched and still pushes the vertex out of SINK_BIN or SOURCE_BIN into
    // a delta bucket. Counting it would change the vertex's PRIORITY CLASS, not
    // its key: a source with a loop on it stops being picked early, gets picked
    // late instead, and drags the arcs around it backwards in the order. That
    // is how a graph whose only cycles are self loops ends up with a real edge
    // reversed.
    if (source === target) continue;
    const out = at(outArcs, source);
    out.set(target, (out.get(target) ?? 0) + 1);
    const into = at(inArcs, target);
    into.set(source, (into.get(source) ?? 0) + 1);
    outDegree[source] = at(outDegree, source) + 1;
    inDegree[target] = at(inDegree, target) + 1;
    weight += 1;
  }

  /** Which bucket a vertex belongs in right now. Sink beats source beats delta. */
  const binFor = (vertex: number): number => {
    if (at(outDegree, vertex) === 0) return SINK_BIN;
    if (at(inDegree, vertex) === 0) return SOURCE_BIN;
    return DELTA_BASE + weight + at(outDegree, vertex) - at(inDegree, vertex);
  };

  // Buckets as intrusive doubly linked lists: one `head`/`tail` pair per bucket
  // and one `next`/`previous` pair per vertex, so unlinking a vertex whose
  // degree changed is O(1) and does not disturb the order of the rest.
  const binCount = DELTA_BASE + 2 * weight + 1;
  const head: number[] = new Array<number>(binCount).fill(NONE);
  const tail: number[] = new Array<number>(binCount).fill(NONE);
  const next: number[] = new Array<number>(count).fill(NONE);
  const previous: number[] = new Array<number>(count).fill(NONE);
  const binOf: number[] = new Array<number>(count).fill(NONE);
  const removed: boolean[] = new Array<boolean>(count).fill(false);
  // The highest bucket that has ever held a vertex, walked down on demand. It
  // is a high-water mark rather than an exact maximum because keeping it exact
  // would cost a scan on every removal.
  let highest = DELTA_BASE - 1;

  /** Appends to a bucket's tail, which is what makes the buckets FIFO. */
  const link = (vertex: number, bin: number): void => {
    const last = at(tail, bin);
    previous[vertex] = last;
    next[vertex] = NONE;
    if (last === NONE) head[bin] = vertex;
    else next[last] = vertex;
    tail[bin] = vertex;
    binOf[vertex] = bin;
    if (bin > highest) highest = bin;
  };

  const unlink = (vertex: number): void => {
    const bin = at(binOf, vertex);
    const before = at(previous, vertex);
    const after = at(next, vertex);
    if (before === NONE) head[bin] = after;
    else next[before] = after;
    if (after === NONE) tail[bin] = before;
    else previous[after] = before;
    binOf[vertex] = NONE;
  };

  for (let vertex = 0; vertex < count; vertex += 1) link(vertex, binFor(vertex));

  /** Moves a vertex whose degrees changed, and only if the bucket changed. */
  const reclassify = (vertex: number): void => {
    const bin = binFor(vertex);
    if (bin === at(binOf, vertex)) return;
    unlink(vertex);
    link(vertex, bin);
  };

  /**
   * Takes a vertex out of the running and tells its neighbours. Everything
   * costed here is charged to a condensed arc, and each arc is charged once
   * from each end over the whole run, which is where the O(V + E) comes from.
   */
  const take = (bin: number): number => {
    const vertex = at(head, bin);
    unlink(vertex);
    removed[vertex] = true;
    for (const [neighbour, arcs] of at(outArcs, vertex)) {
      if (at(removed, neighbour)) continue;
      inDegree[neighbour] = at(inDegree, neighbour) - arcs;
      reclassify(neighbour);
    }
    for (const [neighbour, arcs] of at(inArcs, vertex)) {
      if (at(removed, neighbour)) continue;
      outDegree[neighbour] = at(outDegree, neighbour) - arcs;
      reclassify(neighbour);
    }
    return vertex;
  };

  const heads: number[] = [];
  const tails: number[] = [];
  for (let taken = 0; taken < count; taken += 1) {
    if (at(head, SINK_BIN) !== NONE) {
      // Pushed rather than unshifted, and reversed once at the end: a sink goes
      // to the FRONT of the tail sequence, so the first sink out is the last
      // vertex of the order.
      tails.push(take(SINK_BIN));
      continue;
    }
    if (at(head, SOURCE_BIN) !== NONE) {
      heads.push(take(SOURCE_BIN));
      continue;
    }
    while (highest >= DELTA_BASE && at(head, highest) === NONE) highest -= 1;
    // Unreachable: with vertices left and neither a sink nor a source among
    // them, some delta bucket holds one, and `highest` is never below it.
    //
    // It throws rather than breaking out of the loop, because breaking is the
    // expensive way to be wrong here. Every untaken vertex would keep position
    // 0, tie with whatever `heads[0]` holds, and leave any two-cycle among them
    // unreversed, and the first sign of it would be `rank.ts` throwing two
    // stages later about a cycle the breaker "left", with nothing pointing back
    // at this line. Failing here costs a run that was already wrong and names
    // the place that went wrong.
    if (highest < DELTA_BASE) {
      throw new InternalLayoutError(
        `no sink, no source and no delta bucket with ${String(count - taken)} vertices left`,
      );
    }
    heads.push(take(highest));
  }
  tails.reverse();

  const position: number[] = new Array<number>(count).fill(0);
  for (const [place, vertex] of [...heads, ...tails].entries()) position[vertex] = place;

  // Every arc that runs backwards in the order, taken per edge rather than per
  // condensed pair, so all copies of a pair are decided together by the one
  // comparison. The self-loop skip states the rule rather than doing work: a
  // self loop's endpoints share a position and could not compare as backward
  // anyway. It is here so that the rule survives a change to the comparison.
  const feedback = new Set<EdgeId>();
  for (const edge of edges) {
    const source = numbers.get(edge.source);
    const target = numbers.get(edge.target);
    if (source === undefined || target === undefined) continue;
    if (source === target) continue;
    if (at(position, source) > at(position, target)) feedback.add(edge.id);
  }
  return feedback;
}
