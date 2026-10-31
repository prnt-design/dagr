import type { Vec2 } from './geometry.js';

/** A camera-independent change in viewport CSS pixels: pan first, then zoom at anchor. */
export interface PinchDelta {
  readonly pan: Vec2;
  readonly anchor: Vec2;
  readonly factor: number;
}

/**
 * Tracks at most two contacts. Feed touch pointers only, in one surface's
 * CSS coordinate space. Event capture, scroll ownership and click suppression
 * belong to the adapter. `up` handles both release and cancellation.
 */
export interface PinchGesture {
  readonly size: number;
  /** A snapshot, safe to retain while releasing pointer capture. */
  readonly pointerIds: readonly number[];
  has(pointerId: number): boolean;
  /** False for a duplicate, third contact or non-finite input. */
  down(pointerId: number, point: Vec2): boolean;
  /** Null until two contacts are down, or for an unknown/invalid move. */
  move(pointerId: number, point: Vec2): PinchDelta | null;
  up(pointerId: number): boolean;
  reset(): void;
}

/**
 * Shared touch geometry for SVG, DOM and GPU surfaces. No browser or renderer
 * is accessed. A third contact is ignored until a new down after a slot opens.
 * Coincident fingers translate without zoom; the next separated pair establishes
 * a new zoom baseline. Screen pixels are never multiplied by devicePixelRatio.
 */
export function createPinchGesture(): PinchGesture {
  const points = new Map<number, Vec2>();
  const finite = (point: Vec2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
  const reading = (): { mid: Vec2; distance: number } | null => {
    const [a, b] = points.values();
    if (a === undefined || b === undefined) return null;
    return {
      mid: { x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 },
      distance: Math.hypot(b.x - a.x, b.y - a.y),
    };
  };
  return {
    get size() { return points.size; },
    get pointerIds() { return [...points.keys()]; },
    has: (id) => points.has(id),
    down(id, point) {
      if (!Number.isFinite(id) || !finite(point) || points.has(id) || points.size === 2) return false;
      points.set(id, { x: point.x, y: point.y });
      return true;
    },
    move(id, point) {
      if (!points.has(id) || !finite(point)) return null;
      const before = reading();
      points.set(id, { x: point.x, y: point.y });
      const after = reading();
      if (before === null || after === null) return null;
      const pan = { x: after.mid.x - before.mid.x, y: after.mid.y - before.mid.y };
      if (!finite(pan)) return null;
      const ratio = before.distance > 0 && after.distance > 0 ? after.distance / before.distance : 1;
      return { pan, anchor: after.mid, factor: Number.isFinite(ratio) && ratio > 0 ? ratio : 1 };
    },
    up: (id) => points.delete(id),
    reset: () => points.clear(),
  };
}
