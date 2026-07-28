import { describe, expect, it } from 'vitest';
import { numberOps } from '../src/sdf-ops.js';
import { circleDistance, roundedRectDistance } from '../src/sdf.js';

/**
 * The numeric half of M4.2's coverage. Every shape in this package is written
 * once over `SdfOps`, so running it over {@link numberOps} runs the same source
 * the shader compiles: see `sdf-ops.ts` for why there is no second copy of the
 * maths to test.
 *
 * Two habits from `camera.test.ts` carry over. Random cases come from a seeded
 * PRNG so a failure reproduces exactly rather than once, and where a test
 * measures a numerical error it asserts the bound it actually measured rather
 * than a comfortable round number.
 *
 * A third habit is specific to a distance field: several tests below compare
 * against a reference DERIVED DIFFERENTLY rather than against a rearrangement of
 * the implementation. A test that spells the same folded-quadrant formula a
 * second time and checks the two agree tests nothing at all.
 */

/** mulberry32, a 32-bit seeded PRNG, as in `@dagr/graph` and `@dagr/layout`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many random cases each property test draws. */
const RUNS = 20000;

/** The seed every property test in this file starts from. */
const SEED = 20260727;

/** `roundedRectDistance` over plain numbers, spelled shortly. */
function rrect(px: number, py: number, width: number, height: number, radius: number): number {
  return roundedRectDistance(numberOps, { x: px, y: py }, { x: width, y: height }, radius);
}

/** `circleDistance` over plain numbers, spelled shortly. */
function circle(px: number, py: number, radius: number): number {
  return circleDistance(numberOps, { x: px, y: py }, radius);
}

/**
 * The signed distance to an axis-aligned rectangle, derived from the DEFINITION
 * rather than from the implementation's algebra.
 *
 * Outside, the nearest point of a closed axis-aligned rectangle is the point's
 * own coordinates clamped into it (that is what an axis-aligned box being a
 * product of two intervals buys), so the distance is the plain Euclidean
 * distance to that point. Inside, the nearest boundary point lies on one of the
 * four edges, so the distance is the smallest of the four edge gaps, negated.
 *
 * Neither branch shares a line with the Inigo Quilez formulation under test: no
 * folding into the first quadrant, no `q`, no combining of an inside and an
 * outside term into one expression. That is the whole point of writing it.
 */
function boxReference(px: number, py: number, halfW: number, halfH: number): number {
  if (Math.abs(px) <= halfW && Math.abs(py) <= halfH) {
    return -Math.min(halfW - px, halfW + px, halfH - py, halfH + py);
  }
  const nearestX = Math.min(Math.max(px, -halfW), halfW);
  const nearestY = Math.min(Math.max(py, -halfH), halfH);
  return Math.hypot(px - nearestX, py - nearestY);
}

/**
 * The signed distance to a rounded rectangle, from the same independent box
 * reference plus the definition of the rounding.
 *
 * A rounded rectangle IS the Minkowski sum of a smaller rectangle with a disc of
 * radius `r`, and offsetting a set outward by `r` subtracts `r` from its signed
 * distance field everywhere. So the reference is the box reference on the inner
 * rectangle, minus the radius, which is a fact about offsets rather than a
 * restatement of the formula being tested.
 */
function roundedReference(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number {
  const r = Math.max(Math.min(radius, Math.min(width / 2, height / 2)), 0);
  return boxReference(px, py, width / 2 - r, height / 2 - r) - r;
}

/**
 * The distance from a point to the ZERO SET of a field, computed without
 * trusting the field's own value anywhere: it only ever asks where the sign
 * changes.
 *
 * This is the one reference that can tell a field which merely satisfies
 * `|grad d| = 1` from a field which is genuinely the signed distance to its own
 * boundary, and that distinction turns out to be exactly what the radius clamp
 * is about. See the radius clamp tests.
 *
 * Rays out of the point, a coarse march to bracket the first sign change, then
 * sixty bisections to place it. The bisection is exact for any purpose here, so
 * the whole error is angular, and it OVERESTIMATES: the nearest boundary point
 * can sit up to half a ray spacing off the nearest ray.
 *
 * How large that is depends on the boundary, which is worth stating because it
 * sets every tolerance below. Against a smooth arc the error is second order in
 * the ray spacing and lands at 1e-6 or better; against a SHARP convex corner it
 * is first order, because a ray a little off the corner direction hits a flat
 * edge instead and its crossing recedes linearly, and it lands at 1.3e-3. Either
 * way it is one to three orders of magnitude below the several per cent
 * discrepancy these tests exist to resolve.
 */
function distanceToZeroSet(
  field: (x: number, y: number) => number,
  px: number,
  py: number,
  reach: number,
): number {
  const rays = 1024;
  const steps = 600;
  const startValue = field(px, py);
  let best = Number.POSITIVE_INFINITY;
  for (let ray = 0; ray < rays; ray += 1) {
    const angle = (2 * Math.PI * ray) / rays;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let lo = 0;
    let loValue = startValue;
    for (let step = 1; step <= steps; step += 1) {
      const t = (reach * step) / steps;
      const value = field(px + dx * t, py + dy * t);
      if (Math.sign(value) !== Math.sign(loValue)) {
        let hi = t;
        for (let iteration = 0; iteration < 60; iteration += 1) {
          const mid = (lo + hi) / 2;
          if (Math.sign(field(px + dx * mid, py + dy * mid)) === Math.sign(loValue)) lo = mid;
          else hi = mid;
        }
        best = Math.min(best, (lo + hi) / 2);
        break;
      }
      lo = t;
      loValue = value;
    }
  }
  return best;
}

/**
 * The rounded rectangle field WITHOUT the radius clamp, which is the thing the
 * clamp tests below exist to convict. Kept in the test file rather than exposed
 * from `sdf.ts`, because nothing should be able to call it by accident.
 */
function unclampedRrect(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number {
  const qx = Math.abs(px) - width / 2 + radius;
  const qy = Math.abs(py) - height / 2 + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  );
}

describe('circleDistance', () => {
  it('is exactly the root of the sum of squares, minus the radius, over a grid', () => {
    for (let i = -20; i <= 20; i += 1) {
      for (let j = -20; j <= 20; j += 1) {
        for (const radius of [0.25, 1, 7.5, 1000]) {
          const px = (i / 5) * radius;
          const py = (j / 5) * radius;
          // Exact equality, not closeness: the implementation and this line are
          // the same two multiplications, one addition and one square root, so
          // any difference at all would mean the source had stopped being the
          // formula it claims to be.
          expect(circle(px, py, radius)).toBe(Math.sqrt(px * px + py * py) - radius);
        }
      }
    }
  });

  it('is NOT Math.hypot, which is a different and more accurate algorithm', () => {
    // Found by writing the previous test against `Math.hypot` and watching it
    // fail. `Math.hypot` is specified to avoid intermediate overflow and is
    // implemented with a compensated summation, so it disagrees with the plain
    // root of a sum of squares in 7563 of these 20000 cases, by up to 3.191e-16
    // relative. The implementation cannot use it and should not: the
    // nine ops in `SdfOps` have no `hypot`, and WGSL's `length()`, which is what
    // the TSL backend actually emits, is the plain form. Testing against
    // `Math.hypot` would be asserting that the GPU does something it does not.
    let disagreements = 0;
    let worst = 0;
    const random = mulberry32(SEED + 9);
    for (let run = 0; run < 20000; run += 1) {
      const px = (random() * 2 - 1) * 1000;
      const py = (random() * 2 - 1) * 1000;
      const plain = circle(px, py, 0);
      const compensated = Math.hypot(px, py);
      if (plain !== compensated) disagreements += 1;
      worst = Math.max(worst, Math.abs(plain - compensated) / compensated);
    }
    expect(disagreements).toBeGreaterThan(0);
    // The gap is an ulp or two, so every test in this file that compares
    // against a `Math.hypot` reference does so with a tolerance, never `toBe`.
    expect(worst).toBeLessThan(1e-15);
  });

  it('is zero to within an ulp on the boundary', () => {
    const random = mulberry32(SEED);
    for (let run = 0; run < 2000; run += 1) {
      const radius = 10 ** (random() * 6 - 3);
      const angle = random() * 2 * Math.PI;
      const value = circle(Math.cos(angle) * radius, Math.sin(angle) * radius, radius);
      // Not `toBe(0)`: `sqrt((r cos t)^2 + (r sin t)^2)` is `r` only to within
      // rounding, so the boundary lands within an ulp of zero rather than on
      // it. Measured worst case over these 2000 cases: 2.203e-16 of the radius,
      // which is one ulp. The bound asserted is 1e-14 of the radius.
      expect(Math.abs(value)).toBeLessThan(1e-14 * radius);
    }
  });

  it('is negative inside, zero at the centre distance, and positive outside', () => {
    expect(circle(0, 0, 5)).toBe(-5);
    expect(circle(3, 4, 5)).toBe(0);
    expect(circle(6, 8, 5)).toBe(5);
  });

  it('treats a negative radius as the degenerate circle of radius zero', () => {
    // The decision, and the reason for it, is in the docstring on
    // `circleDistance`: nothing can throw per fragment, and a negative radius
    // makes `hypot(p) - r` positive everywhere, a field whose zero set is empty
    // and which is therefore the distance to nothing at all. Clamping at zero
    // leaves the exact distance field of a point, which is the nearest thing
    // that exists.
    for (const radius of [-0.5, -1, -1e6]) {
      expect(circle(3, 4, radius)).toBe(5);
      expect(circle(0, 0, radius)).toBe(0);
    }
  });

  it('is scale invariant to within 1e-14 of the radius', () => {
    // Measured worst case, as a fraction of the scaled radius: 1.078e-15, about
    // five ulps. This is the "crisp at every zoom" claim in its testable form: a
    // shape drawn ten times larger has ten times the distance at ten times the
    // offset, so the shading in `shading.ts`, which is itself scale invariant,
    // produces the same pixel.
    const random = mulberry32(SEED + 1);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const radius = 10 ** (random() * 4 - 2);
      const px = (random() * 4 - 2) * radius;
      const py = (random() * 4 - 2) * radius;
      const k = 10 ** (random() * 6 - 3);
      const scaled = circle(px * k, py * k, radius * k);
      worst = Math.max(worst, Math.abs(scaled - k * circle(px, py, radius)) / (k * radius));
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it('produces no NaN at the centre or at radius zero', () => {
    expect(circle(0, 0, 0)).toBe(0);
    expect(Number.isNaN(circle(0, 0, 1))).toBe(false);
  });
});

describe('roundedRectDistance against an independent reference', () => {
  it('equals the exact box distance when the radius is zero', () => {
    // The reference is `boxReference`: nearest point by clamping outside,
    // smallest edge gap inside. Neither branch is the folded-quadrant algebra
    // under test.
    const random = mulberry32(SEED + 2);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const width = 10 ** (random() * 4 - 2);
      const height = 10 ** (random() * 4 - 2);
      const px = (random() * 4 - 2) * width;
      const py = (random() * 4 - 2) * height;
      const error = Math.abs(rrect(px, py, width, height, 0) - boxReference(px, py, width / 2, height / 2));
      worst = Math.max(worst, error / Math.max(width, height));
    }
    // Measured worst case, as a fraction of the larger side: 4.424e-16, which
    // is about two ulps. The bound is normalised by the shape size rather
    // than by the distance itself on purpose: near the boundary the distance is
    // a small difference of large numbers, so a bound relative to the VALUE
    // blows up for a reason that has nothing to do with the formula.
    expect(worst).toBeLessThan(1e-14);
  });

  it('equals an offset box for any radius inside the shape', () => {
    // A rounded rectangle is the inner rectangle grown by `r` in every
    // direction, and growing a set by `r` subtracts `r` from its distance
    // field. That is the reference, and it shares no algebra with the
    // implementation.
    const random = mulberry32(SEED + 3);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const width = 10 ** (random() * 4 - 2);
      const height = 10 ** (random() * 4 - 2);
      const radius = random() * Math.min(width, height) * 0.5;
      const px = (random() * 4 - 2) * width;
      const py = (random() * 4 - 2) * height;
      const error = Math.abs(
        rrect(px, py, width, height, radius) - roundedReference(px, py, width, height, radius),
      );
      worst = Math.max(worst, error / Math.max(width, height));
    }
    // Measured worst case as a fraction of the larger side: 6.789e-16.
    expect(worst).toBeLessThan(1e-14);
  });

  it('reads size as the FULL width and height, not the half extent', () => {
    // The vocabulary question, pinned. `@dagr/layout` hands out node boxes as a
    // width and a height, so a 100 by 40 box has its right edge at x = 50, and
    // an implementation that forgot to halve would put it at x = 100.
    expect(rrect(50, 0, 100, 40, 0)).toBe(0);
    expect(rrect(0, 20, 100, 40, 0)).toBe(0);
    expect(rrect(0, 0, 100, 40, 0)).toBe(-20);
    expect(rrect(60, 0, 100, 40, 0)).toBe(10);
  });
});

describe('roundedRectDistance as a circle', () => {
  it('is a circle when the shape is a square and the radius is its half side', () => {
    // The strongest single cross-check available: two formulations that share
    // nothing but their answer. At `radius = halfSide` the rounded rectangle
    // degenerates to the disc inscribed in the square, so it has to agree with
    // `circleDistance` everywhere, including outside, in the corners, and deep
    // inside where the two formulas take completely different branches.
    const random = mulberry32(SEED + 4);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const radius = 10 ** (random() * 6 - 3);
      const px = (random() * 4 - 2) * radius;
      const py = (random() * 4 - 2) * radius;
      const asRect = rrect(px, py, 2 * radius, 2 * radius, radius);
      worst = Math.max(worst, Math.abs(asRect - circle(px, py, radius)) / radius);
    }
    // NOT bit-exact, and that is worth stating rather than hiding behind a
    // tolerance. The rectangle computes `(|px| - halfW) + r` where the circle
    // computes `|px|`, and with `halfW === r` those differ whenever the
    // subtraction cancels digits the addition cannot restore. Measured over
    // these 20000 cases: the two agree bit for bit in 19509 of them and differ
    // by at most 4.343e-16 of the radius (two ulps) in the rest. The bound
    // asserted is 1e-14 of the radius.
    expect(worst).toBeLessThan(1e-14);
  });
});

describe('roundedRectDistance eikonal property', () => {
  it('has a unit gradient everywhere off the medial axis', () => {
    // `|grad d| = 1` is the property that makes derivative antialiasing
    // correct: `shading.ts` divides the distance by a filter width and expects
    // the quotient to be a number of pixels, which it only is if one unit of
    // distance is one unit of space in every direction. A field that is merely
    // monotone in the right direction still shades, and shades WRONG, with an
    // edge that thickens near the corners.
    //
    // Where the property genuinely does not hold: the medial axis, the set of
    // interior points with more than one nearest boundary point, where the
    // field has a crease and the gradient is undefined. That set is contained
    // in three lines of the inner rectangle (half extents A and B after the
    // radius is taken off), and containment is what matters, since a skip rule
    // is allowed to be conservative but not to miss anything:
    //
    //  - two opposite edges tie only on `x = 0` or on `y = 0`;
    //  - two adjacent edges tie only where `A - |x| = B - |y|`.
    //
    // Outside the shape the field is smooth everywhere, because the shape is
    // convex and an exterior point has a unique nearest point, so no skipping
    // is done there and every exterior sample is asserted.
    //
    // The skip band is 100 times the differencing step. That is not arbitrary:
    // a central difference near a crease is wrong by roughly `h^2` over the
    // square of the distance to the crease, so the width of the band sets the
    // achievable tolerance. Measured worst `||grad d| - 1|` at 20h is 7.79e-6,
    // at 50h is 3.03e-6, and at 100h it drops to 1.87e-7 and stops improving,
    // which is where the truncation error of the difference itself takes over.
    // 100h is therefore the smallest band that buys the whole benefit.
    const random = mulberry32(SEED + 5);
    let worst = 0;
    let tested = 0;
    for (let run = 0; run < 4000; run += 1) {
      const width = 10 ** (random() * 5 - 2);
      const height = 10 ** (random() * 5 - 2);
      const radius = random() * Math.min(width, height) * 0.6;
      const scale = Math.max(width, height);
      const step = scale * 1e-5;
      const tau = 100 * step;
      const px = (random() * 3 - 1.5) * width;
      const py = (random() * 3 - 1.5) * height;

      const innerHalfW = width / 2 - radius;
      const innerHalfH = height / 2 - radius;
      const nearMedialAxis =
        Math.abs(innerHalfW - Math.abs(px) - (innerHalfH - Math.abs(py))) < tau ||
        Math.abs(px) < tau ||
        Math.abs(py) < tau;
      if (rrect(px, py, width, height, radius) < 0 && nearMedialAxis) continue;

      const gx =
        (rrect(px + step, py, width, height, radius) -
          rrect(px - step, py, width, height, radius)) /
        (2 * step);
      const gy =
        (rrect(px, py + step, width, height, radius) -
          rrect(px, py - step, width, height, radius)) /
        (2 * step);
      worst = Math.max(worst, Math.abs(Math.hypot(gx, gy) - 1));
      tested += 1;
    }
    // Measured worst case: 1.305e-6 over the 3871 cases that survive the skip
    // rule. The bound asserted is 1e-5, about eight times that.
    expect(worst).toBeLessThan(1e-5);
    // And the guard that keeps the test from passing vacuously: a skip rule
    // that grew until it skipped everything would leave this at zero and every
    // assertion above unreached.
    expect(tested).toBeGreaterThan(3000);
  });
});

describe('roundedRectDistance scale invariance', () => {
  it('scales linearly with the point, the size and the radius together', () => {
    // The claim that "crisp at every zoom" reduces to. A distance field is
    // homogeneous of degree one, so scaling the whole configuration by `k`
    // scales the answer by `k` exactly, and combined with `coverage` being
    // invariant under scaling both its arguments (see `shading.test.ts`) it
    // means the pixel a zoomed shape produces is the pixel the unzoomed one
    // produced. If either half failed, edges would soften or harden with zoom.
    //
    // `k` spans six orders of magnitude, 1e-3 to 1e3, which is the range
    // `camera.test.ts` draws its zooms from.
    const random = mulberry32(SEED + 6);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const width = 10 ** (random() * 4 - 2);
      const height = 10 ** (random() * 4 - 2);
      const radius = random() * Math.min(width, height) * 0.5;
      const px = (random() * 4 - 2) * width;
      const py = (random() * 4 - 2) * height;
      const k = 10 ** (random() * 6 - 3);
      const scaled = rrect(px * k, py * k, width * k, height * k, radius * k);
      const error = Math.abs(scaled - k * rrect(px, py, width, height, radius));
      worst = Math.max(worst, error / (k * Math.max(width, height)));
    }
    // Measured worst case, as a fraction of the scaled shape size: 7.074e-16,
    // about three ulps. Normalised by the size rather than by the value for the
    // same reason as the reference tests: relative to a distance that is itself
    // near zero, four ulps of the size is unboundedly large and says nothing.
    expect(worst).toBeLessThan(1e-14);
  });
});

describe('roundedRectDistance radius clamp', () => {
  it('collapses an over-large radius onto half the short side, exactly', () => {
    const random = mulberry32(SEED + 7);
    for (let run = 0; run < 2000; run += 1) {
      const width = 10 ** (random() * 3 - 1);
      const height = 10 ** (random() * 3 - 1);
      const shortHalf = Math.min(width, height) / 2;
      const px = (random() * 4 - 2) * width;
      const py = (random() * 4 - 2) * height;
      const huge = shortHalf * (1 + random() * 1000);
      expect(rrect(px, py, width, height, huge)).toBe(rrect(px, py, width, height, shortHalf));
    }
  });

  it('collapses a negative radius onto zero, exactly', () => {
    const random = mulberry32(SEED + 8);
    for (let run = 0; run < 2000; run += 1) {
      const width = 10 ** (random() * 3 - 1);
      const height = 10 ** (random() * 3 - 1);
      const px = (random() * 4 - 2) * width;
      const py = (random() * 4 - 2) * height;
      const negative = -random() * 100;
      expect(rrect(px, py, width, height, negative)).toBe(rrect(px, py, width, height, 0));
    }
  });

  it('is a correctness fix, not a cosmetic one: the unclamped field underestimates', () => {
    // The claim the clamp's docstring makes, checked here rather than asserted
    // there. Without the clamp the formula does not merely draw an odd shape:
    // it returns a number that is not the distance to its own zero set, and it
    // is too SMALL, which is the dangerous direction. A distance that reads
    // shorter than it is puts the antialiased edge in the wrong place and, in
    // any later use of these fields for hit testing or ray marching, steps a
    // marcher straight through a surface.
    //
    // Two configurations, both with the radius past half the short side. The
    // reference is `distanceToZeroSet`, which never looks at the field's value,
    // only at where it changes sign.
    const cases: readonly [number, number, number, number, number][] = [
      [10, 2, 3, 6, 0],
      [2, 2, 2, 2, 0],
    ];
    for (const [width, height, radius, px, py] of cases) {
      const field = (x: number, y: number): number => unclampedRrect(x, y, width, height, radius);
      const claimed = field(px, py);
      const truth = distanceToZeroSet(field, px, py, 50);
      expect(claimed).toBeLessThan(truth * 0.95);
    }

    // Measured, so the docstring can quote them: 10 by 2 with radius 3 at
    // (6, 0) claims 1.4721 where the true distance to its own boundary is
    // 1.7639, a 16.5 per cent underestimate; 2 by 2 with radius 2 at (2, 0)
    // claims 1.1623 against 1.2679, 8.3 per cent.
    expect(unclampedRrect(6, 0, 10, 2, 3)).toBeCloseTo(1.472136, 6);
    expect(unclampedRrect(2, 0, 2, 2, 2)).toBeCloseTo(1.162278, 6);
  });

  it('is a correctness fix the eikonal test could never have caught', () => {
    // Worth its own test because it is the reason the previous one has to ray
    // march instead of just differencing. The unclamped field still has a unit
    // gradient almost everywhere, since it is the distance to a circle in the
    // folded first quadrant and folding preserves gradient magnitude. It is the
    // FOLD that breaks it: reflecting across an axis introduces a boundary
    // corner that the circle formula keeps measuring straight past.
    const field = (x: number, y: number): number => unclampedRrect(x, y, 2, 2, 2);
    const step = 1e-5;
    let worst = 0;
    for (let i = -20; i <= 20; i += 1) {
      for (let j = -20; j <= 20; j += 1) {
        const px = i * 0.13 + 0.017;
        const py = j * 0.13 + 0.011;
        const gx = (field(px + step, py) - field(px - step, py)) / (2 * step);
        const gy = (field(px, py + step) - field(px, py - step)) / (2 * step);
        worst = Math.max(worst, Math.abs(Math.hypot(gx, gy) - 1));
      }
    }
    // Measured: 7.508e-11, indistinguishable from the clamped field. A suite
    // that only checked the eikonal property would have shipped this.
    expect(worst).toBeLessThan(1e-9);
  });

  it('leaves the clamped field agreeing with the distance to its own zero set', () => {
    // The other half of the previous test: the same independent reference,
    // applied to what the implementation actually does, at the same points.
    //
    // Each case carries its own bound, so a regression in a smooth case cannot
    // hide under the loose bound the last one needs. The last one needs it
    // because the reference, not the implementation, is the imprecise party
    // there: at a SHARP convex corner the ray march's error is first order in
    // the ray spacing rather than second, since a ray a little off the corner
    // direction hits a flat edge and its crossing recedes linearly. Measured
    // relative gaps at 1024 rays: 4.4e-16, 2.2e-16 and 1.0e-6 for the three
    // shapes whose nearest boundary point is on a rounded arc or a flat edge,
    // and 1.3e-3 for the square corner. Quadrupling the ray count only halves
    // that last one, which is the signature of a first-order error and the
    // reason the bound is set rather than bought.
    const cases: readonly [number, number, number, number, number, number][] = [
      [10, 2, 3, 6, 0, 1e-9],
      [2, 2, 2, 2, 0, 1e-9],
      [100, 40, 8, 70, 30, 1e-5],
      [100, 40, 0, 70, 30, 5e-3],
    ];
    for (const [width, height, radius, px, py, tolerance] of cases) {
      const field = (x: number, y: number): number => rrect(x, y, width, height, radius);
      const claimed = field(px, py);
      const truth = distanceToZeroSet(field, px, py, 400);
      expect(Math.abs(claimed - truth)).toBeLessThan(tolerance * truth);
    }
  });
});

describe('roundedRectDistance degenerate sizes', () => {
  it('produces a finite, sane distance for a zero width or a zero height', () => {
    // A zero-width box is a vertical segment, and the distance to a segment is
    // what the formula degenerates to, exactly. Nothing here is a fallback: the
    // segment IS the shape the caller described.
    expect(rrect(0, 0, 0, 10, 0)).toBe(0);
    expect(rrect(3, 0, 0, 10, 0)).toBe(3);
    expect(rrect(0, 8, 0, 10, 0)).toBe(3);
    expect(rrect(4, 8, 0, 10, 0)).toBe(5);

    expect(rrect(0, 0, 10, 0, 0)).toBe(0);
    expect(rrect(0, 3, 10, 0, 0)).toBe(3);
    expect(rrect(8, 0, 10, 0, 0)).toBe(3);
  });

  it('collapses a zero by zero box to the distance to the origin', () => {
    expect(rrect(0, 0, 0, 0, 0)).toBe(0);
    expect(rrect(3, 4, 0, 0, 0)).toBe(5);
    // And with a radius, which the clamp has to take all the way down to zero,
    // because half the short side is zero.
    expect(rrect(3, 4, 0, 0, 9)).toBe(5);
  });

  it('produces no NaN anywhere on a wide grid of degenerate and normal shapes', () => {
    // The failure this rules out is the one that costs a whole frame: a single
    // NaN distance propagates through every shading term to a transparent or
    // black fragment, and nothing throws on the way.
    const sizes = [0, 1e-9, 0.001, 1, 100, 1e6, -1, -1e6];
    const radii = [-1e6, -1, 0, 1e-9, 0.5, 1e6];
    const points = [0, 1e-12, 0.5, 3, 1e7, -1e7];
    for (const width of sizes) {
      for (const height of sizes) {
        for (const radius of radii) {
          for (const px of points) {
            for (const py of points) {
              expect(Number.isNaN(rrect(px, py, width, height, radius))).toBe(false);
            }
          }
        }
      }
    }
  });

  it('treats a negative size as a zero one rather than as an inside-out box', () => {
    // Not specified by the task, and decided here: a negative extent has no
    // shape to describe, and the arithmetic without a floor produces a field
    // that is positive at the origin of a box the caller believes they are
    // standing inside. Flooring the half extent at zero degenerates the box to
    // a segment or a point, which is a real shape with a real distance field.
    expect(rrect(0, 0, -4, 4, 1)).toBe(rrect(0, 0, 0, 4, 1));
    expect(rrect(3, 1, -4, 4, 1)).toBe(rrect(3, 1, 0, 4, 1));
    expect(rrect(3, 4, -4, -4, 1)).toBe(5);
  });
});
