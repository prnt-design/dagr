import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import type {
  LayoutStages,
  OrderStage,
  Point,
  PositionStage,
  RankStage,
  RouteStage,
  Size,
} from '../src/index.js';

/** `a -> b`, the shortest graph a long edge could later be split across. */
function chain(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  return graph;
}

/**
 * A rank stage that does what M2.4b will do to a long edge: declare a node the
 * caller never added, with the size it wants for it, rank it, and leave the
 * source graph alone.
 */
function dummyRankStage(size: Size = { width: 1, height: 40 }): RankStage {
  return {
    name: 'dummy-rank',
    run: () => ({
      ranks: new Map<NodeId, number>([
        ['a', 0],
        ['ab#1', 1],
        ['b', 2],
      ]),
      reversedEdges: new Set<EdgeId>(),
      virtualNodes: new Map<NodeId, Size>([['ab#1', size]]),
    }),
  };
}

/** An order stage that lays the roster out one node per layer, ranks ascending. */
const oneNodePerLayer: OrderStage = {
  name: 'one-node-per-layer',
  run: () => ({ layers: [['a'], ['ab#1'], ['b']] }),
};

/** Runs a layout expected to fail, and returns the error for inspection. */
function expectContractError(stages: Partial<LayoutStages>): StageContractError {
  try {
    layout({ graph: chain() }, stages);
  } catch (error) {
    if (error instanceof StageContractError) return error;
    throw error;
  }
  throw new Error('layout should have thrown a StageContractError');
}

describe('virtual nodes', () => {
  it('runs a declared virtual node through the whole pipeline', () => {
    const result = layout({ graph: chain() }, { rank: dummyRankStage(), order: oneNodePerLayer });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.has('ab#1')).toBe(false);
  });

  it('keeps a virtual node out of the public result but on its own rank', () => {
    const result = layout({ graph: chain() }, { rank: dummyRankStage(), order: oneNodePerLayer });
    // Three rows of a 40-tall node with the default rankSep of 50.
    expect(result.nodes.get('a')?.y).toBe(20);
    expect(result.nodes.get('b')?.y).toBe(200);
    expect(result.edges.get('ab')?.points).toEqual([
      { x: 0, y: 20 },
      { x: 0, y: 200 },
    ]);
  });

  it('gives the virtual node a size the position stage can use', () => {
    // A dagre dummy is narrow so that nodeSep spacing still works around it.
    // The roster carrying its size is what lets the position stage ask for it,
    // and a different size moves the rows below it.
    const short = layout(
      { graph: chain() },
      { rank: dummyRankStage({ width: 400, height: 10 }), order: oneNodePerLayer },
    );
    expect(short.nodes.get('b')?.y).toBe(170);
  });

  it('lets the default order stage place a virtual node, so M2.4b is a ranker change', () => {
    const result = layout({ graph: chain() }, { rank: dummyRankStage() });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.get('b')?.y).toBe(200);
  });

  // Two tests are gone here, and both premises went with M2.4a rather than
  // being weakened. "A ranker that declares a virtual node without sizing it"
  // is no longer a program: a declaration IS a size, so the runner has no way
  // to be handed an id with no measurement behind it, and the check that caught
  // it was deleted along with the shape that made it possible. "A ranker that
  // overwrites the size the caller's own node was measured at" went the same
  // way: `sizes` is the runner's to build now, and a stage can only state a
  // size for a node it declared itself. What is left of that second test is the
  // one case still reachable, an unusable size on a node the stage did declare,
  // which is the test below.

  it('rejects an unusable declared size, naming the ranker', () => {
    // The one size in a run the config never validated: prepare measured and
    // checked every node the graph holds, and this one was minted afterwards by
    // the stage. A NaN here would survive to the runner's bounds arithmetic and
    // be reported as a runner invariant, naming nobody.
    const badSize: RankStage = {
      name: 'bad-size-rank',
      run: () => ({
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['ghost', 0],
          ['b', 1],
        ]),
        reversedEdges: new Set<EdgeId>(),
        virtualNodes: new Map<NodeId, Size>([['ghost', { width: Number.NaN, height: 40 }]]),
      }),
    };
    const error = expectContractError({ rank: badSize });
    expect(error.stage).toBe('bad-size-rank');
    expect(error.id).toBe('ghost');
    expect(error.message).toContain('size');
  });

  it('lets a rank stage omit virtualNodes and hands the next stage an empty set', () => {
    // The field is optional because a ranker with nothing to declare has
    // nothing to say, and a required field it can only answer with an empty set
    // is a question that should not have been asked. What the runner supplies in
    // its place is the empty set, not `undefined`, so no downstream stage and no
    // check has to handle an absent roster.
    let seen: ReadonlySet<NodeId> | undefined;
    const quiet: RankStage = {
      name: 'quiet-rank',
      run: () => ({
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['b', 1],
        ]),
        reversedEdges: new Set<EdgeId>(),
      }),
    };
    const watching: OrderStage = {
      name: 'watching-order',
      run(input) {
        seen = input.virtualNodes;
        return { layers: [['a'], ['b']] };
      },
    };
    const result = layout({ graph: chain() }, { rank: quiet, order: watching });
    expect(seen?.size).toBe(0);
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('rosters, orders, positions and sizes two declared virtual nodes from the declaration alone', () => {
    // Declaring and sizing are one act now, so this stage never copies
    // `PreparedState.sizes`: it names the two ids it needs and the sizes it
    // wants for them, and the runner folds them into the roster-wide map. The
    // heights below are what the rows are made of, so a size the runner dropped
    // would move `b`.
    const twoDummies: RankStage = {
      name: 'two-dummy-rank',
      run: () => ({
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['ab#1', 1],
          ['ab#2', 2],
          ['b', 3],
        ]),
        reversedEdges: new Set<EdgeId>(),
        virtualNodes: new Map<NodeId, Size>([
          ['ab#1', { width: 1, height: 10 }],
          ['ab#2', { width: 1, height: 30 }],
        ]),
      }),
    };
    let rostered: readonly NodeId[] = [];
    let placed: ReadonlyMap<NodeId, Point> = new Map();
    const watching: PositionStage = {
      name: 'watching-position',
      run(input) {
        rostered = [...input.virtualNodes];
        const output = defaultStages.position.run(input);
        placed = output.positions;
        return output;
      },
    };
    const result = layout({ graph: chain() }, { rank: twoDummies, position: watching });
    expect(rostered).toEqual(['ab#1', 'ab#2']);
    // Ordered onto their own layers by the default orderer, and positioned by
    // the default positioner, so a declared node is a full citizen of both.
    expect(placed.get('ab#1')).toEqual({ x: 0, y: 95 });
    expect(placed.get('ab#2')).toEqual({ x: 0, y: 165 });
    // Rows of 40, 10 and 30 with the default rankSep of 50 put `b` here, which
    // is only true if both declared heights reached the position stage.
    expect(result.nodes.get('b')?.y).toBe(250);
    // And they stop at the route stage, as they always have.
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('still rejects a declared id the graph already holds, blaming the ranker', () => {
    // The one `checkRanked` rule about declarations that the narrowing does not
    // make unrepresentable, and still the right error: the ids collide, which no
    // type can see. A collision is not a second node, it is the caller's node
    // wearing a stage's clothes, and the declaration's size wins in the
    // roster-wide map, so the caller's own node quietly changes size. With the
    // default orderer it does eventually fail, but as a duplicate against the
    // ORDER stage, which blames the wrong stage for the ranker's bad
    // declaration.
    const colliding: RankStage = {
      name: 'colliding-declaration-rank',
      run: () => ({
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['b', 1],
        ]),
        reversedEdges: new Set<EdgeId>(),
        virtualNodes: new Map<NodeId, Size>([['b', { width: 999, height: 999 }]]),
      }),
    };
    const error = expectContractError({ rank: colliding });
    expect(error.stage).toBe('colliding-declaration-rank');
    expect(error.id).toBe('b');
    expect(error.message).toContain('the graph already holds it');
  });

  it('keeps a virtual node out of the result even from a router that tries', () => {
    // This replaces a check. A route stage used to return the `LayoutResult`
    // and could put a dummy in its node map, so the runner checked for it. A
    // route stage now returns routes only and the runner builds the node map by
    // walking the caller's graph, so a leak has no route in. The property is
    // the same one and it is now constructed rather than checked, which is why
    // the router below can declare a route through the dummy and still not
    // leak it.
    const throughDummy: RouteStage = {
      name: 'through-dummy-route',
      run(input) {
        const routes = new Map(defaultStages.route.run(input).routes);
        const dummy = input.positions.get('ab#1');
        const from = input.positions.get('a');
        const to = input.positions.get('b');
        if (dummy === undefined || from === undefined || to === undefined) {
          throw new Error('unreachable');
        }
        routes.set('ab', [from, dummy, to]);
        return { routes };
      },
    };
    const result = layout(
      { graph: chain() },
      { rank: dummyRankStage(), order: oneNodePerLayer, route: throughDummy },
    );
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.has('ab#1')).toBe(false);
    // The dummy's coordinate still shapes the route, which is the M2.4b shape.
    expect(result.edges.get('ab')?.points).toHaveLength(3);
    expect(result.bounds.height).toBe(220);
  });
});
