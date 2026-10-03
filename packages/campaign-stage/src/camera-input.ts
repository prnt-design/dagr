import { fitZoom } from '@prnt/dagr-render';
import type { WorldBounds } from '@prnt/dagr-render';

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

export { FIT, ZOOM_IN, ZOOM_OUT, canvasPoint, keyCommand, wheelZoomFactor } from '@prnt/dagr-render';
export type { ClientPoint, ClientRect, KeyCommand, WheelLike } from '@prnt/dagr-render';

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
 * fills the frame with the same padding.
 *
 * Both ends are `fitZoom` from `@prnt/dagr-render`, which is also what
 * `Camera2D.fitBounds` adopts, so the "0" key, the floor, and the ceiling
 * share one formula and one validation instead of three copies held together
 * by tests. The validation matters here: a zero-extent scene or node reaches
 * `fitZoom`'s RangeError with the field named, rather than deriving an
 * `Infinity` that `setZoomLimits` rejects inside a ResizeObserver callback.
 *
 * The ceiling fits the smallest node's WHOLE box rather than putting its
 * short axis across the viewport, so fully zoomed in, the node's edges are in
 * frame and the view cannot degenerate into the edge-free flat fill that
 * looks exactly like a broken renderer, which is the invariant the fixed
 * range's screenshot tests used to guard. Smallest node rather than median,
 * because scenes like the ladder span decades of node size and a
 * median-derived ceiling would strand the small nodes below readable size.
 *
 * Degenerate content (bounds tighter than the smallest node's own box) can
 * invert the pair; the two are ordered before returning so the range is
 * always one a camera accepts.
 */
export function zoomLimits(
  content: WorldBounds,
  smallestNode: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { readonly minZoom: number; readonly maxZoom: number } {
  const fit = fitZoom(content, viewport, FIT_PADDING);
  const fill = fitZoom(
    { minX: 0, minY: 0, maxX: smallestNode.width, maxY: smallestNode.height },
    viewport,
    FIT_PADDING,
  );
  return fit <= fill ? { minZoom: fit, maxZoom: fill } : { minZoom: fill, maxZoom: fit };
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

/**
 * The node a `#node=` hash names, or `null` when it names none.
 *
 * **An entry point, not a live binding**, which is the same decision
 * {@link initialZoomFromHash} records and is worth restating because the
 * temptation is different here. A `#zoom=` that tracked the camera would fight
 * the wheel; a `#node=` that tracked the camera has no obvious moment to
 * update, since there is no single node a viewport is "at". So this is read
 * ONCE, at load, and nothing writes the hash back. A reader who wants a link to
 * where they are can still build one by hand, and a reader who follows one
 * lands where it points and is then free to move.
 *
 * The id is returned verbatim, not validated against the campaign. This module
 * knows nothing about which ids exist, and a caller that has the scene can
 * answer that in one lookup; returning an id the scene will reject keeps the
 * "does this node exist" decision where the nodes are. An EMPTY id is `null`
 * rather than the empty string, because `#node=` with nothing after it is a
 * mangled link rather than a request for the node whose id is `''`.
 *
 * Parsed with `URLSearchParams` for the same reasons the zoom parser gives:
 * percent decoding, other keys, key order and repeats all come out right, and
 * the first `node` wins. Ids in this dataset are ASCII (`scene-12`), but
 * percent decoding is what makes a hand-written link to an id with a space or a
 * slash work rather than silently missing.
 */
export function nodeIdFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const raw = new URLSearchParams(body).get('node');
  if (raw === null || raw === '') return null;
  return raw;
}
