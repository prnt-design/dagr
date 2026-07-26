import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { invert } from '../src/patch.js';
import type { Patch } from '../src/patch.js';

/**
 * The patches `mutate` emitted. `setup` runs before anything is watching, so a
 * test can build the graph it needs without its patches joining the log.
 */
function record(setup: (graph: Graph) => void, mutate: (graph: Graph) => void): Patch[] {
  const graph = new Graph();
  setup(graph);
  const patches: Patch[] = [];
  graph.subscribe((patch) => patches.push(patch));
  mutate(graph);
  return patches;
}

/** The one patch `mutate` emitted, failing the test if there is not exactly one. */
function single(setup: (graph: Graph) => void, mutate: (graph: Graph) => void): Patch {
  const patches = record(setup, mutate);
  expect(patches).toHaveLength(1);
  const patch = patches[0];
  if (patch === undefined) throw new Error('no patch was emitted');
  return patch;
}

/** A graph that needs no setup. */
const bare = (): void => undefined;

describe('invert of a single op', () => {
  it('turns add-node into remove-node and keeps the payload', () => {
    const patch = single(bare, (graph) => {
      graph.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p', direction: 'out' }] });
    });
    expect(invert(patch)).toStrictEqual([
      {
        op: 'remove-node',
        id: 'a',
        attrs: { label: 'A' },
        ports: [{ id: 'p', direction: 'out' }],
      },
    ]);
  });

  it('turns remove-node into add-node', () => {
    const patch = single(
      (graph) => graph.addNode({ id: 'a', attrs: { label: 'A' } }),
      (graph) => {
        graph.removeNode('a');
      },
    );
    expect(invert(patch)).toStrictEqual([
      { op: 'add-node', id: 'a', attrs: { label: 'A' }, ports: [] },
    ]);
  });

  it('turns add-edge into remove-edge and keeps the bound ports', () => {
    const patch = single(
      (graph) => {
        graph.addNode({ id: 'a', ports: [{ id: 'p' }] });
        graph.addNode('b');
      },
      (graph) => {
        graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { w: 1 }, sourcePort: 'p' });
      },
    );
    expect(invert(patch)).toStrictEqual([
      {
        op: 'remove-edge',
        id: 'ab',
        source: 'a',
        target: 'b',
        attrs: { w: 1 },
        sourcePort: 'p',
      },
    ]);
  });

  it('leaves an unbound end absent rather than adding it as undefined', () => {
    const patch = single(
      (graph) => {
        graph.addNode('a');
        graph.addNode('b');
      },
      (graph) => {
        graph.addEdge('a', 'b', 'ab');
      },
    );
    const op = invert(patch)[0];
    expect(op).toStrictEqual({ op: 'remove-edge', id: 'ab', source: 'a', target: 'b', attrs: {} });
    expect(Object.hasOwn(op ?? {}, 'sourcePort')).toBe(false);
  });

  it('turns add-port into remove-port and keeps the index', () => {
    const patch = single(
      (graph) => graph.addNode({ id: 'a', ports: [{ id: 'p1' }] }),
      (graph) => {
        graph.addPort('a', { id: 'p2', direction: 'in' });
      },
    );
    expect(invert(patch)).toStrictEqual([
      { op: 'remove-port', nodeId: 'a', port: { id: 'p2', direction: 'in' }, index: 1 },
    ]);
  });

  it('turns remove-port into add-port and keeps the index', () => {
    const patch = single(
      (graph) => graph.addNode({ id: 'a', ports: [{ id: 'p1' }, { id: 'p2' }] }),
      (graph) => {
        graph.removePort('a', 'p1');
      },
    );
    expect(invert(patch)).toStrictEqual([
      { op: 'add-port', nodeId: 'a', port: { id: 'p1', direction: 'inout' }, index: 0 },
    ]);
  });

  it('swaps patch and before on a node attribute update', () => {
    const patch = single(
      (graph) => graph.addNode({ id: 'a', attrs: { label: 'A' } }),
      (graph) => {
        graph.updateNodeAttrs('a', { label: 'B', width: 4 });
      },
    );
    expect(invert(patch)).toStrictEqual([
      {
        op: 'update-node-attrs',
        id: 'a',
        patch: { label: 'A', width: undefined },
        before: { label: 'B', width: 4 },
      },
    ]);
  });

  it('swaps patch and before on an edge attribute update', () => {
    const patch = single(
      (graph) => {
        graph.addNode('a');
        graph.addEdge('a', 'a', 'loop');
      },
      (graph) => {
        graph.updateEdgeAttrs('loop', { w: 1 });
      },
    );
    expect(invert(patch)).toStrictEqual([
      { op: 'update-edge-attrs', id: 'loop', patch: { w: undefined }, before: { w: 1 } },
    ]);
  });

  it('swaps patch and before on a graph attribute update', () => {
    const patch = single(bare, (graph) => {
      graph.updateAttrs({ rankdir: 'TB' });
    });
    expect(invert(patch)).toStrictEqual([
      { op: 'update-graph-attrs', patch: { rankdir: undefined }, before: { rankdir: 'TB' } },
    ]);
  });

  it('swaps patch and before on a port rebinding', () => {
    const patch = single(
      (graph) => {
        graph.addNode({ id: 'a', ports: [{ id: 'p1' }, { id: 'p2' }] });
        graph.addEdge({ source: 'a', target: 'a', id: 'loop', sourcePort: 'p1' });
      },
      (graph) => {
        graph.updateEdgePorts('loop', { sourcePort: 'p2', targetPort: 'p1' });
      },
    );
    expect(invert(patch)).toStrictEqual([
      {
        op: 'update-edge-ports',
        id: 'loop',
        patch: { sourcePort: 'p1', targetPort: undefined },
        before: { sourcePort: 'p2', targetPort: 'p1' },
      },
    ]);
  });
});

describe('invert of a multi-op patch', () => {
  /** The cascade patch from removing a node with two incident edges. */
  function cascade(): Patch {
    return single(
      (graph) => {
        graph.addNode('a');
        graph.addNode('b');
        graph.addEdge('a', 'b', 'ab');
        graph.addEdge('b', 'a', 'ba');
      },
      (graph) => {
        graph.removeNode('b');
      },
    );
  }

  it('reverses the order, so the node comes back before its edges', () => {
    const patch = cascade();
    expect(patch.map((op) => op.op)).toEqual(['remove-edge', 'remove-edge', 'remove-node']);
    expect(invert(patch).map((op) => op.op)).toEqual(['add-node', 'add-edge', 'add-edge']);
  });

  it('reverses the edges among themselves too', () => {
    const patch = cascade();
    const ids = patch.flatMap((op) => (op.op === 'remove-edge' ? [op.id] : []));
    const inverseIds = invert(patch).flatMap((op) => (op.op === 'add-edge' ? [op.id] : []));
    expect(ids).toHaveLength(2);
    expect(inverseIds).toEqual([...ids].reverse());
  });

  it('leaves the patch it was given alone', () => {
    const patch = cascade();
    const before = patch.map((op) => op.op);
    invert(patch);
    expect(patch.map((op) => op.op)).toEqual(before);
  });
});

describe('invert twice', () => {
  it('is structurally the patch it started from', () => {
    const patches = record(bare, (graph) => {
      graph.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p' }] });
      graph.addNode('b');
      graph.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'p' });
      graph.updateNodeAttrs('a', { label: 'B', width: 2 });
      graph.updateNodeAttrs('a', { label: undefined });
      graph.updateEdgePorts('ab', { sourcePort: undefined });
      graph.updateEdgeAttrs('ab', { w: 1 });
      graph.updateAttrs({ rankdir: 'LR' });
      graph.addPort('a', { id: 'q' });
      graph.removePort('a', 'q');
      graph.removeNode('a');
    });
    expect(patches.length).toBeGreaterThan(9);
    for (const patch of patches) {
      expect(invert(invert(patch))).toStrictEqual(patch);
    }
  });

  it('holds for a patch built by hand, ops in the same order', () => {
    const patch: Patch = [
      { op: 'add-node', id: 'a', attrs: {}, ports: [] },
      { op: 'add-node', id: 'b', attrs: {}, ports: [] },
      { op: 'add-edge', id: 'ab', source: 'a', target: 'b', attrs: {} },
    ];
    expect(invert(invert(patch))).toStrictEqual(patch);
  });
});

describe('invert results', () => {
  it('freezes the patch and every op in it', () => {
    const patch = single(bare, (graph) => {
      graph.addNode('a');
    });
    const inverted = invert(patch);
    expect(Object.isFrozen(inverted)).toBe(true);
    expect(Object.isFrozen(inverted[0])).toBe(true);
  });

  it('inverts an empty patch to an empty patch', () => {
    expect(invert([])).toStrictEqual([]);
  });
});
