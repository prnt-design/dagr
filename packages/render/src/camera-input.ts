import type { Vec2 } from './types.js';

/**
 * The arithmetic between a DOM input event and a {@link Camera2D} call, shared
 * by `DagrCanvas`'s built-in navigation and by any host that wires its own.
 *
 * Moved here from the campaign demo's private package so a host that owns its
 * camera gets the same wheel feel and key bindings as the component does, in
 * one place. The parameter types are the narrowest structural shapes these
 * functions read, so a test can call them with plain object literals and a real
 * `WheelEvent` satisfies them.
 */

/**
 * Pixels a line of `deltaMode === 1` scrolling stands for.
 *
 * Firefox reports wheel deltas in lines rather than pixels. 16 is the default
 * `font-size`, so roughly one line of body text. Being a few pixels out changes
 * how fast a Firefox wheel zooms and nothing else.
 */
export const WHEEL_LINE_HEIGHT = 16;

/** Pixels a page of `deltaMode === 2` scrolling stands for, on the same terms. */
export const WHEEL_PAGE_HEIGHT = 400;

/**
 * Zoom response, in e-folds per pixel of wheel travel. At 0.0015 a 100 pixel
 * notch changes the zoom by about 16%.
 */
export const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * The largest wheel delta, in pixels, that one event is allowed to mean. A
 * trackpad fling can report thousands of pixels in one event; clamping costs a
 * fast gesture nothing because the events keep arriving and the factors
 * compose.
 */
export const WHEEL_MAX_PIXELS = 200;

/** What a wheel event has to look like. */
export interface WheelLike {
  readonly deltaY: number;
  readonly deltaMode: number;
}

/** Vertical wheel travel in CSS pixels, line and page modes converted, then clamped. */
export function wheelPixels(event: WheelLike): number {
  const scale =
    event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
  const pixels = event.deltaY * scale;
  if (!Number.isFinite(pixels)) return 0;
  return Math.min(WHEEL_MAX_PIXELS, Math.max(-WHEEL_MAX_PIXELS, pixels));
}

/** The zoom factor one wheel event means: above 1 zooms in (wheel up), below 1 zooms out. */
export function wheelZoomFactor(event: WheelLike): number {
  return Math.exp(-wheelPixels(event) * WHEEL_ZOOM_SPEED);
}

/** The part of a pointer event {@link canvasPoint} reads. */
export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** The part of a bounding rect {@link canvasPoint} reads. */
export interface ClientRect {
  readonly left: number;
  readonly top: number;
}

/** An event's position in CSS pixels from the element's top-left, which is what a camera takes. */
export function canvasPoint(event: ClientPoint, rect: ClientRect): Vec2 {
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** One notch of keyboard zoom: half of the largest single wheel event. */
export const KEY_ZOOM_FACTOR = Math.exp((WHEEL_MAX_PIXELS / 2) * WHEEL_ZOOM_SPEED);

/** CSS pixels one arrow-key press pans. */
export const KEY_PAN_STEP = 64;

/** What a navigation key asks the camera to do. */
export type KeyCommand =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'fit' };

/** Zoom in one notch. */
export const ZOOM_IN: KeyCommand = { kind: 'zoom', factor: KEY_ZOOM_FACTOR };
/** Zoom out one notch. */
export const ZOOM_OUT: KeyCommand = { kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
/** Frame the whole graph. */
export const FIT: KeyCommand = { kind: 'fit' };

/**
 * Maps a `KeyboardEvent.key` to a camera command, or `null` for a key that is
 * not navigation.
 *
 * `+`/`=`/Up zoom in, `-`/`_`/Down zoom out, Page Up/Down zoom three notches,
 * Left/Right pan, Shift+Up/Down pan vertically, `0` and Home fit. Pan deltas
 * are {@link Camera2D.panByScreen} arguments (content follows the delta).
 */
export function keyCommand(key: string, shift = false): KeyCommand | null {
  if (shift && key === 'ArrowUp') return { kind: 'pan', dx: 0, dy: KEY_PAN_STEP };
  if (shift && key === 'ArrowDown') return { kind: 'pan', dx: 0, dy: -KEY_PAN_STEP };
  switch (key) {
    case 'ArrowUp':
    case '+':
    case '=':
      return ZOOM_IN;
    case 'ArrowDown':
    case '-':
    case '_':
      return ZOOM_OUT;
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
      return FIT;
    default:
      return null;
  }
}
