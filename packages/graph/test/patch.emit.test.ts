import { describe, expect, it, vi } from 'vitest';
import { Graph } from '../src/graph.js';
import type { Patch } from '../src/patch.js';

/** A graph that records every patch it emits, and the log it records into. */
function watched(): { graph: Graph; patches: Patch[] } {
  const graph = new Graph();
  const patches: Patch[] = [];
  graph.subscribe((patch) => patches.push(patch));
  return { graph, patches };
}

/** The single patch a mutation emitted, failing the test if it emitted none. */
function only(patches: Patch[]): Patch {
  expect(patches).toHaveLength(1);
  const patch = patches[0];
  if (patch === undefined) throw new Error('no patch was emitted');
  return patch;
}

describe('Graph patch emission for nodes', () => {
  it('emits an add-node op carrying the attributes and ports', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p', direction: 'out' }] });
    expect(only(patches)).toStrictEqual([
      {
        op: 'add-node',
        id: 'a',
        attrs: { label: 'A' },
        ports: [{ id: 'p', direction: 'out' }],
      },
    ]);
  });

  it('emits the generated id rather than nothing', () => {
    const { graph, patches } = watched();
    graph.addNode();
    expect(only(patches)).toStrictEqual([{ op: 'add-node', id: 'n1', attrs: {}, ports: [] }]);
  });

  it('reuses the frozen bag and port array the record already carries', () => {
    const { graph, patches } = watched();
    const node = graph.addNode({ id: 'a', ports: [{ id: 'p' }] });
    const op = only(patches)[0];
    expect(op?.op).toBe('add-node');
    if (op?.op !== 'add-node') throw new Error('expected an add-node op');
    expect(op.attrs).toBe(node.attrs);
    expect(op.ports).toBe(node.ports);
  });

  it('emits a remove-node op carrying what it took away', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p', direction: 'in' }] });
    patches.length = 0;
    graph.removeNode('a');
    expect(only(patches)).toStrictEqual([
      {
        op: 'remove-node',
        id: 'a',
        attrs: { label: 'A' },
        ports: [{ id: 'p', direction: 'in' }],
      },
    ]);
  });

  it('emits nothing when a call is rejected', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    patches.length = 0;
    expect(() => graph.addNode('a')).toThrow();
    expect(() => graph.addNode('')).toThrow();
    expect(() => graph.removeNode('nope')).toThrow();
    expect(() => graph.addNode({ id: 'b', ports: [{ id: 'p' }, { id: 'p' }] })).toThrow();
    expect(patches).toHaveLength(0);
  });

  it('freezes the patch and every op in it', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    const patch = only(patches);
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch[0])).toBe(true);
  });
});

describe('Graph patch emission for edges', () => {
  it('emits an add-edge op with the endpoints, attributes, and bound ports', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'out', direction: 'out' }] });
    graph.addNode({ id: 'b', ports: [{ id: 'in', direction: 'in' }] });
    patches.length = 0;
    graph.addEdge({
      source: 'a',
      target: 'b',
      id: 'ab',
      attrs: { weight: 2 },
      sourcePort: 'out',
      targetPort: 'in',
    });
    expect(only(patches)).toStrictEqual([
      {
        op: 'add-edge',
        id: 'ab',
        source: 'a',
        target: 'b',
        attrs: { weight: 2 },
        sourcePort: 'out',
        targetPort: 'in',
      },
    ]);
  });

  it('leaves an unbound end out of the op rather than storing undefined', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    graph.addNode('b');
    patches.length = 0;
    graph.addEdge('a', 'b', 'ab');
    const op = only(patches)[0];
    expect(op).toStrictEqual({ op: 'add-edge', id: 'ab', source: 'a', target: 'b', attrs: {} });
    expect(Object.hasOwn(op ?? {}, 'sourcePort')).toBe(false);
    expect(Object.hasOwn(op ?? {}, 'targetPort')).toBe(false);
  });

  it('emits a remove-edge op carrying everything needed to declare it again', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'p' }] });
    graph.addNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { weight: 1 }, sourcePort: 'p' });
    patches.length = 0;
    graph.removeEdge('ab');
    expect(only(patches)).toStrictEqual([
      {
        op: 'remove-edge',
        id: 'ab',
        source: 'a',
        target: 'b',
        attrs: { weight: 1 },
        sourcePort: 'p',
      },
    ]);
  });

  it('emits nothing when an edge call is rejected', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    graph.addEdge('a', 'a', 'loop');
    patches.length = 0;
    expect(() => graph.addEdge('a', 'nope')).toThrow();
    expect(() => graph.addEdge('a', 'a', 'loop')).toThrow();
    expect(() => graph.addEdge({ source: 'a', target: 'a', sourcePort: 'nope' })).toThrow();
    expect(() => graph.removeEdge('nope')).toThrow();
    expect(patches).toHaveLength(0);
  });
});

describe('Graph patch emission for the removeNode cascade', () => {
  /** Three nodes, with every kind of edge incident to the middle one. */
  function fan(): { graph: Graph; patches: Patch[] } {
    const { graph, patches } = watched();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('b', 'c', 'out1');
    graph.addEdge('a', 'b', 'in1');
    graph.addEdge('b', 'b', 'loop');
    graph.addEdge('b', 'c', 'out2');
    patches.length = 0;
    return { graph, patches };
  }

  it('emits one patch holding the edge ops first and the node op last', () => {
    const { graph, patches } = fan();
    graph.removeNode('b');
    const patch = only(patches);
    expect(patch.map((op) => [op.op, 'id' in op ? op.id : ''])).toEqual([
      ['remove-edge', 'out1'],
      ['remove-edge', 'loop'],
      ['remove-edge', 'out2'],
      ['remove-edge', 'in1'],
      ['remove-node', 'b'],
    ]);
  });

  it('names a self loop once, even though detachment visits it twice', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    graph.addEdge('a', 'a', 'loop');
    patches.length = 0;
    graph.removeNode('a');
    expect(only(patches).map((op) => op.op)).toEqual(['remove-edge', 'remove-node']);
  });

  it('emits a single-op patch for a node with no edges', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    patches.length = 0;
    graph.removeNode('a');
    expect(only(patches).map((op) => op.op)).toEqual(['remove-node']);
  });
});

describe('Graph patch emission for ports', () => {
  it('emits an add-port op with the position the port took', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'p1' }] });
    patches.length = 0;
    graph.addPort('a', { id: 'p2', direction: 'out' });
    expect(only(patches)).toStrictEqual([
      { op: 'add-port', nodeId: 'a', port: { id: 'p2', direction: 'out' }, index: 1 },
    ]);
  });

  it('defaults the direction in the op the way the record does', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    patches.length = 0;
    const node = graph.addPort('a', { id: 'p1' });
    const op = only(patches)[0];
    if (op?.op !== 'add-port') throw new Error('expected an add-port op');
    expect(op.port).toStrictEqual({ id: 'p1', direction: 'inout' });
    expect(op.port).toBe(node.ports[0]);
  });

  it('emits a remove-port op with the position the port sat at', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'p1' }, { id: 'p2', direction: 'in' }, { id: 'p3' }] });
    patches.length = 0;
    graph.removePort('a', 'p2');
    expect(only(patches)).toStrictEqual([
      { op: 'remove-port', nodeId: 'a', port: { id: 'p2', direction: 'in' }, index: 1 },
    ]);
  });

  it('emits nothing when a port call is rejected', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'p1' }] });
    graph.addNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'p1' });
    patches.length = 0;
    expect(() => graph.addPort('a', { id: 'p1' })).toThrow();
    expect(() => graph.addPort('nope', { id: 'p9' })).toThrow();
    expect(() => graph.addPort('a', { id: '' })).toThrow();
    expect(() => graph.removePort('a', 'p9')).toThrow();
    expect(() => graph.removePort('a', 'p1')).toThrow();
    expect(patches).toHaveLength(0);
  });
});

describe('Graph patch emission for attribute updates', () => {
  it('emits an update-node-attrs op with the new values and the prior ones', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    patches.length = 0;
    graph.updateNodeAttrs('a', { label: 'B', width: 4 });
    expect(only(patches)).toStrictEqual([
      {
        op: 'update-node-attrs',
        id: 'a',
        after: { label: 'B', width: 4 },
        before: { label: 'A', width: undefined },
      },
    ]);
  });

  it('normalises both bags down to the keys that actually changed', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { one: 1, two: 2, three: 3, four: 4 } });
    patches.length = 0;
    // Five keys named, one of them a delete of a key that is not there, and
    // only `three` is a real change.
    graph.updateNodeAttrs('a', { one: 1, two: 2, three: 30, four: 4, five: undefined });
    expect(only(patches)).toStrictEqual([
      { op: 'update-node-attrs', id: 'a', after: { three: 30 }, before: { three: 3 } },
    ]);
  });

  it('spells an absent prior value as a key present and undefined', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    patches.length = 0;
    graph.updateNodeAttrs('a', { label: 'A' });
    const op = only(patches)[0];
    if (op?.op !== 'update-node-attrs') throw new Error('expected an update-node-attrs op');
    expect(Object.hasOwn(op.before, 'label')).toBe(true);
    expect(op.before.label).toBeUndefined();
  });

  it('spells a delete as a key present and undefined in the after bag', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    patches.length = 0;
    graph.updateNodeAttrs('a', { label: undefined });
    const op = only(patches)[0];
    if (op?.op !== 'update-node-attrs') throw new Error('expected an update-node-attrs op');
    expect(Object.hasOwn(op.after, 'label')).toBe(true);
    expect(op.after.label).toBeUndefined();
    expect(op.before).toStrictEqual({ label: 'A' });
  });

  it('emits nothing when the merge changes nothing', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    patches.length = 0;
    graph.updateNodeAttrs('a', {});
    graph.updateNodeAttrs('a', { label: 'A' });
    graph.updateNodeAttrs('a', { width: undefined });
    expect(patches).toHaveLength(0);
  });

  it('emits nothing when the node is unknown', () => {
    const { graph, patches } = watched();
    expect(() => graph.updateNodeAttrs('nope', { label: 'A' })).toThrow();
    expect(patches).toHaveLength(0);
  });

  it('freezes both bags in the op', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    patches.length = 0;
    graph.updateNodeAttrs('a', { label: 'A' });
    const op = only(patches)[0];
    if (op?.op !== 'update-node-attrs') throw new Error('expected an update-node-attrs op');
    expect(Object.isFrozen(op.after)).toBe(true);
    expect(Object.isFrozen(op.before)).toBe(true);
  });

  it('keeps a __proto__ key as an own key in both bags', () => {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', attrs: { ['__proto__']: 'first' } });
    patches.length = 0;
    graph.updateNodeAttrs('a', { ['__proto__']: 'second' });
    const op = only(patches)[0];
    if (op?.op !== 'update-node-attrs') throw new Error('expected an update-node-attrs op');
    expect(Object.keys(op.after)).toEqual(['__proto__']);
    expect(Object.keys(op.before)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(op.after)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(op.before)).toBe(Object.prototype);
  });

  it('emits an update-edge-attrs op under the same rules', () => {
    const { graph, patches } = watched();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { weight: 1 } });
    patches.length = 0;
    graph.updateEdgeAttrs('ab', { weight: 1, dashed: true });
    expect(only(patches)).toStrictEqual([
      {
        op: 'update-edge-attrs',
        id: 'ab',
        after: { dashed: true },
        before: { dashed: undefined },
      },
    ]);
    graph.updateEdgeAttrs('ab', { weight: 1 });
    expect(patches).toHaveLength(1);
  });

  it('emits an update-graph-attrs op under the same rules', () => {
    const { graph, patches } = watched();
    graph.updateAttrs({ rankdir: 'TB' });
    expect(only(patches)).toStrictEqual([
      { op: 'update-graph-attrs', after: { rankdir: 'TB' }, before: { rankdir: undefined } },
    ]);
    graph.updateAttrs({ rankdir: 'TB' });
    expect(patches).toHaveLength(1);
  });
});

describe('Graph patch emission for port rebinding', () => {
  /** An edge whose source node declares two usable ports. */
  function bound(): { graph: Graph; patches: Patch[] } {
    const { graph, patches } = watched();
    graph.addNode({ id: 'a', ports: [{ id: 'p1' }, { id: 'p2' }] });
    graph.addNode({ id: 'b', ports: [{ id: 'q1' }] });
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'p1' });
    patches.length = 0;
    return { graph, patches };
  }

  it('names only the end that moved', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', { sourcePort: 'p2', targetPort: undefined });
    expect(only(patches)).toStrictEqual([
      {
        op: 'update-edge-ports',
        id: 'ab',
        after: { sourcePort: 'p2' },
        before: { sourcePort: 'p1' },
      },
    ]);
  });

  it('spells a detached end as a key present and undefined', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', { sourcePort: undefined });
    const op = only(patches)[0];
    if (op?.op !== 'update-edge-ports') throw new Error('expected an update-edge-ports op');
    expect(Object.hasOwn(op.after, 'sourcePort')).toBe(true);
    expect(op.after.sourcePort).toBeUndefined();
    expect(op.before).toStrictEqual({ sourcePort: 'p1' });
  });

  it('spells a newly bound end as an undefined prior value', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', { targetPort: 'q1' });
    const op = only(patches)[0];
    if (op?.op !== 'update-edge-ports') throw new Error('expected an update-edge-ports op');
    expect(Object.hasOwn(op.before, 'targetPort')).toBe(true);
    expect(op.before.targetPort).toBeUndefined();
    expect(op.after).toStrictEqual({ targetPort: 'q1' });
  });

  it('names both ends when both move', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', { sourcePort: 'p2', targetPort: 'q1' });
    expect(only(patches)).toStrictEqual([
      {
        op: 'update-edge-ports',
        id: 'ab',
        after: { sourcePort: 'p2', targetPort: 'q1' },
        before: { sourcePort: 'p1', targetPort: undefined },
      },
    ]);
  });

  it('emits nothing when the rebinding names the port already bound', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', {});
    graph.updateEdgePorts('ab', { sourcePort: 'p1' });
    graph.updateEdgePorts('ab', { targetPort: undefined });
    graph.updateEdgePorts('ab', { sourcePort: 'p1', targetPort: undefined });
    expect(patches).toHaveLength(0);
  });

  it('emits nothing when the rebinding is rejected', () => {
    const { graph, patches } = bound();
    expect(() => graph.updateEdgePorts('ab', { sourcePort: 'nope' })).toThrow();
    expect(() => graph.updateEdgePorts('nope', { sourcePort: 'p2' })).toThrow();
    expect(patches).toHaveLength(0);
  });

  it('freezes both bags in the op', () => {
    const { graph, patches } = bound();
    graph.updateEdgePorts('ab', { sourcePort: 'p2' });
    const op = only(patches)[0];
    if (op?.op !== 'update-edge-ports') throw new Error('expected an update-edge-ports op');
    expect(Object.isFrozen(op.after)).toBe(true);
    expect(Object.isFrozen(op.before)).toBe(true);
  });
});

describe('Graph patch emission and the listener count', () => {
  it('emits nothing to a graph nobody watches', () => {
    const graph = new Graph();
    const listener = vi.fn();
    graph.addNode('a');
    graph.subscribe(listener);
    graph.addNode('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
