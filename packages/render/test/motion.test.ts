import { describe, expect, it } from 'vitest';
import { MotionDesyncError } from '../src/errors.js';
import type { MotionNode, MotionTarget, NodeMotionDelta } from '../src/motion.js';
import { DEFAULT_MOTION_HALF_LIFE, DEFAULT_MOTION_REST, createNodeMotion } from '../src/motion.js';
import type { Spring2DState } from '../src/spring.js';
import { omegaForHalfLife, stepSpring2D } from '../src/spring.js';

/**
 * The node half of the delta consumer, under a clock this file owns.
 *
 * There is no `requestAnimationFrame` anywhere below, and that is the point of
 * the module rather than a convenience of the suite: `advance` takes the
 * elapsed seconds, so a test names them. Every timing property here is
 * therefore exact rather than sampled, and the ones about interruption are
 * assertions about a specific frame rather than about a rendered result that
 * happened to look right.
 *
 * Two helpers carry most of the weight. {@link centre} reads one node out of a
 * frame by id and fails loudly when it is missing, because "the node is not in
 * the frame" and "the node is at the wrong place" are different failures and a
 * `?.center.x` would report the first as `undefined` inside an arithmetic
 * comparison. {@link runTo} steps a fixed number of equal frames, which is what
 * a caller's loop does and is also the only way to ask when something settles.
 */

const HALF_LIFE = 0.12;
const W = omegaForHalfLife(HALF_LIFE);

function centre(nodes: readonly MotionNode[], id: string): { x: number; y: number } {
  const found = nodes.find((node) => node.id === id);
  if (found === undefined) throw new Error(`no node ${id} in frame: [${nodes.map((n) => n.id).join(', ')}]`);
  return found.center;
}

function ids(nodes: readonly MotionNode[]): readonly string[] {
  return [...nodes].map((node) => node.id).sort();
}

function at(id: string, x: number, y: number): MotionTarget {
  return { id, center: { x, y } };
}

function delta(patch: Partial<NodeMotionDelta>): NodeMotionDelta {
  return { added: [], removed: [], moved: [], ...patch };
}

describe('createNodeMotion', () => {
  it('seeds a scene at its targets, at rest', () => {
    const motion = createNodeMotion();
    motion.resync([at('a', 10, 20), at('b', -5, 0)]);

    const frame = motion.advance(0);
    expect(ids(frame.nodes)).toEqual(['a', 'b']);
    expect(centre(frame.nodes, 'a')).toEqual({ x: 10, y: 20 });
    expect(centre(frame.nodes, 'b')).toEqual({ x: -5, y: 0 });
    expect(frame.settled).toBe(true);
  });

  it('leaves a node the delta does not name exactly where it was', () => {
    const motion = createNodeMotion();
    motion.resync([at('a', 0, 0), at('still', 300, 400)]);
    motion.apply(delta({ moved: [at('a', 1000, 0)] }));

    for (let frame = 0; frame < 10; frame += 1) {
      const drawn = motion.advance(1 / 60);
      expect(centre(drawn.nodes, 'still')).toEqual({ x: 300, y: 400 });
    }
  });

  it('moves a retargeted node along the closed form, not towards it', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 100, 0)] }));

    // Released from rest, so the envelope is `(1 + u) e^-u` with `u = w t`, and
    // the displacement left after one half-life is half of what it started as
    // by the definition of HALF_LIFE_OMEGA.
    const frame = motion.advance(HALF_LIFE);
    expect(centre(frame.nodes, 'a').x).toBeCloseTo(50, 6);
    expect(frame.settled).toBe(false);
  });

  it('retargets mid-flight without moving the node it retargets', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 100, 0)] }));
    const before = centre(motion.advance(HALF_LIFE / 2).nodes, 'a');

    motion.apply(delta({ moved: [at('a', -400, 0)] }));
    const after = centre(motion.advance(0).nodes, 'a');

    // The interruption is the whole feature: the target is a parameter of the
    // equation and the state is the position and the velocity, so a second
    // delta arriving mid-flight cannot move the drawing at all on the frame it
    // arrives. A consumer that started the new spring from the delta's `from`
    // would jump here, which is why `MotionTarget` does not carry one.
    expect(after).toEqual(before);
  });

  it('carries velocity through a reversal rather than restarting from rest', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 100, 0)] }));
    const moving = centre(motion.advance(HALF_LIFE / 2).nodes, 'a');

    motion.apply(delta({ moved: [at('a', 0, 0)] }));
    const next = centre(motion.advance(1 / 600).nodes, 'a');

    // Still travelling away from the new target on the frame after the
    // reversal: a spring retargeted while moving overshoots once and comes
    // back. A restart from rest would have moved it straight back towards zero.
    expect(next.x).toBeGreaterThan(moving.x);
  });

  it('lands exactly on the target when it settles, not within the tolerance', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0), at('b', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 137.25, -8.5), at('b', 137.25, 12)] }));

    let frame = motion.advance(0);
    for (let step = 0; step < 600 && !frame.settled; step += 1) frame = motion.advance(1 / 60);

    expect(frame.settled).toBe(true);
    // Exactly, and the alignment is the reason: two nodes a layout put on the
    // same x that stop a hundredth of a unit apart are a rank that reads as
    // ragged, which no per-node sub-pixel bound catches.
    expect(centre(frame.nodes, 'a')).toEqual({ x: 137.25, y: -8.5 });
    expect(centre(frame.nodes, 'b').x).toBe(centre(frame.nodes, 'a').x);
  });

  it('is a fixed point once settled', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 40, 40)] }));

    let frame = motion.advance(0);
    for (let step = 0; step < 600 && !frame.settled; step += 1) frame = motion.advance(1 / 60);
    const settled = centre(frame.nodes, 'a');

    // Not "close to": a settled scene advanced by a long frame, a short one and
    // a zero one is the same scene to every bit. A caller who does not stop
    // their loop must not be paying for a drawing that keeps changing.
    expect(centre(motion.advance(1 / 60).nodes, 'a')).toEqual(settled);
    expect(centre(motion.advance(0).nodes, 'a')).toEqual(settled);
    expect(centre(motion.advance(3600).nodes, 'a')).toEqual(settled);
    expect(motion.advance(0).settled).toBe(true);
  });

  it('tracks the exported spring exactly, and snaps from inside the tolerance', () => {
    const rest = 0.05;
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE, restEpsilon: rest });
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ moved: [at('a', 1000, 0)] }));

    // The same trajectory driven by hand through the package's own exported
    // step. Two things come out of running them in lockstep: the module is
    // doing `stepSpring2D` and not an approximation of it, and the snap's jump
    // is bounded by the tolerance rather than by an argument about it.
    let reference: Spring2DState = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
    const target = { x: 1000, y: 0 };

    let frame = motion.advance(0);
    let steps = 0;
    while (!frame.settled && steps < 600) {
      expect(centre(frame.nodes, 'a')).toEqual(reference.position);
      reference = stepSpring2D(reference, target, W, 1 / 60);
      frame = motion.advance(1 / 60);
      steps += 1;
    }

    expect(frame.settled).toBe(true);
    expect(Math.abs(reference.position.x - target.x)).toBeLessThanOrEqual(rest);
    expect(Math.abs(reference.velocity.x)).toBeLessThanOrEqual(rest * W);
    // And the drawing is on the target rather than on the reference.
    expect(centre(frame.nodes, 'a')).toEqual(target);
  });

  it('starts a new node at its target rather than at the origin', () => {
    const motion = createNodeMotion();
    motion.resync([at('a', 0, 0)]);
    motion.apply(delta({ added: [at('fresh', 900, -300)] }));

    const frame = motion.advance(0);
    expect(centre(frame.nodes, 'fresh')).toEqual({ x: 900, y: -300 });
    expect(frame.settled).toBe(true);
  });

  it('keeps a removed node until its spring has finished, then drops it', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0), at('going', 0, 0)]);
    motion.apply(delta({ moved: [at('going', 500, 0)] }));
    motion.advance(HALF_LIFE / 4);

    motion.apply(delta({ removed: ['going'] }));
    const mid = motion.advance(1 / 60);
    const departing = mid.nodes.find((node) => node.id === 'going');
    expect(departing?.departing).toBe(true);
    expect(departing?.center.x).toBeGreaterThan(0);

    let frame = mid;
    for (let step = 0; step < 600 && !frame.settled; step += 1) frame = motion.advance(1 / 60);
    expect(ids(frame.nodes)).toEqual(['a']);
  });

  it('drops a node removed while at rest on the next frame', () => {
    const motion = createNodeMotion();
    motion.resync([at('a', 0, 0), at('gone', 7, 7)]);
    motion.apply(delta({ removed: ['gone'] }));

    // Its spring has already finished, so "once the spring finishes" is now.
    const frame = motion.advance(0);
    expect(ids(frame.nodes)).toEqual(['a']);
    expect(frame.settled).toBe(true);
  });

  it('revives a departing node from where it is when it comes back', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0), at('flicker', 0, 0)]);
    motion.apply(delta({ moved: [at('flicker', 600, 0)] }));
    motion.advance(HALF_LIFE / 3);
    motion.apply(delta({ removed: ['flicker'] }));
    const leaving = centre(motion.advance(1 / 60).nodes, 'flicker');

    motion.apply(delta({ added: [at('flicker', 600, 0)] }));
    const back = motion.advance(0);
    const revived = back.nodes.find((node) => node.id === 'flicker');

    // A re-add of something still on screen is a departure cancelled, not a
    // node arriving: starting it at its target would teleport it forward by
    // whatever was left of the departure.
    expect(revived?.departing).toBe(false);
    expect(revived?.center).toEqual(leaving);
  });

  it('does not start an animation for a delta that only resized a node', () => {
    const motion = createNodeMotion();
    motion.resync([at('a', 40, 40)]);

    // A `LayoutDelta` reports a resize as a move, because `from` and `to` are
    // whole boxes. A consumer that keys on the centre retargets to where the
    // node already is, and the correct amount of motion for that is none.
    motion.apply(delta({ moved: [at('a', 40, 40)] }));
    expect(motion.advance(0).settled).toBe(true);
  });

  it('applies removals before additions', () => {
    const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
    motion.resync([at('a', 0, 0)]);

    // M3.1's contract states the order for the case an edge produces, where one
    // id is in both lists. A node cannot be, so this is the order being kept
    // rather than the order being needed. Taken the other way round the add
    // would throw on an id that is still live and the removal would then
    // depart the node that had just replaced it.
    expect(() => motion.apply(delta({ removed: ['a'], added: [at('a', 5, 5)] }))).not.toThrow();

    // One id is one node, so the pair is a departure cancelled by an arrival
    // and not two nodes: it stays where it was and springs to the new target.
    const frame = motion.advance(0);
    expect(frame.nodes.find((node) => node.id === 'a')?.departing).toBe(false);
    expect(centre(frame.nodes, 'a')).toEqual({ x: 0, y: 0 });
    expect(frame.settled).toBe(false);
  });

  describe('desynchronisation', () => {
    it('refuses a move naming a node it has never seen', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      expect(() => motion.apply(delta({ moved: [at('ghost', 1, 1)] }))).toThrow(MotionDesyncError);
    });

    it('refuses an add naming a node it already holds', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      expect(() => motion.apply(delta({ added: [at('a', 1, 1)] }))).toThrow(MotionDesyncError);
    });

    it('refuses a removal naming a node it does not hold', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      expect(() => motion.apply(delta({ removed: ['b'] }))).toThrow(MotionDesyncError);
    });

    it('refuses a second removal of a node already on its way out', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0)]);
      motion.apply(delta({ moved: [at('a', 900, 0)] }));
      motion.advance(1 / 60);
      motion.apply(delta({ removed: ['a'] }));
      expect(() => motion.apply(delta({ removed: ['a'] }))).toThrow(MotionDesyncError);
    });

    it('refuses a move naming a node on its way out', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0)]);
      motion.apply(delta({ moved: [at('a', 900, 0)] }));
      motion.advance(1 / 60);
      motion.apply(delta({ removed: ['a'] }));
      expect(() => motion.apply(delta({ moved: [at('a', 5, 5)] }))).toThrow(MotionDesyncError);
    });

    it('names the node and the code a caller switches on', () => {
      const motion = createNodeMotion();
      let thrown: unknown;
      try {
        motion.apply(delta({ moved: [at('n42', 1, 1)] }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MotionDesyncError);
      expect((thrown as MotionDesyncError).code).toBe('MOTION_DESYNC');
      expect((thrown as MotionDesyncError).message).toContain('n42');
    });

    it('leaves the scene it refused untouched', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 3, 4)]);
      expect(() => motion.apply(delta({ moved: [at('ghost', 1, 1)] }))).toThrow(MotionDesyncError);

      // A refused delta is not a half-applied one: the throw is the caller's
      // signal to resync, and a scene that had already taken half the lists
      // would resync from a state nothing described.
      const frame = motion.advance(0);
      expect(ids(frame.nodes)).toEqual(['a']);
      expect(centre(frame.nodes, 'a')).toEqual({ x: 3, y: 4 });
    });
  });

  describe('resync', () => {
    it('animates the correction rather than snapping to it', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0)]);

      // The scene is where a dropped delta left it, and the caller has the
      // truth. Keeping the spring means the picture converges on the truth
      // instead of teleporting onto it.
      motion.resync([at('a', 400, 0)]);
      const frame = motion.advance(0);
      expect(centre(frame.nodes, 'a')).toEqual({ x: 0, y: 0 });
      expect(frame.settled).toBe(false);
    });

    it('drops what it does not name, with no departure', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0), at('b', 1, 1)]);
      motion.resync([at('a', 0, 0)]);

      // A delta describes a change, so a removal has a moment to animate from.
      // A resync describes a state and has none.
      expect(ids(motion.advance(0).nodes)).toEqual(['a']);
    });

    it('forgets a departure it does not name', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0), at('going', 0, 0)]);
      motion.apply(delta({ moved: [at('going', 500, 0)] }));
      motion.advance(1 / 60);
      motion.apply(delta({ removed: ['going'] }));

      motion.resync([at('a', 0, 0)]);
      expect(ids(motion.advance(0).nodes)).toEqual(['a']);
      // And the id is free again, so the delta that re-adds it is an add.
      expect(() => motion.apply(delta({ added: [at('going', 0, 0)] }))).not.toThrow();
    });

    it('takes a node it has never seen at its target, at rest', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      motion.resync([at('a', 0, 0), at('new', 88, 99)]);

      const frame = motion.advance(0);
      expect(centre(frame.nodes, 'new')).toEqual({ x: 88, y: 99 });
      expect(frame.settled).toBe(true);
    });

    it('is what makes a refused delta recoverable', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      expect(() => motion.apply(delta({ moved: [at('ghost', 1, 1)] }))).toThrow(MotionDesyncError);

      motion.resync([at('a', 0, 0), at('ghost', 1, 1)]);
      expect(() => motion.apply(delta({ moved: [at('ghost', 2, 2)] }))).not.toThrow();
    });
  });

  describe('arguments', () => {
    it('rejects a negative frame', () => {
      const motion = createNodeMotion();
      expect(() => motion.advance(-1 / 60)).toThrow(RangeError);
    });

    it('rejects a frame that is not a number', () => {
      const motion = createNodeMotion();
      expect(() => motion.advance(Number.NaN)).toThrow(RangeError);
    });

    it('rejects a target that is not finite, naming the field', () => {
      const motion = createNodeMotion();
      expect(() => motion.resync([at('a', Number.NaN, 0)])).toThrow(/targets\[0\]\.center\.x/);
      expect(() => motion.apply(delta({ added: [at('a', 0, Infinity)] }))).toThrow(
        /added\[0\]\.center\.y/,
      );
    });

    it('rejects a half-life and a tolerance that are not above zero', () => {
      expect(() => createNodeMotion({ halfLifeSeconds: 0 })).toThrow(/halfLifeSeconds/);
      expect(() => createNodeMotion({ restEpsilon: -1 })).toThrow(/restEpsilon/);
    });

    it('publishes the defaults it applies', () => {
      // Exported rather than only documented, so a caller tuning one of them
      // can say "a third of the default" and a test can assert against the
      // number the module actually used.
      expect(DEFAULT_MOTION_HALF_LIFE).toBeGreaterThan(0);
      expect(DEFAULT_MOTION_REST).toBeGreaterThan(0);

      const tuned = createNodeMotion({ halfLifeSeconds: DEFAULT_MOTION_HALF_LIFE });
      const bare = createNodeMotion();
      for (const motion of [tuned, bare]) {
        motion.resync([at('a', 0, 0)]);
        motion.apply(delta({ moved: [at('a', 256, 0)] }));
      }
      expect(centre(tuned.advance(1 / 60).nodes, 'a')).toEqual(centre(bare.advance(1 / 60).nodes, 'a'));
    });
  });

  describe('the frame it returns', () => {
    it('is a fresh array of fresh records', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0)]);
      motion.apply(delta({ moved: [at('a', 100, 0)] }));

      const first = motion.advance(1 / 60);
      const second = motion.advance(1 / 60);
      expect(second.nodes).not.toBe(first.nodes);
      // The previous frame is still readable, which is what lets a caller
      // compare two frames rather than only draw the latest one.
      expect(centre(first.nodes, 'a').x).toBeLessThan(centre(second.nodes, 'a').x);
    });

    it('reports settled for an empty scene', () => {
      const motion = createNodeMotion();
      const frame = motion.advance(1 / 60);
      expect(frame.nodes).toEqual([]);
      expect(frame.settled).toBe(true);
    });

    it('is unsettled while any one node is still moving', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('slow', 0, 0), at('a', 0, 0), at('b', 0, 0)]);
      motion.apply(delta({ moved: [at('slow', 5000, 0)] }));

      let frame = motion.advance(0);
      let steps = 0;
      while (!frame.settled && steps < 2000) {
        expect(centre(frame.nodes, 'a')).toEqual({ x: 0, y: 0 });
        frame = motion.advance(1 / 60);
        steps += 1;
      }
      expect(frame.settled).toBe(true);
      expect(steps).toBeGreaterThan(1);
    });
  });

  describe('the long frame', () => {
    it('arrives settled rather than catching up', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0)]);
      motion.apply(delta({ moved: [at('a', 100, -50)] }));

      // A backgrounded tab hands back a delta of minutes. Exactly stepped that
      // is the settled drawing, which is what a returning tab should show.
      const frame = motion.advance(600);
      expect(centre(frame.nodes, 'a')).toEqual({ x: 100, y: -50 });
      expect(frame.settled).toBe(true);
    });

    it('drops a departing node in one frame rather than after a catch-up', () => {
      const motion = createNodeMotion({ halfLifeSeconds: HALF_LIFE });
      motion.resync([at('a', 0, 0), at('going', 0, 0)]);
      motion.apply(delta({ moved: [at('going', 900, 0)] }));
      motion.advance(1 / 60);
      motion.apply(delta({ removed: ['going'] }));

      expect(ids(motion.advance(600).nodes)).toEqual(['a']);
    });
  });

  describe('the shape of a delta', () => {
    it('takes the lists in the order a LayoutDelta gives them', () => {
      // Structural, and deliberately not `LayoutDelta` itself: this package does
      // not depend on `@dagr/layout`, and the conversion a caller does is the
      // same y-flip `setNodes` already asks of them. The shape below is what
      // that conversion produces, written out so the compiler checks it.
      const converted: NodeMotionDelta = {
        added: [{ id: 'n1', center: { x: 0, y: 0 } }],
        removed: ['n0'],
        moved: [{ id: 'n2', center: { x: 4, y: 4 } }],
      };
      const motion = createNodeMotion();
      motion.resync([at('n0', 1, 1), at('n2', 2, 2)]);
      expect(() => motion.apply(converted)).not.toThrow();
      expect(ids(motion.advance(0).nodes)).toEqual(['n1', 'n2']);
    });

    it('catches a duplicate add and a duplicate removal for free', () => {
      const motion = createNodeMotion();
      motion.resync([at('a', 0, 0)]);
      expect(() =>
        motion.apply(delta({ added: [at('twice', 0, 0), at('twice', 1, 1)] })),
      ).toThrow(MotionDesyncError);

      const fresh = createNodeMotion();
      fresh.resync([at('a', 0, 0)]);
      expect(() => fresh.apply(delta({ removed: ['a', 'a'] }))).toThrow(MotionDesyncError);
    });
  });
});
