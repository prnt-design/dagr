import { readFileSync, writeFileSync } from 'node:fs';
import dagre from '@dagrejs/dagre';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { StageContractError } from '../src/errors.js';
import { layout } from '../src/pipeline.js';
import { brandesKoepfPositionStage } from '../src/position.js';
import {
  SIZE_KINDS,
  buildParityGraph,
  parityCorpus,
  parityNodeSizes,
} from './dagre-parity-corpus.js';
import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import type { ParityGraph } from './dagre-parity-corpus.js';
import type { LayoutStageOverrides, Point, RouteStage, Size } from '../src/types.js';

/**
 * What this package draws against what dagre draws, on the same graphs at the
 * same sizes.
 *
 * WHAT PARITY MEANS HERE, BEFORE ANY NUMBER. "Structural parity metrics within
 * tolerance" has the same choice in it that "monotone in the rank axis" had in
 * M2.8, and it has to be settled the same way: by saying what is compared, what
 * each comparison is allowed to be, and above all WHICH WAY TO READ A DIFF IN
 * EACH ONE. A parity table nobody can act on gets updated reflexively the day
 * it goes red, which is the failure `layout.cycles.quality.test.ts` has a
 * docblock about and this one is written in the shape of.
 *
 * Neither engine is the reference. dagre is not a specification and this
 * package is not trying to reproduce it: it is a successor with a different
 * cycle breaker, a different default ranker, a different position stage and a
 * different routing style. So a number that differs is not by itself a defect
 * on either side. What the table is for is separating the differences that are
 * choices from the differences that are this package being worse at something a
 * well-known implementation does well, and it does that by giving each metric a
 * verdict up front rather than after the fact.
 *
 * ## The population, which is the trap
 *
 * THE CROSSING COUNTS HERE ARE NOT THIS PACKAGE'S CROSSING COUNTS AND ARE NOT
 * DAGRE'S. This package's `countCrossings` counts inversions between adjacent
 * layers over the drawing's segments, 214,222 of them on the 10k bench corpus,
 * and dagre's internal counter counts over its own dummy and border segment
 * population. Those are two different measurements over two populations neither
 * engine can compute for the other, and comparing them would be a category
 * error rather than a tolerance question. Every number in this file is instead
 * derived from PUBLIC OUTPUT ALONE, by one implementation applied to both
 * sides: node centres, node boxes, and the emitted polylines. dagre keeps
 * `rank` and `order` on its node labels after `layout` and reading them would
 * make the layer metric a one-liner; it is deliberately not read, because then
 * one column would be answering a question about dagre's ranker and the other a
 * question about geometry.
 *
 * That choice is what makes the corpus small. A geometric crossing count is
 * quadratic in segments, so it runs on tens of nodes and not on the 10k bench
 * corpus. The benchmark half of M2.9 is measured there instead, in
 * `layout.cost.test.ts`, and the two halves are deliberately not the same
 * corpus. `bench/README.md` says which is which.
 *
 * ## The metrics, the tolerance each gets, and what a diff means
 *
 * Every number is pinned EXACTLY in `dagre-parity.golden.json` for all three
 * columns, so any change on either side arrives as a diff. The tolerances below
 * are the second layer, and they are cross-engine CEILINGS on the shipping
 * column: what this package promises relative to dagre, as opposed to what it
 * currently does. The two say different things and a change that moves one
 * without the other is the interesting case.
 *
 * | metric                | tolerance          | a diff means                    |
 * | --------------------- | ------------------ | ------------------------------- |
 * | `nodeOverlaps`        | exactly 0          | BUG HERE                        |
 * | `nonFinitePoints`     | exactly 0          | BUG HERE                        |
 * | `layers`              | at most dagre's    | BUG HERE if it rises            |
 * | `chordCrossings`      | 1.5x total, 2.5x+1 | BUG HERE if it rises            |
 * | `edgeLength`          | 1.25x total, 2x    | BUG HERE if it rises            |
 * | `edgeLength`, one row | exempt, with reason| a KNOWN GAP, see below          |
 * | `width`, `height`     | 1.25x per graph    | BUG HERE if it rises            |
 * | `crossings`           | none, recorded     | routing style, see below        |
 * | `segments`, `bends`   | none, recorded     | routing style, see below        |
 * | `widestLayer`         | none, recorded     | ranker choice                   |
 * | `attachments*`        | none, recorded     | attachment and self-loop rules  |
 * | `cappedAttachments`   | corpus total > 0   | THE CORPUS is wrong if it is 0  |
 *
 * `nodeOverlaps` and `nonFinitePoints` are not parity metrics at all. They are
 * absolute properties of a drawing this package emits, they are asserted at
 * zero rather than against dagre, and dagre's own values are recorded beside
 * them only because the same code computes both. dagre's `nonFinitePoints` is
 * not zero, which is the next section.
 *
 * `layers`, `chordCrossings`, `edgeLength` and the extents are the real parity
 * claims, and every one of them is one-sided. Nothing here fails because this
 * package did BETTER than dagre. A ceiling that fired in both directions would
 * be asserting that this package must keep drawing what dagre draws, which is
 * the opposite of what a successor is for.
 *
 * ## The control, and the number it stopped this file from publishing
 *
 * THE DRAWN CROSSING COUNT SAYS THIS PACKAGE HAS HALF DAGRE'S CROSSINGS AND
 * THAT READING IS WRONG. Over the corpus `crossings` is 51 here against dagre's
 * 98. The drawn-ink gap is routing style: dagre halves its `ranksep` and
 * doubles every edge's `minlen` to leave room for an edge label, so every edge
 * gets a bend in every rank gap and its polylines carry 1,015 segments and 774
 * bends across this corpus against 525 and 284 here. More elbows sweep more ink
 * and cross more things.
 *
 * `chordCrossings` is the control, and IT SAYS THE OPPOSITE. Counting crossings
 * between the straight lines joining the endpoint node CENTRES, which depends
 * on the node positions and the topology and on nothing either router did, this
 * package is 147 against dagre's 109. THIRTY-FIVE PERCENT MORE. It is the one
 * metric here that dagre wins and it is the most important one in the file,
 * because a crossing between two nodes is what a layout engine is for.
 *
 * So `crossings` is recorded and NOT gated, `chordCrossings` is gated, and the
 * pair is the whole argument. Without the control this file would have
 * published a 1.9x crossing advantage that is a fact about polylines, while the
 * quantity it stands in for went the other way.
 *
 * THE FIRST VERSION OF THIS CONTROL WAS ALSO WRONG and the M2.9 algorithms
 * review caught it. It built the chord from the route's first and last EMITTED
 * points, which are routing output: this package aims an end at the first dummy
 * and caps how far it travels, dagre aims one at its label dummy half a rank
 * away, and the two land in different places on the same box. That definition
 * reported 124 against 123 and the word for it was "level". Correcting the
 * chord to node centres moved it to 147 against 109 and moved the finding from
 * a tie to a loss. A control that is neutral about BENDS and not about
 * ATTACHMENT is most of the way to neutral and is not the same thing.
 *
 * ## What the corpus says, as of this file's first measurement
 *
 * Against dagre 3.1.1, the shipping default pipeline, nine graphs:
 *
 * - `layers` equal on eight graphs, 64 against 68 in total. The one that
 *   differs is `state-machine`, the cyclic graph with self loops, where this
 *   package ranks 6 layers against dagre's 10: M2.2c's least-squares feedback
 *   arc set against dagre's greedy one.
 * - `chordCrossings` 147 against 109 over the corpus, 1.35x, and this package
 *   is higher on five graphs, lower on three and level on one. The two it
 *   loses worst are `build-pipeline` at 2.09x and `pattern-generator` at 1.83x.
 *   THE CAUSE IS THE POSITION PLACEHOLDER rather than the order stage: the same
 *   corpus under `brandesKoepfPositionStage` is 96, which is 0.88x dagre and
 *   0.65x what ships.
 * - `edgeLength` 157,177 against 156,783 over the corpus. Over the eight
 *   graphs dagre draws completely it is 151,511 against 154,509, so 1.9% LESS
 *   ink, ranging from 0.56x on `service-mesh` to 1.50x on `org-chart`. The
 *   ninth is `scattered-suite` at 2.49x, which breaches the per-graph ceiling
 *   and is let off it BY NAME rather than excluded from the comparison: see
 *   {@link EXEMPT_EDGE_LENGTH}, which is also where the reason lives. That row
 *   is inside every other bound. The other position stage draws the same graph
 *   at 1.02x dagre, so what it records is the grid placeholder's handling of
 *   five disconnected components and not anything downstream of it.
 * - `width` never more than 1.02x dagre's on any graph and 0.92x in total,
 *   `height` never more than 1.06x.
 * - `nodeOverlaps` zero on all three columns, and `nonFinitePoints` zero here
 *   and one for dagre.
 *
 * THE LAST ONE IS A DEFECT IN DAGRE ON LEGAL INPUT and is recorded rather than
 * routed around. A route leaving a box of ZERO WIDTH travelling straight down
 * makes dagre 3.1.1 compute `width * dy / dx` with both `width` and `dx` zero
 * and emit a coordinate that is not a number. `scattered-suite` has such a box
 * and one such point. It is confined to that one graph so the other seven rows
 * compare two complete drawings, `drawable` below drops the point and counts
 * it, and this package draws the same input with an attachment at the box's own
 * centre.
 *
 * ## Why there is a second column for a stage that is not the default
 *
 * `dagrBrandesKoepf` is the same pipeline with `brandesKoepfPositionStage` in
 * place of `gridPositionStage`. It is here because `position.ts` states an open
 * question and this corpus is the first evidence that can answer it: M2.7
 * measured Brandes-Koepf at 2.7x and 4.4x `gridPositionStage`'s total edge
 * length on the two GENERATED bench corpora and left the placeholder as the
 * default on those grounds.
 *
 * THE ROBUST RESULT IS THE CROSSING ONE. Brandes-Koepf takes `chordCrossings`
 * from 147 to 96, a 35% fall, winning five graphs, losing one and drawing
 * three, and 96 against dagre's 109 is a placement this package does not
 * currently ship. That is spread across the corpus rather than resting on one
 * graph.
 *
 * ITS EDGE-LENGTH RESULT IS NOT ROBUST AND IS QUOTED AS A MEDIAN AND A SPREAD
 * BECAUSE OF IT. The corpus total is 0.99x, five wins to four, and the M2.9
 * algorithms review showed that total is two graphs cancelling: `module-imports`
 * at +11,880 against `etl-fanout` at -8,592, on a corpus delta of -1,190. Drop
 * either graph and it reads 1.05x or 0.90x. The median per-graph ratio is 0.98
 * and the range is 0.41 to 1.55. So what survives is "not 2.7x, and level on
 * this corpus", and "0.99x" on its own would be a number one graph from
 * reversing.
 *
 * A MECHANISM IS OFFERED AS A HYPOTHESIS AND ITS COUNTEREXAMPLE IS NAMED.
 * `position.ts` blames a compaction that only ever takes maxima and never pulls
 * a block back left, which costs width, and the natural extension is that a
 * generated layered graph has more long-edge chain per node for that to
 * propagate through. This corpus does not confirm the extension: `service-mesh`
 * has 1.07 bends per node and the WORST ratio at 1.55x, while `module-imports`
 * has 8.40 and comes in at 1.37x. Chain density does not order these nine
 * graphs, so the width mechanism is `position.ts`'s and established, and the
 * generated-versus-authored explanation on top of it is a guess.
 *
 * That is a real trade and it is not this file's job to make the call. What
 * this column does is stop the call from being made on generated graphs alone.
 * It carries NO cross-engine ceilings, because holding a stage no caller gets
 * to a parity gate would turn a comparison into a promise; it is pinned exactly
 * in the golden file like everything else, so it cannot move unnoticed.
 *
 * ## Regenerating
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.dagre-parity
 *
 * LEGITIMATE when this package deliberately changed what it draws, or when the
 * pinned dagre version was deliberately bumped, and in either case only when
 * you can say which column moved and why. The dagre version is asserted
 * separately for exactly this reason: the devDependency is pinned exactly, so a
 * bump is a line in a diff, and the pair of a pinned dependency and a committed
 * fixture is what tells a later reader whether a moved number is this package's
 * or dagre's. CHEATING when a number moved and you do not know why. Rerunning
 * the generator turns the test green and destroys the record of what the two
 * engines used to do, which is the only information that could say whether the
 * move was a bug.
 */

/** A node as drawn: a centre and a box, which is what both engines emit. */
interface DrawnNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An edge as drawn: the ids it joins and the polyline between them. */
interface DrawnEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly points: readonly Point[];
}

/** One engine's answer for one graph, reduced to what both engines emit. */
interface Drawing {
  readonly nodes: readonly DrawnNode[];
  readonly edges: readonly DrawnEdge[];
}

/** What one column of the table records. */
interface Metrics {
  readonly layers: number;
  readonly widestLayer: number;
  readonly segments: number;
  readonly crossings: number;
  readonly chordCrossings: number;
  readonly edgeLength: number;
  readonly bends: number;
  readonly width: number;
  readonly height: number;
  readonly nodeOverlaps: number;
  readonly nonFinitePoints: number;
  readonly attachmentsOnBorder: number;
  readonly attachmentsInsideBox: number;
  readonly attachmentsOutsideBox: number;
  readonly selfLoopEnds: number;
  readonly cappedAttachments: number;
}

/** One graph's row: what it is, and what each engine drew. */
interface ParityEntry {
  readonly name: string;
  readonly shapedAfter: string;
  readonly built: {
    readonly nodes: number;
    readonly edges: number;
    readonly selfLoops: number;
    readonly parallelEdges: number;
    readonly components: number;
  };
  readonly dagrDefault: Metrics;
  readonly dagrBrandesKoepf: Metrics;
  readonly dagre: Metrics;
  /**
   * Route ends the router's SECOND cap moves, under the default stages. Not
   * part of {@link Metrics} because dagre has no counterpart to it: it is a
   * property of this package's router measured against this package's own
   * rejected first draft, and a column of zeroes under `dagre` would read as a
   * comparison rather than as an absence.
   *
   * `'refused'` rather than a number when the runner rejected the single-cap
   * router's output outright, which is the harder witness and is not a failure
   * of this file. The reference router is KNOWN BROKEN, that is the whole point
   * of it, so running it through a runner that checks stage contracts can end
   * in a `StageContractError` for a reason that is correct. Recording which of
   * the two happened keeps a position-stage change from crashing this suite
   * instead of producing a diff someone can read.
   */
  readonly endsMovedBySecondCap: number | 'refused';
}

interface GoldenFile {
  readonly regenerate: string;
  readonly regenerateWhen: string;
  readonly dagreVersion: string;
  readonly config: { readonly nodeSep: number; readonly rankSep: number; readonly edgeSep: number };
  readonly entries: readonly ParityEntry[];
}

const goldenPath = new URL('./dagre-parity.golden.json', import.meta.url);

/**
 * The configuration both engines are given, written out rather than defaulted.
 *
 * Every number here is named on both sides of the comparison, because a
 * default that moved on one side and not the other would leave the table
 * comparing two engines drawing at different separations and say nothing about
 * it. A test below holds these to being this package's own defaults, so the
 * column really is what a caller gets out of the box.
 */
const PARITY_CONFIG = { nodeSep: 50, rankSep: 50, edgeSep: 10 } as const;

/**
 * The tolerance a coordinate is compared at, and it is absolute rather than
 * relative on purpose. Coordinates here run to a few thousand, an ulp at that
 * magnitude is about 5e-13, and every question this file asks of a coordinate
 * (is this point on that border, do these two boxes overlap, are these two
 * nodes in the same layer) is a question about a gap that is either zero or
 * tens of units. There is no scale in between for the epsilon to matter at.
 */
const EPSILON = 1e-6;

/**
 * The cross-engine ceilings, in one place because they are the promises this
 * file makes and a promise buried in an assertion is a promise nobody reads.
 *
 * They apply to the shipping default column alone. Every one is one-sided:
 * nothing here fails because this package drew a better picture than dagre.
 * The measured values they bound are in this file's docblock, so the margin
 * between promise and practice is legible without running anything.
 */
const CEILINGS = {
  /**
   * Chord crossings over the corpus, and it is the loosest bound here because
   * it is the one metric dagre wins. Measured 1.35. See the header: the gap is
   * the position placeholder, and the same corpus shows it closing to 0.88 with
   * `brandesKoepfPositionStage` instead. A ceiling under the measured value
   * would be a failing gate rather than a promise, and one at 2x would not
   * notice the placeholder getting worse.
   */
  chordCrossingsTotalRatio: 1.5,
  /** Edge length over the corpus. Measured 1.00, so this is a real bound. */
  edgeLengthTotalRatio: 1.25,
  /**
   * Per graph, looser than the total because one graph is allowed to be bad in
   * a way the corpus is not. The tightest row is `build-pipeline` at 2.09.
   */
  chordCrossingsRatio: 2.5,
  /**
   * Additive, and it exists for exactly one row: `scattered-suite`, where dagre
   * finds no chord crossings and this package finds one. No multiple of zero
   * bounds that, and a single crossing on a five-component graph is not
   * something to fail a gate over. It is 1 rather than a round number so that a
   * SECOND such crossing fails, which is what keeps it from being headroom. It
   * was 5 until the M2.9 algorithms review pointed out that nothing needed it.
   */
  chordCrossingsSlack: 1,
  edgeLengthRatio: 2,
  extentRatio: 1.25,
  /** Segments in one drawing, which is the quadratic counter's size budget. */
  segments: 4_000,
} as const;

/**
 * The one cross-engine bound this corpus does not meet, named with its reason,
 * which is `bench/README.md`'s rule for an exemption applied to a gate that is
 * not the bench gate.
 *
 * `scattered-suite` is 2.49x dagre's total polyline length and the per-graph
 * ceiling is 2x. THE FIRST DRAFT OF THIS FILE EXCLUDED THE WHOLE ROW from every
 * cross-engine bound on the grounds that dagre emits a non-finite point on it,
 * and the M2.9 algorithms review measured what that was actually worth: dagre's
 * one missing point is a single segment of length 73 on `e5`, so repairing it
 * moves dagre's total from 2,274.05 to 2,347.05 and the ratio from 2.49x to
 * 2.41x. Incompleteness explains 0.08 of a 1.49 breach. The exclusion was
 * keeping the suite green over a gap that is real, which is the difference
 * between an exemption and a loophole, so the row is back inside every other
 * bound and this is the one thing it is let off.
 *
 * THE CAUSE IS THE POSITION PLACEHOLDER AND IT IS NOT SUBTLE.
 * `gridPositionStage` centres every row on `x = 0`, so five disconnected
 * components are laid one on top of another and every edge crosses the width of
 * the drawing to reach its own component. `brandesKoepfPositionStage` draws the
 * same graph at 1.02x dagre. This is a known gap with a named cause and a known
 * fix, which is what an exemption has to be.
 */
const EXEMPT_EDGE_LENGTH = 'scattered-suite';

/** Rounded so a last-bit disagreement between engines is not a golden diff. */
function round(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

/**
 * M2.8's router with its SECOND cap removed, which is what M2.8's first draft
 * was and what its algorithms review rejected.
 *
 * Kept here for the reason `centreToCentreRouteStage` in `layout.route.test.ts`
 * is kept there: the package does not ship the thing being compared against, so
 * the comparison has to be written out or it is not a measurement. What it
 * buys is the difference between "a cap binds somewhere in this corpus", which
 * `cappedAttachments` says and which cap ONE satisfies on its own, and "the cap
 * the M2.8 review's bug was in binds somewhere in this corpus", which is a
 * strictly stronger and much easier claim to believe without checking.
 *
 * It was worth writing. The first eight graphs of this corpus moved NOT ONE END
 * between the two routers, so the corpus reached the regime where a cap binds
 * without reaching the regime where the reviewed bug lived, and every varied
 * box size in it would have been evidence for a branch it never took.
 * `canvas-composite` is in the corpus because of that measurement and it moves
 * three ends. See `endsMovedBySecondCap`.
 *
 * Everything else is `polylineRouteStage` copied: the source attachment, the
 * dummies unchanged, the target attachment. Only `Math.min`'s last argument is
 * gone.
 */
const singleCapRouteStage: RouteStage = {
  name: 'single-cap-route',
  run(input) {
    const point = (id: NodeId): Point => {
      const value = input.positions.get(id);
      if (value === undefined) throw new Error(`unpositioned ${id}`);
      return value;
    };
    const size = (id: NodeId): Size => {
      const value = input.sizes.get(id);
      if (value === undefined) throw new Error(`unsized ${id}`);
      return value;
    };
    const attach = (centre: Point, box: Size, toward: Point): Point => {
      const dx = toward.x - centre.x;
      const dy = toward.y - centre.y;
      if (dx * dx + dy * dy === 0) return { x: centre.x, y: centre.y };
      const toSide = dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
      const toEdge = dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
      const along = Math.min(toSide, toEdge, 0.5);
      return { x: centre.x + along * dx, y: centre.y + along * dy };
    };
    const routes = new Map<EdgeId, readonly Point[]>();
    for (const edge of input.graph.edges()) {
      const from = point(edge.source);
      const to = point(edge.target);
      const bends = (input.virtualChains.get(edge.id) ?? []).map(point);
      routes.set(edge.id, [
        attach(from, size(edge.source), bends[0] ?? to),
        ...bends,
        attach(to, size(edge.target), bends[bends.length - 1] ?? from),
      ]);
    }
    return { routes };
  },
};

/**
 * Route ENDS the second cap moves under the default stages, which is the softer
 * of the two witnesses and the one the shipping pipeline reaches.
 *
 * A count of ends rather than a share of runs. A large population of random
 * graphs is not coverage of a rare branch, and this file's whole argument is
 * that a corpus is worth what it varies rather than what it totals. Three ends
 * on one named graph, reproducible, is the evidence; nine graphs that between
 * them moved nothing was the state this measurement found and corrected.
 */
function endsMovedBySecondCap(
  entry: ParityGraph,
  graph: Graph,
  shipping: Drawing,
): number | 'refused' {
  let singleCap: Drawing;
  try {
    singleCap = drawWithDagr(entry, graph, { route: singleCapRouteStage });
  } catch (error) {
    // Narrow for the reason at `graphsTheSingleCapRouterCannotDraw`: 'refused'
    // is a claim about the endpoint-proximity rule and not about any throw.
    if (!(error instanceof StageContractError)) throw error;
    return 'refused';
  }
  const others = new Map(singleCap.edges.map((edge) => [edge.id, edge]));
  let moved = 0;
  for (const edge of shipping.edges) {
    const other = others.get(edge.id);
    if (other === undefined) continue;
    const pairs: readonly (readonly [Point | undefined, Point | undefined])[] = [
      [edge.points[0], other.points[0]],
      [edge.points[edge.points.length - 1], other.points[other.points.length - 1]],
    ];
    for (const [a, b] of pairs) {
      if (a === undefined || b === undefined) continue;
      if (Math.abs(a.x - b.x) > EPSILON || Math.abs(a.y - b.y) > EPSILON) moved += 1;
    }
  }
  return moved;
}

/**
 * Which corpus graphs the single-cap router cannot draw at all, which is the
 * harder witness and the one that does not depend on a tolerance.
 *
 * A `StageContractError` rather than a difference in a coordinate. The runner's
 * endpoint-proximity rule compares a route's end against the node at the far
 * end of the edge, cap one bounds the distance to the nearest DUMMY instead,
 * and where those two come apart the rule fails and `layout()` refuses the
 * stage's output. So "does this corpus reach the branch M2.8's review found the
 * bug in" gets a yes or no answer with a graph's name attached.
 */
function graphsTheSingleCapRouterCannotDraw(stages: LayoutStageOverrides): readonly string[] {
  const failed: string[] = [];
  for (const entry of parityCorpus) {
    const graph = buildParityGraph(entry);
    try {
      layout(
        { graph, config: { ...PARITY_CONFIG, nodeSize: parityNodeSizes(entry) } },
        { ...stages, route: singleCapRouteStage },
      );
    } catch (error) {
      // NOT a bare catch, and the M2.9 algorithms review is why. A catch-all
      // here proves "layout() failed" and this test claims something much
      // narrower: that the runner's ENDPOINT-PROXIMITY rule failed, on a named
      // edge, because one cap was missing. Any other throw, an
      // `InternalLayoutError` from a later refactor or a corpus edit that broke
      // this graph some other way, would keep the test green while the cap it
      // exists to cover went untested. That is precisely the failure mode this
      // witness was added to prevent, so it is rethrown.
      if (!(error instanceof StageContractError)) throw error;
      failed.push(`${entry.name} (${error.id})`);
    }
  }
  return failed;
}

/** This package's answer, at the parity config, with an optional stage swap. */
function drawWithDagr(entry: ParityGraph, graph: Graph, stages?: LayoutStageOverrides): Drawing {
  const config = { ...PARITY_CONFIG, nodeSize: parityNodeSizes(entry) };
  const result = layout({ graph, config }, stages);
  return {
    nodes: [...result.nodes.values()].map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
    edges: [...result.edges.values()].map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      points: edge.points,
    })),
  };
}

/**
 * dagre's answer for the same graph, at the same separations and the same box
 * sizes, read back through its public output alone.
 *
 * The edges come from THIS package's graph rather than from the corpus entry's
 * pair list, which is what makes a parallel edge comparable: `Graph.addEdge`
 * mints `e1`, `e2`, ... in author order and those ids are handed to dagre as
 * multigraph edge names, so the two engines hold the same edge under the same
 * key and the table compares edge for edge rather than pair for pair.
 *
 * `marginx` and `marginy` are pinned to zero because this package has no margin
 * and adds none. Left at dagre's defaults the two drawings would differ by a
 * translation, which no metric here reads, but the hull would differ by a
 * constant, which two of them do.
 *
 * Nothing below reads a dagre internal. `rank` and `order` survive `layout` on
 * a node label and would make the layer metric a one-liner, and using them
 * would make this file's numbers incomparable with its own: the layer count on
 * this side would come from dagre's ranker and on the other from a geometric
 * grouping, and the table would be quietly comparing two different questions.
 * Everything is derived from `x`, `y`, `width`, `height` and `points` on both
 * sides, by the same code.
 */
function drawWithDagre(entry: ParityGraph, graph: Graph): Drawing {
  const g = new dagre.graphlib.Graph({ multigraph: true, directed: true });
  g.setGraph({
    nodesep: PARITY_CONFIG.nodeSep,
    ranksep: PARITY_CONFIG.rankSep,
    edgesep: PARITY_CONFIG.edgeSep,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, kind] of entry.nodes) {
    g.setNode(id, { width: SIZE_KINDS[kind].width, height: SIZE_KINDS[kind].height });
  }
  for (const edge of graph.edges()) g.setEdge(edge.source, edge.target, {}, edge.id);
  dagre.layout(g);

  const nodes = entry.nodes.map(([id]): DrawnNode => {
    const label = g.node(id) as { x: number; y: number; width: number; height: number } | undefined;
    if (label === undefined) throw new Error(`dagre dropped node "${id}"`);
    return { id, x: label.x, y: label.y, width: label.width, height: label.height };
  });
  const edges = graph.edges().map((edge): DrawnEdge => {
    const label = g.edge(edge.source, edge.target, edge.id) as { points?: Point[] } | undefined;
    if (label?.points === undefined) throw new Error(`dagre dropped edge "${edge.id}"`);
    return { id: edge.id, source: edge.source, target: edge.target, points: label.points };
  });
  return { nodes, edges };
}

/** Whether a point is a pair of real numbers, which one engine's are not. */
function isDrawable(point: Point | undefined): point is Point {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * The same drawing with every undrawable route point removed, and how many were
 * removed.
 *
 * dagre emits a non-finite `y` on a route end at a box of zero WIDTH, at 3.1.1,
 * which `scattered-suite` has and which is legal input this package draws. A
 * non-finite coordinate then poisons every metric silently rather than loudly:
 * it compares false against everything, so a crossing test says no crossing, a
 * hull says nothing, and a sum says `NaN`, which the golden file would record
 * as `null` and a reader would take for a missing measurement rather than for a
 * drawing that cannot be drawn. Splitting it out makes the fact a COUNT, which
 * is a number in the table beside the others, and leaves the remaining metrics
 * measuring the part of the drawing that exists.
 */
function drawable(drawing: Drawing): { readonly clean: Drawing; readonly dropped: number } {
  let dropped = 0;
  const edges = drawing.edges.map((edge) => {
    const points = edge.points.filter((point) => {
      if (isDrawable(point)) return true;
      dropped += 1;
      return false;
    });
    return { ...edge, points };
  });
  return { clean: { nodes: drawing.nodes, edges }, dropped };
}

/**
 * The layers of a drawing, as a geometric grouping rather than as either
 * engine's rank.
 *
 * Both engines give every node of a layer one shared centre `y`: this package
 * does it in `rowCentres`, which both position stages share, and dagre does it
 * by centring each node in its rank's band. So distinct `y` among the graph's
 * OWN nodes is the layer count, computed identically on both sides and reading
 * nothing either engine keeps to itself.
 *
 * The one input that would break the equivalence is a drawing where two ranks
 * land on the same `y`, which needs a rank of zero height and a `rankSep` of
 * zero. Neither is reachable at this file's config, and a test below holds the
 * config to the defaults that make it so.
 */
function layersOf(drawing: Drawing): { readonly layers: number; readonly widestLayer: number } {
  const counts = new Map<number, number>();
  for (const node of drawing.nodes) {
    const key = round(node.y);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { layers: counts.size, widestLayer: Math.max(0, ...counts.values()) };
}

/** The sign of the cross product, which is what every predicate below asks for. */
function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Whether two segments cross at a point interior to both, which is the whole
 * definition of a crossing in this file.
 *
 * STRICT on both sides, and that is the decision the parity table rests on.
 * Two segments that merely touch at an endpoint do not cross, which is what
 * makes two edges meeting at a shared node contribute nothing: both attach on
 * the same box border and, where they attach at the same point, that point is
 * an endpoint of both. Two collinear overlapping segments do not cross either,
 * which is what makes a pair of parallel edges worth zero: neither engine fans
 * a bundle out yet, so their polylines coincide exactly, and counting a
 * coincidence as a crossing would score a drawing nobody can see the crossings
 * in.
 */
function crosses(p: readonly Point[], q: readonly Point[], i: number, j: number): boolean {
  const a = p[i];
  const b = p[i + 1];
  const c = q[j];
  const d = q[j + 1];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return false;
  const d1 = orientation(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orientation(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orientation(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orientation(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Crossings between the polylines of distinct edges, counted pairwise.
 *
 * THE POPULATION IS THE EMITTED POLYLINES AND NOTHING ELSE, which is the one
 * thing about this number that has to be read before it is compared. This
 * package's own crossing counter, `countCrossings` in `order.ts`, counts
 * inversions between adjacent layers over the drawing's 214,222 segments on
 * the 10k bench corpus, and dagre's internal counter counts over its own
 * dummy-and-border segment population. Those two are different measurements of
 * different things and neither is comparable to the other, so neither is used
 * here. What is counted instead is what a reader of the drawing would count:
 * two ink strokes that cross. That is defined without reference to a rank, a
 * dummy or a layer, so it means the same on both sides, and it is the reason
 * this corpus is small: it is quadratic in segments.
 */
function crossingsAmong(polylines: readonly (readonly Point[])[]): number {
  let count = 0;
  for (let e = 0; e < polylines.length; e += 1) {
    const left = polylines[e];
    if (left === undefined) continue;
    for (let f = e + 1; f < polylines.length; f += 1) {
      const right = polylines[f];
      if (right === undefined) continue;
      for (let i = 0; i + 1 < left.length; i += 1) {
        for (let j = 0; j + 1 < right.length; j += 1) {
          if (crosses(left, right, i, j)) count += 1;
        }
      }
    }
  }
  return count;
}

/**
 * An edge reduced to the straight line between its two endpoint node CENTRES,
 * which is the control the drawn crossing count needs.
 *
 * THE TWO ENGINES DO NOT BEND THEIR ROUTES THE SAME WAY, and that alone moves a
 * geometric crossing count without either engine having laid the graph out
 * differently. dagre halves its `ranksep` and doubles every edge's `minlen` to
 * leave room for an edge label, so every edge gets an intermediate point in
 * each rank gap it crosses and even an adjacent-rank edge comes back with a
 * bend in it. This package emits a point per dummy and nothing else, so an
 * adjacent-rank edge is two points. Across this corpus dagre's polylines carry
 * about twice the segments and between two and three times the bends. An
 * elbowed polyline and a straight one between the same two boxes sweep
 * different ink and cross different things.
 *
 * So `crossings` and `chordCrossings` answer two different questions, and the
 * pair is more use than either. `crossings` is what a reader of the drawing
 * sees, bends and all, and is the number a renderer's ink is judged by.
 * `chordCrossings` throws the whole route away and counts crossings between the
 * straight lines joining the endpoint node CENTRES, so it is a function of the
 * node positions and the topology alone and of nothing either router did. A gap
 * between the two engines in `crossings` but not in `chordCrossings` is a
 * difference in how routes bend. A gap in `chordCrossings` is a difference in
 * ordering and placement.
 *
 * CENTRES RATHER THAN THE ROUTE'S OWN ENDS, and the first draft of this file
 * used the ends and was wrong. An emitted end is routing output: this package
 * aims it at the first dummy and caps how far it travels, dagre aims it at the
 * label dummy half a rank away, and the two land in different places on the
 * same box. The M2.9 algorithms review measured what that was worth and it was
 * 38 crossings, which is more than the difference the metric existed to report.
 * A chord built from ends is therefore neutral about BENDS and not about
 * ATTACHMENT, which is most of the way to neutral and not the same thing. The
 * numbers moved materially when this was fixed: see the header.
 */
function chordOf(drawing: Drawing, edge: DrawnEdge): readonly Point[] {
  const from = drawing.nodes.find((node) => node.id === edge.source);
  const to = drawing.nodes.find((node) => node.id === edge.target);
  if (from === undefined || to === undefined) return [];
  return [
    { x: from.x, y: from.y },
    { x: to.x, y: to.y },
  ];
}

/** Total ink: the summed length of every polyline in the drawing. */
function edgeLengthOf(drawing: Drawing): number {
  let total = 0;
  for (const edge of drawing.edges) {
    for (let i = 0; i + 1 < edge.points.length; i += 1) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      if (a === undefined || b === undefined) continue;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return total;
}

/**
 * The hull of every node box and every route point, which is this package's
 * `bounds` and is computed here for dagre by the same code.
 *
 * dagre reports a `width` and `height` on its graph label, and they are not
 * this: they are the hull of the node boxes alone, so a route that leaves the
 * boxes (dagre sends a reversed edge well outside them, and this corpus has
 * reversed edges) is not in them. Recomputing both sides here is what makes the
 * two comparable.
 */
function extentOf(drawing: Drawing): { readonly width: number; readonly height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const node of drawing.nodes) {
    see(node.x - node.width / 2, node.y - node.height / 2);
    see(node.x + node.width / 2, node.y + node.height / 2);
  }
  for (const edge of drawing.edges) for (const point of edge.points) see(point.x, point.y);
  if (!Number.isFinite(minX)) return { width: 0, height: 0 };
  return { width: maxX - minX, height: maxY - minY };
}

/** Pairs of the graph's own boxes that overlap with positive area. */
function nodeOverlapsOf(drawing: Drawing): number {
  let count = 0;
  for (let i = 0; i < drawing.nodes.length; i += 1) {
    const a = drawing.nodes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < drawing.nodes.length; j += 1) {
      const b = drawing.nodes[j];
      if (b === undefined) continue;
      const dx = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
      const dy = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
      if (dx > EPSILON && dy > EPSILON) count += 1;
    }
  }
  return count;
}

/**
 * Where every route END landed relative to the box it belongs to, which is the
 * metric only a corpus of varied box sizes can move.
 *
 * M2.8 attaches a route at its endpoint box's border and caps how far the
 * attachment may travel, twice: half of the current segment, and half the way
 * to the edge's other endpoint. When a cap binds the end stops short and lands
 * strictly INSIDE the box instead of on its border, and the second of those two
 * caps was missing from M2.8's first draft, threw a `StageContractError` on
 * four nodes with one box 2,000 wide, and was invisible to every corpus in this
 * package because all of them are drawn at one uniform 100 by 40 box.
 *
 * So this is counted rather than assumed, on both engines. A count of zero
 * across the whole corpus would mean the corpus had drifted back to boxes small
 * enough that no cap can bind, which is the failure M2.8's lesson names, and a
 * test below fails on exactly that.
 */
function attachmentsOf(drawing: Drawing): {
  readonly onBorder: number;
  readonly inside: number;
  readonly outside: number;
  readonly selfLoopEnds: number;
  readonly capped: number;
} {
  const boxes = new Map(drawing.nodes.map((node) => [node.id, node]));
  let onBorder = 0;
  let inside = 0;
  let outside = 0;
  let selfLoopEnds = 0;
  let capped = 0;
  for (const edge of drawing.edges) {
    const loop = edge.source === edge.target;
    const ends: readonly (readonly [string, Point | undefined])[] = [
      [edge.source, edge.points[0]],
      [edge.target, edge.points[edge.points.length - 1]],
    ];
    for (const [id, point] of ends) {
      const box = boxes.get(id);
      if (box === undefined || !isDrawable(point)) continue;
      if (loop) selfLoopEnds += 1;
      const dx = Math.abs(point.x - box.x) - box.width / 2;
      const dy = Math.abs(point.y - box.y) - box.height / 2;
      if (dx > EPSILON || dy > EPSILON) outside += 1;
      else if (Math.abs(dx) <= EPSILON || Math.abs(dy) <= EPSILON) onBorder += 1;
      else {
        inside += 1;
        // A self loop has no direction to attach along and stops at its own
        // centre by an early return in `attachment`, so its ends are inside
        // their box for a reason that is not a cap. Excluding them is what
        // makes this the witness the cap needs: for any other edge, an end
        // strictly inside its box is an end a cap held back, because reaching
        // the border is what the uncapped formula does.
        if (!loop) capped += 1;
      }
    }
  }
  return { onBorder, inside, outside, selfLoopEnds, capped };
}

/** Every metric of one drawing, in the order the golden file records them. */
function measure(drawing: Drawing): Metrics {
  const { clean, dropped } = drawable(drawing);
  const { layers, widestLayer } = layersOf(clean);
  const extent = extentOf(clean);
  const attachments = attachmentsOf(drawing);
  let segments = 0;
  let bends = 0;
  for (const edge of clean.edges) {
    segments += Math.max(0, edge.points.length - 1);
    bends += Math.max(0, edge.points.length - 2);
  }
  return {
    layers,
    widestLayer,
    segments,
    crossings: crossingsAmong(clean.edges.map((edge) => edge.points)),
    chordCrossings: crossingsAmong(clean.edges.map((edge) => chordOf(clean, edge))),
    edgeLength: round(edgeLengthOf(clean)),
    bends,
    width: round(extent.width),
    height: round(extent.height),
    nodeOverlaps: nodeOverlapsOf(clean),
    nonFinitePoints: dropped,
    attachmentsOnBorder: attachments.onBorder,
    attachmentsInsideBox: attachments.inside,
    attachmentsOutsideBox: attachments.outside,
    selfLoopEnds: attachments.selfLoopEnds,
    cappedAttachments: attachments.capped,
  };
}

/** The weakly connected components of a built graph, for the built record. */
function componentCount(graph: Graph): number {
  const seen = new Set<string>();
  let components = 0;
  for (const node of graph.nodes()) {
    if (seen.has(node.id)) continue;
    components += 1;
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) continue;
      for (const edge of graph.edges()) {
        const other =
          edge.source === id ? edge.target : edge.target === id ? edge.source : undefined;
        if (other !== undefined && !seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
  }
  return components;
}

/** The one stage swap the second column is, named once so it cannot drift. */
const brandesKoepf: LayoutStageOverrides = { position: brandesKoepfPositionStage };

/** One row of the table: the graph as built, and what each engine drew. */
function measureEntry(entry: ParityGraph): ParityEntry {
  const graph = buildParityGraph(entry);
  const pairs = new Set<string>();
  let parallelEdges = 0;
  let selfLoops = 0;
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) selfLoops += 1;
    const key = `${edge.source} ${edge.target}`;
    if (pairs.has(key)) parallelEdges += 1;
    else pairs.add(key);
  }
  return {
    name: entry.name,
    shapedAfter: entry.shapedAfter,
    built: {
      nodes: graph.nodes().length,
      edges: graph.edges().length,
      selfLoops,
      parallelEdges,
      components: componentCount(graph),
    },
    dagrDefault: measure(drawWithDagr(entry, graph)),
    dagrBrandesKoepf: measure(drawWithDagr(entry, graph, brandesKoepf)),
    dagre: measure(drawWithDagre(entry, graph)),
    endsMovedBySecondCap: endsMovedBySecondCap(entry, graph, drawWithDagr(entry, graph)),
  };
}

const updating = process.env['UPDATE_GOLDEN'] === '1';

describe('the dagre parity corpus', () => {
  const measured = parityCorpus.map(measureEntry);

  if (updating) {
    it('rewrites the golden file, because UPDATE_GOLDEN was set', () => {
      const file: GoldenFile = {
        regenerate: 'UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.dagre-parity',
        regenerateWhen:
          'Only for a deliberate change to what this package draws, or a deliberate ' +
          'bump of the pinned dagre version, and only when you can say which column ' +
          'moved and why. A number that changed without an intended cause is ' +
          'something to investigate, not a file to refresh.',
        dagreVersion: dagre.version,
        config: PARITY_CONFIG,
        entries: measured,
      };
      writeFileSync(goldenPath, `${JSON.stringify(file, undefined, 2)}\n`);
      expect(measured.length).toBe(parityCorpus.length);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile;

  it('draws exactly what the golden file records, on both engines', () => {
    expect(measured).toEqual(golden.entries);
  });

  it('was measured against the dagre version the golden file names', () => {
    expect(dagre.version).toBe(golden.dagreVersion);
  });

  it("gave both engines this package's own default separations", () => {
    expect(PARITY_CONFIG.nodeSep).toBe(DEFAULT_LAYOUT_CONFIG.nodeSep);
    expect(PARITY_CONFIG.rankSep).toBe(DEFAULT_LAYOUT_CONFIG.rankSep);
    expect(PARITY_CONFIG.edgeSep).toBe(DEFAULT_LAYOUT_CONFIG.edgeSep);
    expect(golden.config).toEqual(PARITY_CONFIG);
  });

  /**
   * Which graphs dagre could not draw completely, pinned as a list rather than
   * used to skip anything.
   *
   * The first draft of this file turned this into an exclusion from every
   * cross-engine bound, and the M2.9 algorithms review showed that was hiding a
   * real breach rather than avoiding a meaningless comparison: see
   * {@link EXEMPT_EDGE_LENGTH}. So nothing is skipped now, every ceiling runs
   * over all nine graphs, and what dagre could not draw is a fact recorded here
   * and asserted by name. A dagre release that broke a second graph fails this
   * and says which, instead of quietly widening a set that switches gates off.
   */
  it('names exactly the graphs dagre cannot draw completely', () => {
    const broken = golden.entries
      .filter((entry) => entry.dagre.nonFinitePoints > 0)
      .map((entry) => `${entry.name} (${String(entry.dagre.nonFinitePoints)})`);
    expect(broken).toEqual(['scattered-suite (1)']);
  });

  /**
   * The two absolute properties, which are not parity claims and are asserted
   * at zero rather than against dagre.
   *
   * Both of this package's columns, because a stage that is not the default is
   * still a stage this package ships the code for, and an overlap or a `NaN`
   * coordinate reaching a caller through it would be just as much a bug.
   */
  it('never overlaps two boxes and never emits a coordinate that is not a number', () => {
    for (const entry of golden.entries) {
      for (const column of [entry.dagrDefault, entry.dagrBrandesKoepf]) {
        expect({ graph: entry.name, overlaps: column.nodeOverlaps }).toEqual({
          graph: entry.name,
          overlaps: 0,
        });
        expect({ graph: entry.name, nonFinite: column.nonFinitePoints }).toEqual({
          graph: entry.name,
          nonFinite: 0,
        });
      }
    }
  });

  /**
   * The ranking is never DEEPER than dagre's.
   *
   * A one-sided claim about the pair of stages that decide a rank, the cycle
   * breaker and the ranker, and the one metric of the four where this package
   * currently wins outright rather than ties. Equal on seven graphs and 6
   * against 10 on `state-machine`, where dagre's greedy feedback arc set
   * stretches the acyclic view that M2.2c's least-squares order keeps short.
   * A breach means one of those two got worse on a real graph, and
   * `layout.cycles.quality.test.ts` is where to look: it pins reversals, depth
   * and total span, and its own docblock explains why depth is the number that
   * moves against the reversal count rather than with it.
   */
  it('never ranks a graph into more layers than dagre does', () => {
    for (const entry of golden.entries) {
      expect({ graph: entry.name, layers: entry.dagrDefault.layers }).toEqual({
        graph: entry.name,
        layers: Math.min(entry.dagrDefault.layers, entry.dagre.layers),
      });
    }
  });

  /**
   * The three ceilings that are genuinely relative to dagre, on the shipping
   * default column.
   *
   * Each is stated twice, once over the corpus total and once per graph, and
   * the two catch different failures. A total that holds while one graph blows
   * out is a regression averaged away by seven others; a per-graph bound that
   * holds everywhere while the total rises is a broad drift no single graph
   * owns. The per-graph bounds are looser than the totals for that reason.
   * {@link CEILINGS} is where each number is justified, including the one
   * additive term.
   *
   * Headroom as measured, so a later reader can see how much of these is promise
   * and how much is margin: `chordCrossings` 147 against a ceiling of 163,
   * which is the tight one and deliberately so, `edgeLength` 157,177 against
   * 195,979, the widest single graph 1.02x of its 1.25x and the tallest 1.06x.
   */
  it('stays inside the stated ceilings against dagre, over the corpus', () => {
    const total = (pick: (entry: ParityEntry) => number): number =>
      golden.entries.reduce((sum, entry) => sum + pick(entry), 0);
    expect(total((entry) => entry.dagrDefault.chordCrossings)).toBeLessThanOrEqual(
      CEILINGS.chordCrossingsTotalRatio * total((entry) => entry.dagre.chordCrossings),
    );
    expect(total((entry) => entry.dagrDefault.edgeLength)).toBeLessThanOrEqual(
      CEILINGS.edgeLengthTotalRatio * total((entry) => entry.dagre.edgeLength),
    );
  });

  it('stays inside the stated ceilings against dagre, on every single graph', () => {
    for (const entry of golden.entries) {
      const under = (mine: number, theirs: number, ratio: number, slack = 0): boolean =>
        mine <= ratio * theirs + slack;
      const exempt = entry.name === EXEMPT_EDGE_LENGTH;
      expect({
        graph: entry.name,
        chordCrossings: under(
          entry.dagrDefault.chordCrossings,
          entry.dagre.chordCrossings,
          CEILINGS.chordCrossingsRatio,
          CEILINGS.chordCrossingsSlack,
        ),
        edgeLength:
          exempt ||
          under(entry.dagrDefault.edgeLength, entry.dagre.edgeLength, CEILINGS.edgeLengthRatio),
        width: under(entry.dagrDefault.width, entry.dagre.width, CEILINGS.extentRatio),
        height: under(entry.dagrDefault.height, entry.dagre.height, CEILINGS.extentRatio),
      }).toEqual({
        graph: entry.name,
        chordCrossings: true,
        edgeLength: true,
        width: true,
        height: true,
      });
    }
  });

  /**
   * The exemption is still needed, which is what stops it outliving its cause.
   *
   * An exemption nobody rechecks is a permanent hole. This one is for a gap with
   * a named fix, so the day the position stage stops interleaving disconnected
   * components this test fails and says to delete the exemption rather than
   * leaving it to be found later.
   */
  it('still needs the one edge-length exemption it grants', () => {
    const exempt = golden.entries.find((entry) => entry.name === EXEMPT_EDGE_LENGTH);
    if (exempt === undefined) throw new Error(`no entry named "${EXEMPT_EDGE_LENGTH}"`);
    expect(exempt.dagrDefault.edgeLength).toBeGreaterThan(
      CEILINGS.edgeLengthRatio * exempt.dagre.edgeLength,
    );
  });

  /**
   * The corpus really does reach the regime M2.8's bug lived in.
   *
   * This is an assertion about the CORPUS and not about the code, and it is the
   * one test here that fails if a later change makes the graphs tamer. An
   * attachment cap binds only where a box is large against the gap it has to
   * cross, every other corpus in this package is drawn at one uniform 100 by 40
   * box where neither cap can ever bind, and that is precisely why four tables
   * over eight graphs agreed about a property while sitting outside the regime
   * where the code could fail. If this count falls to zero, the corpus has
   * drifted back into that regime and the cap is untested again, whatever the
   * numbers beside it say.
   *
   * Self-loop ends are excluded by `attachmentsOf`, because a loop stops at its
   * own centre by an early return rather than because a cap held it.
   */
  it('has a corpus where an attachment cap actually binds', () => {
    const capped = golden.entries.reduce(
      (sum, entry) => sum + entry.dagrDefault.cappedAttachments,
      0,
    );
    expect(capped).toBeGreaterThan(0);
  });

  /**
   * And where the SECOND cap binds, which is the strictly stronger claim and
   * the one the corpus did not satisfy until it was measured.
   *
   * Split from the test above rather than folded into it because the two fail
   * for different reasons and one of them nearly shipped unnoticed. The other
   * eight graphs here bind cap one eight times between them and bind cap two
   * zero times, so a single test on `cappedAttachments` would have been green
   * over a corpus that never took the branch M2.8's review found a real bug in.
   * That was found the only way it could be: by deleting the second cap's term
   * from `route.ts` and rerunning this file, which changed nothing at all.
   * `canvas-composite` exists because of that run.
   *
   * THE TWO POSITION STAGES REACH THE CAP TO DIFFERENT DEPTHS and both are
   * asserted, because the weaker one alone would understate the corpus and the
   * stronger one alone would attach the whole witness to a stage no caller
   * gets. Under the shipping default the cap binds on `canvas-composite` and
   * moves three route ends, and the drawing is still legal without it. Under
   * `brandesKoepfPositionStage` it binds harder: removing the term makes
   * `layout()` throw a `StageContractError` on edge `e17`, which is M2.8's bug
   * exactly, reproduced on a hand-authored graph rather than on a random sweep.
   *
   * Both assertions name the graph rather than counting a population, so a
   * corpus edit that moved the witness somewhere else fails here and says where
   * it went.
   */
  it('has a corpus that reaches the second cap, under both position stages', () => {
    const movedUnderDefault = golden.entries
      .filter((entry) => entry.endsMovedBySecondCap !== 0)
      .map((entry) => entry.name);
    expect(movedUnderDefault).toEqual(['canvas-composite']);
    expect(graphsTheSingleCapRouterCannotDraw(brandesKoepf)).toEqual([
      'canvas-composite (e17)',
    ]);
  });

  /**
   * The structures the corpus claims to carry are in the built graphs rather
   * than only in the docblock that lists them.
   *
   * Same argument as the last test and the same failure mode: a corpus is
   * evidence about a branch only while it still contains the input that reaches
   * the branch, and the way that stops being true is silently, in an edit that
   * looked like tidying. Long edges are checked through `bends`, since a bend
   * in this package's routes is a dummy and a dummy is a rank an edge skipped.
   */
  it('has a corpus that still varies what the pipeline branches on', () => {
    const has = (pick: (entry: ParityEntry) => boolean): boolean => golden.entries.some(pick);
    expect({
      selfLoops: has((entry) => entry.built.selfLoops > 0),
      parallelEdges: has((entry) => entry.built.parallelEdges > 0),
      disconnected: has((entry) => entry.built.components > 1),
      longEdges: has((entry) => entry.dagrDefault.bends > 0),
      noLongEdges: has((entry) => entry.dagrDefault.bends === 0),
      zeroSizeBoxes: parityCorpus.some((graph) =>
        graph.nodes.some(([, kind]) => SIZE_KINDS[kind].width === 0),
      ),
      hugeBoxes: parityCorpus.some((graph) =>
        graph.nodes.some(([, kind]) => SIZE_KINDS[kind].width > 10 * PARITY_CONFIG.nodeSep),
      ),
    }).toEqual({
      selfLoops: true,
      parallelEdges: true,
      disconnected: true,
      longEdges: true,
      noLongEdges: true,
      zeroSizeBoxes: true,
      hugeBoxes: true,
    });
  });

  /**
   * The crossing counter is quadratic in segments, so the corpus has a size
   * budget and it is asserted rather than remembered.
   *
   * At the ceiling below one drawing costs about thirty million orientation
   * tests, which is a fraction of a second, and the whole file measures
   * twenty-seven drawings, nine graphs by three columns. A graph added later
   * that pushed past it would not fail: it would make this suite slow enough
   * that someone eventually deletes a column.
   */
  it('keeps every drawing small enough for a quadratic crossing count', () => {
    for (const entry of golden.entries) {
      for (const column of [entry.dagrDefault, entry.dagrBrandesKoepf, entry.dagre]) {
        expect({ graph: entry.name, overBudget: column.segments > CEILINGS.segments }).toEqual({
          graph: entry.name,
          overBudget: false,
        });
      }
    }
  });
});
