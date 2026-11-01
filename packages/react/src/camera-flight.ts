import type { Camera2D, Vec2 } from '@prnt/dagr-render';

/** Where a camera flight ends. */
export interface CameraTarget {
  readonly center: Vec2;
  readonly zoom: number;
}

/**
 * The camera state at progress `t` (0 to 1) of a flight from `from` to `to`.
 *
 * Zoom interpolates geometrically, so equal steps of `t` feel like equal
 * magnifications, and the centre interpolates linearly in world space, both
 * under an ease-in-out curve. Pure, so the endpoints and the midpoint are
 * testable without a camera or a clock.
 */
export function interpolateCamera(from: CameraTarget, to: CameraTarget, t: number): CameraTarget {
  return blendCamera(from, to, easeInOut(t));
}

function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

function blendCamera(from: CameraTarget, to: CameraTarget, eased: number): CameraTarget {
  return {
    center: {
      x: from.center.x + (to.center.x - from.center.x) * eased,
      y: from.center.y + (to.center.y - from.center.y) * eased,
    },
    zoom: from.zoom * (to.zoom / from.zoom) ** eased,
  };
}

/** A flight in progress, advanced by whoever owns the frame. */
export interface CameraFlight {
  /**
   * Advances to the frame time `nowMs` (the `requestAnimationFrame` timestamp)
   * and returns whether the flight has finished. The first call fixes the
   * start time.
   */
  step(nowMs: number): boolean;
  /**
   * Heads for `target` instead, from where the camera is now, landing when the
   * flight would have. For a target worked out in a frame that has since
   * changed.
   */
  retarget(target: CameraTarget): void;
}

/**
 * Starts a flight of `camera` to `target` over `durationMs`. It owns no
 * timer: the caller steps it from its own coalesced frame, so a flight shares
 * the frame budget with drawing and the HTML overlay instead of adding a second
 * `requestAnimationFrame` loop that could land a frame out of step with them.
 *
 * Each step goes through `setZoom` then `setCenter`, so the camera's own limits
 * clamp every intermediate state and a target outside the content limits lands
 * on the nearest legal view rather than throwing. Cancel by dropping the
 * object.
 */
export function startCameraFlight(
  camera: Camera2D,
  target: CameraTarget,
  durationMs: number,
): CameraFlight {
  let from: CameraTarget = { center: camera.center, zoom: camera.zoom };
  let to = target;
  let start: number | null = null;
  // The eased progress `from` was taken at: a retarget carries on along the
  // same curve and clock rather than starting a new ease from rest, so a frame
  // that changes on every step (a keyboard sliding in) cannot stall it.
  let base = 0;
  let reached = 0;
  return {
    step(nowMs) {
      start ??= nowMs;
      const t = durationMs > 0 ? (nowMs - start) / durationMs : 1;
      reached = easeInOut(t);
      const state = blendCamera(from, to, base < 1 ? (reached - base) / (1 - base) : 1);
      camera.setZoom(state.zoom);
      camera.setCenter(state.center);
      return t >= 1;
    },
    retarget(next) {
      from = { center: camera.center, zoom: camera.zoom };
      to = next;
      base = reached;
    },
  };
}
