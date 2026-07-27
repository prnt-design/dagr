/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export { layout } from './pipeline.js';
export { DEFAULT_LAYOUT_CONFIG } from './config.js';
// The stage set is exported, and none of the four stages behind it. Three of
// them are still placeholders scheduled for replacement (M2.5, M2.7, M2.8), and
// a name exported now is a name to delete or to keep as a dead placeholder
// later. `defaultStages` covers the real use case, wrapping a default, and it
// keeps working when the default behind one of its four properties changes,
// which is what M2.2 did to `rank`.
export { defaultStages } from './stages.js';
// The network simplex ranker is exported by name, and that argument does not
// cover it. It is not a placeholder waiting for a real algorithm, it is a
// second real algorithm with a different objective from the default one:
// minimum total edge length rather than minimum height. A caller has to be able
// to name the one it wants, and `stages: { rank: networkSimplexRankStage }` is
// how. The factory is exported beside it because M3 warm starts a run from the
// previous run's ranks, which is an argument and therefore a call.
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
