import { cpus, loadavg } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { Graph } from '@prnt/dagr-graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { createLayout } from '../src/engine.js';
import type { GraphSpec } from '@dagr/bench';
import type { Patch } from '@prnt/dagr-graph';
import type { LayoutEngine, LayoutStageName } from '../src/index.js';

/**
 * What a relayout costs when every fast path declines it, on the 10k corpus:
 * M3.9b's fallback, which it asks to be a small multiple of a cold run,
 * measured. A measurement, like `layout.relayout-cost`, and not a baseline:
 * nothing gates on the timings.
 *
 *   MEASURE_COST=1 pnpm --filter @prnt/dagr-layout test layout.fallback-cost
 *
 * The ordinary run reads the committed file and checks that every patch it
 * times still takes the fallback on the 1k corpus, and that the docs page
 * prints its table and ceiling.
 */

const KINDS = [
  'add-inner-node',
  'remove-inner-node',
  'add-cycle-edge',
  'remove-cycle-edge',
  'remove-sole-leaf',
] as const;
type Kind = (typeof KINDS)[number];

const LABELS: Readonly<Record<Kind, string>> = {
  'add-inner-node': 'add a node with an edge in and an edge out',
  'remove-inner-node': 'remove that node',
  'add-cycle-edge': 'add an edge that closes a cycle',
  'remove-cycle-edge': 'remove that edge',
  'remove-sole-leaf': 'remove a leaf alone on its rank',
};

interface KindRow {
  readonly ran: readonly LayoutStageName[];
  readonly total: number;
}

interface Sample {
  readonly kind: Kind | 'add-sole-leaf';
  readonly ran: readonly LayoutStageName[];
  readonly total: number;
}

interface FallbackCostFile {
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
  readonly cold: number;
  readonly kinds: Readonly<Record<Kind, KindRow>>;
}

const costPath = new URL('./fallback-cost.json', import.meta.url);

const FRAME_MS = 1000 / 60;
const RUNS = 11;
const WARMUP = 2;
const INNER = 'fallback-cost-inner';
const LEAF = 'fallback-cost-leaf';
const EVERY_STAGE: readonly LayoutStageName[] = ['rank', 'order', 'position', 'route'];

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

/** The same formatting contract as `layout.cost`'s, so the pages agree. */
function render(value: number): string {
  if (value < 100) return `${value.toFixed(1)}ms`;
  return `${Math.round(value).toLocaleString('en-US')}ms`;
}

function multiple(total: number, cold: number): string {
  return `${(total / cold).toFixed(2)}x`;
}

/** A node on the last rank, so a leaf under it is alone on a new one. */
function deepest(engine: LayoutEngine, graph: Graph): string {
  const { nodes } = engine.run(graph);
  let found: string | undefined;
  let bottom = -Infinity;
  for (const [id, node] of nodes) {
    if (node.y > bottom) {
      bottom = node.y;
      found = id;
    }
  }
  if (found === undefined) throw new Error('the graph has no nodes');
  return found;
}

/**
 * One cycle of the patches every fast path declines, each undone by the next,
 * so every cycle makes the same edits to the same graph. The sole leaf is added
 * on the added-leaf path, untimed in the table, so that its removal is the
 * fallback being timed.
 */
function cycle(graph: Graph, engine: LayoutEngine, edge: readonly [string, string], bottom: string): Sample[] {
  let patch: Patch | undefined;
  const unsubscribe = graph.subscribe((emitted) => {
    patch = emitted;
  });
  const measured: Sample[] = [];
  const relayout = (kind: Sample['kind'], edit: () => void): void => {
    patch = undefined;
    edit();
    if (patch === undefined) throw new Error(`the ${kind} edit emitted no patch`);
    const started = performance.now();
    const { ran } = engine.relayout(patch);
    measured.push({ kind, ran, total: performance.now() - started });
  };
  const [source, target] = edge;
  try {
    relayout('add-inner-node', () =>
      graph.batch(() => {
        graph.addNode(INNER);
        graph.addEdge(source, INNER);
        graph.addEdge(INNER, target);
      }),
    );
    relayout('remove-inner-node', () => graph.removeNode(INNER));
    let back = '';
    relayout('add-cycle-edge', () => {
      back = graph.addEdge(target, source).id;
    });
    relayout('remove-cycle-edge', () => graph.removeEdge(back));
    relayout('add-sole-leaf', () =>
      graph.batch(() => {
        graph.addNode(LEAF);
        graph.addEdge(bottom, LEAF);
      }),
    );
    relayout('remove-sole-leaf', () => graph.removeNode(LEAF));
  } finally {
    unsubscribe();
  }
  return measured;
}

function setUp(spec: GraphSpec): { graph: Graph; engine: LayoutEngine; edge: [string, string]; bottom: string } {
  const graph = build(spec);
  const engine = createLayout();
  const bottom = deepest(engine, graph);
  const edge = spec.edges[Math.floor(spec.edges.length / 2)];
  if (edge === undefined) throw new Error('the corpus has no edges');
  return { graph, engine, edge: [edge[0], edge[1]], bottom };
}

function ranOf(samples: readonly Sample[], kind: Kind): readonly LayoutStageName[] {
  const sets = new Set(samples.filter((sample) => sample.kind === kind).map((sample) => sample.ran.join(',')));
  if (sets.size !== 1) throw new Error(`${kind} ran ${String(sets.size)} different sets of stages`);
  return samples.find((sample) => sample.kind === kind)?.ran ?? [];
}

function ranByKind(spec: GraphSpec): Record<Sample['kind'], readonly LayoutStageName[]> {
  const { graph, engine, edge, bottom } = setUp(spec);
  const samples = cycle(graph, engine, edge, bottom);
  return Object.fromEntries(samples.map((sample) => [sample.kind, sample.ran])) as Record<
    Sample['kind'],
    readonly LayoutStageName[]
  >;
}

function measure(spec: GraphSpec): Pick<FallbackCostFile, 'cold' | 'kinds'> {
  const { graph, engine, edge, bottom } = setUp(spec);

  const colds: number[] = [];
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    const started = performance.now();
    createLayout().run(graph);
    if (run >= WARMUP) colds.push(performance.now() - started);
  }

  const samples: Sample[] = [];
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    const measured = cycle(graph, engine, edge, bottom);
    if (run >= WARMUP) samples.push(...measured);
  }

  const kinds = {} as Record<Kind, KindRow>;
  for (const kind of KINDS) {
    const rows = samples.filter((sample) => sample.kind === kind);
    kinds[kind] = { ran: ranOf(samples, kind), total: round(median(rows.map((row) => row.total))) };
  }
  return { cold: round(median(colds)), kinds };
}

const measuring = process.env['MEASURE_COST'] === '1';

describe('what a fallback relayout costs', () => {
  if (measuring) {
    it('rewrites the fallback cost file, because MEASURE_COST was set', () => {
      const cpu = cpus()[0];
      const spec = largeCorpus();
      const file: FallbackCostFile = {
        measure: 'MEASURE_COST=1 pnpm --filter @prnt/dagr-layout test layout.fallback-cost',
        isNotABaseline:
          'Wall-clock milliseconds on one machine, published so M3.9b states its fallback ' +
          'as a measured multiple of a cold run. Nothing gates on it and the benchmark gate never reads it.',
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpu: cpu?.model.trim() ?? 'unknown',
          cores: cpus().length,
          node: process.version,
          loadAverage: Math.round((loadavg()[0] ?? 0) * 100) / 100,
        },
        runs: RUNS,
        corpus: { name: spec.name, nodes: spec.nodes.length, edges: spec.edges.length },
        ...measure(spec),
      };
      for (const kind of KINDS) expect({ kind, ran: file.kinds[kind].ran }).toEqual({ kind, ran: EVERY_STAGE });
      writeFileSync(costPath, `${JSON.stringify(file, undefined, 2)}\n`);
    }, 900_000);
    return;
  }

  const committed = JSON.parse(readFileSync(costPath, 'utf8')) as FallbackCostFile;

  it('times patches that still take the fallback, on the corpus it was measured on', () => {
    const spec = largeCorpus();
    expect(committed.corpus).toEqual({ name: spec.name, nodes: spec.nodes.length, edges: spec.edges.length });
    const ran = ranByKind(smallCorpus());
    for (const kind of KINDS) {
      expect({ kind, ran: committed.kinds[kind].ran }).toEqual({ kind, ran: EVERY_STAGE });
      expect({ kind, ran: ran[kind] }).toEqual({ kind, ran: EVERY_STAGE });
    }
    expect(ran['add-sole-leaf']).toEqual(['order', 'position', 'route']);
  }, 30_000);

  it('is the table the docs page publishes, and the ceiling beneath it', () => {
    const page = readFileSync(new URL('../../../docs/docs/incremental-layout.md', import.meta.url), 'utf8');
    const section = page.slice(page.indexOf('## What a fallback costs'));
    const { cold, kinds } = committed;
    const expected = [
      '| Patch | whole relayout | of a cold run |',
      '| --- | --- | --- |',
      ...KINDS.map((kind) => `| ${LABELS[kind]} | ${render(kinds[kind].total)} | ${multiple(kinds[kind].total, cold)} |`),
    ].join('\n');
    const rows: string[] = [];
    for (const line of section.slice(section.indexOf('| Patch |')).split('\n')) {
      if (!line.startsWith('|')) break;
      rows.push(line);
    }
    expect(rows.join('\n')).toBe(expected);

    const slowest = Math.max(...KINDS.map((kind) => kinds[kind].total));
    const flattened = section.replace(/\s+/gu, ' ');
    for (const phrase of [
      `a cold run of the same graph, measured in the same session, takes ${render(cold)}`,
      `the slowest fallback is ${multiple(slowest, cold)} of a cold run`,
      `the fastest is ${String(Math.round(Math.min(...KINDS.map((kind) => kinds[kind].total)) / FRAME_MS))} frames at 60 Hz`,
      `${committed.machine.cpu} under Node ${committed.machine.node.replace(/^v/u, '')}`,
      `load average of ${String(committed.machine.loadAverage)}`,
    ]) {
      expect({ phrase, present: flattened.includes(phrase) }).toEqual({ phrase, present: true });
    }
  });
});
