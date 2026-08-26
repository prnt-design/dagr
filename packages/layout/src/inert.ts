/**
 * The patches that change nothing this package's pipeline reads.
 *
 * M3.9a, the cheapest of the milestone's fast paths and the one its entry says
 * is available on day one: an attribute edit that does not change a node's size
 * changes no geometry at all, so the right answer is the drawing the caller
 * already holds, an empty delta, and no stage run. `engine.ts` is where the
 * decision is taken, and this is the pair of questions it takes it on.
 *
 * ## What the pipeline reads
 *
 * A run is a pure function of four things: the graph's NODES and EDGES, the
 * resolved config, the resolved SIZES, and the warm-start state. The config is
 * bound at construction and cannot move under a patch. The warm start is the
 * previous run's own output, which a skipped relayout leaves alone. So a patch
 * that adds or removes no node and no edge, and that leaves every size where it
 * was, is a patch the pipeline cannot see, and running it would spend a full
 * Sugiyama pass to reproduce the drawing it started from.
 *
 * That leaves seven op kinds that are inert BY KIND and four that never are.
 * Ports, edge attributes, graph attributes and containment are read by no stage
 * here: sizes come from `nodeSize`, ranks come from edges, and a parent is
 * reserved rather than drawn until M7. Node attributes are read, but only
 * through `nodeSize`, and what that produces is exactly what
 * {@link sameSizes} compares, so an attribute op is inert when the sizes agree
 * and structural when they do not.
 *
 * ## Why the switch lists what is inert rather than what is not
 *
 * Because the two spellings fail in opposite directions when the union grows.
 * `default: return false` refuses an op kind this file has never heard of,
 * which costs a full relayout on the day @dagr/graph adds one; the other
 * spelling would SKIP it, and a skip taken on an op nobody has classified is a
 * wrong drawing returned in silence. The same rule is why every switch over
 * this union in this repo is written out arm by arm.
 */

import type { NodeId, Patch } from '@dagr/graph';
import type { Size } from './types.js';

/**
 * Whether every op in this patch is one no stage in this package reads.
 *
 * It is a question about the OPS and not about the graph, so it is cheap and
 * proportional to the patch. It is also only half the answer: an
 * `update-node-attrs` op passes here and still changes the drawing when the
 * attribute is one `nodeSize` reads, which is what {@link sameSizes} is for.
 *
 * A batch is one patch carrying many ops (M3.3), so a batch that touches a
 * colour and adds an edge fails here on the edge, which is right: the ops are
 * one emission and the drawing they produce together is a new one.
 */
export function movesNothing(patch: Patch): boolean {
  for (const op of patch) {
    switch (op.op) {
      // `update-node-attrs` is read by `nodeSize` and by nothing else, so it is
      // settled by the sizes rather than by its kind: see {@link sameSizes}.
      //
      // The three port ops move where an edge ATTACHES rather than where a node
      // sits, and `polylineRouteStage` reads no port at all: it attaches at the
      // box border. `influence.ts` widens no band for them for the same reason.
      //
      // No stage here reads an edge attribute: ranks come from the edges
      // themselves and routes come from the ranks. Graph attributes reach a
      // layout through the config, which an engine binds at construction and a
      // patch cannot reach. Containment is reserved (M5.5) and drawn by nothing
      // until M7, which is the milestone that makes this arm wrong.
      case 'update-node-attrs':
      case 'add-port':
      case 'remove-port':
      case 'update-edge-ports':
      case 'update-edge-attrs':
      case 'update-graph-attrs':
      case 'update-node-parent':
        break;

      // add-node, remove-node, add-edge, and anything this file has not been
      // taught, which is the case the default arm exists for.
      default:
        return false;
    }
  }
  return true;
}

/**
 * Whether two runs' resolved sizes are the same sizes.
 *
 * TOTAL RATHER THAN OVER THE NODES THE PATCH NAMED, and that is a decision
 * rather than a shortcut in the wrong direction. `measureNodes` promises that a
 * `nodeSize` callback is called once per node per run, which is what makes a
 * callback that measures text or reads the DOM safe to write; a relayout that
 * measured only the patched nodes would quietly stop honouring that, and a
 * caller whose sizes come from somewhere other than the attributes would find
 * an out-of-band change picked up by every relayout until this one shipped.
 * The cost is a walk of the roster, which is the cheapest thing in the
 * pipeline, and the pass it lets the engine skip is proportional to the drawing
 * too. Measuring only what the patch names is the obvious lift and it belongs
 * with the rest of M3.9b, where it can be measured against a fast path that
 * does real work.
 *
 * The sizes are compared component by component rather than by identity,
 * because `measureNodes` builds a fresh map and a fresh record per run: an
 * identity comparison would answer no every time and the fast path would never
 * fire.
 *
 * The two counts are compared first, which is redundant for a patch
 * {@link movesNothing} accepted and is a free guard for a caller who mutated
 * the graph without emitting a patch for it. It guards NODES AND NOT EDGES, and
 * the asymmetry is a price rather than an oversight: the node count is already
 * in hand, and an edge count is a walk of the edges, which is the pass this
 * whole path exists to skip. An unreported edge edit is outside the engine's
 * contract either way, since `relayout` is documented as describing an edit the
 * caller has already made and `checkPatchApplied` refuses a patch that
 * disagrees with the graph.
 */
export function sameSizes(
  before: ReadonlyMap<NodeId, Size>,
  after: ReadonlyMap<NodeId, Size>,
): boolean {
  if (before.size !== after.size) return false;
  for (const [id, size] of after) {
    const was = before.get(id);
    if (was === undefined) return false;
    if (was.width !== size.width || was.height !== size.height) return false;
  }
  return true;
}
