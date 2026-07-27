import { Graph } from '@dagr/graph';
import type { NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { measureNodes, resolveConfig } from '../src/config.js';
import { defaultStages, layout } from '../src/index.js';
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
