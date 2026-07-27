import { largeCorpus, registerControl, smallCorpus } from '@dagr/bench';
import { bench, describe } from 'vitest';

import { Graph } from '../src/graph.js';
import type { GraphSpec } from '@dagr/bench';

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
