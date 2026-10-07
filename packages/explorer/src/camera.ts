/**
 * The camera's arithmetic, with no DOM and no clock.
 *
 * A camera is the plane's CSS transform: `translate(x, y) scale(scale)`, in
 * CSS pixels, over a world that is y-down. Everything here is a pure function
 * from a camera to a camera, so the hook that owns the animation frame holds
 * no arithmetic of its own and all of it is testable in Node.
 *
 * **Functions return the camera that was ASKED for, not the one allowed.**
 * `CameraLimits.constrain` is the one place a camera is clamped, and the
 * caller decides when: a target is constrained when it is set, and the eased
 * camera again when it is drawn, so a flight can cross a sparse gap without
 * being trapped against the nearest node on the way.
 *
 * **A frame is the part of the viewport nothing covers,** such as the area
 * left of an open drawer. Limits, the fit, a focus and a reveal all work in
 * it, so content can be panned out from under an overlay and a flight lands
 * where it can be seen. A size alone is a frame over the whole viewport. What
 * is mounted, `visibleWorld`, still covers the whole viewport.
 *
 * Limits come from `Camera2D` in `@prnt/dagr-render/core`, which speaks a
 * y-up world with a center and a zoom. The conversion to and from this
 * module's top-left, y-down camera lives in `createCameraLimits` and nowhere
 * else.
 *
 * Internal to the package. Only the `ExplorerCamera` type is exported from
 * the entry, because `ExplorerCameraSource` hands one out.
 */

import { Camera2D, fitZoom } from '@prnt/dagr-render/core';
import type { ExplorerBox, ExplorerLayout } from './layout.js';
import type { Vec2 } from '@prnt/dagr-render/core';

export interface ExplorerCamera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}
export interface ExplorerViewportSize {
  readonly width: number;
  readonly height: number;
}
/** A rect in viewport CSS pixels. Without `x` and `y`, it starts at the viewport's top left. */
export interface CameraFrame extends ExplorerViewportSize {
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}
/** CSS pixels taken off each side of the viewport. */
export interface ExplorerInset {
  readonly top?: number | undefined;
  readonly right?: number | undefined;
  readonly bottom?: number | undefined;
  readonly left?: number | undefined;
}
/** A box on screen, as `getBoundingClientRect` reports one. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface CameraLimits {
  readonly minScale: number;
  readonly maxScale: number;
  /**
   * Throws a `RangeError` for a camera whose `scale` is not a positive finite
   * number or whose `x` or `y` is not finite, because `Camera2D` validates
   * what it is given. Callers hold cameras that came from these functions.
   */
  constrain(camera: ExplorerCamera): ExplorerCamera;
}

export const CONTENT_PADDING = 0.05;
/** The range `Camera2D` accepts for a padding. */
const MAX_CONTENT_PADDING = 0.45;
/** The narrowest and shortest a frame may be, at least, before its insets are ignored. */
const MIN_FRAME_WIDTH = 160;
const MIN_FRAME_HEIGHT = 120;
const MIN_FRAME_SHARE = 0.25;
export const FOCUS_MARGIN = 24;
export const REVEAL_MARGIN = 12;
export const EASE_MS = 55;

export const frameCenter = (frame: CameraFrame): Vec2 => ({
  x: (frame.x ?? 0) + frame.width / 2,
  y: (frame.y ?? 0) + frame.height / 2,
});

/** A padding `Camera2D` accepts: a finite value clamped into [0, 0.45], anything else the default. */
function paddingOf(padding: number): number {
  if (!Number.isFinite(padding)) return CONTENT_PADDING;
  return Math.max(0, Math.min(MAX_CONTENT_PADDING, padding));
}

/**
 * The viewport less the insets, the largest on each side. A negative or
 * non-finite inset counts as none, and an axis the insets would squeeze under
 * its minimum keeps the whole viewport: a drawer as wide as a phone must not
 * shrink the graph to nothing.
 */
export function cameraFrame(viewport: ExplorerViewportSize, ...insets: readonly ExplorerInset[]): CameraFrame {
  const side = (key: keyof ExplorerInset): number => {
    let most = 0;
    for (const inset of insets) {
      const value = inset[key];
      if (value !== undefined && Number.isFinite(value) && value > most) most = value;
    }
    return most;
  };
  const axis = (extent: number, start: number, end: number, least: number): [number, number] => {
    const remaining = extent - start - end;
    return remaining < Math.max(least, extent * MIN_FRAME_SHARE) ? [0, extent] : [start, remaining];
  };
  const [x, width] = axis(viewport.width, side('left'), side('right'), MIN_FRAME_WIDTH);
  const [y, height] = axis(viewport.height, side('top'), side('bottom'), MIN_FRAME_HEIGHT);
  return { x, y, width, height };
}

/**
 * What an overlay takes off the viewport: one side, by the overlap, when the
 * overlay touches that side (within a pixel) and spans at least half of it.
 * Of the sides it qualifies on, the one it reaches in from least as a share
 * of its axis, so a drawer the full height of the viewport insets the side it
 * is docked to however wide it is.
 */
export function obstructionInset(viewport: ScreenRect, overlay: ScreenRect): ExplorerInset {
  const left = Math.max(viewport.left, overlay.left);
  const right = Math.min(viewport.right, overlay.right);
  const top = Math.max(viewport.top, overlay.top);
  const bottom = Math.min(viewport.bottom, overlay.bottom);
  const across = right - left;
  const down = bottom - top;
  if (!(across > 0) || !(down > 0)) return {};
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  const sides: [keyof ExplorerInset, number, number][] = [];
  if (down >= height / 2) {
    if (near(overlay.left, viewport.left) || overlay.left < viewport.left) sides.push(['left', right - viewport.left, width]);
    if (near(overlay.right, viewport.right) || overlay.right > viewport.right) sides.push(['right', viewport.right - left, width]);
  }
  if (across >= width / 2) {
    if (near(overlay.top, viewport.top) || overlay.top < viewport.top) sides.push(['top', bottom - viewport.top, height]);
    if (near(overlay.bottom, viewport.bottom) || overlay.bottom > viewport.bottom) sides.push(['bottom', viewport.bottom - top, height]);
  }
  let best: [keyof ExplorerInset, number, number] | null = null;
  for (const each of sides) if (best === null || each[1] / each[2] < best[1] / best[2]) best = each;
  return best === null ? {} : { [best[0]]: best[1] };
}

/** `padding` is the fraction of the frame the content may be panned past its edge. */
export function createCameraLimits(
  layout: ExplorerLayout,
  frame: CameraFrame,
  padding: number = CONTENT_PADDING,
): CameraLimits | null {
  if (!(frame.width > 0) || !(frame.height > 0) || !(layout.width > 0) || !(layout.height > 0)) {
    return null;
  }
  const middle = frameCenter(frame);
  const limiter = new Camera2D({
    viewport: { width: frame.width, height: frame.height, devicePixelRatio: 1 },
  });
  let detail = { width: 160, height: 80 };
  let best = 0;
  const regions = [];
  for (const box of layout.boxes.values()) {
    const zoom = fitZoom({ minX: 0, minY: 0, maxX: box.width, maxY: box.height }, limiter.viewport);
    if (zoom > best) {
      best = zoom;
      detail = { width: box.width, height: box.height };
    }
    regions.push({
      minX: box.x,
      maxX: box.x + box.width,
      minY: -box.y - box.height,
      maxY: -box.y,
    });
  }
  limiter.setContentBounds(
    { minX: 0, maxX: layout.width, minY: -layout.height, maxY: 0 },
    detail,
    paddingOf(padding),
    regions,
  );
  return {
    minScale: limiter.minZoom,
    maxScale: limiter.maxZoom,
    constrain(camera) {
      limiter.setZoom(camera.scale);
      limiter.setCenter({
        x: (middle.x - camera.x) / limiter.zoom,
        y: -(middle.y - camera.y) / limiter.zoom,
      });
      return {
        x: middle.x - limiter.center.x * limiter.zoom,
        y: middle.y + limiter.center.y * limiter.zoom,
        scale: limiter.zoom,
      };
    },
  };
}

export function fitCamera(
  layout: ExplorerLayout,
  frame: CameraFrame,
  limits: CameraLimits,
): ExplorerCamera {
  const scale = limits.minScale;
  const middle = frameCenter(frame);
  return {
    x: middle.x - (layout.width * scale) / 2,
    y: middle.y - (layout.height * scale) / 2,
    scale,
  };
}

/** Divides by `camera.scale`: expects a positive scale, as every camera from `fitCamera` and `constrain` has. */
export function zoomCamera(
  camera: ExplorerCamera,
  factor: number,
  anchor: Vec2,
  limits: CameraLimits,
): ExplorerCamera {
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, camera.scale * factor));
  const ratio = scale / camera.scale;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    scale,
  };
}

export function panCamera(camera: ExplorerCamera, dx: number, dy: number): ExplorerCamera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

export function focusCamera(
  box: ExplorerBox,
  frame: CameraFrame,
  limits: CameraLimits,
): ExplorerCamera {
  const fill = Math.min(
    (frame.width - FOCUS_MARGIN * 2) / box.width,
    (frame.height - FOCUS_MARGIN * 2) / box.height,
  );
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, fill));
  const middle = frameCenter(frame);
  return {
    x: middle.x - (box.x + box.width / 2) * scale,
    y: middle.y - (box.y + box.height / 2) * scale,
    scale,
  };
}

export function revealCamera(
  camera: ExplorerCamera,
  box: ExplorerBox,
  frame: CameraFrame,
): ExplorerCamera {
  // `lo` and `hi` are measured from the frame's own edge.
  const axis = (offset: number, start: number, size: number, extent: number, origin: number): number => {
    const lo = offset + start * camera.scale - origin;
    const hi = lo + size * camera.scale;
    if (hi - lo > extent - REVEAL_MARGIN * 2) return offset + (extent / 2 - (lo + hi) / 2);
    if (lo < REVEAL_MARGIN) return offset + (REVEAL_MARGIN - lo);
    if (hi > extent - REVEAL_MARGIN) return offset + (extent - REVEAL_MARGIN - hi);
    return offset;
  };
  return {
    x: axis(camera.x, box.x, box.width, frame.width, frame.x ?? 0),
    y: axis(camera.y, box.y, box.height, frame.height, frame.y ?? 0),
    scale: camera.scale,
  };
}

/** Divides by `camera.scale`: expects a positive scale, as every camera from `fitCamera` and `constrain` has. */
export function visibleWorld(camera: ExplorerCamera, viewport: ExplorerViewportSize): ExplorerBox {
  return {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    width: viewport.width / camera.scale,
    height: viewport.height / camera.scale,
  };
}

/** Divides by `camera.scale`: expects a positive scale, as every camera from `fitCamera` and `constrain` has. */
export function screenToWorld(camera: ExplorerCamera, point: Vec2): Vec2 {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function easeCamera(
  current: ExplorerCamera,
  target: ExplorerCamera,
  elapsedMs: number,
): ExplorerCamera {
  const alpha = 1 - Math.exp(-Math.max(0, Math.min(64, elapsedMs)) / EASE_MS);
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
    scale: current.scale + (target.scale - current.scale) * alpha,
  };
}

export function cameraSettled(current: ExplorerCamera, target: ExplorerCamera): boolean {
  return (
    Math.abs(current.x - target.x) + Math.abs(current.y - target.y) < 0.05 &&
    Math.abs(current.scale - target.scale) < 0.0001
  );
}
