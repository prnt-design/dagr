import { Graph } from '@dagr/graph';
import { createLayout } from '@dagr/layout';
import type { LayoutPort } from '@dagr/layout';
import type { Campaign, CampaignNode } from '@dagr/campaign';
import type { SceneNode, Size, Vec2, WorldBounds } from '@dagr/render';
import { SMALLEST_NODE_SIZE, glowReach, styleFor } from './campaign-style.js';
import { assignTiles, gridPositions, isRouted, shelfPack } from './tiles.js';
import type { Tile, TileKind } from './tiles.js';

/**
 * The campaign, laid out and packed into one scene the renderer can take.
 *
 * This is P4's orchestration and the only file in the demo that knows about all
 * four of `@dagr/campaign`, `@dagr/graph`, `@dagr/layout` and `@dagr/render` at
 * once. Everything decidable without them is in `tiles.ts` and
 * `campaign-style.ts` and is tested there; what is left here is the sequence,
 * the worker, and one coordinate conversion that is worth reading twice.
 *
 * ## THE Y FLIP, which M4.4 owns and which is silent when it is wrong
 *
 * `@dagr/layout` computes in y-DOWN coordinates: its `PositionedNode.y` grows
 * toward the bottom of the drawing, and its `Rect` is a top-left corner and a
 * size. `Camera2D` is y-UP. `camera.ts` has said since M4.1 that converting
 * between them is the business of whatever feeds a layout result to a scene,
 * which is this file, and `@dagr/render`'s `WorldBounds` is deliberately shaped
 * so a layout rectangle cannot be assigned into a world one by accident.
 *
 * The conversion happens ONCE, in {@link toWorld}, at the very end. Everything
 * before it (a tile's own layout, the shelf packing, a grid) stays in y-down
 * space, so there is exactly one line where the sign changes and one place to
 * look when the drawing comes out mirrored. Flipping per tile instead would be
 * four sign changes and three chances to get one wrong, and the symptom of a
 * missed one is a tile whose contents are upside down inside a picture that is
 * otherwise right, which reads as a layout bug rather than a sign bug.
 */

/** Where a tile ended up in the world, for a caller drawing between tiles. */
export interface CampaignTilePlacement {
  readonly id: string;
  readonly title: string;
  readonly kind: TileKind;
  /** The tile's extent in WORLD space, y up, after packing. */
  readonly bounds: WorldBounds;
  readonly nodeIds: readonly string[];
}

/**
 * One node as an OVERLAY tier binds to it: an id, a world box, and the two
 * facts a label or a card puts on screen without going back to the dataset.
 *
 * The shape `createRichNodes` wants (`{id, bounds, data}`) with the data half
 * filled in, so a tier maps rather than joins. P6 replaces `data` with the
 * campaign's card rows and keeps the id and the bounds, which is why those two
 * are the part this record promises not to change.
 *
 * There is no `color` here, and there was. P4 carried the kind's colour as a
 * CSS string for the tier to assign, and P6's tiers call `nodeColor` themselves
 * instead, because the tier module takes the palette as a parameter rather than
 * reading a value off its data. That left the field with no reader and 3,010
 * eager palette calls per scene build, so it went with its last consumer.
 */
export interface CampaignOverlayNode {
  readonly id: string;
  /** The node's box in WORLD space, y up. */
  readonly bounds: WorldBounds;
  /**
   * The campaign record itself, which is what a card tier reads: `cardRows`
   * takes one, and a title takes its `name`.
   *
   * Carried rather than looked up by id, and NOT unpacked into a `name` and a
   * `kind` beside it. This module already holds the record at the moment it
   * builds this one, so carrying it costs a reference; the alternative is a
   * second id-keyed lookup in whatever renders the card, which is the
   * disagreement that building `nodeBounds` and this list in ONE pass exists to
   * prevent. Copying two of its fields out would be the same duplication in
   * miniature.
   */
  readonly node: CampaignNode;
}

/** Everything the demo needs from one build of the campaign. */
export interface CampaignScene {
  /** Every node, positioned and styled, ready for `Renderer.setNodes`. */
  readonly nodes: readonly SceneNode[];
  /**
   * Each node's box in WORLD space, y up, keyed by node id.
   *
   * The shape the HTML overlay wants: `createRichNodes` takes `{id, bounds,
   * data}`, so a card binds to this map rather than re-deriving a box from a
   * centre and a size and getting the y sign wrong a second time.
   */
  readonly nodeBounds: ReadonlyMap<string, WorldBounds>;
  /**
   * The same nodes as {@link CampaignOverlayNode}s, in the order they were
   * drawn: what an overlay tier iterates. Built in the same pass as
   * {@link nodeBounds}, so the two cannot disagree about where a node is.
   */
  readonly overlayNodes: readonly CampaignOverlayNode[];
  /** Where each tile sits, for cross-tile edges (P5) and for a tile label. */
  readonly tiles: readonly CampaignTilePlacement[];
  /**
   * One polyline per routed edge whose two ends share a tile, keyed by the
   * campaign's own edge id, in WORLD space with y up.
   *
   * What M4.5 tessellates. Kept from the layout pass rather than recovered
   * later, because recovering it means running a hundred layouts again, and
   * carried through the SAME `toWorld` the node boxes go through: a route
   * flipped differently from its endpoints still starts and ends near the right
   * nodes and only bulges the wrong way in between, which reads as a routing bug
   * rather than as a sign bug.
   *
   * A routed edge whose ends are in DIFFERENT tiles is not here and never was
   * routed: the Sugiyama pipeline only ever sees one tile. Those are the
   * cross-tile lines, drawn against {@link tiles}.
   */
  readonly edgeRoutes: ReadonlyMap<string, readonly Vec2[]>;
  /** The whole scene's extent, which is what the camera fits on load. */
  readonly bounds: WorldBounds;
  /** The smallest box any node is drawn in, which the zoom-in limit frames. */
  readonly smallestNodeSize: Size;
  /** How many layout runs the tiling cost, for the readout. */
  readonly layoutRuns: number;
}

/** A node's position and size inside its own tile, in the tile's y-down space. */
interface LocalPlacement {
  readonly x: number;
  readonly y: number;
  readonly size: Size;
}

/** One tile once its contents have positions: placements, routes and an extent. */
interface LaidTile {
  readonly tile: Tile;
  readonly placements: ReadonlyMap<string, LocalPlacement>;
  /** One polyline per routed edge INSIDE the tile, in the tile's y-down space. */
  readonly routes: ReadonlyMap<string, readonly Vec2[]>;
  readonly size: Size;
}

/** A node's drawn size, which is also the size layout is told about. */
function sizeOf(node: CampaignNode): Size {
  return styleFor(node.data.kind, node.data.kind === 'location' ? node.data.subtype : undefined)
    .size;
}

/**
 * Lays out one tile through `@dagr/layout`, in the worker when there is one.
 *
 * A graph per tile rather than one graph filtered per run, because layout takes
 * a graph and a tile's edges are the routed edges with BOTH ends inside it. An
 * edge leaving the tile is not this tile's business and is not the next tile's
 * either: it is a cross-tile line, which P5 draws against
 * {@link CampaignTilePlacement}.
 */
async function layoutTile(
  tile: Tile,
  byId: ReadonlyMap<string, CampaignNode>,
  campaign: Campaign,
  engine: ReturnType<typeof createLayout>,
): Promise<LaidTile> {
  const members = new Set(tile.nodeIds);
  const graph = new Graph<{ node: CampaignNode }>();
  for (const id of tile.nodeIds) {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`unreachable: tile ${tile.id} names a missing node`);
    graph.addNode({ id, attrs: { node } });
  }
  for (const edge of campaign.edges) {
    if (!isRouted(edge)) continue;
    if (!members.has(edge.source) || !members.has(edge.target)) continue;
    graph.addEdge({ id: edge.id, source: edge.source, target: edge.target });
  }

  const result = await engine.runAsync(graph);
  const placements = new Map<string, LocalPlacement>();
  for (const [id, node] of result.nodes) {
    // Relative to the tile's own top-left, so the packer can place the tile as
    // one box. `bounds` includes route points as well as node boxes, which is
    // what makes it the tile's extent rather than the union of its nodes.
    placements.set(id, {
      x: node.x - result.bounds.x,
      y: node.y - result.bounds.y,
      size: { width: node.width, height: node.height },
    });
  }

  // **The routes are kept, and translated by the SAME corner the nodes are.**
  // They are M4.5's entire input, and re-running a hundred layouts to recover
  // what this pass already computed is not an option. Every point rides the one
  // y flip in `toWorld` with the node boxes, which is the correctness that
  // matters: a route flipped differently from its endpoints reads as a ROUTING
  // bug rather than as a sign bug, because the line still starts and ends near
  // the right nodes and only bulges the wrong way in between.
  const routes = new Map<string, readonly Vec2[]>();
  for (const [id, edge] of result.edges) {
    routes.set(
      id,
      edge.points.map((point) => ({
        x: point.x - result.bounds.x,
        y: point.y - result.bounds.y,
      })),
    );
  }

  return {
    tile,
    placements,
    routes,
    size: { width: result.bounds.width, height: result.bounds.height },
  };
}

/**
 * Arranges a tile with no routed edges into a near-square grid.
 *
 * Sized from the first member, because a grid tile is one KIND (see
 * `assignTiles`) and a kind is one size. The one exception the schema allows is
 * `location`, whose four subtypes are four sizes, and a location is never in a
 * grid tile: every location is inside a region tile.
 */
function gridTile(tile: Tile, byId: ReadonlyMap<string, CampaignNode>): LaidTile {
  const first = byId.get(tile.nodeIds[0] ?? '');
  if (first === undefined) throw new Error(`unreachable: empty grid tile ${tile.id}`);
  const nodeSize = sizeOf(first);
  // CHECKED rather than assumed, because the assumption is about the DATASET
  // and not about this file: a grid tile is one kind (see `assignTiles`) and a
  // kind is one size, except `location`, whose four subtypes are four sizes and
  // which never reaches a grid tile only because every non-region location has a
  // contains chain up to a region. If the generator ever emits one outside that
  // forest, the whole tile would be laid out AND drawn at the first member's
  // size, which is silently overlapping and mis-sized nodes that no test in
  // either package could see.
  for (const id of tile.nodeIds) {
    const member = byId.get(id);
    if (member === undefined) throw new Error(`unreachable: tile ${tile.id} names a missing node`);
    const size = sizeOf(member);
    if (size.width !== nodeSize.width || size.height !== nodeSize.height) {
      throw new RangeError(
        `grid tile ${tile.id} holds two sizes (${id} is ${String(size.width)} by ${String(size.height)}, ${first.id} is ${String(nodeSize.width)} by ${String(nodeSize.height)}), so a grid cannot size its cells`,
      );
    }
  }
  const { positions, size } = gridPositions(tile.nodeIds.length, nodeSize);
  const placements = new Map<string, LocalPlacement>();
  tile.nodeIds.forEach((id, index) => {
    const position = positions[index];
    if (position === undefined) throw new Error('unreachable: one position per node');
    placements.set(id, { x: position.x, y: position.y, size: nodeSize });
  });
  // No routes: a grid tile is the tiles with no routed edge among their own
  // members, which is why it is a grid at all. An empty map rather than an
  // absent field, so a consumer iterating every tile's routes needs no branch.
  return { tile, placements, routes: new Map(), size };
}

/**
 * Builds the whole scene: tile, lay out, pack, convert.
 *
 * The layout runs go through `runAsync` and therefore through the worker when
 * one is bound, which is the plan's "one `layout` call per tile" and is what
 * keeps a hundred Sugiyama passes off the main thread while the page is still
 * painting. They are started together rather than in sequence: the worker runs
 * them one at a time anyway (it is one thread), and the protocol matches answers
 * by request id, so `Promise.all` costs nothing and saves a hundred round trips
 * of latency.
 */
export async function buildCampaignScene(
  campaign: Campaign,
  options: { readonly worker?: LayoutPort } = {},
): Promise<CampaignScene> {
  const byId = new Map(campaign.nodes.map((node) => [node.id, node]));
  const tiles = assignTiles(campaign);
  const engine = createLayout({
    ...(options.worker === undefined ? {} : { worker: options.worker }),
    config: {
      // The SAME table the renderer draws from. A node laid out at one size and
      // drawn at another overlaps its neighbours in a picture whose layout says
      // it does not, and neither half's tests can see it.
      nodeSize: (node) => {
        const campaignNode = (node.attrs as { node?: CampaignNode }).node;
        return campaignNode === undefined ? undefined : sizeOf(campaignNode);
      },
    },
  });

  const laid = await Promise.all(
    tiles.map(async (tile) =>
      tile.kind === 'grid'
        ? gridTile(tile, byId)
        : layoutTile(tile, byId, campaign, engine),
    ),
  );

  const packing = shelfPack(
    laid.map((entry) => ({ id: entry.tile.id, ...entry.size })),
    {},
  );
  const offsets = new Map(packing.tiles.map((tile) => [tile.id, tile]));

  // Centred on the origin, so the default camera is already looking at the
  // middle of the campaign before anything calls `fitBounds`. The alternative
  // (a corner at the origin) means the first frame after a mount, and any frame
  // where a fit has not landed yet, looks out at empty space.
  const halfWidth = packing.width / 2;
  const halfHeight = packing.height / 2;

  /** Packed y-down coordinates to world y-up ones. The ONE sign change. */
  const toWorld = (x: number, y: number): { x: number; y: number } => ({
    x: x - halfWidth,
    y: halfHeight - y,
  });

  const nodes: SceneNode[] = [];
  const nodeBounds = new Map<string, WorldBounds>();
  const overlayNodes: CampaignOverlayNode[] = [];
  const edgeRoutes = new Map<string, readonly Vec2[]>();
  const placedTiles: CampaignTilePlacement[] = [];

  for (const entry of laid) {
    const offset = offsets.get(entry.tile.id);
    if (offset === undefined) throw new Error(`unreachable: tile ${entry.tile.id} was not packed`);
    const topLeft = toWorld(offset.x, offset.y);
    const bottomRight = toWorld(offset.x + offset.width, offset.y + offset.height);
    placedTiles.push({
      id: entry.tile.id,
      title: entry.tile.title,
      kind: entry.tile.kind,
      // Extents, so the y flip is applied and then the pair is ordered, rather
      // than trusting that a flipped top is still a maximum.
      bounds: {
        minX: topLeft.x,
        minY: bottomRight.y,
        maxX: bottomRight.x,
        maxY: topLeft.y,
      },
      nodeIds: entry.tile.nodeIds,
    });

    // Through the same `toWorld` as the node boxes below, in the same pass, so
    // there is no second place for the sign to be got wrong.
    for (const [id, points] of entry.routes) {
      edgeRoutes.set(
        id,
        points.map((point) => toWorld(offset.x + point.x, offset.y + point.y)),
      );
    }

    for (const [id, placement] of entry.placements) {
      const node = byId.get(id);
      if (node === undefined) throw new Error(`unreachable: ${id} left the campaign`);
      const style = styleFor(
        node.data.kind,
        node.data.kind === 'location' ? node.data.subtype : undefined,
      );
      const center = toWorld(offset.x + placement.x, offset.y + placement.y);
      nodes.push({
        id,
        shape: style.shape,
        center,
        size: placement.size,
        cornerRadius: style.cornerRadius,
        fillColor: style.fillColor,
        glowColor: style.glowColor,
        glowWorld: glowReach(placement.size),
      });
      const bounds: WorldBounds = {
        minX: center.x - placement.size.width / 2,
        minY: center.y - placement.size.height / 2,
        maxX: center.x + placement.size.width / 2,
        maxY: center.y + placement.size.height / 2,
      };
      nodeBounds.set(id, bounds);
      overlayNodes.push({
        id,
        bounds,
        node,
      });
    }
  }

  return {
    nodes,
    nodeBounds,
    overlayNodes,
    edgeRoutes,
    tiles: placedTiles,
    bounds: {
      minX: -halfWidth,
      minY: -halfHeight,
      maxX: halfWidth,
      maxY: halfHeight,
    },
    smallestNodeSize: SMALLEST_NODE_SIZE,
    layoutRuns: laid.filter((entry) => entry.tile.kind === 'layout').length,
  };
}
