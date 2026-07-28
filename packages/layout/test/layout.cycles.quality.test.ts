import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { acyclicView, longestPathRanks } from '../src/acyclic.js';
import { feedbackArcSet } from '../src/cycles.js';
import type { EdgeId } from '@dagr/graph';
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
 * edges reverse 42 against the shipping 422 on the 1k and 1,651 against 6,327
 * on the 10k, and are 86% and 290% deeper respectively. The exception is
 * reversing the corpus's authored back edges, which is fewer reversals AND
 * shallower on both corpora (71 at depth 24, and 796 at depth 60), and which is
 * not an algorithm: it reads the generator's own layer assignment, and no cycle
 * breaker has a counterpart it could compute. SPAN follows depth on the 10k
 * corpus, where those 1,651 reversals cost 1,601,415 dummies against the
 * shipping 1,414,263, and does NOT on the 1k, where the same swap saves span
 * (30,954 against 40,430). The 10k corpus is the one that decides it, because
 * M2.4b, M2.9, M3.9 and M4.10 all measure against that size. Existing
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
 * Nothing here asserts a target. A better breaker does not exist yet, and a test
 * that asserted one would be asserting a plan.
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
const smallQuality = measure(small, feedbackArcSet(small));
const largeQuality = measure(large, feedbackArcSet(large));

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

  it('pins the shipping answer on the 1k corpus', () => {
    expect(smallQuality, REVIEW_ITEM).toEqual({ reversals: 422, depth: 62, totalSpan: 40_430 });
  });

  it('pins the shipping answer on the 10k corpus', () => {
    expect(largeQuality, REVIEW_ITEM).toEqual({
      reversals: 6_327,
      depth: 154,
      totalSpan: 1_414_263,
    });
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
