import { MessageChannel } from 'node:worker_threads';
import { cpus, loadavg } from 'node:os';
import { Graph } from '@prnt/dagr-graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayout,
  isEmptyDelta,
  longestPathRank,
  networkSimplexRank,
  networkSimplexRankStage,
  serveLayout,
} from '../src/index.js';
import { brandesKoepfPositionStage } from '../src/position.js';
import { defaultStages, insertionOrderStage } from '../src/stages.js';
import type {
  LayoutEngine,
  LayoutPort,
  LayoutResult,
  LayoutStageOverrides,
} from '../src/index.js';
import type { GraphSpec } from '@dagr/bench';
import type { Node, Patch } from '@prnt/dagr-graph';
import { recordingStages } from './fakes.js';

/**
 * M3.9a: the relayout that runs no stage.
 *
 * Every test here is about one claim, which is the whole fast path: a patch
 * that changes nothing the pipeline reads leaves the drawing exactly where it
 * was, so the honest answer is the drawing the caller already holds, an empty
 * delta, and an influence set that is empty because nothing was entitled to
 * move. The suite is written in three parts: the patches that take it, the
 * patches and the engines that must not, and the two checks that the answer it
 * gives is the answer a full run would have given.
 */

const ALL_STAGES = ['rank', 'order', 'position', 'route'];
const PLACED_STAGES = ['position', 'route'];

const nodeSize = (node: Node): { width: number; height: number } | undefined =>
  node.attrs['big'] === true ? { width: 400, height: 300 } : undefined;

function diamond(): Graph {
  const graph = new Graph();
  for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('b', 'd', 'bd');
  graph.addEdge('c', 'd', 'cd');
  return graph;
}

function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/** The graph and the patches it emitted, in the order it emitted them. */
function watched(graph: Graph): { readonly graph: Graph; readonly patches: Patch[] } {
  const patches: Patch[] = [];
  graph.subscribe((patch) => patches.push(patch));
  return { graph, patches };
}

/** The last patch a watched graph emitted. */
function last(patches: readonly Patch[]): Patch {
  const patch = patches.at(-1);
  if (patch === undefined) throw new Error('the graph emitted no patch');
  return patch;
}

/** Every node's box, as one comparable record. */
function boxes(result: LayoutResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, box] of result.nodes) out[id] = `${box.x},${box.y},${box.width},${box.height}`;
  return out;
}

/** Every route, as one comparable record. */
function routes(result: LayoutResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, route] of result.edges) {
    out[id] = route.points.map((point) => `${point.x},${point.y}`).join(' ');
  }
  return out;
}

const engines: LayoutEngine[] = [];

/** Every engine a test builds, disposed whether or not the test got that far. */
function engine(...args: Parameters<typeof createLayout>): LayoutEngine {
  const made = createLayout(...args);
  engines.push(made);
  return made;
}

afterEach(() => {
  for (const made of engines.splice(0)) made.dispose();
});

describe('the relayout that runs no stage', () => {
  it('runs none of them for an attribute that does not change a size', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine();
    const before = laid.run(graph);

    graph.updateNodeAttrs('a', { colour: 'red' });
    const relaid = laid.relayout(last(patches));

    expect(relaid.ran).toEqual([]);
    expect(isEmptyDelta(relaid.delta)).toBe(true);
    expect(relaid.result).toBe(before);
    expect(relaid.influence.nodes.size).toBe(0);
    expect(relaid.influence.edges.size).toBe(0);
    expect(relaid.region.nodes.size).toBe(0);
    expect(relaid.region.edges.size).toBe(0);
  });

  it('runs none of them for a port, an edge attribute, a graph attribute or a parent', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine();
    laid.run(graph);

    graph.addPort('a', { id: 'out' });
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.updateEdgeAttrs('ab', { weight: 3 });
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.updateAttrs({ title: 'a diamond' });
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.setNodeParent('b', 'a');
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.updateEdgePorts('ab', { sourcePort: 'out' });
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.addPort('a', { id: 'spare' });
    expect(laid.relayout(last(patches)).ran).toEqual([]);

    graph.removePort('a', 'spare');
    expect(laid.relayout(last(patches)).ran).toEqual([]);
  });

  it('runs only position and route when the same attribute changes a size', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine({ config: { nodeSize } });
    laid.run(graph);

    graph.updateNodeAttrs('a', { big: true });
    const relaid = laid.relayout(last(patches));

    expect(relaid.ran).toEqual(PLACED_STAGES);
    expect(isEmptyDelta(relaid.delta)).toBe(false);
  });

  it('runs all four for a structural op, and for a batch that carries one', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine();
    laid.run(graph);

    graph.addNode('e');
    expect(laid.relayout(last(patches)).ran).toEqual(ALL_STAGES);

    graph.batch(() => {
      graph.updateNodeAttrs('a', { colour: 'blue' });
      graph.addEdge('d', 'e', 'de');
    });
    expect(laid.relayout(last(patches)).ran).toEqual(ALL_STAGES);
  });

  it('runs all four when a stage this package did not write is in the set', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine({ stages: recordingStages().stages });
    laid.run(graph);

    graph.updateNodeAttrs('a', { colour: 'red' });

    expect(laid.relayout(last(patches)).ran).toEqual(ALL_STAGES);
  });

  it('runs none of them when the set is this package own, default or not', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine({ stages: { rank: networkSimplexRankStage } });
    laid.run(graph);

    graph.updateNodeAttrs('a', { colour: 'red' });

    expect(laid.relayout(last(patches)).ran).toEqual([]);
  });

  it('leaves the retained state exactly as the last real run left it', () => {
    const skipping = watched(diamond());
    const straight = watched(diamond());
    const one = engine();
    const two = engine();
    one.run(skipping.graph);
    two.run(straight.graph);

    skipping.graph.updateNodeAttrs('a', { colour: 'red' });
    one.relayout(last(skipping.patches));

    skipping.graph.addNode('e');
    straight.graph.addNode('e');
    const after = one.relayout(last(skipping.patches));
    const control = two.relayout(last(straight.patches));

    expect(boxes(after.result)).toEqual(boxes(control.result));
    expect(routes(after.result)).toEqual(routes(control.result));
  });

  it('gives the answer the full path gives', () => {
    const skipping = watched(diamond());
    const straight = watched(diamond());
    const one = engine();
    const two = engine({ stages: recordingStages().stages });
    one.run(skipping.graph);
    two.run(straight.graph);

    skipping.graph.updateNodeAttrs('a', { colour: 'red' });
    straight.graph.updateNodeAttrs('a', { colour: 'red' });
    const skipped = one.relayout(last(skipping.patches));
    const ran = two.relayout(last(straight.patches));

    expect(skipped.ran).toEqual([]);
    expect(ran.ran).toEqual(ALL_STAGES);
    expect(boxes(skipped.result)).toEqual(boxes(ran.result));
    expect(routes(skipped.result)).toEqual(routes(ran.result));
  });

  it('withholds nothing extra under a nonzero epsilon', () => {
    const { graph, patches } = watched(diamond());
    const laid = engine({ epsilon: 5 });
    const before = laid.run(graph);

    graph.updateNodeAttrs('a', { colour: 'red' });
    const relaid = laid.relayout(last(patches));

    expect(relaid.ran).toEqual([]);
    expect(relaid.result).toBe(before);
  });
});

/**
 * The same stages with this package's mark taken off, so an engine built on
 * them runs all four on every relayout: the full path to compare against.
 */
function unmarked(stages: LayoutStageOverrides): LayoutStageOverrides {
  const rank = stages.rank ?? defaultStages.rank;
  const order = stages.order ?? defaultStages.order;
  const position = stages.position ?? defaultStages.position;
  const route = stages.route ?? defaultStages.route;
  return {
    rank: { name: rank.name, run: (input) => rank.run(input) },
    order: { name: order.name, run: (input) => order.run(input) },
    position: { name: position.name, run: (input) => position.run(input) },
    route: { name: route.name, run: (input) => route.run(input) },
  };
}

describe('the relayout that skips rank and order', () => {
  // A warm simplex run can move ranks, with or without its pivot budget
  // running out, so a resize has to run it.
  const sets: readonly (readonly [string, LayoutStageOverrides, readonly string[]])[] = [
    ['the defaults', {}, PLACED_STAGES],
    ['a longest-path ranker with no warm share', { rank: longestPathRank({ maxWarmShare: 0 }) }, PLACED_STAGES],
    ['the simplex ranker', { rank: networkSimplexRankStage }, ALL_STAGES],
    ['a simplex ranker out of pivots', { rank: networkSimplexRank({ maxIterations: 1 }) }, ALL_STAGES],
    ['insertion order', { order: insertionOrderStage }, PLACED_STAGES],
    ['Brandes-Koepf positions', { position: brandesKoepfPositionStage }, PLACED_STAGES],
  ];

  for (const [name, stages, resized] of sets) {
    it(`gives the answer the full path gives, through resizes and an edit between them, with ${name}`, () => {
      const spec = smallCorpus();
      const skipping = watched(build(spec));
      const straight = watched(build(spec));
      const one = engine({ config: { nodeSize }, stages });
      const two = engine({ config: { nodeSize }, stages: unmarked(stages) });
      one.run(skipping.graph);
      two.run(straight.graph);
      const middle = spec.nodes[Math.floor(spec.nodes.length / 2)] ?? '';
      const first = spec.nodes[0] ?? '';

      const edits: readonly (readonly [readonly string[], (graph: Graph) => void])[] = [
        [resized, (graph) => graph.updateNodeAttrs(middle, { big: true })],
        [resized, (graph) => graph.updateNodeAttrs(first, { big: true })],
        [
          ALL_STAGES,
          (graph) =>
            graph.batch(() => {
              graph.addNode('leaf');
              graph.addEdge(middle, 'leaf');
            }),
        ],
        [resized, (graph) => graph.updateNodeAttrs(middle, { big: false })],
      ];
      for (const [ran, edit] of edits) {
        edit(skipping.graph);
        edit(straight.graph);
        const skipped = one.relayout(last(skipping.patches));
        const full = two.relayout(last(straight.patches));

        expect(skipped.ran).toEqual(ran);
        expect(full.ran).toEqual(ALL_STAGES);
        expect(boxes(skipped.result)).toEqual(boxes(full.result));
        expect(routes(skipped.result)).toEqual(routes(full.result));
        expect(skipped.delta).toEqual(full.delta);
      }
    }, 60_000);
  }

  it('runs all four for a resize when a rank or order stage is not this package own', () => {
    const { graph, patches } = watched(diamond());
    const { stages } = recordingStages();
    const laid = engine({ config: { nodeSize }, stages: { order: stages.order } });
    laid.run(graph);

    graph.updateNodeAttrs('a', { big: true });

    expect(laid.relayout(last(patches)).ran).toEqual(ALL_STAGES);
  });

  it('runs all four for a resize when the drawing it holds came from a worker', async () => {
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2 as unknown as LayoutPort);
    const { graph, patches } = watched(diamond());
    const laid = engine({ config: { nodeSize }, worker: channel.port1 as unknown as LayoutPort });

    await laid.runAsync(graph);
    graph.updateNodeAttrs('a', { big: true });

    expect(laid.relayout(last(patches)).ran).toEqual(ALL_STAGES);
    stop();
    channel.port1.close();
    channel.port2.close();
  });

  it('runs only position and route on this thread when the engine has no worker', async () => {
    const { graph, patches } = watched(diamond());
    const laid = engine({ config: { nodeSize } });
    laid.run(graph);

    graph.updateNodeAttrs('a', { big: true });

    expect((await laid.relayoutAsync(last(patches))).ran).toEqual(PLACED_STAGES);
  });
});

describe('the relayout that runs no stage, across a worker', () => {
  it('never posts the patch when the last run happened here', async () => {
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2 as unknown as LayoutPort);
    const posted: unknown[] = [];
    const port = channel.port1 as unknown as LayoutPort;
    const watching: LayoutPort = {
      postMessage(message, transfer) {
        posted.push(message);
        port.postMessage(message, transfer);
      },
      addEventListener: (type, listener) => port.addEventListener(type, listener),
      removeEventListener: (type, listener) => port.removeEventListener(type, listener),
      start: () => port.start?.(),
    };
    const { graph, patches } = watched(diamond());
    const laid = engine({ worker: watching });

    laid.run(graph);
    graph.updateNodeAttrs('a', { colour: 'red' });
    const relaid = await laid.relayoutAsync(last(patches));

    expect(relaid.ran).toEqual([]);
    expect(posted).toEqual([]);
    stop();
    channel.port1.close();
    channel.port2.close();
  });

  it('runs all four when the drawing it holds came from over there', async () => {
    const channel = new MessageChannel();
    const stop = serveLayout(channel.port2 as unknown as LayoutPort);
    const { graph, patches } = watched(diamond());
    const laid = engine({ worker: channel.port1 as unknown as LayoutPort });

    await laid.runAsync(graph);
    graph.updateNodeAttrs('a', { colour: 'red' });
    const relaid = await laid.relayoutAsync(last(patches));

    expect(relaid.ran).toEqual(ALL_STAGES);
    stop();
    channel.port1.close();
    channel.port2.close();
  });
});

/**
 * THE ONE TIMING THIS REPO ASSERTS, and it is assertable for one reason: the
 * margin is two orders of magnitude. `layout.cost.test.ts` argues at length
 * that a wall-clock number cannot be asserted on a shared machine without
 * becoming a flake or a no-op, and it is right about a number measured against
 * itself. A frame budget against a path that runs no stage is neither: the full
 * run it replaces is above a second on this corpus, so a machine would have to
 * be thirty times slower than the slowest one this has been run on before the
 * assertion said anything but the truth. It stops being assertable exactly when
 * a fast path gets close to its budget, which is M3.9b's problem and not this
 * one's.
 */
describe('what the fast path costs on the 10k corpus', () => {
  const WARMUP = 3;
  const RUNS = 15;
  /** One frame at 60fps, which is the budget M3.9 names. */
  const FRAME = 1000 / 60;

  it(
    'answers an inert patch inside one frame',
    { timeout: 120_000 },
    () => {
      const spec = largeCorpus();
      const first = spec.nodes[0] ?? 'n0000';
      const graph = build(spec);
      const patches: Patch[] = [];
      graph.subscribe((patch) => patches.push(patch));
      const laid = engine();
      laid.run(graph);

      const timings: number[] = [];
      for (let run = 0; run < WARMUP + RUNS; run += 1) {
        graph.updateNodeAttrs(first, { tick: run });
        const patch = last(patches);
        const started = performance.now();
        const relaid = laid.relayout(patch);
        const took = performance.now() - started;
        expect(relaid.ran).toEqual([]);
        if (run >= WARMUP) timings.push(took);
      }
      timings.sort((one, two) => one - two);
      const median = timings[Math.floor(timings.length / 2)] ?? Number.POSITIVE_INFINITY;
      // Recorded so a reader of a failure sees the machine as well as the miss.
      expect(
        `${median.toFixed(3)}ms on ${String(cpus().length)} cores at load ${loadavg()[0]?.toFixed(2) ?? '?'}`,
      ).toBeTypeOf('string');
      expect(median).toBeLessThan(FRAME);
    },
  );
});
