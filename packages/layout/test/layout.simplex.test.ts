import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { measureNodes, resolveConfig } from '../src/config.js';
import { InvalidConfigError, defaultStages, layout } from '../src/index.js';
import { longestPathRankStage } from '../src/rank.js';
import { networkSimplexRank, networkSimplexRankStage } from '../src/simplex.js';
import type { PreparedState, RankOutput } from '../src/types.js';
import { mulberry32, randomDigraph } from './random.js';

/** What the runner hands the rank stage, built the way the runner builds it. */
function prepare(graph: Graph): PreparedState {
  const config = resolveConfig(undefined);
  return { graph, config, sizes: measureNodes(graph, config, undefined) };
}

/** Runs the stage under test on a graph and hands back what it contributes. */
function rank(graph: Graph): RankOutput {
  return networkSimplexRankStage.run(prepare(graph));
}

/** Ranks as a plain object, which reads better in a failure than a Map does. */
function ranksOf(graph: Graph): Record<NodeId, number> {
  return Object.fromEntries(rank(graph).ranks);
}

/** The rank of a node, which the stage owes for every node in the graph. */
function requireRank(state: RankOutput, id: NodeId): number {
  const rank = state.ranks.get(id);
  if (rank === undefined) throw new Error(`no rank for "${id}"`);
  return rank;
}

/**
 * The quantity this stage minimises: the number of ranks every edge crosses,
 * summed, over the acyclic view the stage chose. Self loops cross nothing and
 * are left out, exactly as the view leaves them out.
 *
 * Minus the edge count, this is the number of dummy nodes M2.4b's splitter will
 * mint, which is why it is the number worth optimising rather than the height.
 */
function totalEdgeLength(graph: Graph, state: RankOutput): number {
  let total = 0;
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const reversed = state.reversedEdges.has(edge.id);
    const from = requireRank(state, reversed ? edge.target : edge.source);
    const to = requireRank(state, reversed ? edge.source : edge.target);
    total += to - from;
  }
  return total;
}

/** Every edge of the acyclic view descends at least one rank. The definition. */
function expectFeasible(graph: Graph, state: RankOutput, where: string): void {
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const reversed = state.reversedEdges.has(edge.id);
    const from = requireRank(state, reversed ? edge.target : edge.source);
    const to = requireRank(state, reversed ? edge.source : edge.target);
    expect(to - from, `${where}: ${edge.id} descends`).toBeGreaterThanOrEqual(1);
  }
}

/** The view a rank output implies: the edges, as endpoint pairs, after reversal. */
function viewOf(graph: Graph, state: RankOutput): [NodeId, NodeId][] {
  const edges: [NodeId, NodeId][] = [];
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const reversed = state.reversedEdges.has(edge.id);
    edges.push(reversed ? [edge.target, edge.source] : [edge.source, edge.target]);
  }
  return edges;
}

/**
 * The least total edge length any feasible ranking of a view achieves, found by
 * trying every one of them.
 *
 * Brute force on purpose, and the only test here that could catch a wrong cut
 * value by disagreeing with it rather than by agreeing for the wrong reason: a
 * checker sharing an implementation with the thing it checks carries the same
 * bug. The window is `0..count - 1` per node, which loses nothing. An optimal
 * ranking never leaves an empty rank inside a connected component (sliding
 * everything below the gap up one shortens every edge crossing it and breaks
 * none, and in a connected component something crosses it), so each component
 * of an optimal ranking is contiguous, spans fewer ranks than it has nodes, and
 * can be translated to start at 0.
 *
 * The search assigns nodes in graph order and prices each edge once, as its
 * later endpoint lands, so a partial assignment that has already spent more
 * than the best complete one is abandoned rather than finished.
 */
function leastTotalEdgeLength(graph: Graph, state: RankOutput): number {
  const ids = graph.nodes().map((node) => node.id);
  const index = new Map<NodeId, number>();
  for (const [position, id] of ids.entries()) index.set(id, position);
  // Edges grouped by the later of their two endpoints, which is where the
  // search first knows what they cost.
  const priced: [number, number][][] = ids.map(() => []);
  for (const [source, target] of viewOf(graph, state)) {
    const from = index.get(source) ?? 0;
    const to = index.get(target) ?? 0;
    priced[Math.max(from, to)]?.push([from, to]);
  }
  const ranks = new Array<number>(ids.length).fill(0);
  let best = Number.POSITIVE_INFINITY;
  const place = (position: number, spent: number): void => {
    if (spent >= best) return;
    if (position === ids.length) {
      best = spent;
      return;
    }
    for (let value = 0; value < ids.length; value += 1) {
      ranks[position] = value;
      let extra = 0;
      let feasible = true;
      for (const [from, to] of priced[position] ?? []) {
        const span = (ranks[to] ?? 0) - (ranks[from] ?? 0);
        if (span < 1) {
          feasible = false;
          break;
        }
        extra += span;
      }
      if (feasible) place(position + 1, spent + extra);
    }
  };
  place(0, 0);
  return best;
}

/** A graph from a script of `addNode`/`addEdge` calls. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string, string])[]) {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/**
 * A graph with two cycles, a self loop, parallel edges, generated ids and a
 * removal, so its iteration order is not the alphabetical one and the stage has
 * something of every kind to deal with. The same graph `layout.rank.test.ts`
 * holds the default stage to, so the two stages are checked against one shape.
 */
function tangled(): Graph {
  const graph = new Graph();
  graph.addNode('zeta');
  graph.addNode('alpha');
  graph.addNode();
  graph.addNode('mid');
  graph.addEdge('zeta', 'alpha');
  graph.addEdge('alpha', 'zeta', 'back');
  graph.addEdge('alpha', 'n1');
  graph.addEdge('n1', 'zeta');
  graph.addEdge('mid', 'mid');
  graph.removeNode('alpha');
  graph.addNode('alpha');
  graph.addEdge('mid', 'alpha');
  graph.addEdge('alpha', 'mid');
  graph.addEdge('alpha', 'mid');
  return graph;
}

describe('networkSimplexRankStage', () => {
  it('puts a lone node on rank 0', () => {
    expect(ranksOf(build(['a'], []))).toEqual({ a: 0 });
  });

  it('ranks nothing at all for an empty graph', () => {
    const state = rank(new Graph());
    expect([...state.ranks]).toEqual([]);
    expect([...state.reversedEdges]).toEqual([]);
  });

  it('walks a chain down one rank at a time', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('ranks a diamond by its longer side', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['a', 'c', 'ac'],
        ['b', 'd', 'bd'],
        ['c', 'd', 'cd'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });

  // The case `rank.ts` names, and it is worth pinning what it does and does not
  // show. `d` is three ranks below `a` in EVERY feasible ranking, because the
  // chain puts it there, so `a -> d` spans three ranks whatever a ranker does
  // and the total is 2 * (rank(d) - rank(a)) = 6 either way. The shortcut edge
  // is the SHAPE longest path gets wrong, not a total it gets wrong; what it
  // gets wrong is a node with slack, which the next test is.
  it('agrees with longest path when the shortcut edge is the only slack', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['a', 'd', 'ad'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    expect(totalEdgeLength(graph, rank(graph))).toBe(6);
    expect(totalEdgeLength(graph, longestPathRankStage.run(prepare(graph)))).toBe(6);
  });

  // A node with slack, which is the case longest path really does lose. `e` has
  // nothing pointing at it, so longest path leaves it at rank 0 and its one
  // edge spans three ranks. Sliding it down to rank 2 costs nothing and saves
  // two, and it is where the height goes up: nothing here changes the height,
  // but nothing here reduces it either.
  it('slides a node with slack down to its successor', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['e', 'd', 'ed'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 2, d: 3, e: 2 });
    expect(totalEdgeLength(graph, rank(graph))).toBe(4);
    expect(totalEdgeLength(graph, longestPathRankStage.run(prepare(graph)))).toBe(6);
  });

  it('starts each disconnected component at rank 0', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['c', 'd', 'cd'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 0, d: 1 });
  });

  it('sends every edge it did not reverse strictly down a rank', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'a', 'ca'],
      ],
    );
    const state = rank(graph);
    for (const edge of graph.edges()) {
      if (state.reversedEdges.has(edge.id)) continue;
      expect(requireRank(state, edge.source), edge.id).toBeLessThan(requireRank(state, edge.target));
    }
  });

  it('sends a reversed edge strictly up a rank', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'b', 'ab'],
        ['b', 'a', 'ba'],
      ],
    );
    const state = rank(graph);
    expect([...state.reversedEdges]).toEqual(['ba']);
    expect(requireRank(state, 'a')).toBe(0);
    expect(requireRank(state, 'b')).toBe(1);
  });

  it('leaves both ends of a self loop on one rank and reverses nothing', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'b', 'ab'],
        ['b', 'b', 'bb'],
      ],
    );
    const state = rank(graph);
    expect([...state.reversedEdges]).toEqual([]);
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1 });
  });

  // Two copies of one edge are two units of total edge length, so a ranker that
  // collapsed them would price the pair wrong: M2.4b mints a dummy per copy per
  // rank, and the second copy costs exactly what the first one does. Here the
  // pair outweighs the single edge and drags `c` up against it.
  it('counts parallel edges once each, so a pair outweighs a single edge', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['b', 'c', 'bc'],
        ['a', 'c', 'ac'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 2 });
    expect(totalEdgeLength(graph, rank(graph))).toBe(5);
  });

  it('declares no virtual node, and contributes nothing but ranks and reversals', () => {
    const state = rank(tangled());
    expect(state.virtualNodes).toBeUndefined();
    expect(state.virtualChains).toBeUndefined();
    expect(Object.keys(state).sort()).toEqual(['ranks', 'reversedEdges']);
  });

  it('ranks exactly the graph, in graph order', () => {
    const graph = tangled();
    expect([...rank(graph).ranks.keys()]).toEqual(graph.nodes().map((node) => node.id));
  });

  it('never touches the graph it was handed', () => {
    const graph = tangled();
    const nodesBefore = graph.nodes();
    const edgesBefore = graph.edges();
    const state = rank(graph);
    expect(state.reversedEdges.size).toBeGreaterThan(0);
    expect(graph.nodes()).toEqual(nodesBefore);
    expect(graph.edges()).toEqual(edgesBefore);
    for (const id of state.reversedEdges) {
      const before = edgesBefore.find((edge) => edge.id === id);
      expect(graph.getEdge(id)).toBe(before);
    }
  });

  it('is not the default stage', () => {
    expect(defaultStages.rank).toBe(longestPathRankStage);
    expect(networkSimplexRankStage.name).toBe('network-simplex-rank');
  });

  it('passes every runner check when a caller selects it', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'a', 'ca'],
        ['e', 'd', 'ed'],
        ['c', 'd', 'cd'],
      ],
    );
    // `layout` runs every contract check in the runner, so reaching a result at
    // all is most of the assertion.
    const result = layout({ graph }, { rank: networkSimplexRankStage });
    expect([...result.nodes.keys()]).toEqual(graph.nodes().map((node) => node.id));
  });

  it('is a stage a factory call with no options produces', () => {
    const stage = networkSimplexRank();
    expect(stage.name).toBe(networkSimplexRankStage.name);
    expect([...stage.run(prepare(tangled())).ranks]).toEqual([...rank(tangled()).ranks]);
  });
});

describe('networkSimplexRankStage determinism', () => {
  it('gives the same graph the same ranks twice', () => {
    const graph = tangled();
    expect([...rank(graph).ranks]).toEqual([...rank(graph).ranks]);
    expect([...rank(graph).reversedEdges]).toEqual([...rank(graph).reversedEdges]);
  });

  it('gives two graphs from the same script the same ranks', () => {
    expect([...rank(tangled()).ranks]).toEqual([...rank(tangled()).ranks]);
  });

  // What edge order does NOT change, on a graph whose optimum is unique. It is
  // stated that narrowly on purpose: this stage's tie-breaks are the graph's own
  // iteration order, so a graph with two optima of equal cost may well land on
  // the other one when its edges arrive in another order, and cycle breaking is
  // order-sensitive before ranking even starts. See the docstring.
  it('gives the same ranks when the edges arrive in another order', () => {
    const edges: (readonly [string, string, string])[] = [
      ['a', 'b', 'ab'],
      ['b', 'c', 'bc'],
      ['c', 'd', 'cd'],
      ['e', 'd', 'ed'],
    ];
    const forwards = build(['a', 'b', 'c', 'd', 'e'], edges);
    const backwards = build(['a', 'b', 'c', 'd', 'e'], [...edges].reverse());
    expect(ranksOf(backwards)).toEqual(ranksOf(forwards));
  });
});

describe('the cut-value identity', () => {
  /**
   * The identity the stage computes cut values with, checked against the
   * definition on every spanning tree of a graph small enough to have all of
   * them enumerated.
   *
   * This pins the ARGUMENT, not the code: `simplex.ts` exports a stage and not
   * its internals, so what checks the implementation of it is
   * `leastTotalEdgeLength` above, which disagrees with a pessimiser rather than
   * agreeing with it. Both are needed. A sign error in the reasoning would
   * survive a suite that only ever compared the stage against itself, and a
   * sign error in the code would survive a suite that only checked the algebra.
   *
   * The definition is Gansner, Koutsofios, North and Vo's: remove the tree edge,
   * and count the edges running from the side holding its tail to the side
   * holding its head, minus those running back. The identity is that this equals
   * the sum of `indegree - outdegree` over the side holding its HEAD, because an
   * edge with both endpoints on that side is counted once each way and cancels.
   */
  const nodes = ['a', 'b', 'c', 'd'];
  const edges: [NodeId, NodeId, EdgeId][] = [
    ['a', 'b', 'ab'],
    ['a', 'c', 'ac'],
    ['b', 'c', 'bc'],
    ['b', 'd', 'bd'],
    ['c', 'd', 'cd'],
    ['a', 'd', 'ad'],
  ];

  /** The nodes reachable from `entry` through the tree, minus one edge. */
  function sideOf(tree: readonly EdgeId[], without: EdgeId, entry: NodeId): Set<NodeId> {
    const side = new Set<NodeId>([entry]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [source, target, id] of edges) {
        if (!tree.includes(id) || id === without) continue;
        if (side.has(source) && !side.has(target)) {
          side.add(target);
          changed = true;
        }
        if (side.has(target) && !side.has(source)) {
          side.add(source);
          changed = true;
        }
      }
    }
    return side;
  }

  it('gives the same answer as counting the crossing edges by hand', () => {
    let trees = 0;
    let checked = 0;
    // Every three-edge subset, kept when it connects all four nodes, which for
    // four nodes and three edges is exactly the spanning trees.
    for (let mask = 0; mask < 1 << edges.length; mask += 1) {
      const tree = edges.filter((_, bit) => (mask & (1 << bit)) !== 0).map(([, , id]) => id);
      if (tree.length !== nodes.length - 1) continue;
      if (sideOf(tree, '', 'a').size !== nodes.length) continue;
      trees += 1;
      for (const id of tree) {
        const edge = edges.find(([, , candidate]) => candidate === id);
        if (edge === undefined) throw new Error(`no edge "${id}"`);
        const [source, target] = edge;
        const head = sideOf(tree, id, target);
        const tail = sideOf(tree, id, source);
        expect(head.has(source), `${id}: the sides are disjoint`).toBe(false);
        expect(head.size + tail.size, `${id}: the sides cover the graph`).toBe(nodes.length);

        let byDefinition = 0;
        for (const [from, to] of edges) {
          if (tail.has(from) && head.has(to)) byDefinition += 1;
          if (head.has(from) && tail.has(to)) byDefinition -= 1;
        }
        let byIdentity = 0;
        for (const [from, to] of edges) {
          if (head.has(to)) byIdentity += 1;
          if (head.has(from)) byIdentity -= 1;
        }
        expect(byIdentity, `${id} in tree ${tree.join(',')}`).toBe(byDefinition);
        checked += 1;
      }
    }
    expect(trees).toBe(16);
    expect(checked).toBe(48);
  });
});

describe('networkSimplexRankStage optimality', () => {
  // Small on purpose: the checker walks every ranking there is, so the graphs
  // it runs on have to be ones a walk finishes. Six nodes is enough for both
  // stages to have something to disagree about, and the seeds below produce a
  // few hundred of them.
  for (const seed of [3, 11, 42, 99, 1337, 20260726]) {
    it(`is exactly optimal on every small random graph for seed ${String(seed)}`, () => {
      const random = mulberry32(seed);
      let compared = 0;
      let strictlyBetter = 0;
      for (let round = 0; round < 100; round += 1) {
        const graph = randomDigraph(random);
        if (graph.nodeCount > 7 || graph.nodeCount === 0) continue;
        const where = `seed ${String(seed)} round ${String(round)}`;
        const state = rank(graph);
        expectFeasible(graph, state, where);
        const total = totalEdgeLength(graph, state);
        expect(total, `${where}: total edge length`).toBe(leastTotalEdgeLength(graph, state));
        if (total < totalEdgeLength(graph, longestPathRankStage.run(prepare(graph)))) {
          strictlyBetter += 1;
        }
        compared += 1;
      }
      expect(compared, `seed ${String(seed)}: graphs small enough to check`).toBeGreaterThan(5);
      expect(strictlyBetter, `seed ${String(seed)}: graphs it beat longest path on`).toBeGreaterThan(
        0,
      );
    });
  }
});

describe('networkSimplexRankStage and the height of the drawing', () => {
  // Six nodes are enough to trade a rank of height for a unit of length, and
  // this is the case the docstring quotes. Longest path draws three layers and
  // pays 6; pulling `v6` down one tightens `v6 -> v5` and pays 5, and drags
  // `v9` and `v0` into a fourth layer to do it. Both rankings are optimal for
  // their own objective, which is the whole point: they are different
  // objectives.
  const graph = () =>
    build(
      ['v0', 'v4', 'v5', 'v6', 'v8', 'v9'],
      [
        ['v8', 'v4', 'e0'],
        ['v9', 'v0', 'e8'],
        ['v4', 'v5', 'e9'],
        ['v6', 'v9', 'e11'],
        ['v6', 'v5', 'e13'],
      ],
    );

  it('spends height to buy total edge length', () => {
    expect(ranksOf(graph())).toEqual({ v0: 3, v4: 1, v5: 2, v6: 1, v8: 0, v9: 2 });
    expect(totalEdgeLength(graph(), rank(graph()))).toBe(5);
    const before = longestPathRankStage.run(prepare(graph()));
    expect(Math.max(...before.ranks.values())).toBe(2);
    expect(totalEdgeLength(graph(), before)).toBe(6);
  });

  it('is never shorter than longest path, which is the minimum height', () => {
    const random = mulberry32(20260727);
    for (let round = 0; round < 200; round += 1) {
      const subject = randomDigraph(random);
      if (subject.nodeCount === 0) continue;
      const where = `round ${String(round)}`;
      const tall = Math.max(...rank(subject).ranks.values());
      const short = Math.max(...longestPathRankStage.run(prepare(subject)).ranks.values());
      expect(tall, `${where}: height`).toBeGreaterThanOrEqual(short);
    }
  });
});

describe('networkSimplexRankStage against longest path', () => {
  // The roadmap's stated golden comparison: the rank sum must never regress.
  for (const seed of [3, 11, 42, 99, 1337, 20260726]) {
    it(`never ranks a random graph worse than longest path for seed ${String(seed)}`, () => {
      const random = mulberry32(seed);
      let improved = 0;
      let broken = 0;
      for (let round = 0; round < 30; round += 1) {
        const graph = randomDigraph(random);
        const where = `seed ${String(seed)} round ${String(round)}`;
        const state = rank(graph);
        const before = longestPathRankStage.run(prepare(graph));
        if (state.reversedEdges.size > 0) broken += 1;

        // Both stages break cycles the same way, so the comparison is between
        // two rankings of one acyclic view rather than between two views.
        expect([...state.reversedEdges], `${where}: same view`).toEqual([...before.reversedEdges]);
        expect([...state.ranks.keys()], `${where}: ranked exactly the graph`).toEqual(
          graph.nodes().map((node) => node.id),
        );
        expectFeasible(graph, state, where);
        const after = totalEdgeLength(graph, state);
        expect(after, `${where}: total edge length`).toBeLessThanOrEqual(
          totalEdgeLength(graph, before),
        );
        if (after < totalEdgeLength(graph, before)) improved += 1;
      }
      // Counted so that a stage which silently returned its input would not sit
      // here green: `<=` is satisfied by doing nothing at all.
      expect(improved, `seed ${String(seed)}: rounds it improved`).toBeGreaterThan(0);
      expect(broken, `seed ${String(seed)}: rounds that needed an edge reversed`).toBeGreaterThan(0);
    });
  }
});

describe('networkSimplexRank and its iteration budget', () => {
  /**
   * The graph that catches the one way this stage can hand back something worse
   * than it was given, which is not a pivot but the tight tree before them.
   *
   * Growing the first tight tree shifts a partly grown tree to close its
   * tightest crossing edge, and that shift lengthens every edge running INTO
   * the tree while it shortens every edge running out. Here the arithmetic
   * comes out against it by one, and with no pivots allowed there is nothing to
   * win it back: 15 becomes 16. One pivot takes it to 13, which is the optimum,
   * so this is only ever visible with a budget too small to be useful, which is
   * exactly when a caller is relying on the promise.
   */
  const regressor = () =>
    build(
      ['v0', 'v1', 'v2', 'v3', 'v5', 'v7', 'v9', 'v10'],
      [
        ['v3', 'v10', 'e0'],
        ['v3', 'v7', 'e2'],
        ['v1', 'v2', 'e5'],
        ['v10', 'v3', 'e6'],
        ['v0', 'v9', 'e7'],
        ['v9', 'v2', 'e8'],
        ['v0', 'v1', 'e9'],
        ['v5', 'v0', 'e10'],
        ['v7', 'v5', 'e12'],
        ['v2', 'v10', 'e13'],
      ],
    );

  it('never returns a ranking worse than the one it started from', () => {
    const graph = regressor();
    const start = longestPathRankStage.run(prepare(graph));
    expect(totalEdgeLength(graph, start)).toBe(15);
    const stopped = networkSimplexRank({ maxIterations: 0 }).run(prepare(graph));
    expectFeasible(graph, stopped, 'no pivots');
    expect(totalEdgeLength(graph, stopped)).toBeLessThanOrEqual(15);
    // And one pivot is all it takes to be better than where it started.
    const pivoted = networkSimplexRank({ maxIterations: 1 }).run(prepare(graph));
    expectFeasible(graph, pivoted, 'one pivot');
    expect(totalEdgeLength(graph, pivoted)).toBe(13);
    expect(totalEdgeLength(graph, rank(graph))).toBe(13);
  });

  it('returns a feasible ranking when the budget runs out mid-solve', () => {
    // A graph that needs many pivots, cut off after one. The assertion is the
    // promise: still feasible, and no worse than the ranking it started from.
    const graph = new Graph();
    const random = mulberry32(4242);
    for (let index = 0; index < 60; index += 1) graph.addNode(`v${String(index)}`);
    for (let index = 0; index < 150; index += 1) {
      const source = Math.floor(random() * 60);
      const target = Math.floor(random() * 60);
      graph.addEdge(`v${String(source)}`, `v${String(target)}`, `e${String(index)}`);
    }
    const start = totalEdgeLength(graph, longestPathRankStage.run(prepare(graph)));
    const stopped = networkSimplexRank({ maxIterations: 1 }).run(prepare(graph));
    expectFeasible(graph, stopped, 'one pivot');
    expect(totalEdgeLength(graph, stopped)).toBeLessThanOrEqual(start);
    // The budget is what stopped it, not convergence: run to the end and the
    // answer is better, so this graph really did want more pivots.
    expect(totalEdgeLength(graph, rank(graph))).toBeLessThan(
      totalEdgeLength(graph, stopped),
    );
  });

  it('rejects a budget that is not a count, at the call that named it', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => networkSimplexRank({ maxIterations: value })).toThrow(InvalidConfigError);
      expect(() => networkSimplexRank({ maxIterations: value })).toThrow(/maxIterations/);
    }
    expect(() => networkSimplexRank({ maxIterations: 0 })).not.toThrow();
  });
});

describe('networkSimplexRank and its warm start', () => {
  /**
   * A graph with two optima of equal cost, which is what a warm start is for.
   * Every ranking of it costs `2 * (rank(c) - rank(a))`, so `c` sits three
   * ranks below `a` in every optimal one and `d` and `e` are pinned between
   * them, while `b` is free to sit at either rank 1 or rank 2 for the same
   * total of 6. Nothing but a tie-break decides which.
   */
  const twoOptima = () =>
    build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['a', 'd', 'ad'],
        ['d', 'e', 'de'],
        ['e', 'c', 'ec'],
      ],
    );

  /** The same graph plus a node that constrains nothing at all. */
  const perturbed = () => {
    const graph = twoOptima();
    graph.addNode('z');
    return graph;
  };

  const other: ReadonlyMap<NodeId, number> = new Map([
    ['a', 0],
    ['b', 2],
    ['c', 3],
    ['d', 1],
    ['e', 2],
  ]);

  it('lands on one of the two optima cold, and the other one hinted', () => {
    const graph = twoOptima();
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 3, d: 1, e: 2 });
    expect(totalEdgeLength(graph, rank(graph))).toBe(6);
    const hinted = networkSimplexRank({ initialRanks: other }).run(prepare(graph));
    expect(Object.fromEntries(hinted.ranks)).toEqual({ a: 0, b: 2, c: 3, d: 1, e: 2 });
    expect(totalEdgeLength(graph, hinted)).toBe(6);
  });

  // The roadmap's rank-stability requirement, and the reason it is beside the
  // rank-sum one rather than instead of it: the sum test passes with flying
  // colours while ranks churn, because churn does not change the sum. Both
  // rankings below cost 6.
  it('keeps every rank across a perturbation that cannot affect anything', () => {
    const previous = networkSimplexRank({ initialRanks: other }).run(prepare(twoOptima())).ranks;
    const graph = perturbed();
    const warm = networkSimplexRank({ initialRanks: previous }).run(prepare(graph));
    for (const [id, value] of previous) {
      expect(warm.ranks.get(id), `${id} did not move`).toBe(value);
    }
    expect(warm.ranks.get('z')).toBe(0);
    // Without the warm start the same perturbation moves `b` a whole rank,
    // which is the churn the requirement exists to stop. Nothing about the
    // graph made it move: the solver simply picked the other optimum.
    expect(rank(graph).ranks.get('b')).toBe(1);
    expect(warm.ranks.get('b')).toBe(2);
  });

  it('takes a stale, garbled or hostile hint and still lands on an optimum', () => {
    const graph = twoOptima();
    const cold = rank(graph);
    const optimum = leastTotalEdgeLength(graph, cold);
    const hints: [string, ReadonlyMap<NodeId, number>][] = [
      ['every node at zero', new Map([...cold.ranks].map(([id]) => [id, 0]))],
      ['the ranking upside down', new Map([...cold.ranks].map(([id, value]) => [id, -value]))],
      ['ids the graph does not hold', new Map([['nope', 3]])],
      ['a node missing from the hint', new Map([['c', 3]])],
      ['ranks that are not integers', new Map([['b', 2.5]])],
      ['a rank wider than the graph', new Map([['b', 1e9]])],
      ['a rank below anything usable', new Map([['b', -1e9]])],
      ['nothing at all', new Map()],
    ];
    for (const [what, hint] of hints) {
      const state = networkSimplexRank({ initialRanks: hint }).run(prepare(graph));
      expectFeasible(graph, state, what);
      expect(totalEdgeLength(graph, state), what).toBe(optimum);
      // Contiguous from zero, which an optimum always is and a hint must not be
      // able to break.
      const used = [...new Set(state.ranks.values())].sort((left, right) => left - right);
      expect(used, what).toEqual(used.map((_, index) => index));
    }
  });

  it('takes a hint from a graph it has never seen', () => {
    // The M3 case that is not a perturbation at all: ranks left over from an
    // unrelated graph. Every id is unknown, so every entry is dropped and the
    // run is the cold one.
    const graph = twoOptima();
    const stale = new Map([
      ['x', 7],
      ['y', 2],
    ]);
    const state = networkSimplexRank({ initialRanks: stale }).run(prepare(graph));
    expect([...state.ranks]).toEqual([...rank(graph).ranks]);
  });
});
