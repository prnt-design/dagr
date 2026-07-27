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
// once. A placeholder is the opposite. Three of the four defaults are still
// stand-ins scheduled for replacement (M2.5, M2.7, M2.8), and a name exported
// now is a name to delete later or to keep exported as a dead placeholder
// forever. `defaultStages` covers what a caller wants from those, wrapping
// whatever the current default is, and it keeps working when the default behind
// one of its properties changes.
export { defaultStages } from './stages.js';
export { longestPathRankStage } from './rank.js';
// The factory is exported beside the simplex stage because M3 warm starts a run
// from the previous run's ranks, which is an argument and therefore a call.
export { networkSimplexRank, networkSimplexRankStage } from './simplex.js';
export type { NetworkSimplexOptions } from './simplex.js';
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
