import { Graph } from '@dagr/graph';
import type { NodeId, Patch } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, resolveConfig } from '../src/config.js';
import { barycenterOrder, countCrossings } from '../src/order.js';
import { createLayout } from '../src/engine.js';
import { prepare, runPipeline } from '../src/pipeline.js';
import { goldenCorpus, buildCorpusGraph } from './golden-corpus.js';
import { mulberry32, randomLayered } from './random.js';
import type { PreviousLayout, RankedState, RoutedState, Size } from '../src/types.js';

/**
 * M3.6: the order stage seeded from the run before it.
 *
 * Two halves, and they fail in different places, so they are tested in
 * different registers. THE CHANNEL is `PreparedState.previous`, which M3.2
 * opened and nobody read: the stage now reads `previous.layers` and a relayout
 * therefore starts from the permutation the user is already looking at. THE
 * RULE is what the seed is allowed to say, and it is a rule about COHORTS: two
 * ids the previous run drew in different layers say nothing about each other,
 * so when they meet in one layer here the walk decides, and each cohort is
 * permuted only into the slots its own members already hold.
 *
 * The price is in `barycenterOrder`'s own docstring and is measured at the foot
 * of this file: a warm start is a constraint on the crossing search, so it
 * cannot beat an unconstrained sweep, and the tolerance is named there.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/**
 * A `RankedState` with the ranks written out as the layers they stand for, and
 * an optional warm start hanging off it.
 *
 * The same helper `layout.order.test.ts` uses, with the one field this file is
 * about. Going through a real ranker would tie every case below to what
 * `longestPathRankStage` happens to do with the witness graph, which is not
 * what any of them is about.
 */
function stateOf(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  previousLayers?: readonly (readonly NodeId[])[],
): RankedState {
  const ranks = new Map<NodeId, number>();
  for (const [rank, ids] of layers.entries()) {
    for (const id of ids) ranks.set(id, rank);
  }
  const sizes = new Map<NodeId, Size>();
  for (const id of ranks.keys()) sizes.set(id, { width: 10, height: 10 });
  const state: RankedState = {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks,
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
  };
  if (previousLayers === undefined) return state;
  return { ...state, previous: previousStateOf(previousLayers) };
}

/**
 * A `PreviousLayout` carrying nothing but the layers, which is all this stage
 * reads of one.
 *
 * The other seven fields are filled with empties rather than with a second
 * pipeline run: a stage that started reading one of them would be reading a
 * record no engine ever produces, and that is a change to catch here rather
 * than to accommodate.
 */
function previousStateOf(layers: readonly (readonly NodeId[])[]): PreviousLayout {
  return {
    sizes: new Map(),
    ranks: new Map(),
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
    layers,
    positions: new Map(),
    routes: new Map(),
  };
}

/** The layers a stage produces for a state, as plain arrays for comparison. */
function ordered(state: RankedState, options?: Parameters<typeof barycenterOrder>[0]): NodeId[][] {
  return barycenterOrder({ maxTransposePasses: 0, ...options })
    .run(state)
    .layers.map((layer) => [...layer]);
}

/**
 * The warm start a run leaves behind, built the way the engine builds it.
 *
 * The engine's own `warmStartOf` is private, so a test that runs the pipeline
 * itself has to name the eight fields. That is the point rather than a
 * duplication: `PreviousLayout` is an `Omit` of `RoutedState`, so a stage
 * output added to that record stops this line compiling until it says what a
 * warm start should do with the new field.
 */
function warmStartOf(routed: RoutedState): PreviousLayout {
  const { sizes, ranks, reversedEdges, virtualNodes, virtualChains, layers, positions, routes } =
    routed;
  return { sizes, ranks, reversedEdges, virtualNodes, virtualChains, layers, positions, routes };
}

/** A reader for the last patch a graph emitted, which is what a relayout takes. */
function watched(graph: Graph): () => Patch {
  let last: Patch = [];
  graph.subscribe((patch) => {
    last = patch;
  });
  return () => last;
}

describe('the order stage reads the warm-start channel', () => {
  const graph = build(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'd'],
      ['b', 'c'],
    ],
  );
  const layers = [
    ['a', 'b'],
    ['c', 'd'],
  ];

  it('seeds from previous.layers, which nothing read before M3.6', () => {
    const cold = ordered(stateOf(graph, layers), { maxSweeps: 0 });
    expect(cold).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ]);
    const warm = ordered(
      stateOf(graph, layers, [
        ['b', 'a'],
        ['c', 'd'],
      ]),
      { maxSweeps: 0 },
    );
    expect(warm).toEqual([
      ['b', 'a'],
      ['c', 'd'],
    ]);
  });

  /**
   * PRECEDENCE, and it is the freshest layering that wins rather than the most
   * explicit one. `initialOrder` is a constant bound when the stage was built;
   * `previous.layers` is the run immediately before this one. A stage that
   * preferred the constant would hand the same frozen hint back on every
   * relayout for the life of the engine, which is churn rather than stability,
   * and it is the one thing the channel exists to stop.
   */
  it('prefers previous.layers to the initialOrder a stage was built with', () => {
    const warm = ordered(
      stateOf(graph, layers, [
        ['b', 'a'],
        ['c', 'd'],
      ]),
      {
        maxSweeps: 0,
        initialOrder: [
          ['a', 'b'],
          ['d', 'c'],
        ],
      },
    );
    expect(warm).toEqual([
      ['b', 'a'],
      ['c', 'd'],
    ]);
  });

  it('falls back to initialOrder on the run that has no previous', () => {
    const cold = ordered(stateOf(graph, layers), {
      maxSweeps: 0,
      initialOrder: [
        ['b', 'a'],
        ['c', 'd'],
      ],
    });
    expect(cold).toEqual([
      ['b', 'a'],
      ['c', 'd'],
    ]);
  });

  /**
   * The channel is a hint like the option is a hint, so everything
   * the constraint drops is dropped here too. Pinned separately because the two
   * arrive by different routes and only one of them is the caller's own.
   */
  it('ignores previous layers the roster does not hold', () => {
    const warm = ordered(stateOf(graph, layers, [['ghost'], ['phantom']]), { maxSweeps: 0 });
    expect(warm).toEqual(ordered(stateOf(graph, layers), { maxSweeps: 0 }));
  });
});

describe('the cohort rule for a node whose rank changed', () => {
  /**
   * THE RULE M3.6 OWES ITS OWN ENTRY, on the smallest layering that shows it.
   *
   * All four of `x`, `y`, `z` and `w` land in one layer here, and the previous
   * run drew `x` and `y` in one layer and `z` and `w` in another. The hint
   * therefore says where `x` sits relative to `y` and where `z` sits relative
   * to `w`, and NOTHING about `x` against `w`: those two were never in a layer
   * together, so there is no previous relative order of theirs to keep.
   *
   * A key read across cohorts is exactly the `(rank, index)` coupling M3.6
   * rules out, arriving one step removed: `x` at index 0 of its old layer would
   * sort ahead of `w` at index 1 of a different old layer purely on the
   * strength of the two numbers, which is a comparison the previous drawing
   * never made. So each cohort is permuted into the slots its OWN members
   * already hold and the walk decides everything between them.
   */
  it('permutes each cohort within its own slots and lets the walk decide between them', () => {
    const fan = build(
      ['a', 'x', 'y', 'z', 'w'],
      [
        ['a', 'x'],
        ['a', 'y'],
        ['a', 'z'],
        ['a', 'w'],
      ],
    );
    const state = stateOf(fan, [['a'], ['x', 'y', 'z', 'w']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a'], ['x', 'y', 'z', 'w']]);

    // Cohort {x, y} holds slots 0 and 1 and the hint reverses it; cohort
    // {z, w} holds slots 2 and 3 and the hint reverses it too. Neither cohort
    // reaches into the other's slots.
    const swapped = ordered(
      stateOf(fan, [['a'], ['x', 'y', 'z', 'w']], [
        ['y', 'x'],
        ['w', 'z'],
      ]),
      { maxSweeps: 0 },
    );
    expect(swapped).toEqual([['a'], ['y', 'x', 'w', 'z']]);

    // And a hint that agrees with the walk within each cohort moves nothing,
    // whatever the indices say across the two.
    const agreeing = ordered(
      stateOf(fan, [['a'], ['x', 'y', 'z', 'w']], [
        ['x', 'y'],
        ['z', 'w'],
      ]),
      { maxSweeps: 0 },
    );
    expect(agreeing).toEqual([['a'], ['x', 'y', 'z', 'w']]);
  });

  /**
   * The interleaved case, which is the one a global key gets wrong and the one
   * a cohort key has to be shown getting right. The walk puts the two cohorts
   * alternately, `x z y w`, and each cohort's hint reverses it. `x` and `y`
   * hold slots 0 and 2, so they swap into those two and leave slots 1 and 3
   * alone; `z` and `w` do the mirror image.
   */
  it('leaves the slots between a cohort members to the other cohort', () => {
    const fan = build(
      ['a', 'b', 'x', 'z', 'y', 'w'],
      [
        ['a', 'x'],
        ['b', 'z'],
        ['a', 'y'],
        ['b', 'w'],
      ],
    );
    const state = stateOf(fan, [
      ['a', 'b'],
      ['x', 'z', 'y', 'w'],
    ]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['x', 'y', 'z', 'w'],
    ]);
    const warm = ordered(
      stateOf(
        fan,
        [
          ['a', 'b'],
          ['x', 'z', 'y', 'w'],
        ],
        [
          ['y', 'x'],
          ['w', 'z'],
        ],
      ),
      { maxSweeps: 0 },
    );
    expect(warm).toEqual([
      ['a', 'b'],
      ['y', 'x', 'w', 'z'],
    ]);
  });

  /**
   * A newcomer at a rank is a node no cohort there claims, and it keeps the
   * slot the walk gave it, which is the rule an unnamed node already had. This
   * is the M3.6 sentence "it is a newcomer at its new rank": the seed says
   * nothing about it, and the sweeps that follow put it at a barycenter-derived
   * slot among the nodes that did keep theirs.
   */
  it('keeps a newcomer at its walk slot and lets the sweeps place it', () => {
    const fan = build(
      ['a', 'x', 'n', 'y'],
      [
        ['a', 'x'],
        ['a', 'n'],
        ['a', 'y'],
      ],
    );
    const state = stateOf(fan, [['a'], ['x', 'n', 'y']], [['y', 'x']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a'], ['y', 'n', 'x']]);
  });
});

/**
 * The order of the caller's own nodes, layer by layer, as one comparable
 * string.
 *
 * Dummies are left out because their ids are minted per run and a chain that
 * grew a rank mints a new one, so a comparison including them would answer a
 * question about `chains.ts` rather than about this stage. The newcomer is left
 * out for the same reason in reverse: it exists on one side of the comparison
 * only.
 */
function shapeOf(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  newcomer: NodeId,
): string {
  return layers
    .map((layer) => layer.filter((id) => graph.hasNode(id) && id !== newcomer).join(','))
    .filter((line) => line.length > 0)
    .join('|');
}

describe('an unchanged subgraph keeps its order across a relayout', () => {
  /**
   * THE TEST M3.6's ENTRY ASKS FOR, over the corpus rather than over one
   * witness, and pinned against the cold run because an assertion that a warm
   * relayout reproduces its own first run says nothing unless the cold one is
   * shown failing to.
   *
   * Thirty random layered graphs, one added leaf each, and the question is
   * whether the layer-by-layer order of the caller's OWN nodes is the order the
   * first run drew. A cold run keeps it on 17 of the 30; warm started it keeps
   * it on all 30. Both figures are asserted, the cold one as a ceiling: a
   * change that made the COLD run stable would be a change to a different
   * stage, and it should have to say so here rather than quietly making this
   * file's evidence vacuous.
   *
   * Note what this does NOT assert, because M3.5 recorded the trap and it bites
   * exactly here: the untouched nodes keep their ORDER and not their
   * COORDINATES. A row that gained a node got wider, every row is centred on
   * x = 0, so a node that kept its slot in an untouched layer still moves
   * sideways. That is M3.8b's, and `layout.influence.test.ts` is where the
   * coordinate half is measured against the region that admits it.
   */
  it('keeps the order of every untouched node on all thirty graphs', () => {
    let coldKept = 0;
    let warmKept = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = mulberry32(seed * 7 + 1);
      const { graph } = randomLayered(random, 40, 6, 60);
      const config = resolveConfig(undefined);
      const first = runPipeline(prepare(graph, config, undefined));
      const nodes = graph.nodes();
      const host = nodes[Math.floor(random() * nodes.length)];
      if (host === undefined) continue;
      graph.batch(() => {
        graph.addNode('newcomer');
        graph.addEdge(host.id, 'newcomer', 'newEdge');
      });
      const cold = runPipeline(prepare(graph, config, undefined));
      const warm = runPipeline(prepare(graph, config, undefined, warmStartOf(first.routed)));
      const base = shapeOf(graph, first.routed.layers, 'newcomer');
      total += 1;
      if (shapeOf(graph, cold.routed.layers, 'newcomer') === base) coldKept += 1;
      if (shapeOf(graph, warm.routed.layers, 'newcomer') === base) warmKept += 1;
    }

    expect(total).toBe(30);
    expect(warmKept).toBe(30);
    expect(coldKept).toBeLessThanOrEqual(17);
  });

  /**
   * The same claim on a witness small enough to read, which is what says the
   * corpus figure above is measuring what it claims to. Two components, each a
   * small fan, and the leaf lands on one of them: the other keeps the exact
   * left-to-right order the first run gave it.
   */
  it('keeps the untouched component in the order the first run drew it', () => {
    const graph = new Graph();
    for (const id of ['a0', 'a1', 'a2', 'a3', 'a4', 'b0', 'b1', 'b2', 'b3', 'b4']) {
      graph.addNode(id);
    }
    graph.addEdge('a0', 'a2');
    graph.addEdge('a0', 'a3');
    graph.addEdge('a1', 'a2');
    graph.addEdge('a1', 'a4');
    graph.addEdge('b0', 'b2');
    graph.addEdge('b0', 'b3');
    graph.addEdge('b1', 'b2');
    graph.addEdge('b1', 'b4');

    const engine = createLayout();
    const before = engine.run(graph);
    const patch = watched(graph);
    graph.batch(() => {
      graph.addNode('a5');
      graph.addEdge('a1', 'a5');
    });
    const { result } = engine.relayout(patch());

    const across = (from: typeof before, ids: readonly NodeId[]): NodeId[] =>
      [...ids].sort((left, right) => (from.nodes.get(left)?.x ?? 0) - (from.nodes.get(right)?.x ?? 0));
    for (const row of [
      ['b0', 'b1'],
      ['b2', 'b3', 'b4'],
    ]) {
      expect(across(result, row)).toEqual(across(before, row));
    }
  });
});

/**
 * WHAT THE WARM START COSTS IN CROSSINGS, AND WHO SET THE TOLERANCE.
 *
 * A warm start is by construction a constraint on the crossing search: it holds
 * pairs of nodes in an order chosen for continuity rather than for quality, so
 * it cannot beat an unconstrained sweep and should be expected to lose to it.
 * M3.6's entry says to name that number here rather than to leave "an agreed
 * tolerance" to whoever needs to pass it, which is how a milestone quietly
 * redefines its own target. IT IS 2%, A CEILING ON THE RATIO OF WARM CROSSINGS
 * TO COLD CROSSINGS AFTER ONE PATCH, PER GRAPH.
 *
 * WHO SET IT: this task, from the measurement below, and the argument is that
 * the worst measured case is inside it with room and the mean is on the other
 * side of parity. Measured over the six graphs, warm against cold after one
 * added leaf: tall-600 1.0012, wide-600 0.9969, dense-1200 1.0053,
 * sparse-2000 0.9960, self-loops-800 0.9981, parallel-800 1.0159. So three of
 * the six are cheaper warm than cold, and the one entry that pays for the
 * constraint pays 1.59% for it. On the thirty random layered graphs of the
 * stability corpus the warm run is 3.1% CHEAPER in aggregate (1,386 crossings
 * against 1,430), with a worst single graph at 1.0545, and that spread is why
 * the committed tolerance is per graph over the committed corpus rather than an
 * aggregate over a population nobody has pinned.
 *
 * THE TOLERANCE IS NOT A BUDGET TO SPEND. A task that pushes a corpus entry
 * past it has changed what the constraint is worth and owes its entry an
 * argument, which is exactly how `CORPUS_CEILINGS` works in
 * `layout.influence.test.ts`.
 *
 * The corpus is the six graphs of `golden-corpus.ts`, which is what M2.6
 * committed and what M3.6's entry names. Each is laid out cold, given one added
 * leaf, and laid out again twice: once with the channel and once without.
 */
const CROSSING_TOLERANCE = 1.02;

describe('the crossing price of the warm start', () => {
  for (const entry of goldenCorpus) {
    it(`stays within the tolerance on ${entry.name}`, () => {
      const graph = buildCorpusGraph(entry);
      const config = resolveConfig(undefined);
      const first = runPipeline(prepare(graph, config, undefined));
      const host = graph.nodes()[0];
      if (host === undefined) throw new Error('an empty corpus graph');
      graph.batch(() => {
        graph.addNode('warm-start-newcomer');
        graph.addEdge(host.id, 'warm-start-newcomer');
      });

      const cold = runPipeline(prepare(graph, config, undefined));
      const warm = runPipeline(prepare(graph, config, undefined, warmStartOf(first.routed)));

      const score = (state: RoutedState): number =>
        countCrossings({ graph, layers: state.layers, virtualChains: state.virtualChains });
      const coldCrossings = score(cold.routed);
      const warmCrossings = score(warm.routed);
      // A corpus entry that drew no crossings at all would satisfy any ratio,
      // so it has to say that there was something to be worse at.
      expect(coldCrossings).toBeGreaterThan(0);
      expect(warmCrossings / coldCrossings).toBeLessThanOrEqual(CROSSING_TOLERANCE);
    });
  }
});
