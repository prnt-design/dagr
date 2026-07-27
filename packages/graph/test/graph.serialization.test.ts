import { describe, expect, expectTypeOf, it } from 'vitest';
import { Graph } from '../src/graph.js';
import {
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  InvalidGraphJSONError,
  NodeNotFoundError,
  PortDirectionError,
  PortNotFoundError,
  isDagrGraphError,
} from '../src/errors.js';
import type { Patch } from '../src/patch.js';
import type { GraphJSON } from '../src/serialize.js';
import type { Attrs } from '../src/types.js';

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

  it('hands back fresh bags and fresh ports, holding caller values by reference', () => {
    const nested = { rows: [1, 2] };
    const graph = new Graph();
    const node = graph.addNode({
      id: 'a',
      attrs: { nested },
      ports: [{ id: 'p', direction: 'out' }],
    });
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

    // The port listing is the same promise, and it needs its own assertions:
    // `PortJSON` is structurally identical to `Port` today, so aliasing the
    // record's own frozen array into the document would typecheck and would
    // still round trip. It would hand a caller a document they cannot edit,
    // which is the one thing the copy is for. All four levels are pinned: the
    // array, the array's freeze, the port object, and the port's freeze.
    const ports = json.nodes[0]?.ports;
    expect(ports).not.toBe(node.ports);
    expect(Object.isFrozen(ports)).toBe(false);
    expect(ports?.[0]).not.toBe(node.ports[0]);
    expect(Object.isFrozen(ports?.[0])).toBe(false);
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
   * The two shapes the format could quietly collapse and still look right.
   *
   * Parallel edges are the multi-digraph promise, and nothing about the
   * document layout enforces it: a reader that keyed edges by their ordered
   * pair rather than by their id would drop the second one and still write out
   * a graph that round trips. A self loop is the other, since it is the one
   * edge whose two ends are the same node and the one shape that makes a graph
   * cyclic on its own. Both are common in the property run and neither had a
   * unit-level round trip until now.
   */
  it('restores parallel edges and a self loop, ends and order intact', () => {
    const source = new Graph();
    source.addNode('a');
    source.addNode({ id: 'b', ports: [{ id: 'p', direction: 'inout' }] });
    source.addEdge({ source: 'a', target: 'b', id: 'ab1' });
    source.addEdge({ source: 'a', target: 'b', id: 'ab2', attrs: { weight: 2 } });
    source.addEdge({ source: 'b', target: 'b', id: 'loop', sourcePort: 'p', targetPort: 'p' });

    const restored = Graph.fromJSON(source.toJSON());
    expect(restored.edges().map((edge) => edge.id)).toEqual(['ab1', 'ab2', 'loop']);
    expect(restored.edgesBetween('a', 'b').map((edge) => edge.id)).toEqual(['ab1', 'ab2']);
    expect(restored.getEdge('ab2')?.attrs['weight']).toBe(2);
    // The loop's ends both name `b`, and both are bound to the same port.
    const loop = restored.requireEdge('loop');
    expect([loop.source, loop.target, loop.sourcePort, loop.targetPort]).toEqual([
      'b',
      'b',
      'p',
      'p',
    ]);
    // A self loop is what makes this graph cyclic, and the witness survives.
    expect(restored.isAcyclic()).toBe(false);
    expect(restored.findCycle()).toEqual(source.findCycle());
    // Neighbours are distinct, so two parallel edges list `b` once and the loop
    // makes `b` its own successor.
    expect(restored.successors('a')).toEqual(['b']);
    expect(restored.successors('b')).toEqual(['b']);
    expect(restored.toJSON()).toEqual(source.toJSON());
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
   * lands, not about removal as such. Named for the one case it pins rather
   * than for the general rule, because the general rule has an exception the
   * next test owns.
   */
  it('does not recover n1 under a surviving n2, since the counter is a maximum', () => {
    const source = new Graph();
    source.addNode(); // n1
    source.addNode(); // n2
    source.removeNode('n1');

    const restored = Graph.fromJSON(source.toJSON());
    expect(restored.addNode().id).toBe('n3');
    expect(source.addNode().id).toBe('n3');
  });

  /**
   * Where "one past the highest surviving suffix" stops being the rule.
   * {@link advanceSeq} refuses a suffix at or past `Number.MAX_SAFE_INTEGER`,
   * since arithmetic there is not exact, so such a survivor moves the counter
   * nowhere on either side of the trip and every smaller suffix is free in the
   * restored graph however far under the survivor it sits.
   *
   * Nothing unsafe follows. Generation probes the node map rather than trusting
   * the counter, so an id in use is still never handed out, which is why this
   * is a documented divergence and not a defect.
   */
  it('leaves the counter alone for a survivor past the safe-integer boundary', () => {
    const huge = `n${String(Number.MAX_SAFE_INTEGER)}`;
    const source = new Graph();
    source.addNode(); // n1
    source.addNode(); // n2
    source.addNode(huge); // refused by advanceSeq, so the counter stays at 3
    source.removeNode('n1');
    source.removeNode('n2');
    expect(source.nodes().map((node) => node.id)).toEqual([huge]);

    const restored = Graph.fromJSON(source.toJSON());
    // The survivor contributes nothing, so the restored counter is back at 1
    // and hands out ids the survivor sits far above.
    expect(restored.addNode().id).toBe('n1');
    expect(restored.addNode().id).toBe('n2');
    // The original never went back either: its counter is still where the two
    // generated nodes left it.
    expect(source.addNode().id).toBe('n3');
    // One under the boundary is accepted, which is what makes the line exact.
    const under = new Graph();
    under.addNode(`n${String(Number.MAX_SAFE_INTEGER - 1)}`);
    expect(Graph.fromJSON(under.toJSON()).addNode().id).toBe(
      `n${String(Number.MAX_SAFE_INTEGER)}`,
    );
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

/**
 * Type-level coverage of the two `fromJSON` signatures.
 *
 * These assertions are checked by `tsc --noEmit`, which covers this directory,
 * so this file failing to compile is the failure they exist to catch. The
 * overload is the whole point: a document that already carries its attribute
 * types has no business handing them back as `Attrs`, and the `unknown` door
 * has to keep landing exactly where it always did. Nothing here changes at
 * runtime, so pinning both halves is the only thing stopping the overload from
 * rotting into a signature nobody reaches.
 */
describe('fromJSON type parameters', () => {
  type NodeAttrs = { label: string };
  type EdgeAttrs = { weight: number };
  type GraphAttrs = { rankdir: string };

  it('infers all three from a document that already carries them', () => {
    const source = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    source.updateAttrs({ rankdir: 'LR' });
    source.addNode({ id: 'a', attrs: { label: 'A' } });
    source.addNode('b');
    source.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { weight: 2 } });
    const doc: GraphJSON<NodeAttrs, EdgeAttrs, GraphAttrs> = source.toJSON();

    // No annotation and no explicit arguments: the document says what it holds.
    const back = Graph.fromJSON(doc);
    expectTypeOf(back).toEqualTypeOf<Graph<NodeAttrs, EdgeAttrs, GraphAttrs>>();
    expectTypeOf(back.getNode('a')?.attrs.label).toEqualTypeOf<string | undefined>();
    expectTypeOf(back.getEdge('ab')?.attrs.weight).toEqualTypeOf<number | undefined>();
    expectTypeOf(back.attrs.rankdir).toEqualTypeOf<string | undefined>();

    // @ts-expect-error the document declared `label`, so there is no `colour`.
    const colour: unknown = back.getNode('a')?.attrs.colour;
    expect(colour).toBeUndefined();

    expect(back.requireNode('a').attrs.label).toBe('A');
  });

  it('leaves an unknown value on the defaults, exactly as before', () => {
    const value: unknown = { version: 1, nodes: [{ id: 'a' }], edges: [] };
    const back = Graph.fromJSON(value);
    expectTypeOf(back).toEqualTypeOf<Graph<Attrs, Attrs, Attrs>>();
    // The bare `Attrs` bag reads anything as `unknown` rather than refusing it,
    // which is what makes this the honest answer for a value nobody typed.
    expectTypeOf(back.getNode('a')?.attrs.anything).toEqualTypeOf<unknown>();
    expect(back.nodeCount).toBe(1);
  });

  it('leaves JSON.parse on the defaults, since its result is any', () => {
    const parsed = JSON.parse('{"version":1,"nodes":[],"edges":[]}') as unknown;
    expectTypeOf(Graph.fromJSON(parsed)).toEqualTypeOf<Graph<Attrs, Attrs, Attrs>>();
    expect(Graph.fromJSON(parsed).nodeCount).toBe(0);
  });

  it('still takes explicit arguments over an untyped value', () => {
    const value: unknown = { version: 1, nodes: [{ id: 'a', attrs: { label: 'A' } }], edges: [] };
    const back = Graph.fromJSON<NodeAttrs>(value);
    expectTypeOf(back).toEqualTypeOf<Graph<NodeAttrs, Attrs, Attrs>>();
    expectTypeOf(back.getNode('a')?.attrs.label).toEqualTypeOf<string | undefined>();
    expect(back.requireNode('a').attrs.label).toBe('A');
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
    // Emptiness is shape, not content. `''` is refusable from the format alone
    // with no knowledge of the rest of the document, which is the line this
    // module draws, and a caller looking for the field in a large file needs
    // the path far more here than anywhere else: the error the graph would
    // throw instead names a kind and an id that is the empty string, so it
    // gives a reader nothing to search for.
    ['an empty node id', { version: 1, nodes: [{ id: '' }], edges: [] }, 'nodes[0].id'],
    [
      'an empty port id',
      { version: 1, nodes: [{ id: 'a', ports: [{ id: '', direction: 'in' }] }], edges: [] },
      'nodes[0].ports[0].id',
    ],
    [
      'an empty edge id',
      { version: 1, nodes: [{ id: 'a' }], edges: [{ id: '', source: 'a', target: 'a' }] },
      'edges[0].id',
    ],
    [
      'an empty edge source',
      { version: 1, nodes: [{ id: 'a' }], edges: [{ id: 'aa', source: '', target: 'a' }] },
      'edges[0].source',
    ],
    [
      'an empty edge target',
      { version: 1, nodes: [{ id: 'a' }], edges: [{ id: 'aa', source: 'a', target: '' }] },
      'edges[0].target',
    ],
    [
      'an empty bound port end',
      {
        version: 1,
        nodes: [{ id: 'a' }],
        edges: [{ id: 'aa', source: 'a', target: 'a', sourcePort: '' }],
      },
      'edges[0].sourcePort',
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

  it('says what it wanted when a string is there but empty', () => {
    const error = refusal({ version: 1, nodes: [{ id: '' }], edges: [] });
    expect(error.expected).toBe('a non-empty string');
    // A missing or mistyped one is the other message, so the two failures stay
    // distinguishable to a reader who only has the error.
    expect(refusal({ version: 1, nodes: [{ id: 7 }], edges: [] }).expected).toBe('a string');
  });

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
