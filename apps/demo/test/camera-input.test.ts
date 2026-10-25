import { describe, expect, it } from 'vitest';
import { AA_QUAD_PADDING_FRACTION, normalizeShape } from '@dagr/render';
import {
  DETAIL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  OVERVIEW_ZOOM,
  WHEEL_LINE_HEIGHT,
  WHEEL_MAX_PIXELS,
  WHEEL_PAGE_HEIGHT,
  WHEEL_ZOOM_SPEED,
  canvasPoint,
  wheelPixels,
  wheelZoomFactor,
} from '../src/camera-input.js';
import { HERO } from '../src/scene.js';

/**
 * The only unit-testable part of the demo's interaction layer.
 *
 * `ShapeStage.tsx` is React glue over a GPU device: every line of it needs a
 * canvas, an adapter and a live layout, so it is verified by a screenshot the
 * way `@dagr/render`'s own renderer is. These two functions are the exception.
 * They are the arithmetic that sits between a DOM event and a `Camera2D` call,
 * they have sign conventions and unit conversions that are easy to get subtly
 * wrong, and they need nothing but numbers to check.
 */

describe('wheelPixels', () => {
  it('passes a pixel-mode delta through unchanged', () => {
    expect(wheelPixels({ deltaY: 53, deltaMode: 0 })).toBe(53);
    expect(wheelPixels({ deltaY: -12.5, deltaMode: 0 })).toBe(-12.5);
  });

  it('converts a line-mode delta into pixels', () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(3 * WHEEL_LINE_HEIGHT);
  });

  it('converts a page-mode delta into pixels', () => {
    // A quarter page, because a whole one is past the clamp: WHEEL_PAGE_HEIGHT
    // is larger than WHEEL_MAX_PIXELS, so every full page-mode notch saturates.
    expect(wheelPixels({ deltaY: 0.25, deltaMode: 2 })).toBe(WHEEL_PAGE_HEIGHT / 4);
    expect(WHEEL_PAGE_HEIGHT).toBeGreaterThan(WHEEL_MAX_PIXELS);
  });

  it('clamps a violent trackpad fling in both directions', () => {
    expect(wheelPixels({ deltaY: 100_000, deltaMode: 0 })).toBe(WHEEL_MAX_PIXELS);
    expect(wheelPixels({ deltaY: -100_000, deltaMode: 0 })).toBe(-WHEEL_MAX_PIXELS);
    // Page mode reaches the clamp far sooner than pixel mode does.
    expect(wheelPixels({ deltaY: 4, deltaMode: 2 })).toBe(WHEEL_MAX_PIXELS);
  });

  it('reports zero rather than a non-finite delta', () => {
    expect(wheelPixels({ deltaY: Number.NaN, deltaMode: 0 })).toBe(0);
    expect(wheelPixels({ deltaY: Number.POSITIVE_INFINITY, deltaMode: 0 })).toBe(0);
  });

  it('treats an unknown deltaMode as pixels', () => {
    expect(wheelPixels({ deltaY: 7, deltaMode: 99 })).toBe(7);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms out when the wheel scrolls down, in when it scrolls up', () => {
    // deltaY is positive scrolling away from the user, which is zoom out, which
    // is a factor below 1 because Camera2D multiplies its zoom by it.
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeLessThan(1);
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1);
  });

  it('holds the zoom still for a zero delta', () => {
    expect(wheelZoomFactor({ deltaY: 0, deltaMode: 0 })).toBe(1);
  });

  it('is exactly reversible: equal and opposite deltas cancel', () => {
    const up = wheelZoomFactor({ deltaY: -40, deltaMode: 0 });
    const down = wheelZoomFactor({ deltaY: 40, deltaMode: 0 });
    expect(up * down).toBeCloseTo(1, 12);
  });

  it('is exponential, so factors compose the way repeated notches do', () => {
    const one = wheelZoomFactor({ deltaY: 25, deltaMode: 0 });
    const two = wheelZoomFactor({ deltaY: 50, deltaMode: 0 });
    expect(one * one).toBeCloseTo(two, 12);
  });

  it('stays a positive finite number for any input Camera2D would reject', () => {
    for (const deltaY of [0, 1e9, -1e9, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      const factor = wheelZoomFactor({ deltaY, deltaMode: 0 });
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThan(0);
    }
  });

  it('bounds one notch to the clamped delta, so no single event can teleport', () => {
    const widest = Math.exp(WHEEL_MAX_PIXELS * WHEEL_ZOOM_SPEED);
    for (const deltaY of [1e9, -1e9, 500, -500]) {
      const factor = wheelZoomFactor({ deltaY, deltaMode: 0 });
      expect(factor).toBeLessThanOrEqual(widest);
      expect(factor).toBeGreaterThanOrEqual(1 / widest);
    }
  });
});

describe('the zoom range', () => {
  /**
   * The shortest a pane ever gets, in CSS pixels: `styles.css` sizes one
   * `clamp(480px, 52vh, 620px)` tall, and no module can read a stylesheet.
   *
   * The last copied number in this block, and the hero it used to sit next to
   * is now imported. That constant was `{ width: 100, height: 40 }`, a
   * hand-copy of M4.1's `FIRST_LIGHT_SIZE` standing in for the quad
   * `@dagr/render` used to hard-code; M4.2 deleted that quad, a renderer now
   * starts empty, and the demo owns what it draws. So the shape these claims
   * are about comes from `scene.ts`, which is the batch actually passed to
   * `setShapes`, and a scene edit that broke one of them fails here instead of
   * agreeing with a stale copy.
   *
   * Only the pane's HEIGHT is copied, because only the height has a floor:
   * panes stack and go full width on a narrow screen, so a claim about their
   * width would be a claim about the reader's window. A taller pane only makes
   * these truer.
   */
  const SHORTEST_PANE = 480;
  const hero = normalizeShape(HERO);

  it('contains both zooms a pane starts at', () => {
    // Camera2D throws rather than clamps an out-of-range initial zoom, so this
    // is the difference between a demo and a blank page with a red overlay.
    for (const zoom of [OVERVIEW_ZOOM, DETAIL_ZOOM]) {
      expect(zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('is what bounds a gesture, since the per-event clamp only bounds an event', () => {
    // Thirty events each saturated at WHEEL_MAX_PIXELS is an ordinary trackpad
    // fling, and wheelZoomFactor composes them exactly, which its own docstring
    // calls a feature. So the clamp that makes one event safe multiplies out to
    // a factor of about 8100 across a flick, and only the range stops it. From
    // EITHER pane: the detail pane starts three orders of magnitude in, and one
    // fling from there has to be caught by the same two numbers.
    const fling = wheelZoomFactor({ deltaY: -1e9, deltaMode: 0 }) ** 30;
    for (const zoom of [OVERVIEW_ZOOM, DETAIL_ZOOM]) {
      expect(zoom * fling).toBeGreaterThan(MAX_ZOOM);
      expect(zoom / fling).toBeLessThan(MIN_ZOOM);
    }
  });

  it('leaves the hero a legible rounded rectangle at MIN_ZOOM', () => {
    // One broken-renderer look: a shape small enough to read as a speck of
    // dust. Both axes have to stay big enough to see a rectangle, and the short
    // one is what binds.
    expect(hero.size.width * MIN_ZOOM).toBeGreaterThanOrEqual(16);
    expect(hero.size.height * MIN_ZOOM).toBeGreaterThanOrEqual(8);
  });

  it('keeps both edges of the hero outline on screen at MAX_ZOOM', () => {
    // The other broken-renderer look, and the rule here is NOT M4.1's "keep two
    // edges of the shape on screen". It cannot be: the detail pane is
    // deliberately INSIDE the hero at 100x, which is the whole requirement, so
    // a range that kept the whole shape visible would forbid the demo. What has
    // to survive to the top of the range instead is the thing being looked at,
    // which is the outline band: keep it narrower than the pane and both of its
    // edges stay on screen, so "the outline still has an even width" remains
    // something a reader can check rather than take on trust.
    expect(hero.style.outlineWidth * MAX_ZOOM).toBeLessThanOrEqual(SHORTEST_PANE);
  });

  it('gives the antialiasing pad a shape big enough to work at OVERVIEW_ZOOM', () => {
    // `shapeQuadSize` reserves room for the coverage ramp as a FRACTION of the
    // shape, so the reservation covers the ramp's outer half only once the
    // shape's larger half extent measures `0.5 / AA_QUAD_PADDING_FRACTION` CSS
    // pixels, which is 33.3. Below that the outermost sliver of the ramp is
    // clipped at the four edge midpoints, which reads as an edge slightly
    // harder than the rest: the exact artefact this pane exists to rule out.
    // This is why the hero is 700 world units wide and not 200.
    const halfExtentPx = (Math.max(hero.size.width, hero.size.height) / 2) * OVERVIEW_ZOOM;
    expect(halfExtentPx).toBeGreaterThanOrEqual(0.5 / AA_QUAD_PADDING_FRACTION);
  });

  it('shows the corner as a curve rather than a straight edge at DETAIL_ZOOM', () => {
    // At 100x the corner arc is 2400 CSS pixels across and the pane is 480, so
    // the reader sees a short chord of it. How far that chord bows away from
    // the straight line joining its ends is the sagitta, and it is what decides
    // whether the picture shows a curve or a slightly tilted straight edge.
    // Eight pixels is the floor: below that a polygonal approximation and a
    // true arc would look the same, and the claim would be uncheckable.
    const radiusPx = hero.cornerRadius * DETAIL_ZOOM;
    const halfChord = SHORTEST_PANE / 2;
    const sagitta = radiusPx - Math.sqrt(radiusPx ** 2 - halfChord ** 2);
    expect(sagitta).toBeGreaterThanOrEqual(8);
  });
});

describe('canvasPoint', () => {
  it('subtracts the bounding rect, so the origin is the canvas top-left', () => {
    const rect = { left: 40, top: 120 };
    expect(canvasPoint({ clientX: 40, clientY: 120 }, rect)).toEqual({ x: 0, y: 0 });
    expect(canvasPoint({ clientX: 140, clientY: 200 }, rect)).toEqual({ x: 100, y: 80 });
  });

  it('keeps the fractional offsets a scrolled or transformed rect produces', () => {
    expect(canvasPoint({ clientX: 10.5, clientY: 20.25 }, { left: 0.5, top: 0.25 })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('reports negative coordinates for a point outside the canvas', () => {
    expect(canvasPoint({ clientX: 0, clientY: 0 }, { left: 40, top: 120 })).toEqual({
      x: -40,
      y: -120,
    });
  });
});
