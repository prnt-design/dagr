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
  Size,
} from './types.js';

/**
 * Every node the pipeline has to place: the source graph's own nodes, then
 * anything a stage declared in `virtualNodes`.
 *
 * The rank, order, and position checks all run over this rather than over the
 * graph, which is what lets M2.4b add dummy-node chains without weakening a
 * single check: a dummy is an id the source graph does not hold, so a check
 * phrased as "the graph holds it" would have to be deleted for M2.4b to land,
 * and a check phrased as "the roster holds it" does not. What it still catches
 * is a stage inventing a node it never declared, which is the case the phrasing
 * was there to catch in the first place.
 *
 * The graph is passed in rather than read off the record, which is now belt and
 * braces: a stage returns its own fields alone, so the `graph` on a record is
 * always the runner's. Keeping it a parameter states which graph a check is
 * entitled to consult, and costs nothing.
 *
 * The virtual segment comes out in id order, because {@link declaredRoster}
 * put it in id order. That is the roster's order for every consumer, this
 * generator and the order stage alike, and the reason it matters is there.
 */
function* rosterOf(graph: Graph, virtualNodes: ReadonlySet<NodeId>): Generator<NodeId> {
  for (const node of graph.nodes()) yield node.id;
  for (const id of virtualNodes) yield id;
}

/**
 * The declared ids as a roster set, in ID order rather than in the order the
 * rank stage happened to declare them.
 *
 * The sort is the point of this function. A `Map`'s keys come out in insertion
 * order, so without it a dummy's index within its layer would depend on where
 * its edge sat in the ranker's iteration rather than on its identity.
 * Deterministic run to run, and NOT incrementally stable: adding an unrelated
 * edge early in that iteration would shift every later dummy within its layer,
 * moving the bends of long edges whose endpoints did not move at all. That is
 * exactly the jitter M2.4b's deterministic-id rule exists to prevent, so stable
 * ids are necessary and this is what makes them sufficient.
 *
 * It is done here rather than in an order stage for two reasons. Order stages
 * come and go, and M2.6b has since replaced the default with `barycenterOrder`,
 * while the roster the runner builds is what every order stage reads. And
 * within a layer a chain contributes at most one node per rank, so ids differ
 * by edge and lexicographic order is both stable and meaningful.
 *
 * The bare `.sort()` is deliberate and is not a latent bug to tidy up. It is
 * UTF-16 lexicographic, so it would put `#dummy:e:10` before `#dummy:e:2`, and
 * that never decides anything: two dummies in one layer come from different
 * edges, so the rank component is equal wherever the comparison is used. All
 * this has to be is a pure function of the id set. A numeric-aware comparator
 * would be slower, would need its own tests, and would buy nothing.
 */
function declaredRoster(declared: ReadonlyMap<NodeId, Size> | undefined): ReadonlySet<NodeId> {
  return new Set([...(declared?.keys() ?? [])].sort());
}

/**
 * The roster-wide size map, from what prepare measured plus what the rank stage
 * declared.
 *
 * A fresh map only when there is something to add, which is a rule about the
 * invariant rather than about how often a stage declares. `PreparedState.sizes`
 * has an entry per node, so a copy is a 10k entry copy on a 10k node graph, and
 * there is nothing to copy it for when the declaration is empty. Sharing it in
 * that case is safe because nobody downstream writes to either map: both are
 * handed out as `ReadonlyMap`, and the merged one is built here and never
 * touched again.
 */
function mergedSizes(
  prepared: ReadonlyMap<NodeId, Size>,
  declared: ReadonlyMap<NodeId, Size> | undefined,
): ReadonlyMap<NodeId, Size> {
  if (declared === undefined || declared.size === 0) return prepared;
  const sizes = new Map(prepared);
  for (const [id, size] of declared) sizes.set(id, size);
  return sizes;
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
 * Checks the rank stage did its job: a usable declaration for each virtual node
 * it asked for, a finite rank for every member of the roster, a real edge behind
 * every reversal, and ranks that actually are a ranking.
 *
 * Every check in this file runs at its own stage's boundary rather than once at
 * the end, which is the whole reason the stages are swappable in the first
 * place. A ranker that forgets a node fails here, named, instead of surfacing
 * two stages later as a node with no coordinates, or worse, silently landing on
 * top of another one.
 *
 * `declared` is the stage's own `RankOutput.virtualNodes`, before the
 * runner folded it into `ranked`, because the rules about declarations are
 * about what the STAGE said. `graph` is the runner's for the same reason the
 * other checks take it: it is the account the stage is being checked against.
 * `ranked.virtualChains` needs no such parameter: the runner passes the
 * declared map through unchanged, substituting an empty one only when the stage
 * omitted it.
 *
 * The "every roster member has a size" rule is a LOOKUP here and no longer a
 * validation. Validating a size moved to the declaration loop, where prepare
 * has not already checked it. The lookup stayed because it catches something no
 * type can: `PreparedState.graph` is a live mutable `Graph` and the roster is
 * recomputed from `graph.nodes()` at every check, so a stage that ADDS its
 * dummy to the graph rather than declaring it produces a roster member
 * `prepared.sizes` never covered. Narrowing the stage return types stopped a
 * stage handing a graph BACK, not a stage reaching into the one it was handed.
 * Without this the caller gets an `InternalLayoutError` blaming this package
 * for a third-party stage's mistake, and M2.4b makes that mistake the obvious
 * wrong first attempt.
 */
function checkRanked(
  stage: string,
  graph: Graph,
  ranked: RankedState,
  declared: ReadonlyMap<NodeId, Size> | undefined,
): void {
  for (const [id, size] of declared ?? []) {
    // A declared id that the graph already holds is not a second node, it is
    // the caller's node wearing a stage's clothes: the declaration's size wins
    // in the roster-wide map, so the caller's own node quietly changes size,
    // and nothing downstream notices because the id really is a graph node.
    // This has to run before the roster loop, which would otherwise see the id
    // twice and report whichever failure the duplicate happened to cause. Once
    // M2.4b mints dummy ids from edge ids, a graph whose node ids look like
    // that pattern lands here.
    if (graph.hasNode(id)) {
      throw new StageContractError(stage, id, 'was declared virtual but the graph already holds it');
    }
    // The one size in the pipeline the config never saw: prepare validated
    // every size it measured, and this one was minted by the stage afterwards.
    // A NaN here would survive to the runner's bounds arithmetic and be
    // reported as a runner invariant, naming nobody.
    if (!isMeasure(size.width) || !isMeasure(size.height)) {
      throw new StageContractError(
        stage,
        id,
        `size ${String(size.width)} by ${String(size.height)} is not a finite pair of lengths that are zero or greater`,
      );
    }
  }

  for (const id of rosterOf(graph, ranked.virtualNodes)) {
    const rank = ranked.ranks.get(id);
    if (rank === undefined) throw new StageContractError(stage, id, 'no rank was assigned');
    if (!Number.isFinite(rank)) {
      throw new StageContractError(stage, id, `rank ${String(rank)} is not a finite number`);
    }
    // See the note above: the only way to reach this is a stage that added the
    // node to the live graph instead of declaring it.
    if (!ranked.sizes.has(id)) {
      throw new StageContractError(
        stage,
        id,
        'no size was assigned; a stage never adds a node to the graph, it declares it ' +
          'with its size in virtualNodes',
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

  // The one cross-stage relationship in the package, and the only one with two
  // authors: the ranker splits a long edge into a chain and the router rejoins
  // it. Checked here, over what the ranker declared, because a chain that is
  // wrong in any of these ways surfaces as a polyline with a bend in the wrong
  // place, which nothing downstream can tell from a bend in the right one.
  const chained = new Set<NodeId>();
  for (const [edgeId, chainIds] of ranked.virtualChains) {
    const edge = graph.getEdge(edgeId);
    if (edge === undefined) {
      throw new StageContractError(
        stage,
        edgeId,
        'has a virtual chain but the graph does not hold that edge',
      );
    }
    if (chainIds.length === 0) {
      throw new StageContractError(
        stage,
        edgeId,
        'has an empty virtual chain; an edge with no dummies has no entry at all',
      );
    }
    for (const id of chainIds) {
      if (!(declared?.has(id) ?? false)) {
        throw new StageContractError(
          stage,
          id,
          `is in the virtual chain for "${edgeId}" but was never declared in virtualNodes`,
        );
      }
      // A dummy belongs to exactly one edge. Shared between two, it would be
      // pulled toward two routes at once and each of them would bend through a
      // coordinate chosen for the other.
      if (chained.has(id)) {
        throw new StageContractError(
          stage,
          id,
          'is in more than one virtual chain, or twice in one',
        );
      }
      chained.add(id);
    }
    // A chain is listed source to target AS THE CALLER AUTHORED THEM, matching
    // `RoutedEdge.points` and for the same reason, so its ranks are strictly
    // MONOTONIC rather than strictly increasing: increasing for a normal edge
    // and decreasing for a reversed one. Walking the chain with the target
    // appended checks the monotonicity and the "strictly between the endpoint
    // ranks" rule in one pass, since the walk starts at the source's rank.
    const reversed = ranked.reversedEdges.has(edgeId);
    let previous = ranked.ranks.get(edge.source);
    for (const id of [...chainIds, edge.target]) {
      const rank = ranked.ranks.get(id);
      // Unreachable: the roster loop above ranked every graph node and every
      // declared id, and the loop above rejected an undeclared chain member.
      if (previous === undefined || rank === undefined) break;
      if (reversed ? rank >= previous : rank <= previous) {
        throw new StageContractError(
          stage,
          edgeId,
          `has a virtual chain that does not run ${reversed ? 'up' : 'down'} the ranks from ` +
            'source to target as the caller authored them: ' +
            `rank ${String(rank)} follows rank ${String(previous)}`,
        );
      }
      previous = rank;
    }
  }

  // The defining invariant of a ranking: every edge runs down the page, or is
  // declared reversed and runs up it. Not-greater rather than strictly less,
  // because a self loop puts both endpoints on one rank and, after M2.4b, a long
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
 * Absence is checked as well as presence, and that is the M2.4b boundary for
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
 * The runner never mutates the input graph, and no stage hands one back. That
 * used to be a rule with a check behind it and is now two mechanisms, belt and
 * braces. The four `...Output` types declare every field the runner owns as
 * `never`, so a stage that ends `{ ...input, ... }` fails to compile: a spread
 * is not excess-property-checked, but a DECLARED property is checked through
 * one. And the runner names every field it takes out of an output, so a value
 * that got past the compiler by way of a cast is still never read. Neither
 * alone would do. The types stop the mistake at the keyboard and a cast gets
 * past them; the naming stops any value getting through and only after the
 * stage ran.
 *
 * What no type can see is a stage that reaches into the graph it was HANDED and
 * adds a node to it. That one is still a runtime check, and it fails at the
 * rank boundary naming the stage rather than surfacing later as an invariant of
 * this package.
 *
 * A stage that needs to pretend an edge runs the other way records its id in
 * `reversedEdges`, and one that needs a node the caller never added declares it,
 * with its size, in `virtualNodes`, and says which edge the node serves in
 * `virtualChains`. Those are what make mutating the graph unnecessary as well
 * as forbidden. The runner turns a declaration into the roster (the graph's
 * nodes plus the declared ids, in id order) and into the roster-wide `sizes`
 * map; everything from the rank stage on is checked over that roster, and the
 * result is filtered back down to the caller's own ids, so a declared node
 * never escapes.
 *
 * Two of the four default stages are real algorithms. The rank stage has been
 * one since M2.2: it breaks cycles with a greedy feedback arc set and ranks by
 * longest path, so the layers are the ones the graph asks for. The order stage
 * has been one since M2.6b: barycenter sweeps and a transpose pass, so within a
 * layer the horizontal order is one that has had its crossings reduced rather
 * than the graph's insertion order. The other two are still placeholders, so
 * the coordinates are a grid and an edge is a straight line between two
 * centres, until coordinate assignment (M2.7) and real routing (M2.8) replace
 * them one at a time, against this runner and its contract checks.
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

  // Every field a stage contributes is named here, one at a time. The spreads
  // below carry the runner's OWN previous record forward; nothing a stage
  // returned is ever spread. That is the second of the two mechanisms behind
  // "no stage hands back a graph": the output types make the mistake fail to
  // compile, and this makes a value that got past them anyway go unread. A
  // stage that cast its way past the compiler and returned an extra `graph`
  // would still not have one read.
  const rank = stages?.rank ?? defaultStages.rank;
  const rankOut = rank.run(prepared);
  const ranked: RankedState = {
    graph,
    config,
    ranks: rankOut.ranks,
    reversedEdges: rankOut.reversedEdges,
    virtualNodes: declaredRoster(rankOut.virtualNodes),
    virtualChains: rankOut.virtualChains ?? new Map(),
    sizes: mergedSizes(prepared.sizes, rankOut.virtualNodes),
  };
  checkRanked(rank.name, graph, ranked, rankOut.virtualNodes);

  const order = stages?.order ?? defaultStages.order;
  const ordered: OrderedState = { ...ranked, layers: order.run(ranked).layers };
  checkOrdered(order.name, graph, ordered);

  const position = stages?.position ?? defaultStages.position;
  const positioned: PositionedState = {
    ...ordered,
    positions: position.run(ordered).positions,
  };
  checkPositioned(position.name, graph, positioned);

  const route = stages?.route ?? defaultStages.route;
  const routed: RoutedState = { ...positioned, routes: route.run(positioned).routes };
  checkRouted(route.name, graph, routed);

  const result = assemble(graph, routed);
  assertBounds(result);
  return result;
}
