import { cpus, loadavg } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/pipeline.js';
import { defaultStages } from '../src/stages.js';
import type { GraphSpec } from '@dagr/bench';
import type {
  LayoutStageOverrides,
  OrderStage,
  PositionStage,
  RankStage,
  RouteStage,
} from '../src/types.js';

/**
 * What a layout run costs, in milliseconds, on a machine that is named.
 *
 * ## Why this exists, and why it is not the benchmark gate
 *
 * THE REPO ALREADY COMMITS LAYOUT BENCHMARK MEDIANS AND THEY ARE THE WRONG
 * NUMBER TO PUBLISH. `bench/baseline.json` holds four entries for this package
 * at 1k and 10k nodes, and every one of them is a RATIO of a median to a
 * control workload's median measured in the same worker. That normalisation is
 * exactly what makes the gate survive a busy machine, and exactly what makes
 * the entries meaningless to a reader: a ratio against a control says whether
 * this package got slower than it was, and says nothing at all about what a
 * layout will cost in a frame budget. `docs/docs/layout.md` has said so since
 * M2.3 and named this milestone as where the other number comes from.
 *
 * So this file measures wall clock, per stage, on the two committed bench
 * corpora, and writes it to `layout-cost.json` with the machine recorded beside
 * it. It is a MEASUREMENT and not a baseline. Nothing gates on it, no run fails
 * because a number moved, and `pnpm bench:ci` never reads it. The two artefacts
 * answer different questions and neither can be derived from the other.
 *
 * ## What it does not claim
 *
 * One machine, one Node version, one run. A reader on other hardware should
 * expect a different number and can get their own with the command below, which
 * is the whole reason the corpora are committed generators rather than a table
 * of results. Read the RATIOS between the stages as the durable part and the
 * absolute milliseconds as one machine's, which is the same reading
 * `position.ts` asks for of its own figures.
 *
 * The per-stage numbers exclude the runner's contract checks and the total
 * includes them, so the four stages do not sum to the total and the gap is what
 * checking costs. That gap is worth having rather than hiding: it is the price
 * of the guarantees in `pipeline.ts`, it is paid on every run, and a reader
 * sizing a budget is paying it too.
 *
 * The default stages are what is measured, which as of M2.8 means the position
 * phase is still `gridPositionStage`, a placeholder. Its line in the table is
 * therefore a floor rather than a cost, and the milestone that replaces it will
 * move that line and no other.
 *
 * ## Regenerating
 *
 *   MEASURE_COST=1 pnpm --filter @dagr/layout test layout.cost
 *
 * The ordinary run does NOT measure. It reads the committed file and checks
 * that it still describes this pipeline: same stage names, same corpora, same
 * shape. That is a real check with a real failure mode, a renamed or added
 * stage leaving the published table describing a pipeline nobody runs, and it
 * is the only kind of check available here. A timing cannot be asserted on a
 * shared machine without becoming either a flake or a no-op, which is the
 * argument `bench/README.md` makes at length about the gate.
 */

/** Milliseconds per stage, plus the whole run, all medians. */
interface CostRow {
  readonly nodes: number;
  readonly edges: number;
  /**
   * Points across every emitted route, which is the closest thing to the real
   * size of the work that a `LayoutResult` exposes. `LayoutResult.nodes` holds
   * only the caller's nodes, so it cannot show the dummy chains that dominate
   * the cost; this can, since a route carries one point per dummy. Two ends per
   * edge plus the dummies, so the 10k corpus's 254,222 is 80,000 ends and
   * 174,222 dummies, which is the figure M2.4b recorded.
   */
  readonly routePoints: number;
  readonly stages: Readonly<Record<string, number>>;
  /** The whole `layout()` call, contract checks included. */
  readonly total: number;
}

interface CostFile {
  readonly measure: string;
  readonly isNotABaseline: string;
  readonly machine: {
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly cores: number;
    readonly node: string;
    /**
     * The one-minute load average when the file was written, recorded because
     * an absolute timing taken on a loaded machine is not worth much and a
     * reader has no other way to tell. `bench/README.md` makes the same point
     * about the gate and answers it with a ratio; this file cannot, since a
     * ratio is the thing it exists not to publish, so it records the load and
     * lets the reader judge.
     */
    readonly loadAverage: number;
  };
  readonly runs: number;
  readonly stageNames: Readonly<Record<string, string>>;
  readonly corpora: Readonly<Record<string, CostRow>>;
}

const costPath = new URL('./layout-cost.json', import.meta.url);

/** A row that must be present, so a missing corpus blames the right line. */
function requireRow(file: CostFile, name: string): CostRow {
  const row = file.corpora[name];
  if (row === undefined) throw new Error(`no corpus named "${name}"`);
  return row;
}

/** What the runner's contract checks cost: the call, less the stages in it. */
function checkCost(row: CostRow): number {
  return row.total - Object.values(row.stages).reduce((sum, value) => sum + value, 0);
}

/**
 * A millisecond figure as the docs page prints it, and the only place that
 * formatting is decided.
 *
 * One decimal below 100ms and a rounded integer with a thousands separator at
 * or above it, which is about the precision a median of eleven runs on a shared
 * machine carries. Quoting more would be claiming resolution this does not
 * have; quoting less would round the position stage to nothing on the 1k.
 */
function render(value: number): string {
  if (value < 100) return `${value.toFixed(1)}ms`;
  return `${Math.round(value).toLocaleString('en-US')}ms`;
}

/**
 * Samples per measurement, and the median of them.
 *
 * A median rather than a mean, for the reason `bench/README.md` gives: one
 * garbage collection drags a mean a long way and barely moves a median. Eleven
 * is enough for a median to be stable at this cost per iteration and few enough
 * that the 10k corpus does not make regenerating the file a coffee break.
 */
const RUNS = 11;
const WARMUP = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle ?? 0;
}

/** A share as the prose writes it, so both published sites round identically. */
function percent(part: number, whole: number): string {
  return `${String(Math.round((part / whole) * 100))}%`;
}

/** Rounded to microseconds, which is well inside what this can resolve. */
function round(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/**
 * The default stages, each wrapped so its own `run` is timed.
 *
 * Wrapping and passing them back through `layout()` rather than driving the
 * stages by hand is what keeps this honest. The runner builds the state each
 * stage reads, and a hand-built state would be this file's idea of the pipeline
 * rather than the pipeline, which is how a published cost figure ends up
 * measuring something no caller runs.
 */
function timedStages(into: Record<string, number>): LayoutStageOverrides {
  const time = <T>(name: string, run: () => T): T => {
    const started = performance.now();
    const output = run();
    into[name] = (into[name] ?? 0) + (performance.now() - started);
    return output;
  };
  const rank: RankStage = {
    name: defaultStages.rank.name,
    run: (input) => time('rank', () => defaultStages.rank.run(input)),
  };
  const order: OrderStage = {
    name: defaultStages.order.name,
    run: (input) => time('order', () => defaultStages.order.run(input)),
  };
  const position: PositionStage = {
    name: defaultStages.position.name,
    run: (input) => time('position', () => defaultStages.position.run(input)),
  };
  const route: RouteStage = {
    name: defaultStages.route.name,
    run: (input) => time('route', () => defaultStages.route.run(input)),
  };
  return { rank, order, position, route };
}

function measureCorpus(spec: GraphSpec): CostRow {
  const graph = build(spec);
  const totals: number[] = [];
  const perStage: Record<string, number[]> = { rank: [], order: [], position: [], route: [] };
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    const into: Record<string, number> = {};
    const started = performance.now();
    layout({ graph }, timedStages(into));
    const elapsed = performance.now() - started;
    if (run < WARMUP) continue;
    totals.push(elapsed);
    for (const [name, samples] of Object.entries(perStage)) samples.push(into[name] ?? 0);
  }
  let routePoints = 0;
  for (const edge of layout({ graph }).edges.values()) routePoints += edge.points.length;
  const stages: Record<string, number> = {};
  for (const [name, samples] of Object.entries(perStage)) stages[name] = round(median(samples));
  return {
    nodes: spec.nodes.length,
    edges: spec.edges.length,
    routePoints,
    stages,
    total: round(median(totals)),
  };
}

const measuring = process.env['MEASURE_COST'] === '1';

describe('what a layout run costs', () => {
  const stageNames: Record<string, string> = {
    rank: defaultStages.rank.name,
    order: defaultStages.order.name,
    position: defaultStages.position.name,
    route: defaultStages.route.name,
  };

  if (measuring) {
    it('rewrites the cost file, because MEASURE_COST was set', () => {
      const cpu = cpus()[0];
      const file: CostFile = {
        measure: 'MEASURE_COST=1 pnpm --filter @dagr/layout test layout.cost',
        isNotABaseline:
          'Wall-clock milliseconds on one machine, published so a reader can size a ' +
          'budget. Nothing gates on it and pnpm bench:ci never reads it. The gate ' +
          'lives in bench/baseline.json and holds ratios, which are the right thing ' +
          'to catch a regression with and the wrong thing to publish as a cost.',
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpu: cpu?.model ?? 'unknown',
          cores: cpus().length,
          node: process.version,
          loadAverage: Math.round((loadavg()[0] ?? 0) * 100) / 100,
        },
        runs: RUNS,
        stageNames,
        corpora: {
          '1k nodes, 4k edges': measureCorpus(smallCorpus()),
          '10k nodes, 40k edges': measureCorpus(largeCorpus()),
        },
      };
      writeFileSync(costPath, `${JSON.stringify(file, undefined, 2)}\n`);
      expect(Object.keys(file.corpora)).toHaveLength(2);
      // Fourteen full pipeline runs on the 10k corpus is a minute of work, and
      // the default five-second budget is sized for a test rather than for a
      // measurement. It applies to the measuring path alone: the ordinary run
      // below reads a file.
    }, 600_000);
    return;
  }

  const committed = JSON.parse(readFileSync(costPath, 'utf8')) as CostFile;

  /**
   * The published table still describes THIS pipeline.
   *
   * The failure this catches is a published figure quietly becoming a figure
   * for a pipeline nobody runs. A stage swapped for a better one is the normal
   * event in this package, three of the four have been through it already, and
   * the swap that does not also refresh the docs leaves a milliseconds number
   * attributed to an algorithm that is gone. Names rather than timings, because
   * a name is the one part of this a test can assert without becoming a flake.
   */
  it('still names the stages the pipeline actually runs', () => {
    expect(committed.stageNames).toEqual(stageNames);
  });

  /**
   * And still describes the corpora it was measured on, at the sizes those
   * generators still produce.
   *
   * `bench/README.md` pins the two corpus shapes because M2.9, M3.9 and M4.10
   * all state numbers against them and only compare to each other while they
   * are the same graphs. A generator edit that changed the node or edge count
   * would leave this file's milliseconds attached to a graph that no longer
   * exists, which is the same failure as the one above with a different cause.
   */
  it('still describes the corpora it was measured on', () => {
    const shapes = Object.fromEntries(
      Object.entries(committed.corpora).map(([name, row]) => [
        name,
        { nodes: row.nodes, edges: row.edges },
      ]),
    );
    expect(shapes).toEqual({
      '1k nodes, 4k edges': {
        nodes: smallCorpus().nodes.length,
        edges: smallCorpus().edges.length,
      },
      '10k nodes, 40k edges': {
        nodes: largeCorpus().nodes.length,
        edges: largeCorpus().edges.length,
      },
    });
  });

  /**
   * THE DOCS PAGE QUOTES THESE NUMBERS AND THIS IS WHAT HOLDS IT TO THEM.
   *
   * A package test reading a docs page is coupling worth paying for exactly
   * once, and this is the once. The figures in
   * `docs/docs/layout.md`'s "What a run costs" are the whole deliverable of
   * M2.9's benchmark clause: a cost a reader can use, published rather than
   * gated. A published number with nothing asserting it is a number that goes
   * stale, and this one did, inside the milestone that added it. The table was
   * written from one measuring run and the file was regenerated by a later one,
   * both of them green, and the docs reviewer found the drift by hand. That is
   * the failure this repo warns about under "a figure that is only in prose
   * will go stale", so the fix is to stop it being only in prose.
   *
   * The expected table is BUILT from the committed file rather than compared
   * loosely against it, so a failure prints the table to paste. {@link render}
   * is the whole formatting contract: one decimal below 100ms, a rounded
   * integer with a thousands separator at or above it, which is the precision
   * these medians actually carry.
   *
   * The three derived figures in the prose beneath the table are asserted too,
   * as the exact strings they are written as. They are the ones with no row of
   * their own to check them: what the checks cost, what share the order stage
   * is, and how the whole call scales between the corpora. Every one of them
   * was wrong or half wrong when the table was.
   */
  it('is the table the docs page publishes, and the figures beneath it', () => {
    const page = readFileSync(new URL('../../../docs/docs/layout.md', import.meta.url), 'utf8');
    const section = page.slice(page.indexOf('## What a run costs'));
    const small = requireRow(committed, '1k nodes, 4k edges');
    const large = requireRow(committed, '10k nodes, 40k edges');
    const row = (label: string, pick: (row: CostRow) => number, bold = false): string => {
      const cell = (value: number): string => (bold ? `**${render(value)}**` : render(value));
      return `| ${label} | ${cell(pick(small))} | ${cell(pick(large))} |`;
    };
    const stage = (key: string): string =>
      row(`\`${stageNames[key] ?? key}\``, (costs) => costs.stages[key] ?? 0);
    const expected = [
      '| Phase | 1k nodes, 4k edges | 10k nodes, 40k edges |',
      '| --- | --- | --- |',
      stage('rank'),
      stage('order'),
      stage('position'),
      stage('route'),
      row('stage contract checks', checkCost),
      row('**whole call**', (costs) => costs.total, true),
    ].join('\n');
    // Contiguous rows only. Filtering every pipe-prefixed line out of the rest
    // of the page instead would sweep in the parity table two sections down and
    // report a failure about a table this test has nothing to say about.
    const rows: string[] = [];
    for (const line of section.slice(section.indexOf('| Phase |')).split('\n')) {
      if (!line.startsWith('|')) break;
      rows.push(line);
    }
    const printed = rows.join('\n');
    expect(printed).toBe(expected);

    const flattened = section.replace(/\s+/gu, ' ');
    const share = (part: number, whole: number): string => `${String(Math.round((part / whole) * 100))}%`;
    for (const phrase of [
      `checks are ${share(checkCost(small), small.total)} of the 1k and ` +
        `${share(checkCost(large), large.total)} of the 10k`,
      `order stage is ${share(small.stages['order'] ?? 0, small.total)} of the 1k run and ` +
        `${share(large.stages['order'] ?? 0, large.total)} of the 10k`,
      `${(large.total / small.total).toFixed(1)}x the 1k for 10x the nodes`,
      `${(large.routePoints / small.routePoints).toFixed(1)}x the size in route points`,
    ]) {
      // Matched against the section with its runs of whitespace collapsed,
      // because these phrases are prose and prose wraps. Matching the raw text
      // would make the test fail whenever a sentence was re-flowed, which is a
      // flake that trains people to loosen it.
      expect({ phrase, present: flattened.includes(phrase) }).toEqual({ phrase, present: true });
    }
  });

  /**
   * The roadmap notes entry quotes the same figures and is held to them too.
   *
   * Added because the docs reviewer pointed out that pinning the docs page
   * alone left the second site unguarded, and the second site is exactly where
   * the stale numbers were found. Two files quoting one measurement is two
   * chances to drift, and the fix that covers one of them is half a fix.
   *
   * The M2.9 working record moved from `ROADMAP.md` to
   * `specs/roadmap-notes.md` on 2026-09-01; the guard followed the prose that
   * quotes the numbers. Phrases rather than a block, because the entry is
   * prose that gets edited around the numbers and asserting its exact
   * wrapping would fail for reasons that are not staleness.
   */
  it('is the same table the roadmap notes entry quotes', () => {
    const roadmap = readFileSync(new URL('../../../specs/roadmap-notes.md', import.meta.url), 'utf8');
    const entry = roadmap.slice(roadmap.indexOf('**M2.9**')).replace(/\s+/gu, ' ');
    const small = requireRow(committed, '1k nodes, 4k edges');
    const large = requireRow(committed, '10k nodes, 40k edges');
    const at = (key: string, row: CostRow): string => render(row.stages[key] ?? 0);
    for (const phrase of [
      `the rank stage ${at('rank', small)} on the 1k and ${at('rank', large)} on the 10k`,
      `order ${at('order', small)} and ${at('order', large)}`,
      `position ${at('position', small)} and ${at('position', large)}`,
      `route ${at('route', small)} and ${at('route', large)}`,
      `the whole call ${render(small.total)} and ${render(large.total)}`,
      `${percent(small.stages['order'] ?? 0, small.total)} of the 1k and ` +
        `${percent(large.stages['order'] ?? 0, large.total)} of the 10k`,
      `checks are ${render(checkCost(small))} and ${render(checkCost(large))}, ` +
        `${percent(checkCost(small), small.total)} and ` +
        `${percent(checkCost(large), large.total)} of the call`,
    ]) {
      expect({ phrase, present: entry.includes(phrase) }).toEqual({ phrase, present: true });
    }
  });

  /**
   * Every stage the file names has a number, and the whole run is at least as
   * expensive as the stages inside it.
   *
   * The weakest possible sanity check on the timings and the strongest one
   * available: an ordering that must hold on any machine at any load, which a
   * file written by a broken measurement path would fail. Asserting a magnitude
   * instead would be asserting this machine.
   */
  it('has a number for every stage, and a total that is not smaller', () => {
    for (const row of Object.values(committed.corpora)) {
      expect(Object.keys(row.stages).sort()).toEqual(Object.keys(stageNames).sort());
      const summed = Object.values(row.stages).reduce((sum, value) => sum + value, 0);
      expect(row.total).toBeGreaterThanOrEqual(summed);
    }
  });
});
