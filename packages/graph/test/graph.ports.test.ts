import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import {
  DuplicatePortError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
  PortDirectionError,
  PortInUseError,
  PortNotFoundError,
} from '../src/errors.js';
import type { Attrs } from '../src/types.js';

/**
 * `a` has one port of each direction, `b` has a matching pair. Enough to ask
 * every direction question without building a new graph per test.
 */
function ported(): Graph {
  const graph = new Graph();
  graph.addNode({
    id: 'a',
    ports: [{ id: 'out' }, { id: 'src', direction: 'out' }, { id: 'sink', direction: 'in' }],
  });
  graph.addNode({
    id: 'b',
    ports: [{ id: 'in', direction: 'in' }, { id: 'back', direction: 'out' }, { id: 'both' }],
  });
  return graph;
}

describe('Graph port declaration', () => {
  it('starts a node with no ports', () => {
    const graph = new Graph();
    const node = graph.addNode('a');
    expect(node.ports).toEqual([]);
    expect(graph.ports('a')).toEqual([]);
  });

  it('declares ports up front, in declaration order', () => {
    const graph = ported();
    expect(graph.ports('a').map((port) => port.id)).toEqual(['out', 'src', 'sink']);
  });

  it('defaults direction to inout', () => {
    const graph = ported();
    expect(graph.getPort('a', 'out')).toEqual({ id: 'out', direction: 'inout' });
    expect(graph.getPort('a', 'src')).toEqual({ id: 'src', direction: 'out' });
    expect(graph.getPort('a', 'sink')).toEqual({ id: 'sink', direction: 'in' });
  });

  it('freezes the port array and every port record', () => {
    const graph = ported();
    const node = graph.requireNode('a');
    expect(Object.isFrozen(node.ports)).toBe(true);
    expect(node.ports.every((port) => Object.isFrozen(port))).toBe(true);
  });

  it('hands out the same array from the record and from ports()', () => {
    const graph = ported();
    expect(graph.ports('a')).toBe(graph.requireNode('a').ports);
  });

  it('rejects a duplicate id inside the declaration list, adding nothing', () => {
    const graph = new Graph();
    expect(() => graph.addNode({ id: 'a', ports: [{ id: 'p' }, { id: 'p' }] })).toThrow(
      DuplicatePortError,
    );
    expect(graph.hasNode('a')).toBe(false);
    expect(graph.nodeCount).toBe(0);
  });

  it('rejects an empty port id with the port kind', () => {
    const graph = new Graph();
    try {
      graph.addNode({ id: 'a', ports: [{ id: '' }] });
      expect.unreachable('addNode should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as InvalidIdError).kind).toBe('port');
      expect((error as InvalidIdError).id).toBe('');
    }
    expect(graph.nodeCount).toBe(0);
  });

  it('does not spend a generated node id on a rejected port list', () => {
    const graph = new Graph();
    expect(() => graph.addNode({ ports: [{ id: 'p' }, { id: 'p' }] })).toThrow(
      DuplicatePortError,
    );
    expect(graph.addNode().id).toBe('n1');
  });

  it('keeps port ids scoped to their node', () => {
    const graph = ported();
    graph.addNode({ id: 'c', ports: [{ id: 'out' }] });
    expect(graph.hasPort('c', 'out')).toBe(true);
    expect(graph.hasPort('c', 'src')).toBe(false);
    expect(graph.hasPort('a', 'src')).toBe(true);
  });
});

describe('Graph hasPort and getPort', () => {
  it('answers for a declared and an undeclared port', () => {
    const graph = ported();
    expect(graph.hasPort('a', 'out')).toBe(true);
    expect(graph.hasPort('a', 'nope')).toBe(false);
    expect(graph.getPort('a', 'nope')).toBeUndefined();
  });

  it('throws for an unknown node rather than answering false', () => {
    const graph = ported();
    expect(() => graph.hasPort('nope', 'out')).toThrow(NodeNotFoundError);
    expect(() => graph.getPort('nope', 'out')).toThrow(NodeNotFoundError);
    expect(() => graph.ports('nope')).toThrow(NodeNotFoundError);
  });

  it('stops answering once the node is removed', () => {
    const graph = ported();
    graph.removeNode('a');
    expect(() => graph.hasPort('a', 'out')).toThrow(NodeNotFoundError);
  });
});

describe('Graph addPort', () => {
  it('appends a port and returns a new frozen record', () => {
    const graph = ported();
    const before = graph.requireNode('a');
    const after = graph.addPort('a', { id: 'extra' });
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after.ports.map((port) => port.id)).toEqual(['out', 'src', 'sink', 'extra']);
    expect(before.ports.map((port) => port.id)).toEqual(['out', 'src', 'sink']);
    expect(graph.getNode('a')).toBe(after);
  });

  it('keeps the attributes the node already had', () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    const node = graph.addPort('a', { id: 'p' });
    expect(node.attrs).toEqual({ label: 'A' });
  });

  it('keeps the ports a node already had when its attributes change', () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode({ id: 'a', ports: [{ id: 'p', direction: 'out' }] });
    const node = graph.updateNodeAttrs('a', { label: 'A' });
    expect(node.ports).toEqual([{ id: 'p', direction: 'out' }]);
    expect(graph.hasPort('a', 'p')).toBe(true);
  });

  /**
   * `@dagr/layout` writes geometry back through an attribute update for every
   * node on every run, and `@dagr/react` will put `node.ports` in a memo
   * dependency, so a fresh array with identical contents would invalidate every
   * port memo on every layout pass. The record identity rule the class promises
   * has to cover `ports`, not only `attrs`.
   */
  it('hands back the very same ports array when only the attributes change', () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode({ id: 'a', ports: [{ id: 'p', direction: 'out' }, { id: 'q' }] });
    const before = graph.requireNode('a');
    const after = graph.updateNodeAttrs('a', { label: 'A' });
    expect(after).not.toBe(before);
    expect(after.ports).toBe(before.ports);
    expect(after.ports[0]).toBe(before.ports[0]);
    expect(graph.ports('a')).toBe(after.ports);
  });

  it('leaves every other record alone', () => {
    const graph = ported();
    const other = graph.requireNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
    const edge = graph.requireEdge('ab');
    graph.addPort('a', { id: 'extra' });
    expect(graph.getNode('b')).toBe(other);
    expect(graph.getEdge('ab')).toBe(edge);
  });

  it('does not disturb adjacency', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
    graph.addPort('a', { id: 'extra' });
    expect(graph.successors('a')).toEqual(['b']);
    expect(graph.outEdges('a').map((edge) => edge.id)).toEqual(['ab']);
    expect(graph.degree('a')).toBe(1);
  });

  it('throws on a duplicate port and leaves the record identity alone', () => {
    const graph = ported();
    const before = graph.requireNode('a');
    expect(() => graph.addPort('a', { id: 'out' })).toThrow(DuplicatePortError);
    expect(graph.getNode('a')).toBe(before);
    expect(graph.ports('a')).toHaveLength(3);
  });

  it('throws on an empty port id and on an unknown node', () => {
    const graph = ported();
    expect(() => graph.addPort('a', { id: '' })).toThrow(InvalidIdError);
    expect(() => graph.addPort('nope', { id: 'p' })).toThrow(NodeNotFoundError);
    expect(graph.ports('a')).toHaveLength(3);
  });
});

describe('Graph removePort', () => {
  it('removes a port and returns a new frozen record', () => {
    const graph = ported();
    const before = graph.requireNode('a');
    const after = graph.removePort('a', 'src');
    expect(after).not.toBe(before);
    expect(after.ports.map((port) => port.id)).toEqual(['out', 'sink']);
    expect(before.ports.map((port) => port.id)).toEqual(['out', 'src', 'sink']);
    expect(graph.hasPort('a', 'src')).toBe(false);
  });

  it('keeps the order of the ports that survive', () => {
    const graph = ported();
    graph.addPort('a', { id: 'extra' });
    const node = graph.removePort('a', 'src');
    expect(node.ports.map((port) => port.id)).toEqual(['out', 'sink', 'extra']);
  });

  it('throws for a port the node does not declare', () => {
    const graph = ported();
    expect(() => graph.removePort('a', 'nope')).toThrow(PortNotFoundError);
    expect(() => graph.removePort('nope', 'out')).toThrow(NodeNotFoundError);
  });

  it('refuses while an edge still references the port, and names the edges', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'one', sourcePort: 'src' });
    graph.addEdge({ source: 'a', target: 'b', id: 'two', sourcePort: 'src' });
    try {
      graph.removePort('a', 'src');
      expect.unreachable('removePort should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortInUseError);
      expect((error as PortInUseError).nodeId).toBe('a');
      expect((error as PortInUseError).portId).toBe('src');
      expect((error as PortInUseError).edgeIds).toEqual(['one', 'two']);
    }
    expect(graph.hasPort('a', 'src')).toBe(true);
  });

  it('refuses for a target reference too', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'one', targetPort: 'in' });
    expect(() => graph.removePort('b', 'in')).toThrow(PortInUseError);
  });

  it('names a self loop that uses the port at both ends only once', () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', ports: [{ id: 'p' }] });
    graph.addEdge({ source: 'a', target: 'a', id: 'loop', sourcePort: 'p', targetPort: 'p' });
    try {
      graph.removePort('a', 'p');
      expect.unreachable('removePort should have thrown');
    } catch (error) {
      expect((error as PortInUseError).edgeIds).toEqual(['loop']);
    }
  });

  it('allows the removal once the referencing edge is gone', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'one', sourcePort: 'src' });
    expect(() => graph.removePort('a', 'src')).toThrow(PortInUseError);
    graph.removeEdge('one');
    expect(graph.removePort('a', 'src').ports.map((port) => port.id)).toEqual(['out', 'sink']);
  });

  it('ignores an edge that references a different port on the same node', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'one', sourcePort: 'src' });
    expect(graph.removePort('a', 'out').ports.map((port) => port.id)).toEqual(['src', 'sink']);
  });

  it('leaves removeNode as the way to take a port and its edges together', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'one', sourcePort: 'src' });
    graph.removeNode('a');
    expect(graph.hasNode('a')).toBe(false);
    expect(graph.hasEdge('one')).toBe(false);
    expect(graph.edgeCount).toBe(0);
  });
});

describe('Graph edge port references', () => {
  it('records the ports an edge names', () => {
    const graph = ported();
    const edge = graph.addEdge({
      source: 'a',
      target: 'b',
      id: 'ab',
      sourcePort: 'src',
      targetPort: 'in',
    });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('in');
  });

  it('leaves the keys absent, not undefined, when no port is named', () => {
    const graph = ported();
    const edge = graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
    expect('sourcePort' in edge).toBe(false);
    expect('targetPort' in edge).toBe(false);
    expect(Object.keys(edge).sort()).toEqual(['attrs', 'id', 'source', 'target']);
  });

  it('allows one end to name a port and the other not to', () => {
    const graph = ported();
    const edge = graph.addEdge({ source: 'a', target: 'b', id: 'ab', targetPort: 'in' });
    expect('sourcePort' in edge).toBe(false);
    expect(edge.targetPort).toBe('in');
  });

  it('accepts an inout port at either end', () => {
    const graph = ported();
    const edge = graph.addEdge({
      source: 'a',
      target: 'b',
      id: 'ab',
      sourcePort: 'out',
      targetPort: 'both',
    });
    expect(edge.sourcePort).toBe('out');
    expect(edge.targetPort).toBe('both');
  });

  it('lets a self loop name two different ports on the same node', () => {
    const graph = ported();
    const edge = graph.addEdge({
      source: 'a',
      target: 'a',
      id: 'loop',
      sourcePort: 'src',
      targetPort: 'sink',
    });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('sink');
    expect(graph.degree('a')).toBe(2);
  });

  /**
   * The two ends of a self loop need not differ: an `'inout'` port passes both
   * the source check and the target check, which is part of what earns the
   * `'inout'` default its keep, and is why `#edgesUsingPort` deduplicates.
   */
  it('lets a self loop name the same inout port at both ends', () => {
    const graph = ported();
    const edge = graph.addEdge({
      source: 'a',
      target: 'a',
      id: 'loop',
      sourcePort: 'out',
      targetPort: 'out',
    });
    expect(edge.sourcePort).toBe('out');
    expect(edge.targetPort).toBe('out');
    expect(graph.degree('a')).toBe(2);
  });

  it('keeps the port references when the attributes change', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'src', targetPort: 'in' });
    const edge = graph.updateEdgeAttrs('ab', { weight: 2 });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('in');
  });

  it('throws when a named port is not declared on its node', () => {
    const graph = ported();
    try {
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'nope' });
      expect.unreachable('addEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortNotFoundError);
      expect((error as PortNotFoundError).nodeId).toBe('a');
      expect((error as PortNotFoundError).portId).toBe('nope');
    }
    expect(() =>
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', targetPort: 'nope' }),
    ).toThrow(PortNotFoundError);
    expect(graph.edgeCount).toBe(0);
  });

  it('throws when a source port faces the wrong way', () => {
    const graph = ported();
    try {
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'sink' });
      expect.unreachable('addEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortDirectionError);
      expect((error as PortDirectionError).nodeId).toBe('a');
      expect((error as PortDirectionError).portId).toBe('sink');
      expect((error as PortDirectionError).direction).toBe('in');
      expect((error as PortDirectionError).end).toBe('source');
    }
    expect(graph.edgeCount).toBe(0);
  });

  it('throws when a target port faces the wrong way', () => {
    const graph = ported();
    try {
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', targetPort: 'back' });
      expect.unreachable('addEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortDirectionError);
      expect((error as PortDirectionError).direction).toBe('out');
      expect((error as PortDirectionError).end).toBe('target');
    }
    expect(graph.edgeCount).toBe(0);
  });

  it('throws on an empty port id with the port kind', () => {
    const graph = ported();
    try {
      graph.addEdge({ source: 'a', target: 'b', sourcePort: '' });
      expect.unreachable('addEdge should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as InvalidIdError).kind).toBe('port');
    }
  });

  it('leaves the graph untouched when a port reference is rejected', () => {
    const graph = ported();
    expect(() => graph.addEdge({ source: 'a', target: 'b', sourcePort: 'sink' })).toThrow(
      PortDirectionError,
    );
    expect(() => graph.addEdge({ source: 'a', target: 'b', targetPort: 'nope' })).toThrow(
      PortNotFoundError,
    );
    expect(() => graph.addEdge({ source: 'a', target: 'b', sourcePort: '' })).toThrow(
      InvalidIdError,
    );
    expect(graph.edgeCount).toBe(0);
    expect(graph.outEdges('a')).toEqual([]);
    expect(graph.inEdges('b')).toEqual([]);
    // The rejected calls must not have spent a generated id either.
    expect(graph.addEdge({ source: 'a', target: 'b' }).id).toBe('e1');
  });

  it('validates the ports before the id, so a duplicate id is not the first complaint', () => {
    const graph = ported();
    graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
    expect(() =>
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'sink' }),
    ).toThrow(PortDirectionError);
    expect(graph.edgeCount).toBe(1);
  });
});

/**
 * Rewiring is what `PortInUseError` tells a caller to do, and dragging an edge
 * endpoint from one port to another is a core editor interaction. Remove plus
 * re-add would cost the edge its attributes, its place in insertion order, and
 * its identity, so the binding gets its own mutator.
 */
describe('Graph updateEdgePorts', () => {
  /** `ported()` plus one edge from `a` to `b` naming no ports. */
  function wired(): Graph<Attrs, { weight: number }> {
    const graph = new Graph<Attrs, { weight: number }>();
    graph.addNode({
      id: 'a',
      ports: [{ id: 'out' }, { id: 'src', direction: 'out' }, { id: 'sink', direction: 'in' }],
    });
    graph.addNode({
      id: 'b',
      ports: [{ id: 'in', direction: 'in' }, { id: 'back', direction: 'out' }, { id: 'both' }],
    });
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { weight: 3 } });
    return graph;
  }

  it('attaches an end that named no port', () => {
    const graph = wired();
    const edge = graph.updateEdgePorts('ab', { sourcePort: 'src' });
    expect(edge.sourcePort).toBe('src');
    expect('targetPort' in edge).toBe(false);
    expect(graph.getEdge('ab')).toBe(edge);
  });

  it('attaches both ends in one call', () => {
    const graph = wired();
    const edge = graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('in');
  });

  it('leaves an end alone when its key is absent', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    const edge = graph.updateEdgePorts('ab', { targetPort: 'both' });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('both');
  });

  it('detaches an end named explicitly undefined, leaving the key absent', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    const edge = graph.updateEdgePorts('ab', { sourcePort: undefined });
    expect('sourcePort' in edge).toBe(false);
    expect(edge.targetPort).toBe('in');
    expect(Object.keys(edge).sort()).toEqual(['attrs', 'id', 'source', 'target', 'targetPort']);
  });

  it('detaches both ends at once', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    const edge = graph.updateEdgePorts('ab', { sourcePort: undefined, targetPort: undefined });
    expect('sourcePort' in edge).toBe(false);
    expect('targetPort' in edge).toBe(false);
  });

  it('swaps one port for another at the same end', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src' });
    const edge = graph.updateEdgePorts('ab', { sourcePort: 'out' });
    expect(edge.sourcePort).toBe('out');
  });

  it('keeps the edge id, its attributes, and its place in insertion order', () => {
    const graph = wired();
    graph.addEdge({ source: 'b', target: 'a', id: 'ba' });
    const edge = graph.updateEdgePorts('ab', { sourcePort: 'src' });
    expect(edge.id).toBe('ab');
    expect(edge.attrs).toEqual({ weight: 3 });
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(graph.edges().map((each) => each.id)).toEqual(['ab', 'ba']);
    expect(graph.outEdges('a')[0]).toBe(edge);
    expect(graph.inEdges('b')[0]).toBe(edge);
  });

  it('returns the same record when nothing changes', () => {
    const graph = wired();
    const detached = graph.requireEdge('ab');
    expect(graph.updateEdgePorts('ab', {})).toBe(detached);
    expect(graph.updateEdgePorts('ab', { sourcePort: undefined })).toBe(detached);

    const bound = graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    expect(graph.updateEdgePorts('ab', { sourcePort: 'src' })).toBe(bound);
    expect(graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' })).toBe(bound);
    expect(graph.updateEdgePorts('ab', {})).toBe(bound);
  });

  it('returns a new frozen record and leaves the old one intact', () => {
    const graph = wired();
    const before = graph.requireEdge('ab');
    const after = graph.updateEdgePorts('ab', { sourcePort: 'src' });
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect('sourcePort' in before).toBe(false);
  });

  it('rejects a source port facing the wrong way', () => {
    const graph = wired();
    try {
      graph.updateEdgePorts('ab', { sourcePort: 'sink' });
      expect.unreachable('updateEdgePorts should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortDirectionError);
      expect((error as PortDirectionError).direction).toBe('in');
      expect((error as PortDirectionError).end).toBe('source');
    }
  });

  it('rejects a target port facing the wrong way', () => {
    const graph = wired();
    try {
      graph.updateEdgePorts('ab', { targetPort: 'back' });
      expect.unreachable('updateEdgePorts should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortDirectionError);
      expect((error as PortDirectionError).direction).toBe('out');
      expect((error as PortDirectionError).end).toBe('target');
    }
  });

  it('rejects a port the node at that end does not declare', () => {
    const graph = wired();
    try {
      graph.updateEdgePorts('ab', { sourcePort: 'in' });
      expect.unreachable('updateEdgePorts should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PortNotFoundError);
      expect((error as PortNotFoundError).nodeId).toBe('a');
      expect((error as PortNotFoundError).portId).toBe('in');
    }
    expect(() => graph.updateEdgePorts('ab', { targetPort: 'src' })).toThrow(PortNotFoundError);
  });

  it('rejects an empty port id with the port kind', () => {
    const graph = wired();
    try {
      graph.updateEdgePorts('ab', { targetPort: '' });
      expect.unreachable('updateEdgePorts should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as InvalidIdError).kind).toBe('port');
    }
  });

  it('throws for an unknown edge', () => {
    const graph = wired();
    expect(() => graph.updateEdgePorts('nope', { sourcePort: 'src' })).toThrow(EdgeNotFoundError);
  });

  it('leaves the edge record untouched when the call is rejected', () => {
    const graph = wired();
    const before = graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    // The valid half of the patch must not land when the other half is refused.
    expect(() => graph.updateEdgePorts('ab', { sourcePort: 'out', targetPort: 'back' })).toThrow(
      PortDirectionError,
    );
    expect(graph.getEdge('ab')).toBe(before);
    expect(before.sourcePort).toBe('src');
    expect(before.targetPort).toBe('in');
  });

  it('binds a self loop to a port at each end', () => {
    const graph = wired();
    graph.addEdge({ source: 'a', target: 'a', id: 'loop' });
    const edge = graph.updateEdgePorts('loop', { sourcePort: 'src', targetPort: 'sink' });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('sink');
    expect(graph.degree('a')).toBe(3);
  });

  it('binds a self loop to the same inout port at both ends', () => {
    const graph = wired();
    graph.addEdge({ source: 'a', target: 'a', id: 'loop' });
    const edge = graph.updateEdgePorts('loop', { sourcePort: 'out', targetPort: 'out' });
    expect(edge.sourcePort).toBe('out');
    expect(edge.targetPort).toBe('out');
  });

  it('makes the rebound port removable and the newly bound one refused', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src' });
    expect(() => graph.removePort('a', 'src')).toThrow(PortInUseError);
    graph.updateEdgePorts('ab', { sourcePort: 'out' });
    expect(graph.removePort('a', 'src').ports.map((port) => port.id)).toEqual(['out', 'sink']);
    expect(() => graph.removePort('a', 'out')).toThrow(PortInUseError);
  });

  it('leaves node records and adjacency alone', () => {
    const graph = wired();
    const node = graph.requireNode('a');
    graph.updateEdgePorts('ab', { sourcePort: 'src' });
    expect(graph.getNode('a')).toBe(node);
    expect(graph.successors('a')).toEqual(['b']);
    expect(graph.degree('a')).toBe(1);
  });

  it('keeps the port bindings when the attributes change afterwards', () => {
    const graph = wired();
    graph.updateEdgePorts('ab', { sourcePort: 'src', targetPort: 'in' });
    const edge = graph.updateEdgeAttrs('ab', { weight: 9 });
    expect(edge.sourcePort).toBe('src');
    expect(edge.targetPort).toBe('in');
  });
});

