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

export const LADDER_SHAPES: readonly LadderShape[] = [
  {
    label: 'rect-10',
    bounds: boxAt({ x: 0, y: 0 }, 10, 4),
    detail: '10 x 4 units, radius 1',
  },
  {
    label: 'circle-10',
    bounds: boxAt({ x: 12, y: 0 }, 4, 4),
    detail: 'radius 2 units',
  },
  {
    label: 'rect-100',
    bounds: boxAt({ x: 100, y: 0 }, 100, 40),
    detail: '100 x 40 units, radius 10',
  },
  {
    label: 'circle-100',
    bounds: boxAt({ x: 200, y: 0 }, 40, 40),
    detail: 'radius 20 units',
  },
  {
    label: 'rect-1000',
    bounds: boxAt({ x: 1000, y: 0 }, 1000, 400),
    detail: '1000 x 400 units, radius 100',
  },
  {
    label: 'circle-1000',
    bounds: boxAt({ x: 2000, y: 0 }, 400, 400),
    detail: 'radius 200 units',
  },
];

/**
 * The smallest a shape can be on screen and still get a label, in CSS pixels.
 *
 * 24, from the campaign demo plan's three tiers, and the tier below it is the
 * absence of an entry: under 24 pixels the shape is drawn by the GPU and says
 * nothing, which is what keeps the far view readable as structure instead of a
 * wall of text. There is no ceiling here yet. The plan's label tier ends at 160
 * where the card tier begins, and M4.12 is what adds the card, so capping the
 * label now would blank the labels at close zoom with nothing to replace them.
 */
export const LABEL_MIN_SCREEN_WIDTH = 24;
