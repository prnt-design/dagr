import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import type {
  LayoutStages,
  OrderStage,
  Point,
  PositionStage,
  RankStage,
  RouteStage,
} from '../src/index.js';
import { recordingStages } from './fakes.js';

function chain(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  return graph;
}

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

/** Ranks `a` above `b`, so the layers have two distinct ranks to disagree with. */
const spreadRank: RankStage = {
  name: 'spread-rank',
  run: (input) => ({
    ...defaultStages.rank.run(input),
    ranks: new Map([
      ['a', 0],
      ['b', 1],
    ]),
  }),
};

describe('layout stage contract', () => {
  it('catches a rank stage that leaves a node unranked', () => {
    const forgetful: RankStage = {
      name: 'forgetful-rank',
      run: (input) => ({ ...defaultStages.rank.run(input), ranks: new Map([['a', 0]]) }),
    };
    const error = expectContractError({ rank: forgetful });
    expect(error.code).toBe('STAGE_CONTRACT');
    expect(error.stage).toBe('forgetful-rank');
    expect(error.id).toBe('b');
    expect(error.message).toContain('forgetful-rank');
    expect(error.message).toContain('"b"');
  });

  it('catches a rank stage that assigns a rank that is not a finite number', () => {
    const nonsense: RankStage = {
      name: 'nonsense-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        ranks: new Map([
          ['a', 0],
          ['b', Number.NaN],
        ]),
      }),
    };
    const error = expectContractError({ rank: nonsense });
    expect(error.stage).toBe('nonsense-rank');
    expect(error.id).toBe('b');
    expect(error.message).toContain('NaN');
  });

  it('catches an order stage that drops a node from the layers', () => {
    const dropping: OrderStage = {
      name: 'dropping-order',
      run: () => ({ layers: [['a']] }),
    };
    const error = expectContractError({ order: dropping });
    expect(error.stage).toBe('dropping-order');
    expect(error.id).toBe('b');
    expect(error.message).toContain('missing from the layers');
  });

  it('catches an order stage that lists a node twice', () => {
    const doubling: OrderStage = {
      name: 'doubling-order',
      run: () => ({ layers: [['a'], ['b'], ['a']] }),
    };
    const error = expectContractError({ order: doubling });
    expect(error.stage).toBe('doubling-order');
    expect(error.id).toBe('a');
    expect(error.message).toContain('twice');
  });

  it('catches an order stage that invents a node', () => {
    const inventing: OrderStage = {
      name: 'inventing-order',
      run: () => ({ layers: [['a', 'ghost'], ['b']] }),
    };
    const error = expectContractError({ order: inventing });
    expect(error.stage).toBe('inventing-order');
    expect(error.id).toBe('ghost');
  });

  it('catches a rank stage that ranks a target above its source', () => {
    const backwards: RankStage = {
      name: 'backwards-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        ranks: new Map([
          ['a', 1],
          ['b', 0],
        ]),
      }),
    };
    const error = expectContractError({ rank: backwards });
    expect(error.stage).toBe('backwards-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('runs from rank 1 to rank 0');
  });

  it('catches a rank stage that reverses an edge and then ranks it forwards anyway', () => {
    const confused: RankStage = {
      name: 'confused-rank',
      run: (input) => ({
        ...spreadRank.run(input),
        reversedEdges: new Set(['ab']),
      }),
    };
    const error = expectContractError({ rank: confused });
    expect(error.stage).toBe('confused-rank');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('reversed');
  });

  it('catches a rank stage that reverses an edge the graph does not hold', () => {
    const stale: RankStage = {
      name: 'stale-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        reversedEdges: new Set(['gone']),
      }),
    };
    const error = expectContractError({ rank: stale });
    expect(error.stage).toBe('stale-rank');
    expect(error.id).toBe('gone');
    expect(error.message).toContain('reversed');
  });

  it('lets a genuinely reversed edge through', () => {
    const reversing: RankStage = {
      name: 'reversing-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        ranks: new Map([
          ['a', 1],
          ['b', 0],
        ]),
        reversedEdges: new Set(['ab']),
      }),
    };
    const result = layout({ graph: chain() }, { rank: reversing });
    expect(result.nodes.get('b')?.y).toBeLessThan(result.nodes.get('a')?.y ?? 0);
  });

  it('catches an order stage that puts a node in a layer of another rank', () => {
    const mixing: OrderStage = {
      name: 'mixing-order',
      run: () => ({ layers: [['a', 'b']] }),
    };
    const error = expectContractError({ rank: spreadRank, order: mixing });
    expect(error.stage).toBe('mixing-order');
    expect(error.id).toBe('b');
    expect(error.message).toContain('rank 1');
  });

  it('catches an order stage that emits its layers out of rank order', () => {
    const descending: OrderStage = {
      name: 'descending-order',
      run: () => ({ layers: [['b'], ['a']] }),
    };
    const error = expectContractError({ rank: spreadRank, order: descending });
    expect(error.stage).toBe('descending-order');
    expect(error.id).toBe('a');
    expect(error.message).toContain('top to bottom');
  });

  it('catches an order stage that emits an empty layer', () => {
    const padding: OrderStage = {
      name: 'padding-order',
      run: () => ({ layers: [['a'], [], ['b']] }),
    };
    const error = expectContractError({ rank: spreadRank, order: padding });
    expect(error.stage).toBe('padding-order');
    expect(error.id).toBe('layer 1');
    expect(error.message).toContain('empty');
  });

  it('catches a position stage that leaves a node unplaced', () => {
    const partial: PositionStage = {
      name: 'partial-position',
      run: () => ({ positions: new Map([['a', { x: 0, y: 0 }]]) }),
    };
    const error = expectContractError({ position: partial });
    expect(error.stage).toBe('partial-position');
    expect(error.id).toBe('b');
    expect(error.message).toContain('no position was assigned');
  });

  it('catches a position stage that produces a coordinate that is not finite', () => {
    const infinite: PositionStage = {
      name: 'infinite-position',
      run: () => ({
        positions: new Map<string, Point>([
          ['a', { x: 0, y: 0 }],
          ['b', { x: Number.POSITIVE_INFINITY, y: 0 }],
        ]),
      }),
    };
    const error = expectContractError({ position: infinite });
    expect(error.stage).toBe('infinite-position');
    expect(error.id).toBe('b');
  });

  it('catches a route stage that leaves an edge unrouted', () => {
    const lazy: RouteStage = {
      name: 'lazy-route',
      run: (input) => ({ ...defaultStages.route.run(input), routes: new Map() }),
    };
    const error = expectContractError({ route: lazy });
    expect(error.stage).toBe('lazy-route');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('no route was assigned');
  });

  it('catches a route with fewer than two points', () => {
    const stub: RouteStage = {
      name: 'stub-route',
      run: () => ({ routes: new Map([['ab', [{ x: 0, y: 0 }]]]) }),
    };
    const error = expectContractError({ route: stub });
    expect(error.stage).toBe('stub-route');
    expect(error.id).toBe('ab');
    expect(error.message).toContain('at least two');
  });

  // The rule that only became checkable in M2.2. Before it, `reversedEdges` was
  // always empty and no router could get the direction wrong; now one can, and
  // the failure is silent all the way to M4's arrowheads.
  it('catches a route stage that emits a reversed edge target-first', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', 'ab');
    graph.addEdge('b', 'a', 'ba');

    let reversed = 0;
    const backwards: RouteStage = {
      name: 'backwards-route',
      run(input) {
        reversed = input.reversedEdges.size;
        const routes = new Map<string, readonly Point[]>();
        for (const edge of input.graph.edges()) {
          const from = input.positions.get(edge.source);
          const to = input.positions.get(edge.target);
          if (from === undefined || to === undefined) throw new Error('unpositioned');
          // The mistake this check exists to catch: a router that works off the
          // ranked direction emits the polyline the way it ranked it.
          routes.set(edge.id, input.reversedEdges.has(edge.id) ? [to, from] : [from, to]);
        }
        return { routes };
      },
    };

    const error = expectContractError({ route: backwards }, graph);
    // The default ranker has to have reversed something, or the stage above is
    // the straight router with extra steps and this test proves nothing.
    expect(reversed).toBeGreaterThan(0);
    expect(error.stage).toBe('backwards-route');
    expect(error.id).toBe('ba');
    expect(error.message).toContain('source');
  });

  // The proximity form has to be non-strict, because a self loop puts both
  // endpoints at the same point and every distance in the comparison is equal.
  it('lets a self loop through, whose two endpoints are the same point', () => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addEdge('a', 'a', 'aa');
    const result = layout({ graph });
    expect(result.edges.get('aa')?.points).toHaveLength(2);
  });

  it('catches a route stage that invents an edge', () => {
    const inventing: RouteStage = {
      name: 'inventing-route',
      run(input) {
        const routed = defaultStages.route.run(input);
        const routes = new Map(routed.routes);
        routes.set('ba', [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]);
        return { routes };
      },
    };
    const error = expectContractError({ route: inventing });
    expect(error.stage).toBe('inventing-route');
    expect(error.id).toBe('ba');
    expect(error.message).toContain('not an edge of the graph');
  });

  // Gone with the route stage's `LayoutResult` return: the checks for a node
  // missing from the result, for a node in the result that the graph does not
  // hold (the virtual-node leak), and the four for stage-supplied `bounds`.
  //
  // A route stage returns a `RoutedState` and supplies routes only. The runner
  // builds the node map by walking the caller's graph and computes `bounds`
  // itself, so none of those five properties is something a stage can get
  // wrong any more: they are constructed rather than checked, and a check that
  // cannot fail is a test that proves nothing. The behaviour they described is
  // pinned in layout.result.test.ts and layout.pipeline.test.ts instead, as
  // assertions on what the runner produces. `bounds` keeps a runner-level
  // assertion guarding `boundsOf`, whose one observable edge (the containment
  // tolerance) is tested in layout.result.test.ts.

  it('fails at the offending stage boundary, before the next stage runs', () => {
    const forgetful: RankStage = {
      name: 'forgetful-rank',
      run: (input) => ({ ...defaultStages.rank.run(input), ranks: new Map([['a', 0]]) }),
    };
    const recorder = recordingStages();
    expect(() => {
      layout({ graph: chain() }, { ...recorder.stages, rank: forgetful });
    }).toThrow(StageContractError);
    expect(recorder.log).toEqual([]);
  });

  // Gone with M2.4a's narrowing of the four stage return types: the four tests
  // for a stage that returns a different graph, and the `graph` label on
  // `StageContractError` that went with them.
  //
  // A stage returns its own fields now (a `RankOutput` and its three siblings)
  // and the runner builds each record around its own graph and its own config.
  // There is no field for a different graph to arrive in, so `checkGraphKept`
  // was deleted rather than left as a check that cannot fire, and a test for it
  // would be a test that a `StageContractError` is thrown by code that no
  // longer exists for a program that no longer compiles. The property those
  // four tests protected is pinned three ways instead: by the `never` fields on
  // the four output types, case by case in stage-output.types.test.ts; by the
  // test below; and by the merge tests in layout.pipeline.test.ts, which assert
  // the record the next stage reads carries the RUNNER's graph by identity.
  //
  // What none of that reaches is a stage that mutates the graph it was handed,
  // which is a runtime rule and is tested in layout.virtual.test.ts.

  it('lays the graph out from the roster the runner holds, not one an order stage prefers', () => {
    // What the escape hatch used to be. An orderer that wanted a smaller graph
    // could return one, and every check downstream that read the record's own
    // graph would then run against the shrunken roster. It cannot return one at
    // all now, so the only thing left of the attempt is the layers it emitted,
    // and those are short a node: the failure lands on the orderer, named, at
    // the orderer's own boundary.
    const shrinking: OrderStage = {
      name: 'shrinking-order',
      run: () => ({ layers: [['a']] }),
    };
    const error = expectContractError({ order: shrinking });
    expect(error.stage).toBe('shrinking-order');
    expect(error.id).toBe('b');
    expect(error.message).toContain('missing from the layers');
  });

  it('lets a stage that does its job through untouched', () => {
    const wide: PositionStage = {
      name: 'wide-position',
      run: () => ({
        positions: new Map([
          ['a', { x: -500, y: 0 }],
          ['b', { x: 500, y: 0 }],
        ]),
      }),
    };
    const result = layout({ graph: chain() }, { position: wide });
    expect(result.nodes.get('b')?.x).toBe(500);
  });
});
