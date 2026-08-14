import type { Vec2, WorldBounds } from './types.js';
import { requireFinite, requireFinitePoint, requirePositive } from './validate.js';

/**
 * The arithmetic behind the HTML overlay, and every CSS string it assigns.
 *
 * **The strings are built here rather than in `html-overlay.ts`, and that is
 * the point of the split.** M4.1 drew this package's testing line at "pure
 * modules in Node, a screenshot for anything that needs a device", and M4.2
 * added the reason it matters where a formula lives: a suite that checks a copy
 * of the expression the GPU runs is a suite that agrees with itself. The same
 * applies to a transform. `transform: translate(...) scale(...)` is the whole
 * of what registers a label with a camera, so it is computed in a file a Node
 * test executes, and the DOM half assigns what it is handed.
 *
 * Nothing in this file touches a `document`, a `window` or a `Camera2D`. It
 * takes numbers and returns numbers and strings.
 */

/**
 * Where on an element its world position lands, as a fraction of the element's
 * OWN box.
 *
 * Its own type rather than a {@link Vec2}, and its fields are deliberately not
 * `x` and `y`. This is a y-DOWN unit fraction and a `Vec2` is a y-up world
 * point; two structurally identical records with opposite conventions flow into
 * each other with nothing red anywhere, which is the same failure `WorldBounds`
 * exists to prevent (see `types.ts`, where a layout rectangle assigned into a
 * world slot compiled clean and mirrored the scene). `across` and `down` are
 * not assignable from `x` and `y`, so the mistake is a type error.
 */
export interface ElementAnchor {
  /** 0 at the element's left edge, 1 at its right. */
  readonly across: number;
  /** 0 at the element's TOP edge, 1 at its bottom. */
  readonly down: number;
}

/**
 * The centre of an element, which is what a point entry anchors by default.
 *
 * Frozen, because `readonly` is a compile-time claim and this is one shared
 * object every default-anchored entry reads: a caller who wrote to it would
 * move every such entry in the scene, in a way no type checker would have
 * mentioned and no stack would point at.
 */
export const CENTRE_ANCHOR: ElementAnchor = Object.freeze({ across: 0.5, down: 0.5 });

/**
 * Where an overlay entry sits in the world, as a discriminated union rather
 * than one record with unused fields.
 *
 * `ShapeDescriptor` in `shape-scene.ts` is the precedent and the argument is
 * the same: a single record carrying every field would carry combinations that
 * have no meaning, and each of those has to be validated at runtime instead of
 * being unwritable. Three combinations are unwritable here.
 *
 * - **A box has no screen mode.** It is sized to its bounds, so it scales with
 *   the zoom by definition, and a world rectangle that does not scale is not a
 *   rectangle in either space.
 * - **A point has no size gate.** It has no extent, so "how big is it on
 *   screen" has no answer that is not invented. A point is culled by position
 *   and nothing else.
 * - **A point is always screen-scaled**, so there is no world-scaled point. One
 *   would grow with the zoom while nothing could gate it: a gate needs an
 *   extent, and the only extent a point has is the authored size of its own
 *   DOM, which `sync()` may not read (reading layout inside the frame loop is
 *   what makes every frame pay for the styles it wrote). A 200 pixel card
 *   placed as a world-scaled point is 20,000 CSS pixels of ungated DOM at zoom
 *   100. Content that should grow with the graph has an extent, and an extent
 *   is a box, which is also what makes it cullable and gateable honestly.
 *
 * Every field is `readonly`, which matters more here than it does for a shape
 * descriptor: the overlay CACHES what it computed from a placement and rewrites
 * an entry's transform only when the entry appears, when `place()` replaces the
 * placement, or on a rebase. A caller mutating a placement in place would move
 * the box for the culling test and not for the transform, and the entry would
 * draw in its old position until something unrelated moved the camera far
 * enough to rebase.
 */
export type OverlayPlacement =
  | {
      readonly kind: 'point';
      /** Where it sits, in world units. */
      readonly at: Vec2;
      /** Which part of the element lands on {@link at}. Default the centre. */
      readonly anchor?: ElementAnchor;
    }
  | {
      readonly kind: 'box';
      /** The node's box, in world units. */
      readonly bounds: WorldBounds;
      /**
       * The smallest screen width, in CSS pixels, at which this entry shows.
       * Inclusive. Default 0.
       */
      readonly minScreenWidth?: number;
      /**
       * The width at which it stops showing, in CSS pixels. EXCLUSIVE, so two
       * tiers sharing a threshold never both show and never both hide. Default
       * `Infinity`.
       */
      readonly maxScreenWidth?: number;
    };

/**
 * Rejects a placement that cannot be drawn, naming the field.
 *
 * Called from `add()` and `place()` rather than from `sync()`, and that is the
 * point of it existing at all: every number here reaches the DOM from inside a
 * `requestAnimationFrame` callback, where a `RangeError` lands on the global
 * error handler with a stack full of frame plumbing. Checked at registration,
 * the same bad number throws on the caller's own line.
 *
 * A box with `maxX` below `minX` is rejected rather than normalised. A negative
 * width would pass no gate above zero and would size an element to a negative
 * length, so the entry would silently never appear; the likely cause is a
 * `WorldBounds` built from a y-down rectangle, which is exactly the confusion
 * `types.ts` chose extents to make impossible.
 */
export function requirePlacement(placement: OverlayPlacement, field: string): OverlayPlacement {
  if (placement.kind === 'point') {
    requireFinitePoint(placement.at, `${field}.at`);
    if (placement.anchor !== undefined) {
      requireFinite(placement.anchor.across, `${field}.anchor.across`);
      requireFinite(placement.anchor.down, `${field}.anchor.down`);
    }
    return placement;
  }

  const { bounds } = placement;
  requireFinite(bounds.minX, `${field}.bounds.minX`);
  requireFinite(bounds.minY, `${field}.bounds.minY`);
  requireFinite(bounds.maxX, `${field}.bounds.maxX`);
  requireFinite(bounds.maxY, `${field}.bounds.maxY`);
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new RangeError(
      `${field}.bounds has to have maxX at or above minX and maxY at or above minY, got x ${String(bounds.minX)} to ${String(bounds.maxX)} and y ${String(bounds.minY)} to ${String(bounds.maxY)}`,
    );
  }
  if (placement.minScreenWidth !== undefined) {
    requireFinite(placement.minScreenWidth, `${field}.minScreenWidth`);
  }
  // `Infinity` is the natural top of an open-ended tier and the default, so it
  // is allowed here where `requireFinite` would reject it.
  if (placement.maxScreenWidth !== undefined && Number.isNaN(placement.maxScreenWidth)) {
    throw new RangeError(`${field}.maxScreenWidth has to be a number, got NaN`);
  }
  return placement;
}

/**
 * How many significant digits {@link cssNumber} keeps.
 *
 * Seven, which is about what a single-precision compositor transform can carry
 * anyway, so the digits beyond it would be describing a precision the browser
 * discards.
 */
const SIGNIFICANT_DIGITS = 7;

/** `toFixed` accepts 0 to 100 fraction digits and throws outside that. */
const MAX_FRACTION_DIGITS = 100;

/**
 * A number as CSS will accept it, which is NOT what `String(value)` produces.
 *
 * **CSS has no exponential notation.** `String(1e-7)` is `"1e-7"` and
 * `String(1e21)` is `"1e+21"`, and a declaration containing either is dropped
 * by the parser: not clamped, not warned about, dropped, so the element keeps
 * whatever transform it had and the symptom is one label that stops following
 * the camera. JavaScript switches to exponent form below 1e-6 and at or above
 * 1e21, and a zoom of 1e-7 is inside the range a `Camera2D` allows by default.
 *
 * **A fixed number of decimals does not fix it either, and the failure is
 * worse.** `(1e-5).toFixed(4)` is `"0.0000"`, so a small zoom would make the
 * layer's `scale()` exactly zero, which is a singular matrix that collapses
 * every entry to a point. A point entry counter-scaled by `1/z` would then be
 * scaled by 1e5 and by 0, and disappear at the zoom where it was supposed to be
 * the only readable thing on screen. So the fraction digits are chosen per
 * value to keep {@link SIGNIFICANT_DIGITS} of it.
 *
 * Below about 1e-100 the digit count runs into `toFixed`'s limit and a scale
 * does round to zero. At that zoom one world unit is 1e-100 CSS pixels and the
 * visible world is 1e102 units across, so there was nothing to draw.
 */
export function cssNumber(value: number, field: string): string {
  requireFinite(value, field);
  if (value === 0) return '0';

  // `toFixed` gives up at 1e21 and returns the exponent form regardless of the
  // digits asked for, so the large end needs its own expansion. `BigInt` is
  // exact and cannot throw here: every double at or above 1e21 is an integer,
  // because the gap between neighbouring doubles has passed 1 by then.
  if (Math.abs(value) >= 1e21) return BigInt(value).toString();

  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const digits = Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(0, SIGNIFICANT_DIGITS - 1 - magnitude),
  );
  const fixed = value.toFixed(digits);
  const trimmed = digits === 0 ? fixed : fixed.replace(/\.?0+$/, '');
  // `(-1e-9).toFixed(4)` is "-0.0000", which trims to "-0". Legal CSS, and
  // still worth normalising: a test asserting a transform string should not
  // have to know which side of zero a rounded-away value fell on.
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
}

/** A length in CSS pixels, for a `transform` or a `width`. */
export function cssPx(value: number, field: string): string {
  return `${cssNumber(value, field)}px`;
}

/**
 * The transform for the LAYER: the one string a pan or a zoom rewrites.
 *
 * `translate` before `scale`, and the layer carries `transform-origin: 0 0`, so
 * the composition is "scale the layer's coordinates, then move the whole thing
 * to where the origin is on screen". With the default origin of `50% 50%` the
 * scale would be about the layer's own centre, which is half a viewport away
 * from where this arithmetic assumes it is, and every entry would sit at the
 * right place only at zoom 1.
 *
 * @param originScreen where the layer origin is, in CSS pixels from the canvas
 * top-left. The caller gets it from `camera.worldToScreen(origin)`.
 * @param zoom CSS pixels per world unit.
 */
export function layerTransform(originScreen: Vec2, zoom: number): string {
  requireFinitePoint(originScreen, 'originScreen');
  requirePositive(zoom, 'zoom');
  return `translate(${cssPx(originScreen.x, 'originScreen.x')}, ${cssPx(originScreen.y, 'originScreen.y')}) scale(${cssNumber(zoom, 'zoom')})`;
}

/**
 * Where a placement sits in the layer's own coordinates, which are world units
 * measured from the layer origin with y pointing DOWN.
 *
 * The y negation is the whole conversion between the two conventions the
 * package states: world y is up, screen y is down, and the layer is a screen
 * space that has been scaled. A box's local origin is its TOP-left corner,
 * which is `minX, maxY` in world extents, and getting that pair the wrong way
 * round puts every card one box-height below its node.
 */
export function layerLocalPoint(placement: OverlayPlacement, origin: Vec2): Vec2 {
  if (placement.kind === 'point') {
    return { x: placement.at.x - origin.x, y: origin.y - placement.at.y };
  }
  return { x: placement.bounds.minX - origin.x, y: origin.y - placement.bounds.maxY };
}

/**
 * The transform for one ENTRY, in the layer's local coordinates.
 *
 * A box gets a translation and nothing else: it is already in world units, so
 * the layer's own scale is what sizes it, and its transform is independent of
 * the zoom. That is what makes a pan one style write in total rather than one
 * per entry.
 *
 * A point gets `translate(local) scale(1/zoom) translate(-anchor)`, read right
 * to left: shift the element so its anchor is at its own origin, undo the
 * layer's scale so the element draws at the size it was authored at, then move
 * it to the world point. Composing them in that order puts the ANCHOR exactly
 * on the world point and scales the element about the anchor, which is the
 * property a tooltip needs and the one a wrong order breaks silently by half an
 * element's size.
 *
 * The anchor is a percentage of the element's own box, so the overlay never has
 * to know how big the element is: the browser resolves it. That is the whole
 * reason `sync()` can avoid reading layout.
 */
export function entryTransform(
  placement: OverlayPlacement,
  origin: Vec2,
  zoom: number,
): string {
  requireFinitePoint(origin, 'origin');
  requirePositive(zoom, 'zoom');

  const local = layerLocalPoint(placement, origin);
  const move = `translate(${cssPx(local.x, 'placement.x')}, ${cssPx(local.y, 'placement.y')})`;
  if (placement.kind === 'box') return move;

  const anchor = placement.anchor ?? CENTRE_ANCHOR;
  const across = cssNumber(-100 * requireFinite(anchor.across, 'anchor.across'), 'anchor.across');
  const down = cssNumber(-100 * requireFinite(anchor.down, 'anchor.down'), 'anchor.down');
  return `${move} scale(${cssNumber(1 / zoom, 'zoom')}) translate(${across}%, ${down}%)`;
}

/** How wide a box entry is on screen, in CSS pixels. */
export function boxScreenWidth(bounds: WorldBounds, zoom: number): number {
  return (bounds.maxX - bounds.minX) * zoom;
}

/**
 * Whether a box entry's gate lets it show at this zoom.
 *
 * `min <= width < max`, HALF-OPEN, which is the property the three-tier
 * semantic zoom is built on: two tiers sharing a threshold (a label ending at
 * 160 and a card starting at 160) then never both show and never both hide, at
 * any zoom, without either of them knowing the other exists. Closed at both
 * ends would draw two elements on one node at exactly one zoom; open at both
 * would draw none, and the node would blink as the camera crossed it.
 */
export function passesGate(placement: OverlayPlacement, zoom: number): boolean {
  if (placement.kind === 'point') return true;
  const width = boxScreenWidth(placement.bounds, zoom);
  const min = placement.minScreenWidth ?? 0;
  const max = placement.maxScreenWidth ?? Number.POSITIVE_INFINITY;
  return width >= min && width < max;
}

/** Whether two world regions share any area. Four comparisons, no additions. */
export function boundsOverlap(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Whether a world point is inside a world region, edges included. */
export function boundsContain(bounds: WorldBounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Whether a placement is in view.
 *
 * A point entry is a candidate when its POINT is inside the visible region, and
 * its element can extend past that point by any amount, so an entry just off
 * the edge is culled while part of it would still have been on screen. The fix
 * a caller has is a box, and the alternative (reading the element's size to
 * cull it properly) is the layout read `sync()` refuses to make.
 */
export function placementInView(placement: OverlayPlacement, visible: WorldBounds): boolean {
  return placement.kind === 'point'
    ? boundsContain(visible, placement.at)
    : boundsOverlap(visible, placement.bounds);
}

/** The centre of a world region. */
export function boundsCentre(bounds: WorldBounds): Vec2 {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/**
 * Whether the layer origin has to move, given what the camera can see.
 *
 * **The origin is rebased when it leaves the visible region, and the new one is
 * the centre of that region.** Compositor transforms are single precision. With
 * a fixed origin at the world origin, a campaign 100,000 units wide viewed at
 * zoom 100 puts an entry's translation at 1e7 CSS pixels, and float32 carries
 * about 1.7e7 of integer resolution, so neighbouring positions stop being
 * distinguishable and cards visibly jitter against the shapes they label.
 *
 * Rebasing on this rule bounds the layer's own translation by the viewport, and
 * an entry's local coordinates by the LARGER of the visible region and that
 * entry's own extent. The second half is the honest version, and an earlier
 * draft of this paragraph left it out: a box is placed by its TOP-LEFT corner,
 * so a box wider than the view stays a culling candidate while its corner is
 * arbitrarily far from the origin, and one 1e5 unit entry at zoom 100 still puts
 * 1e7 CSS pixels into the composed matrix. Rebasing bounds what a scene of
 * ordinary nodes produces. It does not rescue a single entry the size of the
 * whole graph, and nothing short of splitting that entry would.
 *
 * It cannot thrash: a fresh origin sits at the centre with half a viewport of
 * slack on every side, so one gesture cannot trigger two rebases without moving
 * a viewport's worth in between.
 */
export function needsRebase(origin: Vec2, visible: WorldBounds): boolean {
  return !boundsContain(visible, origin);
}

/**
 * How far a placement is from a world point, squared.
 *
 * Squared because the cap only ever ORDERS these, and a square root is a
 * monotone function, so it would change every number and no decision. World
 * distance rather than screen distance for the same reason: screen distance is
 * the world distance times the zoom, and every candidate in one frame shares
 * the zoom.
 */
export function distanceSqFrom(placement: OverlayPlacement, from: Vec2): number {
  const at = placement.kind === 'point' ? placement.at : boundsCentre(placement.bounds);
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  return dx * dx + dy * dy;
}

/** What {@link selectWithinCap} ranks: how far away, and how long registered. */
export interface CapCandidate {
  /** Registration order, which breaks ties. Lower is older. */
  readonly order: number;
  /** From {@link distanceSqFrom}. */
  readonly distanceSq: number;
}

/**
 * The candidates that fit under the cap, nearest to the camera first.
 *
 * **The cap is not a tuning knob.** A degenerate zoom qualifies every label in
 * a graph at once, and the DOM must not be the thing that falls over: a hundred
 * thousand elements is a locked-up tab, where a hundred thousand instanced
 * quads is a frame. Ranking by distance from the camera centre means what
 * survives is what the user is looking at.
 *
 * Ties break by registration order, so the picture does not depend on the
 * iteration order of a map or on which of two coincident nodes was measured
 * first. The visible cost of any cap is that entries pop at the boundary rank
 * as the camera moves; a hysteresis band would trade that for a picture that
 * depends on how you got there, which is worse to debug and worse to screenshot.
 *
 * Under the cap this does not sort at all, which is the common case and the one
 * that runs every frame. Over it, the sort is O(n log n) on the candidates that
 * survived culling; a partial selection would be O(n) and is the change to make
 * if a scene ever qualifies enough entries for it to matter.
 */
export function selectWithinCap<T extends CapCandidate>(
  candidates: readonly T[],
  cap: number,
): readonly T[] {
  if (candidates.length <= cap) return candidates;
  return [...candidates]
    .sort((a, b) => a.distanceSq - b.distanceSq || a.order - b.order)
    .slice(0, cap);
}
