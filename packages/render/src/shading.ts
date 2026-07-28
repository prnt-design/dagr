import type { SdfOps } from './sdf-ops.js';

/**
 * Fill, outline and glow, all read from ONE signed distance.
 *
 * That is the claim M4.2 exists to establish, so this file is arranged to make
 * it structurally true rather than merely honoured: there is one distance
 * parameter, and there is no shape knowledge anywhere below. Nothing here knows
 * what a rectangle is, or a radius, or a size. Hand it a number and it shades;
 * where the number came from is the caller's business. The consequence is the
 * one worth having: every shape M4 adds later inherits the same edge quality,
 * and a fix to one is a fix to all of them.
 *
 * Generic over {@link SdfOps} for the same reason `sdf.ts` is: `sdf-tsl.ts`
 * compiles these lines to WGSL and `test/shading.test.ts` runs them over
 * doubles, and there is no second copy to drift.
 *
 * Nothing here throws either, for the reason `sdf.ts` gives at length: this runs
 * per fragment, where there is no exception mechanism at all. Where a value has
 * to be brought into range it is brought into range by a `min` or a `max`, and
 * the docstring says which values and why.
 */

/**
 * The smallest width this file will divide by, in the same units as the
 * distance.
 *
 * Two divisions in this file have a caller-supplied width in the denominator,
 * and both have a natural way of being handed a zero: `fwidth` of a distance is
 * exactly zero wherever the rasteriser's 2 by 2 quad straddles no change at all,
 * and a glow width of zero is the obvious way to spell "no glow". `0 / 0` is
 * `NaN`, and a `NaN` alpha is a transparent or a black fragment with nothing
 * thrown anywhere along the way, which is the worst failure mode available here:
 * silent, and one frame removed from its cause.
 *
 * 1e-12 rather than a rounder number, from both ends. It is below any filter
 * width a real frame can produce, since a filter width is one pixel measured in
 * world units and reaching 1e-12 would need a zoom of 1e12, at which point the
 * world coordinates themselves have long since exhausted 32-bit float precision
 * and the geometry is gone. And it is large enough that `distance / epsilon`
 * stays finite in 32-bit float for any distance below 3.4e26 world units, so the
 * floor cannot turn one silent failure into another by overflowing to infinity
 * on the GPU while looking fine in a 64-bit test.
 *
 * Below the floor the ramp is narrower than any distance a caller can express,
 * so {@link coverage} degenerates to a hard step with an exact one half at the
 * boundary. That is the answer the absence of a filter asks for, not a guess at
 * a width nobody supplied.
 */
export const MIN_FILTER_WIDTH = 1e-12;

/** A colour, in whatever arithmetic `T` is. Channels are expected in `[0, 1]`. */
export interface Rgb<T> {
  readonly r: T;
  readonly g: T;
  readonly b: T;
}

/**
 * A colour with an alpha, PREMULTIPLIED: each channel has already been
 * multiplied by the alpha, so `r <= a`, `g <= a` and `b <= a` for any colour in
 * the unit cube.
 *
 * Premultiplied rather than straight, and it is the composite of three layers
 * that decides it. Straight-alpha "over" is
 * `out = (src * srcA + dst * dstA * (1 - srcA)) / outA`, which needs a divide per
 * layer, has an undefined result wherever `outA` is zero (which is most of the
 * quad), and spells colour and alpha with two different expressions so that a
 * bug in one does not show up in the other. Premultiplied "over" is
 * `out = src + dst * (1 - srcA)`, the same expression on all four channels, no
 * divide and no special case anywhere. With three layers stacked that is three
 * divides and three undefined regions avoided.
 *
 * **The caller must blend this as `(One, OneMinusSrcAlpha)`**, which is what a
 * premultiplied "over" is once it reaches the fixed-function blender. This is
 * the part worth shouting about, because getting it wrong is not an error: the
 * ordinary straight-alpha equation `(SrcAlpha, OneMinusSrcAlpha)` multiplies by
 * the alpha a second time, and the result is a shape that looks right in the
 * middle and has a dark halo around every antialiased edge and around the whole
 * glow. That reads as "the antialiasing is a bit off" rather than as "the blend
 * mode is wrong", and people spend a day on it.
 *
 * Note what this does NOT say, because the obvious reading of it is a trap in
 * three specifically: it does not say to set `premultipliedAlpha` on the
 * material. That flag asks three to premultiply the fragment IN THE SHADER, on
 * top of setting the blend equation, and a colour that arrives here already
 * premultiplied would be premultiplied twice, which is the same dark halo by a
 * different route. `shapes.ts` sets the blend factors directly and records the
 * line of three's own source that settles it.
 */
export interface Rgba<T> extends Rgb<T> {
  readonly a: T;
}

/**
 * Everything the shading of one shape needs, and nothing about its geometry.
 *
 * Widths are in the SAME UNITS AS THE DISTANCE, which is to say world units.
 * That is what makes an outline scale with the shape rather than with the
 * screen, and it is the choice a graph view wants: a node box and its border
 * should keep their proportions as you zoom, and a border specified in pixels
 * would grow relative to its own node every time you zoomed out.
 *
 * Colours and opacities are NOT clamped by {@link shadeDistance}, and the widths
 * are. The line is drawn there rather than everywhere for a reason: a negative
 * width inverts the SIGN of an alpha, and a negative alpha composited with
 * `dst * (1 - srcAlpha)` amplifies the layer beneath it instead of covering it,
 * so one bad width corrupts the other two layers. A colour above one, by
 * contrast, is a perfectly ordinary high dynamic range colour that a later bloom
 * pass may want, and clamping it here would silently destroy an input rather
 * than protect anything. The premultiplication invariant is therefore stated,
 * and tested, conditionally on the colours and opacities being in `[0, 1]`.
 */
export interface ShapeStyle<T> {
  readonly fill: Rgb<T>;
  readonly fillOpacity: T;
  readonly outline: Rgb<T>;
  /** The band's total thickness, measured INWARD from the boundary. */
  readonly outlineWidth: T;
  readonly outlineOpacity: T;
  readonly glow: Rgb<T>;
  /** How far outside the boundary the glow reaches before it is fully out. */
  readonly glowWidth: T;
  readonly glowOpacity: T;
}

/** `min(max(value, 0), 1)`, which is what `clamp` is in this nine-op algebra. */
function clamp01<T>(ops: SdfOps<T>, value: T): T {
  return ops.min(ops.max(value, ops.literal(0)), ops.literal(1));
}

/**
 * How much of a pixel the shape covers, given the signed distance at the pixel
 * centre and the width of one pixel in the distance's own units.
 *
 * `clamp(0.5 - distance / filterWidth, 0, 1)`, a linear box filter, and the
 * linearity is the point. For a straight edge crossing a pixel, the covered
 * fraction of that pixel is the area of a half plane clipped to a square, and
 * that area is LINEAR in the signed distance from the pixel centre to the edge.
 * So this is not an approximation to the answer for the case that dominates a
 * graph view, it is the answer. `smoothstep`, which is what most shader code
 * reaches for here, gives 0.156 where the truth is 0.25: it renders the outer
 * half of every edge too dark and the inner half too light, which reads as
 * slightly soft, slightly heavy strokes everywhere and is hardest to spot
 * precisely because it is everywhere.
 *
 * **`filterWidth` is a parameter, never computed here.** On the GPU it is
 * `fwidth(distance)`, a screen-space derivative that exists only inside a
 * fragment shader: there is no value a test could pass and no way for a test to
 * evaluate it. Taking it as an argument is what makes every line of this file
 * testable over plain numbers. It is also the better factoring on its own
 * merits, since the caller is the one that knows what a pixel is worth here, and
 * a caller that wants a deliberately softer or a supersampled edge gets it by
 * passing a different width rather than by forking this function.
 *
 * The width is floored at {@link MIN_FILTER_WIDTH}, which also absorbs a
 * negative one. See that constant for the `NaN` this prevents and for why the
 * magnitude is what it is.
 *
 * Scale invariant: `coverage(k d, k w) = coverage(d, w)` exactly, to within an
 * ulp of the division. With the distance fields being homogeneous of degree one
 * (see `sdf.ts`), that is the entire argument that a Dagr shape is equally crisp
 * at every zoom, and the two halves are asserted in the two test files.
 */
export function coverage<T>(ops: SdfOps<T>, distance: T, filterWidth: T): T {
  const width = ops.max(filterWidth, ops.literal(MIN_FILTER_WIDTH));
  return clamp01(ops, ops.sub(ops.literal(0.5), ops.div(distance, width)));
}

/**
 * How strongly the glow is present at this distance: one at and inside the
 * boundary, zero at `glowWidth` and beyond, a squared ramp in between.
 *
 * Squared rather than linear because `t^2` has zero slope where it reaches zero,
 * so the outer edge of the glow simply stops being there, where a linear ramp
 * leaves a discontinuity in the derivative that the eye picks up as a faint ring
 * at the glow's outer radius (a Mach band). The inner end keeps its slope break,
 * and that is fine: it sits underneath the fill and the outline and is never
 * seen. Two multiplies, nothing transcendental, and it is spellable in the nine
 * operations, which an exponential is not.
 *
 * It gets no antialiasing of its own and needs none: it is already a smooth ramp
 * many pixels wide, and it does not read the filter width at all, which the
 * suite asserts rather than assumes.
 *
 * The width is floored at {@link MIN_FILTER_WIDTH} because it is a denominator,
 * so a glow width of zero leaves the degenerate ramp (on at the boundary, off
 * immediately outside it) rather than `NaN`.
 */
function glowFalloff<T>(ops: SdfOps<T>, distance: T, glowWidth: T): T {
  const width = ops.max(glowWidth, ops.literal(MIN_FILTER_WIDTH));
  const ramp = clamp01(ops, ops.div(ops.sub(width, distance), width));
  return ops.mul(ramp, ramp);
}

/** A colour scaled by its own alpha, which is what premultiplied means. */
function premultiply<T>(ops: SdfOps<T>, colour: Rgb<T>, alpha: T): Rgba<T> {
  return {
    r: ops.mul(colour.r, alpha),
    g: ops.mul(colour.g, alpha),
    b: ops.mul(colour.b, alpha),
    a: alpha,
  };
}

/**
 * Porter and Duff "over" on premultiplied colours: `out = src + dst * (1 - srcA)`,
 * the same expression on all four channels.
 *
 * Note what is NOT here: no divide, no branch on a zero alpha, and no separate
 * formula for the alpha channel. That is the whole return on premultiplying, and
 * it is why the invariant `r <= a` survives a stack of layers: both terms are
 * bounded on colour exactly as they are bounded on alpha.
 */
function over<T>(ops: SdfOps<T>, src: Rgba<T>, dst: Rgba<T>): Rgba<T> {
  const keep = ops.sub(ops.literal(1), src.a);
  return {
    r: ops.add(src.r, ops.mul(dst.r, keep)),
    g: ops.add(src.g, ops.mul(dst.g, keep)),
    b: ops.add(src.b, ops.mul(dst.b, keep)),
    a: ops.add(src.a, ops.mul(dst.a, keep)),
  };
}

/**
 * The premultiplied colour of one fragment, from one signed distance.
 *
 * ## The outline is INSET
 *
 * The band runs from the boundary INWARD, so its outer edge is the shape's own
 * edge: `outlineAlpha = outlineOpacity * (coverage(d) - coverage(d + width))`.
 * The alternative, an outline centred on the boundary, grows the shape by half
 * the outline on every side, so a 100 by 40 node box with a 2 unit outline
 * occupies 101 by 41 and disagrees with the layout that placed it. That
 * disagreement is invisible on one node and shows up as boxes touching where the
 * layout left a gap, and as hit testing that misses along every edge.
 *
 * **The band's alpha is never negative**, and no clamp is needed to make that
 * true. {@link coverage} is non-increasing in its distance argument (its whole
 * body is a negated division inside a clamp), and the width is floored at zero
 * just below, so `d + width >= d` gives `coverage(d + width) <= coverage(d)` and
 * the difference is at least zero. Worth being sure of rather than clamping
 * anyway: a negative alpha does not merely hide the outline, it composites as
 * `dst * (1 - srcAlpha)` with `srcAlpha < 0`, which AMPLIFIES the fill beneath
 * it and blows out the very edge it was meant to draw.
 *
 * **A hairline outline fades, it does not alias.** Once the outline is thinner
 * than a pixel, the peak alpha the band reaches is exactly
 * `outlineWidth / filterWidth`: at any distance where both coverage terms are in
 * the linear part of the ramp their difference is that ratio identically, which
 * is measured in the suite for widths from half a pixel down to a millionth of
 * one. That is the right answer rather than a lucky one, because that ratio IS
 * the fraction of the pixel the band covers. A band that stayed opaque as it
 * thinned is what makes hairline strokes crawl and sparkle when a view is zoomed
 * out, and it is the single most common antialiasing artefact in a graph
 * renderer.
 *
 * ## The glow is outside-only in effect
 *
 * It is at full strength at and inside the boundary too, but it is composited
 * UNDER the fill, so an opaque fill hides it entirely and only the part reaching
 * outside the shape is ever seen. Writing it that way rather than masking it to
 * `d > 0` avoids a seam at the boundary, where a masked glow would meet the
 * fill's own antialiased edge and leave a one pixel line of background showing
 * through.
 *
 * ## Composite order
 *
 * Glow, then fill over it, then outline over that. The outline last because it
 * is inset, so it lies entirely within the region the fill also covers and would
 * otherwise be invisible under an opaque fill. The glow first because it is the
 * only layer that reaches outside the shape.
 *
 * ## What is clamped and what is not
 *
 * The two widths are floored at zero (the outline's here, the glow's inside
 * {@link glowFalloff}), because a negative width is the one input that inverts
 * the sign of an alpha and so corrupts the layers around it. Opacities and
 * colours are passed through untouched: see {@link ShapeStyle} for why an HDR
 * colour is a legitimate input and clamping it would destroy information rather
 * than protect anything.
 */
export function shadeDistance<T>(
  ops: SdfOps<T>,
  distance: T,
  filterWidth: T,
  style: ShapeStyle<T>,
): Rgba<T> {
  const zero = ops.literal(0);

  const edge = coverage(ops, distance, filterWidth);
  const outlineWidth = ops.max(style.outlineWidth, zero);
  const innerEdge = coverage(ops, ops.add(distance, outlineWidth), filterWidth);

  const glowAlpha = ops.mul(style.glowOpacity, glowFalloff(ops, distance, style.glowWidth));
  const fillAlpha = ops.mul(style.fillOpacity, edge);
  const outlineAlpha = ops.mul(style.outlineOpacity, ops.sub(edge, innerEdge));

  const glowLayer = premultiply(ops, style.glow, glowAlpha);
  const fillLayer = premultiply(ops, style.fill, fillAlpha);
  const outlineLayer = premultiply(ops, style.outline, outlineAlpha);

  return over(ops, outlineLayer, over(ops, fillLayer, glowLayer));
}
