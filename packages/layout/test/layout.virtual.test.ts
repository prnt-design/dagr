import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { StageContractError, defaultStages, layout } from '../src/index.js';
import type { LayoutStages, OrderStage, RankStage, RouteStage, Size } from '../src/index.js';

/** `a -> b`, the shortest graph a long edge could later be split across. */
function chain(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  return graph;
}

/**
 * A rank stage that does what M2.4 will do to a long edge: declare a node the
 * caller never added, size it, rank it, and leave the source graph alone.
 */
function dummyRankStage(size: Size = { width: 1, height: 40 }): RankStage {
  return {
    name: 'dummy-rank',
    run(input) {
      const sizes = new Map(input.sizes);
      sizes.set('ab#1', size);
      return {
        ...input,
        sizes,
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['ab#1', 1],
          ['b', 2],
        ]),
        reversedEdges: new Set<EdgeId>(),
        virtualNodes: new Set<NodeId>(['ab#1']),
      };
    },
  };
}

/** An order stage that lays the roster out one node per layer, ranks ascending. */
const oneNodePerLayer: OrderStage = {
  name: 'one-node-per-layer',
  run: (input) => ({ ...input, layers: [['a'], ['ab#1'], ['b']] }),
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

  it('lets the default order stage place a virtual node, so M2.4 is a ranker change', () => {
    const result = layout({ graph: chain() }, { rank: dummyRankStage() });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.get('b')?.y).toBe(200);
  });

  it('rejects a rank stage that declares a virtual node without sizing it', () => {
    const unsized: RankStage = {
      name: 'unsized-rank',
      run: (input) => ({
        ...defaultStages.rank.run(input),
        // Ranked, so the rank check passes and the missing size is what is left.
        ranks: new Map<NodeId, number>([
          ['a', 0],
          ['b', 0],
          ['ghost', 0],
        ]),
        virtualNodes: new Set<NodeId>(['ghost']),
      }),
    };
    const error = expectContractError({ rank: unsized });
    expect(error.stage).toBe('unsized-rank');
    expect(error.id).toBe('ghost');
    expect(error.message).toContain('no size');
  });

  it('rejects an unusable size from the rank stage, naming the ranker', () => {
    // `sizes` is roster-wide from the rank stage on, so a ranker can overwrite
    // the size the caller's own node was measured at. A NaN there survives to
    // the runner's bounds arithmetic, which would report a runner invariant and
    // never name the stage that wrote it. Same misattribution the graph
    // identity check exists to prevent.
    const badSize: RankStage = {
      name: 'bad-size-rank',
      run(input) {
        const sizes = new Map(input.sizes);
        sizes.set('b', { width: Number.NaN, height: 40 });
        return { ...defaultStages.rank.run(input), sizes };
      },
    };
    const error = expectContractError({ rank: badSize });
    expect(error.stage).toBe('bad-size-rank');
    expect(error.id).toBe('b');
    expect(error.message).toContain('size');
  });

  it('rejects a virtual id the graph already holds, blaming the ranker', () => {
    // A collision silently resizes the caller's node, because `sizes` is
    // roster-wide and the declaration wins. With the default orderer it does
    // fail, but as a duplicate against the order stage, which blames the wrong
    // stage for the ranker's bad declaration.
    const colliding: RankStage = {
      name: 'colliding-rank',
      run(input) {
        const sizes = new Map(input.sizes);
        sizes.set('b', { width: 999, height: 999 });
        return {
          ...input,
          sizes,
          ranks: new Map<NodeId, number>([
            ['a', 0],
            ['b', 1],
          ]),
          reversedEdges: new Set<EdgeId>(),
          virtualNodes: new Set<NodeId>(['b']),
        };
      },
    };
    const walksTheGraph: OrderStage = {
      name: 'walks-the-graph',
      run: (input) => ({ ...input, layers: [['a'], ['b']] }),
    };
    const error = expectContractError({ rank: colliding, order: walksTheGraph });
    expect(error.stage).toBe('colliding-rank');
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
        return { ...input, routes };
      },
    };
    const result = layout(
      { graph: chain() },
      { rank: dummyRankStage(), order: oneNodePerLayer, route: throughDummy },
    );
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.has('ab#1')).toBe(false);
    // The dummy's coordinate still shapes the route, which is the M2.4 shape.
    expect(result.edges.get('ab')?.points).toHaveLength(3);
    expect(result.bounds.height).toBe(220);
  });
});
