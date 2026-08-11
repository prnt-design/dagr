import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import type {
  LayoutConfig,
  LayoutResult,
  Point,
  PositionedNode,
  RankStage,
  RouteStage,
} from '../src/index.js';

/** `a` fans out to `b` and `c`. Three nodes, two edges, no cycles. */
function fanOut(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  return graph;
}

/** The axis-aligned box a positioned node occupies, from its centre and size. */
function box(node: PositionedNode) {
  return {
    left: node.x - node.width / 2,
    right: node.x + node.width / 2,
    top: node.y - node.height / 2,
    bottom: node.y + node.height / 2,
  };
}

/**
 * Tolerance for comparing two coordinates, scaled to their magnitude.
 *
 * A box edge is recovered here as `x + width / 2`, from an `x` the position
 * stage computed as `left + width / 2`, and `(l + w / 2) + w / 2` is not always
 * exactly `l + w`. Widths 0.3, 0.2, 0.2 laid out with `nodeSep: 0` leave a gap
 * of -2.8e-17 between the second and third box, which is not an overlap, it is
 * the last bit of a double. So the predicate below asks whether the boxes
 * overlap by more than rounding at the magnitude of the numbers involved.
 */
function epsilonFor(...values: number[]): number {
  let magnitude = 1;
  for (const value of values) magnitude = Math.max(magnitude, Math.abs(value));
  return magnitude * 1e-9;
}

/** Whether two node boxes share any interior area. Touching edges are fine. */
function overlaps(left: PositionedNode, right: PositionedNode): boolean {
  const one = box(left);
  const other = box(right);
  const epsX = epsilonFor(one.left, one.right, other.left, other.right);
  const epsY = epsilonFor(one.top, one.bottom, other.top, other.bottom);
  return (
    one.left < other.right - epsX &&
    other.left < one.right - epsX &&
    one.top < other.bottom - epsY &&
    other.top < one.bottom - epsY
  );
}

function expectNoOverlaps(result: LayoutResult): void {
  const nodes = [...result.nodes.values()];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      if (left === undefined || right === undefined) throw new Error('unreachable');
      expect(overlaps(left, right), `${left.id} overlaps ${right.id}`).toBe(false);
    }
  }
}

function expectBoundsEnclose(result: LayoutResult): void {
  const { x, y, width, height } = result.bounds;
  for (const node of result.nodes.values()) {
    const { left, right, top, bottom } = box(node);
    // `x + width` is not exactly the `maxX` it was derived from, so the same
    // magnitude-scaled tolerance applies here as in `overlaps`.
    const epsX = epsilonFor(left, right, x, x + width);
    const epsY = epsilonFor(top, bottom, y, y + height);
    expect(left).toBeGreaterThanOrEqual(x - epsX);
    expect(right).toBeLessThanOrEqual(x + width + epsX);
    expect(top).toBeGreaterThanOrEqual(y - epsY);
    expect(bottom).toBeLessThanOrEqual(y + height + epsY);
  }
}

/** One node per rank, in graph insertion order. Used to build multi-row cases. */
const oneNodePerRank: RankStage = {
  name: 'one-node-per-rank',
  run(input) {
    const ranks = new Map(input.graph.nodes().map((node, index) => [node.id, index]));
    return { ...defaultStages.rank.run(input), ranks };
  },
};

/** Puts the first two nodes on rank 0 and everything after them on rank 1. */
const twoRowRank: RankStage = {
  name: 'two-row-rank',
  run(input) {
    const ranks = new Map(input.graph.nodes().map((node, index) => [node.id, index < 2 ? 0 : 1]));
    return { ...defaultStages.rank.run(input), ranks };
  },
};

/** A graph of `ids`, with no edges, so a case is only about sizes. */
function nodesOnly(ids: readonly string[]): Graph {
  const graph = new Graph();
  for (const id of ids) graph.addNode(id);
  return graph;
}

describe('layout result', () => {
  it('positions every node with its size', () => {
    const result = layout({ graph: fanOut() });
    expect([...result.nodes.keys()]).toEqual(['a', 'b', 'c']);
    for (const node of result.nodes.values()) {
      expect(node.width).toBe(100);
      expect(node.height).toBe(40);
    }
  });

  it('lays each rank out left to right, centred on the origin', () => {
    // Two rows since M2.2: the ranker puts `a` above the pair it fans out to,
    // rather than everything on one rank.
    const result = layout({ graph: fanOut() });
    expect(result.nodes.get('a')).toEqual({ id: 'a', x: 0, y: 20, width: 100, height: 40 });
    expect(result.nodes.get('b')).toEqual({ id: 'b', x: -75, y: 110, width: 100, height: 40 });
    expect(result.nodes.get('c')).toEqual({ id: 'c', x: 75, y: 110, width: 100, height: 40 });
  });

  it('routes every edge as two points on the endpoint borders', () => {
    // The before, for a reader comparing releases: through M2.7 this same
    // graph came back with the endpoint CENTRES, `[{0, 20}, {-75, 110}]` and
    // `[{0, 20}, {75, 110}]`. M2.8 slid each end along its own segment to the
    // border of its box. Both boxes are 100 by 40, so `a` is left through its
    // bottom edge at y 40 and `b` and `c` are entered through their top edges
    // at y 90, and the x moves with the y because the segments are not
    // vertical.
    const result = layout({ graph: fanOut() });
    expect([...result.edges.keys()]).toEqual(['ab', 'ac']);
    const ab = result.edges.get('ab');
    expect(ab?.id).toBe('ab');
    expect(ab?.source).toBe('a');
    expect(ab?.target).toBe('b');
    expect(ab?.points).toHaveLength(2);
    expect(ab?.points[0]?.y).toBe(40);
    expect(ab?.points[1]?.y).toBe(90);
    expect(ab?.points[0]?.x).toBeCloseTo(-50 / 3, 10);
    expect(ab?.points[1]?.x).toBeCloseTo(-175 / 3, 10);
    const ac = result.edges.get('ac')?.points ?? [];
    // The mirror image, because the graph is: `ac` is `ab` reflected in x.
    expect(ac.map((point) => point.y)).toEqual([40, 90]);
    expect(ac[0]?.x).toBeCloseTo(50 / 3, 10);
    expect(ac[1]?.x).toBeCloseTo(175 / 3, 10);
  });

  it('encloses every node box in the bounds', () => {
    const result = layout({ graph: fanOut() });
    expect(result.bounds).toEqual({ x: -125, y: 0, width: 250, height: 130 });
    expectBoundsEnclose(result);
  });

  it('never overlaps two node boxes', () => {
    expectNoOverlaps(layout({ graph: fanOut() }));
  });

  it('stacks ranks downward without overlapping them', () => {
    // The default ranker would put `b` and `c` on one rank, so a layout with
    // one node per row needs a stage of its own. This doubles as a
    // swappability check.
    const byInsertion: RankStage = {
      name: 'one-node-per-rank',
      run(input) {
        const ranks = new Map(input.graph.nodes().map((node, index) => [node.id, index]));
        return { ...defaultStages.rank.run(input), ranks };
      },
    };
    const result = layout({ graph: fanOut() }, { rank: byInsertion });
    expect(result.nodes.get('a')?.y).toBe(20);
    expect(result.nodes.get('b')?.y).toBe(110);
    expect(result.nodes.get('c')?.y).toBe(200);
    expect(result.nodes.get('a')?.x).toBe(0);
    expect(result.bounds).toEqual({ x: -50, y: 0, width: 100, height: 220 });
    expectNoOverlaps(result);
    expectBoundsEnclose(result);
  });

  it('runs a route from source to target even when the ranker reversed the edge', () => {
    // `points` runs from `source` to `target` as the caller authored them,
    // whatever the ranker did to the edge to break a cycle. M4 and M5 draw an
    // arrowhead at the last point, so a router that emitted target-first would
    // put arrowheads on the wrong end for exactly the edges that were part of a
    // cycle. `reversedEdges` is the router's bookkeeping, never the consumer's.
    //
    // The endpoint claim asserted below is a property of the DEFAULT router
    // rather than of the runner, and it is tested here for that reason. It has
    // already been through the change it was written in anticipation of: it
    // used to be equality with the node CENTRES, and M2.8 moved the ends onto
    // the box borders, so what is left is that each end sits on the border of
    // its own node. The source-to-target direction did not move, which is why
    // the runner checks that and not this. A runner check that has to be
    // deleted a milestone later is the failure mode this contract keeps having
    // to avoid.
    const reversingRank: RankStage = {
      name: 'reversing-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        ranks: new Map([
          ['a', 1],
          ['b', 0],
          ['c', 1],
        ]),
        reversedEdges: new Set(['ab']),
      }),
    };
    const result = layout({ graph: fanOut() }, { rank: reversingRank });
    const a = result.nodes.get('a');
    const b = result.nodes.get('b');
    const points = result.edges.get('ab')?.points ?? [];
    // The ranker really did put the target above the source.
    expect(b?.y).toBeLessThan(a?.y ?? 0);
    // So the route climbs, leaving `a` through its top edge and arriving at
    // `b`'s bottom. Both boxes are the default 40 tall.
    expect(points[0]?.y).toBe((a?.y ?? 0) - 20);
    expect(points.at(-1)?.y).toBe((b?.y ?? 0) + 20);
  });

  it('lays out an empty graph without throwing', () => {
    const result = layout({ graph: new Graph() });
    expect(result.nodes.size).toBe(0);
    expect(result.edges.size).toBe(0);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('centres a short node in a tall row rather than hanging it from the top', () => {
    const sizes: Record<string, { width: number; height: number }> = {
      short: { width: 100, height: 10 },
      tall: { width: 100, height: 60 },
      below: { width: 100, height: 40 },
    };
    const result = layout(
      { graph: nodesOnly(['short', 'tall', 'below']), config: { nodeSize: (n) => sizes[n.id] } },
      { rank: twoRowRank },
    );
    const short = result.nodes.get('short');
    const tall = result.nodes.get('tall');
    const below = result.nodes.get('below');
    // One centre line for the row, set by the tallest node in it.
    expect(short?.y).toBe(30);
    expect(tall?.y).toBe(30);
    expect(short?.y).toBe(tall?.y);
    // Not flush with the row's top, which top-aligning would give as y = 5.
    expect(short?.y).not.toBe(5);
    // The next row starts rankSep below the first row's bottom, and the first
    // row's height is the tallest node's, not the first node's.
    expect((below?.y ?? 0) - (below?.height ?? 0) / 2).toBe(60 + 50);
    expect(below?.y).toBe(130);
    expectNoOverlaps(result);
    expectBoundsEnclose(result);
  });

  it('accepts its own bounds when the hull arithmetic rounds', () => {
    // The runner computes `bounds` and then asserts it encloses every box, so
    // the tolerance in that assertion is load bearing on the runner's own
    // output. `bounds.x` is minX and `bounds.width` is maxX - minX, so
    // `x + width` is not always exactly the maxX it was derived from: these
    // three widths at the default nodeSep leave the rightmost box 7.1e-15 past
    // `x + width`. That is one bit of a double, not a node outside its bounds,
    // and an exact comparison would reject this correct layout.
    const widths: Record<string, number> = { one: 0.1, two: 0.2, three: 0.2 };
    const result = layout({
      graph: nodesOnly(['one', 'two', 'three']),
      config: { nodeSize: (n) => ({ width: widths[n.id] ?? 0, height: 1 }) },
    });
    const right = Math.max(...[...result.nodes.values()].map((n) => n.x + n.width / 2));
    expect(right).toBeGreaterThan(result.bounds.x + result.bounds.width);
    expect(right - (result.bounds.x + result.bounds.width)).toBeLessThan(1e-12);
    expectBoundsEnclose(result);
  });

  it('never overlaps boxes at sizes and separations that round badly', () => {
    // The reviewer's counterexample: three boxes packed edge to edge at a scale
    // where `(left + w / 2) + w / 2` loses the last bit, so box two's right
    // edge lands 2.8e-17 past box three's left edge.
    const widths: Record<string, number> = { one: 0.3, two: 0.2, three: 0.2 };
    const result = layout({
      graph: nodesOnly(['one', 'two', 'three']),
      config: {
        nodeSep: 0,
        nodeSize: (n) => ({ width: widths[n.id] ?? 0, height: 0.1 }),
      },
    });
    expectNoOverlaps(result);
    expectBoundsEnclose(result);
  });

  it('holds the no-overlap and containment guarantees across sizes and separations', () => {
    const cases: readonly {
      readonly name: string;
      readonly nodeSep: number;
      readonly rankSep: number;
      readonly sizes: Record<string, { width: number; height: number }>;
      readonly rank: RankStage;
    }[] = [
      {
        name: 'zero separations, mixed heights, one row',
        nodeSep: 0,
        rankSep: 0,
        sizes: {
          p: { width: 10, height: 1 },
          q: { width: 3, height: 90 },
          r: { width: 7, height: 5 },
        },
        rank: defaultStages.rank,
      },
      {
        name: 'zero separations, mixed heights, one node per row',
        nodeSep: 0,
        rankSep: 0,
        sizes: {
          p: { width: 10, height: 1 },
          q: { width: 3, height: 90 },
          r: { width: 7, height: 5 },
        },
        rank: oneNodePerRank,
      },
      {
        name: 'zero sizes',
        nodeSep: 4,
        rankSep: 4,
        sizes: {
          p: { width: 0, height: 0 },
          q: { width: 0, height: 0 },
          r: { width: 0, height: 0 },
        },
        rank: twoRowRank,
      },
      {
        name: 'zero sizes and zero separations',
        nodeSep: 0,
        rankSep: 0,
        sizes: {
          p: { width: 0, height: 0 },
          q: { width: 0, height: 0 },
          r: { width: 0, height: 0 },
        },
        rank: twoRowRank,
      },
      {
        name: 'a separation far below the coordinate scale',
        nodeSep: 1e-9,
        rankSep: 1e-9,
        sizes: {
          p: { width: 1e9, height: 1e9 },
          q: { width: 1e9, height: 1e9 },
          r: { width: 1e9, height: 1e9 },
        },
        rank: twoRowRank,
      },
      {
        // The tall node is second in its row on purpose: a row height taken
        // from the row's first node would put the next row on top of it.
        name: 'wildly mixed heights over two rows',
        nodeSep: 13,
        rankSep: 0.5,
        sizes: {
          p: { width: 1, height: 0.5 },
          q: { width: 500, height: 1000 },
          r: { width: 2, height: 3 },
        },
        rank: twoRowRank,
      },
    ];
    for (const testCase of cases) {
      const result = layout(
        {
          graph: nodesOnly(['p', 'q', 'r']),
          config: {
            nodeSep: testCase.nodeSep,
            rankSep: testCase.rankSep,
            nodeSize: (n) => testCase.sizes[n.id],
          },
        },
        { rank: testCase.rank },
      );
      expect(result.nodes.size, testCase.name).toBe(3);
      expectNoOverlaps(result);
      expectBoundsEnclose(result);
      for (const node of result.nodes.values()) {
        expect(Number.isFinite(node.x), `${testCase.name}: ${node.id} x`).toBe(true);
        expect(Number.isFinite(node.y), `${testCase.name}: ${node.id} y`).toBe(true);
      }
    }
  });

  it('labels a routed edge from the graph, whatever the router thinks it routed', () => {
    // The route stage's opinion is the polyline; the identity of what was
    // routed is the graph's, so the runner takes it from there rather than
    // letting a router state it and possibly state it wrongly.
    //
    // The polyline here wanders a long way off before arriving, which is a
    // router with opinions rather than a router with a bug: the runner has
    // nothing to say about the shape between the endpoints. The one route
    // property it does check is direction, and a router that emits a reversed
    // edge target-first is rejected at the boundary rather than labelled
    // helpfully, which is layout.contract.test.ts's business.
    const scenic: RouteStage = {
      name: 'scenic-route',
      run(input) {
        const routes = new Map<string, readonly Point[]>();
        for (const edge of input.graph.edges()) {
          const from = input.positions.get(edge.source);
          const to = input.positions.get(edge.target);
          if (from === undefined || to === undefined) throw new Error('unreachable');
          routes.set(edge.id, [from, { x: from.x + 1e4, y: from.y - 1e4 }, to]);
        }
        return { routes };
      },
    };
    const result = layout({ graph: fanOut() }, { route: scenic });
    expect(result.edges.get('ab')).toMatchObject({ id: 'ab', source: 'a', target: 'b' });
    expect(result.edges.get('ab')?.points).toHaveLength(3);
  });

  it('rejects a route point that is not finite, naming the router', () => {
    const infinite: RouteStage = {
      name: 'infinite-route',
      run(input) {
        const routes = new Map<string, readonly Point[]>();
        for (const edge of input.graph.edges()) {
          routes.set(edge.id, [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 0 },
          ]);
        }
        return { routes };
      },
    };
    try {
      layout({ graph: fanOut() }, { route: infinite });
    } catch (error) {
      expect(error).toBeInstanceOf(StageContractError);
      expect((error as StageContractError).stage).toBe('infinite-route');
      return;
    }
    throw new Error('layout should have rejected the non-finite route point');
  });

  it('positions isolated nodes with no edges at all', () => {
    const graph = new Graph();
    graph.addNode('lonely');
    graph.addNode('also-lonely');
    const result = layout({ graph });
    expect(result.edges.size).toBe(0);
    expect(result.nodes.get('lonely')).toEqual({
      id: 'lonely',
      x: -75,
      y: 20,
      width: 100,
      height: 40,
    });
    expectNoOverlaps(result);
  });
});

/**
 * A graph with one of everything the pipeline has to survive: a diamond whose
 * tail belongs under the longer side, a cycle back to the top for the ranker to
 * break, a self loop it must not break, a two-cycle in a second component, and
 * a third component that is a lone node. Sizes vary by id length so a node that
 * moved between rows shows up in the coordinates rather than cancelling out.
 */
function menagerie(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  graph.addNode('d');
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('b', 'd', 'bd');
  graph.addEdge('c', 'd', 'cd');
  graph.addEdge('d', 'a', 'da');
  graph.addEdge('b', 'b', 'bb');
  graph.addNode('p');
  graph.addNode('q');
  graph.addEdge('p', 'q', 'pq');
  graph.addEdge('q', 'p', 'qp');
  graph.addNode('lonely');
  return graph;
}

const menagerieConfig: LayoutConfig = {
  nodeSep: 12,
  rankSep: 34,
  nodeSize: (node) => ({ width: node.id.length * 10, height: 20 }),
};

describe('layout result identity across refactors', () => {
  /**
   * The whole result, written out, captured from the implementation as it
   * stands after M2.4b split long edges into dummy chains.
   *
   * Every other test in this suite asserts a property, which is what a test
   * should do and what leaves room for a refactor to be judged on its own. This
   * one asserts the opposite: that nothing at all moved. It was written for
   * M2.4a, which rebuilt how the runner assembles each pipeline record and whose
   * one claim to a caller was that it made no claim, so the guard had to be an
   * equality against a value nobody could derive from the new code.
   *
   * M2.4b is the first milestone to deliberately change what a default run
   * draws, which is the moment this pin was always going to be REPLACED rather
   * than preserved. Recorded here so the replacement is a decision rather than a
   * re-capture, exactly what changed. `da` runs from rank 2 to rank 0, so it is
   * split at rank 1 and the dummy is a full member of that layer. It takes no
   * width but it does take a `nodeSep` gap, so rank 1 goes from three members to
   * four and from 54 wide to 66: `3 * 10 + 2 * 12` becomes
   * `3 * 10 + 0 + 3 * 12`, and a row centred on zero starts at -33 rather than
   * -27.
   *
   * THE DUMMY LANDS SECOND, between `b` and `c`, which is the order stage's
   * decision and not an arithmetic one. So rank 1 is `b`, dummy, `c`, `q` at
   * -28, -11, 6 and 28, and against the pre-M2.4b row of `b`, `c`, `q` at -22,
   * 0 and 22 that is `b` six left and `c` and `q` six RIGHT: the row's left edge
   * moved six left when it widened, and the dummy sitting ahead of `c` and `q`
   * pushes those two twelve right of where the widening alone would put them.
   * `da`'s polyline gains -11 as its bend. Nothing else moves and `bounds` does
   * not either, because rank 0 is the wider row and -11 is well inside it. Every
   * node the caller added is still in the result and the dummy is not.
   *
   * The M2.4b review renamed that dummy from `#dummy:da:1` to `#dummy:da:0`,
   * suffixing the id with the dummy's index along its chain rather than with its
   * rank, and not a number here moved. Within-layer order can be id-derived, so
   * a rename can move coordinates, but only between two dummies sharing a layer,
   * and rank 1 holds exactly one. So the rename is free here whatever the order
   * stage does with the slot.
   *
   * It is one graph rather than a corpus on purpose. M2.9 commits a golden file
   * against dagre, on its own corpus of nine graphs, and that is where a corpus
   * belongs; this is a single pin for a single refactor, and it is expected to
   * be REPLACED, not preserved, the first time a milestone deliberately changes
   * what a default run draws. M2.6b was such a milestone and this capture
   * survived it untouched, which is a fact about this graph and not a
   * guarantee: the barycenter stage that took the order default happens to lay
   * these seven nodes out exactly as roster order did. M2.4b IS such a
   * milestone and the capture did not survive it: a bend appears on `da` and
   * rank 1 gains a member, which is the paragraph above. A test like this
   * outliving its refactor is how a suite ends up asserting that a placeholder
   * algorithm stays a placeholder.
   *
   * M2.8 WAS THE THIRD SUCH MILESTONE, and it moved exactly one thing: the two
   * ENDS of every route. Every node coordinate and `bounds` itself came back
   * byte for byte, which they had to, because an attachment slides along a
   * segment the router already had and lands on a border that is inside a box
   * the hull already contained. The bend on `da` is still at -11, 64, which is
   * the dummy's own coordinate and never the router's to choose. What the
   * endpoints look like now is computed geometry rather than copied
   * coordinates, and the recurring decimals below are that in visible form:
   * `ab` leaves `a` at -43.48, 20 rather than at its centre -47, 10.
   *
   * TWO ROUTES DELIBERATELY DID NOT MOVE and both are the `edgeSep` case
   * `route.ts` names as its next step. `bb`, the self loop, is still two
   * identical points at `b`'s centre: it has no direction to attach along, so
   * there is no border for it to land on. And `pq` and `qp` are still the same
   * two points in opposite orders, exactly coincident, because two edges
   * between one pair of nodes have nothing but their ids to tell them apart
   * until a router fans them out.
   */
  const captured = {
    nodes: [
      { id: 'a', x: -47, y: 10, width: 10, height: 20 },
      { id: 'b', x: -28, y: 64, width: 10, height: 20 },
      { id: 'c', x: 6, y: 64, width: 10, height: 20 },
      { id: 'd', x: 0, y: 118, width: 10, height: 20 },
      { id: 'p', x: -25, y: 10, width: 10, height: 20 },
      { id: 'q', x: 28, y: 64, width: 10, height: 20 },
      { id: 'lonely', x: 22, y: 10, width: 60, height: 20 },
    ],
    edges: [
      {
        id: 'ab',
        source: 'a',
        target: 'b',
        points: [
          { x: -43.48148148148148, y: 20 },
          { x: -31.51851851851852, y: 54 },
        ],
      },
      {
        id: 'ac',
        source: 'a',
        target: 'c',
        points: [
          { x: -42, y: 15.09433962264151 },
          { x: 1, y: 58.90566037735849 },
        ],
      },
      {
        id: 'bd',
        source: 'b',
        target: 'd',
        points: [
          { x: -23, y: 73.64285714285714 },
          { x: -5, y: 108.35714285714286 },
        ],
      },
      {
        id: 'cd',
        source: 'c',
        target: 'd',
        points: [
          { x: 4.888888888888889, y: 74 },
          { x: 1.1111111111111112, y: 108 },
        ],
      },
      {
        id: 'da',
        source: 'd',
        target: 'a',
        points: [
          { x: -2.0370370370370368, y: 108 },
          { x: -11, y: 64 },
          { x: -42, y: 17.5 },
        ],
      },
      {
        id: 'bb',
        source: 'b',
        target: 'b',
        points: [
          { x: -28, y: 64 },
          { x: -28, y: 64 },
        ],
      },
      {
        id: 'pq',
        source: 'p',
        target: 'q',
        points: [
          { x: -20, y: 15.09433962264151 },
          { x: 23, y: 58.90566037735849 },
        ],
      },
      {
        id: 'qp',
        source: 'q',
        target: 'p',
        points: [
          { x: 23, y: 58.90566037735849 },
          { x: -20, y: 15.09433962264151 },
        ],
      },
    ],
    bounds: { x: -52, y: 0, width: 104, height: 128 },
  };

  it('draws the same graph exactly as it did before the stage outputs were narrowed', () => {
    const result = layout({ graph: menagerie(), config: menagerieConfig });
    expect({
      nodes: [...result.nodes.values()],
      edges: [...result.edges.values()],
      bounds: result.bounds,
    }).toEqual(captured);
  });

  it('keeps the key order too, which the result promises is graph insertion order', () => {
    // Deep equality on the arrays above already compares order, and this states
    // separately that the MAPS iterate that way, which is the documented
    // guarantee M3.1's diff is built on rather than an accident of how the
    // assertion above was written.
    const graph = menagerie();
    const result = layout({ graph, config: menagerieConfig });
    expect([...result.nodes.keys()]).toEqual(graph.nodes().map((node) => node.id));
    expect([...result.edges.keys()]).toEqual(graph.edges().map((edge) => edge.id));
  });
});
