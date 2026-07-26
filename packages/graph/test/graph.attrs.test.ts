import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DuplicateNodeError, EdgeNotFoundError, NodeNotFoundError } from '../src/errors.js';

/**
 * Attribute shapes for this suite. Either declaration form works, since the
 * type parameters are constrained to `object` rather than to `Attrs`;
 * `graph.types.test.ts` covers the interface form.
 */
type NodeAttrs = {
  label: string;
  width: number;
  meta: { rows: string[] };
};

type EdgeAttrs = {
  weight: number;
  dashed: boolean;
};

type GraphAttrs = {
  rankdir: string;
  spacing: number;
};

/** Two nodes and one edge, every attribute bag empty. */
function pair(): Graph<NodeAttrs, EdgeAttrs, GraphAttrs> {
  const graph = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
  return graph;
}

describe('Graph attribute defaults', () => {
  it('gives every new node and edge a frozen empty bag', () => {
    const graph = pair();
    const node = graph.requireNode('a');
    const edge = graph.requireEdge('ab');
    expect(node.attrs).toEqual({});
    expect(edge.attrs).toEqual({});
    expect(Object.isFrozen(node.attrs)).toBe(true);
    expect(Object.isFrozen(edge.attrs)).toBe(true);
  });

  it('starts the graph itself with a frozen empty bag', () => {
    const graph = pair();
    expect(graph.attrs).toEqual({});
    expect(Object.isFrozen(graph.attrs)).toBe(true);
  });

  it('keeps the string shorthand working and gives it the same empty bags', () => {
    const graph = new Graph();
    const node = graph.addNode('a');
    graph.addNode('b');
    const edge = graph.addEdge('a', 'b', 'ab');
    expect(node).toEqual({ id: 'a', attrs: {}, ports: [] });
    expect(edge).toEqual({ id: 'ab', source: 'a', target: 'b', attrs: {} });
  });
});

describe('Graph attributes at construction', () => {
  it('accepts node attributes through the object init', () => {
    const graph = pair();
    const node = graph.addNode({ id: 'c', attrs: { label: 'C', width: 12 } });
    expect(node.attrs).toEqual({ label: 'C', width: 12 });
    expect(graph.getNode('c')).toBe(node);
  });

  it('accepts edge attributes through the object init', () => {
    const graph = pair();
    const edge = graph.addEdge({ source: 'a', target: 'b', attrs: { weight: 3 } });
    expect(edge.attrs).toEqual({ weight: 3 });
    expect(graph.getEdge(edge.id)).toBe(edge);
  });

  it('generates an id for an init with no id', () => {
    const graph = new Graph();
    expect(graph.addNode({}).id).toBe('n1');
    expect(graph.addNode({ attrs: { k: 1 } }).id).toBe('n2');
  });

  it('drops a key given as undefined at construction rather than storing it', () => {
    const graph = pair();
    const node = graph.addNode({ id: 'c', attrs: { label: 'C', width: undefined } });
    expect('width' in node.attrs).toBe(false);
    expect(Object.keys(node.attrs)).toEqual(['label']);
  });

  it('copies the bag in, so a later mutation of the supplied object is not seen', () => {
    const graph = pair();
    const supplied: { label: string; width?: number } = { label: 'C' };
    const node = graph.addNode({ id: 'c', attrs: supplied });
    supplied.label = 'mutated';
    supplied.width = 99;
    expect(node.attrs).toEqual({ label: 'C' });
    expect(graph.requireNode('c').attrs).toEqual({ label: 'C' });
  });

  it('leaves the graph untouched when the init is rejected', () => {
    const graph = pair();
    expect(() => graph.addNode({ id: 'a', attrs: { label: 'clash' } })).toThrow(
      DuplicateNodeError,
    );
    expect(graph.requireNode('a').attrs).toEqual({});
    expect(graph.nodeCount).toBe(2);
  });
});

describe('Graph updateNodeAttrs', () => {
  it('merges rather than replaces', () => {
    const graph = pair();
    graph.updateNodeAttrs('a', { label: 'A' });
    const node = graph.updateNodeAttrs('a', { width: 10 });
    expect(node.attrs).toEqual({ label: 'A', width: 10 });
  });

  it('returns a new frozen record and leaves the old one intact', () => {
    const graph = pair();
    const before = graph.requireNode('a');
    const after = graph.updateNodeAttrs('a', { label: 'A' });
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(before.attrs).toEqual({});
    expect(Object.isFrozen(before)).toBe(true);
    expect(graph.getNode('a')).toBe(after);
  });

  it('deletes a key given as undefined instead of storing undefined', () => {
    const graph = pair();
    graph.updateNodeAttrs('a', { label: 'A', width: 4 });
    const node = graph.updateNodeAttrs('a', { width: undefined });
    expect(node.attrs).toEqual({ label: 'A' });
    expect('width' in node.attrs).toBe(false);
  });

  it('returns the same record for an empty patch', () => {
    const graph = pair();
    const before = graph.updateNodeAttrs('a', { label: 'A' });
    expect(graph.updateNodeAttrs('a', {})).toBe(before);
  });

  it('returns the same record when every value is already what the patch says', () => {
    const graph = pair();
    const before = graph.updateNodeAttrs('a', { label: 'A', width: 4 });
    expect(graph.updateNodeAttrs('a', { label: 'A' })).toBe(before);
    expect(graph.updateNodeAttrs('a', { label: 'A', width: 4 })).toBe(before);
  });

  it('returns the same record when deleting a key that is not there', () => {
    const graph = pair();
    const before = graph.updateNodeAttrs('a', { label: 'A' });
    expect(graph.updateNodeAttrs('a', { width: undefined })).toBe(before);
    expect(graph.updateNodeAttrs('a', {})).toBe(before);
  });

  it('compares with Object.is, so NaN to NaN is no change and 0 to -0 is', () => {
    const graph = new Graph<{ value: number }>();
    graph.addNode('a');
    const nan = graph.updateNodeAttrs('a', { value: Number.NaN });
    expect(graph.updateNodeAttrs('a', { value: Number.NaN })).toBe(nan);
    const zero = graph.updateNodeAttrs('a', { value: 0 });
    expect(zero).not.toBe(nan);
    expect(graph.updateNodeAttrs('a', { value: -0 })).not.toBe(zero);
  });

  it('copies the patch in, so a later mutation of it is not seen', () => {
    const graph = pair();
    const patch: { label: string; width?: number } = { label: 'A' };
    const node = graph.updateNodeAttrs('a', patch);
    patch.label = 'mutated';
    patch.width = 99;
    expect(node.attrs).toEqual({ label: 'A' });
    expect(graph.requireNode('a').attrs).toEqual({ label: 'A' });
  });

  it('freezes the bag shallowly, so a nested value stays under caller control', () => {
    const graph = pair();
    const meta = { rows: ['one'] };
    const node = graph.updateNodeAttrs('a', { meta });
    expect(Object.isFrozen(node.attrs)).toBe(true);
    expect(node.attrs.meta).toBe(meta);
    meta.rows.push('two');
    expect(graph.requireNode('a').attrs.meta?.rows).toEqual(['one', 'two']);
  });

  it('rejects a write through a cast', () => {
    const graph = pair();
    const node = graph.updateNodeAttrs('a', { label: 'A' });
    expect(() => {
      (node.attrs as { label: string }).label = 'z';
    }).toThrow(TypeError);
    expect(graph.requireNode('a').attrs.label).toBe('A');
  });

  it('throws for an unknown node and changes nothing', () => {
    const graph = pair();
    expect(() => graph.updateNodeAttrs('nope', { label: 'A' })).toThrow(NodeNotFoundError);
    expect(graph.nodeCount).toBe(2);
  });
});

describe('Graph updateEdgeAttrs', () => {
  it('merges, deletes on undefined, and keeps the endpoints', () => {
    const graph = pair();
    graph.updateEdgeAttrs('ab', { weight: 2, dashed: true });
    const edge = graph.updateEdgeAttrs('ab', { dashed: undefined });
    expect(edge.attrs).toEqual({ weight: 2 });
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
  });

  it('returns a new frozen record and leaves the old one intact', () => {
    const graph = pair();
    const before = graph.requireEdge('ab');
    const after = graph.updateEdgeAttrs('ab', { weight: 2 });
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(before.attrs).toEqual({});
    expect(graph.getEdge('ab')).toBe(after);
  });

  it('returns the same record when nothing changes', () => {
    const graph = pair();
    const before = graph.updateEdgeAttrs('ab', { weight: 2 });
    expect(graph.updateEdgeAttrs('ab', {})).toBe(before);
    expect(graph.updateEdgeAttrs('ab', { weight: 2 })).toBe(before);
    expect(graph.updateEdgeAttrs('ab', { dashed: undefined })).toBe(before);
  });

  it('throws for an unknown edge', () => {
    const graph = pair();
    expect(() => graph.updateEdgeAttrs('nope', { weight: 1 })).toThrow(EdgeNotFoundError);
  });
});

describe('Graph attributes', () => {
  it('merges, deletes on undefined, and freezes', () => {
    const graph = pair();
    const first = graph.updateAttrs({ rankdir: 'TB', spacing: 8 });
    expect(first).toEqual({ rankdir: 'TB', spacing: 8 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(graph.attrs).toBe(first);
    const second = graph.updateAttrs({ spacing: undefined });
    expect(second).toEqual({ rankdir: 'TB' });
    expect(second).not.toBe(first);
  });

  it('returns the same bag when nothing changes', () => {
    const graph = pair();
    const before = graph.updateAttrs({ rankdir: 'TB' });
    expect(graph.updateAttrs({})).toBe(before);
    expect(graph.updateAttrs({ rankdir: 'TB' })).toBe(before);
    expect(graph.updateAttrs({ spacing: undefined })).toBe(before);
    expect(graph.attrs).toBe(before);
  });

  it('is independent of node and edge bags', () => {
    const graph = pair();
    graph.updateAttrs({ rankdir: 'TB' });
    expect(graph.requireNode('a').attrs).toEqual({});
    expect(graph.requireEdge('ab').attrs).toEqual({});
  });
});

/**
 * `__proto__` is a key like any other to a caller, and the realistic way it
 * arrives is `updateNodeAttrs(id, JSON.parse(...))`, which is the path a graph
 * importer and the v0.2 DSL will take. A plain object literal writes it as a
 * prototype rather than as a property, so a bag built with an ordinary
 * assignment would swallow the attribute and inherit the caller's keys. These
 * pin the write as a property definition instead.
 */
describe('Graph attribute keys that collide with Object.prototype', () => {
  /**
   * A computed key is a property definition rather than a prototype
   * assignment, so this literal really does carry an own `__proto__` key, which
   * is what a caller's object looks like when it has one. Written through a
   * helper because a bare computed `__proto__` in a literal reads like a
   * mistake at the call site.
   */
  function protoPatch(value: unknown): Record<string, unknown> {
    return { ['__proto__']: value };
  }

  /** One node and one self-standing edge, both with empty untyped bags. */
  function untyped(): Graph {
    const graph = new Graph();
    graph.addNode('a1');
    graph.addNode('a2');
    graph.addEdge('a1', 'a2', 'ab1');
    return graph;
  }

  it('stores __proto__ from a computed key as an own enumerable property', () => {
    const graph = untyped();
    const node = graph.updateNodeAttrs('a1', protoPatch('polluted'));
    expect(Object.hasOwn(node.attrs, '__proto__')).toBe(true);
    expect(Object.keys(node.attrs)).toEqual(['__proto__']);
    expect(Object.entries(node.attrs)).toEqual([['__proto__', 'polluted']]);
  });

  it('stores __proto__ from a JSON patch and survives JSON.stringify', () => {
    const graph = untyped();
    // `JSON.parse` returns `any`, so this annotation narrows it rather than
    // casting past an error, and the parser really does define an own key.
    const parsed: Record<string, unknown> = JSON.parse('{"__proto__": "polluted"}');
    const node = graph.updateNodeAttrs('a1', parsed);
    expect(JSON.stringify(node.attrs)).toBe('{"__proto__":"polluted"}');
  });

  it('does not let the patch value leak its keys into reads on the bag', () => {
    const graph = untyped();
    const parsed: Record<string, unknown> = JSON.parse('{"__proto__": {"leaked": true}}');
    const node = graph.updateNodeAttrs('a1', parsed);
    expect(node.attrs.leaked).toBeUndefined();
    expect('leaked' in node.attrs).toBe(false);
    expect(Object.getPrototypeOf(node.attrs)).toBe(Object.prototype);
  });

  it('treats a repeat of the same __proto__ value as no change', () => {
    const graph = untyped();
    const before = graph.updateNodeAttrs('a1', protoPatch('polluted'));
    expect(graph.updateNodeAttrs('a1', protoPatch('polluted'))).toBe(before);
  });

  it('deletes a __proto__ key given as undefined', () => {
    const graph = untyped();
    graph.updateNodeAttrs('a1', protoPatch('polluted'));
    const node = graph.updateNodeAttrs('a1', protoPatch(undefined));
    expect(Object.hasOwn(node.attrs, '__proto__')).toBe(false);
    expect(node.attrs).toEqual({});
  });

  it('applies the same rule to edge bags and to the graph bag', () => {
    const graph = untyped();
    const edge = graph.updateEdgeAttrs('ab1', protoPatch('polluted'));
    expect(Object.keys(edge.attrs)).toEqual(['__proto__']);
    const bag = graph.updateAttrs(protoPatch('polluted'));
    expect(Object.keys(bag)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(bag)).toBe(Object.prototype);
  });

  it('accepts __proto__ at construction too', () => {
    const graph = untyped();
    const node = graph.addNode({ id: 'a3', attrs: protoPatch('polluted') });
    expect(Object.keys(node.attrs)).toEqual(['__proto__']);
  });
});

describe('Graph attribute updates and record identity', () => {
  it('leaves every other node record alone', () => {
    const graph = pair();
    const other = graph.requireNode('b');
    graph.updateNodeAttrs('a', { label: 'A' });
    expect(graph.getNode('b')).toBe(other);
  });

  it('leaves edge records alone when a node changes, and the reverse', () => {
    const graph = pair();
    const edge = graph.requireEdge('ab');
    graph.updateNodeAttrs('a', { label: 'A' });
    expect(graph.getEdge('ab')).toBe(edge);

    const node = graph.requireNode('a');
    graph.updateEdgeAttrs('ab', { weight: 1 });
    expect(graph.getNode('a')).toBe(node);
  });

  it('leaves both when only the graph bag changes', () => {
    const graph = pair();
    const node = graph.requireNode('a');
    const edge = graph.requireEdge('ab');
    graph.updateAttrs({ rankdir: 'LR' });
    expect(graph.getNode('a')).toBe(node);
    expect(graph.getEdge('ab')).toBe(edge);
  });

  it('does not disturb adjacency, degrees, or iteration order', () => {
    const graph = pair();
    graph.addNode('c');
    graph.addEdge({ source: 'a', target: 'c', id: 'ac' });
    graph.addEdge({ source: 'c', target: 'a', id: 'ca' });
    const before = {
      nodes: graph.nodes().map((node) => node.id),
      edges: graph.edges().map((edge) => edge.id),
      successors: graph.successors('a'),
      predecessors: graph.predecessors('a'),
      outEdges: graph.outEdges('a').map((edge) => edge.id),
      inEdges: graph.inEdges('a').map((edge) => edge.id),
      degree: graph.degree('a'),
    };
    graph.updateNodeAttrs('a', { label: 'A' });
    graph.updateNodeAttrs('c', { label: 'C' });
    graph.updateEdgeAttrs('ac', { weight: 5 });
    expect({
      nodes: graph.nodes().map((node) => node.id),
      edges: graph.edges().map((edge) => edge.id),
      successors: graph.successors('a'),
      predecessors: graph.predecessors('a'),
      outEdges: graph.outEdges('a').map((edge) => edge.id),
      inEdges: graph.inEdges('a').map((edge) => edge.id),
      degree: graph.degree('a'),
    }).toEqual(before);
  });

  it('serves the updated record through every listing that names it', () => {
    const graph = pair();
    const updated = graph.updateNodeAttrs('a', { label: 'A' });
    expect(graph.nodes()[0]).toBe(updated);
    expect(graph.requireNode('a')).toBe(updated);

    const edge = graph.updateEdgeAttrs('ab', { weight: 7 });
    expect(graph.edges()[0]).toBe(edge);
    expect(graph.outEdges('a')[0]).toBe(edge);
    expect(graph.inEdges('b')[0]).toBe(edge);
    expect(graph.edgesBetween('a', 'b')[0]).toBe(edge);
  });
});
