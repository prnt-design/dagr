import { MotionDesyncError } from './errors.js';
import { omegaForHalfLife, stepSpring2D } from './spring.js';
import type { Spring2DState } from './spring.js';
import type { Vec2 } from './types.js';
import { requireFinite, requireNonNegative, requirePositive } from './validate.js';

/**
 * The delta consumer, node half: a scene's worth of springs, retargeted by a
 * change rather than by a redrawing.
 *
 * M4.6 shipped the arithmetic and deliberately shipped no loop, on the grounds
 * that the clock belongs to whoever owns the frame. This is the other half of
 * that seam and it still owns no clock: {@link NodeMotion.advance} takes the
 * elapsed seconds. What it owns is the STATE between two deltas, which is the
 * part a caller cannot supply and the part the whole task turns on.
 *
 * **The renderer holds its own scene state, and the ROADMAP's question about
 * that has an answer rather than a preference.** M4.7's entry asks whether the
 * renderer applies deltas to state it keeps, or is handed the full
 * `LayoutResult` alongside each delta. The second is not available: a spring's
 * POSITION AND VELOCITY are not in any `LayoutResult`, because a layout says
 * where a node belongs and this module is about where it currently is on the
 * way there. So the renderer is already stateful, and the real question is
 * narrower: whether it keeps a second copy of the LAYOUT's answer too. It
 * keeps one target per node, which is the smallest thing the springs need, and
 * nothing else: no sizes, no shapes, no routes, no bounds.
 *
 * **The cost of that is desynchronisation, and it is paid for loudly.** A
 * dropped or reordered delta leaves the targets describing a graph nobody has,
 * and the M4.7 entry names the observable symptom exactly right: a delta that
 * moves a node this module has never seen. Every one of those is a
 * {@link MotionDesyncError} rather than a silent adoption, on the polarity
 * this project keeps landing on: a wrong drawing returned in silence is worse
 * than a throw at the line that caused it. {@link NodeMotion.resync} is the way
 * back, and it is the same call a caller makes to seed the scene in the first
 * place.
 *
 * **The delta is not `LayoutDelta`, and this package still does not depend on
 * `@dagr/layout`.** {@link NodeMotionDelta} carries a world-space CENTRE per
 * node, which is what a spring pulls towards, where `LayoutDelta` carries
 * y-down boxes. The conversion is the one `setNodes` already asks of a caller,
 * and `camera.ts` has said since M4.1 that the y flip belongs to whoever owns
 * the layout. Doing it here would put a `LayoutResult` in this package's
 * surface for the second time in two tasks after `scene-nodes.ts` refused it
 * once.
 *
 * `MotionTarget` carries no `from`, which is the field `MovedNode` has and this
 * module must not use. A delta's `from` is where the LAYOUT last put the node,
 * and a spring interrupted mid-flight is not there: starting the new spring
 * from it would undo the interruptibility that is the point of the task. Where
 * the drawing is, is this module's own state.
 *
 * **What is deliberately not here is edges, and the seam is a real one.** A
 * node moves as a point, so one 2D spring is the whole of it. An edge is a
 * polyline whose VERTEX COUNT changes between two routes: a long edge gaining
 * a rank to cross gains a bend, and `delta.ts` says in as many words that no
 * per-point comparison catches it. There is nothing to retarget until somebody
 * decides what corresponds to what, and that decision is M4.7b's along with
 * the bounds change and the frame loop that drives both.
 */

/** Where a node is being pulled to: its id, and its centre in world units, y up. */
export interface MotionTarget {
  readonly id: string;
  /** The centre, in world units, y up. The same convention `SceneNode` uses. */
  readonly center: Vec2;
}

/**
 * What changed about the nodes, in the shape M3.1's `NodeDelta` gives it.
 *
 * The three lists and their meanings are `@dagr/layout`'s: `added` is what the
 * next layout holds and the previous one did not, `removed` is ids the previous
 * one held and the next does not, and `moved` is what both hold in a different
 * place. ABSENT MEANS UNCHANGED, so a scene of ten thousand nodes where one
 * moved is a delta of one, and this module iterates the change rather than the
 * graph.
 *
 * REMOVALS APPLY BEFORE ADDITIONS, which is M3.1's rule and is kept here even
 * though the case it was written for cannot arise: an EDGE id can be in both
 * lists, because an edge that changed endpoints is reported that way, and a
 * node id cannot. Keeping the order costs nothing and means a consumer reading
 * either list first agrees with the other one. For a node the pair reads as a
 * departure cancelled by an arrival, since one id is one node.
 */
export interface NodeMotionDelta {
  readonly added: readonly MotionTarget[];
  readonly removed: readonly string[];
  readonly moved: readonly MotionTarget[];
}

/** One node as it should be drawn this frame. */
export interface MotionNode {
  readonly id: string;
  /** Where the spring has got to, in world units, y up. */
  readonly center: Vec2;
  /**
   * Whether a delta has removed this node and its spring has not finished yet.
   *
   * A departing node is still in the frame and is still moving, so a caller can
   * fade it, shrink it, or simply keep drawing it until it goes. The frame
   * after its spring settles is the frame it is not in.
   */
  readonly departing: boolean;
}

/**
 * One frame's worth of answer: what to draw, and whether to ask for another.
 *
 * `settled` is the property that lets a caller stop their loop, and it is the
 * settled predicate M4.6's entry declined to invent before it had a consumer.
 * True means every spring is exactly on its target with zero velocity, so
 * advancing again by any elapsed time at all returns this same frame: an
 * animation that cannot say it is finished is a `requestAnimationFrame` that
 * never stops.
 */
export interface MotionFrame {
  readonly nodes: readonly MotionNode[];
  readonly settled: boolean;
}

/** How the motion should feel, and when it should call itself done. */
export interface NodeMotionOptions {
  /**
   * Seconds to close half the distance to a target, released from rest.
   * Defaults to {@link DEFAULT_MOTION_HALF_LIFE}.
   */
  readonly halfLifeSeconds?: number;
  /**
   * How close, in world units, counts as arrived. Defaults to
   * {@link DEFAULT_MOTION_REST}.
   */
  readonly restEpsilon?: number;
}

/** A scene's springs, and the two things that are done to them. */
export interface NodeMotion {
  /**
   * Replaces the roster with `targets`, absolutely.
   *
   * This is the resync path M4.7's entry asks for, and it is also how a scene
   * is seeded before any delta exists. A node already here KEEPS its spring, so
   * a correction after a dropped delta is animated rather than teleported to;
   * a node not here starts at its target, at rest; a node here and not in
   * `targets` is dropped with no departure at all. That last one is the
   * difference between this call and a removal, and the reason is that a delta
   * describes a CHANGE and so has a moment to animate from, while this
   * describes a STATE and has none.
   */
  resync(targets: readonly MotionTarget[]): void;

  /**
   * Retargets the springs a delta names, and starts or cancels departures.
   *
   * ALL OR NOTHING. Every id in the delta is checked against the scene before
   * anything is mutated, so a {@link MotionDesyncError} leaves the scene
   * exactly as it was. A half-applied delta would be the worst available
   * outcome: the caller's signal to resync arrives having already moved the
   * thing they would resync from.
   *
   * Nothing here reports whether the delta started any motion. `advance(0)` is
   * the answer, and it is exact: a delta that only resized a node retargets a
   * spring to where it already is, and the correct amount of motion for that is
   * none.
   */
  apply(delta: NodeMotionDelta): void;

  /**
   * Steps every spring by `dtSeconds` and returns the frame to draw.
   *
   * Not clamped, on `spring.ts`'s terms: the step is exact, so a backgrounded
   * tab handing back a delta of minutes lands every spring on its target and
   * shows the settled drawing rather than a minute of catch-up. A departing
   * node in that frame is gone in one frame rather than after a replay.
   */
  advance(dtSeconds: number): MotionFrame;
}

/**
 * The default half-life, in seconds.
 *
 * 120ms is the number `render.md`'s spring example has used since M4.6, so the
 * default is the documented feel rather than a new opinion. A spring is
 * visually done after just under four half-lives, which puts a relayout at
 * about half a second: long enough to be followed, short enough that a second
 * edit is not waiting on the first.
 */
export const DEFAULT_MOTION_HALF_LIFE = 0.12;

/**
 * The default arrival tolerance, in world units.
 *
 * World units are CSS pixels at zoom 1, which is the convention the HTML
 * overlay fixes, so a twentieth of a unit is a twentieth of a pixel there and
 * stays under one pixel out to twenty times zoom. A caller drawing further in
 * than that is the caller who should name a smaller one, and the cost of doing
 * so is frames rather than correctness.
 */
export const DEFAULT_MOTION_REST = 0.05;

/** What this module knows about one node between two deltas. */
interface Entry {
  spring: Spring2DState;
  target: Vec2;
  departing: boolean;
  /**
   * Whether the spring is still in flight.
   *
   * Held rather than recomputed because it is the flag that makes a settled
   * scene free: a node that has arrived is skipped entirely, so a drawing where
   * one node moves costs one spring step and not ten thousand.
   */
  moving: boolean;
}

/** What a delta intends to do to one id, worked out before anything is done. */
type Intent =
  | { readonly kind: 'depart' }
  | { readonly kind: 'arrive'; readonly target: Vec2 }
  | { readonly kind: 'revive'; readonly target: Vec2 }
  | { readonly kind: 'retarget'; readonly target: Vec2 };

/** Whether an id is in the scene, and if so whether it is on its way out. */
type Presence = 'absent' | 'live' | 'departing';

const AT_REST = { x: 0, y: 0 };

/** Rejects a target whose centre is not two finite numbers, naming the field. */
function requireTarget(target: MotionTarget, field: string): MotionTarget {
  requireFinite(target.center.x, `${field}.center.x`);
  requireFinite(target.center.y, `${field}.center.y`);
  return target;
}

/**
 * Creates a motion state for one scene's nodes.
 *
 * @param options The feel and the arrival tolerance. See
 *   {@link NodeMotionOptions}.
 */
export function createNodeMotion(options: NodeMotionOptions = {}): NodeMotion {
  const halfLife = options.halfLifeSeconds ?? DEFAULT_MOTION_HALF_LIFE;
  const restEpsilon = options.restEpsilon ?? DEFAULT_MOTION_REST;
  requirePositive(halfLife, 'halfLifeSeconds');
  requirePositive(restEpsilon, 'restEpsilon');

  const w = omegaForHalfLife(halfLife);

  /**
   * The speed below which a spring counts as stopped, in world units per
   * second.
   *
   * Derived rather than passed, because `w` is the only inverse time in the
   * system and `restEpsilon * w` is therefore the one speed scale the tolerance
   * has. A second knob in different units would be two numbers a caller has to
   * keep consistent to express one opinion, and the pair that is inconsistent
   * is a scene that settles while still visibly moving.
   */
  const restSpeed = restEpsilon * w;

  const entries = new Map<string, Entry>();

  /**
   * Whether a stepped spring has arrived.
   *
   * Per axis rather than by distance, because `stepSpring2D` is two independent
   * scalar springs and not one spring in the plane: the test that matches the
   * arithmetic is the one each axis can answer for itself.
   */
  function atRest(state: Spring2DState, target: Vec2): boolean {
    return (
      Math.abs(state.position.x - target.x) <= restEpsilon &&
      Math.abs(state.position.y - target.y) <= restEpsilon &&
      Math.abs(state.velocity.x) <= restSpeed &&
      Math.abs(state.velocity.y) <= restSpeed
    );
  }

  /** Points an existing entry at a new target and works out whether that moves it. */
  function retarget(entry: Entry, target: Vec2): void {
    entry.target = target;
    entry.moving = !atRest(entry.spring, target);
  }

  function resync(targets: readonly MotionTarget[]): void {
    for (const [index, target] of targets.entries()) {
      requireTarget(target, `targets[${String(index)}]`);
    }
    const kept = new Map<string, Entry>();
    for (const target of targets) {
      const existing = entries.get(target.id);
      if (existing === undefined) {
        kept.set(target.id, {
          spring: { position: target.center, velocity: AT_REST },
          target: target.center,
          departing: false,
          moving: false,
        });
        continue;
      }
      existing.departing = false;
      retarget(existing, target.center);
      kept.set(target.id, existing);
    }
    entries.clear();
    for (const [id, entry] of kept) entries.set(id, entry);
  }

  function apply(delta: NodeMotionDelta): void {
    // Worked out in full before anything is mutated, so a refusal leaves the
    // scene untouched. The overlay is keyed by the ids the DELTA names, so it
    // is proportional to the change and not to the scene, which is the property
    // absent-means-unchanged exists to give this module.
    const planned = new Map<string, Intent>();

    function presence(id: string): Presence {
      const intent = planned.get(id);
      if (intent !== undefined) return intent.kind === 'depart' ? 'departing' : 'live';
      const entry = entries.get(id);
      if (entry === undefined) return 'absent';
      return entry.departing ? 'departing' : 'live';
    }

    for (const [index, id] of delta.removed.entries()) {
      const where = presence(id);
      if (where !== 'live') {
        throw new MotionDesyncError(id, `removed[${String(index)}]`, 'removed', where);
      }
      planned.set(id, { kind: 'depart' });
    }
    for (const [index, target] of delta.added.entries()) {
      const field = `added[${String(index)}]`;
      requireTarget(target, field);
      const where = presence(target.id);
      if (where === 'live') {
        throw new MotionDesyncError(target.id, field, 'added', where);
      }
      planned.set(target.id, {
        kind: where === 'departing' ? 'revive' : 'arrive',
        target: target.center,
      });
    }
    for (const [index, target] of delta.moved.entries()) {
      const field = `moved[${String(index)}]`;
      requireTarget(target, field);
      const where = presence(target.id);
      if (where !== 'live') {
        throw new MotionDesyncError(target.id, field, 'moved', where);
      }
      planned.set(target.id, { kind: 'retarget', target: target.center });
    }

    for (const [id, intent] of planned) {
      if (intent.kind === 'arrive') {
        entries.set(id, {
          spring: { position: intent.target, velocity: AT_REST },
          target: intent.target,
          departing: false,
          moving: false,
        });
        continue;
      }
      // Every other intent was checked against an entry that exists.
      const entry = entries.get(id);
      if (entry === undefined) continue;
      if (intent.kind === 'depart') {
        entry.departing = true;
        continue;
      }
      // A revive is a departure cancelled: the node keeps where it is and where
      // it was going, so coming back is not a jump forward by whatever was left
      // of the departure.
      entry.departing = false;
      retarget(entry, intent.target);
    }
  }

  function advance(dtSeconds: number): MotionFrame {
    // Once, here, rather than per node inside `stepSpring2D`: this is the
    // caller's number and every other argument the step sees is one this
    // module produced.
    requireNonNegative(dtSeconds, 'dtSeconds');

    const nodes: MotionNode[] = [];
    let settled = true;
    // Deleting the current key while iterating a Map is defined: the iterator
    // moves on to the next live entry. Nothing else is added or removed here.
    for (const [id, entry] of entries) {
      if (entry.moving) {
        const stepped = stepSpring2D(entry.spring, entry.target, w, dtSeconds);
        if (atRest(stepped, entry.target)) {
          // Exactly on the target rather than within the tolerance of it. The
          // residual would be bounded and permanent, and the visible form of a
          // permanent residual is not one node in the wrong place: it is a rank
          // of nodes a layout aligned that stop a hundredth of a unit apart,
          // which reads as ragged at a glance where a single node does not.
          // The price is one discontinuity per arrival, bounded by
          // `restEpsilon` and taken at the moment of least motion.
          entry.spring = { position: entry.target, velocity: AT_REST };
          entry.moving = false;
        } else {
          entry.spring = stepped;
        }
      }
      if (entry.departing && !entry.moving) {
        entries.delete(id);
        continue;
      }
      if (entry.moving) settled = false;
      nodes.push({ id, center: entry.spring.position, departing: entry.departing });
    }
    return { nodes, settled };
  }

  return { resync, apply, advance };
}
