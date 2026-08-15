import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import {
  DeltaMismatchError,
  InvalidConfigError,
  applyDelta,
  diffLayout,
  isEmptyDelta,
  layout,
} from '../src/index.js';
import type { LayoutResult, Point, PositionedNode, Rect, RoutedEdge } from '../src/index.js';
import { mulberry32, randomDigraph } from './random.js';

/**
 * A result built by hand, so that a test can say exactly what moved.
 *
 * Hand-built rather than laid out, for the cases that are about the diff and
 * not about the pipeline: a real run cannot be asked for two results that
 * differ in one coordinate and nothing else, and a test that nudges a graph
 * until it does is testing the position stage.
 *
 * `bounds` is whatever the caller of this helper says it is, including a box
 * that does not contain the drawing. The diff never recomputes bounds, it
 * compares the two it was handed, and a helper that quietly computed the right
 * box would hide that.
 */
function resultOf(
  nodes: readonly PositionedNode[],
  edges: readonly RoutedEdge[],
  bounds: Rect,
): LayoutResult {
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
    bounds,
  };
}

/** A node box at a centre, sized 100 by 40 unless the test says otherwise. */
function node(id: NodeId, x: number, y: number, width = 100, height = 40): PositionedNode {
  return { id, x, y, width, height };
}

/** A two-point route between two centres. */
function edge(id: EdgeId, source: NodeId, target: NodeId, points: readonly Point[]): RoutedEdge {
  return { id, source, target, points };
}

const ZERO: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** The ids in a group, so an expectation reads as a list rather than as objects. */
function idsOf(entries: readonly { readonly id: string }[]): readonly string[] {
  return entries.map((entry) => entry.id);
}

/**
 * Every node and edge of a result as plain data, key order thrown away.
 *
 * The round-trip property is about geometry rather than about iteration order,
 * and it has to be: `applyDelta` works from the previous result and the delta,
 * neither of which knows what order the next result's maps happened to be built
 * in. It appends what was added to what survived, which is the order a consumer
 * applying deltas has anyway. See `applyDelta`'s docstring.
 */
function geometryOf(result: LayoutResult) {
  return {
    nodes: [...result.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...result.edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
    bounds: result.bounds,
  };
}

describe('diffLayout', () => {
  it('reports nothing when a result is diffed against itself', () => {
    const result = resultOf(
      [node('a', 0, 0), node('b', 200, 100)],
      [edge('ab', 'a', 'b', [{ x: 0, y: 20 }, { x: 200, y: 80 }])],
      { x: -50, y: -20, width: 300, height: 140 },
    );
    const delta = diffLayout(result, result);
    expect(delta.nodes).toEqual({ added: [], removed: [], moved: [] });
    expect(delta.edges).toEqual({ added: [], removed: [], rerouted: [] });
    expect(delta.bounds).toBeUndefined();
    expect(isEmptyDelta(delta)).toBe(true);
  });

  it('reports an added node with its whole box, and a removed one by id alone', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('b', 10, 20, 60, 30)], [], ZERO);
    const delta = diffLayout(before, after);
    expect(delta.nodes.added).toEqual([{ id: 'b', x: 10, y: 20, width: 60, height: 30 }]);
    expect(delta.nodes.removed).toEqual(['a']);
    expect(delta.nodes.moved).toEqual([]);
    expect(isEmptyDelta(delta)).toBe(false);
  });

  it('reports a move as the box before and the box after', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('a', 10, 0)], [], ZERO);
    expect(diffLayout(before, after).nodes.moved).toEqual([
      {
        id: 'a',
        from: { x: 0, y: 0, width: 100, height: 40 },
        to: { x: 10, y: 0, width: 100, height: 40 },
      },
    ]);
  });

  // A node whose label grew measures wider on the next run and its centre need
  // not move at all. Absent from the delta, a consumer applying deltas draws
  // the old size forever, which is the same desynchronisation a dropped move
  // is, arriving through a field nobody thought of as motion.
  it('counts a node that only changed size as moved', () => {
    const before = resultOf([node('a', 0, 0, 100, 40)], [], ZERO);
    const after = resultOf([node('a', 0, 0, 140, 40)], [], ZERO);
    const moved = diffLayout(before, after).nodes.moved;
    expect(idsOf(moved)).toEqual(['a']);
    expect(moved[0]?.from.width).toBe(100);
    expect(moved[0]?.to.width).toBe(140);
  });

  it('reports an added edge with its route, a removed one by id, and a reroute both ways', () => {
    const before = resultOf(
      [node('a', 0, 0), node('b', 0, 100), node('c', 0, 200)],
      [
        edge('ab', 'a', 'b', [{ x: 0, y: 20 }, { x: 0, y: 80 }]),
        edge('bc', 'b', 'c', [{ x: 0, y: 120 }, { x: 0, y: 180 }]),
      ],
      ZERO,
    );
    const after = resultOf(
      [node('a', 0, 0), node('b', 0, 100), node('c', 0, 200)],
      [
        edge('ab', 'a', 'b', [{ x: 0, y: 20 }, { x: 5, y: 50 }, { x: 0, y: 80 }]),
        edge('ac', 'a', 'c', [{ x: 0, y: 20 }, { x: 0, y: 180 }]),
      ],
      ZERO,
    );
    const delta = diffLayout(before, after);
    expect(idsOf(delta.edges.added)).toEqual(['ac']);
    expect(delta.edges.added[0]?.source).toBe('a');
    expect(delta.edges.removed).toEqual(['bc']);
    expect(idsOf(delta.edges.rerouted)).toEqual(['ab']);
    expect(delta.edges.rerouted[0]?.from).toHaveLength(2);
    expect(delta.edges.rerouted[0]?.to).toHaveLength(3);
  });

  // An edge id is the caller's, and nothing stops a patch removing `e1` from
  // `a` to `b` and adding `e1` from `a` to `c` between two runs. Reported as a
  // reroute, `applyDelta` would keep the old endpoints under the new polyline
  // and a consumer would draw an edge that agrees with no graph.
  it('treats an edge id whose endpoints changed as a removal and an addition', () => {
    const before = resultOf(
      [node('a', 0, 0), node('b', 0, 100), node('c', 200, 100)],
      [edge('e1', 'a', 'b', [{ x: 0, y: 20 }, { x: 0, y: 80 }])],
      ZERO,
    );
    const after = resultOf(
      [node('a', 0, 0), node('b', 0, 100), node('c', 200, 100)],
      [edge('e1', 'a', 'c', [{ x: 0, y: 20 }, { x: 200, y: 80 }])],
      ZERO,
    );
    const delta = diffLayout(before, after);
    expect(delta.edges.removed).toEqual(['e1']);
    expect(idsOf(delta.edges.added)).toEqual(['e1']);
    expect(delta.edges.rerouted).toEqual([]);
    // The one case where an id is in two groups of one delta, so it is the one
    // case that pins the order the groups have to be applied in: additions
    // last, or the edge that just arrived is deleted by its own removal.
    expect(geometryOf(applyDelta(before, delta))).toEqual(geometryOf(after));
  });

  it('reports the bounds before and after when they changed, and nothing when they did not', () => {
    const box: Rect = { x: 0, y: 0, width: 100, height: 40 };
    const same = diffLayout(resultOf([node('a', 0, 0)], [], box), resultOf([node('a', 0, 0)], [], box));
    expect(same.bounds).toBeUndefined();
    const grown = diffLayout(
      resultOf([node('a', 0, 0)], [], box),
      resultOf([node('a', 0, 0)], [], { x: 0, y: 0, width: 200, height: 40 }),
    );
    expect(grown.bounds).toEqual({ from: box, to: { x: 0, y: 0, width: 200, height: 40 } });
  });

  // Deterministic, and in an order a consumer can rely on rather than in
  // whichever order the comparison happened to notice things: the next result
  // decides for added and moved, the previous one for removed, and both iterate
  // in graph insertion order.
  it('lists each group in the order of the result it came from', () => {
    const before = resultOf([node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)], [], ZERO);
    const after = resultOf([node('c', 1, 0), node('b', 1, 0), node('d', 0, 0), node('e', 0, 0)], [], ZERO);
    const delta = diffLayout(before, after);
    expect(idsOf(delta.nodes.moved)).toEqual(['c', 'b']);
    expect(idsOf(delta.nodes.added)).toEqual(['d', 'e']);
    expect(delta.nodes.removed).toEqual(['a']);
  });
});

describe('diffLayout tolerance', () => {
  it('reports a move at epsilon zero however small it is', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('a', Number.MIN_VALUE, 0)], [], ZERO);
    expect(diffLayout(before, after).nodes.moved).toHaveLength(1);
  });

  it('drops a move, a reroute and a bounds change that are all within epsilon', () => {
    const before = resultOf(
      [node('a', 0, 0)],
      [edge('aa', 'a', 'a', [{ x: 0, y: 0 }, { x: 10, y: 10 }])],
      { x: 0, y: 0, width: 100, height: 40 },
    );
    const after = resultOf(
      [node('a', 0.4, 0)],
      [edge('aa', 'a', 'a', [{ x: 0.4, y: 0 }, { x: 10, y: 10.4 }])],
      { x: 0.4, y: 0, width: 100, height: 40 },
    );
    const delta = diffLayout(before, after, { epsilon: 0.5 });
    expect(isEmptyDelta(delta)).toBe(true);
  });

  it('reports a move past epsilon, and reports the whole box when it does', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('a', 0.6, 0)], [], ZERO);
    const moved = diffLayout(before, after, { epsilon: 0.5 }).nodes.moved;
    expect(moved).toHaveLength(1);
    expect(moved[0]?.to).toEqual({ x: 0.6, y: 0, width: 100, height: 40 });
  });

  it('reports a reroute when the point count changed, whatever epsilon says', () => {
    const before = resultOf([], [edge('e', 'a', 'b', [{ x: 0, y: 0 }, { x: 10, y: 10 }])], ZERO);
    const after = resultOf(
      [],
      [edge('e', 'a', 'b', [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }])],
      ZERO,
    );
    expect(diffLayout(before, after, { epsilon: 1000 }).edges.rerouted).toHaveLength(1);
  });

  it('refuses an epsilon that is not a finite number that is zero or greater', () => {
    const result = resultOf([node('a', 0, 0)], [], ZERO);
    for (const epsilon of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => diffLayout(result, result, { epsilon })).toThrow(InvalidConfigError);
    }
    expect(() => diffLayout(result, result, { epsilon: 0 })).not.toThrow();
  });

  // The design consequence the M3.1 entry records: a threshold on a diff is not
  // transitive. Fifty steps of 0.9 epsilon each report nothing individually, so
  // a consumer diffing against the last COMPUTED geometry ends 45 epsilon out
  // of position with nothing in the system able to notice. Diffing against the
  // last REPORTED geometry, which is what an engine retaining a snapshot does,
  // holds the error under epsilon forever and eventually reports the move.
  it('keeps a consumer within epsilon only when the diff is against reported geometry', () => {
    const epsilon = 1;
    const step = 0.9;
    let computed = resultOf([node('a', 0, 0)], [], ZERO);
    let reported = computed;
    let consumerX = 0;
    let naiveX = 0;
    for (let index = 0; index < 50; index += 1) {
      const next = resultOf([node('a', (index + 1) * step, 0)], [], ZERO);
      const naive = diffLayout(computed, next, { epsilon });
      naiveX = naive.nodes.moved[0]?.to.x ?? naiveX;
      const honest = diffLayout(reported, next, { epsilon });
      if (!isEmptyDelta(honest)) {
        reported = applyDelta(reported, honest);
        consumerX = honest.nodes.moved[0]?.to.x ?? consumerX;
      }
      computed = next;
    }
    const trueX = 50 * step;
    expect(Math.abs(naiveX - trueX)).toBeGreaterThan(40);
    expect(Math.abs(consumerX - trueX)).toBeLessThanOrEqual(epsilon);
  });
});

describe('applyDelta', () => {
  it('reproduces the next result exactly at epsilon zero', () => {
    const before = resultOf(
      [node('a', 0, 0), node('b', 200, 100)],
      [edge('ab', 'a', 'b', [{ x: 0, y: 20 }, { x: 200, y: 80 }])],
      { x: -50, y: -20, width: 300, height: 140 },
    );
    const after = resultOf(
      [node('b', 210, 100), node('c', 0, 300, 60, 20)],
      [edge('bc', 'b', 'c', [{ x: 210, y: 120 }, { x: 0, y: 290 }])],
      { x: -30, y: 80, width: 290, height: 230 },
    );
    expect(geometryOf(applyDelta(before, diffLayout(before, after)))).toEqual(geometryOf(after));
  });

  it('leaves the previous result untouched', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('a', 10, 0), node('b', 0, 0)], [], ZERO);
    applyDelta(before, diffLayout(before, after));
    expect(before.nodes.size).toBe(1);
    expect(before.nodes.get('a')?.x).toBe(0);
  });

  it('lands within epsilon of the next result when a move was dropped', () => {
    const before = resultOf([node('a', 0, 0)], [], ZERO);
    const after = resultOf([node('a', 0.4, 0)], [], ZERO);
    const applied = applyDelta(before, diffLayout(before, after, { epsilon: 0.5 }));
    expect(applied.nodes.get('a')?.x).toBe(0);
    expect(Math.abs((applied.nodes.get('a')?.x ?? 0) - 0.4)).toBeLessThanOrEqual(0.5);
  });

  // The desynchronisation symptom, made loud. A delta applied to the wrong
  // result is the one failure the delta type cannot rule out, and silence here
  // is a scene that is wrong with nothing able to notice.
  it('refuses a delta that does not fit the result it is applied to', () => {
    const one = resultOf([node('a', 0, 0)], [], ZERO);
    const two = resultOf([node('a', 10, 0), node('b', 0, 0)], [], ZERO);
    const delta = diffLayout(one, two);
    expect(() => applyDelta(two, delta)).toThrow(DeltaMismatchError);
    const removal = diffLayout(one, resultOf([], [], ZERO));
    expect(() => applyDelta(resultOf([], [], ZERO), removal)).toThrow(DeltaMismatchError);
  });

  it('names what did not fit', () => {
    const delta = diffLayout(resultOf([node('a', 0, 0)], [], ZERO), resultOf([node('a', 9, 0)], [], ZERO));
    let thrown: unknown;
    try {
      applyDelta(resultOf([], [], ZERO), delta);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeltaMismatchError);
    expect((thrown as DeltaMismatchError).id).toBe('a');
    expect((thrown as DeltaMismatchError).message).toContain('a');
  });
});

describe('deltas over real layout runs', () => {
  /** The three-node fan the rest of the suite builds its graphs from. */
  function fanOut(): Graph {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('a', 'c', 'ac');
    return graph;
  }

  it('reports nothing between two runs of the same graph', () => {
    const graph = fanOut();
    expect(isEmptyDelta(diffLayout(layout({ graph }), layout({ graph })))).toBe(true);
  });

  it('reports the new node and its edge when one is added', () => {
    const graph = fanOut();
    const before = layout({ graph });
    graph.addNode('d');
    graph.addEdge('b', 'd', 'bd');
    const delta = diffLayout(before, layout({ graph }));
    expect(idsOf(delta.nodes.added)).toEqual(['d']);
    expect(idsOf(delta.edges.added)).toEqual(['bd']);
    expect(delta.nodes.removed).toEqual([]);
  });

  it('round trips a run of a random graph through a patch and back', () => {
    const random = mulberry32(0x5eed);
    for (let trial = 0; trial < 40; trial += 1) {
      const graph = randomDigraph(random);
      const before = layout({ graph });
      const ids = graph.nodes().map((each) => each.id);
      const victim = ids[Math.floor(random() * ids.length)];
      if (victim === undefined) {
        // The generator draws the empty graph deliberately, and a diff over two
        // empty results is a case worth landing on rather than skipping past.
        expect(isEmptyDelta(diffLayout(before, layout({ graph })))).toBe(true);
        continue;
      }
      graph.removeNode(victim);
      graph.addNode('added');
      const after = layout({ graph });
      const delta = diffLayout(before, after);
      expect(delta.nodes.removed).toContain(victim);
      expect(geometryOf(applyDelta(before, delta))).toEqual(geometryOf(after));
    }
  });
});
