/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export { layout } from './pipeline.js';
// The engine, and the worker side that answers it. M2.10 built the object M2.1
// argued should not exist yet: a binding object with nothing to bind was
// speculative surface, and `runAsync` is the first thing that has to be bound
// rather than passed, because a port and a stage set that changed between two
// runs would describe two different workers. M3.2 hangs `relayout` on the same
// object for the same reason.
//
// `serveLayout` is exported from the package root rather than from a
// `@dagr/layout/worker` subpath. A subpath would suggest the two halves are
// separately loadable, and they are not: the worker half pulls in the whole
// pipeline, which is the point of it. A bundler splitting a worker module out
// is what puts this code in a worker bundle and the engine in the main one, and
// that works from one entry point.
export { createLayout } from './engine.js';
export type { LayoutEngine, LayoutEngineOptions, LayoutPort } from './engine.js';
export { serveLayout } from './worker.js';
// `wire.ts` is not exported, the way `traversal.ts` is not exported from
// `@dagr/graph`: the message shapes are an agreement between `createLayout` and
// `serveLayout`, both of which ship here, and publishing them would freeze a
// format whose only two speakers are upgraded together. What a caller needs to
// write down is the port, and `LayoutPort` is above.
export { DEFAULT_LAYOUT_CONFIG } from './config.js';
// The delta model (M3.1). Three functions rather than one, and the two beside
// `diffLayout` earn their place on the same argument: what a delta MEANS is the
// round trip through `applyDelta`, so the meaning ships as code a consumer can
// check itself against rather than only as a paragraph, and `isEmptyDelta` is
// the question every consumer asks first and the one a hand-written check stops
// answering correctly the day the type grows a field.
export { applyDelta, diffLayout, isEmptyDelta } from './delta.js';
export type {
  BoundsChange,
  EdgeDelta,
  LayoutDelta,
  LayoutDiffOptions,
  MovedNode,
  NodeDelta,
  ReroutedEdge,
} from './delta.js';
// The rule for stages: every one a caller CHOOSES BETWEEN is exported by name,
// no PLACEHOLDER is, and the stage set is exported whatever a stage is.
//
// A stage worth a name is an algorithm a caller chooses between, so it needs a
// name to choose it by: the two rank stages optimise different things, minimum
// height against minimum total edge length, and neither is a default a caller
// should have to accept to get. Naming one of them "the default stage" is not a
// handle on it either, because which one that is changes: M2.2 moved `rank`,
// M2.6b moved `order` and M2.8 moved `route`. A placeholder is the opposite.
// The default still holding the position phase is a stand-in waiting on the
// compaction task named in `position.ts` rather than on a milestone, and a name
// exported now is a name to delete later or to keep exported as a dead
// placeholder forever. `defaultStages` covers what a caller wants from it,
// wrapping whatever the current default is, and it keeps working when the
// default behind one of its properties changes.
//
// `barycenterOrderStage` arrived exported and non-default in M2.5 and took the
// default in M2.6b without its name changing, which is the rule surviving the
// case that would have broken a rule tied to defaults: a stage worth a name is
// exported whether or not it is the default. What that default costs and what
// it buys is argued once, beside the code it is about, in the last section of
// `barycenterOrder`'s docstring in `order.ts`. The stage it displaced,
// `insertionOrderStage`, is still in `stages.ts` and still unexported, for the
// reason on it. `brandesKoepfPositionStage` is unexported for a version of that
// reason it states itself: M2.7 implemented and tested it, and its own
// measurements say no caller should choose it over `gridPositionStage`, and
// consuming the dummy chains, which was supposed to be what fixed that, made
// the gap wider rather than closing it. So the name waits on the compaction
// work that file names. See `position.ts`.
export { defaultStages } from './stages.js';
export { longestPathRankStage } from './rank.js';
// The factory is exported beside the simplex stage because M3 warm starts a run
// from the previous run's ranks, which is an argument and therefore a call.
export { networkSimplexRank, networkSimplexRankStage } from './simplex.js';
export type { NetworkSimplexOptions } from './simplex.js';
// Same shape, one milestone later: the factory beside the stage because M3.6
// warm starts a run from the previous run's layers. `countCrossings` is
// exported because the metric a stage optimises has to be one its callers can
// compute, and M2.6's regression corpus is committed against this counter.
export { barycenterOrder, barycenterOrderStage, countCrossings } from './order.js';
export type { BarycenterOrderOptions, Layering } from './order.js';
// No factory beside this one, because it has nothing to configure yet. It is
// exported for the reason `barycenterOrderStage` is: it is a real stage rather
// than the placeholder it replaced, and a caller wrapping or composing the
// router needs to name it. `edgeSep` is the option it will grow first, and the
// argument for what it would do is in `route.ts`.
export { polylineRouteStage } from './route.js';
export {
  DagrLayoutError,
  DeltaMismatchError,
  InternalLayoutError,
  InvalidConfigError,
  StageContractError,
  WorkerTransportError,
} from './errors.js';
export type { DagrLayoutErrorCode } from './errors.js';
export type {
  LayoutConfig,
  LayoutInput,
  LayoutResult,
  LayoutStageOverrides,
  LayoutStages,
  NodeGeometry,
  OrderOutput,
  OrderStage,
  OrderedState,
  Point,
  PositionOutput,
  PositionStage,
  PositionedNode,
  PositionedState,
  PreparedState,
  RankOutput,
  RankStage,
  RankedState,
  Rect,
  ResolvedLayoutConfig,
  RouteOutput,
  RouteStage,
  RoutedEdge,
  Size,
} from './types.js';
// `RoutedState` is deliberately not here. The other four `...State` records
// each earn their export by being the parameter type of a `run` a caller
// writes; that one is the record the runner builds after the last stage and
// hands to nobody, so a caller has nothing to name it for. It stays exported
// from `types.ts` for use inside the package.
