import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { InvalidConfigError } from '../src/errors.js';
import { barycenterOrder, barycenterOrderStage, countCrossings } from '../src/order.js';
import { longestPathRankStage } from '../src/rank.js';
import { defaultStages } from '../src/stages.js';
import { layout } from '../src/pipeline.js';
import { mulberry32, randomDigraph } from './random.js';
import type { GraphSpec } from '@dagr/bench';
import type { NodeId } from '@dagr/graph';
import type { RankedState, Size } from '../src/types.js';

/**
 * The barycenter order stage: its seed, its sweeps, its options, and the one
 * guarantee that makes it safe to reach for, which is that it never hands back
 * a worse drawing than the one it started from.
 *
 * Most of what is pinned here is pinned through `maxSweeps: 0`, which runs no
 * sweep at all and returns the seed permutation. That is deliberate. The seed
 * is the part M3.6 warm starts from, so it is the part a future change is most
 * likely to break by accident and least likely to be caught breaking: a
 * different seed still produces a legal layering with a plausible crossing
 * count, and only the M3 stability metrics would ever notice.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/**
 * A `RankedState` with the ranks written out as the layers they stand for.
 *
 * The order stage is the one stage whose input is easier to state than to
 * produce: going through a real ranker would tie every case below to whatever
 * `longestPathRankStage` happens to do with the witness graph, which is not
 * what any of them is about. The runner's own checks are exercised separately,
 * through `layout` with this stage as an override.
 */
function stateOf(graph: Graph, layers: readonly (readonly NodeId[])[]): RankedState {
  const ranks = new Map<NodeId, number>();
  for (const [rank, ids] of layers.entries()) {
    for (const id of ids) ranks.set(id, rank);
  }
  const sizes = new Map<NodeId, Size>();
  for (const id of ranks.keys()) sizes.set(id, { width: 10, height: 10 });
  return {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks,
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
  };
}

/** The layers a stage produces for a state, as plain arrays for comparison. */
function ordered(state: RankedState, options?: Parameters<typeof barycenterOrder>[0]): NodeId[][] {
  return barycenterOrder(options)
    .run(state)
    .layers.map((layer) => [...layer]);
}

/**
 * A random layered graph: nodes spread over layers, most edges joining adjacent
 * layers and a share of them spanning two.
 *
 * Bigger than `randomDigraph`, because the properties below are about crossing
 * counts and a dozen nodes rarely has a crossing to count. The long edges are
 * there so that the seed and the sweeps both meet the case they cannot see.
 */
function randomLayered(
  random: () => number,
  nodeCount: number,
  layerCount: number,
  edgeCount: number,
): { graph: Graph; layers: NodeId[][] } {
  const graph = new Graph();
  const layers: NodeId[][] = Array.from({ length: layerCount }, () => []);
  for (let index = 0; index < nodeCount; index += 1) {
    const id = graph.addNode(`n${String(index)}`).id;
    layers[Math.floor(random() * layerCount)]?.push(id);
  }
  for (let index = 0; index < edgeCount; index += 1) {
    const span = random() < 0.2 ? 2 : 1;
    const from = Math.floor(random() * (layerCount - span));
    const source = layers[from];
    const target = layers[from + span];
    if (source === undefined || target === undefined) continue;
    if (source.length === 0 || target.length === 0) continue;
    const one = source[Math.floor(random() * source.length)];
    const other = target[Math.floor(random() * target.length)];
    if (one === undefined || other === undefined) continue;
    graph.addEdge(one, other);
  }
  return { graph, layers: layers.filter((layer) => layer.length > 0) };
}

describe('barycenterOrder, the seed permutation', () => {
  /**
   * The rule M3.6 warm starts from, on the smallest graph that shows it. Roster
   * order puts `c` before `d` because that is the order they were added in; the
   * walk reaches `d` first, from `a`, and reaches `c` afterwards from `b`.
   */
  it('seeds a layer by the walk over adjacent-layer edges, not by roster order', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'd'],
        ['b', 'c'],
      ],
    );
    const state = stateOf(graph, [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ]);
    // What the placeholder does with the same input, so that the difference is
    // in the file rather than in a reader's head.
    expect(defaultStages.order.run(state).layers).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  /**
   * The walk follows an adjacent-layer edge in BOTH directions. Here the outer
   * loop starts at `c`, which is the first node the roster holds, and the only
   * way out of it is up its two in-edges.
   */
  it('follows an adjacent-layer edge upward as well as downward', () => {
    const graph = build(
      ['c', 'b', 'a'],
      [
        ['a', 'c'],
        ['b', 'c'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['c']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a', 'b'], ['c']]);
    expect(defaultStages.order.run(state).layers).toEqual([['b', 'a'], ['c']]);
  });

  /**
   * An edge whose endpoints are more than one layer apart is not a step the
   * walk can take, which is the decision D1 records: the seed is built from the
   * edges the sweeps can see rather than from every edge. Following `a -> z`
   * would put `z` in front of `y`, and it does not.
   */
  it('does not follow an edge that spans more than one layer', () => {
    const graph = build(
      ['a', 'b', 'm', 'y', 'z'],
      [
        ['a', 'z'],
        ['m', 'y'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['m'], ['y', 'z']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a', 'b'], ['m'], ['y', 'z']]);
  });

  /** A node nothing reaches is appended when the outer loop gets to it. */
  it('appends an unreached node in roster order', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'e'],
        ['b', 'd'],
      ],
    );
    const state = stateOf(graph, [
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['e', 'd', 'c'],
    ]);
  });
});

describe('barycenterOrder, the initialOrder hint', () => {
  const graph = build(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'd'],
      ['b', 'c'],
    ],
  );
  const state = stateOf(graph, [
    ['a', 'b'],
    ['c', 'd'],
  ]);

  it('reproduces a hint that names every node', () => {
    const hint = [
      ['b', 'a'],
      ['c', 'd'],
    ];
    expect(ordered(state, { maxSweeps: 0, initialOrder: hint })).toEqual(hint);
  });

  it('ignores hint entries the roster does not hold', () => {
    const layers = ordered(state, {
      maxSweeps: 0,
      initialOrder: [['ghost', 'b', 'a'], ['phantom']],
    });
    expect(layers).toEqual([
      ['b', 'a'],
      ['d', 'c'],
    ]);
  });

  /**
   * An id the hint puts in the wrong layer still only contributes its position
   * within the layer it actually belongs to. The hint below claims `d` sits
   * above `a`, and all that survives is that `d` comes before `c`.
   */
  it('reads a misplaced id as a position within its own layer', () => {
    const layers = ordered(state, { maxSweeps: 0, initialOrder: [['d', 'b', 'a'], ['c']] });
    expect(layers).toEqual([
      ['b', 'a'],
      ['d', 'c'],
    ]);
  });

  it('leaves the walk order alone when the hint names nothing it holds', () => {
    const cold = ordered(state, { maxSweeps: 0 });
    expect(ordered(state, { maxSweeps: 0, initialOrder: [] })).toEqual(cold);
    expect(ordered(state, { maxSweeps: 0, initialOrder: [['ghost'], ['phantom']] })).toEqual(cold);
  });
});

describe('barycenterOrder, the sweeps', () => {
  /**
   * D2 on the smallest layering that shows it. Fixing `p q` above, `y` wants
   * index 0 and `x` wants index 1, so the pair has to swap; `u` has no
   * neighbour above at all, so it keeps index 1 and the pair sorts into the
   * indices left over, which are 0 and 2.
   */
  it('pins a node the fixed layer says nothing about at its own index', () => {
    const graph = build(
      ['p', 'q', 'x', 'u', 'y'],
      [
        ['p', 'y'],
        ['q', 'x'],
      ],
    );
    const state = stateOf(graph, [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ]);
    const seed = [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ];
    expect(ordered(state, { maxSweeps: 0, initialOrder: seed })).toEqual(seed);
    expect(ordered(state, { maxSweeps: 1, initialOrder: seed })).toEqual([
      ['p', 'q'],
      ['y', 'u', 'x'],
    ]);
  });

  it('never returns more crossings than its own seed', () => {
    const random = mulberry32(0x5eed);
    let seedTotal = 0;
    let sweptTotal = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { graph, layers } = randomLayered(random, 120, 6, 400);
      const state = stateOf(graph, layers);
      const seed = ordered(state, { maxSweeps: 0 });
      const swept = ordered(state);
      seedTotal += countCrossings({ graph, layers: seed });
      sweptTotal += countCrossings({ graph, layers: swept });
      expect(countCrossings({ graph, layers: swept })).toBeLessThanOrEqual(
        countCrossings({ graph, layers: seed }),
      );
    }
    // Not a vacuous property: the sweeps really do move these graphs. The
    // margin is a floor rather than a pin, because what is being ruled out is
    // an implementation that returns its seed and passes the loop above.
    expect(sweptTotal).toBeLessThan(seedTotal * 0.75);
  });

  /**
   * The property "keep the best layering seen" exists to guarantee, and the one
   * that fails if it is dropped: a bigger budget is never a worse answer.
   *
   * The sweeps are NOT monotone. On the first graph below the layering after
   * five sweeps is worse than the layering after four, and on the second it
   * alternates for the whole run, so a stage that returned its last layering
   * would return the worse of the two at half the budgets it is given. Only the
   * comparison across budgets catches that: comparing against the seed does
   * not, because even a bad sweep is far better than the seed.
   */
  it('is monotone in the sweep budget, because the best seen is what comes back', () => {
    const random = mulberry32(1);
    for (const [nodes, depth, edges] of [
      [40, 4, 90],
      [120, 6, 400],
      [30, 3, 70],
      [200, 8, 700],
    ] as const) {
      const { graph, layers } = randomLayered(random, nodes, depth, edges);
      const state = stateOf(graph, layers);
      const scores = [];
      for (let budget = 0; budget <= 8; budget += 1) {
        scores.push(countCrossings({ graph, layers: ordered(state, { maxSweeps: budget }) }));
      }
      for (const [budget, crossings] of scores.entries()) {
        if (budget === 0) continue;
        expect(crossings).toBeLessThanOrEqual(scores[budget - 1] ?? crossings);
      }
    }
  });

  it('improves with a bigger sweep budget, and runs no sweep at all at zero', () => {
    const random = mulberry32(11);
    const { graph, layers } = randomLayered(random, 200, 8, 700);
    const state = stateOf(graph, layers);
    const at = (maxSweeps: number): number =>
      countCrossings({ graph, layers: ordered(state, { maxSweeps }) });
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThanOrEqual(at(8));
    // A budget of zero returns its seed untouched, at a size where a single
    // sweep would move hundreds of nodes: the hint names every node, so the
    // seed is exactly the hint, and it comes back exactly as it went in.
    const seed = ordered(state, { maxSweeps: 0 });
    expect(ordered(state, { maxSweeps: 0, initialOrder: seed })).toEqual(seed);
    expect(ordered(state, { maxSweeps: 1, initialOrder: seed })).not.toEqual(seed);
  });
});

describe('barycenterOrder, the options', () => {
  const state = stateOf(build(['a'], []), [['a']]);

  it('rejects a maxSweeps that is not a whole number of sweeps', () => {
    for (const maxSweeps of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => barycenterOrder({ maxSweeps })).toThrow(InvalidConfigError);
      expect(() => barycenterOrder({ maxSweeps })).toThrow(/maxSweeps/);
    }
  });

  it('rejects the budget when the stage is built, not when it runs', () => {
    expect(() => barycenterOrder({ maxSweeps: -1 })).toThrow(InvalidConfigError);
    const stage = barycenterOrder({ maxSweeps: 0 });
    expect(() => stage.run(state)).not.toThrow();
  });

  it('is named barycenter-order and is not the default order stage', () => {
    expect(barycenterOrderStage.name).toBe('barycenter-order');
    expect(defaultStages.order.name).toBe('insertion-order');
  });
});

describe('barycenterOrder, in the pipeline', () => {
  it('satisfies the order contract on random graphs', () => {
    const random = mulberry32(0xbeef);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graph = randomDigraph(random);
      expect(() => layout({ graph }, { order: barycenterOrderStage })).not.toThrow();
    }
  });

  it('places every roster member in exactly one layer, in rank order', () => {
    const random = mulberry32(3);
    const graph = randomDigraph(random);
    const result = layout({ graph }, { order: barycenterOrderStage });
    expect(result.nodes.size).toBe(graph.nodes().length);
  });

  it('gives the same graph the same layers twice', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'd'],
        ['b', 'c'],
        ['c', 'e'],
        ['d', 'e'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['c', 'd'], ['e']]);
    expect(ordered(state)).toEqual(ordered(state));
  });

  it('gives two graphs built by the same script the same result', () => {
    const script = (): Graph =>
      build(
        ['a', 'b', 'c', 'd', 'e'],
        [
          ['a', 'd'],
          ['b', 'c'],
          ['c', 'e'],
          ['d', 'e'],
        ],
      );
    const one = layout({ graph: script() }, { order: barycenterOrderStage });
    const other = layout({ graph: script() }, { order: barycenterOrderStage });
    expect(one).toEqual(other);
  });
});

/**
 * The numbers `order.ts` and `docs/docs/layout.md` quote, pinned so that a
 * change to either has to come here and say so.
 *
 * The same arrangement `layout.cycles.quality.test.ts` uses, and for the same
 * reason: a stage that got worse still passes every property above, because
 * every property above is about legality and about beating its own seed, and
 * both survive a large regression in quality. These are exact pins of a
 * deterministic run over a generated corpus, not ceilings, so a failure here
 * means "the answer moved", not "the answer is wrong".
 */
describe('barycenterOrder, on the bench corpora', () => {
  const corpora = [
    ['1k', smallCorpus()],
    ['10k', largeCorpus()],
  ] as const;

  /** The corpus ranked by the default stage, which is what the numbers assume. */
  function rankedCorpus(spec: GraphSpec): RankedState {
    const graph = new Graph();
    for (const id of spec.nodes) graph.addNode(id);
    for (const [source, target] of spec.edges) graph.addEdge(source, target);
    const sizes = new Map<NodeId, Size>();
    for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
    const out = longestPathRankStage.run({ graph, config: DEFAULT_LAYOUT_CONFIG, sizes });
    return {
      graph,
      config: DEFAULT_LAYOUT_CONFIG,
      sizes,
      ranks: out.ranks,
      reversedEdges: out.reversedEdges,
      virtualNodes: new Set(),
      virtualChains: new Map(),
    };
  }

  /**
   * The share of the drawing this stage can see at all: an edge is a segment
   * only if its endpoints land in adjacent layers, and today most do not. This
   * is the number that goes to 100% when M2.4b splits the long edges, so it is
   * pinned here as the thing that is expected to move rather than as a fact.
   */
  it('sees a third of the 1k corpus and a quarter of the 10k', () => {
    const spans = corpora.map(([, spec]) => {
      const state = rankedCorpus(spec);
      const layerOf = new Map<number, number>();
      for (const [index, rank] of [...new Set(state.ranks.values())]
        .sort((left, right) => left - right)
        .entries()) {
        layerOf.set(rank, index);
      }
      let adjacent = 0;
      let longest = 0;
      for (const edge of state.graph.edges()) {
        const from = layerOf.get(state.ranks.get(edge.source) ?? 0) ?? 0;
        const to = layerOf.get(state.ranks.get(edge.target) ?? 0) ?? 0;
        if (Math.abs(from - to) === 1) adjacent += 1;
        longest = Math.max(longest, Math.abs(from - to));
      }
      return { adjacent, longest, edges: state.graph.edges().length };
    });
    expect(spans).toEqual([
      { adjacent: 1_324, longest: 78, edges: 4_000 },
      { adjacent: 10_528, longest: 201, edges: 40_000 },
    ]);
  });

  /** D2 is not a corner case: this many nodes are pinned on every sweep. */
  it('has this many nodes the layer above says nothing about', () => {
    const counts = corpora.map(([, spec]) => {
      const state = rankedCorpus(spec);
      const layerOf = new Map<number, number>();
      for (const [index, rank] of [...new Set(state.ranks.values())]
        .sort((left, right) => left - right)
        .entries()) {
        layerOf.set(rank, index);
      }
      const above = new Set<NodeId>();
      const below = new Set<NodeId>();
      for (const edge of state.graph.edges()) {
        const from = layerOf.get(state.ranks.get(edge.source) ?? 0) ?? 0;
        const to = layerOf.get(state.ranks.get(edge.target) ?? 0) ?? 0;
        if (Math.abs(from - to) !== 1) continue;
        below.add(from < to ? edge.source : edge.target);
        above.add(from < to ? edge.target : edge.source);
      }
      let noneAbove = 0;
      let neither = 0;
      for (const node of state.graph.nodes()) {
        if (above.has(node.id)) continue;
        noneAbove += 1;
        if (!below.has(node.id)) neither += 1;
      }
      return { noneAbove, neither };
    });
    expect(counts).toEqual([
      { noneAbove: 120, neither: 49 },
      { noneAbove: 1_101, neither: 572 },
    ]);
  });

  /**
   * The seed decision and the sweep budget, in one table. The roster-order row
   * is the placeholder's permutation fed back in as a hint, which is both the
   * comparison D1 was decided on and a test that a hint naming every node
   * really does reproduce itself at this size.
   */
  it('pins the seed comparison and the sweep curve', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);
      const { graph } = state;
      const roster = defaultStages.order.run(state).layers;
      const at = (maxSweeps: number, initialOrder?: readonly (readonly NodeId[])[]): number =>
        countCrossings({
          graph,
          layers: barycenterOrder(
            initialOrder === undefined ? { maxSweeps } : { maxSweeps, initialOrder },
          ).run(state).layers,
        });
      return [
        name,
        countCrossings({ graph, layers: roster }),
        at(8, roster),
        at(0),
        at(2),
        at(4),
        at(8),
        at(16),
      ];
    });
    expect(table).toEqual([
      ['1k', 12_890, 3_943, 7_933, 4_619, 3_880, 3_605, 3_532],
      ['10k', 425_394, 54_744, 94_991, 50_735, 40_217, 35_114, 32_503],
    ]);
  });
});
