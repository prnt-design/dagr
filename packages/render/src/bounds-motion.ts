import { DEFAULT_MOTION_HALF_LIFE, DEFAULT_MOTION_REST } from './motion.js';
import { omegaForHalfLife, stepSpring2D } from './spring.js';
import type { Spring2DState } from './spring.js';
import type { Vec2, WorldBounds } from './types.js';
import { requireFinite, requireNonNegative, requirePositive } from './validate.js';

/**
 * The delta consumer, bounds third: the drawing's box, sprung towards the box
 * a relayout gave it.
 *
 * M4.7a and M4.7b left this half on purpose, and M4.7c's entry asked one
 * question about it before anything was written: whether a sprung box is a
 * third motion module or a camera concern. IT IS A MOTION MODULE, AND THE
 * CAMERA IS NOT ALLOWED TO READ IT ON ITS OWN. `<DagrCanvas>` fits the camera
 * once and then the camera is the user's, on the argument M5.1 made and this
 * package agrees with: a camera that refits on every edit is the instability
 * M3 exists to keep out of the layout, reintroduced one level up where no
 * stability metric would see it. So `camera.ts` gains nothing here. What a
 * caller who WANTS a following camera gets is a box per frame that glides
 * rather than cuts, and `fitBounds` on that box is one line in their frame.
 *
 * **Four numbers are sprung and they are not the four corners.** A box is two
 * corners, and springing them separately is the obvious reading. It turns a
 * box inside out on the way: two corners retargeted by different distances
 * arrive at different times, and a box shrinking from the right while growing
 * from the left crosses over in the middle. This module springs the CENTRE
 * and the HALF-EXTENTS instead. Released from rest, each is the same convex
 * combination of where it started and where it is going at every instant, so
 * a half-extent that starts and ends at or above zero stays there, and a
 * corner that is a centre plus a half-extent stays on its own side. A retarget
 * mid-flight carries velocity and can overshoot once, like any spring here,
 * and the report clamps a half-extent at zero for that one case so the box a
 * caller reads is never inside out.
 *
 * **A degenerate box is accepted, and it has to be.** An empty layout has a
 * zero-by-zero box, and a scene seeded from one would otherwise throw before
 * the first node arrived. What is refused is a box that is inside out or not
 * made of numbers, because no spring can be aimed at it. Whether a degenerate
 * box is worth FITTING is the camera's question, and `fitBounds` already
 * answers it by refusing.
 *
 * Everything else is the node half's, deliberately: the same two defaults so
 * that one delta's nodes, edges and box arrive together, the same exact snap
 * on arrival, the same "advance(0) says whether anything moved".
 */

/** How the motion should feel, and when it should call itself done. */
export interface BoundsMotionOptions {
  /**
   * Seconds to close half the distance to a target, released from rest.
   * Defaults to {@link DEFAULT_MOTION_HALF_LIFE}, the node half's default too.
   */
  readonly halfLifeSeconds?: number;
  /**
   * How close, in world units, counts as arrived. Defaults to
   * {@link DEFAULT_MOTION_REST}. Per sprung number: the box is arrived when
   * its centre and both half-extents are.
   */
  readonly restEpsilon?: number;
}

/** One frame's worth of answer: the box to read, and whether to ask for another. */
export interface BoundsMotionFrame {
  /**
   * The box as the springs have it, world units, y up. `null` until a box has
   * been given, and after a `resync(null)`.
   *
   * A fresh object per frame while moving and the same object every frame
   * while settled, on the node half's terms: read it, do not mutate it.
   */
  readonly bounds: WorldBounds | null;
  /** True when the box is exactly on its target with zero velocity, or absent. */
  readonly settled: boolean;
}

/** A drawing's box, and the three things done to it. */
export interface BoundsMotion {
  /**
   * Replaces the box, absolutely.
   *
   * The resync path, and how a box is seeded. A box already here KEEPS its
   * springs, so a correction is animated rather than cut to; no box yet
   * starts at `bounds`, at rest; `null` drops the box with no departure,
   * because a roster describes a STATE and has no moment to animate from.
   */
  resync(bounds: WorldBounds | null): void;

  /**
   * Springs the box towards `bounds`.
   *
   * A box already here is retargeted from wherever its springs are, which is
   * the bounds form of the `from` field M4.7a refused to read. No box yet is
   * an arrival: it starts at `bounds`, at rest, since there is nothing to
   * animate from.
   */
  retarget(bounds: WorldBounds): void;

  /**
   * Steps the springs by `dtSeconds` and returns the box to read.
   *
   * Not clamped, on `spring.ts`'s terms: a backgrounded tab handing back a
   * delta of minutes lands the box on its target.
   */
  advance(dtSeconds: number): BoundsMotionFrame;
}

/** The two springs, and what they are aimed at. */
interface BoxState {
  centre: Spring2DState;
  half: Spring2DState;
  centreTarget: Vec2;
  halfTarget: Vec2;
  /** Held rather than recomputed, so a settled box costs nothing per frame. */
  moving: boolean;
  /** What the last frame reported, reused while settled. */
  reported: WorldBounds;
}

const AT_REST: Vec2 = { x: 0, y: 0 };

/**
 * Rejects a box that is not four finite numbers with each max at or above its
 * min. Equal is allowed: see the module docstring.
 */
function requireBounds(bounds: WorldBounds, field: string): WorldBounds {
  requireFinite(bounds.minX, `${field}.minX`);
  requireFinite(bounds.minY, `${field}.minY`);
  requireFinite(bounds.maxX, `${field}.maxX`);
  requireFinite(bounds.maxY, `${field}.maxY`);
  if (bounds.maxX < bounds.minX) {
    throw new RangeError(
      `${field}.maxX has to be at or above ${field}.minX, got ${String(bounds.maxX)} against ${String(bounds.minX)}`,
    );
  }
  if (bounds.maxY < bounds.minY) {
    throw new RangeError(
      `${field}.maxY has to be at or above ${field}.minY, got ${String(bounds.maxY)} against ${String(bounds.minY)}`,
    );
  }
  return bounds;
}

/** A box as the centre and half-extents this module springs. */
function decompose(bounds: WorldBounds): { centre: Vec2; half: Vec2 } {
  return {
    centre: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    half: { x: (bounds.maxX - bounds.minX) / 2, y: (bounds.maxY - bounds.minY) / 2 },
  };
}

/**
 * The box a centre and half-extents describe, never inside out.
 *
 * The clamp is for the one case the module docstring names: a half-extent
 * retargeted mid-flight towards zero carries velocity through zero and back.
 * From rest it cannot happen, and the clamp costs two comparisons.
 */
function compose(centre: Vec2, half: Vec2): WorldBounds {
  const hx = Math.max(0, half.x);
  const hy = Math.max(0, half.y);
  return { minX: centre.x - hx, minY: centre.y - hy, maxX: centre.x + hx, maxY: centre.y + hy };
}

/**
 * Creates a motion state for one drawing's box.
 *
 * @param options The feel and the arrival tolerance. See
 *   {@link BoundsMotionOptions}.
 */
export function createBoundsMotion(options: BoundsMotionOptions = {}): BoundsMotion {
  const halfLife = options.halfLifeSeconds ?? DEFAULT_MOTION_HALF_LIFE;
  const restEpsilon = options.restEpsilon ?? DEFAULT_MOTION_REST;
  requirePositive(halfLife, 'halfLifeSeconds');
  requirePositive(restEpsilon, 'restEpsilon');

  const w = omegaForHalfLife(halfLife);
  requireFinite(w, 'halfLifeSeconds angular frequency');
  // Derived rather than passed, on `motion.ts`'s argument: `w` is the only
  // inverse time in the system, so the tolerance has one speed scale.
  const restSpeed = restEpsilon * w;

  let state: BoxState | null = null;

  function springAtRest(spring: Spring2DState, target: Vec2): boolean {
    return (
      Math.abs(spring.position.x - target.x) <= restEpsilon &&
      Math.abs(spring.position.y - target.y) <= restEpsilon &&
      Math.abs(spring.velocity.x) <= restSpeed &&
      Math.abs(spring.velocity.y) <= restSpeed
    );
  }

  /** A box exactly on its targets, at rest: how one is seeded and how one lands. */
  function settled(centreTarget: Vec2, halfTarget: Vec2): BoxState {
    return {
      centre: { position: { ...centreTarget }, velocity: AT_REST },
      half: { position: { ...halfTarget }, velocity: AT_REST },
      centreTarget,
      halfTarget,
      moving: false,
      reported: compose(centreTarget, halfTarget),
    };
  }

  /**
   * Checks that the springs can be aimed at `bounds` from where they are,
   * before anything changes. The same overflow guard the node half runs per
   * axis: a finite displacement whose product with `w` is not finite is a
   * spring coefficient the closed form cannot represent.
   */
  function checkAim(existing: BoxState, bounds: WorldBounds, field: string): void {
    const { centre, half } = decompose(bounds);
    const pairs: readonly [Spring2DState, Vec2, string][] = [
      [existing.centre, centre, 'centre'],
      [existing.half, half, 'half-extent'],
    ];
    for (const [spring, target, name] of pairs) {
      for (const axis of ['x', 'y'] as const) {
        const location = `${field} ${name} ${axis}`;
        const displacement = spring.position[axis] - target[axis];
        requireFinite(displacement, `${location} displacement`);
        const weighted = w * displacement;
        requireFinite(weighted, `${location} spring coefficient w * displacement`);
        requireFinite(spring.velocity[axis] + weighted, `${location} spring coefficient with velocity`);
      }
    }
  }

  /** Points the existing springs at `bounds`, after {@link checkAim}. */
  function aim(existing: BoxState, bounds: WorldBounds): void {
    const { centre, half } = decompose(bounds);
    existing.centreTarget = centre;
    existing.halfTarget = half;
    existing.moving =
      !springAtRest(existing.centre, centre) || !springAtRest(existing.half, half);
    if (!existing.moving) {
      // A retarget to the box already drawn is the bounds form of a resize
      // that moves nothing: land it now so the frame count says so.
      const landed = settled(centre, half);
      existing.centre = landed.centre;
      existing.half = landed.half;
      existing.reported = landed.reported;
    }
  }

  function resync(bounds: WorldBounds | null): void {
    if (bounds === null) {
      state = null;
      return;
    }
    requireBounds(bounds, 'bounds');
    if (state === null) {
      const { centre, half } = decompose(bounds);
      state = settled(centre, half);
      return;
    }
    checkAim(state, bounds, 'bounds');
    aim(state, bounds);
  }

  function retarget(bounds: WorldBounds): void {
    requireBounds(bounds, 'bounds');
    if (state === null) {
      const { centre, half } = decompose(bounds);
      state = settled(centre, half);
      return;
    }
    checkAim(state, bounds, 'bounds');
    aim(state, bounds);
  }

  function advance(dtSeconds: number): BoundsMotionFrame {
    requireNonNegative(dtSeconds, 'dtSeconds');
    if (state === null) return { bounds: null, settled: true };
    if (!state.moving) return { bounds: state.reported, settled: true };

    const centre = stepSpring2D(state.centre, state.centreTarget, w, dtSeconds);
    const half = stepSpring2D(state.half, state.halfTarget, w, dtSeconds);
    if (springAtRest(centre, state.centreTarget) && springAtRest(half, state.halfTarget)) {
      // Exactly on the target rather than within the tolerance of it, for the
      // node half's reason: a permanent residual on a box a camera fits to is
      // a drawing that never quite frames.
      state = settled(state.centreTarget, state.halfTarget);
      return { bounds: state.reported, settled: true };
    }
    state.centre = centre;
    state.half = half;
    state.reported = compose(centre.position, half.position);
    return { bounds: state.reported, settled: false };
  }

  return { resync, retarget, advance };
}
