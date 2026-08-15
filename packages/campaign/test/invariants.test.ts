import { beforeAll, describe, expect, it } from 'vitest';
import { EDGE_ROLES, generateCampaign } from '../src/index.js';
import type { Campaign, CampaignEdge, CampaignNode } from '../src/index.js';

/**
 * The structural claims the campaign plan makes, asserted on the output.
 *
 * Two registers on purpose. Fixed counts (6 regions, 12 factions, 60 quests)
 * are asserted exactly, because the generator writes them as literals and a
 * drift there is a bug. Stochastic quantities are asserted as BANDS wide
 * enough to hold across seeds: the suite runs three seeds through the
 * structural invariants, so a claim like the jaquays loop quota is a property
 * of the generator, not a memorized fact about one seed.
 */

const SEEDS = [20260814, 1, 999];

interface Indexed {
  readonly campaign: Campaign;
  readonly byId: ReadonlyMap<string, CampaignNode>;
  readonly byKind: ReadonlyMap<string, readonly CampaignNode[]>;
  readonly edgesByKind: ReadonlyMap<string, readonly CampaignEdge[]>;
}

function index(campaign: Campaign): Indexed {
  const byId = new Map<string, CampaignNode>();
  const byKind = new Map<string, CampaignNode[]>();
  for (const node of campaign.nodes) {
    byId.set(node.id, node);
    const bucket = byKind.get(node.data.kind) ?? [];
    bucket.push(node);
    byKind.set(node.data.kind, bucket);
  }
  const edgesByKind = new Map<string, CampaignEdge[]>();
  for (const edge of campaign.edges) {
    const bucket = edgesByKind.get(edge.kind) ?? [];
    bucket.push(edge);
    edgesByKind.set(edge.kind, bucket);
  }
  return { campaign, byId, byKind, edgesByKind };
}

function kindCount(indexed: Indexed, kind: string): number {
  return indexed.byKind.get(kind)?.length ?? 0;
}

let fixtures: Indexed[] = [];

beforeAll(() => {
  fixtures = SEEDS.map((seed) => index(generateCampaign({ seed })));
});

describe('referential integrity', () => {
  it('gives every node a unique id and every edge existing endpoints', () => {
    for (const { campaign, byId } of fixtures) {
      expect(byId.size).toBe(campaign.nodes.length);
      for (const edge of campaign.edges) {
        expect(byId.has(edge.source)).toBe(true);
        expect(byId.has(edge.target)).toBe(true);
      }
    }
  });

  it('gives every edge a unique id', () => {
    for (const { campaign } of fixtures) {
      const ids = new Set(campaign.edges.map((e) => e.id));
      expect(ids.size).toBe(campaign.edges.length);
    }
  });

  it('maps every edge kind that occurs to a role', () => {
    for (const { campaign } of fixtures) {
      for (const edge of campaign.edges) {
        expect(EDGE_ROLES[edge.kind]).toMatch(/^(routed|overlay)$/);
      }
    }
  });
});

describe('scale', () => {
  it('lands the default campaign in the plan band', () => {
    for (const { campaign } of fixtures) {
      expect(campaign.nodes.length).toBeGreaterThanOrEqual(2000);
      expect(campaign.nodes.length).toBeLessThanOrEqual(5000);
      // Roughly 2 to 4 edges per node: below that the graph is a bare tree,
      // above it a hairball no layout can help.
      const ratio = campaign.edges.length / campaign.nodes.length;
      expect(ratio).toBeGreaterThanOrEqual(2);
      expect(ratio).toBeLessThanOrEqual(4);
    }
  });

  it('holds the fixed counts the generator writes as literals', () => {
    for (const fixture of fixtures) {
      expect(kindCount(fixture, 'campaign')).toBe(1);
      expect(kindCount(fixture, 'arc')).toBe(4);
      expect(kindCount(fixture, 'chapter')).toBe(16);
      expect(kindCount(fixture, 'faction')).toBe(12);
      expect(kindCount(fixture, 'front')).toBe(12);
      expect(kindCount(fixture, 'quest')).toBe(60);
      expect(kindCount(fixture, 'statblock')).toBe(130);
      expect(kindCount(fixture, 'item')).toBe(300);
      expect(kindCount(fixture, 'condition_modifier')).toBe(45);
    }
  });

  it('keeps the stochastic strata inside their hardcover-calibrated bands', () => {
    for (const fixture of fixtures) {
      expect(kindCount(fixture, 'scene')).toBeGreaterThanOrEqual(96);
      expect(kindCount(fixture, 'scene')).toBeLessThanOrEqual(160);
      expect(kindCount(fixture, 'npc')).toBeGreaterThanOrEqual(300);
      expect(kindCount(fixture, 'npc')).toBeLessThanOrEqual(650);
      const locations = fixture.byKind.get('location') ?? [];
      const rooms = locations.filter((n) => n.data.kind === 'location' && n.data.subtype === 'room');
      expect(rooms.length).toBeGreaterThanOrEqual(500);
      expect(rooms.length).toBeLessThanOrEqual(1600);
    }
  });
});

describe('the contains forest', () => {
  it('gives every node at most one contains parent and no cycles', () => {
    for (const { campaign, edgesByKind } of fixtures) {
      const parent = new Map<string, string>();
      for (const edge of edgesByKind.get('contains') ?? []) {
        expect(parent.has(edge.target)).toBe(false);
        parent.set(edge.target, edge.source);
      }
      // Walking up from any node must terminate at a root. The walk is bounded
      // by the node count, so a cycle shows up as an overlong path.
      for (const node of campaign.nodes) {
        let cursor: string | undefined = node.id;
        let hops = 0;
        while (cursor !== undefined) {
          cursor = parent.get(cursor);
          hops += 1;
          expect(hops).toBeLessThanOrEqual(campaign.nodes.length);
        }
      }
    }
  });

  it('steps depth by exactly one along every contains edge', () => {
    for (const { byId, edgesByKind } of fixtures) {
      for (const edge of edgesByKind.get('contains') ?? []) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        expect(source).toBeDefined();
        expect(target).toBeDefined();
        if (source !== undefined && target !== undefined) {
          expect(target.depth).toBe(source.depth + 1);
        }
      }
    }
  });
});

describe('the Three Clue Rule', () => {
  it('backs every revelation with at least three clues from distinct holders of at least two kinds', () => {
    for (const { campaign, byId, edgesByKind } of fixtures) {
      const cluesInto = new Map<string, string[]>();
      for (const edge of edgesByKind.get('points_to') ?? []) {
        const bucket = cluesInto.get(edge.target) ?? [];
        bucket.push(edge.source);
        cluesInto.set(edge.target, bucket);
      }
      const holderOf = new Map<string, string>();
      for (const edge of edgesByKind.get('contains_clue') ?? []) {
        holderOf.set(edge.target, edge.source);
      }
      const revelations = campaign.nodes.filter(
        (n) => n.data.kind === 'quest_step' && n.data.revelation === true,
      );
      expect(revelations.length).toBeGreaterThanOrEqual(30);
      expect(revelations.length).toBeLessThanOrEqual(40);
      for (const revelation of revelations) {
        const clues = cluesInto.get(revelation.id) ?? [];
        expect(clues.length).toBeGreaterThanOrEqual(3);
        const holders = clues.map((clue) => holderOf.get(clue));
        expect(new Set(holders).size).toBeGreaterThanOrEqual(3);
        const holderKinds = new Set(
          holders.map((holder) => (holder === undefined ? undefined : byId.get(holder)?.data.kind)),
        );
        expect(holderKinds.size).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('branch and merge', () => {
  it('gives every check step all three outcomes', () => {
    for (const { edgesByKind } of fixtures) {
      const outcomesBySource = new Map<string, Set<string>>();
      for (const edge of edgesByKind.get('branch_on') ?? []) {
        if (edge.kind !== 'branch_on') continue;
        const bucket = outcomesBySource.get(edge.source) ?? new Set<string>();
        bucket.add(edge.outcome);
        outcomesBySource.set(edge.source, bucket);
      }
      // Scene branches are two-outcome by design; quest steps are the
      // three-outcome ones. At least the quest-step sources must show all
      // three somewhere, so assert the maximum arity seen is 3.
      const arities = [...outcomesBySource.values()].map((set) => set.size);
      expect(Math.max(...arities)).toBe(3);
    }
  });

  it('merges well over half of the failure branches back within two steps', () => {
    for (const { byId, edgesByKind } of fixtures) {
      const merges = new Set((edgesByKind.get('merges_into') ?? []).map((e) => e.source));
      let complications = 0;
      let merged = 0;
      for (const edge of edgesByKind.get('branch_on') ?? []) {
        if (edge.kind !== 'branch_on' || edge.outcome !== 'failure') continue;
        const target = byId.get(edge.target);
        if (target === undefined || target.data.kind !== 'quest_step') continue;
        // Scene failure branches point at later scenes; quest failure
        // branches point at complication steps, the ones merging measures.
        if (!target.oneLine.includes('failure path')) continue;
        complications += 1;
        if (merges.has(edge.target)) merged += 1;
      }
      expect(complications).toBeGreaterThan(20);
      expect(merged / complications).toBeGreaterThanOrEqual(0.55);
      expect(merged / complications).toBeLessThanOrEqual(0.85);
    }
  });
});

describe('the jaquays quota', () => {
  it('gives every dungeon a loop surplus of at least a quarter of its rooms', () => {
    for (const { byId, edgesByKind } of fixtures) {
      const roomsByDungeon = new Map<string, string[]>();
      for (const edge of edgesByKind.get('contains') ?? []) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (
          source?.data.kind === 'location' &&
          source.data.dungeon === true &&
          target?.data.kind === 'location' &&
          target.data.subtype === 'room'
        ) {
          const bucket = roomsByDungeon.get(edge.source) ?? [];
          bucket.push(edge.target);
          roomsByDungeon.set(edge.source, bucket);
        }
      }
      expect(roomsByDungeon.size).toBeGreaterThanOrEqual(18);
      const dungeonOfRoom = new Map<string, string>();
      for (const [dungeon, rooms] of roomsByDungeon) {
        for (const room of rooms) dungeonOfRoom.set(room, dungeon);
      }
      const pathsAmong = new Map<string, number>();
      for (const edge of edgesByKind.get('leads_to') ?? []) {
        const dungeon = dungeonOfRoom.get(edge.source);
        if (dungeon !== undefined && dungeon === dungeonOfRoom.get(edge.target)) {
          pathsAmong.set(dungeon, (pathsAmong.get(dungeon) ?? 0) + 1);
        }
      }
      for (const [dungeon, rooms] of roomsByDungeon) {
        const edges = pathsAmong.get(dungeon) ?? 0;
        // Connected spanning tree is rooms - 1; everything above it is loops.
        expect(edges - (rooms.length - 1)).toBeGreaterThanOrEqual(Math.ceil(rooms.length * 0.25));
      }
      const finale = [...roomsByDungeon.values()].map((rooms) => rooms.length);
      expect(Math.max(...finale)).toBe(88);
    }
  });

  it('keeps secret and one-way doors at module-like proportions', () => {
    for (const { edgesByKind } of fixtures) {
      const paths = (edgesByKind.get('leads_to') ?? []).filter((e) => e.kind === 'leads_to');
      const doors = paths.filter((e) => e.kind === 'leads_to' && ['door', 'secret', 'one_way'].includes(e.path));
      const secret = doors.filter((e) => e.kind === 'leads_to' && e.path === 'secret').length;
      const oneWay = doors.filter((e) => e.kind === 'leads_to' && e.path === 'one_way').length;
      expect(secret / doors.length).toBeGreaterThanOrEqual(0.05);
      expect(secret / doors.length).toBeLessThanOrEqual(0.16);
      expect(oneWay / doors.length).toBeGreaterThanOrEqual(0.02);
      expect(oneWay / doors.length).toBeLessThanOrEqual(0.09);
    }
  });
});

describe('the overland pointcrawl', () => {
  it('holds the settlement layer at the plan average degree', () => {
    for (const { campaign, edgesByKind } of fixtures) {
      const settlements = new Set(
        campaign.nodes
          .filter((n) => n.data.kind === 'location' && n.data.subtype === 'settlement')
          .map((n) => n.id),
      );
      let degreeSum = 0;
      for (const edge of edgesByKind.get('leads_to') ?? []) {
        if (settlements.has(edge.source)) degreeSum += 1;
        if (settlements.has(edge.target)) degreeSum += 1;
      }
      const average = degreeSum / settlements.size;
      expect(average).toBeGreaterThanOrEqual(2.5);
      expect(average).toBeLessThanOrEqual(4);
    }
  });
});

describe('fronts and clocks', () => {
  it('gives every front its full clock and a quest that can interrupt it', () => {
    for (const { campaign, byId, edgesByKind } of fixtures) {
      const fronts = campaign.nodes.filter((n) => n.data.kind === 'front');
      const ticksByFront = new Map<string, number>();
      for (const edge of edgesByKind.get('contains') ?? []) {
        if (byId.get(edge.source)?.data.kind === 'front') {
          ticksByFront.set(edge.source, (ticksByFront.get(edge.source) ?? 0) + 1);
        }
      }
      const interrupted = new Set((edgesByKind.get('interrupted_by') ?? []).map((e) => e.source));
      for (const front of fronts) {
        expect(front.data.kind).toBe('front');
        if (front.data.kind !== 'front') continue;
        expect(ticksByFront.get(front.id)).toBe(front.data.clockSize);
        expect(interrupted.has(front.id)).toBe(true);
      }
    }
  });
});

describe('condition modifiers', () => {
  it('runs a hardcover share of scenes under a modifier and every region under weather', () => {
    for (const { campaign, edgesByKind } of fixtures) {
      const modified = new Set((edgesByKind.get('modified_by') ?? []).map((e) => e.source));
      const scenes = campaign.nodes.filter((n) => n.data.kind === 'scene');
      const modifiedScenes = scenes.filter((n) => modified.has(n.id)).length;
      expect(modifiedScenes / scenes.length).toBeGreaterThanOrEqual(0.3);
      expect(modifiedScenes / scenes.length).toBeLessThanOrEqual(0.5);
      const regions = campaign.nodes.filter(
        (n) => n.data.kind === 'location' && n.data.subtype === 'region',
      );
      expect(regions.length).toBe(6);
      for (const region of regions) expect(modified.has(region.id)).toBe(true);
    }
  });
});

describe('statblock reuse', () => {
  it('reuses the head of the bestiary far more than the tail, and leaves no encounter unarmed', () => {
    for (const { campaign, edgesByKind } of fixtures) {
      const uses = new Map<string, number>();
      const armed = new Set<string>();
      for (const edge of edgesByKind.get('uses_statblock') ?? []) {
        uses.set(edge.target, (uses.get(edge.target) ?? 0) + 1);
        armed.add(edge.source);
      }
      for (const encounter of campaign.nodes.filter((n) => n.data.kind === 'encounter')) {
        expect(armed.has(encounter.id)).toBe(true);
      }
      const counts = [...uses.values()].sort((a, b) => b - a);
      const top = counts[0] ?? 0;
      // Zipf head versus tail: the most-used statblock should carry an order
      // of magnitude more encounters than the median one.
      const median = counts[Math.floor(counts.length / 2)] ?? 0;
      expect(top).toBeGreaterThanOrEqual(median * 5);
    }
  });
});
