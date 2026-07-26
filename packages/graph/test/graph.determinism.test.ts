import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';

/**
 * A mutation script exercising explicit ids, generated ids, parallel edges,
 * self loops, and both kinds of removal.
 */
function build(): Graph {
  const graph = new Graph();
  graph.addNode('zeta');
  graph.addNode('alpha');
  graph.addNode();
  graph.addNode('mid');
  graph.addEdge('zeta', 'alpha');
  graph.addEdge('zeta', 'alpha', 'explicit');
  graph.addEdge('alpha', 'n1');
  graph.addEdge('mid', 'mid');
  graph.addNode('late');
  graph.addEdge('n1', 'late');
  graph.removeNode('alpha');
  graph.addNode('alpha');
  graph.addEdge('late', 'alpha');
  return graph;
}

function snapshot(graph: Graph): string {
  const nodes = graph.nodes().map((node) => node.id);
  const edges = graph.edges().map((edge) => `${edge.id}:${edge.source}->${edge.target}`);
  const adjacency = nodes.map(
    (id) => `${id}|${graph.successors(id).join(',')}|${graph.predecessors(id).join(',')}`,
  );
  return JSON.stringify({ nodes, edges, adjacency });
}

describe('Graph determinism', () => {
  it('produces an identical snapshot for an identical mutation script', () => {
    expect(snapshot(build())).toBe(snapshot(build()));
  });

  it('iterates nodes in insertion order, not sorted order', () => {
    const ids = build()
      .nodes()
      .map((node) => node.id);
    expect(ids).toEqual(['zeta', 'n1', 'mid', 'late', 'alpha']);
    expect(ids).not.toEqual([...ids].sort());
  });

  it('keeps the edge listing in insertion order across removals', () => {
    const graph = build();
    expect(graph.edges().map((edge) => edge.id)).toEqual(['e3', 'e4', 'e5']);
  });

  it('gives repeated queries the same answer while the graph is unchanged', () => {
    const graph = build();
    expect(graph.successors('n1')).toEqual(graph.successors('n1'));
    expect(graph.outEdges('n1')).toEqual(graph.outEdges('n1'));
    expect(graph.predecessors('alpha')).toEqual(['late']);
  });
});
