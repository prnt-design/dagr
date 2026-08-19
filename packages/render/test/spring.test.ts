import { describe, expect, it } from 'vitest';
import type { Spring2DState, SpringState } from '../src/spring.js';
import {
  HALF_LIFE_OMEGA,
  SETTLE_OMEGA_1_PERCENT,
  omegaForHalfLife,
  stepSpring,
  stepSpring2D,
} from '../src/spring.js';

/**
 * The spring integrator, which is arithmetic and therefore exhaustively
 * testable without a device.
 *
 * Two things in this suite are load-bearing beyond the function they check.
 *
 * The first is {@link eulerReference}, a deliberately naive semi-implicit
 * Euler integrator of the same ODE. It is here because a closed form checked
 * only against itself is a suite that agrees with its own algebra: if the
 * exponential solution were transcribed with a sign wrong, every property
 * below except this one would still hold, because they are all properties OF
 * that transcription. Euler is derived from `x'' = -2w x' - w^2 (x - target)`
 * directly, so agreement between the two at a small step is evidence about the
 * ODE rather than about the algebra.
 *
 * The second is that Euler is also the thing the closed form replaces, and the
 * fixed-timestep test below uses it as the demonstration: Euler needs a bounded
 * step and the closed form does not, which is why nothing here accumulates one.
 */

/**
 * Semi-implicit Euler over the same ODE, in `steps` equal substeps.
 *
 * Semi-implicit rather than explicit because explicit Euler on an oscillator
 * gains energy at every step regardless of how small it is, so it would
 * disagree with a correct closed form in a way that says nothing.
 */
function eulerReference(
  state: SpringState,
  target: number,
  w: number,
  dtSeconds: number,
  steps: number,
): SpringState {
  const h = dtSeconds / steps;
  let { position, velocity } = state;
  for (let i = 0; i < steps; i += 1) {
    velocity += h * (-2 * w * velocity - w * w * (position - target));
    position += h * velocity;
  }
  return { position, velocity };
}

/** The analytic displacement `x(t) - target`, sampled without stepping. */
function displacementAt(state: SpringState, target: number, w: number, t: number): number {
  const a = state.position - target;
  const b = state.velocity + w * a;
  return (a + b * t) * Math.exp(-w * t);
}

/** How many times `x - target` changes sign over `[0, span]`, densely sampled. */
function signChanges(state: SpringState, target: number, w: number, span: number): number {
  const samples = 20_000;
  let changes = 0;
  let previous = Math.sign(displacementAt(state, target, w, 0));
  for (let i = 1; i <= samples; i += 1) {
    const current = Math.sign(displacementAt(state, target, w, (span * i) / samples));
    if (current !== 0 && current !== previous) {
      changes += 1;
      previous = current;
    }
  }
  return changes;
}

const rest = (position: number): SpringState => ({ position, velocity: 0 });

describe('stepSpring validation', () => {
  it('names the field of every value it rejects', () => {
    expect(() => stepSpring({ position: Number.NaN, velocity: 0 }, 0, 1, 0.016)).toThrow(
      /state\.position/,
    );
    expect(() => stepSpring({ position: 0, velocity: Number.POSITIVE_INFINITY }, 0, 1, 0.016)).toThrow(
      /state\.velocity/,
    );
    expect(() => stepSpring(rest(0), Number.NaN, 1, 0.016)).toThrow(/target/);
    expect(() => stepSpring(rest(0), 0, 0, 0.016)).toThrow(/angularFrequency/);
    expect(() => stepSpring(rest(0), 0, -1, 0.016)).toThrow(/angularFrequency/);
    expect(() => stepSpring(rest(0), 0, 1, -0.001)).toThrow(/dtSeconds/);
    expect(() => stepSpring(rest(0), 0, 1, Number.POSITIVE_INFINITY)).toThrow(/dtSeconds/);
  });

  it('rejects rather than substitutes, which is the package rule', () => {
    // A spring that silently treated NaN as zero would park a node at the
    // origin and leave nothing anywhere pointing at the line that did it.
    expect(() => stepSpring(rest(0), 0, Number.NaN, 0.016)).toThrow(RangeError);
  });

  it('takes a zero step as an identity', () => {
    const state = { position: 3, velocity: -7 };
    expect(stepSpring(state, 10, 12, 0)).toEqual(state);
  });
});

describe('stepSpring against the ODE it claims to solve', () => {
  it('agrees with semi-implicit Euler, and the agreement tightens as the substep shrinks', () => {
    const state = { position: 100, velocity: -40 };
    const [target, w, dt] = [10, 6, 0.25];
    const exact = stepSpring(state, target, w, dt);
    const coarse = eulerReference(state, target, w, dt, 100);
    const fine = eulerReference(state, target, w, dt, 100_000);
    const coarseError = Math.abs(coarse.position - exact.position);
    const fineError = Math.abs(fine.position - exact.position);
    expect(coarseError).toBeLessThan(1);
    expect(fineError).toBeLessThan(coarseError / 100);
    expect(fineError).toBeLessThan(1e-3);
  });

  it('is translation invariant, so a spring behaves the same far from the origin', () => {
    const shift = 1e6;
    const near = stepSpring({ position: 3, velocity: 5 }, 11, 9, 0.05);
    const far = stepSpring({ position: 3 + shift, velocity: 5 }, 11 + shift, 9, 0.05);
    expect(far.position - shift).toBeCloseTo(near.position, 6);
    expect(far.velocity).toBeCloseTo(near.velocity, 9);
  });

  it('is linear in the displacement, so a scaled problem scales', () => {
    const one = stepSpring({ position: 2, velocity: -3 }, 0, 7, 0.08);
    const ten = stepSpring({ position: 20, velocity: -30 }, 0, 7, 0.08);
    expect(ten.position).toBeCloseTo(one.position * 10, 9);
    expect(ten.velocity).toBeCloseTo(one.velocity * 10, 9);
  });
});

describe('the step is exact, which is why there is no fixed-timestep accumulator', () => {
  it('gives the same state whether one long step or many short ones are taken', () => {
    // The entry asked for a fixed-timestep accumulator so behaviour would not
    // change with frame rate. This is that property, held to machine precision
    // by the closed form itself, with nothing accumulated.
    const state = { position: 250, velocity: -120 };
    const [target, w, dt] = [-30, 14, 0.1];
    const once = stepSpring(state, target, w, dt);
    for (const steps of [2, 10, 100, 1000]) {
      let carried = state;
      for (let i = 0; i < steps; i += 1) {
        carried = stepSpring(carried, target, w, dt / steps);
      }
      expect(carried.position).toBeCloseTo(once.position, 9);
      expect(carried.velocity).toBeCloseTo(once.velocity, 9);
    }
  });

  it('is the property a fixed step would only approximate', () => {
    // Euler over the same total time, at two frame rates, disagrees with itself
    // by more than the closed form disagrees with either. That gap is the whole
    // argument for the accumulator, and it is the gap that is not there.
    const state = { position: 250, velocity: -120 };
    const [target, w, dt] = [-30, 14, 0.1];
    const at60 = eulerReference(state, target, w, dt, 6);
    const at144 = eulerReference(state, target, w, dt, 14);
    expect(Math.abs(at60.position - at144.position)).toBeGreaterThan(1);
  });

  it('survives a step a fixed-step integrator would have to refuse', () => {
    // Semi-implicit Euler diverges once w*h passes about 0.83, pinned below.
    // The closed form takes the same step and lands on the target, which is
    // what a tab coming back from the background should show.
    const state = { position: 900, velocity: 400 };
    const [target, w, dt] = [0, 20, 5];
    expect(Math.abs(eulerReference(state, target, w, dt, 1).position)).toBeGreaterThan(1e6);
    const exact = stepSpring(state, target, w, dt);
    expect(Number.isFinite(exact.position)).toBe(true);
    expect(exact.position).toBeCloseTo(target, 9);
    expect(exact.velocity).toBeCloseTo(0, 9);
  });

  it('pins the substep ceiling the closed form removes', () => {
    // Measured rather than quoted, because the number a textbook gives for a
    // semi-implicit Euler oscillator is w*h < 2 and that is the UNDAMPED case.
    // Critical damping puts a factor of (1 - 2wh) on the velocity update, which
    // changes sign and amplifies well before the spring term does.
    const diverges = (wh: number): boolean => {
      const { position } = eulerReference(rest(1), 0, 1, wh * 20_000, 20_000);
      return !Number.isFinite(position) || Math.abs(position) > 1e12;
    };
    expect(diverges(0.82)).toBe(false);
    expect(diverges(0.84)).toBe(true);
    // Which is a real ceiling at animation frequencies: a 120ms half-life is a
    // substep of about 59ms, so one dropped frame at 60fps clears it.
    expect((0.8288 / omegaForHalfLife(0.12)) * 1000).toBeCloseTo(59.26, 2);
  });

  it('lands exactly on the target once the decay underflows', () => {
    // A backgrounded tab hands back a delta measured in minutes or hours. Past
    // w*dt of about 745 the exponential is zero in a double, and the product
    // that would otherwise be computed is an infinity times a zero.
    const long = stepSpring({ position: 1e12, velocity: -1e12 }, 42, 8, 1e6);
    expect(long).toEqual({ position: 42, velocity: 0 });
  });
});

describe('critical damping: at most one zero crossing, from any initial state', () => {
  it('never crosses when released from rest, at any distance or stiffness', () => {
    for (const w of [0.5, 1, 6, 30, 200]) {
      for (const start of [-1000, -1, -0.001, 0.001, 1, 1000]) {
        expect(signChanges(rest(start), 0, w, 40 / w)).toBe(0);
      }
    }
  });

  it('crosses exactly once, and only when the initial speed beats w times the distance', () => {
    const w = 8;
    for (const start of [-100, -1, 1, 100]) {
      for (const velocity of [-2000, -400, -50, 0, 50, 400, 2000]) {
        const state = { position: start, velocity };
        const a = start - 0;
        const b = velocity + w * a;
        // The displacement is (A + Bt)e^(-wt), which is zero at t = -A/B.
        const crossesInFuture = b !== 0 && -a / b > 0;
        expect(signChanges(state, 0, w, 40 / w)).toBe(crossesInFuture ? 1 : 0);
      }
    }
  });

  it('overshoots on a retarget that no from-rest start could produce', () => {
    // The two bullets the entry warns read as contradictory: "no overshoot" and
    // "retargetable mid-flight" cannot both be unqualified, because a retarget
    // constructs exactly the state the overshoot claim forbids.
    const moving = { position: 0, velocity: -100 };
    expect(signChanges(moving, -1, 8, 5)).toBe(1);
  });
});

describe('a retarget is a change of parameter, not a change of state', () => {
  it('preserves position and velocity at the instant it happens', () => {
    // Exactly, and not to a tolerance: `target + (position - target)` is not
    // `position` in a double, so a zero step has to be an identity by
    // construction rather than by arithmetic.
    const state = stepSpring({ position: 0, velocity: 0 }, 500, 10, 0.2);
    expect(stepSpring(state, -900, 10, 0)).toEqual(state);
    expect(stepSpring(state, 1 / 3, 10, 0).position).toBe(state.position);
  });

  it('keeps moving when retargeted to where it already is', () => {
    // This is the test that catches an integrator storing (start, target,
    // elapsed) and reparameterising time on a retarget: that implementation
    // restarts from rest and stops dead here, where the ODE carries its
    // velocity through and overshoots.
    const moving = { position: 30, velocity: -120 };
    const after = stepSpring(moving, 30, 10, 0.02);
    expect(after.position).toBeLessThan(30);
    expect(after.velocity).toBeLessThan(0);
    // And it comes back, rather than continuing away.
    expect(signChanges(moving, 30, 10, 5)).toBe(1);
  });

  it('reaches the same place whether the retarget is stepped through or not', () => {
    // Stepping to t, retargeting, then stepping on is the same trajectory as
    // solving the second leg from the state at t, which is what makes a
    // mid-flight retarget free of a jump.
    const start = { position: 100, velocity: 0 };
    const mid = stepSpring(start, 0, 6, 0.3);
    const legs = stepSpring(stepSpring(mid, 250, 6, 0.05), 250, 6, 0.05);
    const whole = stepSpring(mid, 250, 6, 0.1);
    expect(legs.position).toBeCloseTo(whole.position, 9);
    expect(legs.velocity).toBeCloseTo(whole.velocity, 9);
  });

  it('discontinues acceleration and nothing else, which is the faint snap at high w', () => {
    const state = { position: 10, velocity: 0 };
    const h = 1e-6;
    // A one-sided difference over h, so the comparison is relative: the
    // truncation error is proportional to the acceleration it is measuring.
    const accelerationTowards = (target: number): number =>
      (stepSpring(state, target, 40, h).velocity - state.velocity) / h;
    expect(accelerationTowards(0) / (-40 * 40 * 10)).toBeCloseTo(1, 3);
    expect(accelerationTowards(20) / (40 * 40 * 10)).toBeCloseTo(1, 3);
  });
});

describe('omegaForHalfLife', () => {
  it('rejects a half-life that is not a positive finite number', () => {
    expect(() => omegaForHalfLife(0)).toThrow(/halfLifeSeconds/);
    expect(() => omegaForHalfLife(-1)).toThrow(/halfLifeSeconds/);
    expect(() => omegaForHalfLife(Number.NaN)).toThrow(/halfLifeSeconds/);
  });

  it('halves the distance from rest in exactly the time asked for', () => {
    for (const halfLife of [0.05, 0.12, 1, 4]) {
      const w = omegaForHalfLife(halfLife);
      const after = stepSpring(rest(1), 0, w, halfLife);
      expect(after.position).toBeCloseTo(0.5, 12);
    }
  });

  it('is a first half-life and not a repeating one', () => {
    // (1 + u)e^(-u) is not an exponential, so the second half-life is shorter
    // than the first. A caller who reads "half-life" as "halves again every
    // time" is reading the wrong curve, and this is the number they would get.
    const w = omegaForHalfLife(1);
    expect(stepSpring(rest(1), 0, w, 2).position).toBeCloseTo(0.151832, 6);
    expect(stepSpring(rest(1), 0, w, 3).position).toBeCloseTo(0.039264, 6);
  });

  it('pins the two constants the envelope is solved from', () => {
    const envelope = (u: number): number => (1 + u) * Math.exp(-u);
    expect(envelope(HALF_LIFE_OMEGA)).toBeCloseTo(0.5, 12);
    expect(envelope(SETTLE_OMEGA_1_PERCENT)).toBeCloseTo(0.01, 12);
    expect(omegaForHalfLife(2)).toBeCloseTo(HALF_LIFE_OMEGA / 2, 12);
  });

  it('settles to within one percent of the distance at the documented multiple', () => {
    const w = omegaForHalfLife(0.25);
    const settle = SETTLE_OMEGA_1_PERCENT / w;
    expect(Math.abs(stepSpring(rest(1), 0, w, settle).position)).toBeCloseTo(0.01, 9);
    expect(Math.abs(stepSpring(rest(1), 0, w, settle * 0.99).position)).toBeGreaterThan(0.01);
  });
});

describe('stepSpring2D', () => {
  const state2d = (
    px: number,
    py: number,
    vx: number,
    vy: number,
  ): Spring2DState => ({ position: { x: px, y: py }, velocity: { x: vx, y: vy } });

  it('names the axis of every value it rejects', () => {
    expect(() => stepSpring2D(state2d(Number.NaN, 0, 0, 0), { x: 0, y: 0 }, 1, 0.016)).toThrow(
      /state\.position\.x/,
    );
    expect(() => stepSpring2D(state2d(0, 0, 0, Number.NaN), { x: 0, y: 0 }, 1, 0.016)).toThrow(
      /state\.velocity\.y/,
    );
    expect(() => stepSpring2D(state2d(0, 0, 0, 0), { x: 0, y: Number.NaN }, 1, 0.016)).toThrow(
      /target\.y/,
    );
    expect(() => stepSpring2D(state2d(0, 0, 0, 0), { x: 0, y: 0 }, 1, -1)).toThrow(/dtSeconds/);
  });

  it('is two independent scalar springs, which is what makes the axes separable', () => {
    const state = state2d(10, -40, 3, 90);
    const target = { x: -5, y: 12 };
    const both = stepSpring2D(state, target, 9, 0.04);
    const x = stepSpring({ position: 10, velocity: 3 }, -5, 9, 0.04);
    const y = stepSpring({ position: -40, velocity: 90 }, 12, 9, 0.04);
    expect(both).toEqual({
      position: { x: x.position, y: y.position },
      velocity: { x: x.velocity, y: y.velocity },
    });
  });

  it('returns fresh points rather than the ones it was handed', () => {
    // The caller's record is theirs. A step that returned an alias would let a
    // later write to the result move the state a previous frame was read from.
    const state = state2d(1, 2, 0, 0);
    const target = { x: 5, y: 5 };
    const next = stepSpring2D(state, target, 8, 0.016);
    expect(next.position).not.toBe(state.position);
    expect(next.position).not.toBe(target);
    expect(next.velocity).not.toBe(state.velocity);
  });

  it('takes a zero step as an identity in both axes', () => {
    const next = stepSpring2D(state2d(4, -6, 11, -2), { x: 0, y: 0 }, 5, 0);
    expect(next).toEqual({ position: { x: 4, y: -6 }, velocity: { x: 11, y: -2 } });
  });
});
