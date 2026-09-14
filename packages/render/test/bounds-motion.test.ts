import { describe, expect, it } from 'vitest';
import { createBoundsMotion } from '../src/bounds-motion.js';
import { DEFAULT_MOTION_HALF_LIFE, DEFAULT_MOTION_REST } from '../src/motion.js';
import { omegaForHalfLife, stepSpring2D } from '../src/spring.js';
import type { WorldBounds } from '../src/types.js';

/**
 * The bounds half of the delta consumer, under a clock this file owns.
 *
 * A box is four numbers, and the question this suite settles is which four are
 * sprung. The module springs the CENTRE and the HALF-EXTENTS rather than the two
 * corners, so a box released from rest never turns inside out on the way: each
 * corner is then a sum of two springs that move together, and the tests below
 * hold the module to a box that stays ordered at every frame.
 */

function box(minX: number, minY: number, maxX: number, maxY: number): WorldBounds {
  return { minX, minY, maxX, maxY };
}

function settle(
  motion: ReturnType<typeof createBoundsMotion>,
  dt = 1 / 60,
  bound = 600,
): WorldBounds | null {
  for (let frame = 0; frame < bound; frame += 1) {
    const result = motion.advance(dt);
    if (result.settled) return result.bounds;
  }
  throw new Error(`did not settle within ${String(bound)} frames`);
}

describe('createBoundsMotion', () => {
  it('holds no box until it is given one', () => {
    const motion = createBoundsMotion();
    const frame = motion.advance(0);
    expect(frame.bounds).toBeNull();
    expect(frame.settled).toBe(true);
  });

  it('seeds a box at rest, exactly', () => {
    const motion = createBoundsMotion();
    motion.resync(box(-10, -20, 30, 40));
    const frame = motion.advance(0);
    expect(frame.bounds).toEqual(box(-10, -20, 30, 40));
    expect(frame.settled).toBe(true);
  });

  it('accepts a degenerate box, because an empty layout has one', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 0, 0));
    expect(motion.advance(0).bounds).toEqual(box(0, 0, 0, 0));
  });

  it('refuses a box that is inside out, by name', () => {
    const motion = createBoundsMotion();
    expect(() => {
      motion.resync(box(10, 0, 0, 10));
    }).toThrow(/maxX/);
    expect(() => {
      motion.resync(box(0, 10, 10, 0));
    }).toThrow(/maxY/);
    expect(() => {
      motion.resync(box(Number.NaN, 0, 1, 1));
    }).toThrow(/minX/);
  });

  it('springs towards a retarget rather than cutting to it', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    motion.retarget(box(0, 0, 200, 100));

    const first = motion.advance(0);
    expect(first.bounds).toEqual(box(0, 0, 100, 100));
    expect(first.settled).toBe(false);

    const mid = motion.advance(0.05).bounds;
    if (mid === null) throw new Error('no bounds mid-flight');
    expect(mid.maxX).toBeGreaterThan(100);
    expect(mid.maxX).toBeLessThan(200);

    expect(settle(motion)).toEqual(box(0, 0, 200, 100));
  });

  it('treats a retarget with no box yet as an arrival, at rest', () => {
    const motion = createBoundsMotion();
    motion.retarget(box(1, 2, 3, 4));
    const frame = motion.advance(0);
    expect(frame.bounds).toEqual(box(1, 2, 3, 4));
    expect(frame.settled).toBe(true);
  });

  it('follows the exported spring on the centre and the half-extents', () => {
    const halfLife = 0.2;
    const motion = createBoundsMotion({ halfLifeSeconds: halfLife, restEpsilon: 1e-9 });
    motion.resync(box(0, 0, 100, 50));
    motion.retarget(box(100, 100, 300, 250));
    motion.advance(0.03);
    const frame = motion.advance(0.02).bounds;
    if (frame === null) throw new Error('no bounds');

    const w = omegaForHalfLife(halfLife);
    const rest = { x: 0, y: 0 };
    let centre = { position: { x: 50, y: 25 }, velocity: rest };
    let half = { position: { x: 50, y: 25 }, velocity: rest };
    for (const dt of [0.03, 0.02]) {
      centre = stepSpring2D(centre, { x: 200, y: 175 }, w, dt);
      half = stepSpring2D(half, { x: 100, y: 75 }, w, dt);
    }
    expect(frame.minX).toBeCloseTo(centre.position.x - half.position.x, 12);
    expect(frame.maxX).toBeCloseTo(centre.position.x + half.position.x, 12);
    expect(frame.minY).toBeCloseTo(centre.position.y - half.position.y, 12);
    expect(frame.maxY).toBeCloseTo(centre.position.y + half.position.y, 12);
  });

  it('never turns inside out on the way from one box to another', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 1000, 1000));
    motion.retarget(box(400, 400, 410, 410));
    for (let frame = 0; frame < 120; frame += 1) {
      const { bounds } = motion.advance(1 / 60);
      if (bounds === null) throw new Error('no bounds');
      expect(bounds.maxX).toBeGreaterThanOrEqual(bounds.minX);
      expect(bounds.maxY).toBeGreaterThanOrEqual(bounds.minY);
    }
  });

  it('retargets mid-flight without moving the box on that frame', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    motion.retarget(box(0, 0, 500, 100));
    motion.advance(0.04);
    const before = motion.advance(0).bounds;
    motion.retarget(box(0, 0, 50, 100));
    const after = motion.advance(0).bounds;
    expect(after).toEqual(before);
    expect(settle(motion)).toEqual(box(0, 0, 50, 100));
  });

  it('is a fixed point once settled', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 10, 10));
    motion.retarget(box(5, 5, 20, 20));
    const settled = settle(motion);
    expect(motion.advance(1).bounds).toEqual(settled);
    expect(motion.advance(1).settled).toBe(true);
  });

  it('clears the box on a resync to nothing', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 10, 10));
    motion.resync(null);
    expect(motion.advance(0).bounds).toBeNull();
  });

  it('keeps the spring on a resync, so a correction is animated', () => {
    const motion = createBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    motion.resync(box(0, 0, 300, 100));
    const first = motion.advance(0);
    expect(first.bounds).toEqual(box(0, 0, 100, 100));
    expect(first.settled).toBe(false);
    expect(settle(motion)).toEqual(box(0, 0, 300, 100));
  });

  it('reads the two defaults the node half reads', () => {
    expect(DEFAULT_MOTION_HALF_LIFE).toBe(0.12);
    expect(DEFAULT_MOTION_REST).toBe(0.05);
    expect(() => createBoundsMotion({ halfLifeSeconds: 0 })).toThrow(/halfLifeSeconds/);
    expect(() => createBoundsMotion({ restEpsilon: -1 })).toThrow(/restEpsilon/);
  });

  it('does not retain the box it was handed', () => {
    const motion = createBoundsMotion();
    const handed = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    motion.resync(handed);
    handed.maxX = 999;
    expect(motion.advance(0).bounds?.maxX).toBe(10);
  });
});
