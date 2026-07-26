import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DuplicateEdgeError, EdgeNotFoundError, InvalidIdError, NodeNotFoundError } from '../src/errors.js';

function triangle(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  return graph;
}

describe('Graph edge basics', () => {
  it('starts with no edges', () => {
    const graph = new Graph();
    expect(graph.edgeCount).toBe(0);
    expect(graph.edges()).toEqual([]);
    expect(graph.hasEdge('e1')).toBe(false);
    expect(graph.getEdge('e1')).toBeUndefined();
  });

  it('adds an edge between two nodes', () => {
    const graph = triangle();
    const edge = graph.addEdge('a', 'b', 'ab');
    expect(edge).toEqual({ id: 'ab', source: 'a', target: 'b' });
    expect(graph.edgeCount).toBe(1);
    expect(graph.hasEdge('ab')).toBe(true);
    expect(graph.getEdge('ab')).toBe(edge);
  });

  it('lists edges in insertion order', () => {
    const graph = triangle();
    graph.addEdge('b', 'c', 'bc');
    graph.addEdge('a', 'b', 'ab');
    expect(graph.edges().map((edge) => edge.id)).toEqual(['bc', 'ab']);
  });

  it('allows parallel edges between the same ordered pair', () => {
    const graph = triangle();
    const first = graph.addEdge('a', 'b');
    const second = graph.addEdge('a', 'b');
    expect(first.id).not.toBe(second.id);
    expect(graph.edgeCount).toBe(2);
  });

  it('allows a self loop', () => {
    const graph = triangle();
    const loop = graph.addEdge('a', 'a', 'loop');
    expect(loop).toEqual({ id: 'loop', source: 'a', target: 'a' });
    expect(graph.edgeCount).toBe(1);
  });

  it('treats direction as significant', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('b', 'a', 'ba');
    expect(graph.edgeCount).toBe(2);
  });
});

describe('Graph edge errors', () => {
  it('throws when the source node is unknown', () => {
    const graph = triangle();
    expect(() => graph.addEdge('nope', 'a')).toThrow(NodeNotFoundError);
    expect(graph.edgeCount).toBe(0);
  });

  it('throws when the target node is unknown', () => {
    const graph = triangle();
    expect(() => graph.addEdge('a', 'nope')).toThrow(NodeNotFoundError);
    expect(graph.edgeCount).toBe(0);
  });

  it('throws on a duplicate edge id', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    expect(() => graph.addEdge('b', 'c', 'ab')).toThrow(DuplicateEdgeError);
    expect(graph.edgeCount).toBe(1);
  });

  it('throws on an empty explicit edge id', () => {
    const graph = triangle();
    expect(() => graph.addEdge('a', 'b', '')).toThrow(InvalidIdError);
    expect(graph.edgeCount).toBe(0);
  });

  it('throws when removing an unknown edge', () => {
    const graph = triangle();
    expect(() => graph.removeEdge('nope')).toThrow(EdgeNotFoundError);
  });
});

describe('Graph edge removal', () => {
  it('removes an edge and leaves its endpoints alone', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('b', 'c', 'bc');
    graph.removeEdge('ab');
    expect(graph.edgeCount).toBe(1);
    expect(graph.hasEdge('ab')).toBe(false);
    expect(graph.edges().map((edge) => edge.id)).toEqual(['bc']);
    expect(graph.nodeCount).toBe(3);
  });

  it('removes only the named edge of a parallel pair', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'first');
    graph.addEdge('a', 'b', 'second');
    graph.removeEdge('first');
    expect(graph.edges().map((edge) => edge.id)).toEqual(['second']);
  });

  it('removes a self loop', () => {
    const graph = triangle();
    graph.addEdge('a', 'a', 'loop');
    graph.removeEdge('loop');
    expect(graph.edgeCount).toBe(0);
  });
});

describe('Graph generated edge ids', () => {
  it('generates e1, e2, e3 in order', () => {
    const graph = triangle();
    expect(graph.addEdge('a', 'b').id).toBe('e1');
    expect(graph.addEdge('a', 'b').id).toBe('e2');
    expect(graph.addEdge('b', 'c').id).toBe('e3');
  });

  it('skips ids already taken by explicit calls', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'e1');
    graph.addEdge('a', 'b', 'e2');
    expect(graph.addEdge('a', 'b').id).toBe('e3');
  });

  it('skips an explicit id that looks exactly like a later generated id', () => {
    const graph = triangle();
    expect(graph.addEdge('a', 'b').id).toBe('e1');
    graph.addEdge('a', 'b', 'e2');
    graph.addEdge('a', 'b', 'e3');
    expect(graph.addEdge('a', 'b').id).toBe('e4');
  });

  it('never reuses a generated id after the edge is removed', () => {
    const graph = triangle();
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'b');
    graph.removeEdge('e1');
    expect(graph.addEdge('a', 'b').id).toBe('e3');
  });

  it('keeps node and edge counters independent', () => {
    const graph = new Graph();
    const source = graph.addNode();
    const target = graph.addNode();
    expect([source.id, target.id]).toEqual(['n1', 'n2']);
    expect(graph.addEdge(source.id, target.id).id).toBe('e1');
  });
});

describe('Graph cascade removal', () => {
  it('removes every incident edge when a node goes', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('c', 'b', 'cb');
    graph.addEdge('b', 'c', 'bc');
    graph.addEdge('b', 'b', 'loop');
    graph.addEdge('a', 'c', 'ac');
    graph.removeNode('b');
    expect(graph.edges().map((edge) => edge.id)).toEqual(['ac']);
    expect(graph.edgeCount).toBe(1);
    expect(graph.nodeCount).toBe(2);
  });

  it('removes parallel edges in the cascade too', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'one');
    graph.addEdge('a', 'b', 'two');
    graph.removeNode('b');
    expect(graph.edgeCount).toBe(0);
  });
});

describe('Graph returned array isolation', () => {
  it('is unaffected by a caller mutating the array from edges()', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    const listed = graph.edges() as { id: string; source: string; target: string }[];
    listed.length = 0;
    expect(graph.edgeCount).toBe(1);
    expect(graph.edges().map((edge) => edge.id)).toEqual(['ab']);
  });
});
