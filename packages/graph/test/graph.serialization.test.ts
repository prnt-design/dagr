import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import {
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  InvalidGraphJSONError,
  InvalidIdError,
  NodeNotFoundError,
  PortDirectionError,
  PortNotFoundError,
  isDagrGraphError,
} from '../src/errors.js';
import type { Patch } from '../src/patch.js';
import type { GraphJSON } from '../src/serialize.js';

/**
 * Unit coverage for `toJSON` and `fromJSON`.
 *
 * The property suite next door pins the round trip over random mutation
 * histories. This one pins the format itself: which keys are written, which are
 * left out, what the input boundary refuses, and which of the graph's own
 * errors a bad document comes back as.
 */

/** A bag whose `__proto__` key is stored rather than reassigning a prototype. */
function bag(key: string, value: unknown): Record<string, unknown> {
  const built: Record<string, unknown> = {};
  Object.defineProperty(built, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return built;
}

/** The own value at a key, without the `__proto__` accessor getting in the way. */
function own(target: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(target, key)?.value;
}

/**
 * A graph built in a deliberately awkward order: `a` is added, removed, and
 * added again, so it sits last in iteration order rather than first, and the
 * edges arrive in an order that is not the node order either. Everything the
 * round trip has to preserve is visible on this one graph.
 */
function awkward(): Graph {
  const graph = new Graph();
  graph.updateAttrs({ rankdir: 'LR' });
  graph.addNode({ id: 'a', ports: [{ id: 'out', direction: 'out' }] });
  graph.addNode({ id: 'b', attrs: { label: 'B' } });
  graph.addNode('c');
  graph.removeNode('a');
  graph.addNode({
    id: 'a',
    attrs: { label: 'A' },
    ports: [
      { id: 'out', direction: 'out' },
      { id: 'in', direction: 'in' },
    ],
  });
  graph.addEdge({ source: 'c', target: 'a', id: 'ca', targetPort: 'in' });
  graph.addEdge({ source: 'b', target: 'a', id: 'ba', attrs: { weight: 3 } });
  graph.addEdge('b', 'c', 'bc');
  return graph;
}

/** The refusal a document earns, or a failure saying it earned none. */
function refusal(json: unknown): InvalidGraphJSONError {
  try {
    Graph.fromJSON(json);
  } catch (error) {
    if (error instanceof InvalidGraphJSONError) return error;
    throw error;
  }
  throw new Error('expected fromJSON to refuse the document');
}

/** A minimal valid document, as the base for a targeted corruption. */
function document(): Record<string, unknown> {
  return { version: 1, nodes: [{ id: 'a' }, { id: 'b' }], edges: [] };
}

describe('toJSON', () => {
  it('writes a version-tagged document with both arrays, even when empty', () => {
    const json = new Graph().toJSON();
    expect(json).toEqual({ version: 1, nodes: [], edges: [] });
    // Both listings are always present, so a reader never has to tell "no
    // nodes" from "a document that forgot to say".
    expect(Object.hasOwn(json, 'attrs')).toBe(false);
  });

  it('writes nodes, edges, ports, and every attribute bag that has a key', () => {
    const graph = new Graph();
    graph.updateAttrs({ rankdir: 'LR' });
    graph.addNode({
      id: 'filter',
      attrs: { label: 'Filter' },
      ports: [
        { id: 'in', direction: 'in' },
        { id: 'pass', direction: 'out' },
      ],
    });
    graph.addNode('sink');
    graph.addEdge({
      source: 'filter',
      target: 'sink',
      id: 'e1',
      attrs: { weight: 2 },
      sourcePort: 'pass',
    });

    expect(graph.toJSON()).toEqual({
      version: 1,
      attrs: { rankdir: 'LR' },
      nodes: [
        {
          id: 'filter',
          attrs: { label: 'Filter' },
          ports: [
            { id: 'in', direction: 'in' },
            { id: 'pass', direction: 'out' },
          ],
        },
        { id: 'sink' },
      ],
      edges: [
        { id: 'e1', source: 'filter', target: 'sink', attrs: { weight: 2 }, sourcePort: 'pass' },
      ],
    });
  });

  it('omits an empty bag, an empty port list, and an unbound port end', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', 'ab');
    const json = graph.toJSON();

    const node = json.nodes[0];
    const edge = json.edges[0];
    expect(node && Object.keys(node)).toEqual(['id']);
    expect(edge && Object.keys(edge)).toEqual(['id', 'source', 'target']);
  });

  it('is the standard protocol, so JSON.stringify(graph) is the whole file', () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    expect(JSON.stringify(graph)).toBe(
      '{"version":1,"nodes":[{"id":"a","attrs":{"label":"A"}}],"edges":[]}',
    );
  });

  it('writes the arrays in insertion order, a re-added node included', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.removeNode('a');
    graph.addNode('a');
    graph.addEdge('c', 'a', 'ca');
    graph.addEdge('b', 'a', 'ba');
    const json = graph.toJSON();

    expect(json.nodes.map((node) => node.id)).toEqual(['b', 'c', 'a']);
    expect(json.edges.map((edge) => edge.id)).toEqual(['ca', 'ba']);
  });

  it('hands back fresh bags holding the caller values by reference', () => {
    const nested = { rows: [1, 2] };
    const graph = new Graph();
    const node = graph.addNode({ id: 'a', attrs: { nested } });
    const json = graph.toJSON();

    // The bag is a copy, so a caller may edit the document it was handed
    // without reaching into the graph, and it is not frozen the way the
    // record's own bag is.
    expect(json.nodes[0]?.attrs).not.toBe(node.attrs);
    expect(Object.isFrozen(json.nodes[0]?.attrs)).toBe(false);
    // The values in it are not copied. The graph never reads an attribute, so
    // it has no business cloning one, and this is the same aliasing
    // `addNode({ attrs })` already has.
    expect(json.nodes[0]?.attrs?.nested).toBe(nested);
  });

  it('stores a __proto__ attribute key as an own key rather than a prototype', () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', attrs: bag('__proto__', 'stored') });
    const json = graph.toJSON();
    const attrs = json.nodes[0]?.attrs;

    expect(attrs && Object.hasOwn(attrs, '__proto__')).toBe(true);
    expect(attrs && own(attrs, '__proto__')).toBe('stored');
    expect(JSON.stringify(json)).toContain('"__proto__":"stored"');
  });

  it('emits nothing: it is a read, and a watched graph stays quiet', () => {
    const graph = new Graph();
    graph.addNode('a');
    const patches: unknown[] = [];
    graph.subscribe((patch) => {
      patches.push(patch);
    });
    graph.toJSON();
    expect(patches).toEqual([]);
  });

  it('annotates as GraphJSON, the exported type of a document', () => {
    const graph = new Graph<{ label: string }>();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    const json: GraphJSON<{ label: string }> = graph.toJSON();
    expect(json.nodes[0]?.attrs?.label).toBe('A');
  });
});

describe('fromJSON', () => {
  it('round trips a graph to a document that writes itself out again', () => {
    const source = awkward();
    const restored = Graph.fromJSON(source.toJSON());
    expect(restored.toJSON()).toEqual(source.toJSON());
  });

  it('round trips through an actual JSON.stringify and JSON.parse', () => {
    const source = awkward();
    const restored = Graph.fromJSON(JSON.parse(JSON.stringify(source)));
    expect(restored.toJSON()).toEqual(source.toJSON());
  });

  it('restores attributes, ports, and port bindings', () => {
    const restored = Graph.fromJSON(awkward().toJSON());

    expect(restored.attrs).toEqual({ rankdir: 'LR' });
    expect(restored.requireNode('a').attrs).toEqual({ label: 'A' });
    expect(restored.ports('a').map((port) => port.id)).toEqual(['out', 'in']);
    expect(restored.getPort('a', 'in')?.direction).toBe('in');
    expect(restored.requireEdge('ba').attrs).toEqual({ weight: 3 });
    expect(restored.requireEdge('ca').targetPort).toBe('in');
    expect(Object.hasOwn(restored.requireEdge('ca'), 'sourcePort')).toBe(false);
  });

  /**
   * The claim that makes this a round trip rather than a content restore.
   * Insertion order is observable three ways in this model and every one of
   * them has to come back: the listings, the neighbour order that follows node
   * insertion rank, and the `topologicalOrder` tie-break that reads the same
   * rank. Compared as sequences, never as sets.
   */
  it('restores insertion order, neighbour order, and the topological order', () => {
    const source = awkward();
    const restored = Graph.fromJSON(source.toJSON());

    expect(restored.nodes().map((node) => node.id)).toEqual(['b', 'c', 'a']);
    expect(restored.edges().map((edge) => edge.id)).toEqual(['ca', 'ba', 'bc']);
    expect(restored.ports('a').map((port) => port.id)).toEqual(source.ports('a').map((p) => p.id));
    expect(restored.successors('b')).toEqual(source.successors('b'));
    expect(restored.predecessors('a')).toEqual(source.predecessors('a'));
    expect(restored.topologicalOrder()).toEqual(source.topologicalOrder());
    // Not merely the same set, in the same sequence. The graph above is built
    // so that a sorted or content-only comparison would pass on a restore that
    // dropped the order entirely.
    expect(source.topologicalOrder()).toEqual(['b', 'c', 'a']);
  });

  /**
   * Only relative order is promised, and only relative order is observable.
   * Removals leave gaps in the rank counter, so a restored graph's absolute
   * ranks are compacted; nothing on the public surface can see the difference,
   * because every listing that reads rank reads it as an ordering.
   */
  it('keeps relative order under a further mutation, gaps or no gaps', () => {
    const source = awkward();
    const restored = Graph.fromJSON(source.toJSON());
    source.addNode('d');
    restored.addNode('d');
    source.addEdge('d', 'a', 'da');
    restored.addEdge('d', 'a', 'da');

    expect(restored.nodes().map((node) => node.id)).toEqual(source.nodes().map((node) => node.id));
    expect(restored.predecessors('a')).toEqual(source.predecessors('a'));
    expect(restored.topologicalOrder()).toEqual(source.topologicalOrder());
  });

  /**
   * The one divergence, pinned rather than left to be discovered. Generated-id
   * counters are not serialised: they are re-derived from content, because
   * every element is added with an explicit id and claiming one already moves
   * the counter past it. Re-deriving lands one past the highest SURVIVING id in
   * generated shape, so a suffix above that, spent by an element the original
   * removed, is free again on the other side and a restored graph can generate
   * an id the original had retired.
   */
  it('re-derives the id counters, so a removed top suffix comes back free', () => {
    const source = new Graph();
    source.addNode(); // n1
    source.addNode(); // n2
    source.removeNode('n2');
    // Spent, not recycled: the original never hands `n2` out again.
    expect(source.addNode().id).toBe('n3');
    source.removeNode('n3');
    expect(source.nodes().map((node) => node.id)).toEqual(['n1']);

    const restored = Graph.fromJSON(source.toJSON());
    // `n1` is the highest surviving suffix, so the restored counter is at 2 and
    // both retired ids come back. The original is still at 4.
    expect(restored.addNode().id).toBe('n2');
    expect(restored.addNode().id).toBe('n3');
    expect(source.addNode().id).toBe('n4');
  });

  /**
   * The other half of the same story, and the reason this is a divergence
   * rather than a bug: a removed suffix UNDER a surviving one is not recovered,
   * because the counter is a maximum. So the rule is about where the counter
   * lands, not about removal as such.
   */
  it('does not recover a removed suffix that a surviving id sits above', () => {
    const source = new Graph();
    source.addNode(); // n1
    source.addNode(); // n2
    source.removeNode('n1');

    const restored = Graph.fromJSON(source.toJSON());
    expect(restored.addNode().id).toBe('n3');
    expect(source.addNode().id).toBe('n3');
  });

  /**
   * M1.2 promised that records are values and that an update which changes
   * nothing hands back the record already held. A restored graph is a different
   * graph, so its records are different objects, but the rule itself has to
   * survive the trip intact.
   */
  it('builds records that keep the copy-on-write identity rule', () => {
    const source = awkward();
    const restored = Graph.fromJSON(source.toJSON());

    expect(restored.getNode('a')).not.toBe(source.getNode('a'));
    expect(restored.getNode('a')).toBe(restored.getNode('a'));
    expect(Object.isFrozen(restored.requireNode('a'))).toBe(true);

    const node = restored.requireNode('a');
    expect(restored.updateNodeAttrs('a', {})).toBe(node);
    expect(restored.updateNodeAttrs('a', { label: 'A' })).toBe(node);
    expect(restored.updateNodeAttrs('a', { width: undefined })).toBe(node);
    expect(restored.updateNodeAttrs('a', { label: 'A2' })).not.toBe(node);
    expect(node.attrs['label']).toBe('A');
  });

  /**
   * Nobody can have subscribed to a graph that does not exist yet, so the
   * building `fromJSON` does emits nothing. Worth pinning rather than assuming:
   * it is built by calling the same mutating methods that would emit, and the
   * only thing keeping them quiet is that the listener set is empty.
   */
  it('builds a graph nobody is watching, and leaves the source unwatched', () => {
    const source = awkward();
    const seen: Patch[] = [];
    source.subscribe((patch) => {
      seen.push(patch);
    });

    const restored = Graph.fromJSON(source.toJSON());
    expect(seen).toEqual([]);

    const restoredSeen: Patch[] = [];
    restored.subscribe((patch) => {
      restoredSeen.push(patch);
    });
    restored.addNode('fresh');
    // One patch, for the one mutation made after subscribing: no replay of the
    // construction is queued up anywhere.
    expect(restoredSeen.map((patch) => patch.map((op) => op.op))).toEqual([['add-node']]);
  });

  it('stores a __proto__ attribute key through a real JSON round trip', () => {
    const source = new Graph();
    source.addNode({ id: 'a', attrs: bag('__proto__', 'stored') });
    const restored = Graph.fromJSON(JSON.parse(JSON.stringify(source)));
    const attrs = restored.requireNode('a').attrs;

    expect(Object.hasOwn(attrs, '__proto__')).toBe(true);
    expect(own(attrs, '__proto__')).toBe('stored');
    // The prototype is untouched, which is the failure this key exists to
    // catch: a plain assignment would have stored nothing and moved it.
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  });

  it('drops an attribute whose value is undefined, as every other writer does', () => {
    // Not reachable through `JSON.parse`, which has no `undefined`, but a
    // hand-built value can carry one and the graph never stores one.
    const restored = Graph.fromJSON({
      version: 1,
      attrs: { rankdir: undefined },
      nodes: [{ id: 'a', attrs: { label: undefined } }],
      edges: [],
    });
    expect(restored.attrs).toEqual({});
    expect(Object.keys(restored.requireNode('a').attrs)).toEqual([]);
  });

  it('ignores keys the format does not name', () => {
    const restored = Graph.fromJSON({
      ...document(),
      comment: 'written by hand',
      nodes: [{ id: 'a', label: 'not an attribute' }],
    });
    expect(restored.nodes().map((node) => node.id)).toEqual(['a']);
    expect(restored.requireNode('a').attrs).toEqual({});
  });

  it('takes the caller at their word about the attribute types', () => {
    type NodeAttrs = { label: string };
    const graph: Graph<NodeAttrs> = Graph.fromJSON<NodeAttrs>({
      version: 1,
      nodes: [{ id: 'a', attrs: { label: 'A' } }],
      edges: [],
    });
    const label: string | undefined = graph.requireNode('a').attrs.label;
    expect(label).toBe('A');
  });

  it('takes an empty document', () => {
    const restored = Graph.fromJSON({ version: 1, nodes: [], edges: [] });
    expect(restored.nodeCount).toBe(0);
    expect(restored.edgeCount).toBe(0);
    expect(restored.toJSON()).toEqual({ version: 1, nodes: [], edges: [] });
  });
});

describe('fromJSON on a value that is not a document', () => {
  /**
   * The package's only untrusted-input door, so every branch is exercised
   * rather than argued for. Each case names the path a reader would use to find
   * the offending field, which is the whole reason the error carries one.
   */
  const REFUSALS: readonly (readonly [string, unknown, string])[] = [
    ['a number', 7, '(root)'],
    ['a string', '{}', '(root)'],
    ['null', null, '(root)'],
    ['undefined', undefined, '(root)'],
    ['an array', [], '(root)'],
    ['a function', (): void => undefined, '(root)'],
    ['no version', { nodes: [], edges: [] }, 'version'],
    ['a later version', { version: 2, nodes: [], edges: [] }, 'version'],
    ['a stringly version', { version: '1', nodes: [], edges: [] }, 'version'],
    ['no nodes', { version: 1, edges: [] }, 'nodes'],
    ['nodes that are not an array', { version: 1, nodes: {}, edges: [] }, 'nodes'],
    ['no edges', { version: 1, nodes: [] }, 'edges'],
    ['edges that are not an array', { version: 1, nodes: [], edges: 0 }, 'edges'],
    ['graph attrs that are not an object', { version: 1, attrs: 1, nodes: [], edges: [] }, 'attrs'],
    ['graph attrs that are an array', { version: 1, attrs: [], nodes: [], edges: [] }, 'attrs'],
    ['graph attrs that are null', { version: 1, attrs: null, nodes: [], edges: [] }, 'attrs'],
    [
      'a node that is not an object',
      { version: 1, nodes: [{ id: 'a' }, 'b'], edges: [] },
      'nodes[1]',
    ],
    ['a node with no id', { version: 1, nodes: [{}], edges: [] }, 'nodes[0].id'],
    [
      'a node id that is not a string',
      { version: 1, nodes: [{ id: 1 }], edges: [] },
      'nodes[0].id',
    ],
    [
      'node attrs that are not an object',
      { version: 1, nodes: [{ id: 'a', attrs: 'x' }], edges: [] },
      'nodes[0].attrs',
    ],
    [
      'ports that are not an array',
      { version: 1, nodes: [{ id: 'a', ports: {} }], edges: [] },
      'nodes[0].ports',
    ],
    [
      'a port that is not an object',
      { version: 1, nodes: [{ id: 'a', ports: ['p'] }], edges: [] },
      'nodes[0].ports[0]',
    ],
    [
      'a port with no id',
      { version: 1, nodes: [{ id: 'a', ports: [{ direction: 'in' }] }], edges: [] },
      'nodes[0].ports[0].id',
    ],
    [
      'a port with no direction',
      { version: 1, nodes: [{ id: 'a', ports: [{ id: 'p' }] }], edges: [] },
      'nodes[0].ports[0].direction',
    ],
    [
      'a port facing nowhere in particular',
      {
        version: 1,
        nodes: [
          {
            id: 'a',
            ports: [
              { id: 'p', direction: 'in' },
              { id: 'q', direction: 'sideways' },
            ],
          },
        ],
        edges: [],
      },
      'nodes[0].ports[1].direction',
    ],
    [
      'an edge that is not an object',
      { version: 1, nodes: [], edges: [null] },
      'edges[0]',
    ],
    [
      'an edge with no id',
      { version: 1, nodes: [], edges: [{ source: 'a', target: 'b' }] },
      'edges[0].id',
    ],
    [
      'an edge with no source',
      { version: 1, nodes: [], edges: [{ id: 'ab', target: 'b' }] },
      'edges[0].source',
    ],
    [
      'an edge with no target',
      { version: 1, nodes: [], edges: [{ id: 'ab', source: 'a' }] },
      'edges[0].target',
    ],
    [
      'edge attrs that are not an object',
      { version: 1, nodes: [], edges: [{ id: 'ab', source: 'a', target: 'b', attrs: 3 }] },
      'edges[0].attrs',
    ],
    [
      'a source port that is not a string',
      { version: 1, nodes: [], edges: [{ id: 'ab', source: 'a', target: 'b', sourcePort: 4 }] },
      'edges[0].sourcePort',
    ],
    [
      'a target port that is not a string',
      { version: 1, nodes: [], edges: [{ id: 'ab', source: 'a', target: 'b', targetPort: {} }] },
      'edges[0].targetPort',
    ],
  ];

  for (const [label, value, path] of REFUSALS) {
    it(`refuses ${label}, naming ${path}`, () => {
      const error = refusal(value);
      expect(error.path).toBe(path);
      expect(isDagrGraphError(error)).toBe(true);
      expect(error.message).toContain(path);
    });
  }

  /**
   * Shape is checked in full before anything is constructed, so a document
   * carrying both kinds of wrongness reports the shape error: the duplicate
   * below would throw first if validation and construction were interleaved.
   */
  it('validates the whole document before constructing any of it', () => {
    const error = refusal({
      version: 1,
      nodes: [{ id: 'a' }, { id: 'a' }, { id: 3 }],
      edges: [],
    });
    expect(error.path).toBe('nodes[2].id');
  });
});

describe('fromJSON on a document the graph itself refuses', () => {
  /**
   * Content errors are the family's existing members, not a serialization
   * dialect of them. `fromJSON` builds by calling the same public constructors
   * any other caller would, so it cannot construct a graph the public API could
   * not, and the error a caller catches is the one that call always throws.
   */
  const CONTENT: readonly (readonly [string, unknown, new (...args: never[]) => Error])[] = [
    [
      'a duplicate node id',
      { version: 1, nodes: [{ id: 'a' }, { id: 'a' }], edges: [] },
      DuplicateNodeError,
    ],
    [
      'a duplicate edge id',
      {
        version: 1,
        nodes: [{ id: 'a' }],
        edges: [
          { id: 'aa', source: 'a', target: 'a' },
          { id: 'aa', source: 'a', target: 'a' },
        ],
      },
      DuplicateEdgeError,
    ],
    [
      'an edge naming an endpoint that is not there',
      { version: 1, nodes: [{ id: 'a' }], edges: [{ id: 'ab', source: 'a', target: 'b' }] },
      NodeNotFoundError,
    ],
    ['an empty node id', { version: 1, nodes: [{ id: '' }], edges: [] }, InvalidIdError],
    [
      'an empty edge id',
      { version: 1, nodes: [{ id: 'a' }], edges: [{ id: '', source: 'a', target: 'a' }] },
      InvalidIdError,
    ],
    [
      'an empty port id',
      { version: 1, nodes: [{ id: 'a', ports: [{ id: '', direction: 'in' }] }], edges: [] },
      InvalidIdError,
    ],
    [
      'a port declared twice on one node',
      {
        version: 1,
        nodes: [
          {
            id: 'a',
            ports: [
              { id: 'p', direction: 'in' },
              { id: 'p', direction: 'out' },
            ],
          },
        ],
        edges: [],
      },
      DuplicatePortError,
    ],
    [
      'an edge naming a port the node does not declare',
      {
        version: 1,
        nodes: [{ id: 'a' }],
        edges: [{ id: 'aa', source: 'a', target: 'a', sourcePort: 'p' }],
      },
      PortNotFoundError,
    ],
    [
      'an edge naming a port that faces the other way',
      {
        version: 1,
        nodes: [{ id: 'a', ports: [{ id: 'p', direction: 'in' }] }],
        edges: [{ id: 'aa', source: 'a', target: 'a', sourcePort: 'p' }],
      },
      PortDirectionError,
    ],
  ];

  for (const [label, value, expected] of CONTENT) {
    it(`reuses the family for ${label}`, () => {
      expect(() => Graph.fromJSON(value)).toThrow(expected);
      expect(() => Graph.fromJSON(value)).not.toThrow(InvalidGraphJSONError);
    });
  }
});
