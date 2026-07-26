import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { apply, invert } from '../src/patch.js';
import type { Patch } from '../src/patch.js';
import { EdgeNotFoundError, NodeNotFoundError, PortNotFoundError } from '../src/errors.js';

/**
 * A source graph and a mirror kept in step by piping every emitted patch
 * through `apply`. This is the intended use of the pair, so most of the suite
 * exercises them together.
 */
function mirrored(): { source: Graph; mirror: Graph; patches: Patch[] } {
  const source = new Graph();
  const mirror = new Graph();
  const patches: Patch[] = [];
  source.subscribe((patch) => {
    patches.push(patch);
    apply(mirror, patch);
  });
  return { source, mirror, patches };
}

/** Nodes and edges as plain content, sorted by id so order is not compared. */
function content(graph: Graph): unknown {
  return {
    attrs: { ...graph.attrs },
    nodes: [...graph.nodes()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        attrs: { ...node.attrs },
        ports: [...node.ports].sort((left, right) => left.id.localeCompare(right.id)),
      })),
    edges: [...graph.edges()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        attrs: { ...edge.attrs },
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
      })),
  };
}

describe('apply of one op', () => {
  it('replays add-node with its attributes and ports', () => {
    const { source, mirror } = mirrored();
    source.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p', direction: 'out' }] });
    expect(mirror.requireNode('a').attrs).toEqual({ label: 'A' });
    expect(mirror.ports('a')).toEqual([{ id: 'p', direction: 'out' }]);
  });

  it('replays a generated id rather than generating a new one', () => {
    const { source, mirror } = mirrored();
    source.addNode();
    source.addNode();
    expect(mirror.nodes().map((node) => node.id)).toEqual(['n1', 'n2']);
  });

  it('replays add-edge with its endpoints, attributes, and ports', () => {
    const { source, mirror } = mirrored();
    source.addNode({ id: 'a', ports: [{ id: 'p' }] });
    source.addNode({ id: 'b', ports: [{ id: 'q' }] });
    source.addEdge({
      source: 'a',
      target: 'b',
      id: 'ab',
      attrs: { w: 3 },
      sourcePort: 'p',
      targetPort: 'q',
    });
    const edge = mirror.requireEdge('ab');
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(edge.attrs).toEqual({ w: 3 });
    expect(edge.sourcePort).toBe('p');
    expect(edge.targetPort).toBe('q');
  });

  it('replays an unbound end as unbound rather than as a named port', () => {
    const { source, mirror } = mirrored();
    source.addNode('a');
    source.addNode('b');
    source.addEdge('a', 'b', 'ab');
    const edge = mirror.requireEdge('ab');
    expect(Object.hasOwn(edge, 'sourcePort')).toBe(false);
    expect(Object.hasOwn(edge, 'targetPort')).toBe(false);
  });

  it('replays remove-edge and remove-node', () => {
    const { source, mirror } = mirrored();
    source.addNode('a');
    source.addNode('b');
    source.addEdge('a', 'b', 'ab');
    source.removeEdge('ab');
    expect(mirror.hasEdge('ab')).toBe(false);
    source.removeNode('a');
    expect(mirror.hasNode('a')).toBe(false);
    expect(mirror.nodeCount).toBe(1);
  });

  it('replays a removeNode cascade without cascading twice', () => {
    const { source, mirror } = mirrored();
    source.addNode('a');
    source.addNode('b');
    source.addEdge('a', 'b', 'ab');
    source.addEdge('b', 'b', 'loop');
    source.removeNode('b');
    expect(mirror.nodeCount).toBe(1);
    expect(mirror.edgeCount).toBe(0);
    expect(mirror.hasNode('a')).toBe(true);
  });

  it('replays add-port and remove-port', () => {
    const { source, mirror } = mirrored();
    source.addNode('a');
    source.addPort('a', { id: 'p', direction: 'in' });
    expect(mirror.getPort('a', 'p')).toEqual({ id: 'p', direction: 'in' });
    source.removePort('a', 'p');
    expect(mirror.hasPort('a', 'p')).toBe(false);
  });

  it('replays the four update ops', () => {
    const { source, mirror } = mirrored();
    source.addNode({ id: 'a', ports: [{ id: 'p' }, { id: 'q' }] });
    source.addEdge({ source: 'a', target: 'a', id: 'loop', sourcePort: 'p' });
    source.updateNodeAttrs('a', { label: 'A', width: 2 });
    source.updateNodeAttrs('a', { width: undefined });
    source.updateEdgeAttrs('loop', { w: 1 });
    source.updateAttrs({ rankdir: 'TB' });
    source.updateEdgePorts('loop', { sourcePort: 'q', targetPort: 'p' });
    expect(mirror.requireNode('a').attrs).toEqual({ label: 'A' });
    expect(Object.hasOwn(mirror.requireNode('a').attrs, 'width')).toBe(false);
    expect(mirror.requireEdge('loop').attrs).toEqual({ w: 1 });
    expect(mirror.attrs).toEqual({ rankdir: 'TB' });
    expect(mirror.requireEdge('loop').sourcePort).toBe('q');
    expect(mirror.requireEdge('loop').targetPort).toBe('p');
  });

  it('keeps a whole mirrored session content-equal', () => {
    const { source, mirror } = mirrored();
    source.addNode({ id: 'a', attrs: { label: 'A' }, ports: [{ id: 'p' }] });
    source.addNode('b');
    source.addEdge({ source: 'a', target: 'b', id: 'ab', sourcePort: 'p' });
    source.addEdge('b', 'a');
    source.updateAttrs({ rankdir: 'LR' });
    source.updateNodeAttrs('b', { label: 'B' });
    source.addPort('b', { id: 'q' });
    source.removeNode('a');
    expect(content(mirror)).toEqual(content(source));
  });
});

describe('apply as an ordinary caller', () => {
  it('makes the target emit its own patches', () => {
    const source = new Graph();
    const target = new Graph();
    const seen: Patch[] = [];
    target.subscribe((patch) => seen.push(patch));
    const log: Patch[] = [];
    source.subscribe((patch) => log.push(patch));
    source.addNode('a');
    source.addNode('b');
    for (const patch of log) apply(target, patch);
    expect(seen.map((patch) => patch.map((op) => op.op))).toEqual([['add-node'], ['add-node']]);
  });

  it('applies the ops of one patch in order', () => {
    const { source, mirror } = mirrored();
    source.addNode('a');
    source.addNode('b');
    source.addEdge('a', 'b', 'ab');
    // The cascade patch removes the edge before the node, and applying it the
    // other way round would throw rather than silently misbehave.
    expect(() => source.removeNode('a')).not.toThrow();
    expect(mirror.nodeCount).toBe(1);
  });

  it('restores content when the inverse is applied after the patch', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge({ source: 'a', target: 'b', id: 'ab', attrs: { w: 1 } });
    const before = content(graph);
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.removeNode('a');
    const patch = patches[0] ?? [];
    apply(graph, invert(patch));
    expect(content(graph)).toEqual(before);
  });

  it('appends a restored node rather than putting it back where it was', () => {
    // The documented limitation: replay restores every value but not insertion
    // order, because iteration order is a function of insertion history and an
    // inverse patch is new insertion history.
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.removeNode('a');
    apply(graph, invert(patches[0] ?? []));
    expect(graph.nodes().map((node) => node.id)).toEqual(['b', 'c', 'a']);
  });

  it('appends a restored port rather than putting it back at its index', () => {
    const graph = new Graph();
    graph.addNode({ id: 'a', ports: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] });
    const patches: Patch[] = [];
    graph.subscribe((patch) => patches.push(patch));
    graph.removePort('a', 'p1');
    const patch = patches[0] ?? [];
    expect(patch[0]).toMatchObject({ op: 'remove-port', index: 0 });
    apply(graph, invert(patch));
    expect(graph.ports('a').map((port) => port.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('does nothing for an empty patch', () => {
    const graph = new Graph();
    graph.addNode('a');
    apply(graph, []);
    expect(graph.nodeCount).toBe(1);
  });
});

describe('apply against a graph that cannot take the patch', () => {
  it('throws the graph error the op runs into', () => {
    const graph = new Graph();
    expect(() =>
      apply(graph, [{ op: 'add-edge', id: 'ab', source: 'a', target: 'b', attrs: {} }]),
    ).toThrow(NodeNotFoundError);
    expect(() => apply(graph, [{ op: 'remove-node', id: 'a', attrs: {}, ports: [] }])).toThrow(
      NodeNotFoundError,
    );
    expect(() =>
      apply(graph, [{ op: 'remove-edge', id: 'ab', source: 'a', target: 'b', attrs: {} }]),
    ).toThrow(EdgeNotFoundError);
    graph.addNode('a');
    expect(() =>
      apply(graph, [
        { op: 'remove-port', nodeId: 'a', port: { id: 'p', direction: 'inout' }, index: 0 },
      ]),
    ).toThrow(PortNotFoundError);
  });

  it('leaves the ops before the failing one applied', () => {
    const graph = new Graph();
    const patch: Patch = [
      { op: 'add-node', id: 'a', attrs: {}, ports: [] },
      { op: 'add-edge', id: 'ab', source: 'a', target: 'gone', attrs: {} },
    ];
    expect(() => apply(graph, patch)).toThrow(NodeNotFoundError);
    // Not a transaction, and it does not claim to be: the ops are ordinary
    // calls, so what ran stays run.
    expect(graph.hasNode('a')).toBe(true);
  });

  it('throws for an op it does not know', () => {
    const graph = new Graph();
    // Only reachable from JavaScript or from a patch that crossed a version
    // boundary, so the cast is what makes the case testable at all.
    const patch = [{ op: 'teleport-node', id: 'a' }] as unknown as Patch;
    expect(() => apply(graph, patch)).toThrow(/teleport-node/);
  });
});

describe('apply and the type parameters', () => {
  it('threads the attribute types through', () => {
    type NodeAttrs = { label: string };
    type EdgeAttrs = { weight: number };
    type GraphAttrs = { rankdir: string };
    const source = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    const mirror = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    source.subscribe((patch) => {
      apply(mirror, patch);
    });
    source.addNode({ id: 'a', attrs: { label: 'A' } });
    source.addEdge({ source: 'a', target: 'a', id: 'loop', attrs: { weight: 2 } });
    source.updateAttrs({ rankdir: 'TB' });
    expect(mirror.requireNode('a').attrs.label).toBe('A');
    expect(mirror.requireEdge('loop').attrs.weight).toBe(2);
    expect(mirror.attrs.rankdir).toBe('TB');
  });
});
