import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  countCrossings,
  createLayout,
  defaultStages,
  layout,
  measureStability,
} from '../src/index.js';
import { applyOp, buildSessionGraph, planSession, sessionCorpus } from './sequence-corpus.js';
import type { Graph, Patch } from '@dagr/graph';
import type { LayoutResult, OrderStage, RankStage, StabilityReport } from '../src/index.js';
import type { SessionEntry, SessionStep } from './sequence-corpus.js';

/**
 * What a SESSION of edits costs, committed as a golden file.
 *
 * WHAT THIS IS FOR, and it is the question M3.6 could not answer and handed
 * here. Every other stability test in this package measures one patch. The warm
 * start's constraint is absolute, so a hint naming every node in a layer freezes
 * that layer, and a crossing that could be removed by swapping two retained
 * nodes stays there with nothing to give it back. Over one patch that cost
 * measured at most 1.59%, and three of six entries came out CHEAPER warm than
 * cold. Over a session of them it is a different question, and only a session
 * can ask it. This file asks it and commits the answer, so a later change that
 * starts bleeding quality away arrives as a diff rather than as a feeling.
 *
 * THE THREE CONFIGURATIONS ARE ONE ENGINE WITH ONE CHANNEL CUT, which is what
 * makes the columns comparable. `PreparedState.previous` is the only way a
 * previous run reaches a stage, and on `main` exactly two stages read it: the
 * rank stage hands `previous.reversedEdges` to the cycle breaker (M3.7a) and
 * the order stage holds to `previous.layers` (M3.6). So the columns are that
 * channel blanked for both, blanked for the ranker only, and left alone. Same
 * engine, same stages, same config, same epsilon, same planned session: the
 * only difference between two columns is what the stage was allowed to see.
 * Building the cold column out of bare `layout()` calls instead would have
 * changed the runner as well as the channel, and a test below holds the cold
 * column to agreeing with a bare `layout()` anyway.
 *
 * WHAT THE THIRD COLUMN MEANS TODAY, said plainly because it will move. "The
 * full incremental path" is whatever the pipeline reads a previous run for, and
 * that is two stages as this file is written. M3.7b's warm ranks, M3.8's stable
 * coordinates and M3.9's fast paths each add a reader, and each will move this
 * column and leave the other two exactly where they are. That is the shape of
 * the evidence this file exists to produce: the first two columns are controls,
 * and a milestone that improves the incremental path improves one column.
 *
 * THE PAIR IS THE POINT. Crossings and displacement are recorded side by side
 * for each column because they trade against each other and reading either
 * alone is how a stability win that quietly cost a large share of the
 * drawing's quality gets shipped. A single pass/fail bar per metric in two different
 * files, one of which gets relaxed when it fails, is what this replaces.
 *
 * HOW TO REGENERATE IT, one command from the repo root:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.sequence.golden
 *
 * WHEN REGENERATING IS LEGITIMATE, and it is the same rule
 * `layout.order.golden.test.ts` states: when you deliberately changed what the
 * pipeline does and can say what moved and why. A number that changed without
 * an intended cause is something to investigate, not a file to refresh, and
 * that goes for a number that IMPROVED too.
 *
 * WHY THE NUMBERS ARE ROUNDED. Crossings are counts and are exact. The
 * distances are rounded to two decimals, because `Math.hypot` is not required
 * to be correctly rounded and two engines may differ in the last bits of a
 * number whose whole part is in the hundreds. Two decimals is far below
 * anything a layout change moves and far above anything a rounding difference
 * does.
 */

/** One configuration's numbers over one session. */
interface SessionMetrics {
  /**
   * Crossings in the drawing the last step produced, over the SEGMENTS of the
   * drawing, which is the population the order stage optimises. The endpoint
   * rather than the journey: this is the quality a user is looking at when the
   * session stops.
   */
  readonly finalCrossings: number;

  /** Mean crossings across every drawing the session produced, the base included. */
  readonly meanCrossings: number;

  /** Mean over steps of the mean distance a shared node travelled. */
  readonly meanDisplacement: number;

  /** The furthest any one node travelled in any one step. */
  readonly maxDisplacement: number;

  /** Mean over steps of the share of shared nodes that moved at all. */
  readonly movedFraction: number;

  /** Mean over steps of the share of shared nodes that changed rank. */
  readonly rankChurn: number;

  /** Mean over steps of the share of rank-neighbour pairs that changed places. */
  readonly orderChurn: number;

  /** Mean over steps of the share of shared edges whose route changed. */
  readonly reroutedFraction: number;
}

/** The three columns, under the names the header argues for. */
interface SessionColumns {
  /** No stage sees a previous run. Every step is a cold layout. */
  readonly cold: SessionMetrics;
  /** The order stage holds to the previous layering; the ranker starts cold. */
  readonly warmOrder: SessionMetrics;
  /** Every stage that reads a previous run gets one. What ships. */
  readonly incremental: SessionMetrics;
}

/** One session of the corpus: how to rebuild it, and what it cost. */
interface GoldenEntry extends SessionEntry {
  /**
   * What the session came out as, so a generator or planner that drifted fails
   * here rather than being read as a quality regression three fields down.
   */
  readonly built: {
    readonly baseNodes: number;
    readonly baseEdges: number;
    readonly finalNodes: number;
    readonly finalEdges: number;
    /** Primitive edits across the whole session, batched into `steps` patches. */
    readonly ops: number;
  };
  readonly columns: SessionColumns;

  /**
   * What the engine was holding going into the session's first relayout and
   * going into its last, per column.
   *
   * Recorded because it is the one thing here that is about the engine rather
   * than about the drawing, and because it is where the churn session's
   * hysteresis is visible as a number: cold and warm-order end a balanced
   * session holding exactly what they started it holding, and the incremental
   * column ends holding one more reversed edge and the dummies that follow
   * from it. A dummy population that started drifting on a session that adds
   * nothing would move these and nothing else in the file.
   */
  readonly retained: { readonly [K in Column]: SessionBookends };
}

/** What one column retained at each end of its session. */
interface SessionBookends {
  /** Carried into the first relayout, so: what laying the base graph out left. */
  readonly first: RetainedSizes;
  /** Carried into the last relayout of the session. */
  readonly last: RetainedSizes;
}

interface GoldenFile {
  readonly regenerate: string;
  readonly regenerateWhen: string;
  readonly configurations: string;
  readonly entries: readonly GoldenEntry[];
}

const goldenPath = new URL('./sequence-stability.golden.json', import.meta.url);

/**
 * A stage handed the same input with the previous run cut out of it.
 *
 * The name is the inner stage's, unchanged, because the wrapper does not change
 * what the stage IS: the algorithm, its budgets and its output are the inner
 * stage's, and only what it is allowed to have seen differs. A stage that
 * renamed itself here would put a name nothing in the package defines into a
 * `StageContractError` raised by code that is not the wrapper's.
 */
function rankWithoutPrevious(inner: RankStage): RankStage {
  return { name: inner.name, run: (input) => inner.run({ ...input, previous: undefined }) };
}

/** The same cut, one stage down. See {@link rankWithoutPrevious}. */
function orderWithoutPrevious(inner: OrderStage): OrderStage {
  return { name: inner.name, run: (input) => inner.run({ ...input, previous: undefined }) };
}

/**
 * The order stage, counting the crossings of the layering it settled on.
 *
 * Counted HERE rather than from the finished `LayoutResult` because a result
 * carries coordinates and not layers, and reconstructing a layering from
 * coordinates would be a second implementation of the thing being measured. The
 * chains come from the input, which is where the rank stage put them: a count
 * that left them out would score the graph's own adjacent-layer edges in a
 * layering arranged for a population sixteen times larger, which is the mistake
 * `layout.order.golden.test.ts` records as having shipped for a milestone.
 */
function countingOrder(inner: OrderStage, into: number[]): OrderStage {
  return {
    name: inner.name,
    run: (input) => {
      const output = inner.run(input);
      into.push(
        countCrossings({
          graph: input.graph,
          layers: output.layers,
          virtualChains: input.virtualChains,
        }),
      );
      return output;
    },
  };
}

/**
 * The sizes of every map the engine carried into a run, recorded before the run
 * uses them.
 *
 * The rank stage is the first thing a run calls, so what it is handed IS what
 * the engine retained. There is no other way to see this from outside the
 * package and that is deliberate: `PreviousLayout` is a stage's input rather
 * than an engine's public field, so a test that wants it has to be a stage.
 */
interface RetainedSizes {
  readonly ranks: number;
  readonly reversedEdges: number;
  readonly virtualNodes: number;
  readonly virtualChains: number;
  readonly layers: number;
  readonly positions: number;
  readonly routes: number;
  readonly sizes: number;
}

/** Nothing retained yet, which is what the first run of a session is handed. */
const NOTHING_RETAINED: RetainedSizes = {
  ranks: 0,
  reversedEdges: 0,
  virtualNodes: 0,
  virtualChains: 0,
  layers: 0,
  positions: 0,
  routes: 0,
  sizes: 0,
};

/** The rank stage, recording what the engine handed it. See {@link RetainedSizes}. */
function recordingRank(inner: RankStage, into: RetainedSizes[]): RankStage {
  return {
    name: inner.name,
    run: (input) => {
      const previous = input.previous;
      into.push(
        previous === undefined
          ? NOTHING_RETAINED
          : {
              ranks: previous.ranks.size,
              reversedEdges: previous.reversedEdges.size,
              virtualNodes: previous.virtualNodes.size,
              virtualChains: previous.virtualChains.size,
              layers: previous.layers.length,
              positions: previous.positions.size,
              routes: previous.routes.size,
              sizes: previous.sizes.size,
            },
      );
      return inner.run(input);
    },
  };
}

/** Which of the two warm channels a column leaves open. */
type Column = keyof SessionColumns;

/** Everything one run of one session produced. */
interface SessionRun {
  readonly metrics: SessionMetrics;
  readonly retained: readonly RetainedSizes[];
  readonly result: LayoutResult;
  readonly graph: Graph;
}

/** The mean of a list, and zero for an empty one. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Two decimals, for the reason the header gives. Counts stay exact. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One session under one column.
 *
 * The graph is rebuilt here rather than shared, and the steps are replayed from
 * the plan the caller passed in, so the three columns edit three graphs through
 * one script. Each step is one `batch`, which is one patch, which is one
 * relayout: the M3.3 contract is what makes a step and a relayout the same
 * thing.
 */
function runSession(
  entry: SessionEntry,
  steps: readonly SessionStep[],
  column: Column,
): SessionRun {
  const graph = buildSessionGraph(entry);
  const patches: Patch[] = [];
  graph.subscribe((patch) => patches.push(patch));

  const crossings: number[] = [];
  const retained: RetainedSizes[] = [];
  const rank =
    column === 'incremental' ? defaultStages.rank : rankWithoutPrevious(defaultStages.rank);
  const order = column === 'cold' ? orderWithoutPrevious(defaultStages.order) : defaultStages.order;
  const engine = createLayout({
    stages: {
      rank: recordingRank(rank, retained),
      order: countingOrder(order, crossings),
    },
  });

  let previous = engine.run(graph);
  const reports: StabilityReport[] = [];
  for (const step of steps) {
    patches.length = 0;
    graph.batch(() => {
      for (const op of step) applyOp(graph, op);
    });
    const patch = patches.flat();
    const next = engine.relayout(patch).result;
    reports.push(measureStability(previous, next));
    previous = next;
  }

  return {
    metrics: {
      finalCrossings: crossings.at(-1) ?? 0,
      meanCrossings: round(mean(crossings)),
      meanDisplacement: round(mean(reports.map((report) => report.nodes.meanDisplacement))),
      maxDisplacement: round(Math.max(...reports.map((report) => report.nodes.maxDisplacement))),
      movedFraction: round(mean(reports.map((report) => report.nodes.movedFraction))),
      rankChurn: round(mean(reports.map((report) => report.nodes.rankChurn))),
      orderChurn: round(mean(reports.map((report) => report.nodes.orderChurn))),
      reroutedFraction: round(mean(reports.map((report) => report.edges.reroutedFraction))),
    },
    retained,
    result: previous,
    graph,
  };
}

/**
 * The two ends of what a column retained.
 *
 * Index 1 rather than 0: the base run is handed nothing at all, so the record
 * at index 0 is {@link NOTHING_RETAINED} for every session and says nothing
 * about any of them.
 */
function bookends(run: SessionRun): SessionBookends {
  const first = run.retained[1];
  const last = run.retained.at(-1);
  if (first === undefined || last === undefined) throw new Error('a session ran no relayout');
  return { first, last };
}

/** Everything the file records about one session, measured. */
function measure(entry: SessionEntry): { readonly golden: GoldenEntry; readonly runs: Runs } {
  const steps = planSession(entry);
  const base = buildSessionGraph(entry);
  const runs: Runs = {
    cold: runSession(entry, steps, 'cold'),
    warmOrder: runSession(entry, steps, 'warmOrder'),
    incremental: runSession(entry, steps, 'incremental'),
  };
  return {
    golden: {
      ...entry,
      built: {
        baseNodes: base.nodes().length,
        baseEdges: base.edges().length,
        finalNodes: runs.incremental.graph.nodes().length,
        finalEdges: runs.incremental.graph.edges().length,
        ops: steps.reduce((total, step) => total + step.length, 0),
      },
      columns: {
        cold: runs.cold.metrics,
        warmOrder: runs.warmOrder.metrics,
        incremental: runs.incremental.metrics,
      },
      retained: {
        cold: bookends(runs.cold),
        warmOrder: bookends(runs.warmOrder),
        incremental: bookends(runs.incremental),
      },
    },
    runs,
  };
}

/** The three runs of one session, kept so the tests below can ask more of them. */
type Runs = { readonly [K in Column]: SessionRun };

/**
 * What the engine had retained at the end of each balanced cycle of a churn
 * session.
 *
 * A cycle is two steps, an add and its undo, so the graph is the base graph
 * again after every odd step. The records are one per pipeline run with the
 * base run first, so the run that STARTS at index 2k + 3 is the first one whose
 * input is what cycle k left behind.
 */
function churnBoundaries(run: SessionRun): readonly RetainedSizes[] {
  const boundaries: RetainedSizes[] = [];
  for (let index = 3; index < run.retained.length; index += 2) {
    const record = run.retained[index];
    if (record !== undefined) boundaries.push(record);
  }
  return boundaries;
}

/** The three columns, in the order the file records them. */
const COLUMNS = ['cold', 'warmOrder', 'incremental'] as const;

const updating = process.env['UPDATE_GOLDEN'] === '1';

/**
 * Measured once for the whole file. Six sessions times three columns times
 * seventeen pipeline runs is the cost of this file, and measuring it per test
 * would multiply that by the number of tests.
 */
const measured = sessionCorpus.map(measure);

describe('the incremental pipeline, over a session of edits', () => {
  if (updating) {
    it('rewrites the golden file, because UPDATE_GOLDEN was set', () => {
      const file: GoldenFile = {
        regenerate: 'UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.sequence.golden',
        regenerateWhen:
          'Only for a deliberate change to what the pipeline does, and only when ' +
          'you can say what moved and why. A number that changed without an ' +
          'intended cause is something to investigate, not a file to refresh.',
        configurations:
          'One engine with one channel cut. cold: no stage is handed the previous ' +
          'run. warmOrder: the order stage holds to the previous layering and the ' +
          'rank stage starts cold. incremental: every stage that reads a previous ' +
          'run gets one, which on this commit is the cycle breaker inside the rank ' +
          'stage and the order stage.',
        entries: measured.map((entry) => entry.golden),
      };
      writeFileSync(goldenPath, `${JSON.stringify(file, undefined, 2)}\n`);
      expect(measured.length).toBe(sessionCorpus.length);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile;

  /**
   * One assertion over the whole file rather than one per session, so that a
   * change which moved every session reads as one diff of the corpus rather
   * than as six failures with the shared cause left to be inferred.
   */
  it('costs exactly what the golden file records', () => {
    expect(measured.map((entry) => entry.golden)).toEqual(golden.entries);
  });

  /**
   * The cold column really is cold, checked against the thing it claims to be
   * rather than against its own construction.
   *
   * A cut channel is a claim about a wrapper, and a wrapper that cut the wrong
   * field, or cut it after the stage had already read it, would leave the file
   * recording three warm columns and reporting the warm start as free. The
   * check is exact equality of every box with a bare `layout()` over the final
   * graph, which is what a caller holding no engine gets.
   */
  it('lays the cold column out exactly as a caller with no engine would', () => {
    for (const { golden: entry, runs } of measured) {
      const fresh = layout({ graph: runs.cold.graph });
      const boxes = (result: LayoutResult): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [id, node] of result.nodes) out[id] = `${String(node.x)},${String(node.y)}`;
        return out;
      };
      expect(boxes(runs.cold.result), entry.name).toEqual(boxes(fresh));
    }
  });

  /**
   * The warm columns are actually warm, which the equality above cannot say.
   *
   * If every column drew the same picture, the file would be three copies of
   * one number and would answer nothing. Each session is required to have at
   * least one column that differs from cold, so a change that quietly stopped
   * warm starting anything fails here instead of passing with a file full of
   * identical rows.
   *
   * `reparent-mid` is excused BY NAME rather than by a rule that would excuse
   * anything: no stage in this package reads a parent, so its three columns
   * agreeing is the correct answer and is asserted as one below.
   */
  it('draws a different picture warm than cold, on every session that can', () => {
    for (const entry of golden.entries) {
      if (entry.kind === 'reparent') continue;
      const { cold, warmOrder, incremental } = entry.columns;
      const differs =
        cold.meanCrossings !== warmOrder.meanCrossings ||
        cold.meanCrossings !== incremental.meanCrossings ||
        cold.meanDisplacement !== warmOrder.meanDisplacement ||
        cold.meanDisplacement !== incremental.meanDisplacement;
      expect(differs, entry.name).toBe(true);
    }
  });

  /**
   * A reparent moves nothing, in every column.
   *
   * This is the control of the corpus and the one entry whose expected answer
   * is a constant rather than a measurement: containment is a fact no stage in
   * this package reads, so a session made only of `setNodeParent` calls has to
   * produce the same drawing every step. It is worth a test rather than a
   * comment because it is exactly what M7 changes, and the day inline compound
   * layout lands this assertion is the one that says so.
   */
  it('moves nothing at all when only containment changes', () => {
    const entry = golden.entries.find((candidate) => candidate.kind === 'reparent');
    if (entry === undefined) throw new Error('the corpus lost its reparent session');
    for (const column of COLUMNS) {
      const metrics = entry.columns[column];
      expect(metrics.meanDisplacement, column).toBe(0);
      expect(metrics.movedFraction, column).toBe(0);
      expect(metrics.reroutedFraction, column).toBe(0);
    }
  });

  /**
   * A balanced add-and-remove cycle gives back every map it took.
   *
   * THE CHEAPEST PLACE TO CATCH THE M3.2 STATE LEAK, and the only one: a
   * retained map that grows by four entries per cycle and is never read again
   * is invisible to every metric in this file, produces a correct drawing every
   * step, and is a session that gets slower for as long as it runs.
   *
   * WHAT IS ASSERTED IS THE ROSTER AND NOT THE SIZE, and the difference is a
   * measurement rather than a preference. The first form of this test asked for
   * every boundary record to be identical, and the incremental column is not:
   * see the ratchet test below for what it does instead and why that is
   * correct. A leak, though, has a shape that survives the ratchet. Every
   * per-node map has to be exactly the drawing's roster, the caller's nodes
   * plus the dummies THIS run declared, and every per-edge map exactly the
   * graph's edges. An entry kept for a node that no longer exists breaks that
   * whatever the layering did, which is what makes this the assertion rather
   * than an equality that a legitimate change of drawing can break.
   *
   * Cycle one rather than the base run is where the boundaries start. The base
   * run is handed nothing at all, and the run after the first cycle is the
   * first one whose input is a full retained record of the base graph.
   */
  it('retains nothing for a node or an edge the graph no longer holds', () => {
    const entry = measured.find((candidate) => candidate.golden.kind === 'churn');
    if (entry === undefined) throw new Error('the corpus lost its churn session');
    const { baseNodes, baseEdges } = entry.golden.built;
    for (const column of COLUMNS) {
      for (const [cycle, boundary] of churnBoundaries(entry.runs[column]).entries()) {
        const where = `${column}, cycle ${String(cycle)}`;
        const roster = baseNodes + boundary.virtualNodes;
        expect(boundary.ranks, where).toBe(roster);
        expect(boundary.positions, where).toBe(roster);
        expect(boundary.sizes, where).toBe(roster);
        expect(boundary.routes, where).toBe(baseEdges);
      }
    }
  });

  /**
   * A balanced cycle settles, and the incremental column does not settle where
   * it started.
   *
   * THE FINDING THIS SESSION EXISTS TO HAVE MADE. Add four nodes, remove the
   * same four, and the graph is the base graph again, edge for edge. The cold
   * and warm-order columns redraw the base graph and retain exactly what they
   * retained seven cycles ago, every number identical. The incremental column
   * does not: at one cycle of the eight its held reversed set gains an edge and
   * keeps it, and the ranking that follows mints ten more dummies which it also
   * keeps, for the rest of the session.
   *
   * THAT IS THE RETENTION RULE WORKING RATHER THAN A LEAK. M3.7a holds a
   * previously reversed edge reversed while it stays a back edge, and a
   * transient cycle through a node that has since left is exactly the case
   * where holding and re-deciding disagree. The point of not re-deciding is
   * that a drawing does not flip when a graph changes, and the price is
   * hysteresis: an edit and its exact undo do not return the drawing to where
   * it started. Nobody had measured that price before this file, and the test
   * above says it costs no correctness.
   *
   * WHAT IS ASSERTED IS THAT IT SETTLES. A held set that gained an edge every
   * cycle would be a session that grows without bound, which is the leak in a
   * different disguise, and the two are told apart by counting DISTINCT
   * boundary records: a settled session has one or two and a ratcheting one has
   * as many as it has cycles.
   */
  it('settles a balanced churn session, in every column', () => {
    const entry = measured.find((candidate) => candidate.golden.kind === 'churn');
    if (entry === undefined) throw new Error('the corpus lost its churn session');
    for (const column of COLUMNS) {
      const boundaries = churnBoundaries(entry.runs[column]);
      expect(boundaries.length, column).toBeGreaterThan(2);
      const distinct = new Set(boundaries.map((boundary) => JSON.stringify(boundary)));
      expect(distinct.size, column).toBeLessThanOrEqual(2);
    }
  });

  /**
   * The corpus still holds all six shapes, checked against the file rather than
   * against the intent.
   *
   * A corpus that lost a kind would keep passing every assertion above while
   * measuring one less thing, which is the failure mode a golden file is worst
   * at showing: nothing in a diff of numbers says a row stopped being a row of
   * a different kind.
   */
  it('holds one session of every kind', () => {
    const kinds = golden.entries.map((entry) => entry.kind).sort();
    expect(kinds).toEqual(['churn', 'grow', 'pattern', 'prune', 'reparent', 'rewire']);
  });
});
