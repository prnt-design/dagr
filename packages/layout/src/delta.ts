import type { EdgeId, NodeId } from '@dagr/graph';
import { DeltaMismatchError, InvalidConfigError } from './errors.js';
import type {
  LayoutResult,
  NodeGeometry,
  Point,
  PositionedNode,
  Rect,
  RoutedEdge,
} from './types.js';

/**
 * A node whose box is not where it was: the geometry before, and the geometry
 * after.
 *
 * `from` and `to` are whole boxes rather than centres, so a node that only
 * changed SIZE is a move as well. A label that grew measures wider on the next
 * run and its centre need not shift at all, and a delta that left that out
 * would leave a consumer applying deltas drawing the old size forever, which is
 * the same desynchronisation a dropped move is, arriving through a field nobody
 * had thought of as motion. One list rather than a `moved` and a `resized` for
 * the same reason the tolerance is one number: the question a consumer asks per
 * node is whether this box is materially different from the last one it drew,
 * and splitting the answer in two makes every consumer join it back up.
 *
 * ABSOLUTE, and only absolute. The displacement is `to.x - from.x` and belongs
 * to whoever wants it: springs retarget to an absolute position, so `to` is
 * required, and M3.4's stability metric sums the displacement, which it can
 * derive in the same pass it sums it in. A third field carrying the difference
 * would be a cache of two numbers that are right there, and a cache that can
 * disagree with them.
 */
export interface MovedNode {
  readonly id: NodeId;
  readonly from: NodeGeometry;
  readonly to: NodeGeometry;
}

/** An edge whose polyline changed: the route before, and the route after. */
export interface ReroutedEdge {
  readonly id: EdgeId;
  readonly from: readonly Point[];
  readonly to: readonly Point[];
}

/** The bounding box before and after, present only when it changed. */
export interface BoundsChange {
  readonly from: Rect;
  readonly to: Rect;
}

/** What happened to the nodes between two results. */
export interface NodeDelta {
  /** Nodes the next result holds and the previous one did not, whole. */
  readonly added: readonly PositionedNode[];

  /** Ids the previous result held and the next one does not. */
  readonly removed: readonly NodeId[];

  /** Nodes both results hold whose box changed by more than the tolerance. */
  readonly moved: readonly MovedNode[];
}

/**
 * What happened to the edges between two results.
 *
 * ONE ID CAN BE IN BOTH `removed` AND `added`, which is how an edge that
 * changed endpoints is reported (see {@link diffLayout}), and it is the one
 * thing a consumer applying these lists by hand has to know: APPLY REMOVALS
 * BEFORE ADDITIONS. The other order deletes the edge that just arrived and
 * leaves nothing where an edge should be. {@link applyDelta} does it in that
 * order for this reason.
 */
export interface EdgeDelta {
  /** Edges the next result holds and the previous one did not, whole. */
  readonly added: readonly RoutedEdge[];

  /** Ids the previous result held and the next one does not. */
  readonly removed: readonly EdgeId[];

  /** Edges both results hold whose polyline changed by more than the tolerance. */
  readonly rerouted: readonly ReroutedEdge[];
}

/**
 * The difference between two {@link LayoutResult}s: what appeared, what went
 * away, what moved, and what the box around the lot became.
 *
 * ABSENT MEANS UNCHANGED. A node that did not move is not in here at all, not
 * even with a marker saying so, which is the decision that makes a delta
 * proportional to the change rather than to the graph. That is the whole point
 * of the type, and it is what M4.7's spring consumer wants: nothing to animate
 * is nothing to iterate. The cost is that a delta is not self-describing, so a
 * consumer cannot rebuild a scene from one alone; it needs the result the delta
 * was computed against, which {@link applyDelta} is the reference for. The
 * alternative, flagging every unchanged node, would make every delta the size
 * of the graph to buy a rebuild path that a caller who has kept the previous
 * result already has, and a caller who has not can simply be handed the next
 * result whole.
 *
 * ARRAYS rather than records keyed by id. Arrays are cheaper to build, they
 * carry an order this type can promise (see {@link diffLayout}), and they cross
 * a worker boundary as arrays rather than as objects whose keys are caller
 * strings, which is where `__proto__` and friends stop being a curiosity. A
 * consumer that wants O(1) lookup builds one map in one pass over a list that
 * is already proportional to the change; a consumer that wants to iterate,
 * which is every renderer, wanted the array.
 *
 * `bounds` is `undefined` rather than absent-as-a-key when it did not change,
 * so a hand-built delta cannot forget to say which it meant.
 */
export interface LayoutDelta {
  readonly nodes: NodeDelta;
  readonly edges: EdgeDelta;
  readonly bounds: BoundsChange | undefined;
}

/**
 * What {@link diffLayout} may be told, which is one number.
 *
 * `epsilon` is the smallest change worth reporting, in the same units as
 * everything else here, which is to say in node-size units. Default 0, which
 * reports any difference at all.
 *
 * It is named HERE, on the comparison, and not on `LayoutConfig`. The M3.1
 * entry in `ROADMAP.md` argued for the config on the grounds that the number is
 * in node-size units and only the caller knows that scale, and the first half
 * of that survives while the conclusion does not: every field of `LayoutConfig`
 * answers "how should this graph be laid out", is resolved once per RUN, and is
 * threaded to stages, and no stage can read a tolerance that is about two
 * results. Putting it there would have carried a number nothing reads into
 * `ResolvedLayoutConfig`, across the worker wire, and into every one-shot
 * `layout()` call, which has nothing to compare itself to. The caller still
 * picks the number; M3.2's engine, which is the first thing to hold a config
 * and two results at once, is where it gets named once and passed through in
 * one place.
 *
 * A NONZERO EPSILON IS NOT TRANSITIVE, and that is a design consequence rather
 * than a caveat. Fifty steps of 0.9 epsilon each report nothing, and a consumer
 * diffing each run against the last COMPUTED one ends 45 epsilon out of
 * position with nothing in the system able to notice. So the diff has to run
 * against the last REPORTED geometry: the result the consumer was actually told
 * about, which is the previous reported result with this delta applied to it.
 * An engine retaining deltas therefore keeps a reported-geometry snapshot
 * distinct from its true pipeline state, and `test/layout.delta.test.ts` holds
 * both loops side by side, one drifting and one not.
 *
 * The reason for a tolerance is consumer-facing and never numerical. A move too
 * small to see is not worth animating; a move that appears because the same
 * stage given the same inputs returned different numbers is a determinism bug
 * to fix rather than a wobble to threshold away. IEEE 754 is deterministic, and
 * on an anchored fast path untouched coordinates are copied and therefore
 * bit-identical, so the epsilon only ever does anything on a fallback path that
 * recomputed a coordinate it could have kept.
 */
export interface LayoutDiffOptions {
  readonly epsilon?: number;
}

/**
 * Whether two numbers differ by more than the tolerance.
 *
 * Phrased as the negation of "within tolerance" rather than as
 * `Math.abs(left - right) > epsilon`, which is the same thing for every pair of
 * real numbers and not the same thing for `NaN`: every comparison against `NaN`
 * is false, so the strict form calls a coordinate that turned into `NaN`
 * unchanged and drops it. The pipeline rejects a `NaN` coordinate long before a
 * result is assembled, so this can only arrive in a hand-built result, and a
 * hand-built result full of `NaN` is exactly the case where a diff reporting
 * nothing is the least helpful answer available.
 */
function differs(left: number, right: number, epsilon: number): boolean {
  return !(Math.abs(left - right) <= epsilon);
}

/** Whether a node's box moved or resized past the tolerance. */
function boxDiffers(left: NodeGeometry, right: NodeGeometry, epsilon: number): boolean {
  return (
    differs(left.x, right.x, epsilon) ||
    differs(left.y, right.y, epsilon) ||
    differs(left.width, right.width, epsilon) ||
    differs(left.height, right.height, epsilon)
  );
}

/**
 * Whether a route changed past the tolerance.
 *
 * A different number of points is a different route whatever the tolerance
 * says, and no per-point comparison would catch it: a bend appearing is the
 * observable half of a long edge gaining a rank to cross, and the points on
 * either side of the new one can sit exactly where they were.
 */
function routeDiffers(left: readonly Point[], right: readonly Point[], epsilon: number): boolean {
  if (left.length !== right.length) return true;
  for (const [index, point] of left.entries()) {
    const other = right[index];
    // Unreachable: the lengths are equal, so the index is in both.
    if (other === undefined) return true;
    if (differs(point.x, other.x, epsilon) || differs(point.y, other.y, epsilon)) return true;
  }
  return false;
}

/** The four numbers of a node's box, without its id. */
function geometryOf(node: PositionedNode): NodeGeometry {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/**
 * The same rule the config enforces, for the one number this module takes.
 *
 * Exported inside the package rather than kept private because M3.2's engine
 * takes the same number on its own options and has to refuse it by the same
 * rule, at construction rather than on the first relayout. One rule, one place,
 * one error.
 */
export function requireEpsilon(epsilon: number | undefined): number {
  if (epsilon === undefined) return 0;
  if (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0) {
    throw new InvalidConfigError('epsilon', epsilon, 'option');
  }
  return epsilon;
}

/**
 * What changed between two layout results.
 *
 * A pure function over two results and a number: no engine, no graph, no
 * incremental algorithm, and nothing retained between calls. That is why this
 * is the first task of M3 rather than a consequence of one of the later ones.
 * Every incremental stage after it is judged by the delta it emits, and this is
 * the thing that emits it, so the shape has to exist before the algorithms that
 * are measured against it. See {@link LayoutDelta} for the shape and
 * {@link LayoutDiffOptions} for what the tolerance means.
 *
 * ORDER IS PART OF THE CONTRACT, because "deterministic" and "in an order you
 * can rely on" are different promises and only the second one lets a consumer
 * commit a golden file. `added` and `moved` come out in the NEXT result's
 * iteration order and `removed` in the PREVIOUS one's, which for both is graph
 * insertion order, because that is the order a `LayoutResult`'s maps iterate
 * in. Each group is the order of the result it came from, which is the only
 * order available to it: an id in `removed` has no place in the next result at
 * all.
 *
 * AN EDGE THAT CHANGED ENDPOINTS IS A REMOVAL AND AN ADDITION, listed in both
 * groups under the one id, rather than a reroute. Nothing in `@dagr/graph`
 * rebinds an edge's ends, but an edge id is the caller's own string and two
 * runs need not be of the same graph: a patch that removed `e1` from `a` to `b`
 * and added `e1` from `a` to `c` produces exactly this, and reporting it as a
 * reroute would leave a consumer holding the old endpoints under the new
 * polyline, drawing an edge that agrees with no graph. Node identity has no
 * matching case, since a node is an id and nothing else.
 *
 * Cost is one pass over each result, so O(nodes + edges) with a map lookup per
 * entry and no allocation for anything unchanged.
 *
 * @throws {InvalidConfigError} when `epsilon` is not a finite number that is
 * zero or greater.
 */
export function diffLayout(
  previous: LayoutResult,
  next: LayoutResult,
  options?: LayoutDiffOptions,
): LayoutDelta {
  const epsilon = requireEpsilon(options?.epsilon);

  const addedNodes: PositionedNode[] = [];
  const movedNodes: MovedNode[] = [];
  for (const [id, node] of next.nodes) {
    const before = previous.nodes.get(id);
    if (before === undefined) {
      addedNodes.push(node);
      continue;
    }
    if (boxDiffers(before, node, epsilon)) {
      movedNodes.push({ id, from: geometryOf(before), to: geometryOf(node) });
    }
  }
  const removedNodes: NodeId[] = [];
  for (const id of previous.nodes.keys()) {
    if (!next.nodes.has(id)) removedNodes.push(id);
  }

  const addedEdges: RoutedEdge[] = [];
  const reroutedEdges: ReroutedEdge[] = [];
  // The ids that are in both results but are not the same edge, collected on
  // the way past so the removal pass below can list them without asking the
  // endpoint question a second time.
  const rebound = new Set<EdgeId>();
  for (const [id, edge] of next.edges) {
    const before = previous.edges.get(id);
    if (before === undefined) {
      addedEdges.push(edge);
      continue;
    }
    if (before.source !== edge.source || before.target !== edge.target) {
      rebound.add(id);
      addedEdges.push(edge);
      continue;
    }
    if (routeDiffers(before.points, edge.points, epsilon)) {
      reroutedEdges.push({ id, from: before.points, to: edge.points });
    }
  }
  const removedEdges: EdgeId[] = [];
  for (const id of previous.edges.keys()) {
    if (!next.edges.has(id) || rebound.has(id)) removedEdges.push(id);
  }

  const bounds = boundsChange(previous.bounds, next.bounds, epsilon);

  return {
    nodes: { added: addedNodes, removed: removedNodes, moved: movedNodes },
    edges: { added: addedEdges, removed: removedEdges, rerouted: reroutedEdges },
    bounds,
  };
}

/** The bounds before and after, or `undefined` when they agree within epsilon. */
function boundsChange(previous: Rect, next: Rect, epsilon: number): BoundsChange | undefined {
  const changed =
    differs(previous.x, next.x, epsilon) ||
    differs(previous.y, next.y, epsilon) ||
    differs(previous.width, next.width, epsilon) ||
    differs(previous.height, next.height, epsilon);
  return changed ? { from: previous, to: next } : undefined;
}

/**
 * Whether a delta says anything happened.
 *
 * One function rather than six comparisons at each call site, because "is there
 * anything to do" is the first question every consumer asks and the seventh
 * field this type grows is the one a hand-written check forgets.
 */
export function isEmptyDelta(delta: LayoutDelta): boolean {
  return (
    delta.nodes.added.length === 0 &&
    delta.nodes.removed.length === 0 &&
    delta.nodes.moved.length === 0 &&
    delta.edges.added.length === 0 &&
    delta.edges.removed.length === 0 &&
    delta.edges.rerouted.length === 0 &&
    delta.bounds === undefined
  );
}

/**
 * The result a delta describes, from the result it was computed against.
 *
 * `applyDelta(previous, diffLayout(previous, next))` holds every node, edge and
 * bound of `next`, exactly at `epsilon: 0` and to within epsilon otherwise.
 * That round trip is what the delta MEANS, and it lives here as executable code
 * rather than only as a paragraph because a consumer that applies deltas
 * differently from this function has a bug the delta type cannot catch. M4.7's
 * renderer applies them to a scene rather than to a result and cannot call
 * this; what it can do is be checked against it.
 *
 * ITERATION ORDER IS THE ONE THING IT DOES NOT REPRODUCE. The returned maps
 * hold what survived in the previous result's order, with what was added
 * appended, because that is the only order available from a previous result and
 * a delta: the next result's insertion order is not in either of them. Nothing
 * in this package's contract rests on it (`bounds` is a hull and a renderer
 * keyed by id does not care), and a consumer that needs the graph's insertion
 * order has the graph.
 *
 * A new result rather than a mutation, so the previous one stays usable, which
 * is what a caller retaining a reported-geometry snapshot needs: the snapshot
 * it had is still the snapshot it had.
 *
 * `from` is NOT checked against what the result currently holds, only presence
 * is. The two disagree legitimately whenever a delta was computed with a
 * nonzero epsilon against reported geometry, and this function's job is to
 * reach `to` rather than to relitigate where the caller thought it was.
 *
 * @throws {DeltaMismatchError} when the delta names something the result does
 * not hold, or adds something it already does.
 */
export function applyDelta(previous: LayoutResult, delta: LayoutDelta): LayoutResult {
  const nodes = new Map(previous.nodes);
  for (const id of delta.nodes.removed) {
    if (!nodes.delete(id)) {
      throw new DeltaMismatchError(id, 'is removed by this delta but the result does not hold it');
    }
  }
  for (const move of delta.nodes.moved) {
    if (!nodes.has(move.id)) {
      throw new DeltaMismatchError(
        move.id,
        'is moved by this delta but the result does not hold it',
      );
    }
    nodes.set(move.id, { id: move.id, ...move.to });
  }
  for (const node of delta.nodes.added) {
    if (nodes.has(node.id)) {
      throw new DeltaMismatchError(node.id, 'is added by this delta but the result already holds it');
    }
    nodes.set(node.id, node);
  }

  // Removals before additions, because an edge that changed endpoints is in
  // both groups under one id and the delta means "that edge went, this one
  // arrived" rather than "this id was touched twice".
  const edges = new Map(previous.edges);
  for (const id of delta.edges.removed) {
    if (!edges.delete(id)) {
      throw new DeltaMismatchError(id, 'is removed by this delta but the result does not hold it');
    }
  }
  for (const reroute of delta.edges.rerouted) {
    const before = edges.get(reroute.id);
    if (before === undefined) {
      throw new DeltaMismatchError(
        reroute.id,
        'is rerouted by this delta but the result does not hold it',
      );
    }
    edges.set(reroute.id, { ...before, points: reroute.to });
  }
  for (const edge of delta.edges.added) {
    if (edges.has(edge.id)) {
      throw new DeltaMismatchError(edge.id, 'is added by this delta but the result already holds it');
    }
    edges.set(edge.id, edge);
  }

  return { nodes, edges, bounds: delta.bounds?.to ?? previous.bounds };
}
