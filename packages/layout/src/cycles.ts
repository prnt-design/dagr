import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';

/**
 * Cycle breaking for the rank stage: the greedy feedback-arc-set heuristic of
 * Eades, Lin and Smyth (1993), usually called GR, with its reversals scoped to
 * the strongly connected components of the input.
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
 *
 * The index signature rather than `readonly number[]` is what lets one guard
 * serve the typed arrays below as well as the plain ones, and it is the same
 * signature `acyclic.ts` guards its own rows with.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
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
 * The set returned is those backward arcs whose two endpoints lie in the SAME
 * strongly connected component of the input graph. A backward arc between two
 * components is left pointing the way it was authored: it lies on no cycle, so
 * no cycle needs it turned round, and turning it round only stretches the view
 * the rank stage then has to rank.
 *
 * ## Why scoping to components is safe
 *
 * A proof rather than a measurement, because the neighbouring rule that looks
 * like it is a measurement and is false. Let sigma be the order this pass
 * builds, and reverse exactly the arcs (u, v) with sigma(v) < sigma(u) and u
 * and v in one strongly connected component of the INPUT graph. The view
 * `acyclic.ts` builds from that result is acyclic. The claim is about the VIEW
 * rather than about the graph with the set applied, because the view drops
 * self loops and a self loop is the one cycle no reversal can break; see Self
 * loops below. Suppose the view holds a cycle C. Every arc of C therefore has
 * two distinct endpoints.
 *
 * If every arc of C is intra-component, then after the transform every arc of C
 * runs forward in sigma: a forward one was kept and a backward one was turned
 * round. So sigma strictly increases all the way along C, and C cannot come
 * back to where it started.
 *
 * Otherwise C uses an arc (u, v) whose endpoints are in different components,
 * which is kept exactly as authored. Every arc of the result either stays
 * inside one component or is an original cross-component arc, and an original
 * cross-component arc strictly advances the topological order of the
 * condensation, the DAG of components, which is what makes that DAG a DAG.
 * (Condensation means that and only that in this file: the parallel-arc
 * collapse below is called the weighted simple graph.) So the component index
 * never falls along C and rises at least once, and again C cannot close.
 *
 * This does NOT contradict the four-node witness M2.2b records, `u->v, v->a,
 * a->b, b->a, u->b` with components {a, b}, {u} and {v}. That witness refutes
 * dropping SOME cross-component reversals while keeping others. Under the order
 * (v, a, b, u) the backward set is {u->v, b->a, u->b}; drop `u->v` alone and
 * the view holds `u->v, v->a, a->b, b->u`, which is a cycle, because the
 * reversed `u->b` is still there to close it. Drop the whole class at once and
 * the view holds `u->v, v->a, a->b, a->b, u->b`, which is acyclic. The witness
 * is in `layout.cycles.test.ts` with that reading beside it.
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
 * at all. It survives the component rule for free, since that rule only takes
 * arcs OUT of the backward set the argument bounds, so the returned set is a
 * subset of a set already under `m/2`. Half is still worth having, and it is
 * still the difference between this and the DFS back-edge set a naive cycle
 * breaker produces, which has no bound at all: a DFS reverses whatever its
 * traversal order happens to hit.
 *
 * Do not read that as "and therefore DFS reverses more edges here". Measured on
 * the 10k bench corpus, DFS back edges reverse FEWER of them than this does,
 * 1,651 against 4,620, and leave a view 601 ranks deep against 203. The bound
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
 * M4.10 all commit against. This module: 4,620 reversals, 203 ranks, 1,359,680
 * dummies, and 74, 81 and 22,726 on the 1k. The same order with EVERY backward
 * arc reversed, which is what this module returned before the component rule:
 * 6,327 reversals, 154 ranks, 1,414,263 dummies, and 422, 62 and 40,430.
 * Reversing exactly the edges the corpus authored as back edges, which is
 * knowledge no cycle breaker has and is here only as a bound to argue against:
 * 796 reversals, 60 ranks, 32,050 dummies. So there is a factor of forty on the
 * table and greedy does not find it.
 *
 * The candidates measured beside it are recorded so that the next reader does
 * not spend a run on them blind. All the figures here are under
 * `longestPathRanks`; the ranker matters and the paragraph after next says how.
 * DFS back edges: 1,651 reversals, 601 ranks, 1,601,415 dummies, so a cut of
 * nearly three times in the reversal count bought 18% MORE of the thing that is
 * actually paid for. This same heuristic run PER strongly connected component,
 * which rebuilds the order inside each component rather than scoping the
 * reversals of one global order: 2,454 reversals, 320 ranks, 1,522,128 dummies,
 * so 47% fewer reversals than this pass at 1.6 times the depth and 12% more
 * span. That last one is the instructive failure under this ranker, because it
 * runs on the same idea this pass does and takes it one step too far.
 *
 * The idea both of them turn on: an edge between two components lies on no
 * cycle, so NO CYCLE REQUIRES reversing it, and the order built below makes
 * 1,707 of its 6,327 backward arcs cross a boundary (348 of 422 on the 1k).
 * Those 1,707 are exactly the reversals this pass declines, which is where
 * 6,327 minus 1,707 equals 4,620 comes from. Note the exact strength of the
 * component theorem taken alone: it says a construction avoiding those
 * reversals exists, NOT that they can be dropped from a set one at a time,
 * because reversing a set is not deleting it and a reversed arc creates paths
 * the original graph did not have. Dropping SOME of them is what has no theorem
 * behind it, and the four-node witness above is the counterexample; dropping
 * the whole class is the theorem two sections up. But a reversal SHORTENS the
 * path it sat on as well as pointing an edge backwards, so taking away
 * reversals nobody needed makes the longest path longer, and that is why this
 * pass costs 203 ranks against the unscoped order's 154. That tension is the
 * shape of the problem, and the depth is a price M2.2b's bar row states and
 * accepts rather than one to leave unsaid.
 *
 * ## Which ranker those spans assume
 *
 * All of them assume `longestPathRanks`, and the verdicts move under the
 * network simplex ranker M2.3 shipped. At its default 20,000-pivot budget the
 * 10k spans become 423,426 for the unscoped order, 311,179 for the
 * per-component variant and 268,589 for this pass, which reads as though
 * per-component wins. IT DOES NOT: that budget does not converge the 10k, and
 * the rows are not equally far from converged, so the column ranks convergence
 * SPEED. At 200,000 pivots the unscoped order is 224,789, this pass 226,676 and
 * the per-component variant 309,732, and the order is back to where longest
 * path had it. Quote a pivot budget beside any simplex figure, and treat a
 * candidate that wins only at a truncated budget as a lead rather than a
 * result. Depth was identical under both rankers in every row measured, at both
 * budgets.
 *
 * State the corpus with any claim made here. On the 1k corpus the depth result
 * is the same (DFS is 86% deeper than the unscoped order at a tenth of the
 * reversals) but the span result INVERTS: DFS comes out at 30,954 dummies
 * against the unscoped order's 40,430, 24% fewer, and every candidate measured
 * cuts span there. A run that measured only the 1k would have concluded that
 * DFS is an improvement. It is not: this pass reaches 22,726 on that corpus,
 * 27% under DFS. The 1k has 242 intra-component edges out of 4,000 against the
 * 10k's 20,229 out of 40,000, so its cycle structure is nearly trivial and a
 * deeper view has little to span across. See M2.2b in `ROADMAP.md` for both
 * corpora in full and the other two families measured.
 *
 * The components and the parallel-arc collapse come out of ONE CSR build, and
 * that is what makes the rule affordable. M2.2b sizes a component-scoped
 * candidate against a Tarjan pass measured at 4.1ms on the 10k, against a time
 * budget of about 2ms, on the assumption that such a pass would run IN FRONT OF
 * the work below. This one replaces that work: the per-vertex arc `Map`s became
 * typed arrays, Tarjan walks the same collapsed rows the greedy walks, and the
 * call came out FASTER than the unscoped version rather than slower, 8.5ms
 * median against 11.0ms on the 10k (warm, median of 25, both measured in the
 * same process on one machine, so the ratio is the claim and the absolute is
 * not).
 *
 * ## Complexity
 *
 * O(V + E) time and space. The passes are one walk of `graph.edges()` for the
 * degrees, a second walk to fill the CSR rows, one linear collapse per row
 * that folds parallel arcs together in place, one Tarjan over the collapsed
 * out-rows, the greedy itself, and one final walk of the edges to collect the
 * set. Tarjan runs over the COLLAPSED rows, so a pair with k parallel arcs
 * between it is traversed once rather than k times.
 *
 * The vertex to pick each round comes from degree buckets rather than from a
 * scan of what is left: each vertex sits in one bucket keyed by its current
 * `outdeg - indeg`, removing a vertex moves only its neighbours between
 * buckets, and the pointer at the highest occupied bucket only ever walks down
 * as far as it was pushed up. A rescan per round would be O(V * E), which is
 * the difference between laying out a 10k-node graph and not.
 *
 * `graph.edges()` is walked three times per call, off one materialised array.
 * Taking the nodes and edges as parameters instead, so that the rank stage
 * could share the arrays it materialises anyway, was considered and
 * deliberately deferred: it buys an unmeasured saving and costs a function that
 * can be handed arrays disagreeing with its own graph. That is the class of bug
 * the pipeline spent M2.4a making unrepresentable at the stage boundary, by
 * having a stage return its own fields and the runner supply the graph, and
 * reintroducing it here as a private convention would be going the other way.
 * M0.2's bench harness is what should decide it, on a measurement rather than
 * on a count of allocations.
 *
 * ## Self loops
 *
 * A self loop is never in the set. Reversing it cannot help, since it is a
 * cycle whichever way it points, and the pipeline already tolerates it: the
 * runner's rank check compares endpoint ranks with `<=` precisely so that both
 * ends of a self loop may share a rank. A loop is a cycle, so its vertex is in
 * a component with itself and would pass the component test, but it never
 * reaches that test: it is skipped when the rows are built, skipped again when
 * the set is collected, and so never becomes a backward arc to scope.
 *
 * ## Parallel edges
 *
 * GR runs over the weighted simple graph, where all arcs from one ordered
 * pair collapse into one arc whose weight is how many there were, and
 * the reversal decision is then taken per pair. Every copy between the same
 * two nodes therefore goes the same way, and the component test cannot split
 * them either, since every copy has the same two endpoints and so the same
 * answer. Deciding per edge instead would let one copy of `a -> b` be reversed
 * and another not, which puts a two-cycle back into the supposedly acyclic
 * view, which is the whole thing this exists to prevent.
 *
 * ## Determinism
 *
 * Same graph, same set, always. Vertices are numbered by `graph.nodes()` and
 * arcs are walked in `graph.edges()` order, both of which `@dagr/graph`
 * guarantees to be insertion order, and every intermediate structure here is an
 * array whose contents are placed in one of those two orders. A vertex's
 * collapsed row holds its neighbours in FIRST-OCCURRENCE order over the edges,
 * which is what the insertion-ordered `Map` this used to keep gave and what the
 * stamped collapse below preserves. Buckets are FIFO queues seeded in insertion
 * order, so a tie between two vertices neither of which has moved bucket goes
 * to the one added to the graph first, and a tie involving a vertex that has
 * moved goes to whichever arrived in the bucket first, which is itself fixed by
 * the graph's order. M3 re-runs layout on every patch, and a ranker that
 * resolved a tie differently on a re-run would move nodes the user never
 * touched.
 *
 * Tarjan is deterministic for the same two reasons: roots are tried in vertex
 * number order and each row is walked in first-occurrence order, so the
 * component NUMBERING is fixed and not just the partition. Nothing compares a
 * component number against anything but another component number, and only for
 * equality, so the partition is all that can reach an answer; the numbering is
 * pinned anyway because a number that moved between runs would be a number no
 * later reader could rely on.
 */
export function feedbackArcSet(graph: Graph): ReadonlySet<EdgeId> {
  const nodes = graph.nodes();
  const count = nodes.length;
  // Materialised once and walked three times below, twice through the vertex
  // numbers resolved from it and once for the ids. `graph.edges()` builds a
  // fresh array on every call, and every walk wants the same edges in the same
  // order as the first, so asking again would pay for a copy to be told the
  // same thing.
  const edges = graph.edges();
  const numbers = new Map<NodeId, number>();
  for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

  // The edges by vertex number, parallel to `edges`, with NONE where an edge is
  // not an arc this pass has anything to say about. Resolved once here so that
  // the two walks after this one are array reads rather than two more hash
  // lookups per edge, which is worth about a millisecond on the 10k corpus.
  const arcSource = new Int32Array(edges.length).fill(NONE);
  const arcTarget = new Int32Array(edges.length).fill(NONE);
  const outDegree = new Int32Array(count);
  const inDegree = new Int32Array(count);
  // Every arc that is not a self loop, counted once. Bounds how far a delta can
  // travel in either direction, which is what sizes the bucket array, and it is
  // also the length of the uncollapsed CSR rows.
  let weight = 0;
  for (const [index, edge] of edges.entries()) {
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
    arcSource[index] = source;
    arcTarget[index] = target;
    outDegree[source] = at(outDegree, source) + 1;
    inDegree[target] = at(inDegree, target) + 1;
    weight += 1;
  }

  // The arcs as CSR, one row per vertex, filled in edge order so that a row
  // lists its neighbours in first-occurrence order. Both directions are needed:
  // removing a vertex has to reach the vertices it points at AND the ones that
  // point at it. A `Map` per vertex would collapse parallel arcs as it went and
  // read in the same order, which is what this replaced, at the price of a
  // hash lookup per arc and an allocation per vertex.
  const outStart = new Int32Array(count + 1);
  const inStart = new Int32Array(count + 1);
  for (let vertex = 0; vertex < count; vertex += 1) {
    outStart[vertex + 1] = at(outStart, vertex) + at(outDegree, vertex);
    inStart[vertex + 1] = at(inStart, vertex) + at(inDegree, vertex);
  }
  const outNeighbour = new Int32Array(weight);
  const inNeighbour = new Int32Array(weight);
  const outCursor = outStart.slice(0, count);
  const inCursor = inStart.slice(0, count);
  for (let index = 0; index < edges.length; index += 1) {
    const source = at(arcSource, index);
    const target = at(arcTarget, index);
    if (source === NONE) continue;
    outNeighbour[at(outCursor, source)] = target;
    outCursor[source] = at(outCursor, source) + 1;
    inNeighbour[at(inCursor, target)] = source;
    inCursor[target] = at(inCursor, target) + 1;
  }

  // Which row last claimed a given neighbour, and where in the collapsed output
  // it put it. A stamp rather than a cleared flag array, so the collapse costs
  // one pass over the arcs and not one pass per row.
  const seenBy = new Int32Array(count);
  const seenAt = new Int32Array(count);
  const outWeight = new Int32Array(weight);
  const inWeight = new Int32Array(weight);

  /**
   * Folds each row's parallel arcs into one entry carrying how many there were,
   * rewriting `start` to the collapsed row bounds.
   *
   * In place, and safe in place, because the write cursor never overtakes the
   * read cursor: it advances at most once per arc read and starts each row at
   * or before that row's first arc. First-occurrence order survives because an
   * entry is appended when its neighbour is first seen in the row and only
   * added to afterwards, which is exactly what the insertion-ordered `Map` this
   * replaced did.
   */
  const collapse = (start: Int32Array, neighbour: Int32Array, arcs: Int32Array): void => {
    seenBy.fill(NONE);
    let write = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const from = at(start, vertex);
      const upto = at(start, vertex + 1);
      start[vertex] = write;
      for (let slot = from; slot < upto; slot += 1) {
        const other = at(neighbour, slot);
        if (at(seenBy, other) === vertex) {
          const already = at(seenAt, other);
          arcs[already] = at(arcs, already) + 1;
          continue;
        }
        seenBy[other] = vertex;
        seenAt[other] = write;
        neighbour[write] = other;
        arcs[write] = 1;
        write += 1;
      }
    }
    start[count] = write;
  };

  collapse(outStart, outNeighbour, outWeight);
  collapse(inStart, inNeighbour, inWeight);

  // Tarjan's strongly connected components over the collapsed out-rows,
  // iterative because a 10k-node chain would overflow a recursive one and the
  // overflow would read as a layout failure. `discovery` is a vertex's visit
  // number and NONE means unvisited; `lowest` is the smallest discovery number
  // reachable from its subtree without leaving the stack; a vertex whose two
  // agree is the root of a component, which is then the run of vertices above
  // it on the stack. `frame` is the explicit call stack: which vertex, and how
  // far through its row.
  const componentOf = new Int32Array(count).fill(NONE);
  const discovery = new Int32Array(count).fill(NONE);
  const lowest = new Int32Array(count);
  const onStack = new Int32Array(count);
  const stack = new Int32Array(count);
  const frameVertex = new Int32Array(count);
  const frameSlot = new Int32Array(count);
  let visited = 0;
  let components = 0;
  let stacked = 0;
  let frames = 0;
  for (let root = 0; root < count; root += 1) {
    if (at(discovery, root) !== NONE) continue;
    discovery[root] = visited;
    lowest[root] = visited;
    visited += 1;
    stack[stacked] = root;
    stacked += 1;
    onStack[root] = 1;
    frameVertex[frames] = root;
    frameSlot[frames] = at(outStart, root);
    frames += 1;
    while (frames > 0) {
      const vertex = at(frameVertex, frames - 1);
      const slot = at(frameSlot, frames - 1);
      if (slot < at(outStart, vertex + 1)) {
        frameSlot[frames - 1] = slot + 1;
        const other = at(outNeighbour, slot);
        if (at(discovery, other) === NONE) {
          discovery[other] = visited;
          lowest[other] = visited;
          visited += 1;
          stack[stacked] = other;
          stacked += 1;
          onStack[other] = 1;
          frameVertex[frames] = other;
          frameSlot[frames] = at(outStart, other);
          frames += 1;
        } else if (at(onStack, other) === 1 && at(discovery, other) < at(lowest, vertex)) {
          lowest[vertex] = at(discovery, other);
        }
        continue;
      }
      frames -= 1;
      if (at(lowest, vertex) === at(discovery, vertex)) {
        for (;;) {
          stacked -= 1;
          const member = at(stack, stacked);
          onStack[member] = 0;
          componentOf[member] = components;
          if (member === vertex) break;
        }
        components += 1;
      }
      if (frames > 0) {
        const parent = at(frameVertex, frames - 1);
        if (at(lowest, vertex) < at(lowest, parent)) lowest[parent] = at(lowest, vertex);
      }
    }
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
  const head = new Int32Array(binCount).fill(NONE);
  const tail = new Int32Array(binCount).fill(NONE);
  const next = new Int32Array(count).fill(NONE);
  const previous = new Int32Array(count).fill(NONE);
  const binOf = new Int32Array(count).fill(NONE);
  const removed = new Int32Array(count);
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
   * costed here is charged to a collapsed arc, and each arc is charged once
   * from each end over the whole run, which is where the O(V + E) comes from.
   */
  const take = (bin: number): number => {
    const vertex = at(head, bin);
    unlink(vertex);
    removed[vertex] = 1;
    for (let slot = at(outStart, vertex); slot < at(outStart, vertex + 1); slot += 1) {
      const neighbour = at(outNeighbour, slot);
      if (at(removed, neighbour) === 1) continue;
      inDegree[neighbour] = at(inDegree, neighbour) - at(outWeight, slot);
      reclassify(neighbour);
    }
    for (let slot = at(inStart, vertex); slot < at(inStart, vertex + 1); slot += 1) {
      const neighbour = at(inNeighbour, slot);
      if (at(removed, neighbour) === 1) continue;
      outDegree[neighbour] = at(outDegree, neighbour) - at(inWeight, slot);
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

  const position = new Int32Array(count);
  for (const [place, vertex] of [...heads, ...tails].entries()) position[vertex] = place;

  // Every arc that runs backwards in the order AND stays inside one strongly
  // connected component, taken per edge rather than per collapsed pair, so all
  // copies of a pair are decided together by the one pair of comparisons. A
  // self loop is one of the edges `arcSource` left at NONE, so it is skipped
  // here as it was everywhere else. That skip states the rule rather than doing
  // work, twice over: a self loop's endpoints share a position and could not
  // compare as backward, and they trivially share a component. It is here so
  // that the rule survives a change to either comparison.
  const feedback = new Set<EdgeId>();
  for (const [index, edge] of edges.entries()) {
    const source = at(arcSource, index);
    const target = at(arcTarget, index);
    if (source === NONE) continue;
    if (at(componentOf, source) !== at(componentOf, target)) continue;
    if (at(position, source) > at(position, target)) feedback.add(edge.id);
  }
  return feedback;
}
