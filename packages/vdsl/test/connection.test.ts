import { Graph, NodeNotFoundError } from '@dagr/graph';
import { describe, expect, it, vi } from 'vitest';
import { UnknownNodeKindError } from '../src/errors.js';
import { defineRegistry, sameType } from '../src/registry.js';
import type { ConnectionCheck, NodeRegistry } from '../src/types.js';

/**
 * A registry whose two kinds carry type tokens and a capped input, used by most
 * of the cases below. `sink` is deliberately `inout` at one end, because an
 * `inout` port is the only place the difference between "edges at a port" and
 * "edges leaving a port" is visible.
 */
function typed() {
  return defineRegistry({
    source: { ports: [{ id: 'out', direction: 'out', type: 'number' }] },
    filter: {
      ports: [
        { id: 'in', direction: 'in', maxEdges: 1, type: 'number' },
        { id: 'out', direction: 'out', type: 'text' },
      ],
    },
    sink: { ports: [{ id: 'io', direction: 'inout', maxEdges: 2 }] },
  });
}

/** A graph holding one node of each kind, built through the registry. */
function threeNodes(registry: ReturnType<typeof typed>) {
  const graph = new Graph();
  const a = graph.addNode(registry.nodeInit('source', { id: 'a' })).id;
  const b = graph.addNode(registry.nodeInit('filter', { id: 'b' })).id;
  const c = graph.addNode(registry.nodeInit('sink', { id: 'c' })).id;
  return { graph, a, b, c };
}

describe('checkPorts', () => {
  it('allows a declared out-to-in pair', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'source', portId: 'out' }, { kind: 'filter', portId: 'in' }),
    ).toEqual({ ok: true });
  });

  it('hands back one shared frozen result for every allowed pair', () => {
    const registry = typed();
    const first = registry.checkPorts(
      { kind: 'source', portId: 'out' },
      { kind: 'filter', portId: 'in' },
    );
    const second = registry.checkPorts(
      { kind: 'filter', portId: 'out' },
      { kind: 'sink', portId: 'io' },
    );
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('refuses a port the source kind does not declare', () => {
    const registry = typed();
    const result = registry.checkPorts(
      { kind: 'source', portId: 'nope' },
      { kind: 'filter', portId: 'in' },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'no-such-port' });
    expect(result.ok === false && result.reason).toContain('nope');
  });

  it('refuses a port the target kind does not declare', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'source', portId: 'out' }, { kind: 'filter', portId: 'nope' }),
    ).toMatchObject({ ok: false, code: 'no-such-port' });
  });

  it('refuses an in port as a source and an out port as a target', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'filter', portId: 'in' }, { kind: 'filter', portId: 'in' }),
    ).toMatchObject({ ok: false, code: 'wrong-direction' });
    expect(
      registry.checkPorts({ kind: 'source', portId: 'out' }, { kind: 'filter', portId: 'out' }),
    ).toMatchObject({ ok: false, code: 'wrong-direction' });
  });

  it('lets an inout port stand at either end', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'sink', portId: 'io' }, { kind: 'filter', portId: 'in' }),
    ).toEqual({ ok: true });
    expect(
      registry.checkPorts({ kind: 'source', portId: 'out' }, { kind: 'sink', portId: 'io' }),
    ).toEqual({ ok: true });
  });

  it('takes the first refusal, so an absent port is reported before a direction', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'filter', portId: 'nope' }, { kind: 'filter', portId: 'in' }),
    ).toMatchObject({ code: 'no-such-port' });
  });

  it('throws for a kind the registry does not hold', () => {
    const registry = typed();
    expect(() =>
      // @ts-expect-error a kind that was never declared is a compile error
      registry.checkPorts({ kind: 'ghost', portId: 'out' }, { kind: 'filter', portId: 'in' }),
    ).toThrow(UnknownNodeKindError);
  });
});

describe('canConnect', () => {
  it('is consulted at both ends, source first', () => {
    const calls: string[] = [];
    const registry = defineRegistry({
      a: {
        ports: [{ id: 'out', direction: 'out' }],
        canConnect: () => {
          calls.push('a');
          return undefined;
        },
      },
      b: {
        ports: [{ id: 'in', direction: 'in' }],
        canConnect: () => {
          calls.push('b');
          return undefined;
        },
      },
    });
    expect(registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' })).toEqual({
      ok: true,
    });
    expect(calls).toEqual(['a', 'b']);
  });

  it('carries the consumer own reason and stops at the first refusal', () => {
    const target = vi.fn<ConnectionCheck>(() => undefined);
    const registry = defineRegistry({
      a: {
        ports: [{ id: 'out', direction: 'out' }],
        canConnect: () => 'a never connects to anything',
      },
      b: { ports: [{ id: 'in', direction: 'in' }], canConnect: target },
    });
    expect(registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' })).toEqual({
      ok: false,
      code: 'incompatible',
      reason: 'a never connects to anything',
    });
    expect(target).not.toHaveBeenCalled();
  });

  it('is handed both ends, each with its kind and its resolved port', () => {
    const seen = vi.fn<ConnectionCheck>(() => undefined);
    const registry = defineRegistry({
      a: { ports: [{ id: 'out', direction: 'out', type: 'number' }], canConnect: seen },
      b: { ports: [{ id: 'in', direction: 'in' }] },
    });
    registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' });
    expect(seen).toHaveBeenCalledWith({
      source: { kind: 'a', port: { id: 'out', direction: 'out', type: 'number' } },
      target: { kind: 'b', port: { id: 'in', direction: 'in' } },
    });
  });

  it('is never consulted for a pair that was already refused', () => {
    const check = vi.fn<ConnectionCheck>(() => undefined);
    const registry = defineRegistry({
      a: { ports: [{ id: 'in', direction: 'in' }], canConnect: check },
      b: { ports: [{ id: 'in', direction: 'in' }] },
    });
    expect(
      registry.checkPorts({ kind: 'a', portId: 'in' }, { kind: 'b', portId: 'in' }),
    ).toMatchObject({ code: 'wrong-direction' });
    expect(check).not.toHaveBeenCalled();
  });

  it('is not on the spec the registry hands back, because it is about a pair', () => {
    const check: ConnectionCheck = () => undefined;
    const registry = defineRegistry({ a: { canConnect: check } });
    expect(Object.keys(registry.get('a'))).toEqual(['kind', 'ports']);
    expect(Object.isFrozen(registry.get('a'))).toBe(true);
  });

  it('leaves an unparameterised registry accepting one built from a literal', () => {
    // M6.1 shipped this property and a `canConnect` on `NodeSpec<K>` would
    // have taken it away, by making the spec invariant in `K`.
    const registry = defineRegistry({
      a: { ports: [{ id: 'out', direction: 'out' }], canConnect: () => undefined },
      b: { ports: [{ id: 'in', direction: 'in' }] },
    });
    const held: NodeRegistry = registry;
    expect(held.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' })).toEqual({
      ok: true,
    });
  });
});

describe('sameType', () => {
  it('refuses two tokens that differ and names both', () => {
    const registry = defineRegistry({
      a: { ports: [{ id: 'out', direction: 'out', type: 'number' }], canConnect: sameType },
      b: { ports: [{ id: 'in', direction: 'in', type: 'text' }] },
    });
    const result = registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' });
    expect(result).toMatchObject({ ok: false, code: 'incompatible' });
    expect(result.ok === false && result.reason).toContain('number');
    expect(result.ok === false && result.reason).toContain('text');
  });

  it('allows two tokens that match', () => {
    const registry = defineRegistry({
      a: { ports: [{ id: 'out', direction: 'out', type: 'number' }], canConnect: sameType },
      b: { ports: [{ id: 'in', direction: 'in', type: 'number' }] },
    });
    expect(registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' })).toEqual({
      ok: true,
    });
  });

  it('has no opinion when either end declares no token', () => {
    const registry = defineRegistry({
      a: { ports: [{ id: 'out', direction: 'out' }], canConnect: sameType },
      b: { ports: [{ id: 'in', direction: 'in', type: 'text' }] },
    });
    expect(registry.checkPorts({ kind: 'a', portId: 'out' }, { kind: 'b', portId: 'in' })).toEqual({
      ok: true,
    });
  });

  it('is not applied by a registry that did not ask for it', () => {
    const registry = typed();
    expect(
      registry.checkPorts({ kind: 'filter', portId: 'out' }, { kind: 'sink', portId: 'io' }),
    ).toEqual({ ok: true });
  });
});

describe('a type token at define time', () => {
  it('is refused when empty', () => {
    expect(() => defineRegistry({ a: { ports: [{ id: 'p', direction: 'out', type: '' }] } })).toThrow(
      /type/,
    );
  });

  it('is carried onto the frozen port', () => {
    const registry = typed();
    expect(registry.port('source', 'out')).toEqual({
      id: 'out',
      direction: 'out',
      type: 'number',
    });
  });

  it('is absent rather than undefined on a port that declares none', () => {
    const registry = typed();
    expect(Object.keys(registry.port('sink', 'io') ?? {})).toEqual(['id', 'direction', 'maxEdges']);
  });
});

describe('checkConnection', () => {
  it('answers everything checkPorts answers', () => {
    const registry = typed();
    const { graph, a, b } = threeNodes(registry);
    expect(
      registry.checkConnection(graph, {
        source: a,
        sourcePort: 'nope',
        target: b,
        targetPort: 'in',
      }),
    ).toMatchObject({ ok: false, code: 'no-such-port' });
  });

  it('allows a pair the graph has room for', () => {
    const registry = typed();
    const { graph, a, b } = threeNodes(registry);
    expect(
      registry.checkConnection(graph, { source: a, sourcePort: 'out', target: b, targetPort: 'in' }),
    ).toEqual({ ok: true });
  });

  it('refuses a target port already at its cap', () => {
    const registry = typed();
    const { graph, a, b, c } = threeNodes(registry);
    graph.addEdge({ source: a, target: b, sourcePort: 'out', targetPort: 'in' });
    const result = registry.checkConnection(graph, {
      source: c,
      sourcePort: 'io',
      target: b,
      targetPort: 'in',
    });
    expect(result).toMatchObject({ ok: false, code: 'port-full' });
    expect(result.ok === false && result.reason).toContain('1');
  });

  it('leaves an uncapped port alone however many edges it carries', () => {
    const registry = typed();
    const { graph, a, b, c } = threeNodes(registry);
    graph.addEdge({ source: a, target: b, sourcePort: 'out', targetPort: 'in' });
    graph.addEdge({ source: a, target: c, sourcePort: 'out', targetPort: 'io' });
    expect(
      registry.checkConnection(graph, { source: a, sourcePort: 'out', target: c, targetPort: 'io' }),
    ).toEqual({ ok: true });
  });

  it('counts edges at an inout port from both sides', () => {
    const registry = typed();
    const { graph, a, b, c } = threeNodes(registry);
    graph.addEdge({ source: a, target: c, sourcePort: 'out', targetPort: 'io' });
    expect(
      registry.checkConnection(graph, { source: c, sourcePort: 'io', target: b, targetPort: 'in' }),
    ).toEqual({ ok: true });
    graph.addEdge({ source: c, target: b, sourcePort: 'io', targetPort: 'in' });
    expect(
      registry.checkConnection(graph, { source: c, sourcePort: 'io', target: b, targetPort: 'in' }),
    ).toMatchObject({ ok: false, code: 'port-full' });
  });

  it('counts only the edges that name the port', () => {
    const registry = typed();
    const { graph, a, b } = threeNodes(registry);
    graph.addEdge({ source: a, target: b });
    expect(
      registry.checkConnection(graph, { source: a, sourcePort: 'out', target: b, targetPort: 'in' }),
    ).toEqual({ ok: true });
  });

  it('throws when an endpoint is not in the graph', () => {
    const registry = typed();
    const { graph, b } = threeNodes(registry);
    expect(() =>
      registry.checkConnection(graph, {
        source: 'ghost',
        sourcePort: 'out',
        target: b,
        targetPort: 'in',
      }),
    ).toThrow(NodeNotFoundError);
  });

  it('throws when an endpoint holds a kind the registry never declared', () => {
    const registry = typed();
    const { graph, b } = threeNodes(registry);
    const stray = graph.addNode({ attrs: { kind: 'ghost' }, ports: [{ id: 'out', direction: 'out' }] });
    expect(() =>
      registry.checkConnection(graph, {
        source: stray.id,
        sourcePort: 'out',
        target: b,
        targetPort: 'in',
      }),
    ).toThrow(UnknownNodeKindError);
  });
});

describe('cycle rejection', () => {
  it('is off by default, so a graph that permits cycles keeps permitting them', () => {
    const registry = typed();
    expect(registry.rejectsCycles).toBe(false);
    const { graph, a, b, c } = threeNodes(registry);
    // The first edge names no ports, so `in` is free and the only thing left
    // to refuse this pair for is the cycle it closes.
    graph.addEdge({ source: a, target: b });
    graph.addEdge({ source: b, target: c, sourcePort: 'out', targetPort: 'io' });
    expect(
      registry.checkConnection(graph, { source: c, sourcePort: 'io', target: b, targetPort: 'in' }),
    ).toEqual({ ok: true });
  });

  it('refuses an edge that closes a cycle when the adapter declares it', () => {
    const registry = defineRegistry(
      {
        step: {
          ports: [
            { id: 'in', direction: 'in' },
            { id: 'out', direction: 'out' },
          ],
        },
      },
      { rejectCycles: true },
    );
    expect(registry.rejectsCycles).toBe(true);
    const graph = new Graph();
    const a = graph.addNode(registry.nodeInit('step', { id: 'a' })).id;
    const b = graph.addNode(registry.nodeInit('step', { id: 'b' })).id;
    graph.addEdge({ source: a, target: b, sourcePort: 'out', targetPort: 'in' });
    expect(
      registry.checkConnection(graph, { source: b, sourcePort: 'out', target: a, targetPort: 'in' }),
    ).toMatchObject({ ok: false, code: 'would-cycle' });
    expect(
      registry.checkConnection(graph, { source: a, sourcePort: 'out', target: b, targetPort: 'in' }),
    ).toEqual({ ok: true });
  });

  it('refuses a self edge as the shortest cycle there is', () => {
    const registry = defineRegistry(
      {
        step: {
          ports: [
            { id: 'in', direction: 'in' },
            { id: 'out', direction: 'out' },
          ],
        },
      },
      { rejectCycles: true },
    );
    const graph = new Graph();
    const a = graph.addNode(registry.nodeInit('step', { id: 'a' })).id;
    expect(
      registry.checkConnection(graph, { source: a, sourcePort: 'out', target: a, targetPort: 'in' }),
    ).toMatchObject({ ok: false, code: 'would-cycle' });
  });

  it('adds nothing to the graph while answering', () => {
    const registry = defineRegistry(
      {
        step: {
          ports: [
            { id: 'in', direction: 'in' },
            { id: 'out', direction: 'out' },
          ],
        },
      },
      { rejectCycles: true },
    );
    const graph = new Graph();
    const a = graph.addNode(registry.nodeInit('step', { id: 'a' })).id;
    const b = graph.addNode(registry.nodeInit('step', { id: 'b' })).id;
    graph.addEdge({ source: a, target: b, sourcePort: 'out', targetPort: 'in' });
    const seen = vi.fn();
    graph.subscribe(seen);
    registry.checkConnection(graph, { source: b, sourcePort: 'out', target: a, targetPort: 'in' });
    expect(seen).not.toHaveBeenCalled();
    expect(graph.edgeCount).toBe(1);
  });

  it('is asked after the cap, so a full port is reported before a cycle', () => {
    const registry = defineRegistry(
      {
        step: {
          ports: [
            { id: 'in', direction: 'in', maxEdges: 1 },
            { id: 'out', direction: 'out' },
          ],
        },
      },
      { rejectCycles: true },
    );
    const graph = new Graph();
    const a = graph.addNode(registry.nodeInit('step', { id: 'a' })).id;
    const b = graph.addNode(registry.nodeInit('step', { id: 'b' })).id;
    graph.addEdge({ source: a, target: b, sourcePort: 'out', targetPort: 'in' });
    graph.addEdge({ source: b, target: a, sourcePort: 'out', targetPort: 'in' });
    expect(
      registry.checkConnection(graph, { source: b, sourcePort: 'out', target: a, targetPort: 'in' }),
    ).toMatchObject({ ok: false, code: 'port-full' });
  });
});
