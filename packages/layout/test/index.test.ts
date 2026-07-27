import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  DagrLayoutErrorCode,
  LayoutConfig,
  LayoutInput,
  LayoutResult,
  LayoutStageOverrides,
  LayoutStages,
  NetworkSimplexOptions,
  OrderOutput,
  OrderStage,
  OrderedState,
  Point,
  PositionOutput,
  PositionStage,
  PositionedState,
  PositionedNode,
  PreparedState,
  RankOutput,
  RankStage,
  RankedState,
  Rect,
  ResolvedLayoutConfig,
  RouteOutput,
  RoutedEdge,
  RouteStage,
  Size,
} from '../src/index.js';
// `RoutedState` is not part of the public surface: it is the record the runner
// builds after the last stage and hands to nobody, so no caller has a `run` to
// name it in. It is reached from the module that defines it, like the default
// stages below.
import type { RoutedState } from '../src/types.js';
// The three placeholder stages are deliberately not part of the public surface,
// so the tests that name them reach into the module that defines them. The two
// real rank stages are exported, and are reached below through `api`.
import { gridPositionStage, insertionOrderStage, straightRouteStage } from '../src/stages.js';

describe('@dagr/layout public surface', () => {
  it('exports the entry point', () => {
    expect(typeof api.layout).toBe('function');
  });

  it('exports the default stages as a set, which is what they are reachable as', () => {
    expect(api.defaultStages.rank).toBe(api.longestPathRankStage);
    expect(api.defaultStages.order).toBe(insertionOrderStage);
    expect(api.defaultStages.position).toBe(gridPositionStage);
    expect(api.defaultStages.route).toBe(straightRouteStage);
  });

  it('lets a caller wrap a default through defaultStages alone', () => {
    // The use case the four individual exports existed for. Going through
    // `defaultStages` keeps working when M2.7 swaps what `.position` points at,
    // which importing `gridPositionStage` by name would not.
    let shifted = 0;
    const nudging: PositionStage = {
      name: 'nudging-position',
      run(input) {
        const placed = api.defaultStages.position.run(input);
        const positions = new Map<string, Point>();
        for (const [id, point] of placed.positions) {
          shifted += 1;
          positions.set(id, { x: point.x + 1000, y: point.y });
        }
        return { positions };
      },
    };
    const graph = new Graph();
    graph.addNode('a');
    const result = api.layout({ graph }, { position: nudging });
    expect(shifted).toBe(1);
    expect(result.nodes.get('a')?.x).toBe(1000);
  });

  it('exports the resolved defaults', () => {
    expect(api.DEFAULT_LAYOUT_CONFIG).toEqual({
      nodeSep: 50,
      rankSep: 50,
      edgeSep: 10,
      defaultNodeSize: { width: 100, height: 40 },
    });
  });

  it('exports every error class', () => {
    expect(typeof api.DagrLayoutError).toBe('function');
    expect(typeof api.InvalidConfigError).toBe('function');
    expect(typeof api.StageContractError).toBe('function');
    expect(typeof api.InternalLayoutError).toBe('function');
  });

  // The two stages exported by name, because neither is a placeholder waiting
  // for a real algorithm: they are two real algorithms with different
  // objectives, and a caller has to be able to name the one it wants. Naming
  // one of them "the default stage" would not do it, because which one that is
  // changes: M2.2 already moved it once.
  it('exports both rank stages, and the simplex factory', () => {
    expect(api.longestPathRankStage.name).toBe('longest-path-rank');
    expect(api.networkSimplexRankStage.name).toBe('network-simplex-rank');
    expect(api.defaultStages.rank).not.toBe(api.networkSimplexRankStage);
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b');
    const options: NetworkSimplexOptions = { maxIterations: 10, initialRanks: new Map() };
    const stage: RankStage = api.networkSimplexRank(options);
    expect(api.layout({ graph }, { rank: stage }).nodes.size).toBe(2);
    const shortest: RankStage = api.longestPathRankStage;
    expect(api.layout({ graph }, { rank: shortest }).nodes.size).toBe(2);
  });

  // Both are module-level singletons shared by every run in the process, which
  // is the same argument that freezes `defaultStages`, and a stage's `name` is
  // quoted in every `StageContractError` the runner raises against it. An
  // assignment to one of these names would poison those messages process wide,
  // from anywhere that can import the package.
  it('freezes every stage it shares', () => {
    expect(Object.isFrozen(api.defaultStages)).toBe(true);
    expect(Object.isFrozen(api.longestPathRankStage)).toBe(true);
    expect(Object.isFrozen(api.networkSimplexRankStage)).toBe(true);
    expect(() => {
      (api.networkSimplexRankStage as { name: string }).name = 'mine';
    }).toThrow(TypeError);
    expect(api.networkSimplexRankStage.name).toBe('network-simplex-rank');
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_LAYOUT_CONFIG',
      'DagrLayoutError',
      'InternalLayoutError',
      'InvalidConfigError',
      'StageContractError',
      'defaultStages',
      'layout',
      'longestPathRankStage',
      'networkSimplexRank',
      'networkSimplexRankStage',
    ]);
  });

  it('exports the DagrLayoutErrorCode type, and every code is a member of it', () => {
    const codes: DagrLayoutErrorCode[] = [
      new api.InvalidConfigError('nodeSep', -1).code,
      new api.StageContractError('rank', 'a', 'why').code,
      new api.InternalLayoutError('why').code,
    ];
    expect(codes).toEqual(['INVALID_CONFIG', 'STAGE_CONTRACT', 'INTERNAL']);
  });

  it('exports every type the pipeline is described in', () => {
    const graph = new Graph();
    graph.addNode('a');

    const size: Size = { width: 1, height: 2 };
    const point: Point = { x: 0, y: 0 };
    const rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
    const config: LayoutConfig = { nodeSep: 1 };
    const resolved: ResolvedLayoutConfig = api.DEFAULT_LAYOUT_CONFIG;
    const input: LayoutInput = { graph, config };
    const result: LayoutResult = api.layout(input);
    const positioned: PositionedNode | undefined = result.nodes.get('a');
    const routed: RoutedEdge | undefined = result.edges.get('nope');
    const bounds: Rect = result.bounds;

    const prepared: PreparedState = { graph, config: resolved, sizes: new Map([['a', size]]) };
    const ranks = new Map([['a', 0]]);
    // The records a stage READS, still an extends chain, so a stage author can
    // name the argument its `run` is handed. Four of the five are exported from
    // the package; `RoutedState` is not, for the reason at the top of this file.
    const ranked: RankedState = {
      ...prepared,
      ranks,
      reversedEdges: new Set(),
      virtualNodes: new Set(),
      virtualChains: new Map(),
    };
    const ordered: OrderedState = { ...ranked, layers: [['a']] };
    const placed: PositionedState = { ...ordered, positions: new Map([['a', point]]) };
    const wired: RoutedState = { ...placed, routes: new Map() };

    // The four types a stage WRITES. Each is that stage's own contribution, and
    // the runner merges it into the record above.
    const rankOut: RankOutput = { ranks, reversedEdges: new Set() };
    const orderOut: OrderOutput = { layers: [['a']] };
    const positionOut: PositionOutput = { positions: new Map([['a', point]]) };
    const routeOut: RouteOutput = { routes: new Map() };

    const rank: RankStage = { name: 'r', run: () => rankOut };
    const order: OrderStage = { name: 'o', run: () => orderOut };
    const position: PositionStage = { name: 'p', run: () => positionOut };
    const route: RouteStage = { name: 't', run: () => routeOut };
    const stages: LayoutStages = { rank, order, position, route };
    const overrides: LayoutStageOverrides = { position };

    // The runner assembles the result from the last record's `positions` and
    // `sizes`. The position comes from the stage above, and the size does NOT:
    // it is what the runner measured during prepare, because a stage has no
    // field to hand back a size in unless it declared the node itself. The
    // `size` in `prepared` is therefore a record a stage reads, not one it can
    // impose, which is the whole shape of the M2.4a contract in one assertion.
    const handBuilt: PositionedNode = { id: 'a', x: 0, y: 0, width: 100, height: 40 };
    expect(api.layout(input, stages).nodes.get('a')).toEqual(handBuilt);
    expect(api.layout(input, overrides).nodes.get('a')).toEqual(handBuilt);
    expect(positioned).toEqual({ id: 'a', x: 0, y: 20, width: 100, height: 40 });
    expect(routed).toBeUndefined();
    expect(bounds).toEqual({ x: -50, y: 0, width: 100, height: 40 });
    expect(rect.width).toBe(1);
    // The read-side records still exist and still extend one another, which is
    // what lets a stage author name the argument its `run` is handed.
    expect(wired.graph).toBe(graph);
    expect(wired.layers).toEqual([['a']]);
    expect(wired.sizes.get('a')).toBe(size);
  });
});
