import type { EdgeId, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';
import type { Point, RouteStage, Size } from './types.js';

/**
 * The router: one polyline per edge, attached at the endpoint boxes' borders,
 * bending through each dummy on the edge's chain, and monotone in the rank
 * axis.
 *
 * WHAT M2.8 ADDED AND WHAT WAS ALREADY THERE, because the milestone's title
 * claims more than its diff did. "Polyline routes through dummy-node
 * coordinates" shipped in M2.4b: `straight-route`, which this replaces, already
 * walked `virtualChains` and emitted a point per dummy. What M2.8 added is the
 * two ENDS. A route used to start and finish at the endpoint centres, inside
 * the boxes, where the arrowhead a renderer draws at the last point is drawn
 * underneath the target; it now starts and finishes on the boxes' borders.
 * Every point between the ends is what `straight-route` produced, unchanged,
 * which is why the invariant tests can pin the two routers against each other
 * rather than pin either of them against prose.
 *
 * ## Monotone in the rank axis
 *
 * **Reading a route's points from source to target, `y` never moves against
 * the direction the route runs as a whole.** Writing `d` for the sign of the
 * last point's `y` minus the first's, every consecutive pair steps by `d` or by
 * zero.
 *
 * Two choices in that sentence, both of which exist to spare a case rather than
 * to be elegant. It is WEAK, so a pair of points at one `y` is a flat step and
 * not a backtrack, which is what lets a self loop satisfy the rule rather than
 * be excused from it: both its ends are the same node at the same `y`, `d` is
 * zero, and every step is zero. And it is stated over the AUTHORED direction,
 * source to target as the caller wrote them, which is the direction
 * {@link RoutedEdge.points} runs. That costs nothing precisely because the rule
 * names no sign of its own: an edge the ranker reversed comes back as a route
 * that CLIMBS the page, `d` is negative, and it is monotone climbing. Phrase it
 * as "`y` increases" instead and every reversed edge needs an exception, which
 * is a special case in the one place a router is most likely to get wrong.
 *
 * **This stage does not create the property and it is worth being exact about
 * that.** `y` is the position stage's answer, not the router's. Layers run in
 * strictly increasing rank order, both position stages in this package give a
 * layer one shared `y`, and a chain holds one node at every rank between its
 * endpoints, so the points are already monotone before this stage sees them.
 * What the router promises is the other half: **it introduces no reversal that
 * its input did not have**. That is not free, and the cap in
 * {@link attachment} is what buys it.
 *
 * Nothing in the runner checks monotonicity, which is a decision rather than an
 * omission. The property belongs to the position stage and the router jointly,
 * a caller may supply a {@link PositionStage} that stacks ranks any way it
 * likes, and a contract check that a correct third-party stage fails is worse
 * than one never claimed. `pipeline.ts` makes the same argument about the
 * endpoint-proximity rule.
 *
 * ## What it does not do yet
 *
 * **`edgeSep` is still not honoured, and it is the named next step for this
 * stage.** It is the gap between two routes running alongside each other, so
 * the cases it governs are the two where routes coincide exactly rather than
 * merely run close: parallel edges, which get identical polylines here because
 * they have identical endpoints and no chain to tell them apart, and self
 * loops, which get two identical points at their node's centre. Both are
 * present in the golden corpus and both are pinned below as they stand, so the
 * milestone that fans them out has a before to measure against. It needs a
 * fan-out rule and, for a loop, a height, and a loop that bulges vertically is
 * the one shape in this package that would need an exception carved into the
 * monotone rule above. That is a decision with its own before and after rather
 * than a line in this one.
 *
 * Obstacle detours are the other thing this is not. A route here goes where its
 * dummies are and takes no notice of a box in the way. `LayoutResult.bounds`
 * already carries the formulation detours need, the hull of the node boxes AND
 * the route points, adopted early in M2.4b, so that is one thing the milestone
 * which brings them does not also have to change.
 */

/** A position that must be present. Absence is a runner bug, so it fails loudly. */
function requirePoint(positions: ReadonlyMap<NodeId, Point>, id: NodeId): Point {
  const point = positions.get(id);
  if (point === undefined) throw new InternalLayoutError(`node "${id}" was never positioned`);
  return point;
}

/** A size that must be present. Absence is a runner bug, see above. */
function requireSize(sizes: ReadonlyMap<NodeId, Size>, id: NodeId): Size {
  const size = sizes.get(id);
  if (size === undefined) throw new InternalLayoutError(`node "${id}" was never sized`);
  return size;
}

/**
 * Where a route leaves the box around `centre` on its way to `toward`: the
 * point on the box's border, or half way to `toward`, whichever comes first.
 *
 * The border of an axis-aligned box is found by parameter rather than by
 * casework on which of the four sides is hit. Walking from the centre toward
 * `toward`, the box's half width is reached at `width / 2 / |dx|` of the way
 * and its half height at `height / 2 / |dy|`, and the border is whichever of
 * those comes first. An axis the segment does not move along is reached never,
 * not immediately, which is why a zero component contributes an infinity here
 * and not a zero: a route running straight down leaves through the bottom edge
 * whatever the box's width.
 *
 * THE HALF-WAY CAP IS THE LOAD-BEARING PART and it is the whole of what keeps
 * the monotone rule true through this stage. Both ends of a route with no bend
 * in it are attached along THE SAME segment, one from each end, so without a
 * cap a box wider than the gap to its neighbour would push its attachment past
 * the other one and hand back a polyline that runs backwards, on a drawing
 * where nothing else was wrong. Capping each at the midpoint makes crossing
 * impossible by arithmetic rather than by an assumption about how far apart a
 * position stage puts things: two points that each moved at most half way along
 * one segment, from opposite ends, meet at worst in the middle. It also keeps
 * `pipeline.ts`'s endpoint-proximity check satisfied for the same reason, since
 * an end that moved at most half way is never strictly nearer the node it is
 * not attached to.
 *
 * With the shipped config the cap never binds: a default box is 40 tall and
 * `rankSep` is 50, so a route to the next row down leaves its box a quarter of
 * the way along rather than half. It binds where the boxes nearly touch, which
 * a caller reaches with `rankSep: 0`, and that is a legal config rather than a
 * pathological one.
 *
 * A zero-size node attaches at its own centre, having no border to leave from,
 * and so does a self loop, whose `toward` IS the centre it starts at: both
 * components are zero, both ratios are infinite, the cap takes over, and half
 * of no distance is no distance. Neither is a case in the code.
 */
function attachment(centre: Point, size: Size, toward: Point): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const toSide = dx === 0 ? Number.POSITIVE_INFINITY : size.width / 2 / Math.abs(dx);
  const toEdge = dy === 0 ? Number.POSITIVE_INFINITY : size.height / 2 / Math.abs(dy);
  const along = Math.min(toSide, toEdge, 0.5);
  return { x: centre.x + along * dx, y: centre.y + along * dy };
}

/**
 * Routes every edge as a polyline: out of the source's border, through the
 * centre of each dummy on the edge's chain, and into the target's border.
 *
 * The interior points are the dummies' own coordinates, so a long edge crosses
 * every layer between its endpoints at a place that layer chose rather than
 * wherever the line between two distant centres happened to fall. An edge with
 * no chain comes back as the two attachments and nothing else.
 *
 * The routes are built by walking the graph rather than the roster, so a route
 * exists for every edge the caller added and for nothing else, and the points
 * run from `source` to `target` because that is where they are read from. That
 * direction is a contract, not an accident of this implementation: see
 * {@link RoutedEdge.points}. The chain needs no reversal bookkeeping for the
 * same reason: `RankedState.virtualChains` lists a chain source to target as
 * the caller authored it, and the coordinates are looked up by id, so an edge
 * the ranker reversed comes out running the caller's way with nothing to undo.
 *
 * Each end is aimed at its own neighbour along the polyline, which for a route
 * with bends is the nearest dummy and for a bendless one is the other endpoint.
 * That is the only reason the chain is read before the first point is written.
 *
 * It returns the routes and nothing else. The runner assembles the
 * {@link LayoutResult} from them and from the graph, so a router states the
 * polyline and never the identity of what it routed.
 */
export const polylineRouteStage: RouteStage = {
  name: 'polyline-route',
  run(input) {
    const routes = new Map<EdgeId, readonly Point[]>();
    for (const edge of input.graph.edges()) {
      const from = requirePoint(input.positions, edge.source);
      const to = requirePoint(input.positions, edge.target);
      const chain = input.virtualChains.get(edge.id);
      const head = chain?.[0];
      const tail = chain?.at(-1);
      const first = head === undefined ? to : requirePoint(input.positions, head);
      const last = tail === undefined ? from : requirePoint(input.positions, tail);
      const points: Point[] = [attachment(from, requireSize(input.sizes, edge.source), first)];
      if (chain !== undefined) {
        for (const id of chain) {
          const bend = requirePoint(input.positions, id);
          points.push({ x: bend.x, y: bend.y });
        }
      }
      points.push(attachment(to, requireSize(input.sizes, edge.target), last));
      routes.set(edge.id, points);
    }
    return { routes };
  },
};
