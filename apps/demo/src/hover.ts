import type { Vec2, WorldBounds } from '@dagr/render';

/**
 * Which node is under a world point.
 *
 * **This is hover without picking, and the trade is deliberate.** M4.8 will put
 * an id per pixel on the GPU, which is what a scene of arbitrary shapes needs.
 * A campaign node is an axis-aligned box whose extents the demo already holds,
 * because the overlay is positioned from exactly the same boxes, so the same
 * question can be answered here with arithmetic and no readback, no extra
 * render target, and nothing to keep in step with the camera.
 *
 * It answers for the BOX, not for the drawn shape, so a pointer just outside a
 * circle's edge but inside its box counts as over it. That is the right answer
 * for a hover that exists to say WHICH node you are near, and the wrong one for
 * a click target, which is a reason this is not quietly reused as one when
 * M4.8's picking arrives.
 *
 * A linear scan over every node, deliberately. At 3,010 boxes a pass is a few
 * microseconds, so an index would be a structure to keep in step with the scene
 * for no measurable gain. A scene that made this matter would want M4.8 anyway.
 *
 * **Hover is visible from title tier up, and that is a consequence rather than
 * a rule this file enforces.** What the demo does with the answer is put a
 * class on the node's overlay element, and a node below about 24 CSS pixels of
 * screen width has no overlay element at all: at the fitted campaign the
 * pointer crosses hundreds of nodes and nothing lights up. The same is true of
 * a node the overlay's 200-element cap evicted. Answering anyway keeps this
 * function about the geometry rather than about the overlay's bookkeeping, and
 * a consumer that wanted to draw its own highlight (M4.8's picking, a canvas
 * ring) would want exactly this answer at every zoom.
 */
export interface HoverTarget {
  readonly id: string;
  readonly bounds: WorldBounds;
}

/** Whether a world point is inside a box, edges included. */
function contains(bounds: WorldBounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** A box's area, for choosing between boxes that both contain the point. */
function area(bounds: WorldBounds): number {
  return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
}

/**
 * The id of the node under `point`, or `null`.
 *
 * The SMALLEST containing box wins. The campaign's layout does not overlap
 * boxes today, so this rarely decides anything, and it is what keeps the answer
 * from depending on scene order when something does overlap: a room inside a
 * hall should be the answer when the pointer is over the room, and "the first
 * one in the array" would sometimes say the hall.
 */
export function nodeAtPoint(
  point: Vec2,
  nodes: readonly HoverTarget[],
): string | null {
  let best: HoverTarget | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!contains(node.bounds, point)) continue;
    const nodeArea = area(node.bounds);
    if (nodeArea < bestArea) {
      best = node;
      bestArea = nodeArea;
    }
  }
  return best === null ? null : best.id;
}
