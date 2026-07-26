import type { EdgeId, NodeId } from '@dagr/graph';
import { longestPathRankStage } from './rank.js';
import type { LayoutStages, OrderStage, Point, PositionStage, RouteStage, Size } from './types.js';

/**
 * The order, position and route stages the pipeline uses when the caller
 * supplies none, and the stage set that binds them to the rank stage.
 *
 * None of the three here is a real algorithm yet. They exist so that the
 * pipeline produces a well formed `LayoutResult` for any graph, and so that
 * every later milestone can be a one-stage swap against a runner and a test
 * suite that already work: crossing reduction replaces
 * {@link insertionOrderStage} (M2.5, M2.6), Brandes-Koepf replaces
 * {@link gridPositionStage} (M2.7), and polyline routing replaces
 * {@link straightRouteStage} (M2.8). The rank stage is no longer among them:
 * M2.2 replaced the single-rank placeholder with `longestPathRankStage`, which
 * breaks cycles and ranks by longest path, and M2.3 will tighten those ranks
 * rather than replace the stage wholesale.
 *
 * What they do guarantee, and what their tests hold them to, is the pipeline
 * contract: every node in exactly one layer, every node positioned, every edge
 * routed, and no two node boxes overlapping (up to floating point rounding, see
 * {@link gridPositionStage}).
 *
 * Each is exported from this module, for the tests, and none of them is
 * exported from the package: `index.ts` re-exports `defaultStages` alone. Every
 * one of them is scheduled for replacement, and a public name now is a choice
 * later between breaking callers and keeping a dead placeholder exported
 * forever. `defaultStages` covers the use case the individual names would
 * serve, wrapping whatever the current default is, and it keeps working when
 * the default behind one of its properties changes, which is exactly what
 * happened to `rank` in M2.2.
 */

/** A size that must be present. Absence is a runner bug, so it fails loudly. */
function requireSize(sizes: ReadonlyMap<NodeId, Size>, id: NodeId): Size {
  const size = sizes.get(id);
  if (size === undefined) throw new Error(`layout invariant: node "${id}" was never sized`);
  return size;
}

/** A rank that must be present. Absence is a runner bug, see above. */
function requireRank(ranks: ReadonlyMap<NodeId, number>, id: NodeId): number {
  const rank = ranks.get(id);
  if (rank === undefined) throw new Error(`layout invariant: node "${id}" was never ranked`);
  return rank;
}

/** A position that must be present. Absence is a runner bug, see above. */
function requirePoint(positions: ReadonlyMap<NodeId, Point>, id: NodeId): Point {
  const point = positions.get(id);
  if (point === undefined) throw new Error(`layout invariant: node "${id}" was never positioned`);
  return point;
}

/**
 * Groups the roster by rank and orders each layer by graph insertion order.
 *
 * Ranks are sorted numerically rather than assumed to be a contiguous run from
 * zero, so a ranker that leaves gaps or uses negative ranks still produces
 * layers top to bottom. Within a layer the order is the order the nodes were
 * added to the graph, which is arbitrary as a drawing but completely
 * reproducible, which is what M2.5's crossing-count regression corpus needs as
 * a starting point.
 *
 * It walks the roster rather than the graph, so a rank stage that declares
 * virtual nodes is already ordered correctly by this one. That keeps M2.4 out
 * of the ordering stage entirely: it adds to the ranker (splitting a long edge
 * into a chain) and to the router (rejoining that chain into a polyline), and
 * changes no contract between them. Virtual nodes come after the graph's own
 * within a layer, which is as arbitrary and as reproducible as the rest of this
 * stage.
 */
export const insertionOrderStage: OrderStage = {
  name: 'insertion-order',
  run(input) {
    const byRank = new Map<number, NodeId[]>();
    const roster = [...input.graph.nodes().map((node) => node.id), ...input.virtualNodes];
    for (const id of roster) {
      const rank = requireRank(input.ranks, id);
      const layer = byRank.get(rank);
      if (layer === undefined) byRank.set(rank, [id]);
      else layer.push(id);
    }
    const layers: readonly (readonly NodeId[])[] = [...byRank.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, layer]) => layer);
    return { ...input, layers };
  },
};

/**
 * Lays each layer out as a row, left to right, centred on `x = 0`, and stacks
 * the rows downward from `y = 0`.
 *
 * Adjacent boxes in a row are `nodeSep` apart and adjacent rows are `rankSep`
 * apart, measured box edge to box edge. A row's nodes share a centre line, so a
 * short node sits centred in a tall row rather than hanging from its top, and a
 * row is as tall as its tallest node. Coordinates come out symmetric about the
 * vertical axis and start at the top, which is not a layout so much as a legible
 * placeholder until M2.7 does real coordinate assignment.
 *
 * No two boxes overlap, up to floating point rounding at the magnitude of the
 * coordinates involved. The hedge is not a hedge about the placement, which is
 * exact in real arithmetic for every case including zero separations, zero
 * sizes, and a single node. It is about the representation: a position is a
 * centre, computed as `left + width / 2`, and a consumer recovers the right
 * edge as `x + width / 2`, and `(l + w / 2) + w / 2` is not always exactly
 * `l + w`. Widths 0.3, 0.2, 0.2 with `nodeSep: 0` leave the second and third
 * boxes 2.8e-17 apart the wrong way. Centres are the committed representation,
 * for the reasons on `PositionedState.positions`, so the guarantee is stated
 * with a tolerance rather than the representation changed to make it exact.
 *
 * The same arithmetic absorbs a separation far below the coordinate scale:
 * `nodeSep` of 1e-9 between boxes 1e9 wide leaves boxes that touch, because the
 * gap is smaller than one ulp of where it would go. That is a real property of
 * doubles at that spread, not a bug to hide, and boxes that touch still do not
 * overlap.
 *
 * Empty layers do not arise: the runner rejects them at the order boundary,
 * where the layers still know their ranks, so this stage never draws a row of
 * `rankSep` worth of nothing.
 */
export const gridPositionStage: PositionStage = {
  name: 'grid-position',
  run(input) {
    const { nodeSep, rankSep } = input.config;
    const positions = new Map<NodeId, Point>();
    let top = 0;
    for (const layer of input.layers) {
      let rowWidth = layer.length > 0 ? nodeSep * (layer.length - 1) : 0;
      let rowHeight = 0;
      for (const id of layer) {
        const size = requireSize(input.sizes, id);
        rowWidth += size.width;
        rowHeight = Math.max(rowHeight, size.height);
      }
      const centreY = top + rowHeight / 2;
      let left = -rowWidth / 2;
      for (const id of layer) {
        const size = requireSize(input.sizes, id);
        positions.set(id, { x: left + size.width / 2, y: centreY });
        left += size.width + nodeSep;
      }
      top += rowHeight + rankSep;
    }
    return { ...input, positions };
  },
};

/**
 * Routes every edge as a straight two-point line between the endpoint centres.
 *
 * The routes are built by walking the graph rather than the roster, so a route
 * exists for every edge the caller added and for nothing else, and the points
 * run from `source` to `target` because that is where they are read from. That
 * direction is a contract, not an accident of this implementation: see
 * {@link RoutedEdge.points}.
 *
 * A self loop routes to two identical points, which is degenerate but well
 * formed; M2.8 gives it a real shape along with everything else, and bends a
 * long edge through its dummies' coordinates while it is at it.
 */
export const straightRouteStage: RouteStage = {
  name: 'straight-route',
  run(input) {
    const routes = new Map<EdgeId, readonly Point[]>();
    for (const edge of input.graph.edges()) {
      const from = requirePoint(input.positions, edge.source);
      const to = requirePoint(input.positions, edge.target);
      routes.set(edge.id, [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ]);
    }
    return { ...input, routes };
  },
};

/**
 * The stage set a run uses for any phase the caller does not override. Frozen,
 * because it is shared by every default run in the process.
 */
export const defaultStages: LayoutStages = Object.freeze({
  rank: longestPathRankStage,
  order: insertionOrderStage,
  position: gridPositionStage,
  route: straightRouteStage,
});
