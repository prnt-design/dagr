import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { DagrGraphError } from '../src/errors.js';
import type { Edge, EdgeId, Node, NodeId, Port } from '../src/types.js';

/**
 * Property-style coverage: random operation sequences, with the invariants
 * re-checked after every single call.
 *
 * The per-operation suites pin behaviour one call at a time. This one pins the
 * relationships that must hold no matter which calls came before, so a future
 * refactor of removal or of patch application cannot desynchronise the
 * adjacency indexes, the port index, or the freezing rules while staying
 * green. Randomness is seeded and the seeds are fixed, so any failure
 * reproduces exactly.
 *
 * There are three layers to what gets checked, and they catch different
 * things. The structural invariants prove the graph is self-consistent. The
 * shadow model proves the records hold exactly what this operation sequence
 * put there, which is the direction that catches a copy-on-write rebuild that
 * silently drops content. The identity contract proves the records that did
 * not change are the same objects they were, which is the direction that
 * catches a rebuild that changes nothing but invalidates everything.
 */

/** mulberry32, a 32-bit seeded PRNG. Deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The port ids an edge names, tracked with both keys always present. The
 * public argument type spells them optional, but `exactOptionalPropertyTypes`
 * makes an optional key awkward to build up incrementally, and the shadow only
 * ever needs "what is bound now", where an unbound end is honestly `undefined`.
 */
interface PortBinding {
  readonly sourcePort: string | undefined;
  readonly targetPort: string | undefined;
}

/**
 * What every live record must contain, tracked alongside the graph and never
 * read out of it.
 *
 * Walking only the records proves they agree with themselves, which any
 * rebuild that drops a whole attribute bag also satisfies. Comparing them
 * against a bag this file maintained itself is what turns "the record still
 * shows something" into "the record shows exactly what these calls put there".
 */
interface Shadow {
  readonly nodeAttrs: Map<NodeId, Record<string, unknown>>;
  readonly edgeAttrs: Map<EdgeId, Record<string, unknown>>;
  readonly edgePorts: Map<EdgeId, PortBinding>;
  graphAttrs: Record<string, unknown>;
}

/** The records a step started from, keyed by id, for the identity contract. */
interface Snapshot {
  readonly nodes: ReadonlyMap<NodeId, Node>;
  readonly edges: ReadonlyMap<EdgeId, Edge>;
}

/**
 * The merge the graph performs, done independently here. An explicit
 * `undefined` deletes, anything else stores, and a key the patch does not name
 * is left alone.
 */
function applyPatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    // Defined rather than assigned, for the same reason the graph does it: a
    // plain assignment of a `__proto__` key hits the inherited accessor and
    // reassigns this object's prototype instead of storing anything. The
    // shadow has to store what the graph stores, or the key pool below could
    // not include `__proto__` at all.
    else Object.defineProperty(next, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return next;
}

/**
 * The shadow entry for a live record. A miss means the shadow and the graph
 * disagree about which records exist, which is a bug in this file or in the
 * graph, so it throws a plain `Error`: the fuzz loop only swallows
 * `DagrGraphError`, so this cannot be mistaken for an expected rejection.
 */
function requireShadow<T>(index: ReadonlyMap<string, T>, id: string, what: string): T {
  const entry = index.get(id);
  if (entry === undefined) throw new Error(`shadow model has no ${what} for "${id}"`);
  return entry;
}

/** Whether two bags hold the same keys with the same values. */
function sameBag(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

/**
 * Whether two port listings hold the same port records in the same order.
 * Compared by identity rather than by content: a port record is only ever
 * built by a declaration, so two equal-looking records with different identity
 * mean a rebuild happened that should not have.
 */
function samePorts(left: readonly Port[], right: readonly Port[]): boolean {
  return left.length === right.length && left.every((port, index) => port === right[index]);
}

/** Everything that must be true of the graph after any operation. */
function checkInvariants(graph: Graph, shadow: Shadow, where: string): void {
  const nodes = graph.nodes();
  const edges = graph.edges();
  expect(nodes.length, `${where}: nodeCount`).toBe(graph.nodeCount);
  expect(edges.length, `${where}: edgeCount`).toBe(graph.edgeCount);

  for (const edge of edges) {
    // Every endpoint is a live node, and both indexes hold the edge.
    expect(graph.hasNode(edge.source), `${where}: source of ${edge.id}`).toBe(true);
    expect(graph.hasNode(edge.target), `${where}: target of ${edge.id}`).toBe(true);
    expect(graph.outEdges(edge.source), `${where}: outEdges of ${edge.source}`).toContain(edge);
    expect(graph.inEdges(edge.target), `${where}: inEdges of ${edge.target}`).toContain(edge);
  }

  // Every port an edge names still exists, on the right node, facing a way
  // that admits the end it was named for.
  for (const edge of edges) {
    if (edge.sourcePort !== undefined) {
      const port = graph.getPort(edge.source, edge.sourcePort);
      expect(port, `${where}: source port of ${edge.id}`).toBeDefined();
      expect(port?.direction, `${where}: direction of ${edge.source}.${edge.sourcePort}`).not.toBe(
        'in',
      );
    }
    if (edge.targetPort !== undefined) {
      const port = graph.getPort(edge.target, edge.targetPort);
      expect(port, `${where}: target port of ${edge.id}`).toBeDefined();
      expect(port?.direction, `${where}: direction of ${edge.target}.${edge.targetPort}`).not.toBe(
        'out',
      );
    }
  }

  // Records are frozen, bags never hold an undefined value, and the port
  // index and the record agree on content and on order.
  for (const record of [...nodes, ...edges]) {
    expect(Object.isFrozen(record), `${where}: frozen ${record.id}`).toBe(true);
    expect(Object.isFrozen(record.attrs), `${where}: frozen attrs of ${record.id}`).toBe(true);
    // A bag whose prototype moved is one that took a key as a prototype
    // assignment instead of as a property, so the attribute is gone and the
    // caller's keys read back through it.
    expect(
      Object.getPrototypeOf(record.attrs),
      `${where}: prototype of attrs of ${record.id}`,
    ).toBe(Object.prototype);
    for (const [key, value] of Object.entries(record.attrs)) {
      expect(value, `${where}: ${record.id}.${key} stored as undefined`).toBeDefined();
    }
  }
  expect(Object.getPrototypeOf(graph.attrs), `${where}: prototype of graph attrs`).toBe(
    Object.prototype,
  );
  for (const node of nodes) {
    expect(Object.isFrozen(node.ports), `${where}: frozen ports of ${node.id}`).toBe(true);
    expect(graph.ports(node.id), `${where}: ports array of ${node.id}`).toBe(node.ports);
    const seenPorts = new Set<string>();
    for (const port of node.ports) {
      expect(Object.isFrozen(port), `${where}: frozen port ${node.id}.${port.id}`).toBe(true);
      expect(seenPorts.has(port.id), `${where}: duplicate port ${node.id}.${port.id}`).toBe(false);
      seenPorts.add(port.id);
      expect(graph.hasPort(node.id, port.id), `${where}: hasPort ${node.id}.${port.id}`).toBe(true);
      expect(graph.getPort(node.id, port.id), `${where}: getPort ${node.id}.${port.id}`).toBe(port);
    }
    // Walking the record only proves the index holds everything the record
    // shows. Probing the whole candidate pool also proves the record shows
    // everything the index holds, which is the direction a copy-on-write
    // rebuild that forgets to carry the ports over would break.
    for (const candidate of PORT_POOL) {
      expect(
        graph.hasPort(node.id, candidate),
        `${where}: index and record disagree on ${node.id}.${candidate}`,
      ).toBe(node.ports.some((port) => port.id === candidate));
    }
  }

  checkShadow(graph, nodes, edges, shadow, where);

  let outTotal = 0;
  let inTotal = 0;
  for (const node of nodes) {
    const outgoing = graph.outEdges(node.id);
    const incoming = graph.inEdges(node.id);

    // Nothing foreign in either index.
    for (const edge of outgoing) {
      expect(edge.source, `${where}: ${edge.id} in outEdges of ${node.id}`).toBe(node.id);
      expect(graph.hasEdge(edge.id), `${where}: ${edge.id} still live`).toBe(true);
    }
    for (const edge of incoming) {
      expect(edge.target, `${where}: ${edge.id} in inEdges of ${node.id}`).toBe(node.id);
      expect(graph.hasEdge(edge.id), `${where}: ${edge.id} still live`).toBe(true);
    }

    // Degrees agree with the listings they summarise.
    expect(graph.outDegree(node.id), `${where}: outDegree of ${node.id}`).toBe(outgoing.length);
    expect(graph.inDegree(node.id), `${where}: inDegree of ${node.id}`).toBe(incoming.length);
    expect(graph.degree(node.id), `${where}: degree of ${node.id}`).toBe(
      outgoing.length + incoming.length,
    );
    outTotal += graph.outDegree(node.id);
    inTotal += graph.inDegree(node.id);

    // Neighbours are distinct, live, and in node insertion order.
    const order = nodes.map((candidate) => candidate.id);
    for (const side of [graph.successors(node.id), graph.predecessors(node.id)]) {
      expect(new Set(side).size, `${where}: duplicate neighbour of ${node.id}`).toBe(side.length);
      for (const neighbour of side) {
        expect(graph.hasNode(neighbour), `${where}: neighbour ${neighbour}`).toBe(true);
      }
      const ranks = side.map((neighbour) => order.indexOf(neighbour));
      expect(ranks, `${where}: neighbour order of ${node.id}`).toEqual(
        [...ranks].sort((left, right) => left - right),
      );
    }
  }

  // Every edge is counted exactly once from each side.
  expect(outTotal, `${where}: out-degree sum`).toBe(graph.edgeCount);
  expect(inTotal, `${where}: in-degree sum`).toBe(graph.edgeCount);
}

/**
 * Reconciles every live record against the shadow model, in both directions:
 * the record holds nothing the shadow does not, and the shadow holds nothing
 * the record does not. The graph-level bag is reconciled too, since it is
 * exercised by the sequence and would otherwise never be read back.
 */
function checkShadow(
  graph: Graph,
  nodes: readonly Node[],
  edges: readonly Edge[],
  shadow: Shadow,
  where: string,
): void {
  const nodeIds = nodes.map((node) => node.id).sort();
  const edgeIds = edges.map((edge) => edge.id).sort();
  expect([...shadow.nodeAttrs.keys()].sort(), `${where}: shadowed node ids`).toEqual(nodeIds);
  expect([...shadow.edgeAttrs.keys()].sort(), `${where}: shadowed edge ids`).toEqual(edgeIds);
  expect([...shadow.edgePorts.keys()].sort(), `${where}: shadowed port bindings`).toEqual(edgeIds);

  for (const node of nodes) {
    const expected = requireShadow(shadow.nodeAttrs, node.id, 'node attrs');
    expect(node.attrs, `${where}: attrs of node ${node.id}`).toEqual(expected);
    expect(expected, `${where}: attrs of node ${node.id}, reversed`).toEqual(node.attrs);
  }

  for (const edge of edges) {
    const expected = requireShadow(shadow.edgeAttrs, edge.id, 'edge attrs');
    expect(edge.attrs, `${where}: attrs of edge ${edge.id}`).toEqual(expected);
    expect(expected, `${where}: attrs of edge ${edge.id}, reversed`).toEqual(edge.attrs);

    // Compared as a pair with both ends always present, so an end the record
    // dropped reads as `undefined` against a shadow that still names a port
    // rather than skipping the check the way an `if (port !== undefined)`
    // guard would.
    const binding = requireShadow(shadow.edgePorts, edge.id, 'port binding');
    expect(
      { source: edge.sourcePort, target: edge.targetPort },
      `${where}: port bindings of edge ${edge.id}`,
    ).toEqual({ source: binding.sourcePort, target: binding.targetPort });
  }

  expect(graph.attrs, `${where}: graph attrs`).toEqual(shadow.graphAttrs);
  expect(shadow.graphAttrs, `${where}: graph attrs, reversed`).toEqual(graph.attrs);
}

/**
 * The copy-on-write identity contract, in both directions.
 *
 * A record whose content did not change must be the same object it was before
 * the step, so a rebuild that produces an identical record fails here. A record
 * whose content did change must be a different object, so an in-place mutation
 * fails here. Applying both to every live record rather than to the one the
 * step named is what catches collateral invalidation: an operation on one node
 * rebuilding another.
 */
function checkIdentity(before: Snapshot, graph: Graph, where: string): void {
  for (const node of graph.nodes()) {
    const previous = before.nodes.get(node.id);
    // Added by this step, so there is no previous identity to hold on to.
    if (previous === undefined) continue;
    const portsHeld = samePorts(previous.ports, node.ports);
    const unchanged = portsHeld && sameBag(previous.attrs, node.attrs);
    expect(node === previous, `${where}: identity of node ${node.id}`).toBe(unchanged);
    // The ports array keeps its identity whenever its content did, even when
    // the attributes changed: re-materialising it would invalidate every
    // consumer memoising on `node.ports`.
    if (portsHeld) expect(node.ports, `${where}: ports array of ${node.id}`).toBe(previous.ports);
  }

  for (const edge of graph.edges()) {
    const previous = before.edges.get(edge.id);
    if (previous === undefined) continue;
    const unchanged =
      previous.source === edge.source &&
      previous.target === edge.target &&
      previous.sourcePort === edge.sourcePort &&
      previous.targetPort === edge.targetPort &&
      sameBag(previous.attrs, edge.attrs);
    expect(edge === previous, `${where}: identity of edge ${edge.id}`).toBe(unchanged);
  }
}

const NODE_POOL = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const EDGE_POOL = ['x1', 'x2', 'x3'] as const;
const PORT_POOL = ['p1', 'p2', 'p3'] as const;
const DIRECTION_POOL = ['in', 'out', 'inout'] as const;
// `__proto__` is in the pool on purpose. It is the one key where storing and
// reading a bag can go wrong without any operation failing, so leaving it out
// made the prototype assertion in `checkInvariants` inert.
const ATTR_KEYS = ['label', 'width', 'weight', '__proto__'] as const;
/** `undefined` is in the pool on purpose: it is the delete form of a patch. */
const ATTR_VALUES = [1, 'x', true, undefined] as const;

/** What one seeded run exercised, so a vacuous run cannot pass unnoticed. */
interface Coverage {
  maxNodes: number;
  maxEdges: number;
  maxPorts: number;
  rebinds: number;
}

/** Runs a seeded operation sequence, checking everything after every step. */
function fuzz(seed: number, steps: number): Coverage {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => {
    const chosen = items[Math.floor(random() * items.length)];
    if (chosen === undefined) throw new Error('empty pool');
    return chosen;
  };

  // `pick` treats `undefined` as an empty pool, and an attribute value of
  // `undefined` is exactly the delete form this wants to exercise, so values
  // are drawn by index instead. The same goes for an unbound port end.
  const pickValue = (): unknown => ATTR_VALUES[Math.floor(random() * ATTR_VALUES.length)];
  const pickPort = (): string | undefined =>
    [...PORT_POOL, undefined][Math.floor(random() * (PORT_POOL.length + 1))];
  const patch = (): Record<string, unknown> => ({ [pick(ATTR_KEYS)]: pickValue() });
  const anyEdgeId = (): string => pick([...EDGE_POOL, ...graph.edges().map((edge) => edge.id)]);

  // A port drawn from what a node actually declares, most of the time. Drawing
  // blindly from the pool makes almost every rebinding a rejection, which
  // exercises the validation but never the rebinding itself.
  const pickPortOn = (nodeId: string | undefined): string | undefined => {
    const declared = nodeId !== undefined && graph.hasNode(nodeId) ? graph.ports(nodeId) : [];
    if (declared.length === 0 || random() < 0.15) return pickPort();
    return declared[Math.floor(random() * declared.length)]?.id;
  };

  const graph = new Graph();
  const shadow: Shadow = {
    nodeAttrs: new Map(),
    edgeAttrs: new Map(),
    edgePorts: new Map(),
    graphAttrs: {},
  };
  const coverage: Coverage = { maxNodes: 0, maxEdges: 0, maxPorts: 0, rebinds: 0 };

  for (let step = 0; step < steps; step += 1) {
    const before: Snapshot = {
      nodes: new Map(graph.nodes().map((node) => [node.id, node])),
      edges: new Map(graph.edges().map((edge) => [edge.id, edge])),
    };
    const roll = random();
    try {
      if (roll < 0.2) {
        const node = graph.addNode(pick(NODE_POOL));
        shadow.nodeAttrs.set(node.id, {});
      } else if (roll < 0.26) {
        const attrs = patch();
        const node = graph.addNode({
          id: pick(NODE_POOL),
          attrs,
          ports: [{ id: pick(PORT_POOL), direction: pick(DIRECTION_POOL) }],
        });
        shadow.nodeAttrs.set(node.id, applyPatch({}, attrs));
      } else if (roll < 0.3) {
        const node = graph.addNode();
        shadow.nodeAttrs.set(node.id, {});
      } else if (roll < 0.43) {
        const edge = graph.addEdge(pick(NODE_POOL), pick(NODE_POOL));
        shadow.edgeAttrs.set(edge.id, {});
        shadow.edgePorts.set(edge.id, { sourcePort: undefined, targetPort: undefined });
      } else if (roll < 0.51) {
        const attrs = patch();
        const sourcePort = pick(PORT_POOL);
        const targetPort = pick(PORT_POOL);
        const edge = graph.addEdge({
          source: pick(NODE_POOL),
          target: pick(NODE_POOL),
          attrs,
          sourcePort,
          targetPort,
        });
        shadow.edgeAttrs.set(edge.id, applyPatch({}, attrs));
        shadow.edgePorts.set(edge.id, { sourcePort, targetPort });
      } else if (roll < 0.56) {
        const edge = graph.addEdge(pick(NODE_POOL), pick(NODE_POOL), pick(EDGE_POOL));
        shadow.edgeAttrs.set(edge.id, {});
        shadow.edgePorts.set(edge.id, { sourcePort: undefined, targetPort: undefined });
      } else if (roll < 0.63) {
        const id = pick(NODE_POOL);
        const applied = patch();
        graph.updateNodeAttrs(id, applied);
        shadow.nodeAttrs.set(id, applyPatch(requireShadow(shadow.nodeAttrs, id, 'node'), applied));
      } else if (roll < 0.69) {
        const id = anyEdgeId();
        const applied = patch();
        graph.updateEdgeAttrs(id, applied);
        shadow.edgeAttrs.set(id, applyPatch(requireShadow(shadow.edgeAttrs, id, 'edge'), applied));
      } else if (roll < 0.73) {
        const applied = patch();
        graph.updateAttrs(applied);
        shadow.graphAttrs = applyPatch(shadow.graphAttrs, applied);
      } else if (roll < 0.82) {
        // Each end is named or left out independently, so the "absent key
        // leaves that end alone" branch is exercised as well as the explicit
        // `undefined` that detaches one.
        const id = anyEdgeId();
        const bound = graph.getEdge(id);
        const namesSource = random() < 0.75;
        const namesTarget = random() < 0.75;
        const sourcePort = pickPortOn(bound?.source);
        const targetPort = pickPortOn(bound?.target);
        const rebound = graph.updateEdgePorts(id, {
          ...(namesSource ? { sourcePort } : {}),
          ...(namesTarget ? { targetPort } : {}),
        });
        const held = requireShadow(shadow.edgePorts, id, 'port binding');
        shadow.edgePorts.set(id, {
          sourcePort: namesSource ? sourcePort : held.sourcePort,
          targetPort: namesTarget ? targetPort : held.targetPort,
        });
        if (rebound !== before.edges.get(id)) coverage.rebinds += 1;
      } else if (roll < 0.88) {
        graph.addPort(pick(NODE_POOL), { id: pick(PORT_POOL), direction: pick(DIRECTION_POOL) });
      } else if (roll < 0.92) {
        graph.removePort(pick(NODE_POOL), pick(PORT_POOL));
      } else if (roll < 0.97) {
        const id = anyEdgeId();
        graph.removeEdge(id);
        shadow.edgeAttrs.delete(id);
        shadow.edgePorts.delete(id);
      } else {
        const id = pick(NODE_POOL);
        // Collected before the call, since the incident edges go with the node
        // and the adjacency listings stop answering once it is gone.
        const incident = graph.hasNode(id)
          ? [...graph.outEdges(id), ...graph.inEdges(id)].map((edge) => edge.id)
          : [];
        graph.removeNode(id);
        shadow.nodeAttrs.delete(id);
        for (const edgeId of incident) {
          shadow.edgeAttrs.delete(edgeId);
          shadow.edgePorts.delete(edgeId);
        }
      }
    } catch (error) {
      // Duplicate, not-found, direction, and in-use rejections are part of the
      // exercise, and a rejected call changes neither the graph nor the shadow.
      // Anything else is a real bug and must not be swallowed.
      if (!(error instanceof DagrGraphError)) throw error;
    }
    const where = `seed ${String(seed)} step ${String(step)}`;
    checkInvariants(graph, shadow, where);
    checkIdentity(before, graph, where);
    coverage.maxNodes = Math.max(coverage.maxNodes, graph.nodeCount);
    coverage.maxEdges = Math.max(coverage.maxEdges, graph.edgeCount);
    for (const node of graph.nodes()) {
      coverage.maxPorts = Math.max(coverage.maxPorts, node.ports.length);
    }
  }

  return coverage;
}

describe('Graph invariants under random operation sequences', () => {
  for (const seed of [1, 2, 42, 1337, 20260726]) {
    it(`holds for seed ${String(seed)}`, () => {
      const coverage = fuzz(seed, 400);
      // Guard against a vacuous run: the sequence must actually build a graph,
      // ports and rebindings included, or the checks above would pass on an
      // empty one.
      expect(coverage.maxNodes).toBeGreaterThan(3);
      expect(coverage.maxEdges).toBeGreaterThan(5);
      expect(coverage.maxPorts).toBeGreaterThan(1);
      expect(coverage.rebinds).toBeGreaterThan(0);
    });
  }

  it('replays a seed identically', () => {
    expect(fuzz(7, 200)).toEqual(fuzz(7, 200));
  });
});
