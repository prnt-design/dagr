import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';

/**
 * Cycle breaking for the rank stage: a least-squares vertex order, with the
 * backward arcs of that order reversed, scoped to the strongly connected
 * components of the input.
 *
 * The output is a set of edge ids, not a modified graph. Nothing here touches
 * the caller's graph, because not touching it is the pipeline's one hard
 * promise, and the rank stage records the set in `RankedState.reversedEdges`
 * for the router to undo later.
 */

/** The empty end of a list, and the unvisited mark in the components pass. */
const NONE = -1;

/**
 * How far the solver drives the residual down before its answer is taken.
 *
 * Measured rather than picked: the answer stops moving at 1e-3 on both bench
 * corpora and is identical at every tolerance from there down to 1e-12, so this
 * is one step inside the plateau rather than on its edge. See the convergence
 * section of {@link feedbackArcSet}.
 */
const RESIDUAL_TOLERANCE = 1e-4;

/**
 * The most solver iterations any one call may spend.
 *
 * A quality knob and never a correctness one: the solver's output is only ever
 * used to ORDER the vertices, and every linear order yields a legal feedback
 * set, so stopping early returns a worse answer and never a wrong one. Both
 * bench corpora converge well inside it (24 iterations on the 1k, 46 on the
 * 10k), so it is a guard against a pathological spectrum rather than a budget
 * the normal path spends.
 */
const ITERATION_CAP = 200;

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
 * {@link at} for one array type each, which is the whole reason they exist.
 *
 * `at` takes an index signature so that one guard can serve every array in this
 * file, and that makes its argument position MEGAMORPHIC: it is handed
 * `Int32Array`, `Float64Array` and plain arrays, so the engine cannot settle on
 * one shape and every read through it pays for the lookup. That is free
 * everywhere in this module except the solver, which reads through it about
 * seventeen million times on the 10k corpus. These two are the same guard with the
 * argument nailed down to one type each, used only in the loops that are hot.
 */
function atInt(values: Int32Array, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

function atFloat(values: Float64Array, index: number): number {
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
 * Every vertex gets a real-valued height, and the arcs that run downhill in
 * those heights are the feedback set. The heights are the ones minimising
 *
 *     sum over arcs (u, v) of (s(v) - s(u) - 1)^2
 *
 * which is the least-squares statement of "put every target one step below its
 * source". Setting the gradient to zero gives `L s = b`, where `L` is the
 * graph's undirected Laplacian counting parallel arcs with multiplicity and
 * `b(u) = indeg(u) - outdeg(u)`, and that system is solved by a
 * Jacobi-preconditioned conjugate gradient. Exact ties in `s` fall back to
 * vertex number, and the whole order is flipped if that leaves more arcs
 * pointing backwards than forwards; see the bound section.
 *
 * The set returned is those backward arcs whose two endpoints lie in the SAME
 * strongly connected component of the input graph. A backward arc between two
 * components is left pointing the way it was authored: it lies on no cycle, so
 * no cycle needs it turned round, and turning it round only stretches the view
 * the rank stage then has to rank.
 *
 * ## Why least squares rather than greedy
 *
 * This pass used to be the greedy feedback-arc-set heuristic of Eades, Lin and
 * Smyth (1993), usually called GR, which builds its order by repeatedly taking
 * a sink, then a source, then the vertex maximising `outdeg - indeg`. GR is a
 * LOCAL rule: it decides where a vertex goes from that vertex's own degrees and
 * never revisits the decision. On a layered graph that is exactly the
 * information it needs least. M2.2b measured what it cost, and the whole case
 * for this change is one row of that table: on the 10k corpus GR left a view
 * 203 ranks deep on a graph authored with 60 layers, and the depth is paid one
 * dummy node per rank per edge that spans it.
 *
 * Least squares is a GLOBAL rule. Every arc pulls its two endpoints, the
 * solution is the balance of all of them at once, and a handful of arcs
 * pointing the wrong way cannot move a height far because the arcs around it
 * hold it in place. That is what recovers a layering from a graph that has one:
 * the 2% of the 10k corpus authored as back edges are outvoted by the 98% that
 * are not, rather than being taken at face value one vertex at a time.
 *
 * Being a physical analogy rather than a proof, it is not a guarantee, and the
 * numbers below are what it is claimed on.
 *
 * ## What quality actually means here
 *
 * The caller is the rank stage, and what it does with this set is build an
 * acyclic view and rank it. The number it pays for is the TOTAL SPAN of that
 * view, the sum over its edges of `max(0, rank(target) - rank(source) - 1)`,
 * because that is exactly one dummy node per rank an edge crosses beyond the
 * first once M2.4b's splitter exists. The reversal count is a CONSTRAINT and
 * not the objective: a drawing with a third of its edges pointing backwards is
 * not a drawing anyone wants, but between two answers that both read, the one
 * that mints fewer dummies wins. M2.2b's record is the long form of this and it
 * is worth reading before changing anything here, because it is a list of four
 * families of heuristic that cut the reversal count and made span WORSE.
 *
 * The numbers, on the two bench corpora, as reversals / depth / dummies. This
 * pass on the 10k corpus (10,000 nodes, 40,000 edges, 60 authored layers):
 * 857 / 160 / 174,222, against the greedy pass it replaces at
 * 4,620 / 203 / 1,359,680. On the 1k (1,000 nodes, 4,000 edges, 24 authored
 * layers): 40 / 64 / 14,746 against 74 / 81 / 22,726. So it is better on ALL
 * THREE numbers on BOTH corpora, which is the bar M2.2b set for a replacement
 * and is a stronger result than that bar asked for: the bar allowed depth to
 * stay where it was and only required span to fall.
 *
 * The target it does not reach is still the ground truth, reversing exactly the
 * edges the corpus generator authored as back edges, which is knowledge no
 * cycle breaker has: 796 / 60 / 32,050 on the 10k. So the gap has gone from a
 * factor of forty-two to a factor of five, and the remaining five is depth. A
 * view 160 ranks deep on 60 authored layers still stretches every long edge in
 * it, and closing that is the next thing worth measuring here.
 *
 * ## What was measured beside it and NOT taken
 *
 * Recorded so the next reader does not spend a run rediscovering them. All
 * figures under `longestPathRanks` on the 10k, as reversals / depth / dummies.
 *
 * DROPPING THE COMPONENT RULE, which is to say reversing every backward arc of
 * the same least-squares order: 1,117 / 124 / 128,141, and 110 / 39 / 8,388 on
 * the 1k. That is 26% LESS span than what ships, at 30% more reversals, and it
 * is the one row here that beats the shipping choice on the stated objective.
 * It is not taken because the component rule is a shipped property with a proof
 * and a test of its own (`layout.cycles.quality.test.ts` calls a violation of
 * it a bug and not a trade), and swapping the core heuristic is already one
 * decision. Taking it is a one-line change and a deliberate one, not a tuning
 * pass: it means accepting that some edges are drawn backwards when no cycle
 * required it, in exchange for a quarter of the dummy nodes.
 *
 * A HINGE OBJECTIVE, charging `max(0, s(u) + 1 - s(v))^2` so that a long
 * forward arc costs nothing and only a backward or too-short arc is penalised,
 * relaxed from the least-squares answer. At 1,024 rounds it reaches
 * 664 / 117 / 101,146 unscoped, the best row anything here produced. IT IS NOT
 * TAKEN, and the reason is the lesson M2.2b already wrote down about quoting a
 * budget beside a figure: that row is its best point and not its converged one.
 * At 4,096 rounds the same relaxation is 594 / 140 / 127,695 and at 16,384 it
 * is 485 / 184 / 186,856, so it degrades monotonically towards the shipping
 * greedy pass as it converges. A candidate that wins only at a truncated
 * iteration budget has not won, and 1,024 is a number tuned to this corpus. It
 * is a lead, and what would make it a result is a stopping rule that is about
 * the graph rather than about the count.
 *
 * ## Why scoping to components is safe
 *
 * A proof rather than a measurement, because the neighbouring rule that looks
 * like it is a measurement and is false. Let sigma be any linear order of the
 * vertices, and reverse exactly the arcs (u, v) with sigma(v) < sigma(u) and u
 * and v in one strongly connected component of the INPUT graph. The view
 * `acyclic.ts` builds from that result is acyclic. Nothing in the argument
 * mentions how sigma was built, which is why it survived this module's change
 * of heuristic unaltered. The claim is about the VIEW rather than about the
 * graph with the set applied, because the view drops self loops and a self loop
 * is the one cycle no reversal can break; see Self loops below. Suppose the
 * view holds a cycle C. Every arc of C therefore has two distinct endpoints.
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
 * condensation, the DAG of components, which is what makes that DAG a DAG. So
 * the component index never falls along C and rises at least once, and again C
 * cannot close.
 *
 * This does NOT contradict the four-node witness M2.2b records, `u->v, v->a,
 * a->b, b->a, u->b` with components {a, b}, {u} and {v}. That witness refutes
 * dropping SOME cross-component reversals while keeping others, not dropping
 * the whole class at once, which is what the paragraphs above prove. The
 * witness is in `layout.cycles.test.ts` with that reading beside it.
 *
 * ## The `m/2` bound, and how it survives
 *
 * The old pass inherited a bound from its paper: GR's greedy pick always has
 * `indeg <= outdeg`, so it never adds more backward arcs than forward ones, and
 * `|F| <= m/2` fell out of that. Least squares proves nothing of the kind. Its
 * order comes from a numerical solve, and there are graphs where the solve is
 * degenerate and the order it produces is close to the worst one available: a
 * directed cycle whose vertices were added in the order that walks it backwards
 * has `indeg == outdeg` at every vertex, so `b` is zero everywhere, every
 * height ties at zero, the tie break hands back insertion order, and every arc
 * but one runs backwards in it.
 *
 * So the bound is restored by construction rather than inherited. The backward
 * arcs of an order and the backward arcs of its REVERSE partition the arcs
 * between them, since an arc runs backwards in exactly one of the two, so the
 * smaller of those two sets is at most `m/2`. This pass counts the backward
 * arcs, flips the order when that count is more than half, and takes the
 * smaller side. The bound is then exact and unconditional, and the component
 * rule only takes arcs OUT of the set it bounds, so the returned set is a
 * subset of a set already under `m/2`.
 *
 * The flip is not defensive padding for a case that cannot arise. The backwards
 * cycle above is the case, it is small enough to check by eye, and it is in
 * `layout.cycles.test.ts`: without the flip that graph reverses `n - 1` of its
 * `n` arcs and with it exactly one.
 *
 * As before, the bound is a real guarantee about the wrong quantity. Half the
 * edges reversed is not a drawing anyone would accept, so nothing is ever
 * ACTUALLY close to it: measured, this pass reverses 2.1% of the 10k corpus's
 * arcs and 1.0% of the 1k's. It is kept because it is what rules out the
 * degenerate answer entirely, not because it is tight.
 *
 * ## Convergence
 *
 * Conjugate gradient on `L s = b`, preconditioned by the diagonal of `L`, which
 * is each vertex's degree. `L` is singular, its null space being a constant per
 * WEAKLY connected component, and the system is consistent because `b` sums to
 * zero over each of those components. The null direction is harmless twice
 * over: conjugate gradient never leaves the subspace its residual starts in,
 * and a constant added to one weakly connected component cannot change the
 * comparison across any arc, because an arc has both endpoints in one such
 * component.
 *
 * The stopping rule is a residual tolerance rather than an iteration count, and
 * the difference matters for the reason the hinge row above is not taken: a
 * count is tuned to a corpus and a tolerance is a statement about the solve.
 * Measured, the answer is IDENTICAL at every tolerance from 1e-3 to 1e-12 on
 * both corpora, so {@link RESIDUAL_TOLERANCE} sits inside a plateau rather than
 * on a cliff. It takes 24 iterations on the 1k and 46 on the 10k.
 *
 * Convergence is a quality knob and never a correctness one. The heights are
 * only ever used to sort the vertices, every linear order gives a legal
 * feedback set, and so an early stop at {@link ITERATION_CAP} returns a worse
 * answer rather than a wrong one. That is worth stating because it is what
 * makes a numerical method acceptable in a pass whose output has to be exactly
 * right.
 *
 * ## Complexity
 *
 * O(V + E) space, and O(k(V + E) + V log V) time for k solver iterations. The
 * passes are one walk of `graph.edges()` for the degrees and the right-hand
 * side, a second to fill the CSR rows, one linear collapse of parallel arcs per
 * row, one Tarjan over the collapsed rows, k solver iterations each walking the
 * arcs once, one sort of the vertices by height, and one final walk of the
 * edges to collect the set. Tarjan runs over the COLLAPSED rows, so a pair with
 * k parallel arcs between it is traversed once rather than k times.
 *
 * It costs more than the pass it replaces, and the trade is deliberate. On the
 * 10k corpus this call is about twice the greedy one, and it removes about 1.19
 * million dummy nodes from everything downstream of it. M2.4b measured what
 * those cost when they existed: 5.2 seconds and 735MB on a pipeline that runs
 * in about 30ms without them. A cycle breaker is not the place to save
 * milliseconds at the price of dummies.
 *
 * `graph.edges()` is walked once into a materialised array and that array is
 * then walked several times, for the reason the old pass did the same: every
 * walk wants the same edges in the same order as the first, so asking the graph
 * again would pay for a copy to be told the same thing.
 *
 * ## Self loops
 *
 * A self loop is never in the set. Reversing it cannot help, since it is a
 * cycle whichever way it points, and the pipeline already tolerates it: the
 * runner's rank check compares endpoint ranks with `<=` precisely so that both
 * ends of a self loop may share a rank. A loop is a cycle, so its vertex is in
 * a component with itself and would pass the component test, but it never
 * reaches that test: it is skipped when the arcs are numbered, so it is absent
 * from the degrees, from the right-hand side, from the rows and from the final
 * collection. Leaving it in would be wrong and not merely wasteful, because it
 * contributes `(s(v) - s(v) - 1)^2` to the objective, a constant the solve
 * cannot reduce, while adding two to its vertex's degree and so damping every
 * real arc attached to it.
 *
 * ## Parallel edges
 *
 * The reversal decision is taken per ordered PAIR and not per edge, because it
 * is taken by comparing the two endpoints' positions and every copy of a pair
 * has the same two endpoints. Deciding per edge instead would let one copy of
 * `a -> b` be reversed and another not, which puts a two-cycle back into the
 * supposedly acyclic view, which is the whole thing this exists to prevent.
 * Under the greedy pass this needed a weighted collapse to arrange; here it is
 * a property of the rule.
 *
 * Copies do count in the solve, once each. Two copies of `a -> b` pull their
 * endpoints twice as hard as one, which is the right answer for the same reason
 * `acyclic.ts` keeps both: M2.4b mints a dummy per copy per rank spanned, so
 * the second copy costs exactly what the first one does.
 *
 * ## Determinism
 *
 * Same graph, same set, always. Vertices are numbered by `graph.nodes()` and
 * arcs are walked in `graph.edges()` order, both of which `@dagr/graph`
 * guarantees to be insertion order, and every intermediate structure here is an
 * array whose contents are placed in one of those two orders. The solve is
 * floating point but it is not therefore unpredictable: every operation is an
 * IEEE-754 double operation in an order this file fixes, with no transcendental
 * function anywhere in it, so it gives the same bits on every engine. The sort
 * that turns heights into an order compares height first and vertex number
 * second, which is a total order with no ties left in it, so it does not depend
 * on the sort being stable. M3 re-runs layout on every patch, and a breaker
 * that resolved a tie differently on a re-run would move nodes the user never
 * touched.
 *
 * BE PRECISE ABOUT WHAT THE VERTEX-NUMBER TIE BREAK ACTUALLY DECIDES, because
 * the loose reading of it is wrong and it is worth knowing which. It settles
 * EXACT equality of two doubles and nothing else. Two vertices that are
 * structurally interchangeable, the two ends of a two-cycle hanging off one
 * place in the graph being the smallest example, have equal heights in exact
 * arithmetic and do NOT generally come out of the solve as equal doubles: on
 * the seven-node witness in `layout.cycles.test.ts` they land at
 * -1.6999999999999995 and -1.6999999999999997, so the last bit of an iterative
 * solve is what puts one before the other. That is reproducible, which is the
 * property M3 needs, and it is arbitrary, which is worth saying rather than
 * implying that the tie break governs it. It costs nothing in quality, since
 * the two orders of a pair of interchangeable vertices are equally good by
 * construction, and it is why the witnesses in the test suite quote the arcs
 * that come out reversed rather than the heights that decided them. What it
 * does mean is that a change to the solver or to its tolerance can reorder such
 * a pair, so a pinned set moving on a graph with symmetric parts is a weaker
 * signal than a pinned set moving on one without.
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
  const edges = graph.edges();
  const numbers = new Map<NodeId, number>();
  for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

  // The edges by vertex number, parallel to `edges`, with NONE where an edge is
  // not an arc this pass has anything to say about. Resolved once here so that
  // every later walk is an array read rather than two more hash lookups.
  const arcSource = new Int32Array(edges.length).fill(NONE);
  const arcTarget = new Int32Array(edges.length).fill(NONE);
  // Degree counts parallel arcs with multiplicity, because the objective sums
  // over arcs. It is the diagonal of the Laplacian and so the preconditioner.
  const degree = new Float64Array(count);
  // `b(u) = indeg(u) - outdeg(u)`, the right-hand side of `L s = b`.
  const load = new Float64Array(count);
  const outDegree = new Int32Array(count);
  let arcCount = 0;
  for (const [index, edge] of edges.entries()) {
    const source = numbers.get(edge.source);
    const target = numbers.get(edge.target);
    // Unreachable: an edge's endpoints are always nodes of the graph.
    if (source === undefined || target === undefined) continue;
    if (source === target) continue;
    arcSource[index] = source;
    arcTarget[index] = target;
    degree[source] = at(degree, source) + 1;
    degree[target] = at(degree, target) + 1;
    load[source] = at(load, source) - 1;
    load[target] = at(load, target) + 1;
    outDegree[source] = at(outDegree, source) + 1;
    arcCount += 1;
  }

  const componentOf = stronglyConnected(count, arcCount, arcSource, arcTarget, outDegree);
  const height = solveHeights(count, arcSource, arcTarget, degree, load);
  const position = orderBy(height);

  // The order or its reverse, whichever leaves fewer arcs pointing backwards.
  // An arc runs backwards in exactly one of the two, so the smaller side is at
  // most half of them, which is the bound the docblock restores by doing this.
  let backward = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const source = at(arcSource, index);
    if (source === NONE) continue;
    if (at(position, source) > at(position, at(arcTarget, index))) backward += 1;
  }
  const flipped = backward * 2 > arcCount;

  // Every arc that runs backwards in the chosen order AND stays inside one
  // strongly connected component. A self loop is one of the edges `arcSource`
  // left at NONE, so it is skipped here as it was everywhere else. That skip
  // states the rule rather than doing work, twice over: a self loop's endpoints
  // share a position and could not compare as backward, and they trivially
  // share a component. It is here so that the rule survives a change to either
  // comparison.
  const feedback = new Set<EdgeId>();
  for (const [index, edge] of edges.entries()) {
    const source = at(arcSource, index);
    if (source === NONE) continue;
    const target = at(arcTarget, index);
    if (at(componentOf, source) !== at(componentOf, target)) continue;
    const runsBackward = at(position, source) > at(position, target);
    if (runsBackward !== flipped) feedback.add(edge.id);
  }
  return feedback;
}

/**
 * The heights minimising the sum over arcs of `(s(target) - s(source) - 1)^2`,
 * by conjugate gradient on `L s = b` preconditioned by the diagonal of `L`.
 *
 * See {@link feedbackArcSet} for why the singular `L` is harmless and why an
 * unconverged answer is a quality loss rather than a correctness one.
 */
function solveHeights(
  count: number,
  arcSource: Int32Array,
  arcTarget: Int32Array,
  degree: Float64Array,
  load: Float64Array,
): Float64Array {
  const height = new Float64Array(count);
  const residual = Float64Array.from(load);
  const preconditioned = new Float64Array(count);
  const direction = new Float64Array(count);
  const applied = new Float64Array(count);

  const precondition = (): void => {
    for (let vertex = 0; vertex < count; vertex += 1) {
      const scale = atFloat(degree, vertex);
      preconditioned[vertex] = scale === 0 ? 0 : atFloat(residual, vertex) / scale;
    }
  };

  precondition();
  direction.set(preconditioned);
  let residualDotPreconditioned = 0;
  let residualNorm = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    residualDotPreconditioned += atFloat(residual, vertex) * atFloat(preconditioned, vertex);
    residualNorm += atFloat(residual, vertex) * atFloat(residual, vertex);
  }
  const target = RESIDUAL_TOLERANCE * RESIDUAL_TOLERANCE * residualNorm;

  for (let step = 0; step < ITERATION_CAP; step += 1) {
    if (residualNorm <= target || residualDotPreconditioned <= 0) break;

    // `L p`, assembled arc by arc: the Laplacian's action on a vector is the
    // sum over arcs of the endpoint difference, added at one end and subtracted
    // at the other. Never materialised as a matrix, which on the 10k corpus
    // would be a hundred million entries to hold ten thousand rows.
    applied.fill(0);
    for (let index = 0; index < arcSource.length; index += 1) {
      const source = atInt(arcSource, index);
      if (source === NONE) continue;
      const targetVertex = atInt(arcTarget, index);
      const difference = atFloat(direction, source) - atFloat(direction, targetVertex);
      applied[source] = atFloat(applied, source) + difference;
      applied[targetVertex] = atFloat(applied, targetVertex) - difference;
    }

    let curvature = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      curvature += atFloat(direction, vertex) * atFloat(applied, vertex);
    }
    // Zero curvature means the direction lies in the null space, which is the
    // constant per weakly connected component. There is no descent left along
    // it and the step would divide by zero.
    if (curvature <= 0) break;

    const stepSize = residualDotPreconditioned / curvature;
    residualNorm = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      height[vertex] = atFloat(height, vertex) + stepSize * atFloat(direction, vertex);
      const updated = atFloat(residual, vertex) - stepSize * atFloat(applied, vertex);
      residual[vertex] = updated;
      residualNorm += updated * updated;
    }

    precondition();
    let next = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      next += atFloat(residual, vertex) * atFloat(preconditioned, vertex);
    }
    const decay = next / residualDotPreconditioned;
    for (let vertex = 0; vertex < count; vertex += 1) {
      direction[vertex] = atFloat(preconditioned, vertex) + decay * atFloat(direction, vertex);
    }
    residualDotPreconditioned = next;
  }

  return height;
}

/**
 * The position of every vertex in the order the heights put them in, ties
 * broken by vertex number.
 *
 * The comparator is a total order with no ties left in it, so this does not
 * rest on the sort being stable, and the tie break is vertex number rather than
 * anything structural because vertex number is graph insertion order and
 * insertion order is what every other tie break in the layout package is
 * stated against.
 */
function orderBy(height: Float64Array): Int32Array {
  const count = height.length;
  const order = Array.from({ length: count }, (unused, index) => index);
  order.sort((left, right) => {
    const difference = at(height, left) - at(height, right);
    if (difference !== 0) return difference;
    return left - right;
  });
  const position = new Int32Array(count);
  for (const [place, vertex] of order.entries()) position[vertex] = place;
  return position;
}

/**
 * Tarjan's strongly connected components, as a component number per vertex.
 *
 * Iterative because a 10k-node chain would overflow a recursive one and the
 * overflow would read as a layout failure. `discovery` is a vertex's visit
 * number and NONE means unvisited; `lowest` is the smallest discovery number
 * reachable from its subtree without leaving the stack; a vertex whose two
 * agree is the root of a component, which is then the run of vertices above it
 * on the stack. `frame` is the explicit call stack: which vertex, and how far
 * through its row.
 *
 * It walks CSR rows with each vertex's parallel arcs collapsed to one entry, so
 * a pair with k arcs between it is traversed once rather than k times. The
 * collapse keeps first-occurrence order, which is what fixes the component
 * numbering as well as the partition.
 */
function stronglyConnected(
  count: number,
  arcCount: number,
  arcSource: Int32Array,
  arcTarget: Int32Array,
  outDegree: Int32Array,
): Int32Array {
  const start = new Int32Array(count + 1);
  for (let vertex = 0; vertex < count; vertex += 1) {
    start[vertex + 1] = at(start, vertex) + at(outDegree, vertex);
  }
  const cursor = start.slice(0, count);
  const neighbour = new Int32Array(arcCount);
  for (let index = 0; index < arcSource.length; index += 1) {
    const source = at(arcSource, index);
    if (source === NONE) continue;
    neighbour[at(cursor, source)] = at(arcTarget, index);
    cursor[source] = at(cursor, source) + 1;
  }

  // Folds each row's parallel arcs into one entry, rewriting `start` to the
  // collapsed bounds. In place, and safe in place, because the write cursor
  // never overtakes the read cursor: it advances at most once per arc read and
  // starts each row at or before that row's first arc. A stamp rather than a
  // cleared flag array, so this costs one pass over the arcs and not one pass
  // per row.
  const seenBy = new Int32Array(count).fill(NONE);
  let write = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const from = at(start, vertex);
    const upto = at(start, vertex + 1);
    start[vertex] = write;
    for (let slot = from; slot < upto; slot += 1) {
      const other = at(neighbour, slot);
      if (at(seenBy, other) === vertex) continue;
      seenBy[other] = vertex;
      neighbour[write] = other;
      write += 1;
    }
  }
  start[count] = write;

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
    frameSlot[frames] = at(start, root);
    frames += 1;
    while (frames > 0) {
      const vertex = at(frameVertex, frames - 1);
      const slot = at(frameSlot, frames - 1);
      if (slot < at(start, vertex + 1)) {
        frameSlot[frames - 1] = slot + 1;
        const other = at(neighbour, slot);
        if (at(discovery, other) === NONE) {
          discovery[other] = visited;
          lowest[other] = visited;
          visited += 1;
          stack[stacked] = other;
          stacked += 1;
          onStack[other] = 1;
          frameVertex[frames] = other;
          frameSlot[frames] = at(start, other);
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
  return componentOf;
}
