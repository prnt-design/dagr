import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId, Patch } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import {
  InvalidConfigError,
  createLayout,
  layout,
  measureStability,
  stabilityViolations,
} from '../src/index.js';
import type {
  InfluenceSet,
  LayoutResult,
  Point,
  PositionedNode,
  Rect,
  RoutedEdge,
} from '../src/index.js';
import { expectStable, expectStabilityWithin } from './stability.js';

/**
 * A result built by hand, so a test can say exactly what moved.
 *
 * Same helper `layout.delta.test.ts` uses and for the same reason: the metrics
 * are about two results, and a real run cannot be asked for two results that
 * differ in one coordinate and nothing else. The tests that need a real drawing
 * run the pipeline, at the bottom of this file.
 */
function resultOf(
  nodes: readonly PositionedNode[],
  edges: readonly RoutedEdge[],
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 },
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

/** An edge with the polyline the test cares about. */
function edge(id: EdgeId, source: NodeId, target: NodeId, points: readonly Point[]): RoutedEdge {
  return { id, source, target, points };
}

/** An influence set from two lists, so a test can name what was allowed to move. */
function influenceOf(nodes: readonly NodeId[], edges: readonly EdgeId[] = []): InfluenceSet {
  return { nodes: new Set(nodes), edges: new Set(edges) };
}

describe('measureStability, over the nodes', () => {
  it('reports nothing moved when a result is measured against itself', () => {
    const result = resultOf([node('a', 0, 0), node('b', 200, 100)], []);

    const report = measureStability(result, result);

    expect(report.nodes).toEqual({
      shared: 2,
      added: 0,
      removed: 0,
      moved: 0,
      movedFraction: 0,
      meanDisplacement: 0,
      maxDisplacement: 0,
      rankChurn: 0,
      orderChurn: 0,
    });
  });

  it('turns a known displacement into the known mean and max', () => {
    // One node walks a 3-4-5 triangle, the other stays where it was.
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 3, 4), node('b', 200, 0)], []);

    const report = measureStability(before, after);

    expect(report.nodes.moved).toBe(1);
    expect(report.nodes.movedFraction).toBe(0.5);
    expect(report.nodes.maxDisplacement).toBe(5);
    // Over the two nodes that are in both results, not over the one that moved.
    expect(report.nodes.meanDisplacement).toBe(2.5);
  });

  it('takes the mean over every shared node, so adding stationary nodes lowers it', () => {
    // The scoping decision, as a test rather than as a paragraph: an average
    // taken over the nodes that MOVED rises as a layout gets more stable,
    // because the small moves drop out of the set and only the big ones are
    // left to average. These two comparisons hold one move fixed and change
    // nothing but the size of the drawing around it.
    const twoBefore = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const twoAfter = resultOf([node('a', 3, 4), node('b', 200, 0)], []);
    const fourBefore = resultOf(
      [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0), node('d', 600, 0)],
      [],
    );
    const fourAfter = resultOf(
      [node('a', 3, 4), node('b', 200, 0), node('c', 400, 0), node('d', 600, 0)],
      [],
    );

    expect(measureStability(twoBefore, twoAfter).nodes.meanDisplacement).toBe(2.5);
    expect(measureStability(fourBefore, fourAfter).nodes.meanDisplacement).toBe(1.25);
  });

  it('counts a pure resize as moved and as no displacement at all', () => {
    const before = resultOf([node('a', 0, 0, 100, 40)], []);
    const after = resultOf([node('a', 0, 0, 180, 40)], []);

    const report = measureStability(before, after);

    expect(report.nodes.moved).toBe(1);
    expect(report.nodes.maxDisplacement).toBe(0);
    expect(report.nodes.meanDisplacement).toBe(0);
  });

  it('counts additions and removals outside the shared roster', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('b', 200, 0), node('c', 400, 0)], []);

    const report = measureStability(before, after);

    expect(report.nodes.added).toBe(1);
    expect(report.nodes.removed).toBe(1);
    expect(report.nodes.shared).toBe(1);
    expect(report.nodes.moved).toBe(0);
    expect(report.nodes.movedFraction).toBe(0);
  });

  it('reports zero rather than a division by zero when nothing is shared', () => {
    const before = resultOf([node('a', 0, 0)], []);
    const after = resultOf([node('b', 200, 0)], []);

    const report = measureStability(before, after);

    expect(report.nodes.shared).toBe(0);
    expect(report.nodes.movedFraction).toBe(0);
    expect(report.nodes.meanDisplacement).toBe(0);
    expect(report.nodes.rankChurn).toBe(0);
    expect(report.nodes.orderChurn).toBe(0);
  });

  it('is scoped by the epsilon the comparison was made at', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0.5, 0), node('b', 200, 0)], []);

    expect(measureStability(before, after).nodes.moved).toBe(1);
    expect(measureStability(before, after, { epsilon: 1 }).nodes.moved).toBe(0);
    expect(measureStability(before, after, { epsilon: 1 }).nodes.meanDisplacement).toBe(0);
  });

  it('refuses an epsilon that is not a measurement', () => {
    const result = resultOf([node('a', 0, 0)], []);

    expect(() => measureStability(result, result, { epsilon: -1 })).toThrow(InvalidConfigError);
    expect(() => measureStability(result, result, { epsilon: Number.NaN })).toThrow(
      InvalidConfigError,
    );
  });
});

describe('measureStability, over the ranks', () => {
  it('reads a rank off the centre line the nodes of a row share', () => {
    // Three rows of two. `c` drops from the middle row to the bottom one.
    const before = resultOf(
      [
        node('a', 0, 0),
        node('b', 200, 0),
        node('c', 0, 100),
        node('d', 200, 100),
        node('e', 0, 200),
        node('f', 200, 200),
      ],
      [],
    );
    const after = resultOf(
      [
        node('a', 0, 0),
        node('b', 200, 0),
        node('d', 200, 100),
        node('c', 400, 200),
        node('e', 0, 200),
        node('f', 200, 200),
      ],
      [],
    );

    const report = measureStability(before, after);

    expect(report.nodes.rankChurn).toBeCloseTo(1 / 6, 12);
  });

  it('renumbers every rank when a row is inserted above the drawing', () => {
    // The documented consequence of an absolute rank index, and it is true
    // rather than a bug: every node is one row further down than it was.
    const before = resultOf([node('a', 0, 0), node('b', 0, 100)], []);
    const after = resultOf([node('z', 0, -100), node('a', 0, 0), node('b', 0, 100)], []);

    expect(measureStability(before, after).nodes.rankChurn).toBe(1);
  });

  it('does not call a rank churned for sliding down together', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 400), node('b', 200, 400)], []);

    const report = measureStability(before, after);

    // Both nodes moved, both are still the only row in the drawing.
    expect(report.nodes.moved).toBe(2);
    expect(report.nodes.rankChurn).toBe(0);
  });
});

describe('measureStability, over the intra-rank order', () => {
  it('reports nothing for an insertion at the head of a rank', () => {
    // The case an absolute index gets wrong, and the reason the order metric is
    // relative: `a`, `b` and `c` are at index 1, 2 and 3 rather than 0, 1 and 2,
    // and not one of them changed place with another.
    const before = resultOf([node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)], []);
    const after = resultOf(
      [node('a', 200, 0), node('b', 400, 0), node('c', 600, 0), node('z', 0, 0)],
      [],
    );

    const report = measureStability(before, after);

    expect(report.nodes.moved).toBe(3);
    expect(report.nodes.orderChurn).toBe(0);
  });

  it('counts a pair that changed places', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)], []);
    const after = resultOf([node('a', 0, 0), node('c', 200, 0), node('b', 400, 0)], []);

    const report = measureStability(before, after);

    // Two adjacent pairs, (a, b) and (b, c). Both flipped: `b` is now after
    // `c`, and `a` is still before `b`, so the discordant pair is (b, c) and
    // (a, b) survives.
    expect(report.nodes.orderChurn).toBe(0.5);
  });

  it('keeps a pair comparable when both members changed rank together', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('z', 0, -100), node('b', 0, 0), node('a', 200, 0)], []);

    const report = measureStability(before, after);

    // The whole row is one rank lower, which rank churn reports, and inside it
    // the two nodes changed places, which order churn reports.
    expect(report.nodes.rankChurn).toBe(1);
    expect(report.nodes.orderChurn).toBe(1);
  });

  it('has no pairs to compare when the two nodes of a rank went different ways', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 0), node('b', 200, 100)], []);

    const report = measureStability(before, after);

    expect(report.nodes.rankChurn).toBe(0.5);
    expect(report.nodes.orderChurn).toBe(0);
  });
});

describe('measureStability, over the routes', () => {
  const straight: readonly Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ];

  it('measures a route change as the distance between the two drawn lines', () => {
    const before = resultOf([], [edge('ab', 'a', 'b', straight)]);
    const after = resultOf(
      [],
      [
        edge('ab', 'a', 'b', [
          { x: 0, y: 0 },
          { x: 30, y: 50 },
          { x: 0, y: 100 },
        ]),
      ],
    );

    const report = measureStability(before, after);

    expect(report.edges.rerouted).toBe(1);
    expect(report.edges.reroutedFraction).toBe(1);
    expect(report.edges.maxRouteDistance).toBe(30);
    expect(report.edges.meanRouteDistance).toBe(30);
  });

  it('reads a subdivided route as the same drawn line and a different bend count', () => {
    // The reason both metrics ship. A point added on the line the route already
    // ran along changes nothing a reader can see, and the distance says so; the
    // bend count is what says the polyline is not the polyline it was, which is
    // the half a spring consumer rebinding per segment cares about.
    const before = resultOf([], [edge('ab', 'a', 'b', straight)]);
    const after = resultOf(
      [],
      [
        edge('ab', 'a', 'b', [
          { x: 0, y: 0 },
          { x: 0, y: 50 },
          { x: 0, y: 100 },
        ]),
      ],
    );

    const report = measureStability(before, after);

    expect(report.edges.rerouted).toBe(1);
    expect(report.edges.maxRouteDistance).toBe(0);
    expect(report.edges.bendChurn).toBe(1);
    expect(report.edges.maxBendChange).toBe(1);
    expect(report.edges.meanBendChange).toBe(1);
  });

  it('takes the route mean over every shared edge', () => {
    const before = resultOf(
      [],
      [edge('ab', 'a', 'b', straight), edge('cd', 'c', 'd', straight)],
    );
    const after = resultOf(
      [],
      [
        edge('ab', 'a', 'b', [
          { x: 0, y: 0 },
          { x: 10, y: 50 },
          { x: 0, y: 100 },
        ]),
        edge('cd', 'c', 'd', straight),
      ],
    );

    const report = measureStability(before, after);

    expect(report.edges.shared).toBe(2);
    expect(report.edges.maxRouteDistance).toBe(10);
    expect(report.edges.meanRouteDistance).toBe(5);
    expect(report.edges.bendChurn).toBe(0.5);
    expect(report.edges.meanBendChange).toBe(0.5);
  });

  it('counts an edge that changed endpoints as gone and arrived rather than shared', () => {
    const before = resultOf([], [edge('e1', 'a', 'b', straight)]);
    const after = resultOf([], [edge('e1', 'a', 'c', straight)]);

    const report = measureStability(before, after);

    expect(report.edges).toMatchObject({ shared: 0, added: 1, removed: 1, rerouted: 0 });
  });
});

describe('stabilityViolations', () => {
  it('says nothing when everything that changed is inside the influence set', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 0), node('b', 260, 0)], []);

    expect(stabilityViolations(before, after, influenceOf(['b']))).toEqual([]);
  });

  it('names a node that moved and was not entitled to', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 0), node('b', 260, 0)], []);

    expect(stabilityViolations(before, after, influenceOf(['a']))).toEqual([
      { id: 'b', kind: 'node-moved' },
    ]);
  });

  it('takes no tolerance, so the smallest representable move is a violation', () => {
    // The contract is exact by decision, not by omission: a fast path that keeps
    // a coordinate COPIES it, so any difference at all is a coordinate that was
    // recomputed when it should have been kept.
    const before = resultOf([node('a', 1, 0)], []);
    const after = resultOf([node('a', 1 + Number.EPSILON, 0)], []);

    expect(stabilityViolations(before, after, influenceOf([]))).toEqual([
      { id: 'a', kind: 'node-moved' },
    ]);
  });

  it('names an arrival and a departure outside the set', () => {
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 0), node('c', 400, 0)], []);

    expect(stabilityViolations(before, after, influenceOf([]))).toEqual([
      { id: 'c', kind: 'node-added' },
      { id: 'b', kind: 'node-removed' },
    ]);
  });

  it('holds the edges to the same rule as the nodes', () => {
    const line: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ];
    const before = resultOf([], [edge('ab', 'a', 'b', line), edge('cd', 'c', 'd', line)]);
    const after = resultOf(
      [],
      [
        edge('ab', 'a', 'b', [
          { x: 0, y: 0 },
          { x: 5, y: 50 },
          { x: 0, y: 100 },
        ]),
        edge('ce', 'c', 'e', line),
      ],
    );

    expect(stabilityViolations(before, after, influenceOf([], ['ab']))).toEqual([
      { id: 'ce', kind: 'edge-added' },
      { id: 'cd', kind: 'edge-removed' },
    ]);
  });

  it('lets the influence set cover a change on either side of the patch', () => {
    // A removal's id is only in the previous result, which is why an influence
    // set spans both sides. A set built from the current drawing alone could
    // not name `b` at all.
    const before = resultOf([node('a', 0, 0), node('b', 200, 0)], []);
    const after = resultOf([node('a', 0, 0)], []);

    expect(stabilityViolations(before, after, influenceOf(['b']))).toEqual([]);
  });
});

describe('the stability contract, against a real relayout', () => {
  function diamond(): Graph {
    const graph = new Graph();
    for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('a', 'c', 'ac');
    graph.addEdge('b', 'd', 'bd');
    graph.addEdge('c', 'd', 'cd');
    return graph;
  }

  /**
   * The graph, wired up so a test can read the one patch a batched edit emits.
   *
   * `graph.batch` returns what its body returned rather than the patch it made,
   * so the patch arrives at a listener, which is where a consumer's would. And
   * the edit is BATCHED because M3.3 made a batch the boundary saying which
   * graph states were meant to be drawn: measuring stability over the states in
   * between a multi-step edit measures drawings nobody asked for.
   */
  function insertion(graph: Graph, body: () => void): Patch {
    const patches: Patch[] = [];
    const unsubscribe = graph.subscribe((patch) => patches.push(patch));
    graph.batch(body);
    unsubscribe();
    const patch = patches.at(-1);
    if (patch === undefined) throw new Error('the edit emitted no patch');
    return patch;
  }

  /** Every node id a patch mentions, however it mentions it. */
  function nodesNamedBy(patch: Patch): ReadonlySet<NodeId> {
    const named = new Set<NodeId>();
    for (const op of patch) {
      if (op.op === 'add-node' || op.op === 'remove-node') named.add(op.id);
      if (op.op === 'add-edge' || op.op === 'remove-edge') {
        named.add(op.source);
        named.add(op.target);
      }
    }
    return named;
  }

  it('holds over a relayout, vacuously against the whole-roster set, which is the guard M3.5 narrows into', () => {
    const graph = diamond();
    const engine = createLayout();
    const before = engine.run(graph);

    const patch = insertion(graph, () => {
      graph.addNode('e');
      graph.addEdge('a', 'e', 'ae');
      graph.addEdge('e', 'd', 'ed');
    });
    const relaid = engine.relayout(patch);

    expectStable(before, relaid.result, relaid.influence);
    engine.dispose();
  });

  it('catches a violation the moment the influence set is narrower than the truth', () => {
    // Without this the test above proves nothing: the whole-roster set makes
    // every violation impossible, so the checker has to be shown failing
    // against a set that leaves something out.
    const graph = diamond();
    const engine = createLayout();
    const before = engine.run(graph);

    const patch = insertion(graph, () => {
      graph.addNode('e');
      graph.addEdge('a', 'e', 'ae');
    });
    const relaid = engine.relayout(patch);
    const narrowed: InfluenceSet = { nodes: new Set(['e']), edges: relaid.influence.edges };

    expect(stabilityViolations(before, relaid.result, narrowed).length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('moves nodes the patch never names, which is why the contract is scoped to the influence set', () => {
    // Hard anchoring in its exact form is infeasible and this is the smallest
    // demonstration of it available. Inserting one node widens the rank it
    // lands in, and the neighbours it pushed apart are not in the patch. The
    // exits are moving an anchor, which is this, or violating the minimum
    // separation, which fails M2.7's invariant test.
    const graph = diamond();
    const engine = createLayout();
    engine.run(graph);

    const patch = insertion(graph, () => {
      graph.addNode('e');
      graph.addEdge('a', 'e', 'ae');
    });
    const relaid = engine.relayout(patch);

    const named = nodesNamedBy(patch);
    const movedOutsideThePatch = relaid.delta.nodes.moved.filter((move) => !named.has(move.id));
    expect(movedOutsideThePatch.length).toBeGreaterThan(0);
    // And every one of them is in the influence set, which is the whole of why
    // the contract is written against that set rather than against the patch.
    for (const move of movedOutsideThePatch) {
      expect(relaid.influence.nodes.has(move.id)).toBe(true);
    }

    engine.dispose();
  });

  it('measures what the fallback costs today, so M3.5 has a number to beat', () => {
    const graph = diamond();
    const before = layout({ graph });
    graph.batch(() => {
      graph.addNode('e');
      graph.addEdge('a', 'e', 'ae');
    });
    const after = layout({ graph });

    const report = measureStability(before, after);

    // Not a threshold anybody tuned: what a full relayout produces today is
    // whatever the pipeline produces, and the point of asserting a ceiling at
    // all is that M3.5 through M3.9 lower it rather than raise it.
    expectStabilityWithin(report, { maxMovedFraction: 1, maxRankChurn: 1, maxOrderChurn: 1 });
    expect(report.nodes.shared).toBe(4);
  });
});
