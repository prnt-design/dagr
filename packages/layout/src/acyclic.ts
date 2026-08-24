import type { EdgeId, Graph, Node, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';

/**
 * The view every rank stage ranks over, and the two ways this package ranks it.
 *
 * All of it lives here rather than in `rank.ts` because two stages want it.
 * `longestPathRankStage` is the ranking, and `networkSimplexRankStage` needs
 * exactly the same view and the same initial feasible ranking before it can
 * start pivoting. A second copy of either would be a second place for the
 * self-loop rule and the reversal rule to drift, and a ranker that disagreed
 * with the other about what the acyclic view IS would disagree about which
 * rankings are feasible, which is the one thing both have to agree on.
 *
 * THE TWO RANKINGS ARE ONE RANKING, which is the thing to hold on to when
 * reading {@link warmLongestPathRanks} beside {@link longestPathRanks}. The
 * first sweeps the view from nothing; the second checks a previous run's answer
 * against the view and recomputes only what disagrees. They return the same
 * numbers for the same view, always, because longest path has one answer per
 * view and there is nothing for a warm start to choose. What differs is the
 * work, which is what {@link WarmRanking} reports on the side.
 *
 * {@link viewNeighbours} is the one thing here that is not the arrays: a
 * per-node reading of the same view off the graph's own adjacency, which the
 * confined sweep needs and which is the second copy of the reversal rule this
 * module's whole argument is against. Its docstring says what it costs to have
 * one and how the two are held to agreeing.
 */

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node or edge number this module minted. Absence is a bug
 * here rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * The graph as a ranker sees it: every node numbered, and every edge that
 * constrains a ranking listed by endpoint number, pointing the way it has to
 * point for the view to be acyclic.
 *
 * Numbers rather than ids, and parallel arrays rather than records, because
 * both consumers index arrays by node number for the whole of their run and
 * neither has any use for an id until it writes its answer back out.
 *
 * Self loops are dropped. A self loop constrains nothing (a node cannot be
 * below itself), it is never in the feedback set, and counting one would give
 * its node an in-degree the sweep below could never clear, stalling the whole
 * ranking on an edge that means nothing here.
 *
 * Parallel edges are kept, one entry each. Two copies of `a -> b` are two units
 * of total edge length to the network simplex ranker, which is the right answer
 * for it: M2.4b mints a dummy per copy per rank spanned, so the second copy
 * costs exactly what the first one does.
 */
export interface AcyclicView {
  /** The graph's nodes, in insertion order. A node's number is its index here. */
  readonly nodes: readonly Node[];

  /** Node number by id, for writing an answer back out against the graph. */
  readonly numbers: ReadonlyMap<NodeId, number>;

  /** Source node number per edge, after any reversal. Parallel to {@link to}. */
  readonly from: Int32Array;

  /** Target node number per edge, after any reversal. Parallel to {@link from}. */
  readonly to: Int32Array;
}

/**
 * The acyclic view of a graph given the edges to treat as running the other
 * way, which is what `feedbackArcSet` computed.
 *
 * It reads the graph and builds arrays; it never touches either. The edges come
 * out in `graph.edges()` order, which `@dagr/graph` guarantees to be insertion
 * order, and that order is what a ranker's tie-breaks are stated against.
 */
export function acyclicView(graph: Graph, reversedEdges: ReadonlySet<EdgeId>): AcyclicView {
  const nodes = graph.nodes();
  const numbers = new Map<NodeId, number>();
  for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

  const from: number[] = [];
  const to: number[] = [];
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const reversed = reversedEdges.has(edge.id);
    const source = numbers.get(reversed ? edge.target : edge.source);
    const target = numbers.get(reversed ? edge.source : edge.target);
    // Unreachable: an edge's endpoints are always nodes of the graph.
    if (source === undefined || target === undefined) continue;
    from.push(source);
    to.push(target);
  }
  return { nodes, numbers, from: Int32Array.from(from), to: Int32Array.from(to) };
}

/**
 * Ranks every node of a view by the longest path that reaches it, or by the
 * longest path that reaches it from a floor the caller supplies.
 *
 * A Kahn-style sweep: repeatedly take a node whose remaining in-degree is zero,
 * and relax its out-edges. Every node and every edge is visited once, so this is
 * O(V + E) like the cycle breaker it follows. Nodes enter the queue in node
 * number order, which is graph insertion order, and are relaxed in edge order,
 * so the run is reproducible. Longest path is far less order-sensitive than
 * cycle breaking: it has one answer per view whatever order the sweep visits it
 * in, because a node's rank is settled only once every predecessor is settled.
 *
 * `floor` is what makes this serve the network simplex ranker's warm start as
 * well as the default ranker. With no floor a node with nothing pointing at it
 * gets rank 0, which is the minimum-height ranking `longestPathRankStage`
 * promises. With one, each node starts at the floor the caller named and is
 * still pushed down by its predecessors, so the answer is feasible whatever the
 * floor said: a floor is a preference, and the sweep is what makes a preference
 * safe to express. The floor is read once per node and never written back, so a
 * caller's array is not modified.
 *
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the view still had a cycle. That is a bug in the cycle breaker or in
 * the view rather than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export function longestPathRanks(view: AcyclicView, floor?: Int32Array): Int32Array {
  const count = view.nodes.length;
  const edgeCount = view.from.length;

  // The out-edges as CSR: one array of targets, grouped by source, with an
  // index per source. An array of arrays would allocate a row per node, and on
  // a 10k node graph that is 10k allocations to walk once.
  const outDegree = new Int32Array(count);
  const inDegree = new Int32Array(count);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(view.from, edge);
    const target = at(view.to, edge);
    outDegree[source] = at(outDegree, source) + 1;
    inDegree[target] = at(inDegree, target) + 1;
  }
  const start = new Int32Array(count + 1);
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node) + at(outDegree, node);
  }
  const cursor = start.slice(0, count);
  const successors = new Int32Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(view.from, edge);
    successors[at(cursor, source)] = at(view.to, edge);
    cursor[source] = at(cursor, source) + 1;
  }

  const rankOf = floor === undefined ? new Int32Array(count) : Int32Array.from(floor);
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
    for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
      const successor = at(successors, slot);
      // Longest path, not shortest: a node sits below the LOWEST thing that
      // points at it, so a diamond's tail lands one rank under its longer side
      // rather than under whichever side the sweep reached first.
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
  return rankOf;
}

/**
 * One node's neighbours in the view, read off the graph's own adjacency rather
 * than out of {@link AcyclicView}'s arrays.
 *
 * ## Why a second reading of one rule exists at all
 *
 * The arrays are the right shape for a pass over the whole view and the wrong
 * shape for a walk that is supposed to be proportional to a handful of nodes:
 * finding one node's out-edges in them means an index over every edge, which is
 * the O(V + E) build {@link warmLongestPathRanks}'s confined sweep exists to
 * avoid paying. The graph already keeps that index per node, so the walk asks
 * it instead.
 *
 * THE RULE IS THE ONE `acyclicView` APPLIES AND IT IS NOW WRITTEN TWICE, HERE
 * AND THERE, WHICH IS ONCE TOO MANY. Self loops are dropped, and a reversed
 * edge runs target to source, so it leaves the node it was authored to arrive
 * at and arrives at the node it was authored to leave. That the two readings
 * agree is asserted in `test/layout.rank.warm.test.ts` over a random cyclic
 * population, edge for edge and in both directions, rather than argued here:
 * this module's own docstring says a second copy of the reversal rule is what
 * it exists to prevent, and a second copy that is checked is the most this walk
 * can offer instead.
 *
 * ONE ENTRY PER EDGE, DUPLICATES KEPT, which is the half of the agreement a
 * deduplicating walk would break silently. The confined sweep counts arriving
 * EDGES to know when a node is settled, exactly as `longestPathRanks` does, so
 * a walk that collapsed two parallel copies of `a -> b` into one neighbour
 * would leave `b` waiting for an edge that never arrives and stall the sweep on
 * a node the caller can see.
 *
 * A generator rather than an array, for the reason `@dagr/graph`'s own
 * traversal view gives: this is called once per node of a walk, and a
 * materialised neighbour array per node is the allocation the walk is trying
 * not to make. `graph.outEdges` does materialise one, which is the cost of
 * reading a public surface rather than a private index, and it is bounded by
 * the node's degree rather than by the graph.
 */
export function* viewNeighbours(
  graph: Graph,
  reversedEdges: ReadonlySet<EdgeId>,
  view: AcyclicView,
  node: number,
  direction: 'out' | 'in',
): Generator<number> {
  const here = view.nodes[node];
  if (here === undefined) throw new InternalLayoutError(`no node at index ${String(node)}`);
  const forward = direction === 'out';
  // Two questions, and only the first one is about the reversal. WHICH LISTING
  // AN EDGE BELONGS TO is the reversal's: an edge in this node's out-index runs
  // away from it in the view unless it was reversed, and one in its in-index
  // runs away from it only if it was. WHICH END TO READ is not: an edge in the
  // out-index has this node as its source, so its other end is its target
  // however the view runs it, and the in-index is the mirror of that. Reading
  // the end off the direction rather than off the listing is the bug this pair
  // of loops was written with, and it survives every acyclic input.
  for (const edge of graph.outEdges(here.id)) {
    if (edge.source === edge.target) continue;
    if (reversedEdges.has(edge.id) === forward) continue;
    const other = view.numbers.get(edge.target);
    if (other !== undefined) yield other;
  }
  for (const edge of graph.inEdges(here.id)) {
    if (edge.source === edge.target) continue;
    if (reversedEdges.has(edge.id) !== forward) continue;
    const other = view.numbers.get(edge.source);
    if (other !== undefined) yield other;
  }
}

/** What a warm ranking needs: the view, the graph under it, and a seed. */
export interface WarmRankInput {
  /** The view to rank, which is the one the seed has to be checked against. */
  readonly view: AcyclicView;

  /** The graph the view was built from, for the per-node walk. */
  readonly graph: Graph;

  /** The edges the view treats as running the other way. */
  readonly reversedEdges: ReadonlySet<EdgeId>;

  /**
   * A previous run's ranks by id, which is `PreviousLayout.ranks`.
   *
   * Ids the view does not hold are ignored and nodes the seed does not name
   * start at zero, so a seed from another graph is legal input rather than an
   * error. See {@link warmLongestPathRanks} for why it needs no validation
   * beyond keeping the arithmetic in range.
   */
  readonly seed: ReadonlyMap<NodeId, number>;

  /** The largest share of the roster a confined sweep may recompute. */
  readonly maxWarmShare: number;
}

/** A warm ranking, and what it cost to reach. */
export interface WarmRanking {
  /** The ranks by node number, and always the ranking a cold sweep produces. */
  readonly ranks: Int32Array;

  /** Whether the seed was abandoned and the whole view swept from scratch. */
  readonly cold: boolean;

  /** How many nodes the seed put somewhere their own predecessors deny. */
  readonly dirty: number;

  /**
   * How many nodes were recomputed: none when the seed was already exact, the
   * region when the sweep was confined, and the whole roster when it was not.
   */
  readonly swept: number;
}

/**
 * The longest-path ranking of a view, computed from a previous run's ranks
 * where they still hold and swept where they do not.
 *
 * ## What it returns, which is not a weaker answer than the cold one
 *
 * THE SAME RANKING `longestPathRanks` RETURNS, ALWAYS, and this is the whole
 * shape of the task. A ranking LP has many optima and a warm start chooses
 * between them, which is what `networkSimplexRank`'s hint does and why its
 * answer legitimately depends on what it was handed. Longest path has ONE
 * answer per view, so there is nothing here for a seed to choose and any
 * difference from the cold sweep is a defect. `test/layout.rank.warm.test.ts`
 * asserts the equality over 3,000 random cyclic digraphs given one edit each,
 * rather than over the cases where the two "must" agree, because there is no
 * other kind.
 *
 * ## The seed needs no validation, and that is a fact about this function
 *
 * A seed is CHECKED against the view before any of it is believed, so a wrong
 * seed costs work and cannot cost correctness. That is the opposite of the
 * floor `networkSimplexRank` passes to {@link longestPathRanks}, which is only
 * ever pushed DOWN by the sweep and therefore has to be validated by the caller
 * or it makes the answer worse. Same channel, two stages, two meanings: see
 * `simplex.ts`, where `floorFrom` drops the same three kinds of entry for the
 * other reason.
 *
 * What IS kept in range is the arithmetic. A seeded value outside `[0, count]`
 * is dropped, because ranks are read one above their predecessors and a value
 * near `Int32Array`'s ceiling would wrap to a negative rather than fail, and a
 * dropped entry is a node seeded at zero, which is legal input the detection
 * pass corrects like any other.
 *
 * ## How it decides what moved
 *
 * A ranking is the longest-path ranking exactly when every node is LOCALLY
 * CONSISTENT: it sits one below its deepest predecessor, or at zero when it has
 * none. That is one pass over the view's edges to find each node's deepest
 * predecessor and one over its nodes to compare, and it settles three questions
 * at once.
 *
 * NOTHING MOVED, so the seed is the answer and there is no sweep. This is the
 * case the feature is for and the only one where the saving is large: the pass
 * that proves it is two walks of typed arrays, against a cold sweep's index
 * build and Kahn queue.
 *
 * SOMETHING MOVED, and the nodes that moved are the seed of a region. Every
 * node NOT reachable from a locally inconsistent one is already correct, by
 * induction over the view's own order: it is locally consistent, and so is
 * everything above it. So the sweep is confined to the forward closure of the
 * dirty set, and every node outside it keeps the rank it had.
 *
 * THE VIEW STILL HAS A CYCLE, which is a bug in the cycle breaker rather than
 * in the caller. Local consistency all the way round a cycle would need each
 * node to sit one below the last and one above the first, so a cyclic view
 * always has a dirty node in every cycle, the cycle is inside the region, and
 * the confined sweep reports it exactly as the cold one does. The clean answer
 * is therefore also a proof that the view is acyclic, which is what makes
 * returning it without sweeping safe.
 *
 * ## When it gives up
 *
 * `maxWarmShare` is the largest share of the roster the confined sweep may
 * recompute, and it is checked twice against the same limit because the region
 * can be known two ways and they cost different amounts.
 *
 * FIRST FROM THE RANKS THE SEED ALREADY HOLDS, which is free: the region lies
 * under the shallowest dirty rank, so the nodes the seed put at that rank and
 * below are an estimate of its size, and an estimate is enough because
 * over-estimating sweeps cold and cold is always right. This is the guard that
 * matters, and it is the one the dirty count could not be: one dirty node at
 * the top of a drawing reaches most of it and one at the bottom reaches itself,
 * so counting dirty nodes is counting the wrong thing.
 *
 * THEN FROM THE WALK ITSELF, which is what catches an estimate that read low.
 * The region is measured as it grows and abandoned the moment it passes the
 * limit, so the wasted walk is bounded by the limit rather than by the graph.
 *
 * Both hand back the cold sweep's answer, because giving up is a decision about
 * work rather than about what the answer is.
 *
 * The default share and the measurement behind it are in `rank.ts`, where the
 * stage that names it lives.
 *
 * @throws {InternalLayoutError} when the sweep cannot reach every node of the
 * region, which means the acyclic view still had a cycle. Same condition and
 * same reason as {@link longestPathRanks}.
 */
export function warmLongestPathRanks(input: WarmRankInput): WarmRanking {
  const { view, graph, reversedEdges, seed } = input;
  const count = view.nodes.length;
  const edgeCount = view.from.length;

  const ranks = new Int32Array(count);
  for (const [number, node] of view.nodes.entries()) {
    const value = seed.get(node.id);
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > count) continue;
    ranks[number] = value;
  }

  // The deepest seeded predecessor of each node, or -1 where it has none.
  // Seeded values are never negative, so -1 cannot be one of them.
  const deepest = new Int32Array(count).fill(-1);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const above = at(ranks, at(view.from, edge));
    const target = at(view.to, edge);
    if (above > at(deepest, target)) deepest[target] = above;
  }

  // A tally of the seeded ranks, kept while the dirty set is collected because
  // it is the same pass and it is what prices the region before anything walks
  // it: see the guards below.
  const perRank = new Int32Array(count + 1);
  const dirty: number[] = [];
  let shallowest = count;
  let lowest = 0;
  for (let node = 0; node < count; node += 1) {
    const rank = at(ranks, node);
    perRank[rank] = at(perRank, rank) + 1;
    if (rank > lowest) lowest = rank;
    const above = at(deepest, node);
    if ((above < 0 ? 0 : above + 1) === rank) continue;
    dirty.push(node);
    if (rank < shallowest) shallowest = rank;
  }
  if (dirty.length === 0) return { ranks, cold: false, dirty: 0, swept: 0 };

  // `ceil` rather than `floor`, so that a share of one admits every roster and
  // a share of zero admits none: a small graph under a small share should read
  // as "sweep it cold" rather than as an off-by-one nobody notices.
  const limit = Math.ceil(input.maxWarmShare * count);

  // THE DIRTY COUNT DOES NOT PREDICT THE REGION AND THE SHALLOWEST DIRTY RANK
  // DOES, which is the one thing this task measured that changed its shape.
  // Nudging one node at the top of the 10k corpus moves 76% of the roster and
  // nudging one at the bottom moves it alone, so a guard on the dirty count lets the
  // worst case through and then pays for the walk that discovers it. A region
  // node is a descendant of a dirty one, so in the ranking being computed it
  // sits below the shallowest dirty rank, and the nodes the SEED put there are
  // a reading of how many that is. An ESTIMATE rather than a bound, because it
  // is read off the seed and the seed is what is being corrected, which costs
  // nothing: guessing high sweeps cold, which is always right, and guessing low
  // is caught by the walk's own guard below.
  let reachable = 0;
  for (let rank = shallowest; rank <= lowest; rank += 1) reachable += at(perRank, rank);
  if (reachable > limit) return coldFrom(view, dirty.length);

  // The forward closure of the dirty set. Walked with a read index rather than
  // `shift`, for the reason `longestPathRanks` gives.
  const region: number[] = [];
  const inRegion = new Uint8Array(count);
  for (const node of dirty) {
    inRegion[node] = 1;
    region.push(node);
  }
  for (let read = 0; read < region.length; read += 1) {
    if (region.length > limit) return coldFrom(view, dirty.length);
    for (const next of viewNeighbours(graph, reversedEdges, view, at(region, read), 'out')) {
      if (at(inRegion, next) === 1) continue;
      inRegion[next] = 1;
      region.push(next);
    }
  }

  // Every region node starts at the floor its predecessors OUTSIDE the region
  // put it at, which is a rank that is already correct, and waits for the ones
  // inside it. Nothing outside the region is touched or re-read afterwards.
  const waiting = new Int32Array(count);
  for (const node of region) {
    let floor = 0;
    let arriving = 0;
    for (const above of viewNeighbours(graph, reversedEdges, view, node, 'in')) {
      if (at(inRegion, above) === 1) {
        arriving += 1;
        continue;
      }
      if (at(ranks, above) + 1 > floor) floor = at(ranks, above) + 1;
    }
    ranks[node] = floor;
    waiting[node] = arriving;
  }

  const queue: number[] = [];
  for (const node of region) {
    if (at(waiting, node) === 0) queue.push(node);
  }
  let read = 0;
  let swept = 0;
  while (read < queue.length) {
    const node = at(queue, read);
    read += 1;
    swept += 1;
    const rank = at(ranks, node);
    // Every successor of a region node is in the region, because the region is
    // the forward closure of the dirty set, so no membership test is needed
    // here and none is written: a test that cannot fail is a test that hides
    // the property it was standing in for.
    for (const next of viewNeighbours(graph, reversedEdges, view, node, 'out')) {
      if (rank + 1 > at(ranks, next)) ranks[next] = rank + 1;
      waiting[next] = at(waiting, next) - 1;
      if (at(waiting, next) === 0) queue.push(next);
    }
  }
  if (swept !== region.length) {
    throw new InternalLayoutError(
      `${String(region.length - swept)} of ${String(region.length)} nodes in the ` +
        'changed region could not be ranked, so the cycle breaker left a cycle ' +
        'in the acyclic view',
    );
  }
  return { ranks, cold: false, dirty: dirty.length, swept };
}

/** The cold answer, reported as the cold answer. */
function coldFrom(view: AcyclicView, dirty: number): WarmRanking {
  return { ranks: longestPathRanks(view), cold: true, dirty, swept: view.nodes.length };
}
