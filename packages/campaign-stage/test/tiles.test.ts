import { generateCampaign } from '@dagr/campaign';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STYLE,
  LOCATION_STYLE,
  SMALLEST_NODE_SIZE,
  cssHex,
  nodeColor,
  styleFor,
} from '../src/campaign-style.js';
import {
  CAMPAIGN_SPACING,
  TARGET_ASPECT,
  TILE_GUTTER,
  TILE_GUTTER_RATIO,
  assignTiles,
  campaignSpacing,
  containsParents,
  gridPositions,
  isRouted,
  shelfPack,
} from '../src/tiles.js';
import type { TileBox } from '../src/tiles.js';

/**
 * The decidable half of P4: how the campaign is cut up, and where the pieces go.
 *
 * Against the REAL dataset rather than a fixture, because the properties worth
 * asserting are properties of the campaign's shape (its contains forest is a
 * strict forest, its social edges are all overlay edges, its residue is a
 * thousand nodes with no routed edge) and a fixture would assert them of itself.
 * The generator is deterministic per seed, so this is reproducible; three seeds
 * rather than one, because a partition that holds only at the default seed is a
 * partition that holds by accident.
 */

const SEEDS = [undefined, 7, 99] as const;

/**
 * The scale knob, which moves rooms per dungeon and NPCs per settlement
 * together. Varied as well as the seed because the tiling is a claim about the
 * campaign's SHAPE, and a shape that only holds at one size is a coincidence: a
 * review swept seven seeds against these three and the partition held at all
 * twenty-one.
 */
const SCALES = [0.5, 1, 2] as const;

describe('the routed and overlay split', () => {
  it('keeps the dense cyclic layers out of layout entirely', () => {
    // The plan's rule, as an assertion about the data: social, investigation,
    // reference and pressure edges are dense and cyclic, and feeding them to
    // crossing reduction buys nothing a viewer can read.
    const campaign = generateCampaign();
    const routed = campaign.edges.filter(isRouted);
    expect(routed.length).toBeGreaterThan(0);
    expect(routed.length).toBeLessThan(campaign.edges.length);
    for (const kind of ['knows', 'ally_of', 'uses_statblock', 'contains_clue', 'advances_clock']) {
      expect(routed.some((edge) => edge.kind === kind)).toBe(false);
    }
    for (const kind of ['contains', 'next', 'leads_to', 'requires']) {
      expect(routed.some((edge) => edge.kind === kind)).toBe(true);
    }
  });
});

describe('the contains forest', () => {
  it('gives every contained node exactly one parent, at three seeds', () => {
    // A node with two parents would make the tile walk depend on edge order,
    // which is the kind of thing that produces a different picture on a
    // different day. `@dagr/campaign` asserts the forest property too; this
    // asserts that THIS reading of it agrees.
    for (const seed of SEEDS) {
      const campaign = seed === undefined ? generateCampaign() : generateCampaign({ seed });
      expect(() => containsParents(campaign.edges)).not.toThrow();
      const parents = containsParents(campaign.edges);
      expect(parents.size).toBeGreaterThan(1000);
    }
  });

  it('rejects a second parent rather than picking one', () => {
    expect(() =>
      containsParents([
        { id: 'e1', source: 'a', target: 'c', kind: 'contains' },
        { id: 'e2', source: 'b', target: 'c', kind: 'contains' },
      ]),
    ).toThrow(/not a forest/);
  });
});

describe('assignTiles', () => {
  it('PARTITIONS the campaign: every node in exactly one tile, at every seed and scale', () => {
    // The property the whole file exists for. A node in two tiles is drawn
    // twice at two positions and a node in none is missing from a picture of
    // three thousand, and neither is something a reader would report as a bug.
    for (const seed of SEEDS) {
      for (const scale of SCALES) {
        const campaign = generateCampaign({ ...(seed === undefined ? {} : { seed }), scale });
        const tiles = assignTiles(campaign);
        const seen = new Set<string>();
        for (const tile of tiles) {
          for (const id of tile.nodeIds) {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
          }
        }
        expect(seen.size).toBe(campaign.nodes.length);
      }
    }
  });

  it('keeps the spine closed under contains, so nothing joins it by accident', () => {
    // A node lands in the spine when nothing above it is a tile root. That is
    // stated as "the campaign and its arcs", and it holds at every seed today,
    // but the rule is structural rather than by kind: if the generator ever gave
    // a node outside the contains forest a contains child, that child would
    // silently join the spine's LAYOUT tile and the partition assertion above
    // would still pass. This is the assertion that would not.
    for (const seed of SEEDS) {
      const campaign = seed === undefined ? generateCampaign() : generateCampaign({ seed });
      const tiles = assignTiles(campaign);
      const parents = containsParents(campaign.edges);
      const spine = tiles.find((tile) => tile.id === 'spine');
      expect(spine).toBeDefined();
      const members = new Set(spine?.nodeIds);
      for (const id of members) {
        const parent = parents.get(id);
        if (parent !== undefined) expect(members.has(parent)).toBe(true);
      }
    }
  });

  it('refuses a contains chain that loops rather than walking it forever', () => {
    // The guard exists because a cycle here would hang the page rather than fail
    // a test, and nothing in the real dataset can reach it.
    const looped = {
      seed: 0,
      rootId: 'a',
      nodes: [
        { id: 'a', name: 'a', oneLine: '', depth: 0, tags: [], data: { kind: 'chapter', expectedOrder: 1, summary: '' } },
        { id: 'b', name: 'b', oneLine: '', depth: 1, tags: [], data: { kind: 'scene', sceneType: 'social', trigger: '' } },
        { id: 'c', name: 'c', oneLine: '', depth: 2, tags: [], data: { kind: 'scene', sceneType: 'social', trigger: '' } },
      ],
      edges: [
        { id: 'e1', source: 'b', target: 'c', kind: 'contains' },
        { id: 'e2', source: 'c', target: 'b', kind: 'contains' },
      ],
    } as unknown as Parameters<typeof assignTiles>[0];
    expect(() => assignTiles(looped)).toThrow(/loops at/);
  });

  it('cuts a tile per chapter, region, quest and front, plus a spine', () => {
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const byId = new Map(campaign.nodes.map((node) => [node.id, node]));
    const chapters = campaign.nodes.filter((node) => node.data.kind === 'chapter');
    const regions = campaign.nodes.filter(
      (node) => node.data.kind === 'location' && node.data.subtype === 'region',
    );

    expect(tiles.some((tile) => tile.id === 'spine')).toBe(true);
    for (const root of [...chapters, ...regions]) {
      const tile = tiles.find((entry) => entry.id === root.id);
      expect(tile).toBeDefined();
      // A tile root is IN its own tile, which is what makes the partition work:
      // it is not left in the spine to be drawn twice.
      expect(tile?.nodeIds).toContain(root.id);
      expect(tile?.title).toBe(byId.get(root.id)?.name);
    }
    expect(tiles.length).toBeGreaterThan(chapters.length + regions.length);
  });

  it('puts a room in its REGION tile, not in its building or the spine', () => {
    // The walk is up the contains chain to the FIRST tile root, so a room's
    // chain (building, settlement, region) stops at the region and a chapter's
    // scene stops at the chapter.
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const tileOf = new Map<string, string>();
    for (const tile of tiles) for (const id of tile.nodeIds) tileOf.set(id, tile.id);

    const regionIds = new Set(
      campaign.nodes
        .filter((node) => node.data.kind === 'location' && node.data.subtype === 'region')
        .map((node) => node.id),
    );
    const rooms = campaign.nodes.filter(
      (node) => node.data.kind === 'location' && node.data.subtype === 'room',
    );
    expect(rooms.length).toBeGreaterThan(100);
    for (const room of rooms) {
      const tile = tileOf.get(room.id);
      expect(tile).toBeDefined();
      expect(regionIds.has(tile as string)).toBe(true);
    }
  });

  it('grids the strata a Sugiyama pass could do nothing with', () => {
    // NPCs, factions, items, stat blocks, clues and weather sit outside the
    // contains forest, and no routed edge has both ends inside one of these
    // groups, so a layer assignment would put all 375 NPCs in rank 0 and the
    // "layout" of a bestiary would be one row 550 nodes wide. A grid is what
    // that data actually wants.
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const grids = tiles.filter((tile) => tile.kind === 'grid');
    expect(grids.map((tile) => tile.id).sort()).toEqual([
      'all-clue',
      'all-condition_modifier',
      'all-faction',
      'all-item',
      'all-npc',
      'all-statblock',
    ]);

    const routed = campaign.edges.filter(isRouted);
    for (const tile of grids) {
      const members = new Set(tile.nodeIds);
      const inside = routed.filter(
        (edge) => members.has(edge.source) && members.has(edge.target),
      );
      expect(inside).toHaveLength(0);
    }
  });

  it('leaves the routed edges that LEAVE a grid tile to be drawn between tiles', () => {
    // Worth stating because a grid tile is not edgeless in the campaign, only
    // edgeless within itself: `rewards` runs from a quest to an item and
    // `requires` from a step to one, so an item has routed edges and every one
    // of them crosses a tile boundary. P5 draws those against the tile
    // placements rather than routing them through a Sugiyama pass that only
    // ever sees one tile.
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const tileOf = new Map<string, string>();
    for (const tile of tiles) for (const id of tile.nodeIds) tileOf.set(id, tile.id);
    const crossing = campaign.edges
      .filter(isRouted)
      .filter((edge) => tileOf.get(edge.source) !== tileOf.get(edge.target));
    expect(crossing.length).toBeGreaterThan(0);
    // And every one of them still names two nodes that were drawn, so a line
    // between tiles always has two ends to attach to.
    for (const edge of crossing) {
      expect(tileOf.has(edge.source)).toBe(true);
      expect(tileOf.has(edge.target)).toBe(true);
    }
  });

  it('leaves every LAYOUT tile with at least one routed edge to lay out', () => {
    // The other half of the same claim: a layout tile that turned out to be
    // edgeless would be a Sugiyama pass producing one long row, which is the
    // ribbon this whole scheme exists to avoid.
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const routed = campaign.edges.filter(isRouted);
    for (const tile of tiles.filter((entry) => entry.kind === 'layout')) {
      const members = new Set(tile.nodeIds);
      const inside = routed.filter(
        (edge) => members.has(edge.source) && members.has(edge.target),
      );
      expect(inside.length).toBeGreaterThan(0);
    }
  });

  it('keeps every tile small enough that a Sugiyama pass is worth running', () => {
    // The point of tiling, as a number. The largest tile is the 88-room finale
    // dungeon's region, and even that is two orders of magnitude below the
    // whole campaign, which is the difference between a figure and a ribbon.
    const campaign = generateCampaign();
    const tiles = assignTiles(campaign);
    const largest = Math.max(...tiles.map((tile) => tile.nodeIds.length));
    expect(largest).toBeLessThan(campaign.nodes.length / 3);
  });
});

describe('shelfPack', () => {
  const box = (id: string, width: number, height: number): TileBox => ({ id, width, height });

  it('places nothing for nothing', () => {
    expect(shelfPack([])).toEqual({ tiles: [], width: 0, height: 0 });
  });

  it('never overlaps two tiles, gutter included', () => {
    // The assertion the packer exists to satisfy. Two tiles overlapping is two
    // figures drawn on top of each other, which reads as a layout failure.
    const boxes = Array.from({ length: 40 }, (_, i) =>
      box(`t${String(i)}`, 100 + ((i * 37) % 900), 80 + ((i * 53) % 400)),
    );
    const packing = shelfPack(boxes);
    for (let i = 0; i < packing.tiles.length; i += 1) {
      for (let j = i + 1; j < packing.tiles.length; j += 1) {
        const a = packing.tiles[i];
        const b = packing.tiles[j];
        if (a === undefined || b === undefined) throw new Error('unreachable');
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('keeps a gutter between SHELVES, not only between neighbours on one', () => {
    // The gap a review found: the overlap test accepts two tiles touching, and
    // the neighbour test only checks x, so deleting `+ gutter` from the shelf
    // advance left the whole file green while every shelf sat flush against the
    // one above it.
    const boxes = [
      box('tall-a', 400, 900),
      box('tall-b', 400, 900),
      box('short-a', 400, 100),
      box('short-b', 400, 100),
    ];
    const packing = shelfPack(boxes, { gutter: 70, aspect: 1 });
    const shelves = new Map<number, number>();
    for (const tile of packing.tiles) {
      shelves.set(tile.y, Math.max(shelves.get(tile.y) ?? 0, tile.height));
    }
    const tops = [...shelves.keys()].sort((a, b) => a - b);
    expect(tops.length).toBeGreaterThan(1);
    for (let i = 1; i < tops.length; i += 1) {
      const previousTop = tops[i - 1] as number;
      const top = tops[i] as number;
      expect(top - previousTop).toBe((shelves.get(previousTop) as number) + 70);
    }
  });

  it('keeps a gutter between neighbours on a shelf', () => {
    // Tall and narrow, so the area-derived shelf width has room for both: two
    // squares would land on separate shelves, which is the packer working
    // rather than the gutter failing.
    const packing = shelfPack([box('a', 100, 400), box('b', 100, 400)], { gutter: 50 });
    const [first, second] = packing.tiles;
    expect(first?.y).toBe(second?.y);
    expect((second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0))).toBe(50);
  });

  it('places every tile exactly once and keeps its size', () => {
    const boxes = [box('a', 100, 50), box('b', 200, 300), box('c', 40, 40)];
    const packing = shelfPack(boxes);
    expect(packing.tiles.map((tile) => tile.id).sort()).toEqual(['a', 'b', 'c']);
    for (const original of boxes) {
      const placed = packing.tiles.find((tile) => tile.id === original.id);
      expect(placed?.width).toBe(original.width);
      expect(placed?.height).toBe(original.height);
    }
  });

  it('lands near the target aspect on a campaign-shaped input', () => {
    // The reason the shelf width is searched rather than computed. The obvious
    // `sqrt(totalArea * aspect)` ignores the space a shelf wastes under its
    // short members, and on a hundred tiles of mixed height it produced 0.92
    // against a 1.78 target: a nearly square packing in a 16:9 frame, which
    // leaves a third of the viewport empty at the fitted zoom.
    const boxes = Array.from({ length: 100 }, (_, i) =>
      box(`t${String(i)}`, 400 + ((i * 91) % 2000), 300 + ((i * 47) % 1200)),
    );
    const packing = shelfPack(boxes);
    const aspect = packing.width / packing.height;
    expect(aspect).toBeGreaterThan(TARGET_ASPECT * 0.75);
    expect(aspect).toBeLessThan(TARGET_ASPECT * 1.33);
  });

  it('hits the target on inputs a single-pass width estimate misses', () => {
    // Two shapes of tile that break the area estimate in opposite directions:
    // many small ones (where the gutters dominate) and a few very tall ones
    // (where one shelf's wasted height dominates).
    for (const boxes of [
      Array.from({ length: 200 }, (_, i) => box(`s${String(i)}`, 100, 100)),
      Array.from({ length: 12 }, (_, i) => box(`t${String(i)}`, 500, i % 3 === 0 ? 4000 : 200)),
    ]) {
      const packing = shelfPack(boxes);
      const aspect = packing.width / packing.height;
      expect(aspect).toBeGreaterThan(TARGET_ASPECT * 0.6);
      expect(aspect).toBeLessThan(TARGET_ASPECT * 1.7);
    }
  });

  it('wastes less than the same tiles unsorted would', () => {
    // What the sort buys, measured rather than asserted. Each shelf is as tall
    // as its tallest member, so mixing a tall tile with short ones wastes the
    // difference under every short one.
    const boxes = Array.from({ length: 60 }, (_, i) =>
      box(`t${String(i)}`, 300, i % 2 === 0 ? 100 : 2000),
    );
    // An EXPLICIT gutter, because the bound below is about the sort and the
    // default gutter is not: it is the campaign's, and D2 raised it with the
    // node separation, at which point 480 units of gutter around a 300 unit tile
    // is most of the area and this measured the gutter instead.
    const packing = shelfPack(boxes, { gutter: 200 });
    const used = boxes.reduce((total, entry) => total + entry.width * entry.height, 0);
    expect(packing.width * packing.height).toBeLessThan(used * 2.5);
  });

  it('gives a tile wider than the shelf a shelf of its own', () => {
    // The `cursor > 0` guard. Without it, a tile wider than the target width
    // starts a new empty shelf and then still does not fit, forever.
    const packing = shelfPack([box('wide', 100000, 100), box('small', 10, 10)]);
    expect(packing.tiles).toHaveLength(2);
    expect(packing.tiles[0]?.x).toBe(0);
  });

  it('is a pure function of its input, so a screenshot is reproducible', () => {
    const boxes = [box('c', 100, 100), box('a', 100, 100), box('b', 100, 100)];
    expect(shelfPack(boxes)).toEqual(shelfPack([...boxes].reverse()));
  });

  it('rejects a tile with no area, naming it', () => {
    expect(() => shelfPack([box('flat', 100, 0)])).toThrow(/flat/);
    expect(() => shelfPack([box('flat', Number.NaN, 10)])).toThrow(RangeError);
  });
});

describe('gridPositions', () => {
  it('lays out nothing for nothing', () => {
    expect(gridPositions(0, { width: 10, height: 10 })).toEqual({
      positions: [],
      size: { width: 0, height: 0 },
    });
  });

  it('never puts two nodes in the same cell', () => {
    const { positions } = gridPositions(550, { width: 48, height: 48 });
    expect(positions).toHaveLength(550);
    expect(new Set(positions.map((p) => `${String(p.x)},${String(p.y)}`)).size).toBe(550);
  });

  it('lands near the target aspect whatever shape its nodes are', () => {
    // The reason the column count is not `ceil(sqrt(count))`: 550 items at 56
    // by 28 in 24 columns is a block twice as wide as it is tall, and the
    // packer works worst on tiles that are extreme.
    for (const nodeSize of [
      { width: 48, height: 48 },
      { width: 56, height: 28 },
      { width: 96, height: 96 },
    ]) {
      const { size } = gridPositions(550, nodeSize);
      const aspect = size.width / size.height;
      expect(aspect).toBeGreaterThan(TARGET_ASPECT / 2);
      expect(aspect).toBeLessThan(TARGET_ASPECT * 2);
    }
  });

  it('reports a size that contains every node it placed', () => {
    const nodeSize = { width: 56, height: 28 };
    const { positions, size } = gridPositions(37, nodeSize);
    for (const position of positions) {
      expect(position.x - nodeSize.width / 2).toBeGreaterThanOrEqual(0);
      expect(position.y - nodeSize.height / 2).toBeGreaterThanOrEqual(0);
      expect(position.x + nodeSize.width / 2).toBeLessThanOrEqual(size.width + 1e-9);
      expect(position.y + nodeSize.height / 2).toBeLessThanOrEqual(size.height + 1e-9);
    }
  });

  it('puts one node in a cell of its own size', () => {
    const { size } = gridPositions(1, { width: 56, height: 28 });
    expect(size).toEqual({ width: 56, height: 28 });
  });
});

describe('the per-kind style table', () => {
  it('covers every kind the generator produces', () => {
    // A kind with no entry would be `undefined` at the point a node is styled,
    // and the symptom is a crash at load rather than a missing shape, which is
    // the better of the two failures and is still worth not having.
    const campaign = generateCampaign();
    for (const node of campaign.nodes) {
      const style = styleFor(
        node.data.kind,
        node.data.kind === 'location' ? node.data.subtype : undefined,
      );
      expect(style).toBeDefined();
      expect(style.size.width).toBeGreaterThan(0);
      expect(style.size.height).toBeGreaterThan(0);
    }
  });

  it('keeps every circle square, which the renderer requires', () => {
    for (const style of Object.values(CAMPAIGN_STYLE)) {
      if (style.shape !== 'circle') continue;
      expect(style.size.width).toBe(style.size.height);
    }
  });

  it('keeps every corner radius inside half the smaller dimension', () => {
    // Past it the corner arcs of opposite corners overlap and the field stops
    // being a distance to anything: `@dagr/render` rejects it, so a bad number
    // here is a scene that will not build.
    for (const style of Object.values(CAMPAIGN_STYLE)) {
      expect(style.cornerRadius).toBeLessThanOrEqual(
        Math.min(style.size.width, style.size.height) / 2,
      );
    }
  });

  it('sizes a region above a room, so the geography reads as a hierarchy', () => {
    const region = styleFor('location', 'region');
    const room = styleFor('location', 'room');
    expect(region.size.width).toBeGreaterThan(room.size.width * 3);
    expect(styleFor('campaign').size.height).toBeGreaterThan(styleFor('encounter').size.height * 3);
  });

  it('bounds every drawn box PER AXIS, which taking the smallest by area does not', () => {
    // The first version reduced by area and resolved to a clock tick's 32 by 32,
    // while an item and a room are 56 by 28. `zoomLimits` frames this with
    // `fitZoom`, which takes a minimum over both axes, so a height 14% too large
    // silently lowered the zoom ceiling for the two most numerous kinds in the
    // campaign. Both tables, because a location subtype is not in the kind one.
    const every = [...Object.values(CAMPAIGN_STYLE), ...Object.values(LOCATION_STYLE)].map(
      (style) => style.size,
    );
    for (const size of every) {
      expect(SMALLEST_NODE_SIZE.width).toBeLessThanOrEqual(size.width);
      expect(SMALLEST_NODE_SIZE.height).toBeLessThanOrEqual(size.height);
    }
    expect(SMALLEST_NODE_SIZE.width).toBe(Math.min(...every.map((size) => size.width)));
    expect(SMALLEST_NODE_SIZE.height).toBe(Math.min(...every.map((size) => size.height)));
  });

  it('gives a CSS colour the parser accepts, from the same table the GPU reads', () => {
    // A CSS declaration whose value the parser rejects is DROPPED SILENTLY: the
    // element keeps what it inherited and nothing fails, so this is the one
    // conversion in the demo that has to be checked rather than eyeballed.
    const campaign = generateCampaign();
    for (const node of campaign.nodes) {
      expect(nodeColor(node)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(cssHex(0x000000)).toBe('#000000');
    expect(cssHex(0xffb703)).toBe('#ffb703');
  });

  it('badges a node in the colour the GPU actually draws it, subtype included', () => {
    // The reason `nodeColor` takes the NODE. Its first signature was
    // `(kind, subtype?)`, and the optional argument decides the answer for the
    // most numerous kind in the campaign: a room and a region are both
    // `location` and two different blues, so a caller who passed the kind alone
    // badged all 1,023 rooms in the region's colour while the GPU drew them in
    // their own.
    const campaign = generateCampaign();
    for (const node of campaign.nodes) {
      const style = styleFor(
        node.data.kind,
        node.data.kind === 'location' ? node.data.subtype : undefined,
      );
      expect(nodeColor(node)).toBe(cssHex(style.fillColor));
    }
    const rooms = campaign.nodes.filter(
      (node) => node.data.kind === 'location' && node.data.subtype === 'room',
    );
    const regions = campaign.nodes.filter(
      (node) => node.data.kind === 'location' && node.data.subtype === 'region',
    );
    expect(rooms.length).toBeGreaterThan(100);
    expect(nodeColor(rooms[0] as never)).not.toBe(nodeColor(regions[0] as never));
  });

  it('has a gutter wider than layout separates two nodes by', () => {
    // Or a tile boundary would be closer than two nodes inside the same tile,
    // and the tiling would read as noise rather than as chunking. Against the
    // campaign's OWN separation rather than the package default of 50, which is
    // the number this used to compare with and which the campaign no longer
    // uses: a gutter that cleared 50 while the nodes were 120 apart would pass
    // this test and fail the claim it exists to make.
    expect(TILE_GUTTER).toBeGreaterThan(CAMPAIGN_SPACING.nodeSep);
    expect(TILE_GUTTER).toBe(CAMPAIGN_SPACING.nodeSep * TILE_GUTTER_RATIO);
  });

  it('derives every gap from the two separations, so no ratio can drift', () => {
    const spacing = campaignSpacing(70, 90);
    expect(spacing).toEqual({
      nodeSep: 70,
      rankSep: 90,
      tileGutter: 70 * TILE_GUTTER_RATIO,
      // A grid tile IS one rank of nodes, so its cells are a node gap apart.
      gridGap: 70,
    });
  });

  it('separates the campaign by more than the package default, at both axes', () => {
    // The D2 direction, as an assertion rather than as a number nobody would
    // notice reverting: `@dagr/layout` defaults to 50 and 50, and the whole
    // point of the measurement recorded on CAMPAIGN_SPACING is that the campaign
    // is not a graph those defaults were chosen for.
    expect(CAMPAIGN_SPACING.nodeSep).toBeGreaterThan(50);
    expect(CAMPAIGN_SPACING.rankSep).toBeGreaterThan(50);
    // And ranks by more than nodes, because the rank gap is the one with the
    // routed edges in it.
    expect(CAMPAIGN_SPACING.rankSep).toBeGreaterThan(CAMPAIGN_SPACING.nodeSep);
  });
});
