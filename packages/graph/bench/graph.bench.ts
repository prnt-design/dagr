import { largeCorpus, registerControl, smallCorpus } from '@dagr/bench';
import { bench, describe } from 'vitest';

import { Graph } from '../src/graph.js';
import type { GraphSpec } from '@dagr/bench';
import type { NodeId } from '../src/types.js';

/**
 * `@dagr/graph`'s hot paths.
 *
 * The reason this file exists rather than a note saying the code looks fine:
 * the algorithms review during M1.3 verified that reverting the allocation
 * guard in `diffAttrs` leaves all 329 tests passing. A whole class of
 * performance regression is invisible to the suite, and only a recorded
 * baseline sees it.
 *
 * Every benchmark is sized so one iteration takes a few milliseconds. That is
 * not arbitrary. vitest samples for a fixed wall-clock window, so an iteration
 * measured in microseconds is mostly loop overhead, and one measured in
 * hundreds of milliseconds yields a handful of samples and a median that means
 * nothing. M1.3's figures were quoted at 400k updates in one go, roughly 270ms;
 * the same path is measured here in smaller batches for that reason, so the
 * ratio moves with the per-call cost and not with the sampler.
 */

registerControl();

/**
 * A longer sampling window for the two benchmarks that need one, matching
 * `layout.bench.ts`'s `HEAVY` and for the reason `bench/README.md` gives under
 * "Adding a benchmark": vitest samples for a fixed wall clock, so a heavy
 * iteration inside the default 500ms yields a handful of samples and a median
 * drawn from a handful of samples is not a number worth gating on.
 *
 * IT WAS ADDED BECAUSE THE GATE FLAKED, not on principle. `topologicalOrder`
 * ran about 15ms an iteration, which is 33 samples in the default window, and
 * one gate run against a freshly captured baseline failed it while the runs
 * either side of it passed comfortably.
 *
 * WHAT THE LONGER WINDOW DOES IS EXPOSE A SECOND MODE that the short one was
 * missing, and saying it "reduces sampling noise" would be wrong. At 33 samples
 * three consecutive runs of this entry differed by 2.8% in the MEAN, so the
 * failing run was a slow run rather than an unlucky draw, and a wider window
 * does not prevent one. What changes is the shape: p75 runs 16.2ms to 20.9ms
 * across five wide-window runs against 15.4ms to 15.8ms at 500ms, and p99
 * reaches 26ms. The gate then reads it steadily, at -0.5%, +0.4% and -2.6% over
 * three consecutive checks against the baseline captured here.
 * `isAcyclic on an acyclic graph` is the other one at about 8ms, and both go
 * from tens of samples to a few hundred.
 *
 * The other nine benchmarks in this file already run about 2ms or less an
 * iteration and draw from at least 200 samples, so they are left on the default
 * window. A longer window costs wall clock on every run and buys them nothing.
 */
const HEAVY = { time: 3_000 };

/** Build a `Graph` from a corpus description. */
function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

const small = smallCorpus();
const large = largeCorpus();

describe('build', () => {
  bench('1k nodes and 4k edges from empty', () => {
    build(small);
  });
});

/**
 * The attribute update path, watched against unwatched.
 *
 * This pair is the guard's regression detector. `diffAttrs` allocates its
 * before and after bags only when the graph has a subscriber, so reverting that
 * guard costs two object allocations per call on the unwatched path and none on
 * the watched one. The unwatched number moving towards the watched one is what
 * that looks like from here.
 */
describe('attributes', () => {
  const UPDATES = 2_000;
  const ids = large.nodes.slice(0, UPDATES);

  const unwatched = build(large);
  const watched = build(large);
  const unchanged = build(large);
  let seen = 0;
  watched.subscribe(() => {
    seen += 1;
  });

  /**
   * Every iteration must write a value the node does not already hold.
   *
   * `diffAttrs` returns early when nothing changed, so a patch replayed with
   * the same value takes the no-op path and rebuilds no record. Writing
   * `{ width: index }` on every iteration therefore measures the real path once
   * and the early return forever after, which is how the first version of this
   * file had the watched and unwatched benchmarks agreeing to within 1% while
   * M1.3 had measured them 1.8x apart.
   */
  let tick = 0;

  bench('2k updateNodeAttrs, unwatched', () => {
    tick += 1;
    for (let index = 0; index < UPDATES; index += 1) {
      const id = ids[index];
      if (id !== undefined) unwatched.updateNodeAttrs(id, { width: index + tick });
    }
  });

  bench('2k updateNodeAttrs, watched', () => {
    tick += 1;
    for (let index = 0; index < UPDATES; index += 1) {
      const id = ids[index];
      if (id !== undefined) watched.updateNodeAttrs(id, { width: index + tick });
    }
    // Reading the counter keeps the listener from being optimised away, which
    // would quietly turn this into a second copy of the unwatched benchmark.
    if (seen < 0) throw new Error('unreachable');
  });

  // The early return above, measured on purpose rather than by accident. Layout
  // rewrites sizes that mostly have not moved, so this is a real path and not a
  // curiosity, and separating it is what keeps it out of the two numbers above.
  bench('2k updateNodeAttrs, no change', () => {
    for (let index = 0; index < UPDATES; index += 1) {
      const id = ids[index];
      if (id !== undefined) unchanged.updateNodeAttrs(id, { width: index });
    }
  });
});

/**
 * Traversal over the 10k corpus.
 *
 * `topologicalOrder` orders ties by node insertion rank rather than by whatever
 * a queue happened to hold, which costs a heap and turns O(V + E) into
 * O((V + E) log V). This is where that trade is priced rather than argued
 * about. The corpus is about 2% back edges, so it is cyclic, and a topological
 * sort of a cyclic graph throws: the acyclic view is built once here so the
 * benchmark measures the sweep and not the error path.
 */
describe('traversal', () => {
  const cyclic = build(large);
  /**
   * The corpus with every edge ORIENTED from the lower-indexed endpoint to the
   * higher, rather than with backward edges dropped.
   *
   * Dropping was the first attempt and it quietly destroyed the thing being
   * measured. The corpus assigns nodes to layers on a skewed draw, so node
   * index does not track layer, and filtering on index threw away about half
   * the 40k edges and fragmented what was left: the best source reached 357
   * nodes. Orienting keeps every edge, so this stays a 10k node, 40k edge DAG
   * and the walks have something to walk.
   */
  const acyclic = (() => {
    const graph = new Graph();
    for (const id of large.nodes) graph.addNode(id);
    const rank = new Map(large.nodes.map((id, index) => [id, index]));
    const seen = new Set<string>();
    for (const [source, target] of large.edges) {
      const from = (rank.get(source) ?? 0) < (rank.get(target) ?? 0) ? source : target;
      const to = from === source ? target : source;
      if (from === to) continue;
      const key = `${from} ${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      graph.addEdge(from, to);
    }
    return graph;
  })();

  /**
   * The source that reaches the most, chosen once, outside the timed body.
   *
   * Both halves of that matter, and the first version of this benchmark got
   * both wrong. Calling `sources()` inside the body made 97% of the recorded
   * time an O(V) scan of all 10k nodes, so the entry sat within noise of the
   * `sources` benchmark below it and a `descendants` regression would have had
   * to be about 40x to move it: exactly the silent no-op the harness exists to
   * prevent, and exactly the trap `bench/README.md` warns about. And the FIRST
   * source by insertion rank reaches 16 of 10,000 nodes, so even hoisted it
   * would have measured a sixteen-node walk under a name saying 10k.
   */
  // The best length is carried alongside the id rather than recomputed. The
  // obvious `reduce` calls `descendants(best)` again on every step, which is
  // two traversals per source instead of one, and this runs at setup on every
  // bench invocation including CI.
  const { id: deepestSource, reach } = acyclic.sources().reduce<{ id: NodeId; reach: number }>(
    (best, id) => {
      const length = acyclic.descendants(id).length;
      return length > best.reach ? { id, reach: length } : best;
    },
    { id: '', reach: -1 },
  );
  // Asserted, not assumed: if a corpus reseed or a change to the rank filter
  // ever shrinks this, the benchmark fails loudly instead of quietly measuring
  // a walk over nothing again.
  if (reach < 1_000) {
    throw new Error(`descendants benchmark reaches only ${String(reach)} nodes, so it measures nothing`);
  }

  bench('topologicalOrder, 10k nodes', () => {
    acyclic.topologicalOrder();
  }, HEAVY);

  bench('isAcyclic on a cyclic graph, 10k nodes', () => {
    cyclic.isAcyclic();
  });

  bench('isAcyclic on an acyclic graph, 10k nodes', () => {
    acyclic.isAcyclic();
  }, HEAVY);

  bench('descendants, 10k nodes', () => {
    acyclic.descendants(deepestSource);
  });

  bench('sources, 10k nodes', () => {
    acyclic.sources();
  });
});

/**
 * Adjacency queries.
 *
 * `successors` and `predecessors` materialise a fresh array per call, which the
 * M1.2 review flagged and M2.5 deferred. Layout calls them per node per pass,
 * so the allocation is paid on the hot path of every ordering sweep. This is
 * the number that decision will be revisited against.
 */
describe('adjacency', () => {
  const graph = build(large);
  // A slice rather than all 10k. Sweeping the whole corpus allocates hard
  // enough to pull a garbage collection into most iterations, which showed up
  // as a 5ms minimum against a 25ms maximum and 9.9% of margin of error: a
  // measurement too noisy for a 10% gate to say anything about. The per-call
  // cost is what is being watched here, and 2.5k calls shows it just as well.
  const ids = large.nodes.slice(0, 2_500);

  bench('2.5k successors', () => {
    let total = 0;
    for (const id of ids) total += graph.successors(id).length;
    if (total < 0) throw new Error('unreachable');
  });

  bench('2.5k outEdges', () => {
    let total = 0;
    for (const id of ids) total += graph.outEdges(id).length;
    if (total < 0) throw new Error('unreachable');
  });
});
