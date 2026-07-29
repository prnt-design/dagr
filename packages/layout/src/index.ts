/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export { layout } from './pipeline.js';
export { DEFAULT_LAYOUT_CONFIG } from './config.js';
// The rule for stages: every one a caller CHOOSES BETWEEN is exported by name,
// no PLACEHOLDER is, and the stage set is exported whatever a stage is.
//
// A stage worth a name is an algorithm a caller chooses between, so it needs a
// name to choose it by: the two rank stages optimise different things, minimum
// height against minimum total edge length, and neither is a default a caller
// should have to accept to get. Naming one of them "the default stage" is not a
// handle on it either, because which one that is changes: M2.2 moved `rank` and
// M2.6b moved `order`. A placeholder is the opposite. The defaults still
// holding the position and route phases are stand-ins scheduled for replacement
// (M2.4b makes a real positioner worth selecting, and M2.8 brings the router),
// and a name exported now is a name to delete later or to keep exported as a
// dead placeholder forever. `defaultStages` covers what a caller wants from
// those, wrapping whatever the current default is, and it keeps working when
// the default behind one of its properties changes.
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
// measurements say no caller should choose it over `gridPositionStage` until
// M2.4b lands, so the name waits with it. See `position.ts`.
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
export {
  DagrLayoutError,
  InternalLayoutError,
  InvalidConfigError,
  StageContractError,
} from './errors.js';
export type { DagrLayoutErrorCode } from './errors.js';
export type {
  LayoutConfig,
  LayoutInput,
  LayoutResult,
  LayoutStageOverrides,
  LayoutStages,
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
