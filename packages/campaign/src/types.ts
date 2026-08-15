/**
 * The campaign schema: what a node is, what an edge is, and which edges a
 * layout should route.
 *
 * The kinds are a synthesis of how published D&D hardcovers and the existing
 * tools (Kanka, World Anvil, Foundry VTT, the 5e SRD API) structure the
 * domain, argued in `plans/2026-08-14-campaign-demo.md` and its research
 * report. They are offered as a standardized starting point, not as anyone's
 * final schema: the generator in this package is the only producer today, and
 * a real external schema can retarget it.
 *
 * Everything here is plain data with string ids. Deliberately no dependency on
 * `@dagr/graph`: this package is a dataset, and the conversion to a `Graph` is
 * the business of whoever draws it (the demo, in the campaign plan's P4).
 * Depending on the graph package from here would make the dataset unusable as
 * a fixture for anything that is not Dagr.
 */

/** Every kind of node a campaign contains. */
export type NodeKind =
  | 'campaign'
  | 'arc'
  | 'chapter'
  | 'scene'
  | 'encounter'
  | 'location'
  | 'npc'
  | 'faction'
  | 'quest'
  | 'quest_step'
  | 'clue'
  | 'item'
  | 'front'
  | 'clock_tick'
  | 'statblock'
  | 'condition_modifier';

/** Every kind of edge, grouped in {@link EDGE_ROLES} by what layout does with it. */
export type EdgeKind =
  // Hierarchy: a strict forest. campaign>arc>chapter>scene, region>...>room,
  // quest>quest_step, front>clock_tick.
  | 'contains'
  // Narrative flow between scenes and between quest steps.
  | 'next'
  | 'branch_on'
  | 'merges_into'
  // Traversal: the pointcrawl and dungeon layer.
  | 'leads_to'
  | 'entry_point'
  // Dependency.
  | 'requires'
  | 'unlocks'
  | 'rewards'
  // Investigation.
  | 'contains_clue'
  | 'points_to'
  // Social.
  | 'member_of'
  | 'leads'
  | 'ally_of'
  | 'hostile_to'
  | 'knows'
  // Reference.
  | 'uses_statblock'
  | 'located_at'
  | 'gives_quest'
  // Pressure.
  | 'advances_clock'
  | 'triggers'
  | 'interrupted_by'
  // State.
  | 'modified_by';

/**
 * What a layout pass should do with an edge kind.
 *
 * `routed` edges (hierarchy, flow, traversal, dependency) go through the
 * layout pipeline and get real routes. `overlay` edges (investigation, social,
 * reference, pressure, state) are dense and cyclic, and feeding them to
 * crossing reduction buys nothing a viewer can read: they draw as straight
 * overlay lines, gated by zoom or hover. The split is the campaign plan's
 * schema table, encoded once so a consumer cannot route half a group by
 * accident.
 */
export type EdgeRole = 'routed' | 'overlay';

/** The role of every edge kind. A `Record` so a new kind cannot be left unmapped. */
export const EDGE_ROLES: Record<EdgeKind, EdgeRole> = {
  contains: 'routed',
  next: 'routed',
  branch_on: 'routed',
  merges_into: 'routed',
  leads_to: 'routed',
  entry_point: 'routed',
  requires: 'routed',
  unlocks: 'routed',
  rewards: 'routed',
  contains_clue: 'overlay',
  points_to: 'overlay',
  member_of: 'overlay',
  leads: 'overlay',
  ally_of: 'overlay',
  hostile_to: 'overlay',
  knows: 'overlay',
  uses_statblock: 'overlay',
  located_at: 'overlay',
  gives_quest: 'overlay',
  advances_clock: 'overlay',
  triggers: 'overlay',
  interrupted_by: 'overlay',
  modified_by: 'overlay',
};

/** An ability check: which skill, against what DC. */
export interface SkillCheck {
  readonly skill: string;
  readonly dc: number;
}

/** How a check resolved. Three outcomes, not two: partial success is a branch. */
export type CheckOutcome = 'success' | 'failure' | 'partial';

/** How a `leads_to` edge is traversed. `one_way` cannot be walked backwards. */
export type PathKind = 'road' | 'trail' | 'door' | 'secret' | 'one_way';

/**
 * The kind-specific half of a node, as a discriminated union so a scene
 * cannot carry an item's rarity. Optional fields are genuinely optional facts
 * (not every NPC has a secret), never "unknown".
 */
export type NodeData =
  | { readonly kind: 'campaign'; readonly levelRange: readonly [number, number]; readonly premise: string }
  | { readonly kind: 'arc'; readonly levelBand: readonly [number, number]; readonly summary: string }
  | { readonly kind: 'chapter'; readonly expectedOrder: number; readonly summary: string }
  | {
      readonly kind: 'scene';
      readonly sceneType: 'combat' | 'social' | 'exploration' | 'puzzle';
      readonly trigger: string;
      readonly check?: SkillCheck;
    }
  | {
      readonly kind: 'encounter';
      readonly difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
      readonly xpBudget: number;
    }
  | {
      readonly kind: 'location';
      readonly subtype: 'region' | 'settlement' | 'building' | 'room';
      /** Module-style key, like "K37". Rooms in keyed sites only. */
      readonly keyCode?: string;
      readonly terrain?: string;
      /** A safe hub the surrounding sites radiate from. Settlements only. */
      readonly hub?: boolean;
      /** A keyed multi-room site with a looping room graph. Buildings only. */
      readonly dungeon?: boolean;
    }
  | {
      readonly kind: 'npc';
      readonly role: string;
      readonly attitude: 'ally' | 'neutral' | 'hostile';
      readonly secret?: string;
    }
  | { readonly kind: 'faction'; readonly goal: string; readonly stance: 'ally' | 'neutral' | 'hostile' }
  | {
      readonly kind: 'quest';
      readonly objective: string;
      readonly state: 'available' | 'active' | 'done' | 'failed';
    }
  | {
      readonly kind: 'quest_step';
      readonly objective: string;
      /** A conclusion the Three Clue Rule protects: clue in-degree >= 3. */
      readonly revelation?: boolean;
      readonly check?: SkillCheck;
    }
  | { readonly kind: 'clue'; readonly fact: string }
  | {
      readonly kind: 'item';
      readonly rarity: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';
      readonly plotCritical: boolean;
    }
  | { readonly kind: 'front'; readonly doom: string; readonly clockSize: number }
  | { readonly kind: 'clock_tick'; readonly index: number; readonly portent: string }
  | { readonly kind: 'statblock'; readonly challengeRating: number }
  | {
      readonly kind: 'condition_modifier';
      readonly scope: 'weather' | 'time' | 'terrain' | 'magical';
      readonly effect: string;
    };

/**
 * One node. `depth` is the semantic-zoom hint from the research report: 0 is
 * the campaign, and each `contains` step adds 1, so a viewer can gate whole
 * strata on it (arcs and regions at far zoom, rooms and clues up close).
 * Nodes outside the `contains` forest carry the depth of the stratum they
 * belong with rather than 0, so the gate stays meaningful for them.
 */
export interface CampaignNode {
  readonly id: string;
  readonly name: string;
  /** One sentence a card's subtitle can show. */
  readonly oneLine: string;
  readonly depth: number;
  /** Free-form, including `pattern:` tags naming the structure a node is part of. */
  readonly tags: readonly string[];
  readonly data: NodeData;
}

/**
 * One edge. `branch_on` and `leads_to` carry payloads; every other kind is
 * fully described by its endpoints, so the union gives them no extra fields
 * rather than an always-empty `data` bag.
 */
export type CampaignEdge =
  | {
      readonly id: string;
      readonly source: string;
      readonly target: string;
      readonly kind: 'branch_on';
      readonly outcome: CheckOutcome;
      readonly check: SkillCheck;
    }
  | {
      readonly id: string;
      readonly source: string;
      readonly target: string;
      readonly kind: 'leads_to';
      readonly path: PathKind;
    }
  | {
      readonly id: string;
      readonly source: string;
      readonly target: string;
      readonly kind: Exclude<EdgeKind, 'branch_on' | 'leads_to'>;
    };

/** A generated campaign: the seed that made it, and everything it contains. */
export interface Campaign {
  readonly seed: number;
  readonly nodes: readonly CampaignNode[];
  readonly edges: readonly CampaignEdge[];
}
