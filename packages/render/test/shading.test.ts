import { describe, expect, it } from 'vitest';
import { numberOps } from '../src/sdf-ops.js';
import { circleDistance, roundedRectDistance } from '../src/sdf.js';
import type { Rgb, Rgba, ShapeStyle } from '../src/shading.js';
import { MIN_FILTER_WIDTH, coverage, shadeDistance } from '../src/shading.js';

/**
 * The other half of M4.2's coverage. Everything in `shading.ts` reads ONE
 * distance and knows nothing about shapes, which is what makes this file
 * possible: not a single test below constructs a rectangle or a circle.
 *
 * The structural claim of the task, that fill, outline and glow all come off the
 * same distance, is asserted directly at the bottom of this file rather than
 * left to the type signature.
 */

/** mulberry32, a 32-bit seeded PRNG, as in the rest of the suite. */
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

/** `coverage` over plain numbers, spelled shortly. */
function cover(distance: number, filterWidth: number): number {
  return coverage(numberOps, distance, filterWidth);
}

/** `shadeDistance` over plain numbers, spelled shortly. */
function shade(distance: number, filterWidth: number, style: ShapeStyle<number>): Rgba<number> {
  return shadeDistance(numberOps, distance, filterWidth, style);
}

/** A style with every layer switched on, overridable field by field. */
function style(overrides: Partial<ShapeStyle<number>> = {}): ShapeStyle<number> {
  return {
    fill: { r: 0.2, g: 0.4, b: 0.6 },
    fillOpacity: 1,
    outline: { r: 1, g: 0, b: 0 },
    outlineWidth: 2,
    outlineOpacity: 1,
    glow: { r: 0, g: 0, b: 1 },
    glowWidth: 8,
    glowOpacity: 0.5,
    ...overrides,
  };
}

/** Every opacity but one at zero, so the returned alpha IS that layer's alpha. */
function onlyFill(overrides: Partial<ShapeStyle<number>> = {}): ShapeStyle<number> {
  return style({ outlineOpacity: 0, glowOpacity: 0, ...overrides });
}
function onlyOutline(overrides: Partial<ShapeStyle<number>> = {}): ShapeStyle<number> {
  return style({ fillOpacity: 0, glowOpacity: 0, ...overrides });
}
function onlyGlow(overrides: Partial<ShapeStyle<number>> = {}): ShapeStyle<number> {
  return style({ fillOpacity: 0, outlineOpacity: 0, ...overrides });
}

/** A random colour in the unit cube. */
function randomColour(random: () => number): Rgb<number> {
  return { r: random(), g: random(), b: random() };
}

describe('coverage', () => {
  it('is exactly one half on the boundary, at any filter width', () => {
    // Half a pixel is covered when the edge runs through the pixel centre. This
    // is the one value in the file that is fixed by the geometry rather than
    // chosen, and it is the value `smoothstep` also happens to give, which is
    // why getting it right proves nothing on its own: see the linearity test.
    for (const filterWidth of [1e-6, 0.01, 1, 7.5, 1e6]) {
      expect(cover(0, filterWidth)).toBe(0.5);
    }
  });

  it('is the exact covered fraction for a straight edge, which is linear', () => {
    // The reason this is a linear ramp and not a `smoothstep`. For a straight
    // edge crossing a pixel, the covered fraction is the area of the half plane
    // inside the pixel, and that area is linear in the signed distance from the
    // pixel centre to the edge. `smoothstep` would give 0.15625 where the truth
    // is 0.25, so it renders the outer half of every edge too dark and the
    // inner half too light, and the error is largest exactly where a thin
    // outline lives.
    expect(cover(-0.5, 1)).toBe(1);
    expect(cover(-0.25, 1)).toBe(0.75);
    expect(cover(0, 1)).toBe(0.5);
    expect(cover(0.25, 1)).toBe(0.25);
    expect(cover(0.5, 1)).toBe(0);
    // The smoothstep an implementation might reach for instead, at the same
    // point, so the difference is on the record rather than in a comment.
    const t = 0.25;
    expect(t * t * (3 - 2 * t)).toBeCloseTo(0.15625, 12);
  });

  it('is clamped into zero and one and never leaves it', () => {
    const random = mulberry32(SEED);
    for (let run = 0; run < RUNS; run += 1) {
      const filterWidth = 10 ** (random() * 8 - 4);
      const distance = (random() * 2 - 1) * 10 ** (random() * 8 - 4);
      const value = cover(distance, filterWidth);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonically non-increasing in the distance', () => {
    // Non-increasing rather than decreasing, because both clamps are flat. This
    // is what makes the inset outline band non-negative without a clamp of its
    // own: see the outline tests.
    const random = mulberry32(SEED + 1);
    for (let run = 0; run < 2000; run += 1) {
      const filterWidth = 10 ** (random() * 6 - 3);
      let previous = 1;
      for (let step = -30; step <= 30; step += 1) {
        const value = cover((step / 10) * filterWidth, filterWidth);
        expect(value).toBeLessThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('is invariant when the distance and the filter width scale together', () => {
    // Half of the antialiasing argument. The other half is in `sdf.test.ts`:
    // the distance field is homogeneous of degree one, so zooming by `k` scales
    // every distance by `k`, and the filter width is a screen-space derivative
    // so it scales by `k` too. Both scale, this is invariant, and therefore the
    // edge occupies the same fraction of a pixel at every zoom. That is the
    // whole "crisp at every zoom" claim, and it is these two tests.
    const random = mulberry32(SEED + 2);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const distance = (random() * 2 - 1) * 10 ** (random() * 4 - 2);
      const filterWidth = 10 ** (random() * 6 - 4);
      const k = 10 ** (random() * 6 - 3);
      worst = Math.max(worst, Math.abs(cover(distance * k, filterWidth * k) - cover(distance, filterWidth)));
    }
    // Measured worst case: 2.220e-16, one ulp, from the division rounding
    // differently on the scaled operands. The bound asserted is 1e-15.
    expect(worst).toBeLessThan(1e-15);
  });

  it('stays finite and inside zero and one at a zero or negative filter width', () => {
    // The trap the epsilon floor exists for. `0.5 - 0 / 0` is NaN, and a NaN
    // alpha is a transparent or black fragment with nothing thrown anywhere on
    // the way to it. This is not hypothetical: a filter width is `fwidth` of
    // the distance, which is exactly zero wherever the rasteriser's 2 by 2 quad
    // straddles nothing, and at the shape's own centre of symmetry.
    expect(Number.isNaN(0.5 - 0 / 0)).toBe(true);

    for (const filterWidth of [0, -0, -1, -1e30, Number.MIN_VALUE]) {
      for (const distance of [0, -0, 1, -1, 1e-300, 1e30, -1e30]) {
        const value = cover(distance, filterWidth);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('degenerates to a hard step at a zero filter width', () => {
    // What the floor leaves behind, stated so nobody expects a fallback to have
    // invented a width. Below the epsilon the ramp is narrower than any
    // distance a caller can express, so coverage becomes the step function the
    // absence of a filter asks for, with the exact half at the boundary.
    expect(cover(-1e-9, 0)).toBe(1);
    expect(cover(0, 0)).toBe(0.5);
    expect(cover(1e-9, 0)).toBe(0);
    // And the epsilon is genuinely below anything real: it is the width in
    // world units of one pixel at a zoom of 1e12.
    expect(MIN_FILTER_WIDTH).toBe(1e-12);
    expect(cover(1e-13, MIN_FILTER_WIDTH)).toBeCloseTo(0.4, 12);
  });
});

describe('shadeDistance alpha and premultiplication', () => {
  it('keeps alpha inside zero and one over a wide grid of distances and styles', () => {
    const random = mulberry32(SEED + 3);
    for (let run = 0; run < RUNS; run += 1) {
      const shaded = shade((random() * 2 - 1) * 30, 10 ** (random() * 4 - 2), {
        fill: randomColour(random),
        fillOpacity: random(),
        outline: randomColour(random),
        outlineWidth: random() * 10,
        outlineOpacity: random(),
        glow: randomColour(random),
        glowWidth: random() * 20,
        glowOpacity: random(),
      });
      expect(shaded.a).toBeGreaterThanOrEqual(0);
      expect(shaded.a).toBeLessThanOrEqual(1);
      expect(Number.isFinite(shaded.r + shaded.g + shaded.b)).toBe(true);
    }
  });

  it('holds the premultiplication invariant r <= a, g <= a, b <= a', () => {
    // Stated as an invariant because it is exactly the property a compositing
    // bug breaks. A premultiplied colour is a colour already multiplied by its
    // own alpha, so no channel can exceed the alpha unless the colour itself
    // exceeded one. Compose two such layers with `src + dst * (1 - srcAlpha)`
    // and the invariant survives, since both terms are bounded the same way on
    // colour and on alpha. Compose them with a straight-alpha formula, or
    // forget to premultiply one layer, or divide by an alpha that is zero, and
    // this is what goes wrong first, showing up as a bright fringe around a
    // fading shape rather than as an error.
    //
    // Conditional on the colours and opacities being in [0, 1], which is what
    // the signature asks for and what `shadeDistance` deliberately does NOT
    // clamp: see its docstring for where the line is drawn.
    const random = mulberry32(SEED + 4);
    let worst = -1;
    for (let run = 0; run < RUNS; run += 1) {
      const shaded = shade((random() * 2 - 1) * 30, 10 ** (random() * 4 - 2), {
        fill: randomColour(random),
        fillOpacity: random(),
        outline: randomColour(random),
        outlineWidth: random() * 10,
        outlineOpacity: random(),
        glow: randomColour(random),
        glowWidth: random() * 20,
        glowOpacity: random(),
      });
      worst = Math.max(worst, shaded.r - shaded.a, shaded.g - shaded.a, shaded.b - shaded.a);
    }
    // Measured worst overshoot: 0, exactly. Every product involved is a product
    // of numbers in [0, 1], so nothing rounds upward past the alpha.
    expect(worst).toBeLessThanOrEqual(0);
  });
});

describe('shadeDistance boundary cases', () => {
  it('is all zeros far outside the glow', () => {
    // Exactly zero, not nearly: the coverage clamp and the glow ramp both reach
    // their floor rather than approaching it, so a fragment outside every layer
    // contributes nothing at all and a quad drawn much larger than its shape
    // costs only its own fragments.
    expect(shade(50, 0.1, style())).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(shade(8, 0.1, style())).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('is the fill colour at full alpha deep inside the shape', () => {
    const shaded = shade(-100, 0.1, style());
    expect(shaded).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
    // Premultiplied by an alpha of one, so the premultiplied and straight
    // colours coincide here and the test reads the same either way. That is a
    // coincidence of this case, not a general fact.
  });

  it('is the outline colour half way through an opaque outline band', () => {
    const shaded = shade(-1, 0.1, style({ outlineWidth: 2, outlineOpacity: 1 }));
    expect(shaded).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});

describe('shadeDistance outline inset', () => {
  it('puts the outline band inward from the boundary, so the shape does not grow', () => {
    // The decision this test pins: an outline centred on the boundary would
    // make a 100 by 40 node box with a 2 unit outline occupy 101 by 41, and
    // disagree with the layout that placed it by half an outline on every side.
    // Inset means the outer edge of the outline IS the shape's edge.
    const outline = onlyOutline({ outlineWidth: 2, outlineOpacity: 1 });
    const filterWidth = 1e-4;
    // Outside the boundary: nothing.
    expect(shade(0.5, filterWidth, outline).a).toBe(0);
    // Just inside the boundary and just inside the far edge of the band: full.
    expect(shade(-0.001, filterWidth, outline).a).toBeCloseTo(1, 6);
    expect(shade(-1.999, filterWidth, outline).a).toBeCloseTo(1, 6);
    // Past the inner edge of the band: nothing again.
    expect(shade(-2.5, filterWidth, outline).a).toBe(0);
  });

  it('never produces a negative outline alpha, for any width or distance', () => {
    // Why it cannot: `coverage` is non-increasing in its distance argument and
    // the width is floored at zero, so `coverage(d)` is always at least
    // `coverage(d + outlineWidth)` and the difference is at least zero. No
    // clamp is needed on the band itself, and a negative alpha would be worse
    // than an invisible outline: composed with `dst * (1 - srcAlpha)` it
    // amplifies the layer beneath instead of covering it.
    const random = mulberry32(SEED + 5);
    let worst = Number.POSITIVE_INFINITY;
    for (let run = 0; run < RUNS; run += 1) {
      const shaded = shade((random() * 2 - 1) * 100, 10 ** (random() * 8 - 4), {
        ...onlyOutline(),
        outlineWidth: random() < 0.1 ? 0 : 10 ** (random() * 8 - 4),
      });
      worst = Math.min(worst, shaded.a);
    }
    expect(worst).toBe(0);
  });

  it('treats a negative outline width as no outline at all', () => {
    // Not specified by the task, decided here, and for the same reason as the
    // radius clamp in `sdf.ts`: nothing can throw per fragment, and a negative
    // width is the one input that inverts the SIGN of an alpha rather than
    // merely producing an odd looking band. Flooring the width at zero is one
    // `max` and it makes the non-negativity above unconditional.
    for (const outlineWidth of [-0.001, -2, -1e9]) {
      expect(shade(-1, 0.1, onlyOutline({ outlineWidth })).a).toBe(0);
    }
  });

  it('fades a hairline outline toward outlineWidth / filterWidth rather than aliasing', () => {
    // The regression test for the zoomed-far-out case, and the measurement
    // behind the claim in the docstring. Once the outline is thinner than a
    // pixel, the peak alpha the band can reach is EXACTLY `outlineWidth /
    // filterWidth`, not merely close to it: at a distance where both coverage
    // terms are in the linear part of the ramp, their difference is the width
    // over the filter width identically.
    //
    // That is the right answer rather than a lucky one, because that ratio IS
    // the fraction of the pixel the band covers. The alternative, a band that
    // stayed opaque as it thinned, is what produces the crawling dotted line
    // every hairline stroke in a naive renderer shows when you zoom out.
    const filterWidth = 1;
    for (const outlineWidth of [0.5, 0.1, 0.01, 0.001, 1e-6]) {
      const outline = onlyOutline({ outlineWidth, outlineOpacity: 1 });
      let peak = 0;
      for (let step = -4000; step <= 4000; step += 1) {
        peak = Math.max(peak, shade((step / 1000) * filterWidth, filterWidth, outline).a);
      }
      expect(peak).toBeCloseTo(outlineWidth / filterWidth, 12);
    }
    // And above one pixel wide the band saturates rather than continuing to
    // brighten, since coverage itself is clamped.
    for (const outlineWidth of [1, 2, 50]) {
      const outline = onlyOutline({ outlineWidth, outlineOpacity: 1 });
      expect(shade(-outlineWidth / 2, filterWidth, outline).a).toBe(1);
    }
  });
});

describe('shadeDistance glow', () => {
  it('is at full strength at and inside the boundary and zero at the glow width', () => {
    const glow = onlyGlow({ glowWidth: 10, glowOpacity: 1 });
    expect(shade(-50, 0.1, glow).a).toBe(1);
    expect(shade(0, 0.1, glow).a).toBe(1);
    expect(shade(10, 0.1, glow).a).toBe(0);
    expect(shade(20, 0.1, glow).a).toBe(0);
  });

  it('falls off as the square of the remaining fraction of the glow width', () => {
    // The falloff chosen, and why it is squared rather than linear: `t^2` has
    // zero slope where it reaches zero, so the outer edge of the glow has no
    // visible Mach band, where a linear ramp shows the discontinuity in its
    // derivative as a faint ring. The inner end keeps its slope break, but that
    // end is underneath the fill and the outline and is never seen. Two
    // multiplies, no transcendental, and expressible in the nine ops.
    const glow = onlyGlow({ glowWidth: 10, glowOpacity: 1 });
    expect(shade(2.5, 0.1, glow).a).toBeCloseTo(0.5625, 12);
    expect(shade(5, 0.1, glow).a).toBeCloseTo(0.25, 12);
    expect(shade(7.5, 0.1, glow).a).toBeCloseTo(0.0625, 12);
  });

  it('needs no antialiasing of its own', () => {
    // Stated as a test rather than as a claim: the glow's value does not depend
    // on the filter width at all, at any distance. It is already a ramp many
    // pixels wide, so filtering it would be filtering something that is already
    // smooth.
    const glow = onlyGlow({ glowWidth: 10, glowOpacity: 0.75 });
    for (const distance of [-5, 0, 1, 5, 9.99]) {
      const reference = shade(distance, 1, glow).a;
      for (const filterWidth of [1e-6, 0.01, 100, 1e6]) {
        expect(shade(distance, filterWidth, glow).a).toBe(reference);
      }
    }
  });

  it('produces no NaN at a zero or negative glow width', () => {
    // Same floor as the filter width, same reason: the ramp divides by the glow
    // width, and a glow width of zero is the natural way to spell "no glow".
    for (const glowWidth of [0, -0, -1, -1e9]) {
      for (const distance of [-1, 0, 1e-300, 1, 1e9]) {
        const shaded = shade(distance, 0.1, onlyGlow({ glowWidth, glowOpacity: 1 }));
        expect(Number.isNaN(shaded.a)).toBe(false);
      }
    }
    // A zero glow width leaves a glow that is on at and inside the boundary and
    // off outside it, which is the degenerate ramp rather than an invention.
    expect(shade(0, 0.1, onlyGlow({ glowWidth: 0, glowOpacity: 1 })).a).toBe(1);
    expect(shade(1e-9, 0.1, onlyGlow({ glowWidth: 0, glowOpacity: 1 })).a).toBe(0);
  });
});

describe('shadeDistance composite order', () => {
  it('puts the outline over the fill and the fill over the glow', () => {
    // Order matters where the layers overlap, and they do overlap: the outline
    // band lies entirely inside the region the fill also covers, and the glow
    // reaches under both. An opaque fill with an opaque outline has to show the
    // outline, and an opaque fill has to hide the glow.
    const opaque = style({ fillOpacity: 1, outlineOpacity: 1, glowOpacity: 1 });
    expect(shade(-1, 1e-4, opaque)).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(shade(-50, 1e-4, opaque)).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
    // And a transparent fill lets the glow through where the outline does not
    // cover it.
    const glowThrough = style({ fillOpacity: 0, outlineOpacity: 0, glowOpacity: 1 });
    expect(shade(-50, 1e-4, glowThrough)).toEqual({ r: 0, g: 0, b: 1, a: 1 });
  });
});

describe('shadeDistance reads one distance', () => {
  it('moves fill, outline and glow when the single distance argument moves', () => {
    // The structural claim of the whole task, asserted rather than left to the
    // signature. There is one distance parameter, no shape is named anywhere in
    // `shading.ts`, and all three layers respond to it. A version that took a
    // separate distance per layer, or that reached for a shape, would still
    // pass every other test in this file.
    const filterWidth = 0.5;
    const near = 0;
    const far = 1.5;

    const fillNear = shade(near, filterWidth, onlyFill()).a;
    const fillFar = shade(far, filterWidth, onlyFill()).a;
    expect(fillNear).not.toBe(fillFar);

    const outlineNear = shade(-1, filterWidth, onlyOutline()).a;
    const outlineFar = shade(-4, filterWidth, onlyOutline()).a;
    expect(outlineNear).not.toBe(outlineFar);

    const glowNear = shade(near, filterWidth, onlyGlow()).a;
    const glowFar = shade(far, filterWidth, onlyGlow()).a;
    expect(glowNear).not.toBe(glowFar);

    // And the composite moves with it, monotonically outward: pushing the
    // fragment further from the shape can only reduce what it is covered by.
    let previous = Number.POSITIVE_INFINITY;
    for (let step = -20; step <= 40; step += 1) {
      const alpha = shade(step / 2, filterWidth, style({ glowOpacity: 1 })).a;
      expect(alpha).toBeLessThanOrEqual(previous + 1e-15);
      previous = alpha;
    }
  });

  it('shades two different shapes identically wherever their distances agree', () => {
    // The consequence worth having, and the reason the file is factored this
    // way: a rounded rectangle, a circle and anything M4 adds later share one
    // shading path, so a fix to the edge quality of one is a fix to all of
    // them. The shapes are imported HERE, in the test, and nowhere in
    // `shading.ts`, which is the point being made.
    //
    // The two fields agree because a square with `radius = halfSide` is the
    // disc inscribed in it: see `sdf.test.ts`, where that equivalence is pinned
    // on its own. They agree to within a couple of ulps rather than bit for
    // bit, so the shading of the two agrees to the same order, which is why
    // this compares channel by channel with a tolerance instead of `toEqual`.
    const radius = 6;
    const chosenStyle = style({ glowOpacity: 1 });
    for (const px of [-9, -6, -3, 0, 2.5, 5.9, 6.1, 11]) {
      for (const py of [0, 1.75, 4, 7.5]) {
        const asRect = roundedRectDistance(
          numberOps,
          { x: px, y: py },
          { x: 2 * radius, y: 2 * radius },
          radius,
        );
        const asCircle = circleDistance(numberOps, { x: px, y: py }, radius);
        const fromRect = shade(asRect, 0.5, chosenStyle);
        const fromCircle = shade(asCircle, 0.5, chosenStyle);
        expect(fromRect.r).toBeCloseTo(fromCircle.r, 12);
        expect(fromRect.g).toBeCloseTo(fromCircle.g, 12);
        expect(fromRect.b).toBeCloseTo(fromCircle.b, 12);
        expect(fromRect.a).toBeCloseTo(fromCircle.a, 12);
      }
    }
  });
});
