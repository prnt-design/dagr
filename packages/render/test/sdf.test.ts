import { describe, expect, it } from 'vitest';
import {
  FILL_AA_CROSSOVER_ZOOM,
  FILL_AA_PADDING_WORLD,
  circleDistance,
  fillCoverage,
  glowCoverage,
  numberArith,
  outlineCoverage,
  quadPadding,
  requireCornerRadius,
  requireShapeStyle,
  roundedRectDistance,
  shapeAlpha,
  shapeQuadSize,
  smoothstepBetween,
} from '../src/sdf.js';
import type { ShapeStyle } from '../src/sdf.js';

/**
 * The whole of M4.2's arithmetic, executed.
 *
 * This suite is not a scalar re-implementation of the shader checked against a
 * second copy of the same formulas. There is only ONE copy of each formula:
 * `sdf.ts` writes it over {@link Arith}, `sdf-nodes.ts` supplies the TSL
 * implementation of the nine primitives, and this file supplies numbers through
 * `numberArith`. So every expression tree asserted below is the expression tree
 * the fragment shader evaluates, node for node, and the only thing between the
 * two is nine one-line adapters (`test/sdf-nodes.test.ts` covers that they
 * exist and build).
 *
 * What that does NOT cover, stated plainly: the two backends agree on finite
 * values and are free to disagree about `NaN`, about signed zero and about
 * denormals, since WGSL leaves `min(NaN, x)` implementation defined where
 * `Math.min` returns `NaN`. Nothing below asserts anything about a non-finite
 * input reaching a coverage function, and nothing should: the inputs that could
 * produce one are validated at the scene boundary instead. See
 * {@link requireShapeStyle}.
 */

/** A 100 by 40 rounded rect with a 4 unit corner radius, as half extents. */
const rect = { halfWidth: 50, halfHeight: 20, radius: 4 } as const;

/** `roundedRectDistance` on {@link rect}, so the tests below read as geometry. */
function rectAt(px: number, py: number, radius: number = rect.radius): number {
  return roundedRectDistance(numberArith, px, py, rect.halfWidth, rect.halfHeight, radius);
}

/** A style with every field distinct, so a test cannot pass by reading the wrong one. */
const style: ShapeStyle = {
  fillColor: 0xffb703,
  outlineColor: 0xfff3d0,
  glowColor: 0xff7a00,
  glowAlpha: 0.4,
  outlinePixels: 2,
  glowWorld: 6,
};

describe('numberArith', () => {
  it('is the nine primitives and nothing else', () => {
    // The size of the untested surface is the point of the whole design: every
    // formula in this package is written once over these nine, so a tenth
    // primitive is a tenth line of shader code no Node test can reach.
    expect(Object.keys(numberArith).sort()).toEqual([
      'abs',
      'add',
      'div',
      'literal',
      'max',
      'min',
      'mul',
      'sqrt',
      'sub',
    ]);
  });

  it('divides towards infinity rather than throwing, as a shader would', () => {
    // Worth pinning because it is the one primitive whose scalar behaviour a
    // reader might expect to throw. WGSL's `/` by zero is not a trap either, so
    // the backends agree here, and the formulas above are written so that no
    // denominator can be zero for a validated style: see `smoothstepBetween`.
    expect(numberArith.div(1, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('takes the square root of zero without a sign surprise', () => {
    // `Math.sqrt(-0)` is `-0`, which compares equal to `0` and is therefore
    // invisible to every assertion in this file. Recorded rather than asserted
    // as a difference, because the euclidean term it feeds is a sum of squares
    // and cannot be negative.
    expect(numberArith.sqrt(0)).toBe(0);
  });
});

describe('roundedRectDistance', () => {
  it('is zero on the midpoint of each of the four edges', () => {
    expect(rectAt(50, 0)).toBe(0);
    expect(rectAt(-50, 0)).toBe(0);
    expect(rectAt(0, 20)).toBe(0);
    expect(rectAt(0, -20)).toBe(0);
  });

  it('is zero on the corner arc, at 45 degrees round it', () => {
    // The arc centre of the top-right corner is at (46, 16), inset by the
    // radius on both axes, so a point 4 units from it at 45 degrees is on the
    // boundary. This is the assertion that fails if the `min` term or the
    // `- radius` at the end is dropped.
    const offset = rect.radius / Math.SQRT2;
    expect(rectAt(46 + offset, 16 + offset)).toBeCloseTo(0, 12);
  });

  it('is minus the inradius at the centre', () => {
    // Negative inside is the sign convention, and the inradius is the exact
    // value it has to take at the centre: the nearest boundary point of a 100 by
    // 40 box is 20 units away, whatever the corner radius does.
    expect(rectAt(0, 0)).toBe(-rect.halfHeight);
  });

  it('is the true euclidean distance at a point diagonally outside a corner', () => {
    // 10 units from the corner's arc centre, so 6 from the arc itself. The whole
    // reason to use this SDF rather than a box distance is that this number is
    // exact rather than an L1 or L-infinity approximation, and 6 is the only
    // value a euclidean field can give here.
    expect(rectAt(46 + 8, 16 + 6)).toBeCloseTo(6, 12);
  });

  it('degenerates to a box SDF at radius zero', () => {
    // 3 out past the right edge and 4 out past the top, so 5 from the corner.
    expect(rectAt(53, 24, 0)).toBeCloseTo(5, 12);
    expect(rectAt(53, 0, 0)).toBeCloseTo(3, 12);
    expect(rectAt(0, 0, 0)).toBe(-rect.halfHeight);
  });

  it('is a stadium when the radius is half the smaller dimension', () => {
    // The flat middle of a stadium is a straight segment 60 units long, so the
    // distance is minus the half height everywhere along it, and the ends are
    // semicircles of radius 20 centred at (+/-30, 0).
    const half = rect.halfHeight;
    expect(rectAt(0, 0, half)).toBe(-half);
    expect(rectAt(30, 0, half)).toBe(-half);
    expect(rectAt(50, 0, half)).toBeCloseTo(0, 12);
    expect(rectAt(30 + half / Math.SQRT2, half / Math.SQRT2, half)).toBeCloseTo(0, 12);
  });

  it('is a circle to within two ulps on a square whose radius is half its side', () => {
    // This test asserted bit-for-bit equality with `toBe` until the claim was
    // measured, and passed only because of the four radii and sixteen angles it
    // happened to sample. On a square with `radius === halfWidth === halfHeight`
    // the `min` term IS identically zero, so both formulas are the same euclidean
    // term minus the same radius and the two shape families agree about where
    // their edges are, which is the property the scene relies on when it draws
    // circles with the cheaper `circleSDF`. The arithmetic getting there is not
    // identical: `qx = (|px| - halfWidth) + radius` does not round back to `|px|`
    // when `halfWidth === radius`, so the `sqrt` argument differs in the last bits.
    //
    // Measured over 200k pseudo-random points on this square: 1.9% of them differ,
    // worst absolute difference 7.105e-15, which is two ulps of a distance of 20
    // and thirteen orders of magnitude under the 1/255 a fragment can show. The
    // sweep below is four times as dense as the old one and includes radii 1 and
    // 19, both of which are among the differing cases, so it can afford to be
    // honest about the tolerance rather than sampling around it.
    for (let i = 0; i < 64; i += 1) {
      const angle = (i / 64) * 2 * Math.PI;
      for (const r of [0, 1, 3, 19, 20, 47.5]) {
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        expect(roundedRectDistance(numberArith, px, py, 20, 20, 20)).toBeCloseTo(
          circleDistance(numberArith, px, py, 20),
          12,
        );
      }
    }

    // Two counterexamples, pinned so that the tolerance above keeps its reason
    // attached rather than looking like a hedge. Inside the shape, at (0.1, 0.1),
    // the rect gives -19.858578643762687 and the circle -19.85857864376269.
    expect(roundedRectDistance(numberArith, 0.1, 0.1, 20, 20, 20)).not.toBe(
      circleDistance(numberArith, 0.1, 0.1, 20),
    );

    // And ON the boundary, so the two zero level sets are not identical either:
    // 20 units out at this angle the circle reads exactly 0 and the rect reads
    // -3.55e-15, which is inside rather than on the edge by a distance no
    // rasteriser can sample.
    // The coordinates are hardcoded rather than computed from `Math.cos` and
    // `Math.sin` of `(5 / 17) * 2 * PI`, which is where they came from. ECMAScript
    // leaves the transcendentals implementation defined, so deriving them would pin
    // this counterexample to one libm and `not.toBe(0)` could flip on another
    // platform for a reason that has nothing to do with this file.
    const px = -5.473259801441658;
    const py = 19.23651286345638;
    const onEdge = roundedRectDistance(numberArith, px, py, 20, 20, 20);
    expect(circleDistance(numberArith, px, py, 20)).toBe(0);
    expect(onEdge).not.toBe(0);
    expect(onEdge).toBeCloseTo(0, 12);
  });

  it('never decreases as a point moves away along the x axis', () => {
    // Non-decreasing rather than strictly increasing, and the flat stretch is
    // correct rather than a bug: for `px <= 30` the nearest boundary point of a
    // 100 by 40 box is on the top or bottom edge, so the distance is minus the
    // half height and does not care about x at all. Past x = 30 the right edge is
    // the nearer one and the distance is exactly `px - 50`, across the corner arc
    // and out the other side without a kink.
    let previous = Number.NEGATIVE_INFINITY;
    for (let px = 0; px <= 120; px += 1.5) {
      const d = rectAt(px, 0);
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
    expect(rectAt(0, 0)).toBe(-rect.halfHeight);
    expect(rectAt(30, 0)).toBe(-rect.halfHeight);
    for (const px of [30, 46, 49, 60, 100, 120]) {
      expect(rectAt(px, 0)).toBeCloseTo(px - 50, 12);
    }
  });
});

describe('circleDistance', () => {
  it('is zero on the boundary, minus the radius at the centre', () => {
    expect(circleDistance(numberArith, 0, 0, 20)).toBe(-20);
    expect(circleDistance(numberArith, 20, 0, 20)).toBe(0);
    expect(circleDistance(numberArith, 0, -20, 20)).toBe(0);
  });

  it('is the euclidean distance outside, at a spread of angles', () => {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * 2 * Math.PI;
      const d = circleDistance(numberArith, 35 * Math.cos(angle), 35 * Math.sin(angle), 20);
      expect(d).toBeCloseTo(15, 12);
    }
  });
});

describe('smoothstepBetween', () => {
  it('clamps outside the two edges', () => {
    expect(smoothstepBetween(numberArith, 0, 1, -5)).toBe(0);
    expect(smoothstepBetween(numberArith, 0, 1, 5)).toBe(1);
  });

  it('is a half at the midpoint and symmetric about it', () => {
    expect(smoothstepBetween(numberArith, 0, 1, 0.5)).toBe(0.5);
    for (const t of [0.1, 0.25, 0.4]) {
      const low = smoothstepBetween(numberArith, 0, 1, t);
      const high = smoothstepBetween(numberArith, 0, 1, 1 - t);
      expect(low + high).toBeCloseTo(1, 15);
    }
  });

  it('is the cubic and not the linear ramp', () => {
    // The distinguishing value: a linear ramp gives 0.25 at a quarter of the
    // way, the cubic gives 0.15625. Worth an exact assertion because a linear
    // ramp looks almost right on a screenshot and wrong on a gradient.
    expect(smoothstepBetween(numberArith, 0, 1, 0.25)).toBe(0.15625);
  });

  it('runs the other way when the edges are given the other way round', () => {
    // Relied on by every coverage function below: a descending ramp is spelled
    // as reversed edges rather than as `1 - s(...)`, which saves a subtract per
    // fragment and is the only form in which the clamp is already the right
    // clamp.
    expect(smoothstepBetween(numberArith, 1, 0, -5)).toBe(1);
    expect(smoothstepBetween(numberArith, 1, 0, 5)).toBe(0);
    expect(smoothstepBetween(numberArith, 1, 0, 0.25)).toBe(
      1 - smoothstepBetween(numberArith, 0, 1, 0.25),
    );
  });
});

describe('fillCoverage', () => {
  it('is exactly a half on the boundary', () => {
    // The one value that has to be exact rather than close: it is what makes a
    // shape's apparent edge sit where the geometry says it does, at every zoom
    // and for every aaWidth.
    for (const aaWidth of [1e-3, 0.5, 1, 7, 1e4]) {
      expect(fillCoverage(numberArith, 0, aaWidth)).toBe(0.5);
    }
  });

  it('reaches one and zero exactly half an aaWidth either side', () => {
    expect(fillCoverage(numberArith, -0.5, 1)).toBe(1);
    expect(fillCoverage(numberArith, 0.5, 1)).toBe(0);
  });

  it('is clamped to the unit interval well outside the ramp', () => {
    expect(fillCoverage(numberArith, -1000, 1)).toBe(1);
    expect(fillCoverage(numberArith, 1000, 1)).toBe(0);
  });

  it('falls monotonically across the boundary', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = -1; d <= 1; d += 0.05) {
      const coverage = fillCoverage(numberArith, d, 1);
      expect(coverage).toBeLessThanOrEqual(previous);
      previous = coverage;
    }
  });
});

describe('outlineCoverage', () => {
  it('never covers a pixel more than the fill already does: the footprint is a contract', () => {
    // The claim that makes an outline safe to add to any shape, in the form that
    // is actually true. The outline can never make a pixel MORE covered than the
    // fill alone makes it, so the alpha the shape writes,
    // `max(glowAlpha * glow, max(fill, outline))`, has the same support with and
    // without a border and a hit test built on the fill's geometry cannot miss a
    // pixel the user can see.
    //
    // Asserted with NO tolerance, which is the strongest form available and is
    // available because of how the band distance is spelled. It is
    // `max(d, -(d + widthPixels * aaWidth))`, and `max(d, anything)` is never
    // less than `d` with no arithmetic involved at all: in the outer branch the
    // expression returns `d` itself, unrounded, so the outline's coverage there
    // is not merely close to the fill's but the identical double. Everywhere
    // else it is `max` of `d` and something larger, and `fillCoverage` is
    // decreasing. The worst excess measured over this sweep is exactly 0.
    for (const widthPixels of [0, 1, 2, 4, 11]) {
      for (const aaWidth of [1e-3, 1, 250]) {
        for (let k = -15; k <= 3; k += 0.25) {
          const outline = outlineCoverage(numberArith, k * aaWidth, widthPixels, aaWidth);
          expect(outline).toBeLessThanOrEqual(fillCoverage(numberArith, k * aaWidth, aaWidth));
        }
      }
    }
  });

  it('is exactly the fill coverage on the boundary, so a border does not move the edge', () => {
    // Exactly a half, and exactly what the fill has there. The band's outer ramp
    // IS the fill's ramp: for any `d` at or outside the band's centre line the
    // band distance is `d` itself, so `max(fill, outline)` at the boundary is 0.5
    // whether or not the shape has an outline and whatever width it is.
    for (const aaWidth of [1e-3, 0.5, 1, 7, 1e4]) {
      for (const widthPixels of [0, 1, 2, 4, 11]) {
        expect(outlineCoverage(numberArith, 0, widthPixels, aaWidth)).toBe(
          fillCoverage(numberArith, 0, aaWidth),
        );
        expect(outlineCoverage(numberArith, 0, widthPixels, aaWidth)).toBe(0.5);
      }
    }
  });

  it('is exactly zero at and beyond the end of the fill ramp, at every aaWidth', () => {
    // Half an aaWidth past the boundary, which is where `fillCoverage` itself
    // reaches zero: past there the shape writes no alpha at all, so the outline
    // has nothing to be drawn into and the footprint cannot grow.
    //
    // Exactly zero, and for EVERY aaWidth in the list rather than only the ones
    // whose arithmetic happens to be exact. That is the outer branch returning
    // `d` untouched: `fillCoverage(aaWidth / 2, aaWidth)` clamps its ramp
    // parameter at exactly 0, so there is no residual to tolerate. The awkward
    // aaWidths below (a seventh, a third, 0.123) are in the list deliberately,
    // because a spelling that reached the same cutoff through
    // `(d + half) - half` leaves 1e-29 of coverage there instead of nothing.
    for (const widthPixels of [0.5, 1, 2, 3, 4, 11, 100]) {
      for (const aaWidth of [1e-3, 0.01, 1 / 7, 1 / 3, 0.123, 1, 3.7, 250]) {
        for (const k of [0.5, 1, 5, 1e6]) {
          expect(outlineCoverage(numberArith, k * aaWidth, widthPixels, aaWidth)).toBe(0);
        }
      }
    }
  });

  it('covers both pixel centres of a 2 pixel band, and the one centre of a hairline', () => {
    // The assertions this construction exists for, and the only ones that
    // describe what a user sees. A rasteriser samples coverage at PIXEL CENTRES,
    // which at `aaWidth = 1` sit at `d = -0.5, -1.5, -2.5, ...`; the value of the
    // continuous function between them decides nothing at all.
    //
    // Measured on a real GPU frame before this was fixed: at zoom 100 the two
    // outline pixels down the shape's left edge both came out #bc8932, the amber
    // fill 0xffb703 mixed with the navy outline 0x023047 at half strength,
    // instead of the navy the band was asked for. Both centres landed on exactly
    // 0.5 because the old inset spelling's opaque plateau is
    // `abs(d + w/2) <= w/2 - 1` in pixel units, an EMPTY interval for every band
    // 2 pixels wide or narrower. A 2 pixel outline that never reaches its own
    // colour anywhere is not a 2 pixel outline.
    expect(outlineCoverage(numberArith, -0.5, 2, 1)).toBe(1);
    expect(outlineCoverage(numberArith, -1.5, 2, 1)).toBe(1);
    expect(outlineCoverage(numberArith, -0.5, 1, 1)).toBe(1);
  });

  it('gives a band of w pixels exactly w fully covered pixel centres', () => {
    // The general form of the pixel grid claim, including that the count is not
    // one more: the first centre past the band's inner edge is uncovered.
    for (const widthPixels of [1, 2, 3, 4, 7]) {
      for (let pixel = 0; pixel < widthPixels; pixel += 1) {
        expect(outlineCoverage(numberArith, -(pixel + 0.5), widthPixels, 1)).toBe(1);
      }
      expect(outlineCoverage(numberArith, -(widthPixels + 0.5), widthPixels, 1)).toBe(0);
    }
  });

  it('draws nothing at any pixel centre at width zero, and fades below one pixel', () => {
    // The two claims `ShapeStyle.outlinePixels` makes to callers, asserted rather
    // than left in a docstring. Width 0 turns the outline off at every pixel a
    // rasteriser samples, which is the promise; the continuous function does not
    // vanish, since a zero width band still has two coincident 50% ramps and reads
    // exactly 0.5 ON the boundary, and the reason that is harmless is that no
    // pixel centre ever lands there.
    expect(outlineCoverage(numberArith, 0, 0, 1)).toBe(0.5);
    for (const pixel of [0.5, 1.5, 2.5, 3.5]) {
      expect(outlineCoverage(numberArith, -pixel, 0, 1)).toBe(0);
      expect(outlineCoverage(numberArith, pixel, 0, 1)).toBe(0);
    }
    for (const aaWidth of [1e-3, 1 / 7, 1, 250]) {
      expect(outlineCoverage(numberArith, -aaWidth / 2, 0, aaWidth)).toBe(0);
    }
    // And the fade below one pixel, which is the honest cost of a sub-pixel width:
    // half a pixel covers its single pixel centre at 0.5, a quarter at 0.15625.
    expect(outlineCoverage(numberArith, -0.5, 0.5, 1)).toBe(0.5);
    expect(outlineCoverage(numberArith, -0.5, 0.25, 1)).toBe(0.15625);
    expect(outlineCoverage(numberArith, -1.5, 0.5, 1)).toBe(0);
  });

  it('is a half at the inner edge of the band and zero past the ramp', () => {
    // What "2 pixels wide" means, stated on the inner side: the band's two 50%
    // points are the boundary and 2 pixels in, exactly as a shape's own 50% point
    // is its boundary. The inner ramp is spent half an aaWidth further in, and the
    // band does not bleed towards the middle of the shape after that.
    expect(outlineCoverage(numberArith, -2, 2, 1)).toBe(0.5);
    expect(outlineCoverage(numberArith, -2.5, 2, 1)).toBe(0);
    expect(outlineCoverage(numberArith, -50, 2, 1)).toBe(0);
    expect(outlineCoverage(numberArith, -1, 1, 1)).toBe(0.5);
  });

  it('is exact on the outer side of the band and quadratic in the width on the inner side', () => {
    // The one asymmetry in the construction, measured rather than left for
    // somebody to trip over. `max(d, -(d + widthPixels * aaWidth))` returns `d`
    // UNROUNDED in the outer branch, so every claim about the outer edge is exact
    // at every aaWidth. The inner branch has to compute `widthPixels * aaWidth`
    // and negate a sum, so for an aaWidth that is not a dyadic rational the inner
    // cutoff lands a few ulps short of where it should and leaves a residue
    // instead of a zero.
    //
    // The bound SCALES, which is why it is written as one. The ramp parameter's
    // error is a couple of ulps of `widthPixels * aaWidth` measured against
    // `aaWidth`, so it is of order `widthPixels * 2^-53`, and `smoothstep` squares
    // it: the residue is of order `(widthPixels * 2^-53)^2` and grows
    // QUADRATICALLY in the width. The flat 3e-30 this test used to assert was
    // therefore not a bound at all. It fails at width 7 with `aaWidth = 1.1`,
    // which is zoom 0.91 and squarely inside the range the committed screenshots
    // cover: measured 3.056e-30, and that aaWidth is in the list below now so the
    // counterexample stays tested. The asserted constant is backed by a DERIVED
    // bound rather than by the worst value anybody sampled, which matters because
    // two independent probes of this residue disagreed about its ceiling by an
    // order of magnitude and neither could reproduce the other's figure: the three
    // roundings give a ramp parameter error of at most `2^-53 * (2w + 1)`, so the
    // squared residue is at most `3 * 2^-106 * (2w + 1)^2`, which is about
    // `1.5e-31 * w^2` for large `w` and therefore about 6.8x under what this
    // asserts. Sampled figures for scale rather than as ceilings: 6.24e-32 per
    // `w^2` across this list, 2.08e-31 over a 500k pair sweep with widths in
    // [1, 201].
    //
    // All of it is thirty orders of magnitude under the 1/255 an 8 bit framebuffer
    // can represent, so no pixel anybody can see is affected. It is the reason the
    // test above can say `toBe(0)` about the outer side and this one cannot say it
    // about the inner side.
    for (const widthPixels of [1, 2, 3, 4, 7, 11]) {
      for (const aaWidth of [1e-3, 0.01, 1 / 7, 1 / 3, 0.123, 1, 1.1, 3.7, 10, 250]) {
        const innerCutoff = outlineCoverage(
          numberArith,
          -(widthPixels + 0.5) * aaWidth,
          widthPixels,
          aaWidth,
        );
        expect(innerCutoff).toBeLessThan(1e-30 * widthPixels ** 2);
        // Well past the ramp it is a hard zero again, whatever the rounding did.
        expect(outlineCoverage(numberArith, -(widthPixels + 4) * aaWidth, widthPixels, aaWidth)).toBe(
          0,
        );
      }
    }

    // A SUB-PIXEL band does not follow that law and does not need to: the rounding
    // there is an ulp of `aaWidth` itself rather than of `widthPixels * aaWidth`,
    // so the residue stops shrinking with the width. At width 0.25 it is 2.26e-32,
    // which is larger as a multiple of `widthPixels^2` (3.6e-31) and an order of
    // magnitude SMALLER in absolute terms than any width above, so the width-1
    // bound covers it.
    expect(outlineCoverage(numberArith, -0.75 * 0.01, 0.25, 0.01)).toBeLessThan(1e-30);
  });

  it('scales its band with aaWidth, so its width in pixels is fixed', () => {
    // The reason the width is given in PIXELS. At zoom 100 a 2 pixel outline is
    // 0.02 world units and at zoom 0.1 it is 20, and both draw the same two fully
    // covered pixels with their inner 50% point 2 pixels in.
    for (const aaWidth of [0.01, 1, 10]) {
      expect(outlineCoverage(numberArith, -0.5 * aaWidth, 2, aaWidth)).toBe(1);
      expect(outlineCoverage(numberArith, -1.5 * aaWidth, 2, aaWidth)).toBe(1);
      expect(outlineCoverage(numberArith, -2 * aaWidth, 2, aaWidth)).toBe(0.5);
      expect(outlineCoverage(numberArith, -2.5 * aaWidth, 2, aaWidth)).toBe(0);
    }
  });
});

describe('glowCoverage', () => {
  it('is one on the boundary and one everywhere inside', () => {
    // It sits UNDER the fill, so anything less than one inside would cut a hole
    // in the shape wherever the fill is itself partly transparent.
    expect(glowCoverage(numberArith, 0, 10, 1)).toBe(1);
    expect(glowCoverage(numberArith, -0.001, 10, 1)).toBe(1);
    expect(glowCoverage(numberArith, -1e6, 10, 1)).toBe(1);
  });

  it('is zero at the glow radius and beyond it', () => {
    expect(glowCoverage(numberArith, 10, 10, 1)).toBe(0);
    expect(glowCoverage(numberArith, 10.5, 10, 1)).toBe(0);
    expect(glowCoverage(numberArith, 1e6, 10, 1)).toBe(0);
  });

  it('falls monotonically across the halo, through a half at the midpoint', () => {
    expect(glowCoverage(numberArith, 5, 10, 1)).toBe(0.5);
    let previous = Number.POSITIVE_INFINITY;
    for (let d = -1; d <= 11; d += 0.25) {
      const coverage = glowCoverage(numberArith, d, 10, 1);
      expect(coverage).toBeLessThanOrEqual(previous);
      previous = coverage;
    }
  });

  it('widens a sub-pixel glow radius to one pixel rather than aliasing it', () => {
    // A halo narrower than the sample spacing is a hard step, which is the one
    // thing this whole file exists to avoid. The floor costs a caller who asked
    // for no glow a one pixel halo, which is why the scene expresses "no glow"
    // with the glow colour or its alpha and not with a zero radius.
    expect(glowCoverage(numberArith, 0.5, 0, 1)).toBe(0.5);
    expect(glowCoverage(numberArith, 1, 0.25, 1)).toBe(0);
  });
});

describe('shapeAlpha', () => {
  /**
   * The scene's own glow alpha, which is what the claims below are about. Not
   * `style.glowAlpha` above, deliberately: `shape-scene.ts` draws every shape at
   * 0.45, and the numbers in `shapeAlpha`'s docstring are that shape's numbers.
   */
  const glowAlpha = 0.45;

  /** The three coverages at `d` pixels from the boundary, at one pixel per world unit. */
  function coverages(d: number): { fill: number; outline: number; glow: number } {
    return {
      fill: fillCoverage(numberArith, d, 1),
      outline: outlineCoverage(numberArith, d, style.outlinePixels, 1),
      glow: glowCoverage(numberArith, d, style.glowWorld, 1),
    };
  }

  /** The alpha this package writes, at `d` pixels from the boundary. */
  function alphaAt(d: number): number {
    const { fill, outline, glow } = coverages(d);
    return shapeAlpha(numberArith, glowAlpha, glow, fill, outline);
  }

  /**
   * The `over` chain this function exists not to be: glow under fill under
   * outline, each composited with `a + b * (1 - a)`.
   */
  function overAt(d: number): number {
    const { fill, outline, glow } = coverages(d);
    const overGlow = glowAlpha * glow;
    const overFill = overGlow + fill * (1 - overGlow);
    return overFill + outline * (1 - overFill);
  }

  /** Where a monotone alpha crosses 0.5, by bisection: the shape's APPARENT edge. */
  function halfAlphaContour(alpha: (d: number) => number): number {
    let inside = -1;
    let outside = 8;
    for (let i = 0; i < 80; i += 1) {
      const mid = (inside + outside) / 2;
      if (alpha(mid) > 0.5) inside = mid;
      else outside = mid;
    }
    return (inside + outside) / 2;
  }

  it('is exactly a half on the boundary of a shape with a glow under it', () => {
    // The assertion the whole compositing argument is about, and the one nothing
    // checked before: replacing this function's `max` with the `over` chain it
    // argues against left all 154 tests green. It is exact rather than close
    // because all three inputs are exact there: the fill and the band are both
    // 0.5 on the boundary and the glow is clamped to 1 inside, so the `max` picks
    // 0.5 over the glow's 0.45 with no arithmetic in between.
    const { fill, outline, glow } = coverages(0);
    expect(fill).toBe(0.5);
    expect(outline).toBe(0.5);
    expect(glow).toBe(1);
    expect(alphaAt(0)).toBe(0.5);
  });

  it('is what the over chain would NOT give: the docstring argument, computed', () => {
    // The counterfactual, as arithmetic rather than as prose. `over` of the glow
    // and the fill is 0.725 at the boundary and `over` of all three is 0.8625,
    // both well past the half a shape's edge is supposed to write, so a reader
    // does not have to take the docstring's word for which form inflates a shape.
    const { fill, glow } = coverages(0);
    const overGlow = glowAlpha * glow;
    const overFill = overGlow + fill * (1 - overGlow);
    expect(overFill).toBeCloseTo(0.725, 15);
    expect(overFill).toBeGreaterThan(0.5);
    expect(overAt(0)).toBe(0.8625);
    expect(overAt(0)).toBeGreaterThan(0.5);
  });

  it('leaves the apparent edge on the geometry, where the over chain moves it out', () => {
    // The consequence of the two numbers above, in the unit a reviewer looking at
    // a screenshot cares about: pixels. Following the 0.5 alpha contour, this
    // form puts a shape's apparent edge on its boundary and the over chain puts it
    // 0.3637 pixels outside, so every shape with a glow under it would be drawn
    // about a third of a pixel too big, at every zoom, with the error hidden
    // inside the antialiasing ramp where nothing else would report it.
    expect(halfAlphaContour(alphaAt)).toBeCloseTo(0, 12);
    expect(halfAlphaContour(overAt)).toBeCloseTo(0.3637, 4);
    expect(halfAlphaContour(overAt)).toBeGreaterThan(0.3);
  });

  it('is exactly a half at the boundary for every glow alpha at or below a half', () => {
    // The precondition, stated as a range rather than as one number. Above 0.5 the
    // halo itself sets the floor at the boundary, which is a decision about how
    // strong a glow is (see `shape-scene.ts`, which picks 0.45) and not a
    // compositing bug, so `requireShapeStyle` allows the whole unit interval.
    const { fill, outline, glow } = coverages(0);
    for (const alpha of [0, 0.1, 0.45, 0.5]) {
      expect(shapeAlpha(numberArith, alpha, glow, fill, outline)).toBe(0.5);
    }
    expect(shapeAlpha(numberArith, 0.8, glow, fill, outline)).toBe(0.8);
  });

  it('is the glow alone outside the fill ramp, and the fill alone inside it', () => {
    // Where the two forms agree, which is everywhere the ramps do not overlap:
    // past half a pixel out the fill and the outline are both zero, so the alpha
    // is the halo's and the `over` chain has nothing to add. That is why the
    // inflation above is confined to a one pixel band around the shape.
    for (const d of [0.5, 1, 2, 3, 5.9]) {
      const { glow } = coverages(d);
      expect(alphaAt(d)).toBe(glowAlpha * glow);
      expect(alphaAt(d)).toBe(overAt(d));
    }
    // Well inside, the fill is 1 and nothing can raise it: an alpha above 1 is
    // what the over chain cannot produce here either, and the fill's own clamp is
    // what guarantees it.
    expect(alphaAt(-3)).toBe(1);
  });

  it('never lets the outline or the glow enlarge the shape', () => {
    // The footprint contract as the alpha sees it: `outlineCoverage` is at most
    // `fillCoverage` everywhere (asserted above), and the glow is multiplied by an
    // alpha in the unit interval, so the alpha is the fill's own coverage wherever
    // the fill is the largest of the three and never exceeds 1.
    for (let d = -4; d <= 7; d += 0.125) {
      const { fill, outline, glow } = coverages(d);
      const alpha = shapeAlpha(numberArith, glowAlpha, glow, fill, outline);
      expect(alpha).toBeLessThanOrEqual(1);
      expect(alpha).toBeGreaterThanOrEqual(fill);
      expect(alpha).toBeGreaterThanOrEqual(outline);
    }
  });
});

describe('crisp at every zoom instead of at one', () => {
  /**
   * The headline claim of M4.2, as an executed test.
   *
   * `aaWidth` is one CSS pixel measured in world units, which is `1 / zoom`
   * exactly: the distance field is a true euclidean distance, so the magnitude
   * of its screen-space gradient is world units per pixel and nothing else. Feed
   * a distance of `k` pixels through the coverage functions at any zoom and the
   * answer has to be the same number, because `zoom` cancels. Nothing about the
   * shape's size on screen enters it, which is what distinguishes an SDF from a
   * texture atlas baked at one scale.
   */
  /**
   * The zooms where bit-identity is provable, and it is the ZOOM that has to be a
   * power of two rather than only `k`.
   *
   * Kept as its own list because the reason is easy to get wrong and was: the
   * argument is not "dyadic `k` makes the ramp parameter an exact scaling of
   * `aaWidth` by powers of two", because the numerator is `aaWidth * (k - 0.5)`
   * and `k - 0.5` is not a power of two for most dyadic `k` (`k = -0.25` gives
   * -0.75). Exactness needs `aaWidth = 1 / zoom` to be dyadic TOO, so that every
   * quantity in the ramp is the `zoom = 1` quantity scaled by one exact power of
   * two and the division rounds identically. Do not trim this list towards
   * "realistic" zooms: 1024 is here to be far from 1 while staying dyadic, and
   * 0.25 and 4 are here so that the scaling is exercised in both directions.
   * Counterexample from the other list, measured: at `k = -0.25`, zoom 2.5 gives
   * `aaWidth = 0.4` and the coverage differs by 2.22e-16, which `toBe` would
   * catch.
   */
  const dyadicZooms = [0.25, 0.5, 1, 2, 4, 1024] as const;

  /**
   * Ordinary zooms, none of them a power of two, which is what a mouse wheel
   * actually produces. 0.1 and 1000 are the ends of the 10000:1 range M4.2 claims;
   * 2.5 is in this list rather than in the dyadic one precisely because it is the
   * kind of zoom a user lands on by accident, and it is one of the zooms that
   * makes bit-identity false.
   */
  const zooms = [0.1, 0.3, 2.5, 7, 100, 123.456, 1000] as const;

  /** `k` values that are exact in binary, so only the zoom decides exactness. */
  const dyadicK = [-2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2] as const;

  it('gives a bit-identical fill coverage at k pixels from the boundary at every dyadic zoom', () => {
    // Exact equality, and the precondition is dyadic `k` AND a dyadic `aaWidth`:
    // every quantity in the ramp parameter is then the `zoom = 1` quantity scaled
    // by one exact power of two, so the division rounds to the same double and
    // `toBe` is a stronger statement than any tolerance. The version of this test
    // that ran over the zoom list below passed by luck of sampling: adding 2.5 to
    // it would have failed at `k = -0.25`, which was already in the list.
    for (const k of dyadicK) {
      const expected = fillCoverage(numberArith, k, 1);
      for (const zoom of dyadicZooms) {
        const aaWidth = 1 / zoom;
        expect(fillCoverage(numberArith, k * aaWidth, aaWidth)).toBe(expected);
      }
    }
  });

  it('gives a bit-identical outline coverage at every dyadic zoom, at four widths', () => {
    // Same precondition, and the widths are integers so `widthPixels * aaWidth` is
    // exact too. Widths 1 and 2 are asserted because a spelling that got the same
    // ramp from `abs(d + half) - half` is exact for width 1 by accident (its
    // subtrahend is identically zero there) and 1.4e-16 off for width 2; 3 and 11
    // are here because the inner branch's error grows with the width, so a wide
    // band is where a spelling that was only accidentally exact would show it.
    for (const widthPixels of [1, 2, 3, 11]) {
      for (const k of dyadicK) {
        const expected = outlineCoverage(numberArith, k, widthPixels, 1);
        for (const zoom of dyadicZooms) {
          const aaWidth = 1 / zoom;
          expect(outlineCoverage(numberArith, k * aaWidth, widthPixels, aaWidth)).toBe(expected);
        }
      }
    }
  });

  it('is invariant to within 1.67e-16 when the zoom or k is not dyadic', () => {
    // The honest version for arbitrary zooms, with the two numbers that were wrong
    // corrected. The worst deviation across these `k` and these zooms is
    // 1.6653e-16, at `k = 0.123456` and zoom 2.5 (and again at zoom 1000), not the
    // 1.2e-16 previously claimed. And `toBeCloseTo(expected, 15)` passes below
    // `10^-15 / 2`, so the asserted bound is 5e-16 rather than 1e-15: the real
    // headroom is 3.0x, not the 8x the two numbers together implied.
    //
    // Kept at 15 digits deliberately. Over a 2 million pair random sweep of `k` in
    // [-3.5, 3.5] and zoom in [1e-4, 1e4] the worst fill deviation is 3.331e-16,
    // still inside 5e-16 but only by 1.5x, so 15 digits is a real assertion about
    // this function rather than a formality: a change that cost the ramp one more
    // rounding would trip it. Every one of these numbers is thirteen orders of
    // magnitude under the 1/255 an 8 bit framebuffer can represent, so "identical"
    // is true of every pixel that can be drawn and "bit identical" is true only of
    // the dyadic case above.
    for (const k of [1 / 3, 0.3, -0.7, 0.123456]) {
      const expected = fillCoverage(numberArith, k, 1);
      for (const zoom of zooms) {
        const aaWidth = 1 / zoom;
        expect(fillCoverage(numberArith, k * aaWidth, aaWidth)).toBeCloseTo(expected, 15);
      }
    }
  });

  it('keeps a band invariant to a bound that scales with the band, not with the fill', () => {
    // The outline's own version of the test above, at 14 digits rather than 15, and
    // the loosening is measured rather than defensive. On the OUTER side of the
    // band the expression returns `d` untouched, so the deviation is the fill's own
    // 1.665e-16; on the INNER side it has to compute `widthPixels * aaWidth` and
    // negate a sum, and the error scales with the width: measured on these lists,
    // 2.22e-16 at width 1, 3.33e-16 at width 2, 9.99e-16 at width 3 and 2.665e-15
    // at width 11. The third of those is already past the 5e-16 that 15 digits
    // enforces, which is why the fill's tolerance cannot be reused here, and 14
    // digits (5e-15) leaves 1.9x on the widest band asserted. A 100 pixel band
    // would need looser again, at 2.2e-14: the rule of thumb the sweep supports is
    // about 2.4e-16 per pixel of width.
    for (const widthPixels of [1, 2, 3, 11]) {
      for (const k of [1 / 3, 0.3, -0.7, 0.123456]) {
        // Both sides of the band: `k` alone lands on the outer ramp, and
        // `k - widthPixels` lands on the inner one, which is where the arithmetic
        // is.
        for (const offset of [k, k - widthPixels]) {
          const expected = outlineCoverage(numberArith, offset, widthPixels, 1);
          for (const zoom of zooms) {
            const aaWidth = 1 / zoom;
            expect(
              outlineCoverage(numberArith, offset * aaWidth, widthPixels, aaWidth),
            ).toBeCloseTo(expected, 14);
          }
        }
      }
    }
  });

  it('keeps a 2 pixel outline exactly 2 pixels wide across a 10000:1 zoom range', () => {
    // The same claim read as geometry rather than as coverage, and read on the
    // pixel grid: the two pixels the band covers are fully covered and its inner
    // 50% point is at 2 pixels in, whatever a pixel is worth in world units. Both
    // zoom lists, since this one is exact at every aaWidth: the coverages asserted
    // are the clamped ends of the ramp and its exact midpoint, none of which
    // depends on how `aaWidth` rounds.
    for (const zoom of [...dyadicZooms, ...zooms]) {
      const aaWidth = 1 / zoom;
      expect(outlineCoverage(numberArith, -0.5 * aaWidth, 2, aaWidth)).toBe(1);
      expect(outlineCoverage(numberArith, -1.5 * aaWidth, 2, aaWidth)).toBe(1);
      expect(outlineCoverage(numberArith, -1.999 * aaWidth, 2, aaWidth)).toBeGreaterThan(0.5);
      expect(outlineCoverage(numberArith, -2 * aaWidth, 2, aaWidth)).toBe(0.5);
      expect(outlineCoverage(numberArith, -3 * aaWidth, 2, aaWidth)).toBe(0);
    }
  });
});

describe('quadPadding and shapeQuadSize', () => {
  it('leaves room for the whole glow plus one world unit for the fill ramp', () => {
    expect(quadPadding(style)).toBe(style.glowWorld + FILL_AA_PADDING_WORLD);
    expect(quadPadding(style)).toBe(7);
  });

  it('grows the shape by twice the padding on each axis', () => {
    expect(shapeQuadSize({ width: 100, height: 40 }, style)).toEqual({
      width: 114,
      height: 54,
    });
  });

  it('contains the glow on every side', () => {
    // The quad has to reach at least `glowWorld` past the shape's own edge, or
    // the halo is cut off by a straight line that has nothing to do with the
    // shape. This is the assertion that fails if the padding is applied once
    // instead of twice.
    const size = { width: 100, height: 40 };
    const quad = shapeQuadSize(size, style);
    expect((quad.width - size.width) / 2).toBeGreaterThanOrEqual(style.glowWorld);
    expect((quad.height - size.height) / 2).toBeGreaterThanOrEqual(style.glowWorld);
  });

  it('puts the crossover zoom at 0.5 CSS pixels per world unit', () => {
    // What the one world unit of fill padding buys, as a number. The fill's own
    // ramp reaches half an aaWidth past the boundary, which is `1 / (2 * zoom)`
    // world units, so the padding is exhausted at zoom 0.5 and the outer half of
    // the ramp is clipped by the quad edge below it. A zoom-aware quad is M4.4's
    // problem; M4.2 states the number instead of implying there is not one.
    expect(FILL_AA_CROSSOVER_ZOOM).toBe(0.5);
    expect(1 / (2 * FILL_AA_CROSSOVER_ZOOM)).toBe(FILL_AA_PADDING_WORLD);
  });

  it('clips the fill ramp at the QUAD edge, which a glow puts much further out', () => {
    // What the crossover zoom is, and what it is not. The previous version of this
    // test compared a local `halfRamp` against `FILL_AA_PADDING_WORLD`, which just
    // restates the constant's definition and cannot notice the thing that was
    // wrong: the quad's edge is `quadPadding` out, which is the glow PLUS the fill
    // allowance, so 0.5 is the zoom at which the fill's own unit is spent and NOT
    // the zoom at which anything is clipped. Below is the number that decides
    // whether an edge hardens.
    const halfRamp = (zoom: number): number => 1 / (2 * zoom);
    const clipZoom = (padded: ShapeStyle): number => 1 / (2 * quadPadding(padded));

    // The sample style's 6 unit glow gives 7 units of padding, so its ramp survives
    // to zoom 1/14, seven times further down than the constant suggests.
    expect(quadPadding(style)).toBe(7);
    expect(clipZoom(style)).toBe(1 / 14);
    expect(clipZoom(style)).toBeLessThan(FILL_AA_CROSSOVER_ZOOM);
    expect(FILL_AA_CROSSOVER_ZOOM / clipZoom(style)).toBe(quadPadding(style));

    // The constant describes exactly one style: a glow-free one, which is the
    // worst case and which `shape-scene.ts` never draws.
    expect(clipZoom({ ...style, glowWorld: 0 })).toBe(FILL_AA_CROSSOVER_ZOOM);

    // The ladder's own two extremes, so the numbers in the docstring are asserted
    // rather than asserted about a hypothetical style: a 1 unit glow (the 4 unit
    // tall rung) clips below 0.25, which is ABOVE the 0.1 the committed screenshot
    // is taken at, and a 100 unit glow (the 400 unit rung) survives to 0.00495.
    expect(clipZoom({ ...style, glowWorld: 1 })).toBe(0.25);
    expect(clipZoom({ ...style, glowWorld: 1 })).toBeGreaterThan(0.1);
    expect(clipZoom({ ...style, glowWorld: 10 })).toBeCloseTo(0.0455, 4);
    expect(clipZoom({ ...style, glowWorld: 100 })).toBeCloseTo(0.00495, 5);

    // And the relation the constant does hold: half a ramp at the crossover zoom is
    // exactly the fill's own allowance, which is what makes it a crossover at all.
    expect(halfRamp(FILL_AA_CROSSOVER_ZOOM)).toBe(FILL_AA_PADDING_WORLD);
    expect(halfRamp(clipZoom(style))).toBe(quadPadding(style));
  });

  it('rejects a style whose numbers cannot describe a quad', () => {
    // Validated here rather than inside a coverage function, because this is
    // where a caller's number first does something, and a coverage function is
    // called once per fragment per frame where a throw would be both meaningless
    // and ruinously expensive. See the docstring on `requireShapeStyle`.
    expect(() => quadPadding({ ...style, glowWorld: -1 })).toThrow(RangeError);
    expect(() => quadPadding({ ...style, glowWorld: -1 })).toThrow(/glowWorld/);
    expect(() => quadPadding({ ...style, glowWorld: Number.NaN })).toThrow(RangeError);
    expect(() => shapeQuadSize({ width: 10, height: 4 }, { ...style, glowWorld: -1 })).toThrow(
      RangeError,
    );
  });
});

describe('requireShapeStyle', () => {
  it('accepts the style the scene uses', () => {
    expect(requireShapeStyle(style, 'style')).toEqual(style);
  });

  it('returns a COPY, so a validated style cannot be mutated behind its user', () => {
    // The docstring's copy contract, which `toEqual` above cannot see: it is
    // structural, so `return style` passes it. Measured before this line existed:
    // changing the body to return its argument left all 153 tests green. What the
    // copy buys is that a caller holding the record it passed cannot turn a
    // validated style into an invalid one after the fact, which matters because
    // everything downstream of this function is entitled to skip re-checking.
    expect(requireShapeStyle(style, 'style')).not.toBe(style);
  });

  it('rejects a colour that is not a 24-bit integer, as createRenderer does', () => {
    for (const field of ['fillColor', 'outlineColor', 'glowColor'] as const) {
      for (const bad of [-1, 0x1000000, 1.7, Number.NaN]) {
        expect(() => requireShapeStyle({ ...style, [field]: bad }, 'style')).toThrow(RangeError);
        expect(() => requireShapeStyle({ ...style, [field]: bad }, 'style')).toThrow(
          new RegExp(field),
        );
      }
    }
  });

  it('rejects a glow alpha outside the unit interval', () => {
    expect(() => requireShapeStyle({ ...style, glowAlpha: -0.1 }, 'style')).toThrow(/glowAlpha/);
    expect(() => requireShapeStyle({ ...style, glowAlpha: 1.1 }, 'style')).toThrow(/glowAlpha/);
    expect(requireShapeStyle({ ...style, glowAlpha: 0 }, 'style').glowAlpha).toBe(0);
    expect(requireShapeStyle({ ...style, glowAlpha: 1 }, 'style').glowAlpha).toBe(1);
  });

  it('rejects a negative outline width, which draws nothing or draws it outside', () => {
    expect(() => requireShapeStyle({ ...style, outlinePixels: -2 }, 'style')).toThrow(
      /outlinePixels/,
    );
    expect(requireShapeStyle({ ...style, outlinePixels: 0 }, 'style').outlinePixels).toBe(0);
  });

  it('is worth rejecting because a negative width fails silently, in two different ways', () => {
    // The reason for the check above, pinned rather than asserted in a comment,
    // because both failure modes are invisible on a screenshot review.
    //
    // NOT the footprint: `max(d, y)` is never less than `d` whatever the sign of
    // `widthPixels`, so a negative width cannot enlarge a shape and the footprint
    // contract needs no help from this validation.
    for (const widthPixels of [-0.5, -1, -2]) {
      for (let k = -6; k <= 3; k += 0.125) {
        expect(outlineCoverage(numberArith, k, widthPixels, 1)).toBeLessThanOrEqual(
          fillCoverage(numberArith, k, 1),
        );
      }
    }

    // At or below -1 pixel the band vanishes: the inner branch exceeds the outer
    // end of the ramp everywhere, so the outline is silently not drawn at all and
    // a caller who wrote a sign error sees a shape with no border rather than an
    // error naming the field.
    for (const widthPixels of [-1, -2, -11]) {
      for (let k = -6; k <= 3; k += 0.125) {
        expect(outlineCoverage(numberArith, k, widthPixels, 1)).toBe(0);
      }
    }

    // Between -1 and 0 it is worse than nothing: the band lands OUTSIDE the
    // boundary, painting the outline colour into the fill's own outer
    // antialiasing ramp at up to the fill's alpha there. At width -0.5 the peak is
    // 0.15625 at d = +0.25, which is exactly the fill's coverage at that distance,
    // so the shape's soft edge is tinted with the border colour and its geometry
    // has not moved. Nothing downstream can tell that apart from a design choice.
    expect(outlineCoverage(numberArith, 0.25, -0.5, 1)).toBe(0.15625);
    expect(outlineCoverage(numberArith, 0.25, -0.5, 1)).toBe(fillCoverage(numberArith, 0.25, 1));
    expect(outlineCoverage(numberArith, -0.5, -0.5, 1)).toBe(0);
  });

  it('names the record it was given, so a scene with six shapes says which one', () => {
    expect(() => requireShapeStyle({ ...style, glowWorld: -1 }, 'ladder[3].style')).toThrow(
      /ladder\[3\]\.style\.glowWorld/,
    );
  });
});

describe('requireCornerRadius', () => {
  it('accepts zero and half the smaller dimension', () => {
    const size = { width: 100, height: 40 };
    expect(requireCornerRadius(0, size, 'radius', 'size')).toBe(0);
    expect(requireCornerRadius(20, size, 'radius', 'size')).toBe(20);
  });

  it('rejects a radius past half the smaller dimension', () => {
    // Past this the corner arcs of opposite corners overlap and the formula
    // stops being a distance to anything: the `min` term goes positive at the
    // centre, so the shape reads as inside-out. Rejected at the scene boundary
    // rather than clamped, because a caller who asked for a 30 unit radius on a
    // 40 unit tall box has a bug in the number they wrote, and silently drawing
    // a stadium hides it.
    const size = { width: 100, height: 40 };
    expect(() => requireCornerRadius(20.1, size, 'radius', 'size')).toThrow(RangeError);
    expect(() => requireCornerRadius(20.1, size, 'radius', 'size')).toThrow(/radius/);
    // The limit itself is in the message, because "at most half the smaller
    // dimension" is a rule the caller has to do arithmetic on to apply.
    expect(() => requireCornerRadius(20.1, size, 'radius', 'size')).toThrow(/20/);
  });

  it('rejects a negative or non-finite radius', () => {
    const size = { width: 100, height: 40 };
    expect(() => requireCornerRadius(-1, size, 'radius', 'size')).toThrow(RangeError);
    expect(() => requireCornerRadius(Number.NaN, size, 'radius', 'size')).toThrow(RangeError);
    expect(() => requireCornerRadius(Number.POSITIVE_INFINITY, size, 'radius', 'size')).toThrow(
      RangeError,
    );
  });

  it('rejects a size that is not a positive area, naming the axis and the record', () => {
    // Two field names rather than one, because a descriptor's radius and its size
    // are separate fields a caller wrote separately, and a message naming only
    // the radius would send them to the wrong line.
    expect(() => requireCornerRadius(0, { width: 0, height: 40 }, 'r', 'shape.size')).toThrow(
      /shape\.size\.width/,
    );
    expect(() => requireCornerRadius(0, { width: 100, height: -1 }, 'r', 'shape.size')).toThrow(
      /shape\.size\.height/,
    );
    expect(() =>
      requireCornerRadius(0, { width: Number.NaN, height: 40 }, 'r', 'shape.size'),
    ).toThrow(RangeError);
  });
});
