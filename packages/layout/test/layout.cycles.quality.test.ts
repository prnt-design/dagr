import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { acyclicView, longestPathRanks } from '../src/acyclic.js';
import { feedbackArcSet } from '../src/cycles.js';
import type { EdgeId, NodeId } from '@dagr/graph';
import type { GraphSpec } from '@dagr/bench';

/**
 * What a cycle breaker is actually being asked to minimise.
 *
 * The project's memory recorded the cycle breaker as the blocker for M2.4b
 * (dummy-node chains) with a prescribed target of cutting the reversal count on
 * the 10k corpus from about six thousand to about eight hundred. That
 * prescription names the wrong number. M2.4b mints one dummy node per rank an
 * edge spans beyond the first, so what it pays for is the TOTAL EDGE SPAN of the
 * acyclic view, and the reversal count does not predict it: the cheapest feedback
 * set to state is often the one that stretches the view into a long thin chain,
 * and a stretched view is a dummy explosion.
 *
 * Stated precisely, because the loose version of this claim is wrong and was
 * caught being wrong twice while this file was written. DEPTH runs against the
 * reversal count across every HEURISTIC measured, on both corpora: DFS back
 * edges reverse 42 against the unscoped pass's 422 on the 1k and 1,651 against
 * 6,327 on the 10k, and are 86% and 290% deeper respectively. The exception is
 * reversing the corpus's authored back edges, which is fewer reversals AND
 * shallower on both corpora (71 at depth 24, and 796 at depth 60), and which is
 * not an algorithm: it reads the generator's own layer assignment, and no cycle
 * breaker has a counterpart it could compute. SPAN follows depth on the 10k
 * corpus, where those 1,651 reversals cost 1,601,415 dummies against the
 * unscoped pass's 1,414,263, and does NOT on the 1k, where the same swap saves
 * span (30,954 against 40,430). The 10k corpus is the one that decides it,
 * because M2.4b, M2.9, M3.9 and M4.10 all measure against that size. Existing
 * assertions see none of this: `layout.cycles.test.ts` checks that the set is
 * legal, minimal-ish against `m/2`, and reproducible, all of which a
 * catastrophically deep answer passes.
 *
 * So this file measures the triple that matters (reversals, depth, total span)
 * and pins it, on hand-built witnesses first and then on both bench corpora. The
 * witnesses are the argument: they show, on objects small enough to check by
 * eye, that a STRICTLY SMALLER feedback set can produce a STRICTLY DEEPER view
 * with STRICTLY MORE span. The corpus pins are the guard: they make any change
 * to `cycles.ts` show up here as a diff in three numbers rather than silently.
 *
 * What ships is that greedy order with its cross-component reversals dropped,
 * which is M2.2b's bar row: 74 reversals, depth 81 and 22,726 dummies on the
 * 1k, and 4,620, depth 203 and 1,359,680 on the 10k. So this file now asserts a
 * target as well as a pin. The CEILINGS below are what the algorithm promises
 * and are what M2.2b asks for; the exact pins beside them are what it currently
 * does. The two say different things and a change that moves one without the
 * other is the interesting case, which is why neither replaces the other.
 */

/**
 * An entry of one of this file's own arrays, which is always present because
 * every index is a node or edge number `acyclicView` minted. Mirrors the guard
 * in `acyclic.ts` for the same reason: under `noUncheckedIndexedAccess` the
 * alternative is arithmetic on `undefined` that quietly reads as `NaN`, and a
 * `NaN` total span would compare unequal to everything and blame the wrong line.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`no entry at index ${String(index)}`);
  return value;
}

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string, string])[]) {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/**
 * An order-sensitive FNV-1a hash of a corpus, which is how a failure below says
 * WHICH thing changed.
 *
 * The pins further down are exact numbers taken from a generated graph, so they
 * have three ways to fail and only two of them are about the cycle breaker.
 * Either `cycles.ts` now answers differently, or `acyclic.ts` does (all three
 * pinned numbers are functions of `acyclicView` and `longestPathRanks` as well,
 * so the self-loop rule, the parallel-edge rule and the ranking sweep each move
 * `depth` and `totalSpan` without `cycles.ts` being touched at all), or the
 * corpus itself is not the same graph on this machine, in which case the pins
 * are measuring a different input rather than a different algorithm. This hash
 * separates the third cause from the first two and does NOT separate the first
 * two from each other: for that, look at whether `layout.cycles.test.ts`
 * (legality, `m/2`, reproducibility) moved with them. The third is
 * not hypothetical: `layeredDag` assigns a node's layer with `random() ** 1.4`,
 * and `Math.pow` is not required by the language to be correctly rounded, so two
 * engines may legitimately disagree in the last bit and land a node in a
 * different layer. This hash is built from integer operations only (`Math.imul`
 * and xor, and `hash ^ x` forces ToInt32), so it cannot disagree for that reason
 * itself, and it is asserted FIRST. If this test fails and the quality tests
 * fail with it, read this one: the graph moved, the code did not, and nothing
 * below is evidence about the cycle breaker at all.
 *
 * The node ids contribute a constant, since `layeredDag` always emits
 * `n00000..` in order however the layers fall. All the signal is in the edge
 * pairs. They are hashed anyway so that a change to the id scheme is caught too.
 */
function fingerprint(spec: GraphSpec): string {
  let hash = 0x81_1c_9d_c5;
  const mix = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 0x01_00_01_93);
    }
  };
  for (const id of spec.nodes) mix(id);
  for (const [source, target] of spec.edges) {
    mix(source);
    mix('>');
    mix(target);
  }
  return (hash >>> 0).toString(16);
}

/** A bench corpus as a `Graph`, built the way `bench/layout.bench.ts` builds it. */
function fromSpec(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/**
 * The strongly connected components of a graph, as a component number per node.
 *
 * KOSARAJU, and deliberately not Tarjan: one depth-first pass over the forward
 * arcs for a finishing order, then one pass over the reversed arcs taking the
 * latest unassigned finisher as each root. `cycles.ts` computes the same
 * partition with Tarjan, and a checker sharing an implementation with the thing
 * it checks carries the same bug and turns the assertion into a no-op. That is
 * the same reason `referenceTopologicalOrder` in `layout.cycles.test.ts` is a
 * three-colour depth-first search against `longestPathRanks`'s Kahn sweep.
 *
 * The two methods fail in different places, which is the point. Tarjan's
 * partition hangs on the `onStack` guard in its back-edge case: drop it and a
 * cross edge lowers a lowlink, which OVER-MERGES components. Kosaraju has no
 * lowlink to lower; it can only be wrong by taking the second pass's roots in
 * the wrong order, which is a different mistake in a different line.
 *
 * Iterative rather than recursive, because the 10k corpus is deep enough that a
 * recursive walk would overflow and the overflow would read as a test failure
 * about the cycle breaker.
 *
 * Numbers, not sets, so a caller compares two nodes with `===` and never has to
 * hold a component to compare against. Self loops are irrelevant to it: they
 * neither create nor merge components.
 */
function kosarajuComponents(graph: Graph): Map<NodeId, number> {
  const successors = new Map<NodeId, NodeId[]>();
  const predecessors = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes()) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }
  for (const edge of graph.edges()) {
    successors.get(edge.source)?.push(edge.target);
    predecessors.get(edge.target)?.push(edge.source);
  }

  // Pass one: push a vertex once every one of its successors is done, so the
  // last vertex out is in a source component of the component DAG.
  const finished: NodeId[] = [];
  const entered = new Set<NodeId>();
  for (const root of graph.nodes()) {
    if (entered.has(root.id)) continue;
    entered.add(root.id);
    const stack: { readonly id: NodeId; next: number }[] = [{ id: root.id, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const outgoing = successors.get(frame.id) ?? [];
      if (frame.next >= outgoing.length) {
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const successor = outgoing[frame.next];
      frame.next += 1;
      if (successor === undefined || entered.has(successor)) continue;
      entered.add(successor);
      stack.push({ id: successor, next: 0 });
    }
  }

  // Pass two: walking BACKWARDS from the latest unassigned finisher reaches
  // exactly the vertices that can also reach it, which is exactly its
  // component.
  const component = new Map<NodeId, number>();
  let components = 0;
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const root = finished[index];
    if (root === undefined || component.has(root)) continue;
    component.set(root, components);
    const stack: NodeId[] = [root];
    while (stack.length > 0) {
      const vertex = stack.pop();
      if (vertex === undefined) break;
      for (const other of predecessors.get(vertex) ?? []) {
        if (component.has(other)) continue;
        component.set(other, components);
        stack.push(other);
      }
    }
    components += 1;
  }
  return component;
}

/** The three numbers a cycle breaker's answer costs downstream. */
interface Quality {
  /**
   * How many edges the router will have to draw against their stated direction.
   * The size of the set itself: `feedbackArcSet` never puts a self loop in it,
   * so counting the set is counting real reversals.
   */
  readonly reversals: number;

  /** Occupied ranks, counting from rank 0. This is `max(ranks) + 1`. */
  readonly depth: number;

  /**
   * Exactly how many dummy nodes M2.4b's splitter will mint for this view: an
   * edge between ranks r and s > r passes through the s - r - 1 ranks strictly
   * between them and needs a dummy on each.
   */
  readonly totalSpan: number;
}

/**
 * Measures a graph under a proposed set of reversals.
 *
 * Test-only on purpose. It is a statement about what the pipeline will cost, not
 * a step the pipeline takes, so exporting it from `src` would put a number
 * nothing consumes into the published surface. It is built from the production
 * view and the production ranker, though, because the point is to measure the
 * view the ranker will really be handed, not a re-derivation of it.
 *
 * It throws, via `longestPathRanks`, if reversing the given set does not leave a
 * DAG. Callers below lean on that: measuring a proposed set at all is the
 * assertion that the set is legal.
 */
function measure(graph: Graph, reversed: ReadonlySet<EdgeId>): Quality {
  const view = acyclicView(graph, reversed);
  const ranks = longestPathRanks(view);

  let deepest = 0;
  for (const rank of ranks) {
    if (rank > deepest) deepest = rank;
  }

  let totalSpan = 0;
  for (let edge = 0; edge < view.from.length; edge += 1) {
    const source = at(ranks, at(view.from, edge));
    const target = at(ranks, at(view.to, edge));
    totalSpan += Math.max(0, target - source - 1);
  }

  return { reversals: reversed.size, depth: deepest + 1, totalSpan };
}

/**
 * A six-cycle, `v0 -> v1 -> ... -> v5 -> v0`.
 *
 * The smallest object this file needs, and the one that carries its argument.
 * Every vertex has one arc in and one out, so the greedy breaker sees no sink,
 * no source, and a delta of zero everywhere, takes `v0` off the front of the
 * FIFO delta bucket, and then unzips the rest as a run of sinks. The order it
 * lands on is `v0 ... v5` and the one backward arc is `v5 -> v0`.
 */
function sixCycle(): Graph {
  return build(
    ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'],
    [
      ['v0', 'v1', 'e01'],
      ['v1', 'v2', 'e12'],
      ['v2', 'v3', 'e23'],
      ['v3', 'v4', 'e34'],
      ['v4', 'v5', 'e45'],
      ['v5', 'v0', 'e50'],
    ],
  );
}

describe('acyclic view quality on hand-built witnesses', () => {
  // The whole reason this file exists, on six nodes.
  //
  // Cutting the six-cycle at one arc leaves a path: the view is
  // `v0 -> v1 -> ... -> v5` plus the reversed arc now running `v0 -> v5`.
  // Ranks are 0,1,2,3,4,5, so depth is 6, and the reversed arc jumps five ranks
  // and mints four dummies while every other arc is short and mints none.
  //
  // Cutting it at three alternating arcs leaves `v0 -> v1 <- v2 -> v3 <- v4 ->
  // v5 <- v0`. Ranks are 0 for v0, v2 and v4 and 1 for v1, v3 and v5, so depth
  // is 2, every arc is short, and the whole view mints nothing at all.
  //
  // So the SMALLER set is three times deeper and infinitely more expensive in
  // dummies. Both are legal: `measure` ranks each one and would throw if either
  // left a cycle. And the small deep one is not a straw man, it is what ships:
  // the assertion below pins that `feedbackArcSet` picks exactly it.
  it('lets a strictly smaller feedback set be strictly deeper and cost more span', () => {
    const graph = sixCycle();

    const oneArc = measure(graph, new Set<EdgeId>(['e50']));
    const threeArcs = measure(graph, new Set<EdgeId>(['e12', 'e34', 'e50']));

    expect(oneArc).toEqual({ reversals: 1, depth: 6, totalSpan: 4 });
    expect(threeArcs).toEqual({ reversals: 3, depth: 2, totalSpan: 0 });

    // Stated as comparisons as well as as values, because the values are the
    // evidence and these three lines are the claim being made from it.
    expect(oneArc.reversals).toBeLessThan(threeArcs.reversals);
    expect(oneArc.depth).toBeGreaterThan(threeArcs.depth);
    expect(oneArc.totalSpan).toBeGreaterThan(threeArcs.totalSpan);

    // And the shipping breaker chooses the small, deep, expensive one.
    expect([...feedbackArcSet(graph)]).toEqual(['e50']);
    expect(measure(graph, feedbackArcSet(graph))).toEqual(oneArc);
  });

  // Total span is not a proxy for anything, it is a count of objects M2.4b will
  // allocate. An edge whose endpoints sit k ranks apart passes through k - 1
  // ranks on the way and needs one dummy on each, so k = 1 costs nothing and
  // every rank after that costs one. The chain fixes the ranks (a chain of k + 1
  // nodes occupies ranks 0..k) and the extra arc from the first node to the last
  // is the one being priced; at k = 1 it is a parallel copy of the chain's only
  // arc, which is the case that pins the "adjacent ranks are free" end.
  it('prices an edge spanning k ranks at exactly k - 1 dummies', () => {
    for (const k of [1, 2, 3, 4, 5]) {
      const nodes = Array.from({ length: k + 1 }, (unused, index) => `n${String(index)}`);
      const edges: [string, string, string][] = [];
      for (let index = 0; index < k; index += 1) {
        edges.push([`n${String(index)}`, `n${String(index + 1)}`, `chain${String(index)}`]);
      }
      edges.push(['n0', `n${String(k)}`, 'long']);

      expect(measure(build(nodes, edges), new Set<EdgeId>()), `k = ${String(k)}`).toEqual({
        reversals: 0,
        depth: k + 1,
        totalSpan: k - 1,
      });
    }
  });

  // A self loop is invisible to all three numbers, from both ends. `acyclicView`
  // drops it, because a node cannot be below itself and counting one would give
  // its node an in-degree the ranking sweep could never clear; and `cycles.ts`
  // never puts one in the feedback set, because reversing a loop leaves it a
  // loop.
  //
  // What this pins, stated exactly, because the first draft of this comment
  // claimed more and algorithms-review killed it by mutation. It pins the two
  // DROP RULES: that `acyclicView` removes the loop before any measurement sees
  // it, and that `feedbackArcSet` declines to put one in the set. It does NOT
  // pin the `max(0, ...)` clamp in `measure`. That clamp is unreachable from
  // this file: every edge that survives into a view has `rank(target) >=
  // rank(source) + 1`, because `longestPathRanks` settles a node only after
  // every predecessor and relaxes each edge by at least one. Deleting the clamp
  // leaves all of these tests passing, which was verified. The clamp stays as a
  // guard for the one caller that could reach it, `longestPathRanks` with a
  // `floor` that puts a target below its source, which is the simplex warm-start
  // path and is tested in `layout.simplex.test.ts` rather than here.
  it('lets a self loop cost nothing in reversals, depth or span', () => {
    const plain = sixCycle();
    const looped = build(
      ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'],
      [
        ['v0', 'v0', 'loop0'],
        ['v0', 'v1', 'e01'],
        ['v1', 'v2', 'e12'],
        ['v2', 'v3', 'e23'],
        ['v3', 'v3', 'loop3'],
        ['v3', 'v4', 'e34'],
        ['v4', 'v5', 'e45'],
        ['v5', 'v0', 'e50'],
        ['v5', 'v5', 'loop5'],
      ],
    );

    // The view half: hand the same feedback set to both graphs, so the only
    // difference between them is the three loops.
    const chosen = new Set<EdgeId>(['e50']);
    expect(measure(looped, chosen)).toEqual(measure(plain, chosen));

    // The breaker half: it declines to reverse a loop, so the reversal count is
    // untouched too, and the triple is the six-cycle's triple exactly.
    expect([...feedbackArcSet(looped)]).toEqual(['e50']);
    expect(measure(looped, feedbackArcSet(looped))).toEqual({
      reversals: 1,
      depth: 6,
      totalSpan: 4,
    });
  });
});

// Both corpora are built once for the whole file. Each is deterministic (seeded
// generator, insertion-order tie breaks throughout `cycles.ts` and
// `acyclic.ts`), so one build is as good as one per test, and the 10k one costs
// tens of milliseconds to build and measure.
const small = fromSpec(smallCorpus());
const large = fromSpec(largeCorpus());
const smallReversed = feedbackArcSet(small);
const largeReversed = feedbackArcSet(large);
const smallQuality = measure(small, smallReversed);
const largeQuality = measure(large, largeReversed);

/**
 * The shipping breaker's answer on both corpora, pinned exactly.
 *
 * Exact equality rather than a tolerance, because every input is deterministic
 * and the whole value of the pin is that it moves when the algorithm moves.
 *
 * A DIFF IN THESE NUMBERS IS A REVIEW ITEM, NOT A FAILURE TO BE UPDATED
 * REFLEXIVELY. The three move independently and only one of them is the
 * objective. If `totalSpan` fell, the change is a win and the new numbers should
 * be written down. If only `reversals` fell and `totalSpan` or `depth` rose, the
 * change made the thing M2.4b pays for WORSE while improving the number that was
 * mistakenly written down as the target, and it should not land on the strength
 * of the reversal count alone. Whoever updates these has to say which of the two
 * happened.
 *
 * Last updated by M2.2b, scoping the reversals to components, and it is the
 * first of the two: TOTAL SPAN FELL ON BOTH CORPORA, 44% on the 1k (40,430 to
 * 22,726) and 3.9% on the 10k (1,414,263 to 1,359,680), and the reversal count
 * fell with it (422 to 74, and 6,327 to 4,620). DEPTH ROSE, 62 to 81 and 154 to
 * 203, and that is paid rather than hidden: a reversal shortens the path it sat
 * on as well as pointing an edge backwards, so declining the reversals no cycle
 * needed makes the longest path longer. The entry that governs the trade is
 * ROADMAP M2.2b's bar row, which states this exact triple on both corpora and
 * accepts the depth alongside it.
 */
describe('acyclic view quality on the bench corpora', () => {
  // Asserted before the three numbers below, because it is what tells the two
  // failure modes apart. See `fingerprint` for why a generated corpus can differ
  // between engines without anything being wrong with this repo.
  it('pins the corpora the numbers below were measured on', () => {
    expect({
      nodes: smallCorpus().nodes.length,
      edges: smallCorpus().edges.length,
      hash: fingerprint(smallCorpus()),
    }).toEqual({ nodes: 1_000, edges: 4_000, hash: 'f355d1dc' });

    expect({
      nodes: largeCorpus().nodes.length,
      edges: largeCorpus().edges.length,
      hash: fingerprint(largeCorpus()),
    }).toEqual({ nodes: 10_000, edges: 40_000, hash: '88149c23' });
  });

  // The instruction above is repeated into `expect`'s message argument, because
  // a failing run prints the diff and not the docblock twenty lines above it,
  // and the reader who most needs the instruction is the one reading that diff.
  const REVIEW_ITEM =
    'A diff here is a review item, not a number to update reflexively. If ' +
    'totalSpan fell, the change is a win and these numbers should be rewritten. ' +
    'If only reversals fell while span or depth rose, the change made what ' +
    'M2.4b pays for WORSE while improving the number that was mistakenly ' +
    'written down as the target. Say which of the two happened.';

  // The opposite instruction, for the opposite kind of failure, and it says so
  // in as many words because the two failures land side by side in the same
  // file and the message above is the one a reader will reach for first.
  const SCOPE_BROKEN =
    'feedbackArcSet returned an edge whose endpoints are in DIFFERENT strongly ' +
    'connected components. This is NOT a quality trade to be weighed and the ' +
    'numbers rewritten: the components here are recomputed by Kosaraju, so a ' +
    'disagreement means the Tarjan pass in `cycles.ts` partitioned the graph ' +
    'wrongly. Over-merging is the usual cause, and the usual cause of that is a ' +
    "missing `onStack` guard in Tarjan's back-edge case, which lets a cross " +
    'edge lower a lowlink. Expect the pinned triples above to have moved with ' +
    'this: ignore them and read this line, because over-merging only reverses ' +
    'MORE arcs than needed, which stays acyclic, stays under m/2 and stays ' +
    'deterministic, so those three numbers are the only other thing that moves.';

  it('pins the shipping answer on the 1k corpus', () => {
    expect(smallQuality, REVIEW_ITEM).toEqual({ reversals: 74, depth: 81, totalSpan: 22_726 });
  });

  it('pins the shipping answer on the 10k corpus', () => {
    expect(largeQuality, REVIEW_ITEM).toEqual({
      reversals: 4_620,
      depth: 203,
      totalSpan: 1_359_680,
    });
  });

  // The component rule itself, asserted structurally rather than as a number.
  //
  // The three pins above are the only thing that moves when the SCC pass is
  // wrong, and they move the wrong way: over-merging components (the classic
  // slip is dropping the `onStack` guard from Tarjan's back-edge case, which
  // lets a cross edge lower a lowlink) only ever reverses MORE arcs than
  // needed, and more reversals is still an acyclic answer, still under `m/2`,
  // still deterministic, and still passes both hand-built witnesses. So a
  // broken partition arrives at the reader as a diff in three numbers, under a
  // message telling them to decide between "the algorithm improved" and "the
  // target was mistakenly written down", neither of which is the truth. This
  // test is the assertion that names it.
  //
  // The components come from `kosarajuComponents`, by a different method than
  // the pass under test, for the reason its docblock gives.
  //
  // NON-VACUITY, and why it is these two statements. The main assertion is a
  // universal over the returned set, so it is trivially true if that set is
  // empty, and trivially true if the checker itself merged the whole corpus
  // into one component. `reversed.size < intra` alone rules out neither: an
  // all-one-component checker would report `intra` as the whole edge count and
  // still be under it. So `intra` is PINNED EXACTLY instead, at the counts
  // `cycles.ts` records (242 of the 1k's 4,000 edges, 20,229 of the 10k's
  // 40,000). That single number says the partition is neither collapsed (it is
  // far below the edge count) nor shattered into singletons (it is far above
  // zero), and it says it about the CHECKER, which nothing else here checks.
  // `0 < reversed.size < intra` then says the returned set is non-empty and is
  // a strict subset of the arcs the rule even allows.
  //
  // What is deliberately NOT asserted here: the count of backward arcs the rule
  // DECLINED, 348 on the 1k and 1,707 on the 10k. That count is the difference
  // between the unscoped and scoped sets, and the unscoped set is not
  // recoverable from this module's surface, since it needs the vertex order the
  // pass builds internally. The pinned `reversals` above carry it instead: 74
  // against the unscoped 422, and 4,620 against 6,327.
  it('reverses nothing that crosses a component, on both corpora', () => {
    for (const [corpus, graph, reversed, intraEdges] of [
      ['1k', small, smallReversed, 242],
      ['10k', large, largeReversed, 20_229],
    ] as const) {
      const component = kosarajuComponents(graph);
      const crossed: EdgeId[] = [];
      let intra = 0;
      for (const edge of graph.edges()) {
        if (edge.source === edge.target) continue;
        if (component.get(edge.source) === component.get(edge.target)) intra += 1;
        else if (reversed.has(edge.id)) crossed.push(edge.id);
      }

      // The count and a sample rather than one assertion per edge: a whole
      // corpus of ids in a diff is unreadable, and the count is what says how
      // badly the partition moved.
      const scoped = { corpus, crossed: crossed.length, sample: crossed.slice(0, 3) };
      expect(scoped, SCOPE_BROKEN).toEqual({ corpus, crossed: 0, sample: [] });

      expect(intra, `intra-component edges on the ${corpus} corpus`).toBe(intraEdges);
      expect(reversed.size).toBeGreaterThan(0);
      expect(reversed.size).toBeLessThan(intra);
    }
  });

  // The ceilings M2.2b asks for, beside the exact pins rather than instead of
  // them. A pin says what the pass does today and moves whenever anything moves;
  // a ceiling says what it PROMISES, so a change that stays under one of these
  // is allowed to rewrite the pin above without further argument and a change
  // that breaks one is a change of objective.
  //
  // Why these numbers. The span ceilings are round numbers just under what the
  // unscoped greedy pass used to cost, 25,000 against its 40,430 on the 1k and
  // 1,400,000 against its 1,414,263 on the 10k, so they cannot be met by
  // reverting the component rule: they assert the win rather than the current
  // measurement. The depth ceilings are round numbers just above what the pass
  // costs today, 90 against 81 and 220 against 203, because depth is the side of
  // this trade that is PAID and a ceiling below today's depth would be a
  // promise this pass does not make. They still bite: DFS back edges come out at
  // 115 and 601, and per-component ELS at 84 and 320, so both of the shapes this
  // objective is meant to rule out are well over them. The reversal ceiling is
  // M2.2b's constraint verbatim, no more than the 6,327 the unscoped pass
  // reversed on the 10k and the 422 on the 1k, and it holds a fortiori because
  // the scoped set is a subset of the unscoped one.
  it('keeps both corpora under the ceilings M2.2b states', () => {
    expect(smallQuality.totalSpan).toBeLessThanOrEqual(25_000);
    expect(smallQuality.depth).toBeLessThanOrEqual(90);
    expect(smallQuality.reversals).toBeLessThanOrEqual(422);

    expect(largeQuality.totalSpan).toBeLessThanOrEqual(1_400_000);
    expect(largeQuality.depth).toBeLessThanOrEqual(220);
    expect(largeQuality.reversals).toBeLessThanOrEqual(6_327);
  });

  // The gap this file exists to make visible.
  //
  // `largeCorpus` is authored as 60 layers and every edge in it is drawn between
  // layers, so a ranking that respected the authored structure would occupy
  // about 60 ranks. The shipping view occupies far more, and the extra ranks are
  // not free: every rank an edge spans is one dummy node the M2.4b splitter has
  // to mint, position, order and route. That is what the pinned `totalSpan`
  // above is a count of, and it is why the reversal count is the wrong thing to
  // optimise. Reversing fewer edges by threading them into one long chain
  // deepens the view, and a deeper view makes every long edge in it longer.
  //
  // Asserted as a bound rather than as an equality because the equality is
  // already pinned above. This one is here to say what the pinned number MEANS,
  // and it should keep failing to be interesting until a breaker lands that
  // actually closes the gap.
  it('leaves the 10k view far deeper than the corpus has authored layers', () => {
    const authoredLayers = 60;
    expect(largeQuality.depth).toBeGreaterThan(2 * authoredLayers);
  });
});
