import { EDGE_ROLES } from '@dagr/campaign';
import type { Campaign, CampaignEdge, CampaignNode } from '@dagr/campaign';
import type { Size } from '@dagr/render';

/**
 * How the campaign is cut into tiles, and how the tiles are packed.
 *
 * Pure arithmetic and set membership: no layout engine, no GPU, no DOM, so
 * `test/tiles.test.ts` decides every claim below. The layout runs and the
 * drawing are `campaign-scene.ts`'s business.
 *
 * ## Why tiles at all, which the plan settles and this restates
 *
 * One Sugiyama pass over the whole campaign produces a RIBBON. Ranking 3,010
 * nodes by hierarchy depth puts ~750 rooms and ~550 NPCs into a couple of ranks,
 * which at default spacing is a drawing on the order of 100,000 world units wide
 * and under 2,000 tall. Zoomed to fit, a 50:1 ribbon is a horizontal line on a
 * 16:9 viewport, and "the whole campaign in frame" would frame nothing legible.
 *
 * So the demo composes layouts instead of running one: each chapter's narrative
 * subgraph and each region's location subgraph is laid out separately, and the
 * resulting blocks are packed. That is more honest than it is a workaround,
 * because chapters and regions are how DMs chunk a campaign in the first place,
 * and it showcases the engine running dozens of real layouts rather than one.
 *
 * ## Two kinds of tile, and the second one is not a shortcut
 *
 * A LAYOUT tile has routed edges among its members and goes through
 * `@dagr/layout`. A GRID tile does not, and is arranged in a near-square grid
 * instead. That is not Sugiyama being avoided where it is inconvenient: 550
 * NPCs with no routed edge between them (every social edge is an OVERLAY edge,
 * see `EDGE_ROLES`) is a graph of 550 components, and a layer assignment puts
 * every component in rank 0, so the "layout" of a bestiary is one row 550 nodes
 * wide. A grid is what that data actually wants and it is the same shape a
 * reader expects a list of items to take.
 */

/** Which edge kinds a layout is allowed to see. See `@dagr/campaign`'s EDGE_ROLES. */
export function isRouted(edge: CampaignEdge): boolean {
  return EDGE_ROLES[edge.kind] === 'routed';
}

/** How a tile's nodes get their positions. */
export type TileKind = 'layout' | 'grid';

/** One chunk of the campaign, laid out on its own. */
export interface Tile {
  /** Stable across runs, and what a cross-tile line names. Derived from the tile's root. */
  readonly id: string;
  readonly kind: TileKind;
  /** A short human name, for the readout and for a future tile label. */
  readonly title: string;
  /** Every node in the tile, in campaign order so a run is reproducible. */
  readonly nodeIds: readonly string[];
}

/**
 * The kinds that ROOT a layout tile: the four places the campaign is naturally
 * chunked.
 *
 * A chapter and a region are the plan's two, and quests and fronts are here on
 * the same argument rather than as an afterthought: a quest is a branch-and-merge
 * DAG that reads as one figure, and a front is a countdown clock that reads as
 * one line. Left in the spine they would be ranked against everything else and
 * would stretch it; cut out, each is a small tile whose shape is visible.
 */
const LAYOUT_TILE_ROOTS: ReadonlySet<string> = new Set(['chapter', 'quest', 'front']);

/** The `location` subtype that roots a geography tile. */
const REGION_SUBTYPE = 'region';

/** Whether a node is the root of its own layout tile. */
function isTileRoot(node: CampaignNode): boolean {
  if (node.data.kind === 'location') return node.data.subtype === REGION_SUBTYPE;
  return LAYOUT_TILE_ROOTS.has(node.data.kind);
}

/**
 * Every node's parent in the `contains` forest, or absent for a root and for
 * everything outside the forest.
 *
 * `contains` is a strict forest, which `@dagr/campaign`'s invariant suite
 * asserts across three seeds, so one parent per node is a fact rather than a
 * convenience: a node with two parents would make the walk below depend on edge
 * order.
 */
export function containsParents(edges: readonly CampaignEdge[]): ReadonlyMap<string, string> {
  const parents = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind !== 'contains') continue;
    if (parents.has(edge.target)) {
      throw new RangeError(
        `${edge.target} has two contains parents (${String(parents.get(edge.target))} and ${edge.source}), so it is not a forest`,
      );
    }
    parents.set(edge.target, edge.source);
  }
  return parents;
}

/**
 * Cuts the campaign into tiles: one per chapter, region, quest and front, one
 * for the spine above them, and one per kind for everything outside the
 * `contains` forest.
 *
 * **Every node lands in exactly one tile**, which the test asserts as a
 * partition rather than as a count. A node in two tiles is drawn twice at two
 * positions, and a node in none is missing from a picture of three thousand,
 * neither of which a reader would report as a bug.
 *
 * The walk is up the `contains` chain to the first tile root. A room's chain is
 * building, settlement, region, and it stops at the region; a scene's is chapter
 * and stops there; an encounter's is scene, chapter. Nodes ABOVE every root (the
 * campaign and its arcs) are the spine tile, and nodes outside the forest
 * entirely (NPCs, factions, items, clues, stat blocks, weather) are grouped by
 * kind into grid tiles.
 */
export function assignTiles(campaign: Campaign): readonly Tile[] {
  const parents = containsParents(campaign.edges);
  const byId = new Map(campaign.nodes.map((node) => [node.id, node]));
  const roots = new Set(campaign.nodes.filter(isTileRoot).map((node) => node.id));

  /** The tile root a node belongs to, or null for the spine and the residue. */
  const tileRootOf = (id: string): string | null => {
    let current: string | undefined = id;
    // Bounded by the forest's depth, which the dataset caps well under ten. A
    // visited set rather than a trusted bound, because a cycle here would hang
    // the page rather than fail a test.
    const seen = new Set<string>();
    while (current !== undefined) {
      if (roots.has(current)) return current;
      if (seen.has(current)) {
        throw new RangeError(`the contains chain through ${id} loops at ${current}`);
      }
      seen.add(current);
      current = parents.get(current);
    }
    return null;
  };

  const members = new Map<string, string[]>();
  const spine: string[] = [];
  const residue = new Map<string, string[]>();

  for (const node of campaign.nodes) {
    const root = tileRootOf(node.id);
    if (root !== null) {
      const bucket = members.get(root);
      if (bucket === undefined) members.set(root, [node.id]);
      else bucket.push(node.id);
      continue;
    }
    // Above every root, or outside the forest. The distinction is whether
    // anything contains it: the campaign and its arcs are the spine's own
    // structure, and a stat block is not part of any structure at all.
    if (parents.has(node.id) || node.data.kind === 'campaign' || node.data.kind === 'arc') {
      spine.push(node.id);
    } else {
      const bucket = residue.get(node.data.kind);
      if (bucket === undefined) residue.set(node.data.kind, [node.id]);
      else bucket.push(node.id);
    }
  }

  const tiles: Tile[] = [];
  if (spine.length > 0) {
    tiles.push({ id: 'spine', kind: 'layout', title: 'the spine', nodeIds: spine });
  }
  for (const [root, nodeIds] of members) {
    tiles.push({
      id: root,
      kind: 'layout',
      title: byId.get(root)?.name ?? root,
      nodeIds,
    });
  }
  for (const [kind, nodeIds] of residue) {
    tiles.push({ id: `all-${kind}`, kind: 'grid', title: pluralise(kind), nodeIds });
  }
  return tiles;
}

/** A kind as a tile title: `quest_step` reads as "quest steps". */
function pluralise(kind: string): string {
  const words = kind.replace(/_/g, ' ');
  return words.endsWith('s') ? words : `${words}s`;
}

/** A tile with a measured size, ready to be packed. */
export interface TileBox {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** Where a tile ended up, as a top-left corner in the packing's own y-down space. */
export interface PackedTile extends TileBox {
  readonly x: number;
  readonly y: number;
}

/** Everything {@link shelfPack} produces: the placements and the extent they fill. */
export interface Packing {
  readonly tiles: readonly PackedTile[];
  readonly width: number;
  readonly height: number;
}

/**
 * Every gap in the campaign's drawing, from the two `@dagr/layout` separations
 * the rest are derived from.
 *
 * Four numbers rather than one, because they are read by three different pieces
 * of arithmetic (a Sugiyama pass, the shelf packer, a grid) and the ratios
 * between them are what makes a tile read as a figure. Derived rather than
 * written down four times, so raising the node gap carries the tile gutter and
 * the grid with it and no ratio can drift.
 *
 * `@dagr/layout`'s third separation, `edgeSep`, is deliberately NOT here and
 * stays at the package default. It is the gap between two ROUTES sharing a rank
 * gap, so it decides how a bundle of parallel edges fans rather than how two
 * nodes sit, and D2's direction is about the nodes. Raising it is a separate
 * measurement, and the frame to take it against is a dense tile at reading zoom
 * rather than the fitted view.
 */
export interface CampaignSpacing {
  /** Between two nodes in the same rank, in world units. `@dagr/layout`'s `nodeSep`. */
  readonly nodeSep: number;
  /** Between two ranks, in world units. `@dagr/layout`'s `rankSep`. */
  readonly rankSep: number;
  /** Between two packed tiles. See {@link TILE_GUTTER_RATIO}. */
  readonly tileGutter: number;
  /** Between two cells of a grid tile, which is the node gap: a grid IS a rank. */
  readonly gridGap: number;
}

/**
 * How much wider a tile gutter is than the gap between two nodes inside a tile.
 *
 * Four, so two adjacent tiles read as two figures rather than one. The rule is
 * the ratio and not the number: a gutter at or under the node gap would put a
 * tile boundary closer than two nodes in the same tile, so whatever the node gap
 * becomes, the gutter has to clear it by enough that the eye groups the tile
 * before it groups the row.
 */
export const TILE_GUTTER_RATIO = 4;

/** The four gaps that follow from the two separations. See {@link CampaignSpacing}. */
export function campaignSpacing(nodeSep: number, rankSep: number): CampaignSpacing {
  return { nodeSep, rankSep, tileGutter: nodeSep * TILE_GUTTER_RATIO, gridGap: nodeSep };
}

/**
 * The campaign's own separations, which are not `@dagr/layout`'s defaults.
 *
 * `@dagr/layout` defaults to 50 and 50, which is right for a graph of a few
 * dozen boxes read at a zoom where a box is a box. The campaign is 3,010 nodes
 * that a reader meets fitted into one viewport and then zooms into, and at both
 * ends 50 was too tight: the tiles fuse into slabs of ink at the far view, and
 * at a reading zoom a site's rooms sit closer to each other than their own
 * labels are wide.
 *
 * **Measured rather than picked, on the demo's own 1102 by 598 stage**, by
 * building the whole scene at each candidate. `roomPx` is a 56 unit room at the
 * fitted zoom, `gapPx` is the in-rank gap at the same zoom, and `ink` is the
 * share of the viewport the edges cover there, which is centreline times the
 * width the alpha ramp holds them to:
 *
 * | nodeSep / rankSep | scene | fitted zoom | roomPx | gapPx | centreline | ink |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | 50 / 50 | 18050 x 10474 | 0.0514 | 2.88 | 2.57 | 21.1M | 25.4% |
 * | 100 / 130 | 32736 x 17856 | 0.0301 | 1.69 | 3.01 | 39.0M | 16.1% |
 * | 120 / 160 | 38576 x 20332 | 0.0257 | 1.44 | 3.09 | 42.0M | 12.6% |
 * | 160 / 200 | 49288 x 27944 | 0.0193 | 1.08 | 3.08 | 62.0M | 10.5% |
 *
 * **The fitted view is where the trade is, and the table is why 120 is the
 * answer.** The zoom floor is derived from the scene extent (P2's limits), so a
 * scene that grows is drawn smaller: the gap in PIXELS barely moves, because
 * both the gap and the floor scale together, and what actually improves is the
 * gap against the node, from 0.89 of a room's width to 2.1 of it. Past 120 even
 * that stops: the gap in pixels is already within 3% of its plateau at 100, and
 * every step after it spends node size on nothing. What DOES keep improving is
 * the ink, halved from a quarter of the viewport to an eighth, because
 * centreline grows linearly with the separations while the floor falls with them
 * and the coverage goes as its square. That is what makes the far view read as
 * structure rather than as a mat, and it is why 120 beats 100 at the same gap.
 *
 * **What it costs, stated rather than implied.** A room at the fitted zoom goes
 * from 2.88 pixels wide to 1.44, so the smallest kinds are dots in the overview
 * where they were small boxes. The zoom range widens from 374x to 748x, which is
 * more scrolling between the overview and a card. Both are the price of a scene
 * that is twice as wide in world units, and both are the reason the tiles are
 * tiles: a reader gets at the detail by framing one, not by zooming from orbit.
 *
 * **Ranks are separated a third more than nodes**, and the asymmetry is the one
 * number here that is not from the table: the rank gap is where the routed edges
 * live, so it carries a ribbon, its two attachments and whatever dummies the
 * order stage put between them, while the in-rank gap carries background. Equal
 * separations spend the same room on a gap that has something in it and one that
 * does not.
 *
 * One thing it improves for free: `@dagr/render`'s ribbon geometry inverts a
 * quad when a segment on screen is shorter than about `3.46 * (halfWidth + 1)`
 * pixels, which at the fitted view's floor width is 5.2. A rank step was 2.6
 * pixels there and is now 4.1, so the hairpin corners that could bow-tie are
 * fewer. It does not close the case, and M4.5's record already says the fix for
 * that is a per-vertex cap rather than a separation.
 */
export const CAMPAIGN_SPACING: CampaignSpacing = campaignSpacing(120, 160);

/**
 * The gap between two tiles, in world units: {@link CAMPAIGN_SPACING}'s.
 *
 * Kept as its own export because it is what `shelfPack` defaults to, and a
 * packer given no spacing at all should still pack the campaign's way.
 */
export const TILE_GUTTER = CAMPAIGN_SPACING.tileGutter;

/**
 * The aspect the packing aims for, width over height.
 *
 * 16:9, because that is the shape of the viewport it will be fitted into, and a
 * packing whose aspect matches its viewport wastes the least of it: fitting a
 * 4:1 drawing into a 16:9 frame leaves the top and bottom empty, and fitting a
 * 1:1 one leaves the sides.
 */
export const TARGET_ASPECT = 16 / 9;

/**
 * Packs tiles into shelves: rows filled left to right, a new row when the
 * current one is full.
 *
 * **Sorted by height, tallest first**, which is what makes shelf packing worth
 * the fifteen lines. Each shelf's height is its tallest member's, so a shelf
 * that mixes a 2,000 unit tile with a 200 unit one wastes 1,800 units under the
 * short one; sorting groups tiles of similar height together and the waste
 * collapses. Ties break on the tile id, so the packing is a pure function of its
 * input and a screenshot is reproducible.
 *
 * The shelf WIDTH is searched rather than computed, and the reason is in the
 * body: the obvious `sqrt(totalArea * aspect)` ignores the space a shelf wastes
 * under its short members, and on a hundred tiles of mixed height it produced a
 * nearly square packing against a 16:9 target.
 *
 * What this is NOT is an optimal packer. Optimal rectangle packing is NP-hard,
 * the input here is a hundred tiles laid out once at startup, and the difference
 * between this and optimal is some background nobody is looking at.
 */
export function shelfPack(
  boxes: readonly TileBox[],
  options: { readonly gutter?: number; readonly aspect?: number } = {},
): Packing {
  const gutter = options.gutter ?? TILE_GUTTER;
  const aspect = options.aspect ?? TARGET_ASPECT;
  if (boxes.length === 0) return { tiles: [], width: 0, height: 0 };
  for (const box of boxes) {
    if (!(box.width > 0) || !(box.height > 0)) {
      throw new RangeError(
        `tile ${box.id} has to have a positive area, got ${String(box.width)} by ${String(box.height)}`,
      );
    }
  }

  // Sorted once, outside the search below. Ties break on the tile id, so the
  // packing is a pure function of its input and a screenshot is reproducible.
  const sorted = [...boxes].sort((a, b) => b.height - a.height || (a.id < b.id ? -1 : 1));

  // **The shelf width is SEARCHED, not computed, and the first version computed
  // it.** `sqrt(totalArea * aspect)` is the width a packing of exactly the tile
  // areas would need, and a shelf packing is not that: each shelf is as tall as
  // its tallest member, so the height it actually reaches is the sum of those
  // maxima plus the gutters, which on a hundred tiles of mixed height came out
  // nearly SQUARE against a 16:9 target. The area estimate is still the right
  // place to start; it is the wrong place to stop.
  //
  // Bisection on the width, because the packed aspect is monotonic in it: a
  // wider shelf fits more per row, which lowers the height and raises the
  // aspect. Forty iterations of a bisection over a hundred tiles is arithmetic
  // nobody will notice at startup, and it converges to within a fraction of a
  // percent of the target.
  const widest = Math.max(...boxes.map((box) => box.width));
  const total = boxes.reduce((sum, box) => sum + box.width + gutter, 0);
  let low = widest;
  let high = Math.max(widest, total);
  let best = layShelves(sorted, high, gutter);
  for (let step = 0; step < 40 && high - low > 1; step += 1) {
    const middle = (low + high) / 2;
    const packing = layShelves(sorted, middle, gutter);
    const packedAspect = packing.width / packing.height;
    if (packedAspect > aspect) high = middle;
    else low = middle;
    if (
      Math.abs(Math.log(packedAspect / aspect)) <
      Math.abs(Math.log(best.width / best.height / aspect))
    ) {
      best = packing;
    }
  }
  return best;
}

/** One pass of the shelf algorithm at a fixed width: the part the search calls. */
function layShelves(
  sorted: readonly TileBox[],
  shelfWidth: number,
  gutter: number,
): Packing {
  const placed: PackedTile[] = [];
  let shelfTop = 0;
  let shelfHeight = 0;
  let cursor = 0;

  for (const box of sorted) {
    // A shelf that already holds something and would overflow starts a new one.
    // The `cursor > 0` guard is what lets a tile wider than the target width
    // have a shelf to itself rather than starting an empty new one for ever.
    if (cursor > 0 && cursor + box.width > shelfWidth) {
      shelfTop += shelfHeight + gutter;
      shelfHeight = 0;
      cursor = 0;
    }
    placed.push({ ...box, x: cursor, y: shelfTop });
    cursor += box.width + gutter;
    shelfHeight = Math.max(shelfHeight, box.height);
  }

  const width = placed.reduce((max, tile) => Math.max(max, tile.x + tile.width), 0);
  const height = placed.reduce((max, tile) => Math.max(max, tile.y + tile.height), 0);
  return { tiles: placed, width, height };
}

/**
 * Where each of `count` nodes goes in a near-square grid, as centres in the
 * grid's own y-down space with its top-left corner at the origin.
 *
 * For the tiles with no routed edges at all. Near-square rather than square,
 * because the packer above works best on tiles that are not extreme: a column of
 * 550 NPCs is the ribbon problem in miniature. The column count is
 * `ceil(sqrt(count * aspect / nodeAspect))` so the GRID comes out near the
 * target aspect whatever shape its nodes are, which a plain `ceil(sqrt(count))`
 * does not: 550 circles at 48 across in 24 columns is a square of circles, and
 * 550 items at 56 by 28 in 24 columns is a block twice as wide as it is tall.
 */
export function gridPositions(
  count: number,
  nodeSize: Size,
  options: { readonly gap?: number; readonly aspect?: number } = {},
): { readonly positions: readonly { x: number; y: number }[]; readonly size: Size } {
  if (count <= 0) return { positions: [], size: { width: 0, height: 0 } };
  const gap = options.gap ?? CAMPAIGN_SPACING.gridGap;
  const aspect = options.aspect ?? TARGET_ASPECT;
  const cellWidth = nodeSize.width + gap;
  const cellHeight = nodeSize.height + gap;
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * aspect * cellHeight) / cellWidth)));
  const rows = Math.ceil(count / columns);

  const positions = Array.from({ length: count }, (_, index) => ({
    x: (index % columns) * cellWidth + nodeSize.width / 2,
    y: Math.floor(index / columns) * cellHeight + nodeSize.height / 2,
  }));
  return {
    positions,
    size: {
      width: Math.min(count, columns) * cellWidth - gap,
      height: rows * cellHeight - gap,
    },
  };
}
