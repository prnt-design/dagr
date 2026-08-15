import { Camera2D } from '@dagr/render';
import { describe, expect, it } from 'vitest';
import {
  FIT_PADDING,
  INITIAL_ZOOM,
  KEY_PAN_STEP,
  KEY_ZOOM_FACTOR,
  WHEEL_LINE_HEIGHT,
  WHEEL_MAX_PIXELS,
  WHEEL_PAGE_HEIGHT,
  WHEEL_ZOOM_SPEED,
  canvasPoint,
  initialZoomFromHash,
  keyCommand,
  wheelPixels,
  wheelZoomFactor,
  zoomLimits,
} from '../src/camera-input.js';
import { LADDER_BOUNDS, LADDER_SMALLEST_EXTENT } from '../src/ladder.js';

/**
 * The only unit-testable part of the first light demo.
 *
 * `FirstLight.tsx` is React glue over a GPU device: every line of it needs a
 * canvas, an adapter and a live layout, so it is verified by a screenshot the
 * way `@dagr/render`'s own renderer is. These functions are the exception. They
 * are the arithmetic and the string parsing that sit between a DOM event or a
 * URL and a `Camera2D` call, they have sign conventions, unit conversions and
 * coercion holes that are easy to get subtly wrong, and they need nothing but
 * numbers to check.
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

describe('the derived zoom range', () => {
  /**
   * The canvas the committed screenshots are taken at, in CSS pixels. A copy,
   * because it comes from CSS no module can read: `styles.css` holds the
   * stage at `clamp(600px, 62vh, 780px)` inside a `.page` capped at 72rem
   * with 1.5rem of padding, so 1102 by 598 is the widest page at the
   * shortest stage. The scene, unlike the fixed-range era, is NOT copied:
   * `ladder.ts` exports its bounds and smallest extent, computed from the
   * shapes, so these tests move with the scene instead of drifting from it.
   */
  const CANVAS = { width: 1102, height: 598 };

  it('derives the range this scene and canvas actually produce', () => {
    const { minZoom, maxZoom } = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    // The floor: 90% of the width-limited fit of a 2205-unit-wide scene.
    expect(minZoom).toBeCloseTo(0.9 * (CANVAS.width / 2205), 6);
    // The ceiling: the 4-unit smallest extent filling the 598px short side.
    expect(maxZoom).toBeCloseTo(CANVAS.height / 4, 9);
  });

  it('keeps the 100x crispness reference reachable and retires the 0.1x one', () => {
    // The derived range supersedes the fixed 0.1 to 100. The 100x reference
    // stays reachable (the ceiling lands near 150 on the reference canvas);
    // the 0.1x frame is deliberately below the floor now, because a floor at
    // the fitted scene is exactly the "too far out" state the derived range
    // exists to prevent. That frame stays reproducible from the M4.2 commit,
    // and its finding is recorded in the M4.2 ROADMAP entry.
    const { minZoom, maxZoom } = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    expect(maxZoom).toBeGreaterThanOrEqual(100);
    expect(minZoom).toBeGreaterThan(0.1);
  });

  it('agrees with Camera2D.fitBounds on what the floor means', () => {
    // The floor is fitBounds restated as a number, and this is the drift
    // guard: the "0" key fits with FIT_PADDING, the limit is derived with
    // FIT_PADDING, and if the two formulas ever diverge, zooming out would
    // stop short of (or past) what the fit key shows.
    const camera = new Camera2D({
      viewport: { ...CANVAS, devicePixelRatio: 1 },
    });
    camera.fitBounds(LADDER_BOUNDS, FIT_PADDING);
    const { minZoom } = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    expect(camera.zoom).toBeCloseTo(minZoom, 12);
  });

  it('contains the zoom the camera starts at', () => {
    const { minZoom, maxZoom } = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    expect(INITIAL_ZOOM).toBeGreaterThanOrEqual(minZoom);
    expect(INITIAL_ZOOM).toBeLessThanOrEqual(maxZoom);
  });

  it('is what bounds a gesture, since the per-event clamp only bounds an event', () => {
    // Thirty events each saturated at WHEEL_MAX_PIXELS is an ordinary trackpad
    // fling, and wheelZoomFactor composes them exactly, which its own docstring
    // calls a feature. So the clamp that makes one event safe multiplies out to
    // a factor of about 8100 across a flick, and only the range stops it.
    const { minZoom, maxZoom } = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    const fling = wheelZoomFactor({ deltaY: -1e9, deltaMode: 0 }) ** 30;
    expect(INITIAL_ZOOM * fling).toBeGreaterThan(maxZoom);
    expect(INITIAL_ZOOM / fling).toBeLessThan(minZoom);
  });

  it('moves with the viewport, which is why the camera limits must be rebindable', () => {
    const small = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, { width: 551, height: 299 });
    const large = zoomLimits(LADDER_BOUNDS, LADDER_SMALLEST_EXTENT, CANVAS);
    expect(small.minZoom).toBeCloseTo(large.minZoom / 2, 6);
    expect(small.maxZoom).toBeCloseTo(large.maxZoom / 2, 6);
  });

  it('orders a degenerate pair instead of handing the camera an empty range', () => {
    // Content tighter than its own smallest node inverts fit and fill; the
    // range is ordered before returning, so Camera2D.setZoomLimits accepts it.
    const bounds = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const { minZoom, maxZoom } = zoomLimits(bounds, 100, CANVAS);
    expect(minZoom).toBeLessThanOrEqual(maxZoom);
  });
});

describe('keyCommand', () => {
  it('zooms on the keys that would scroll the page, one wheel detent per press', () => {
    expect(keyCommand('ArrowUp')).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR });
    expect(keyCommand('ArrowDown')).toEqual({ kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR });
    expect(keyCommand('=')).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR });
    expect(keyCommand('+')).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR });
    expect(keyCommand('-')).toEqual({ kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR });
    // One detent is 100 pixels of wheel travel, so key and wheel agree.
    expect(KEY_ZOOM_FACTOR).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_SPEED), 12);
  });

  it('takes three detents on the page keys', () => {
    expect(keyCommand('PageUp')).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR ** 3 });
    expect(keyCommand('PageDown')).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR ** -3 });
  });

  it('pans horizontally on left and right, in panByScreen drag convention', () => {
    // Panning the VIEW left means the content slides right on screen, and
    // panByScreen takes the content delta, so ArrowLeft is a POSITIVE dx.
    expect(keyCommand('ArrowLeft')).toEqual({ kind: 'pan', dx: KEY_PAN_STEP, dy: 0 });
    expect(keyCommand('ArrowRight')).toEqual({ kind: 'pan', dx: -KEY_PAN_STEP, dy: 0 });
  });

  it('pans vertically when shift holds the zoom keys down', () => {
    expect(keyCommand('ArrowUp', true)).toEqual({ kind: 'pan', dx: 0, dy: KEY_PAN_STEP });
    expect(keyCommand('ArrowDown', true)).toEqual({ kind: 'pan', dx: 0, dy: -KEY_PAN_STEP });
  });

  it('fits on 0 and Home', () => {
    expect(keyCommand('0')).toEqual({ kind: 'fit' });
    expect(keyCommand('Home')).toEqual({ kind: 'fit' });
  });

  it('claims nothing else, so the page keeps its keys', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'F5', 'ArrowLeft\t']) {
      expect(keyCommand(key, false)).toBeNull();
    }
    // Shift changes nothing for keys the map does not shift-bind.
    expect(keyCommand('ArrowLeft', true)).toEqual({ kind: 'pan', dx: KEY_PAN_STEP, dy: 0 });
  });
});

describe('initialZoomFromHash', () => {
  /**
   * Deliberately not {@link INITIAL_ZOOM} and not a limit, so a fallback that
   * comes back can only have come from the argument. A parse that quietly
   * returned MIN_ZOOM, MAX_ZOOM or the real initial zoom would otherwise pass
   * half of the assertions below by coincidence.
   */
  const FALLBACK = 7;

  it('reads a named zoom exactly, with no gesture involved', () => {
    // The point of the feature: `#zoom=100` has to give the zoom the 100x
    // reference image was taken at, exactly.
    expect(initialZoomFromHash('#zoom=100', FALLBACK)).toBe(100);
    expect(initialZoomFromHash('#zoom=0.1', FALLBACK)).toBe(0.1);
  });

  it('takes the hash with or without its leading hash mark', () => {
    // `window.location.hash` includes the `#`, and callers that already sliced
    // it off should not get a different answer.
    expect(initialZoomFromHash('#zoom=2.5', FALLBACK)).toBe(2.5);
    expect(initialZoomFromHash('zoom=2.5', FALLBACK)).toBe(2.5);
  });

  it('returns an out-of-range zoom as parsed, for the camera to clamp later', () => {
    // The demo's limits are derived at the first viewport measurement, so at
    // parse time there is nothing correct to clamp against. The camera starts
    // unbounded and `setZoomLimits` clamps when the real range lands, which
    // still gives the user who typed 500 the closest thing the camera can do.
    expect(initialZoomFromHash('#zoom=500', FALLBACK)).toBe(500);
    expect(initialZoomFromHash('#zoom=0.001', FALLBACK)).toBe(0.001);
    expect(initialZoomFromHash('#zoom=1e9', FALLBACK)).toBe(1e9);
  });

  it('falls back when the hash names no zoom at all', () => {
    for (const hash of ['', '#', '#x=3', '#zoom', '#zoomed=4', '#Zoom=4']) {
      expect(initialZoomFromHash(hash, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('falls back when the value is not a number', () => {
    for (const hash of ['#zoom=', '#zoom=abc', '#zoom=NaN', '#zoom=Infinity', '#zoom=2px']) {
      expect(initialZoomFromHash(hash, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('treats zero and negatives as not a zoom rather than as an extreme one', () => {
    // The distinction worth keeping: 500 is a view this camera can approximate,
    // while 0 and -5 are not extreme views at all. They are a typo or a mangled
    // link, and answering them with a plausible frame would hide the mistake.
    // `#zoom=` lands here too, because `Number('')` is 0 rather than NaN,
    // which is the coercion hole this function exists to plug.
    for (const hash of ['#zoom=0', '#zoom=-0', '#zoom=-5', '#zoom=-1e9']) {
      expect(initialZoomFromHash(hash, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('ignores other keys and takes the first of a repeated zoom', () => {
    // `URLSearchParams.get` is what decides both, and it is why the parsing is
    // not a hand-rolled split: order-independence and first-wins come free, and
    // first-wins matches how a query string behaves everywhere else. Last-wins
    // would be no more correct, so the property worth pinning is that it is
    // predictable.
    expect(initialZoomFromHash('#zoom=2&x=3', FALLBACK)).toBe(2);
    expect(initialZoomFromHash('#x=3&zoom=2', FALLBACK)).toBe(2);
    expect(initialZoomFromHash('#zoom=2&zoom=50', FALLBACK)).toBe(2);
  });

  it('accepts every spelling Number does, including exponents and padding', () => {
    // Free with `Number`, and none of it is worth a special case: `%20` decodes
    // to a space and `+` to a space, both of which `Number` trims.
    expect(initialZoomFromHash('#zoom=1e1', FALLBACK)).toBe(10);
    expect(initialZoomFromHash('#zoom=%202%20', FALLBACK)).toBe(2);
    expect(initialZoomFromHash('#zoom=+2', FALLBACK)).toBe(2);
  });

  it('never returns a zoom an unbounded Camera2D would throw on', () => {
    // The property the call site depends on, stated once over everything above:
    // whatever the hash says, the result is a positive finite number, which is
    // what a camera with its default unbounded range accepts at construction.
    // The derived limits then clamp it at the first viewport measurement.
    const hashes = [
      '',
      '#',
      '#zoom=100',
      '#zoom=0.1',
      '#zoom=1e9',
      '#zoom=-1e9',
      '#zoom=0',
      '#zoom=abc',
      '#zoom=',
      '#zoom=NaN',
      '#zoom=Infinity',
      '#zoom=2&zoom=50',
    ];
    for (const hash of hashes) {
      const zoom = initialZoomFromHash(hash, INITIAL_ZOOM);
      expect(Number.isFinite(zoom)).toBe(true);
      expect(zoom).toBeGreaterThan(0);
    }
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
