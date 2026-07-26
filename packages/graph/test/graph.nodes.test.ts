import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DuplicateNodeError, InvalidIdError, NodeNotFoundError } from '../src/errors.js';

describe('Graph node basics', () => {
  it('starts empty', () => {
    const graph = new Graph();
    expect(graph.nodeCount).toBe(0);
    expect(graph.nodes()).toEqual([]);
    expect(graph.hasNode('a')).toBe(false);
    expect(graph.getNode('a')).toBeUndefined();
  });

  it('adds a node with an explicit id', () => {
    const graph = new Graph();
    const node = graph.addNode('a');
    expect(node).toEqual({ id: 'a' });
    expect(graph.nodeCount).toBe(1);
    expect(graph.hasNode('a')).toBe(true);
    expect(graph.getNode('a')).toEqual({ id: 'a' });
  });

  it('returns the same node record from addNode and getNode', () => {
    const graph = new Graph();
    const added = graph.addNode('a');
    expect(graph.getNode('a')).toBe(added);
  });

  it('lists nodes in insertion order', () => {
    const graph = new Graph();
    graph.addNode('c');
    graph.addNode('a');
    graph.addNode('b');
    expect(graph.nodes().map((node) => node.id)).toEqual(['c', 'a', 'b']);
  });

  it('rejects a duplicate node id', () => {
    const graph = new Graph();
    graph.addNode('a');
    expect(() => graph.addNode('a')).toThrow(DuplicateNodeError);
    expect(graph.nodeCount).toBe(1);
  });

  it('rejects an empty node id', () => {
    const graph = new Graph();
    expect(() => graph.addNode('')).toThrow(InvalidIdError);
    expect(graph.nodeCount).toBe(0);
  });

  it('reports the kind and the offending value on an empty node id', () => {
    const graph = new Graph();
    try {
      graph.addNode('');
      expect.unreachable('addNode should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as InvalidIdError).kind).toBe('node');
      expect((error as InvalidIdError).id).toBe('');
    }
  });
});

describe('Graph requireNode', () => {
  it('returns the same record identity as getNode', () => {
    const graph = new Graph();
    const added = graph.addNode('a');
    expect(graph.requireNode('a')).toBe(added);
    expect(graph.requireNode('a')).toBe(graph.getNode('a'));
    expect(Object.isFrozen(graph.requireNode('a'))).toBe(true);
  });

  it('throws NodeNotFoundError with the NODE_NOT_FOUND code when the node is absent', () => {
    const graph = new Graph();
    expect(() => graph.requireNode('nope')).toThrow(NodeNotFoundError);
    try {
      graph.requireNode('nope');
      expect.unreachable('requireNode should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NodeNotFoundError);
      expect((error as NodeNotFoundError).code).toBe('NODE_NOT_FOUND');
      expect((error as NodeNotFoundError).id).toBe('nope');
    }
  });

  it('lets a successors listing be resolved to records without a non-null assertion', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b');
    graph.addEdge('a', 'c');
    const ids = graph.successors('a').map((id) => graph.requireNode(id).id);
    expect(ids).toEqual(['b', 'c']);
  });
});

describe('Graph node removal', () => {
  it('removes a node', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.removeNode('a');
    expect(graph.nodeCount).toBe(1);
    expect(graph.hasNode('a')).toBe(false);
    expect(graph.nodes().map((node) => node.id)).toEqual(['b']);
  });

  it('stops resolving the id through getNode once the node is gone', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.removeNode('a');
    expect(graph.getNode('a')).toBeUndefined();
    expect(graph.hasNode('a')).toBe(false);
  });

  it('throws when removing an unknown node', () => {
    const graph = new Graph();
    expect(() => graph.removeNode('nope')).toThrow(NodeNotFoundError);
  });

  it('puts a removed and re-added node at the end of iteration order', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.removeNode('a');
    graph.addNode('a');
    expect(graph.nodes().map((node) => node.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('Graph generated node ids', () => {
  it('generates n1, n2, n3 in order', () => {
    const graph = new Graph();
    expect(graph.addNode().id).toBe('n1');
    expect(graph.addNode().id).toBe('n2');
    expect(graph.addNode().id).toBe('n3');
  });

  it('skips ids already taken by explicit calls', () => {
    const graph = new Graph();
    graph.addNode('n1');
    graph.addNode('n2');
    expect(graph.addNode().id).toBe('n3');
  });

  it('skips an explicit id that looks exactly like a later generated id', () => {
    const graph = new Graph();
    expect(graph.addNode().id).toBe('n1');
    graph.addNode('n2');
    graph.addNode('n3');
    expect(graph.addNode().id).toBe('n4');
  });

  it('never reuses a generated id after the node is removed', () => {
    const graph = new Graph();
    graph.addNode();
    graph.addNode();
    graph.removeNode('n1');
    expect(graph.addNode().id).toBe('n3');
  });

  it('never reuses an id explicitly claimed and then removed', () => {
    const graph = new Graph();
    graph.addNode('n1');
    graph.removeNode('n1');
    expect(graph.addNode().id).toBe('n2');
  });

  it('does not recycle a freed suffix the counter later walks up to', () => {
    const graph = new Graph();
    graph.addNode('n3');
    graph.removeNode('n3');
    expect([graph.addNode().id, graph.addNode().id, graph.addNode().id]).toEqual([
      'n4',
      'n5',
      'n6',
    ]);
  });

  it('leaves the counter alone for an explicit id outside the generated shape', () => {
    const graph = new Graph();
    graph.addNode('n007');
    expect(graph.addNode().id).toBe('n1');
    expect(graph.addNode().id).toBe('n2');
  });

  it('leaves the counter alone for an explicit suffix beyond the safe integer range', () => {
    const graph = new Graph();
    graph.addNode('n99999999999999999999');
    expect(graph.addNode().id).toBe('n1');
    expect(graph.addNode().id).toBe('n2');
    expect(graph.nodeCount).toBe(3);
  });

  it('does not burn a generated id on a rejected duplicate', () => {
    const graph = new Graph();
    graph.addNode('a');
    expect(() => graph.addNode('a')).toThrow(DuplicateNodeError);
    expect(() => graph.addNode('')).toThrow(InvalidIdError);
    expect(graph.addNode().id).toBe('n1');
  });
});

describe('Graph node record immutability', () => {
  it('freezes the record returned by addNode and getNode', () => {
    const graph = new Graph();
    const added = graph.addNode('a');
    expect(Object.isFrozen(added)).toBe(true);
    expect(Object.isFrozen(graph.getNode('a'))).toBe(true);
    expect(Object.isFrozen(graph.nodes()[0])).toBe(true);
  });

  it('rejects a write through a cast and keeps the id intact', () => {
    const graph = new Graph();
    const added = graph.addNode('a');
    expect(() => {
      (added as { id: string }).id = 'z';
    }).toThrow(TypeError);
    expect(graph.getNode('a')?.id).toBe('a');
    expect(graph.nodes().map((node) => node.id)).toEqual(['a']);
  });
});

describe('Graph returned array isolation', () => {
  it('is unaffected by a caller mutating the array from nodes()', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    const listed = graph.nodes() as { id: string }[];
    listed.push({ id: 'ghost' });
    listed.shift();
    expect(graph.nodeCount).toBe(2);
    expect(graph.nodes().map((node) => node.id)).toEqual(['a', 'b']);
  });
});
