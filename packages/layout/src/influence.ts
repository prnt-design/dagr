/**
 * What a relayout could have touched.
 *
 * M3.2 ships the observable and the trivial implementation of it; M3.5 adds the
 * computed one beside it, as {@link influenceRegion}. See {@link InfluenceSet}
 * for the observable and {@link InfluenceRegionInput} for what bounding a patch
 * actually needs.
 */

import type { EdgeId, Graph, NodeId, Patch } from '@dagr/graph';
import { InvalidConfigError } from './errors.js';
import type { LayoutResult, PreviousLayout, Size } from './types.js';

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
 * as passing. The same type is what M3.9's fast paths assert against, and it
 * buys a free regression guard, because it should shrink monotonically across
 * M3.7 and M3.9 and a set is a thing you can measure.
 *
 * M3.2 AND M3.4 BOTH SAID M3.5 WOULD NARROW THIS SET, AND IT DID NOT, which is
 * worth recording where the prediction was made. What a relayout is ENTITLED to
 * move is a statement about the run that happened, and M3.5 changed no stage, so
 * a run that re-runs the whole pipeline is still entitled to everything: the
 * honest value here is still the whole roster and narrowing it would have been a
 * promise the pipeline does not keep. What M3.5 shipped is a second set of this
 * same type beside it, {@link influenceRegion}, which bounds the PATCH rather
 * than the run. The two converge when the stages are confined to the region,
 * which is M3.6 through M3.9, and the distance between them until then is a
 * measurement rather than a feeling.
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
 * {@link influenceRegion} obeys the same rule for the same reason, and the band
 * it works in is allowed to be wider than what it names: the band is how the
 * work would be confined, the set is what the work promises.
 *
 * IT SPANS BOTH SIDES OF THE PATCH. A removal is a change, and the id of a
 * removed node exists only in the previous result, so a set built from the
 * current graph alone cannot contain every change in the delta it accompanies.
 * `layout.influence.test.ts` asserts it of the computed region too.
 */
export interface InfluenceSet {
  readonly nodes: ReadonlySet<NodeId>;
  readonly edges: ReadonlySet<EdgeId>;
}

/**
 * The trivial influence set: everything on either side of the patch.
 *
 * The honest answer for a relayout that re-runs the whole pipeline, which is
 * what M3.2's does and what it still does. Nothing about the patch is consulted,
 * because nothing about this relayout is confined by it: see
 * {@link influenceRegion} for what the patch does bound, and M3.6 onwards for
 * the stages that make the two the same set.
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

/**
 * How far past the ranks a patch touches the region reaches, by default.
 *
 * ONE, and the number is an approximation with a reason rather than a guess.
 * The order stage sweeps barycenters between adjacent layers, so changing which
 * nodes sit in a rank changes the barycenter of every node one rank above and
 * one rank below it, which is where a reordering starts. It does not stop
 * there: the next sweep carries the new order one rank further, and a cold
 * sweep carries it to the end of the drawing, so no finite window is a bound on
 * an UNCONFINED run. The window is a bound on what a CONFINED stage may touch,
 * which is what M3.6 to M3.9 are, and `test/layout.influence.test.ts` measures
 * what today's cold fallback does outside it at 0, 1 and 2.
 */
const DEFAULT_RANK_WINDOW = 1;

/**
 * What bounding a patch takes: the graph it was applied to, the patch, and the
 * pipeline state of the run before it.
 *
 * `graph` is the graph AFTER the patch, which is the one the engine is holding:
 * `relayout` describes an edit a caller has already made. `previous` is the
 * retained pipeline state, which is where the ranks come from, and it is the
 * reason this is not a pure function of two `LayoutResult`s the way M3.4's
 * metrics are. A result holds coordinates; bounding a patch needs the ranks, the
 * layers and the dummy chains, and deriving those back out of coordinates would
 * be M3.4's rank derivation carrying a load it was never measured for.
 *
 * `sizes` is the CURRENT resolved size per node, which the engine has from
 * `prepare` and which a caller measuring its own nodes has too. It is here for
 * one question and it is the vertical half of the answer: rows stack from
 * `y = 0` and a row is as tall as its tallest node, so a patch that makes a row
 * taller moves every row under it, however far away and however unconnected.
 * Without the sizes this module can only ever answer about `x`.
 */
export interface InfluenceRegionInput {
  /** The graph as it stands after the patch. */
  readonly graph: Graph;

  /** What the caller changed, as `Graph.subscribe` delivered it. */
  readonly patch: Patch;

  /** The pipeline state the previous run left behind. */
  readonly previous: PreviousLayout;

  /** Resolved size per node of the current graph. */
  readonly sizes: ReadonlyMap<NodeId, Size>;

  /** Ranks past the touched band to take with it. Defaults to 1. */
  readonly rankWindow?: number | undefined;
}

/** The tallest node in a row, and how many nodes in it are that tall. */
interface Row {
  readonly height: number;
  readonly tallest: number;
}

/**
 * The height of each row of the previous drawing, keyed by rank.
 *
 * `tallest` is a count rather than a flag because removing one of two equally
 * tall nodes leaves the row exactly as tall as it was, and a region that
 * extended to the bottom of the drawing every time a node left a row would give
 * up the vertical half of its narrowing on the most ordinary patch there is.
 */
function rowHeights(previous: PreviousLayout): Map<number, Row> {
  const rows = new Map<number, Row>();
  for (const members of previous.layers) {
    const first = members[0];
    if (first === undefined) continue;
    const rank = previous.ranks.get(first);
    if (rank === undefined) continue;
    let height = 0;
    let tallest = 0;
    for (const id of members) {
      const size = previous.sizes.get(id);
      if (size === undefined) continue;
      if (size.height > height) {
        height = size.height;
        tallest = 1;
      } else if (size.height === height) {
        tallest += 1;
      }
    }
    rows.set(rank, { height, tallest });
  }
  return rows;
}

/**
 * Checks a rank window the way every other option in this package is checked.
 *
 * Integer as well as finite and not negative, which the separations are not:
 * this one indexes ranks, and half a rank is a window a caller believes in and
 * the arithmetic quietly rounds away.
 *
 * @throws {InvalidConfigError} naming `rankWindow` with `subject: 'option'`.
 */
export function requireRankWindow(rankWindow: number | undefined): number {
  if (rankWindow === undefined) return DEFAULT_RANK_WINDOW;
  if (!Number.isInteger(rankWindow) || rankWindow < 0) {
    throw new InvalidConfigError('rankWindow', rankWindow, 'option');
  }
  return rankWindow;
}

/**
 * The nodes and edges a patch can affect, as a band of ranks around what it
 * touched.
 *
 * ## Why a rank band, and not the nodes the patch names
 *
 * Influence travels three ways in a Sugiyama pipeline and only one of them
 * follows edges. It travels DOWN through successors, because ranking is a
 * longest-path sweep and one added edge pushes a whole subtree; UP through
 * predecessors, because the order stage sweeps both directions; and SIDEWAYS
 * within a rank, because ordering and coordinate assignment are per rank, so a
 * node arriving in a row changes the barycenters, the order and the coordinates
 * of the nodes already there. Nothing in that third direction is reachable from
 * the patch in either of the first two: a node in a completely separate
 * component that happens to share a rank moves, and `layout.influence.test.ts`
 * shows it moving.
 *
 * So a band of ranks is what this computes. It cuts along the grain of the
 * algorithm, where k hops from the patch cuts across it unevenly: every stage
 * here is organised per rank, and a rank is either recomputed or it is not.
 *
 * ## What it is a bound on
 *
 * IT IS A BOUND ON A CONFINED RELAYOUT, WHICH IS NOT WHAT THE ENGINE DOES YET.
 * M3.2's `relayout` re-runs the whole pipeline, and a cold sweep is entitled to
 * reorder a rank the patch never came near, so the honest set for that run is
 * still the whole roster and that is still what `RelayoutResult.influence`
 * reports. This is the other object: what M3.6's warm-started ordering, M3.7's
 * incremental ranking, M3.8's anchored coordinates and M3.9's fast paths are
 * allowed to touch, computed before any of them exist so that each is written
 * against a bound rather than against its own opinion of one. The distance
 * between the two is the milestone, and it is a measurement rather than a
 * feeling: `test/layout.influence.test.ts` runs the cold fallback against this
 * region over a corpus and pins what escapes.
 *
 * ## What widens it to everything
 *
 * Three things, each because the alternative is a bound that is not one.
 *
 * AN EDGE THAT INVERTS A RANK ORDER. An added edge from a node at rank `r` to
 * one at rank `r` or above forces the target down, and longest-path ranking
 * takes every descendant with it, so the band runs to the bottom of the
 * drawing. An added edge whose target already sits below its source changes no
 * rank at all, which is the ordinary case and stays narrow.
 *
 * A REMOVAL THAT FREES ITS TARGET TO RISE. Longest-path rank is the deepest
 * predecessor plus one, so removing that predecessor lets the target rise, and
 * it can rise all the way to rank 0. If any other predecessor still sits one
 * rank above the target, its rank is pinned and nothing rises.
 *
 * A ROW THAT CHANGES HEIGHT. Rows stack from `y = 0` and a row is as tall as
 * its tallest node, so a taller node arriving, or the only tallest one leaving,
 * moves every row under it. That is the one direction that reaches nodes at
 * ranks the patch cannot otherwise touch, and it is why {@link
 * InfluenceRegionInput.sizes} is an input.
 *
 * ## What it names
 *
 * Ids a caller can see, on BOTH sides of the patch: dummy chain nodes are
 * filtered out, and a removed node is named although only the previous run ever
 * held it. An edge is named when either endpoint is named, and also when the
 * ranks it spans meet the band, which is the case a set built from endpoints
 * alone gets wrong: a long edge from the top of the drawing to the bottom is
 * drawn through every rank between, so a patch in the middle reroutes it while
 * neither of its endpoints moves at all.
 *
 * @throws {InvalidConfigError} when `rankWindow` is not a whole number of ranks
 * that is zero or greater.
 */
export function influenceRegion(input: InfluenceRegionInput): InfluenceSet {
  const { graph, patch, previous, sizes } = input;
  const window = requireRankWindow(input.rankWindow);
  const rows = rowHeights(previous);

  /**
   * Whether the previous run had a cycle to break, which is what makes an edge
   * op unboundable.
   *
   * M2.2's greedy feedback arc set is order dependent by construction: its
   * sequence depends on degree-bucket membership, so one added or removed edge
   * can change one node's degree, change the whole sequence, and produce a
   * different reversed set of the same size for a graph whose cycle structure
   * did not change. Edges flip, ranks flip under them, and no band bounds that.
   * M3.7 is the task that makes the cycle breaker incremental, and it is the
   * task that narrows this back down. On a DAG the reversed set is empty and
   * stays empty, which is the prnt.design pattern-generator case and the one
   * this region is sharp on.
   */
  const broken = previous.reversedEdges.size > 0;

  const seedNodes = new Set<NodeId>();
  const seedEdges = new Set<EdgeId>();
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  /** Something the patch touched can rise, so the band runs to the top. */
  let rises = false;
  /** Something the patch touched can fall, so the band runs to the bottom. */
  let falls = false;

  const widen = (rank: number | undefined): void => {
    if (rank === undefined) return;
    top = Math.min(top, rank);
    bottom = Math.max(bottom, rank);
  };

  /**
   * Where a node sits, or where a node the previous run never saw is going.
   *
   * A new node's rank is the deepest of its predecessors plus one, or 0 when it
   * has none, which is longest-path ranking's own rule read forwards. It gives
   * up when a predecessor is itself new, because then the answer depends on a
   * rank this state cannot name, and giving up here is what widens the band to
   * everything rather than what produces a wrong narrow one.
   */
  const rankOf = (id: NodeId): number | undefined => {
    const known = previous.ranks.get(id);
    if (known !== undefined) return known;
    if (!graph.hasNode(id)) return undefined;
    let rank = 0;
    for (const predecessor of graph.predecessors(id)) {
      if (predecessor === id) continue;
      const above = previous.ranks.get(predecessor);
      if (above === undefined) return undefined;
      rank = Math.max(rank, above + 1);
    }
    return rank;
  };

  /** Whether the row at `rank` can end up a different height than it was. */
  const rowChanges = (rank: number | undefined, arriving?: Size, leaving?: Size): boolean => {
    if (rank === undefined) return true;
    const row = rows.get(rank);
    // A rank the previous drawing had no row for is a row this patch creates,
    // and a new row pushes everything under it down by its whole height.
    if (row === undefined) return true;
    if (arriving !== undefined && arriving.height > row.height) return true;
    return leaving !== undefined && leaving.height >= row.height && row.tallest === 1;
  };

  for (const op of patch) {
    switch (op.op) {
      case 'add-node': {
        seedNodes.add(op.id);
        const rank = rankOf(op.id);
        widen(rank);
        if (rank === undefined) {
          rises = true;
          falls = true;
        } else if (rowChanges(rank, sizes.get(op.id))) {
          falls = true;
        }
        break;
      }

      case 'remove-node': {
        seedNodes.add(op.id);
        const rank = previous.ranks.get(op.id);
        widen(rank);
        if (rowChanges(rank, undefined, previous.sizes.get(op.id))) falls = true;
        break;
      }

      case 'add-edge': {
        seedEdges.add(op.id);
        seedNodes.add(op.source);
        seedNodes.add(op.target);
        const source = rankOf(op.source);
        const target = rankOf(op.target);
        widen(source);
        widen(target);
        // A self loop is never reversed and never spans a rank, so it moves
        // nothing: see `acyclic.ts`, which drops them from the view.
        if (op.source === op.target) break;
        // The target already sits below the source, so the longest-path
        // constraint this edge adds is one the ranking already satisfies, and
        // in a drawing with no reversed edge it cannot have closed a cycle
        // either: a path back from the target would have ranked the source
        // below it.
        if (!broken && source !== undefined && target !== undefined && target > source) break;
        rises = true;
        falls = true;
        break;
      }

      case 'remove-edge': {
        seedEdges.add(op.id);
        seedNodes.add(op.source);
        seedNodes.add(op.target);
        const source = previous.ranks.get(op.source);
        const target = previous.ranks.get(op.target);
        widen(source);
        widen(target);
        if (op.source === op.target) break;
        if (!broken && source !== undefined && target !== undefined) {
          // Only the predecessor one rank above can have been the one setting
          // this rank, so a longer edge carried no rank and its removal frees
          // nothing.
          if (source !== target - 1) break;
          if (pinnedFrom(graph, previous, op.target, target)) break;
        }
        rises = true;
        falls = true;
        break;
      }

      case 'update-node-attrs': {
        seedNodes.add(op.id);
        const rank = previous.ranks.get(op.id);
        widen(rank);
        // Attributes are what `nodeSize` reads, so an attribute change is a
        // size change until the two sizes say otherwise.
        const before = previous.sizes.get(op.id);
        const after = sizes.get(op.id);
        if (before === undefined || after === undefined) {
          falls = true;
        } else if (before.height !== after.height && rowChanges(rank, after, before)) {
          falls = true;
        }
        break;
      }

      case 'add-port':
      case 'remove-port': {
        // Ports move where an edge ATTACHES to a node rather than where the
        // node sits, so this names the node and the edges that could reattach
        // and widens no band. `polylineRouteStage` reads no port at all, so
        // today it moves nothing; a caller's own router is who this is for.
        seedNodes.add(op.nodeId);
        if (!graph.hasNode(op.nodeId)) break;
        for (const edge of graph.outEdges(op.nodeId)) seedEdges.add(edge.id);
        for (const edge of graph.inEdges(op.nodeId)) seedEdges.add(edge.id);
        break;
      }

      case 'update-edge-ports': {
        seedEdges.add(op.id);
        break;
      }

      // An edge attribute is read by no stage in this package: sizes come from
      // nodes and routes come from ranks. It names the edge because a caller's
      // own router may read one, and widens no band because moving a node on
      // an edge attribute would be a stage doing something this pipeline has
      // no contract for.
      case 'update-edge-attrs': {
        seedEdges.add(op.id);
        break;
      }

      // Graph attributes reach the layout through the config, which is bound
      // to the engine and cannot change under a patch.
      default:
        break;
    }
  }

  if (rises) top = Number.NEGATIVE_INFINITY;
  if (falls) bottom = Number.POSITIVE_INFINITY;
  const lowest = top - window;
  const deepest = bottom + window;

  const nodes = new Set<NodeId>(seedNodes);
  for (const [id, rank] of previous.ranks) {
    if (previous.virtualNodes.has(id)) continue;
    if (rank >= lowest && rank <= deepest) nodes.add(id);
  }
  // A node the previous run never ranked arrived with this patch or one the
  // engine has not laid out yet, and either way its coordinates are new.
  for (const node of graph.nodes()) {
    if (!previous.ranks.has(node.id)) nodes.add(node.id);
  }

  const edges = new Set<EdgeId>(seedEdges);
  for (const edge of graph.edges()) {
    if (edges.has(edge.id)) continue;
    if (nodes.has(edge.source) || nodes.has(edge.target)) {
      edges.add(edge.id);
      continue;
    }
    const source = previous.ranks.get(edge.source);
    const target = previous.ranks.get(edge.target);
    if (source === undefined || target === undefined) {
      edges.add(edge.id);
      continue;
    }
    // The ranks the edge is drawn through, which is what a dummy chain
    // occupies and what makes this edge reroute when one of them changes.
    if (Math.min(source, target) <= deepest && Math.max(source, target) >= lowest) {
      edges.add(edge.id);
    }
  }

  return { nodes, edges };
}

/**
 * Whether a node keeps its rank once the edge from `rank - 1` above it goes.
 *
 * Longest-path rank is the deepest predecessor plus one, so one remaining
 * predecessor at that depth is enough to pin it, and the check stops at the
 * first. The node may already be gone, since removing a node emits the removal
 * of its edges first, and a rank nothing holds is a rank nothing can rise from.
 */
function pinnedFrom(
  graph: Graph,
  previous: PreviousLayout,
  target: NodeId,
  rank: number,
): boolean {
  if (!graph.hasNode(target)) return true;
  for (const predecessor of graph.predecessors(target)) {
    if (predecessor === target) continue;
    if (previous.ranks.get(predecessor) === rank - 1) return true;
  }
  return false;
}
