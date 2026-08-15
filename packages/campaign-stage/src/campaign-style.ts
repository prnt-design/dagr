import type { CampaignNode, NodeKind } from '@dagr/campaign';
import type { NodeShape, Size } from '@dagr/render';

/**
 * What each of the campaign's sixteen node kinds looks like: its shape, how big
 * it is in world units, and its two colours.
 *
 * **One table, two consumers, and that is the whole reason this is its own
 * module.** The GPU wants a `0xRRGGBB` integer per instance; the card overlay
 * (P6) wants a CSS colour string for a kind badge. A second table for the second
 * consumer is two tables that drift, and the drift is invisible: a badge in one
 * colour beside a shape in another reads as a design choice rather than a bug.
 * So the numbers are here and {@link nodeColor} derives the string.
 *
 * Sizes are here for a third reason, and it is the one that would be a real bug
 * if it were got wrong. A node's size is an input to LAYOUT (`@dagr/layout` asks
 * for it through `nodeSize`) as well as to rendering, and the overlay places a
 * card against the node's box. Three readers of one number: if the drawn box and
 * the laid-out box disagree, nodes overlap in a picture whose layout says they
 * do not, and no test that checks either half alone can see it.
 *
 * ## Colour is by STRATUM, so the far view reads as structure
 *
 * Six families, one per layer of the schema, because the whole argument for
 * drawing 3,010 nodes at once is that a viewer can see the shape of a campaign
 * before reading a word of it. Amber is the narrative spine, blue the geography,
 * violet the people, green the quests and their clues, red the pressure clocks,
 * and grey the reference material (items, stat blocks, weather). Within a family
 * the deeper kinds are darker, so a region reads as a heading over its rooms.
 *
 * The five colours M4.1 and M4.2 chose are the seed of it: amber `0xffb703` on
 * near-black `0x0b0d10`, orange, blue, sky and deep blue. Three hues were added
 * because sixteen kinds in five colours is confetti, and the additions were
 * picked to sit at similar chroma against the same near-black so no family
 * shouts over the others.
 *
 * **The separations that matter are the CROSS-family ones, and the first draft
 * got them wrong.** A review measured the fills in Oklab and found three pairs
 * from different strata as close as the deliberate steps WITHIN a family: a
 * scene against a clock tick at 0.075 and against a front at 0.093, a stat block
 * against a settlement at 0.070, a weather modifier against a building at 0.095,
 * where campaign against arc is 0.068. So the pressure family read as more
 * narrative orange and the reference greys read as geography blue, which is
 * precisely the work the stratum claim is supposed to be doing at the far zoom.
 * The pressure reds are off the orange axis now (a clock tick is crimson rather
 * than coral) and the greys are neutral rather than blue-leaning.
 *
 * ## Shape carries one bit, and only one
 *
 * A circle is a THING WITH AGENCY OR A COUNT: a person, a faction, a stat block,
 * a tick of a clock. A rounded rect is a PLACE OR A STEP: the campaign, its arcs
 * and scenes, every location, every quest step, every item. One bit is what a
 * shape can carry at a glance, and spending it on the distinction a reader most
 * often wants (who versus where) is worth more than spending it on, say, depth,
 * which the size already carries.
 */
export interface KindStyle {
  /** Which distance function draws it. A circle's size has to be square. */
  readonly shape: NodeShape;
  /** The drawn size in world units, and the size LAYOUT is told about. */
  readonly size: Size;
  /** The corner radius in world units, at most half the smaller dimension. */
  readonly cornerRadius: number;
  /** The interior colour, as `0xRRGGBB`. */
  readonly fillColor: number;
  /** The halo's colour, as `0xRRGGBB`: the family's lightest member. */
  readonly glowColor: number;
}

/** A square size, for the kinds a circle draws. */
function circle(diameter: number): Size {
  return { width: diameter, height: diameter };
}

/**
 * The table.
 *
 * Sizes span 12:1 from a clock tick to the campaign, which is a decade less than
 * the M4.2 ladder spanned and is set by what layout can pack rather than by what
 * an SDF can draw: at more than about that, a scene tile's smallest nodes stop
 * being separable at the zoom where its largest one fits. The zoom-in limit is
 * derived from {@link SMALLEST_NODE_SIZE}, so the small end of this table is
 * what decides how far a reader can zoom in.
 */
export const CAMPAIGN_STYLE: Readonly<Record<NodeKind, KindStyle>> = {
  // The narrative spine, in amber. Light at the top, warm and dark going down,
  // so an arc reads as a heading over its chapters.
  campaign: {
    shape: 'roundedRect',
    size: { width: 360, height: 120 },
    cornerRadius: 24,
    fillColor: 0xffd166,
    glowColor: 0xffe7a8,
  },
  arc: {
    shape: 'roundedRect',
    size: { width: 260, height: 96 },
    cornerRadius: 20,
    fillColor: 0xffb703,
    glowColor: 0xffd166,
  },
  chapter: {
    shape: 'roundedRect',
    size: { width: 200, height: 80 },
    cornerRadius: 16,
    fillColor: 0xfb8500,
    glowColor: 0xffb703,
  },
  scene: {
    shape: 'roundedRect',
    size: { width: 120, height: 48 },
    cornerRadius: 10,
    fillColor: 0xe36414,
    glowColor: 0xfb8500,
  },
  encounter: {
    shape: 'roundedRect',
    size: { width: 72, height: 32 },
    cornerRadius: 8,
    fillColor: 0xbc4b0a,
    glowColor: 0xe36414,
  },
  // The geography, in blue. Rooms are the most numerous kind in the campaign, so
  // they take the darkest step: a wall of them should read as texture under the
  // settlements rather than competing with them.
  location: {
    shape: 'roundedRect',
    size: { width: 100, height: 44 },
    cornerRadius: 10,
    fillColor: 0x2b7f9e,
    glowColor: 0x8ecae6,
  },
  // People, in violet. Circles: a person is not a place.
  npc: {
    shape: 'circle',
    size: circle(48),
    cornerRadius: 0,
    fillColor: 0xa78bfa,
    glowColor: 0xd0c2ff,
  },
  faction: {
    shape: 'circle',
    size: circle(96),
    cornerRadius: 0,
    fillColor: 0x7c5cf0,
    glowColor: 0xa78bfa,
  },
  // Quests and the clue web, in green.
  quest: {
    shape: 'roundedRect',
    size: { width: 160, height: 64 },
    cornerRadius: 14,
    fillColor: 0x52b788,
    glowColor: 0x95d5b2,
  },
  quest_step: {
    shape: 'roundedRect',
    size: { width: 100, height: 44 },
    cornerRadius: 10,
    fillColor: 0x40916c,
    glowColor: 0x74c69d,
  },
  clue: {
    shape: 'roundedRect',
    size: { width: 64, height: 32 },
    cornerRadius: 8,
    fillColor: 0x95d5b2,
    glowColor: 0xcdeedd,
  },
  // Pressure, in red, which is the one family meant to catch an eye.
  front: {
    shape: 'roundedRect',
    size: { width: 160, height: 64 },
    cornerRadius: 14,
    fillColor: 0xe63946,
    glowColor: 0xf07167,
  },
  clock_tick: {
    shape: 'circle',
    size: circle(32),
    cornerRadius: 0,
    fillColor: 0xd11149,
    glowColor: 0xf07167,
  },
  // Reference material, in grey, deliberately quiet: three hundred items and a
  // hundred and thirty stat blocks should not be the first thing anybody sees.
  item: {
    shape: 'roundedRect',
    size: { width: 56, height: 28 },
    cornerRadius: 6,
    fillColor: 0xc9ada7,
    glowColor: 0xe4d3ce,
  },
  statblock: {
    shape: 'circle',
    size: circle(40),
    cornerRadius: 0,
    fillColor: 0x9aa0a6,
    glowColor: 0xc3c7cb,
  },
  condition_modifier: {
    shape: 'roundedRect',
    size: { width: 72, height: 32 },
    cornerRadius: 8,
    fillColor: 0x76747a,
    glowColor: 0xa5a3aa,
  },
};

/**
 * The four location subtypes, which are one KIND and four sizes.
 *
 * A region and a keyed room are both `location`, and drawing them at one size
 * would be the single worst thing this table could do to the picture: a region
 * is a chapter-scale heading and a room is the smallest thing on screen. So the
 * subtype is read where it exists, and the kind table above holds the middle of
 * the range for anything that asks without one.
 *
 * Separate from {@link CAMPAIGN_STYLE} rather than folded into it because the
 * key is not a `NodeKind`, and a table keyed by "kind, or kind plus subtype
 * where there is one" is a lookup with two shapes and a rule to remember. Two
 * tables and one function is the version a reader can follow.
 */
export const LOCATION_STYLE: Readonly<Record<'region' | 'settlement' | 'building' | 'room', KindStyle>> =
  {
    region: {
      shape: 'roundedRect',
      size: { width: 200, height: 80 },
      cornerRadius: 16,
      fillColor: 0x8ecae6,
      glowColor: 0xc7e6f5,
    },
    settlement: {
      shape: 'roundedRect',
      size: { width: 140, height: 56 },
      cornerRadius: 12,
      fillColor: 0x4fa3c4,
      glowColor: 0x8ecae6,
    },
    building: {
      shape: 'roundedRect',
      size: { width: 100, height: 44 },
      cornerRadius: 10,
      fillColor: 0x2b7f9e,
      glowColor: 0x4fa3c4,
    },
    room: {
      shape: 'roundedRect',
      size: { width: 56, height: 28 },
      cornerRadius: 6,
      fillColor: 0x1c6076,
      glowColor: 0x2b7f9e,
    },
  };

/**
 * How far a node's halo reaches past it, in world units: a quarter of its
 * height, which is M4.2's ratio and its argument unchanged.
 *
 * A glow is a property of the SHAPE, so it is in world units and scales with the
 * node: a halo that stayed one unit wide while its node grew from 28 units tall
 * to 120 would be invisible on the largest kind and overwhelming on the
 * smallest. The cost is overdraw, since the padded quad is the node grown by
 * this plus one on each side, and at a quarter of the height that is 2.25 times
 * the fill area for a square-ish node. Worth measuring at M4.10 rather than
 * guessing at here; at the zoom where the whole campaign fits, every one of
 * these is under a pixel anyway.
 */
export function glowReach(size: Size): number {
  return size.height / 4;
}

/** The style for one node, reading a location's subtype where there is one. */
export function styleFor(kind: NodeKind, locationSubtype?: string): KindStyle {
  if (kind === 'location' && locationSubtype !== undefined) {
    const style = LOCATION_STYLE[locationSubtype as keyof typeof LOCATION_STYLE];
    if (style !== undefined) return style;
  }
  return CAMPAIGN_STYLE[kind];
}

/**
 * A node's fill colour as a CSS string, for the card overlay's kind badge.
 *
 * **Derived rather than written down a second time**, which is the point of the
 * module. And a STRING rather than a number because that is what an element's
 * `style` takes, and a CSS declaration whose value the parser rejects is DROPPED
 * SILENTLY: the element keeps whatever it inherited and nothing anywhere fails.
 * That is the same class of failure `@dagr/render`'s `cssNumber` exists for, and
 * the reason the conversion lives here rather than at each badge.
 *
 * **It takes the NODE and not its kind**, which is the second version of this
 * signature. The first took `(kind, locationSubtype?)`, and the optional second
 * argument is the one that decides the answer for the most numerous kind in the
 * campaign: a room and a region are both `location` and are two different blues,
 * so `kindColor('location')` badged all 750 rooms in the region's colour while
 * the GPU drew them in their own. That is exactly the drift this module exists to
 * prevent, reintroduced at the seam another session consumes. Taking the node
 * means a caller cannot omit it.
 *
 * Six hex digits, zero padded, which every CSS parser accepts.
 */
export function nodeColor(node: CampaignNode): string {
  return cssHex(nodeFill(node));
}

/**
 * A node's fill as the `0xRRGGBB` the GPU takes, which is {@link nodeColor}'s
 * number before it becomes a string.
 *
 * Extracted when D2 gave the edges a second consumer of the same value: an edge
 * is drawn in its SOURCE node's colour, and `campaign-edges.ts` hands a number
 * to `SceneEdge.color`. Going through `nodeColor` and parsing the hex back would
 * be a round trip through a string for no reason, and writing the lookup out a
 * second time is the drift this module exists to prevent.
 */
export function nodeFill(node: CampaignNode): number {
  return styleFor(
    node.data.kind,
    node.data.kind === 'location' ? node.data.subtype : undefined,
  ).fillColor;
}

/**
 * The near-black the whole scene is drawn on, from M4.1, and what an edge ink is
 * mixed towards.
 *
 * Here rather than in the stylesheet that also paints it, because this is the
 * one use that is ARITHMETIC: mixing towards the ground is how an ink is
 * derived, and a CSS variable is not readable from a colour function without a
 * computed style. The two have to agree, and if the stage's background ever
 * moves, an ink mixed towards the old one reads as a halo rather than as a dim
 * line.
 */
export const GROUND_COLOR = 0x0b0d10;

/**
 * How much of a node's own colour an edge leaving it keeps: the rest is the
 * ground.
 *
 * **An edge is drawn a step darker than the box it leaves**, which is the
 * constraint the two role inks met by being written down dim and which sixteen
 * derived inks have to meet by construction. An edge is the relation between two
 * things a reader is looking AT, so the boxes stay the figure and the lines stay
 * the structure under them.
 *
 * 0.75, calibrated against the ink it replaces rather than chosen: the old
 * routed ink `0x6ea8c7` sits at 0.76, 0.82 and 0.86 of the three channels of the
 * sky blue `0x8ecae6` it was derived from, once the ground is subtracted. So a
 * step of about a quarter towards the ground is the step this drawing already
 * looked right at, and applying it to each kind's own fill carries every family
 * down by the same ratio rather than by sixteen numbers nobody could re-derive.
 *
 * **What it costs is at the dark end of the palette**, and the cost is worth
 * stating: a room's fill is `0x1c6076` and its ink is `0x184b5d`, which is a line
 * a reader sees at reading zoom and not one they pick out at the fitted view.
 * That is the right order rather than a defect: at the fitted view the ribbon
 * alpha ramp has already taken every edge to about 0.15, so no edge is picked
 * out there by design.
 *
 * **"Under" is about the ink's VALUE and not about each of its channels**, which
 * a review corrected here after the first version of this paragraph claimed the
 * stronger thing. A mix towards the ground moves a channel TOWARDS the ground's
 * own, so a channel already darker than it rises: the amber `0xffb703` has 3 of
 * blue against the ground's 16 and inks to 6. The ink is still a third less
 * bright (a relative luminance of 143 against 185) and the visible effect is
 * that the warm families lose a little saturation as they dim, which is the same
 * drift towards the cold ground this function is spelled to accept. The test
 * samples the amber and the orange for exactly this reason.
 */
export const EDGE_INK_MIX = 0.75;

/**
 * A node fill as the ink an edge leaving that node is drawn in: the fill mixed
 * towards {@link GROUND_COLOR} by {@link EDGE_INK_MIX}.
 *
 * **Mixed per channel in sRGB, deliberately, and it is worth saying which space
 * because the alternative is defensible.** A perceptual mix would hold each
 * family's hue more exactly at low values; this one drags saturated colours
 * slightly towards the ground's blue as it darkens them. That is the cheaper
 * arithmetic and, here, the more useful drift: the ground is a cold near-black,
 * so every ink leans the same way and the FAMILY separations, which is what a
 * reader is tracing, survive. `linearFromHex` in `@dagr/render` converts to
 * linear on the way to the GPU, so this operates on the same numbers the palette
 * is written in and nothing here is a second colour space.
 */
export function edgeInk(fill: number): number {
  const mix = (shift: number): number => {
    const from = (GROUND_COLOR >> shift) & 0xff;
    const to = (fill >> shift) & 0xff;
    return Math.round(from + (to - from) * EDGE_INK_MIX) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

/** `0xRRGGBB` as `#rrggbb`, zero padded so a dark colour is still six digits. */
export function cssHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * A lower bound on every box any node is drawn in: the smallest WIDTH beside the
 * smallest HEIGHT, which are not the same node's.
 *
 * **Reduced per component rather than by area**, which is the second version of
 * this constant. Taking the smallest by area resolved to a clock tick's 32 by 32,
 * while an item and a room are 56 by 28, so the height was 14% too large on the
 * axis that decides the fit for the two most numerous kinds in the campaign.
 * `zoomLimits` frames this with `fitZoom`, which takes a MINIMUM over both axes,
 * so an over-large height silently lowers the zoom ceiling and a reader cannot
 * get as close to a room as the range claims.
 *
 * The pair is a box no node is, which is the point: it is a bound, and a bound
 * that is not achieved is still correct. Computed from both tables rather than
 * typed out, for the drift reason: a size lowered without this following it would
 * strand the new smallest kind below readable size, and the symptom is a reader
 * who cannot zoom in far enough to read one card.
 */
export const SMALLEST_NODE_SIZE: Size = [
  ...Object.values(CAMPAIGN_STYLE),
  ...Object.values(LOCATION_STYLE),
]
  .map((style) => style.size)
  .reduce((smallest, size) => ({
    width: Math.min(smallest.width, size.width),
    height: Math.min(smallest.height, size.height),
  }));
