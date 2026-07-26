/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export { layout } from './pipeline.js';
export { DEFAULT_LAYOUT_CONFIG } from './config.js';
// Only the stage set is exported, not the four placeholders behind it. Each of
// those is scheduled for replacement (M2.2, M2.5, M2.7, M2.8), and a name
// exported now is a name to delete or to keep as a dead placeholder later.
// `defaultStages` covers the real use case, wrapping a default, and it keeps
// working when the default behind one of its four properties changes.
export { defaultStages } from './stages.js';
export { DagrLayoutError, InvalidConfigError, StageContractError } from './errors.js';
export type { DagrLayoutErrorCode } from './errors.js';
export type {
  LayoutConfig,
  LayoutInput,
  LayoutResult,
  LayoutStageOverrides,
  LayoutStages,
  OrderStage,
  OrderedState,
  Point,
  PositionStage,
  PositionedNode,
  PositionedState,
  PreparedState,
  RankStage,
  RankedState,
  Rect,
  ResolvedLayoutConfig,
  RouteStage,
  RoutedEdge,
  RoutedState,
  Size,
} from './types.js';
