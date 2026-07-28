import { describe, expect, it } from 'vitest';
import {
  CORNER_FOCUS,
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  SHOWCASE_RECT,
  WHEEL_LINE_HEIGHT,
  WHEEL_MAX_PIXELS,
  WHEEL_PAGE_HEIGHT,
  WHEEL_ZOOM_SPEED,
  ZOOM_PRESETS,
  canvasPoint,
  wheelPixels,
  wheelZoomFactor,
} from '../src/camera-input.js';

/**
 * The only unit-testable part of the demo.
 *
 * `FirstLight.tsx` is React glue over a GPU device: every line of it needs a
 * canvas, an adapter and a live layout, so it is verified by a screenshot the
 * way `@dagr/render`'s own renderer is. This module is the exception. It is the
 * arithmetic that sits between a DOM event and a `Camera2D` call, plus the
 * camera states the preset buttons set, and it has sign conventions, unit
 * conversions and one piece of geometry that are easy to get subtly wrong and
 * need nothing but numbers to check.
 *
 * The preset tests are worth more than they look. M4.2's deliverable is two
 * screenshots, and the failure that ruins them is not a crash: it is a 100x
 * frame that is flat amber because the camera moved nowhere, which is
 * indistinguishable from a broken renderer and which the board has already been
 * caught by once. That the focus point sits ON the shape's boundary is checkable
 * here, with no canvas.
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

/**
 * The shortest the stage ever gets, in CSS pixels.
 *
 * A copy on purpose: the stage height is `clamp(600px, 62vh, 780px)` in
 * `styles.css`, which no module can read. The shortest stage is the worst case
 * for every claim below, so a taller one only makes them truer.
 */
const SHORTEST_STAGE = 600;

/**
 * The narrowest the stage plausibly gets, in CSS pixels: a small phone, less the
 * page's 1.5rem of padding either side. Also a copy, on the same terms, and
 * also the worst case rather than the likely one.
 */
const NARROWEST_STAGE = 320 - 48;

describe('the zoom range', () => {
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

  it('reaches every preset, since Camera2D clamps a zoom rather than rejecting it', () => {
    // The failure this catches is silent, which is the whole reason it is here.
    // `Camera2D.setZoom` clamps into `[minZoom, maxZoom]`, so a 100x preset
    // against a MAX_ZOOM of 12 does not throw and does not log: it produces a
    // frame at zoom 12 with a button labelled 100x, and the screenshot that
    // frame ends up in is the crispness reference.
    for (const preset of ZOOM_PRESETS) {
      expect(preset.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(preset.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });
});

describe('the zoom presets', () => {
  const byId = (id: string): (typeof ZOOM_PRESETS)[number] => {
    const preset = ZOOM_PRESETS.find((candidate) => candidate.id === id);
    if (preset === undefined) throw new Error(`no preset ${id}`);
    return preset;
  };

  it('covers the two zooms the roadmap asks for a screenshot at', () => {
    // 0.1x and 100x are the crispness reference, so they are a requirement on
    // this list rather than a nice pair of round numbers.
    const zooms = ZOOM_PRESETS.map((preset) => preset.zoom);
    expect(zooms).toContain(0.1);
    expect(zooms).toContain(1);
    expect(zooms).toContain(100);
  });

  it('gives every preset a distinct id, which a React key and a test both need', () => {
    expect(new Set(ZOOM_PRESETS.map((preset) => preset.id)).size).toBe(ZOOM_PRESETS.length);
  });

  it('recentres at 100x rather than only changing the zoom', () => {
    // The bug this exists for, stated as an inequality because it is the only
    // way to state it. A preset that set the zoom and left the centre alone
    // would frame the world origin, which at zoom 100 is 90 world units (9000
    // CSS pixels) from either shape: an empty near-black frame, or, one pan
    // away, a flat amber one. Both look exactly like a broken renderer.
    const corner = byId('corner');
    expect(corner.zoom).toBe(100);
    expect(corner.center).not.toEqual({ x: 0, y: 0 });
  });

  it('points 100x at a point ON the rounded rectangle boundary', () => {
    // The strong version of the claim above, and the one that would catch an
    // arithmetic slip. The corner arc's centre is one radius in from each edge,
    // so a point on the arc is exactly `radius` from it. Off by a sign and the
    // camera looks at empty background; off by the radius and it looks at flat
    // fill.
    const { width, height, radius, center } = SHOWCASE_RECT;
    const arcX = center.x - width / 2 + radius;
    const arcY = center.y + height / 2 - radius;
    expect(Math.hypot(CORNER_FOCUS.x - arcX, CORNER_FOCUS.y - arcY)).toBeCloseTo(radius, 12);
  });

  it('puts the corner arc across the frame at 100x rather than past it', () => {
    // The curvature has to be visible, which is a claim about the frame's size
    // against the radius. At zoom 100 the shortest stage sees 6 world units
    // vertically, so a 10 unit radius arc centred on its own 45 degree point
    // crosses the frame from side to side. The check that matters is the other
    // way round: the arc must not be so tight that it closes inside the frame
    // and reads as a dot, nor so slack that the frame is a straight edge.
    const visible = SHORTEST_STAGE / byId('corner').zoom;
    expect(SHOWCASE_RECT.radius).toBeGreaterThan(visible / 2);
    expect(SHOWCASE_RECT.radius).toBeLessThan(visible * 10);
  });

  it('leaves both shapes inside the frame at 0.1x and at 1x', () => {
    // A preset nobody can see anything in is not a reference frame. The shapes
    // span 254 world units across (the rectangle's left edge at -140 to the
    // circle's right at 114) and 48 down, and both presets look at the origin,
    // which is not their midpoint but is within 13 units of it.
    const span = { x: 254, y: 48 };
    for (const preset of [byId('far'), byId('unit')]) {
      expect(NARROWEST_STAGE / preset.zoom).toBeGreaterThan(span.x);
      expect(SHORTEST_STAGE / preset.zoom).toBeGreaterThan(span.y);
      expect(preset.center).toEqual({ x: 0, y: 0 });
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
