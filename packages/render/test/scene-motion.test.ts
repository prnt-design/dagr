import { describe, expect, it } from 'vitest';
import { MotionDesyncError } from '../src/errors.js';
import { createSceneMotion } from '../src/scene-motion.js';
import type { SceneMotion, SceneMotionFrame } from '../src/scene-motion.js';
import type { WorldBounds } from '../src/types.js';

/**
 * The three halves driven as one scene.
 *
 * Nearly everything here is the halves' own behaviour and is tested in their
 * own files. What this suite is FOR is the one property that only exists at
 * the composite: a delta names nodes, edges and bounds together, and applying
 * it has to be all or nothing across all three. The tests that matter are the
 * three where one half would accept and another would refuse, one per half, so
 * that no ordering of the commits passes them all by luck.
 *
 * There is no `delta` helper here, unlike `motion.test.ts`, because every field
 * of a `SceneMotionDelta` is optional: the object a test writes is already the
 * delta, and a helper wrapping it would be the identity function.
 */

function box(minX: number, minY: number, maxX: number, maxY: number): WorldBounds {
  return { minX, minY, maxX, maxY };
}

function seeded(): SceneMotion {
  const motion = createSceneMotion();
  motion.resync({
    nodes: [
      { id: 'a', center: { x: 0, y: 0 } },
      { id: 'b', center: { x: 0, y: -100 } },
    ],
    edges: [
      {
        id: 'a-b',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: -100 },
        ],
      },
    ],
    bounds: box(-10, -110, 10, 10),
  });
  return motion;
}

function settle(motion: SceneMotion, bound = 600): SceneMotionFrame {
  for (let frame = 0; frame < bound; frame += 1) {
    const result = motion.advance(1 / 60);
    if (result.settled) return result;
  }
  throw new Error(`did not settle within ${String(bound)} frames`);
}

function centreOf(frame: SceneMotionFrame, id: string): { x: number; y: number } {
  const node = frame.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node.center;
}

describe('createSceneMotion', () => {
  it('seeds all three halves at rest', () => {
    const frame = seeded().advance(0);
    expect(frame.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(frame.edges.map((edge) => edge.id)).toEqual(['a-b']);
    expect(frame.bounds).toEqual(box(-10, -110, 10, 10));
    expect(frame.settled).toBe(true);
  });

  it('is settled only when every half is', () => {
    const motion = seeded();
    motion.apply({ bounds: box(-10, -110, 200, 10) });
    expect(motion.advance(0).settled).toBe(false);
    const done = settle(motion);
    expect(done.bounds).toEqual(box(-10, -110, 200, 10));
    expect(done.settled).toBe(true);
  });

  it('retargets nodes and edges from one delta so they arrive together', () => {
    const motion = seeded();
    motion.apply({
      nodes: { added: [], removed: [], moved: [{ id: 'b', center: { x: 50, y: -100 } }] },
      edges: {
        added: [],
        removed: [],
        rerouted: [
          {
            id: 'a-b',
            points: [
              { x: 0, y: 0 },
              { x: 50, y: -100 },
            ],
          },
        ],
      },
    });
    const done = settle(motion);
    expect(centreOf(done, 'b')).toEqual({ x: 50, y: -100 });
    expect(done.edges[0]?.points.at(-1)).toEqual({ x: 50, y: -100 });
  });

  it('leaves a half the delta does not name exactly as it was', () => {
    const motion = seeded();
    motion.apply({
      nodes: { added: [], removed: [], moved: [{ id: 'b', center: { x: 1, y: -100 } }] },
    });
    const frame = motion.advance(0);
    expect(frame.bounds).toEqual(box(-10, -110, 10, 10));
    expect(frame.edges[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -100 },
    ]);
  });

  it('takes an undefined half as unchanged, which is what a layout delta means by it', () => {
    // `LayoutDelta.bounds` is a key that is always present and is `undefined`
    // when the box did not change, so a caller forwards it rather than deciding
    // whether to spread it. The two rosters read the same way.
    const motion = seeded();
    motion.apply({ nodes: undefined, edges: undefined, bounds: undefined });
    const frame = motion.advance(0);
    expect(frame.bounds).toEqual(box(-10, -110, 10, 10));
    expect(frame.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(frame.settled).toBe(true);
  });

  it('applies nothing when the edge half refuses, even though the node half would accept', () => {
    // THE property. Without the two-phase commit the node half would have moved
    // `b` by the time the edge half threw, and the caller's resync would then
    // start from a scene that had already been changed by the delta it is
    // recovering from.
    const motion = seeded();
    expect(() => {
      motion.apply({
        nodes: { added: [], removed: [], moved: [{ id: 'b', center: { x: 500, y: -100 } }] },
        edges: { added: [], removed: ['no-such-edge'], rerouted: [] },
      });
    }).toThrow(MotionDesyncError);
    const frame = motion.advance(0);
    expect(centreOf(frame, 'b')).toEqual({ x: 0, y: -100 });
    expect(frame.settled).toBe(true);
  });

  it('applies nothing when the bounds refuse, even though both rosters would accept', () => {
    const motion = seeded();
    expect(() => {
      motion.apply({
        nodes: { added: [], removed: [], moved: [{ id: 'b', center: { x: 500, y: -100 } }] },
        bounds: box(10, 0, 0, 10),
      });
    }).toThrow(/maxX/);
    const frame = motion.advance(0);
    expect(centreOf(frame, 'b')).toEqual({ x: 0, y: -100 });
    expect(frame.settled).toBe(true);
  });

  it('applies nothing when the bounds refuse while the box is mid-flight', () => {
    // The same refusal as above, taken in the state the first version of this
    // file got wrong. It checked the bounds half by aiming a throwaway motion
    // seeded at REST from the current box, where the real half is here caught
    // with velocity, so the two ran the same check against different springs.
    // With the plan API the check is the real entry's, whatever it is doing.
    const motion = seeded();
    motion.apply({ bounds: box(-10, -110, 500, 10) });
    motion.advance(0.03);
    const midFlight = motion.advance(0).bounds;
    if (midFlight === null) throw new Error('no bounds mid-flight');
    expect(midFlight.maxX).toBeGreaterThan(10);

    expect(() => {
      motion.apply({
        nodes: { added: [], removed: [], moved: [{ id: 'b', center: { x: 500, y: -100 } }] },
        bounds: box(0, 10, 10, 0),
      });
    }).toThrow(/maxY/);
    const after = motion.advance(0);
    expect(centreOf(after, 'b')).toEqual({ x: 0, y: -100 });
    expect(after.bounds).toEqual(midFlight);
  });

  it('applies nothing when the node half refuses after the edge half would accept', () => {
    const motion = seeded();
    expect(() => {
      motion.apply({
        nodes: { added: [], removed: ['no-such-node'], moved: [] },
        edges: { added: [], removed: ['a-b'], rerouted: [] },
      });
    }).toThrow(MotionDesyncError);
    const frame = motion.advance(0);
    expect(frame.edges.map((edge) => edge.id)).toEqual(['a-b']);
    expect(frame.edges[0]?.departing).toBe(false);
  });

  it('resyncs all three halves or none of them', () => {
    const motion = seeded();
    expect(() => {
      motion.resync({
        nodes: [{ id: 'z', center: { x: 0, y: 0 } }],
        edges: [{ id: 'short', points: [{ x: 0, y: 0 }] }],
      });
    }).toThrow(/at least two points/);
    const frame = motion.advance(0);
    expect(frame.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(frame.bounds).toEqual(box(-10, -110, 10, 10));
  });

  it('clears the bounds on a resync that names none, because a roster is a state', () => {
    const motion = seeded();
    motion.resync({ nodes: [], edges: [] });
    const frame = motion.advance(0);
    expect(frame.nodes).toEqual([]);
    expect(frame.bounds).toBeNull();
  });

  it('shares one feel across the three halves', () => {
    expect(() => createSceneMotion({ halfLifeSeconds: -1 })).toThrow(/halfLifeSeconds/);
    const quick = createSceneMotion({ halfLifeSeconds: 0.01, restEpsilon: 0.5 });
    quick.resync({
      nodes: [{ id: 'a', center: { x: 0, y: 0 } }],
      edges: [],
      bounds: box(0, 0, 1, 1),
    });
    quick.apply({
      nodes: { added: [], removed: [], moved: [{ id: 'a', center: { x: 100, y: 0 } }] },
      bounds: box(0, 0, 101, 1),
    });
    let frames = 0;
    while (!quick.advance(1 / 60).settled) frames += 1;
    expect(frames).toBeLessThan(20);
  });
});
