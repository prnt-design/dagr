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
 * so {@link stepSpring} evaluates it rather than integrating towards it. Its
 * evaluation forms each polynomial-times-exponential coefficient in log space,
 * then evaluates the resulting short linear combinations at a shared scale.
 * This is the same closed form, but it preserves a representable coefficient
 * after the bare exponential underflows and lets overflowing products cancel
 * when their final sum is finite. The consequences run through everything
 * below, and the largest is what is NOT here.
 *
 * **There is no fixed-timestep accumulator, and the reason one is usually
 * needed is the reason there is none.** An accumulator exists to keep an
 * approximate integrator's error, and therefore its behaviour, from changing
 * with the frame rate: semi-implicit Euler over `x''` above is stable only
 * while `w h` stays below about 0.83, and inside that bound it still traces a
 * slightly different curve at 60fps than at 144fps. An exact step has no such
 * error to bound. Ten steps of a millisecond and one step of ten give the same
 * state to machine precision, which `test/spring.test.ts` asserts directly, so
 * a consumer stepping once per `requestAnimationFrame` already has the property
 * the accumulator was going to buy. Adding one anyway would cost the thing it
 * was meant to protect: a fixed substep leaves a remainder every frame, and a
 * remainder is either dropped (the drawing lags the clock by up to a substep,
 * differently at each frame rate) or carried (a frame occasionally advances one
 * substep further than its neighbour, which is a stagger at constant velocity).
 * The ROADMAP's M4.6 entry asked for the accumulator; this is the entry being
 * settled rather than skipped, and the argument is a measurement rather than a
 * preference.
 *
 * That 0.83 is measured and pinned in the suite rather than quoted, and it is
 * worth knowing because it is EARLIER than the `w h` of 2 an undamped
 * oscillator gives. What goes unstable first on a critically damped system is
 * the DAMPING term: the velocity update carries a factor of `1 - 2 w h`, which
 * changes sign and starts amplifying long before the spring term does. At a
 * half-life of 120ms it is a substep ceiling of about 59 milliseconds, which
 * one dropped frame at 60fps clears.
 *
 * **A long frame needs no clamp either, which is the opinion `ribbon.ts` says
 * this module owes.** A backgrounded tab hands back a delta of seconds or
 * minutes. Exactly stepped, that lands the spring on its target with zero
 * velocity, which is what a returning tab should show: the settled drawing,
 * not a minute of catch-up animation. The same delta through an Euler step is
 * an overflow. A bare `e^(-w t)` underflows around 745, but coefficients such
 * as `(1 + w t)e^(-w t)` can remain representable beyond it. Only an infinite
 * `w * dt` takes the finite-state limit directly.
 *
 * **This module depends on nothing in this package that a device could break.**
 * The M4.6 entry asked for no dependency on anything else in `@prnt/dagr-render`, so
 * that splitting it into its own package stays cheap if `@prnt/dagr-react` ever
 * wants it for interaction animation with no graph in it. It has two, both
 * deliberate: the `Vec2` TYPE, which is two numbers and would be redeclared by
 * any package that took this on, and `validate.ts`, whose own docstring already
 * refused a third copy of these checks once. Neither is three.js and neither is
 * a scene, so the split cost is a file that would travel unchanged rather than
 * code that would have to be rewritten. Keeping the module in `@prnt/dagr-render`
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
 * Evaluates a short linear combination without requiring each product to fit.
 *
 * The ordinary path keeps the usual floating-point evaluation. The scaled path
 * is only for an overflowing product or partial sum: values and coefficients
 * are divided by their largest magnitudes before multiplication, then the two
 * scales are restored in the order that keeps the representable result finite.
 */
function linearCombination(terms: readonly (readonly [number, number])[]): number {
  let direct = 0;
  let maxValue = 0;
  let maxCoefficient = 0;
  let needsScaling = false;
  for (const [value, coefficient] of terms) {
    const product = value * coefficient;
    if (!Number.isFinite(product)) {
      needsScaling = true;
    }
    direct += product;
    if (!Number.isFinite(direct)) {
      needsScaling = true;
    }
    maxValue = Math.max(maxValue, Math.abs(value));
    maxCoefficient = Math.max(maxCoefficient, Math.abs(coefficient));
  }
  if (!needsScaling || maxValue === 0 || maxCoefficient === 0) {
    return direct;
  }

  let scaled = 0;
  for (const [value, coefficient] of terms) {
    scaled += (value / maxValue) * (coefficient / maxCoefficient);
  }

  // At least one of these orders avoids overflow when the final product is
  // representable. The logarithmic fallback also covers a tiny scale product
  // that underflows before a large third factor restores it.
  const coefficientFirst = scaled * maxCoefficient;
  if (coefficientFirst !== 0 && Number.isFinite(coefficientFirst)) {
    const result = coefficientFirst * maxValue;
    if (Number.isFinite(result)) {
      return result;
    }
  }
  const valueFirst = scaled * maxValue;
  if (valueFirst !== 0 && Number.isFinite(valueFirst)) {
    const result = valueFirst * maxCoefficient;
    if (Number.isFinite(result)) {
      return result;
    }
  }
  return Math.sign(scaled) * Math.exp(
    Math.log(Math.abs(scaled)) + Math.log(maxValue) + Math.log(maxCoefficient),
  );
}

/**
 * {@link linearCombination} over two terms, without building its arrays when
 * every product and partial sum is finite, which is the case where it returns
 * the plain sum anyway. The sum starts from `0` as that one does, so a `-0`
 * product comes back as `+0` on both paths.
 */
function combineTwo(
  value: number,
  coefficient: number,
  other: number,
  otherCoefficient: number,
): number {
  const first = value * coefficient;
  const second = other * otherCoefficient;
  const direct = 0 + first + second;
  if (Number.isFinite(first) && Number.isFinite(second) && Number.isFinite(direct)) {
    return direct;
  }
  return linearCombination([
    [value, coefficient],
    [other, otherCoefficient],
  ]);
}

/**
 * Computes `log(1 + u) - u` without subtracting equal rounded values near zero.
 *
 * The alternating series starts at `-u^2 / 2`. Below one percent it converges
 * quickly enough that stopping when the next term no longer changes the sum
 * preserves the rounded remainder without paying for a fixed term count.
 */
function log1pMinusU(u: number): number {
  if (u >= 0.01) {
    return Math.log1p(u) - u;
  }

  let power = u * u;
  let sum = -power / 2;
  for (let n = 3; ; n += 1) {
    power *= u;
    const term = (n % 2 === 0 ? -power : power) / n;
    const next = sum + term;
    if (next === sum) {
      return sum;
    }
    sum = next;
  }
}

/**
 * Interpolates without losing a residual when one weight rounds to one.
 *
 * Equal coordinates are an identity before either coefficient applies. Every
 * other case keeps the two weighted coordinates separate, which preserves a
 * polynomial-scaled residual after the complementary weight rounds to one and
 * lets opposite-sign huge coordinates cancel through the scaled path.
 */
function weightedInterpolation(
  position: number,
  target: number,
  retention: number,
  targetRetention: number,
): number {
  if (position === target) {
    return position;
  }
  return combineTwo(position, retention, target, targetRetention);
}

/**
 * The part of a step that depends only on `w` and `dtSeconds`, so a frame that
 * steps every spring in a scene by the same clock computes it once rather than
 * once per axis. Not exported from the package index.
 */
export interface SpringStep {
  /** `dtSeconds` is zero: every spring stays exactly where it is. */
  readonly identity: boolean;
  /** `w * dtSeconds` is infinite: every spring lands on its target at rest. */
  readonly settles: boolean;
  readonly retention: number;
  readonly targetRetention: number;
  readonly timeDecay: number;
  readonly velocityRetention: number;
  readonly springRetention: number;
}

/**
 * Builds the {@link SpringStep} for `w` and `dtSeconds`, checking both under
 * the names the public steppers have always used for them.
 */
export function springStep(angularFrequency: number, dtSeconds: number): SpringStep {
  requirePositive(angularFrequency, 'angularFrequency');
  requireNonNegative(dtSeconds, 'dtSeconds');
  const w = angularFrequency;
  const step = {
    identity: false,
    settles: false,
    retention: 0,
    targetRetention: 0,
    timeDecay: 0,
    velocityRetention: 0,
    springRetention: 0,
  };
  if (dtSeconds === 0) {
    // An identity by construction rather than by arithmetic. The formula
    // recovers the position as `target + (position - target)`, which is not
    // `position` in a double, so a caller stepping a paused clock or two
    // callbacks inside the same millisecond would walk a spring off its own
    // resting value one rounding at a time.
    step.identity = true;
    return step;
  }
  const u = w * dtSeconds;
  if (!Number.isFinite(u)) {
    // With finite inputs, an infinite `w * dt` can only be the settled limit.
    step.settles = true;
    return step;
  }
  // Each polynomial-times-exponential coefficient is formed from its log.
  // `exp(-u)` may be zero while `u exp(-u)` is still a subnormal number.
  const logDecay = -u;
  const logUDecay = Math.log(u) - u;
  const retentionLog = log1pMinusU(u);
  step.retention = Math.exp(retentionLog);
  step.targetRetention = -Math.expm1(retentionLog);
  step.timeDecay = Math.exp(Math.log(dtSeconds) + logDecay);
  step.velocityRetention =
    u === 1 ? 0 : Math.sign(1 - u) * Math.exp(Math.log(Math.abs(1 - u)) + logDecay);
  step.springRetention = Math.exp(Math.log(w) + logUDecay);
  return step;
}

/**
 * One axis's next position under `step`. No validation of the state: both
 * public entry points check their own arguments under their own field names,
 * and a per-frame loop over a scene's worth of springs should not pay for the
 * same check twice. Position and velocity are separate functions so a step
 * allocates nothing per axis.
 */
function nextAxisPosition(
  step: SpringStep,
  position: number,
  velocity: number,
  target: number,
): number {
  if (step.identity) return position;
  if (step.settles) return target;
  const interpolatedPosition = weightedInterpolation(
    position,
    target,
    step.retention,
    step.targetRetention,
  );
  return requireFinite(
    combineTwo(interpolatedPosition, 1, velocity, step.timeDecay),
    'spring result position',
  );
}

/** One axis's next velocity under `step`. See {@link nextAxisPosition}. */
function nextAxisVelocity(
  step: SpringStep,
  position: number,
  velocity: number,
  target: number,
): number {
  if (step.identity) return velocity;
  if (step.settles) return 0;
  const difference = target - position;
  const nextVelocity = Number.isFinite(difference)
    ? combineTwo(velocity, step.velocityRetention, difference, step.springRetention)
    : linearCombination([
        [velocity, step.velocityRetention],
        [target, step.springRetention],
        [position, -step.springRetention],
      ]);
  return requireFinite(nextVelocity, 'spring result velocity');
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
  const step = springStep(angularFrequency, dtSeconds);
  return {
    position: nextAxisPosition(step, state.position, state.velocity, target),
    velocity: nextAxisVelocity(step, state.position, state.velocity, target),
  };
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
  return stepSpring2DBy(state, target, springStep(angularFrequency, dtSeconds));
}

/**
 * {@link stepSpring2D} with the clock's half already built, for a loop that
 * steps many springs by one `step`. Not exported from the package index. It
 * skips the per-spring checks {@link stepSpring2D} makes, so the caller owns
 * that every state and target it passes is finite; the result is still checked.
 */
export function stepSpring2DBy(
  state: Spring2DState,
  target: Vec2,
  step: SpringStep,
): Spring2DState {
  const { position, velocity } = state;
  // x before y, position before velocity: the order the checks on the result
  // have always run in, so the same bad input names the same field.
  const x = nextAxisPosition(step, position.x, velocity.x, target.x);
  const vx = nextAxisVelocity(step, position.x, velocity.x, target.x);
  const y = nextAxisPosition(step, position.y, velocity.y, target.y);
  const vy = nextAxisVelocity(step, position.y, velocity.y, target.y);
  return { position: { x, y }, velocity: { x: vx, y: vy } };
}
