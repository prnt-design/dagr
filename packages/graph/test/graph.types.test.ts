import { describe, expect, expectTypeOf, it } from 'vitest';
import { Graph } from '../src/graph.js';
import type { Attrs, Edge, Node, Port, ReadAttrs } from '../src/types.js';

/**
 * Type-level coverage of the attribute generics.
 *
 * These assertions are checked by `tsc --noEmit`, which covers this directory,
 * so the file failing to compile is the failure this suite exists to catch.
 * The runtime bodies are here because a vitest file has to hold at least one
 * test, and because a type promise that no execution ever exercises is a
 * promise worth doubting.
 */

type NodeAttrs = { label: string; width: number };
type EdgeAttrs = { weight: number };
type GraphAttrs = { rankdir: string };

type Typed = Graph<NodeAttrs, EdgeAttrs, GraphAttrs>;

/**
 * The same shapes as interfaces. Only a `type` alias picks up an implicit
 * index signature, so these would be rejected by a constraint of `Attrs`.
 * Nothing in the implementation needs that index signature, so the constraint
 * is `object` and a caller may declare attributes either way.
 */
interface InterfaceNodeAttrs {
  label: string;
  width: number;
}

interface InterfaceEdgeAttrs {
  weight: number;
}

interface InterfaceGraphAttrs {
  rankdir: string;
}

describe('Graph type parameters', () => {
  it('leaves the unparameterised Graph meaning what it always did', () => {
    // Both spellings still have to work: `apps/demo` annotates with a bare
    // `Graph`, and every existing test constructs one with no arguments.
    const graph: Graph = new Graph();
    const node = graph.addNode('a');
    expectTypeOf(node).toEqualTypeOf<Node<Attrs>>();
    expectTypeOf(node.attrs).toEqualTypeOf<ReadAttrs<Attrs>>();
    expectTypeOf(node.attrs.anything).toEqualTypeOf<unknown>();
    expect(node.id).toBe('a');
  });

  it('types a node read as the declared value or undefined', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    const node = graph.addNode({ id: 'a', attrs: { label: 'A', width: 12 } });
    expectTypeOf(node).toEqualTypeOf<Node<NodeAttrs>>();
    expectTypeOf(node.attrs.width).toEqualTypeOf<number | undefined>();
    expectTypeOf(node.attrs.label).toEqualTypeOf<string | undefined>();

    // The honest read: every key can be absent, so every read is optional.
    const width: number | undefined = node.attrs.width;
    expect(width).toBe(12);
  });

  it('types an edge read the same way', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    graph.addNode('a');
    graph.addNode('b');
    const edge = graph.addEdge({ source: 'a', target: 'b', attrs: { weight: 3 } });
    expectTypeOf(edge).toEqualTypeOf<Edge<EdgeAttrs>>();
    // Attributes live in a bag rather than on the record, so they can never
    // collide with `id`, `source`, `target`, or a field a later milestone adds.
    expectTypeOf(edge.attrs.weight).toEqualTypeOf<number | undefined>();
    expectTypeOf(edge.sourcePort).toEqualTypeOf<string | undefined>();
    expect(edge.attrs.weight).toBe(3);
  });

  it('types the graph bag and its setter', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    expectTypeOf(graph.attrs).toEqualTypeOf<ReadAttrs<GraphAttrs>>();
    expectTypeOf(graph.updateAttrs({ rankdir: 'LR' })).toEqualTypeOf<ReadAttrs<GraphAttrs>>();
    expectTypeOf(graph.attrs.rankdir).toEqualTypeOf<string | undefined>();
    expect(graph.updateAttrs({ rankdir: 'LR' }).rankdir).toBe('LR');
  });

  it('lets a patch delete a key by naming it undefined', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    graph.addNode({ id: 'a', attrs: { label: 'A', width: 1 } });
    // `exactOptionalPropertyTypes` is on, so this only compiles because
    // `AttrsPatch` widens the value position with `| undefined`.
    const node = graph.updateNodeAttrs('a', { width: undefined });
    expectTypeOf(node).toEqualTypeOf<Node<NodeAttrs>>();
    expect('width' in node.attrs).toBe(false);
  });

  it('returns the same record type from both addNode forms', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    expectTypeOf(graph.addNode()).toEqualTypeOf<Node<NodeAttrs>>();
    expectTypeOf(graph.addNode('a')).toEqualTypeOf<Node<NodeAttrs>>();
    expectTypeOf(graph.addNode({ id: 'b' })).toEqualTypeOf<Node<NodeAttrs>>();
    expectTypeOf(graph.addEdge('a', 'b')).toEqualTypeOf<Edge<EdgeAttrs>>();
    expectTypeOf(graph.addEdge({ source: 'a', target: 'b' })).toEqualTypeOf<Edge<EdgeAttrs>>();
    expect(graph.nodeCount).toBe(3);
  });

  it('types ports independently of the attribute parameters', () => {
    const graph: Typed = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    const node = graph.addNode({ id: 'a', ports: [{ id: 'p' }] });
    expectTypeOf(node.ports).toEqualTypeOf<readonly Port[]>();
    expectTypeOf(graph.ports('a')).toEqualTypeOf<readonly Port[]>();
    expectTypeOf(graph.getPort('a', 'p')).toEqualTypeOf<Port | undefined>();
    expectTypeOf(graph.addPort('a', { id: 'q' })).toEqualTypeOf<Node<NodeAttrs>>();
    expectTypeOf(graph.removePort('a', 'q')).toEqualTypeOf<Node<NodeAttrs>>();
    expect(node.ports.map((port) => port.direction)).toEqual(['inout']);
  });

  it('accepts attribute shapes declared as interfaces', () => {
    const graph = new Graph<InterfaceNodeAttrs, InterfaceEdgeAttrs, InterfaceGraphAttrs>();
    const node = graph.addNode({ id: 'a', attrs: { label: 'A', width: 12 } });
    graph.addNode('b');
    const edge = graph.addEdge({ source: 'a', target: 'b', attrs: { weight: 3 } });
    expectTypeOf(node).toEqualTypeOf<Node<InterfaceNodeAttrs>>();
    expectTypeOf(node.attrs.width).toEqualTypeOf<number | undefined>();
    expectTypeOf(edge.attrs.weight).toEqualTypeOf<number | undefined>();
    expectTypeOf(graph.attrs).toEqualTypeOf<ReadAttrs<InterfaceGraphAttrs>>();
    expect(graph.updateNodeAttrs('a', { width: 20 }).attrs.width).toBe(20);
    expect(graph.updateAttrs({ rankdir: 'LR' }).rankdir).toBe('LR');
  });

  it('accepts a partially parameterised Graph', () => {
    // Only the node attributes are named; the other two fall back to `Attrs`.
    const graph = new Graph<NodeAttrs>();
    graph.addNode({ id: 'a', attrs: { label: 'A' } });
    expectTypeOf(graph.requireNode('a').attrs.label).toEqualTypeOf<string | undefined>();
    expectTypeOf(graph.attrs).toEqualTypeOf<ReadAttrs<Attrs>>();
    expect(graph.requireNode('a').attrs.label).toBe('A');
  });
});
