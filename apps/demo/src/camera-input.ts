import type { Vec2, WorldBounds } from '@dagr/render';

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
 * The zoom the demo's camera starts at, in CSS pixels per world unit.
 *
 * 1 for the reason that survives from the fixed-range era: one CSS pixel per
 * world unit makes the overlay's world bounds and the sizes on screen
 * literally the same numbers, which is the cheapest way for a first-time
 * reader to believe the readout, and the 100-unit rung is at its natural
 * size, where fill, outline and glow are all legible at once.
 *
 * MIN_ZOOM and MAX_ZOOM used to live beside this, at 0.1 and 100, chosen for
 * M4.2's two crispness screenshots. The campaign demo's P2 replaces them with
 * {@link zoomLimits}, derived from the content and the viewport, because a
 * fixed range answers the wrong question: the range a wheel fling needs to be
 * stopped at depends on what is on screen, and "the whole graph with padding"
 * to "one node filling the view" is that answer for any scene. The 100x
 * reference stays reachable under the derived range (the max lands near 150
 * on the reference canvas); the 0.1x reference does not, deliberately, since
 * a floor at the fitted scene is exactly the "too far out" state the range
 * now exists to prevent. The 0.1x frame remains reproducible from the M4.2
 * commit, and its finding (the sub-pixel fade) is recorded in the M4.2
 * ROADMAP entry rather than re-demonstrated by every future scene.
 *
 * A range is still the ONLY thing that stops a fling, exactly as before:
 * {@link WHEEL_MAX_PIXELS} clamps one event, exponentials compose, and
 * thirty saturated events are an ordinary trackpad gesture worth e^9.
 */
export const INITIAL_ZOOM = 1;

/**
 * The fraction of the viewport left empty on each side when fitting the whole
 * scene, passed to both `Camera2D.fitBounds` and {@link zoomLimits} so the
 * "0" key and the zoom-out limit agree on what "the whole graph" looks like.
 */
export const FIT_PADDING = 0.05;

/**
 * The derived zoom range for a scene: zoom out stops where the whole content
 * is in frame with {@link FIT_PADDING}, zoom in stops where the smallest node
 * spans the viewport's short side.
 *
 * The min is the same arithmetic as `Camera2D.fitBounds`, restated here
 * because the camera computes it as a state change and this caller needs it
 * as a number to hand `setZoomLimits`; `camera-input.test.ts` pins the two
 * against each other so they cannot drift apart.
 *
 * The max is the smallest node rather than the median one, and the reason is
 * scenes like the ladder whose node sizes span decades: a median-derived max
 * would strand the small nodes below readable size. "Smallest fills the short
 * side" reads as "almost an individual node level" for uniform scenes and
 * stays generous for skewed ones.
 *
 * Degenerate content (bounds tighter than the smallest node's own extent)
 * can invert the pair; the two are ordered before returning so the range is
 * always one a camera accepts.
 */
export function zoomLimits(
  content: WorldBounds,
  smallestNodeExtent: number,
  viewport: { readonly width: number; readonly height: number },
): { readonly minZoom: number; readonly maxZoom: number } {
  const width = content.maxX - content.minX;
  const height = content.maxY - content.minY;
  const fit =
    (1 - 2 * FIT_PADDING) * Math.min(viewport.width / width, viewport.height / height);
  const fill = Math.min(viewport.width, viewport.height) / smallestNodeExtent;
  return fit <= fill ? { minZoom: fit, maxZoom: fill } : { minZoom: fill, maxZoom: fit };
}

/**
 * One keyboard zoom step, as a factor. Exactly one wheel detent
 * ({@link WHEEL_MAX_PIXELS} / 2 pixels of travel at {@link WHEEL_ZOOM_SPEED}),
 * so holding a key and rolling the wheel move at the same speed and there is
 * one zoom feel, not two.
 */
export const KEY_ZOOM_FACTOR = Math.exp(100 * WHEEL_ZOOM_SPEED);

/** One keyboard pan step, in CSS pixels. */
export const KEY_PAN_STEP = 64;

/** What one keypress asks the camera to do. */
export type KeyCommand =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'fit' };

/**
 * The key map, while the canvas has focus. `null` means "not ours": the
 * caller must not `preventDefault`, so keys like Tab keep their meaning.
 *
 * Up and Down ZOOM rather than pan, because that is the ask this map exists
 * to satisfy: with the visualization focused, the keys that would scroll the
 * page zoom the scene instead. Vertical panning moves to Shift+Up/Down;
 * Left and Right pan horizontally, since nothing else wants them. The pan
 * deltas are in `panByScreen`'s drag convention (the content follows the
 * delta), so panning the VIEW left means a positive dx.
 */
export function keyCommand(key: string, shift = false): KeyCommand | null {
  if (shift && key === 'ArrowUp') return { kind: 'pan', dx: 0, dy: KEY_PAN_STEP };
  if (shift && key === 'ArrowDown') return { kind: 'pan', dx: 0, dy: -KEY_PAN_STEP };
  switch (key) {
    case 'ArrowUp':
    case '+':
    case '=':
      return { kind: 'zoom', factor: KEY_ZOOM_FACTOR };
    case 'ArrowDown':
    case '-':
    case '_':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
    case 'PageUp':
      return { kind: 'zoom', factor: KEY_ZOOM_FACTOR ** 3 };
    case 'PageDown':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR ** 3 };
    case 'ArrowLeft':
      return { kind: 'pan', dx: KEY_PAN_STEP, dy: 0 };
    case 'ArrowRight':
      return { kind: 'pan', dx: -KEY_PAN_STEP, dy: 0 };
    case '0':
    case 'Home':
      return { kind: 'fit' };
    default:
      return null;
  }
}

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
 * An out-of-range number is returned AS PARSED rather than clamped here, which
 * is a change from the fixed-range era with the same outcome for the user who
 * typed `#zoom=500`: the demo's limits are now derived from the scene at the
 * first viewport measurement (see {@link zoomLimits}), and `setZoomLimits`
 * clamps the camera's current zoom when they land. This function cannot clamp
 * correctly any more, because at parse time the viewport has not been measured
 * and the limits do not exist yet. The camera is built with its default
 * unbounded range, so any positive finite zoom is legal to start at, for the
 * one frame at most that can be drawn before the first measurement.
 *
 * Zero and negatives still fall back. A scale of 0 or -5 is not an extreme
 * view a camera can approximate, it is a typo or a mangled link, and clamping
 * it would show a plausible frame and hide the mistake. The `zoom <= 0` test
 * does double duty, and its second job is the classic hole here: `Number('')`
 * is 0 rather than NaN, so `#zoom=` walks straight through `Number.isFinite`
 * and would otherwise read as a request for the minimum.
 *
 * The fallback is returned as given rather than validated: it is the caller's
 * own constant, and second-guessing it would hide a bad one behind a working
 * camera.
 */
export function initialZoomFromHash(hash: string, fallback: number): number {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const raw = new URLSearchParams(body).get('zoom');
  if (raw === null) return fallback;
  const zoom = Number(raw);
  if (!Number.isFinite(zoom) || zoom <= 0) return fallback;
  return zoom;
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
