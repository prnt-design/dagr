import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it, vi } from 'vitest';
import { measureNodes, resolveConfig } from '../src/config.js';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import { longestPathRankStage } from '../src/rank.js';
import type { PreparedState, RankedState } from '../src/types.js';
import { mulberry32, randomDigraph } from './random.js';

/** What the runner hands the rank stage, built the way the runner builds it. */
function prepare(graph: Graph): PreparedState {
  const config = resolveConfig(undefined);
  return { graph, config, sizes: measureNodes(graph, config, undefined) };
}

/** Runs the stage under test on a graph and hands back the whole record. */
function rank(graph: Graph): RankedState {
  return longestPathRankStage.run(prepare(graph));
}

/** Ranks as a plain object, which reads better in a failure than a Map does. */
function ranksOf(graph: Graph): Record<NodeId, number> {
  return Object.fromEntries(rank(graph).ranks);
}

/** The rank of a node, which the stage owes for every node in the graph. */
function requireRank(state: RankedState, id: NodeId): number {
  const rank = state.ranks.get(id);
  if (rank === undefined) throw new Error(`no rank for "${id}"`);
  return rank;
}

/**
 * The number of edges on the longest path in the acyclic view, found by walking
 * every path there is.
 *
 * Brute force on purpose. A memoised sweep would be the production algorithm
 * written twice, and a checker that shares an implementation with the thing it
 * checks carries the same bug and proves nothing. Exhaustive enumeration cannot
 * agree with the ranker for the wrong reason, and the graphs it runs on here
 * are small enough that the exponent does not matter. It terminates because the
 * view is acyclic, which the rest of the suite is what establishes.
 */
function longestChain(graph: Graph, reversed: ReadonlySet<EdgeId>): number {
  const successors = new Map<NodeId, Set<NodeId>>();
  for (const node of graph.nodes()) successors.set(node.id, new Set());
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const from = reversed.has(edge.id) ? edge.target : edge.source;
    const to = reversed.has(edge.id) ? edge.source : edge.target;
    successors.get(from)?.add(to);
  }
  let longest = 0;
  const walk = (id: NodeId, depth: number): void => {
    if (depth > longest) longest = depth;
    for (const next of successors.get(id) ?? []) walk(next, depth + 1);
  };
  for (const node of graph.nodes()) walk(node.id, 0);
  return longest;
}

/** The `y` of a row that the layout under test is expected to have drawn. */
function requireRow(rows: ReadonlyMap<number, number>, rank: number): number {
  const row = rows.get(rank);
  if (row === undefined) throw new Error(`no row for rank ${String(rank)}`);
  return row;
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
 * something of every kind to deal with.
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

describe('longestPathRankStage', () => {
  it('puts a lone node on rank 0', () => {
    expect(ranksOf(build(['a'], []))).toEqual({ a: 0 });
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

  // The case that separates longest path from a breadth-first sweep: `a -> c`
  // reaches `c` in one hop, and `c` still belongs below `b`, or the edge
  // `b -> c` would run sideways instead of down.
  it('takes the long path to a node, not the short one', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['a', 'c', 'ac'],
      ],
    );
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1, c: 2 });
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

  // The runner's own check only asks for `<=`, so an edge that stayed inside
  // one rank would satisfy it. This stage means to produce strict descent, so
  // the strict form is asserted here, where it is meant.
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
    // Both endpoints are the same node, so sharing a rank is free. What is not
    // free is `b` having a rank at all: a sweep that counted the loop as an
    // in-edge would wait forever for an in-degree that nothing can clear.
    expect(ranksOf(graph)).toEqual({ a: 0, b: 1 });
  });

  // Guaranteed by construction, not by luck: a node at rank r got there from a
  // predecessor at rank r - 1, so every rank below the highest has an occupant.
  // The order stage turns ranks into layers and the runner rejects an empty
  // layer, so a gap here would surface there as a contract failure.
  it('uses every rank from zero to the highest, with no gaps', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'e', 'ae'],
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['d', 'e', 'de'],
      ],
    );
    const ranks = [...new Set(rank(graph).ranks.values())].sort((left, right) => left - right);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });

  it('is no taller than the longest path in the acyclic view', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['a', 'd', 'ad'],
        ['a', 'c', 'ac'],
      ],
    );
    const state = rank(graph);
    expect(Math.max(...state.ranks.values())).toBe(longestChain(graph, state.reversedEdges));
    expect(longestChain(graph, state.reversedEdges)).toBe(3);
  });

  it('declares no virtual node and passes the sizes through untouched', () => {
    const input = prepare(tangled());
    const state = longestPathRankStage.run(input);
    expect(state.virtualNodes.size).toBe(0);
    expect(state.sizes).toBe(input.sizes);
    expect(state.graph).toBe(input.graph);
    expect(state.config).toBe(input.config);
  });

  it('never touches the graph it was handed', () => {
    const graph = tangled();
    // Snapshotted rather than written out as literals, so this asserts the
    // graph is unchanged rather than pinning `@dagr/graph`'s record shape,
    // which gains fields over time and is none of this test's business.
    const nodesBefore = graph.nodes();
    const edgesBefore = graph.edges();
    const state = rank(graph);
    expect(state.reversedEdges.size).toBeGreaterThan(0);
    expect(graph.nodes()).toEqual(nodesBefore);
    expect(graph.edges()).toEqual(edgesBefore);
    expect(graph.nodeCount).toBe(nodesBefore.length);
    expect(graph.edgeCount).toBe(edgesBefore.length);
    // The reversal was bookkeeping on the record, so the edges still run the
    // way the caller authored them.
    for (const id of state.reversedEdges) {
      const before = edgesBefore.find((edge) => edge.id === id);
      expect(graph.getEdge(id)).toBe(before);
    }
  });

  it('gives the same graph the same ranks twice', () => {
    const graph = tangled();
    expect([...rank(graph).ranks]).toEqual([...rank(graph).ranks]);
    expect([...rank(graph).reversedEdges]).toEqual([...rank(graph).reversedEdges]);
  });

  it('gives two graphs from the same script the same ranks', () => {
    expect([...rank(tangled()).ranks]).toEqual([...rank(tangled()).ranks]);
  });

  it('fails loudly, and as its own bug, if the acyclic view still has a cycle', async () => {
    // The one failure this stage can suffer that is nobody else's fault, so it
    // is unreachable without replacing the cycle breaker: a breaker that
    // reverses nothing leaves the sweep with two nodes that each wait on the
    // other. It throws an `InternalLayoutError` rather than a
    // `StageContractError`, which would name a stage the caller supplied for a
    // bug in this one.
    vi.resetModules();
    vi.doMock('../src/cycles.js', () => ({ feedbackArcSet: () => new Set<EdgeId>() }));
    try {
      const { longestPathRankStage: stage } = await import('../src/rank.js');
      const { InternalLayoutError: Internal } = await import('../src/errors.js');
      const graph = build(
        ['a', 'b'],
        [
          ['a', 'b', 'ab'],
          ['b', 'a', 'ba'],
        ],
      );
      expect(() => stage.run(prepare(graph))).toThrow(/2 of 2 nodes could not be ranked/);
      expect(() => stage.run(prepare(graph))).toThrow(Internal);
      expect(() => stage.run(prepare(graph))).not.toThrow(StageContractError);
    } finally {
      vi.doUnmock('../src/cycles.js');
      vi.resetModules();
    }
  });
});

describe('layout with the default rank stage', () => {
  it('is the default', () => {
    expect(defaultStages.rank).toBe(longestPathRankStage);
    expect(defaultStages.rank.name).toBe('longest-path-rank');
  });

  it('draws a cyclic graph as several layers, and every runner check passes', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'a', 'ca'],
        ['b', 'd', 'bd'],
      ],
    );
    // `layout` runs every contract check in the runner, so reaching a result at
    // all is most of the assertion.
    const result = layout({ graph });
    const state = rank(graph);

    // One row per rank, and nodes of a rank share a row: the grid positioner
    // gives a layer one centre line, so equal ranks mean equal `y`.
    const rows = new Map<number, number>();
    for (const node of result.nodes.values()) {
      const layer = requireRank(state, node.id);
      const row = rows.get(layer);
      if (row === undefined) rows.set(layer, node.y);
      else expect(node.y, `${node.id} shares a row with its rank`).toBe(row);
    }
    expect(rows.size).toBeGreaterThan(1);
    expect([...rows.keys()].sort((left, right) => left - right)).toEqual([0, 1, 2]);
    // Layers run down the page in rank order.
    expect(requireRow(rows, 0)).toBeLessThan(requireRow(rows, 1));
    expect(requireRow(rows, 1)).toBeLessThan(requireRow(rows, 2));

    // The cycle was broken by bookkeeping, so the result still runs the edges
    // the way the caller authored them.
    expect(result.edges.get('ca')).toMatchObject({ source: 'c', target: 'a' });
    expect(graph.getEdge('ca')?.source).toBe('c');
  });
});

describe('longestPathRankStage on random digraphs', () => {
  // Fixed seeds rather than a clock or `Math.random`, so a failure is a failure
  // anyone can reproduce from the name of the test that reported it.
  for (const seed of [3, 11, 42, 99, 1337, 20260726]) {
    it(`holds every guarantee for seed ${String(seed)}`, () => {
      const random = mulberry32(seed);
      // Counted and asserted on at the end: most of these checks are vacuous on
      // a graph with no cycle, so a generator that drifted into drawing sparse
      // DAGs would leave this green while testing nothing.
      let broken = 0;
      for (let round = 0; round < 30; round += 1) {
        const graph = randomDigraph(random);
        const where = `seed ${String(seed)} round ${String(round)}`;
        const nodesBefore = graph.nodes();
        const edgesBefore = graph.edges();
        const state = rank(graph);
        if (state.reversedEdges.size > 0) broken += 1;

        // Every node ranked, and nothing else.
        expect([...state.ranks.keys()], `${where}: ranked exactly the graph`).toEqual(
          nodesBefore.map((node) => node.id),
        );
        expect(state.virtualNodes.size, `${where}: virtual nodes`).toBe(0);

        // Contiguous from zero, which is what keeps the order stage from
        // producing an empty layer.
        const used = [...new Set(state.ranks.values())].sort((left, right) => left - right);
        expect(used, `${where}: ranks used`).toEqual(used.map((_, index) => index));

        for (const edge of graph.edges()) {
          const from = requireRank(state, edge.source);
          const to = requireRank(state, edge.target);
          if (edge.source === edge.target) {
            expect(state.reversedEdges.has(edge.id), `${where}: ${edge.id} is a reversed self loop`)
              .toBe(false);
            continue;
          }
          // Strict both ways. The runner only asks for `<=`, which an edge
          // sitting inside one rank would satisfy; this stage means more.
          if (state.reversedEdges.has(edge.id)) {
            expect(to, `${where}: reversed ${edge.id} runs up`).toBeLessThan(from);
          } else {
            expect(from, `${where}: ${edge.id} runs down`).toBeLessThan(to);
          }
        }

        // Minimum height, against a longest path found by walking every path.
        const height = used.length === 0 ? 0 : Math.max(...state.ranks.values());
        expect(height, `${where}: height`).toBe(longestChain(graph, state.reversedEdges));

        // Same ranks on a second run, and a graph nobody touched.
        expect([...rank(graph).ranks], `${where}: determinism`).toEqual([...state.ranks]);
        expect(graph.nodes(), `${where}: nodes unchanged`).toEqual(nodesBefore);
        expect(graph.edges(), `${where}: edges unchanged`).toEqual(edgesBefore);
      }
      expect(broken, `seed ${String(seed)}: rounds that needed an edge reversed`).toBeGreaterThan(0);
    });
  }
});
