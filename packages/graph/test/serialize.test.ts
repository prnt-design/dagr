import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import {
  DuplicateNodeError,
  InvalidDocumentError,
  NodeNotFoundError,
  PortDirectionError,
} from '../src/errors.js';
import type { GraphDocument } from '../src/serialize.js';

/**
 * Unit coverage for `toJSON` and `Graph.fromJSON`.
 *
 * The property suite next door pins the round trip over random graphs. This one
 * pins the named cases: what the document looks like, the four decisions a
 * reader is most likely to be surprised by (history is not in the document,
 * order is, replay goes through the mutators, attribute values are never
 * inspected), and every way a malformed document is refused.
 */

/** A small graph exercising every field the document has. */
function sample(): Graph {
  const graph = new Graph();
  graph.updateAttrs({ rankdir: 'TB' });
  graph.addNode({
    id: 'ingest',
    attrs: { label: 'Ingest' },
    ports: [{ id: 'out', direction: 'out' }],
  });
  graph.addNode({ id: 'parse', ports: [{ id: 'in', direction: 'in' }, { id: 'both' }] });
  graph.addEdge({
    id: 'first',
    source: 'ingest',
    target: 'parse',
    attrs: { weight: 2 },
    sourcePort: 'out',
    targetPort: 'in',
  });
  graph.addEdge({ id: 'loop', source: 'parse', target: 'parse' });
  return graph;
}

/** The document `sample()` has to produce, written out rather than derived. */
const SAMPLE_DOCUMENT: GraphDocument = {
  version: 1,
  attrs: { rankdir: 'TB' },
  nodes: [
    {
      id: 'ingest',
      attrs: { label: 'Ingest' },
      ports: [{ id: 'out', direction: 'out' }],
    },
    {
      id: 'parse',
      attrs: {},
      ports: [
        { id: 'in', direction: 'in' },
        { id: 'both', direction: 'inout' },
      ],
    },
  ],
  edges: [
    {
      id: 'first',
      source: 'ingest',
      target: 'parse',
      attrs: { weight: 2 },
      sourcePort: 'out',
      targetPort: 'in',
    },
    { id: 'loop', source: 'parse', target: 'parse', attrs: {} },
  ],
};

describe('toJSON', () => {
  it('describes the whole graph: version, attributes, nodes, ports, edges', () => {
    // The fixture is asserted before it is used, so a test below cannot pass
    // over a graph smaller or flatter than the one it claims to cover.
    const graph = sample();
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(2);
    expect(graph.requireNode('parse').ports).toHaveLength(2);

    expect(graph.toJSON()).toEqual(SAMPLE_DOCUMENT);
  });

  it('produces a document for an empty graph rather than refusing one', () => {
    expect(new Graph().toJSON()).toEqual({ version: 1, attrs: {}, nodes: [], edges: [] });
  });

  /**
   * An unbound end is an absent key, never a key present and `undefined`, the
   * same distinction the edge records and the patch ops draw. `toEqual` cannot
   * see the difference, so this asks the object directly.
   */
  it('leaves an unbound port end out rather than writing it as null', () => {
    const document = sample().toJSON();
    const loop = document.edges[1];
    expect(loop?.id).toBe('loop');
    expect(Object.hasOwn(loop ?? {}, 'sourcePort')).toBe(false);
    expect(Object.hasOwn(loop ?? {}, 'targetPort')).toBe(false);
  });

  /** Decision 7: `toJSON` is the hook by name, so `JSON.stringify` finds it. */
  it('is the JSON.stringify hook, so stringifying the graph works', () => {
    const graph = sample();
    expect(JSON.parse(JSON.stringify(graph))).toEqual(SAMPLE_DOCUMENT);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(graph.toJSON()));
  });

  /**
   * Decision 6: the bags are handed back by reference, not copied and not
   * inspected. This is what makes `toJSON` cheap on a large graph, and it is
   * also why a caller who stored something JSON cannot express gets
   * `JSON.stringify`'s own behaviour rather than a rewritten value.
   */
  it('hands the frozen attribute bags back by reference', () => {
    const graph = sample();
    const document = graph.toJSON();
    expect(document.attrs).toBe(graph.attrs);
    expect(document.nodes[0]?.attrs).toBe(graph.requireNode('ingest').attrs);
    expect(document.nodes[0]?.ports).toBe(graph.requireNode('ingest').ports);
    expect(document.edges[0]?.attrs).toBe(graph.requireEdge('first').attrs);
  });

  it('keeps a value JSON cannot express, and lets JSON.stringify drop it', () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', attrs: { render: () => 'x', label: 'A' } });
    const document = graph.toJSON();
    expect(typeof document.nodes[0]?.attrs.render).toBe('function');
    // Not this module's doing: a function value is what `JSON.stringify` drops
    // from any object, and the document is an ordinary object.
    expect(JSON.parse(JSON.stringify(document)).nodes[0].attrs).toEqual({ label: 'A' });
  });

  it('freezes the document it hands back, arrays included', () => {
    const document = sample().toJSON();
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.nodes)).toBe(true);
    expect(Object.isFrozen(document.edges)).toBe(true);
    expect(Object.isFrozen(document.nodes[0])).toBe(true);
    expect(Object.isFrozen(document.edges[0])).toBe(true);
  });
});

describe('Graph.fromJSON', () => {
  it('rebuilds the graph the document describes', () => {
    const graph = Graph.fromJSON(SAMPLE_DOCUMENT);
    expect(graph).toBeInstanceOf(Graph);
    expect(graph.toJSON()).toEqual(SAMPLE_DOCUMENT);
    expect(graph.attrs).toEqual({ rankdir: 'TB' });
    expect(graph.requireNode('ingest').attrs).toEqual({ label: 'Ingest' });
    expect(graph.requireEdge('first').sourcePort).toBe('out');
    expect(graph.edgesBetween('parse', 'parse').map((edge) => edge.id)).toEqual(['loop']);
  });

  it('round-trips a graph through JSON text and back', () => {
    const graph = sample();
    const restored = Graph.fromJSON(JSON.parse(JSON.stringify(graph)));
    expect(restored.toJSON()).toEqual(graph.toJSON());
  });

  it('hands back a live graph, which mutates and emits like any other', () => {
    const graph = Graph.fromJSON(SAMPLE_DOCUMENT);
    const patches: unknown[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.addNode('extra');
    expect(patches).toHaveLength(1);
    expect(graph.nodeCount).toBe(3);
  });

  /**
   * Decision 2: order faithful, deliberately unlike `apply`. A document holds
   * the whole graph at once, so replaying in array order restores insertion
   * order for free, and the ids alone would not: `parse` sorts before `render`
   * and was added after it, and `moved` is at the end because it was removed
   * and added again.
   */
  it('restores insertion order for nodes, edges, and ports', () => {
    const graph = new Graph();
    graph.addNode('render');
    graph.addNode('moved');
    graph.addNode('parse');
    graph.addEdge('parse', 'render', 'second');
    graph.addEdge('render', 'moved', 'first');
    graph.removeNode('moved');
    graph.addNode('moved');
    graph.addPort('parse', { id: 'zz' });
    graph.addPort('parse', { id: 'aa' });

    const ids = graph.nodes().map((node) => node.id);
    expect(ids).toEqual(['render', 'parse', 'moved']);

    const restored = Graph.fromJSON(graph.toJSON());
    expect(restored.nodes().map((node) => node.id)).toEqual(ids);
    expect(restored.edges().map((edge) => edge.id)).toEqual(['second']);
    expect(restored.ports('parse').map((port) => port.id)).toEqual(['zz', 'aa']);
  });

  /**
   * Decision 3: replay goes through the public mutators, so a document that is
   * shaped like a document but describes an impossible graph fails exactly the
   * way the equivalent bad call fails, with no second implementation of the
   * same checks to drift from the first.
   */
  it('refuses an inconsistent document with the mutator error, not a document error', () => {
    const duplicate: GraphDocument = {
      version: 1,
      attrs: {},
      nodes: [
        { id: 'a', attrs: {}, ports: [] },
        { id: 'a', attrs: {}, ports: [] },
      ],
      edges: [],
    };
    expect(() => Graph.fromJSON(duplicate)).toThrow(DuplicateNodeError);

    const dangling: GraphDocument = {
      version: 1,
      attrs: {},
      nodes: [{ id: 'a', attrs: {}, ports: [] }],
      edges: [{ id: 'e', source: 'a', target: 'b', attrs: {} }],
    };
    expect(() => Graph.fromJSON(dangling)).toThrow(NodeNotFoundError);

    const wrongWay: GraphDocument = {
      version: 1,
      attrs: {},
      nodes: [{ id: 'a', attrs: {}, ports: [{ id: 'p', direction: 'in' }] }],
      edges: [{ id: 'e', source: 'a', target: 'a', attrs: {}, sourcePort: 'p' }],
    };
    expect(() => Graph.fromJSON(wrongWay)).toThrow(PortDirectionError);
  });

  /** The other half of decision 4: the two failures are told apart by code. */
  it('tells "not a document" apart from "the graph does not hold together"', () => {
    const notADocument = (): unknown =>
      Graph.fromJSON({ version: 1, attrs: {}, nodes: {}, edges: [] });
    const notAGraph = (): unknown =>
      Graph.fromJSON({
        version: 1,
        attrs: {},
        nodes: [],
        edges: [{ id: 'e', source: 'a', target: 'a', attrs: {} }],
      });
    expect(notADocument).toThrow(InvalidDocumentError);
    expect(notAGraph).toThrow(NodeNotFoundError);
    expect(notAGraph).not.toThrow(InvalidDocumentError);
  });

  /**
   * Decision 1: the document describes content, not history, so the id counters
   * are not in it and a round trip does not continue the original's generation
   * sequence. The original has spent `n2` and `n3` and will never hand either
   * out again; the round trip has only ever seen `n1`, so its next generated id
   * is `n2`. Worth pinning rather than leaving to the docs, because it is the
   * one place a round trip is visibly not the identity.
   */
  it('does not carry the id counters, so a spent suffix comes back', () => {
    const graph = new Graph();
    expect([graph.addNode().id, graph.addNode().id, graph.addNode().id]).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
    graph.removeNode('n3');
    graph.removeNode('n2');
    expect(graph.addNode().id).toBe('n4');
    graph.removeNode('n4');

    const restored = Graph.fromJSON(graph.toJSON());
    expect(restored.nodes().map((node) => node.id)).toEqual(['n1']);
    expect(restored.addNode().id).toBe('n2');
  });

  /**
   * The same decision from the other side, and the reason it is worth having:
   * a document is a usable golden key only if two graphs holding the same
   * content in the same order produce the same document however they got there.
   */
  it('produces the same document for two graphs built by different routes', () => {
    const built = new Graph();
    built.addNode();
    built.addNode();
    built.addNode();
    built.removeNode('n2');

    const declared = new Graph();
    declared.addNode('n1');
    declared.addNode('n3');

    expect(built.nodes().map((node) => node.id)).toEqual(['n1', 'n3']);
    expect(JSON.stringify(built)).toBe(JSON.stringify(declared));
  });

  /**
   * Replay hands the document's own bags to the mutators, which store a fresh
   * bag per element rather than the one they were given, so the two graphs can
   * never alias. Both bags are frozen, so aliasing could not be observed
   * through a write, which is exactly why it is asserted on identity here.
   */
  it('does not share attribute bags with the graph the document came from', () => {
    const graph = sample();
    const document = graph.toJSON();
    const restored = Graph.fromJSON(document);

    expect(restored.attrs).toEqual(graph.attrs);
    expect(restored.attrs).not.toBe(graph.attrs);
    expect(restored.requireNode('ingest').attrs).not.toBe(graph.requireNode('ingest').attrs);
    expect(restored.requireEdge('first').attrs).not.toBe(graph.requireEdge('first').attrs);
    expect(restored.requireNode('ingest').attrs).toEqual(graph.requireNode('ingest').attrs);
  });

  /**
   * `__proto__` is the key where a store can go wrong with no call failing, and
   * a document read back from `JSON.parse` is the sharpest version of it: the
   * parser creates the key as an own property, unlike an object literal, which
   * would have reassigned the prototype instead. So this is the one path where
   * a bag really does arrive carrying it, and it has to survive both ways.
   */
  it('carries a __proto__ attribute key through JSON.parse and back', () => {
    const graph = new Graph();
    const attrs: Record<string, unknown> = {};
    Object.defineProperty(attrs, '__proto__', {
      value: 'own',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    graph.addNode({ id: 'a', attrs });
    expect(Object.hasOwn(graph.requireNode('a').attrs, '__proto__')).toBe(true);

    const text = JSON.stringify(graph);
    expect(text).toContain('__proto__');
    const parsed: unknown = JSON.parse(text);
    const restored = Graph.fromJSON(parsed);
    const bag = restored.requireNode('a').attrs;
    expect(Object.hasOwn(bag, '__proto__')).toBe(true);
    expect(Object.entries(bag)).toEqual([['__proto__', 'own']]);
    // Stored as an attribute, not as a prototype: the bag is still a plain
    // object, which is what the whole `define` discipline exists to keep true.
    expect(Object.getPrototypeOf(bag)).toBe(Object.prototype);
    expect(restored.toJSON()).toEqual(graph.toJSON());
  });
});

/**
 * A malformed document, built one field at a time.
 *
 * Every case below starts from {@link document}, which is valid and is
 * asserted to be valid first, and overrides exactly one field. So a case that
 * reports the path it claims to report can only have got there through the
 * check it is named for: nothing else about the document is wrong.
 */
type Json = Record<string, unknown>;

function port(overrides: Json = {}): Json {
  return { id: 'p', direction: 'out', ...overrides };
}

function node(overrides: Json = {}): Json {
  const ports = [port(), port({ id: 'q', direction: 'in' })];
  return { id: 'a', attrs: {}, ports, ...overrides };
}

function edge(overrides: Json = {}): Json {
  const ends = { sourcePort: 'p', targetPort: 'q' };
  return { id: 'e', source: 'a', target: 'a', attrs: {}, ...ends, ...overrides };
}

function document(overrides: Json = {}): Json {
  return { version: 1, attrs: { rankdir: 'TB' }, nodes: [node()], edges: [edge()], ...overrides };
}

/** Each case: what is wrong, and the path the error has to name. */
interface Rejection {
  readonly name: string;
  readonly path: string;
  readonly value: unknown;
}

const REJECTIONS: readonly Rejection[] = [
    { name: 'null', path: '', value: null },
    { name: 'a number', path: '', value: 7 },
    { name: 'a string', path: '', value: '{}' },
    { name: 'an array of nodes with no document around them', path: '', value: [node()] },
    { name: 'a missing version', path: 'version', value: document({ version: undefined }) },
    { name: 'a version from the future', path: 'version', value: document({ version: 2 }) },
    { name: 'a version written as a string', path: 'version', value: document({ version: '1' }) },
    { name: 'missing graph attributes', path: 'attrs', value: document({ attrs: undefined }) },
    { name: 'null graph attributes', path: 'attrs', value: document({ attrs: null }) },
    { name: 'graph attributes as an array', path: 'attrs', value: document({ attrs: [] }) },
    { name: 'a missing node list', path: 'nodes', value: document({ nodes: undefined }) },
    { name: 'a node list that is an object', path: 'nodes', value: document({ nodes: {} }) },
    { name: 'a node that is a string', path: 'nodes[0]', value: document({ nodes: ['a'] }) },
    {
      name: 'a node id that is a number',
      path: 'nodes[0].id',
      value: document({ nodes: [node({ id: 3 })] }),
    },
    {
      name: 'missing node attributes',
      path: 'nodes[0].attrs',
      value: document({ nodes: [node({ attrs: undefined })] }),
    },
    {
      name: 'a missing port list',
      path: 'nodes[0].ports',
      value: document({ nodes: [node({ ports: undefined })] }),
    },
    {
      name: 'a port that is null',
      path: 'nodes[0].ports[1]',
      value: document({ nodes: [node({ ports: [port(), null] })] }),
    },
    {
      name: 'a missing port id',
      path: 'nodes[0].ports[1].id',
      value: document({ nodes: [node({ ports: [port(), port({ id: undefined })] })] }),
    },
    {
      name: 'a missing port direction',
      path: 'nodes[0].ports[1].direction',
      value: document({ nodes: [node({ ports: [port(), port({ direction: undefined })] })] }),
    },
    {
      name: 'a port direction outside the three',
      path: 'nodes[0].ports[1].direction',
      value: document({ nodes: [node({ ports: [port(), port({ direction: 'sideways' })] })] }),
    },
    { name: 'a missing edge list', path: 'edges', value: document({ edges: undefined }) },
    { name: 'an edge list that is an object', path: 'edges', value: document({ edges: {} }) },
    { name: 'an edge that is a number', path: 'edges[0]', value: document({ edges: [1] }) },
    {
      name: 'a missing edge id',
      path: 'edges[0].id',
      value: document({ edges: [edge({ id: undefined })] }),
    },
    {
      name: 'a missing edge source',
      path: 'edges[0].source',
      value: document({ edges: [edge({ source: undefined })] }),
    },
    {
      name: 'an edge target that is null',
      path: 'edges[0].target',
      value: document({ edges: [edge({ target: null })] }),
    },
    {
      name: 'edge attributes that are a string',
      path: 'edges[0].attrs',
      value: document({ edges: [edge({ attrs: 'none' })] }),
    },
    {
      name: 'a source port spelled as null',
      path: 'edges[0].sourcePort',
      value: document({ edges: [edge({ sourcePort: null })] }),
    },
    {
      name: 'a target port that is a number',
      path: 'edges[0].targetPort',
      value: document({ edges: [edge({ targetPort: 2 })] }),
    },
  ];

describe('Graph.fromJSON on a malformed document', () => {
  /**
   * The control, and it runs first for a reason: every rejection below is one
   * override away from this document, so if this one were rejected too, or
   * were smaller than it looks, the whole table could pass for the wrong
   * reason.
   */
  it('accepts the document every rejection below is built from', () => {
    const graph = Graph.fromJSON(document());
    expect(graph.nodeCount).toBe(1);
    expect(graph.edgeCount).toBe(1);
    expect(graph.ports('a')).toHaveLength(2);
    expect(graph.requireEdge('e').sourcePort).toBe('p');
    expect(graph.attrs).toEqual({ rankdir: 'TB' });
  });

  it.each(REJECTIONS)('refuses $name, naming $path', ({ path, value }) => {
    expect(() => Graph.fromJSON(value)).toThrow(InvalidDocumentError);
    try {
      Graph.fromJSON(value);
      expect.unreachable('the document was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDocumentError);
      expect((error as InvalidDocumentError).path).toBe(path);
      expect((error as InvalidDocumentError).message).toContain('graph document');
    }
  });

  /**
   * An unbound end is an absent key in a document, and a document built in
   * memory rather than parsed can spell absence as a key holding `undefined`.
   * `JSON.parse` never produces that, `addEdge` does not tell the two apart,
   * and refusing it would only surprise a caller who built the object by hand.
   * A `null` is a different claim and is refused above.
   */
  it('reads a port end present and undefined as unbound', () => {
    const graph = Graph.fromJSON(
      document({ edges: [edge({ sourcePort: undefined, targetPort: undefined })] }),
    );
    expect(graph.requireEdge('e').sourcePort).toBeUndefined();
    expect(Object.hasOwn(graph.toJSON().edges[0] ?? {}, 'sourcePort')).toBe(false);
  });

  /**
   * Fields this version does not know are dropped rather than refused. A
   * document from a later format is caught by `version` long before an unknown
   * field could be read, so what is left here is a writer's own annotation, and
   * refusing those would make the format brittle for no gain. They do not
   * survive: the document that comes back out is the one this version writes.
   */
  it('ignores fields it does not know, and does not write them back', () => {
    const graph = Graph.fromJSON(
      document({ comment: 'hand written', nodes: [node({ shape: 'box' })] }),
    );
    const round = graph.toJSON();
    expect(Object.hasOwn(round, 'comment')).toBe(false);
    expect(Object.hasOwn(round.nodes[0] ?? {}, 'shape')).toBe(false);
    expect(round.nodes[0]?.id).toBe('a');
  });
});
