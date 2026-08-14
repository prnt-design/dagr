import { describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import type { OverlayPlacement } from '../src/overlay-math.js';
import {
  CENTRE_ANCHOR,
  boundsCentre,
  boundsContain,
  boundsOverlap,
  boxScreenWidth,
  cssNumber,
  cssPx,
  distanceSqFrom,
  entryTransform,
  layerLocalPoint,
  layerTransform,
  needsRebase,
  passesGate,
  placementInView,
  requirePlacement,
  selectWithinCap,
} from '../src/overlay-math.js';

/**
 * The overlay's arithmetic, including the CSS strings it produces.
 *
 * The strings are asserted here rather than in the DOM suite because this is
 * where they are built: `html-overlay.ts` assigns what this file returns, so a
 * transform that is wrong is wrong in a function this suite can call with
 * numbers and no browser.
 *
 * What this suite CANNOT establish is that a browser composes the layer's
 * transform and an entry's the way the algebra below says. That is the
 * screenshot's job, and it is listed as untested on `docs/docs/render.md`.
 */

/** A camera whose viewport is a round number, so screen positions are readable. */
function testCamera(zoom: number, center = { x: 0, y: 0 }): Camera2D {
  return new Camera2D({
    zoom,
    center,
    viewport: { width: 1000, height: 600, devicePixelRatio: 1 },
  });
}

const box = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  gate?: { min?: number; max?: number },
): OverlayPlacement => ({
  kind: 'box',
  bounds: { minX, minY, maxX, maxY },
  ...(gate?.min === undefined ? {} : { minScreenWidth: gate.min }),
  ...(gate?.max === undefined ? {} : { maxScreenWidth: gate.max }),
});

describe('cssNumber', () => {
  it('never produces exponential notation, which CSS rejects', () => {
    // The two places JavaScript switches to exponent form, and a sweep between
    // them. A declaration containing "1e-7" is dropped by the CSS parser, so
    // the element keeps its previous transform and one label silently stops
    // following the camera.
    for (const value of [1e-7, 1e-9, 5e-12, 1e-100, 1e20, 1.5e21, 1e30, 123456789]) {
      expect(cssNumber(value, 'v')).not.toContain('e');
      expect(cssNumber(-value, 'v')).not.toContain('e');
    }
  });

  it('keeps a small zoom from rounding its scale to zero', () => {
    // A fixed four decimals would give "0.0000" here, and a layer scaled by
    // exactly zero collapses every entry to a point, including the screen-scaled
    // ones that were supposed to stay readable.
    expect(Number(cssNumber(1e-5, 'zoom'))).toBeCloseTo(1e-5, 12);
    expect(Number(cssNumber(2.5e-8, 'zoom'))).toBeCloseTo(2.5e-8, 15);
  });

  it('keeps seven significant digits and trims the rest', () => {
    expect(cssNumber(1, 'v')).toBe('1');
    expect(cssNumber(0.5, 'v')).toBe('0.5');
    expect(cssNumber(1234.5, 'v')).toBe('1234.5');
    expect(cssNumber(1 / 3, 'v')).toBe('0.3333333');
    expect(cssNumber(0, 'v')).toBe('0');
  });

  it('normalises a value that rounded away to a signed zero', () => {
    expect(cssNumber(-1e-300, 'v')).toBe('0');
  });

  it('rejects a value that is not finite, naming the field', () => {
    expect(() => cssNumber(Number.NaN, 'zoom')).toThrow(RangeError);
    expect(() => cssNumber(Number.POSITIVE_INFINITY, 'zoom')).toThrow(/zoom/);
  });

  it('appends the unit for a length', () => {
    expect(cssPx(12.5, 'v')).toBe('12.5px');
  });
});

describe('layerTransform', () => {
  it('translates to the origin on screen and then scales', () => {
    // Order matters: with `transform-origin: 0 0`, translate-then-scale means
    // "scale the layer's coordinates, then move the whole thing", which is what
    // the entry arithmetic assumes.
    expect(layerTransform({ x: 500, y: 300 }, 2)).toBe('translate(500px, 300px) scale(2)');
  });

  it('agrees with the camera about where the origin is', () => {
    const camera = testCamera(4, { x: 100, y: 50 });
    const origin = { x: 120, y: 70 };
    const screen = camera.worldToScreen(origin);
    expect(layerTransform(screen, camera.zoom)).toBe('translate(580px, 220px) scale(4)');
  });

  it('rejects a zoom that is not positive and finite', () => {
    expect(() => layerTransform({ x: 0, y: 0 }, 0)).toThrow(RangeError);
    expect(() => layerTransform({ x: 0, y: 0 }, Number.NaN)).toThrow(/zoom/);
  });
});

describe('layerLocalPoint', () => {
  it('negates y, because world y is up and the layer is a scaled screen', () => {
    const origin = { x: 10, y: 10 };
    expect(layerLocalPoint({ kind: 'point', at: { x: 30, y: 40 } }, origin)).toEqual({
      x: 20,
      y: -30,
    });
  });

  it('places a box by its top-left corner, which is minX and maxY', () => {
    // Getting this pair the wrong way round puts every card one box height
    // below its node, which looks like a plausible offset rather than a bug.
    expect(layerLocalPoint(box(0, 0, 100, 40), { x: 0, y: 0 })).toEqual({ x: 0, y: -40 });
  });
});

describe('entryTransform', () => {
  const origin = { x: 0, y: 0 };

  it('gives a box a translation and nothing else, at any zoom', () => {
    // The property the whole design rests on: a box entry's transform does not
    // mention the zoom, so a pan or a zoom rewrites one string on the layer and
    // nothing on the entries.
    const placement = box(100, 0, 200, 40);
    const at1 = entryTransform(placement, origin, 1);
    const at97 = entryTransform(placement, origin, 97);
    expect(at1).toBe('translate(100px, -40px)');
    expect(at97).toBe(at1);
  });

  it('counter-scales a point and shifts it by its anchor', () => {
    expect(entryTransform({ kind: 'point', at: { x: 10, y: 20 } }, origin, 4)).toBe(
      'translate(10px, -20px) scale(0.25) translate(-50%, -50%)',
    );
  });

  it('anchors a point at its top-left when asked', () => {
    expect(
      entryTransform(
        { kind: 'point', at: { x: 0, y: 0 }, anchor: { across: 0, down: 0 } },
        origin,
        2,
      ),
    ).toBe('translate(0px, 0px) scale(0.5) translate(0%, 0%)');
  });

  it('defaults the anchor to the centre', () => {
    const explicit = entryTransform(
      { kind: 'point', at: { x: 5, y: 5 }, anchor: CENTRE_ANCHOR },
      origin,
      1,
    );
    expect(entryTransform({ kind: 'point', at: { x: 5, y: 5 } }, origin, 1)).toBe(explicit);
  });

  it('follows the origin, so a rebase moves every entry by the same amount', () => {
    const placement = box(1000, 1000, 1100, 1040);
    const before = entryTransform(placement, { x: 0, y: 0 }, 1);
    const after = entryTransform(placement, { x: 900, y: 900 }, 1);
    expect(before).toBe('translate(1000px, -1040px)');
    expect(after).toBe('translate(100px, -140px)');
  });
});

describe('the gate', () => {
  it('measures the box width in CSS pixels', () => {
    expect(boxScreenWidth({ minX: 0, minY: 0, maxX: 40, maxY: 10 }, 4)).toBe(160);
  });

  it('is half-open, so adjacent tiers never both show or both hide', () => {
    // The label tier ends where the card tier begins. At exactly 160 CSS pixels
    // the card shows and the label does not, at every zoom, without either tier
    // knowing the other exists.
    const bounds = { minX: 0, minY: 0, maxX: 40, maxY: 10 };
    const label: OverlayPlacement = { kind: 'box', bounds, minScreenWidth: 24, maxScreenWidth: 160 };
    const card: OverlayPlacement = { kind: 'box', bounds, minScreenWidth: 160 };
    const zoomAt = (width: number): number => width / 40;

    for (const width of [23.9, 24, 100, 159.9, 160, 400]) {
      const zoom = zoomAt(width);
      const shown = [passesGate(label, zoom), passesGate(card, zoom)].filter(Boolean).length;
      expect(shown, `width ${String(width)}`).toBeLessThanOrEqual(1);
    }
    expect(passesGate(label, zoomAt(24))).toBe(true);
    expect(passesGate(label, zoomAt(160))).toBe(false);
    expect(passesGate(card, zoomAt(160))).toBe(true);
    expect(passesGate(label, zoomAt(23.9))).toBe(false);
    expect(passesGate(card, zoomAt(23.9))).toBe(false);
  });

  it('lets an ungated box through at any zoom', () => {
    expect(passesGate(box(0, 0, 10, 10), 1e-6)).toBe(true);
    expect(passesGate(box(0, 0, 10, 10), 1e6)).toBe(true);
  });

  it('never gates a point, which has no extent to measure', () => {
    expect(passesGate({ kind: 'point', at: { x: 0, y: 0 } }, 1e-6)).toBe(true);
  });
});

describe('culling', () => {
  const visible = { minX: -10, minY: -10, maxX: 10, maxY: 10 };

  it('keeps a box that overlaps the view at all', () => {
    expect(placementInView(box(9, 9, 900, 900), visible)).toBe(true);
    expect(placementInView(box(10, 10, 20, 20), visible)).toBe(true);
    expect(placementInView(box(10.1, 0, 20, 1), visible)).toBe(false);
  });

  it('keeps a point only while the point itself is in view', () => {
    expect(placementInView({ kind: 'point', at: { x: 10, y: 10 } }, visible)).toBe(true);
    expect(placementInView({ kind: 'point', at: { x: 10.1, y: 0 } }, visible)).toBe(false);
  });

  it('overlaps and contains agree on their shared edge', () => {
    expect(boundsOverlap(visible, { minX: 10, minY: 10, maxX: 11, maxY: 11 })).toBe(true);
    expect(boundsContain(visible, { x: -10, y: 10 })).toBe(true);
    expect(boundsCentre(visible)).toEqual({ x: 0, y: 0 });
  });
});

describe('rebasing', () => {
  it('rebases exactly when the origin leaves the visible region', () => {
    const camera = testCamera(1);
    expect(needsRebase({ x: 0, y: 0 }, camera.visibleWorldBounds())).toBe(false);
    camera.panByScreen(-499, 0);
    expect(needsRebase({ x: 0, y: 0 }, camera.visibleWorldBounds())).toBe(false);
    camera.panByScreen(-2, 0);
    expect(needsRebase({ x: 0, y: 0 }, camera.visibleWorldBounds())).toBe(true);
  });

  it('cannot rebase twice from one gesture, because the new origin is centred', () => {
    // A fresh origin sits at the centre with half a viewport of slack on every
    // side, so the camera has to move a viewport's worth before the next one.
    const camera = testCamera(1);
    camera.panByScreen(-600, 0);
    const bounds = camera.visibleWorldBounds();
    const origin = boundsCentre(bounds);
    expect(needsRebase(origin, bounds)).toBe(false);
    camera.panByScreen(-499, 0);
    expect(needsRebase(origin, camera.visibleWorldBounds())).toBe(false);
  });

  it('keeps the layer transform small at a deep zoom, which is the point', () => {
    // Without rebasing, this entry's offset would be 1e5 * 100 = 1e7 CSS
    // pixels, against float32's ~1.7e7 of integer resolution, and the card
    // would jitter against the shape it labels.
    const camera = testCamera(100, { x: 1e5, y: 0 });
    const visible = camera.visibleWorldBounds();
    const origin = boundsCentre(visible);
    const screen = camera.worldToScreen(origin);
    expect(Math.abs(screen.x)).toBeLessThanOrEqual(1000);
    const local = layerLocalPoint(box(1e5, 0, 1e5 + 1, 1), origin);
    expect(Math.abs(local.x)).toBeLessThan(camera.viewport.width);
  });
});

describe('selectWithinCap', () => {
  const candidate = (order: number, distanceSq: number): { order: number; distanceSq: number } => ({
    order,
    distanceSq,
  });

  it('returns the array itself when nothing is over the cap', () => {
    // Identity rather than a copy: this is the every-frame case, and a sort of
    // 200 elements a frame that changes no decision is 200 comparisons wasted.
    const all = [candidate(0, 5), candidate(1, 1)];
    expect(selectWithinCap(all, 2)).toBe(all);
  });

  it('keeps the nearest to the camera when over the cap', () => {
    const kept = selectWithinCap([candidate(0, 90), candidate(1, 1), candidate(2, 40)], 2);
    expect(kept.map((c) => c.order)).toEqual([1, 2]);
  });

  it('breaks ties by registration order, so the picture is stable', () => {
    const kept = selectWithinCap([candidate(7, 4), candidate(3, 4), candidate(5, 4)], 2);
    expect(kept.map((c) => c.order)).toEqual([3, 5]);
  });

  it('does not mutate what it was given', () => {
    const all = [candidate(0, 90), candidate(1, 1)];
    selectWithinCap(all, 1);
    expect(all.map((c) => c.order)).toEqual([0, 1]);
  });

  it('measures a box from its centre and a point from itself', () => {
    expect(distanceSqFrom(box(0, 0, 10, 10), { x: 5, y: 5 })).toBe(0);
    expect(distanceSqFrom({ kind: 'point', at: { x: 3, y: 4 } }, { x: 0, y: 0 })).toBe(25);
  });
});

describe('requirePlacement', () => {
  it('names the field of a coordinate that is not finite', () => {
    expect(() => requirePlacement({ kind: 'point', at: { x: Number.NaN, y: 0 } }, 'p')).toThrow(
      /p\.at\.x/,
    );
    expect(() => requirePlacement(box(0, 0, Number.NaN, 1), 'p')).toThrow(/p\.bounds\.maxX/);
  });

  it('rejects a box whose extents are the wrong way round', () => {
    // The likely cause is a y-down rectangle assigned into world extents, which
    // would size an element to a negative length and never appear.
    expect(() => requirePlacement(box(0, 0, 10, -10), 'p')).toThrow(RangeError);
    expect(() => requirePlacement(box(10, 0, 0, 10), 'p')).toThrow(/maxX at or above minX/);
  });

  it('allows an open-ended tier ceiling', () => {
    expect(() =>
      requirePlacement(box(0, 0, 1, 1, { min: 160, max: Number.POSITIVE_INFINITY }), 'p'),
    ).not.toThrow();
  });

  it('rejects an anchor that is not finite', () => {
    expect(() =>
      requirePlacement(
        { kind: 'point', at: { x: 0, y: 0 }, anchor: { across: Number.NaN, down: 0 } },
        'p',
      ),
    ).toThrow(/p\.anchor\.across/);
  });
});
