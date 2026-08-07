import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { acyclicView, longestPathRanks } from '../src/acyclic.js';
import { measureNodes, resolveConfig } from '../src/config.js';
import { feedbackArcSet } from '../src/cycles.js';
import { InvalidConfigError, defaultStages, layout } from '../src/index.js';
import { longestPathRankStage } from '../src/rank.js';
import { networkSimplexRank, networkSimplexRankStage } from '../src/simplex.js';
import type { NetworkSimplexOptions } from '../src/simplex.js';
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

  /**
   * The tight tree's tie-break, which is the entering edge's rule as well:
   * minimum slack, and among equal slacks the lowest edge number.
   *
   * The tree here reaches `v0, v8, v18, v15` over tight edges and then stalls
   * with two edges tied at slack 1: `e2` (`v6 -> v15`), which runs INTO the
   * tree, and `e4` (`v8 -> v3`), which runs out of it. The lower edge number
   * wins, so the tree shifts up by one to meet `v6` rather than down by one to
   * meet `v3`, and the two choices leave different trees and different
   * rankings. Both are feasible and neither costs more than the other, so
   * nothing but the tie-break decides it, which is why it is a tie-break worth
   * pinning: it is the whole of what "same graph, same ranks" rests on here.
   * The pivots that follow do not wash the choice out, so both budgets below
   * see it.
   */
  it('breaks a tie in the tight tree by the lowest edge number', () => {
    const graph = build(
      ['v0', 'v3', 'v6', 'v8', 'v14', 'v15', 'v16', 'v18', 'v19'],
      [
        ['v8', 'v18', 'e0'],
        ['v18', 'v15', 'e1'],
        ['v6', 'v15', 'e2'],
        ['v19', 'v3', 'e3'],
        ['v8', 'v3', 'e4'],
        ['v16', 'v6', 'e5'],
        ['v16', 'v14', 'e6'],
        ['v14', 'v15', 'e7'],
        ['v6', 'v19', 'e8'],
        ['v0', 'v8', 'e9'],
      ],
    );
    const settled = { v0: 0, v3: 4, v6: 2, v8: 1, v14: 2, v15: 3, v16: 1, v18: 2, v19: 3 };
    const grown = networkSimplexRank({ maxIterations: 0 }).run(prepare(graph));
    expect(Object.fromEntries(grown.ranks), 'the tight tree alone').toEqual(settled);
    expect(ranksOf(graph), 'and every pivot after it').toEqual(settled);
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
   *
   * ALREADY A DAG, and that is the point of it rather than an accident. The
   * witness is about what the tight tree does to ONE acyclic view, and it was
   * originally written as a cyclic graph whose view came out of whatever
   * `cycles.ts` happened to return. That made it hostage to a module it is not
   * testing: M2.2c replaced the cycle breaker, the view moved, and all three
   * numbers moved with it, so the witness stopped witnessing the tight-tree
   * regression it was built for and said nothing about whether that regression
   * had been fixed. It is written here as the view itself, `e6` and `e10`
   * already pointing the way the old breaker turned them, so `feedbackArcSet`
   * returns nothing on it and no future change to that module can move these
   * numbers. Anything that does move them is this stage.
   */
  const regressor = () =>
    build(
      ['v0', 'v1', 'v2', 'v3', 'v5', 'v7', 'v9', 'v10'],
      [
        ['v3', 'v10', 'e0'],
        ['v3', 'v7', 'e2'],
        ['v1', 'v2', 'e5'],
        ['v3', 'v10', 'e6'],
        ['v0', 'v9', 'e7'],
        ['v9', 'v2', 'e8'],
        ['v0', 'v1', 'e9'],
        ['v0', 'v5', 'e10'],
        ['v7', 'v5', 'e12'],
        ['v2', 'v10', 'e13'],
      ],
    );

  it('never returns a ranking worse than the longest-path one it computes first', () => {
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
    // promise: still feasible, and no worse than the longest-path ranking the
    // stage computed before pivoting.
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

  // A count, not a number. `Number.isFinite(2.5)` is true, so a check for a
  // finite number takes 2.5 as a budget and takes 0.5 as a budget of zero
  // pivots, which is a run that silently does none of the work it was asked
  // for. The one number that is not an integer and is still a budget is
  // infinity, which is how a caller spells "run to convergence".
  it('rejects a budget that is not a count, at the call that named it', () => {
    for (const value of [-1, -0.5, 2.5, 0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => networkSimplexRank({ maxIterations: value })).toThrow(InvalidConfigError);
      expect(() => networkSimplexRank({ maxIterations: value })).toThrow(/maxIterations/);
      // And says which object it means, because no `LayoutConfig` holds one.
      expect(() => networkSimplexRank({ maxIterations: value })).toThrow(/Invalid layout option/);
    }
    expect(() => networkSimplexRank({ maxIterations: 0 })).not.toThrow();
  });

  it('takes an infinite budget as a run to convergence', () => {
    const graph = regressor();
    expect(() => networkSimplexRank({ maxIterations: Number.POSITIVE_INFINITY })).not.toThrow();
    const forever = networkSimplexRank({ maxIterations: Number.POSITIVE_INFINITY });
    const state = forever.run(prepare(graph));
    expectFeasible(graph, state, 'an infinite budget');
    // The same answer the default budget reaches on a graph that converges
    // well inside it, which is what makes this a budget rather than a mode.
    expect(totalEdgeLength(graph, state)).toBe(13);
    expect([...state.ranks]).toEqual([...rank(graph).ranks]);
  });

  /**
   * The call site both options exist for, which `exactOptionalPropertyTypes`
   * would reject if they were declared `?: T` rather than `?: T | undefined`.
   * On the first run of an M3 session there is no previous ranking, so the
   * variable holding it is `Map | undefined` by construction, and a caller
   * would have to build the options object conditionally to say so.
   *
   * A type-level assertion that happens to run: what it pins is that this file
   * compiles, and `pnpm typecheck` is where it is really checked.
   */
  it('takes an option that is explicitly undefined', () => {
    const previousRanks: ReadonlyMap<NodeId, number> | undefined = undefined;
    const budget: number | undefined = undefined;
    const options: NetworkSimplexOptions = {
      initialRanks: previousRanks,
      maxIterations: budget,
    };
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
      ],
    );
    expect(Object.fromEntries(networkSimplexRank(options).run(prepare(graph)).ranks)).toEqual({
      a: 0,
      b: 1,
      c: 2,
    });
  });
});

describe('the cost of growing the tight tree', () => {
  /**
   * The shape that stalls the tight tree once per link: a chain
   * `c0 -> c1 -> ... ` with one extra source `b(i) -> c(i)` hanging off every
   * link. Longest path puts `c(i)` at rank `i` and every `b(i)` at rank 0, so
   * the `b(i) -> c(i)` slacks are all distinct, no shift makes two of them tight
   * at once, and every stall admits exactly one node.
   */
  const witness = (total: number): Graph => {
    const chain = Math.floor(total / 2);
    const graph = new Graph();
    for (let index = 0; index < chain; index += 1) graph.addNode(`c${String(index)}`);
    for (let index = 1; index < chain; index += 1) graph.addNode(`b${String(index)}`);
    for (let index = 1; index < chain; index += 1) {
      graph.addEdge(`c${String(index - 1)}`, `c${String(index)}`, `l${String(index)}`);
    }
    for (let index = 1; index < chain; index += 1) {
      graph.addEdge(`b${String(index)}`, `c${String(index)}`, `s${String(index)}`);
    }
    return graph;
  };

  /** The best of a few runs, which sheds a garbage collection rather than a bug. */
  const fastest = (run: () => void): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      run();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };

  /**
   * What the tight tree costs, in units of one linear sweep over the same graph.
   *
   * A ratio against the sweep rather than a wall time or a ratio of two sizes,
   * and both halves of that matter. A wall time pins the machine. Timing one
   * stage at two sizes pins the shape in principle, but the constant factor
   * climbs with the graph as the arrays leave cache, so quadratic growth came
   * out at 12 over a fourfold graph rather than 16 while the heaps come out
   * between 4 and 8, which is not a gap to hang a test on. The unit is O(V + E)
   * over the SAME view: it breaks the same cycles, builds the same acyclic view
   * and runs the same longest-path sweep, and then stops exactly where the tight
   * tree starts. So the ratio is 1 plus what the tree costs in sweeps, on this
   * machine, at this size, with this much of the graph in cache.
   *
   * The unit is those three calls rather than `longestPathRankStage.run`, which
   * is what it was until M2.4b. That stage no longer stops where the tight tree
   * starts: it goes on to split every long edge, and on this witness that is
   * quadratic work in the chain length rather than the linear sweep this ratio
   * is denominated in. Timing the three calls is the same unit the paragraph
   * above always described, and it is now the only way to get it.
   */
  const sweepsPerGrowth = (total: number): number => {
    const input = prepare(witness(total));
    const stage = networkSimplexRank({ maxIterations: 0 });
    const sweep = fastest(() => {
      const reversed = feedbackArcSet(input.graph);
      longestPathRanks(acyclicView(input.graph, reversed));
    });
    const growth = fastest(() => void stage.run(input));
    expect(stage.run(input).ranks.size).toBe(input.graph.nodeCount);
    return growth / sweep;
  };

  /**
   * Measured at two sizes because the claim is that the cost does not climb
   * with the graph: the rescan this replaced cost 86 sweeps at 8,000 nodes and
   * 392 at 16,000, and the heaps cost between 1.0 and 2.0 at both. The limit of
   * 10 therefore sits a factor of five above anything measured and a factor of
   * eight below the shape it rules out.
   */
  it('grows it in far less than the time a full rescan per stall would take', () => {
    const small = sweepsPerGrowth(8000);
    const large = sweepsPerGrowth(16000);
    expect(small, 'sweeps per growth at 8,000 nodes').toBeLessThan(10);
    expect(large, 'sweeps per growth at 16,000 nodes').toBeLessThan(10);
  }, 120_000);
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
      ['a node missing from the hint', new Map([['c', 3]])],
      ['the other optimum', other],
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

  // Dropped entirely rather than repaired into something else, which is a
  // stronger claim than "still optimal": each of these leaves the run exactly
  // where the cold one landed. A fractional rank rounded rather than dropped
  // would put `b` on rank 2 and pass an optimality check, and a rank of a
  // billion honoured rather than dropped would hand the solver a ranking
  // stretched over a window it has to pivot back closed, one pivot per unit of
  // nonsense, which no budget survives.
  it('drops a hint entry that carries nothing a ranking of this graph could use', () => {
    const graph = twoOptima();
    const hints: [string, ReadonlyMap<NodeId, number>][] = [
      ['ids the graph does not hold', new Map([['nope', 3]])],
      ['ranks that are not integers', new Map([['b', 2.5]])],
      ['a rank wider than the graph', new Map([['b', 1e9]])],
      ['a rank below anything usable', new Map([['b', -1e9]])],
      ['nothing at all', new Map()],
    ];
    for (const [what, hint] of hints) {
      const state = networkSimplexRank({ initialRanks: hint }).run(prepare(graph));
      expect([...state.ranks], what).toEqual([...rank(graph).ranks]);
    }
  });

  /**
   * The one property that reaches the incremental bookkeeping a pivot does
   * outside the subtree it moves, and the reason it is here rather than beside
   * the optimality suite: those graphs are small enough to brute force and this
   * one is not.
   *
   * A pivot rehangs one side of a cut somewhere else in the tree, so the subtree
   * sums along the path from the old attachment point to the new one change,
   * and only those. Getting that wrong does not break feasibility and does not
   * throw. It corrupts a cut value, so the search stops at a ranking that is not
   * optimal, and WHICH ranking depends on where it started. Convergence to a
   * global optimum does not: the cost is the same from every starting basis.
   * Skipping the update leaves these graphs at 71 and 492 from a cold start and
   * at 69 and 490 from one of the hinted ones, which is what this catches.
   */
  it('reaches the same total from four very different starting points', () => {
    for (const [nodes, edges, seed] of [
      [20, 40, 2],
      [60, 150, 0],
    ] as const) {
      const random = mulberry32(seed);
      const graph = new Graph();
      for (let index = 0; index < nodes; index += 1) graph.addNode(`v${String(index)}`);
      for (let index = 0; index < edges; index += 1) {
        graph.addEdge(
          `v${String(Math.floor(random() * nodes))}`,
          `v${String(Math.floor(random() * nodes))}`,
          `e${String(index)}`,
        );
      }
      const where = `${String(nodes)} nodes, ${String(edges)} edges`;
      const cold = rank(graph);
      const total = totalEdgeLength(graph, cold);
      expect(total, where).toBeLessThan(totalEdgeLength(graph, longestPathRankStage.run(prepare(graph))));
      // Every one of these is a different feasible starting basis: the ranking
      // squashed flat, stretched to twice its height, and turned upside down.
      for (const scale of [0, 2, -1]) {
        const hint = new Map([...cold.ranks].map(([id, value]) => [id, value * scale]));
        const state = networkSimplexRank({ initialRanks: hint }).run(prepare(graph));
        expectFeasible(graph, state, `${where} from ${String(scale)}`);
        expect(totalEdgeLength(graph, state), `${where} from ${String(scale)}`).toBe(total);
      }
    }
  });

  /**
   * A hint entry that SURVIVES, on an ancestor of a node with no entry of its
   * own. The hint tests above do not reach this: every entry of theirs is
   * dropped, so nothing is left to propagate, and a run where nothing survives
   * cannot tell a floor that propagates from one that does not.
   *
   * A floor does propagate. `f` is `b`'s only predecessor here, and a floor
   * under `f` pushes `b` down with it, so `b` lands one below `f` rather than
   * where the cold run left it, having had no entry at all. Both rankings cost
   * 7, so what the hint did was choose between two optima, which is the whole
   * job. What it cannot do is put `b` anywhere its predecessors do not allow.
   */
  it('lets a surviving hint on an ancestor move a node with no entry', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['a', 'd', 'ad'],
        ['d', 'e', 'de'],
        ['e', 'c', 'ec'],
        ['f', 'b', 'fb'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 3, d: 1, e: 2, f: 0 });
    const hint: ReadonlyMap<NodeId, number> = new Map([['f', 1]]);
    const hinted = networkSimplexRank({ initialRanks: hint }).run(prepare(graph));
    expectFeasible(graph, hinted, 'a floor on an ancestor');
    expect(Object.fromEntries(hinted.ranks)).toEqual({ a: 0, b: 2, c: 3, d: 1, e: 2, f: 1 });
    expect(totalEdgeLength(graph, hinted)).toBe(totalEdgeLength(graph, rank(graph)));
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
