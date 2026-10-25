import { describe, expect, it } from 'vitest';
import {
  AA_QUAD_PADDING_FRACTION,
  circleDistance,
  clampCornerRadius,
  edgeCoverage,
  glowIntensity,
  roundedRectDistance,
  shapeQuadSize,
} from '../src/sdf.js';

/**
 * The proof of M4.2's shape math.
 *
 * The TSL nodes that draw these shapes are checked by a screenshot, and a
 * screenshot tells you that something looked plausible at one zoom on one
 * machine. It cannot tell you that a rounded corner is a circular arc rather
 * than a slightly wrong curve, that a distance is exact rather than an
 * approximation that happens to look right, or that a glow reaches zero before
 * the quad ends. Every one of those is checked here instead, on ordinary
 * numbers, which is why `sdf.ts` exists as a separate module at all.
 *
 * Three habits carry over from `camera.test.ts` and from the graph and layout
 * suites. Random cases come from a seeded PRNG, so a failure reproduces exactly
 * rather than once. Where a test measures a numerical error it asserts the
 * bound it actually measured rather than a comfortable round number. And where
 * a claim can be checked against a SECOND, independently written implementation
 * (the point-in-rounded-rect predicate and the brute-force nearest boundary
 * search below), it is, because two implementations disagreeing is a stronger
 * signal than any assertion about one of them. That is the lesson M2.3 left
 * behind and it applies here more than anywhere: this file is the only reason
 * anyone will believe the shader.
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
const RUNS = 2000;

/** The seed every property test in this file starts from. */
const SEED = 20260728;

/**
 * Is a point inside a rounded rectangle? A SECOND implementation, written by
 * region case analysis rather than as a vector formula, so that it shares no
 * arithmetic with `roundedRectDistance` beyond `Math.hypot`.
 *
 * The cases are: outside the bounding box, inside one of the two cross arms
 * that the corner radii do not touch, and otherwise inside the corner square,
 * where membership is a circle test against the arc's centre. Boundary points
 * count as inside, matching the `distance <= 0` the sign tests compare against.
 */
function insideRoundedRect(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): boolean {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  if (ax > halfWidth || ay > halfHeight) return false;
  const flatX = halfWidth - radius;
  const flatY = halfHeight - radius;
  if (ax <= flatX || ay <= flatY) return true;
  return Math.hypot(ax - flatX, ay - flatY) <= radius;
}

/**
 * The distance from a point to the NEAREST POINT ON THE BOUNDARY of a rounded
 * rectangle, found by walking the boundary and taking the smallest distance
 * seen. Unsigned, and independent of `roundedRectDistance` in every respect
 * except the shape it describes.
 *
 * This is what makes "the field is exact, not an approximation" a tested claim
 * rather than a sentence in a docstring. The boundary is four straight segments
 * and four quarter arcs, parameterised directly; `samples` points are taken
 * along each of the eight pieces. The error is the sagitta of one sampling
 * step, `s * s / (8 * d)` for a query point `d` from the boundary, which is why
 * the caller skips query points that sit almost exactly on it.
 */
function nearestBoundaryDistance(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
  samples: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  const consider = (bx: number, by: number): void => {
    const dx = px - bx;
    const dy = py - by;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  };

  const flatX = halfWidth - radius;
  const flatY = halfHeight - radius;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = -flatX + 2 * flatX * t;
    consider(x, halfHeight);
    consider(x, -halfHeight);
    const y = -flatY + 2 * flatY * t;
    consider(halfWidth, y);
    consider(-halfWidth, y);
  }
  for (let i = 0; i <= samples; i += 1) {
    const angle = (Math.PI / 2) * (i / samples);
    const ox = Math.cos(angle) * radius;
    const oy = Math.sin(angle) * radius;
    consider(flatX + ox, flatY + oy);
    consider(-flatX - ox, flatY + oy);
    consider(flatX + ox, -flatY - oy);
    consider(-flatX - ox, -flatY - oy);
  }
  return Math.sqrt(best);
}

/** A grid of exact binary fractions, so no sample lands near a boundary by luck. */
function binaryGrid(limit: number, step: number): number[] {
  const points: number[] = [];
  for (let value = -limit; value <= limit; value += step) points.push(value);
  return points;
}

describe('roundedRectDistance exact values', () => {
  it('reads minus the smaller half extent at the centre', () => {
    // The centre's nearest boundary point is on whichever pair of straight
    // edges is closer, so the corner radius drops out entirely. Exact: every
    // number here is a binary fraction and the formula's corner term cancels.
    expect(roundedRectDistance(0, 0, 3, 2, 0.5)).toBe(-2);
    expect(roundedRectDistance(0, 0, 3, 2, 0)).toBe(-2);
    expect(roundedRectDistance(0, 0, 2, 5, 1.5)).toBe(-2);
    expect(roundedRectDistance(0, 0, 4, 4, 4)).toBe(-4);
  });

  it('reads the gap to the edge at the four edge midpoints', () => {
    // On the straight part of an edge the field is exactly the gap, inside and
    // out, which is the property the antialiasing band depends on: a coverage
    // ramp of a given width in world units has to be that width on the screen.
    const [halfWidth, halfHeight, radius] = [3, 2, 0.5];
    for (const gap of [-0.75, -0.25, 0, 0.25, 1.5, 8]) {
      expect(roundedRectDistance(0, halfHeight + gap, halfWidth, halfHeight, radius)).toBe(gap);
      expect(roundedRectDistance(0, -halfHeight - gap, halfWidth, halfHeight, radius)).toBe(gap);
      expect(roundedRectDistance(halfWidth + gap, 0, halfWidth, halfHeight, radius)).toBe(gap);
      expect(roundedRectDistance(-halfWidth - gap, 0, halfWidth, halfHeight, radius)).toBe(gap);
    }
  });

  it('reads the distance to the corner arc centre minus the radius, at all four corners', () => {
    // A 3-4-5 offset from the arc centre, so the expected value is exact rather
    // than close. This is the case that would still look right in a screenshot
    // if the corner were an ellipse or a superellipse instead of a circle.
    const [halfWidth, halfHeight, radius] = [3, 2, 0.5];
    const arcX = halfWidth - radius;
    const arcY = halfHeight - radius;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        // Outside the corner: 5 away from the arc centre, so 4.5 from the arc.
        expect(
          roundedRectDistance(sx * (arcX + 3), sy * (arcY + 4), halfWidth, halfHeight, radius),
        ).toBe(4.5);
        // Inside it: 0.2 away from the arc centre, so 0.3 in from the arc.
        expect(
          roundedRectDistance(sx * (arcX + 0.12), sy * (arcY + 0.16), halfWidth, halfHeight, radius),
        ).toBeCloseTo(-0.3, 15);
      }
    }
  });

  it('reads exactly zero on the boundary', () => {
    // Zero, not nearly zero. `edgeCoverage` puts its half-coverage point here,
    // so a boundary that read 1e-16 would still be right, but a boundary that
    // read the radius or the negative radius (the two ways to drop a term from
    // the formula) would not, and both survive a sign-only test.
    expect(roundedRectDistance(0, 2, 3, 2, 0.5)).toBe(0);
    expect(roundedRectDistance(3, 0, 3, 2, 0.5)).toBe(0);
    expect(roundedRectDistance(-3, 0, 3, 2, 0.5)).toBe(0);
    expect(roundedRectDistance(0, -2, 3, 2, 0.5)).toBe(0);
    // A point on the corner arc itself, again on a 3-4-5 offset scaled to 0.5.
    expect(roundedRectDistance(2.5 + 0.3, 1.5 + 0.4, 3, 2, 0.5)).toBeCloseTo(0, 15);
  });

  it('reads the diagonal distance far outside', () => {
    // Far out on the diagonal the shape is a point, and the field is the
    // distance to the arc centre less the radius. A 30-40-50 offset keeps the
    // expected value exact even at this range.
    expect(roundedRectDistance(32.5, 41.5, 3, 2, 0.5)).toBe(49.5);
    expect(roundedRectDistance(1e6, 1e6, 3, 2, 0.5)).toBeCloseTo(
      Math.hypot(1e6 - 2.5, 1e6 - 1.5) - 0.5,
      6,
    );
  });

  it('collapses to a square box field at radius zero', () => {
    // Radius 0 has to leave the plain box field behind, with no residue of the
    // corner terms. Checked against the box field written out separately.
    const boxDistance = (px: number, py: number, hw: number, hh: number): number => {
      const qx = Math.abs(px) - hw;
      const qy = Math.abs(py) - hh;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    };
    const random = mulberry32(SEED);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const hw = 0.25 + random() * 8;
      const hh = 0.25 + random() * 8;
      const px = (random() * 2 - 1) * 12;
      const py = (random() * 2 - 1) * 12;
      worst = Math.max(
        worst,
        Math.abs(roundedRectDistance(px, py, hw, hh, 0) - boxDistance(px, py, hw, hh)),
      );
    }
    // Exactly zero: with radius 0 the two expressions are the same additions in
    // the same order, so any difference at all would mean a term had moved.
    expect(worst).toBe(0);
    // And the corner of a square box is the corner of the box, sharp.
    expect(roundedRectDistance(6, 6, 3, 2, 0)).toBe(5);
  });

  it('becomes a circle when the radius equals the half extent of a square', () => {
    // The strongest single check in this file. A square whose corner radius is
    // its half extent IS a circle, so two formulas with nothing in common but
    // that fact have to agree everywhere. Every wrong sign, every dropped
    // `+ radius` and every `min`/`max` swapped for the other in the rounded box
    // field breaks this, including the ones that leave the sign correct and the
    // centre and the edge midpoints correct.
    const random = mulberry32(SEED + 1);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const radius = 10 ** (random() * 4 - 2);
      const px = (random() * 2 - 1) * radius * 3;
      const py = (random() * 2 - 1) * radius * 3;
      const box = roundedRectDistance(px, py, radius, radius, radius);
      const circle = circleDistance(px, py, radius);
      // Relative, because the radius here spans four orders of magnitude and an
      // absolute bound would only be testing the small end.
      worst = Math.max(worst, Math.abs(box - circle) / radius);
    }
    // Measured worst case over these 2000 seeded cases: 8.361e-16 relative,
    // which is under four ulps. The only arithmetic the two do not share is the
    // `- halfExtent + radius` in the box field's `q`, which cancels exactly
    // whenever the two operands are within an exponent or so of each other and
    // rounds by an ulp or two when they are not. The bound asserted is 1e-14,
    // about twelve times the worst case seen.
    expect(worst).toBeLessThan(1e-14);
  });

  it('matches a brute-force search for the nearest boundary point', () => {
    // What "exact, not an approximation" means, made into a measurement. The
    // comparison walks the actual boundary of the actual shape and takes the
    // smallest distance it can find; the field has to agree in magnitude, and
    // agree on both sides. The cheap approximate field, which clamps `q` and
    // drops the interior term, agrees with this one at every point OUTSIDE the
    // shape and reads a flat `-radius` at every point inside it; 11 of the 60
    // query points this seed keeps are interior, and it is wrong by up to 0.87
    // world units on them.
    const [halfWidth, halfHeight, radius] = [3, 2, 0.75];
    const random = mulberry32(SEED + 2);
    let worst = 0;
    let checked = 0;
    for (let run = 0; run < 60; run += 1) {
      const px = (random() * 2 - 1) * 6;
      const py = (random() * 2 - 1) * 6;
      const signed = roundedRectDistance(px, py, halfWidth, halfHeight, radius);
      // Skip points almost on the boundary: there the sampling error of the
      // brute force blows up like 1 / distance, and the claim would be about
      // the search rather than about the field.
      if (Math.abs(signed) < 0.05) continue;
      checked += 1;
      const brute = nearestBoundaryDistance(px, py, halfWidth, halfHeight, radius, 20000);
      worst = Math.max(worst, Math.abs(Math.abs(signed) - brute));
      expect(signed < 0).toBe(insideRoundedRect(px, py, halfWidth, halfHeight, radius));
    }
    expect(checked).toBeGreaterThan(50);
    // Measured worst case: 9.577e-9, and it is the brute force's error, not the
    // field's: it is the sagitta of one sampling step of the boundary walk,
    // `s * s / (8 * d)`, at the closest query point this seed kept (0.112 from
    // the boundary). The bound asserted is 1e-6, which is set by the SKIP
    // THRESHOLD rather than by this seed's luck: a query point sitting at the
    // 0.05 the loop still accepts would carry an error of 1.3e-7, and a bound
    // tighter than that would be a bound about the draw rather than the field.
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('roundedRectDistance sign', () => {
  it('agrees with an independent point-in-rounded-rect predicate on a dense grid', () => {
    // Two implementations, one vector formula and one region case analysis.
    // The grid is exact binary fractions and the shapes have exact binary
    // extents, so the handful of samples that land exactly on a boundary land
    // there in both implementations and both call it inside.
    const shapes = [
      { halfWidth: 3, halfHeight: 2, radius: 0.75 },
      { halfWidth: 3, halfHeight: 2, radius: 0 },
      { halfWidth: 2, halfHeight: 2, radius: 2 },
      { halfWidth: 1.5, halfHeight: 4, radius: 1.5 },
      { halfWidth: 0.5, halfHeight: 0.25, radius: 0.25 },
    ];
    const axis = binaryGrid(6, 0.0625);
    let checked = 0;
    for (const { halfWidth, halfHeight, radius } of shapes) {
      for (const px of axis) {
        for (const py of axis) {
          const signed = roundedRectDistance(px, py, halfWidth, halfHeight, radius);
          expect(signed <= 0).toBe(insideRoundedRect(px, py, halfWidth, halfHeight, radius));
          checked += 1;
        }
      }
    }
    // Asserted so that a grid that silently stopped producing points would fail
    // rather than pass vacuously.
    expect(checked).toBe(shapes.length * axis.length * axis.length);
  });

  it('agrees with the same predicate for random shapes and random points', () => {
    // The grid fixes five shapes; this varies the shape too, including the two
    // degenerate ends (radius 0 and radius equal to the smaller half extent).
    const random = mulberry32(SEED + 3);
    for (let run = 0; run < RUNS; run += 1) {
      const halfWidth = 0.05 + random() * 5;
      const halfHeight = 0.05 + random() * 5;
      const radius = clampCornerRadius(random() * 6 - 1, halfWidth, halfHeight);
      const px = (random() * 2 - 1) * 8;
      const py = (random() * 2 - 1) * 8;
      const signed = roundedRectDistance(px, py, halfWidth, halfHeight, radius);
      expect(signed <= 0).toBe(insideRoundedRect(px, py, halfWidth, halfHeight, radius));
    }
  });

  it('is negative inside and positive outside, which is the graphics convention', () => {
    // Stated once as a bare fact, because it is the convention the TSL side
    // shares and the one every other function in the module reads.
    expect(roundedRectDistance(0, 0, 2, 1, 0.25)).toBeLessThan(0);
    expect(roundedRectDistance(10, 0, 2, 1, 0.25)).toBeGreaterThan(0);
    expect(circleDistance(0, 0, 1)).toBeLessThan(0);
    expect(circleDistance(5, 0, 1)).toBeGreaterThan(0);
  });
});

describe('circleDistance', () => {
  it('reads minus the radius at the centre, zero on the rim and the gap outside', () => {
    expect(circleDistance(0, 0, 2)).toBe(-2);
    expect(circleDistance(2, 0, 2)).toBe(0);
    expect(circleDistance(0, -2, 2)).toBe(0);
    expect(circleDistance(3, 4, 2)).toBe(3);
    expect(circleDistance(0.6, 0.8, 2)).toBeCloseTo(-1, 15);
  });

  it('depends only on how far the point is from the centre', () => {
    // Rotational symmetry, which is the whole content of the circle field and
    // the one property a rounded box does not have.
    const random = mulberry32(SEED + 4);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const radius = 0.1 + random() * 10;
      const at = 0.1 + random() * 20;
      const angle = random() * Math.PI * 2;
      const rotated = circleDistance(at * Math.cos(angle), at * Math.sin(angle), radius);
      worst = Math.max(worst, Math.abs(rotated - (at - radius)));
    }
    // Measured worst case: 7.105e-15, entirely the rounding of `cos` and `sin`
    // multiplied back up by the radius.
    expect(worst).toBeLessThan(1e-13);
  });
});

describe('clampCornerRadius', () => {
  it('passes an in-range radius through unchanged', () => {
    expect(clampCornerRadius(0.75, 3, 2)).toBe(0.75);
    expect(clampCornerRadius(0, 3, 2)).toBe(0);
    expect(clampCornerRadius(2, 3, 2)).toBe(2);
  });

  it('clamps down to the smaller half extent', () => {
    expect(clampCornerRadius(100, 3, 2)).toBe(2);
    expect(clampCornerRadius(100, 2, 3)).toBe(2);
    expect(clampCornerRadius(2.5, 3, 2)).toBe(2);
  });

  it('clamps a negative radius up to zero rather than throwing', () => {
    // The decision, and it is the one the package's own rule points at rather
    // than an exception to it. `Camera2D.setZoom` clamps a zoom that overshoots
    // its range and rejects only a zoom no clamp could mean anything by; the
    // same split applies here, and the neutral answer a negative radius asks
    // for exists and is a square corner.
    expect(clampCornerRadius(-1, 3, 2)).toBe(0);
    expect(clampCornerRadius(-1e9, 3, 2)).toBe(0);
    expect(clampCornerRadius(-0, 3, 2)).toBe(0);
  });

  it('returns zero for a zero-sized shape', () => {
    expect(clampCornerRadius(5, 0, 0)).toBe(0);
    expect(clampCornerRadius(5, 4, 0)).toBe(0);
  });

  it('rejects a non-finite radius, naming the field', () => {
    for (const radius of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => clampCornerRadius(radius, 3, 2)).toThrow(RangeError);
      expect(() => clampCornerRadius(radius, 3, 2)).toThrow(/radius/);
    }
  });

  it('rejects a negative or non-finite half extent, naming the field', () => {
    // Unlike the radius, a half extent is not clamped. It is not a value that
    // overshoots from a gesture: it is the shape's own size, and a negative one
    // means the caller computed the size wrongly, which no clamp can repair
    // without inventing a shape the caller never asked for.
    expect(() => clampCornerRadius(1, -1, 2)).toThrow(/halfWidth/);
    expect(() => clampCornerRadius(1, 3, -1)).toThrow(/halfHeight/);
    expect(() => clampCornerRadius(1, Number.NaN, 2)).toThrow(/halfWidth/);
    expect(() => clampCornerRadius(1, 3, Number.POSITIVE_INFINITY)).toThrow(/halfHeight/);
    expect(() => clampCornerRadius(1, -1, 2)).toThrow(RangeError);
  });

  it('always returns a radius the rounded box field can take', () => {
    // The contract that makes it safe for `roundedRectDistance` to skip
    // validating its own radius: whatever goes in, what comes out lies in
    // `[0, min(halfWidth, halfHeight)]`, which is the range the field is a
    // field over.
    const random = mulberry32(SEED + 5);
    for (let run = 0; run < RUNS; run += 1) {
      const halfWidth = random() * 10;
      const halfHeight = random() * 10;
      const radius = clampCornerRadius((random() * 4 - 1) * 10, halfWidth, halfHeight);
      expect(radius).toBeGreaterThanOrEqual(0);
      expect(radius).toBeLessThanOrEqual(Math.min(halfWidth, halfHeight));
    }
  });
});

describe('edgeCoverage', () => {
  it('is one well inside the shape and zero well outside it', () => {
    expect(edgeCoverage(-10, 2)).toBe(1);
    expect(edgeCoverage(-1, 2)).toBe(1);
    expect(edgeCoverage(1, 2)).toBe(0);
    expect(edgeCoverage(10, 2)).toBe(0);
  });

  it('is exactly one half on the boundary', () => {
    for (const filterWidth of [0.001, 1, 2, 1000]) {
      expect(edgeCoverage(0, filterWidth)).toBe(0.5);
    }
  });

  it('is the cubic smoothstep across the band', () => {
    // The formula pinned by value, not by shape: `smoothstep(w/2, -w/2, d)`
    // with the standard `t * t * (3 - 2 * t)`. At a quarter of the way in from
    // the outer edge of the band `t` is 0.25 and the cubic reads 0.15625; a
    // linear ramp would read 0.25 here and a Hermite quintic 0.103515625.
    expect(edgeCoverage(0.25, 1)).toBe(0.15625);
    expect(edgeCoverage(-0.25, 1)).toBe(0.84375);
    expect(edgeCoverage(0.5, 1)).toBe(0);
    expect(edgeCoverage(-0.5, 1)).toBe(1);
    // Scaling the band scales the distance with it and nothing else.
    expect(edgeCoverage(0.5, 2)).toBe(0.15625);
    expect(edgeCoverage(0.025, 0.1)).toBe(0.15625);
  });

  it('never increases as the distance grows', () => {
    const random = mulberry32(SEED + 6);
    for (let run = 0; run < RUNS; run += 1) {
      const filterWidth = 10 ** (random() * 4 - 2);
      const a = (random() * 2 - 1) * filterWidth;
      const b = a + random() * filterWidth;
      expect(edgeCoverage(b, filterWidth)).toBeLessThanOrEqual(edgeCoverage(a, filterWidth));
    }
  });

  it('sums to one across the boundary, so the ramp is centred on it', () => {
    // The band has to straddle the boundary rather than sit to one side of it,
    // or every shape draws half a filter width too fat or too thin, which at a
    // small enough size is the difference between a visible node and no node.
    const random = mulberry32(SEED + 7);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const filterWidth = 10 ** (random() * 4 - 2);
      const distance = (random() * 2 - 1) * filterWidth;
      const sum = edgeCoverage(distance, filterWidth) + edgeCoverage(-distance, filterWidth);
      worst = Math.max(worst, Math.abs(sum - 1));
    }
    // Measured worst case: 2.220e-16, one ulp of 1.
    expect(worst).toBeLessThan(1e-15);
  });

  it('stays inside zero and one for every distance and band width', () => {
    const random = mulberry32(SEED + 8);
    for (let run = 0; run < RUNS; run += 1) {
      const filterWidth = 10 ** (random() * 8 - 4);
      const distance = (random() * 2 - 1) * 10 ** (random() * 8 - 4);
      const coverage = edgeCoverage(distance, filterWidth);
      expect(coverage).toBeGreaterThanOrEqual(0);
      expect(coverage).toBeLessThanOrEqual(1);
    }
  });

  it('degenerates to a hard step at a filter width of zero, with no NaN', () => {
    // A zero band is a division by zero away from painting every pixel `NaN`,
    // which composites as nothing at all: the shape simply does not appear, and
    // there is no error anywhere to say why. The half at the boundary is the
    // Heaviside convention, and it is what makes this the limit of the smooth
    // case at EVERY distance rather than at every distance but one.
    expect(edgeCoverage(-1, 0)).toBe(1);
    expect(edgeCoverage(-1e-12, 0)).toBe(1);
    expect(edgeCoverage(0, 0)).toBe(0.5);
    expect(edgeCoverage(1e-12, 0)).toBe(0);
    expect(edgeCoverage(1, 0)).toBe(0);
    for (const distance of [-1, -1e-12, 0, 1e-12, 1]) {
      expect(Number.isNaN(edgeCoverage(distance, 0))).toBe(false);
    }
    // And it is that limit: shrinking the band converges on the step.
    expect(edgeCoverage(-1e-3, 1e-9)).toBe(1);
    expect(edgeCoverage(1e-3, 1e-9)).toBe(0);
  });

  it('handles an infinite distance without a NaN', () => {
    // `roundedRectDistance` overflows to infinity for a far enough point, and a
    // fully transparent fragment is the right answer for one.
    expect(edgeCoverage(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(edgeCoverage(Number.NEGATIVE_INFINITY, 1)).toBe(1);
  });

  it('rejects a negative or non-finite filter width, naming the field', () => {
    for (const filterWidth of [-1, -1e-12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => edgeCoverage(0, filterWidth)).toThrow(RangeError);
      expect(() => edgeCoverage(0, filterWidth)).toThrow(/filterWidth/);
    }
  });
});

describe('glowIntensity', () => {
  it('is one at the boundary and everywhere inside', () => {
    // The glow is the falloff OUTSIDE the shape. Inside it is saturated, and
    // whatever draws the fill draws over it.
    expect(glowIntensity(0, 4)).toBe(1);
    expect(glowIntensity(-0.5, 4)).toBe(1);
    expect(glowIntensity(-1e9, 4)).toBe(1);
    expect(glowIntensity(Number.NEGATIVE_INFINITY, 4)).toBe(1);
  });

  it('falls to exactly zero at the glow radius and stays there', () => {
    // Exactly zero, and this is the load-bearing half of `shapeQuadSize`: the
    // quad reserves the glow radius and then only the antialiasing pad, which
    // is a fraction of the shape rather than more glow, so anything but zero
    // here is a straight cut across a glow.
    expect(glowIntensity(4, 4)).toBe(0);
    expect(glowIntensity(4.000001, 4)).toBe(0);
    expect(glowIntensity(1e9, 4)).toBe(0);
    expect(glowIntensity(Number.POSITIVE_INFINITY, 4)).toBe(0);
  });

  it('is the quadratic falloff in between', () => {
    // `(1 - d / glowRadius) ** 2`, pinned by value. Halfway out the glow is at
    // a quarter strength, not a half: a linear ramp would read 0.5 here.
    expect(glowIntensity(2, 4)).toBe(0.25);
    expect(glowIntensity(1, 4)).toBe(0.5625);
    expect(glowIntensity(3, 4)).toBe(0.0625);
    // Scale invariant in the radius, as a falloff shape should be.
    expect(glowIntensity(0.5, 1)).toBe(0.25);
    expect(glowIntensity(50, 100)).toBe(0.25);
  });

  it('never increases as the distance grows', () => {
    const random = mulberry32(SEED + 9);
    for (let run = 0; run < RUNS; run += 1) {
      const glowRadius = 10 ** (random() * 4 - 2);
      const a = (random() * 2 - 1) * glowRadius * 1.5;
      const b = a + random() * glowRadius;
      expect(glowIntensity(b, glowRadius)).toBeLessThanOrEqual(glowIntensity(a, glowRadius));
    }
  });

  it('meets zero with zero slope, so the quad edge leaves no seam', () => {
    // Why quadratic rather than linear, as a measurement. A linear ramp reaches
    // zero at the quad edge with a slope of `-1 / glowRadius`, and the eye
    // reads a discontinuity in the GRADIENT as an edge just as readily as one
    // in the value: the glow would end in a faint visible outline exactly where
    // the geometry stops. The quadratic's value falls off like the square of
    // the remaining distance, so both the value and the slope arrive at zero.
    const glowRadius = 1;
    for (const step of [1e-2, 1e-3, 1e-4]) {
      const value = glowIntensity(glowRadius - step, glowRadius);
      // Quadratic to within a part in a thousand: a linear ramp would sit at
      // `step` here, which is larger by a factor of one over `step`.
      expect(value / (step * step)).toBeCloseTo(1, 9);
    }
  });

  it('stays inside zero and one for every distance and radius', () => {
    const random = mulberry32(SEED + 10);
    for (let run = 0; run < RUNS; run += 1) {
      const glowRadius = 10 ** (random() * 8 - 4);
      const distance = (random() * 2 - 1) * 10 ** (random() * 8 - 4);
      const intensity = glowIntensity(distance, glowRadius);
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });

  it('does not divide by zero at a glow radius of zero', () => {
    // No glow at all is the common case, and it must not be the case that
    // produces `NaN` for every fragment of every shape in the scene.
    expect(glowIntensity(-1, 0)).toBe(1);
    expect(glowIntensity(0, 0)).toBe(1);
    expect(glowIntensity(1e-12, 0)).toBe(0);
    expect(glowIntensity(1, 0)).toBe(0);
    for (const distance of [-1, 0, 1e-12, 1]) {
      expect(Number.isNaN(glowIntensity(distance, 0))).toBe(false);
    }
  });

  it('rejects a negative or non-finite glow radius, naming the field', () => {
    for (const glowRadius of [-1, -1e-12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => glowIntensity(0, glowRadius)).toThrow(RangeError);
      expect(() => glowIntensity(0, glowRadius)).toThrow(/glowRadius/);
    }
  });
});

describe('shapeQuadSize', () => {
  /** The antialiasing pad a shape of this size gets on every side. */
  function aaPad(size: { width: number; height: number }): number {
    return (AA_QUAD_PADDING_FRACTION * Math.max(size.width, size.height)) / 2;
  }

  it('pads a shape with no outline and no glow, so its own ramp has room', () => {
    // The margin is never zero for a shape with any size, because the
    // antialiasing ramp reaches past the boundary on every edge and a quad cut
    // exactly at the boundary clips its outer half. 1.5% of the larger half
    // extent, which is 1.5 units on a shape 100 half extents across.
    expect(shapeQuadSize({ width: 200, height: 100 }, 0, 0)).toEqual({
      width: 203,
      height: 103,
    });
  });

  it('returns full width and height, not half extents', () => {
    // What `PlaneGeometry` takes. Half extents here would draw every shape at a
    // quarter of its area, which is a bug that looks like a layout bug.
    const quad = shapeQuadSize({ width: 200, height: 100 }, 4, 0);
    expect(quad.width).toBe(207);
    expect(quad.height).toBe(107);
    expect(quad.width).toBeGreaterThan(100);
  });

  it('adds half the outline width on every side', () => {
    // The outline straddles the boundary, so only its outer half needs room:
    // 4 units of outline is 2 units past the edge, 4 units on the full width,
    // on top of the 0.75 of antialiasing pad this size gets on every side.
    expect(shapeQuadSize({ width: 100, height: 50 }, 4, 0)).toEqual({
      width: 105.5,
      height: 55.5,
    });
    expect(shapeQuadSize({ width: 100, height: 50 }, 1, 0)).toEqual({
      width: 102.5,
      height: 52.5,
    });
  });

  it('adds the whole glow radius on every side', () => {
    // The glow starts at the boundary and reaches out, so it needs all of it:
    // 6 units of glow is 12 units on the full width, plus the pad.
    expect(shapeQuadSize({ width: 100, height: 50 }, 0, 6)).toEqual({
      width: 113.5,
      height: 63.5,
    });
  });

  it('takes the larger of the two reaches rather than their sum', () => {
    // Both `edgeCoverage` and `glowIntensity` read the SAME signed distance, so
    // both reaches are measured from the same boundary and the painted region
    // extends to whichever is further, not to both added together. Summing
    // would inflate every quad in the scene, and M4.4's culling bounds with it.
    // The antialiasing pad is the one term that IS added, because it is not a
    // reach of the same field: it is room for a ramp centred on the boundary.
    expect(shapeQuadSize({ width: 100, height: 50 }, 4, 6)).toEqual({
      width: 113.5,
      height: 63.5,
    });
    expect(shapeQuadSize({ width: 100, height: 50 }, 20, 6)).toEqual({
      width: 121.5,
      height: 71.5,
    });
    // Equal reaches: 8 units of outline reaches 4 out, the same as this glow.
    expect(shapeQuadSize({ width: 100, height: 50 }, 8, 4)).toEqual({
      width: 109.5,
      height: 59.5,
    });
  });

  it('pads by 1.5% of the larger half extent, on both axes', () => {
    expect(AA_QUAD_PADDING_FRACTION).toBe(0.015);
    // The LARGER half extent drives both axes. The ramp is one screen pixel
    // wide on every edge whichever way the edge runs, so a per-axis pad would
    // under-pad the short axis of a wide flat node, which is exactly the shape
    // whose long edges show the clipping first.
    expect(shapeQuadSize({ width: 200, height: 10 }, 0, 0)).toEqual({ width: 203, height: 13 });
    expect(shapeQuadSize({ width: 10, height: 200 }, 0, 0)).toEqual({ width: 13, height: 203 });
  });

  it('covers the outer half of a one-pixel ramp above about 33 CSS pixels', () => {
    // The arithmetic the docstring states, as a measurement. The ramp is one
    // screen pixel wide and centred on the boundary, so it reaches `0.5 / zoom`
    // world units past it, and geometry built once cannot know the zoom. A
    // proportional pad is scale invariant instead: measured in pixels it is
    // `f * halfExtentPx`, so it covers the ramp's outer half exactly when the
    // shape's larger half extent on screen reaches `0.5 / f` pixels.
    const thresholdPx = 0.5 / AA_QUAD_PADDING_FRACTION;
    expect(thresholdPx).toBeCloseTo(33.33, 2);

    for (const zoom of [0.1, 1, 100]) {
      // A shape whose larger half extent measures exactly the threshold on
      // screen, at this zoom. World units, since that is what a quad is in.
      const halfExtent = thresholdPx / zoom;
      const size = { width: 2 * halfExtent, height: halfExtent };
      const quad = shapeQuadSize(size, 0, 0);
      const pad = (quad.width - size.width) / 2;
      // Exactly the half ramp width, at every zoom: that is what scale
      // invariant means here, and it is why one constant serves 0.1x and 100x.
      expect(pad).toBeCloseTo(0.5 / zoom, 10);
    }

    // Above the threshold the pad more than covers the ramp, below it does not.
    const above = shapeQuadSize({ width: 2 * (2 * thresholdPx), height: 1 }, 0, 0);
    expect((above.width - 2 * (2 * thresholdPx)) / 2).toBeGreaterThan(0.5);
    const below = shapeQuadSize({ width: 2 * (thresholdPx / 2), height: 1 }, 0, 0);
    expect((below.width - 2 * (thresholdPx / 2)) / 2).toBeLessThan(0.5);
  });

  it('covers everything the shader paints, plus the pad and no more', () => {
    // The load-bearing test in this file, and the one that would have caught
    // the bug the docstring used to warn about. Walk a grid over and around the
    // quad, ask the same two functions the shader asks whether this point is
    // painted, and check that no painted point falls outside the quad. Then
    // check the other direction: the gap between the last painted point and the
    // quad's edge is the antialiasing pad, within one grid step, so the quad is
    // not merely large enough but as tight as the pad allows.
    const step = 0.03125;
    const cases = [
      { size: { width: 4, height: 2 }, radius: 0.5, outlineWidth: 0, glowRadius: 0 },
      { size: { width: 4, height: 2 }, radius: 0.5, outlineWidth: 1, glowRadius: 0 },
      { size: { width: 4, height: 2 }, radius: 0.5, outlineWidth: 0, glowRadius: 0.75 },
      { size: { width: 4, height: 2 }, radius: 0.5, outlineWidth: 1, glowRadius: 0.75 },
      { size: { width: 4, height: 2 }, radius: 0.5, outlineWidth: 3, glowRadius: 0.75 },
      { size: { width: 2, height: 2 }, radius: 1, outlineWidth: 0.5, glowRadius: 1.5 },
      { size: { width: 0, height: 0 }, radius: 0, outlineWidth: 0.5, glowRadius: 1 },
    ];

    for (const { size, radius, outlineWidth, glowRadius } of cases) {
      const quad = shapeQuadSize(size, outlineWidth, glowRadius);
      const axisX = binaryGrid(quad.width / 2 + 1, step);
      const axisY = binaryGrid(quad.height / 2 + 1, step);
      let reachX = 0;
      let reachY = 0;
      let painted = 0;

      for (const px of axisX) {
        for (const py of axisY) {
          const distance = roundedRectDistance(px, py, size.width / 2, size.height / 2, radius);
          // Exactly what the shader paints: the fill and the outline out to
          // half the outline width, and the glow while it is still non-zero.
          const isPainted = distance <= outlineWidth / 2 || glowIntensity(distance, glowRadius) > 0;
          if (!isPainted) continue;
          painted += 1;
          reachX = Math.max(reachX, Math.abs(px));
          reachY = Math.max(reachY, Math.abs(py));
          expect(Math.abs(px)).toBeLessThanOrEqual(quad.width / 2);
          expect(Math.abs(py)).toBeLessThanOrEqual(quad.height / 2);
        }
      }

      expect(painted).toBeGreaterThan(0);
      // The pad, and no more than the pad plus one grid step. The glow reaches
      // zero exactly at its own radius, so the last painted point sits at the
      // painted reach and the quad's edge is the pad beyond it.
      const pad = aaPad(size);
      expect(quad.width / 2 - reachX).toBeGreaterThanOrEqual(pad - 1e-9);
      expect(quad.height / 2 - reachY).toBeGreaterThanOrEqual(pad - 1e-9);
      expect(quad.width / 2 - reachX).toBeLessThanOrEqual(pad + step);
      expect(quad.height / 2 - reachY).toBeLessThanOrEqual(pad + step);
    }
  });

  it('accepts a zero-sized shape', () => {
    // Legal, and it must not throw: a node whose label has not measured yet is
    // zero-sized for one frame, and a renderer that threw on that would take
    // the whole scene down over a shape nobody can see anyway. A zero-sized
    // shape gets no antialiasing pad either, since a proportional pad of
    // nothing is nothing, and there is no edge to ramp across.
    expect(shapeQuadSize({ width: 0, height: 0 }, 0, 0)).toEqual({ width: 0, height: 0 });
    expect(shapeQuadSize({ width: 0, height: 0 }, 2, 3)).toEqual({ width: 6, height: 6 });
  });

  it('rejects a negative or non-finite input, naming the field', () => {
    const size = { width: 10, height: 5 };
    expect(() => shapeQuadSize({ width: -1, height: 5 }, 0, 0)).toThrow(/size\.width/);
    expect(() => shapeQuadSize({ width: 10, height: -1 }, 0, 0)).toThrow(/size\.height/);
    expect(() => shapeQuadSize({ width: Number.NaN, height: 5 }, 0, 0)).toThrow(/size\.width/);
    expect(() => shapeQuadSize({ width: 10, height: Number.POSITIVE_INFINITY }, 0, 0)).toThrow(
      /size\.height/,
    );
    expect(() => shapeQuadSize(size, -1, 0)).toThrow(/outlineWidth/);
    expect(() => shapeQuadSize(size, Number.NaN, 0)).toThrow(/outlineWidth/);
    expect(() => shapeQuadSize(size, 0, -1)).toThrow(/glowRadius/);
    expect(() => shapeQuadSize(size, 0, Number.POSITIVE_INFINITY)).toThrow(/glowRadius/);
    expect(() => shapeQuadSize(size, -1, 0)).toThrow(RangeError);
  });
});
