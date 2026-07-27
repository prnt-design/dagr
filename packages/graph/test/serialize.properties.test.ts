import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DagrGraphError } from '../src/errors.js';
import type { GraphDocument } from '../src/serialize.js';
import type { PortDirection, PortInit } from '../src/types.js';

/**
 * Property coverage for serialization, over random mutation sequences.
 *
 * The unit suite pins the named cases and every rejection. This one pins the
 * three relationships a document has to keep to be worth writing to a file:
 * reading one back gives a graph that writes the same document, that document
 * survives a trip through JSON text, and the graph it rebuilds is order
 * faithful down to each node's port declarations. The last one is the sharp
 * difference from patch replay, whose own property suite deliberately compares
 * an order-free snapshot because `apply` promises no more than content.
 *
 * The generator is the shape `patch.properties.test.ts` uses, trimmed to what
 * a document exercises: the same node, edge, port and attribute pools, the same
 * weighting towards the calls that build a graph up, and the same swallowing of
 * graph errors, since a rejected call is a legitimate step in a sequence. Every
 * run is seeded, so a failure reproduces exactly.
 */

const RUNS = { seed: 20260727, numRuns: 250 } as const;

const NODE_POOL = ['a', 'b', 'c'] as const;
const EDGE_POOL = ['x1', 'x2', 'x3'] as const;
const PORT_POOL = ['p1', 'p2', 'p3'] as const;
// `inout` weighted up for the same reason it is next door: with an even split
// most generated bindings would be refused and the sequences would exercise the
// validation instead of the binding.
const DIRECTIONS: readonly PortDirection[] = ['in', 'out', 'inout', 'inout', 'inout'];
// `__proto__` is in the pool because it is the key where a store can go wrong
// with nothing failing, and serialization is where it is sharpest: a document
// read back through `JSON.parse` carries it as an OWN property, which an object
// literal would not, so this is the one path that really does hand a bag with
// that key to `addNode`.
const ATTR_KEYS = ['label', 'width', 'weight', '__proto__'] as const;
/** `undefined` is in the pool on purpose: it is the delete form of a patch. */
const ATTR_VALUES = [1, 'x', true, undefined] as const;

/** A patch bag as generated: entries, so an explicit `undefined` survives. */
type Entry = readonly [string, unknown];

/**
 * A patch bag built from generated entries. Defined rather than assigned, for
 * the reason the graph itself defines: a plain assignment of a `__proto__` key
 * reaches the inherited accessor and reassigns the prototype instead of storing
 * anything, and the key pool above includes it.
 */
function bag(entries: readonly Entry[]): Record<string, unknown> {
  const built: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(built, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return built;
}

/** One mutation to attempt. Rejections are part of the exercise. */
type Command =
  | { readonly kind: 'add-node'; readonly id: string; readonly attrs: readonly Entry[]; readonly ports: readonly PortInit[] }
  | { readonly kind: 'add-node-generated' }
  | { readonly kind: 'remove-node'; readonly id: string }
  | {
      readonly kind: 'add-edge';
      readonly id: string | undefined;
      readonly source: string;
      readonly target: string;
      readonly attrs: readonly Entry[];
      readonly sourcePort: string | undefined;
      readonly targetPort: string | undefined;
    }
  | { readonly kind: 'remove-edge'; readonly id: string }
  | { readonly kind: 'add-port'; readonly nodeId: string; readonly port: PortInit }
  | { readonly kind: 'remove-port'; readonly nodeId: string; readonly portId: string }
  | { readonly kind: 'update-node-attrs'; readonly id: string; readonly attrs: readonly Entry[] }
  | { readonly kind: 'update-edge-attrs'; readonly id: string; readonly attrs: readonly Entry[] }
  | { readonly kind: 'update-graph-attrs'; readonly attrs: readonly Entry[] };

const nodeId = fc.constantFrom(...NODE_POOL);
const edgeId = fc.constantFrom(...EDGE_POOL);
const portId = fc.constantFrom(...PORT_POOL);
const direction = fc.constantFrom(...DIRECTIONS);
const portInit: fc.Arbitrary<PortInit> = fc.record({ id: portId, direction });
/** A node's declared ports, distinct by id so the list is never self-rejecting. */
const portInits = fc.uniqueArray(portInit, {
  selector: (port) => port.id,
  minLength: 1,
  maxLength: 3,
});
/** An end that names a port, or one left unbound. */
const boundPort = fc.option(portId, { nil: undefined, freq: 2 });

/** Up to three distinct keys, each at a value that may be the delete form. */
const attrEntries: fc.Arbitrary<readonly Entry[]> = fc.uniqueArray(
  fc.tuple(fc.constantFrom(...ATTR_KEYS), fc.constantFrom(...ATTR_VALUES)),
  { maxLength: 3, selector: ([key]) => key },
);

const command: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 7,
    arbitrary: fc
      .record({ id: nodeId, attrs: attrEntries, ports: portInits })
      .map((fields): Command => ({ kind: 'add-node', ...fields })),
  },
  { weight: 2, arbitrary: fc.constant<Command>({ kind: 'add-node-generated' }) },
  {
    weight: 7,
    arbitrary: fc
      .record({
        id: fc.option(edgeId, { nil: undefined, freq: 8 }),
        source: nodeId,
        target: nodeId,
        attrs: attrEntries,
        sourcePort: boundPort,
        targetPort: boundPort,
      })
      .map((fields): Command => ({ kind: 'add-edge', ...fields })),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({ nodeId, port: portInit })
      .map((fields): Command => ({ kind: 'add-port', ...fields })),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({ id: nodeId, attrs: attrEntries })
      .map((fields): Command => ({ kind: 'update-node-attrs', ...fields })),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({ id: edgeId, attrs: attrEntries })
      .map((fields): Command => ({ kind: 'update-edge-attrs', ...fields })),
  },
  {
    weight: 2,
    arbitrary: fc
      .record({ attrs: attrEntries })
      .map((fields): Command => ({ kind: 'update-graph-attrs', ...fields })),
  },
  {
    weight: 2,
    arbitrary: fc
      .record({ nodeId, portId })
      .map((fields): Command => ({ kind: 'remove-port', ...fields })),
  },
  {
    weight: 1,
    arbitrary: fc.record({ id: edgeId }).map((fields): Command => ({ kind: 'remove-edge', ...fields })),
  },
  // Removals of nodes are weighted up a little relative to the patch suite,
  // because a node removed and added again is what makes insertion order stop
  // agreeing with id order, and an order-faithful claim tested only on graphs
  // where the two agree is a claim tested on nothing.
  {
    weight: 2,
    arbitrary: fc.record({ id: nodeId }).map((fields): Command => ({ kind: 'remove-node', ...fields })),
  },
);

/**
 * A sequence long enough to build something and then take it apart again. The
 * lower bound is not decoration: fast-check biases array length small, and a
 * run of two calls exercises none of the shapes the coverage guards ask for.
 */
const commands = fc.array(command, { minLength: 25, maxLength: 60 });

/** Performs one command. Graph errors are expected and swallowed. */
function run(graph: Graph, item: Command): void {
  try {
    switch (item.kind) {
      case 'add-node':
        graph.addNode({ id: item.id, attrs: bag(item.attrs), ports: item.ports });
        return;
      case 'add-node-generated':
        graph.addNode();
        return;
      case 'remove-node':
        graph.removeNode(item.id);
        return;
      case 'add-edge':
        graph.addEdge({
          source: item.source,
          target: item.target,
          attrs: bag(item.attrs),
          ...(item.id === undefined ? {} : { id: item.id }),
          ...(item.sourcePort === undefined ? {} : { sourcePort: item.sourcePort }),
          ...(item.targetPort === undefined ? {} : { targetPort: item.targetPort }),
        });
        return;
      case 'remove-edge':
        graph.removeEdge(item.id);
        return;
      case 'add-port':
        graph.addPort(item.nodeId, item.port);
        return;
      case 'remove-port':
        graph.removePort(item.nodeId, item.portId);
        return;
      case 'update-node-attrs':
        graph.updateNodeAttrs(item.id, bag(item.attrs));
        return;
      case 'update-edge-attrs':
        graph.updateEdgeAttrs(item.id, bag(item.attrs));
        return;
      case 'update-graph-attrs':
        graph.updateAttrs(bag(item.attrs));
        return;
    }
  } catch (error) {
    // Duplicate, not-found, direction and in-use rejections are part of the
    // exercise. Anything else is a real bug and must not be swallowed.
    if (!(error instanceof DagrGraphError)) throw error;
  }
}

/** Builds a graph by running a sequence on a fresh, unwatched graph. */
function build(items: readonly Command[]): Graph {
  const graph = new Graph();
  for (const item of items) run(graph, item);
  return graph;
}

/** A bag as entries in the order the bag holds them, so key order is compared too. */
function bagOf(attrs: object): readonly Entry[] {
  return Object.entries(attrs);
}

/**
 * The graph's content in full, ORDER INCLUDED, in all three places order
 * exists: node order, edge order, and each node's port declaration order.
 *
 * This is where the suite parts company with `patch.properties.test.ts`, which
 * sorts everything before comparing because `apply` promises content and not
 * order. A document holds the whole graph at once, so it can promise both, and
 * a snapshot that sorted would quietly stop testing the difference. Attribute
 * bags are compared as entry lists in bag order, so a rebuilt bag holding the
 * right keys in a different order is a failure rather than a pass: key order is
 * what makes two documents compare equal as text.
 */
function snapshot(graph: Graph): unknown {
  return {
    attrs: bagOf(graph.attrs),
    nodes: graph.nodes().map((node) => ({
      id: node.id,
      attrs: bagOf(node.attrs),
      ports: node.ports.map((port) => ({ id: port.id, direction: port.direction })),
    })),
    edges: graph.edges().map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      attrs: bagOf(edge.attrs),
      // Normalised to `null` rather than left `undefined`, so an end that
      // vanished cannot be quietly ignored by the comparison.
      sourcePort: edge.sourcePort ?? null,
      targetPort: edge.targetPort ?? null,
    })),
  };
}

/** What the sequences exercised, so a vacuous run cannot pass unnoticed. */
interface Coverage {
  /** Graphs that came out with at least one node. */
  populated: number;
  /** Nodes written to a document. */
  nodes: number;
  /** Edges written to a document. */
  edges: number;
  /** Ports written to a document. */
  ports: number;
  /** Edges that bound at least one port end. */
  boundEnds: number;
  /** Attribute bags that came out holding something. */
  filledBags: number;
  /** Bags carrying the `__proto__` key, the one that can go wrong silently. */
  protoBags: number;
  /** Graphs whose node order does not match their sorted id order. */
  reordered: number;
}

const emptyCoverage = (): Coverage => ({
  populated: 0,
  nodes: 0,
  edges: 0,
  ports: 0,
  boundEnds: 0,
  filledBags: 0,
  protoBags: 0,
  reordered: 0,
});

/** Records what one document says about the run, for the coverage guards. */
function tally(coverage: Coverage, document: GraphDocument): void {
  if (document.nodes.length > 0) coverage.populated += 1;
  coverage.nodes += document.nodes.length;
  coverage.edges += document.edges.length;
  const ids = document.nodes.map((node) => node.id);
  if (ids.join() !== [...ids].sort().join()) coverage.reordered += 1;
  const bags = [
    document.attrs,
    ...document.nodes.map((node) => node.attrs),
    ...document.edges.map((edge) => edge.attrs),
  ];
  for (const held of bags) {
    if (Object.keys(held).length > 0) coverage.filledBags += 1;
    if (Object.hasOwn(held, '__proto__')) coverage.protoBags += 1;
  }
  for (const node of document.nodes) coverage.ports += node.ports.length;
  for (const edge of document.edges) {
    if (edge.sourcePort !== undefined || edge.targetPort !== undefined) coverage.boundEnds += 1;
  }
}

describe('serialization properties over random mutation sequences', () => {
  it('round-trips a graph to a document and back to the same document', () => {
    const total = emptyCoverage();
    fc.assert(
      fc.property(commands, (items) => {
        const graph = build(items);
        const document = graph.toJSON();
        tally(total, document);
        const restored = Graph.fromJSON(document);
        expect(restored.toJSON()).toEqual(document);
        // And as text, which is the claim golden files actually rest on: the
        // same keys in the same order, not merely the same content.
        expect(JSON.stringify(restored)).toBe(JSON.stringify(graph));
      }),
      RUNS,
    );
    // Guards against a vacuous run: the sequences have to reach the shapes the
    // assertions are about, or they would hold on almost-empty graphs.
    expect(total.populated).toBeGreaterThan(200);
    expect(total.nodes).toBeGreaterThan(900);
    expect(total.edges).toBeGreaterThan(150);
    expect(total.ports).toBeGreaterThan(800);
    expect(total.boundEnds).toBeGreaterThan(80);
    expect(total.filledBags).toBeGreaterThan(600);
    expect(total.protoBags).toBeGreaterThan(300);
    expect(total.reordered).toBeGreaterThan(150);
  });

  it('restores every id, port, attribute, and both iteration orders', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const graph = build(items);
        expect(snapshot(Graph.fromJSON(graph.toJSON()))).toEqual(snapshot(graph));
      }),
      RUNS,
    );
  });

  /**
   * The same round trip with JSON text in the middle, which is the only path
   * that really tests the format rather than the object shape: `JSON.parse`
   * creates `__proto__` as an own property, and a bag that lost it would still
   * pass the in-memory property above.
   */
  it('survives a trip through JSON text, __proto__ keys included', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const graph = build(items);
        const parsed: unknown = JSON.parse(JSON.stringify(graph));
        const restored = Graph.fromJSON(parsed);
        expect(snapshot(restored)).toEqual(snapshot(graph));
      }),
      RUNS,
    );
  });

  it('leaves the two graphs holding separate attribute bags', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const graph = build(items);
        const restored = Graph.fromJSON(graph.toJSON());
        expect(restored.attrs).not.toBe(graph.attrs);
        for (const node of graph.nodes()) {
          expect(restored.requireNode(node.id).attrs).not.toBe(node.attrs);
        }
        for (const edge of graph.edges()) {
          expect(restored.requireEdge(edge.id).attrs).not.toBe(edge.attrs);
        }
      }),
      RUNS,
    );
  });
});
