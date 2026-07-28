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
  initialZoomFromHash,
  wheelPixels,
  wheelZoomFactor,
} from '../src/camera-input.js';

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

describe('the zoom range', () => {
  /**
   * The crispness ladder `@dagr/render` draws, in world units, and the canvas it
   * lands on, in CSS pixels.
   *
   * Every number here is a copy, and every one is a copy on purpose. The ladder
   * exports nothing (M4.2 draws it, M4.4 replaces the scene), and importing the
   * module to reach its sizes would pull three.js and a GPU device into a node
   * test to check three numbers. The canvas comes from CSS that no module can
   * read: `styles.css` holds the stage at `clamp(600px, 62vh, 780px)` inside a
   * `.page` capped at 72rem with 1.5rem of padding, so 1102 by 598 is the widest
   * page at the shortest stage, and it is the size the committed screenshots are
   * taken at.
   *
   * The worst cases differ by end of the range, which is why one canvas figure
   * is not enough. A taller stage only makes the MIN_ZOOM claims truer. A
   * NARROWER window is the single case that weakens the MAX_ZOOM claim, because
   * the smallest rung's side edges leave the frame once the canvas is under 1000
   * CSS pixels wide; that is a property of the screenshot, not of the camera.
   */
  const RUNG = { small: 10, medium: 100, large: 1000 };
  const CANVAS = { width: 1102, height: 598 };

  it('reaches exactly the two zooms the crispness reference is taken at', () => {
    // The ROADMAP asks M4.2 for the same shape at 0.1x and 100x, committed as
    // the reference. Those are the limits rather than points inside a wider
    // range because `#zoom=` clamps, so a range that stopped short would answer
    // `#zoom=100` with something else and quietly make the reference
    // unreproducible.
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(100);
  });

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

  it('fills the view with the smallest rung at MAX_ZOOM, edges included', () => {
    // Both halves of what the 100x screenshot has to show, and they pull against
    // each other. Taller than the stage is "fills the view", which is what makes
    // a magnified edge worth photographing. No wider than the canvas is what
    // keeps the rung's two side edges and two rounded corners in frame, so the
    // picture is an antialiased boundary rather than a flat fill that looks
    // exactly like a broken renderer. 10 units at 100 is 1000 CSS pixels, which
    // clears 598 comfortably and clears 1102 by 9%.
    expect(RUNG.small * MAX_ZOOM).toBeGreaterThanOrEqual(CANVAS.height);
    expect(RUNG.small * MAX_ZOOM).toBeLessThanOrEqual(CANVAS.width);
  });

  it('leaves the largest rung a legible shape at MIN_ZOOM', () => {
    // The other broken-renderer look: a whole scene reduced to specks of dust.
    // The largest rung is 100 CSS pixels at 0.1, wide enough that its corner
    // radius is still a curve and not a stair, so a reader can see it is the
    // same shape they were just looking at at 100x.
    expect(RUNG.large * MIN_ZOOM).toBeGreaterThanOrEqual(64);
  });

  it('gives the whole ladder room on the short axis at MIN_ZOOM', () => {
    // Zoom is CSS pixels per world unit, so the visible world is the canvas
    // divided by it: 5980 units tall at 0.1. The factor of four is headroom for
    // the largest rung plus the rest of the ladder around it, and it is a bound
    // rather than a measurement, because this file cannot see the scene's layout
    // and should not: `@dagr/render` owns where the rungs sit.
    expect(CANVAS.height / MIN_ZOOM).toBeGreaterThanOrEqual(4 * RUNG.large);
  });

  it('puts the smallest rung inside the sub-pixel fade at MIN_ZOOM', () => {
    // 10 units at 0.1 is exactly 1 CSS pixel, and the middle rung is 10. Drawn
    // at or under a pixel a signed distance field FADES toward the background
    // instead of aliasing into a flickering speck, because the coverage the
    // screen-space derivative computes falls with the shape. That fade is a
    // result the 0.1x screenshot exists to show, so the range deliberately
    // reaches into it rather than stopping above it.
    expect(RUNG.small * MIN_ZOOM).toBeLessThanOrEqual(1);
    expect(RUNG.medium * MIN_ZOOM).toBeGreaterThan(1);
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

  it('reads the two zooms the crispness screenshots are named by', () => {
    // The whole point of the feature: `#zoom=100` has to give the zoom the
    // reference image was taken at, exactly, with no gesture involved.
    expect(initialZoomFromHash('#zoom=100', FALLBACK)).toBe(100);
    expect(initialZoomFromHash('#zoom=0.1', FALLBACK)).toBe(0.1);
    expect(initialZoomFromHash('#zoom=100', FALLBACK)).toBe(MAX_ZOOM);
    expect(initialZoomFromHash('#zoom=0.1', FALLBACK)).toBe(MIN_ZOOM);
  });

  it('takes the hash with or without its leading hash mark', () => {
    // `window.location.hash` includes the `#`, and callers that already sliced
    // it off should not get a different answer.
    expect(initialZoomFromHash('#zoom=2.5', FALLBACK)).toBe(2.5);
    expect(initialZoomFromHash('zoom=2.5', FALLBACK)).toBe(2.5);
  });

  it('clamps an out-of-range zoom instead of rejecting it', () => {
    // Somebody who typed 500 wants the closest thing this camera can do, and
    // `Camera2D` throws a RangeError on 500 rather than clamping it, so the
    // choice here is between clamping and a red overlay where the demo was.
    expect(initialZoomFromHash('#zoom=500', FALLBACK)).toBe(MAX_ZOOM);
    expect(initialZoomFromHash('#zoom=0.001', FALLBACK)).toBe(MIN_ZOOM);
    expect(initialZoomFromHash('#zoom=1e9', FALLBACK)).toBe(MAX_ZOOM);
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

  it('treats zero and negatives as not a zoom rather than as clamp to MIN_ZOOM', () => {
    // The distinction worth keeping: 500 is a view this camera can approximate,
    // while 0 and -5 are not extreme views at all. They are a typo or a mangled
    // link, and answering them with 0.1 would show a plausible frame and hide
    // the mistake. `#zoom=` lands here too, because `Number('')` is 0 rather
    // than NaN, which is the coercion hole this function exists to plug.
    for (const hash of ['#zoom=0', '#zoom=-0', '#zoom=-5', '#zoom=-1e9']) {
      expect(initialZoomFromHash(hash, FALLBACK)).toBe(FALLBACK);
      expect(initialZoomFromHash(hash, FALLBACK)).not.toBe(MIN_ZOOM);
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

  it('never returns a zoom Camera2D would throw on', () => {
    // The property the call site depends on, stated once over everything above:
    // whatever the hash says, the result is a zoom the camera accepts. The
    // fallback is returned as given rather than clamped, so this holds for a
    // caller whose fallback is in range, which the zoom range suite pins for
    // INITIAL_ZOOM.
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
      expect(zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(zoom).toBeLessThanOrEqual(MAX_ZOOM);
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
