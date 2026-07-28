import type { Vec2 } from '@dagr/render';

/**
 * The arithmetic between a DOM input event and a {@link Camera2D} call.
 *
 * Extracted out of `FirstLight.tsx` because it is the only part of the demo's
 * interaction layer that a test can reach without a canvas, a GPU adapter and a
 * live layout. The parameter types are the narrowest structural shapes these
 * functions actually read rather than `WheelEvent` and `DOMRect`, which is what
 * lets the suite call them with plain object literals; a real event and a real
 * bounding rect satisfy them.
 */

/**
 * Pixels a line of `deltaMode === 1` scrolling stands for.
 *
 * Firefox reports wheel deltas in lines rather than pixels, and the DOM gives
 * no way to ask how tall a line is here, so this is a convention: 16 is the
 * default `font-size` and therefore roughly one line of body text. Being a few
 * pixels out changes how fast a Firefox wheel zooms and nothing else.
 */
export const WHEEL_LINE_HEIGHT = 16;

/** Pixels a page of `deltaMode === 2` scrolling stands for, on the same terms. */
export const WHEEL_PAGE_HEIGHT = 400;

/**
 * Zoom response, in e-folds per pixel of wheel travel.
 *
 * At 0.0015, a 100 pixel notch (one detent on a typical mouse) changes the zoom
 * by about 16%, which is brisk without overshooting a target on one flick.
 */
export const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * The largest wheel delta, in pixels, that one event is allowed to mean.
 *
 * A trackpad fling in Safari can report several thousand pixels in a single
 * event, and an unclamped exponential turns that into a factor of e^4 or worse:
 * the view jumps from readable to a dot between two frames, with nothing on
 * screen to say which way to scroll back. Clamping costs a fast gesture
 * nothing, because the events keep arriving and the factors compose.
 */
export const WHEEL_MAX_PIXELS = 200;

/**
 * The zoom the demo's camera starts at, and how far the wheel may take it, in
 * CSS pixels per world unit.
 *
 * Next to {@link WHEEL_MAX_PIXELS} rather than in `FirstLight.tsx` because the
 * two are halves of one decision and neither is right on its own. That clamp
 * bounds ONE event and cannot bound a gesture: {@link wheelZoomFactor} is
 * exponential and exponentials compose exactly, which its docstring rightly
 * calls a feature. Thirty saturated events are an ordinary trackpad fling and
 * multiply the zoom by e^9, about 8100x. **So the RANGE is what stops a fling,
 * and it is the only thing that does.**
 *
 * ## M4.2 widened this, and replaced the argument behind it
 *
 * The range was 0.2 to 12, chosen so that neither limit could be mistaken for a
 * broken renderer: at 12 the quad's top and bottom edges were both still on
 * screen instead of amber filling the frame, and at 0.2 it was 20 by 8 CSS
 * pixels, small but unmistakably a rectangle. Both bounds are gone, because the
 * roadmap asks M4.2 for a screenshot of the same shape at 0.1x AND at 100x as
 * the crispness reference, and neither was reachable.
 *
 * The old failures are still real; they are prevented somewhere else now.
 *
 * **At 100 the frame is a flat amber field unless the camera also moves**, and
 * that is exactly what the old MAX_ZOOM existed to stop. A 100 by 40 shape at
 * zoom 100 covers 10000 by 4000 CSS pixels, so a stage under 800 pixels tall is
 * entirely inside it. The fix is {@link ZOOM_PRESETS}, which recentres on a
 * corner of the rounded rectangle rather than only changing the zoom: a curved
 * edge crossing the frame is the thing the screenshot has to show, and it is
 * also the only frame at that zoom that proves anything about crispness.
 *
 * **At 0.1 the shape is 10 by 4 CSS pixels**, which the old MIN_ZOOM would have
 * rejected as a speck. It is the point: at that size an edge either resolves
 * cleanly or it sparkles, and analytic antialiasing from the distance field is
 * the claim under test. A speck is a bad DEFAULT view and a good reference
 * frame, which is why 0.1 is a preset a user chooses rather than where the demo
 * opens.
 *
 * {@link INITIAL_ZOOM} is unchanged at 3, which frames both shapes with room
 * around them on any stage this page produces.
 */
export const INITIAL_ZOOM = 3;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 100;

/**
 * The rounded rectangle `@dagr/render` draws, in world units.
 *
 * A COPY, on purpose, and the same copy `test/camera-input.test.ts` has always
 * kept. These numbers are internal to `@dagr/render`: `shapes.ts` owns them and
 * `index.ts` deliberately exports nothing from it, because they are three.js
 * node parameters and no three type may reach this package's surface. Importing
 * them would mean widening a public API so that a demo could position a camera.
 *
 * The cost of the copy is that this file goes stale if the scene moves, and the
 * symptom would be a 100x preset pointing at empty background. That is a
 * screenshot away from obvious, and it is the cheaper of the two mistakes.
 */
export const SHOWCASE_RECT = {
  width: 100,
  height: 40,
  radius: 10,
  center: { x: -90, y: 0 },
} as const;

/**
 * Where the camera looks at 100x: a point ON the rounded rectangle's top-left
 * corner arc, 45 degrees around it.
 *
 * The arc's centre is one radius in from each edge, and the point 45 degrees
 * around it is `radius / sqrt(2)` away on both axes. Choosing a point ON the
 * boundary rather than the arc's centre matters at this zoom: an 1100 by 600
 * stage at zoom 100 sees 11 by 6 world units, which is smaller than the 10 unit
 * radius, so centring on the arc's centre would put the whole curve off screen
 * and show flat amber, which is the failure this preset exists to avoid. The 45
 * degree point puts the boundary through the middle of the frame at its
 * steepest, with fill on one side and glow on the other.
 */
export const CORNER_FOCUS: Vec2 = cornerFocus();

/** {@link CORNER_FOCUS}, as arithmetic rather than as four magic numbers. */
function cornerFocus(): Vec2 {
  const { width, height, radius, center } = SHOWCASE_RECT;
  const arcX = center.x - width / 2 + radius;
  const arcY = center.y + height / 2 - radius;
  const diagonal = radius / Math.SQRT2;
  return { x: arcX - diagonal, y: arcY + diagonal };
}

/** One button on the demo's zoom bar: a zoom AND the point to look at. */
export interface ZoomPreset {
  /** Stable across renders, for a React key and for a test to name one. */
  readonly id: string;
  readonly label: string;
  readonly zoom: number;
  readonly center: Vec2;
}

/**
 * The reproducible views the demo's buttons set.
 *
 * **Buttons rather than a scroll gesture, because a screenshot has to be
 * repeatable.** "Zoom out a lot" is not a view: two people, or the same person
 * on two trackpads, land on different numbers, and a crispness reference
 * comparing two frames taken at unknown zooms compares nothing. Each preset
 * pins both halves of the camera state, so the frame is a function of the code
 * rather than of the gesture.
 *
 * Each carries a CENTRE as well as a zoom, and that is the part that is easy to
 * leave out. A preset that only set the zoom would put the 100x frame wherever
 * the user had last panned to, which at that magnification is almost certainly
 * flat amber or flat background: see {@link CORNER_FOCUS}.
 */
export const ZOOM_PRESETS: readonly ZoomPreset[] = [
  { id: 'far', label: '0.1x', zoom: 0.1, center: { x: 0, y: 0 } },
  { id: 'unit', label: '1x', zoom: 1, center: { x: 0, y: 0 } },
  { id: 'fit', label: '3x', zoom: INITIAL_ZOOM, center: { x: 0, y: 0 } },
  { id: 'corner', label: '100x', zoom: 100, center: CORNER_FOCUS },
];

/** The part of a `WheelEvent` that {@link wheelPixels} reads. */
export interface WheelLike {
  readonly deltaY: number;
  readonly deltaMode: number;
}

/** The part of a `PointerEvent` (or any `MouseEvent`) a canvas point needs. */
export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** The part of a `DOMRect` a canvas point needs. */
export interface ClientRect {
  readonly left: number;
  readonly top: number;
}

/**
 * A wheel event's vertical travel in CSS pixels, normalised across the three
 * `deltaMode` units and clamped to {@link WHEEL_MAX_PIXELS}.
 *
 * A non-finite delta reports 0, meaning "this event moves nothing". That is a
 * fallback with a genuinely neutral answer, unlike the ones `Camera2D` refuses:
 * there is no zoom that a `NaN` wheel event wanted, and the useful behaviour is
 * to ignore the event rather than to throw out of a listener.
 */
export function wheelPixels(event: WheelLike): number {
  const scale =
    event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
  const pixels = event.deltaY * scale;
  if (!Number.isFinite(pixels)) return 0;
  return Math.min(WHEEL_MAX_PIXELS, Math.max(-WHEEL_MAX_PIXELS, pixels));
}

/**
 * The multiplier to hand `Camera2D.zoomAtScreen` for one wheel event.
 *
 * Exponential rather than linear, and that is the whole reason this is a
 * function rather than one inline expression. Zoom is a scale, so the operation
 * a user expects to be uniform is multiplication: two notches should zoom the
 * same amount whether they start at zoom 0.1 or zoom 10, which `exp` gives and
 * `1 + k * delta` does not. Exponential also composes exactly, so a fast
 * gesture delivered as one big event and the same gesture delivered as ten
 * small ones land on the same zoom, and it can never produce a factor of zero
 * or a negative one, both of which `zoomAtScreen` rejects outright.
 *
 * The sign: `deltaY` is positive when the wheel scrolls away from the user,
 * which every map and every canvas treats as zooming OUT, so the exponent is
 * negated and the factor comes out below 1.
 */
export function wheelZoomFactor(event: WheelLike): number {
  return Math.exp(-wheelPixels(event) * WHEEL_ZOOM_SPEED);
}

/**
 * Turns a pointer or wheel event's viewport coordinates into CSS pixels from
 * the canvas's top-left corner, which is the space `Camera2D` calls "screen".
 *
 * `getBoundingClientRect` rather than `offsetX` and `offsetY`, even though
 * those are already canvas-relative. `offsetX` is relative to the event's
 * TARGET, which during a pointer capture or a drag that leaves the canvas is
 * not the canvas, and it is missing from a synthetic event a test writes. The
 * rect is passed in rather than measured here so this stays pure, and so the
 * caller can measure once for a burst of events if it ever needs to.
 */
export function canvasPoint(event: ClientPoint, rect: ClientRect): Vec2 {
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
