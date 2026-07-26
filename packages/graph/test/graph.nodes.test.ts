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
