import type { Vec2 } from './types.js';
import { requireFinite, requireNonNegative, requirePositive } from './validate.js';

/**
 * Critically damped springs, as arithmetic.
 *
 * A spring is how a node gets from where it was drawn to where the layout now
 * puts it. Critically damped is the choice this project makes everywhere motion
 * is meant to read as physical rather than decorative: it is the fastest
 * approach to a target that does not oscillate around it, so a graph settling
 * after an edit looks like it arrived rather than like it rang.
 *
 * The system is `x'' = -2w x' - w^2 (x - target)`, where `w` is the angular
 * frequency and the damping ratio is fixed at 1 by construction rather than
 * passed in. An under-damped spring is a different feeling and would need a
 * second parameter and a second closed form; nothing has asked for one, and a
 * ratio a caller can set to 1.0001 is a ratio a caller can set to 1.0001 by
 * accident and get a different curve with nothing to point at.
 *
 * **The step is exact, and that is the one thing to know before reading the
 * rest.** Over a step where `target` and `w` are constant, the solution of that
 * equation is closed form:
 *
 * ```
 * A = x0 - target
 * B = v0 + w A
 * x(h) = target + (A + B h) e^(-w h)
 * v(h) = (B - w (A + B h)) e^(-w h)
 * ```
 *
 * so {@link stepSpring} evaluates it rather than integrating towards it. The
 * consequences run through everything below, and the largest is what is NOT
 * here.
 *
 * **There is no fixed-timestep accumulator, and the reason one is usually
 * needed is the reason there is none.** An accumulator exists to keep an
 * approximate integrator's error, and therefore its behaviour, from changing
 * with the frame rate: semi-implicit Euler over `x''` above is stable only
 * while `w h` stays below 2, and inside that bound it still traces a slightly
 * different curve at 60fps than at 144fps. An exact step has no such error to
 * bound. Ten steps of a millisecond and one step of ten give the same state to
 * machine precision, which `test/spring.test.ts` asserts directly, so a
 * consumer stepping once per `requestAnimationFrame` already has the property
 * the accumulator was going to buy. Adding one anyway would cost the thing it
 * was meant to protect: a fixed substep leaves a remainder every frame, and a
 * remainder is either dropped (the drawing lags the clock by up to a substep,
 * differently at each frame rate) or carried (a frame occasionally advances one
 * substep further than its neighbour, which is a stagger at constant velocity).
 * The ROADMAP's M4.6 entry asked for the accumulator; this is the entry being
 * settled rather than skipped, and the argument is a measurement rather than a
 * preference.
 *
 * **A long frame needs no clamp either, which is the opinion `ribbon.ts` says
 * this module owes.** A backgrounded tab hands back a delta of seconds or
 * minutes. Exactly stepped, that lands the spring on its target with zero
 * velocity, which is what a returning tab should show: the settled drawing,
 * not a minute of catch-up animation. The same delta through an Euler step is
 * an overflow. Past `w * dt` of about 746 the decay underflows to zero in a
 * double and the exact answer is the target itself, which {@link stepSpring}
 * returns rather than computing an infinity times a zero.
 *
 * **This module depends on nothing in this package that a device could break.**
 * The M4.6 entry asked for no dependency on anything else in `@dagr/render`, so
 * that splitting it into its own package stays cheap if `@dagr/react` ever
 * wants it for interaction animation with no graph in it. It has two, both
 * deliberate: the `Vec2` TYPE, which is two numbers and would be redeclared by
 * any package that took this on, and `validate.ts`, whose own docstring already
 * refused a third copy of these checks once. Neither is three.js and neither is
 * a scene, so the split cost is a file that would travel unchanged rather than
 * code that would have to be rewritten. Keeping the module in `@dagr/render`
 * and exporting it is the third option that entry named, and it is now the
 * second time this package has taken it: `html-overlay.ts` is the first.
 */

/** A scalar spring's whole state: where it is, and how fast it is going. */
export interface SpringState {
  /** Current value, in whatever unit the target is in. */
  readonly position: number;
  /** Current rate of change, in that unit per second. */
  readonly velocity: number;
}

/** A two-axis spring's state, one independent scalar spring per axis. */
export interface Spring2DState {
  /** Current point. */
  readonly position: Vec2;
  /** Current rate of change, per second, per axis. */
  readonly velocity: Vec2;
}

/**
 * `w * t` at which a spring released FROM REST has closed half the distance to
 * its target.
 *
 * The envelope from rest is `(1 + u) e^(-u)` with `u = w t`, since `v0 = 0`
 * makes `B = w A`. This is the root of `(1 + u) e^(-u) = 1/2`, which has no
 * closed form, so the number is solved once and pinned by a test rather than
 * recomputed. A spring carrying velocity is on a different curve and this
 * constant says nothing about it.
 */
export const HALF_LIFE_OMEGA = 1.67834699001666;

/**
 * `w * t` at which a spring released from rest is within one percent of the
 * distance it started at.
 *
 * The same envelope at `1/100`. Useful as a settling time: a half-life of 0.12s
 * is a spring that is visually done after `SETTLE_OMEGA_1_PERCENT /
 * HALF_LIFE_OMEGA`, just under four half-lives, which is the number to reach
 * for when deciding how long an animation "takes" rather than how fast it
 * starts.
 */
export const SETTLE_OMEGA_1_PERCENT = 6.638352067993813;

/**
 * The angular frequency of a spring that closes half its distance in
 * `halfLifeSeconds`, released from rest.
 *
 * The tuning parameter callers actually have an opinion about. `w` is the
 * parameter of the differential equation and belongs in {@link stepSpring},
 * which is called once per spring per frame; a half-life is a design decision
 * converted once, at the point where somebody decided how fast the drawing
 * should feel. Making the step itself take a half-life would divide by it
 * sixty times a second to recover the number the formula wants.
 */
export function omegaForHalfLife(halfLifeSeconds: number): number {
  requirePositive(halfLifeSeconds, 'halfLifeSeconds');
  return HALF_LIFE_OMEGA / halfLifeSeconds;
}

/**
 * Advances one axis by `dtSeconds`. No validation: both public entry points
 * check their own arguments under their own field names, and a per-frame loop
 * over a scene's worth of springs should not pay for the same check twice.
 */
function stepAxis(
  position: number,
  velocity: number,
  target: number,
  w: number,
  dtSeconds: number,
): SpringState {
  if (dtSeconds === 0) {
    // An identity by construction rather than by arithmetic. The formula
    // recovers the position as `target + (position - target)`, which is not
    // `position` in a double, so a caller stepping a paused clock or two
    // callbacks inside the same millisecond would walk a spring off its own
    // resting value one rounding at a time.
    return { position, velocity };
  }
  const decay = Math.exp(-w * dtSeconds);
  if (decay === 0) {
    // Underflowed, so the drawing is at its target to every bit a double has.
    // Computing it anyway would multiply a possibly infinite `A + B h` by zero.
    return { position: target, velocity: 0 };
  }
  const a = position - target;
  const b = velocity + w * a;
  const displacement = a + b * dtSeconds;
  return {
    position: target + displacement * decay,
    velocity: (b - w * displacement) * decay,
  };
}

/**
 * Advances a scalar spring towards `target` by `dtSeconds`, exactly.
 *
 * Retargetable mid-flight with no discontinuity in position or velocity: the
 * target is a parameter of the equation and the state is `(position,
 * velocity)`, so changing the target between two calls cannot move either. What
 * it does discontinue is ACCELERATION, which is a faint snap at high `w` and is
 * the honest cost of the property.
 *
 * "Critically damped" guarantees no OSCILLATION, which is not the same as no
 * overshoot: the displacement `(A + B t) e^(-w t)` is zero at `t = -A/B`, which
 * is in the future whenever the initial speed towards the target exceeds `w`
 * times the distance to it. Released from rest that never happens, so a spring
 * that starts still never passes its target. A spring retargeted while moving
 * can pass it once and comes back, and once is the bound: a linear factor times
 * an exponential has one root.
 *
 * Every result is a fresh record, so a caller can hold the previous frame's
 * state and compare.
 *
 * @param state Where the spring is now.
 * @param target Where it is being pulled to.
 * @param angularFrequency `w`, above zero. See {@link omegaForHalfLife}.
 * @param dtSeconds Elapsed time, at or above zero. Not clamped: see the module
 *   docstring for why a long frame is safe.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  angularFrequency: number,
  dtSeconds: number,
): SpringState {
  requireFinite(state.position, 'state.position');
  requireFinite(state.velocity, 'state.velocity');
  requireFinite(target, 'target');
  requirePositive(angularFrequency, 'angularFrequency');
  requireNonNegative(dtSeconds, 'dtSeconds');
  return stepAxis(state.position, state.velocity, target, angularFrequency, dtSeconds);
}

/**
 * Advances a two-axis spring towards `target` by `dtSeconds`.
 *
 * Two independent scalar springs sharing one `angularFrequency`, which is what
 * makes a node's x and y separable and is worth stating because it is a
 * modelling choice rather than a fact: the pair is NOT a spring in the plane
 * pulling along the line to the target, so a node with sideways velocity
 * traces a curve rather than a straight line into place. That is the behaviour
 * a graph wants, since the two axes carry different meanings here (a rank and a
 * position within it) and a node changing rank should not have its horizontal
 * motion decided by how far it moved vertically.
 */
export function stepSpring2D(
  state: Spring2DState,
  target: Vec2,
  angularFrequency: number,
  dtSeconds: number,
): Spring2DState {
  requireFinite(state.position.x, 'state.position.x');
  requireFinite(state.position.y, 'state.position.y');
  requireFinite(state.velocity.x, 'state.velocity.x');
  requireFinite(state.velocity.y, 'state.velocity.y');
  requireFinite(target.x, 'target.x');
  requireFinite(target.y, 'target.y');
  requirePositive(angularFrequency, 'angularFrequency');
  requireNonNegative(dtSeconds, 'dtSeconds');
  const x = stepAxis(state.position.x, state.velocity.x, target.x, angularFrequency, dtSeconds);
  const y = stepAxis(state.position.y, state.velocity.y, target.y, angularFrequency, dtSeconds);
  return {
    position: { x: x.position, y: y.position },
    velocity: { x: x.velocity, y: y.velocity },
  };
}
