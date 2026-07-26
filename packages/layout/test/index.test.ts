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
  OrderStage,
  OrderedState,
  Point,
  PositionStage,
  PositionedState,
  PositionedNode,
  PreparedState,
  RankStage,
  RankedState,
  Rect,
  ResolvedLayoutConfig,
  RoutedEdge,
  RoutedState,
  RouteStage,
  Size,
} from '../src/index.js';
// The default stages are deliberately not part of the public surface, so the
// tests that name them reach into the modules that define them.
import { longestPathRankStage } from '../src/rank.js';
import { gridPositionStage, insertionOrderStage, straightRouteStage } from '../src/stages.js';

describe('@dagr/layout public surface', () => {
  it('exports the entry point', () => {
    expect(typeof api.layout).toBe('function');
  });

  it('exports the default stages as a set, which is what they are reachable as', () => {
    expect(api.defaultStages.rank).toBe(longestPathRankStage);
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
        return { ...placed, positions };
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
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_LAYOUT_CONFIG',
      'DagrLayoutError',
      'InvalidConfigError',
      'StageContractError',
      'defaultStages',
      'layout',
    ]);
  });

  it('exports the DagrLayoutErrorCode type, and every code is a member of it', () => {
    const codes: DagrLayoutErrorCode[] = [
      new api.InvalidConfigError('nodeSep', -1).code,
      new api.StageContractError('rank', 'a', 'why').code,
    ];
    expect(codes).toEqual(['INVALID_CONFIG', 'STAGE_CONTRACT']);
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
    const ranked: RankedState = {
      ...prepared,
      ranks,
      reversedEdges: new Set(),
      virtualNodes: new Set(),
    };
    const ordered: OrderedState = { ...ranked, layers: [['a']] };
    const placed: PositionedState = { ...ordered, positions: new Map([['a', point]]) };
    const wired: RoutedState = { ...placed, routes: new Map() };

    const rank: RankStage = { name: 'r', run: () => ranked };
    const order: OrderStage = { name: 'o', run: () => ordered };
    const position: PositionStage = { name: 'p', run: () => placed };
    const route: RouteStage = { name: 't', run: () => wired };
    const stages: LayoutStages = { rank, order, position, route };
    const overrides: LayoutStageOverrides = { position };

    // The runner assembles the result from the last record's `positions` and
    // `sizes`, so these hand-built records decide the node, not the default run
    // that produced `positioned`.
    const handBuilt: PositionedNode = { id: 'a', x: 0, y: 0, width: 1, height: 2 };
    expect(api.layout(input, stages).nodes.get('a')).toEqual(handBuilt);
    expect(api.layout(input, overrides).nodes.get('a')).toEqual(handBuilt);
    expect(positioned).toEqual({ id: 'a', x: 0, y: 20, width: 100, height: 40 });
    expect(routed).toBeUndefined();
    expect(bounds).toEqual({ x: -50, y: 0, width: 100, height: 40 });
    expect(rect.width).toBe(1);
  });
});
