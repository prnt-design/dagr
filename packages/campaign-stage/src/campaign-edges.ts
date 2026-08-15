import { EDGE_ROLES } from '@dagr/campaign';
import type { Campaign, CampaignEdge, CampaignNode } from '@dagr/campaign';
import type { SceneEdge, SceneEdgeGroup } from '@dagr/render';
import type { CampaignScene } from './campaign-scene.js';
import { edgeInk, nodeFill } from './campaign-style.js';

/**
 * Which of the three ways an edge is drawn, and the geometry for the two that
 * a layout never saw.
 *
 * The campaign plan's split, made concrete. `@dagr/campaign` sorts every edge
 * kind into `routed` or `overlay` through `EDGE_ROLES`, and P4's tiling adds a
 * second cut across the first, because the Sugiyama pipeline only ever sees one
 * tile at a time:
 *
 * | group | what it is | geometry |
 * | --- | --- | --- |
 * | `routed` | a routed edge with both ends in ONE tile | the layout's own polyline, from `CampaignScene.edgeRoutes` |
 * | `crossTile` | a routed edge whose ends are in different tiles | a bowed line, drawn here |
 * | `overlay` | every `overlay` kind, wherever its ends are | a bowed line, drawn here |
 *
 * The first group is the one M4.5 was written for and the only one carrying a
 * layout's opinion about where an edge should go. The other two are lines
 * between two boxes and nothing more, which is the plan's point: clue, social,
 * reference and pressure edges are dense and cyclic, and feeding them to
 * crossing reduction buys nothing a viewer can read.
 *
 * **Why the last two are BOWED rather than straight.** Two nodes joined by more
 * than one overlay kind would otherwise draw the same segment twice, with the
 * second invisible under the first, and a viewer counting relationships would
 * count one. A bow proportional to the chord separates them the moment their
 * bows differ, and it costs one control point. It is also what makes an overlay
 * line legible where it crosses the tile it passes over: a straight chord
 * through a dense tile reads as a tile boundary, and a curve reads as a
 * connection.
 */

/** How far a bowed line's midpoint leaves the chord, as a fraction of the chord. */
export const DEFAULT_BOW = 0.12;

/**
 * What an edge is drawn in: the SOURCE NODE's own colour, dimmed to an ink.
 *
 * **The question a reader asks of an edge is where it came from**, which is what
 * D2's direction says and what two inks by role could not answer. Before this,
 * every routed edge in the campaign was one sky blue and every overlay edge one
 * cooler blue, so a line arriving at a room told a reader that it was a
 * hierarchy edge and nothing else: not which region it descends from, not
 * whether the quest step in front of them is fed by a faction or by a clue. The
 * source node's colour is the answer already on screen, because the palette is
 * by stratum: a ribbon out of a quest is quest green, out of a location is
 * location blue, and a reader traces provenance by hue across a tile they cannot
 * read the labels of.
 *
 * **The role split survives as the DASH**, not as a second colour, and that is
 * the whole of why both facts still reach a viewer. `EDGE_GROUPS` dashes the two
 * routed groups and leaves the overlay kinds solid, so hue says where a line is
 * from and pattern says what kind of relation it is. Colour cannot carry both:
 * sixteen kinds times two roles is thirty-two inks nobody can tell apart.
 *
 * The source and not the target, of a directed edge whose direction the dataset
 * fixes: `contains` runs parent to child, `leads_to` earlier to later. So a
 * dense node is a node many colours converge ON, which reads as an inbound
 * count, and the colours LEAVING it are all one, which is what makes a
 * provenance trace possible at all.
 *
 * A curried lookup rather than a plain function, because a colour now depends on
 * a node the edge only names. `campaignEdges` takes the function, so the demo
 * binds this once per campaign and the seam is unchanged.
 */
export function sourceEdgeColor(campaign: Campaign): (edge: CampaignEdge) => number {
  const byId = new Map<string, CampaignNode>(campaign.nodes.map((node) => [node.id, node]));
  return (edge) => {
    const source = byId.get(edge.source);
    // An edge whose source is not in the campaign is drawn in the neutral ink
    // rather than dropped: `campaignEdges` decides what is drawable from the
    // SCENE, which is the map that knows, and a colour function that threw here
    // would make a palette lookup the thing that fails on a dataset defect.
    return source === undefined ? UNSOURCED_INK : edgeInk(nodeFill(source));
  };
}

/**
 * The ink for an edge whose source node the campaign does not hold.
 *
 * The old routed ink, kept for exactly this: it is the colour the whole drawing
 * was before D2, so a line in it is visibly not the colour of anything.
 */
export const UNSOURCED_INK = 0x6ea8c7;

/** The routed group's id, and the first mesh drawn: everything else sits over it. */
export const ROUTED_GROUP = 'routed';
/** Routed edges that crossed a tile boundary and so were never routed. */
export const CROSS_TILE_GROUP = 'crossTile';
/** The dense, cyclic kinds the plan keeps out of layout entirely. */
export const OVERLAY_GROUP = 'overlay';

/**
 * The three groups, in DRAW ORDER, with the look that tells them apart.
 *
 * Order is the layering, since every mesh here is transparent with `depthWrite`
 * off: routed ribbons are the structure and go under, cross-tile lines join
 * tiles and go over them, and the overlay kinds go on top because they are the
 * ones a reader is looking for when they are visible at all.
 *
 * **The dash is now the ROLE, which is a job it did not have before D2.** It
 * dashed the routed group alone, on the argument that a dash shows the direction
 * a LAYOUT computed and that dashing a line this file drew between two boxes
 * would be decoration. Colour carried the role: one ink for the routed kinds,
 * another for the overlay kinds, across all three groups. D2 spent colour on
 * where an edge comes from, so the role has nowhere else to go, and the dash is
 * where it goes: the two routed-role groups are dashed and the overlay group is
 * solid. A cross-tile line is dashed for what it IS, a `contains` or a
 * `leads_to` that happened to cross a tile boundary, and its flow still runs
 * source to target because `bowedLine` builds it in that order.
 *
 * The two line groups take `'smooth'` because their three control points ARE a
 * curve waiting to happen; the routed group stays a polyline, because its bends
 * are where a layout put a dummy and rounding them off would be this file
 * second-guessing the crossing the order stage chose.
 */
export const EDGE_GROUPS: readonly SceneEdgeGroup[] = [
  {
    id: ROUTED_GROUP,
    style: {
      halfWidthPixels: 1.5,
      dash: { periodPixels: 14, duty: 0.55, speedPixelsPerSecond: 18 },
    },
  },
  {
    id: CROSS_TILE_GROUP,
    style: {
      halfWidthPixels: 1.2,
      // The same pattern as the routed group, because it is the same fact: a
      // second dash shape would read as a third kind of edge, and there are
      // two. The flow speed is shared for the same reason, so two halves of one
      // hierarchy that a tile boundary split do not march at different speeds.
      dash: { periodPixels: 14, duty: 0.55, speedPixelsPerSecond: 18 },
    },
    curve: 'smooth',
  },
  { id: OVERLAY_GROUP, style: { halfWidthPixels: 1 }, curve: 'smooth' },
];

/**
 * How visible the overlay kinds are at a given zoom: 0 below the band, 1 above
 * it, and a smooth ramp between.
 *
 * The plan's rule, as arithmetic. Clue, social, reference and pressure edges
 * are dense and cyclic, and drawing all of them at the fitted zoom is the
 * hairball the routed/overlay split exists to avoid; they become worth reading
 * once a viewer is close enough to be asking about one node's neighbourhood.
 *
 * A RAMP rather than a threshold because a hard switch at one zoom makes a
 * thousand lines appear between two frames of a pinch, which reads as a glitch
 * rather than as detail arriving.
 *
 * **The band is in CSS pixels per world unit, where every width in this demo is
 * in DEVICE pixels, and the two are deliberately different vocabularies.** How
 * crisply a line is drawn is a fact about the display's pixels; whether a KIND
 * of edge is worth showing is a fact about apparent scale. Keyed on device
 * pixels this band halves on a retina screen, and measured at CSS zoom 2 the
 * overlay alpha came out 0.20 at dpr 1 against 1.00 at dpr 2: the same campaign
 * at the same zoom showing its social graph on one display and hiding it on
 * another.
 */
export function overlayFade(cssPixelsPerWorldUnit: number, start: number, full: number): number {
  if (!(full > start)) {
    throw new RangeError(`overlayFade needs full above start, got ${String(start)} to ${String(full)}`);
  }
  const t = (cssPixelsPerWorldUnit - start) / (full - start);
  return Math.min(1, Math.max(0, t));
}

/** The three groups, each ready for `Renderer.setEdges`. */
export interface CampaignEdges {
  /** Routed edges with a layout polyline of their own. */
  readonly routed: readonly SceneEdge[];
  /** Routed edges whose ends fell in different tiles, as bowed lines. */
  readonly crossTile: readonly SceneEdge[];
  /** Every `overlay` kind, as bowed lines. */
  readonly overlay: readonly SceneEdge[];
}

/** A point, in world units. Structurally `@dagr/render`'s `Vec2`. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A world box, as extents. Structurally `@dagr/render`'s `WorldBounds`. */
interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The centre of a box. */
function centreOf(box: Box): Point {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/**
 * Where a line leaves the box around `centre` on its way to `toward`: the point
 * on the box's border, or the centre when the two coincide.
 *
 * The same parameterised border walk `@dagr/layout`'s `attachment` uses, and
 * for the same reason: a line that started at a node's CENTRE would be drawn
 * underneath the node for its first half, so a hundred overlay lines leaving a
 * settlement would all be hidden until they cleared its box. Without layout's
 * two caps, which exist to keep a routed polyline monotone through a chain and
 * have nothing to say about a straight line between two boxes.
 */
export function borderPoint(box: Box, toward: Point): Point {
  const centre = centreOf(box);
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) return centre;
  const halfWidth = (box.maxX - box.minX) / 2;
  const halfHeight = (box.maxY - box.minY) / 2;
  // An axis the line does not move along is reached never rather than
  // immediately, which is why a zero component contributes an infinity here:
  // a line running straight up leaves through the top edge whatever the box's
  // width.
  const toSide = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const toEnd = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const along = Math.min(toSide, toEnd, 1);
  return { x: centre.x + along * dx, y: centre.y + along * dy };
}

/**
 * A three point centreline between two boxes: border to border, bowed sideways
 * at the middle.
 *
 * `bow` is a fraction of the CHORD, so the curve keeps its shape at every
 * distance rather than flattening out across a campaign and looping across a
 * tile. Its sign is the side the bow falls on, which lets a caller separate two
 * lines between the same pair by giving them opposite signs.
 *
 * Three points and not more because the renderer's `'smooth'` curve turns them
 * into a centripetal Catmull-Rom spline through all three, so the shape a
 * viewer sees is a curve and the shape this file has to reason about is a
 * triangle.
 *
 * A chord that would run BACKWARDS comes back as an empty array, along with a
 * self edge. That is the case where one box's centre is inside the other, so
 * the attachment caps put the far border behind the near one and the "line"
 * would be drawn inside out. It is not the same claim as "overlapping boxes are
 * dropped": two boxes can overlap in a corner and still have a perfectly
 * sensible chord between their centres, and that line is drawn.
 */
export function bowedLine(from: Box, to: Box, bow: number): readonly Point[] {
  const fromCentre = centreOf(from);
  const toCentre = centreOf(to);
  const start = borderPoint(from, toCentre);
  const end = borderPoint(to, fromCentre);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // A chord that runs BACKWARDS, which is the case where one box's centre is
  // inside the other: each attachment is capped at the other centre, so the far
  // border ends up behind the near one and the line would be drawn inside out.
  // A length test cannot see that, because neither attachment can travel
  // further than the gap; a direction test can. Note this is not overlap
  // detection: two boxes can overlap at a corner and still have a sensible
  // chord between their centres, and that line is drawn.
  const alongChord =
    dx * (toCentre.x - fromCentre.x) + dy * (toCentre.y - fromCentre.y);
  if (alongChord <= 0) return [];
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  return [
    start,
    // Perpendicular to the chord, which is `(-dy, dx)` normalised, times the
    // bow. Written as a scale of the chord rather than a normalisation and a
    // multiply, since the length is already known.
    { x: midX - dy * bow, y: midY + dx * bow },
    end,
  ];
}

/**
 * Splits a campaign's edges into the three groups, with geometry for each.
 *
 * The routed group reads its polylines from the scene rather than building
 * any: those points are a layout's answer, translated into world space by the
 * same flip the node boxes went through, and re-deriving them here would be a
 * second opinion about where an edge goes.
 *
 * An edge whose endpoints are not both in the scene is dropped from every
 * group. That is not defensive: a campaign holds edges to nodes the tiling
 * chose not to draw, and a line to a box that is not on screen is a line to the
 * origin.
 */
export function campaignEdges(
  campaign: Campaign,
  scene: CampaignScene,
  colorOf: (edge: CampaignEdge) => number,
  bow = DEFAULT_BOW,
): CampaignEdges {
  const routed: SceneEdge[] = [];
  const crossTile: SceneEdge[] = [];
  const overlay: SceneEdge[] = [];
  /** How many lines have already been drawn between each unordered node pair. */
  const drawnPerPair = new Map<string, number>();

  for (const edge of campaign.edges) {
    const points = scene.edgeRoutes.get(edge.id);
    if (points !== undefined) {
      routed.push({ id: edge.id, points, color: colorOf(edge) });
      continue;
    }
    const from = scene.nodeBounds.get(edge.source);
    const to = scene.nodeBounds.get(edge.target);
    if (from === undefined || to === undefined) continue;
    // Alternating by POSITION WITHIN THE PAIR, which is the only thing that
    // separates the lines this bow exists to separate. The first version keyed
    // the side on `edge.id.length % 2`, which is deterministic and useless
    // here: `@dagr/campaign` mints ids as `e-<n>`, so the length only changes
    // when the digit count does, and 6,101 of the campaign's 7,100 ids are the
    // same length. Measured, all 26 node pairs joined by more than one overlay
    // edge got the SAME side, so the two lines drew exactly on top of each
    // other and a reader counting relationships counted one: the feature fired
    // zero times on the real dataset.
    //
    // Still deterministic, because `campaign.edges` is in a fixed order. The
    // key is unordered, so an edge back the other way counts as the same pair:
    // two lines between the same boxes overlap whichever way they point.
    const forward = edge.source < edge.target;
    const pair = forward ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`;
    const seen = drawnPerPair.get(pair) ?? 0;
    drawnPerPair.set(pair, seen + 1);
    // Sides alternate and the magnitude steps every second line, so a third and
    // fourth line clear the first pair rather than landing back on them.
    //
    // The side is decided in the PAIR's canonical direction and then flipped
    // for an edge authored the other way, which is not bookkeeping for its own
    // sake: reversing a chord negates its perpendicular, so `a to c` bowed by
    // `+b` and `c to a` bowed by `-b` are the SAME curve. Alternating without
    // this put 4 of the campaign's 28 multi-line pairs back on top of each
    // other, which is the defect this alternation exists to remove.
    const step = (seen % 2 === 0 ? 1 : -1) * bow * (1 + Math.floor(seen / 2));
    const line = bowedLine(from, to, forward ? step : -step);
    if (line.length === 0) continue;
    const sceneEdge: SceneEdge = { id: edge.id, points: line, color: colorOf(edge) };
    if (EDGE_ROLES[edge.kind] === 'overlay') overlay.push(sceneEdge);
    else crossTile.push(sceneEdge);
  }

  return { routed, crossTile, overlay };
}
