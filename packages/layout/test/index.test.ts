import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  BarycenterOrderOptions,
  BoundsChange,
  DagrLayoutErrorCode,
  EdgeDelta,
  EdgeStability,
  InfluenceSet,
  Layering,
  LayoutConfig,
  LayoutDelta,
  LayoutDiffOptions,
  LayoutEngine,
  LayoutEngineOptions,
  LayoutInput,
  LayoutPort,
  LayoutResult,
  LayoutStageOverrides,
  LongestPathRankOptions,
  LayoutStages,
  MovedNode,
  NetworkSimplexOptions,
  NodeDelta,
  NodeGeometry,
  NodeStability,
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
  ReroutedEdge,
  ResolvedLayoutConfig,
  RouteOutput,
  RoutedEdge,
  RouteStage,
  Size,
  StabilityReport,
  StabilityViolation,
  StabilityViolationKind,
} from '../src/index.js';
// `RoutedState` is not part of the public surface: it is the record the runner
// builds after the last stage and hands to nobody, so no caller has a `run` to
// name it in. It is reached from the module that defines it, like the default
// stages below.
import type { RoutedState } from '../src/types.js';
// The stages that are deliberately not part of the public surface, so the tests
// that name them reach into the module that defines them: the one remaining
// placeholder, `insertionOrderStage`, which stopped being the default in M2.6b
// and stayed module-local because the ordering evidence still runs it, and
// `brandesKoepfPositionStage`, which M2.7 implemented and left unexported
// because its own measurements say no caller should choose it yet. The stages
// a caller does choose between are exported, and are reached below through
// `api`.
import { brandesKoepfPositionStage } from '../src/position.js';
import { gridPositionStage, insertionOrderStage } from '../src/stages.js';

describe('@dagr/layout public surface', () => {
  it('exports the entry point', () => {
    expect(typeof api.layout).toBe('function');
  });

  // Three names for two sides of one boundary: the engine a caller builds, and
  // the call a worker module makes to answer it. The messages between them are
  // not exported, the way `traversal.ts` is not exported from `@dagr/graph`:
  // both speakers ship here and are upgraded together, so publishing the format
  // would freeze an agreement nobody outside can hold either end of.
  it('exports the engine and the worker side of it', () => {
    expect(typeof api.createLayout).toBe('function');
    expect(typeof api.serveLayout).toBe('function');
    const engine: LayoutEngine = api.createLayout();
    expect(typeof engine.run).toBe('function');
    expect(typeof engine.runAsync).toBe('function');
  });

  it('exports the default stages as a set, which is what they are reachable as', () => {
    expect(api.defaultStages.rank).toBe(api.longestPathRankStage);
    expect(api.defaultStages.order).toBe(api.barycenterOrderStage);
    expect(api.defaultStages.position).toBe(gridPositionStage);
    expect(api.defaultStages.route).toBe(api.polylineRouteStage);
    // The stage `order` used to point at is still in the package and still not
    // exported from it, which is the export rule holding in the one direction
    // it had not been asked to hold in yet: a stage that stops being the
    // default does not thereby earn a public name.
    expect(Object.values(api)).not.toContain(insertionOrderStage);
  });

  it('lets a caller wrap a default through defaultStages alone', () => {
    // The use case the four individual exports existed for. Going through
    // `defaultStages` keeps working when the milestone after M2.4b swaps what
    // `.position` points at, which importing `gridPositionStage` by name would
    // not.
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
    expect(typeof api.WorkerTransportError).toBe('function');
    expect(typeof api.DeltaMismatchError).toBe('function');
  });

  // The delta model, M3.1. Three functions, and the two beside `diffLayout` are
  // there for reasons `index.ts` states: the round trip through `applyDelta` is
  // what a delta MEANS, and `isEmptyDelta` is the question a consumer asks
  // first.
  it('exports the delta model', () => {
    expect(typeof api.diffLayout).toBe('function');
    expect(typeof api.applyDelta).toBe('function');
    expect(typeof api.isEmptyDelta).toBe('function');
    const graph = new Graph();
    graph.addNode('a');
    const first = api.layout({ graph });
    expect(api.isEmptyDelta(api.diffLayout(first, first))).toBe(true);
  });

  // Stability, M3.4. Two functions because stability is two things: a contract
  // over what a relayout was entitled to touch, and a metric over how much of
  // the drawing moved. `stabilityViolations` returns its findings rather than
  // throwing, which is what lets it ship here at all rather than in the test
  // tree; the assertion wrappers live in `test/stability.ts`.
  it('exports the stability contract and the stability metric', () => {
    expect(typeof api.measureStability).toBe('function');
    expect(typeof api.stabilityViolations).toBe('function');
    const graph = new Graph();
    graph.addNode('a');
    const first = api.layout({ graph });
    expect(api.measureStability(first, first).nodes).toMatchObject({ shared: 1, moved: 0 });
    expect(api.stabilityViolations(first, first, { nodes: new Set(), edges: new Set() })).toEqual(
      [],
    );
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
    // The same shape one milestone later (M3.7b): the default ranker has a
    // budget of its own now, so its factory is on the surface beside the stage.
    const shortestOptions: LongestPathRankOptions = { maxWarmShare: 0 };
    const configured: RankStage = api.longestPathRank(shortestOptions);
    expect(api.layout({ graph }, { rank: configured }).nodes.size).toBe(2);
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
    expect(Object.isFrozen(api.barycenterOrderStage)).toBe(true);
    expect(() => {
      (api.networkSimplexRankStage as { name: string }).name = 'mine';
    }).toThrow(TypeError);
    expect(api.networkSimplexRankStage.name).toBe('network-simplex-rank');
  });

  it('exports nothing else at runtime', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_LAYOUT_CONFIG',
      'DagrLayoutError',
      'DeltaMismatchError',
      'EngineStateError',
      'InternalLayoutError',
      'InvalidConfigError',
      'StageContractError',
      'WorkerTransportError',
      'applyDelta',
      'barycenterOrder',
      'barycenterOrderStage',
      'countCrossings',
      'createLayout',
      'defaultStages',
      'diffLayout',
      'influenceRegion',
      'isEmptyDelta',
      'layout',
      'longestPathRank',
      'longestPathRankStage',
      'measureStability',
      'networkSimplexRank',
      'networkSimplexRankStage',
      'polylineRouteStage',
      'serveLayout',
      'stabilityViolations',
    ]);
  });

  // The order stage was exported by name for a milestone before it took the
  // default, which is what makes the export rule "every real stage is exported
  // by name" rather than "every default is": the name did not arrive with the
  // default and does not depend on it. The counter is exported beside it
  // because a metric only a stage can compute is a metric nobody can hold the
  // stage to.
  it('exports the barycenter order stage, its factory, and the crossing counter', () => {
    expect(api.barycenterOrderStage.name).toBe('barycenter-order');
    expect(api.defaultStages.order).toBe(api.barycenterOrderStage);
    expect(Object.isFrozen(api.barycenterOrderStage)).toBe(true);
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b');
    const options: BarycenterOrderOptions = { maxSweeps: 4, initialOrder: [['a'], ['b']] };
    const stage: OrderStage = api.barycenterOrder(options);
    expect(api.layout({ graph }, { order: stage }).nodes.size).toBe(2);
    const drawing: Layering = { graph, layers: [['a'], ['b']] };
    expect(api.countCrossings(drawing)).toBe(0);
  });

  // M2.7's position stage is NOT here, which is the export rule holding in the
  // direction M2.6b's `insertion-order` established: a stage earns a public
  // name by being an algorithm a caller chooses between, and by its own
  // measurements `brandes-koepf-position` is not one yet. It is implemented,
  // tested and reached through `../src/position.js` by the suite that covers
  // it. See `position.ts` for the measurement and `index.ts` for the rule.
  it('does not export the Brandes-Koepf position stage', () => {
    expect(api.defaultStages.position).toBe(gridPositionStage);
    expect(Object.values(api)).not.toContain(brandesKoepfPositionStage);
    expect(brandesKoepfPositionStage.name).toBe('brandes-koepf-position');
    // Still one object shared by every run that names it, so still frozen, for
    // the reason the other shared stages are; being module-local does not make
    // an assignment to its `name` any less process wide.
    expect(Object.isFrozen(brandesKoepfPositionStage)).toBe(true);
  });

  it('exports the DagrLayoutErrorCode type, and every code is a member of it', () => {
    const codes: DagrLayoutErrorCode[] = [
      new api.InvalidConfigError('nodeSep', -1).code,
      new api.StageContractError('rank', 'a', 'why').code,
      new api.InternalLayoutError('why').code,
      new api.WorkerTransportError('why').code,
      new api.DeltaMismatchError('a', 'why').code,
    ];
    expect(codes).toEqual([
      'INVALID_CONFIG',
      'STAGE_CONTRACT',
      'INTERNAL',
      'WORKER',
      'DELTA_MISMATCH',
    ]);
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

    // The engine's own three. `LayoutPort` is the one a caller most has to be
    // able to write down: it is what they annotate the worker or the channel
    // end they are handing over as, and this package names no class it could
    // have been spelled with.
    const port: LayoutPort = {
      postMessage: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const engineOptions: LayoutEngineOptions = { stages: overrides, config, worker: port };
    const engine: LayoutEngine = api.createLayout(engineOptions);

    // The runner assembles the result from the last record's `positions` and
    // `sizes`. The position comes from the stage above, and the size does NOT:
    // it is what the runner measured during prepare, because a stage has no
    // field to hand back a size in unless it declared the node itself. The
    // `size` in `prepared` is therefore a record a stage reads, not one it can
    // impose, which is the whole shape of the M2.4a contract in one assertion.
    const handBuilt: PositionedNode = { id: 'a', x: 0, y: 0, width: 100, height: 40 };
    expect(api.layout(input, stages).nodes.get('a')).toEqual(handBuilt);
    expect(api.layout(input, overrides).nodes.get('a')).toEqual(handBuilt);
    // The sync entry point of an engine that has a worker bound still runs
    // here, so this needs nothing from the port above.
    expect(engine.run(graph).nodes.get('a')).toEqual(handBuilt);
    expect(positioned).toEqual({ id: 'a', x: 0, y: 20, width: 100, height: 40 });
    expect(routed).toBeUndefined();
    expect(bounds).toEqual({ x: -50, y: 0, width: 100, height: 40 });
    expect(rect.width).toBe(1);
    // M3.1's own types, which are the ones M4.7 and M5 are written against.
    // `NodeGeometry` is the shape a `PositionedNode` is an id away from, so a
    // positioned node is assignable to it and that is the whole relationship.
    const geometry: NodeGeometry = handBuilt;
    const move: MovedNode = { id: 'a', from: geometry, to: geometry };
    const reroute: ReroutedEdge = { id: 'e', from: [point], to: [point] };
    const grew: BoundsChange = { from: rect, to: rect };
    const nodeDelta: NodeDelta = { added: [handBuilt], removed: [], moved: [move] };
    const edgeDelta: EdgeDelta = { added: [], removed: ['e'], rerouted: [reroute] };
    const delta: LayoutDelta = { nodes: nodeDelta, edges: edgeDelta, bounds: grew };
    const diffOptions: LayoutDiffOptions = { epsilon: 0 };
    expect(api.isEmptyDelta(delta)).toBe(false);
    expect(api.isEmptyDelta(api.diffLayout(result, result, diffOptions))).toBe(true);

    // M3.4's types. `LayoutDiffOptions` is what `measureStability` takes as
    // well, so a report is scoped by the same tolerance a delta is and there is
    // one epsilon rule in the package rather than two.
    const nodeStability: NodeStability = api.measureStability(result, result).nodes;
    const edgeStability: EdgeStability = api.measureStability(result, result, diffOptions).edges;
    const report: StabilityReport = { nodes: nodeStability, edges: edgeStability };
    const kind: StabilityViolationKind = 'node-moved';
    const violation: StabilityViolation = { id: 'a', kind };
    expect(report.nodes.shared).toBe(1);
    expect(violation.kind).toBe('node-moved');
    // The influence set is what the contract is scoped to, and the trivial one
    // this milestone ships makes every violation impossible on purpose.
    const influence: InfluenceSet = { nodes: new Set(['a']), edges: new Set() };
    expect(api.stabilityViolations(result, result, influence)).toEqual([]);

    // The read-side records still exist and still extend one another, which is
    // what lets a stage author name the argument its `run` is handed.
    expect(wired.graph).toBe(graph);
    expect(wired.layers).toEqual([['a']]);
    expect(wired.sizes.get('a')).toBe(size);
  });
});
