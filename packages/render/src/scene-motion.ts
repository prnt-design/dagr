import { createPlannedBoundsMotion } from './bounds-motion.js';
import { createPlannedEdgeMotion } from './edge-motion.js';
import type { EdgeMotionDelta, EdgeMotionTarget, MotionEdge } from './edge-motion.js';
import { createPlannedNodeMotion } from './motion.js';
import type { MotionNode, MotionTarget, NodeMotionDelta } from './motion.js';
import type { WorldBounds } from './types.js';

/**
 * The delta consumer as one thing: nodes, edges and the box, retargeted by one
 * delta and stepped by one clock.
 *
 * M4.7a and M4.7b shipped the halves separately and each said so: a caller
 * driving both stops when BOTH say settled, and one delta's nodes and edges
 * should arrive together. This is the module that makes those two sentences
 * one call each. It adds no arithmetic. What it adds is the ONE property that
 * cannot exist in either half alone.
 *
 * **APPLYING A SCENE DELTA IS ALL OR NOTHING ACROSS THE SCENE.** Each half is
 * already all or nothing for itself: every check that can throw runs before
 * anything is mutated. But a scene delta names nodes AND edges, and applying
 * the node half and then refusing the edge half hands the caller precisely the
 * half-applied scene both halves promise never to produce, with the node
 * springs already moved by the delta the caller is about to resync away from.
 * So the halves expose their two mutations as a PLAN and a COMMIT (see
 * `PlannedNodeMotion`), this module asks all three halves to plan first, and
 * only when it holds every commit does it run any. A `MotionDesyncError` or a
 * `RangeError` from any half therefore leaves all three exactly as they were.
 * The plans are internal to the package, because a caller of one half alone
 * has nothing to coordinate with.
 *
 * **ABSENT MEANS UNCHANGED, PER HALF.** A delta that names no edges leaves the
 * edges alone, which is what `LayoutDelta.bounds` being `undefined` already
 * means for the box and is extended to the two rosters. A ROSTER is different:
 * `resync` describes a whole state, so a roster without a box is a scene with
 * no box, rather than a scene with the box it had.
 *
 * **ONE FEEL FOR ALL THREE.** One half-life and one tolerance, because one
 * delta is one change and three arrival times would be three changes.
 *
 * What is deliberately NOT here is any `LayoutDelta`, any `LayoutResult`, and
 * any renderer: the conversion into world centres and routes stays with
 * whoever owns the layout, as it has since M4.1, and the frame this returns is
 * what a caller hands to `setNodes` and `setEdges` after dressing it. The loop
 * that calls `advance` is `motion-loop.ts`.
 */

/** What a scene is made of, absolutely. The shape `resync` takes. */
export interface SceneMotionRoster {
  readonly nodes: readonly MotionTarget[];
  readonly edges: readonly EdgeMotionTarget[];
  /** The drawing's box. Absent means the scene has none. */
  readonly bounds?: WorldBounds;
}

/**
 * What changed, in the shape one relayout reports it.
 *
 * Every field is optional and ABSENT MEANS UNCHANGED, so a relayout that moved
 * two nodes and nothing else is a delta naming two nodes.
 */
export interface SceneMotionDelta {
  readonly nodes?: NodeMotionDelta;
  readonly edges?: EdgeMotionDelta;
  /** The box after the change. Absent means it did not change. */
  readonly bounds?: WorldBounds;
}

/** One frame's worth of answer for the whole scene. */
export interface SceneMotionFrame {
  readonly nodes: readonly MotionNode[];
  readonly edges: readonly MotionEdge[];
  /** The box as the springs have it, or `null` when the scene has none. */
  readonly bounds: WorldBounds | null;
  /** True when every half says so: the predicate a loop stops on. */
  readonly settled: boolean;
}

/** How the whole scene should feel. One number each, shared by all three halves. */
export interface SceneMotionOptions {
  /** See `NodeMotionOptions.halfLifeSeconds`. Defaults to `DEFAULT_MOTION_HALF_LIFE`. */
  readonly halfLifeSeconds?: number;
  /** See `NodeMotionOptions.restEpsilon`. Defaults to `DEFAULT_MOTION_REST`. */
  readonly restEpsilon?: number;
}

/** A scene's springs, and the three things done to them. */
export interface SceneMotion {
  /**
   * Replaces the scene with `roster`, absolutely, across all three halves or
   * not at all. See `NodeMotion.resync` for what happens to a node already
   * here (it keeps its spring) and one that is not in the roster (it is
   * dropped with no departure).
   */
  resync(roster: SceneMotionRoster): void;

  /**
   * Retargets whatever `delta` names. ALL OR NOTHING ACROSS THE SCENE: a half
   * that refuses leaves every half untouched. See the module docstring.
   */
  apply(delta: SceneMotionDelta): void;

  /** Steps every half by `dtSeconds` and returns the frame to draw. */
  advance(dtSeconds: number): SceneMotionFrame;
}

/**
 * Creates a motion state for a whole scene.
 *
 * @param options The feel and the arrival tolerance, shared by all three
 *   halves. See {@link SceneMotionOptions}.
 */
export function createSceneMotion(options: SceneMotionOptions = {}): SceneMotion {
  const nodes = createPlannedNodeMotion(options);
  const edges = createPlannedEdgeMotion(options);
  const bounds = createPlannedBoundsMotion(options);

  // Plan all three, then commit all three. Nothing between the first plan and
  // the last commit can throw, which is the whole of the property: every check
  // runs against the state every commit will still find, because no commit has
  // run yet. See `PlannedBoundsMotion` for why the bounds half needs a plan of
  // its own rather than a throwaway probe, which is what the first version of
  // this file used and which could pass where the real retarget would throw.
  function resync(roster: SceneMotionRoster): void {
    const commitNodes = nodes.planResync(roster.nodes);
    const commitEdges = edges.planResync(roster.edges);
    const commitBounds = bounds.planResync(roster.bounds ?? null);
    commitNodes();
    commitEdges();
    commitBounds();
  }

  function apply(delta: SceneMotionDelta): void {
    const commitNodes = delta.nodes === undefined ? undefined : nodes.planApply(delta.nodes);
    const commitEdges = delta.edges === undefined ? undefined : edges.planApply(delta.edges);
    const commitBounds =
      delta.bounds === undefined ? undefined : bounds.planRetarget(delta.bounds);
    commitNodes?.();
    commitEdges?.();
    commitBounds?.();
  }

  function advance(dtSeconds: number): SceneMotionFrame {
    const nodeFrame = nodes.advance(dtSeconds);
    const edgeFrame = edges.advance(dtSeconds);
    const boundsFrame = bounds.advance(dtSeconds);
    return {
      nodes: nodeFrame.nodes,
      edges: edgeFrame.edges,
      bounds: boundsFrame.bounds,
      settled: nodeFrame.settled && edgeFrame.settled && boundsFrame.settled,
    };
  }

  return { resync, apply, advance };
}
