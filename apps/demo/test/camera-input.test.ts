import { describe, expect, it } from 'vitest';
import {
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  WHEEL_LINE_HEIGHT,
  WHEEL_MAX_PIXELS,
  WHEEL_PAGE_HEIGHT,
  WHEEL_ZOOM_SPEED,
  canvasPoint,
  wheelPixels,
  wheelZoomFactor,
} from '../src/camera-input.js';

/**
 * The only unit-testable part of the first light demo.
 *
 * `FirstLight.tsx` is React glue over a GPU device: every line of it needs a
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
   * The quad `@dagr/render` draws, in world units, and the shortest the stage
   * ever gets, in CSS pixels.
   *
   * Both are copies, and both are copies on purpose. `FIRST_LIGHT_SIZE` is not
   * exported from `@dagr/render` (M4.1 draws it, M4.4 replaces it), and the
   * stage height is `clamp(600px, 62vh, 780px)` in `styles.css`, which no
   * module can read. Importing the component to reach the first would pull
   * three.js and a GPU device into a node test to check two numbers. The
   * shortest stage is the worst case for the claim below, so a taller one only
   * makes it truer.
   */
  const QUAD = { width: 100, height: 40 };
  const SHORTEST_STAGE = 600;

  it('contains the zoom the camera starts at', () => {
    // Camera2D throws rather than clamps an out-of-range initial zoom, so this
    // is the difference between a demo and a blank page with a red overlay.
    expect(INITIAL_ZOOM).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(INITIAL_ZOOM).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('is what bounds a gesture, since the per-event clamp only bounds an event', () => {
    // Thirty events each saturated at WHEEL_MAX_PIXELS is an ordinary trackpad
    // fling, and wheelZoomFactor composes them exactly, which its own docstring
    // calls a feature. So the clamp that makes one event safe multiplies out to
    // a factor of about 8100 across a flick, and only the range stops it.
    const fling = wheelZoomFactor({ deltaY: -1e9, deltaMode: 0 }) ** 30;
    expect(INITIAL_ZOOM * fling).toBeGreaterThan(MAX_ZOOM);
    expect(INITIAL_ZOOM / fling).toBeLessThan(MIN_ZOOM);
  });

  it('keeps two edges of the quad on screen at MAX_ZOOM', () => {
    // Zoom is CSS pixels per world unit, so the visible world is the canvas
    // divided by it. Keeping that taller than the quad keeps the quad's top and
    // bottom edges both on screen, which is what stops a zoom to the limit
    // painting a flat amber fill that looks exactly like a broken renderer.
    expect(SHORTEST_STAGE / MAX_ZOOM).toBeGreaterThanOrEqual(QUAD.height);
  });

  it('leaves the quad a legible rectangle at MIN_ZOOM', () => {
    // The other broken-renderer look: a quad small enough to read as a speck of
    // dust. Both axes have to stay big enough to see a rectangle, and the short
    // one is what binds.
    expect(QUAD.width * MIN_ZOOM).toBeGreaterThanOrEqual(16);
    expect(QUAD.height * MIN_ZOOM).toBeGreaterThanOrEqual(8);
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
