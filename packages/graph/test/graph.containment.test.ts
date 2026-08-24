import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { ContainmentCycleError, NodeNotFoundError } from '../src/errors.js';
import { apply, invert } from '../src/patch.js';
import type { Patch } from '../src/patch.js';

/** The patches `mutate` emitted, with `setup` running before anything watches. */
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

/** A parent with two children and a grandchild under the first of them. */
function buildFamily(graph: Graph): void {
  graph.addNode('p');
  graph.addNode({ id: 'c1', parent: 'p' });
  graph.addNode({ id: 'c2', parent: 'p' });
  graph.addNode({ id: 'g', parent: 'c1' });
}

/** The same forest as a graph of its own. */
function family(): Graph {
  const graph = new Graph();
  buildFamily(graph);
  return graph;
}

describe('containment on the node record', () => {
  it('leaves the key absent on a node with no parent', () => {
    const graph = new Graph();
    const node = graph.addNode('a');
    expect(node).toEqual({ id: 'a', attrs: {}, ports: [] });
    expect(node.parent).toBeUndefined();
    expect(Object.hasOwn(node, 'parent')).toBe(false);
  });

  it('declares a parent at addNode', () => {
    const graph = new Graph();
    graph.addNode('p');
    const child = graph.addNode({ id: 'c', parent: 'p' });
    expect(child.parent).toBe('p');
    expect(graph.getNode('c')?.parent).toBe('p');
  });

  it('refuses a parent the graph does not hold, and adds nothing', () => {
    const graph = new Graph();
    expect(() => graph.addNode({ id: 'c', parent: 'p' })).toThrow(NodeNotFoundError);
    expect(graph.nodeCount).toBe(0);
  });

  it('refuses a node that declares itself as its own parent', () => {
    const graph = new Graph();
    expect(() => graph.addNode({ id: 'a', parent: 'a' })).toThrow(ContainmentCycleError);
    expect(graph.nodeCount).toBe(0);
  });

  it('sets, replaces, and clears a parent through setNodeParent', () => {
    const graph = new Graph();
    graph.addNode('p');
    graph.addNode('q');
    graph.addNode('c');
    expect(graph.setNodeParent('c', 'p').parent).toBe('p');
    // At most one parent, so the second call replaces rather than adds.
    expect(graph.setNodeParent('c', 'q').parent).toBe('q');
    expect(graph.children('p')).toEqual([]);
    const cleared = graph.setNodeParent('c', undefined);
    expect(cleared.parent).toBeUndefined();
    expect(Object.hasOwn(cleared, 'parent')).toBe(false);
    expect(graph.children('q')).toEqual([]);
  });

  it('is copy on write, and a no-op keeps the record identity', () => {
    const graph = new Graph();
    graph.addNode('p');
    const before = graph.addNode({ id: 'c', attrs: { label: 'C' }, ports: [{ id: 'in' }] });
    const after = graph.setNodeParent('c', 'p');
    expect(after).not.toBe(before);
    expect(before.parent).toBeUndefined();
    expect(after.attrs).toEqual({ label: 'C' });
    // The ports did not change, so the array must not change identity either,
    // exactly as `updateNodeAttrs` promises.
    expect(after.ports).toBe(before.ports);
    expect(graph.setNodeParent('c', 'p')).toBe(after);
    expect(graph.setNodeParent('p', undefined)).toBe(graph.getNode('p'));
  });

  it('refuses a parent that is not in the graph and leaves the child alone', () => {
    const graph = new Graph();
    const child = graph.addNode('c');
    expect(() => graph.setNodeParent('c', 'p')).toThrow(NodeNotFoundError);
    expect(() => graph.setNodeParent('missing', undefined)).toThrow(NodeNotFoundError);
    expect(graph.getNode('c')).toBe(child);
  });
});

describe('containment is acyclic', () => {
  it('refuses a node as its own parent', () => {
    const graph = new Graph();
    graph.addNode('a');
    expect(() => graph.setNodeParent('a', 'a')).toThrow(ContainmentCycleError);
    expect(graph.getNode('a')?.parent).toBeUndefined();
  });

  it('refuses a parent that the node already contains, however deep', () => {
    const graph = family();
    expect(() => graph.setNodeParent('p', 'g')).toThrow(ContainmentCycleError);
    expect(graph.getNode('p')?.parent).toBeUndefined();
    expect(graph.getNode('g')?.parent).toBe('c1');
  });

  it('carries the chain that closes, child first and the endpoint listed once', () => {
    const graph = family();
    try {
      graph.setNodeParent('p', 'g');
      expect.unreachable('the reparent should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ContainmentCycleError);
      if (!(error instanceof ContainmentCycleError)) throw error;
      expect(error.chain).toEqual(['p', 'g', 'c1']);
      expect(error.code).toBe('CONTAINMENT_CYCLE');
      expect(error.message).toBe('Containment cycle: p -> g -> c1 -> p');
    }
  });

  it('allows a sibling reparent that closes nothing', () => {
    const graph = family();
    expect(graph.setNodeParent('c2', 'c1').parent).toBe('c1');
    expect(graph.children('c1')).toEqual(['c2', 'g']);
  });
});

describe('children', () => {
  it('lists the contained nodes in node insertion order', () => {
    const graph = new Graph();
    graph.addNode('p');
    graph.addNode('late');
    graph.addNode('early');
    // Reparented in the opposite order to the one they were added in, because
    // the listing follows insertion order the way `successors` does rather than
    // the order the containment happened to be declared in.
    graph.setNodeParent('early', 'p');
    graph.setNodeParent('late', 'p');
    expect(graph.children('p')).toEqual(['late', 'early']);
  });

  it('is empty for a leaf and refuses a node that is not there', () => {
    const graph = new Graph();
    graph.addNode('a');
    expect(graph.children('a')).toEqual([]);
    expect(() => graph.children('missing')).toThrow(NodeNotFoundError);
  });

  it('moves a child between the two listings on a reparent', () => {
    const graph = family();
    expect(graph.children('p')).toEqual(['c1', 'c2']);
    graph.setNodeParent('g', 'c2');
    expect(graph.children('c1')).toEqual([]);
    expect(graph.children('c2')).toEqual(['g']);
  });

  it('hands back a fresh array', () => {
    const graph = family();
    expect(graph.children('p')).not.toBe(graph.children('p'));
  });
});

describe('containment against the rest of the model', () => {
  it('lets an edge cross a containment boundary', () => {
    const graph = family();
    graph.addNode('outside');
    const crossing = graph.addEdge({ source: 'outside', target: 'g', id: 'x' });
    expect(crossing.source).toBe('outside');
    expect(graph.successors('outside')).toEqual(['g']);
  });

  it('changes no traversal: containment is not reachability', () => {
    const graph = family();
    expect(graph.successors('p')).toEqual([]);
    expect(graph.descendants('p')).toEqual([]);
    expect(graph.ancestors('g')).toEqual([]);
    expect(graph.canReach('p', 'g')).toBe(false);
    expect(graph.sources()).toEqual(['p', 'c1', 'c2', 'g']);
    expect(graph.isAcyclic()).toBe(true);
    expect(graph.topologicalOrder()).toEqual(['p', 'c1', 'c2', 'g']);
  });

  it('keeps a containment cycle out of the edge cycle report', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode({ id: 'b', parent: 'a' });
    graph.addEdge({ source: 'a', target: 'b', id: 'ab' });
    graph.addEdge({ source: 'b', target: 'a', id: 'ba' });
    // The edges are what make this cyclic. Containment runs the other way and
    // has nothing to say about it: the same two nodes nested the same way with
    // only one edge between them are a DAG.
    expect(graph.isAcyclic()).toBe(false);
    expect(graph.findCycle()).toEqual(['a', 'b']);
    graph.removeEdge('ba');
    expect(graph.isAcyclic()).toBe(true);
  });
});

describe('containment patches', () => {
  it('emits one update-node-parent op naming both sides of the move', () => {
    const patch = single(
      (graph) => {
        graph.addNode('p');
        graph.addNode('c');
      },
      (graph) => graph.setNodeParent('c', 'p'),
    );
    expect(patch).toEqual([{ op: 'update-node-parent', id: 'c', after: 'p', before: undefined }]);
    expect(Object.isFrozen(patch[0])).toBe(true);
  });

  it('spells a cleared parent as an explicit undefined on both keys', () => {
    const patch = single(
      (graph) => {
        graph.addNode('p');
        graph.addNode({ id: 'c', parent: 'p' });
      },
      (graph) => graph.setNodeParent('c', undefined),
    );
    expect(patch).toEqual([{ op: 'update-node-parent', id: 'c', after: undefined, before: 'p' }]);
    const op = patch[0];
    if (op?.op !== 'update-node-parent') throw new Error('expected an update-node-parent op');
    expect(Object.hasOwn(op, 'after')).toBe(true);
  });

  it('emits nothing when the parent does not move', () => {
    const patches = record(
      (graph) => {
        graph.addNode('p');
        graph.addNode({ id: 'c', parent: 'p' });
      },
      (graph) => {
        graph.setNodeParent('c', 'p');
        graph.setNodeParent('p', undefined);
      },
    );
    expect(patches).toEqual([]);
  });

  it('carries the parent on the add-node op, and leaves the key absent without one', () => {
    const patch = single(
      (graph) => graph.addNode('p'),
      (graph) => {
        graph.addNode({ id: 'c', parent: 'p' });
      },
    );
    expect(patch).toEqual([{ op: 'add-node', id: 'c', attrs: {}, ports: [], parent: 'p' }]);
    const rootPatch = single(
      () => undefined,
      (graph) => {
        graph.addNode('r');
      },
    );
    const op = rootPatch[0];
    if (op === undefined) throw new Error('no op was emitted');
    expect(Object.hasOwn(op, 'parent')).toBe(false);
  });

  it('removes a subtree child first, deepest first, with the parent last', () => {
    const patch = single(buildFamily, (graph) => {
      graph.removeNode('p');
    });
    expect(patch.map((op) => (op.op === 'remove-node' ? op.id : op.op))).toEqual([
      'g',
      'c1',
      'c2',
      'p',
    ]);
  });

  it('takes the incident edges of every removed descendant with it', () => {
    const patch = single(
      (graph) => {
        graph.addNode('p');
        graph.addNode({ id: 'c', parent: 'p' });
        graph.addNode('outside');
        graph.addEdge({ source: 'outside', target: 'c', id: 'x' });
        graph.addEdge({ source: 'p', target: 'outside', id: 'y' });
      },
      (graph) => {
        graph.removeNode('p');
      },
    );
    expect(patch.map((op) => op.op)).toEqual([
      'remove-edge',
      'remove-node',
      'remove-edge',
      'remove-node',
    ]);
    expect(patch.filter((op) => op.op === 'remove-edge').map((op) => op.id)).toEqual(['x', 'y']);
  });

  it('drops the removed child out of its parent listing', () => {
    const graph = family();
    graph.removeNode('c1');
    expect(graph.hasNode('g')).toBe(false);
    expect(graph.children('p')).toEqual(['c2']);
  });

  it('inverts a reparent into the move back', () => {
    const graph = family();
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.setNodeParent('g', 'c2');
    apply(graph, invert(patches[0] ?? []));
    expect(graph.getNode('g')?.parent).toBe('c1');
  });

  it('inverts a subtree removal into an add that names every parent first', () => {
    const graph = family();
    graph.addNode('outside');
    graph.addEdge({ source: 'outside', target: 'g', id: 'x' });
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.removeNode('p');
    const undo = invert(patches[0] ?? []);
    // The parent has to come back before the child that names it, which is
    // what the post-order removal buys: reversing it is already the right
    // order and nothing here sorts.
    expect(undo.map((op) => (op.op === 'add-node' ? op.id : op.op))).toEqual([
      'p',
      'c2',
      'c1',
      'g',
      'add-edge',
    ]);
    apply(graph, undo);
    expect(graph.getNode('g')?.parent).toBe('c1');
    expect(graph.children('p')).toEqual(['c2', 'c1']);
    expect(graph.hasEdge('x')).toBe(true);
  });

  it('replays containment onto a mirror', () => {
    const source = family();
    const mirror = new Graph();
    apply(mirror, [
      { op: 'add-node', id: 'p', attrs: {}, ports: [] },
      { op: 'add-node', id: 'c1', attrs: {}, ports: [], parent: 'p' },
      { op: 'add-node', id: 'c2', attrs: {}, ports: [], parent: 'p' },
      { op: 'add-node', id: 'g', attrs: {}, ports: [], parent: 'c1' },
    ]);
    expect(mirror.toJSON()).toEqual(source.toJSON());
    apply(mirror, [{ op: 'update-node-parent', id: 'g', after: 'c2', before: 'c1' }]);
    expect(mirror.getNode('g')?.parent).toBe('c2');
  });

  it('keeps a mirror in step through a subscription', () => {
    const source = new Graph();
    const mirror = new Graph();
    source.subscribe((patch) => {
      apply(mirror, patch);
    });
    source.addNode('p');
    source.addNode({ id: 'c', parent: 'p' });
    source.addNode('g');
    source.setNodeParent('g', 'c');
    source.removeNode('c');
    expect(mirror.toJSON()).toEqual(source.toJSON());
    expect(mirror.nodeCount).toBe(1);
  });
});

describe('containment in a document', () => {
  it('writes the parent when there is one and omits it otherwise', () => {
    const document = family().toJSON();
    expect(document.nodes).toEqual([
      { id: 'p' },
      { id: 'c1', parent: 'p' },
      { id: 'c2', parent: 'p' },
      { id: 'g', parent: 'c1' },
    ]);
    expect(document.version).toBe(1);
  });

  it('round trips a containment forest', () => {
    const graph = family();
    const restored = Graph.fromJSON(graph.toJSON());
    expect(restored.toJSON()).toEqual(graph.toJSON());
    expect(restored.children('p')).toEqual(['c1', 'c2']);
  });

  it('restores a parent written after the child it contains', () => {
    const graph = new Graph();
    graph.addNode('c');
    graph.addNode('p');
    graph.setNodeParent('c', 'p');
    const document = graph.toJSON();
    // Insertion order is the document's contract, so the child is written
    // first and a reader that added nodes in one pass would name a parent that
    // is not there yet.
    expect(document.nodes.map((node) => node.id)).toEqual(['c', 'p']);
    const restored = Graph.fromJSON(document);
    expect(restored.getNode('c')?.parent).toBe('p');
    expect(restored.nodes().map((node) => node.id)).toEqual(['c', 'p']);
  });

  it('refuses a parent that is not a non-empty string, naming the path', () => {
    expect(() =>
      Graph.fromJSON({ version: 1, nodes: [{ id: 'a', parent: 7 }], edges: [] }),
    ).toThrow(/nodes\[0\]\.parent/);
    expect(() =>
      Graph.fromJSON({ version: 1, nodes: [{ id: 'a', parent: '' }], edges: [] }),
    ).toThrow(/nodes\[0\]\.parent/);
  });

  it('refuses a document whose containment names a node it does not hold', () => {
    expect(() =>
      Graph.fromJSON({ version: 1, nodes: [{ id: 'a', parent: 'missing' }], edges: [] }),
    ).toThrow(NodeNotFoundError);
  });

  it('refuses a document whose containment closes a cycle', () => {
    expect(() =>
      Graph.fromJSON({
        version: 1,
        nodes: [
          { id: 'a', parent: 'b' },
          { id: 'b', parent: 'a' },
        ],
        edges: [],
      }),
    ).toThrow(ContainmentCycleError);
  });
});
