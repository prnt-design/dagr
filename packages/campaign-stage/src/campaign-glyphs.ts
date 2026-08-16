import type { CampaignNode, NodeKind } from '@dagr/campaign';

/**
 * One drawn mark per node kind, for the overlay tiers to put on a card badge
 * and a title.
 *
 * **Inline SVG, authored here, and both halves of that are decisions.** An icon
 * font would be a network request the docs site does not otherwise make and a
 * glyph table nobody in this repo can read; a raster set would be twenty files
 * to keep in step with a palette that is computed. A path string is text: it
 * diffs, it takes `currentColor`, it costs no request, and the element the tier
 * builds is one `<svg>` with one `<path>` whose `d` is rewritten on every bind,
 * which is exactly the shape a POOLED element needs (see the tiers: an element
 * that came back for a different node must carry nothing of the last one).
 *
 * **One path per glyph, deliberately.** A mark that needed two paths would make
 * the tier's `create` and `update` disagree about how many children an icon
 * has, which is the kind of drift that shows up as one kind rendering half its
 * icon. Subpaths inside one `d` cost nothing and keep the DOM fixed at one
 * node.
 *
 * The marks are stroked rather than filled, at {@link GLYPH_STROKE_WIDTH} in a
 * {@link GLYPH_VIEWBOX} box, so one path reads at 12 CSS pixels on a badge and
 * at 44 as the card's watermark without a second drawing. Stroke also means the
 * mark takes the ink of whatever is around it, which is what lets the badge use
 * the palette without this module importing it.
 */

/** The coordinate box every path below is drawn in. */
export const GLYPH_VIEWBOX = '0 0 16 16';

/**
 * The stroke width, in the viewBox's own units.
 *
 * 1.5 of 16, so a glyph scaled to a 12 pixel badge draws at about 1.1 device
 * pixels and one scaled to the 44 pixel watermark at about 4. Thinner reads as
 * a smudge at badge size on the software rasteriser the screenshots come
 * through; thicker closes the counters on the denser marks (the citadel, the
 * d20).
 */
export const GLYPH_STROKE_WIDTH = 1.5;

/**
 * What a location's four subtypes are drawn as, since one kind is four sizes
 * and four blues and reads as four things.
 *
 * Keyed separately from {@link KIND_GLYPHS} for the reason `campaign-style.ts`
 * keeps `LOCATION_STYLE` separate: the key is not a `NodeKind`, and one table
 * keyed by "kind, or kind plus subtype where there is one" is a lookup with two
 * shapes and a rule to remember.
 */
export const LOCATION_GLYPHS: Readonly<Record<'region' | 'settlement' | 'building' | 'room', string>> =
  {
    // A ridge line: the region as the land it covers.
    region: 'M1.5 12.5l4.5-7 3 4 2-3 3.5 6z',
    // Roofs clustered, which is what a settlement is from far enough away.
    settlement: 'M1.5 9.5L4 7l2.5 2.5v4h-5zM7.5 8L11 4.5 14.5 8v5.5h-7z',
    // One roof and a door under it.
    building: 'M2.5 7.5L8 3l5.5 4.5v6h-11zM6.5 13.5v-4h3v4',
    // Four walls with a gap for the door, which is how a keyed room is drawn on
    // every dungeon map there has ever been.
    room: 'M2.5 3.5h11v9.5H10M6 13H2.5V3.5',
  };

/**
 * One mark per kind. `location` is the fallback for a node whose subtype is
 * missing, which is the same shape {@link styleFor} has.
 */
export const KIND_GLYPHS: Readonly<Record<NodeKind, string>> = {
  // An open book on its spine.
  campaign:
    'M8 4.5v8M8 4.5C6.7 3.4 4.9 2.9 2.5 2.9v8c2.4 0 4.2.5 5.5 1.6M8 4.5c1.3-1.1 3.1-1.6 5.5-1.6v8c-2.4 0-4.2.5-5.5 1.6',
  // An arc, drawn as one, with its ends marked.
  arc: 'M2.5 12.5a5.5 5.5 0 0 1 11 0M2.5 12.5h-.01M13.5 12.5h.01',
  // A page with its corner turned.
  chapter: 'M4 2.5h5l3.5 3.5v7.5H4zM9 2.5V6h3.5',
  // A stage: the frame, and the boards a scene is played on.
  scene: 'M2.5 2.5h11v6.5h-11zM4.5 13.5L8 9.5l3.5 4',
  // Crossed blades.
  encounter: 'M2.5 2.5l8 8M13.5 2.5l-8 8M2.5 13.5l2.5-2.5M13.5 13.5L11 11',
  // A map pin, for a location whose subtype nobody read.
  location: 'M8 13.5c2.7-3.3 4-5.6 4-7a4 4 0 1 0-8 0c0 1.4 1.3 3.7 4 7zM8 6v.01',
  // Head and shoulders.
  npc: 'M8 7.5a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM3 13.5c0-2.8 2.2-4.2 5-4.2s5 1.4 5 4.2',
  // A banner on its pole.
  faction: 'M4 2v12M4 3h8l-2 2.6L12 8.2H4',
  // A scroll, rolled at the foot.
  quest: 'M4.5 2.5h7.5v9a2 2 0 0 1-2 2H4a2 2 0 0 0 2-2V2.5zM7 5.5h3M7 8h3',
  // A step taken: the box and its tick.
  quest_step: 'M2.5 3h11v10h-11zM5 8l2 2 4-4',
  // A lens over a fact.
  clue: 'M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM9.9 9.9l3.6 3.6',
  // A cut gem.
  item: 'M3 6l2.5-3h5L13 6l-5 7.5zM3 6h10M5.5 3L8 13.5 10.5 3',
  // The wave about to break, which is what a front is.
  front: 'M1.5 11.5c2.2-3.2 4.3-3.2 6.5 0s4.3 3.2 6.5 0M1.5 7c2.2-3.2 4.3-3.2 6.5 0s4.3 3.2 6.5 0',
  // A clock, one tick from its doom.
  clock_tick: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 5v3.2l2.2 1.5',
  // A d20: the reference die.
  statblock: 'M8 2l5.5 3.2v6.6L8 15l-5.5-3.2V5.2zM8 2l5.5 9.8h-11z',
  // Weather standing over the ground.
  condition_modifier:
    'M5 9a2.5 2.5 0 0 1 .3-5 3.5 3.5 0 0 1 6.5 1.2A2.4 2.4 0 0 1 11.3 9zM4.5 11.8h7M6.5 13.8h5',
};

/**
 * The mark for one node, reading a location's subtype where there is one.
 *
 * Takes the NODE for the same reason `nodeColor` does: `location` is one kind
 * and four of everything, and a signature over `NodeKind` alone would give
 * every room the region's mark while the palette gave it the room's colour.
 */
export function nodeGlyph(node: CampaignNode): string {
  if (node.data.kind === 'location') {
    const glyph = LOCATION_GLYPHS[node.data.subtype as keyof typeof LOCATION_GLYPHS];
    if (glyph !== undefined) return glyph;
  }
  return KIND_GLYPHS[node.data.kind];
}
