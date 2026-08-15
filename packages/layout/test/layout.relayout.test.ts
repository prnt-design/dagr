import { MessageChannel } from 'node:worker_threads';
import { Graph } from '@dagr/graph';
import type { Patch } from '@dagr/graph';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EngineStateError,
  InvalidConfigError,
  applyDelta,
  createLayout,
  isEmptyDelta,
  layout,
  serveLayout,
} from '../src/index.js';
import type { LayoutEngine, LayoutPort, LayoutResult, PositionStage } from '../src/index.js';
import { recordingStages } from './fakes.js';

function diamond(): Graph {
  const graph = new Graph();
  for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('b', 'd', 'bd');
  graph.addEdge('c', 'd', 'cd');
  return graph;
}

/**
 * The graph, and the patches it emitted, in the order it emitted them.
 *
 * The tests build their patches this way rather than by hand because that is
 * the shape a consumer has: `Graph.subscribe` hands a listener one frozen patch
 * per mutating call, AFTER the call is committed, which is exactly the sequence
 * `relayout` is written against.
 */
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

/** Node boxes as plain records, which is what two runs are compared on. */
function boxes(result: LayoutResult): Record<string, [number, number, number, number]> {
  const out: Record<string, [number, number, number, number]> = {};
  for (const [id, node] of result.nodes) out[id] = [node.x, node.y, node.width, node.height];
  return out;
}

describe('engine.relayout', () => {
  it('emits a delta describing what the patch changed', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('e');
    graph.addEdge('d', 'e', 'de');
    const { delta } = engine.relayout(patches.flat());

    expect(delta.nodes.added.map((node) => node.id)).toEqual(['e']);
    expect(delta.edges.added.map((edge) => edge.id)).toEqual(['de']);
    expect(delta.nodes.removed).toEqual([]);
  });

  // The headline promise of this task, and the reason it is worth shipping a
  // relayout that is no faster than a cold run: whatever the engine retains, the
  // answer is the one the pipeline would give a caller who threw the engine away
  // and started again.
  it('lands the same geometry a cold run of the same graph does', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('e');
    graph.addEdge('d', 'e', 'de');
    graph.removeEdge('ac');
    const relaid = engine.relayout(patches.flat());

    expect(boxes(relaid.result)).toEqual(boxes(layout({ graph })));
  });

  // M3.3's evidence, landed here because this is the run that can produce it: a
  // sequence of single patches through `relayout` against the one combined edit.
  // Whatever M3.3 decides about batching, the answer has to be the same layout.
  it('composes over a sequence of single patches', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('e');
    engine.relayout(last(patches));
    graph.addEdge('d', 'e', 'de');
    engine.relayout(last(patches));
    graph.addEdge('a', 'e', 'ae');
    const stepwise = engine.relayout(last(patches));

    const combined = diamond();
    combined.addNode('e');
    combined.addEdge('d', 'e', 'de');
    combined.addEdge('a', 'e', 'ae');
    expect(boxes(stepwise.result)).toEqual(boxes(layout({ graph: combined })));
  });

  it('reports an empty delta for a patch that changed nothing about the drawing', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.updateNodeAttrs('a', { colour: 'green' });
    const { delta } = engine.relayout(last(patches));

    expect(isEmptyDelta(delta)).toBe(true);
  });

  it('refuses to relayout an engine that has never run', () => {
    expect(() => createLayout().relayout([])).toThrow(EngineStateError);
  });

  // The one mistake the "your graph is already mutated" contract invites. A
  // caller who expects `relayout` to apply the patch for them gets an error
  // rather than an empty delta and a drawing that never changes.
  it('refuses a patch the graph does not show', () => {
    const graph = diamond();
    const engine = createLayout();
    engine.run(graph);

    const unapplied: Patch = [{ op: 'add-node', id: 'e', attrs: {}, ports: [] }];
    expect(() => engine.relayout(unapplied)).toThrow(EngineStateError);
    expect(() => engine.relayout(unapplied)).toThrow(/"e"/u);
  });

  it('accepts a patch whose own ops cancel out', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('e');
    graph.removeNode('e');
    expect(() => engine.relayout(patches.flat())).not.toThrow();
  });
});

describe('the influence set', () => {
  it('names the whole roster, which is what its trivial implementation is', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('e');
    const { influence } = engine.relayout(last(patches));

    expect([...influence.nodes]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...influence.edges]).toEqual(['ab', 'ac', 'bd', 'cd']);
  });

  // M3.5's property test is "every change in the emitted delta falls inside the
  // influence set", and a removal is a change whose id exists only on the
  // previous side of the patch. A set built from the current graph alone cannot
  // satisfy it.
  it('spans both sides of the patch, so a removed id is in it', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);

    graph.removeNode('b');
    const { influence, delta } = engine.relayout(last(patches));

    expect(delta.nodes.removed).toContain('b');
    expect(influence.nodes.has('b')).toBe(true);
    expect(influence.edges.has('ab')).toBe(true);
  });

  it('names no virtual node, whatever the pipeline made up', () => {
    const graph = new Graph();
    const { patches } = watched(graph);
    for (const id of ['a', 'b', 'c']) graph.addNode(id);
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('b', 'c', 'bc');
    // A long edge, which the default ranker splits into a dummy chain.
    graph.addEdge('a', 'c', 'ac');
    const engine = createLayout();
    engine.run(graph);

    graph.addNode('d');
    const { influence } = engine.relayout(last(patches));

    expect([...influence.nodes]).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the warm-start state the engine retains', () => {
  it('is absent on the first run and is the previous run on the next', () => {
    const recorder = recordingStages();
    const { graph, patches } = watched(diamond());
    const engine = createLayout({ stages: recorder.stages });

    engine.run(graph);
    expect(recorder.inputs.rank?.previous).toBeUndefined();
    const routed = recorder.outputs.rank;

    graph.addNode('e');
    engine.relayout(last(patches));
    expect(recorder.inputs.rank?.previous?.ranks).toEqual(routed?.ranks);
    expect(recorder.inputs.rank?.previous?.positions.size).toBeGreaterThan(0);
    // Every stage, not only the first. The channel is on the record the runner
    // threads through, so the router reads the same object the ranker did, and
    // the stages that warm start later are not all the first one.
    expect(recorder.inputs.route?.previous).toBe(recorder.inputs.rank?.previous);
  });

  // The leak M3.10's churn sequence is written to catch, asserted here in the
  // one form this task can assert it: retained state is rebuilt from the run it
  // came from, so a node that went away is not in it.
  it('holds nothing for a node the patch removed', () => {
    const recorder = recordingStages();
    const { graph, patches } = watched(diamond());
    const engine = createLayout({ stages: recorder.stages });
    engine.run(graph);

    graph.removeNode('b');
    engine.relayout(last(patches));
    graph.addNode('e');
    engine.relayout(last(patches));

    expect(recorder.inputs.rank?.previous?.ranks.has('b')).toBe(false);
    expect(recorder.inputs.rank?.previous?.sizes.has('b')).toBe(false);
  });

  // The leak this task's entry predicted, arriving through the mechanism it did
  // not: `previous` is a field on the record every stage reads, so the runner
  // carries it forward to the RoutedState the engine then retains, and a warm
  // start feeding that back in chains one full pipeline state onto the front of
  // the last on every single relayout. Twenty edits retained twenty runs. It is
  // proportional to PATCH HISTORY rather than to the live graph, which is the
  // exact shape M3.10's churn sequence exists to catch, and no assertion that
  // looks only at the newest link can see it.
  it('does not chain, so an editing session retains one run and not all of them', () => {
    const recorder = recordingStages();
    const { graph, patches } = watched(diamond());
    const engine = createLayout({ stages: recorder.stages });
    engine.run(graph);

    for (let step = 0; step < 20; step += 1) {
      graph.updateNodeAttrs('a', { touched: step });
      engine.relayout(last(patches));
    }

    // Walked at RUNTIME rather than trusted to the type. `PreviousLayout` now
    // subtracts `previous`, so a type-level check here would assert what the
    // compiler already knows and would say nothing about the object, which is
    // where the chain actually was: an `Omit` narrows a view and strips nothing.
    type Link = { previous?: unknown } | undefined;
    let depth = 0;
    let link = recorder.inputs.rank?.previous as unknown as Link;
    while (link !== undefined) {
      depth += 1;
      link = link.previous as Link;
    }
    expect(depth).toBe(1);
  });

  it('is not carried across a cold run of another graph', () => {
    const recorder = recordingStages();
    const engine = createLayout({ stages: recorder.stages });
    engine.run(diamond());
    engine.run(diamond());
    expect(recorder.inputs.rank?.previous).toBeUndefined();
  });
});

describe('the engine tolerance', () => {
  /** A position stage that nudges one node a little further each run. */
  function drifting(step: number): PositionStage {
    let runs = 0;
    return {
      name: 'drifting-position',
      run(input) {
        runs += 1;
        const positions = new Map<string, { x: number; y: number }>();
        let index = 0;
        for (const layer of input.layers) {
          for (const id of layer) {
            positions.set(id, { x: id === 'a' ? runs * step : index * 100, y: index * 100 });
            index += 1;
          }
        }
        return { positions };
      },
    };
  }

  it('refuses an epsilon that is not a usable number', () => {
    expect(() => createLayout({ epsilon: -1 })).toThrow(InvalidConfigError);
    expect(() => createLayout({ epsilon: Number.NaN })).toThrow(InvalidConfigError);
  });

  it('withholds a move smaller than the tolerance, and reports it without one', () => {
    const quiet = watched(diamond());
    const withheld = createLayout({ epsilon: 10, stages: { position: drifting(1) } });
    withheld.run(quiet.graph);
    quiet.graph.updateNodeAttrs('a', { touched: 1 });
    expect(withheld.relayout(last(quiet.patches)).delta.nodes.moved).toEqual([]);

    // The same move through an engine at the default tolerance, so the test
    // above is about the epsilon rather than about a stage that did nothing.
    const loud = watched(diamond());
    const reporting = createLayout({ stages: { position: drifting(1) } });
    reporting.run(loud.graph);
    loud.graph.updateNodeAttrs('a', { touched: 1 });
    expect(reporting.relayout(last(loud.patches)).delta.nodes.moved.map((n) => n.id)).toEqual(['a']);
  });

  // The non-transitivity M3.1 measured, now at the level that has to survive it.
  // Fifty steps of 0.9 epsilon each: an engine diffing against its last COMPUTED
  // result would report nothing at all and leave the caller 45 epsilon behind
  // the drawing, and one diffing against the geometry it last REPORTED stays
  // within one. The node really is at 9 * 51 by the end.
  it('diffs against the geometry it last reported, so nothing drifts away', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout({ epsilon: 10, stages: { position: drifting(9) } });
    // What a consumer holding nothing but the deltas ends up with.
    let accumulated = engine.run(graph);
    let steps = 1;

    for (let step = 0; step < 50; step += 1) {
      graph.updateNodeAttrs('a', { touched: step });
      const { delta, result } = engine.relayout(last(patches));
      steps += 1;
      accumulated = applyDelta(accumulated, delta);
      // The engine and the consumer applying its deltas never disagree, at any
      // point in the sequence.
      expect(boxes(result)).toEqual(boxes(accumulated));
    }

    const drift = Math.abs((boxes(accumulated)['a']?.[0] ?? Number.NaN) - 9 * steps);
    expect(drift).toBeLessThanOrEqual(10);
  });

  it('reports the geometry the deltas add up to, and not the run it just did', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout({ epsilon: 10, stages: { position: drifting(9) } });
    const first = engine.run(graph);

    // The pipeline is at 18 by now and the tolerance withheld the move, so what
    // the engine reports is still 9. This is the assertion the whole choice
    // rests on: what a caller reads and what a caller's deltas add up to are the
    // same geometry, and neither of them is the raw run.
    graph.updateNodeAttrs('a', { touched: 1 });
    const withheld = engine.relayout(last(patches));
    expect(withheld.delta.nodes.moved).toEqual([]);
    expect(boxes(withheld.result)['a']?.[0]).toBe(9);
    expect(boxes(withheld.result)).toEqual(boxes(applyDelta(first, withheld.delta)));

    // And the step that does clear the tolerance carries the whole accumulated
    // move rather than one step of it.
    graph.updateNodeAttrs('a', { touched: 2 });
    const reported = engine.relayout(last(patches));
    expect(reported.delta.nodes.moved.map((node) => node.id)).toEqual(['a']);
    expect(boxes(reported.result)['a']?.[0]).toBe(27);
    expect(boxes(reported.result)).toEqual(boxes(applyDelta(withheld.result, reported.delta)));
  });
});

describe('engine.relayoutAsync', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  function channel(): { readonly engineSide: LayoutEngine } {
    const { port1, port2 } = new MessageChannel();
    const stop = serveLayout(port2);
    closers.push(() => {
      stop();
      port1.close();
      port2.close();
    });
    return { engineSide: createLayout({ worker: port1 }) };
  }

  it('answers with the same deltas the synchronous call does', async () => {
    const { graph, patches } = watched(diamond());
    const engine = channel().engineSide;
    await engine.runAsync(graph);

    graph.addNode('e');
    graph.addEdge('d', 'e', 'de');
    const remote = await engine.relayoutAsync(patches.flat());

    const local = createLayout();
    const twin = watched(diamond());
    local.run(twin.graph);
    twin.graph.addNode('e');
    twin.graph.addEdge('d', 'e', 'de');
    const here = local.relayout(twin.patches.flat());

    expect(boxes(remote.result)).toEqual(boxes(here.result));
    expect(remote.delta).toEqual(here.delta);
  });

  it('rejects rather than throwing when there is nothing to relayout', async () => {
    await expect(createLayout().relayoutAsync([])).rejects.toBeInstanceOf(EngineStateError);
  });

  /**
   * A port that holds the worker's answers until a test lets them through, so
   * the overlap the protocol allows can be arranged rather than raced for.
   */
  function gated(port: LayoutPort): LayoutPort & {
    readonly held: () => number;
    readonly release: () => void;
  } {
    type Event = { readonly data: unknown };
    const queued: Event[] = [];
    const listeners = new Set<(event: Event) => void>();
    let open = false;
    const deliver = (event: Event): void => {
      for (const listener of [...listeners]) listener(event);
    };
    port.addEventListener('message', (event: Event) => {
      if (open) deliver(event);
      else queued.push(event);
    });
    port.start?.();
    return {
      postMessage: (message: unknown, transfer: ArrayBuffer[]) => {
        port.postMessage(message, transfer);
      },
      addEventListener: (_type: 'message', listener: (event: Event) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'message', listener: (event: Event) => void) => {
        listeners.delete(listener);
      },
      held: () => queued.length,
      release: () => {
        open = true;
        for (const event of queued.splice(0)) deliver(event);
      },
    };
  }

  // Runs may overlap, which M2.10 decided and this task inherits, so a relayout
  // in a worker can be overtaken by one served here. The answer is odd either
  // way, because the worker laid out the graph as it was when the run was sent.
  // What must not happen is an INCONSISTENT one: the delta a caller is handed
  // has to apply to the geometry they are currently holding, and it does only
  // because the engine diffs against what it last reported at the moment it
  // reports rather than against what was current when the relayout started.
  it('hands back a delta that applies to what the caller is holding, even when overtaken', async () => {
    const { port1, port2 } = new MessageChannel();
    const stop = serveLayout(port2);
    const hold = gated(port1);
    closers.push(() => {
      stop();
      port1.close();
      port2.close();
    });

    const { graph, patches } = watched(diamond());
    const engine = createLayout({ worker: hold });
    engine.run(graph);

    graph.addNode('e');
    const inFlight = engine.relayoutAsync(last(patches));
    graph.addNode('f');
    const overtaking = engine.relayout(last(patches));

    // The worker's answer crosses the channel on its own schedule, so the
    // overlap is arranged by waiting for it to be held rather than assumed.
    while (hold.held() === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    hold.release();
    const late = await inFlight;
    expect(boxes(applyDelta(overtaking.result, late.delta))).toEqual(boxes(late.result));
  });
});

describe('engine.dispose', () => {
  it('releases what the engine was holding, and says so on the next call', () => {
    const { graph, patches } = watched(diamond());
    const engine = createLayout();
    engine.run(graph);
    engine.dispose();

    graph.addNode('e');
    expect(() => engine.relayout(last(patches))).toThrow(EngineStateError);
    expect(() => engine.run(graph)).toThrow(EngineStateError);
  });

  it('is idempotent', () => {
    const engine = createLayout();
    engine.run(diamond());
    engine.dispose();
    expect(() => {
      engine.dispose();
    }).not.toThrow();
  });

  it('rejects the asynchronous entry points rather than throwing', async () => {
    const engine = createLayout();
    engine.dispose();
    await expect(engine.runAsync(diamond())).rejects.toBeInstanceOf(EngineStateError);
    await expect(engine.relayoutAsync([])).rejects.toBeInstanceOf(EngineStateError);
  });
});
