import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { apply, invert } from '../src/patch.js';
import type { Patch, PatchOp } from '../src/patch.js';
import { DagrGraphError } from '../src/errors.js';
import type { EdgePortsPatch, PortDirection, PortInit } from '../src/types.js';

/**
 * Property coverage for patches, over random mutation sequences.
 *
 * The per-operation suites pin one call at a time. This one pins the four
 * relationships that have to hold for a patch log to be worth anything:
 * replaying it rebuilds the graph, inverting it undoes it, inverting twice is
 * the identity, and a patch is emitted exactly when something changed. Every
 * run is seeded, so a failure reproduces exactly, and the seed is printed by
 * fast-check with the counterexample.
 */

const RUNS = { seed: 20260726, numRuns: 250 } as const;

const NODE_POOL = ['a', 'b', 'c'] as const;
const EDGE_POOL = ['x1', 'x2', 'x3'] as const;
const PORT_POOL = ['p1', 'p2', 'p3'] as const;
// `inout` twice on purpose. A port that faces one way refuses one of the two
// ends, and with an even split most generated bindings would be rejections, so
// the sequences would exercise the validation and never the rebinding.
const DIRECTIONS: readonly PortDirection[] = ['in', 'out', 'inout', 'inout', 'inout'];
// `__proto__` is in the pool for the same reason the invariants suite keeps it
// there: it is the one key where storing and reading a bag can go wrong without
// any call failing, and a patch has two more bags to get it wrong in.
const ATTR_KEYS = ['label', 'width', 'weight', '__proto__'] as const;
/** `undefined` is in the pool on purpose: it is the delete form of a patch. */
const ATTR_VALUES = [1, 'x', true, undefined] as const;

/** A patch bag as generated: entries, so an explicit `undefined` survives. */
type Entry = readonly [string, unknown];

/**
 * A patch bag built from generated entries.
 *
 * Defined rather than assigned, for the same reason the graph itself defines:
 * a plain assignment of a `__proto__` key hits the inherited accessor and
 * reassigns this object's prototype instead of storing anything, and the key
 * pool above includes `__proto__`.
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
  | { readonly kind: 'update-graph-attrs'; readonly attrs: readonly Entry[] }
  | { readonly kind: 'update-edge-ports'; readonly id: string; readonly ports: EdgePortsPatch };

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
/** An end that names a port, or one left unbound. Even odds between the two. */
const boundPort = fc.option(portId, { nil: undefined, freq: 2 });

/** Up to three distinct keys, each at a value that may be the delete form. */
const attrEntries: fc.Arbitrary<readonly Entry[]> = fc.uniqueArray(
  fc.tuple(fc.constantFrom(...ATTR_KEYS), fc.constantFrom(...ATTR_VALUES)),
  { maxLength: 3, selector: ([key]) => key },
);

/**
 * A port rebinding. Each end is named or left out independently, so the
 * "absent key leaves that end alone" branch is generated as well as the
 * explicit `undefined` that detaches one.
 */
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

const command: fc.Arbitrary<Command> = fc.oneof(
  // Weighted towards the calls that build a graph up, and the weights are
  // calibrated rather than guessed: the coverage guards on the first property
  // below report what a run actually exercised, and an even spread over these
  // eleven kinds leaves almost every edge call naming an endpoint that is not
  // there, so the sequences reject constantly and never reach a cascade or a
  // rebinding. Rejections are worth having, they are just not worth having
  // instead of everything else.
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
    arbitrary: fc.record({ id: edgeId }).map((fields): Command => ({ kind: 'remove-edge', ...fields })),
  },
  {
    weight: 2,
    arbitrary: fc.record({ id: nodeId }).map((fields): Command => ({ kind: 'remove-node', ...fields })),
  },
);

/**
 * A sequence long enough to build something and then take it apart again. The
 * lower bound is not decoration: fast-check biases array length small, and a
 * run of two calls exercises none of the shapes the coverage guards below ask
 * for.
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
      case 'update-edge-ports':
        graph.updateEdgePorts(item.id, item.ports);
        return;
    }
  } catch (error) {
    // Duplicate, not-found, direction, and in-use rejections are part of the
    // exercise, and a rejected call must change nothing and emit nothing.
    // Anything else is a real bug and must not be swallowed.
    if (!(error instanceof DagrGraphError)) throw error;
  }
}

/** A bag as sorted entries, so two bags compare on keys and values alone. */
function bagOf(attrs: object): readonly Entry[] {
  const entries: [string, unknown][] = Object.entries(attrs);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

/**
 * The graph's content, normalised.
 *
 * Nodes, edges, and each node's ports are sorted by id, and attribute bags are
 * sorted entry lists. Insertion order is deliberately not part of this, in any
 * of the three places it exists: node order, edge order, and port declaration
 * order. `apply` replays through the public API, so a restored element is a new
 * insertion and lands at the end of its listing, exactly as it would if a
 * caller had re-added it. Comparing content is therefore the strongest claim
 * replay and inversion can make, and pretending otherwise would only pin a
 * promise the module does not make. An unbound port end is normalised to `null`
 * rather than left `undefined`, so a comparison cannot quietly ignore it.
 */
function snapshot(graph: Graph): unknown {
  return {
    attrs: bagOf(graph.attrs),
    nodes: [...graph.nodes()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        attrs: bagOf(node.attrs),
        ports: [...node.ports]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((port) => ({ id: port.id, direction: port.direction })),
      })),
    edges: [...graph.edges()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        attrs: bagOf(edge.attrs),
        sourcePort: edge.sourcePort ?? null,
        targetPort: edge.targetPort ?? null,
      })),
  };
}

/** The snapshot as a string, for the "did anything change" question. */
function serialise(graph: Graph): string {
  return JSON.stringify(snapshot(graph));
}

/** What a sequence exercised, so a vacuous run cannot pass unnoticed. */
interface Coverage {
  /** Patches emitted. */
  patches: number;
  /** Multi-op patches, which today means a `removeNode` that took edges. */
  cascades: number;
  /** Rebindings that actually moved an end. */
  rebinds: number;
  /** Ports removed. */
  portRemovals: number;
  /** Attribute updates that deleted a key rather than storing one. */
  deletes: number;
  /** Calls that left the graph as it was: rejections, and no-op merges. */
  unchanged: number;
}

const emptyCoverage = (): Coverage => ({
  patches: 0,
  cascades: 0,
  rebinds: 0,
  portRemovals: 0,
  deletes: 0,
  unchanged: 0,
});

/** Records what one op says about the run, for the coverage guards. */
function tally(coverage: Coverage, patch: Patch): void {
  coverage.patches += 1;
  if (patch.length > 1) coverage.cascades += 1;
  for (const op of patch) {
    if (op.op === 'update-edge-ports') coverage.rebinds += 1;
    if (op.op === 'remove-port') coverage.portRemovals += 1;
    if (op.op === 'update-node-attrs' || op.op === 'update-edge-attrs') {
      const entries: [string, unknown][] = Object.entries(op.patch);
      if (entries.some(([, value]) => value === undefined)) coverage.deletes += 1;
    }
  }
}

/**
 * The normalisation rule an emitted update op has to keep: `patch` and `before`
 * name the same keys, and every one of those keys really moved. This is what
 * makes inverting a swap of the two bags, and it is not something the content
 * properties below can see, since a patch carrying extra unchanged keys applies
 * to the same content.
 */
function checkNormalised(op: PatchOp): void {
  if (
    op.op !== 'update-node-attrs' &&
    op.op !== 'update-edge-attrs' &&
    op.op !== 'update-graph-attrs' &&
    op.op !== 'update-edge-ports'
  ) {
    return;
  }
  const patched: [string, unknown][] = Object.entries(op.patch);
  const prior: [string, unknown][] = Object.entries(op.before);
  const patchedKeys = patched.map(([key]) => key).sort();
  expect(patchedKeys, `${op.op}: patch and before name different keys`).toEqual(
    prior.map(([key]) => key).sort(),
  );
  const priorByKey = new Map(prior);
  for (const [key, value] of patched) {
    expect(
      Object.is(value, priorByKey.get(key)),
      `${op.op}: key "${key}" is named but did not change`,
    ).toBe(false);
  }
}

/** Runs a command sequence on a fresh graph, recording every patch emitted. */
function record(items: readonly Command[]): { graph: Graph; log: Patch[]; coverage: Coverage } {
  const graph = new Graph();
  const log: Patch[] = [];
  const coverage = emptyCoverage();
  graph.subscribe((patch) => {
    tally(coverage, patch);
    for (const op of patch) checkNormalised(op);
    log.push(patch);
  });
  for (const item of items) {
    const before = serialise(graph);
    const emitted = log.length;
    run(graph, item);
    if (log.length === emitted && serialise(graph) === before) coverage.unchanged += 1;
  }
  return { graph, log, coverage };
}

/** Sums the coverage of every run, so the guards can be asserted once. */
function accumulate(total: Coverage, one: Coverage): void {
  total.patches += one.patches;
  total.cascades += one.cascades;
  total.rebinds += one.rebinds;
  total.portRemovals += one.portRemovals;
  total.deletes += one.deletes;
  total.unchanged += one.unchanged;
}

describe('patch properties over random mutation sequences', () => {
  it('replays a recorded log onto an empty graph to the same content', () => {
    const total = emptyCoverage();
    fc.assert(
      fc.property(commands, (items) => {
        const { graph, log, coverage } = record(items);
        accumulate(total, coverage);
        const replay = new Graph();
        for (const patch of log) apply(replay, patch);
        expect(snapshot(replay)).toEqual(snapshot(graph));
      }),
      RUNS,
    );
    // Guards against a vacuous run: the sequences have to actually exercise
    // the interesting shapes, or the assertion above would hold on nothing.
    expect(total.patches).toBeGreaterThan(1500);
    expect(total.cascades).toBeGreaterThan(40);
    expect(total.rebinds).toBeGreaterThan(25);
    expect(total.portRemovals).toBeGreaterThan(75);
    expect(total.deletes).toBeGreaterThan(35);
    expect(total.unchanged).toBeGreaterThan(1000);
  });

  it('restores the content when the inverse follows the patch', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const { log } = record(items);
        const replay = new Graph();
        for (const patch of log) {
          const before = snapshot(replay);
          apply(replay, patch);
          apply(replay, invert(patch));
          expect(snapshot(replay)).toEqual(before);
          // Then advance, so the next patch meets the state it was recorded
          // against rather than the one it was rolled back to.
          apply(replay, patch);
        }
      }),
      RUNS,
    );
  });

  it('unwinds a whole log back to an empty graph', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const { log } = record(items);
        const replay = new Graph();
        const flat = log.flat();
        apply(replay, flat);
        apply(replay, invert(flat));
        expect(snapshot(replay)).toEqual(snapshot(new Graph()));
      }),
      RUNS,
    );
  });

  it('inverts twice back to the patch it started from', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const { log } = record(items);
        for (const patch of log) expect(invert(invert(patch))).toStrictEqual(patch);
        const flat = log.flat();
        expect(invert(invert(flat))).toStrictEqual(flat);
      }),
      RUNS,
    );
  });

  it('emits a patch exactly when the content changes', () => {
    fc.assert(
      fc.property(commands, (items) => {
        const graph = new Graph();
        let emitted = 0;
        graph.subscribe(() => {
          emitted += 1;
        });
        for (const item of items) {
          const before = serialise(graph);
          const emittedBefore = emitted;
          run(graph, item);
          expect(emitted > emittedBefore, `${item.kind}: emission and change disagree`).toBe(
            serialise(graph) !== before,
          );
        }
      }),
      RUNS,
    );
  });
});
