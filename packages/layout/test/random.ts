import { Graph } from '@dagr/graph';
import type { NodeId } from '@dagr/graph';

/**
 * The seeded random graph population the cycle-breaking and ranking suites both
 * run over.
 *
 * A helper module rather than a copy in each file, and not because of the
 * duplication: two generators would drift, and a random suite whose generator
 * quietly stopped producing cycles stays green while testing nothing.
 */

/** mulberry32, a 32-bit seeded PRNG, as in `@dagr/graph`'s invariant suite. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random digraph, drawn to hit every case the cycle breaker and the ranker
 * have a rule about: self loops, parallel edges, disconnected components, and
 * the empty graph. Endpoints are drawn uniformly and independently, so cycles
 * are the norm rather than the exception at these densities, which is the
 * point: a generator that mostly produced DAGs would leave both suites
 * vacuously green.
 *
 * Small on purpose. The suites that use it check properties exhaustively,
 * including one by walking every path in the graph, and a dozen nodes is enough
 * for every structure they have something to say about.
 */
export function randomDigraph(random: () => number): Graph {
  const graph = new Graph();
  const nodeCount = Math.floor(random() * 13);
  const ids: NodeId[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    ids.push(graph.addNode(`v${String(index)}`).id);
  }
  if (ids.length === 0) return graph;
  const edgeCount = Math.floor(random() * (nodeCount * 2 + 1));
  for (let index = 0; index < edgeCount; index += 1) {
    const source = ids[Math.floor(random() * ids.length)];
    const target = ids[Math.floor(random() * ids.length)];
    if (source === undefined || target === undefined) continue;
    graph.addEdge(source, target, `e${String(index)}`);
  }
  return graph;
}
