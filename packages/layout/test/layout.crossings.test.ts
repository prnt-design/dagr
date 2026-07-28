import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { countCrossings } from '../src/order.js';
import { mulberry32 } from './random.js';
import type { NodeId } from '@dagr/graph';

/**
 * What `countCrossings` counts, checked twice over: by hand on graphs small
 * enough to draw in the comment above each one, and against an independent
 * second solver on random layerings.
 *
 * The second solver is the whole point of this file. The shipping counter is
 * the Barth, Junger and Mutzel accumulator tree, which sorts each gap's
 * segments and counts inversions through a binary tree, and a bug in it is an
 * off-by-one in an index nobody can check by reading. The brute-force pair loop
 * below is the definition itself, one comparison per pair of segments, too slow
 * to ship and too simple to get wrong. Agreement between the two on hundreds of
 * random layerings is the evidence; the hand counts are what say the definition
 * being agreed on is the right one.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(
  nodes: readonly string[],
  edges: readonly (readonly [string, string])[],
): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/**
 * The definition, one comparison per pair of segments in a gap.
 *
 * A segment is an edge whose endpoints sit in two ADJACENT layers, drawn from
 * its position in the upper layer to its position in the lower one. Two of them
 * cross when one starts left of the other and ends right of it, which is what
 * the sign of the product says. Equality either end means they share an
 * endpoint, and the product is then zero: they touch, they do not cross.
 */
function pairLoopCrossings(graph: Graph, layers: readonly (readonly NodeId[])[]): number {
  const layerOf = new Map<NodeId, number>();
  const indexOf = new Map<NodeId, number>();
  for (const [layer, ids] of layers.entries()) {
    for (const [index, id] of ids.entries()) {
      layerOf.set(id, layer);
      indexOf.set(id, index);
    }
  }
  const gaps = new Map<number, [number, number][]>();
  for (const edge of graph.edges()) {
    const from = layerOf.get(edge.source);
    const to = layerOf.get(edge.target);
    if (from === undefined || to === undefined) continue;
    if (Math.abs(from - to) !== 1) continue;
    const upper = from < to ? edge.source : edge.target;
    const lower = from < to ? edge.target : edge.source;
    const gap = Math.min(from, to);
    const segments = gaps.get(gap) ?? [];
    segments.push([indexOf.get(upper) ?? 0, indexOf.get(lower) ?? 0]);
    gaps.set(gap, segments);
  }
  let crossings = 0;
  for (const segments of gaps.values()) {
    for (const [index, one] of segments.entries()) {
      for (const other of segments.slice(index + 1)) {
        if ((one[0] - other[0]) * (one[1] - other[1]) < 0) crossings += 1;
      }
    }
  }
  return crossings;
}

/** A random layering of `count` nodes over `depth` layers, empties included. */
function randomLayering(
  random: () => number,
  count: number,
  depth: number,
): { graph: Graph; layers: NodeId[][] } {
  const graph = new Graph();
  const layers: NodeId[][] = Array.from({ length: depth }, () => []);
  for (let index = 0; index < count; index += 1) {
    const id = graph.addNode(`v${String(index)}`).id;
    layers[Math.floor(random() * depth)]?.push(id);
  }
  const ids = graph.nodes().map((node) => node.id);
  const edgeCount = Math.floor(random() * (count * 3 + 1));
  for (let index = 0; index < edgeCount; index += 1) {
    const source = ids[Math.floor(random() * ids.length)];
    const target = ids[Math.floor(random() * ids.length)];
    if (source === undefined || target === undefined) continue;
    graph.addEdge(source, target);
  }
  return { graph, layers };
}

describe('countCrossings', () => {
  /**
   * K2,2 both ways up. Two layers of two, every node of the first joined to
   * every node of the second, so the drawing is fixed and only the order
   * changes: `a c` over `b d` with `a -> d` and `c -> b` crosses once, and
   * swapping the lower layer uncrosses it.
   */
  it('counts the one crossing in K2,2, and none in the uncrossed order', () => {
    const graph = build(
      ['a', 'c', 'b', 'd'],
      [
        ['a', 'd'],
        ['c', 'b'],
      ],
    );
    expect(countCrossings({ graph, layers: [['a', 'c'], ['b', 'd']] })).toBe(1);
    expect(countCrossings({ graph, layers: [['a', 'c'], ['d', 'b']] })).toBe(0);
  });

  /**
   * Two segments that share an endpoint touch rather than cross. Both edges
   * leave `a`, so whatever the lower layer's order, the drawing is a V and a V
   * has no crossing in it.
   */
  it('does not count two segments that share an endpoint', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'c'],
        ['a', 'b'],
      ],
    );
    expect(countCrossings({ graph, layers: [['a'], ['b', 'c']] })).toBe(0);
    expect(countCrossings({ graph, layers: [['a'], ['c', 'b']] })).toBe(0);
  });

  /**
   * Three layers, counted by hand a gap at a time. Top gap: `a -> e` and
   * `b -> d` cross, `a -> d` runs alongside `a -> e` from the same node and
   * `c -> f` is to the right of everything, so one crossing. Bottom gap:
   * `d -> h` and `e -> g` cross, `f -> i` again to the right, so one more.
   * Two in total, and the counter has to add the gaps rather than the layers.
   */
  it('adds up the crossings of a three-layer drawing', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      [
        ['a', 'e'],
        ['a', 'd'],
        ['b', 'd'],
        ['c', 'f'],
        ['d', 'h'],
        ['e', 'g'],
        ['f', 'i'],
      ],
    );
    const layers = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ];
    expect(countCrossings({ graph, layers })).toBe(2);
  });

  /**
   * An edge whose endpoints are more than one layer apart is invisible, and so
   * is a self loop, which spans none. This is the honest limit of the metric
   * rather than an oversight: a crossing is only defined between two segments
   * joining the same pair of adjacent layers. Both edges here would cross
   * something if a longer edge were a chain of segments, which is what M2.4b
   * makes it.
   */
  it('sees neither a long edge nor a self loop', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'd'],
        ['b', 'b'],
      ],
    );
    const layers = [['a', 'b'], ['c'], ['d']];
    expect(countCrossings({ graph, layers })).toBe(0);
  });

  /** Parallel edges between the same two nodes lie on top of each other. */
  it('does not count parallel edges as crossing each other', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['a', 'b'],
      ],
    );
    expect(countCrossings({ graph, layers: [['a'], ['b']] })).toBe(0);
  });

  /** An edge ranked the other way up still joins the same two layers. */
  it('counts a segment whose edge runs up the page', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['d', 'a'],
        ['c', 'b'],
      ],
    );
    expect(countCrossings({ graph, layers: [['a', 'b'], ['c', 'd']] })).toBe(1);
  });

  it('agrees with the pair loop on random layerings', () => {
    const random = mulberry32(0xc0ffee);
    for (const [count, depth] of [
      [0, 1],
      [1, 1],
      [2, 3],
      [5, 2],
      [12, 4],
      [30, 6],
      [60, 3],
    ] as const) {
      for (let run = 0; run < 40; run += 1) {
        const { graph, layers } = randomLayering(random, count, depth);
        expect(countCrossings({ graph, layers })).toBe(pairLoopCrossings(graph, layers));
      }
    }
  });

  /**
   * The same agreement, on layerings that hold empty and single-node layers.
   *
   * Sized so that those layers coexist with crossings to count, which is the
   * whole difficulty of the case: an empty layer is easiest to produce by
   * spreading few nodes over many layers, and few nodes over many layers is
   * also how you produce a gap with nothing in it to cross. Six nodes over
   * eight layers put an empty layer in all 60 runs and 2 crossings in the whole
   * loop, with 58 of the 60 agreeing that the answer was zero, which is two
   * implementations agreeing on nothing.
   *
   * 40 over 12 is where both happen. It is not every run, so the counts are
   * over the loop rather than over each run: 18 of the 60 have an empty layer,
   * 49 have a layer of one, and 32 count something. The three totals are pinned
   * exactly, because "an empty layer turned up at least once" is the assertion
   * that quietly stops being worth anything if the generator drifts.
   */
  it('agrees with the pair loop when a layer is empty or holds one node', () => {
    const random = mulberry32(7);
    let crossings = 0;
    let empty = 0;
    let single = 0;
    for (let run = 0; run < 60; run += 1) {
      const { graph, layers } = randomLayering(random, 40, 12);
      if (layers.some((layer) => layer.length === 0)) empty += 1;
      if (layers.some((layer) => layer.length === 1)) single += 1;
      const counted = countCrossings({ graph, layers });
      expect(counted).toBe(pairLoopCrossings(graph, layers));
      crossings += counted;
    }
    expect(empty).toBe(18);
    expect(single).toBe(49);
    expect(crossings).toBe(128);
  });
});
