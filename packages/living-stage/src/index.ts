/**
 * The living demo as a mountable component.
 *
 * Two hosts import this package: `apps/demo`, the Vite playground the engine is
 * exercised in, and the docs site's `/demos/living` route. The docs site is the
 * one that matters, because it is the deployed one and it is where the claim
 * this demo illustrates is made. `apps/demo` mounts the same component so that
 * what a contributor sees locally and what a visitor sees cannot drift, which
 * is the same argument `@dagr/campaign-stage` was split out on.
 *
 * Private, never published. It exists because two pages draw the same thing,
 * not because anybody should install it.
 *
 * The stylesheet is `@dagr/living-stage/living.css`, imported by the host.
 */

export { LivingStage } from './LivingStage.js';
export type { LivingStageProps } from './LivingStage.js';

export {
  CLEAR_COLOR,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_GLOW,
  STAGE_LEGEND,
  livingAppearance,
  stageColor,
  touchedBy,
} from './appearance.js';
export type { StageOfId } from './appearance.js';

export {
  AUTOPLAY_CYCLE,
  EDIT_KINDS,
  INITIAL_SCRIPT_STATE,
  applyStep,
  createEditScript,
  takeAutoStep,
  takeStep,
} from './edit-script.js';
export type {
  ClusterPlan,
  EditKind,
  EditScript,
  EditStep,
  GrowStep,
  LinkPlan,
  PlannedEdge,
  PlannedNode,
  PruneStep,
  RelayoutStep,
  ScriptState,
  TakenStep,
} from './edit-script.js';

export {
  LIVING_LAYOUT_CONFIG,
  LIVING_SEED,
  STAGES,
  STAGE_WIDTHS,
  WIDEST_STAGE,
  createLivingGraph,
  edgeIdFor,
  stageOf,
} from './living-graph.js';
export type { LivingGraphOptions, Stage } from './living-graph.js';

export { readEdit } from './readout.js';
export type {
  CoalescedReadout,
  CountedReadout,
  InitialReadout,
  Readout,
  ReadoutBase,
} from './readout.js';

export { usePrefersReducedMotion } from './use-reduced-motion.js';
