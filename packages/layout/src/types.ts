import type { EdgeId, Graph, Node, NodeId } from '@dagr/graph';

/** A width and a height, both in layout units. Neither may be negative. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A point in layout space. Y grows downward, matching screen coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle given by its top-left corner and its size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What the caller may say about a layout run. Every field is optional, and the
 * runner resolves the whole record once into a {@link ResolvedLayoutConfig}
 * before any stage sees it.
 *
 * Sizes arrive through the `nodeSize` callback rather than off the node record
 * on purpose. `@dagr/graph` has attribute bags as of M1.2, and a node's drawn
 * size still does not belong in one: it belongs to whoever is drawing it, not
 * to the graph. A caller who does keep sizes in attributes reads them straight
 * off the node the callback is handed, which is their convention rather than
 * this package's. Keeping it a callback means layout never reaches into a node
 * for anything but its id, so no attribute key is reserved and no graph has to
 * be shaped a particular way to be laid out.
 */
export interface LayoutConfig {
  /** Minimum gap between two node boxes side by side in a layer. Default 50. */
  readonly nodeSep?: number;

  /** Minimum gap between two adjacent layers, measured box to box. Default 50. */
  readonly rankSep?: number;

  /**
   * Minimum gap between two edge routes running alongside each other. Default
   * 10. Carried through the pipeline now and honoured once real routing lands
   * in M2.8.
   */
  readonly edgeSep?: number;

  /** Size for any node the `nodeSize` callback does not size. Default 100 by 40. */
  readonly defaultNodeSize?: Size;

  /**
   * Per-node size. Return `undefined` for a node to fall back to
   * `defaultNodeSize`. Called exactly once per node, during prepare, so it may
   * be as expensive as measuring text.
   */
  readonly nodeSize?: (node: Node) => Size | undefined;
}

/**
 * The config every stage reads, with each separation and the default size
 * resolved to a real number. The runner computes it once and threads it through
 * the pipeline, so no stage re-applies a default and no two stages can disagree
 * about what `nodeSep` meant on this run.
 *
 * The `nodeSize` callback deliberately does not survive resolution: it is
 * consumed once during prepare and the answers live in
 * {@link PreparedState.sizes}. A stage that could still call it might size the
 * same node twice, and get two different answers.
 */
export interface ResolvedLayoutConfig {
  readonly nodeSep: number;
  readonly rankSep: number;
  readonly edgeSep: number;
  readonly defaultNodeSize: Size;
}

/** What a caller hands to {@link layout}: a graph, and optionally some config. */
export interface LayoutInput {
  readonly graph: Graph;
  readonly config?: LayoutConfig;
}

/**
 * The pipeline's starting record, built by the runner before the first stage.
 *
 * Every later record extends this one, so a stage can read everything computed
 * upstream of it and nothing has to be passed around out of band. The graph is
 * carried by reference and is never mutated by layout: a stage that wants to
 * reverse an edge records the id instead (see {@link RankedState}).
 *
 * This record and the four that extend it are named `...State` rather than
 * `...Layout` because they are the accumulating state that flows between
 * stages, and only a stage author ever names one. `LayoutInput`,
 * `LayoutConfig`, and `LayoutResult` are the caller-facing surface. Two
 * vocabularies for two audiences, split along the line that matters: what a
 * caller passes and gets back, versus what one stage hands the next.
 *
 * The five records are what a stage READS. What a stage WRITES is one of the
 * four `...Output` types, and the runner merges that into the next record
 * itself. So `graph` here is always the object the caller passed: a stage has
 * no way to hand back a different one, which is why nothing checks for it. The
 * one reason to want to replace the graph, needing a node the caller never
 * added, is what {@link RankOutput.virtualNodes} is for.
 */
export interface PreparedState {
  readonly graph: Graph;
  readonly config: ResolvedLayoutConfig;

  /** Resolved size per node. Has an entry for every node in the graph. */
  readonly sizes: ReadonlyMap<NodeId, Size>;
}

/** {@link PreparedState} plus the output of the rank stage. */
export interface RankedState extends PreparedState {
  /**
   * Layer index per node. Has an entry for every node in the roster: every node
   * in the graph, plus every id in {@link virtualNodes}. Lower means closer to
   * the top of the drawing. Values need not be contiguous or start at zero; the
   * order stage sorts the distinct ranks it finds.
   */
  readonly ranks: ReadonlyMap<NodeId, number>;

  /**
   * Edges the ranker treated as pointing the other way, so that later stages
   * and the router can put them back. Every id has to be an edge the graph
   * holds, and a self loop is never one of them: reversing a self loop cannot
   * make it any less of a cycle.
   *
   * Filled in since M2.2, where the default ranker started breaking cycles with
   * a greedy feedback arc set. It exists rather than the ranker flipping the
   * edge because the alternative, mutating the caller's graph, is the one thing
   * this pipeline promises not to do.
   *
   * It is bookkeeping between the ranker and the router, and never the
   * consumer's business: a {@link RoutedEdge} runs from `source` to `target` as
   * the caller authored them whatever is in here.
   */
  readonly reversedEdges: ReadonlySet<EdgeId>;

  /**
   * Ids the rank stage needs to lay out but the caller never added to the
   * graph. Empty until dummy-node chains land in M2.4b, where a long edge is
   * split into a chain of one virtual node per rank it spans.
   *
   * This carries exactly the argument `reversedEdges` carries: the source graph
   * is never mutated, so a stage that needs a node the user never added
   * declares it in {@link RankOutput.virtualNodes} instead of adding it.
   * Declaring an id puts it in the roster, which is what the rank, order, and
   * position checks run over, so a dummy is a first-class citizen of the
   * pipeline right up to the route stage. It stops there: the result only ever
   * mentions the caller's own nodes.
   *
   * The runner builds this set from the keys of what the rank stage declared,
   * which is why it is a set here and a map there. A stage WRITES a declaration,
   * where an id without a size is a bug, and READS a roster, where a size it
   * already has in `sizes` would be a second copy to disagree with. Two types
   * for the two directions, so the compiler catches the confusion rather than a
   * check catching it later.
   */
  readonly virtualNodes: ReadonlySet<NodeId>;

  /**
   * Resolved size per node, now covering the whole roster rather than only the
   * graph. The runner derives it: {@link PreparedState.sizes} for the graph's
   * own nodes, plus the size the rank stage gave each id it declared. A stage
   * never assembles this map, which is what makes "declared but unsized"
   * unrepresentable rather than merely rejected, and what stops a ranker
   * silently resizing a node the caller measured itself.
   */
  readonly sizes: ReadonlyMap<NodeId, Size>;
}

/** {@link RankedState} plus the output of the order stage. */
export interface OrderedState extends RankedState {
  /**
   * One entry per layer, top to bottom, each listing its nodes left to right.
   * Every member of the roster appears exactly once across all layers, and
   * nothing else does.
   *
   * A layer holds nodes of one rank, and the layers run in strictly increasing
   * rank order, so layer index and rank agree about which way is down. No layer
   * is empty: an empty layer has no rank to compare against its neighbours, and
   * the position stage would still give it a row of vertical space.
   */
  readonly layers: readonly (readonly NodeId[])[];
}

/** {@link OrderedState} plus the output of the position stage. */
export interface PositionedState extends OrderedState {
  /**
   * Coordinate per node, with an entry for every member of the roster. A point
   * is the node's CENTRE, not its top-left corner. Centres are what animation
   * interpolates and what edges attach to, and they stay meaningful when a node
   * resizes; a corner does not.
   */
  readonly positions: ReadonlyMap<NodeId, Point>;
}

/**
 * {@link PositionedState} plus the output of the route stage, and the last
 * record the pipeline produces.
 *
 * A route stage adds routes and nothing else, in the same shape as the three
 * stages before it: it returns a {@link RouteOutput} and the runner builds this
 * record. It does not build the {@link LayoutResult} either: the runner does
 * that, from `positions` and `sizes` for the nodes, from `routes` for the
 * edges, and by computing `bounds` itself. Assembling the result is not
 * routing, and a third-party router that had to do it would be reimplementing
 * a bounds hull and a node loop it has no opinion about, once per router, with
 * each copy trusted to get a pipeline invariant right.
 */
export interface RoutedState extends PositionedState {
  /**
   * Polyline per edge, with an entry for every edge the graph holds and nothing
   * else. Virtual nodes stop here: a long edge split into a dummy chain in
   * M2.4b is rejoined into one polyline by the router, keyed by the caller's
   * own edge id.
   *
   * The polyline alone, not a {@link RoutedEdge}: which edge this is, and which
   * nodes it connects, are the graph's facts and the runner copies them from
   * there. A router that stated them too could state them wrongly, and a
   * consumer would read an edge that was self-consistent and still disagreed
   * with the graph it came from. A router doing reversal bookkeeping is exactly
   * the code most likely to hand back a flipped pair, so the fields it has no
   * opinion about are not its to fill in.
   */
  readonly routes: ReadonlyMap<EdgeId, readonly Point[]>;
}

/** A node with a place and a size. `x` and `y` are the node's centre. */
export interface PositionedNode {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An edge with a polyline route. */
export interface RoutedEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;

  /**
   * The route, including both endpoints, and always running from
   * {@link source} to {@link target} as the caller authored them, even when the
   * ranker reversed the edge to break a cycle.
   *
   * The direction is stated because it cannot be inferred and because getting
   * it wrong is silent. A router working from the reversed direction naturally
   * emits its points target-first while `source` and `target` still name the
   * original endpoints, and a renderer that draws an arrowhead at the last
   * point (M4 and M5 both will) then puts arrowheads on the wrong end for
   * exactly the edges that were part of a cycle. `reversedEdges` is the
   * router's bookkeeping and never the consumer's: nothing downstream of the
   * route stage should have to consult it to know which way an edge runs.
   */
  readonly points: readonly Point[];
}

/**
 * What a layout run produces: where every node sits, how every edge runs, and
 * the box around the lot.
 *
 * Maps rather than arrays, keyed by the graph's own ids. M3.1 diffs two results
 * by id to produce a `LayoutDelta`, which is an O(n) map lookup per node rather
 * than an index scan, and Map iteration is still deterministic insertion order,
 * so nothing is given up: both maps iterate in graph insertion order.
 *
 * The keys are exactly the caller's own ids, no more and no less. Whatever a
 * stage needed internally, including any node it declared in
 * {@link RankedState.virtualNodes}, never reaches here, because the runner
 * builds both maps by walking the caller's own graph rather than by trusting
 * what a stage handed it.
 */
export interface LayoutResult {
  readonly nodes: ReadonlyMap<NodeId, PositionedNode>;
  readonly edges: ReadonlyMap<EdgeId, RoutedEdge>;

  /**
   * The smallest rectangle containing every node box. Edge routes are not
   * counted: today they run centre to centre and cannot leave it, and once
   * M2.8 routes around obstacles the bounds will grow to cover them too.
   * An empty graph gets a zero rectangle at the origin.
   */
  readonly bounds: Rect;
}

/**
 * What the rank stage contributes, and all it contributes.
 *
 * The four `...Output` types are the write side of the pipeline, and the five
 * `...State` records are the read side. A stage reads everything computed
 * upstream of it and returns its own fields alone; the runner merges those into
 * the next record. Returning less is a stronger contract than returning more,
 * for three reasons that are all the same reason. A stage cannot replace the
 * graph, so nothing has to check that it did not. A stage cannot restate a
 * field it has no opinion about, so no two records can disagree about what
 * `config` meant on this run. And a stage no longer has to spread the record it
 * was handed just to give back fields it never touched, which is the line that
 * quietly carries a mistake when a new field is added upstream.
 */
export interface RankOutput {
  /** Layer index per node, covering the roster. See {@link RankedState.ranks}. */
  readonly ranks: ReadonlyMap<NodeId, number>;

  /** Edges treated as running the other way. See {@link RankedState.reversedEdges}. */
  readonly reversedEdges: ReadonlySet<EdgeId>;

  /**
   * Nodes this stage needs that the caller never added, each WITH its size.
   *
   * Declaring an id and sizing it are one act, so they are one field. The
   * alternative, a set of ids next to a roster-wide `sizes` map the stage had
   * to copy and extend, made "declared but unsized" a mistake to check for
   * rather than a mistake to be unable to make, and it handed every ranker a
   * copy of the caller's sizes to overwrite by accident. Here a stage can only
   * say what its own nodes measure.
   *
   * Optional, because most rankers declare nothing and a required field whose
   * only honest answer is an empty collection is a question that should not
   * have been asked. Omitting it and declaring nothing are the same thing: the
   * runner puts an empty set in {@link RankedState.virtualNodes} either way.
   *
   * Dagre gives a dummy a small width so that `nodeSep` spacing still works
   * around it.
   */
  readonly virtualNodes?: ReadonlyMap<NodeId, Size>;
}

/** What the order stage contributes. See {@link OrderedState.layers}. */
export interface OrderOutput {
  readonly layers: readonly (readonly NodeId[])[];
}

/** What the position stage contributes. See {@link PositionedState.positions}. */
export interface PositionOutput {
  readonly positions: ReadonlyMap<NodeId, Point>;
}

/** What the route stage contributes. See {@link RoutedState.routes}. */
export interface RouteOutput {
  readonly routes: ReadonlyMap<EdgeId, readonly Point[]>;
}

/**
 * Assigns each node a layer index, and records any edge it had to treat as
 * reversed to do so.
 *
 * All four stage interfaces have the same shape: a `name` used in diagnostics,
 * and a `run` from the record the runner built for it to that stage's own
 * output. Because each record extends the last, a stage reads everything
 * upstream of it, and replacing one implementation is a one-line change at the
 * call site that still typechecks.
 */
export interface RankStage {
  readonly name: string;
  run(input: PreparedState): RankOutput;
}

/** Turns ranks into ordered layers, choosing the left-to-right order in each. */
export interface OrderStage {
  readonly name: string;
  run(input: RankedState): OrderOutput;
}

/** Turns ordered layers into coordinates. */
export interface PositionStage {
  readonly name: string;
  run(input: OrderedState): PositionOutput;
}

/** Turns coordinates into routes, one polyline per edge the graph holds. */
export interface RouteStage {
  readonly name: string;
  run(input: PositionedState): RouteOutput;
}

/** The four stages a run uses, in the order the runner calls them. */
export interface LayoutStages {
  readonly rank: RankStage;
  readonly order: OrderStage;
  readonly position: PositionStage;
  readonly route: RouteStage;
}

/**
 * The stage overrides {@link layout} accepts: any subset of the four, with the
 * rest falling back to `defaultStages`.
 *
 * Named rather than spelled `Partial<LayoutStages>` inline so that a caller
 * that builds a stage set separately from the call has a type to write down,
 * and so that the name is already public when M3.2's engine takes the same
 * object.
 */
export type LayoutStageOverrides = Partial<LayoutStages>;
