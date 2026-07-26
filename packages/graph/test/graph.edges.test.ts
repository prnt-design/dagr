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
    expect(edge).toEqual({ id: 'ab', source: 'a', target: 'b', attrs: {} });
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
    expect(loop).toEqual({ id: 'loop', source: 'a', target: 'a', attrs: {} });
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

  it('reports the kind and the offending value on an empty edge id', () => {
    const graph = triangle();
    try {
      graph.addEdge('a', 'b', '');
      expect.unreachable('addEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as InvalidIdError).kind).toBe('edge');
      expect((error as InvalidIdError).id).toBe('');
    }
  });
});

describe('Graph requireEdge', () => {
  it('returns the same record identity as getEdge', () => {
    const graph = triangle();
    const added = graph.addEdge('a', 'b', 'ab');
    expect(graph.requireEdge('ab')).toBe(added);
    expect(graph.requireEdge('ab')).toBe(graph.getEdge('ab'));
    expect(Object.isFrozen(graph.requireEdge('ab'))).toBe(true);
  });

  it('throws EdgeNotFoundError with the EDGE_NOT_FOUND code when the edge is absent', () => {
    const graph = triangle();
    expect(() => graph.requireEdge('nope')).toThrow(EdgeNotFoundError);
    try {
      graph.requireEdge('nope');
      expect.unreachable('requireEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EdgeNotFoundError);
      expect((error as EdgeNotFoundError).code).toBe('EDGE_NOT_FOUND');
      expect((error as EdgeNotFoundError).id).toBe('nope');
    }
  });

  it('stops resolving an edge id once the edge is removed', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.removeEdge('ab');
    expect(() => graph.requireEdge('ab')).toThrow(EdgeNotFoundError);
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

  it('stops resolving the id through getEdge once the edge is gone', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.removeEdge('ab');
    expect(graph.getEdge('ab')).toBeUndefined();
    expect(graph.hasEdge('ab')).toBe(false);
  });

  it('stops resolving a cascaded edge through getEdge', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    graph.removeNode('b');
    expect(graph.getEdge('ab')).toBeUndefined();
    expect(graph.hasEdge('ab')).toBe(false);
  });
});

describe('Graph edge record immutability', () => {
  it('freezes the record returned by addEdge and getEdge', () => {
    const graph = triangle();
    const added = graph.addEdge('a', 'b', 'ab');
    expect(Object.isFrozen(added)).toBe(true);
    expect(Object.isFrozen(graph.getEdge('ab'))).toBe(true);
    expect(Object.isFrozen(graph.edges()[0])).toBe(true);
    expect(Object.isFrozen(graph.outEdges('a')[0])).toBe(true);
  });

  it('rejects a write through a cast, so the indexes cannot desynchronise', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'ab');
    expect(() => {
      (graph.getEdge('ab') as { source: string }).source = 'z';
    }).toThrow(TypeError);
    expect(graph.getEdge('ab')?.source).toBe('a');
    graph.removeEdge('ab');
    expect(graph.outDegree('a')).toBe(0);
    expect(graph.outEdges('a')).toEqual([]);
    expect(graph.inDegree('b')).toBe(0);
    expect(graph.inEdges('b')).toEqual([]);
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

  it('never reuses an id explicitly claimed and then removed', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'e1');
    graph.removeEdge('e1');
    expect(graph.addEdge('a', 'b').id).toBe('e2');
  });

  it('does not recycle a freed suffix the counter later walks up to', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'e3');
    graph.removeEdge('e3');
    expect([
      graph.addEdge('a', 'b').id,
      graph.addEdge('a', 'b').id,
      graph.addEdge('a', 'b').id,
    ]).toEqual(['e4', 'e5', 'e6']);
  });

  it('leaves the counter alone for an explicit id outside the generated shape', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'e007');
    expect(graph.addEdge('a', 'b').id).toBe('e1');
    expect(graph.addEdge('a', 'b').id).toBe('e2');
  });

  it('leaves the counter alone for an explicit suffix beyond the safe integer range', () => {
    const graph = triangle();
    graph.addEdge('a', 'b', 'e99999999999999999999');
    expect(graph.addEdge('a', 'b').id).toBe('e1');
    expect(graph.addEdge('a', 'b').id).toBe('e2');
    expect(graph.edgeCount).toBe(3);
  });

  it('does not burn a generated id on a failed call', () => {
    const graph = triangle();
    expect(() => graph.addEdge('a', 'nope')).toThrow(NodeNotFoundError);
    expect(() => graph.addEdge('nope', 'a')).toThrow(NodeNotFoundError);
    expect(() => graph.addEdge('a', 'b', '')).toThrow(InvalidIdError);
    graph.addEdge('a', 'b', 'taken');
    expect(() => graph.addEdge('a', 'b', 'taken')).toThrow(DuplicateEdgeError);
    expect(graph.addEdge('a', 'b').id).toBe('e1');
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
    const listed = graph.edges() as unknown[];
    listed.length = 0;
    expect(graph.edgeCount).toBe(1);
    expect(graph.edges().map((edge) => edge.id)).toEqual(['ab']);
  });
});
