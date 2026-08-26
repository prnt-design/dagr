import { Graph } from '@dagr/graph';
import type { NodeId, Patch } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { InvalidConfigError, createLayout, influenceRegion, stabilityViolations } from '../src/index.js';
import type { InfluenceSet, PreviousLayout, Size } from '../src/index.js';
import { prepare, runPipeline } from '../src/pipeline.js';
import { mulberry32, randomLayered } from './random.js';

/** What `nodeSize` is given, which is the node record and nothing else. */
type Sizer = (node: { readonly id: NodeId }) => Size;

/**
 * The pipeline state a relayout warm starts from, built the way the engine
 * builds it.
 *
 * The engine retains this privately, so a unit test of the bound has to run the
 * pipeline itself. It is the record `warmStartOf` produces: a `RoutedState`
 * without the graph, the config and its own `previous`.
 */
function pipelineState(
  graph: Graph,
  nodeSize?: Sizer,
): { readonly previous: PreviousLayout; readonly sizes: ReadonlyMap<NodeId, Size> } {
  const { routed } = runPipeline(prepare(graph, resolveConfig(undefined), nodeSize));
  const { sizes, ranks, reversedEdges, virtualNodes, virtualChains, layers, positions, routes } =
    routed;
  return {
    previous: {
      sizes,
      ranks,
      reversedEdges,
      virtualNodes,
      virtualChains,
      layers,
      positions,
      routes,
    },
    sizes,
  };
}

/** A reader for the last patch a graph emitted, which is what a relayout takes. */
function watched(graph: Graph): () => Patch {
  let last: Patch = [];
  graph.subscribe((patch) => {
    last = patch;
  });
  return () => last;
}

/**
 * The region of one edit, made against a graph that has already been laid out.
 *
 * The edit runs inside `graph.batch`, which is M3.3's hand-off and is what a
 * consumer editing more than one thing is told to do: an unbatched multi-step
 * edit arrives as several patches, and the region of the first one is a bound
 * on a graph state nobody meant to draw.
 */
function regionOf(
  graph: Graph,
  edit: () => void,
  options: { readonly rankWindow?: number; readonly nodeSize?: Sizer } = {},
): InfluenceSet {
  const { previous } = pipelineState(graph, options.nodeSize);
  const patch = watched(graph);
  graph.batch(edit);
  const { sizes } = pipelineState(graph, options.nodeSize);
  return influenceRegion({
    graph,
    patch: patch(),
    previous,
    sizes,
    ...(options.rankWindow === undefined ? {} : { rankWindow: options.rankWindow }),
  });
}

/** Ids as a sorted array, which is what a set is readable as in a failure. */
function ids(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

/**
 * Two components of three ranks each, sharing every rank and joined by nothing.
 *
 * `a1 -> a2 -> a4` and `a1 -> a3 -> a4` beside `b1 -> b2 -> b3`, which puts a
 * node of each component on ranks 0, 1 and 2. It is the graph the
 * cross-component question is asked over, because sharing a rank is exactly how
 * influence reaches a component nothing connects to.
 */
function twoComponents(): Graph {
  const graph = new Graph();
  for (const id of ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3']) graph.addNode(id);
  graph.addEdge('a1', 'a2', 'a12');
  graph.addEdge('a1', 'a3', 'a13');
  graph.addEdge('a2', 'a4', 'a24');
  graph.addEdge('a3', 'a4', 'a34');
  graph.addEdge('b1', 'b2', 'b12');
  graph.addEdge('b2', 'b3', 'b23');
  return graph;
}

/** A chain of `length` nodes, one per rank, for the questions about ranks. */
function chain(length: number): Graph {
  const graph = new Graph();
  for (let index = 0; index < length; index += 1) graph.addNode(`n${String(index)}`);
  for (let index = 1; index < length; index += 1) {
    graph.addEdge(`n${String(index - 1)}`, `n${String(index)}`, `e${String(index)}`);
  }
  return graph;
}

describe('influenceRegion', () => {
  it('names the ranks the patch reaches and leaves the rest of the drawing out', () => {
    const graph = chain(6);
    const region = regionOf(graph, () => {
      graph.addNode('leaf');
      graph.addEdge('n1', 'leaf', 'toLeaf');
    });

    // `leaf` lands one below `n1`, so ranks 1 and 2 are what the patch touches
    // and the default window of one rank takes 0 and 3 with them.
    expect(ids(region.nodes)).toEqual(['leaf', 'n0', 'n1', 'n2', 'n3']);
  });

  it('takes only the touched ranks at a window of zero', () => {
    const graph = chain(6);
    const region = regionOf(
      graph,
      () => {
        graph.addNode('leaf');
        graph.addEdge('n1', 'leaf', 'toLeaf');
      },
      { rankWindow: 0 },
    );

    expect(ids(region.nodes)).toEqual(['leaf', 'n1', 'n2']);
  });

  it('names an edge whose route crosses the band with neither endpoint in it', () => {
    const graph = chain(6);
    // A long edge from the top of the drawing to the bottom, which the ranker
    // splits into a dummy chain passing through every rank between.
    graph.addEdge('n0', 'n5', 'long');
    const region = regionOf(
      graph,
      () => {
        graph.addNode('leaf');
        graph.addEdge('n2', 'leaf', 'toLeaf');
      },
      { rankWindow: 0 },
    );

    expect(region.nodes.has('n0')).toBe(false);
    expect(region.nodes.has('n5')).toBe(false);
    expect(region.edges.has('long')).toBe(true);
  });

  it('names nothing a caller cannot see', () => {
    const graph = chain(6);
    graph.addEdge('n0', 'n5', 'long');
    const region = regionOf(graph, () => {
      graph.addNode('leaf');
      graph.addEdge('n2', 'leaf', 'toLeaf');
    });

    for (const id of region.nodes) {
      expect(id.startsWith('#dummy:')).toBe(false);
      expect(graph.hasNode(id)).toBe(true);
    }
    for (const id of region.edges) expect(graph.hasEdge(id)).toBe(true);
  });

  it('names a removed node, which exists only on the previous side', () => {
    const graph = chain(6);
    const region = regionOf(graph, () => {
      graph.removeNode('n2');
    });

    expect(region.nodes.has('n2')).toBe(true);
    expect(graph.hasNode('n2')).toBe(false);
  });

  it('keeps the band for an added edge that already runs downhill', () => {
    const graph = chain(6);
    // `n4` sits three ranks below `n1`, so the constraint this edge adds is one
    // the ranking already satisfies and no rank moves.
    const region = regionOf(
      graph,
      () => {
        graph.addEdge('n1', 'n4', 'shortcut');
      },
      { rankWindow: 0 },
    );

    expect(region.nodes.has('n0')).toBe(false);
    expect(ids(region.nodes)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('widens to the whole roster when an added edge inverts a rank order', () => {
    const graph = chain(6);
    const region = regionOf(graph, () => {
      graph.addEdge('n4', 'n1', 'back');
    });

    expect(ids(region.nodes)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('widens to the whole roster when a removal frees its target to rise', () => {
    const graph = chain(6);
    const region = regionOf(graph, () => {
      graph.removeEdge('e3');
    });

    // `n3` had one predecessor and now has none, so it rises to the top of the
    // drawing and takes everything under it with it.
    expect(ids(region.nodes)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('keeps the band when another predecessor pins the rank a removal freed', () => {
    const graph = chain(6);
    graph.addNode('side');
    graph.addEdge('n1', 'side', 'toSide');
    graph.addEdge('side', 'n3', 'sideDown');
    const region = regionOf(
      graph,
      () => {
        graph.removeEdge('e3');
      },
      { rankWindow: 0 },
    );

    // `side` still points at `n3` from rank 2, so `n3` stays where it is and
    // the bottom of the drawing is out of the region.
    expect(region.nodes.has('n5')).toBe(false);
  });

  it('extends to the bottom when an added node makes its row taller', () => {
    const graph = chain(6);
    const nodeSize: Sizer = (node) =>
      node.id === 'tall' ? { width: 100, height: 400 } : { width: 100, height: 40 };
    const region = regionOf(
      graph,
      () => {
        graph.addNode('tall');
        graph.addEdge('n1', 'tall', 'toTall');
      },
      { nodeSize, rankWindow: 0 },
    );

    // Rows stack from y = 0 and a row is as tall as its tallest node, so a
    // taller row moves every row under it however far away.
    expect(region.nodes.has('n5')).toBe(true);
  });

  it('does not extend to the bottom when the added node fits its row', () => {
    const graph = chain(6);
    const nodeSize: Sizer = (node) =>
      node.id === 'short' ? { width: 100, height: 10 } : { width: 100, height: 40 };
    const region = regionOf(
      graph,
      () => {
        graph.addNode('short');
        graph.addEdge('n1', 'short', 'toShort');
      },
      { nodeSize, rankWindow: 0 },
    );

    expect(region.nodes.has('n5')).toBe(false);
  });

  it('extends to the bottom when the only tallest node in a row leaves', () => {
    const graph = chain(6);
    const nodeSize: Sizer = (node) =>
      node.id === 'n1' ? { width: 100, height: 400 } : { width: 100, height: 40 };
    const region = regionOf(
      graph,
      () => {
        graph.removeNode('n1');
      },
      { nodeSize, rankWindow: 0 },
    );

    expect(region.nodes.has('n5')).toBe(true);
  });

  it('names the edges a port move can reattach and widens no band', () => {
    const graph = chain(6);
    const region = regionOf(graph, () => {
      graph.addPort('n2', { id: 'in' });
    });

    expect(ids(region.nodes)).toEqual(['n2']);
    expect(ids(region.edges)).toEqual(['e2', 'e3']);
  });

  // M5.5. Nothing in this package reads `parent`, so a reparent moves no node
  // and the exact bound on it is the empty one. The case is explicit rather
  // than left to the `default` arm so that M7, which is the task that does read
  // `parent`, finds a case to change instead of a silence to notice.
  it('names nothing for a reparent, because no stage reads containment', () => {
    const graph = chain(6);
    graph.addNode('box');
    const region = regionOf(graph, () => {
      graph.setNodeParent('n2', 'box');
    });

    // Empty, and empty is exact rather than optimistic: the drawing after the
    // reparent is the drawing before it, down to the coordinate. `box` was in
    // the previous run, so it is not named either, which is what makes this
    // about containment rather than about a node the patch arrived with.
    expect(ids(region.nodes)).toEqual([]);
    expect(ids(region.edges)).toEqual([]);
  });

  it('refuses a rank window it cannot use', () => {
    const graph = chain(6);
    const { previous, sizes } = pipelineState(graph);
    for (const rankWindow of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => influenceRegion({ graph, patch: [], previous, sizes, rankWindow })).toThrow(
        InvalidConfigError,
      );
    }
  });
});

describe('influence regions across components', () => {
  it('names a node in another component that shares a touched rank', () => {
    const graph = twoComponents();
    const region = regionOf(
      graph,
      () => {
        graph.addNode('a5');
        graph.addEdge('a1', 'a5', 'a15');
      },
      { rankWindow: 0 },
    );

    // The property this task was written expecting is FALSE for this pipeline,
    // and it is false for the reason the milestone entry itself gives:
    // influence travels sideways within a rank. `b2` shares rank 1 with the
    // insertion, is connected to it by nothing at all, and moves.
    expect(region.nodes.has('b2')).toBe(true);
  });

  it('names nothing in another component outside the band', () => {
    const graph = twoComponents();
    const region = regionOf(
      graph,
      () => {
        graph.addNode('a5');
        graph.addEdge('a1', 'a5', 'a15');
      },
      { rankWindow: 0 },
    );

    expect(region.nodes.has('b3')).toBe(false);
    // Its edge is still named, because `b2` moving is `b23` rerouting.
    expect(region.edges.has('b23')).toBe(true);
  });

  it('moves the node in the other component, which is what makes that the answer', () => {
    const graph = twoComponents();
    const engine = createLayout();
    const before = engine.run(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('a5');
      graph.addEdge('a1', 'a5', 'a15');
    });
    const { result } = engine.relayout(patch());

    const b2Before = before.nodes.get('b2');
    const b2After = result.nodes.get('b2');
    expect(b2Before?.x).not.toBe(b2After?.x);
    // And a node of that component one rank further down does not.
    expect(before.nodes.get('b3')?.x).toBe(result.nodes.get('b3')?.x);
  });
});

/**
 * What a relayout does outside the bound, measured rather than guessed.
 *
 * This is the distance between the two sets `RelayoutResult` carries, and it is
 * the number the rest of M3 closes: every violation here is a node or an edge
 * the region says a confined relayout may leave alone and the run moved anyway.
 * The ceilings are upper bounds in the sense M3.4's `StabilityBounds` are, so a
 * task that lowers one needs no test change and a task that raises one past its
 * ceiling stops the build.
 *
 * ALL FOUR ARE ZERO SINCE M3.6, and this describe block is named for the cold
 * fallback because that is what it measured when M3.5 wrote it. M3.5 recorded
 * 8, 11, 15 and 0 escapes here and named the cause: every one of them was the
 * cold barycenter sweep reordering a rank the patch never came near. M3.6's
 * warm start is the constraint that stops exactly that, and it closed the gap
 * outright rather than narrowing it. What is left inside the bound is still
 * everything: the region is 48% to 86% of the roster on these graphs, so this
 * says the run respects a wide bound and not that it is confined.
 *
 * The corpus is `randomLayered`, which is the population the crossing suites
 * already run over, at four patch kinds, all batched. It is not M3.10a's
 * committed session corpus and does not want to be: this measures ONE relayout
 * per graph against ONE bound, where that one measures a session of them
 * against the stability metrics.
 */
const CORPUS_CEILINGS: Record<PatchKind, { readonly escaped: number; readonly violations: number }> =
  {
    'add-leaf': { escaped: 0, violations: 0 },
    'remove-node': { escaped: 0, violations: 0 },
    'remove-edge': { escaped: 0, violations: 0 },
    // The one kind that was inside its bound on every graph in the corpus
    // before M3.6 as well, and it is the one that changes no rank and no
    // barycenter: a wider node re-centres its own row and nothing else. M3.9b's
    // attribute fast path is written over exactly this case.
    resize: { escaped: 0, violations: 0 },
  };

type PatchKind = 'add-leaf' | 'remove-node' | 'remove-edge' | 'resize';

/**
 * An engine that sizes a node from its attributes, so the corpus has a resize
 * to measure.
 *
 * Without this the `resize` kind is an attribute change nothing reads, which
 * lays the graph out identically and would pass the assertions below by moving
 * nothing at all.
 */
function sizingEngine(): ReturnType<typeof createLayout> {
  return createLayout({
    config: {
      nodeSize: (node): Size => ({
        width: node.attrs['touched'] === true ? 220 : 100,
        height: 40,
      }),
    },
  });
}

/** Applies one kind of edit to a graph, batched, and answers whether it did. */
function edit(graph: Graph, kind: PatchKind, random: () => number): boolean {
  const nodes = graph.nodes();
  const host = nodes[Math.floor(random() * nodes.length)];
  const edges = graph.edges();
  const victim = edges[Math.floor(random() * edges.length)];
  if (host === undefined) return false;
  if (kind === 'remove-edge' && victim === undefined) return false;
  graph.batch(() => {
    if (kind === 'add-leaf') {
      graph.addNode('newcomer');
      graph.addEdge(host.id, 'newcomer', 'newEdge');
    } else if (kind === 'remove-node') {
      graph.removeNode(host.id);
    } else if (kind === 'remove-edge' && victim !== undefined) {
      graph.removeEdge(victim.id);
    } else if (kind === 'resize') {
      graph.updateNodeAttrs(host.id, { touched: true });
    }
  });
  return true;
}

describe('the cold fallback against the region', () => {
  for (const kind of ['add-leaf', 'remove-node', 'remove-edge', 'resize'] as PatchKind[]) {
    it(`escapes the bound on no more than the recorded share of thirty ${kind} patches`, () => {
      let escaped = 0;
      let violations = 0;
      let changes = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const random = mulberry32(seed * 7 + 1);
        const { graph } = randomLayered(random, 40, 6, 60);
        const engine = sizingEngine();
        const before = engine.run(graph);
        const patch = watched(graph);
        if (!edit(graph, kind, random)) continue;
        const { result, delta, region } = engine.relayout(patch());
        const found = stabilityViolations(before, result, region);
        if (found.length > 0) escaped += 1;
        violations += found.length;
        changes += delta.nodes.moved.length + delta.edges.rerouted.length;
      }

      const ceiling = CORPUS_CEILINGS[kind];
      expect(escaped).toBeLessThanOrEqual(ceiling.escaped);
      expect(violations).toBeLessThanOrEqual(ceiling.violations);
      // A corpus that stopped editing anything would satisfy both ceilings
      // perfectly, so it has to say that it moved something.
      expect(changes).toBeGreaterThan(0);
    });
  }

  it('reports violations against a region narrowed by hand', () => {
    // The negative half, which M3.4 shipped its own version of and for the same
    // reason: a corpus that reports nothing proves nothing unless the same
    // checker is shown reporting something. A region of one node cannot bound
    // an insertion, and the assertions above would pass over a checker that had
    // stopped looking.
    const graph = twoComponents();
    const engine = createLayout();
    const before = engine.run(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('a5');
      graph.addEdge('a1', 'a5', 'a15');
    });
    const { result } = engine.relayout(patch());
    const narrowed: InfluenceSet = { nodes: new Set(['a5']), edges: new Set() };

    expect(stabilityViolations(before, result, narrowed).length).toBeGreaterThan(0);
  });
});

describe('engine.relayout regions', () => {
  it('reports the region beside the influence set it does not yet narrow', () => {
    const graph = chain(6);
    const engine = createLayout();
    engine.run(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('leaf');
      graph.addEdge('n1', 'leaf', 'toLeaf');
    });
    const { influence, region } = engine.relayout(patch());

    expect(influence.nodes.has('n5')).toBe(true);
    expect(region.nodes.has('n5')).toBe(false);
    expect(region.nodes.size).toBeLessThan(influence.nodes.size);
  });

  it('bounds a relayout it served itself, after a run it served itself', async () => {
    const graph = chain(6);
    const engine = createLayout();
    await engine.runAsync(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('leaf');
      graph.addEdge('n1', 'leaf', 'toLeaf');
    });
    const { region } = await engine.relayoutAsync(patch());

    expect(region.nodes.has('n5')).toBe(false);
  });

  it('stays inside the region it reported, for an insertion that widens one rank', () => {
    const graph = twoComponents();
    const engine = createLayout();
    const before = engine.run(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('a5');
      graph.addEdge('a1', 'a5', 'a15');
    });
    const { result, region } = engine.relayout(patch());

    expect(stabilityViolations(before, result, region)).toEqual([]);
  });
});
