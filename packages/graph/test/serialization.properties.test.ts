import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DagrGraphError } from '../src/errors.js';
import type { GraphJSON } from '../src/serialize.js';
import type { EdgePortsPatch, PortDirection, PortInit } from '../src/types.js';

/**
 * Property coverage for serialization, over random mutation histories.
 *
 * The unit suite pins the format one field at a time. This one pins the claim
 * the format exists to make: a document written from a graph rebuilds THAT
 * graph, order included, not merely its contents. That is a strictly higher bar
 * than M1.3's `apply` clears, and it is why nothing here sorts anything before
 * comparing it. The command sequences are the patch suite's, because the
 * histories worth serialising are the awkward ones: removals, re-adds, ports
 * declared and taken away, rejections that must leave nothing behind.
 *
 * Every run is seeded, so a failure reproduces exactly, and fast-check prints
 * the seed with the counterexample.
 */

const RUNS = { seed: 20260727, numRuns: 200 } as const;

const NODE_POOL = ['a', 'b', 'c'] as const;
const EDGE_POOL = ['x1', 'x2', 'x3'] as const;
const PORT_POOL = ['p1', 'p2', 'p3'] as const;
// `inout` weighted, for the reason the patch suite gives: with an even split
// most generated bindings would be rejections and the sequences would exercise
// the validation rather than the graph.
const DIRECTIONS: readonly PortDirection[] = ['in', 'out', 'inout', 'inout', 'inout'];
// `__proto__` is in the pool for the same reason it is in the patch suite and
// the invariants suite: it is the one key where storing and reading a bag can
// go wrong with no call failing, and serialization adds two more places to get
// it wrong, the document and whatever `JSON.parse` hands back.
const ATTR_KEYS = ['label', 'width', 'weight', '__proto__'] as const;
/** `undefined` is in both pools on purpose: it is the delete form of a patch. */
const JSON_VALUES = [1, 'x', true, null, undefined] as const;
/**
 * Values a document holds fine and `JSON.stringify` does not. The graph never
 * reads an attribute, so a structural round trip passes them through by
 * reference whatever they are; only the properties that actually stringify are
 * restricted to the pool above.
 */
const RICH_VALUES = [1, 'x', true, Number.NaN, { nested: [1, 2] }, new Date(0), undefined] as const;

/** A patch bag as generated: entries, so an explicit `undefined` survives. */
type Entry = readonly [string, unknown];

/**
 * A patch bag built from generated entries. Defined rather than assigned, for
 * the reason the graph itself defines: a plain assignment of a `__proto__` key
 * hits the inherited accessor and moves this object's prototype instead of
 * storing anything.
 */
function bag(entries: readonly Entry[]): Record<string, unknown> {
  const built: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(built, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return built;
}

/** One mutation to attempt. Rejections are part of the exercise. */
type Command =
  | {
      readonly kind: 'add-node';
      readonly id: string;
      readonly attrs: readonly Entry[];
      readonly ports: readonly PortInit[];
    }
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
  | { readonly kind: 'update-graph-attrs'; readonly attrs: readonly Entry[] }
  | { readonly kind: 'update-edge-ports'; readonly id: string; readonly ports: EdgePortsPatch };

const nodeId = fc.constantFrom(...NODE_POOL);
const edgeId = fc.constantFrom(...EDGE_POOL);
const portId = fc.constantFrom(...PORT_POOL);
const direction = fc.constantFrom(...DIRECTIONS);
const portInit: fc.Arbitrary<PortInit> = fc.record({ id: portId, direction });
const portInits = fc.uniqueArray(portInit, {
  selector: (port) => port.id,
  minLength: 1,
  maxLength: 3,
});
const boundPort = fc.option(portId, { nil: undefined, freq: 2 });

const portsPatch: fc.Arbitrary<EdgePortsPatch> = fc
  .record({
    namesSource: fc.boolean(),
    namesTarget: fc.boolean(),
    sourcePort: boundPort,
    targetPort: boundPort,
  })
  .map(({ namesSource, namesTarget, sourcePort, targetPort }) => ({
    ...(namesSource ? { sourcePort } : {}),
    ...(namesTarget ? { targetPort } : {}),
  }));

/**
 * A command sequence over a given attribute value pool.
 *
 * Parameterised rather than duplicated, because the only difference between the
 * structural round trip and the one that goes through `JSON.stringify` is which
 * values may appear in a bag. The weights are the patch suite's, calibrated
 * there against its coverage guards: an even spread over the eleven kinds
 * leaves almost every edge call naming an endpoint that is not there.
 */
function sequences(values: readonly unknown[]): fc.Arbitrary<readonly Command[]> {
  const attrEntries: fc.Arbitrary<readonly Entry[]> = fc.uniqueArray(
    fc.tuple(fc.constantFrom(...ATTR_KEYS), fc.constantFrom(...values)),
    { maxLength: 3, selector: ([key]) => key },
  );
  const command: fc.Arbitrary<Command> = fc.oneof(
    {
      weight: 7,
      arbitrary: fc
        .record({ id: nodeId, attrs: attrEntries, ports: portInits })
        .map((fields): Command => ({ kind: 'add-node', ...fields })),
    },
    { weight: 1, arbitrary: fc.constant<Command>({ kind: 'add-node-generated' }) },
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
      weight: 6,
      arbitrary: fc
        .record({ id: edgeId, ports: portsPatch })
        .map((fields): Command => ({ kind: 'update-edge-ports', ...fields })),
    },
    {
      weight: 2,
      arbitrary: fc
        .record({ nodeId, portId })
        .map((fields): Command => ({ kind: 'remove-port', ...fields })),
    },
    {
      weight: 2,
      arbitrary: fc
        .record({ id: edgeId })
        .map((fields): Command => ({ kind: 'remove-edge', ...fields })),
    },
    {
      weight: 2,
      arbitrary: fc
        .record({ id: nodeId })
        .map((fields): Command => ({ kind: 'remove-node', ...fields })),
    },
  );
  // Long enough to build something up and take part of it apart again.
  // fast-check biases array length small, and a run of two calls exercises
  // none of the shapes the coverage guards below ask for.
  return fc.array(command, { minLength: 25, maxLength: 60 });
}

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
      case 'update-edge-ports':
        graph.updateEdgePorts(item.id, item.ports);
        return;
    }
  } catch (error) {
    // Duplicate, not-found, direction, and in-use rejections are part of the
    // exercise. Anything else is a real bug and must not be swallowed.
    if (!(error instanceof DagrGraphError)) throw error;
  }
}

/** A fresh graph with a sequence played onto it. */
function build(items: readonly Command[]): Graph {
  const graph = new Graph();
  for (const item of items) run(graph, item);
  return graph;
}

/**
 * Everything about a graph that insertion order is visible through, in order.
 *
 * Nothing is sorted anywhere, which is the whole point: a round trip that
 * restores the content and permutes the order would pass a normalised
 * comparison and is exactly the failure this suite exists to catch. The
 * topological order is included only where there is one, since a cyclic graph
 * has none and asking throws.
 *
 * The cycle witness is here because `topological` alone leaves a hole. Roughly
 * a third of the generated documents are cyclic, and for every one of those the
 * topological entry collapses to `null`, so without `cycle` the whole
 * walk-order-dependent half of the traversal surface goes uncompared on exactly
 * the graphs where it is hardest to get right. `findCycle` is ordered and its
 * answer depends on the order the walk visits in, which is what makes it worth
 * comparing rather than a restatement of `isAcyclic`.
 */
function ordering(graph: Graph): unknown {
  const nodes = graph.nodes().map((node) => node.id);
  return {
    nodes,
    edges: graph.edges().map((edge) => edge.id),
    ports: nodes.map((id) => graph.ports(id).map((port) => port.id)),
    successors: nodes.map((id) => graph.successors(id)),
    predecessors: nodes.map((id) => graph.predecessors(id)),
    sources: graph.sources(),
    sinks: graph.sinks(),
    topological: graph.isAcyclic() ? graph.topologicalOrder() : null,
    cycle: graph.findCycle() ?? null,
  };
}

/** What a run of sequences exercised, so a vacuous pass cannot go unnoticed. */
interface Coverage {
  /** Documents written. */
  documents: number;
  /** Nodes and edges written across all of them. */
  nodes: number;
  edges: number;
  /** Elements carrying a non-empty bag, and nodes carrying ports. */
  withAttrs: number;
  withPorts: number;
  /** Edges with at least one end bound to a port. */
  withBoundEnds: number;
  /** Bags carrying the `__proto__` key. */
  withProto: number;
  /** Documents whose node order is not the pool's own, so a re-add moved one. */
  reordered: number;
  /** Documents that were acyclic, and ones that were not. */
  acyclic: number;
  cyclic: number;
  /**
   * The two shapes `cyclic` alone does not distinguish, counted as edges.
   *
   * Almost every cyclic document here is cyclic because of a self loop, so
   * `cyclic` on its own is close to a self-loop counter wearing another name.
   * These two say which shape actually turned up, and the parallel-edge tally
   * covers one `cyclic` says nothing about at all: two edges between the same
   * ordered pair are the multi-digraph promise, and a round trip that collapsed
   * them would still be acyclic.
   */
  selfLoops: number;
  parallelEdges: number;
}

const emptyCoverage = (): Coverage => ({
  documents: 0,
  nodes: 0,
  edges: 0,
  withAttrs: 0,
  withPorts: 0,
  withBoundEnds: 0,
  withProto: 0,
  reordered: 0,
  acyclic: 0,
  cyclic: 0,
  selfLoops: 0,
  parallelEdges: 0,
});

/** Whether a listing is in ascending order, which the pools are generated in. */
function ascending(ids: readonly string[]): boolean {
  return ids.every((id, index) => index === 0 || (ids[index - 1] ?? '') <= id);
}

/** Records what one document says about the run. */
function tally(coverage: Coverage, graph: Graph, json: GraphJSON): void {
  coverage.documents += 1;
  coverage.nodes += json.nodes.length;
  coverage.edges += json.edges.length;
  if (graph.isAcyclic()) coverage.acyclic += 1;
  else coverage.cyclic += 1;
  if (!ascending(json.nodes.map((node) => node.id))) coverage.reordered += 1;
  const bags = [json.attrs, ...json.nodes.map((n) => n.attrs), ...json.edges.map((e) => e.attrs)];
  for (const held of bags) {
    if (held === undefined) continue;
    coverage.withAttrs += 1;
    if (Object.hasOwn(held, '__proto__')) coverage.withProto += 1;
  }
  for (const node of json.nodes) if (node.ports !== undefined) coverage.withPorts += 1;
  const pairs = new Set<string>();
  for (const edge of json.edges) {
    if (edge.sourcePort !== undefined || edge.targetPort !== undefined) {
      coverage.withBoundEnds += 1;
    }
    if (edge.source === edge.target) coverage.selfLoops += 1;
    // Counted as the edges beyond the first between a given ordered pair, so
    // the tally is what a round trip that collapsed them would lose.
    const pair = `${edge.source}\u0000${edge.target}`;
    if (pairs.has(pair)) coverage.parallelEdges += 1;
    else pairs.add(pair);
  }
}

function accumulate(total: Coverage, one: Coverage): void {
  total.documents += one.documents;
  total.nodes += one.nodes;
  total.edges += one.edges;
  total.withAttrs += one.withAttrs;
  total.withPorts += one.withPorts;
  total.withBoundEnds += one.withBoundEnds;
  total.withProto += one.withProto;
  total.reordered += one.reordered;
  total.acyclic += one.acyclic;
  total.cyclic += one.cyclic;
  total.selfLoops += one.selfLoops;
  total.parallelEdges += one.parallelEdges;
}

describe('serialization properties over random mutation sequences', () => {
  it('writes a document that rebuilds a graph writing the same document', () => {
    const total = emptyCoverage();
    fc.assert(
      fc.property(sequences(RICH_VALUES), (items) => {
        const source = build(items);
        const json = source.toJSON();
        const coverage = emptyCoverage();
        tally(coverage, source, json);
        accumulate(total, coverage);
        expect(Graph.fromJSON(json).toJSON()).toEqual(json);
      }),
      RUNS,
    );
    // Guards against a vacuous run: the sequences have to reach the shapes the
    // assertion is interesting on, or it would be holding over empty graphs.
    expect(total.documents).toBe(RUNS.numRuns);
    expect(total.nodes).toBeGreaterThan(400);
    expect(total.edges).toBeGreaterThan(100);
    expect(total.withAttrs).toBeGreaterThan(400);
    expect(total.withPorts).toBeGreaterThan(250);
    expect(total.withBoundEnds).toBeGreaterThan(40);
    expect(total.withProto).toBeGreaterThan(200);
    expect(total.reordered).toBeGreaterThan(80);
    expect(total.acyclic).toBeGreaterThan(80);
    expect(total.cyclic).toBeGreaterThan(40);
    // `cyclic` reads as a multi-node-cycle guard and is not one: only six of
    // the sixty-nine cyclic documents are cyclic without a self loop. These two
    // say which shapes the run really reached (measured: 72 self loops, 9
    // parallel edges), so a generator change that lost one is visible here.
    expect(total.selfLoops).toBeGreaterThan(40);
    expect(total.parallelEdges).toBeGreaterThan(4);
  });

  it('survives a real JSON.stringify and JSON.parse over JSON-safe values', () => {
    fc.assert(
      fc.property(sequences(JSON_VALUES), (items) => {
        const source = build(items);
        const json = source.toJSON();
        const parsed: unknown = JSON.parse(JSON.stringify(source));
        expect(Graph.fromJSON(parsed).toJSON()).toEqual(json);
      }),
      RUNS,
    );
  });

  it('restores every ordering insertion order is visible through', () => {
    fc.assert(
      fc.property(sequences(RICH_VALUES), (items) => {
        const source = build(items);
        expect(ordering(Graph.fromJSON(source.toJSON()))).toEqual(ordering(source));
      }),
      RUNS,
    );
  });

  /**
   * A restored graph is a different graph, so its records are different
   * objects. What has to survive is the rule M1.2 set: records are frozen
   * values, a lookup answers with the same object every time, and a merge that
   * changes nothing hands back the record already held.
   */
  it('rebuilds records that keep the copy-on-write identity rule', () => {
    fc.assert(
      fc.property(sequences(RICH_VALUES), (items) => {
        const source = build(items);
        const restored = Graph.fromJSON(source.toJSON());
        for (const node of restored.nodes()) {
          expect(Object.isFrozen(node)).toBe(true);
          expect(restored.getNode(node.id)).toBe(node);
          expect(restored.getNode(node.id)).not.toBe(source.getNode(node.id));
          // An empty patch, and a patch setting every key to the value it
          // already holds, are both "nothing happened" and must not rebuild.
          expect(restored.updateNodeAttrs(node.id, {})).toBe(node);
          expect(restored.updateNodeAttrs(node.id, { ...node.attrs })).toBe(node);
          expect(restored.ports(node.id)).toBe(node.ports);
        }
        for (const edge of restored.edges()) {
          expect(Object.isFrozen(edge)).toBe(true);
          expect(restored.getEdge(edge.id)).toBe(edge);
          expect(restored.updateEdgeAttrs(edge.id, {})).toBe(edge);
          expect(restored.updateEdgePorts(edge.id, {})).toBe(edge);
        }
      }),
      RUNS,
    );
  });
});
