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
 * The limits are 0.1 and 100 because those are the two zooms M4.2 owes a
 * committed screenshot at. The claim the task has to demonstrate is that one
 * signed distance field keeps an edge crisp at EVERY zoom rather than at one,
 * and the evidence is the same shape photographed at 0.1x and at 100x. A range
 * that stopped short of either end could not produce the reference at all, and
 * {@link initialZoomFromHash} clamps, so `#zoom=100` against a smaller MAX_ZOOM
 * would answer with something else and make the reference quietly
 * unreproducible.
 *
 * They still have to pass the older test, which is that neither end can be
 * mistaken for a broken renderer, and that is a claim about this specific scene:
 * `@dagr/render` draws a crispness ladder of rounded rects and circles about 10,
 * 100 and 1000 world units across, the smallest at or beside the world origin,
 * on a canvas that measures 1102 by 598 CSS pixels at the demo's full page width
 * (`styles.css` caps `.page` at 72rem and holds the stage at least 600 tall).
 *
 * At 0.1 the 1000-unit rung is 100 CSS pixels and still visibly a rounded
 * rectangle with a curved corner, the 100-unit rung is 10, and the 10-unit rung
 * is exactly 1. As a shape shrinks towards a pixel a distance field FADES toward
 * the background instead of aliasing into a flickering speck, because the
 * coverage the screen-space derivative computes falls away with the shape. That
 * is measured rather than assumed, and so is where it stops: at zoom 0.2 the
 * 10-unit rung draws as a 2 by 2 block of #723b0e, a dim amber against the
 * #ffb703 it is at full coverage, which is the fade. At zoom 0.1 that same rung
 * does not appear at all. Its padded quad is 1.4 by 0.8 CSS pixels there, and
 * whether a footprint that small covers a sample point at all depends on where it
 * falls on the grid: the 10-unit CIRCLE beside it survives as one dim pixel in the
 * same frame. That is a rasterisation limit rather than a shading one, and no
 * distance field can fix it, because the fragment that would have faded is never
 * shaded. The visible world is then 11020 by 5980 units, nearly six times the
 * largest rung on the short axis, which is the headroom the ladder needs to be in
 * frame.
 *
 * At 100 the 10-unit rung is 1000 CSS pixels: taller than the 598-pixel stage,
 * so it fills the view the way the 100x reference wants, and still 9% narrower
 * than the 1102-pixel canvas, so both of its side edges and two of its rounded
 * corners stay on screen and the frame is an antialiased boundary rather than a
 * flat fill. That second half holds only while the scene keeps a rung near 10
 * units and only at the demo's full page width: a narrower window pushes the
 * side edges out of frame, which is why the reference is taken maximised.
 *
 * INITIAL_ZOOM is 1, the middle of the ladder rather than the whole of it, for
 * three reasons. One CSS pixel per world unit makes the overlay's world bounds
 * and the sizes on screen literally the same numbers, which is the cheapest way
 * for a first-time reader to believe the readout. The 100-unit rung is then at
 * its natural size, which is the one size where fill, outline and glow are all
 * legible at once, and that trio is what M4.2 claims. And it is neither limit,
 * so a first flick in either direction visibly does something: about 8 saturated
 * wheel events reach 0.1 and about 16 reach 100. Framing the whole ladder
 * instead would take a number this file cannot honestly pick, because the
 * ladder's layout lives in `@dagr/render` and is not exported.
 *
 * 0.2 to 12 from zoom 3 was the range before, argued against M4.1's single 100
 * by 40 quad. Those numbers were right for that scene and are wrong for this
 * one: 12 cannot reach the magnification the crispness claim is about, and 0.2
 * puts the smallest rung at 2 pixels, which is inside the fade rather than past
 * it and therefore proves nothing about aliasing either way.
 */
export const INITIAL_ZOOM = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 100;

/**
 * The zoom to start at, taken from a URL hash like `#zoom=100`, falling back to
 * `fallback` ({@link INITIAL_ZOOM} at the only call site) for a hash that does
 * not name a usable one.
 *
 * This exists so M4.2's committed crispness screenshots are reproducible. The
 * references are the same shape at 0.1x and 100x, and a maintainer checking one
 * against the current build should be able to open the demo at `#zoom=100` and
 * see what the image shows, instead of trying to land on 100x with a trackpad
 * and then wondering whether a difference is the renderer or the gesture.
 *
 * Takes the hash verbatim, leading `#` and all, because that is exactly what
 * `window.location.hash` yields (and it yields `''` when there is no hash).
 * Parsed with `URLSearchParams` over the hash body rather than a split on `=`,
 * which gets percent decoding, other keys, key order and a repeated key right
 * for free; the FIRST `zoom` wins, as it would in a query string.
 *
 * An out-of-range number clamps into [{@link MIN_ZOOM}, {@link MAX_ZOOM}] rather
 * than falling back, because somebody who typed `#zoom=500` wants the closest
 * thing this camera can do, and `Camera2D` throws a `RangeError` on 500 rather
 * than clamping it: the alternative to clamping here is a red overlay where the
 * demo was. Zero and negatives are NOT in that group. A scale of 0 or -5 is not
 * an extreme view this camera can approximate, it is a typo or a mangled link,
 * and answering it with 0.1 would show a plausible frame and hide the mistake.
 *
 * So the `zoom <= 0` test does double duty, and its second job is the classic
 * hole here: `Number('')` is 0 rather than NaN, so `#zoom=` walks straight
 * through `Number.isFinite` and would otherwise clamp to MIN_ZOOM as though a
 * user had asked for it.
 *
 * The fallback is returned as given rather than clamped: it is the caller's own
 * constant, and clamping it would hide a bad one behind a working camera.
 */
export function initialZoomFromHash(hash: string, fallback: number): number {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const raw = new URLSearchParams(body).get('zoom');
  if (raw === null) return fallback;
  const zoom = Number(raw);
  if (!Number.isFinite(zoom) || zoom <= 0) return fallback;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

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
