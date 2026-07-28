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

  it('is exactly a circle on a square whose radius is half its side', () => {
    // Not approximately, and not only at the boundary. On a square with
    // `radius === halfWidth === halfHeight` the `min` term is identically zero
    // and the euclidean term is `sqrt(px*px + py*py)`, so the two formulas
    // reduce to the same expression and agree bit for bit. That is why the scene
    // is allowed to draw circles with the cheaper `circleSDF` without the two
    // families disagreeing about where their edges are.
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * 2 * Math.PI;
      for (const r of [0, 3, 20, 47.5]) {
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        expect(roundedRectDistance(numberArith, px, py, 20, 20, 20)).toBe(
          circleDistance(numberArith, px, py, 20),
        );
      }
    }
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

  it('is exact on the outer side of the band and within 3e-30 on the inner side', () => {
    // The one asymmetry in the construction, measured rather than left for
    // somebody to trip over. `max(d, -(d + widthPixels * aaWidth))` returns `d`
    // UNROUNDED in the outer branch, so every claim about the outer edge is exact
    // at every aaWidth. The inner branch has to compute `widthPixels * aaWidth`
    // and negate a sum, so for an aaWidth that is not a dyadic rational the inner
    // cutoff lands a few ulps short of where it should and leaves a residue
    // instead of a zero. The worst measured across these widths and aaWidths is
    // 2.8e-30: thirty orders of magnitude under the 1/255 an 8 bit framebuffer
    // can represent, so it is not a pixel anybody can see, but it is the reason
    // the test above can say `toBe(0)` about the outer side and this one cannot
    // say it about the inner side.
    for (const widthPixels of [1, 2, 3, 4, 7, 11]) {
      for (const aaWidth of [1e-3, 0.01, 1 / 7, 1 / 3, 0.123, 1, 3.7, 10, 250]) {
        const innerCutoff = outlineCoverage(
          numberArith,
          -(widthPixels + 0.5) * aaWidth,
          widthPixels,
          aaWidth,
        );
        expect(innerCutoff).toBeLessThan(3e-30);
        // Well past the ramp it is a hard zero again, whatever the rounding did.
        expect(outlineCoverage(numberArith, -(widthPixels + 4) * aaWidth, widthPixels, aaWidth)).toBe(
          0,
        );
      }
    }
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
  const zooms = [0.1, 0.5, 1, 7, 100, 1000] as const;

  it('gives an identical fill coverage at k pixels from the boundary at every zoom', () => {
    // Dyadic `k`, and exact equality. Both are deliberate: for `k` a dyadic
    // rational the numerator and the denominator of the ramp parameter are exact
    // scalings of `aaWidth` by powers of two, so the result is bit identical
    // rather than merely close, and asserting `toBe` is a stronger statement
    // than any tolerance.
    for (const k of [-2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2]) {
      const expected = fillCoverage(numberArith, k, 1);
      for (const zoom of zooms) {
        const aaWidth = 1 / zoom;
        expect(fillCoverage(numberArith, k * aaWidth, aaWidth)).toBe(expected);
      }
    }
  });

  it('gives an identical one and two pixel outline coverage at every zoom', () => {
    // Bit identical, and `toBe` rather than a tolerance for the same reason the
    // fill's version above gets one: the band distance is
    // `max(d, -(d + widthPixels * aaWidth))`, which is a pure function of
    // `d / aaWidth` and `widthPixels` and introduces no arithmetic of its own in
    // the outer branch, where it returns `d` untouched. Both widths are asserted
    // because a spelling that got the same ramp from `abs(d + half) - half` is
    // exact for width 1 by accident (its subtrahend is identically zero there)
    // and 1.4e-16 off for width 2.
    for (const widthPixels of [1, 2]) {
      for (const k of [-2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2]) {
        const expected = outlineCoverage(numberArith, k, widthPixels, 1);
        for (const zoom of zooms) {
          const aaWidth = 1 / zoom;
          expect(outlineCoverage(numberArith, k * aaWidth, widthPixels, aaWidth)).toBe(expected);
        }
      }
    }
  });

  it('is invariant to within 1.2e-16 for a k that is not a dyadic rational', () => {
    // The honest version of the claim for arbitrary `k`. The worst deviation
    // seen across these zooms and these `k` is 1.2e-16, against an asserted
    // bound of 1e-15. Both are far below the 1/255 an 8 bit framebuffer can
    // represent, so "identical" is true of every pixel that can be drawn, and
    // "bit identical" is only true of the dyadic case above.
    for (const k of [1 / 3, 0.3, -0.7, 0.123456]) {
      const expected = fillCoverage(numberArith, k, 1);
      for (const zoom of [...zooms, 0.3, 123.456]) {
        const aaWidth = 1 / zoom;
        expect(fillCoverage(numberArith, k * aaWidth, aaWidth)).toBeCloseTo(expected, 15);
      }
    }
  });

  it('keeps a 2 pixel outline exactly 2 pixels wide across a 10000:1 zoom range', () => {
    // The same claim read as geometry rather than as coverage, and read on the
    // pixel grid: the two pixels the band covers are fully covered and its inner
    // 50% point is at 2 pixels in, whatever a pixel is worth in world units.
    for (const zoom of zooms) {
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

  it('has an unclipped fill ramp at and above the crossover zoom, clipped below', () => {
    const halfRamp = (zoom: number): number => 1 / (2 * zoom);
    expect(halfRamp(FILL_AA_CROSSOVER_ZOOM)).toBe(FILL_AA_PADDING_WORLD);
    expect(halfRamp(FILL_AA_CROSSOVER_ZOOM * 1.0001)).toBeLessThan(FILL_AA_PADDING_WORLD);
    expect(halfRamp(0.1)).toBeGreaterThan(FILL_AA_PADDING_WORLD);
    expect(halfRamp(100)).toBeLessThan(FILL_AA_PADDING_WORLD);
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
