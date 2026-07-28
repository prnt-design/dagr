/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export { layout } from './pipeline.js';
export { DEFAULT_LAYOUT_CONFIG } from './config.js';
// The rule for stages: every REAL one is exported by name, no PLACEHOLDER is,
// and the stage set is exported whatever a stage is.
//
// A real stage is an algorithm a caller chooses between, so it needs a name to
// choose it by: the two rank stages optimise different things, minimum height
// against minimum total edge length, and neither is a default a caller should
// have to accept to get. Naming one of them "the default stage" is not a handle
// on it either, because which one that is changes: M2.2 already moved `rank`
// once. A placeholder is the opposite. The defaults still holding the order,
// position and route phases are stand-ins scheduled for replacement (M2.5 built
// the replacement for the first of them without taking the default, M2.7 and
// M2.8 are still to come), and a name exported now is a name to delete later or
// to keep exported as a dead placeholder forever. `defaultStages` covers what a
// caller wants from those, wrapping whatever the current default is, and it
// keeps working when the default behind one of its properties changes.
//
// `barycenterOrderStage` is the second real stage to arrive without taking the
// default, so the rule is now the one that survives that too: a real stage is
// exported by name whether or not it is the default, and which stage is the
// default is a separate decision from whether the algorithm exists. See
// `order.ts` for why the order default has not moved yet, and M2.6 for when it
// is meant to.
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
export type { BarycenterOrderOptions, CrossingInput } from './order.js';
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
