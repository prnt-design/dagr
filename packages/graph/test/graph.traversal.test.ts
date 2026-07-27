import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { CycleError, NodeNotFoundError } from '../src/errors.js';
import type { NodeId } from '../src/types.js';

/**
 * Traversal: topological order, cycle detection, sources and sinks,
 * reachability.
 *
 * Every question here has an answer that depends on which nodes and edges
 * exist and on nothing else, including the order the edges happened to be
 * added in. That is the same rule the adjacency listings already keep, and the
 * cases below that look like pedantry (parallel edges, self loops, isolated
 * nodes) are the ones where an implementation drifts off it.
 */

/** A graph from an edge list, with nodes declared in the order first seen. */
function graphOf(edges: readonly (readonly [string, string])[], extraNodes: readonly string[] = []) {
  const graph = new Graph();
  for (const [source, target] of edges) {
    if (!graph.hasNode(source)) graph.addNode(source);
    if (!graph.hasNode(target)) graph.addNode(target);
    graph.addEdge(source, target);
  }
  for (const id of extraNodes) if (!graph.hasNode(id)) graph.addNode(id);
  return graph;
}

/** Position of each id in a listing, for asserting one thing precedes another. */
function positions(order: readonly NodeId[]): ReadonlyMap<NodeId, number> {
  return new Map(order.map((id, index) => [id, index]));
}

describe('topologicalOrder', () => {
  it('orders a chain', () => {
    expect(graphOf([['a', 'b'], ['b', 'c']]).topologicalOrder()).toEqual(['a', 'b', 'c']);
  });

  it('lists every node exactly once, isolated ones included', () => {
    const graph = graphOf([['a', 'b']], ['lonely']);
    const order = graph.topologicalOrder();
    expect([...order].sort()).toEqual(['a', 'b', 'lonely']);
  });

  it('puts every edge source before its target', () => {
    const graph = graphOf([
      ['a', 'd'],
      ['b', 'd'],
      ['a', 'c'],
      ['c', 'd'],
    ]);
    const at = positions(graph.topologicalOrder());
    for (const edge of graph.edges()) {
      expect(at.get(edge.source)).toBeLessThan(at.get(edge.target) ?? -1);
    }
  });

  it('is empty for an empty graph', () => {
    expect(new Graph().topologicalOrder()).toEqual([]);
  });

  it('breaks ties by node insertion order', () => {
    // Nothing constrains these three against each other, so the answer is a
    // choice. Insertion order is the choice, for the same reason the adjacency
    // listings sort by it: it makes the result reproducible without depending
    // on which edge was added first.
    const graph = new Graph();
    graph.addNode('c');
    graph.addNode('a');
    graph.addNode('b');
    expect(graph.topologicalOrder()).toEqual(['c', 'a', 'b']);
  });

  it('does not depend on the order edges were added', () => {
    const forwards = graphOf([['a', 'b'], ['b', 'c'], ['a', 'c']]).topologicalOrder();
    const backwards = graphOf([['a', 'c'], ['b', 'c'], ['a', 'b']]).topologicalOrder();
    expect(forwards).toEqual(backwards);
  });

  it('picks the earliest-added node when several are ready at once', () => {
    // The case the property suite found against a first-in-first-out sweep.
    // Relaxing `a` frees both `b` and `c` in one step, so a queue would emit
    // them in the order their EDGES were added, which is c then b here. The
    // answer has to follow the order the NODES were added instead, or adding a
    // redundant edge could permute a result nothing else changed.
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'c');
    graph.addEdge('a', 'b');
    expect(graph.topologicalOrder()).toEqual(['a', 'b', 'c']);
  });

  it('is unmoved by a parallel edge', () => {
    const graph = graphOf([['a', 'b']]);
    const before = graph.topologicalOrder();
    graph.addEdge('a', 'b');
    expect(graph.topologicalOrder()).toEqual(before);
  });

  it('throws on a cycle, naming it', () => {
    const graph = graphOf([['a', 'b'], ['b', 'a']]);
    expect(() => graph.topologicalOrder()).toThrow(CycleError);
    try {
      graph.topologicalOrder();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).cycle).toHaveLength(2);
      expect((error as CycleError).message).toContain('a');
    }
  });

  it('throws on a self loop, which is a cycle like any other', () => {
    const graph = graphOf([['a', 'a']]);
    expect(() => graph.topologicalOrder()).toThrow(CycleError);
  });
});

describe('findCycle and isAcyclic', () => {
  it('finds nothing in a DAG', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['a', 'c']]);
    expect(graph.findCycle()).toBeUndefined();
    expect(graph.isAcyclic()).toBe(true);
  });

  it('finds nothing in an empty graph', () => {
    expect(new Graph().findCycle()).toBeUndefined();
    expect(new Graph().isAcyclic()).toBe(true);
  });

  it('returns a cycle that really is one', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['c', 'a']]);
    const cycle = graph.findCycle();
    expect(cycle).toBeDefined();
    const found = cycle ?? [];
    expect(found).toHaveLength(3);
    // Consecutive entries are joined by an edge, and the last closes back to
    // the first. The endpoint is not repeated: a cycle of n nodes has n entries.
    for (let index = 0; index < found.length; index += 1) {
      const from = found[index] ?? '';
      const to = found[(index + 1) % found.length] ?? '';
      expect(graph.edgesBetween(from, to).length).toBeGreaterThan(0);
    }
  });

  it('reports a self loop as a one-node cycle', () => {
    expect(graphOf([['a', 'a']]).findCycle()).toEqual(['a']);
    expect(graphOf([['a', 'a']]).isAcyclic()).toBe(false);
  });

  it('finds a cycle that only part of the graph is in', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['c', 'b'], ['c', 'd']]);
    expect(graph.isAcyclic()).toBe(false);
    expect([...(graph.findCycle() ?? [])].sort()).toEqual(['b', 'c']);
  });

  it('does not call two parallel edges a cycle', () => {
    // Two edges a -> b are not a cycle. Only an edge back the other way is.
    const graph = graphOf([['a', 'b']]);
    graph.addEdge('a', 'b');
    expect(graph.isAcyclic()).toBe(true);
  });
});

describe('sources and sinks', () => {
  it('names the nodes with nothing arriving and nothing leaving', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c']]);
    expect(graph.sources()).toEqual(['a']);
    expect(graph.sinks()).toEqual(['c']);
  });

  it('counts an isolated node as both', () => {
    const graph = graphOf([], ['lonely']);
    expect(graph.sources()).toEqual(['lonely']);
    expect(graph.sinks()).toEqual(['lonely']);
  });

  it('lists in node insertion order', () => {
    const graph = new Graph();
    graph.addNode('z');
    graph.addNode('y');
    expect(graph.sources()).toEqual(['z', 'y']);
  });

  it('does not call a self-looped node a source or a sink', () => {
    // Degree is counted in edges, and a self loop is one in-edge and one
    // out-edge, so the node has something arriving and something leaving. It
    // is the same node at both ends, which is exactly what makes it a cycle.
    const graph = graphOf([['a', 'a']]);
    expect(graph.sources()).toEqual([]);
    expect(graph.sinks()).toEqual([]);
  });

  it('finds every source of a cyclic graph, which may be none', () => {
    expect(graphOf([['a', 'b'], ['b', 'a']]).sources()).toEqual([]);
  });
});

describe('descendants and ancestors', () => {
  it('follows edges transitively', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['c', 'd']]);
    expect(graph.descendants('a')).toEqual(['b', 'c', 'd']);
    expect(graph.ancestors('d')).toEqual(['a', 'b', 'c']);
  });

  it('excludes the node itself when nothing leads back to it', () => {
    expect(graphOf([['a', 'b']]).descendants('a')).toEqual(['b']);
  });

  it('excludes the node itself even when something does lead back', () => {
    // "descendants" means strictly below everywhere else it is used on directed
    // graphs, so it means that here too, and a cycle does not make a node its
    // own descendant. `canReach(a, a)` is how you ask the reflexive question.
    expect(graphOf([['a', 'b'], ['b', 'a']]).descendants('a')).toEqual(['b']);
    expect(graphOf([['a', 'a']]).descendants('a')).toEqual([]);
  });

  it('still walks through a cycle to find what lies beyond it', () => {
    // The seed is dropped after the walk, not skipped during it, so a node
    // only reachable by going around the cycle is still found.
    const graph = graphOf([['a', 'b'], ['b', 'a'], ['b', 'c']]);
    expect(graph.descendants('a')).toEqual(['b', 'c']);
  });

  it('is empty for a sink and for an isolated node', () => {
    const graph = graphOf([['a', 'b']], ['lonely']);
    expect(graph.descendants('b')).toEqual([]);
    expect(graph.descendants('lonely')).toEqual([]);
    expect(graph.ancestors('lonely')).toEqual([]);
  });

  it('lists in node insertion order, not in the order the walk found things', () => {
    // Same rule as `successors`: the answer is which nodes are reachable, so
    // it must not depend on which path arrived first.
    const graph = new Graph();
    for (const id of ['d', 'c', 'b', 'a']) graph.addNode(id);
    graph.addEdge('a', 'b');
    graph.addEdge('b', 'c');
    graph.addEdge('a', 'd');
    expect(graph.descendants('a')).toEqual(['d', 'c', 'b']);
  });

  it('terminates on a cycle it walks into', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['c', 'b']]);
    expect(graph.descendants('a')).toEqual(['b', 'c']);
  });

  it('refuses a node the graph does not hold', () => {
    expect(() => new Graph().descendants('nope')).toThrow(NodeNotFoundError);
    expect(() => new Graph().ancestors('nope')).toThrow(NodeNotFoundError);
  });
});

describe('canReach', () => {
  it('answers the transitive question', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c']]);
    expect(graph.canReach('a', 'c')).toBe(true);
    expect(graph.canReach('c', 'a')).toBe(false);
  });

  it('is false from a node to itself with no path back', () => {
    expect(graphOf([['a', 'b']]).canReach('a', 'a')).toBe(false);
  });

  it('is true from a node to itself around a cycle', () => {
    expect(graphOf([['a', 'b'], ['b', 'a']]).canReach('a', 'a')).toBe(true);
    expect(graphOf([['a', 'a']]).canReach('a', 'a')).toBe(true);
  });

  it('agrees with descendants everywhere except the reflexive case', () => {
    // The one deliberate divergence: canReach stays at "one or more edges" so
    // it can answer "is this node on a cycle", which descendants gives up by
    // excluding its own node.
    const graph = graphOf([['a', 'b'], ['b', 'c'], ['c', 'a'], ['x', 'y']]);
    for (const from of graph.nodes()) {
      const reachable = new Set(graph.descendants(from.id));
      for (const to of graph.nodes()) {
        if (from.id === to.id) continue;
        expect(graph.canReach(from.id, to.id)).toBe(reachable.has(to.id));
      }
      expect(reachable.has(from.id)).toBe(false);
    }
    expect(graph.canReach('a', 'a')).toBe(true);
    expect(graph.canReach('x', 'x')).toBe(false);
  });

  it('refuses a node the graph does not hold, at either end', () => {
    const graph = graphOf([['a', 'b']]);
    expect(() => graph.canReach('a', 'nope')).toThrow(NodeNotFoundError);
    expect(() => graph.canReach('nope', 'a')).toThrow(NodeNotFoundError);
  });
});

describe('depth', () => {
  it('walks a chain far deeper than the call stack', () => {
    // The reason findCycle carries an explicit stack and a per-node iterator
    // array instead of six lines of recursion. Without this the justification
    // is only a comment, and the next cleanup that "simplifies" it back to
    // recursion would pass every other test in the suite and overflow in the
    // field. reachable and canReach are iterative for the same reason and are
    // covered by the same case.
    const graph = new Graph();
    const depth = 20_000;
    for (let index = 0; index < depth; index += 1) graph.addNode(`d${String(index)}`);
    for (let index = 0; index + 1 < depth; index += 1) {
      graph.addEdge(`d${String(index)}`, `d${String(index + 1)}`);
    }

    expect(graph.isAcyclic()).toBe(true);
    expect(graph.topologicalOrder()).toHaveLength(depth);
    expect(graph.descendants('d0')).toHaveLength(depth - 1);
    expect(graph.canReach('d0', `d${String(depth - 1)}`)).toBe(true);

    graph.addEdge(`d${String(depth - 1)}`, 'd0');
    expect(graph.findCycle()).toHaveLength(depth);
  });
});

describe('traversal after mutation', () => {
  it('reflects a removed edge', () => {
    const graph = graphOf([['a', 'b'], ['b', 'a']]);
    expect(graph.isAcyclic()).toBe(false);
    const [back] = graph.edgesBetween('b', 'a');
    graph.removeEdge(back?.id ?? '');
    expect(graph.isAcyclic()).toBe(true);
    expect(graph.topologicalOrder()).toEqual(['a', 'b']);
  });

  it('reflects a removed node and the edges that went with it', () => {
    const graph = graphOf([['a', 'b'], ['b', 'c']]);
    graph.removeNode('b');
    expect(graph.sources()).toEqual(['a', 'c']);
    expect(graph.descendants('a')).toEqual([]);
  });
});
