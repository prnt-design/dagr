import { MotionDesyncError } from './errors.js';
import { DEFAULT_MOTION_HALF_LIFE, DEFAULT_MOTION_REST } from './motion.js';
import { omegaForHalfLife, stepSpring2D } from './spring.js';
import type { Spring2DState } from './spring.js';
import type { Vec2 } from './types.js';
import { requireFinite, requireNonNegative, requirePositive } from './validate.js';

/**
 * The delta consumer, edge half: a scene's worth of routes, sprung towards the
 * routes a relayout gave them.
 *
 * M4.7a took the node half and left this one deliberately, because the two are
 * different problems wearing one entry. A node moves as a point, so one 2D
 * spring is the whole of it and the hard part is the bookkeeping between two
 * deltas. AN EDGE IS A POLYLINE WHOSE VERTEX COUNT CHANGES: a long edge that
 * gains a rank to cross gains a bend, and `@dagr/layout`'s `delta.ts` says in
 * as many words that no per-point comparison catches it. There is nothing to
 * retarget until something decides what corresponds to what, so the hard part
 * here is a CORRESPONDENCE and the state machine is the part that comes free.
 *
 * **THE CORRESPONDENCE IS RESAMPLING, AND THE METRIC THAT JUDGES IT SAYS THE
 * RESAMPLING COSTS NOTHING.** M4.7b's entry offers three ways out: resample
 * both routes to a common count, spring the control points of a curve instead
 * of the polyline, or animate the endpoints and re-route instantly. The third
 * is the one that gives up, since the bend appearing is exactly the change a
 * reader is trying to follow. The second needs a curve this package does not
 * have and would move the drawing off the line the layout computed even at
 * rest. The first is right, and the reason it is right is `@dagr/layout`'s own
 * `maxRouteDistance`: that metric is a Hausdorff distance between two
 * polylines taken as CURVES, and its
 * docstring already records what follows from that, that "a point added on the
 * line the route already ran along draws the same picture and measures zero".
 * So a correspondence built by adding points ON both routes is invisible to the
 * measurement M3.4 says this task is judged by. It is not a compromise between
 * two drawings; it is the same two drawings with more names for places on them.
 *
 * **WHICH POINTS TO ADD IS THE WHOLE OF THE DECISION, AND A COMMON COUNT IS THE
 * WRONG ANSWER.** Resampling both routes to `max(from.length, to.length)` evenly
 * spaced points is the obvious reading of "a common count" and it CUTS EVERY
 * CORNER: a bend at 40% of the way along a five-point sampling lands between
 * two samples and the drawing rounds it off. {@link alignRoutes} takes the UNION
 * of the two routes' own arc-length parameters instead, so every vertex of each
 * route survives in its own list exactly, and every point either list gains
 * sits on a segment the other route already had. The settled drawing is then
 * the layout's answer to the bit, which is the same commitment M4.7a made when
 * it snapped an arriving node onto its target rather than stopping within the
 * tolerance of it.
 *
 * **THE RESAMPLING IS FOR THE DRAWN TRANSITION, AND SETTLEMENT COMPACTS.** The
 * union is at most the two counts added together minus their two shared
 * endpoint parameters, and an edge that kept it would carry the shape of every
 * route it had ever taken: a hundred reroutes in a session is a polyline with
 * hundreds of vertices drawing a line with three. So arrival COMPACTS, back to
 * the target route's own points, which is exact because every extra point was
 * on a segment of that route. A settled edge therefore holds exactly what the
 * layout gave it, and the union-sized points are drawn only while the edge is
 * moving.
 *
 * **VELOCITY IS RESAMPLED WITH POSITION, AND THAT IS WHAT KEEPS A RETARGET
 * SMOOTH.** A polyline caught mid-flight has a velocity per point as well as a
 * position, so the point a retarget adds needs both. Interpolating the velocity
 * along the same parameter is exactly as defensible as interpolating the
 * position, and zeroing it instead would stop a moving edge dead at every new
 * bend, which is the interruptibility failure M4.7a's `from` field was refused
 * to avoid.
 *
 * Everything else is M4.7a's, deliberately: the same desynchronisation
 * polarity, the same all-or-nothing apply, the same departing state, the same
 * two options, and the same two defaults so that one delta's nodes and edges
 * arrive together. What is NOT here is the bounds change and the loop that
 * drives both halves, which are M4.7c's.
 */

/** Where an edge is being pulled to: its id, and its route in world units, y up. */
export interface EdgeMotionTarget {
  readonly id: string;
  /**
   * The centreline, world units, y up, source to target: at least two points.
   *
   * `RoutedEdge.points` from `@dagr/layout` after the caller's y flip, which is
   * the same conversion `SceneEdge.points` already asks for. The direction is a
   * contract there and is preserved here, because a route reversed mid-flight
   * would spring every point to the far end of the line.
   */
  readonly points: readonly Vec2[];
}

/**
 * What changed about the edges, in the shape M3.1's `EdgeDelta` gives it.
 *
 * The three lists are `@dagr/layout`'s: `added` is what the next layout holds
 * and the previous one did not, `removed` is ids the previous one held and the
 * next does not, and `rerouted` is edges both hold on a different polyline.
 * ABSENT MEANS UNCHANGED, so this iterates the change rather than the drawing.
 *
 * ONE ID CAN BE IN BOTH `removed` AND `added`, and unlike the node half this is
 * the case the rule was written for: that is how `EdgeDelta` reports that the
 * old edge left and a new edge with different endpoints arrived. Removals
 * apply first, and see {@link EdgeMotion.apply} for what the pair means.
 */
export interface EdgeMotionDelta {
  readonly added: readonly EdgeMotionTarget[];
  readonly removed: readonly string[];
  readonly rerouted: readonly EdgeMotionTarget[];
}

/**
 * One edge as it should be drawn this frame.
 *
 * READ IT, USE IT, DO NOT MUTATE IT, on M4.7a's terms and for M4.7a's reason: a
 * moving edge's `points` are fresh out of the springs every frame and a settled
 * edge's are the same array every frame, so copying per edge per frame would
 * double an allocation for a hazard the `readonly` describes.
 *
 * THE COUNT IS NOT STABLE ACROSS FRAMES. While an edge is in flight its points
 * are the union of the route it left and the route it is going to; on the frame
 * it arrives they are the target route's own. Both draw the same line at the
 * moment they change, and `Renderer.setEdges` rebuilds a group's geometry whole,
 * so nothing downstream binds per segment. A caller that does bind per segment
 * should key on the edge and not on the vertex.
 */
export interface MotionEdge {
  readonly id: string;
  /** The centreline as the springs have it, world units, y up. */
  readonly points: readonly Vec2[];
  /**
   * Whether a delta has removed this edge and its springs have not finished.
   *
   * A departing edge is still in the frame and may still be moving, so a caller
   * can fade it or keep drawing it until it goes. The frame after its springs
   * settle is the frame it is not in.
   */
  readonly departing: boolean;
}

/** One frame's worth of answer: what to draw, and whether to ask for another. */
export interface EdgeMotionFrame {
  readonly edges: readonly MotionEdge[];
  /**
   * True when every spring is exactly on its target with zero velocity.
   *
   * The same stopping predicate `MotionFrame` carries for the nodes, and a caller
   * driving both halves stops when both say so. Advancing a settled edge motion
   * by any elapsed time returns this same frame.
   */
  readonly settled: boolean;
}

/** How the motion should feel, and when it should call itself done. */
export interface EdgeMotionOptions {
  /**
   * Seconds to close half the distance to a target, released from rest.
   * Defaults to {@link DEFAULT_MOTION_HALF_LIFE}, which is the node half's
   * default too: one delta moves both, and two feels are two arrivals.
   */
  readonly halfLifeSeconds?: number;
  /**
   * How close, in world units, counts as arrived. Defaults to
   * {@link DEFAULT_MOTION_REST}. Per point: an edge is arrived when all of its
   * points are.
   */
  readonly restEpsilon?: number;
}

/** A scene's edge springs, and the three things that are done to them. */
export interface EdgeMotion {
  /**
   * Replaces the roster with `targets`, absolutely.
   *
   * The resync path, and also how a scene is seeded. An edge already here KEEPS
   * its springs, so a correction after a dropped delta is animated rather than
   * cut to; an edge not here starts on its route, at rest; an edge here and not
   * in `targets` is dropped with no departure, because a roster describes a
   * STATE and has no moment to animate from.
   */
  resync(targets: readonly EdgeMotionTarget[]): void;

  /**
   * Retargets the springs a delta names, and starts or cancels departures.
   *
   * ALL OR NOTHING, on M4.7a's reasoning: every id is checked before anything
   * is mutated, so a {@link MotionDesyncError} leaves the scene exactly as it
   * was and the caller's signal to resync arrives before the thing they would
   * resync from has moved.
   *
   * AN ID IN BOTH `removed` AND `added` IS A REPLACEMENT. `EdgeDelta` reports
   * changed endpoints this way because the old edge left and a new edge
   * arrived. The replacement is seeded immediately on its new directed route,
   * at rest, rather than retargeting springs that belonged to the old edge. A
   * genuinely rerouted edge present in both layouts still animates.
   */
  apply(delta: EdgeMotionDelta): void;

  /**
   * Steps every spring by `dtSeconds` and returns the frame to draw.
   *
   * Not clamped, on `spring.ts`'s terms: the step is exact, so a backgrounded
   * tab handing back a delta of minutes lands every route on its target and
   * shows the settled drawing rather than a minute of catch-up.
   */
  advance(dtSeconds: number): EdgeMotionFrame;
}

/** Two routes given a common list of places along themselves. See {@link alignRoutes}. */
export interface AlignedRoutes {
  /** The first route, resampled. Same length as {@link AlignedRoutes.to}. */
  readonly from: readonly Vec2[];
  /** The second route, resampled. Same length as {@link AlignedRoutes.from}. */
  readonly to: readonly Vec2[];
}

const AT_REST: Vec2 = { x: 0, y: 0 };

/** A copy of a caller's point, taken at the boundary. Nothing here retains one. */
function copyOf(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

/**
 * Rejects a route that is not at least two finite, representable points.
 *
 * Finite coordinates can still produce an infinite segment length or total
 * when subtraction or accumulation overflows.
 */
function requireRoute(points: readonly Vec2[], field: string): readonly Vec2[] {
  if (points.length < 2) {
    throw new RangeError(
      `${field} has to have at least two points, got ${String(points.length)}: ` +
        'a route with one point is not a line and has no direction to spring along',
    );
  }
  for (const [index, point] of points.entries()) {
    requireFinite(point.x, `${field}[${String(index)}].x`);
    requireFinite(point.y, `${field}[${String(index)}].y`);
  }
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (!Number.isFinite(length)) {
      throw new RangeError(`${field} segment ${String(index - 1)} length has to be finite`);
    }
    total += length;
    if (!Number.isFinite(total)) {
      throw new RangeError(`${field} total length has to be finite after segment ${String(index - 1)}`);
    }
  }
  return points;
}

/** A copy of a route, so nothing this module holds is a caller's array. */
function copyRoute(points: readonly Vec2[]): readonly Vec2[] {
  return points.map(copyOf);
}

/**
 * Where each vertex sits along the route, as a fraction of its total length.
 *
 * Ascending, first exactly 0 and last exactly 1, one per point. BY ARC LENGTH
 * rather than by index, because the parameter is what decides which places on
 * the two routes correspond, and the place a reader sees is a distance along
 * the line rather than a count of the bends before it. A two-point route and a
 * three-point route whose bend is near one end are not halfway through each
 * other at their middles.
 *
 * A ROUTE OF ZERO LENGTH FALLS BACK TO INDEX SPACING. Every point coinciding is
 * the only way the total can be zero, and it is the one division here that
 * could put a `NaN` into the drawing. Index spacing is not a better answer for
 * that route, it is an answer at all: every parameter maps to the same point,
 * so any spacing draws the same nothing, and the alternative is a route of
 * `NaN` that never settles.
 */
function routeParameters(points: readonly Vec2[]): number[] {
  const parameters: number[] = [];
  let total = 0;
  parameters.push(0);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    parameters.push(total);
  }
  const last = points.length - 1;
  if (total === 0) {
    for (let index = 0; index <= last; index += 1) parameters[index] = index / last;
    return parameters;
  }
  for (let index = 0; index < last; index += 1) {
    const value = parameters[index];
    if (value !== undefined) parameters[index] = value / total;
  }
  // Exactly one rather than one divided by itself, so the last parameter of
  // both routes is the same number and their endpoints always correspond.
  parameters[last] = 1;
  return parameters;
}

/**
 * The two ascending lists merged with the larger multiplicity of each value.
 *
 * Multiplicity matters when distinct vertices acquire the same parameter after
 * floating-point accumulation. Taking the maximum keeps every vertex from
 * either route without summing the copies both routes already share. Two
 * straight routes therefore still produce `{0, 1}`.
 */
function mergeParameters(left: readonly number[], right: readonly number[]): number[] {
  const merged: number[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const a = left[leftIndex];
    const b = right[rightIndex];
    // Unreachable: both indices are inside their own list.
    if (a === undefined || b === undefined) break;
    if (a < b) {
      merged.push(a);
      leftIndex += 1;
    } else if (b < a) {
      merged.push(b);
      rightIndex += 1;
    } else {
      let leftEnd = leftIndex + 1;
      while (leftEnd < left.length && left[leftEnd] === a) leftEnd += 1;
      let rightEnd = rightIndex + 1;
      while (rightEnd < right.length && right[rightEnd] === b) rightEnd += 1;
      const count = Math.max(leftEnd - leftIndex, rightEnd - rightIndex);
      for (let copy = 0; copy < count; copy += 1) merged.push(a);
      leftIndex = leftEnd;
      rightIndex = rightEnd;
    }
  }
  for (; leftIndex < left.length; leftIndex += 1) {
    const a = left[leftIndex];
    if (a !== undefined) merged.push(a);
  }
  for (; rightIndex < right.length; rightIndex += 1) {
    const b = right[rightIndex];
    if (b !== undefined) merged.push(b);
  }
  return merged;
}

/**
 * The polyline `values` read at every parameter in `at`, given its own
 * `parameters`.
 *
 * A PARAMETER THAT IS ONE OF THE POLYLINE'S OWN RETURNS THAT VERTEX EXACTLY,
 * by equality rather than by interpolating with a fraction that ought to come
 * out at zero or one. That is the property the whole correspondence rests on:
 * `to` resampled has to contain every vertex of `to` to the bit, or the route
 * the springs settle onto is a rounded copy of the one the layout computed.
 *
 * Used for velocities as well as for positions, with the POSITION route's
 * parameters both times, because index `i` of one list is index `i` of the
 * other and a velocity is a value along the line rather than a line of its own.
 */
function sampleAlong(
  values: readonly Vec2[],
  parameters: readonly number[],
  at: readonly number[],
): Vec2[] {
  const sampled: Vec2[] = [];
  let parameterCursor = 0;
  let atCursor = 0;
  while (atCursor < at.length) {
    const t = at[atCursor];
    if (t === undefined) break;
    let atEnd = atCursor + 1;
    while (atEnd < at.length && at[atEnd] === t) atEnd += 1;

    while (parameterCursor < parameters.length && (parameters[parameterCursor] ?? Infinity) < t) {
      parameterCursor += 1;
    }
    let parameterEnd = parameterCursor;
    while (parameterEnd < parameters.length && parameters[parameterEnd] === t) parameterEnd += 1;
    const ownCount = parameterEnd - parameterCursor;

    if (ownCount > 0) {
      for (let copy = 0; copy < atEnd - atCursor; copy += 1) {
        const index = parameterCursor + Math.min(copy, ownCount - 1);
        const value = values[index];
        if (value !== undefined) sampled.push(copyOf(value));
      }
      parameterCursor = parameterEnd;
    } else {
      const startIndex = Math.max(0, parameterCursor - 1);
      const endIndex = Math.min(parameterCursor, parameters.length - 1);
      const startParameter = parameters[startIndex];
      const endParameter = parameters[endIndex];
      const start = values[startIndex];
      const end = values[endIndex];
      if (
        startParameter !== undefined &&
        endParameter !== undefined &&
        start !== undefined &&
        end !== undefined
      ) {
        const span = endParameter - startParameter;
        const fraction = span === 0 ? 0 : (t - startParameter) / span;
        const point = {
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        };
        for (let copy = atCursor; copy < atEnd; copy += 1) sampled.push(copyOf(point));
      }
    }
    atCursor = atEnd;
  }
  return sampled;
}

/**
 * Two routes given a common list of places along themselves, so their points
 * correspond one for one.
 *
 * Both come back at the same length, every vertex of each survives in its own
 * list exactly, and every point either list gained lies on a segment that list
 * already had. The count is at most `from.length + to.length - 2` and is
 * exactly `from.length` when the two routes already parameterise the same way,
 * which two straight lines do.
 *
 * Exported because it is the decision this task makes rather than an
 * implementation detail of the springs: a caller animating edges with their own
 * curve, their own interpolation or their own clock needs the correspondence
 * before they need anything else, and there is nothing to reuse from
 * {@link createEdgeMotion} if it is buried inside it.
 *
 * @param from The route being left. At least two finite points whose segment
 *   lengths and total length are representable as finite numbers.
 * @param to The route being taken. At least two finite points whose segment
 *   lengths and total length are representable as finite numbers.
 */
export function alignRoutes(from: readonly Vec2[], to: readonly Vec2[]): AlignedRoutes {
  requireRoute(from, 'from');
  requireRoute(to, 'to');
  const fromParameters = routeParameters(from);
  const toParameters = routeParameters(to);
  const merged = mergeParameters(fromParameters, toParameters);
  return {
    from: sampleAlong(from, fromParameters, merged),
    to: sampleAlong(to, toParameters, merged),
  };
}

/** What this module knows about one edge between two deltas. */
interface EdgeEntry {
  /** One spring per point of the current correspondence, in draw order. */
  springs: Spring2DState[];
  /** Where each of those springs is going: the target route, resampled to match. */
  targets: Vec2[];
  /** The target route in its OWN point count: what arrival compacts back to. */
  rest: readonly Vec2[];
  /** What to draw this frame. The same array every frame while settled. */
  points: readonly Vec2[];
  departing: boolean;
  /**
   * Whether any spring is still in flight.
   *
   * Held rather than recomputed, for M4.7a's reason: it is what makes a settled
   * scene cost its own length and not its own arithmetic.
   */
  moving: boolean;
}

/** What a delta intends to do to one id, worked out before anything is done. */
type Intent =
  | { readonly kind: 'depart' }
  | { readonly kind: 'arrive'; readonly route: readonly Vec2[] }
  | { readonly kind: 'replace'; readonly route: readonly Vec2[] }
  | { readonly kind: 'reroute'; readonly route: readonly Vec2[]; readonly field: string };

/** A retarget worked out without changing the entry it came from. */
interface RetargetTransition {
  readonly springs: Spring2DState[];
  readonly targets: Vec2[];
  readonly rest: readonly Vec2[];
  readonly points: readonly Vec2[];
}

/** Whether an id is in the scene, and if so whether it is on its way out. */
type Presence = 'absent' | 'live' | 'departing';

/**
 * Creates a motion state for one scene's edges.
 *
 * @param options The feel and the arrival tolerance. See
 *   {@link EdgeMotionOptions}.
 */
export function createEdgeMotion(options: EdgeMotionOptions = {}): EdgeMotion {
  const halfLife = options.halfLifeSeconds ?? DEFAULT_MOTION_HALF_LIFE;
  const restEpsilon = options.restEpsilon ?? DEFAULT_MOTION_REST;
  requirePositive(halfLife, 'halfLifeSeconds');
  requirePositive(restEpsilon, 'restEpsilon');

  const w = omegaForHalfLife(halfLife);

  /**
   * The speed below which a spring counts as stopped, in world units per
   * second. Derived from the distance rather than passed, on M4.7a's argument:
   * `w` is the only inverse time in the system, so the tolerance has exactly
   * one speed scale and a caller expressing one opinion names one number.
   */
  const restSpeed = restEpsilon * w;

  const entries = new Map<string, EdgeEntry>();

  /**
   * Whether one stepped spring has arrived. Per axis, because `stepSpring2D` is
   * two independent scalar springs and not one spring in the plane, so the test
   * that matches the arithmetic is the one each axis can answer for itself.
   */
  function springAtRest(spring: Spring2DState, target: Vec2): boolean {
    return (
      Math.abs(spring.position.x - target.x) <= restEpsilon &&
      Math.abs(spring.position.y - target.y) <= restEpsilon &&
      Math.abs(spring.velocity.x) <= restSpeed &&
      Math.abs(spring.velocity.y) <= restSpeed
    );
  }

  /** Whether every one of an edge's springs has arrived. */
  function atRest(entry: EdgeEntry): boolean {
    for (const [index, spring] of entry.springs.entries()) {
      const target = entry.targets[index];
      if (target === undefined) return false;
      if (!springAtRest(spring, target)) return false;
    }
    return true;
  }

  /**
   * Puts an edge exactly on its route, in the route's own point count.
   *
   * Two things at once, and both are the same commitment M4.7a made per node.
   * EXACTLY, so a settled drawing is the layout's answer and not a bounded
   * permanent residual of it. IN THE ROUTE'S OWN COUNT, so the union the flight
   * needed does not outlive the flight; that is exact rather than a
   * simplification, because every point the union added lay on a segment of
   * this route.
   */
  function settleOnto(entry: EdgeEntry): void {
    const springs: Spring2DState[] = [];
    const targets: Vec2[] = [];
    const points: Vec2[] = [];
    for (const point of entry.rest) {
      const position = copyOf(point);
      springs.push({ position, velocity: AT_REST });
      targets.push(position);
      points.push(position);
    }
    entry.springs = springs;
    entry.targets = targets;
    entry.points = points;
    entry.moving = false;
  }

  /** An edge that has never been drawn, sitting on its route at rest. */
  function seed(route: readonly Vec2[]): EdgeEntry {
    const entry: EdgeEntry = {
      springs: [],
      targets: [],
      rest: route,
      points: route,
      departing: false,
      moving: false,
    };
    settleOnto(entry);
    return entry;
  }

  /**
   * Points an edge at a new route from wherever its springs currently are.
   *
   * The current polyline is the `from` side, never the route the LAYOUT last
   * reported: an edge caught mid-flight is on neither of the routes it is
   * between, and starting from the reported one would undo the interruptibility
   * that is the point of the task. This is the edge form of the `from` field
   * M4.7a refused to read.
   */
  function prepareRetarget(
    entry: EdgeEntry,
    route: readonly Vec2[],
    field: string,
    id: string,
  ): RetargetTransition {
    const fromParameters = routeParameters(entry.points);
    const toParameters = routeParameters(route);
    const merged = mergeParameters(fromParameters, toParameters);
    const positions = sampleAlong(entry.points, fromParameters, merged);
    const velocities = sampleAlong(
      entry.springs.map((spring) => spring.velocity),
      fromParameters,
      merged,
    );
    const springs = positions.map((position, index) => ({
      position,
      velocity: velocities[index] ?? AT_REST,
    }));
    const targets = sampleAlong(route, toParameters, merged);
    for (const [index, position] of positions.entries()) {
      const target = targets[index];
      if (target === undefined) continue;
      requireFinite(
        position.x - target.x,
        `${field} edge "${id}" point ${String(index)} x displacement`,
      );
      requireFinite(
        position.y - target.y,
        `${field} edge "${id}" point ${String(index)} y displacement`,
      );
    }
    return { springs, targets, rest: route, points: positions };
  }

  /** Applies a transition only after every transition in the call was validated. */
  function installRetarget(entry: EdgeEntry, transition: RetargetTransition): void {
    entry.springs = transition.springs;
    entry.targets = transition.targets;
    entry.rest = transition.rest;
    entry.points = transition.points;
    entry.departing = false;
    entry.moving = !atRest(entry);
    // A reroute to the line already being drawn is the edge form of M4.7a's
    // resize: the correct amount of animation for it is none, and settling here
    // rather than on the next frame means the frame count says so too.
    if (!entry.moving) settleOnto(entry);
  }

  function resync(targets: readonly EdgeMotionTarget[]): void {
    for (const [index, target] of targets.entries()) {
      requireRoute(target.points, `targets[${String(index)}].points`);
    }
    const prepared = targets.map((target, index) => {
      const route = copyRoute(target.points);
      const existing = entries.get(target.id);
      const transition =
        existing === undefined
          ? undefined
          : prepareRetarget(existing, route, `targets[${String(index)}].points`, target.id);
      return { id: target.id, route, existing, transition };
    });
    const kept = new Map<string, EdgeEntry>();
    for (const target of prepared) {
      const { existing, route, transition } = target;
      if (existing === undefined) {
        kept.set(target.id, seed(route));
        continue;
      }
      if (transition !== undefined) installRetarget(existing, transition);
      kept.set(target.id, existing);
    }
    entries.clear();
    for (const [id, entry] of kept) entries.set(id, entry);
  }

  function apply(delta: EdgeMotionDelta): void {
    // Worked out in full before anything is mutated, so a refusal leaves the
    // scene untouched. Keyed by the ids the DELTA names, so the overlay is
    // proportional to the change and not to the drawing.
    const planned = new Map<string, Intent>();

    function presence(id: string): Presence {
      const intent = planned.get(id);
      if (intent !== undefined) return intent.kind === 'depart' ? 'departing' : 'live';
      const entry = entries.get(id);
      if (entry === undefined) return 'absent';
      return entry.departing ? 'departing' : 'live';
    }

    for (const [index, id] of delta.removed.entries()) {
      const where = presence(id);
      if (where !== 'live') {
        throw new MotionDesyncError(id, `removed[${String(index)}]`, where, 'edge');
      }
      planned.set(id, { kind: 'depart' });
    }
    for (const [index, target] of delta.added.entries()) {
      const field = `added[${String(index)}]`;
      requireRoute(target.points, `${field}.points`);
      const where = presence(target.id);
      if (where === 'live') {
        throw new MotionDesyncError(target.id, field, where, 'edge');
      }
      planned.set(target.id, {
        kind: where === 'departing' ? 'replace' : 'arrive',
        route: copyRoute(target.points),
      });
    }
    for (const [index, target] of delta.rerouted.entries()) {
      const field = `rerouted[${String(index)}]`;
      requireRoute(target.points, `${field}.points`);
      const where = presence(target.id);
      if (where !== 'live') {
        throw new MotionDesyncError(target.id, field, where, 'edge');
      }
      // A reroute of something this same delta added or replaced is still that
      // arrival, at the later route: overwriting the kind would leave nothing
      // for the reroute to find, since the entry does not exist yet.
      const prior = planned.get(target.id)?.kind;
      if (prior === 'arrive' || prior === 'replace') {
        planned.set(target.id, { kind: prior, route: copyRoute(target.points) });
      } else {
        planned.set(target.id, { kind: 'reroute', route: copyRoute(target.points), field });
      }
    }

    const transitions = new Map<string, RetargetTransition>();
    for (const [id, intent] of planned) {
      if (intent.kind !== 'reroute') continue;
      const entry = entries.get(id);
      if (entry === undefined) continue;
      transitions.set(id, prepareRetarget(entry, intent.route, intent.field, id));
    }

    for (const [id, intent] of planned) {
      if (intent.kind === 'arrive' || intent.kind === 'replace') {
        entries.set(id, seed(intent.route));
        continue;
      }
      // Every other intent was checked against an entry that exists.
      const entry = entries.get(id);
      if (entry === undefined) continue;
      if (intent.kind === 'depart') {
        entry.departing = true;
        continue;
      }
      const transition = transitions.get(id);
      if (transition !== undefined) installRetarget(entry, transition);
    }
  }

  function advance(dtSeconds: number): EdgeMotionFrame {
    requireNonNegative(dtSeconds, 'dtSeconds');

    const edges: MotionEdge[] = [];
    let settled = true;
    // Deleting the current key while iterating a Map is defined: the iterator
    // moves on to the next live entry. Nothing else is added or removed here.
    for (const [id, entry] of entries) {
      if (entry.moving) {
        const springs: Spring2DState[] = [];
        const points: Vec2[] = [];
        // Arrival is decided in the pass that steps rather than in a pass after
        // it. An edge is arrived only when ALL of its points are, so a second
        // walk would read every spring twice to answer a question the first
        // walk could have carried, and an edge's springs are the one list in
        // either half of this consumer that is per POINT and not per drawing.
        let arrived = true;
        for (const [index, spring] of entry.springs.entries()) {
          const target = entry.targets[index];
          // Unreachable: the two lists are built together and stay the same
          // length, which is what the correspondence is for.
          if (target === undefined) continue;
          const stepped = stepSpring2D(spring, target, w, dtSeconds);
          springs.push(stepped);
          points.push(stepped.position);
          if (arrived && !springAtRest(stepped, target)) arrived = false;
        }
        entry.springs = springs;
        if (arrived) settleOnto(entry);
        else entry.points = points;
      }
      if (entry.departing && !entry.moving) {
        entries.delete(id);
        continue;
      }
      if (entry.moving) settled = false;
      edges.push({ id, points: entry.points, departing: entry.departing });
    }
    return { edges, settled };
  }

  return { resync, apply, advance };
}
