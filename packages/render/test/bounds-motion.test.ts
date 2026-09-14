import { describe, expect, it } from 'vitest';
import { createBoundsMotion, createPlannedBoundsMotion } from '../src/bounds-motion.js';
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

  it('keeps a box whose midpoint would overflow, by not computing the midpoint', () => {
    // Four finite coordinates in the right order do not make a finite `(minX +
    // maxX) / 2`, and a box from 1e308 to 1.5e308 is the demonstration: every
    // corner is finite, the ordering holds, and the sum overflows. The module
    // computes the HALF-EXTENT first and the centre as `minX + half`, so the
    // intermediate that overflowed never exists and this box is drawn correctly
    // rather than refused. Asserted on the way back out, because the point is
    // that the decomposition round-trips.
    const motion = createBoundsMotion();
    motion.resync(box(1e308, 0, 1.5e308, 1));
    expect(motion.advance(0).bounds).toEqual(box(1e308, 0, 1.5e308, 1));
  });

  it('refuses a box whose extent overflows, rather than drawing an infinite one', () => {
    // What is left once the midpoint is out of the way: a box wider than the
    // finite range, whose half-extent overflows however it is computed. This is
    // the one input class that reached the drawing, because a SEEDED box has no
    // springs yet and the guard that catches everything else reads the springs.
    // Unrefused it puts an infinite box in the frame, and the caller hands that
    // to `fitBounds`, which throws an animation loop away from the cause.
    const motion = createBoundsMotion();
    expect(() => {
      motion.resync(box(-1.7e308, 0, 1.7e308, 1));
    }).toThrow(/half-extent x/);
    expect(() => {
      motion.resync(box(0, -1.7e308, 1, 1.7e308));
    }).toThrow(/half-extent y/);
    // Refused rather than half seeded: nothing infinite reached the frame and
    // the motion still holds no box at all.
    expect(motion.advance(0)).toEqual({ bounds: null, settled: true });
    expect(() => {
      motion.retarget(box(-1.7e308, 0, 1.7e308, 1));
    }).toThrow(/half-extent x/);
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

/**
 * The two-phase form, which exists for `createSceneMotion` and not for a caller.
 *
 * Asserted here rather than only through the composite, because the property it
 * carries is about THIS module: every check that can throw runs at plan time,
 * and the closure that comes back mutates and cannot refuse. The composite's own
 * suite asserts what that buys across three halves.
 */
describe('createPlannedBoundsMotion', () => {
  it('changes nothing until the commit is called', () => {
    const motion = createPlannedBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    const commit = motion.planRetarget(box(0, 0, 400, 100));

    expect(motion.advance(0)).toEqual({ bounds: box(0, 0, 100, 100), settled: true });
    commit();
    expect(motion.advance(0).settled).toBe(false);
    expect(settle(motion)).toEqual(box(0, 0, 400, 100));
  });

  it('refuses at plan time, before there is anything to undo', () => {
    const motion = createPlannedBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    expect(() => motion.planRetarget(box(10, 0, 0, 10))).toThrow(/maxX/);
    expect(motion.advance(0)).toEqual({ bounds: box(0, 0, 100, 100), settled: true });
  });

  it('checks the spring it will actually aim, mid-flight and not at rest', () => {
    // The defect the plan API replaced. The composite used to check this half by
    // aiming a THROWAWAY motion seeded from the current box, which is at REST,
    // where the real half is caught mid-flight with velocity. `checkAim` guards
    // `velocity + w * displacement`, so the two validate different expressions.
    //
    // WHAT THIS TEST EXHIBITS is that a plan is made against the moving entry:
    // the commit lands the box on the plan's target from wherever the springs
    // had got to, carrying velocity, rather than from the box the plan was read
    // at. WHAT IT DOES NOT EXHIBIT is the arithmetic divergence itself, and that
    // is worth saying plainly: reaching it needs a velocity and a displacement
    // whose sum overflows while neither does, and `spring.ts` rejects a step
    // whose own result leaves the finite range, so the states that would show it
    // are guarded a layer earlier. The hole was real, the fix is the symmetry,
    // and the evidence for it is the code path rather than a number.
    const motion = createPlannedBoundsMotion({ restEpsilon: 1e-9 });
    motion.resync(box(0, 0, 100, 100));
    motion.retarget(box(0, 0, 900, 100));
    motion.advance(0.05);
    const midFlight = motion.advance(0).bounds;
    if (midFlight === null) throw new Error('no bounds mid-flight');
    expect(midFlight.maxX).toBeGreaterThan(100);
    expect(midFlight.maxX).toBeLessThan(900);

    const commit = motion.planRetarget(box(0, 0, 100, 100));
    commit();
    // Still where it was on the frame the plan committed: a retarget moves no
    // box on its own frame, which is the node half's rule for the same reason.
    expect(motion.advance(0).bounds).toEqual(midFlight);
    expect(settle(motion)).toEqual(box(0, 0, 100, 100));
  });

  it('aims the entry it validated, which is why a plan is not portable', () => {
    // The rule the plan API's docstring states, as a test. A plan holds the
    // entry it checked; dropping the box and then committing aims an entry
    // nothing is drawing, and the scene is left with no box rather than with a
    // box the plan never validated.
    const motion = createPlannedBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    const commit = motion.planRetarget(box(0, 0, 400, 100));
    motion.resync(null);
    commit();
    expect(motion.advance(0)).toEqual({ bounds: null, settled: true });
  });

  it('plans a resync to nothing as a commit that clears the box', () => {
    const motion = createPlannedBoundsMotion();
    motion.resync(box(0, 0, 100, 100));
    const commit = motion.planResync(null);
    expect(motion.advance(0).bounds).toEqual(box(0, 0, 100, 100));
    commit();
    expect(motion.advance(0).bounds).toBeNull();
  });
});
