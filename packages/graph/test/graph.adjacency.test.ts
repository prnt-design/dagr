import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { NodeNotFoundError } from '../src/errors.js';

/** a -> b, a -> b (parallel), a -> c, c -> a, b -> b (self loop). */
function sample(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  graph.addEdge('a', 'b', 'ab1');
  graph.addEdge('a', 'b', 'ab2');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('c', 'a', 'ca');
  graph.addEdge('b', 'b', 'bb');
  return graph;
}

describe('Graph outEdges and inEdges', () => {
  it('returns an empty list for an isolated node', () => {
    const graph = new Graph();
    graph.addNode('lonely');
    expect(graph.outEdges('lonely')).toEqual([]);
    expect(graph.inEdges('lonely')).toEqual([]);
  });

  it('returns out-edges in insertion order', () => {
    const graph = sample();
    expect(graph.outEdges('a').map((edge) => edge.id)).toEqual(['ab1', 'ab2', 'ac']);
  });

  it('returns in-edges in insertion order', () => {
    const graph = sample();
    expect(graph.inEdges('b').map((edge) => edge.id)).toEqual(['ab1', 'ab2', 'bb']);
  });

  it('counts a self loop as both an out-edge and an in-edge', () => {
    const graph = sample();
    expect(graph.outEdges('b').map((edge) => edge.id)).toEqual(['bb']);
    expect(graph.inEdges('b').map((edge) => edge.id)).toContain('bb');
  });

  it('throws for an unknown node', () => {
    const graph = sample();
    expect(() => graph.outEdges('nope')).toThrow(NodeNotFoundError);
    expect(() => graph.inEdges('nope')).toThrow(NodeNotFoundError);
  });
});

describe('Graph successors and predecessors', () => {
  it('returns an empty list for an isolated node', () => {
    const graph = new Graph();
    graph.addNode('lonely');
    expect(graph.successors('lonely')).toEqual([]);
    expect(graph.predecessors('lonely')).toEqual([]);
  });

  it('deduplicates parallel edges and keeps first-connection order', () => {
    const graph = sample();
    expect(graph.successors('a')).toEqual(['b', 'c']);
    expect(graph.predecessors('a')).toEqual(['c']);
  });

  it('reports a self loop as its own successor and predecessor', () => {
    const graph = sample();
    expect(graph.successors('b')).toEqual(['b']);
    expect(graph.predecessors('b')).toEqual(['a', 'b']);
  });

  it('orders by the first connecting edge, not by node insertion', () => {
    const graph = new Graph();
    graph.addNode('root');
    graph.addNode('x');
    graph.addNode('y');
    graph.addNode('z');
    graph.addEdge('root', 'z');
    graph.addEdge('root', 'x');
    graph.addEdge('root', 'z');
    graph.addEdge('root', 'y');
    expect(graph.successors('root')).toEqual(['z', 'x', 'y']);
  });

  it('throws for an unknown node', () => {
    const graph = sample();
    expect(() => graph.successors('nope')).toThrow(NodeNotFoundError);
    expect(() => graph.predecessors('nope')).toThrow(NodeNotFoundError);
  });
});

describe('Graph edgesBetween', () => {
  it('returns every parallel edge in insertion order', () => {
    const graph = sample();
    expect(graph.edgesBetween('a', 'b').map((edge) => edge.id)).toEqual(['ab1', 'ab2']);
  });

  it('respects direction', () => {
    const graph = sample();
    expect(graph.edgesBetween('b', 'a')).toEqual([]);
    expect(graph.edgesBetween('c', 'a').map((edge) => edge.id)).toEqual(['ca']);
  });

  it('returns the self loop when source and target are the same node', () => {
    const graph = sample();
    expect(graph.edgesBetween('b', 'b').map((edge) => edge.id)).toEqual(['bb']);
  });

  it('returns an empty list for an unconnected pair', () => {
    const graph = sample();
    expect(graph.edgesBetween('b', 'c')).toEqual([]);
  });

  it('throws when either endpoint is unknown', () => {
    const graph = sample();
    expect(() => graph.edgesBetween('nope', 'a')).toThrow(NodeNotFoundError);
    expect(() => graph.edgesBetween('a', 'nope')).toThrow(NodeNotFoundError);
  });
});

describe('Graph degrees', () => {
  it('is zero on every axis for an isolated node', () => {
    const graph = new Graph();
    graph.addNode('lonely');
    expect(graph.outDegree('lonely')).toBe(0);
    expect(graph.inDegree('lonely')).toBe(0);
    expect(graph.degree('lonely')).toBe(0);
  });

  it('counts parallel edges separately', () => {
    const graph = sample();
    expect(graph.outDegree('a')).toBe(3);
    expect(graph.inDegree('a')).toBe(1);
    expect(graph.degree('a')).toBe(4);
  });

  it('counts a self loop once out, once in, so twice in degree', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addEdge('a', 'a', 'loop');
    expect(graph.outDegree('a')).toBe(1);
    expect(graph.inDegree('a')).toBe(1);
    expect(graph.degree('a')).toBe(2);
  });

  it('throws for an unknown node', () => {
    const graph = sample();
    expect(() => graph.outDegree('nope')).toThrow(NodeNotFoundError);
    expect(() => graph.inDegree('nope')).toThrow(NodeNotFoundError);
    expect(() => graph.degree('nope')).toThrow(NodeNotFoundError);
  });
});

describe('Graph adjacency index consistency', () => {
  it('drops adjacency when an edge is removed', () => {
    const graph = sample();
    graph.removeEdge('ab1');
    expect(graph.outEdges('a').map((edge) => edge.id)).toEqual(['ab2', 'ac']);
    expect(graph.inEdges('b').map((edge) => edge.id)).toEqual(['ab2', 'bb']);
    expect(graph.successors('a')).toEqual(['b', 'c']);
    graph.removeEdge('ab2');
    expect(graph.successors('a')).toEqual(['c']);
  });

  it('leaves no stale adjacency on a node re-added under the same id', () => {
    const graph = sample();
    graph.removeNode('b');
    expect(graph.successors('a')).toEqual(['c']);
    expect(graph.outDegree('a')).toBe(1);
    graph.addNode('b');
    expect(graph.outEdges('b')).toEqual([]);
    expect(graph.inEdges('b')).toEqual([]);
    expect(graph.degree('b')).toBe(0);
    expect(graph.successors('a')).toEqual(['c']);
  });

  it('keeps the surviving side of a cascade consistent', () => {
    const graph = sample();
    graph.removeNode('a');
    expect(graph.inEdges('b')).toEqual([graph.getEdge('bb')]);
    expect(graph.outEdges('c')).toEqual([]);
    expect(graph.inEdges('c')).toEqual([]);
    expect(graph.edgeCount).toBe(1);
  });
});

describe('Graph adjacency array isolation', () => {
  it('is unaffected by a caller mutating a returned adjacency array', () => {
    const graph = sample();
    (graph.outEdges('a') as unknown[]).length = 0;
    (graph.inEdges('b') as unknown[]).length = 0;
    (graph.successors('a') as string[]).push('ghost');
    (graph.predecessors('b') as string[]).pop();
    (graph.edgesBetween('a', 'b') as unknown[]).length = 0;
    expect(graph.outEdges('a').map((edge) => edge.id)).toEqual(['ab1', 'ab2', 'ac']);
    expect(graph.inEdges('b').map((edge) => edge.id)).toEqual(['ab1', 'ab2', 'bb']);
    expect(graph.successors('a')).toEqual(['b', 'c']);
    expect(graph.predecessors('b')).toEqual(['a', 'b']);
    expect(graph.edgesBetween('a', 'b').map((edge) => edge.id)).toEqual(['ab1', 'ab2']);
  });
});
