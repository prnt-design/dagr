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
 * The two zooms the demo's panes start at, and how far the wheel may take
 * either of them, in CSS pixels per world unit.
 *
 * Next to {@link WHEEL_MAX_PIXELS} rather than in `ShapeStage.tsx` because the
 * clamp and the range are halves of one decision and neither is right on its
 * own. That clamp bounds ONE event and cannot bound a gesture:
 * {@link wheelZoomFactor} is exponential and exponentials compose exactly,
 * which its docstring rightly calls a feature. Thirty saturated events are an
 * ordinary trackpad fling and multiply the zoom by e^9, about 8100x. **So the
 * RANGE is what stops a fling, and it is the only thing that does.**
 *
 * {@link OVERVIEW_ZOOM} and {@link DETAIL_ZOOM} are M4.2's requirement written
 * as numbers: the same shape at 0.1x and at 100x, three orders of magnitude
 * apart, so that one screenshot carries the claim that an edge is crisp at
 * every zoom rather than at the one it was tuned for. `scene.ts` is sized
 * against both of them and explains what each pane is for.
 *
 * **The range is one factor of two past each of those, not equal to them.** A
 * range pinned exactly at the two reference zooms would leave the overview pane
 * unable to zoom out and the detail pane unable to zoom in at all, and a wheel
 * that does nothing reads as a broken demo rather than as a limit. Two is
 * enough to feel and small enough that neither end reaches a picture that could
 * be mistaken for a broken renderer:
 *
 * - At 0.05 the hero chip is 35 by 22 CSS pixels: small, but unmistakably a
 *   rounded rectangle rather than a speck. (M4.1's range bottomed out at 0.05
 *   too and that WAS a speck, because the quad it drew was 100 by 40 world
 *   units. The limit is the same number about a scene seven times the size.)
 * - At 200 the hero's 2-unit outline is 400 CSS pixels wide, which still fits
 *   inside the 480 pixel minimum height `styles.css` gives a pane, so both
 *   edges of the band stay on screen.
 *
 * That second bullet replaces M4.1's rule, which was that the whole shape stays
 * on screen at MAX_ZOOM. It had to change: at 100x the detail pane is
 * deliberately INSIDE the hero, which is the requirement rather than an
 * accident, so a range that kept a whole shape visible would forbid the demo.
 * What has to stay visible at the top of the range is the thing being looked
 * at, and that is the outline band and the corner arc under it. See
 * `test/camera-input.test.ts`, which executes every number above.
 */
export const OVERVIEW_ZOOM = 0.1;
export const DETAIL_ZOOM = 100;
export const MIN_ZOOM = OVERVIEW_ZOOM / 2;
export const MAX_ZOOM = DETAIL_ZOOM * 2;

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
