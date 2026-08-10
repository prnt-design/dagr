import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/pipeline.js';
import { brandesKoepfPositionStage } from '../src/position.js';
import { defaultStages } from '../src/stages.js';
import { buildCorpusGraph, goldenCorpus } from './golden-corpus.js';
import { mulberry32 } from './random.js';
import type { EdgeId, Node, NodeId } from '@dagr/graph';
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
 * hand-built graph. Every property here is checked over nine graphs, the two
 * bench corpora, the six of `golden-corpus.ts` and one of those six again under
 * varied box widths, for the reason `variedWidths` gives. The golden six are the
 * same corpus
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

/**
 * Where an end of a route sits relative to its own node's box.
 *
 * The tolerance is scaled the way `assertBounds` scales its own, by the
 * magnitude of the coordinates involved and then divided back through the half
 * extent that {@link reach} divided by. A flat `1e-9` on the ratio is what this
 * had first and it is safe on the uniform graphs below only by accident: with
 * 100 by 40 boxes the error at an `x` of 6e8 is exactly zero. It stops being
 * safe the moment a box extent is SMALL at a large coordinate, where a width of
 * 5e-3 at an `x` of 2.8e8 puts a genuine border hit 4e-6 off the ratio and this
 * would report it as `inside`.
 */
function endKind(point: Point, centre: Point, size: Size): 'centre' | 'border' | 'inside' {
  const out = reach(point, centre, size);
  if (out === 0) return 'centre';
  const extent = Math.max(size.width, size.height) / 2;
  const scale = Math.max(1, Math.abs(centre.x), Math.abs(centre.y), Math.abs(point.x));
  const epsilon = extent === 0 ? 1e-9 : (scale * 1e-9) / extent;
  if (Math.abs(out - 1) <= epsilon) return 'border';
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

/**
 * A width per node, deterministic and spread wide enough to matter.
 *
 * THE NINTH ROW EXISTS BECAUSE THE FIRST EIGHT COULD NOT SEE THE BUG. Every
 * corpus graph is laid out at one uniform 100 by 40 box, and at that size a box
 * is never large against the gap it has to cross, so neither cap in
 * {@link attachment} ever binds and no table below can reach the case the M2.8
 * review found. Widths from 10 to 2010 put a box wider than a row's spacing in
 * every drawing, which is the regime where an attachment travels far enough for
 * the caps to be the thing keeping the route legal.
 */
function variedWidths(graph: Graph, seed: number): (node: Node) => Size {
  const random = mulberry32(seed);
  const widths = new Map<NodeId, number>();
  for (const node of graph.nodes()) widths.set(node.id, 10 + Math.floor(random() * 2_001));
  return (node) => ({ width: widths.get(node.id) ?? 100, height: 40 });
}

const denseEntry = goldenCorpus.find((entry) => entry.name === 'dense-1200');
if (denseEntry === undefined) throw new Error('the golden corpus no longer holds dense-1200');
const variedBase = buildCorpusGraph(denseEntry);

/**
 * The nine graphs every invariant below is checked over, built once: the two
 * bench corpora, the six of `golden-corpus.ts`, and `dense-1200` again under
 * varied box widths. `dense-1200` is the one re-run because it has the largest
 * long-edge share of the six, so it is where a chained edge's attachment gets
 * the most exercise.
 */
const corpora: readonly (readonly [string, Graph, LayoutConfig | undefined])[] = [
  ['1k', build(smallCorpus()), undefined],
  ['10k', build(largeCorpus()), undefined],
  ...goldenCorpus.map((entry) => [entry.name, buildCorpusGraph(entry), undefined] as const),
  ['dense-1200-varied', variedBase, { nodeSize: variedWidths(variedBase, 0xd15) }] as const,
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

  it('gives two parallel edges the same polyline when neither has a chain', () => {
    // The `edgeSep` case, and it is narrower than "parallel edges coincide".
    // Over ONE rank two edges between the same pair have identical endpoints,
    // no bend, and nothing but their ids to tell them apart, so they coincide
    // exactly. Pinned as it stands for the same reason the self loop above is.
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

  it('separates two parallel edges that each span a rank, without meaning to', () => {
    // And over more than one rank they come apart on their own. The ranker
    // mints each of them its own chain, those dummies are separate members of
    // the layers they join, and the order stage gives each its own place, so
    // the two routes differ at their bends AND at their attachments, which aim
    // at those bends. `nodeSep` does the separating and no router asked it to.
    //
    // This is why the `edgeSep` case above is stated with its condition. The
    // golden corpus's `parallel-800` carries long parallel edges, so the
    // unconditional claim would have been false on the very corpus this file
    // pins its tables over.
    const graph = scripted(
      ['a', 'm', 'n', 'b'],
      [
        ['a', 'm', 'am'],
        ['m', 'n', 'mn'],
        ['n', 'b', 'nb'],
        ['a', 'b', 'first'],
        ['a', 'b', 'second'],
      ],
    );
    const result = layout({ graph });
    const first = result.edges.get('first')?.points ?? [];
    const second = result.edges.get('second')?.points ?? [];
    expect(first).toHaveLength(4);
    expect(second).toHaveLength(4);
    // Every point differs, not merely the bends.
    expect(first.map((point) => point.x)).toEqual([50 / 4.5, 50, 50, 50 / 4.5]);
    expect(second.map((point) => point.x)).toEqual([100 / 4.5, 100, 100, 100 / 4.5]);
    expect(first.map((point) => point.y)).toEqual([40, 110, 200, 270]);
    expect(second.map((point) => point.y)).toEqual([40, 110, 200, 270]);
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

describe('the two caps on an attachment', () => {
  /**
   * NEITHER CAP IS DECORATION, and they bound different distances.
   *
   * An attachment slides from a centre toward the NEXT POINT on the route and
   * stops at the box border. The first cap holds it to half of that segment,
   * because on a bendless route both ends slide along the same one and two
   * attachments that pass each other hand back a polyline running the wrong
   * way. The second holds it to half the distance to the edge's OTHER
   * ENDPOINT, which on a chained edge is a different distance entirely, and it
   * exists because the runner's endpoint-proximity rule compares this end
   * against that endpoint rather than against the dummy it walked toward.
   *
   * Every case below FAILS WITH A `StageContractError` when its cap is removed,
   * which is that rule catching an end nearer the node it is not attached to.
   * Verified by removing them, not by reasoning about it.
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

  it('holds a chained edge back to half way to its TARGET, not to its first bend', () => {
    // THE M2.8 ALGORITHMS REVIEW'S REGRESSOR, kept verbatim because it is the
    // case the first cap does not cover and the one that shipped broken in the
    // first draft. Four nodes, default config, one box 2000 wide. `st` spans
    // two ranks, so its source end walks toward a dummy in the wide row rather
    // than toward `t`, the first cap bounds the distance to THAT, and the
    // runner's proximity rule compares the result against `t`. With only the
    // first cap `layout()` throws a `StageContractError` on this graph.
    const widths: Record<string, number> = { a: 100, s: 100, m: 2000, t: 700 };
    const graph = scripted(
      ['a', 's', 'm', 't'],
      [
        ['s', 'm', 'sm'],
        ['m', 't', 'mt'],
        ['s', 't', 'st'],
        ['a', 'm', 'am'],
      ],
    );
    const result = layout({
      graph,
      config: { nodeSize: (node) => ({ width: widths[node.id] ?? 100, height: 40 }) },
    });
    const points = result.edges.get('st')?.points ?? [];
    const source = result.nodes.get('s');
    const target = result.nodes.get('t');
    expect(points).toHaveLength(3);
    // The property the runner checks, asserted here as the thing this cap is
    // for rather than left to the fact that `layout()` returned at all.
    const gap = Math.hypot((source?.x ?? 0) - (target?.x ?? 0), (source?.y ?? 0) - (target?.y ?? 0));
    const travelled = Math.hypot(
      (points[0]?.x ?? 0) - (source?.x ?? 0),
      (points[0]?.y ?? 0) - (source?.y ?? 0),
    );
    expect(travelled).toBeLessThanOrEqual(gap / 2);
    // And it really is the second cap doing the work: the first one would have
    // allowed half the way to the dummy, which is further than this.
    const toBend = Math.hypot(
      (points[1]?.x ?? 0) - (source?.x ?? 0),
      (points[1]?.y ?? 0) - (source?.y ?? 0),
    );
    expect(travelled).toBeLessThan(toBend / 2);
  });

  it('survives 3,000 random DAGs with box widths from 10 to 2010', () => {
    // The population behind the regressor above, and it is here as the SWEEP
    // that found the shape rather than as the evidence: the deterministic case
    // is the evidence. 664 of these 3,000 threw before the second cap landed
    // and none of them threw under the centre-to-centre router, which is what
    // said the fault was new and was the router's. Uniform 100 by 40 finds
    // nothing, which is why the eight-graph tables below could not have.
    const random = mulberry32(0x2b8);
    let laid = 0;
    for (let run = 0; run < 3_000; run += 1) {
      const count = 4 + Math.floor(random() * 8);
      const graph = new Graph();
      for (let node = 0; node < count; node += 1) graph.addNode(`n${String(node)}`);
      for (let from = 0; from < count; from += 1) {
        for (let to = from + 1; to < count; to += 1) {
          if (random() < 0.35) graph.addEdge(`n${String(from)}`, `n${String(to)}`);
        }
      }
      const widths = new Map<NodeId, number>();
      for (const node of graph.nodes()) widths.set(node.id, 10 + Math.floor(random() * 2_001));
      const result = layout({
        graph,
        config: { nodeSize: (node) => ({ width: widths.get(node.id) ?? 100, height: 40 }) },
      });
      for (const edge of result.edges.values()) expect(monotone(edge.points)).toBe(true);
      laid += 1;
    }
    expect(laid).toBe(3_000);
  }, 300_000);
});

describe('the route invariants, over both bench corpora and the golden six plus one', () => {
  it('has a monotonicity check that can actually fail', () => {
    // Nine zeroes below are worth nothing if the predicate producing them
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
  function run(
    name: string,
    graph: Graph,
    config: LayoutConfig | undefined,
  ): ReturnType<typeof routedBothWays> {
    const cached = runs.get(name);
    if (cached !== undefined) return cached;
    const fresh = routedBothWays(graph, config);
    runs.set(name, fresh);
    return fresh;
  }

  it('routes every edge monotone in the rank axis, on all nine', () => {
    // The headline invariant, in the weak form `route.ts` states, so that a
    // self loop and a flat pair are steps and not backtracks. All nine graphs,
    // and the two routers alike, because monotonicity is
    // a property this stage INHERITS from the position stage rather than one it
    // creates: what M2.8 promises is that border attachment does not break it,
    // and a column that only checked the new router could not say that.
    const table = corpora.map(([name, graph, config]) => {
      const { result, before } = run(name, graph, config);
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
      ['dense-1200-varied', 6_000, 0, 0],
    ]);
  }, 300_000);

  it('moves the two ends and not one point between them', () => {
    // What M2.8 changed, stated as the difference against the router it
    // replaced rather than as a description of this one. Every interior point
    // is the coordinate of a dummy, which is the order and position stages'
    // decision and never the router's, so the two routers have to agree about
    // all of them, exactly, and about how many there are.
    const table = corpora.map(([name, graph, config]) => {
      const { result, before } = run(name, graph, config);
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
      // Same graph as `dense-1200`, so the same chains and the same bends. Only
      // the boxes differ, and a box is not something an interior point knows
      // about.
      ['dense-1200-varied', 27_068, 0],
    ]);
  }, 300_000);

  it('lands every end on its own box border, bar the self loops and the capped', () => {
    // The other half of the same difference: where the ends went. `centre` is
    // the self loops, which have no direction to attach along. `inside` is a
    // cap binding before the border is reached, which happens where a box is
    // large against the gap it has to cross: never on the eight uniform
    // graphs, and 282 times on the ninth, whose boxes run up to 2010 wide at
    // the same default separations.
    const table = corpora.map(([name, graph, config]) => {
      const { result, state } = run(name, graph, config);
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
      // THE ONLY ROW WITH ANYTHING IN THE `inside` COLUMN, and it is the reason
      // this row exists. 282 of its 12,000 ends belong to a box big enough
      // against the gap it has to cross that a cap binds before the border is
      // reached. Every one of the other eight is uniform 100 by 40, where
      // neither cap ever binds, so eight zeroes here would have said the caps
      // were untested rather than that they were not needed.
      ['dense-1200-varied', 11_718, 0, 282],
    ]);
  }, 300_000);

  it('shortens the drawing by exactly the ink that was under the boxes', () => {
    // What the change is worth, as one number per corpus rather than as an
    // adjective. Total polyline length, centre to centre against border to
    // border, on the same coordinates. The saving is bounded below by nothing
    // and above by half a box DIAGONAL per end, 53.85 at the default 100 by 40,
    // because an attachment leaving through a side travels up to half a width
    // and one leaving through the bottom up to half a height. It is not
    // bounded by the height alone: `tall-600` saves 90 per edge below, which a
    // 40-tall box could not account for.
    const table = corpora.map(([name, graph, config]) => {
      const { result, before } = run(name, graph, config);
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
      ['dense-1200-varied', 159_138_358, 154_193_400],
    ]);
    // Between 0.6% and 5.9% of the total, and the spread is the point rather
    // than the size: the saving is at most half a box diagonal per END, 53.85
    // at the default 100 by 40, so a drawing of long thin rows saves a smaller
    // share of a much larger number. The 10k saves 3,965,122 of 632,523,805,
    // which is 0.63%; `tall-600` saves 162,181 of 2,740,824, which is 5.92%.
    // The varied row is 3.11%, of a drawing whose boxes run up to 2010 wide, so
    // its bound per end is far higher than 53.85 and its rows are far wider
    // too. Every unit of every one of them was ink drawn underneath a node box.
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
