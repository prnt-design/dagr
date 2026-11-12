import { cpus, loadavg } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { Graph } from '@prnt/dagr-graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { authored } from '../src/authorship.js';
import { createLayout } from '../src/engine.js';
import { defaultStages } from '../src/stages.js';
import type { GraphSpec } from '@dagr/bench';
import type { Node, Patch } from '@prnt/dagr-graph';
import type { LayoutEngine, LayoutStageOverrides, LayoutStageName } from '../src/index.js';

/**
 * What one relayout costs on the 10k corpus, per patch kind, on a named
 * machine: the starting point M3.9b's fast paths are judged against, since its
 * budget is one 60 Hz frame per patch. A measurement, like `layout.cost`, and
 * not a baseline: nothing gates on the timings.
 *
 *   MEASURE_COST=1 pnpm --filter @prnt/dagr-layout test layout.relayout-cost
 *
 * The ordinary run reads the committed file and checks that it still describes
 * this engine: the stages it names, the stages each patch kind runs, and the
 * table the docs page prints. A fast path that fires on the 1k corpus without a
 * re-measure fails the second check.
 */

const KINDS = ['add-leaf', 'remove-leaf', 'resize'] as const;
type Kind = (typeof KINDS)[number];

const STAGES = ['rank', 'order', 'position', 'route'] as const;

interface KindRow {
  readonly ran: readonly LayoutStageName[];
  readonly stages: Readonly<Record<string, number>>;
  /** The median, per relayout, of the call less its stages. */
  readonly outside: number;
  readonly total: number;
}

interface Sample {
  readonly kind: Kind;
  readonly ran: readonly LayoutStageName[];
  readonly stages: Readonly<Record<string, number>>;
  readonly total: number;
}

interface RelayoutCostFile {
  readonly measure: string;
  readonly isNotABaseline: string;
  readonly machine: {
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly cores: number;
    readonly node: string;
    readonly loadAverage: number;
  };
  readonly runs: number;
  readonly corpus: { readonly name: string; readonly nodes: number; readonly edges: number };
  readonly stageNames: Readonly<Record<string, string>>;
  /** A cold `run` of the same graph, which is what a fallback costs. */
  readonly cold: number;
  readonly kinds: Readonly<Record<Kind, KindRow>>;
}

const costPath = new URL('./relayout-cost.json', import.meta.url);

const FRAME_MS = 1000 / 60;
const RUNS = 11;
const WARMUP = 2;
const LEAF = 'relayout-cost-leaf';
const BIG = { width: 400, height: 300 };

const nodeSize = (node: Node): { width: number; height: number } | undefined =>
  node.attrs['big'] === true ? BIG : undefined;

function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}

/** The same formatting contract as `layout.cost`'s, so the two pages agree. */
function render(value: number): string {
  if (value < 100) return `${value.toFixed(1)}ms`;
  return `${Math.round(value).toLocaleString('en-US')}ms`;
}

function percent(part: number, whole: number): string {
  return `${String(Math.round((part / whole) * 100))}%`;
}

function outside(sample: Sample): number {
  return sample.total - STAGES.reduce((sum, key) => sum + (sample.stages[key] ?? 0), 0);
}

/**
 * The default stages, timed, and marked as this package's own: an unmarked
 * wrapper would switch off every fast path and measure an engine no caller
 * running the defaults gets.
 */
function timedStages(into: Record<string, number>): LayoutStageOverrides {
  const time = <T>(key: string, run: () => T): T => {
    const started = performance.now();
    const output = run();
    into[key] = (into[key] ?? 0) + (performance.now() - started);
    return output;
  };
  return {
    rank: authored({ ...defaultStages.rank, run: (input) => time('rank', () => defaultStages.rank.run(input)) }),
    order: authored({ ...defaultStages.order, run: (input) => time('order', () => defaultStages.order.run(input)) }),
    position: authored({
      ...defaultStages.position,
      run: (input) => time('position', () => defaultStages.position.run(input)),
    }),
    route: authored({ ...defaultStages.route, run: (input) => time('route', () => defaultStages.route.run(input)) }),
  };
}

/**
 * One cycle of the three patch kinds against a mid-graph node: add a leaf
 * under it, grow it, shrink it back, remove the leaf, so every cycle makes the
 * same edits to the same graph.
 */
function cycle(
  graph: Graph,
  engine: LayoutEngine,
  parent: string,
  into: Record<string, number>,
): readonly Sample[] {
  let patch: Patch | undefined;
  const unsubscribe = graph.subscribe((emitted) => {
    patch = emitted;
  });
  const measured: Sample[] = [];
  const relayout = (kind: Kind, edit: () => void): void => {
    patch = undefined;
    edit();
    if (patch === undefined) throw new Error(`the ${kind} edit emitted no patch`);
    for (const key of Object.keys(into)) delete into[key];
    const started = performance.now();
    const { ran } = engine.relayout(patch);
    const total = performance.now() - started;
    measured.push({ kind, ran, stages: { ...into }, total });
  };
  try {
    relayout('add-leaf', () =>
      graph.batch(() => {
        graph.addNode(LEAF);
        graph.addEdge(parent, LEAF);
      }),
    );
    relayout('resize', () => graph.updateNodeAttrs(parent, { big: true }));
    relayout('resize', () => graph.updateNodeAttrs(parent, { big: false }));
    relayout('remove-leaf', () => graph.removeNode(LEAF));
  } finally {
    unsubscribe();
  }
  return measured;
}

function engineFor(graph: Graph, into: Record<string, number>): LayoutEngine {
  const engine = createLayout({ config: { nodeSize }, stages: timedStages(into) });
  engine.run(graph);
  return engine;
}

/** The one set of stages every sample of a kind ran, or a throw naming the kind that disagreed. */
function ranOf(samples: readonly Sample[], kind: Kind): readonly LayoutStageName[] {
  const sets = new Set(samples.filter((sample) => sample.kind === kind).map((sample) => sample.ran.join(',')));
  if (sets.size !== 1) throw new Error(`${kind} ran ${String(sets.size)} different sets of stages`);
  return samples.find((sample) => sample.kind === kind)?.ran ?? [];
}

/** Which stages each kind runs on the engine a caller gets, with no timing wrapper. */
function ranByKind(spec: GraphSpec): Record<Kind, readonly LayoutStageName[]> {
  const graph = build(spec);
  const engine = createLayout({ config: { nodeSize } });
  engine.run(graph);
  const samples = cycle(graph, engine, spec.nodes[Math.floor(spec.nodes.length / 2)] ?? '', {});
  return Object.fromEntries(KINDS.map((kind) => [kind, ranOf(samples, kind)])) as Record<
    Kind,
    readonly LayoutStageName[]
  >;
}

function measure(spec: GraphSpec): Pick<RelayoutCostFile, 'cold' | 'kinds'> {
  const graph = build(spec);
  const into: Record<string, number> = {};
  const parent = spec.nodes[Math.floor(spec.nodes.length / 2)] ?? '';

  const colds: number[] = [];
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    const started = performance.now();
    createLayout({ config: { nodeSize } }).run(graph);
    if (run >= WARMUP) colds.push(performance.now() - started);
  }

  const engine = engineFor(graph, into);
  const samples: Sample[] = [];
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    const measured = cycle(graph, engine, parent, into);
    if (run >= WARMUP) samples.push(...measured);
  }

  const kinds = {} as Record<Kind, KindRow>;
  for (const kind of KINDS) {
    const rows = samples.filter((sample) => sample.kind === kind);
    const stages: Record<string, number> = {};
    for (const key of STAGES) stages[key] = round(median(rows.map((row) => row.stages[key] ?? 0)));
    kinds[kind] = {
      ran: ranOf(samples, kind),
      stages,
      outside: round(median(rows.map(outside))),
      total: round(median(rows.map((row) => row.total))),
    };
  }
  return { cold: round(median(colds)), kinds };
}

const measuring = process.env['MEASURE_COST'] === '1';

describe('what a relayout costs', () => {
  const stageNames: Record<string, string> = {
    rank: defaultStages.rank.name,
    order: defaultStages.order.name,
    position: defaultStages.position.name,
    route: defaultStages.route.name,
  };

  if (measuring) {
    it('rewrites the relayout cost file, because MEASURE_COST was set', () => {
      const cpu = cpus()[0];
      const spec = largeCorpus();
      const file: RelayoutCostFile = {
        measure: 'MEASURE_COST=1 pnpm --filter @prnt/dagr-layout test layout.relayout-cost',
        isNotABaseline:
          'Wall-clock milliseconds on one machine, published so M3.9b has a starting ' +
          'point to beat. Nothing gates on it and the benchmark gate never reads it.',
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpu: cpu?.model ?? 'unknown',
          cores: cpus().length,
          node: process.version,
          loadAverage: Math.round((loadavg()[0] ?? 0) * 100) / 100,
        },
        runs: RUNS,
        corpus: { name: spec.name, nodes: spec.nodes.length, edges: spec.edges.length },
        stageNames,
        ...measure(spec),
      };
      expect(Object.fromEntries(KINDS.map((kind) => [kind, file.kinds[kind].ran]))).toEqual(ranByKind(spec));
      writeFileSync(costPath, `${JSON.stringify(file, undefined, 2)}\n`);
    }, 900_000);
    return;
  }

  const committed = JSON.parse(readFileSync(costPath, 'utf8')) as RelayoutCostFile;

  it('still names the stages the engine runs, on the corpus it was measured on', () => {
    const spec = largeCorpus();
    expect(committed.stageNames).toEqual(stageNames);
    expect(committed.corpus).toEqual({ name: spec.name, nodes: spec.nodes.length, edges: spec.edges.length });
  });

  it('still records the stages each patch kind runs', () => {
    const recorded = Object.fromEntries(KINDS.map((kind) => [kind, committed.kinds[kind].ran]));
    expect(ranByKind(smallCorpus())).toEqual(recorded);
  }, 30_000);

  it('has a number for every stage, and a total that is not smaller', () => {
    for (const kind of KINDS) {
      const row = committed.kinds[kind];
      expect(Object.keys(row.stages).sort()).toEqual([...STAGES].sort());
      expect(row.outside).toBeGreaterThanOrEqual(0);
    }
  });

  it('is the table the docs page publishes, and the figures beneath it', () => {
    const page = readFileSync(new URL('../../../docs/docs/incremental-layout.md', import.meta.url), 'utf8');
    const section = page.slice(page.indexOf('## What a relayout costs'));
    const { kinds } = committed;
    const row = (label: string, pick: (row: KindRow) => number | undefined, bold = false): string => {
      const cell = (value: number | undefined): string => {
        if (value === undefined) return 'not run';
        return bold ? `**${render(value)}**` : render(value);
      };
      return `| ${label} | ${KINDS.map((kind) => cell(pick(kinds[kind]))).join(' | ')} |`;
    };
    const expected = [
      '| Phase | add a leaf | remove a leaf | resize a node |',
      '| --- | --- | --- | --- |',
      ...STAGES.map((key) =>
        row(`\`${stageNames[key] ?? key}\``, (costs) =>
          costs.ran.includes(key) ? (costs.stages[key] ?? 0) : undefined,
        ),
      ),
      row('everything else', (costs) => costs.outside),
      row('**whole relayout**', (costs) => costs.total, true),
    ].join('\n');
    const rows: string[] = [];
    for (const line of section.slice(section.indexOf('| Phase |')).split('\n')) {
      if (!line.startsWith('|')) break;
      rows.push(line);
    }
    expect(rows.join('\n')).toBe(expected);

    const totals = KINDS.map((kind) => kinds[kind].total);
    const flattened = section.replace(/\s+/gu, ' ');
    for (const phrase of [
      `measured in the same session, takes ${render(committed.cold)}`,
      `between ${String(Math.round(Math.min(...totals) / FRAME_MS))} and ` +
        `${String(Math.round(Math.max(...totals) / FRAME_MS))} frames`,
      `about ${String(Math.round(kinds['add-leaf'].outside / FRAME_MS))} frames on its own for an added leaf, ` +
        `and about ${String(Math.round(kinds.resize.outside / FRAME_MS))} even for a resize`,
      `order stage is ${percent(kinds['add-leaf'].stages['order'] ?? 0, kinds['add-leaf'].total)} ` +
        `of an added leaf`,
      `${committed.machine.cpu} under Node ${committed.machine.node.replace(/^v/u, '')}`,
      `load average of ${String(committed.machine.loadAverage)}`,
    ]) {
      expect({ phrase, present: flattened.includes(phrase) }).toEqual({ phrase, present: true });
    }
  });
});
