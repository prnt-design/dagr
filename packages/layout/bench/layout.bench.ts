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

/**
 * The rank stage on its own, which is where the cost currently sits.
 *
 * Isolated from the full pipeline because three of the four stages are still
 * placeholders scheduled for replacement (M2.5, M2.7, M2.8). A combined number
 * would move when any of those lands and tell nobody which one moved, and the
 * ranker itself is due to be replaced by network simplex in M2.3, which is the
 * change this baseline exists to keep honest.
 */
describe('rank', () => {
  bench('1k nodes, 4k edges', () => {
    longestPathRankStage.run(preparedSmall);
  });

  bench('10k nodes, 40k edges', () => {
    longestPathRankStage.run(preparedLarge);
  }, HEAVY);
});

/** The whole pipeline, including whatever the placeholder stages currently cost. */
describe('pipeline', () => {
  bench('1k nodes, 4k edges', () => {
    layout({ graph: small });
  });

  bench('10k nodes, 40k edges', () => {
    layout({ graph: large });
  }, HEAVY);
});
