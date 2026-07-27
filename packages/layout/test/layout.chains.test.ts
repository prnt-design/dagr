import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { measureNodes, resolveConfig } from '../src/config.js';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import { longestPathRankStage } from '../src/rank.js';
import type { Point, PositionStage, PreparedState, RankOutput, Size } from '../src/index.js';

/**
 * M2.4b: the dummy chains a long edge is split into, from the ranker that mints
 * them to the polyline the router rejoins them into.
 *
 * The five contract rules about a chain, and the completeness rule that decides
 * what a chain has to cover, live in `layout.virtual.test.ts` next to the fake
 * rankers that break them. This file is about the real ranker and the real
 * router.
 */

/** What the runner hands the rank stage, built the way the runner builds it. */
function prepare(graph: Graph): PreparedState {
  const config = resolveConfig(undefined);
  return { graph, config, sizes: measureNodes(graph, config, undefined) };
}

/** Runs the stage under test on a graph and hands back what it contributes. */
function rank(graph: Graph): RankOutput {
  return longestPathRankStage.run(prepare(graph));
}

/** A graph from a script of `addNode`/`addEdge` calls. */
function build(
  nodes: readonly string[],
  edges: readonly (readonly [string, string, string])[],
): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/** The chain for an edge, which a test asking for one expects to exist. */
function chainOf(state: RankOutput, id: EdgeId): readonly NodeId[] {
  const chain = state.virtualChains?.get(id);
  if (chain === undefined) throw new Error(`no chain for "${id}"`);
  return chain;
}

/**
 * `a -> z` alongside `a -> m -> z`, so the direct edge spans a rank that the
 * path already occupies. The shortest graph with a long edge in it.
 */
function detour(): Graph {
  return build(
    ['a', 'm', 'z'],
    [
      ['a', 'm', 'am'],
      ['m', 'z', 'mz'],
      ['a', 'z', 'az'],
    ],
  );
}

describe('longestPathRankStage dummy chains', () => {
  it('splits a three-rank edge into one dummy at the rank between', () => {
    const state = rank(detour());
    expect(chainOf(state, 'az')).toEqual(['#dummy:az:0']);
    // Only the long edge is split: the two one-rank hops have no entry at all.
    expect([...(state.virtualChains ?? [])].map(([id]) => id)).toEqual(['az']);
    expect([...(state.virtualNodes ?? [])]).toEqual([['#dummy:az:0', { width: 0, height: 0 }]]);
  });

  it('splits a four-rank edge into two dummies, source to target', () => {
    const graph = build(
      ['a', 'm', 'n', 'z'],
      [
        ['a', 'm', 'am'],
        ['m', 'n', 'mn'],
        ['n', 'z', 'nz'],
        ['a', 'z', 'az'],
      ],
    );
    // Named for their position along the chain counting from the authored
    // source, and listed in the order the route walks them, so a router never
    // has to sort or reverse anything.
    expect(chainOf(rank(graph), 'az')).toEqual(['#dummy:az:0', '#dummy:az:1']);
  });

  it('leaves an edge between adjacent ranks with no chain, and declares nothing', () => {
    // The behaviour a ranker with nothing to say has always had: both fields
    // omitted rather than handed back empty, so the runner supplies the empty
    // collections and nothing downstream sees an absent one.
    const state = rank(build(['a', 'b'], [['a', 'b', 'ab']]));
    expect(state.virtualChains).toBeUndefined();
    expect(state.virtualNodes).toBeUndefined();
  });

  it('gives a self loop no chain, because both its ends are on one rank', () => {
    const state = rank(
      build(
        ['a', 'b'],
        [
          ['a', 'b', 'ab'],
          ['b', 'b', 'bb'],
        ],
      ),
    );
    expect(state.virtualChains).toBeUndefined();
  });

  it('runs a reversed edge chain down the ranks, source to target as authored', () => {
    // A chain is listed source to target as the CALLER authored them, matching
    // `RoutedEdge.points`, so a reversed edge's chain DESCENDS the ranks. The
    // cycle is what makes this a real case rather than a hand-built one: the
    // feedback arc set picks the edge, and the chain is asserted against the
    // edge it actually picked.
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['d', 'a', 'da'],
      ],
    );
    const state = rank(graph);
    expect([...state.reversedEdges]).toEqual(['da']);
    const edge = graph.getEdge('da');
    expect(state.ranks.get(edge?.source ?? '')).toBe(3);
    expect(state.ranks.get(edge?.target ?? '')).toBe(0);
    // Ranks 2 then 1: down the page from `d` to `a`, which is up the ranks. The
    // index counts from the AUTHORED source either way, so index 0 is the dummy
    // next to `d`, which is the end sitting at the high rank.
    expect(chainOf(state, 'da')).toEqual(['#dummy:da:0', '#dummy:da:1']);
    expect(state.ranks.get('#dummy:da:0')).toBe(2);
    expect(state.ranks.get('#dummy:da:1')).toBe(1);
  });

  it('keeps the dummies a chain already had when the chain grows by a rank', () => {
    // A dummy id is a function of its edge and its position along the chain,
    // never of a counter or of iteration order, so a chain that grows at its far
    // end keeps every dummy before the growth and gains one. If it were a
    // counter, all four ids would be new nodes M3.6's warm start had never seen,
    // and the edge would jitter between two endpoints that did not move.
    //
    // What this does NOT establish, and the M2.4b review was right to say so, is
    // stability under a rank shift: the path lengthens BELOW the shared dummies,
    // so their ranks never move and a rank-suffixed id would pass this test
    // identically. The test below it is the one that separates the two schemes.
    const shorter = build(
      ['a', 'p1', 'p2', 'p3', 'z'],
      [
        ['a', 'p1', 'ap1'],
        ['p1', 'p2', 'p1p2'],
        ['p2', 'p3', 'p2p3'],
        ['p3', 'z', 'p3z'],
        ['a', 'z', 'az'],
      ],
    );
    const longer = build(
      ['a', 'p1', 'p2', 'p3', 'p4', 'z'],
      [
        ['a', 'p1', 'ap1'],
        ['p1', 'p2', 'p1p2'],
        ['p2', 'p3', 'p2p3'],
        ['p3', 'p4', 'p3p4'],
        ['p4', 'z', 'p4z'],
        ['a', 'z', 'az'],
      ],
    );
    // The path lengthened below the shared dummies, so the first three bends of
    // the chain are the same three bends in both layouts and the ids there have
    // to be the same ids.
    const before = new Set(chainOf(rank(shorter), 'az'));
    const after = new Set(chainOf(rank(longer), 'az'));
    expect([...before]).toEqual(['#dummy:az:0', '#dummy:az:1', '#dummy:az:2']);
    for (const id of before) expect(after.has(id), `kept ${id}`).toBe(true);
    expect([...after].filter((id) => !before.has(id))).toEqual(['#dummy:az:3']);
  });

  it('keeps every dummy id when an unrelated node upstream shifts the whole chain', () => {
    // The case the id scheme exists for, and the one a rank-suffixed id fails.
    // `up -> a` touches neither end of `az`, and `az` still spans three ranks,
    // but every rank in the cone below `up` moves down by one. Under
    // `#dummy:<edge>:<rank>` the chain's ids would go from `:1, :2` to `:2, :3`,
    // so one of the two survives and it survives WRONG: the id that named the
    // second bend now names the first, and a warm start anchoring by id would
    // anchor that bend to the wrong previous coordinate rather than simply
    // missing it. An index from the authored source is invariant under the
    // shift, so both ids are unchanged.
    const before = build(
      ['a', 'p1', 'p2', 'z'],
      [
        ['a', 'p1', 'ap1'],
        ['p1', 'p2', 'p1p2'],
        ['p2', 'z', 'p2z'],
        ['a', 'z', 'az'],
      ],
    );
    const after = build(
      ['a', 'p1', 'p2', 'z', 'up'],
      [
        ['a', 'p1', 'ap1'],
        ['p1', 'p2', 'p1p2'],
        ['p2', 'z', 'p2z'],
        ['a', 'z', 'az'],
        ['up', 'a', 'upa'],
      ],
    );
    const shifted = rank(after);
    // The shift really happened: `az` sits one rank lower at both ends, and its
    // span is the three ranks it always had.
    expect(rank(before).ranks.get('a')).toBe(0);
    expect(shifted.ranks.get('a')).toBe(1);
    expect(shifted.ranks.get('z')).toBe(4);
    // And not one dummy was renamed.
    expect(chainOf(rank(before), 'az')).toEqual(['#dummy:az:0', '#dummy:az:1']);
    expect(chainOf(shifted, 'az')).toEqual(['#dummy:az:0', '#dummy:az:1']);
  });

  it('ranks, layers, sizes and positions every dummy, so a dummy is a full citizen', () => {
    let layers: readonly (readonly NodeId[])[] = [];
    let sizes: ReadonlyMap<NodeId, Size> = new Map();
    let positions: ReadonlyMap<NodeId, Point> = new Map();
    const watching: PositionStage = {
      name: 'watching-position',
      run(input) {
        layers = input.layers;
        sizes = input.sizes;
        const output = defaultStages.position.run(input);
        positions = output.positions;
        return output;
      },
    };
    const result = layout({ graph: detour() }, { position: watching });
    // Rank 1 holds `m` and the dummy, the graph's own node first.
    expect(layers).toEqual([['a'], ['m', '#dummy:az:0'], ['z']]);
    expect(sizes.get('#dummy:az:0')).toEqual({ width: 0, height: 0 });
    expect(positions.get('#dummy:az:0')).toEqual({ x: 75, y: 110 });
    // And it stops at the route stage, as every piece of dummy bookkeeping does.
    expect([...result.nodes.keys()]).toEqual(['a', 'm', 'z']);
  });

  it('names the reserved namespace when the graph already holds an id the splitter would mint', () => {
    // `#dummy:` is reserved, and the reservation is a convention rather than a
    // guarantee: a caller may hold a node with a minted id. The splitter asks
    // the graph before declaring, so the message says the namespace is reserved
    // and points at the node to rename, rather than the runner's generic
    // "declared virtual but the graph already holds it", which reads as a
    // built-in stage leaving work undone and never uses the word reserved. Only
    // one error surfaces: this one throws first, and the runner's still covers a
    // third-party ranker that mints ids some other way.
    const graph = build(
      ['a', 'm', 'z', '#dummy:az:0'],
      [
        ['a', 'm', 'am'],
        ['m', 'z', 'mz'],
        ['a', 'z', 'az'],
      ],
    );
    let thrown: unknown;
    try {
      layout({ graph });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StageContractError);
    const error = thrown as StageContractError;
    expect(error.stage).toBe('longest-path-rank');
    expect(error.id).toBe('#dummy:az:0');
    expect(error.message).toContain('reserved');
    expect(error.message).toContain('rename the node');
  });

  it('gives two parallel long edges a chain each, sharing no dummy', () => {
    // The id carries the edge, so parallel edges never collide, and they must
    // not: one dummy in two chains would be pulled toward two routes at once.
    const graph = build(
      ['a', 'm', 'z'],
      [
        ['a', 'm', 'am'],
        ['m', 'z', 'mz'],
        ['a', 'z', 'az'],
        ['a', 'z', 'az2'],
      ],
    );
    const state = rank(graph);
    expect(chainOf(state, 'az')).toEqual(['#dummy:az:0']);
    expect(chainOf(state, 'az2')).toEqual(['#dummy:az2:0']);
    // Both are declared, and both are on rank 1 alongside `m`.
    expect([...(state.virtualNodes?.keys() ?? [])]).toEqual(['#dummy:az:0', '#dummy:az2:0']);
  });

  it('gives the same graph the same chains twice', () => {
    const graph = detour();
    expect([...(rank(graph).virtualChains ?? [])]).toEqual([...(rank(graph).virtualChains ?? [])]);
    expect(layout({ graph })).toEqual(layout({ graph }));
  });
});

describe('straightRouteStage over a chain', () => {
  it('bends a long edge through its dummies and leaves a short edge two points', () => {
    let positions: ReadonlyMap<NodeId, Point> = new Map();
    const watching: PositionStage = {
      name: 'watching-position',
      run(input) {
        const output = defaultStages.position.run(input);
        positions = output.positions;
        return output;
      },
    };
    const result = layout({ graph: detour() }, { position: watching });
    expect(result.edges.get('az')?.points).toEqual([
      positions.get('a'),
      positions.get('#dummy:az:0'),
      positions.get('z'),
    ]);
    // Every segment is still straight, which is what the stage's name means.
    // What changed is that the polyline now has more than one of them.
    expect(result.edges.get('am')?.points).toHaveLength(2);
    expect(result.edges.get('mz')?.points).toHaveLength(2);
  });

  it('walks a reversed edge chain from source to target, so the route still runs that way', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd'],
        ['d', 'a', 'da'],
      ],
    );
    const result = layout({ graph });
    const points = result.edges.get('da')?.points ?? [];
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: result.nodes.get('d')?.x, y: result.nodes.get('d')?.y });
    expect(points.at(-1)).toEqual({ x: result.nodes.get('a')?.x, y: result.nodes.get('a')?.y });
    // The chain was listed source to target, so the polyline climbs the page
    // without the router reversing anything.
    const ys = points.map((point) => point.y);
    expect(ys).toEqual([...ys].sort((left, right) => right - left));
  });
});

describe('bounds around a bend', () => {
  it('grows the bounds to hold a route point outside every node box', () => {
    // The claim `bounds` used to make, that routes run centre to centre and
    // cannot leave the node hull, stops being true the moment a route bends
    // through a dummy: `insertionOrderStage` puts a virtual node last in its
    // layer and `gridPositionStage` lays a row out left to right, so a
    // zero-width dummy sits at the row's right extreme, outside every box.
    const result = layout({ graph: detour() });
    const dummyX = 75;
    const boxes = [...result.nodes.values()].map((node) => node.x + node.width / 2);
    expect(Math.max(...boxes)).toBe(50);
    expect(result.edges.get('az')?.points[1]?.x).toBe(dummyX);
    expect(result.bounds).toEqual({ x: -75, y: 0, width: 150, height: 220 });
  });

  it('leaves the bounds of a chainless layout exactly where they were', () => {
    // A straight route's endpoints are node centres, always inside their own
    // boxes, so the hull of the boxes and the points is the hull of the boxes.
    // Nothing that was laid out before M2.4b moves.
    const result = layout({ graph: build(['a', 'b'], [['a', 'b', 'ab']]) });
    expect(result.bounds).toEqual({ x: -50, y: 0, width: 100, height: 130 });
  });
});
