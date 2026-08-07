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
function expectContractError(
  stages: Partial<LayoutStages>,
  graph: Graph = chain(),
): StageContractError {
  try {
    layout({ graph }, stages);
  } catch (error) {
    if (error instanceof StageContractError) return error;
    throw error;
  }
  throw new Error('layout should have thrown a StageContractError');
}

/** The one dummy size every chain test below uses, since none is about sizing. */
const dummySize: Size = { width: 1, height: 40 };

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
  // to be handed an id with no measurement behind it. "A ranker that overwrites
  // the size the caller's own node was measured at" went the same way: `sizes`
  // is the runner's to build now, and a stage can only state a size for a node
  // it declared itself. So the size VALIDATION narrowed to the declaration
  // alone, which is the test below, and what is gone is the pair of shapes that
  // made those two programs writable.
  //
  // The size LOOKUP did not go anywhere, and the M2.4a review was right that it
  // could not: see the graph-mutation test further down for the one way still
  // left to put a roster member in front of the runner that nothing measured.

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

  it('names the ranker when it adds a node to the graph instead of declaring it', () => {
    // The hazard the roster-size rule exists for, and the reason it is a rule
    // rather than a runner invariant. `PreparedState.graph` is a live mutable
    // `Graph` and the roster is recomputed from `graph.nodes()` at every check,
    // so a ranker that ADDS its dummy rather than declaring it produces a
    // roster member `prepared.sizes` never covered. Nothing in the type system
    // can see that: narrowing the return types stops a stage handing a graph
    // back, not a stage reaching into the one it was handed.
    //
    // What the caller must not get is `InternalLayoutError: ... This is a bug
    // in @dagr/layout`, which is a third-party stage author being told to file
    // a bug against us for their own mistake. M2.4b makes "just add the dummy
    // to the graph" the obvious wrong first attempt, so this is the error that
    // has to name the ranker.
    const mutating: RankStage = {
      name: 'mutating-rank',
      run(input) {
        input.graph.addNode('ab#1');
        return {
          ranks: new Map<NodeId, number>([
            ['a', 0],
            ['ab#1', 1],
            ['b', 2],
          ]),
          reversedEdges: new Set<EdgeId>(),
        };
      },
    };
    const error = expectContractError({ rank: mutating });
    expect(error.code).toBe('STAGE_CONTRACT');
    expect(error.stage).toBe('mutating-rank');
    expect(error.id).toBe('ab#1');
    expect(error.message).toContain('no size was assigned');
    expect(error.message).toContain('virtualNodes');
  });

  it('orders the roster by id rather than by the order the ranker declared in', () => {
    // Deterministic run to run either way, but declaration order is not
    // INCREMENTALLY stable: a dummy's index within its layer would depend on
    // where its edge happened to sit in the ranker's iteration, so adding an
    // unrelated edge upstream would shift every later dummy in its layer and
    // move the bends of long edges whose endpoints did not move. M2.4b's
    // deterministic-id rule is necessary for stability and not sufficient; the
    // roster being ordered by id is what completes it.
    function sameRankDummies(order: readonly NodeId[]): RankStage {
      return {
        name: 'same-rank-dummy-rank',
        run: () => ({
          ranks: new Map<NodeId, number>([
            ['a', 0],
            ['ab#1', 1],
            ['ab#2', 1],
            ['b', 2],
          ]),
          reversedEdges: new Set<EdgeId>(),
          virtualNodes: new Map<NodeId, Size>(order.map((id) => [id, dummySize])),
        }),
      };
    }
    function layersFrom(rank: RankStage): readonly (readonly NodeId[])[] {
      let seen: readonly (readonly NodeId[])[] = [];
      const watching: PositionStage = {
        name: 'watching-position',
        run(input) {
          seen = input.layers;
          return defaultStages.position.run(input);
        },
      };
      layout({ graph: chain() }, { rank, position: watching });
      return seen;
    }
    const declared = layersFrom(sameRankDummies(['ab#1', 'ab#2']));
    const reversed = layersFrom(sameRankDummies(['ab#2', 'ab#1']));
    expect(declared).toEqual([['a'], ['ab#1', 'ab#2'], ['b']]);
    expect(reversed).toEqual(declared);
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

/** `a -> b` twice, so two chains have something to collide over. */
function parallel(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'b', 'ab2');
  return graph;
}

/**
 * A ranker that declares whatever a chain test is about, so each test states
 * only the part it is testing. Every declared id gets the same size, because no
 * test here is about sizing.
 */
function chainRank(spec: {
  readonly ranks: readonly (readonly [NodeId, number])[];
  readonly declare: readonly NodeId[];
  readonly chains: readonly (readonly [EdgeId, readonly NodeId[]])[];
  readonly reversed?: readonly EdgeId[];
}): RankStage {
  return {
    name: 'chain-rank',
    run: () => ({
      ranks: new Map<NodeId, number>(spec.ranks),
      reversedEdges: new Set<EdgeId>(spec.reversed ?? []),
      virtualNodes: new Map<NodeId, Size>(spec.declare.map((id) => [id, dummySize])),
      virtualChains: new Map<EdgeId, readonly NodeId[]>(spec.chains),
    }),
  };
}

describe('virtual chains', () => {
  it('carries a declared chain through to the next stage, keyed by the caller edge id', () => {
    // The whole point of the field: the router that rejoins a chain into one
    // polyline is handed the edge it belongs to and the order to walk it in,
    // rather than parsing a dummy id back apart.
    let seen: ReadonlyMap<EdgeId, readonly NodeId[]> | undefined;
    const watching: OrderStage = {
      name: 'watching-order',
      run(input) {
        seen = input.virtualChains;
        return defaultStages.order.run(input);
      },
    };
    const result = layout(
      { graph: chain() },
      {
        rank: chainRank({
          ranks: [
            ['a', 0],
            ['ab#1', 1],
            ['b', 2],
          ],
          declare: ['ab#1'],
          chains: [['ab', ['ab#1']]],
        }),
        order: watching,
      },
    );
    expect([...(seen ?? [])]).toEqual([['ab', ['ab#1']]]);
    // And it stops where every other piece of dummy bookkeeping stops.
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('hands the next stage an empty map when the ranker declares no chains', () => {
    // The same treatment `virtualNodes` gets, and for the same reason: no
    // downstream stage and no check should have to handle an absent map.
    let seen: ReadonlyMap<EdgeId, readonly NodeId[]> | undefined;
    const watching: OrderStage = {
      name: 'watching-order',
      run(input) {
        seen = input.virtualChains;
        return defaultStages.order.run(input);
      },
    };
    layout({ graph: chain() }, { order: watching });
    expect(seen?.size).toBe(0);
  });

  it('catches a chain keyed by an edge the graph does not hold', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['ab#1', 1],
          ['b', 2],
        ],
        declare: ['ab#1'],
        chains: [['gone', ['ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('gone');
    expect(error.message).toContain('does not hold that edge');
  });

  it('catches an empty chain, which is not the same as no chain', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['b', 1],
        ],
        declare: [],
        chains: [['ab', []]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('empty');
  });

  it('catches a chain member that was never declared in virtualNodes', () => {
    // Without this the id would be in a chain, absent from the roster, and
    // therefore unranked, unordered and unpositioned, and the router would ask
    // for a coordinate nothing ever computed.
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['b', 1],
        ],
        declare: [],
        chains: [['ab', ['ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab#1');
    expect(error.message).toContain('virtualNodes');
  });

  it('catches one dummy shared between two chains', () => {
    // A dummy belongs to exactly one edge. Shared, it would be pulled toward
    // two routes at once and each of them would bend through a coordinate
    // chosen for the other.
    const error = expectContractError(
      {
        rank: chainRank({
          ranks: [
            ['a', 0],
            ['ab#1', 1],
            ['b', 2],
          ],
          declare: ['ab#1'],
          chains: [
            ['ab', ['ab#1']],
            ['ab2', ['ab#1']],
          ],
        }),
      },
      parallel(),
    );
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab#1');
    expect(error.message).toContain('more than one');
  });

  it('catches a dummy listed twice in one chain', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['ab#1', 1],
          ['b', 2],
        ],
        declare: ['ab#1'],
        chains: [['ab', ['ab#1', 'ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab#1');
    expect(error.message).toContain('more than one');
  });

  it('catches a chain whose ranks are not strictly monotonic', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['ab#1', 2],
          ['ab#2', 1],
          ['b', 3],
        ],
        declare: ['ab#1', 'ab#2'],
        chains: [['ab', ['ab#1', 'ab#2']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 1 follows rank 2');
  });

  it('catches a chain that leaves the ranks its endpoints sit between', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['ab#1', 5],
          ['b', 2],
        ],
        declare: ['ab#1'],
        chains: [['ab', ['ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 2 follows rank 5');
  });

  it('takes a chain that descends for a reversed edge, because a chain runs source to target', () => {
    // The direction decision, stated as a test. A chain is listed source to
    // target as the CALLER authored them, matching `RoutedEdge.points`, so a
    // reversed edge's chain runs DOWN the ranks rather than up them. Writing
    // the rule as "strictly increasing" would reject this, and it is correct.
    const result = layout(
      { graph: chain() },
      {
        rank: chainRank({
          ranks: [
            ['a', 2],
            ['ab#1', 1],
            ['b', 0],
          ],
          declare: ['ab#1'],
          chains: [['ab', ['ab#1']]],
          reversed: ['ab'],
        }),
      },
    );
    expect(result.nodes.get('b')?.y).toBeLessThan(result.nodes.get('a')?.y ?? 0);
  });

  it('catches a chain with a hole in it, and names the rank that is missing', () => {
    // The rule M2.4a left open and M2.4b decided. One dummy at rank 1 on an
    // edge from rank 0 to rank 3 passes all five rules above, and its route
    // then crosses rank 2 at an x nothing constrains, which is the thing
    // dummies exist to prevent. The message names rank 2 rather than counting:
    // a count says the chain is too short, and this says where the hole is.
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['ab#1', 1],
          ['filler', 2],
          ['b', 3],
        ],
        declare: ['ab#1', 'filler'],
        chains: [['ab', ['ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 2');
    // And it names what made rank 2 a rank. Completeness is a property of the
    // whole ranking rather than of this edge, so the node that put the layer
    // there is routinely not on the chain being blamed for skipping it, and a
    // message that only said "rank 2" would leave the reader hunting for it.
    expect(error.message).toContain('"filler"');
  });

  it('blames a complete chain for a rank an unchained dummy introduced, and says which node', () => {
    // The two rules a paragraph apart compose into a third. A declared id needs
    // no chain, AND a chain covers every rank the layout actually has between
    // its endpoints, so an orphan dummy declared at a rank nothing previously
    // occupied retroactively makes every chain spanning that rank incomplete.
    // Here `ab`'s chain covers rank 10, which was every rank between 0 and 20
    // until `loose` put a layer at rank 5, and now it does not.
    //
    // The behaviour is CORRECT and this test pins it rather than regrets it: if
    // a layer exists at rank 5, a long edge really does cross it at an x nothing
    // in it constrains. What the message has to do is say so, which is why it
    // names `loose` and not only the rank.
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 0],
          ['loose', 5],
          ['ab#1', 10],
          ['b', 20],
        ],
        declare: ['loose', 'ab#1'],
        chains: [['ab', ['ab#1']]],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 5');
    expect(error.message).toContain('"loose"');
  });

  it('names the first missing rank walking a reversed chain source to target', () => {
    // Same rule on a reversed edge, where "first" is the first one the ROUTE
    // meets: the chain descends from rank 4 to rank 0, holds rank 3, and the
    // next rank the route would cross is 2. Reporting rank 1 instead would be
    // naming the far end of the hole rather than the near one.
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 4],
          ['ab#3', 3],
          ['low', 1],
          ['mid', 2],
          ['b', 0],
        ],
        declare: ['ab#3', 'low', 'mid'],
        chains: [['ab', ['ab#3']]],
        reversed: ['ab'],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 2');
  });

  it('takes a chain over ranks that are not contiguous, so the rule assumes none', () => {
    // The case that proves the rule is "every rank the layout actually has
    // between the endpoints" and not "steps of exactly one". Ranks 0, 10 and 20
    // are a perfectly legal ranking: `insertionOrderStage` sorts the distinct
    // ranks it finds rather than assuming a contiguous run, and so must this.
    // A rule phrased as steps of one would demand nine dummies here, none of
    // which would have a layer to sit in.
    const result = layout(
      { graph: chain() },
      {
        rank: chainRank({
          ranks: [
            ['a', 0],
            ['ab#1', 10],
            ['b', 20],
          ],
          declare: ['ab#1'],
          chains: [['ab', ['ab#1']]],
        }),
      },
    );
    expect(result.edges.get('ab')?.points).toHaveLength(3);
  });

  it('lets a ranker declare no chain at all for a long edge', () => {
    // The scope of the completeness rule, stated as a test: it is about a chain
    // that EXISTS. Having one stays optional, a ranker that splits nothing is
    // still legal, and the route it produces is the straight two-point line it
    // always was.
    const result = layout(
      { graph: chain() },
      {
        rank: chainRank({
          ranks: [
            ['a', 0],
            ['filler', 1],
            ['b', 2],
          ],
          declare: ['filler'],
          chains: [],
        }),
      },
    );
    expect(result.edges.get('ab')?.points).toHaveLength(2);
  });

  it('catches a reversed edge whose chain runs the other way', () => {
    const error = expectContractError({
      rank: chainRank({
        ranks: [
          ['a', 2],
          ['ab#1', 3],
          ['b', 0],
        ],
        declare: ['ab#1'],
        chains: [['ab', ['ab#1']]],
        reversed: ['ab'],
      }),
    });
    expect(error.stage).toBe('chain-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('rank 3 follows rank 2');
  });
});
