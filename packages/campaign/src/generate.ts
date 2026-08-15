import {
  NameBook,
  buildingName,
  dungeonName,
  factionName,
  itemName,
  monsterName,
  omen,
  personName,
  personRole,
  placeName,
  questName,
  regionName,
  roomName,
  skillCheckSkill,
  terrainKind,
} from './names.js';
import { Rng } from './random.js';
import type {
  Campaign,
  CampaignEdge,
  CampaignNode,
  CheckOutcome,
  NodeData,
  PathKind,
  SkillCheck,
} from './types.js';

/**
 * The seeded generator behind {@link generateCampaign}.
 *
 * Structure over prose: each layer function below builds one stratum of the
 * campaign and returns the ids the next layer references. The proportions are
 * the campaign plan's, calibrated against published hardcovers (one
 * 256-page book is 10 to 15 chapters, 150 to 250 keyed locations, 50 to 100
 * named NPCs), and the structural patterns are built deliberately rather than
 * emerging: hub-and-spoke settlements, jaquaysed dungeon room graphs with a
 * loop quota, branch-and-merge quest DAGs, a clue web with the Three Clue
 * Rule as a construction rule, and faction fronts with countdown clocks.
 * `test/invariants.test.ts` asserts each of those claims on the output rather
 * than trusting this file to have done what it says.
 *
 * Everything flows from one {@link Rng}, so the same seed reproduces the same
 * campaign byte for byte. That is a tested guarantee, and it is why nothing
 * here reads `Date`, `Math.random`, or iteration order of anything unordered.
 */

/** What a caller may tune. Both fields optional, both defaulted. */
export interface GenerateOptions {
  /** The RNG seed. Same seed, same campaign. Default 20260814. */
  readonly seed?: number;
  /**
   * Scales the two knobs the plan names, rooms per dungeon and NPCs per
   * settlement, moving the total across roughly 2,600 to 3,800 nodes over
   * 0.5 to 2 without distorting the ratios. Rooms floor at 8 per keyed site
   * whatever the scale: below that a "dungeon" cannot carry its loop quota
   * or its entry point, so a tiny scale shrinks the count of things, never
   * the integrity of a thing. Default 1.
   */
  readonly scale?: number;
}

interface Build {
  readonly rng: Rng;
  readonly book: NameBook;
  readonly nodes: CampaignNode[];
  readonly edges: CampaignEdge[];
  readonly counters: Map<string, number>;
  readonly scale: number;
}

function nextId(build: Build, prefix: string): string {
  const n = (build.counters.get(prefix) ?? 0) + 1;
  build.counters.set(prefix, n);
  return `${prefix}-${String(n)}`;
}

function addNode(
  build: Build,
  init: {
    readonly idPrefix: string;
    readonly name: string;
    readonly oneLine: string;
    readonly depth: number;
    readonly tags?: readonly string[];
    readonly data: NodeData;
  },
): string {
  const id = nextId(build, init.idPrefix);
  build.nodes.push({
    id,
    name: init.name,
    oneLine: init.oneLine,
    depth: init.depth,
    tags: init.tags ?? [],
    data: init.data,
  });
  return id;
}

function addEdge(
  build: Build,
  kind: Exclude<CampaignEdge['kind'], 'branch_on' | 'leads_to'>,
  source: string,
  target: string,
): void {
  build.edges.push({ id: nextId(build, 'e'), source, target, kind });
}

function addBranch(
  build: Build,
  source: string,
  target: string,
  outcome: CheckOutcome,
  check: SkillCheck,
): void {
  build.edges.push({ id: nextId(build, 'e'), source, target, kind: 'branch_on', outcome, check });
}

function addPath(build: Build, source: string, target: string, path: PathKind): void {
  build.edges.push({ id: nextId(build, 'e'), source, target, kind: 'leads_to', path });
}

function makeCheck(rng: Rng): SkillCheck {
  return { skill: skillCheckSkill(rng), dc: rng.int(10, 18) };
}

/** Weighted pick, weights summing to anything positive. */
function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = rng.next() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (last === undefined) throw new RangeError('weighted needs entries');
  return last[0];
}

// ---------------------------------------------------------------------------
// Spine: campaign > arcs > chapters > scenes > encounters.

interface Spine {
  readonly campaignId: string;
  readonly sceneIds: readonly string[];
  readonly encounterIds: readonly string[];
}

function buildSpine(build: Build): Spine {
  const { rng, book } = build;
  const campaignId = addNode(build, {
    idPrefix: 'campaign',
    name: book.unique('campaign', `The Shadow over ${placeName(rng)}`),
    oneLine: 'A four-arc campaign for levels 1 to 12.',
    depth: 0,
    data: {
      kind: 'campaign',
      levelRange: [1, 12],
      premise: `An old power stirs, and ${omen(rng)}.`,
    },
  });

  const sceneIds: string[] = [];
  const encounterIds: string[] = [];
  let chapterOrder = 0;

  for (let a = 0; a < 4; a += 1) {
    const arcId = addNode(build, {
      idPrefix: 'arc',
      name: book.unique('arc', `Arc ${String(a + 1)}: the ${placeName(rng)} Design`),
      oneLine: `Levels ${String(1 + a * 3)} to ${String(3 + a * 3)}.`,
      depth: 1,
      data: {
        kind: 'arc',
        levelBand: [1 + a * 3, 3 + a * 3],
        summary: `The arc where ${omen(rng)}.`,
      },
    });
    addEdge(build, 'contains', campaignId, arcId);

    for (let c = 0; c < 4; c += 1) {
      chapterOrder += 1;
      const chapterId = addNode(build, {
        idPrefix: 'chapter',
        name: book.unique('chapter', `Chapter ${String(chapterOrder)}: ${placeName(rng)}`),
        oneLine: `Chapter ${String(chapterOrder)} of 16.`,
        depth: 2,
        data: {
          kind: 'chapter',
          expectedOrder: chapterOrder,
          summary: `In which ${omen(rng)}.`,
        },
      });
      addEdge(build, 'contains', arcId, chapterId);

      // 6 to 10 scenes, chained with `next`. A scene with a check also
      // reroutes its failure two scenes ahead, which braids the chapter chain
      // the way the plan's branching table asks without doubling the count.
      // The check rides alongside the id so the wiring loop below does not
      // have to find the node it just built.
      const sceneCount = rng.int(6, 10);
      const chapterScenes: { readonly id: string; readonly check: SkillCheck | undefined }[] = [];
      for (let s = 0; s < sceneCount; s += 1) {
        const sceneType = weighted(rng, [
          ['combat', 45],
          ['social', 25],
          ['exploration', 20],
          ['puzzle', 10],
        ] as const);
        const check = rng.chance(0.3) ? makeCheck(rng) : undefined;
        const sceneId = addNode(build, {
          idPrefix: 'scene',
          name: book.unique('scene', `The ${roomName(rng)}`),
          oneLine: `A ${sceneType} scene.`,
          depth: 3,
          data:
            check === undefined
              ? { kind: 'scene', sceneType, trigger: `When the party arrives, ${omen(rng)}.` }
              : { kind: 'scene', sceneType, trigger: `When the party arrives, ${omen(rng)}.`, check },
        });
        addEdge(build, 'contains', chapterId, sceneId);
        chapterScenes.push({ id: sceneId, check });
        sceneIds.push(sceneId);

        const encounterCount = rng.int(1, 3);
        for (let e = 0; e < encounterCount; e += 1) {
          const difficulty = weighted(rng, [
            ['easy', 25],
            ['medium', 40],
            ['hard', 25],
            ['deadly', 10],
          ] as const);
          const encounterId = addNode(build, {
            idPrefix: 'encounter',
            name: book.unique('encounter', `${difficulty} encounter`),
            oneLine: `A ${difficulty} encounter in this scene.`,
            depth: 4,
            data: { kind: 'encounter', difficulty, xpBudget: rng.int(2, 30) * 100 },
          });
          addEdge(build, 'contains', sceneId, encounterId);
          encounterIds.push(encounterId);
        }
      }

      for (let s = 0; s + 1 < chapterScenes.length; s += 1) {
        const here = chapterScenes[s];
        const after = chapterScenes[s + 1];
        if (here === undefined || after === undefined) continue;
        addEdge(build, 'next', here.id, after.id);
        const skip = chapterScenes[s + 2];
        if (here.check !== undefined && skip !== undefined) {
          addBranch(build, here.id, after.id, 'success', here.check);
          addBranch(build, here.id, skip.id, 'failure', here.check);
        }
      }
    }
  }

  return { campaignId, sceneIds, encounterIds };
}

// ---------------------------------------------------------------------------
// Geography: regions > settlements > buildings > rooms, plus the pointcrawl
// and the jaquaysed dungeons.

interface Geography {
  readonly regionIds: readonly string[];
  readonly settlementIds: readonly string[];
  readonly hubIds: readonly string[];
  readonly dungeonIds: readonly string[];
  readonly roomIds: readonly string[];
  /** Rooms by their dungeon, for clue placement and boss lairs. */
  readonly roomsByDungeon: ReadonlyMap<string, readonly string[]>;
}

function buildRoomGraph(build: Build, dungeonId: string, roomCount: number): string[] {
  const { rng, book } = build;
  const rooms: string[] = [];
  // Corridors already dug, as unordered pairs, so an "extra" cannot land on a
  // pair that is already connected: a doubled door is not a loop, and the
  // quota below counts loops.
  const corridors = new Set<string>();
  const corridorKey = (a: number, b: number): string =>
    a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;

  for (let r = 0; r < roomCount; r += 1) {
    const roomId = addNode(build, {
      idPrefix: 'room',
      name: book.unique(`room:${dungeonId}`, `K${String(r + 1)}: ${roomName(rng)}`),
      oneLine: 'A keyed area of this site.',
      depth: 4,
      tags: ['pattern:pointcrawl'],
      data: { kind: 'location', subtype: 'room', keyCode: `K${String(r + 1)}` },
    });
    addEdge(build, 'contains', dungeonId, roomId);
    rooms.push(roomId);
    // Spanning tree by attaching each room to a random earlier one, so the
    // site is connected by construction.
    if (r > 0) {
      const parentIndex = rng.int(0, r - 1);
      const parent = rooms[parentIndex];
      if (parent !== undefined) {
        addPath(build, parent, roomId, roomPathKind(rng));
        corridors.add(corridorKey(parentIndex, r));
      }
    }
  }
  // The jaquays quota: edges beyond the tree between DISTINCT unconnected
  // pairs are exactly the loops, so cycle rank >= 0.25 * rooms is enforced by
  // counting. The attempt cap only matters for a site so small the pairs run
  // out, and the 8-room floor in buildGeography keeps sites above it.
  const extras = Math.ceil(roomCount * 0.25);
  let added = 0;
  let attempts = 0;
  while (added < extras && attempts < extras * 20) {
    attempts += 1;
    const [a, b] = rng.distinct(2, rooms.length);
    if (a === undefined || b === undefined) continue;
    if (corridors.has(corridorKey(a, b))) continue;
    const from = rooms[a];
    const to = rooms[b];
    if (from === undefined || to === undefined) continue;
    addPath(build, from, to, roomPathKind(rng));
    corridors.add(corridorKey(a, b));
    added += 1;
  }
  const first = rooms[0];
  if (first !== undefined) addEdge(build, 'entry_point', dungeonId, first);
  return rooms;
}

function roomPathKind(rng: Rng): PathKind {
  return weighted(rng, [
    ['door', 85],
    ['secret', 10],
    ['one_way', 5],
  ] as const);
}

function buildGeography(build: Build, campaignId: string): Geography {
  const { rng, book, scale } = build;
  const regionIds: string[] = [];
  const settlementIds: string[] = [];
  const hubIds: string[] = [];
  const dungeonIds: string[] = [];
  const roomIds: string[] = [];
  const roomsByDungeon = new Map<string, readonly string[]>();
  const settlementsByRegion: string[][] = [];

  for (let g = 0; g < 6; g += 1) {
    const terrain = terrainKind(rng);
    const regionId = addNode(build, {
      idPrefix: 'region',
      name: book.unique('region', regionName(rng)),
      oneLine: `A ${terrain} region.`,
      depth: 1,
      data: { kind: 'location', subtype: 'region', terrain },
    });
    addEdge(build, 'contains', campaignId, regionId);
    regionIds.push(regionId);

    const regionSettlements: string[] = [];
    for (let s = 0; s < 4; s += 1) {
      const hub = s === 0;
      const settlementId = addNode(build, {
        idPrefix: 'settlement',
        name: book.unique('settlement', placeName(rng)),
        oneLine: hub ? 'The safe hub the region radiates from.' : `A ${terrain} settlement.`,
        depth: 2,
        tags: hub ? ['pattern:hub-spoke'] : [],
        data: hub
          ? { kind: 'location', subtype: 'settlement', terrain, hub: true }
          : { kind: 'location', subtype: 'settlement', terrain },
      });
      addEdge(build, 'contains', regionId, settlementId);
      settlementIds.push(settlementId);
      regionSettlements.push(settlementId);
      if (hub) hubIds.push(settlementId);

      const buildingCount = hub ? rng.int(6, 8) : rng.int(2, 6);
      for (let b = 0; b < buildingCount; b += 1) {
        const buildingId = addNode(build, {
          idPrefix: 'building',
          name: book.unique('building', buildingName(rng)),
          oneLine: 'A building worth a key on the map.',
          depth: 3,
          data: { kind: 'location', subtype: 'building' },
        });
        addEdge(build, 'contains', settlementId, buildingId);
        // Ordinary buildings still have interiors, 2 to 4 unkeyed rooms in a
        // simple chain of doors: no loop quota, that is what marks a dungeon.
        const roomCount = rng.int(2, 4);
        let previousRoom: string | undefined;
        for (let r = 0; r < roomCount; r += 1) {
          const roomId = addNode(build, {
            idPrefix: 'room',
            name: book.unique(`room:${buildingId}`, roomName(rng)),
            oneLine: 'A room of this building.',
            depth: 4,
            data: { kind: 'location', subtype: 'room' },
          });
          addEdge(build, 'contains', buildingId, roomId);
          if (previousRoom === undefined) addEdge(build, 'entry_point', buildingId, roomId);
          else addPath(build, previousRoom, roomId, 'door');
          previousRoom = roomId;
          roomIds.push(roomId);
        }
      }
    }
    settlementsByRegion.push(regionSettlements);

    // 3 to 4 keyed dungeon sites per region, hung off random settlements.
    const dungeonCount = rng.int(3, 4);
    for (let d = 0; d < dungeonCount; d += 1) {
      const host = rng.pick(regionSettlements);
      const dungeonId = addNode(build, {
        idPrefix: 'dungeon',
        name: book.unique('dungeon', dungeonName(rng)),
        oneLine: 'A keyed site with a looping room graph.',
        depth: 3,
        tags: ['pattern:pointcrawl', 'jaquaysed'],
        data: { kind: 'location', subtype: 'building', dungeon: true },
      });
      addEdge(build, 'contains', host, dungeonId);
      dungeonIds.push(dungeonId);
      // The 8-room floor is what keeps a keyed site a keyed site at any
      // scale: entry point present, loop quota meaningful.
      const rooms = buildRoomGraph(build, dungeonId, Math.max(8, Math.round(rng.int(15, 40) * scale)));
      roomsByDungeon.set(dungeonId, rooms);
      roomIds.push(...rooms);
    }
  }

  // The Ravenloft-class finale: one 88-room site in the last region, because
  // Castle Ravenloft really has 88 keyed areas and the dataset should have one
  // structure at that scale.
  const lastRegionSettlements = settlementsByRegion[settlementsByRegion.length - 1];
  if (lastRegionSettlements !== undefined) {
    const host = rng.pick(lastRegionSettlements);
    const finaleId = addNode(build, {
      idPrefix: 'dungeon',
      name: book.unique('dungeon', `the ${placeName(rng)} Citadel`),
      oneLine: 'The 88-room finale site.',
      depth: 3,
      tags: ['pattern:pointcrawl', 'jaquaysed', 'finale'],
      data: { kind: 'location', subtype: 'building', dungeon: true },
    });
    addEdge(build, 'contains', host, finaleId);
    dungeonIds.push(finaleId);
    const rooms = buildRoomGraph(build, finaleId, 88);
    roomsByDungeon.set(finaleId, rooms);
    roomIds.push(...rooms);
  }

  // The overland pointcrawl. Regions in a ring with two chords; hubs joined
  // hub to hub; each hub roads to its own spokes; spokes chord to each other
  // and reach into adjacent regions often enough to land the settlement layer
  // at the plan's average degree of 2.5 to 4.
  for (let g = 0; g < regionIds.length; g += 1) {
    const here = regionIds[g];
    const there = regionIds[(g + 1) % regionIds.length];
    if (here !== undefined && there !== undefined) addPath(build, here, there, 'road');
  }
  for (let x = 0; x < 2; x += 1) {
    const [a, b] = rng.distinct(2, regionIds.length);
    const from = a === undefined ? undefined : regionIds[a];
    const to = b === undefined ? undefined : regionIds[b];
    if (from !== undefined && to !== undefined) addPath(build, from, to, 'trail');
  }
  for (let g = 0; g < settlementsByRegion.length; g += 1) {
    const settlements = settlementsByRegion[g];
    if (settlements === undefined) continue;
    const [hub, ...spokes] = settlements;
    if (hub === undefined) continue;
    for (const spoke of spokes) addPath(build, hub, spoke, 'road');
    for (let s = 0; s + 1 < spokes.length; s += 1) {
      const here = spokes[s];
      const there = spokes[s + 1];
      if (here !== undefined && there !== undefined && rng.chance(0.5)) {
        addPath(build, here, there, 'trail');
      }
    }
    const nextRegion = settlementsByRegion[(g + 1) % settlementsByRegion.length];
    const nextHub = nextRegion?.[0];
    if (nextHub !== undefined) addPath(build, hub, nextHub, 'road');
    const reachingSpoke = spokes[rng.int(0, Math.max(0, spokes.length - 1))];
    const reached = nextRegion?.[rng.int(0, Math.max(0, (nextRegion?.length ?? 1) - 1))];
    if (reachingSpoke !== undefined && reached !== undefined && rng.chance(0.6)) {
      addPath(build, reachingSpoke, reached, 'trail');
    }
  }

  return { regionIds, settlementIds, hubIds, dungeonIds, roomIds, roomsByDungeon };
}

// ---------------------------------------------------------------------------
// People: NPCs and factions.

interface People {
  /** Every NPC with the one field downstream layers branch on. */
  readonly npcs: readonly { readonly id: string; readonly attitude: string }[];
  readonly npcIds: readonly string[];
  readonly factions: readonly { readonly id: string; readonly name: string }[];
}

function addNpc(
  build: Build,
  home: string | undefined,
  boss: boolean,
): { id: string; attitude: string } {
  const { rng, book } = build;
  const attitude = boss
    ? 'hostile'
    : weighted(rng, [
        ['ally', 25],
        ['neutral', 55],
        ['hostile', 20],
      ] as const);
  const role = boss ? 'master of this place' : personRole(rng);
  const secret = rng.chance(0.3) ? `Knows why ${omen(rng)}.` : undefined;
  const npcId = addNode(build, {
    idPrefix: 'npc',
    name: book.unique('npc', personName(rng)),
    oneLine: `A ${attitude} ${role}.`,
    depth: 4,
    data:
      secret === undefined
        ? { kind: 'npc', role, attitude }
        : { kind: 'npc', role, attitude, secret },
  });
  if (home !== undefined && rng.chance(boss ? 1 : 0.85)) {
    addEdge(build, 'located_at', npcId, home);
  }
  return { id: npcId, attitude };
}

function buildPeople(build: Build, geo: Geography): People {
  const { rng, book, scale } = build;
  const npcs: { id: string; attitude: string }[] = [];

  for (const hub of geo.hubIds) {
    const count = Math.round(rng.int(12, 20) * scale);
    for (let i = 0; i < count; i += 1) npcs.push(addNpc(build, hub, false));
  }
  for (const settlement of geo.settlementIds) {
    if (geo.hubIds.includes(settlement)) continue;
    const count = Math.round(rng.int(6, 10) * scale);
    for (let i = 0; i < count; i += 1) npcs.push(addNpc(build, settlement, false));
  }
  for (const dungeon of geo.dungeonIds) {
    const rooms = geo.roomsByDungeon.get(dungeon);
    const lair = rooms === undefined || rooms.length === 0 ? dungeon : rng.pick(rooms);
    npcs.push(addNpc(build, lair, true));
    const lieutenants = rng.int(2, 4);
    for (let i = 0; i < lieutenants; i += 1) {
      const post = rooms === undefined || rooms.length === 0 ? dungeon : rng.pick(rooms);
      npcs.push(addNpc(build, post, false));
    }
  }
  for (const region of geo.regionIds) {
    const wanderers = rng.int(8, 14);
    for (let i = 0; i < wanderers; i += 1) npcs.push(addNpc(build, region, false));
  }

  const npcIds = npcs.map((npc) => npc.id);

  // Social fabric: 1 to 5 acquaintances each, self excluded by construction.
  // Indices are drawn over a range one short of the roster and skip-adjusted
  // past the NPC's own position, so the documented floor of one edge holds:
  // drawing over the full roster and filtering self out afterwards could
  // leave an NPC with zero.
  for (let selfIndex = 0; selfIndex < npcIds.length; selfIndex += 1) {
    const npc = npcIds[selfIndex];
    if (npc === undefined) continue;
    const count = rng.int(1, 5);
    for (const drawn of rng.distinct(count, npcIds.length - 1)) {
      const other = npcIds[drawn >= selfIndex ? drawn + 1 : drawn];
      if (other !== undefined) addEdge(build, 'knows', npc, other);
    }
  }

  const factions: { id: string; name: string }[] = [];
  for (let f = 0; f < 12; f += 1) {
    const stance = weighted(rng, [
      ['ally', 25],
      ['neutral', 35],
      ['hostile', 40],
    ] as const);
    const name = book.unique('faction', factionName(rng));
    const factionId = addNode(build, {
      idPrefix: 'faction',
      name,
      oneLine: `A ${stance} power with its own design.`,
      depth: 2,
      tags: ['pattern:front-clock'],
      data: { kind: 'faction', goal: `To make sure ${omen(rng)}.`, stance },
    });
    factions.push({ id: factionId, name });

    const memberCount = Math.min(rng.int(8, 40), npcIds.length);
    const members = rng.distinct(memberCount, npcIds.length);
    let leader: string | undefined;
    for (const index of members) {
      const npc = npcIds[index];
      if (npc === undefined) continue;
      addEdge(build, 'member_of', npc, factionId);
      leader = leader ?? npc;
    }
    if (leader !== undefined) addEdge(build, 'leads', leader, factionId);
  }
  for (let a = 0; a < factions.length; a += 1) {
    for (let b = a + 1; b < factions.length; b += 1) {
      const from = factions[a];
      const to = factions[b];
      if (from === undefined || to === undefined) continue;
      const roll = rng.next();
      if (roll < 0.2) addEdge(build, 'ally_of', from.id, to.id);
      else if (roll < 0.45) addEdge(build, 'hostile_to', from.id, to.id);
    }
  }

  return { npcs, npcIds, factions };
}

// ---------------------------------------------------------------------------
// Stuff: statblocks, items, condition modifiers.

interface Stuff {
  readonly items: readonly {
    readonly id: string;
    readonly rarity: string;
    readonly plotCritical: boolean;
  }[];
}

function buildStuff(build: Build, spine: Spine, geo: Geography, people: People): Stuff {
  const { rng, book } = build;

  const statblockIds: string[] = [];
  for (let m = 0; m < 130; m += 1) {
    const cr = Math.min(24, Math.round((0.25 + m * 0.2) * 4) / 4);
    statblockIds.push(
      addNode(build, {
        idPrefix: 'statblock',
        name: book.unique('statblock', monsterName(m)),
        oneLine: `CR ${String(cr)}.`,
        depth: 4,
        data: { kind: 'statblock', challengeRating: cr },
      }),
    );
  }
  // Zipf reuse: the low-index statblocks are the goblins every encounter
  // shares, the tail appears once or never. Encounters get 1 to 3 refs.
  for (const encounter of spine.encounterIds) {
    const refs = rng.int(1, 3);
    for (let i = 0; i < refs; i += 1) {
      const statblock = statblockIds[rng.zipf(statblockIds.length)];
      if (statblock !== undefined) addEdge(build, 'uses_statblock', encounter, statblock);
    }
  }
  // Hostile NPCs fight with a statblock 60% of the time.
  for (const npc of people.npcs) {
    if (npc.attitude === 'hostile' && rng.chance(0.6)) {
      const statblock = statblockIds[rng.zipf(statblockIds.length)];
      if (statblock !== undefined) addEdge(build, 'uses_statblock', npc.id, statblock);
    }
  }

  const items: { id: string; rarity: string; plotCritical: boolean }[] = [];
  for (let i = 0; i < 300; i += 1) {
    const rarity = weighted(rng, [
      ['common', 35],
      ['uncommon', 30],
      ['rare', 20],
      ['very_rare', 10],
      ['legendary', 5],
    ] as const);
    const plotCritical = i < 30;
    const itemId = addNode(build, {
      idPrefix: 'item',
      name: book.unique('item', itemName(rng)),
      oneLine: plotCritical ? 'A plot-critical item: something opens only for it.' : `A ${rarity} item.`,
      depth: 4,
      data: { kind: 'item', rarity, plotCritical },
    });
    items.push({ id: itemId, rarity, plotCritical });
    // Everything is somewhere: a room mostly, a person's pockets otherwise.
    addEdge(
      build,
      'located_at',
      itemId,
      rng.chance(0.65) ? rng.pick(geo.roomIds) : rng.pick(people.npcIds),
    );
  }
  // What the plot-critical 10% unlock: dungeon rooms mostly, quest steps once
  // those exist (the quests layer wires that half).
  for (const item of items.slice(0, 30)) {
    if (rng.chance(0.6)) addEdge(build, 'unlocks', item.id, rng.pick(geo.roomIds));
  }

  const conditionIds: string[] = [];
  const conditions: readonly (readonly ['weather' | 'time' | 'terrain' | 'magical', string, string])[] = [
    ['weather', 'heavy rain', 'visibility one mile, disadvantage on Perception'],
    ['weather', 'fog bank', 'heavily obscured beyond 30 feet'],
    ['weather', 'high wind', 'disadvantage on ranged attacks, open flames die'],
    ['weather', 'snowfall', 'difficult terrain, tracks fill within the hour'],
    ['weather', 'heatwave', 'a gallon of water per day or exhaustion'],
    ['weather', 'thunderstorm', 'thunder masks sound, lightning marks the tallest thing'],
    ['time', 'dead of night', 'darkness outside lit streets, most NPCs asleep'],
    ['time', 'market day', 'crowds everywhere, watch doubled, rumors cheap'],
    ['time', 'festival', 'the town is masked, nothing closes, nobody is home'],
    ['magical', 'dead magic pocket', 'spells fail, magic items go quiet'],
    ['magical', 'wild surge zone', 'first spell each scene surges'],
    ['terrain', 'flooded passages', 'swim checks, torches at risk'],
    ['terrain', 'rubble choke', 'difficult terrain, loud to cross'],
    ['terrain', 'rotten floors', 'weight checks, falls to the level below'],
  ];
  for (let c = 0; c < 45; c += 1) {
    const template = conditions[c % conditions.length];
    if (template === undefined) continue;
    const [scope, name, effect] = template;
    conditionIds.push(
      addNode(build, {
        idPrefix: 'condition',
        name: book.unique('condition', name),
        oneLine: effect,
        depth: 4,
        data: { kind: 'condition_modifier', scope, effect },
      }),
    );
  }
  // 40% of scenes run under a modifier; every region carries standing weather.
  for (const scene of spine.sceneIds) {
    if (rng.chance(0.4)) addEdge(build, 'modified_by', scene, rng.pick(conditionIds));
  }
  for (const region of geo.regionIds) {
    addEdge(build, 'modified_by', region, rng.pick(conditionIds));
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Quests: the branch-and-merge DAG, and the clue web on top of it.

interface Quests {
  readonly questIds: readonly string[];
}

function buildQuests(build: Build, geo: Geography, people: People, stuff: Stuff): Quests {
  const { rng, book } = build;
  const questIds: string[] = [];
  const allStepIds: string[] = [];
  const revelationIds: string[] = [];
  let revelationsLeft = 40;

  for (let q = 0; q < 60; q += 1) {
    const subject = rng.chance(0.5) ? itemName(rng) : placeName(rng);
    // The title is rolled once and the objective restates it, so the card
    // cannot contradict the node's own name.
    const title = questName(rng, subject);
    const questId = addNode(build, {
      idPrefix: 'quest',
      name: book.unique('quest', title),
      oneLine: 'A quest with steps that branch on how its checks go.',
      depth: 3,
      tags: ['pattern:branch-merge'],
      data: {
        kind: 'quest',
        objective: `${title} before ${omen(rng)}.`,
        state: weighted(rng, [
          ['available', 50],
          ['active', 30],
          ['done', 15],
          ['failed', 5],
        ] as const),
      },
    });
    questIds.push(questId);
    addEdge(build, 'gives_quest', rng.pick(people.npcIds), questId);

    // 3 to 5 steps in a chain; a step with a check forks: success continues,
    // failure detours through a complication step, partial goes either way.
    // 70% of complications merge back within 2 steps, which is the invariant
    // the tests measure; the rest are honest dead ends.
    const stepCount = rng.int(3, 5);
    const steps: { readonly id: string; readonly check: SkillCheck | undefined }[] = [];
    for (let s = 0; s < stepCount; s += 1) {
      const isRevelation = revelationsLeft > 0 && s === stepCount - 1 && rng.chance(0.8);
      if (isRevelation) revelationsLeft -= 1;
      const check = rng.chance(0.4) ? makeCheck(rng) : undefined;
      const base = {
        kind: 'quest_step' as const,
        objective: `Step ${String(s + 1)}: ${questName(rng, placeName(rng))}.`,
      };
      const data =
        isRevelation && check !== undefined
          ? { ...base, revelation: true, check }
          : isRevelation
            ? { ...base, revelation: true }
            : check !== undefined
              ? { ...base, check }
              : base;
      const stepId = addNode(build, {
        idPrefix: 'step',
        name: book.unique('step', `${isRevelation ? 'Revelation' : 'Step'} ${String(s + 1)}`),
        oneLine: isRevelation
          ? 'A conclusion the Three Clue Rule protects.'
          : 'One step of the quest.',
        depth: 4,
        tags: isRevelation ? ['pattern:clue-web'] : [],
        data,
      });
      addEdge(build, 'contains', questId, stepId);
      steps.push({ id: stepId, check });
      allStepIds.push(stepId);
      if (isRevelation) revelationIds.push(stepId);
    }
    for (let s = 0; s + 1 < steps.length; s += 1) {
      const here = steps[s];
      const after = steps[s + 1];
      if (here === undefined || after === undefined) continue;
      addEdge(build, 'next', here.id, after.id);
      if (here.check === undefined) continue;
      addBranch(build, here.id, after.id, 'success', here.check);
      const complicationId = addNode(build, {
        idPrefix: 'step',
        name: book.unique('step', 'Complication'),
        oneLine: 'The failure path: the same quest, the hard way.',
        depth: 4,
        data: { kind: 'quest_step', objective: `Recover after ${omen(rng)}.` },
      });
      addEdge(build, 'contains', questId, complicationId);
      allStepIds.push(complicationId);
      addBranch(build, here.id, complicationId, 'failure', here.check);
      addBranch(build, here.id, rng.chance(0.5) ? after.id : complicationId, 'partial', here.check);
      if (rng.chance(0.7)) {
        const mergeTarget = steps[Math.min(s + 2, steps.length - 1)] ?? after;
        addEdge(build, 'merges_into', complicationId, mergeTarget.id);
      }
    }
  }

  // Quest chains: some quests require an earlier one.
  for (let x = 0; x < 20; x += 1) {
    const [a, b] = rng.distinct(2, questIds.length);
    if (a === undefined || b === undefined) continue;
    const early = questIds[Math.min(a, b)];
    const late = questIds[Math.max(a, b)];
    if (early !== undefined && late !== undefined && early !== late) {
      addEdge(build, 'requires', late, early);
    }
  }
  // Rewards, drawn from the full pool, plot-critical items included, and
  // re-drawn up to twice while the pick is common: a stated bias has to be a
  // built one. Roughly 4% of rewards stay common (0.35 cubed).
  for (const questId of questIds) {
    if (!rng.chance(0.75)) continue;
    let reward = rng.pick(stuff.items);
    for (let retry = 0; retry < 2 && reward.rarity === 'common'; retry += 1) {
      reward = rng.pick(stuff.items);
    }
    addEdge(build, 'rewards', questId, reward.id);
  }
  // The other half of the plot-critical unlocks, now that steps exist.
  for (const item of stuff.items.slice(0, 30)) {
    if (rng.chance(0.4)) addEdge(build, 'unlocks', item.id, rng.pick(allStepIds));
  }

  // The clue web. Every revelation gets exactly three clues, one held by a
  // room, one by an NPC, one by an item: three distinct holders of three
  // distinct kinds, which is the Three Clue Rule as a construction rule
  // rather than an aspiration.
  for (const revelation of revelationIds) {
    const holders = [
      rng.pick(geo.roomIds),
      rng.pick(people.npcIds),
      rng.pick(stuff.items).id,
    ];
    for (const holder of holders) {
      const clueId = addNode(build, {
        idPrefix: 'clue',
        name: book.unique('clue', `a clue: ${omen(rng)}`),
        oneLine: 'One of three clues pointing at the same conclusion.',
        depth: 5,
        tags: ['pattern:clue-web'],
        data: { kind: 'clue', fact: `Someone saw that ${omen(rng)}.` },
      });
      addEdge(build, 'contains_clue', holder, clueId);
      addEdge(build, 'points_to', clueId, revelation);
    }
  }

  return { questIds };
}

// ---------------------------------------------------------------------------
// Pressure: a front per faction, ticking toward its doom.

function buildPressure(build: Build, spine: Spine, people: People, quests: Quests): void {
  const { rng, book } = build;
  for (const faction of people.factions) {
    const clockSize = rng.int(4, 6);
    const frontId = addNode(build, {
      idPrefix: 'front',
      name: book.unique('front', `the design of ${faction.name}`),
      oneLine: `A ${String(clockSize)}-segment clock, ticking whether or not anyone watches.`,
      depth: 2,
      tags: ['pattern:front-clock'],
      data: { kind: 'front', doom: `Unless stopped, ${omen(rng)} forever.`, clockSize },
    });

    let previousTick: string | undefined;
    for (let t = 0; t < clockSize; t += 1) {
      // The portents escalate in sequence, so the last tick reads as the last
      // warning rather than another first one.
      const opener =
        t === 0 ? 'First' : t === clockSize - 1 ? 'At the last' : rng.pick(['Then', 'Soon', 'Next']);
      const tickId = addNode(build, {
        idPrefix: 'tick',
        name: book.unique(`tick:${frontId}`, `portent ${String(t + 1)}`),
        oneLine: `Grim portent ${String(t + 1)} of ${String(clockSize)}.`,
        depth: 3,
        tags: ['pattern:front-clock'],
        data: { kind: 'clock_tick', index: t + 1, portent: `${opener}, ${omen(rng)}.` },
      });
      addEdge(build, 'contains', frontId, tickId);
      if (previousTick !== undefined) addEdge(build, 'next', previousTick, tickId);
      previousTick = tickId;
    }

    for (const index of rng.distinct(rng.int(2, 4), spine.sceneIds.length)) {
      const scene = spine.sceneIds[index];
      if (scene !== undefined) addEdge(build, 'advances_clock', scene, frontId);
    }
    for (const index of rng.distinct(rng.int(1, 2), spine.sceneIds.length)) {
      const scene = spine.sceneIds[index];
      if (scene !== undefined) addEdge(build, 'triggers', frontId, scene);
    }
    const interruptingQuest = rng.pick(quests.questIds);
    addEdge(build, 'interrupted_by', frontId, interruptingQuest);
  }
}

// ---------------------------------------------------------------------------

/**
 * Generates the mock campaign. Same options, same campaign, byte for byte.
 *
 * Measured, not projected: the default seed at scale 1 generates 3,010 nodes
 * and 7,100 edges; scale 0.5 and 2 land at 2,581 and 3,752 nodes, because
 * `scale` moves only rooms per dungeon and NPCs per settlement while the
 * spine, quests, and bestiary stay put. The research proposal's 8,000-plus
 * edge estimate assumed a denser social layer than the one built here; the
 * invariant suite gates the ratio at 2 to 4 edges per node rather than
 * pinning either number.
 */
export function generateCampaign(options: GenerateOptions = {}): Campaign {
  const seed = options.seed ?? 20260814;
  const scale = options.scale ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new RangeError(`scale has to be a positive finite number, got ${String(scale)}`);
  }
  const build: Build = {
    rng: new Rng(seed),
    book: new NameBook(),
    nodes: [],
    edges: [],
    counters: new Map(),
    scale,
  };

  const spine = buildSpine(build);
  const geo = buildGeography(build, spine.campaignId);
  const people = buildPeople(build, geo);
  const stuff = buildStuff(build, spine, geo, people);
  const quests = buildQuests(build, geo, people, stuff);
  buildPressure(build, spine, people, quests);

  // Scenes happen somewhere: tie the spine to the geography.
  const scenePlaces = [...geo.roomIds, ...geo.settlementIds];
  for (const scene of spine.sceneIds) {
    addEdge(build, 'located_at', scene, build.rng.pick(scenePlaces));
  }

  return { seed, rootId: spine.campaignId, nodes: build.nodes, edges: build.edges };
}
