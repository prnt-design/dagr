/** Headless Sugiyama layout pipeline, the dagre successor: incremental and animation first. */
export const PKG_NAME = '@dagr/layout';

export { LayoutError } from './errors.js';
export type { LayoutErrorCode } from './errors.js';

export { DEFAULT_LAYOUT_CONFIG, RANK_DIRS, resolveConfig } from './config.js';
export type { LayoutOptions, RankDir, ResolvedLayoutConfig } from './config.js';

export type {
  LayoutEdgeInput,
  LayoutInput,
  LayoutNodeInput,
  LayoutResult,
  Point,
  PositionedNode,
  RoutedEdge,
} from './types.js';

export { addDummyNode, createLayoutState, reverseEdge } from './state.js';
export type { DummyNodeOptions, LayoutEdgeState, LayoutNodeState, LayoutState } from './state.js';

export {
  defaultOrderStage,
  defaultPositionStage,
  defaultRankStage,
  defaultRouteStage,
  defaultStages,
} from './stages.js';
export type { LayoutStages, OrderStage, PositionStage, RankStage, RouteStage } from './stages.js';

export { buildResult, layout, runPipeline, runStages } from './pipeline.js';
