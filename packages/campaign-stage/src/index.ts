/**
 * The campaign demo as a mountable component.
 *
 * Two hosts import this package: `apps/demo`, the Vite playground the engine is
 * exercised in, and the docs site's `/demos/campaign` route. What they share is
 * everything on the canvas: the scene build, the tiling, the palette, the
 * camera arithmetic, the overlay tiers and the hover test. What they do not
 * share is the page around it, and the layout worker's entry, which is a
 * bundler-visible `new Worker(new URL(...))` and therefore each host's own (see
 * {@link useCampaignScene}).
 *
 * Private, never published. It exists because two pages draw the same thing,
 * not because anybody should install it.
 *
 * The stylesheet is `@dagr/campaign-stage/stage.css`, imported by the host.
 */

export { CampaignStage } from './CampaignStage.js';
export { FirstLight } from './FirstLight.js';
export { useCampaignScene } from './use-campaign-scene.js';
export type { CampaignSceneState } from './use-campaign-scene.js';

export { buildCampaignScene } from './campaign-scene.js';
export type {
  CampaignOverlayNode,
  CampaignScene,
  CampaignTilePlacement,
} from './campaign-scene.js';
export { campaignEdges, sourceEdgeColor } from './campaign-edges.js';
export type { CampaignEdges } from './campaign-edges.js';
export { SMALLEST_NODE_SIZE, nodeColor, styleFor } from './campaign-style.js';
