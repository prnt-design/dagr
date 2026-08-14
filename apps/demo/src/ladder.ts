import type { WorldBounds } from '@dagr/render';

/**
 * Where M4.2's crispness ladder is, restated for the overlay.
 *
 * **This is a copy of geometry that lives in `@dagr/render`'s
 * `shape-scene.ts`, and the copy is deliberate.** That module exports its
 * descriptors to its own tests and `index.ts` does not re-export them, on a
 * decision worth keeping: the ladder is a demonstration rather than a feature,
 * and exporting a hard-coded set of six shapes would make a placeholder part of
 * the package's contract, which is the kind of thing that survives three
 * milestones because something depends on it. M4.4 replaces the scene with a
 * real layout, and on that day this file goes rather than being ported.
 *
 * The risk a copy carries is drift, and here the drift is visible rather than
 * silent: a label in the wrong place is the first thing anybody looking at the
 * demo sees, and the committed screenshot is the record of where they were.
 *
 * The numbers come from `CRISPNESS_LADDER`: rects 10, 100 and 1000 world units
 * across with heights 4, 40 and 400, each rung's circle matching its rung's
 * HEIGHT, and everything growing to the right in decades.
 */
export interface LadderShape {
  /** The descriptor's own label, so the two files can be compared by eye. */
  readonly label: string;
  /** The shape itself, not its padded quad. Extents, world y up. */
  readonly bounds: WorldBounds;
  /** What the label says about the shape, past its name. */
  readonly detail: string;
  /** Which primitive draws it, for the card tier's badge. */
  readonly kind: 'roundedRect' | 'circle';
  /** The card tier's rows: what `shape-scene.ts` gave this shape and why. */
  readonly card: readonly (readonly [key: string, value: string])[];
}

/** A shape's box from its centre and size, which is how the descriptors read. */
function boxAt(center: { x: number; y: number }, width: number, height: number): WorldBounds {
  return {
    minX: center.x - width / 2,
    minY: center.y - height / 2,
    maxX: center.x + width / 2,
    maxY: center.y + height / 2,
  };
}

/**
 * The card rows for one rung, which are the same facts for every shape on it.
 *
 * The glow radius is a quarter of the shape's HEIGHT and scales with the shape,
 * while the outline is 2 device pixels on every rung. That asymmetry is M4.2's
 * substantive decision (a glow is a property of the shape, an outline is a
 * property of the screen), so it is what the card tier is for: a fact worth
 * reading when you are close enough to read it, and worth nobody's pixels when
 * you are not.
 */
function rungRows(height: number): readonly (readonly [string, string])[] {
  return [
    ['outline', '2 device px, inset'],
    ['glow', `${String(height / 4)} units, outside`],
    ['fill', 'one distance field'],
  ];
}

export const LADDER_SHAPES: readonly LadderShape[] = [
  {
    label: 'rect-10',
    kind: 'roundedRect',
    bounds: boxAt({ x: 0, y: 0 }, 10, 4),
    detail: '10 x 4 units, radius 1',
    card: [['size', '10 x 4 units'], ['corner', 'radius 1'], ...rungRows(4)],
  },
  {
    label: 'circle-10',
    kind: 'circle',
    bounds: boxAt({ x: 12, y: 0 }, 4, 4),
    detail: 'radius 2 units',
    card: [['size', 'radius 2 units'], ['rung', 'height 4'], ...rungRows(4)],
  },
  {
    label: 'rect-100',
    kind: 'roundedRect',
    bounds: boxAt({ x: 100, y: 0 }, 100, 40),
    detail: '100 x 40 units, radius 10',
    card: [['size', '100 x 40 units'], ['corner', 'radius 10'], ...rungRows(40)],
  },
  {
    label: 'circle-100',
    kind: 'circle',
    bounds: boxAt({ x: 200, y: 0 }, 40, 40),
    detail: 'radius 20 units',
    card: [['size', 'radius 20 units'], ['rung', 'height 40'], ...rungRows(40)],
  },
  {
    label: 'rect-1000',
    kind: 'roundedRect',
    bounds: boxAt({ x: 1000, y: 0 }, 1000, 400),
    detail: '1000 x 400 units, radius 100',
    card: [['size', '1000 x 400 units'], ['corner', 'radius 100'], ...rungRows(400)],
  },
  {
    label: 'circle-1000',
    kind: 'circle',
    bounds: boxAt({ x: 2000, y: 0 }, 400, 400),
    detail: 'radius 200 units',
    card: [['size', 'radius 200 units'], ['rung', 'height 400'], ...rungRows(400)],
  },
];

/**
 * The three tiers, in CSS pixels of screen width, from the campaign demo plan.
 *
 * Below {@link LABEL_MIN_SCREEN_WIDTH} a shape gets NO overlay element at all,
 * and that is the first tier rather than a gap: the GPU draws it and it says
 * nothing, which is what keeps the far view readable as structure instead of a
 * wall of text. From there to {@link CARD_MIN_SCREEN_WIDTH} it gets a title
 * tag, and above that a card with the fields `shape-scene.ts` gave it.
 *
 * The two numbers meet exactly, and the overlay's gate is half-open, so at the
 * card threshold the card shows and the label does not. There is no zoom at
 * which a shape carries both and none at which it briefly carries neither.
 */
export const LABEL_MIN_SCREEN_WIDTH = 24;

/**
 * Where the label tier ends and the card tier begins.
 *
 * The campaign plan says about 160 CSS pixels, and this demo uses 240 for a
 * reason worth carrying into it: **a card should not be wider than the node it
 * describes.** These cards are 208 pixels of content plus padding, a border and
 * an 8 pixel inset, so at a 160 pixel node the card would hang 60 pixels past
 * the right edge of the shape it belongs to, at exactly the moment a reader is
 * watching a tag turn into a card. The threshold that matters is the card's own
 * width, not a round number, and a consumer whose cards are narrower can move
 * it down.
 */
export const CARD_MIN_SCREEN_WIDTH = 240;
