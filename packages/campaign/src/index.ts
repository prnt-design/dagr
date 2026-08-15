/**
 * `@dagr/campaign`: a deterministic mock D&D campaign dataset for Dagr demos.
 *
 * The schema (node kinds, edge kinds, and which edges a layout routes) is a
 * synthesis of how published campaigns and existing campaign tools structure
 * the domain; the generator reproduces the structural patterns DMs actually
 * use (hub-and-spoke, jaquaysed dungeons, branch-and-merge quests, the Three
 * Clue Rule, faction fronts) deliberately, and the tests assert them as graph
 * invariants. `plans/2026-08-14-campaign-demo.md` is the decision record.
 *
 * Private and unpublished: this is a fixture, not a product. It has zero
 * dependencies, including on `@dagr/graph`, so it stays usable as a fixture
 * for anything that reads plain nodes and edges.
 */

export { cardRows } from './card.js';
export { generateCampaign } from './generate.js';
export type { GenerateOptions } from './generate.js';
export { Rng } from './random.js';
export { EDGE_ROLES } from './types.js';
export type {
  Campaign,
  CampaignEdge,
  CampaignNode,
  CheckOutcome,
  EdgeKind,
  EdgeRole,
  NodeData,
  NodeKind,
  PathKind,
  SkillCheck,
} from './types.js';
