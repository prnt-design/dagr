import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION_HALF_LIFE,
  DEFAULT_MOTION_REST,
  MotionDesyncError,
  alignRoutes,
  createEdgeMotion,
} from '../src/index.js';
import type { EdgeMotionTarget, MotionEdge } from '../src/index.js';
import type { Vec2 } from '../src/types.js';

/**
 * The edge half of the delta consumer.
 *
 * Two suites, and the split is the one M5.4a's checks made the case for:
 * `alignRoutes` is a PURE function of two point lists and can be failed on
 * constructed input, while `createEdgeMotion` holds state and a clock. A
 * correspondence bug tested only through the springs would be reported as a
 * frame that looks wrong, three layers from the arithmetic that decided it.
 */

/** The distance from a point to one segment, which is what a route is made of. */
function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * The furthest any of `points` strays from the line `route` draws.
 *
 * This is one direction of the Hausdorff distance `@dagr/layout`'s
 * `maxRouteDistance` measures, and it is the metric this whole task is judged
 * by: a resampled route that measures zero here is the same drawing as the
 * route it came from, whatever its vertex count says.
 */
function maxDeviation(points: readonly Vec2[], route: readonly Vec2[]): number {
  let worst = 0;
  for (const point of points) {
    let best = Infinity;
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1];
      const b = route[index];
      if (a === undefined || b === undefined) continue;
      best = Math.min(best, distanceToSegment(point, a, b));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** The one edge in a frame, by id, so a test never indexes an array by luck. */
function edgeNamed(edges: readonly MotionEdge[], id: string): MotionEdge {
  const found = edges.find((edge) => edge.id === id);
  if (found === undefined) throw new Error(`no edge ${id} in the frame`);
  return found;
}

const STRAIGHT: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

/** A three-point route whose two segments are the same length, so its middle sits at t = 0.5. */
const BENT: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 5, y: 5 },
  { x: 10, y: 0 },
];

/**
 * A bend at ten elevenths of the way along, which is nowhere a uniform
 * resampling would look.
 *
 * BENT is the fixture that cannot fail the corner-cutting guard, because its
 * own parameters are {0, 0.5, 1} and a three-point uniform sampling lands on
 * every one of them by luck. This one is the fixture that can.
 */
const LOPSIDED: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 1 },
];

function target(id: string, points: readonly Vec2[]): EdgeMotionTarget {
  return { id, points };
}

/** Steps until nothing is moving, and says how many frames that took. */
function runToRest(
  motion: ReturnType<typeof createEdgeMotion>,
  dtSeconds = 1 / 60,
): { frames: number; edges: readonly MotionEdge[] } {
  for (let frames = 1; frames <= 10_000; frames += 1) {
    const frame = motion.advance(dtSeconds);
    if (frame.settled) return { frames, edges: frame.edges };
  }
  throw new Error('never settled');
}

describe('alignRoutes', () => {
  it('gives two routes of different lengths the same point count', () => {
    const aligned = alignRoutes(STRAIGHT, BENT);
    expect(aligned.from).toHaveLength(3);
    expect(aligned.to).toHaveLength(3);
  });

  it('keeps every vertex of each route, exactly, and in order', () => {
    // The guard the whole decision rests on, and LOPSIDED rather than BENT is
    // what makes it a guard: a uniform three-point resampling of BENT lands on
    // {0, 0.5, 1}, which are BENT's own parameters, so BENT cannot fail this.
    // LOPSIDED's bend is at ten elevenths, so a uniform sampling misses it and
    // the drawing cuts the corner.
    const aligned = alignRoutes(STRAIGHT, LOPSIDED);
    expect(aligned.to).toEqual(LOPSIDED);
    expect(aligned.from[0]).toEqual({ x: 0, y: 0 });
    expect(aligned.from[aligned.from.length - 1]).toEqual({ x: 10, y: 0 });
    expect(maxDeviation(LOPSIDED, aligned.to)).toBe(0);
  });

  it('keeps distinct vertices whose arc-length parameters round equal', () => {
    const collapsed: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: 2 ** 54, y: 0 },
      { x: 2 ** 54, y: 1 },
    ];
    const straight: readonly Vec2[] = [
      { x: 0, y: 4 },
      { x: 2 ** 54, y: 4 },
    ];

    const aligned = alignRoutes(collapsed, straight);

    expect(aligned.from).toEqual(collapsed);
    expect(aligned.to).toHaveLength(collapsed.length);
    expect(maxDeviation(aligned.to, straight)).toBe(0);
  });

  it('puts the points it adds on the line the route already drew', () => {
    // Zero, not "small". A point placed on a segment of the route is on the
    // route, so the drawing does not change and `maxRouteDistance` says so.
    const aligned = alignRoutes(STRAIGHT, BENT);
    expect(maxDeviation(aligned.from, STRAIGHT)).toBe(0);
    expect(maxDeviation(aligned.to, BENT)).toBe(0);
  });

  it('parameterises by arc length rather than by index', () => {
    // A route whose two segments differ in length ten to one. Index
    // parameterisation would put the middle vertex at t = 0.5 and land the
    // straight route's added point at x = 5; arc length puts it at t = 10/11,
    // which is where the bend actually is along the line.
    const lopsided: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: 0 },
    ];
    const aligned = alignRoutes(STRAIGHT, lopsided);
    expect(aligned.from[1]?.x).toBeCloseTo(100 / 11, 12);
  });

  it('agrees on the endpoints of both routes exactly', () => {
    const aligned = alignRoutes(BENT, STRAIGHT);
    expect(aligned.from[0]).toEqual(BENT[0]);
    expect(aligned.to[0]).toEqual(STRAIGHT[0]);
    expect(aligned.from[aligned.from.length - 1]).toEqual(BENT[BENT.length - 1]);
    expect(aligned.to[aligned.to.length - 1]).toEqual(STRAIGHT[STRAIGHT.length - 1]);
  });

  it('returns both routes untouched when their parameters already agree', () => {
    // Two straight routes are both {0, 1}, so the union adds nothing and the
    // common case costs no extra points. Without this the count would grow on
    // every reroute of every edge for no drawn difference.
    const other: readonly Vec2[] = [
      { x: 0, y: 4 },
      { x: 10, y: 4 },
    ];
    const aligned = alignRoutes(STRAIGHT, other);
    expect(aligned.from).toEqual(STRAIGHT);
    expect(aligned.to).toEqual(other);
  });

  it('falls back to index spacing for a route of zero length', () => {
    // A route whose points coincide has no arc length to divide by, and the
    // division is the one place a NaN could enter the drawing.
    const degenerate: readonly Vec2[] = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ];
    const aligned = alignRoutes(degenerate, STRAIGHT);
    expect(aligned.from).toHaveLength(aligned.to.length);
    for (const point of [...aligned.from, ...aligned.to]) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('refuses a route of fewer than two points', () => {
    expect(() => alignRoutes([{ x: 0, y: 0 }], STRAIGHT)).toThrow(RangeError);
    expect(() => alignRoutes(STRAIGHT, [])).toThrow(RangeError);
  });

  it('refuses a coordinate that is not finite', () => {
    expect(() => alignRoutes([{ x: 0, y: 0 }, { x: NaN, y: 0 }], STRAIGHT)).toThrow(RangeError);
  });

  it('refuses a segment whose derived length overflows', () => {
    const overflowing: readonly Vec2[] = [
      { x: -Number.MAX_VALUE, y: 0 },
      { x: Number.MAX_VALUE, y: 0 },
    ];
    expect(() => alignRoutes(overflowing, STRAIGHT)).toThrow(/from segment 0 length/);

    const overflowingTotal: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: Number.MAX_VALUE * 0.75, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(() => alignRoutes(overflowingTotal, STRAIGHT)).toThrow(/from total length.*segment 1/);
  });
});

describe('createEdgeMotion', () => {
  it('seeds a scene at rest, drawing exactly what it was given', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', BENT)]);
    const frame = motion.advance(0);
    expect(frame.settled).toBe(true);
    expect(frame.edges).toHaveLength(1);
    expect(edgeNamed(frame.edges, 'e1').points).toEqual(BENT);
    expect(edgeNamed(frame.edges, 'e1').departing).toBe(false);
  });

  it('copies the points a caller passes in, at the boundary', () => {
    // The pooling consumer again: one record per edge reused across frames is
    // the shape an allocation-conscious caller takes, and retaining it would
    // let them move this module's targets from outside.
    const mutable: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const motion = createEdgeMotion();
    motion.resync([target('e1', mutable)]);
    mutable[1] = { x: 999, y: 999 };
    mutable.push({ x: 5, y: 5 });
    expect(edgeNamed(motion.advance(0).edges, 'e1').points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('animates a reroute rather than cutting to it', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    const frame = motion.advance(1 / 60);
    expect(frame.settled).toBe(false);
    const points = edgeNamed(frame.edges, 'e1').points;
    // On the way: off the straight line it left, and not yet on the bend.
    expect(maxDeviation(points, STRAIGHT)).toBeGreaterThan(0);
    expect(maxDeviation(points, BENT)).toBeGreaterThan(0);
  });

  it('arrives on the points of the target itself, at its own count', () => {
    // Two claims in one, and the second is the one a naive implementation
    // fails: the flight is over the UNION of both routes' vertices, so an edge
    // that stayed at that count would carry the shape of every route it has
    // ever taken for the rest of the session.
    const motion = createEdgeMotion();
    motion.resync([target('e1', BENT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', STRAIGHT)] });
    const rested = runToRest(motion);
    expect(edgeNamed(rested.edges, 'e1').points).toEqual(STRAIGHT);
  });

  it('returns the same frame for any elapsed time once settled', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', BENT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', STRAIGHT)] });
    runToRest(motion);
    const first = edgeNamed(motion.advance(1 / 60).edges, 'e1').points;
    const second = edgeNamed(motion.advance(3600).edges, 'e1').points;
    expect(second).toEqual(first);
  });

  it('does not move at all for a reroute to the route it is already drawing', () => {
    // The edge analogue of M4.7a's resize, and it falls out rather than being
    // handled: a delta with a tolerance can report a route that rounds to the
    // same line, and the correct amount of animation for that is none.
    const motion = createEdgeMotion();
    motion.resync([target('e1', BENT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    const frame = motion.advance(0);
    expect(frame.settled).toBe(true);
    expect(edgeNamed(frame.edges, 'e1').points).toEqual(BENT);
  });

  it('retargets mid-flight without a jump', () => {
    // The interruptibility the task is about. A `(start, target, elapsed)`
    // implementation restarts from the route the LAYOUT last reported, so the
    // frame after the second delta snaps back to where the first delta began.
    const far: readonly Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 40 },
      { x: 10, y: 0 },
    ];
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', far)] });
    for (let step = 0; step < 6; step += 1) motion.advance(1 / 60);
    const before = edgeNamed(motion.advance(0).edges, 'e1').points.map((p) => ({ ...p }));
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    const after = edgeNamed(motion.advance(0).edges, 'e1').points;
    expect(maxDeviation(after, before)).toBeLessThan(1e-9);
  });

  it('adds an edge at its route, at rest', () => {
    const motion = createEdgeMotion();
    motion.resync([]);
    motion.apply({ added: [target('e1', BENT)], removed: [], rerouted: [] });
    const frame = motion.advance(0);
    expect(frame.settled).toBe(true);
    expect(edgeNamed(frame.edges, 'e1').points).toEqual(BENT);
  });

  it('keeps a removed edge in the frame until its springs finish', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    motion.advance(1 / 60);
    motion.apply({ added: [], removed: ['e1'], rerouted: [] });
    const frame = motion.advance(1 / 60);
    expect(edgeNamed(frame.edges, 'e1').departing).toBe(true);
    expect(frame.settled).toBe(false);
    expect(runToRest(motion).edges).toHaveLength(0);
  });

  it('drops an edge removed while already at rest on the next frame', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: ['e1'], rerouted: [] });
    const frame = motion.advance(1 / 60);
    expect(frame.edges).toHaveLength(0);
    expect(frame.settled).toBe(true);
  });

  it('seeds a same-id replacement on its new directed route', () => {
    // `EdgeDelta` reports changed endpoints as the old edge leaving and a new
    // edge arriving. Retargeting would collapse this reversed route in flight.
    const reversed = [...STRAIGHT].reverse();
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [target('e1', reversed)], removed: ['e1'], rerouted: [] });
    const frame = motion.advance(0);
    expect(frame.settled).toBe(true);
    expect(edgeNamed(frame.edges, 'e1').departing).toBe(false);
    expect(edgeNamed(frame.edges, 'e1').points).toEqual(reversed);
  });

  it('throws when a delta names an edge the scene does not hold', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    expect(() => {
      motion.apply({ added: [], removed: [], rerouted: [target('e2', BENT)] });
    }).toThrow(MotionDesyncError);
    expect(() => {
      motion.apply({ added: [], removed: ['e2'], rerouted: [] });
    }).toThrow(MotionDesyncError);
    expect(() => {
      motion.apply({ added: [target('e1', BENT)], removed: [], rerouted: [] });
    }).toThrow(MotionDesyncError);
  });

  it('names the edge and the list position, and calls it an edge', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    expect(() => {
      motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT), target('e2', BENT)] });
    }).toThrow(/rerouted\[1\] names edge "e2"/);
  });

  it('leaves the scene untouched when a delta is refused', () => {
    // All or nothing, for M4.7a's reason: a half-applied delta moves the thing
    // the caller would resync from before telling them to resync.
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    expect(() => {
      motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT), target('e2', BENT)] });
    }).toThrow(MotionDesyncError);
    const frame = motion.advance(1 / 60);
    expect(frame.settled).toBe(true);
    expect(edgeNamed(frame.edges, 'e1').points).toEqual(STRAIGHT);
  });

  it('validates every route before mutating the scene', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT), target('e2', STRAIGHT)]);
    const overflowing: readonly Vec2[] = [
      { x: -Number.MAX_VALUE, y: 0 },
      { x: Number.MAX_VALUE, y: 0 },
    ];
    expect(() => {
      motion.apply({
        added: [],
        removed: [],
        rerouted: [target('e1', BENT), target('e2', overflowing)],
      });
    }).toThrow(/rerouted\[1\]\.points segment 0 length/);
    expect(edgeNamed(motion.advance(0).edges, 'e1').points).toEqual(STRAIGHT);
  });

  it('validates every spring displacement before mutating the scene', () => {
    const negative: readonly Vec2[] = [
      { x: -1e308, y: 0 },
      { x: -9e307, y: 0 },
    ];
    const positive: readonly Vec2[] = [
      { x: 1e308, y: 0 },
      { x: 9e307, y: 0 },
    ];
    const motion = createEdgeMotion();
    motion.resync([target('earlier', STRAIGHT), target('overflow', negative)]);
    const before = motion.advance(0);

    expect(() => {
      motion.apply({
        added: [],
        removed: [],
        rerouted: [target('earlier', BENT), target('overflow', positive)],
      });
    }).toThrow(/rerouted\[1\].*"overflow".*point 0.*x displacement/);

    expect(motion.advance(0)).toEqual(before);
  });

  it('keeps a far reroute finite through a long frame and a later retarget', () => {
    const far: readonly Vec2[] = [
      { x: 1e307, y: 1e306 },
      { x: 1.1e307, y: 2e306 },
    ];
    const farther: readonly Vec2[] = [
      { x: 9e306, y: 2e306 },
      { x: 1.05e307, y: 3e306 },
    ];
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', far)] });

    const afterLongFrame = motion.advance(2);
    expect(afterLongFrame.settled).toBe(false);
    for (const point of edgeNamed(afterLongFrame.edges, 'e1').points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThan(0);
    }

    motion.apply({ added: [], removed: [], rerouted: [target('e1', farther)] });
    for (const point of edgeNamed(motion.advance(1 / 60).edges, 'e1').points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it.each(['apply', 'resync'] as const)(
    'refuses an overflowing spring coefficient in %s without changing finite state',
    (operation) => {
      const negative: readonly Vec2[] = [
        { x: -8e307, y: 0 },
        { x: -7e307, y: 0 },
      ];
      const positive: readonly Vec2[] = [
        { x: 8e307, y: 0 },
        { x: 7e307, y: 0 },
      ];
      const motion = createEdgeMotion();
      motion.resync([target('earlier', STRAIGHT), target('overflow', negative)]);
      const before = motion.advance(0);

      expect(() => {
        if (operation === 'apply') {
          motion.apply({
            added: [],
            removed: [],
            rerouted: [target('earlier', BENT), target('overflow', positive)],
          });
        } else {
          motion.resync([target('earlier', BENT), target('overflow', positive)]);
        }
      }).toThrow(
        operation === 'apply'
          ? /rerouted\[1\].*edge "overflow".*point 0.*x spring coefficient/
          : /targets\[1\].*edge "overflow".*point 0.*x spring coefficient/,
      );

      const after = motion.advance(1 / 60);
      expect(after).toEqual(before);
      for (const edge of after.edges) {
        for (const point of edge.points) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
      }
    },
  );

  it('drops what a resync does not name, with no departure', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT), target('e2', BENT)]);
    motion.resync([target('e2', BENT)]);
    const frame = motion.advance(0);
    expect(frame.edges).toHaveLength(1);
    expect(edgeNamed(frame.edges, 'e2').points).toEqual(BENT);
  });

  it('animates a correction rather than teleporting to it', () => {
    // A resync after a dropped delta keeps the springs of everything it names,
    // which is what makes the way back from a desync a correction the reader
    // can follow.
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.resync([target('e1', BENT)]);
    const frame = motion.advance(0);
    expect(frame.settled).toBe(false);
    expect(maxDeviation(edgeNamed(frame.edges, 'e1').points, STRAIGHT)).toBe(0);
  });

  it('validates every resync displacement before mutating the scene', () => {
    const negative: readonly Vec2[] = [
      { x: -1e308, y: 0 },
      { x: -9e307, y: 0 },
    ];
    const positive: readonly Vec2[] = [
      { x: 1e308, y: 0 },
      { x: 9e307, y: 0 },
    ];
    const motion = createEdgeMotion();
    motion.resync([target('earlier', STRAIGHT), target('overflow', negative)]);
    const before = motion.advance(0);

    expect(() => {
      motion.resync([target('earlier', BENT), target('overflow', positive)]);
    }).toThrow(/targets\[1\].*edge "overflow".*point 0.*x displacement/);

    expect(motion.advance(0)).toEqual(before);
  });

  it('refuses a route of fewer than two points, wherever it arrives', () => {
    const motion = createEdgeMotion();
    expect(() => {
      motion.resync([target('e1', [{ x: 0, y: 0 }])]);
    }).toThrow(RangeError);
    motion.resync([target('e1', STRAIGHT)]);
    expect(() => {
      motion.apply({ added: [], removed: [], rerouted: [target('e1', [{ x: 0, y: 0 }])] });
    }).toThrow(RangeError);
  });

  it('refuses a coordinate that is not finite, naming where it was', () => {
    const motion = createEdgeMotion();
    expect(() => {
      motion.resync([target('e1', [{ x: 0, y: 0 }, { x: 10, y: Infinity }])]);
    }).toThrow(/targets\[0\]\.points\[1\]\.y/);
  });

  it('refuses a half-life or a tolerance that is not above zero', () => {
    expect(() => createEdgeMotion({ halfLifeSeconds: 0 })).toThrow(RangeError);
    expect(() => createEdgeMotion({ restEpsilon: -1 })).toThrow(RangeError);
  });

  it('refuses a finite half-life whose angular frequency overflows', () => {
    expect(() => createEdgeMotion({ halfLifeSeconds: Number.MIN_VALUE })).toThrow(
      /halfLifeSeconds.*angular frequency/,
    );
  });

  it('shares the node motion defaults, and honours one a caller names', () => {
    // The same feel for both halves of one delta, or a reader watches the
    // nodes arrive and the edges keep going. A shorter half-life settles in
    // fewer frames, which is the observable form of the option working.
    expect(DEFAULT_MOTION_HALF_LIFE).toBeGreaterThan(0);
    expect(DEFAULT_MOTION_REST).toBeGreaterThan(0);
    const slow = createEdgeMotion();
    const fast = createEdgeMotion({ halfLifeSeconds: DEFAULT_MOTION_HALF_LIFE / 4 });
    for (const motion of [slow, fast]) {
      motion.resync([target('e1', STRAIGHT)]);
      motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    }
    expect(runToRest(fast).frames).toBeLessThan(runToRest(slow).frames);
  });

  it('carries the velocity of a moving route through a retarget', () => {
    // The guard for the half of a spring that is not its position, and it is
    // written so that zeroing the velocity fails it: retarget a moving edge to
    // the line it is drawing RIGHT NOW. Carrying the velocity means it
    // overshoots and comes back, so the frame is not settled and the next one
    // is somewhere else; dropping it means the edge stops dead, exactly on a
    // target it is already on, and reports itself settled.
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    for (let step = 0; step < 4; step += 1) motion.advance(1 / 60);
    const inFlight = edgeNamed(motion.advance(0).edges, 'e1').points.map((p) => ({ ...p }));
    motion.apply({ added: [], removed: [], rerouted: [target('e1', inFlight)] });
    const frame = motion.advance(0);
    expect(frame.settled).toBe(false);
    expect(maxDeviation(edgeNamed(motion.advance(1 / 60).edges, 'e1').points, inFlight)).toBeGreaterThan(0);
  });

  it('interpolates velocity for a point added during a mid-flight retarget', () => {
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
    for (let step = 0; step < 4; step += 1) motion.advance(1 / 60);

    const inFlight = edgeNamed(motion.advance(0).edges, 'e1').points;
    const first = inFlight[0];
    const second = inFlight[1];
    if (first === undefined || second === undefined) throw new Error('expected an in-flight segment');
    const inserted = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const samePolyline = [first, inserted, ...inFlight.slice(1)];

    motion.apply({ added: [], removed: [], rerouted: [target('e1', samePolyline)] });
    const retargeted = edgeNamed(motion.advance(0).edges, 'e1').points;
    expect(retargeted[1]).toEqual(inserted);
    const next = edgeNamed(motion.advance(1 / 60).edges, 'e1').points;
    expect(next[1]).not.toEqual(inserted);
  });

  it('does not grow an edge by one point per reroute it has ever taken', () => {
    // The leak guard. The flight is over the UNION of two routes' vertices, so
    // an implementation that kept the union would add a point per reroute and
    // an hour of editing would draw a three-point line out of hundreds.
    const motion = createEdgeMotion();
    motion.resync([target('e1', STRAIGHT)]);
    for (let round = 0; round < 20; round += 1) {
      motion.apply({ added: [], removed: [], rerouted: [target('e1', BENT)] });
      runToRest(motion);
      motion.apply({ added: [], removed: [], rerouted: [target('e1', LOPSIDED)] });
      runToRest(motion);
    }
    expect(edgeNamed(motion.advance(0).edges, 'e1').points).toEqual(LOPSIDED);
  });

  it('refuses an elapsed time that is negative', () => {
    const motion = createEdgeMotion();
    expect(() => motion.advance(-1)).toThrow(RangeError);
  });
});
