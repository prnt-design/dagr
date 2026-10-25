import { clampCornerRadius } from './sdf.js';
import type { Size, Vec2 } from './types.js';

/**
 * What M4.2 draws, as plain data.
 *
 * No three.js type appears here, for the reason `types.ts` gives at length:
 * three is a peer dependency, so a node or a `Vector2` in an exported signature
 * would make two copies of three in one tree a type error rather than a
 * bundle-size problem. The shader transcription of these same shapes lives in
 * `sdf-nodes.ts`, which does import three and is therefore internal.
 *
 * The split is not only about the peer dependency. A distance field written in
 * TSL cannot be unit tested (Node has no WebGPU, and emitting WGSL headlessly
 * does not work on three 0.185.1), so everything about a shape that can be
 * decided on the CPU is decided here, where a test can reach it. What is left
 * in the shader is arithmetic that a screenshot checks.
 *
 * ## Validation, and why any of it
 *
 * three validates none of this. A `NaN` size becomes a quad with `NaN`
 * vertices, which the rasteriser silently drops; a colour of `-1` becomes some
 * colour; an opacity of `2` becomes an opaque shape that a caller reads as
 * "blending is broken". Every one of those is a wrong picture rather than an
 * error, arriving frames away from the line that caused it, which is exactly
 * the argument `RendererOptions.clearColor` already makes for its own range
 * check. So this module makes each of them a `RangeError` naming the field, per
 * the package rule in `errors.ts`: **an out-of-range value is a `RangeError`
 * naming the field, and anything else this package throws gets a named class.**
 * Nothing here needs a new class, so nothing here adds one.
 */

/**
 * The shape families M4.2 has a distance field for.
 *
 * Two, and the count is load-bearing rather than a starting point: `circle` is
 * not a special case of `rounded-rect` in this package (see
 * {@link ShapeInstance.cornerRadius}), and an ellipse is a third family with no
 * closed-form exact distance, so it is not quietly reachable by passing an
 * unequal size to a circle.
 */
export type ShapeKind = 'rounded-rect' | 'circle';

/**
 * How a shape is painted: a fill, an optional outline, an optional glow.
 *
 * All three are read from ONE distance field rather than from three pieces of
 * geometry, which is M4.2's whole premise, so they are one record rather than
 * three. Every colour is a 24-bit `0xRRGGBB` integer, following
 * `RendererOptions.clearColor` in `types.ts`: a number rather than a CSS string
 * because it is handed straight to three, and because a string invites
 * `'transparent'`, which is a context-creation flag here and not a colour.
 *
 * Opacity is separate from the colour rather than packed into an `0xAARRGGBB`
 * word on purpose. Packing costs a mask and a shift at every read, makes the
 * legal range of a colour depend on whether alpha is present, and makes `0`
 * ambiguous between opaque black and fully transparent black.
 */
export interface ShapeStyle {
  /** The fill, as `0xRRGGBB`. The only required field: a shape has a colour. */
  readonly fillColor: number;

  /** Fill alpha in `[0, 1]`. Default 1. Zero is legal and draws nothing. */
  readonly fillOpacity?: number;

  /**
   * The outline, as `0xRRGGBB`. Default the fill colour, which is not a guess
   * at what the caller meant: see {@link NormalizedShapeStyle.outlineColor}.
   */
  readonly outlineColor?: number;

  /**
   * Outline thickness in WORLD units, so it scales with the shape under zoom.
   * Default 0, meaning no outline. World units rather than pixels because a
   * pixel-width outline needs the camera's zoom, which a shape record does not
   * have and should not need; a constant-pixel outline is a later decision that
   * belongs wherever the zoom already is.
   */
  readonly outlineWidth?: number;

  /** The glow, as `0xRRGGBB`. Default the fill colour, which is the usual halo. */
  readonly glowColor?: number;

  /**
   * How far the glow reaches beyond the edge, in world units. Default 0,
   * meaning no glow. Also world units, and for the same reason.
   */
  readonly glowRadius?: number;
}

/**
 * One shape to draw: a family, a place, a size, and a style.
 *
 * A ZERO-SIZED SHAPE IS LEGAL and does not throw. It draws nothing, which is
 * what a caller animating a node in from nothing, or drawing a collapsed group,
 * actually wants, and making it an error would force every such caller to
 * branch around this function at the exact moment the code is least
 * interesting.
 * Negative is a different thing: it is not a smaller shape, it is a mistake in
 * the caller's arithmetic, so it is rejected.
 */
export interface ShapeInstance {
  /** Which distance field draws this. */
  readonly kind: ShapeKind;

  /** Where the shape's centre sits, in world units. */
  readonly center: Vec2;

  /**
   * The shape's full extent in world units, not its half extent.
   *
   * **For a `circle`, `width` and `height` have to be EQUAL**, and an unequal
   * pair is a `RangeError` naming `size`. The two alternatives were both worse.
   * Silently taking the min (or the max, or the mean) draws a shape the caller
   * did not ask for and gives them no way to notice: the picture is a circle,
   * it is just the wrong circle, and nothing anywhere reports it. Drawing an
   * ellipse instead makes `circle` a second family in disguise, and an ellipse
   * has no closed-form exact signed distance, so the outline and the glow that
   * M4.2 reads off that distance would be subtly wrong in a way the fill would
   * not be. A caller who wants "a circle that fits this box" writes one
   * `Math.min` at the call site, where they can see which dimension won.
   *
   * Full extent rather than a radius for a circle so that one field means the
   * same thing in both families and the quad sizer has one code path. The
   * radius is `width / 2`.
   */
  readonly size: Size;

  /**
   * Corner radius in world units, `rounded-rect` only. Default 0, a sharp
   * rectangle.
   *
   * **A radius larger than half the shorter side is CLAMPED to half the shorter
   * side, not rejected**, by `clampCornerRadius` in `sdf.ts`, which owns that
   * rule and states the argument for it: a corner radius comes from a theme
   * rather than from the call site, so a radius bigger than the shape is the
   * ordinary case of a small node under a design that rounds generously, and
   * half the shorter side is where the four arcs meet, which is a genuinely
   * neutral answer rather than a guess at what the caller meant. This function
   * calls that one rather than repeating the bound, so there is one clamp and
   * the normalized record carries its result.
   *
   * A NEGATIVE radius is still a `RangeError` here, even though
   * `clampCornerRadius` would clamp it to 0. The two are not in disagreement,
   * they sit at different gates: `clampCornerRadius` is an internal safety net
   * on a value that may already have been through a pile of arithmetic, and
   * this is the package's front door, where a negative radius is a caller's
   * sign error on a line they can see. Strict about the sign, forgiving about
   * the magnitude, because a sign error is written and a magnitude is
   * inherited.
   *
   * **On a `circle` this field being PRESENT AT ALL is a `RangeError`**, `0`
   * included. Present rather than nonzero is the line because it is the only
   * one that can be checked without judgement: a rule that let `0` through and
   * rejected `0.0001` would make the error depend on the value of a field that
   * has no meaning for this kind, and would not catch the bug that motivates
   * the check, which is a caller building shapes from a template and flipping
   * `kind` to `'circle'` with the corner radius still on it. Under an
   * ignore-it rule that caller gets a circle and no signal; under this one they
   * get a line number.
   */
  readonly cornerRadius?: number;

  /** How it is painted. */
  readonly style: ShapeStyle;
}

/**
 * A {@link ShapeStyle} with every optional field resolved to a number.
 *
 * `outlineColor` and `glowColor` default to `fillColor` rather than to black.
 * With `outlineWidth` and `glowRadius` at 0 neither is read at all, so the
 * default only matters when a caller sets a width or a radius and forgets the
 * colour, and there the fill colour is the one value that cannot produce an
 * artefact the caller will misread: a black ring nobody asked for looks like a
 * shader bug and sends them into `sdf-nodes.ts`, while a fill-coloured ring
 * looks like the outline they forgot to colour, which is what happened.
 */
export interface NormalizedShapeStyle {
  readonly fillColor: number;
  readonly fillOpacity: number;
  readonly outlineColor: number;
  readonly outlineWidth: number;
  readonly glowColor: number;
  readonly glowRadius: number;
}

/**
 * A validated {@link ShapeInstance} with every optional field filled in.
 *
 * This exists because {@link normalizeShape} returns a record rather than
 * `void`, and that is the decision worth recording. Two consumers need these
 * defaults: whatever builds the material and whatever sizes the quad, and under
 * a `void` validator each of them writes its own `?? 0` and `?? 1`. Two places
 * applying a default is how the two drift apart, and the drift is invisible:
 * the quad gets sized for a glow the material does not draw, or the material
 * draws a glow that is clipped by the quad, and neither is an error anywhere.
 * Applying the defaults once, here, at the same point the values are checked,
 * makes the drift unrepresentable rather than merely unlikely.
 *
 * `cornerRadius` here is the CLAMPED radius, already held inside
 * `[0, min(width, height) / 2]` by `clampCornerRadius`, so nothing downstream
 * has to clamp it again and nothing downstream can forget to.
 *
 * `cornerRadius` on a `circle` normalizes to 0. It is not the circle's radius:
 * a circle's radius is `size.width / 2`, and putting it in `cornerRadius` would
 * make the field mean two different things depending on `kind`, which is the
 * kind of overloading that reads fine for a week.
 */
export interface NormalizedShape {
  readonly kind: ShapeKind;
  readonly center: Vec2;
  readonly size: Size;
  readonly cornerRadius: number;
  readonly style: NormalizedShapeStyle;
}

/** Rejects a value that is not a finite number, naming the field. */
function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} has to be a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Rejects a value that is not a finite number at or above zero.
 *
 * Zero passes: an extent of zero draws nothing, which is legal, and so does an
 * outline of zero width and a glow of zero reach. Only the sign is the mistake.
 */
function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} has to be a finite number at or above zero, got ${String(value)}`,
    );
  }
  return value;
}

/** Rejects an alpha outside `[0, 1]`, both ends included. */
function requireUnitInterval(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} has to lie in [0, 1], got ${String(value)}`);
  }
  return value;
}

/**
 * Rejects anything that is not a 24-bit `0xRRGGBB` integer.
 *
 * `Number.isInteger` covers `NaN` and both infinities on its own, so the range
 * test only has to say what a colour is. The fractional case matters as much as
 * the out-of-range one: `0x336699 + 0.5` is a number a caller reaches by
 * interpolating two colours as scalars, and it produces a colour rather than an
 * error everywhere downstream.
 */
function requireColor(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(
      `${field} has to be an integer in [0, 0xffffff], got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Checks a shape and returns it with every optional field resolved.
 *
 * Throws a `RangeError` naming the offending field for anything that cannot
 * describe a shape: a non-finite number anywhere, a negative extent, width or
 * radius, an opacity outside `[0, 1]`, a colour that is not an integer in
 * `[0, 0xffffff]`, a `kind` that is neither family, an unequal size on a
 * circle, and a corner radius present on a circle at all. Two things are NOT on
 * that list: a zero size, which is legal and draws nothing, and a corner radius
 * larger than the shape, which is clamped (see
 * {@link ShapeInstance.cornerRadius}).
 *
 * The checks run in the order a caller has to fix them, which is why the size
 * is checked before the corner radius: with a negative width the radius clamp
 * is meaningless, and reporting the radius first sends the caller to the wrong
 * line.
 */
export function normalizeShape(shape: ShapeInstance): NormalizedShape {
  if (shape.kind !== 'rounded-rect' && shape.kind !== 'circle') {
    throw new RangeError(
      `kind has to be 'rounded-rect' or 'circle', got ${String(shape.kind)}`,
    );
  }

  requireFinite(shape.center.x, 'center.x');
  requireFinite(shape.center.y, 'center.y');
  requireNonNegative(shape.size.width, 'size.width');
  requireNonNegative(shape.size.height, 'size.height');

  if (shape.kind === 'circle' && shape.size.width !== shape.size.height) {
    throw new RangeError(
      `size has to be square for a circle, got ${String(shape.size.width)} by ${String(shape.size.height)}`,
    );
  }

  const cornerRadius = normalizeCornerRadius(shape);

  return {
    kind: shape.kind,
    center: { x: shape.center.x, y: shape.center.y },
    size: { width: shape.size.width, height: shape.size.height },
    cornerRadius,
    style: normalizeStyle(shape.style),
  };
}

/** The corner radius rules, which are the two that depend on {@link ShapeKind}. */
function normalizeCornerRadius(shape: ShapeInstance): number {
  if (shape.kind === 'circle') {
    if (shape.cornerRadius !== undefined) {
      throw new RangeError(
        `cornerRadius has no meaning on a circle and has to be omitted, got ${String(shape.cornerRadius)}`,
      );
    }
    return 0;
  }

  const cornerRadius = requireNonNegative(shape.cornerRadius ?? 0, 'cornerRadius');
  // Clamped rather than rejected past half the shorter side, and clamped THERE
  // rather than here: `sdf.ts` owns the bound because its distance field is
  // what the bound is about, and a second copy of it is a second chance to
  // write `width` where `height` was meant.
  return clampCornerRadius(cornerRadius, shape.size.width / 2, shape.size.height / 2);
}

/** Checks a style and fills in its defaults. */
function normalizeStyle(style: ShapeStyle): NormalizedShapeStyle {
  const fillColor = requireColor(style.fillColor, 'style.fillColor');
  return {
    fillColor,
    fillOpacity: requireUnitInterval(style.fillOpacity ?? 1, 'style.fillOpacity'),
    outlineColor: requireColor(style.outlineColor ?? fillColor, 'style.outlineColor'),
    outlineWidth: requireNonNegative(style.outlineWidth ?? 0, 'style.outlineWidth'),
    glowColor: requireColor(style.glowColor ?? fillColor, 'style.glowColor'),
    glowRadius: requireNonNegative(style.glowRadius ?? 0, 'style.glowRadius'),
  };
}
