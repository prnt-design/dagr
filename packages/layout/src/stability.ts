/**
 * What stable means, and how much of it a run has.
 *
 * Two things, and the split between them is M3.4's decision. THE CONTRACT is a
 * hard, exact assertion, `stabilityViolations`: nothing outside a relayout's
 * influence set changed at all. THE METRIC is a set of numbers over two
 * results, `measureStability`: how far the drawing moved and how much of it
 * rearranged. The contract governs the paths that keep coordinates and the
 * metric governs the fallback that recomputes them, which is the shape the M3.4
 * roadmap entry predicted and the reason both ship in one module rather than
 * one of them shipping later.
 *
 * WHY BOTH, said once. A contract alone certifies nothing about a full
 * relayout, because a run that recomputes everything is entitled to move
 * everything and the assertion passes without measuring the drawing. A metric
 * alone lets a regression land as long as it stays under the bar, which is how
 * stability becomes a claim rather than a test: the number goes up by four
 * percent per milestone and no run is the one that broke it. Each covers the
 * other's blind spot, and neither is a weaker version of the other.
 *
 * WHY THE CONTRACT IS SCOPED TO THE INFLUENCE SET AND NOT TO THE PATCH, which
 * is the part that has to survive insertion. Take hard anchoring literally:
 * untouched nodes hold their coordinates, the intra-rank order is fixed, and
 * M2.7 requires a minimum separation. Now insert one node into a rank between
 * two anchored neighbours exactly `nodeSep` apart. There is no coordinate for
 * it. The system is infeasible, and the only exits are moving an anchor (so
 * stability was never exact) or overlapping two boxes (so M2.7's invariant test
 * fails). That is not an edge case, it is the most common patch a pattern
 * generator emits. So the claim this module makes is the achievable one: a node
 * outside the INFLUENCE SET keeps its coordinate exactly, where the influence
 * set is defined to include whatever an insertion widened. The impossible form
 * is not available here, deliberately, so no later task can reach for it by
 * accident. `test/layout.stability.test.ts` holds the demonstration: a batched
 * one-node insertion into the diamond moves nodes the patch never names.
 *
 * EVERY METRIC IS SCOPED BY THE SET IT IS TAKEN OVER, and this module takes
 * them over the SHARED roster, meaning the ids both results hold. A node that
 * did not exist before has no displacement, and an average taken over only the
 * nodes that MOVED rises as a layout gets more stable, because the small moves
 * drop out of the set and the large ones are what is left to average. A metric
 * that gets worse when the thing it measures gets better is not a regression
 * gate. Additions and removals are reported as their own counts beside it.
 */

import type { EdgeId, NodeId } from '@dagr/graph';
import { diffLayout } from './delta.js';
import type { LayoutDelta, LayoutDiffOptions } from './delta.js';
import type { InfluenceSet } from './influence.js';
import type { LayoutResult, NodeGeometry, Point } from './types.js';

/**
 * How much the nodes of a drawing moved and rearranged.
 *
 * `shared` is the denominator of every fraction and every mean here: the ids
 * both results hold. `added` and `removed` sit beside it rather than inside it,
 * because a node that arrived did not move.
 */
export interface NodeStability {
  /** Ids both results hold. The set every number below is taken over. */
  readonly shared: number;

  /** Ids only the next result holds. */
  readonly added: number;

  /** Ids only the previous result holds. */
  readonly removed: number;

  /** Shared nodes whose box differs by more than the tolerance. */
  readonly moved: number;

  /** {@link moved} over {@link shared}, and zero when nothing is shared. */
  readonly movedFraction: number;

  /**
   * Mean centre-to-centre distance travelled, over every shared node.
   *
   * A node that did not move contributes zero rather than being left out. See
   * the module docstring for why the denominator is the whole shared roster.
   *
   * CENTRE TO CENTRE, so a node whose label grew and whose centre did not shift
   * contributes zero here while still counting in {@link moved}. A resize is a
   * change a consumer has to draw and is not a distance anything travelled, and
   * folding the two together would make one number answer two questions badly.
   */
  readonly meanDisplacement: number;

  /** The furthest any one shared node travelled, and zero when none did. */
  readonly maxDisplacement: number;

  /**
   * The fraction of shared nodes that changed rank.
   *
   * ABSOLUTE, which has a consequence worth knowing before reading the number:
   * a patch that inserts a whole new row ABOVE the drawing renumbers every rank
   * under it and reports total rank churn. That is true rather than a bug,
   * since every node really is one row further down, but it means a single
   * insertion at the top produces the same number a total reshuffle does. The
   * absolute form is still the right one, because a drawing has an anchored
   * top: `gridPositionStage` stacks rows from `y = 0`, so a rank index is a
   * fact about where a node is drawn rather than an arbitrary label. Compare
   * {@link orderChurn}, which has no anchor to be absolute about.
   */
  readonly rankChurn: number;

  /**
   * The fraction of rank-neighbour pairs that changed places.
   *
   * RELATIVE, and this is the one place the two churn metrics differ in kind.
   * The absolute form, "did this node keep its index within its rank", calls a
   * whole rank churned when one node is inserted at its head, which is the most
   * common patch there is and a case where nothing changed places with anything.
   * An index within a rank is a position among siblings whose value means
   * nothing on its own (index 3 of 4 and index 4 of 5 are the same slot), so
   * only the relative form measures a drawing rather than a count.
   *
   * Measured over pairs that were ADJACENT in the previous result's rank and
   * that share a rank in the next one: a pair whose two members ended up in
   * different rows has no order to have kept, and counting it here would report
   * one rank change twice.
   */
  readonly orderChurn: number;
}

/**
 * How much the edges of a drawing rerouted.
 *
 * The node metrics certify the wrong thing on their own. A layout can score
 * perfectly on all of the above while every polyline in the drawing re-routes,
 * which is exactly what an unstable dummy chain produces: node coordinates
 * bit-identical and the lines between them different on every patch. So the
 * edges get the same treatment, and the two numbers below answer two different
 * questions on purpose. See {@link maxRouteDistance} and {@link bendChurn}.
 */
export interface EdgeStability {
  /**
   * Edges both results hold, with the same endpoints.
   *
   * An edge whose endpoints changed is not shared: it is a removal and an
   * addition under one id, the way `diffLayout` reports it, because an edge id
   * is the caller's own string and an `e1` that used to run to `b` and now runs
   * to `c` is not an `e1` that rerouted.
   */
  readonly shared: number;

  /** Ids only the next result holds, plus any whose endpoints changed. */
  readonly added: number;

  /** Ids only the previous result holds, plus any whose endpoints changed. */
  readonly removed: number;

  /** Shared edges whose polyline differs by more than the tolerance. */
  readonly rerouted: number;

  /** {@link rerouted} over {@link shared}, and zero when nothing is shared. */
  readonly reroutedFraction: number;

  /** Mean route distance over every shared edge. See {@link maxRouteDistance}. */
  readonly meanRouteDistance: number;

  /**
   * The furthest any one shared edge's drawn line moved.
   *
   * The symmetric Hausdorff distance between the two polylines: the greatest
   * distance from a vertex of either route to the OTHER route taken as a curve,
   * segments and all. Hausdorff rather than a per-vertex sum, and the reason is
   * the case that matters most: a route that gained a bend has more vertices
   * than it had, and a per-vertex comparison cannot even be spelled between two
   * lists of different lengths, let alone answer with a distance. Gaining a
   * bend is the observable half of a long edge crossing one more rank, so a
   * metric that gives up exactly there measures nothing about the drawings that
   * change most.
   *
   * It is computed from the VERTICES of each route against the SEGMENTS of the
   * other, rather than from every point of both curves, which lower-bounds the
   * true Hausdorff distance between two curves. That is exact for the only
   * question this metric decides: two polylines with the same vertices are the
   * same polyline, so a distance of zero means the same line was drawn, and a
   * distance above zero is a line a reader can see moved. What it does not
   * claim is the last decimal place of how far a bulging segment strayed.
   *
   * Zero does NOT mean the route is unchanged. A point added on the line the
   * route already ran along draws the same picture and measures zero here,
   * while still being a different polyline to anything binding per segment.
   * {@link bendChurn} is the metric that catches it, and that split is why both
   * ship.
   */
  readonly maxRouteDistance: number;

  /**
   * The fraction of shared edges whose bend count changed.
   *
   * A bend is an interior point of the polyline, so a straight two-point route
   * has none. See {@link maxRouteDistance} for what this catches that a
   * distance cannot.
   */
  readonly bendChurn: number;

  /** Mean absolute change in bend count, over every shared edge. */
  readonly meanBendChange: number;

  /** The largest change in bend count on any one shared edge. */
  readonly maxBendChange: number;
}

/** What two results say about how stable the layout between them was. */
export interface StabilityReport {
  readonly nodes: NodeStability;
  readonly edges: EdgeStability;
}

/** How a result stopped being what the contract said it would be. */
export type StabilityViolationKind =
  | 'node-added'
  | 'node-moved'
  | 'node-removed'
  | 'edge-added'
  | 'edge-rerouted'
  | 'edge-removed';

/**
 * One thing that changed and was not entitled to.
 *
 * The id and what happened to it, and nothing else. No message string: the
 * caller knows which two results it handed over and which set it claimed, and a
 * sentence assembled here would be a sentence every consumer parses back apart.
 */
export interface StabilityViolation {
  readonly id: NodeId | EdgeId;
  readonly kind: StabilityViolationKind;
}

/** The distance between two node centres. */
function displacement(from: NodeGeometry, to: NodeGeometry): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** How far a point is from a segment, measuring to the nearer end when it degenerates. */
function pointToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const square = dx * dx + dy * dy;
  if (square === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const along = ((point.x - start.x) * dx + (point.y - start.y) * dy) / square;
  const clamped = along < 0 ? 0 : along > 1 ? 1 : along;
  return Math.hypot(point.x - (start.x + clamped * dx), point.y - (start.y + clamped * dy));
}

/** How far a point is from a polyline, taken as a curve rather than as its vertices. */
function pointToPolyline(point: Point, line: readonly Point[]): number {
  const first = line[0];
  if (first === undefined) return 0;
  if (line.length === 1) return Math.hypot(point.x - first.x, point.y - first.y);
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    // Unreachable: both indices are inside a list of at least two points.
    if (start === undefined || end === undefined) continue;
    const distance = pointToSegment(point, start, end);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/** The furthest any vertex of one route is from the other route. */
function directedDistance(from: readonly Point[], to: readonly Point[]): number {
  let furthest = 0;
  for (const point of from) {
    const distance = pointToPolyline(point, to);
    if (distance > furthest) furthest = distance;
  }
  return furthest;
}

/**
 * How far apart two routes are drawn. See {@link EdgeStability.maxRouteDistance}.
 *
 * An empty polyline measures zero against anything, because there is no
 * distance to a curve that is not there. The router emits both endpoints on
 * every route so this can only arrive in a hand-built result, and the reroute
 * is still counted: it is the distance that has nothing to say, not the diff.
 */
function routeDistance(from: readonly Point[], to: readonly Point[]): number {
  if (from.length === 0 || to.length === 0) return 0;
  return Math.max(directedDistance(from, to), directedDistance(to, from));
}

/** Interior points of a polyline, which is what a bend is. */
function bendCount(points: readonly Point[]): number {
  return Math.max(0, points.length - 2);
}

/** Where each node sits in the stack of rows, and where it sits within its row. */
interface RankIndex {
  readonly rankOf: ReadonlyMap<NodeId, number>;
  readonly orderOf: ReadonlyMap<NodeId, number>;
}

/**
 * Ranks and intra-rank order, read back off a result.
 *
 * A `LayoutResult` carries no ranks, so they are derived, and the derivation is
 * exact rather than a guess: `gridPositionStage` gives every node of a row the
 * same centre line and stacks the rows from `y = 0`, so nodes sharing a `y`
 * share a rank and sorting the distinct values gives the rank indices. Within a
 * row, `x` ascending is the order, ties broken by the result's own iteration
 * order so that a hand-built result with two boxes at one `x` still indexes
 * deterministically.
 *
 * Deriving rather than plumbing the real ranks through is what keeps every
 * metric here a function of two results, which is what lets a consumer measure
 * two `layout()` calls with no engine and no pipeline state. The cost is that a
 * position stage that stopped giving a row one centre line would silently
 * change what these two numbers mean, which is a thing for such a stage to
 * declare rather than a thing this module can check.
 */
function rankIndex(result: LayoutResult): RankIndex {
  const rows = new Map<number, NodeId[]>();
  for (const [id, node] of result.nodes) {
    const row = rows.get(node.y);
    if (row === undefined) rows.set(node.y, [id]);
    else row.push(id);
  }

  const rankOf = new Map<NodeId, number>();
  const orderOf = new Map<NodeId, number>();
  const centres = [...rows.keys()].sort((left, right) => left - right);
  for (const [rank, centre] of centres.entries()) {
    const row = rows.get(centre) ?? [];
    const sorted = row
      .map((id, arrival) => ({ id, arrival, x: result.nodes.get(id)?.x ?? 0 }))
      .sort((left, right) => left.x - right.x || left.arrival - right.arrival);
    for (const [order, entry] of sorted.entries()) {
      rankOf.set(entry.id, rank);
      orderOf.set(entry.id, order);
    }
  }
  return { rankOf, orderOf };
}

/** The two churn numbers, which need both rosters rather than only the delta. */
type Churn = Pick<NodeStability, 'orderChurn' | 'rankChurn'>;

function churn(previous: LayoutResult, next: LayoutResult, shared: number): Churn {
  if (shared === 0) return { rankChurn: 0, orderChurn: 0 };

  const before = rankIndex(previous);
  const after = rankIndex(next);

  let changedRank = 0;
  // The shared nodes of each previous row, in that row's order, so the pairs
  // below are the pairs that were adjacent in the drawing.
  const rows = new Map<number, NodeId[]>();
  for (const [id, rank] of before.rankOf) {
    const now = after.rankOf.get(id);
    if (now === undefined) continue;
    if (now !== rank) changedRank += 1;
    const row = rows.get(rank);
    if (row === undefined) rows.set(rank, [id]);
    else row.push(id);
  }
  for (const row of rows.values()) {
    row.sort((left, right) => (before.orderOf.get(left) ?? 0) - (before.orderOf.get(right) ?? 0));
  }

  let pairs = 0;
  let discordant = 0;
  for (const row of rows.values()) {
    for (let index = 1; index < row.length; index += 1) {
      const left = row[index - 1];
      const right = row[index];
      // Unreachable: both indices are inside the row.
      if (left === undefined || right === undefined) continue;
      // A pair whose members ended up in different rows has no order left to
      // have kept, and the rank metric has already reported the move.
      if (after.rankOf.get(left) !== after.rankOf.get(right)) continue;
      pairs += 1;
      if ((after.orderOf.get(left) ?? 0) > (after.orderOf.get(right) ?? 0)) discordant += 1;
    }
  }

  return {
    rankChurn: changedRank / shared,
    orderChurn: pairs === 0 ? 0 : discordant / pairs,
  };
}

/** The node half of a report, folded out of the delta. */
function nodeStability(delta: LayoutDelta, shared: number, rank: Churn): NodeStability {
  let total = 0;
  let furthest = 0;
  for (const move of delta.nodes.moved) {
    const distance = displacement(move.from, move.to);
    total += distance;
    if (distance > furthest) furthest = distance;
  }
  const moved = delta.nodes.moved.length;
  return {
    shared,
    added: delta.nodes.added.length,
    removed: delta.nodes.removed.length,
    moved,
    movedFraction: shared === 0 ? 0 : moved / shared,
    meanDisplacement: shared === 0 ? 0 : total / shared,
    maxDisplacement: furthest,
    ...rank,
  };
}

/** The edge half of a report, folded out of the delta. */
function edgeStability(delta: LayoutDelta, shared: number): EdgeStability {
  let totalDistance = 0;
  let furthest = 0;
  let totalBendChange = 0;
  let largestBendChange = 0;
  let bent = 0;
  for (const reroute of delta.edges.rerouted) {
    const distance = routeDistance(reroute.from, reroute.to);
    totalDistance += distance;
    if (distance > furthest) furthest = distance;

    const change = Math.abs(bendCount(reroute.to) - bendCount(reroute.from));
    totalBendChange += change;
    if (change > largestBendChange) largestBendChange = change;
    if (change !== 0) bent += 1;
  }
  const rerouted = delta.edges.rerouted.length;
  return {
    shared,
    added: delta.edges.added.length,
    removed: delta.edges.removed.length,
    rerouted,
    reroutedFraction: shared === 0 ? 0 : rerouted / shared,
    meanRouteDistance: shared === 0 ? 0 : totalDistance / shared,
    maxRouteDistance: furthest,
    bendChurn: shared === 0 ? 0 : bent / shared,
    meanBendChange: shared === 0 ? 0 : totalBendChange / shared,
    maxBendChange: largestBendChange,
  };
}

/**
 * How stable the layout between two results was.
 *
 * A pure function over two results and a tolerance, like `diffLayout`, and
 * built on top of it rather than beside it: the delta already answers what
 * moved, what arrived, what left, and which ids are the same edge, at the same
 * epsilon and under the same rules, so a second implementation of those
 * questions here would be a second set of answers to keep agreeing with the
 * first. The metrics are a fold over the delta plus the two rosters, which is
 * also why the numbers a task asserts on are the numbers its consumers see: the
 * thing measured is the thing emitted.
 *
 * The delta is recomputed rather than accepted as an argument, even though the
 * engine has one already. A delta passed in is a cache of two results that can
 * disagree with them, which is the field M3.1 refused on `MovedNode` for the
 * same reason, and the cost of recomputing it is one pass over each result.
 *
 * `options.epsilon` is the same number `diffLayout` takes and means the same
 * thing, so a report is scoped by the tolerance it was measured at: at the
 * default of 0 every difference counts, and at a nonzero one a node that moved
 * under the bar contributes nothing rather than contributing a small distance.
 *
 * @throws {InvalidConfigError} when `epsilon` is not a finite number that is
 * zero or greater.
 */
export function measureStability(
  previous: LayoutResult,
  next: LayoutResult,
  options?: LayoutDiffOptions,
): StabilityReport {
  const delta = diffLayout(previous, next, options);
  // What survived, counted off the delta rather than by intersecting the two
  // rosters: everything the previous result held that the delta did not take
  // away is in both. An edge whose endpoints changed is in `removed`, so it
  // drops out here exactly as it should.
  const sharedNodes = previous.nodes.size - delta.nodes.removed.length;
  const sharedEdges = previous.edges.size - delta.edges.removed.length;

  return {
    nodes: nodeStability(delta, sharedNodes, churn(previous, next, sharedNodes)),
    edges: edgeStability(delta, sharedEdges),
  };
}

/**
 * Everything that changed between two results and was not in the influence set.
 *
 * THE CONTRACT, and an empty list is it holding. See the module docstring for
 * what the influence set has to include for this to be satisfiable at all, and
 * why the stronger form ("a node the patch did not name keeps its coordinate")
 * is infeasible rather than merely hard.
 *
 * EXACT, WITH NO TOLERANCE, and that is a decision rather than an omission.
 * `diffLayout` takes an epsilon because a move too small to see is not worth
 * animating; nothing about that reasoning reaches here. A path entitled to keep
 * a coordinate KEEPS it, which is to say copies it, so the result is
 * bit-identical and any difference at all is a coordinate that was recomputed
 * when it should have been kept. Allowing a tolerance would let a fast path
 * quietly recompute the whole drawing and still pass, which is the one thing
 * this assertion exists to catch.
 *
 * IT CHECKS THE EDGES TOO. Node coordinates can be bit-identical while every
 * polyline in the drawing re-routes, which is what an unstable dummy chain
 * produces, so a contract over nodes alone certifies a drawing nobody looked
 * at.
 *
 * Violations come out nodes first and edges after, each group in the delta's
 * own order, which is the next result's iteration order for what arrived and
 * moved and the previous one's for what left.
 */
export function stabilityViolations(
  previous: LayoutResult,
  next: LayoutResult,
  influence: InfluenceSet,
): readonly StabilityViolation[] {
  const delta = diffLayout(previous, next);
  const violations: StabilityViolation[] = [];

  for (const node of delta.nodes.added) {
    if (!influence.nodes.has(node.id)) violations.push({ id: node.id, kind: 'node-added' });
  }
  for (const move of delta.nodes.moved) {
    if (!influence.nodes.has(move.id)) violations.push({ id: move.id, kind: 'node-moved' });
  }
  for (const id of delta.nodes.removed) {
    if (!influence.nodes.has(id)) violations.push({ id, kind: 'node-removed' });
  }

  for (const edge of delta.edges.added) {
    if (!influence.edges.has(edge.id)) violations.push({ id: edge.id, kind: 'edge-added' });
  }
  for (const reroute of delta.edges.rerouted) {
    if (!influence.edges.has(reroute.id)) violations.push({ id: reroute.id, kind: 'edge-rerouted' });
  }
  for (const id of delta.edges.removed) {
    if (!influence.edges.has(id)) violations.push({ id, kind: 'edge-removed' });
  }

  return violations;
}
