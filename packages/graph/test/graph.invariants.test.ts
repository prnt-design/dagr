import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DagrGraphError } from '../src/errors.js';

/**
 * Property-style coverage: random operation sequences, with the index
 * invariants re-checked after every single call.
 *
 * The per-operation suites pin behaviour one call at a time. This one pins the
 * relationships that must hold no matter which calls came before, so a future
 * refactor of removal or of patch application cannot desynchronise the
 * adjacency indexes while staying green. Randomness is seeded and the seeds are
 * fixed, so any failure reproduces exactly.
 */

/** mulberry32, a 32-bit seeded PRNG. Deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything that must be true of the graph after any operation. */
function checkInvariants(graph: Graph, where: string): void {
  const nodes = graph.nodes();
  const edges = graph.edges();
  expect(nodes.length, `${where}: nodeCount`).toBe(graph.nodeCount);
  expect(edges.length, `${where}: edgeCount`).toBe(graph.edgeCount);

  for (const edge of edges) {
    // Every endpoint is a live node, and both indexes hold the edge.
    expect(graph.hasNode(edge.source), `${where}: source of ${edge.id}`).toBe(true);
    expect(graph.hasNode(edge.target), `${where}: target of ${edge.id}`).toBe(true);
    expect(graph.outEdges(edge.source), `${where}: outEdges of ${edge.source}`).toContain(edge);
    expect(graph.inEdges(edge.target), `${where}: inEdges of ${edge.target}`).toContain(edge);
  }

  let outTotal = 0;
  let inTotal = 0;
  for (const node of nodes) {
    const outgoing = graph.outEdges(node.id);
    const incoming = graph.inEdges(node.id);

    // Nothing foreign in either index.
    for (const edge of outgoing) {
      expect(edge.source, `${where}: ${edge.id} in outEdges of ${node.id}`).toBe(node.id);
      expect(graph.hasEdge(edge.id), `${where}: ${edge.id} still live`).toBe(true);
    }
    for (const edge of incoming) {
      expect(edge.target, `${where}: ${edge.id} in inEdges of ${node.id}`).toBe(node.id);
      expect(graph.hasEdge(edge.id), `${where}: ${edge.id} still live`).toBe(true);
    }

    // Degrees agree with the listings they summarise.
    expect(graph.outDegree(node.id), `${where}: outDegree of ${node.id}`).toBe(outgoing.length);
    expect(graph.inDegree(node.id), `${where}: inDegree of ${node.id}`).toBe(incoming.length);
    expect(graph.degree(node.id), `${where}: degree of ${node.id}`).toBe(
      outgoing.length + incoming.length,
    );
    outTotal += graph.outDegree(node.id);
    inTotal += graph.inDegree(node.id);

    // Neighbours are distinct, live, and in node insertion order.
    const order = nodes.map((candidate) => candidate.id);
    for (const side of [graph.successors(node.id), graph.predecessors(node.id)]) {
      expect(new Set(side).size, `${where}: duplicate neighbour of ${node.id}`).toBe(side.length);
      for (const neighbour of side) {
        expect(graph.hasNode(neighbour), `${where}: neighbour ${neighbour}`).toBe(true);
      }
      const ranks = side.map((neighbour) => order.indexOf(neighbour));
      expect(ranks, `${where}: neighbour order of ${node.id}`).toEqual(
        [...ranks].sort((left, right) => left - right),
      );
    }
  }

  // Every edge is counted exactly once from each side.
  expect(outTotal, `${where}: out-degree sum`).toBe(graph.edgeCount);
  expect(inTotal, `${where}: in-degree sum`).toBe(graph.edgeCount);
}

const NODE_POOL = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const EDGE_POOL = ['x1', 'x2', 'x3'] as const;

/** Runs a seeded operation sequence, checking invariants after every step. */
function fuzz(seed: number, steps: number): { maxNodes: number; maxEdges: number } {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => {
    const chosen = items[Math.floor(random() * items.length)];
    if (chosen === undefined) throw new Error('empty pool');
    return chosen;
  };

  const graph = new Graph();
  let maxNodes = 0;
  let maxEdges = 0;

  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    try {
      if (roll < 0.28) {
        graph.addNode(pick(NODE_POOL));
      } else if (roll < 0.4) {
        graph.addNode();
      } else if (roll < 0.68) {
        graph.addEdge(pick(NODE_POOL), pick(NODE_POOL));
      } else if (roll < 0.78) {
        graph.addEdge(pick(NODE_POOL), pick(NODE_POOL), pick(EDGE_POOL));
      } else if (roll < 0.9) {
        graph.removeEdge(pick([...EDGE_POOL, ...graph.edges().map((edge) => edge.id)]));
      } else {
        graph.removeNode(pick(NODE_POOL));
      }
    } catch (error) {
      // Duplicate and not-found rejections are part of the exercise. Anything
      // else is a real bug and must not be swallowed.
      if (!(error instanceof DagrGraphError)) throw error;
    }
    checkInvariants(graph, `seed ${String(seed)} step ${String(step)}`);
    maxNodes = Math.max(maxNodes, graph.nodeCount);
    maxEdges = Math.max(maxEdges, graph.edgeCount);
  }

  return { maxNodes, maxEdges };
}

describe('Graph invariants under random operation sequences', () => {
  for (const seed of [1, 2, 42, 1337, 20260726]) {
    it(`holds for seed ${String(seed)}`, () => {
      const { maxNodes, maxEdges } = fuzz(seed, 400);
      // Guard against a vacuous run: the sequence must actually build a graph.
      expect(maxNodes).toBeGreaterThan(3);
      expect(maxEdges).toBeGreaterThan(5);
    });
  }

  it('replays a seed identically', () => {
    expect(fuzz(7, 200)).toEqual(fuzz(7, 200));
  });
});
