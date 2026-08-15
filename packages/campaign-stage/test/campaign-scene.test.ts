import { generateCampaign } from '@dagr/campaign';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCampaignScene } from '../src/campaign-scene.js';
import type { CampaignScene } from '../src/campaign-scene.js';
import { SMALLEST_NODE_SIZE, styleFor } from '../src/campaign-style.js';
import { isRouted } from '../src/tiles.js';

/**
 * The whole scene, built once and asserted from every angle.
 *
 * **This runs the real layout, on this thread.** `createLayout` without a bound
 * worker runs the pipeline synchronously and resolves, which is exactly the
 * fallback `@dagr/layout` documents, so a hundred Sugiyama passes over the real
 * campaign are reachable from a bare Node suite. That is worth the couple of
 * seconds it costs: everything below is a property of the composition (the
 * packing, the offsets, the y flip) that no unit test of `tiles.ts` can see and
 * that a screenshot can only fail to notice.
 *
 * The one claim it cannot make is that any of it reaches a GPU.
 */

describe('the campaign scene', () => {
  let scene: CampaignScene;
  const campaign = generateCampaign();

  beforeAll(async () => {
    scene = await buildCampaignScene(campaign);
  }, 60_000);

  it('draws every node in the campaign, exactly once', () => {
    expect(scene.nodes).toHaveLength(campaign.nodes.length);
    expect(new Set(scene.nodes.map((node) => node.id)).size).toBe(campaign.nodes.length);
    expect(scene.nodeBounds.size).toBe(campaign.nodes.length);
    expect(scene.overlayNodes).toHaveLength(campaign.nodes.length);
  });

  it('gives every node the size and shape its kind declares', () => {
    // The table has three readers (layout, the renderer, the overlay) and this
    // is the one that would catch them disagreeing: a node laid out at one size
    // and drawn at another overlaps its neighbours in a picture whose layout
    // says it does not.
    const byId = new Map(campaign.nodes.map((node) => [node.id, node]));
    for (const node of scene.nodes) {
      const source = byId.get(node.id);
      if (source === undefined) throw new Error('unreachable');
      const style = styleFor(
        source.data.kind,
        source.data.kind === 'location' ? source.data.subtype : undefined,
      );
      expect(node.shape).toBe(style.shape);
      expect(node.size).toEqual(style.size);
    }
  });

  it('agrees with itself about where a node is, across all three views', () => {
    const overlayById = new Map(scene.overlayNodes.map((node) => [node.id, node]));
    for (const node of scene.nodes) {
      const bounds = scene.nodeBounds.get(node.id);
      const overlay = overlayById.get(node.id);
      if (bounds === undefined || overlay === undefined) throw new Error('unreachable');
      expect(bounds).toEqual(overlay.bounds);
      expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(node.center.x, 9);
      expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(node.center.y, 9);
      expect(bounds.maxX - bounds.minX).toBeCloseTo(node.size.width, 9);
      expect(bounds.maxY - bounds.minY).toBeCloseTo(node.size.height, 9);
    }
  });

  it('reports bounds that contain every node it placed', () => {
    // What the camera fits on load. A node outside it is a node a reader cannot
    // reach by pressing 0, and the zoom floor would be wrong by however far out
    // it sat.
    for (const bounds of scene.nodeBounds.values()) {
      expect(bounds.minX).toBeGreaterThanOrEqual(scene.bounds.minX);
      expect(bounds.maxX).toBeLessThanOrEqual(scene.bounds.maxX);
      expect(bounds.minY).toBeGreaterThanOrEqual(scene.bounds.minY);
      expect(bounds.maxY).toBeLessThanOrEqual(scene.bounds.maxY);
    }
    expect(scene.bounds.minX).toBeLessThan(scene.bounds.maxX);
    expect(scene.bounds.minY).toBeLessThan(scene.bounds.maxY);
  });

  it('keeps every node inside its own tile, which is what makes a tile a tile', () => {
    for (const tile of scene.tiles) {
      for (const id of tile.nodeIds) {
        const bounds = scene.nodeBounds.get(id);
        if (bounds === undefined) throw new Error(`unreachable: ${id} was not drawn`);
        expect(bounds.minX).toBeGreaterThanOrEqual(tile.bounds.minX - 1e-6);
        expect(bounds.maxX).toBeLessThanOrEqual(tile.bounds.maxX + 1e-6);
        expect(bounds.minY).toBeGreaterThanOrEqual(tile.bounds.minY - 1e-6);
        expect(bounds.maxY).toBeLessThanOrEqual(tile.bounds.maxY + 1e-6);
      }
    }
  });

  it('never overlaps two tiles in world space, after the packing and the flip', () => {
    // The packer's own test asserts this in packing space. This asserts it
    // survived the offsets and the sign change, which is the step that would
    // turn a correct packing into a pile.
    for (let i = 0; i < scene.tiles.length; i += 1) {
      for (let j = i + 1; j < scene.tiles.length; j += 1) {
        const a = scene.tiles[i];
        const b = scene.tiles[j];
        if (a === undefined || b === undefined) throw new Error('unreachable');
        const apart =
          a.bounds.maxX <= b.bounds.minX + 1e-9 ||
          b.bounds.maxX <= a.bounds.minX + 1e-9 ||
          a.bounds.maxY <= b.bounds.minY + 1e-9 ||
          b.bounds.maxY <= a.bounds.minY + 1e-9;
        expect(apart).toBe(true);
      }
    }
  });

  it('ROUTES A ROUTE THROUGH THE SAME FLIP AS ITS ENDPOINTS', () => {
    // The correctness the ribbons session named, and the reason it is worth a
    // test rather than a comment: a route flipped differently from its endpoints
    // still STARTS AND ENDS near the right nodes, because the endpoints are on
    // the node boxes either way, and only bulges the wrong way in between. That
    // reads as a routing bug and would be looked for in `@dagr/layout`.
    //
    // So the assertion is on the whole polyline: every point of every route sits
    // inside the tile its edge belongs to. A y flip applied to the nodes and not
    // the routes would put a route's middle outside its tile, mirrored about the
    // tile's own top edge.
    const tileOf = new Map<string, (typeof scene.tiles)[number]>();
    for (const tile of scene.tiles) for (const id of tile.nodeIds) tileOf.set(id, tile);

    const byEdgeId = new Map(campaign.edges.map((edge) => [edge.id, edge]));
    expect(scene.edgeRoutes.size).toBeGreaterThan(1000);

    for (const [edgeId, points] of scene.edgeRoutes) {
      const edge = byEdgeId.get(edgeId);
      if (edge === undefined) throw new Error(`unreachable: ${edgeId} is not a campaign edge`);
      expect(isRouted(edge)).toBe(true);
      const tile = tileOf.get(edge.source);
      expect(tile).toBeDefined();
      expect(tileOf.get(edge.target)).toBe(tile);
      if (tile === undefined) throw new Error('unreachable');
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(tile.bounds.minX - 1e-6);
        expect(point.x).toBeLessThanOrEqual(tile.bounds.maxX + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(tile.bounds.minY - 1e-6);
        expect(point.y).toBeLessThanOrEqual(tile.bounds.maxY + 1e-6);
      }
    }
  });

  it('starts and ends every route on the boxes of the nodes it names', () => {
    // The endpoints, separately from the polyline above, because they are what a
    // ribbon attaches to and because the pair of assertions is what distinguishes
    // a sign error from a routing one: this passes and the previous one fails
    // when only the routes are flipped wrongly.
    for (const [edgeId, points] of scene.edgeRoutes) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first === undefined || last === undefined) throw new Error('unreachable');
      const edge = campaign.edges.find((candidate) => candidate.id === edgeId);
      if (edge === undefined) throw new Error('unreachable');
      const source = scene.nodeBounds.get(edge.source);
      const target = scene.nodeBounds.get(edge.target);
      if (source === undefined || target === undefined) throw new Error('unreachable');
      // On the box, not at its centre: `@dagr/layout` attaches a route to the
      // border it leaves from as of M2.8.
      expect(first.x).toBeGreaterThanOrEqual(source.minX - 1e-6);
      expect(first.x).toBeLessThanOrEqual(source.maxX + 1e-6);
      expect(first.y).toBeGreaterThanOrEqual(source.minY - 1e-6);
      expect(first.y).toBeLessThanOrEqual(source.maxY + 1e-6);
      expect(last.x).toBeGreaterThanOrEqual(target.minX - 1e-6);
      expect(last.x).toBeLessThanOrEqual(target.maxX + 1e-6);
      expect(last.y).toBeGreaterThanOrEqual(target.minY - 1e-6);
      expect(last.y).toBeLessThanOrEqual(target.maxY + 1e-6);
    }
  });

  it('leaves the cross-tile edges unrouted, because no pass ever saw them', () => {
    // The other half of the routes claim. A routed edge whose ends are in
    // different tiles was never in any layout's graph, so there is no polyline
    // for it and there should not be one: P5 draws those against the tile
    // placements instead.
    const tileOf = new Map<string, string>();
    for (const tile of scene.tiles) for (const id of tile.nodeIds) tileOf.set(id, tile.id);
    const crossing = campaign.edges
      .filter(isRouted)
      .filter((edge) => tileOf.get(edge.source) !== tileOf.get(edge.target));
    expect(crossing.length).toBeGreaterThan(0);
    for (const edge of crossing) {
      expect(scene.edgeRoutes.has(edge.id)).toBe(false);
    }
  });

  it('runs one layout per layout tile and none for a grid tile', () => {
    expect(scene.layoutRuns).toBe(scene.tiles.filter((tile) => tile.kind === 'layout').length);
    expect(scene.tiles.some((tile) => tile.kind === 'grid')).toBe(true);
  });

  it('packs to something near 16:9, which is what the camera fits into', () => {
    const aspect =
      (scene.bounds.maxX - scene.bounds.minX) / (scene.bounds.maxY - scene.bounds.minY);
    expect(aspect).toBeGreaterThan(1.2);
    expect(aspect).toBeLessThan(2.5);
  });

  it('reports the smallest node the zoom-in limit will frame', () => {
    expect(scene.smallestNodeSize).toEqual(SMALLEST_NODE_SIZE);
    for (const node of scene.nodes) {
      expect(node.size.width * node.size.height).toBeGreaterThanOrEqual(
        SMALLEST_NODE_SIZE.width * SMALLEST_NODE_SIZE.height,
      );
    }
  });

  it('centres the campaign on the origin, so the default camera looks at it', () => {
    expect(scene.bounds.minX).toBeCloseTo(-scene.bounds.maxX, 9);
    expect(scene.bounds.minY).toBeCloseTo(-scene.bounds.maxY, 9);
  });
});
