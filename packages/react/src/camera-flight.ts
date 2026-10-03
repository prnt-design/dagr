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
  const clamped = Math.min(1, Math.max(0, t));
  const eased = clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
  return {
    center: {
      x: from.center.x + (to.center.x - from.center.x) * eased,
      y: from.center.y + (to.center.y - from.center.y) * eased,
    },
    zoom: from.zoom * (to.zoom / from.zoom) ** eased,
  };
}

/** A flight in progress. */
export interface CameraFlight {
  /** Stops where it is. Idempotent, and a no-op after the flight finished. */
  cancel(): void;
}

/**
 * Moves `camera` to `target` over `durationMs`, one `requestAnimationFrame`
 * step at a time, calling `onStep` after each so the host can redraw.
 *
 * A duration of zero (or below) jumps in the same call and never schedules a
 * frame, which is also what a host honouring `prefers-reduced-motion` asks
 * for. Each step goes through `setZoom` then `setCenter`, so the camera's own
 * limits clamp every intermediate state and a target outside the content
 * limits lands on the nearest legal view rather than throwing.
 */
export function flyCamera(
  camera: Camera2D,
  target: CameraTarget,
  durationMs: number,
  onStep: () => void,
): CameraFlight {
  const apply = (state: CameraTarget): void => {
    camera.setZoom(state.zoom);
    camera.setCenter(state.center);
  };
  if (!(durationMs > 0)) {
    apply(target);
    onStep();
    return { cancel() {} };
  }
  const from: CameraTarget = { center: camera.center, zoom: camera.zoom };
  let start: number | null = null;
  let handle: number | null = null;
  const step = (now: number): void => {
    handle = null;
    start ??= now;
    const t = (now - start) / durationMs;
    apply(interpolateCamera(from, target, t));
    onStep();
    if (t < 1) handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return {
    cancel() {
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
