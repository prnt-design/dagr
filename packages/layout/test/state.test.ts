import { describe, expect, it } from 'vitest';
import { addDummyNode, createLayoutState, reverseEdge } from '../src/index.js';
import type { LayoutEdgeInput, LayoutEdgeState, LayoutInput, LayoutNodeInput, LayoutState } from '../src/index.js';

/** Snapshot of the adjacency of `state`, as plain ids, for exact comparison. */
function adjacency(state: LayoutState): Record<string, { out: string[]; in: string[] }> {
  const snapshot: Record<string, { out: string[]; in: string[] }> = {};
  for (const node of state.nodes) {
    snapshot[node.id] = {
      out: (state.outEdges.get(node.id) ?? []).map((edge) => edge.id),
      in: (state.inEdges.get(node.id) ?? []).map((edge) => edge.id),
    };
  }
  return snapshot;
}

/** Two nodes and one edge between them. */
const pair: LayoutInput = {
  nodes: [
    { id: 'a', width: 20, height: 10 },
    { id: 'b', width: 20, height: 10 },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
};

describe('createLayoutState provenance', () => {
  it('marks every node from the input as real', () => {
    const state = createLayoutState(pair);
    expect(state.nodes.map((node) => node.kind)).toEqual(['real', 'real']);
  });

  it('leaves `of` undefined on every edge from the input', () => {
    const state = createLayoutState(pair);
    expect(state.edges.map((edge) => edge.of)).toEqual([undefined]);
  });

  it('starts every edge unreversed', () => {
    const state = createLayoutState(pair);
    expect(state.edges.map((edge) => edge.reversed)).toEqual([false]);
  });

  it('numbers edges by their position in the master list', () => {
    const state = createLayoutState(parallel);
    expect(state.edges.map((edge) => edge.index)).toEqual([0, 1, 2]);
  });
});

/**
 * Assert that every adjacency list of `state` holds exactly the edges that
 * currently point that way, in input order.
 *
 * This is the invariant `reverseEdge` has to maintain, checked structurally
 * rather than against hand-written expectations, so it holds for any graph.
 */
function expectConsistentAdjacency(state: LayoutState): void {
  const expectedOut = new Map<string, string[]>();
  const expectedIn = new Map<string, string[]>();
  for (const node of state.nodes) {
    expectedOut.set(node.id, []);
    expectedIn.set(node.id, []);
  }
  // state.edges is the input order, so walking it in order builds the
  // expected lists in input order too.
  for (const edge of state.edges) {
    expectedOut.get(edge.source)?.push(edge.id);
    expectedIn.get(edge.target)?.push(edge.id);
  }

  for (const node of state.nodes) {
    expect(state.outEdges.get(node.id)?.map((edge) => edge.id)).toEqual(expectedOut.get(node.id));
    expect(state.inEdges.get(node.id)?.map((edge) => edge.id)).toEqual(expectedIn.get(node.id));
  }
}

/** A diamond with parallel edges, so adjacency order is observable. */
const parallel: LayoutInput = {
  nodes: [
    { id: 'a', width: 10, height: 10 },
    { id: 'b', width: 10, height: 10 },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'a', target: 'b' },
    { id: 'e3', source: 'a', target: 'b' },
  ],
};

describe('reverseEdge', () => {
  it('swaps the endpoints and flags the edge', () => {
    const state = createLayoutState(pair);
    const edge = state.edges[0];
    if (edge === undefined) {
      throw new Error('missing edge');
    }

    reverseEdge(state, edge);

    expect(edge.source).toBe('b');
    expect(edge.target).toBe('a');
    expect(edge.reversed).toBe(true);
    expect(edge.id).toBe('e');
  });

  it('moves the record between the adjacency lists', () => {
    const state = createLayoutState(pair);
    const edge = state.edges[0];
    if (edge === undefined) {
      throw new Error('missing edge');
    }

    reverseEdge(state, edge);

    expect(adjacency(state)).toEqual({
      a: { out: [], in: ['e'] },
      b: { out: ['e'], in: [] },
    });
    expect(state.outEdges.get('b')?.[0]).toBe(edge);
    expect(state.inEdges.get('a')?.[0]).toBe(edge);
    // The master edge list keeps its input order and its records.
    expect(state.edges.map((each) => each.id)).toEqual(['e']);
  });

  it('restores the state exactly when reversed twice, adjacency order included', () => {
    const state = createLayoutState(parallel);
    const before = adjacency(state);
    const middle = state.edges[1];
    if (middle === undefined) {
      throw new Error('missing edge');
    }

    reverseEdge(state, middle);
    expect(adjacency(state)).not.toEqual(before);

    reverseEdge(state, middle);

    expect(adjacency(state)).toEqual(before);
    expect(middle.reversed).toBe(false);
    expect(middle.source).toBe('a');
    expect(middle.target).toBe('b');
  });

  it('keeps the reversed edge in input order inside its new lists', () => {
    const state = createLayoutState(parallel);
    const first = state.edges[0];
    const middle = state.edges[1];
    if (first === undefined || middle === undefined) {
      throw new Error('missing edge');
    }

    reverseEdge(state, first);
    reverseEdge(state, middle);

    // Both moved lists stay sorted the way the input listed the edges.
    expect(adjacency(state)).toEqual({
      a: { out: ['e3'], in: ['e1', 'e2'] },
      b: { out: ['e1', 'e2'], in: ['e3'] },
    });
  });

  it('keeps every adjacency list in input order across many reversals', () => {
    // A hub of degree 400 plus 200 low-degree leaves, with the hub edges
    // interleaved in the master list, so placing one record correctly needs
    // the whole list ordering, not just an append.
    const nodes: LayoutNodeInput[] = [{ id: 'hub', width: 10, height: 10 }];
    const edges: LayoutEdgeInput[] = [];
    for (let i = 0; i < 200; i += 1) {
      nodes.push({ id: `leaf${i}`, width: 10, height: 10 });
      edges.push({ id: `out${i}`, source: 'hub', target: `leaf${i}` });
      edges.push({ id: `in${i}`, source: `leaf${i}`, target: 'hub' });
    }
    const state = createLayoutState({ nodes, edges });

    for (const edge of state.edges) {
      if (edge.index % 3 === 0) {
        reverseEdge(state, edge);
      }
    }
    expectConsistentAdjacency(state);

    // Reversing everything back leaves the state exactly as it started.
    const before = adjacency(createLayoutState({ nodes, edges }));
    for (const edge of state.edges) {
      if (edge.index % 3 === 0) {
        reverseEdge(state, edge);
      }
    }
    expect(adjacency(state)).toEqual(before);
  });

  it('moves a record without reading the master edge list', () => {
    // The cost property behind the input-order guarantee: placing a record
    // must cost the degree of the two nodes involved, not the size of the
    // graph, or cycle breaking over E edges is quadratic. Counting reads of
    // state.edges says that without timing anything.
    const nodes: LayoutNodeInput[] = [];
    const edges: LayoutEdgeInput[] = [];
    for (let i = 0; i < 500; i += 1) {
      nodes.push({ id: `n${i}`, width: 10, height: 10 });
    }
    for (let i = 0; i < 499; i += 1) {
      edges.push({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` });
    }
    const state = createLayoutState({ nodes, edges });
    const victims = [state.edges[0], state.edges[250], state.edges[498]];

    let reads = 0;
    const watched = new Proxy(state.edges, {
      get(target, property, receiver): unknown {
        reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    Object.defineProperty(state, 'edges', { value: watched, configurable: true });

    for (const edge of victims) {
      if (edge === undefined) {
        throw new Error('missing edge');
      }
      reverseEdge(state, edge);
    }

    expect(reads).toBe(0);
  });

  it('places an edge a stage appended after the input edges', () => {
    const state = createLayoutState(parallel);
    // A stage-created record numbers itself with the master list length.
    const extra: LayoutEdgeState = {
      id: 'extra',
      index: state.edges.length,
      source: 'a',
      target: 'b',
      of: undefined,
      reversed: false,
      points: [],
    };
    state.edges.push(extra);
    state.outEdges.get('a')?.push(extra);
    state.inEdges.get('b')?.push(extra);

    const first = state.edges[0];
    if (first === undefined) {
      throw new Error('missing edge');
    }
    reverseEdge(state, extra);
    reverseEdge(state, first);
    expectConsistentAdjacency(state);

    reverseEdge(state, extra);
    expectConsistentAdjacency(state);
    expect(state.outEdges.get('a')?.map((edge) => edge.id)).toEqual(['e2', 'e3', 'extra']);
  });

  it('survives a self loop', () => {
    const loop: LayoutInput = {
      nodes: [{ id: 'a', width: 10, height: 10 }],
      edges: [{ id: 'loop', source: 'a', target: 'a' }],
    };
    const state = createLayoutState(loop);
    const edge = state.edges[0];
    if (edge === undefined) {
      throw new Error('missing edge');
    }

    reverseEdge(state, edge);

    expect(edge.source).toBe('a');
    expect(edge.target).toBe('a');
    expect(edge.reversed).toBe(true);
    expect(adjacency(state)).toEqual({ a: { out: ['loop'], in: ['loop'] } });

    reverseEdge(state, edge);
    expect(edge.reversed).toBe(false);
    expect(adjacency(state)).toEqual({ a: { out: ['loop'], in: ['loop'] } });
  });
});

describe('addDummyNode', () => {
  it('appends a dummy node carrying the requested size and rank', () => {
    const state = createLayoutState(pair);
    const dummy = addDummyNode(state, { width: 1, height: 2, rank: 3 });

    expect(dummy.kind).toBe('dummy');
    expect(dummy.width).toBe(1);
    expect(dummy.height).toBe(2);
    expect(dummy.rank).toBe(3);
    expect(state.nodes).toHaveLength(3);
    expect(state.nodes[2]).toBe(dummy);
  });

  it('defaults to a zero-sized, unranked node', () => {
    const state = createLayoutState(pair);
    const dummy = addDummyNode(state, {});

    expect(dummy.width).toBe(0);
    expect(dummy.height).toBe(0);
    expect(dummy.rank).toBeUndefined();
    expect(dummy.order).toBeUndefined();
    expect(dummy.x).toBeUndefined();
    expect(dummy.y).toBeUndefined();
  });

  it('registers the dummy in the lookup and both adjacency maps', () => {
    const state = createLayoutState(pair);
    const dummy = addDummyNode(state, {});

    expect(state.nodesById.get(dummy.id)).toBe(dummy);
    expect(state.outEdges.get(dummy.id)).toEqual([]);
    expect(state.inEdges.get(dummy.id)).toEqual([]);
  });

  it('never returns an id a caller node already occupies', () => {
    // The name search starts at the current node count, so with three nodes
    // "dummy:3" is the name a naive counter would hand out: squat it.
    const squatters: LayoutInput = {
      nodes: [
        { id: 'a', width: 1, height: 1 },
        { id: 'b', width: 1, height: 1 },
        { id: 'dummy:3', width: 1, height: 1 },
      ],
      edges: [{ id: 'e', source: 'a', target: 'dummy:3' }],
    };
    const state = createLayoutState(squatters);
    const squatter = state.nodesById.get('dummy:3');

    const first = addDummyNode(state, {});
    const second = addDummyNode(state, {});

    expect(first.id).not.toBe('dummy:3');
    expect(first.id).not.toBe(second.id);

    const ids = state.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.nodesById.size).toBe(5);

    // The caller's node, its lookup entry and its adjacency all survive.
    expect(state.nodesById.get('dummy:3')).toBe(squatter);
    expect(squatter?.kind).toBe('real');
    expect(state.inEdges.get('dummy:3')?.map((edge) => edge.id)).toEqual(['e']);
  });

  it('hands out ids without restarting the search over a squatted block', () => {
    // A caller block of names sitting exactly where the search begins. A
    // search that restarts from scratch every call rescans the whole block
    // each time, which is quadratic in the size of the block.
    const size = 300;
    const nodes: LayoutNodeInput[] = [];
    for (let i = 0; i < size; i += 1) {
      nodes.push({ id: `dummy:${size + i}`, width: 1, height: 1 });
    }
    const state = createLayoutState({ nodes, edges: [] });

    const added: string[] = [];
    for (let i = 0; i < size; i += 1) {
      added.push(addDummyNode(state, {}).id);
    }

    expect(new Set(added).size).toBe(size);
    expect(state.nodesById.size).toBe(2 * size);

    // Every id is fresh and the numbers only ever go up, which is what says
    // the search resumed where it left off instead of starting over.
    const numbers = added.map((id) => Number(id.slice('dummy:'.length)));
    expect(numbers.every((value) => Number.isInteger(value))).toBe(true);
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1] ?? Number.NaN);
    }
    // The whole squatted block was walked at most once, so the last id sits
    // just past it rather than a block-length beyond.
    expect(numbers[numbers.length - 1]).toBeLessThan(4 * size);
  });

  it('probes a squatted block once in total, not once per call', () => {
    // The cost property: adding n dummies over a block of s squatted names
    // must cost O(n + s) id probes, not O(n * s). Counting the lookups says
    // that without timing anything.
    const size = 200;
    const nodes: LayoutNodeInput[] = [];
    for (let i = 0; i < size; i += 1) {
      nodes.push({ id: `dummy:${size + i}`, width: 1, height: 1 });
    }
    const state = createLayoutState({ nodes, edges: [] });

    let probes = 0;
    const lookup = state.nodesById;
    const has = lookup.has.bind(lookup);
    lookup.has = (id: string): boolean => {
      probes += 1;
      return has(id);
    };

    for (let i = 0; i < size; i += 1) {
      addDummyNode(state, {});
    }

    // Linear in (dummies + squatters) with room to spare. A search that
    // restarts every call costs about size * size, which is 40000 here.
    expect(probes).toBeLessThan(4 * size);
  });

  it('rejects a negative or non-finite size', () => {
    const state = createLayoutState(pair);
    expect(() => addDummyNode(state, { width: -1 })).toThrow(/INVALID|width/);
    expect(() => addDummyNode(state, { height: Number.NaN })).toThrow(/INVALID|height/);
  });
});

