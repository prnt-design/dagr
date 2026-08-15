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
   * 10. Carried through the pipeline and NOT YET HONOURED by any stage.
   *
   * M2.8 brought real routing and did not honour it, which is worth saying
   * plainly because this docstring used to promise that milestone would. The
   * cases it governs are the two where routes coincide exactly rather than
   * merely run close, parallel edges and self loops, and fanning either of them
   * out needs a rule this package has not chosen yet. `polylineRouteStage`'s
   * docstring in `route.ts` is where that is argued and it is the named next
   * step for the router.
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
 * itself. So `graph` here is always the object the caller passed, held there by
 * two mechanisms rather than one: each output type declares `graph` as `never`,
 * so a stage that spreads the record it was handed fails to compile, and the
 * runner names every field it takes out of an output, so a field a stage
 * returned anyway is never read. The one reason to want to replace the graph,
 * needing a node the caller never added, is what
 * {@link RankOutput.virtualNodes} is for.
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
   * Filled in since M2.2, where the default ranker started breaking cycles
   * with a feedback arc set. It exists rather than the ranker flipping the
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
   * graph. Filled since M2.4b, where the default ranker splits a long edge into
   * a chain of one virtual node per rank it spans, and by both built-in rankers
   * since M2.4c, which moved that splitter into `chains.ts` so the two share
   * it.
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
   * The dummy chain the rank stage split each long edge into, keyed by the
   * caller's own edge id. Filled since M2.4b, and declared in M2.4a: a slot
   * declared before anything fills it, exactly as `reversedEdges` was until
   * M2.2, so the milestone that fills it was a stage change rather than a
   * contract change.
   *
   * **A chain is listed source to target as the CALLER authored them**, which
   * is the same direction {@link RoutedEdge.points} runs and for the same
   * reason. A router working from the ranked direction naturally walks its
   * chain backwards, and nothing downstream would notice until an arrowhead
   * landed on the wrong end, two packages away from the cause. So the ranks
   * along a chain are strictly MONOTONIC rather than strictly increasing:
   * increasing for a normal edge, decreasing for one in {@link reversedEdges},
   * and strictly between the two endpoint ranks either way.
   *
   * It exists because a dummy is not just a sized id. M2.4b's router has to
   * rejoin a chain into one polyline keyed by the edge it serves, and without
   * this the only recourse is parsing a dummy id back apart, which is ambiguous
   * (an `EdgeId` is a caller-supplied string and may contain any separator a
   * format picks), couples the ranker and the router through a string format,
   * and promotes the id format to load-bearing public contract when the M3
   * requirement only pins the VALUE.
   *
   * The runner builds this from {@link RankOutput.virtualChains}, putting an
   * empty map here when the stage omitted it, which is the treatment
   * `virtualNodes` gets for the same reason.
   */
  readonly virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]>;

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

/**
 * Where a node's box is and how big it is. `x` and `y` are the node's CENTRE,
 * as everywhere else in this package.
 *
 * Split out from {@link PositionedNode} by M3.1, which needed the same four
 * numbers without an id: a `LayoutDelta` reports a move as the box before and
 * the box after, and an id repeated inside both halves of an entry that already
 * carries one is a second copy to disagree with. `PositionedNode` is this plus
 * the id, so nothing about a result changed shape.
 */
export interface NodeGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A node with a place and a size. `x` and `y` are the node's centre. */
export interface PositionedNode extends NodeGeometry {
  readonly id: NodeId;
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
 * Maps rather than arrays, keyed by the graph's own ids. `diffLayout` compares
 * two results by id to produce a `LayoutDelta`, which is an O(n) map lookup per
 * node rather than an index scan, and Map iteration is still deterministic
 * insertion order, so nothing is given up: both maps iterate in graph insertion
 * order, and a delta's own groups inherit that order from them.
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
   * The smallest rectangle containing every node box AND every route point. An
   * empty graph gets a zero rectangle at the origin.
   *
   * The routes count as of M2.4b, and until then the two formulations agreed:
   * a route ran centre to centre, and a centre is inside its own box. A route
   * that bends through a dummy does not agree, because a zero-width dummy at
   * the end of a row sits at that row's right extreme, outside every box in it.
   * This is the formulation obstacle detours need as well, so it is the durable
   * one rather than a patch. M2.8's border attachment did not exercise it: an
   * attachment lands ON a box the hull already contains, so a route's ENDS
   * cannot grow it and only its bends ever could.
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
 * for three reasons that are all the same reason. A stage does not hand back a
 * graph, so the roster every check runs over is the runner's. A stage cannot
 * restate a field it has no opinion about, so no two records can disagree about
 * what `config` meant on this run. And a stage no longer has to spread the
 * record it was handed just to give back fields it never touched, which is the
 * line that quietly carries a mistake when a new field is added upstream.
 *
 * Two mechanisms hold that up, belt and braces. Each output type DECLARES every
 * field the runner owns, and every field contributed upstream of it, as
 * `never`: see the block at the end of each of the four. And the runner names
 * every field it takes out of an output one at a time, so a field a stage
 * returned anyway is never read. Neither alone is enough. The types stop the
 * mistake at the keyboard but a cast gets past them; the runner stops any
 * value getting through but only after the stage ran.
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
   * A size is whatever the stage wants. The default ranker gives a plain
   * long-edge dummy no size at all, matching dagre's, because a dummy is a place
   * a route passes through rather than a thing that is drawn, and the `nodeSep`
   * on either side of it is what keeps the route clear of its neighbours.
   */
  readonly virtualNodes?: ReadonlyMap<NodeId, Size>;

  /**
   * The chain of declared ids this stage split each long edge into, in order,
   * source to target as the CALLER authored them. See
   * {@link RankedState.virtualChains} for the direction argument and for why
   * the chain is recorded rather than recovered from the ids.
   *
   * Every id in a chain has to be a key of {@link virtualNodes}, every key has
   * to be an edge the graph holds, no id may appear in two chains or twice in
   * one, and a chain is never empty: an edge with no dummies simply has no
   * entry. Optional for the same reason `virtualNodes` is.
   *
   * The converse is deliberately NOT required: a declared id that belongs to no
   * chain is legal, and stays legal after M2.4b. A long edge split is only the
   * first reason to want a node the caller never added, and dagre has others
   * (an edge label, a self loop's stand-in), so the asymmetry here is a
   * decision rather than an omission. What a chain adds is that these
   * particular dummies belong to one edge and run in one order.
   *
   * A chain that exists also has to be COMPLETE, which M2.4b decided and which
   * the five rules above do not establish on their own: a single dummy at rank
   * 1 on an edge from rank 0 to rank 3 satisfies every one of them and routes
   * across rank 2 with no bend. The rule is that a chain holds exactly one node
   * at every rank THE LAYOUT ACTUALLY HAS strictly between its endpoint ranks,
   * the occupied ranks being exactly the layers the order stage builds. It is
   * phrased that way rather than as steps of exactly one because that assumes
   * contiguous integer ranks, which no order stage in this package assumes:
   * both of them take the layers to be the distinct ranks sorted.
   *
   * Its scope is a chain that EXISTS. Having one at all stays optional: a
   * ranker that splits nothing is legal, and so is a declared id in no chain.
   * What is not legal is a chain with a hole in it.
   *
   * Because the rule is phrased over the ranks the layout HAS rather than over
   * an edge's own endpoints, completeness is a property of the whole ranking and
   * not of one chain. Those two paragraphs compose: a stage that introduces a
   * rank nothing previously occupied, by declaring a dummy in no chain at a rank
   * of its own, has to extend every chain that spans that rank, including chains
   * it did not mint. That is the intended reading rather than an accident, since
   * a layer that exists really is a layer a long edge crosses at a coordinate
   * nothing in it constrains, and the runner's error names the node occupying
   * the missing rank so the cause is findable from the message.
   */
  readonly virtualChains?: ReadonlyMap<EdgeId, readonly NodeId[]>;

  // Every field the runner owns, declared `never` so that a stage which spreads
  // the record it was handed fails to compile. TypeScript does not
  // excess-property-check a spread, so `{ ...input, ranks, reversedEdges }` was
  // a legal `RankOutput` without these, and quietly handed back a graph, a
  // config and a sizes map the runner ignored. A DECLARED property is checked
  // through a spread, which is what makes the rule a compiler rule rather than
  // a claim. Optional, because a correct stage says nothing about any of them.
  // Pinned case by case in `test/stage-output.types.test.ts`.
  readonly graph?: never;
  readonly config?: never;
  readonly sizes?: never;
}

/** What the order stage contributes. See {@link OrderedState.layers}. */
export interface OrderOutput {
  readonly layers: readonly (readonly NodeId[])[];

  // The runner's own fields, plus everything the rank stage contributed. Same
  // rule as {@link RankOutput}, one stage further down: an order stage that
  // ends `{ ...input, layers }` fails to compile, because the record it was
  // handed carries the ranker's four fields as well as the runner's three.
  readonly graph?: never;
  readonly config?: never;
  readonly sizes?: never;
  readonly ranks?: never;
  readonly reversedEdges?: never;
  readonly virtualNodes?: never;
  readonly virtualChains?: never;
}

/** What the position stage contributes. See {@link PositionedState.positions}. */
export interface PositionOutput {
  readonly positions: ReadonlyMap<NodeId, Point>;

  // Everything upstream of the position stage, declared `never` so that
  // `{ ...input, positions }` fails to compile. Same rule as {@link RankOutput}.
  readonly graph?: never;
  readonly config?: never;
  readonly sizes?: never;
  readonly ranks?: never;
  readonly reversedEdges?: never;
  readonly virtualNodes?: never;
  readonly virtualChains?: never;
  readonly layers?: never;
}

/** What the route stage contributes. See {@link RoutedState.routes}. */
export interface RouteOutput {
  readonly routes: ReadonlyMap<EdgeId, readonly Point[]>;

  // Everything upstream of the route stage, declared `never` so that
  // `{ ...input, routes }` fails to compile. Same rule as {@link RankOutput}.
  readonly graph?: never;
  readonly config?: never;
  readonly sizes?: never;
  readonly ranks?: never;
  readonly reversedEdges?: never;
  readonly virtualNodes?: never;
  readonly virtualChains?: never;
  readonly layers?: never;
  readonly positions?: never;
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
