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
 * Limits come from `Camera2D` in `@prnt/dagr-render/core`, which speaks a
 * y-up world with a center and a zoom. The conversion to and from this
 * module's top-left, y-down camera lives in `createCameraLimits` and nowhere
 * else.
 *
 * Internal to the package. Nothing here is exported from the entry.
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
export const FOCUS_MARGIN = 24;
export const REVEAL_MARGIN = 12;
export const EASE_MS = 55;

export function createCameraLimits(
  layout: ExplorerLayout,
  viewport: ExplorerViewportSize,
): CameraLimits | null {
  if (!(viewport.width > 0) || !(viewport.height > 0) || !(layout.width > 0) || !(layout.height > 0)) {
    return null;
  }
  const limiter = new Camera2D({
    viewport: { width: viewport.width, height: viewport.height, devicePixelRatio: 1 },
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
    CONTENT_PADDING,
    regions,
  );
  return {
    minScale: limiter.minZoom,
    maxScale: limiter.maxZoom,
    constrain(camera) {
      limiter.setZoom(camera.scale);
      limiter.setCenter({
        x: (viewport.width / 2 - camera.x) / limiter.zoom,
        y: -(viewport.height / 2 - camera.y) / limiter.zoom,
      });
      return {
        x: viewport.width / 2 - limiter.center.x * limiter.zoom,
        y: viewport.height / 2 + limiter.center.y * limiter.zoom,
        scale: limiter.zoom,
      };
    },
  };
}

export function fitCamera(
  layout: ExplorerLayout,
  viewport: ExplorerViewportSize,
  limits: CameraLimits,
): ExplorerCamera {
  const scale = limits.minScale;
  return {
    x: (viewport.width - layout.width * scale) / 2,
    y: (viewport.height - layout.height * scale) / 2,
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
  viewport: ExplorerViewportSize,
  limits: CameraLimits,
): ExplorerCamera {
  const fill = Math.min(
    (viewport.width - FOCUS_MARGIN * 2) / box.width,
    (viewport.height - FOCUS_MARGIN * 2) / box.height,
  );
  const scale = Math.max(limits.minScale, Math.min(limits.maxScale, fill));
  return {
    x: viewport.width / 2 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
    scale,
  };
}

export function revealCamera(
  camera: ExplorerCamera,
  box: ExplorerBox,
  viewport: ExplorerViewportSize,
): ExplorerCamera {
  const axis = (offset: number, start: number, size: number, extent: number): number => {
    const lo = offset + start * camera.scale;
    const hi = lo + size * camera.scale;
    if (hi - lo > extent - REVEAL_MARGIN * 2) return offset + (extent / 2 - (lo + hi) / 2);
    if (lo < REVEAL_MARGIN) return offset + (REVEAL_MARGIN - lo);
    if (hi > extent - REVEAL_MARGIN) return offset + (extent - REVEAL_MARGIN - hi);
    return offset;
  };
  return {
    x: axis(camera.x, box.x, box.width, viewport.width),
    y: axis(camera.y, box.y, box.height, viewport.height),
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
