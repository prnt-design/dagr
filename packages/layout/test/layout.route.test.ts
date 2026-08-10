import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/pipeline.js';
import { brandesKoepfPositionStage } from '../src/position.js';
import { defaultStages } from '../src/stages.js';
import { buildCorpusGraph, goldenCorpus } from './golden-corpus.js';
import type { EdgeId, NodeId } from '@dagr/graph';
import type { GraphSpec } from '@dagr/bench';
import type {
  LayoutConfig,
  LayoutResult,
  Point,
  PositionStage,
  PositionedState,
  RouteStage,
  Size,
} from '../src/types.js';

/**
 * The router: what a polyline's ENDS are, and the invariants every route has to
 * satisfy whatever graph it came from.
 *
 * Two things make this file the shape it is.
 *
 * The first is that M2.8 changed less than its title says. "Polyline routes
 * through dummy-node coordinates" was M2.4b's work: `straight-route` already
 * walked the chains and emitted a point per dummy. So the honest way to state
 * what M2.8 did is as a DIFFERENCE against that router rather than as a
 * description of this one, and {@link centreToCentreRouteStage} below is
 * M2.4b's router written out so the difference can be measured instead of
 * described. It stands in the same relation to the shipped stage as
 * `referenceTranspose` in `layout.transpose.test.ts` does to the transpose
 * pass: a second implementation kept in the test file because the package no
 * longer ships the thing being compared against.
 *
 * The second is that a route invariant is worth nothing pinned against one
 * hand-built graph. Every property here is checked over eight graphs, the two
 * bench corpora and the six of `golden-corpus.ts`, which is the same corpus
 * `layout.order.golden.test.ts` and `layout.transpose.test.ts` use and is
 * shared for the reason that file gives: two files declaring their own would
 * drift, and then they would be pinning numbers for graphs nobody else has. Two
 * of the six carry the structure this stage has a stated rule about and the
 * bench corpora do not have at all: self loops, which have no direction to
 * attach along, and parallel edges, which get routes that coincide exactly.
 */

/** A graph from a `@dagr/bench` spec, built the way every corpus test builds one. */
function build(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function scripted(
  nodes: readonly string[],
  edges: readonly (readonly [string, string, string])[],
): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/**
 * M2.4b's `straight-route`, kept here because the package stopped shipping it.
 *
 * It is the router this milestone replaced, copied unchanged: the source
 * centre, the centre of each dummy on the edge's chain, and the target centre.
 * Everything the two routers disagree about is therefore the whole of what M2.8
 * changed, and the tests below read that difference off rather than asserting a
 * remembered figure.
 */
const centreToCentreRouteStage: RouteStage = {
  name: 'centre-to-centre-route',
  run(input) {
    const routes = new Map<EdgeId, readonly Point[]>();
    for (const edge of input.graph.edges()) {
      const from = input.positions.get(edge.source);
      const to = input.positions.get(edge.target);
      if (from === undefined || to === undefined) throw new Error(`unpositioned ${edge.id}`);
      const points: Point[] = [{ x: from.x, y: from.y }];
      for (const id of input.virtualChains.get(edge.id) ?? []) {
        const bend = input.positions.get(id);
        if (bend === undefined) throw new Error(`unpositioned ${id}`);
        points.push({ x: bend.x, y: bend.y });
      }
      points.push({ x: to.x, y: to.y });
      routes.set(edge.id, points);
    }
    return { routes };
  },
};

/**
 * One run of the pipeline, with the record the position stage handed on kept so
 * that both routers can be run over the SAME coordinates.
 *
 * That is the whole reason the position stage is wrapped rather than the router
 * called twice through `layout`: two runs would give the same coordinates today
 * and the comparison would be silently about two drawings the day one of them
 * stopped doing so.
 */
function routedBothWays(
  graph: Graph,
  config?: LayoutConfig,
  position: PositionStage = defaultStages.position,
): { result: LayoutResult; before: ReadonlyMap<EdgeId, readonly Point[]>; state: PositionedState } {
  let captured: PositionedState | undefined;
  const watching: PositionStage = {
    name: 'watching-position',
    run(input) {
      const output = position.run(input);
      captured = { ...input, positions: output.positions };
      return output;
    },
  };
  const result = layout(config === undefined ? { graph } : { graph, config }, {
    position: watching,
  });
  if (captured === undefined) throw new Error('the position stage never ran');
  return { result, before: centreToCentreRouteStage.run(captured).routes, state: captured };
}

/**
 * Whether a polyline is monotone in the rank axis, in the form `route.ts`
 * states: with `run` the sign of the last point's `y` minus the first's, every
 * consecutive pair steps by `run` or by zero.
 *
 * Written from the rule rather than from the implementation, so that a router
 * which satisfied it by accident on one corpus and not another would be caught.
 */
function monotone(points: readonly Point[]): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return false;
  const run = Math.sign(last.y - first.y);
  let previous = first;
  for (const point of points.slice(1)) {
    const step = Math.sign(point.y - previous.y);
    if (step !== 0 && step !== run) return false;
    previous = point;
  }
  return true;
}

/**
 * How far out of its box a point is, as a multiple of the box's half extent: 0
 * at the centre, 1 on the border, more than 1 outside it.
 *
 * The maximum over the two axes, which is what "on the border of an
 * axis-aligned box" means: a point on the bottom edge is at 1 vertically and
 * anywhere at all horizontally. A zero-width box has no horizontal inside, so
 * anything off its centre line is infinitely far out of it, which is the
 * answer that keeps a zero-size node's only legal attachment its own centre.
 */
function reach(point: Point, centre: Point, size: Size): number {
  const out = (distance: number, extent: number): number => {
    if (extent !== 0) return distance / (extent / 2);
    return distance === 0 ? 0 : Number.POSITIVE_INFINITY;
  };
  return Math.max(
    out(Math.abs(point.x - centre.x), size.width),
    out(Math.abs(point.y - centre.y), size.height),
  );
}

/** Where an end of a route sits relative to its own node's box. */
function endKind(point: Point, centre: Point, size: Size): 'centre' | 'border' | 'inside' {
  const out = reach(point, centre, size);
  if (out === 0) return 'centre';
  // A relative tolerance, because the attachment is a centre plus a ratio times
  // a difference and the last bit of that is not free.
  if (Math.abs(out - 1) <= 1e-9) return 'border';
  return 'inside';
}

/** The length of a polyline, summed segment by segment. */
function polylineLength(points: readonly Point[]): number {
  let total = 0;
  let previous = points[0];
  if (previous === undefined) return 0;
  for (const point of points.slice(1)) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

/** The eight graphs every invariant below is checked over, built once. */
const corpora: readonly (readonly [string, Graph])[] = [
  ['1k', build(smallCorpus())],
  ['10k', build(largeCorpus())],
  ...goldenCorpus.map((entry) => [entry.name, buildCorpusGraph(entry)] as const),
];

describe('polylineRouteStage, what a route looks like', () => {
  it('leaves the source box and enters the target box through their borders', () => {
    // Two 100 by 40 boxes stacked with the default rankSep of 50, so the row
    // centres are 20 and 110 and the two facing borders are at 40 and 90. The
    // route is the 50 units of clear air between them and not the 90 units
    // between the centres, which is what the previous router drew.
    const result = layout({ graph: scripted(['a', 'b'], [['a', 'b', 'ab']]) });
    expect(result.edges.get('ab')?.points).toEqual([
      { x: 0, y: 40 },
      { x: 0, y: 90 },
    ]);
  });

  it('leaves through the side when that is the border the route crosses', () => {
    // The border is found by parameter over both axes rather than by casework
    // on which of the four sides is hit, and a route flat enough to leave
    // through a side is what says so. `wide` is 400 by 10, half a width of 200
    // against half a height of 5, and its neighbour is 500 to the right and 4
    // down: the horizontal limit is reached at 0.4 of the way and the vertical
    // one never would be, so the attachment is on the RIGHT edge at x 200 with
    // a y of 1.6 that is well inside the box's own 5.
    //
    // The coordinates come from a position stage of the test's own rather than
    // from the grid, which centres a lone node on each row and would make every
    // segment here vertical.
    const sideways: PositionStage = {
      name: 'sideways-position',
      run: () => ({
        positions: new Map<NodeId, Point>([
          ['wide', { x: 0, y: 0 }],
          ['near', { x: 500, y: 4 }],
        ]),
      }),
    };
    const result = layout(
      {
        graph: scripted(['wide', 'near'], [['wide', 'near', 'wn']]),
        config: {
          nodeSize: (node) =>
            node.id === 'wide' ? { width: 400, height: 10 } : { width: 10, height: 10 },
        },
      },
      { position: sideways },
    );
    expect(result.edges.get('wn')?.points[0]).toEqual({ x: 200, y: 1.6 });
  });

  it('leaves a self loop at its node centre, having no direction to attach along', () => {
    // Not an exception in the code: a self loop's next point IS the centre it
    // starts from, both components of the difference are zero, and half of no
    // distance is no distance. It is the case `edgeSep` will give a shape, and
    // it is pinned here as it stands so that milestone has a before.
    const result = layout({ graph: scripted(['a'], [['a', 'a', 'aa']]) });
    const a = result.nodes.get('a');
    expect(result.edges.get('aa')?.points).toEqual([
      { x: a?.x, y: a?.y },
      { x: a?.x, y: a?.y },
    ]);
  });

  it('gives two parallel edges the same polyline, which is the edgeSep case', () => {
    // Two edges between one pair of nodes have nothing but their ids to tell
    // them apart, so they coincide exactly. Pinned as it stands for the same
    // reason the self loop above is.
    const graph = scripted(
      ['a', 'b'],
      [
        ['a', 'b', 'first'],
        ['a', 'b', 'second'],
      ],
    );
    const result = layout({ graph });
    expect(result.edges.get('first')?.points).toEqual(result.edges.get('second')?.points);
  });

  it('attaches a zero-size node at its own centre, there being no border', () => {
    const result = layout({
      graph: scripted(['a', 'b'], [['a', 'b', 'ab']]),
      config: { defaultNodeSize: { width: 0, height: 0 } },
    });
    const a = result.nodes.get('a');
    const b = result.nodes.get('b');
    expect(result.edges.get('ab')?.points).toEqual([
      { x: a?.x, y: a?.y },
      { x: b?.x, y: b?.y },
    ]);
  });
});

describe('the half-way cap on an attachment', () => {
  /**
   * THE CAP IS NOT DECORATION and these two cases are why it is in the code.
   *
   * An attachment slides from a centre toward the next point along the route
   * and stops at the box border, and both ends of a route with no bend in it
   * slide along the SAME segment. Let either of them travel more than half way
   * and the two cross over, and the polyline handed back runs the wrong way on
   * a drawing where nothing else is wrong. `route.ts` caps each at the segment
   * midpoint, which makes crossing impossible by arithmetic rather than by an
   * assumption about how far apart a position stage puts things.
   *
   * Both cases below FAIL WITH A `StageContractError` when the cap is removed,
   * which is the runner's endpoint-proximity rule catching an end that has
   * ended up nearer the node it is not attached to. That was verified by
   * removing it, not by reasoning about it.
   */
  it('stops half way when a box reaches its neighbour, rather than passing it', () => {
    // Reachable through the shipping stages alone: `rankSep: 0` puts the rows
    // edge to edge, and a target of no height puts its centre exactly on the
    // source's bottom border. Uncapped, the source's attachment lands on the
    // target's centre.
    const config: LayoutConfig = {
      rankSep: 0,
      nodeSize: (node) =>
        node.id === 'a' ? { width: 100, height: 100 } : { width: 100, height: 0 },
    };
    const result = layout({ graph: scripted(['a', 'b'], [['a', 'b', 'ab']]), config });
    expect(result.nodes.get('a')?.y).toBe(50);
    expect(result.nodes.get('b')?.y).toBe(100);
    expect(result.edges.get('ab')?.points).toEqual([
      { x: 0, y: 75 },
      { x: 0, y: 100 },
    ]);
  });

  it('holds against a position stage that overlaps two boxes outright', () => {
    // The grid stage never overlaps two rows, so this one is a third-party
    // position stage: the property has to survive coordinates this package
    // does not produce, because a caller may supply any `PositionStage` at all.
    const stacked: PositionStage = {
      name: 'stacked-position',
      run: () => ({
        positions: new Map<NodeId, Point>([
          ['a', { x: 0, y: 0 }],
          ['b', { x: 0, y: 10 }],
        ]),
      }),
    };
    const result = layout(
      {
        graph: scripted(['a', 'b'], [['a', 'b', 'ab']]),
        config: { defaultNodeSize: { width: 100, height: 100 } },
      },
      { position: stacked },
    );
    // Both ends stop at the midpoint, so the route is degenerate and still well
    // formed. Uncapped they would be at y 50 and y -40, a polyline running up
    // the page between two nodes that run down it.
    expect(result.edges.get('ab')?.points).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 5 },
    ]);
  });
});

describe('the route invariants, over both bench corpora and the golden six', () => {
  it('has a monotonicity check that can actually fail', () => {
    // Eight zeroes below are worth nothing if the predicate producing them
    // cannot say no, and a weak rule is exactly the kind that quietly cannot.
    // So: what it accepts, and what it rejects.
    expect(monotone([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 9 }])).toBe(true);
    expect(monotone([{ x: 0, y: 9 }, { x: 1, y: 5 }, { x: 2, y: 0 }])).toBe(true);
    // A flat step is a step and not a backtrack, which is the weak half.
    expect(monotone([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 4 }])).toBe(true);
    expect(monotone([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true);
    // One step against the run is enough, wherever it is and however small.
    expect(monotone([{ x: 0, y: 0 }, { x: 1, y: 6 }, { x: 2, y: 5 }, { x: 3, y: 9 }])).toBe(false);
    expect(monotone([{ x: 0, y: 0 }, { x: 1, y: -1 }, { x: 2, y: 9 }])).toBe(false);
  });

  const runs = new Map<string, ReturnType<typeof routedBothWays>>();
  function run(name: string, graph: Graph): ReturnType<typeof routedBothWays> {
    const cached = runs.get(name);
    if (cached !== undefined) return cached;
    const fresh = routedBothWays(graph);
    runs.set(name, fresh);
    return fresh;
  }

  it('routes every edge monotone in the rank axis, on all eight', () => {
    // The headline invariant, in the weak form `route.ts` states, so that a
    // self loop and a flat pair are steps and not backtracks. Both corpora and
    // all six golden graphs, and the two routers alike, because monotonicity is
    // a property this stage INHERITS from the position stage rather than one it
    // creates: what M2.8 promises is that border attachment does not break it,
    // and a column that only checked the new router could not say that.
    const table = corpora.map(([name, graph]) => {
      const { result, before } = run(name, graph);
      const after = [...result.edges.values()].filter((edge) => !monotone(edge.points));
      const centres = [...before.values()].filter((points) => !monotone(points));
      return [name, result.edges.size, after.length, centres.length];
    });
    expect(table).toEqual([
      ['1k', 4_000, 0, 0],
      ['10k', 40_000, 0, 0],
      ['tall-600', 1_800, 0, 0],
      ['wide-600', 2_400, 0, 0],
      ['dense-1200', 6_000, 0, 0],
      ['sparse-2000', 3_000, 0, 0],
      ['self-loops-800', 2_440, 0, 0],
      ['parallel-800', 2_600, 0, 0],
    ]);
  }, 300_000);

  it('moves the two ends and not one point between them', () => {
    // What M2.8 changed, stated as the difference against the router it
    // replaced rather than as a description of this one. Every interior point
    // is the coordinate of a dummy, which is the order and position stages'
    // decision and never the router's, so the two routers have to agree about
    // all of them, exactly, and about how many there are.
    const table = corpora.map(([name, graph]) => {
      const { result, before } = run(name, graph);
      let interior = 0;
      let differing = 0;
      for (const edge of result.edges.values()) {
        const centres = before.get(edge.id) ?? [];
        expect(edge.points).toHaveLength(centres.length);
        for (let index = 1; index < edge.points.length - 1; index += 1) {
          interior += 1;
          if (edge.points[index] !== undefined && centres[index] !== undefined) {
            const same =
              edge.points[index]?.x === centres[index]?.x &&
              edge.points[index]?.y === centres[index]?.y;
            if (!same) differing += 1;
          }
        }
      }
      return [name, interior, differing];
    });
    expect(table).toEqual([
      ['1k', 14_746, 0],
      ['10k', 174_222, 0],
      ['tall-600', 5_197, 0],
      ['wide-600', 7_116, 0],
      ['dense-1200', 27_068, 0],
      ['sparse-2000', 9_206, 0],
      ['self-loops-800', 6_948, 0],
      ['parallel-800', 6_353, 0],
    ]);
  }, 300_000);

  it('lands every end on its own box border, bar the self loops', () => {
    // The other half of the same difference: where the ends went. `centre` is
    // the self loops, which have no direction to attach along, and `inside` is
    // the half-way cap binding, which needs boxes nearly touching and so does
    // not happen anywhere on these eight at the default separations.
    const table = corpora.map(([name, graph]) => {
      const { result, state } = run(name, graph);
      const tally = { border: 0, centre: 0, inside: 0 };
      for (const edge of result.edges.values()) {
        const ends: readonly (readonly [Point | undefined, NodeId])[] = [
          [edge.points[0], edge.source],
          [edge.points.at(-1), edge.target],
        ];
        for (const [point, id] of ends) {
          const centre = state.positions.get(id);
          const size = state.sizes.get(id);
          if (point === undefined || centre === undefined || size === undefined) continue;
          tally[endKind(point, centre, size)] += 1;
        }
      }
      return [name, tally.border, tally.centre, tally.inside];
    });
    expect(table).toEqual([
      ['1k', 8_000, 0, 0],
      ['10k', 80_000, 0, 0],
      ['tall-600', 3_600, 0, 0],
      ['wide-600', 4_800, 0, 0],
      ['dense-1200', 12_000, 0, 0],
      ['sparse-2000', 6_000, 0, 0],
      ['self-loops-800', 4_800, 80, 0],
      ['parallel-800', 5_200, 0, 0],
    ]);
  }, 300_000);

  it('shortens the drawing by exactly the ink that was under the boxes', () => {
    // What the change is worth, as one number per corpus rather than as an
    // adjective. Total polyline length, centre to centre against border to
    // border, on the same coordinates. The saving is bounded below by nothing
    // and above by two box half-heights per edge, so it falls as the share of
    // long edges rises: a chain's interior segments are untouched and only its
    // two ends move.
    const table = corpora.map(([name, graph]) => {
      const { result, before } = run(name, graph);
      let after = 0;
      let centres = 0;
      for (const edge of result.edges.values()) {
        after += polylineLength(edge.points);
        centres += polylineLength(before.get(edge.id) ?? []);
      }
      return [name, Math.round(centres), Math.round(after)];
    });
    expect(table).toEqual([
      ['1k', 15_185_148, 14_802_719],
      ['10k', 632_523_805, 628_558_683],
      ['tall-600', 2_740_824, 2_578_643],
      ['wide-600', 16_260_342, 16_024_932],
      ['dense-1200', 67_303_651, 66_713_408],
      ['sparse-2000', 19_784_217, 19_496_115],
      ['self-loops-800', 10_325_617, 10_093_752],
      ['parallel-800', 10_259_013, 10_007_327],
    ]);
    // Between 0.6% and 5.9% of the total, and the spread is the point rather
    // than the size: the saving is at most half a box diagonal per END, 53.85
    // at the default 100 by 40, so a drawing of long thin rows saves a smaller
    // share of a much larger number. The 10k saves 3,965,122 of 632,523,805,
    // which is 0.63%; `tall-600` saves 162,181 of 2,740,824, which is 5.92%.
    // Every unit of it was ink drawn underneath a node box.
    for (const [, centres, after] of table) {
      expect(Number(after)).toBeLessThan(Number(centres));
    }
  }, 300_000);

  it('keeps every route monotone under Brandes-Koepf too', () => {
    // The claim in `route.ts` is that BOTH position stages in this package give
    // a layer one shared `y`, which is what makes a chain monotone before the
    // router sees it. That is two stages, so it is checked against two. The
    // golden six rather than the bench corpora, because this is about the
    // position stage's `y` and not about scale, and `brandes-koepf-position` is
    // the slower of the two.
    for (const entry of goldenCorpus) {
      const graph = buildCorpusGraph(entry);
      const result = layout({ graph }, { position: brandesKoepfPositionStage });
      const bent = [...result.edges.values()].filter((edge) => !monotone(edge.points));
      expect([entry.name, bent.length]).toEqual([entry.name, 0]);
    }
  }, 300_000);
});
