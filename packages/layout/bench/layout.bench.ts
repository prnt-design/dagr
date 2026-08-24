import { Graph } from '@dagr/graph';
import { largeCorpus, registerControl, smallCorpus } from '@dagr/bench';
import { bench, describe } from 'vitest';

import { measureNodes, resolveConfig } from '../src/config.js';
import { layout } from '../src/pipeline.js';
import { longestPathRankStage } from '../src/rank.js';
import type { GraphSpec } from '@dagr/bench';
import type { PreparedState } from '../src/types.js';

/**
 * `@dagr/layout`'s pipeline.
 *
 * Two numbers this pins, both argued about in the M2.2 review and both
 * previously living only in a review comment. The rank stage measured 33ms on
 * 10k nodes and 40k edges on a reviewer's machine, 28ms of which was feedback
 * arc set. And the stage materialises four arrays per run, two the size of the
 * node set and two the size of the edge set; fixing the rest of that was
 * deliberately deferred to this harness, because the alternative would let a
 * function be handed arrays that disagree with its own graph.
 *
 * The heavy benchmarks are given a longer sampling window. vitest samples for a
 * fixed wall clock, so a 30ms iteration inside the default 500ms yields about
 * fifteen samples, and a median drawn from fifteen samples on a shared runner
 * is not a number worth gating on.
 */

registerControl();

const HEAVY = { time: 3_000 };

function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/** What the runner hands the rank stage, built the way the runner builds it. */
function prepare(graph: Graph): PreparedState {
  const config = resolveConfig(undefined);
  return { graph, config, sizes: measureNodes(graph, config, undefined) };
}

const small = build(smallCorpus());
const large = build(largeCorpus());
const preparedSmall = prepare(small);
const preparedLarge = prepare(large);

/** What the runner hands the rank stage on the run AFTER a cold one. */
function warmed(graph: Graph, prepared: PreparedState): PreparedState {
  const first = longestPathRankStage.run(prepared);
  const previous = { ranks: first.ranks, reversedEdges: first.reversedEdges };
  return { ...prepared, previous: previous as PreparedState['previous'] };
}

const warmSmall = warmed(small, preparedSmall);
const warmLarge = warmed(large, preparedLarge);

/**
 * The rank stage on its own, which is where the cost currently sits.
 *
 * Isolated from the full pipeline because the other stages keep being replaced:
 * the order stage was replaced in M2.6b and the route stage in M2.8, and the
 * position default is still a placeholder scheduled for it. A combined number
 * would move when any of those lands and tell nobody which one moved, and the
 * ranker itself is due to be replaced by network simplex in M2.3, which is the
 * change this baseline exists to keep honest.
 *
 * That isolation is what makes these two the CONTROLS for a route or position
 * change rather than merely unaffected by one: they run the rank stage alone,
 * so a milestone touching either of the later stages reads its own pipeline
 * entries against two entries in the same file and the same worker that cannot
 * have moved for a reason inside the package.
 */
describe('rank', () => {
  bench('1k nodes, 4k edges', () => {
    longestPathRankStage.run(preparedSmall);
  });

  bench('10k nodes, 40k edges', () => {
    longestPathRankStage.run(preparedLarge);
  }, HEAVY);

  // M3.7b: the same stage on a relayout, which is what an engine actually runs
  // after the first frame. Both warm starts are in these two rather than one:
  // the cycle breaker is seeded (M3.7a) and the ranks are (M3.7b), because that
  // is the pair `PreparedState.previous` carries and measuring one of them
  // alone would be measuring a state the engine never builds.
  //
  // The graph is UNCHANGED between the cold entry and the warm one, which is
  // the case the warm path is sharpest on and the only one that is reproducible
  // in a benchmark: a patch would have to be applied per iteration, and then
  // the entry would be measuring the patch. What the pair says is what a
  // relayout that moved nothing costs against a run that assumed everything
  // moved, and M3.7b's ROADMAP entry carries the breakdown underneath it.
  bench('1k nodes, 4k edges, warm', () => {
    longestPathRankStage.run(warmSmall);
  });

  bench('10k nodes, 40k edges, warm', () => {
    longestPathRankStage.run(warmLarge);
  }, HEAVY);
});

/** The whole pipeline, including whatever the stages behind it currently cost. */
describe('pipeline', () => {
  bench('1k nodes, 4k edges', () => {
    layout({ graph: small });
  });

  bench('10k nodes, 40k edges', () => {
    layout({ graph: large });
  }, HEAVY);
});
