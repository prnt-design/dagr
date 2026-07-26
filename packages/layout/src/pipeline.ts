import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { measureNodes, resolveConfig } from './config.js';
import { InternalLayoutError, StageContractError } from './errors.js';
import { defaultStages } from './stages.js';
import type {
  LayoutInput,
  LayoutResult,
  LayoutStageOverrides,
  OrderedState,
  PositionedNode,
  Point,
  PositionedState,
  PreparedState,
  RankedState,
  Rect,
  RoutedEdge,
  RoutedState,
} from './types.js';

/**
 * Every node the pipeline has to place: the source graph's own nodes, then
 * anything a stage declared in `virtualNodes`.
 *
 * The rank, order, and position checks all run over this rather than over the
 * graph, which is what lets M2.4 add dummy-node chains without weakening a
 * single check: a dummy is an id the source graph does not hold, so a check
 * phrased as "the graph holds it" would have to be deleted for M2.4 to land,
 * and a check phrased as "the roster holds it" does not. What it still catches
 * is a stage inventing a node it never declared, which is the case the phrasing
 * was there to catch in the first place.
 *
 * The graph comes from the runner rather than off the record being checked. A
 * check that read `state.graph` would be reading the graph the stage under test
 * returned, which is the stage's own account of its own homework.
 */
function* rosterOf(graph: Graph, virtualNodes: ReadonlySet<NodeId>): Generator<NodeId> {
  for (const node of graph.nodes()) yield node.id;
  for (const id of virtualNodes) yield id;
}

/**
 * Checks the stage handed the graph back rather than a graph of its own.
 *
 * Every other check compares a stage's output against the graph the runner
 * handed in, so a stage that swapped the graph could no longer escape its own
 * contract even if this check did not exist. What this adds is the diagnosis:
 * without it, a stage that replaced the graph fails somewhere downstream with a
 * message about a node, rather than here with a message about the graph.
 *
 * Replacing the graph is never necessary, because the roster covers the only
 * reason to want to. A stage that needs a node the caller never added declares
 * it in {@link RankedState.virtualNodes} and it becomes a full citizen of
 * every check from that point on. M2.4's dummy-node chains work exactly that
 * way.
 */
function checkGraphKept(stage: string, graph: Graph, returned: PreparedState): void {
  if (returned.graph !== graph) {
    throw new StageContractError(
      stage,
      'graph',
      'returned a different graph; a stage never replaces the graph it was given, and one ' +
        'that needs a node the caller never added declares it in virtualNodes instead',
    );
  }
}

/**
 * Tolerance for a comparison of two coordinates, scaled to their magnitude.
 *
 * Box edges here are sums of floats: a node's right edge is recovered as
 * `x + width / 2` from an `x` that the position stage computed as
 * `left + width / 2`, and `(l + w / 2) + w / 2` is not always exactly `l + w`.
 * Two edges that coincide in real arithmetic can therefore differ in the last
 * bit, so an exact comparison would reject correct layouts. See the same
 * tolerance in `gridPositionStage`'s no-overlap guarantee.
 */
/** A usable length: finite and not negative, the same rule the config enforces. */
function isMeasure(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function toleranceFor(...values: readonly number[]): number {
  let magnitude = 1;
  for (const value of values) magnitude = Math.max(magnitude, Math.abs(value));
  return magnitude * 1e-9;
}

/**
 * Checks the rank stage did its job: a finite rank and a size for every member
 * of the roster, a real edge behind every reversal, and ranks that actually are
 * a ranking.
 *
 * Every check in this file runs at its own stage's boundary rather than once at
 * the end, which is the whole reason the stages are swappable in the first
 * place. A ranker that forgets a node fails here, named, instead of surfacing
 * two stages later as a node with no coordinates, or worse, silently landing on
 * top of another one.
 *
 * `graph` is the runner's, not `ranked.graph`. See {@link checkGraphKept}.
 */
function checkRanked(stage: string, graph: Graph, ranked: RankedState): void {
  // A declared id that the graph already holds is not a second node, it is the
  // caller's node wearing a stage's clothes: `sizes` is roster-wide, so the
  // declaration overwrites the size the caller asked for, and nothing
  // downstream notices, because the id really is a graph node. This has to run
  // before the roster loop, which would otherwise see the id twice and report
  // whichever failure the duplicate happened to cause. Once M2.4 mints dummy
  // ids from edge ids, a graph whose node ids look like that pattern lands
  // here, and the alternative symptom is one node mysteriously the wrong size.
  for (const id of ranked.virtualNodes) {
    if (graph.hasNode(id)) {
      throw new StageContractError(stage, id, 'was declared virtual but the graph already holds it');
    }
  }

  for (const id of rosterOf(graph, ranked.virtualNodes)) {
    const rank = ranked.ranks.get(id);
    if (rank === undefined) throw new StageContractError(stage, id, 'no rank was assigned');
    if (!Number.isFinite(rank)) {
      throw new StageContractError(stage, id, `rank ${String(rank)} is not a finite number`);
    }
    // A declared virtual node has to be sized by whoever declared it. Catching
    // it here names the rank stage, rather than letting the position stage trip
    // over a bare invariant error two stages downstream.
    const size = ranked.sizes.get(id);
    if (size === undefined) throw new StageContractError(stage, id, 'no size was assigned');
    // The size is checked, not just counted, because `sizes` is roster-wide
    // from here on: a rank stage can overwrite the size the caller's own node
    // was measured at, and the resolved config that validated the original is
    // two stages upstream. A NaN would survive to the runner's bounds
    // arithmetic and be reported as a runner invariant, naming nobody.
    if (!isMeasure(size.width) || !isMeasure(size.height)) {
      throw new StageContractError(
        stage,
        id,
        `size ${String(size.width)} by ${String(size.height)} is not a finite pair of lengths that are zero or greater`,
      );
    }
  }

  // A stale or invented id here would sit invisible until M2.8 tried to
  // un-reverse a route and quietly did nothing.
  for (const id of ranked.reversedEdges) {
    if (!graph.hasEdge(id)) {
      throw new StageContractError(stage, id, 'was reversed but the graph does not hold that edge');
    }
  }

  // The defining invariant of a ranking: every edge runs down the page, or is
  // declared reversed and runs up it. Not-greater rather than strictly less,
  // because a self loop puts both endpoints on one rank and, after M2.4, a long
  // edge legitimately spans several. Both endpoints of an edge are graph nodes
  // even once dummies exist, so their ranks are the ones to compare.
  for (const edge of graph.edges()) {
    const from = ranked.ranks.get(edge.source);
    const to = ranked.ranks.get(edge.target);
    // Unreachable: the roster loop above covers every graph node.
    if (from === undefined || to === undefined) continue;
    if (ranked.reversedEdges.has(edge.id)) {
      if (to > from) {
        throw new StageContractError(
          stage,
          edge.id,
          `was reversed but still runs from rank ${String(from)} to rank ${String(to)}`,
        );
      }
    } else if (from > to) {
      throw new StageContractError(
        stage,
        edge.id,
        `runs from rank ${String(from)} to rank ${String(to)} and was not reversed`,
      );
    }
  }
}

/**
 * Checks the order stage put every roster member in exactly one layer, nothing
 * else in any layer, and the layers themselves in rank order top to bottom.
 *
 * Tying the layers back to the ranks matters as much as covering every node.
 * Without it an orderer could put a rank-5 node in layer 0, or emit its layers
 * bottom to top, and the position stage would draw the result in the wrong row
 * with nothing complaining. Empty layers are rejected in the same pass: an
 * empty layer has no rank to compare against its neighbours, and it would still
 * consume a row of vertical space downstream.
 */
function checkOrdered(stage: string, graph: Graph, ordered: OrderedState): void {
  const roster = new Set(rosterOf(graph, ordered.virtualNodes));
  const placed = new Set<NodeId>();
  let previousRank: number | undefined;
  for (const [index, layer] of ordered.layers.entries()) {
    if (layer.length === 0) {
      throw new StageContractError(
        stage,
        `layer ${String(index)}`,
        'the layers include an empty layer, which has no rank and would still take a row',
      );
    }
    let layerRank: number | undefined;
    for (const id of layer) {
      if (!roster.has(id)) {
        throw new StageContractError(stage, id, 'the layers list a node that is not in the roster');
      }
      if (placed.has(id)) throw new StageContractError(stage, id, 'listed in the layers twice');
      placed.add(id);
      const rank = ordered.ranks.get(id);
      if (rank === undefined) throw new StageContractError(stage, id, 'no rank was assigned');
      if (layerRank === undefined) layerRank = rank;
      else if (rank !== layerRank) {
        throw new StageContractError(
          stage,
          id,
          `has rank ${String(rank)} but sits in a layer of rank ${String(layerRank)}`,
        );
      }
    }
    if (previousRank !== undefined && layerRank !== undefined && layerRank <= previousRank) {
      throw new StageContractError(
        stage,
        layer[0] ?? `layer ${String(index)}`,
        `sits in a layer of rank ${String(layerRank)} below one of rank ${String(previousRank)}, ` +
          'and the layers run top to bottom',
      );
    }
    previousRank = layerRank;
  }
  for (const id of roster) {
    if (!placed.has(id)) throw new StageContractError(stage, id, 'missing from the layers');
  }
}

/** Checks the position stage gave every roster member a usable coordinate. */
function checkPositioned(stage: string, graph: Graph, positioned: PositionedState): void {
  for (const id of rosterOf(graph, positioned.virtualNodes)) {
    const point = positioned.positions.get(id);
    if (point === undefined) {
      throw new StageContractError(stage, id, 'no position was assigned');
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new StageContractError(
        stage,
        id,
        `position (${String(point.x)}, ${String(point.y)}) is not a finite point`,
      );
    }
  }
}

/**
 * Asserts `bounds` is the box the rest of the result says it is.
 *
 * `bounds` is the one field of a {@link LayoutResult} with a documented
 * invariant and no way for a caller to notice it broken: a stale or zero
 * rectangle draws perfectly well and only surfaces in M3, as viewport code
 * fitting to a box that does not contain the drawing.
 *
 * It is an assertion rather than a stage contract check, and it throws an
 * {@link InternalLayoutError} rather than a {@link StageContractError}, because
 * the runner computes `bounds` itself now. There is no stage left to name. What it guards is
 * {@link boundsOf} and the arithmetic around it, which is not nothing: `x` is
 * `minX` and `width` is `maxX - minX`, so the right edge a consumer recovers as
 * `x + width` is not always exactly the `maxX` it came from. That is why the
 * comparison carries a tolerance, and why removing the tolerance makes this
 * fire on a real layout rather than on a broken one.
 */
function assertBounds(result: LayoutResult): void {
  const { x, y, width, height } = result.bounds;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    throw new InternalLayoutError(
      `bounds (${String(x)}, ${String(y)}) ${String(width)} by ` +
        `${String(height)} has a component that is not a finite number`,
    );
  }
  if (result.nodes.size === 0) {
    if (x !== 0 || y !== 0 || width !== 0 || height !== 0) {
      throw new InternalLayoutError(
        'a result with no nodes needs the zero rectangle at the origin',
      );
    }
    return;
  }
  for (const node of result.nodes.values()) {
    const left = node.x - node.width / 2;
    const right = node.x + node.width / 2;
    const top = node.y - node.height / 2;
    const bottom = node.y + node.height / 2;
    const epsX = toleranceFor(left, right, x, x + width);
    const epsY = toleranceFor(top, bottom, y, y + height);
    if (
      left < x - epsX ||
      right > x + width + epsX ||
      top < y - epsY ||
      bottom > y + height + epsY
    ) {
      throw new InternalLayoutError(
        `node "${node.id}" box (${String(left)}, ${String(top)}) to ` +
          `(${String(right)}, ${String(bottom)}) falls outside the bounds (${String(x)}, ` +
          `${String(y)}) ${String(width)} by ${String(height)}`,
      );
    }
  }
}

/**
 * Checks the route stage routed every edge the graph holds, nothing besides,
 * and gave each route at least a line.
 *
 * Fewer than two points is not a shorter route, it is a route a renderer cannot
 * draw, so it is caught here rather than in the renderer, several packages away
 * from the stage that caused it.
 *
 * Absence is checked as well as presence, and that is the M2.4 boundary for
 * edges: a router that rejoins a dummy chain into one polyline keys it by the
 * caller's own edge id, and a leftover route keyed by something else is caught
 * here. The matching property for nodes is not checked, because the runner
 * builds the result's node map from the graph itself and a virtual node has no
 * way in.
 *
 * Direction is checked as of M2.2, and only became worth checking then:
 * `reversedEdges` was always empty before it, so no router could get the
 * direction wrong, and now one can. {@link RoutedEdge.points} promises the
 * polyline runs source to target as the caller authored them even for an edge
 * the ranker reversed, and a router that works from the ranked direction
 * naturally emits its points target-first. Nothing downstream notices: the
 * arrowheads M4 and M5 draw at the last point land on the wrong end, for
 * exactly the edges that were in a cycle, two packages from the cause.
 *
 * The form is proximity rather than equality: each end has to be at least as
 * close to its own node as to the other one. Equality of the endpoints against
 * the node positions is the check this would obviously be, and it is the wrong
 * one, because it would have to be relaxed in M2.8 as soon as routes attach at
 * box borders and detour around obstacles, and a contract that loses rules is
 * worse than one that never claimed them. Proximity survives both: a route that
 * leaves its source's border and arrives at its target's is still nearer its
 * own node at each end under any routing scheme planned. What it does not
 * constrain is the shape between the endpoints, which is the router's business.
 *
 * The comparison is deliberately not strict, so a self loop passes: both
 * endpoints are the same node, every distance in the comparison is equal, and a
 * strict form would reject the one edge that cannot possibly point the wrong
 * way.
 */
function checkRouted(stage: string, graph: Graph, routed: RoutedState): void {
  for (const edge of graph.edges()) {
    const route = routed.routes.get(edge.id);
    if (route === undefined) throw new StageContractError(stage, edge.id, 'no route was assigned');
    if (route.length < 2) {
      throw new StageContractError(
        stage,
        edge.id,
        `route has ${String(route.length)} points, a route needs at least two`,
      );
    }
    // The last numbers reaching the caller without a finiteness check, and the
    // same argument the config makes about NaN applies: it does not fail, it
    // propagates through every sum downstream and surfaces as a scene that will
    // not draw. Cheap now, and doing real work from M2.8, where this map stops
    // holding two copied endpoints and starts holding computed geometry.
    for (const [index, point] of route.entries()) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new StageContractError(
          stage,
          edge.id,
          `route point ${String(index)} (${String(point.x)}, ${String(point.y)}) is not a finite point`,
        );
      }
    }
    // Squared distances, because only the comparison matters and a square root
    // would buy nothing but rounding.
    const sourceAt = routed.positions.get(edge.source);
    const targetAt = routed.positions.get(edge.target);
    const first = route[0];
    const last = route.at(-1);
    const known =
      sourceAt !== undefined && targetAt !== undefined && first !== undefined && last !== undefined;
    if (known) {
      const near = (from: Point, to: Point): number => (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
      const startsWrong = near(first, sourceAt) > near(first, targetAt);
      const endsWrong = near(last, targetAt) > near(last, sourceAt);
      if (startsWrong || endsWrong) {
        throw new StageContractError(
          stage,
          edge.id,
          "the route runs the wrong way: a polyline goes from its edge's source to its " +
            'target as the caller authored them, even when the ranker reversed the edge, ' +
            'and this one has an end nearer the node it is not attached to',
        );
      }
    }
  }
  for (const id of routed.routes.keys()) {
    if (!graph.hasEdge(id)) {
      throw new StageContractError(stage, id, 'was routed but is not an edge of the graph');
    }
  }
}

/** The smallest rectangle containing every node box, or a zero rect for none. */
function boundsOf(nodes: ReadonlyMap<NodeId, PositionedNode>): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes.values()) {
    minX = Math.min(minX, node.x - node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
    maxX = Math.max(maxX, node.x + node.width / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }
  if (nodes.size === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A value the checks above have already guaranteed. Absence is a runner bug. */
function required<T>(value: T | undefined, what: string, id: NodeId): T {
  if (value === undefined) throw new InternalLayoutError(`no ${what} for "${id}"`);
  return value;
}

/**
 * Turns the last pipeline record into the {@link LayoutResult} the caller gets.
 *
 * This is the runner's job rather than the route stage's, and that is what
 * makes three of the old route-boundary rules unnecessary rather than merely
 * unchecked. Both maps are keyed by walking the caller's own graph, so they
 * hold exactly the caller's ids in graph insertion order, and a node a stage
 * declared in `virtualNodes` has no way in. `bounds` is computed once, here,
 * rather than by each router in turn.
 */
function assemble(graph: Graph, routed: RoutedState): LayoutResult {
  const nodes = new Map<NodeId, PositionedNode>();
  for (const node of graph.nodes()) {
    const point = required(routed.positions.get(node.id), 'position', node.id);
    const size = required(routed.sizes.get(node.id), 'size', node.id);
    nodes.set(node.id, {
      id: node.id,
      x: point.x,
      y: point.y,
      width: size.width,
      height: size.height,
    });
  }
  const edges = new Map<EdgeId, RoutedEdge>();
  for (const edge of graph.edges()) {
    // The route stage supplies the polyline; the identity of what was routed
    // comes from the graph, so a `RoutedEdge` whose `id`, `source` or `target`
    // disagrees with the edge it is keyed by cannot be built here.
    edges.set(edge.id, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      points: required(routed.routes.get(edge.id), 'route', edge.id),
    });
  }
  return { nodes, edges, bounds: boundsOf(nodes) };
}

/**
 * Runs a graph through the layout pipeline and returns where everything goes.
 *
 * The run is prepare, rank, order, position, route, assemble. The first and the
 * last belong to the runner. Prepare resolves the config once and sizes every
 * node once, so no stage re-applies a default or measures a node twice.
 * Assemble turns the last record into the {@link LayoutResult}: the node map
 * from `positions` and `sizes`, the edge map from `routes`, and `bounds`
 * computed once here rather than by each router in turn. The four stages
 * between them are swappable, and `stages` overrides any subset of them; the
 * rest fall back to {@link defaultStages}. Each stage's output is checked
 * before the next one sees it, so a stage that leaves work undone fails at its
 * own boundary with a {@link StageContractError} naming it and the id it
 * dropped, and every check compares against the runner's own graph rather than
 * against whatever the stage handed back.
 *
 * The input graph is never mutated, and no stage may replace it either: every
 * record a stage returns has to carry back the very graph the runner handed in,
 * and every check compares against that graph rather than against the one the
 * stage returned. A stage that needs to pretend an edge runs the other way
 * records its id in `reversedEdges` instead, and one that needs a node the
 * caller never added declares it in `virtualNodes`, which is what makes
 * replacing the graph unnecessary as well as forbidden. Everything from the
 * rank stage on is checked over that roster, and the result is filtered back
 * down to the caller's own ids, so a declared node never escapes.
 *
 * The default rank stage is real as of M2.2: it breaks cycles with a greedy
 * feedback arc set and ranks by longest path, so the layers are the ones the
 * graph asks for. The other three defaults are still placeholders, so within a
 * layer the order is the graph's insertion order, the coordinates are a grid,
 * and an edge is a straight line between two centres. Crossing reduction
 * (M2.5), coordinate assignment (M2.7) and real routing (M2.8) replace them
 * one at a time, against this runner and its contract checks.
 *
 * @throws {InvalidConfigError} when a separation or a size is not a finite
 * number that is zero or greater.
 * @throws {StageContractError} when a stage breaks the pipeline contract.
 * @throws {InternalLayoutError} when the pipeline catches itself breaking one of
 * its own invariants, which is a bug in this package and nothing the caller can
 * fix or provoke.
 */
export function layout(input: LayoutInput, stages?: LayoutStageOverrides): LayoutResult {
  const config = resolveConfig(input.config);
  const { graph } = input;
  const prepared: PreparedState = {
    graph,
    config,
    sizes: measureNodes(graph, config, input.config?.nodeSize),
  };

  const rank = stages?.rank ?? defaultStages.rank;
  const ranked = rank.run(prepared);
  checkGraphKept(rank.name, graph, ranked);
  checkRanked(rank.name, graph, ranked);

  const order = stages?.order ?? defaultStages.order;
  const ordered = order.run(ranked);
  checkGraphKept(order.name, graph, ordered);
  checkOrdered(order.name, graph, ordered);

  const position = stages?.position ?? defaultStages.position;
  const positioned = position.run(ordered);
  checkGraphKept(position.name, graph, positioned);
  checkPositioned(position.name, graph, positioned);

  const route = stages?.route ?? defaultStages.route;
  const routed = route.run(positioned);
  checkGraphKept(route.name, graph, routed);
  checkRouted(route.name, graph, routed);

  const result = assemble(graph, routed);
  assertBounds(result);
  return result;
}
