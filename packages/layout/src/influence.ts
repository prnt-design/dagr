/**
 * What a relayout could have touched.
 *
 * M3.2 ships the observable and the trivial implementation of it; M3.5 narrows
 * the implementation without moving the observable, which is the point of
 * landing it early. See {@link InfluenceSet}.
 */

import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import type { LayoutResult } from './types.js';

/**
 * The nodes and edges a relayout was entitled to move.
 *
 * An observable output of `engine.relayout` from M3.2, where its implementation
 * reports the whole roster and the claim is therefore true and useless. That is
 * deliberate, and it is what broke the circularity between M3.4 and M3.5. M3.4's
 * stability contract ("a node outside the influence set keeps its coordinate
 * exactly") shipped against this set and is vacuously true against it, which is
 * exactly the intent: see `stabilityViolations` in `stability.ts`, and the test
 * beside it that narrows the set by hand so the checker is shown failing as well
 * as passing. M3.5 is therefore a narrowing of something already observable
 * rather than a new concept, and M3.9's fast paths assert against the same
 * object. It also buys a free regression guard, because this set should shrink
 * monotonically across M3.5, M3.7 and M3.9, and a set is a thing you can measure.
 *
 * SETS RATHER THAN ARRAYS, which is the opposite of what `LayoutDelta` chose and
 * for the opposite reason. A delta is a list of things that happened and every
 * consumer of it iterates; this is a PREDICATE, and every consumer named above
 * asks it either "is this id in you" or "how big are you". An array would make
 * each of them build the set back up. The argument that pushed the delta to
 * arrays does not reach here either: nothing sends an influence set across the
 * worker wire, because M3.2's `relayoutAsync` computes it on the calling thread
 * beside the delta.
 *
 * IT NAMES ONLY IDS THE CALLER CAN SEE. Dummy chain nodes are in the pipeline's
 * roster and in nothing a caller ever holds, so a set naming them would be a set
 * whose membership question a consumer cannot ask about half its contents.
 * M3.5's internal region may well be wider than what it reports here, and the
 * two are allowed to differ: the region is how the work is confined, this is
 * what the work promises.
 *
 * IT SPANS BOTH SIDES OF THE PATCH. A removal is a change, and the id of a
 * removed node exists only in the previous result, so a set built from the
 * current graph alone cannot contain every change in the delta it accompanies,
 * which is exactly the property M3.5's tests assert.
 */
export interface InfluenceSet {
  readonly nodes: ReadonlySet<NodeId>;
  readonly edges: ReadonlySet<EdgeId>;
}

/**
 * The trivial influence set: everything on either side of the patch.
 *
 * The honest answer for a relayout that re-runs the whole pipeline, which is
 * what M3.2's does. Nothing about the patch is consulted, because nothing about
 * this relayout is confined by it. M3.5 is where the patch starts to matter.
 */
export function wholeRoster(graph: Graph, previous: LayoutResult): InfluenceSet {
  const nodes = new Set<NodeId>();
  for (const node of graph.nodes()) nodes.add(node.id);
  for (const id of previous.nodes.keys()) nodes.add(id);

  const edges = new Set<EdgeId>();
  for (const edge of graph.edges()) edges.add(edge.id);
  for (const id of previous.edges.keys()) edges.add(id);

  return { nodes, edges };
}
