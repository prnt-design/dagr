/**
 * The other half of the conversion `scene.ts` owns: a `LayoutDelta` into the
 * shape `@dagr/render`'s scene motion takes, and the one decision a caller
 * driving it has to get right.
 *
 * `scene.ts` turns a whole `LayoutResult` into a whole drawing. That is what a
 * renderer needs at mount and what it needs after a cold run, and it is exactly
 * what an animation must NOT be handed on every edit: a scene rebuilt from a
 * result is a scene with no history, and a spring with no history cuts. What an
 * animation needs is the difference, which `@dagr/layout` already computes and
 * `@dagr/render` already consumes, in two vocabularies that differ by one minus
 * sign. This file is that minus sign, applied to the three lists that carry a
 * position.
 *
 * **The flip is the same flip, and that is the whole of the risk.** `scene.ts`
 * says it: a layout runs y-down and the renderer's world is y-up, and flipping
 * some of the expressions draws a picture that is half upside down with every
 * unit test on the flipped halves still green. There are now six expressions
 * rather than three, and a delta's are the worse three, because a delta is
 * applied to a scene that already exists: a target flipped the wrong way does
 * not draw the node upside down, it springs the node to the mirror of where it
 * belongs and leaves it there. So `animation.test.ts` asserts the delta's
 * targets against what `toSceneNodes` and `toWorldBounds` put in the same place
 * for the same run, rather than against numbers written by hand.
 *
 * **A DELTA IS A DIFFERENCE FROM A DRAWING, AND A COLD RUN IS NOT.** {@link
 * retarget} is the one place that decision is written down. `useDagr` reports a
 * run it could not describe as a difference by handing back no delta at all
 * (see `DagrLayoutState.delta`), which happens on the first run of a graph, on
 * a config change, and on the recovery from a patch the engine refused. Those
 * are the runs where the scene has to be reseated absolutely rather than
 * retargeted, and reseating is `resync`.
 *
 * Nothing here touches React and nothing here holds state, for the reason
 * `scene.ts` gives: the arithmetic is the part worth testing without a DOM, and
 * `<DagrCanvas>` is then wiring rather than arithmetic.
 */

import type { LayoutDelta, NodeGeometry, Point } from '@dagr/layout';
import { MotionDesyncError } from '@dagr/render';
import type {
  EdgeMotionTarget,
  MotionTarget,
  SceneEdge,
  SceneMotion,
  SceneMotionDelta,
  SceneMotionRoster,
  SceneNode,
  WorldBounds,
} from '@dagr/render';
import { toWorldBounds } from './scene.js';

/** A layout-space box as the target of a spring, y up. */
function centerOf(id: string, geometry: NodeGeometry | Point): MotionTarget {
  return { id, center: { x: geometry.x, y: -geometry.y } };
}

/** A layout-space polyline as the target of a route, y up, source to target. */
function routeOf(id: string, points: readonly Point[]): EdgeMotionTarget {
  return { id, points: points.map((point) => ({ x: point.x, y: -point.y })) };
}

/**
 * A relayout's delta in the renderer's world.
 *
 * `removed` is copied rather than forwarded, because `LayoutDelta`'s lists are
 * `readonly NodeId[]` and a `NodeId` is a string: the copy costs a list
 * proportional to the edit and it means the motion holds no reference into a
 * structure the engine may reuse.
 *
 * `bounds` forwards `undefined` rather than dropping the key, which is what
 * both sides already mean by it: `LayoutDelta.bounds` is a key that is always
 * present and sometimes `undefined`, and `SceneMotionDelta.bounds` is declared
 * `?: T | undefined` so that this forwards without a conditional spread.
 */
export function toMotionDelta(delta: LayoutDelta): SceneMotionDelta {
  return {
    nodes: {
      added: delta.nodes.added.map((node) => centerOf(node.id, node)),
      removed: [...delta.nodes.removed],
      moved: delta.nodes.moved.map((node) => centerOf(node.id, node.to)),
    },
    edges: {
      added: delta.edges.added.map((edge) => routeOf(edge.id, edge.points)),
      removed: [...delta.edges.removed],
      rerouted: delta.edges.rerouted.map((edge) => routeOf(edge.id, edge.to)),
    },
    bounds: delta.bounds === undefined ? undefined : toWorldBounds(delta.bounds.to),
  };
}

/**
 * The drawing as it stands, in the shape `resync` takes.
 *
 * The scene arrays are passed through rather than rebuilt, because a
 * {@link SceneNode} already IS a `MotionTarget` and a {@link SceneEdge} already
 * is an `EdgeMotionTarget`: both carry the two fields the motion reads, dressed
 * with the ones it ignores. Building a second pair of arrays to drop the
 * dressing would be a copy of the whole drawing, per reseat, to hide fields
 * nothing looks at.
 *
 * `null` becomes `undefined` because the two types say the same thing with
 * different words: `WorldBounds | null` is what this package carries for a
 * layout with no box, and an absent `bounds` is what a roster means by it.
 */
export function toMotionRoster(
  nodes: readonly SceneNode[],
  edges: readonly SceneEdge[],
  bounds: WorldBounds | null,
): SceneMotionRoster {
  return { nodes, edges, bounds: bounds ?? undefined };
}

/** What {@link retarget} did, which is the difference between a glide and a cut. */
export type Retargeting = 'applied' | 'resynced';

/**
 * Moves a scene onto a new layout: by the delta when there is one, absolutely
 * when there is not.
 *
 * The `MotionDesyncError` arm is the recovery `@dagr/render` names in that
 * error's own message, and it is reachable through this package rather than
 * theoretical: a motion built after the edit that produced the delta (turning
 * `animate` on again, for one) holds a roster the delta's `moved` list does not
 * describe. The roster is the way back because it describes a whole state
 * rather than a difference, so a scene reseated from it agrees with the drawing
 * whatever it was holding before.
 *
 * Only that error is caught. A `RangeError` from a target that is not finite is
 * a number the reseat would meet again in the roster, so swallowing it would
 * turn a refusal into the same picture forever, which is the failure the
 * refusal exists to prevent.
 */
export function retarget(
  motion: SceneMotion,
  delta: LayoutDelta | null,
  roster: SceneMotionRoster,
): Retargeting {
  if (delta === null) {
    motion.resync(roster);
    return 'resynced';
  }
  try {
    motion.apply(toMotionDelta(delta));
    return 'applied';
  } catch (cause: unknown) {
    if (!(cause instanceof MotionDesyncError)) throw cause;
    motion.resync(roster);
    return 'resynced';
  }
}
