import type { Vec2 } from './types.js';

/**
 * The value checks this package shares, and the rule they implement.
 *
 * **An out-of-range value is a `RangeError` naming the field.** That is the
 * package rule `errors.ts` states, and these functions are how it is applied
 * without re-deciding at each call site. The field name is the whole value of
 * the message: `nodeSize("n1").width` or `maxElements` tells a caller which
 * line they wrote is wrong, where "invalid argument" sends them looking.
 *
 * Nothing here falls back to a default. A fallback is only acceptable where
 * there is a NEUTRAL answer, and there is none for any of these: a zoom of
 * `NaN` has no sensible substitute, and picking one turns a caller's arithmetic
 * bug into a view that is silently in the wrong place, three frames and one
 * animation loop away from the line that caused it.
 *
 * These lived in `camera.ts` until the overlay needed the same three. Moved
 * rather than copied: two copies of a validator drift, and the one that drifts
 * is always the one whose error message a test does not assert.
 *
 * {@link requireNonNegative} and {@link requireColor} arrived the same way at
 * M4.3, out of `sdf.ts`, which had grown its own private copy of
 * {@link requireFinite} beside them. The instanced path validates the same
 * colours and the same non-negative reaches that a `ShapeStyle` does, one
 * instance at a time instead of one style at a time, so the choice was a third
 * copy or a move. The messages are unchanged, which is what makes the move
 * invisible to `test/sdf.test.ts`.
 */

/** Rejects a value that is not a finite number, naming the field. */
export function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} has to be a finite number, got ${String(value)}`);
  }
  return value;
}

/** Rejects a value that is not a finite number strictly greater than zero. */
export function requirePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} has to be a finite number above zero, got ${String(value)}`);
  }
  return value;
}

/**
 * Rejects a value that is not a finite number at or above `min`.
 *
 * Separate from {@link requirePositive} because "at least one element" and
 * "above zero" are different bounds and a cap of 0.5 is not a cap: it is a
 * number that silently means the same as 1 after the comparison it feeds.
 */
export function requireAtLeast(value: number, min: number, field: string): number {
  if (!Number.isFinite(value) || value < min) {
    throw new RangeError(
      `${field} has to be a finite number of at least ${String(min)}, got ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a value that is not a finite number at or above zero. */
export function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} has to be a finite number at or above zero, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Rejects a colour that is not a 24-bit `0xRRGGBB` integer.
 *
 * The same check `createRenderer` applies to `clearColor`, for the same measured
 * reason: three's `Color.setHex` validates nothing, and against 0.185.1 `NaN`
 * and `Infinity` both come out #000000 while `-1` and `0x1ffffff` both saturate
 * to #ffffff. A shape that silently turns black on a near-black background is a
 * shape that is not there.
 */
export function requireColor(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(
      `${field} has to be an integer between 0x000000 and 0xffffff, got ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a point with a non-finite coordinate, naming which one. */
export function requireFinitePoint(point: Vec2, field: string): Vec2 {
  requireFinite(point.x, `${field}.x`);
  requireFinite(point.y, `${field}.y`);
  return { x: point.x, y: point.y };
}
