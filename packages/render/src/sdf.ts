import type { Size } from './types.js';

/**
 * The signed distance fields M4.2's shapes are made of, as ordinary numbers.
 *
 * Nothing here imports three, and nothing here knows what a shader is. That is
 * the point of the file. The TSL nodes that actually draw these shapes are
 * transcriptions of the arithmetic below, and a transcription is checked by a
 * screenshot, which can tell you that something looked plausible at one zoom on
 * one machine and cannot tell you that a corner is a circular arc rather than a
 * curve that resembles one. So the math is PROVED here, on the CPU, in
 * `test/sdf.test.ts`, and the shader's job is to agree with it.
 *
 * The module is exported from the package rather than kept internal because two
 * later tasks need exactly this and not the shader: M4.8's picking asks whether
 * a world point is inside a shape, which is the sign of
 * {@link roundedRectDistance}, and M4.4's bounds ask how much room a shape
 * needs, which is {@link shapeQuadSize}. Both would otherwise reimplement it,
 * and a second copy of a distance field is a second chance to get a sign wrong.
 *
 * ## Conventions, stated once
 *
 * **Distances are SIGNED and NEGATIVE INSIDE.** That is the graphics convention
 * and the one the TSL side uses, so a point is inside a shape exactly when its
 * distance is at most zero, and the boundary reads exactly zero.
 *
 * **Points are in SHAPE-LOCAL space, with the origin at the shape's centre.**
 * Not world space: a shape does not know where it is. World y is up, as
 * everywhere else in this package (see `camera.ts`), which for a field
 * symmetric in `y` matters only in that a caller must not flip the sign on the
 * way in and expect the same answer for an asymmetric extension later.
 *
 * **Sizes in and out are FULL extents where the type says `Size`, and HALF
 * extents where the parameter says `halfWidth`.** The distance functions want
 * half extents because that is what the field's algebra is written in;
 * {@link shapeQuadSize} returns full extents because that is what
 * `PlaneGeometry` takes.
 *
 * ## Which functions validate, and why not all of them
 *
 * The package rule holds: an out-of-range value is a `RangeError` naming the
 * field, and anything else this package throws gets a named class (see
 * `errors.ts`). Nothing here needs a new class.
 *
 * {@link clampCornerRadius}, {@link edgeCoverage}, {@link glowIntensity} and
 * {@link shapeQuadSize} validate. {@link roundedRectDistance} and
 * {@link circleDistance} do not, and that is deliberate rather than an
 * oversight. They are the two functions that take a POINT, and a point is
 * generated rather than written: it comes from a sampling loop, a pick test, a
 * grid. A `RangeError` naming `px` would name the loop variable, not the line
 * that was wrong, and it would put a branch in the innermost loop of M4.8's
 * picking. What makes that safe is that a `NaN` in gives a `NaN` out and a
 * `NaN` distance never reads as a hit: every comparison against `NaN` is false,
 * so `distance <= 0` is false and the point is outside every shape. The shape
 * arguments those two take have their own gate in {@link clampCornerRadius},
 * which every caller is expected to pass a radius through; checking it again
 * per sample buys nothing.
 */

/** Rejects a value that is not a finite number, naming the field. */
function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} has to be a finite number, got ${String(value)}`);
  }
  return value;
}

/** Rejects a value that is not a finite number of at least zero. */
function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} has to be a finite number of at least zero, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * The exact signed distance from a shape-local point to a rounded rectangle
 * centred on the origin, negative inside.
 *
 * EXACT, everywhere, and not an approximation that is good enough near the
 * boundary. The distinction is not academic: the cheap version of this field
 * (drop the interior term, clamp `q` and stop) is correct outside the shape and
 * wrong inside the corner squares, and everything downstream reads the interior
 * too. {@link edgeCoverage} needs a true distance on both sides of the boundary
 * or the antialiasing band is not centred on it; M4.8's picking needs the sign
 * to be right in the corners, which is precisely where a user aiming at a node
 * is most likely to click and miss. The suite pins exactness by walking the
 * real boundary of the real shape and comparing against the nearest point it
 * can find, rather than by asserting the formula against itself.
 *
 * The formula is the standard one:
 *
 * ```
 * q = abs(p) - halfSize + r
 * d = length(max(q, 0)) + min(max(q.x, q.y), 0) - r
 * ```
 *
 * Read it as: shrink the rectangle by `r` on every side, take the plain box
 * field of the shrunken rectangle (`length(max(q, 0))` outside it, `min(max(q.x,
 * q.y), 0)` inside, exactly one of which is non-zero), then subtract `r` to
 * grow the whole field back out. Growing a distance field by a constant is
 * literally what rounding a corner is, which is why the corner comes out as a
 * circular arc rather than as anything that merely looks like one.
 *
 * `radius` is expected to lie in `[0, min(halfWidth, halfHeight)]`; pass it
 * through {@link clampCornerRadius} first. A larger radius does not throw here
 * (see the module docstring on why these two do not validate) but it does not
 * describe a shape either: the shrunken rectangle turns inside out and the
 * field is not the field of anything.
 *
 * At `radius` 0 this is the plain box field, and at `radius` equal to the half
 * extent of a SQUARE it is a circle, agreeing with {@link circleDistance} to
 * within an ulp. The suite checks both, and the circle case is the strongest
 * check in it: nothing survives it that has a sign or a `min`/`max` wrong.
 */
export function roundedRectDistance(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(px) - halfWidth + radius;
  const qy = Math.abs(py) - halfHeight + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/**
 * The exact signed distance from a shape-local point to a circle centred on the
 * origin, negative inside.
 *
 * A separate function rather than `roundedRectDistance(px, py, r, r, r)`, even
 * though the two agree to an ulp, because this one is what a circle IS: two
 * multiplications and a subtraction against six operations and four branches,
 * and it says "circle" at the call site instead of leaving a reader to notice
 * that three arguments happen to be equal. The equivalence is a test, not an
 * implementation.
 *
 * `Math.hypot` rather than `Math.sqrt(px * px + py * py)`: it is the version
 * that does not overflow to infinity for a point far enough out, and the two
 * agree to an ulp otherwise.
 */
export function circleDistance(px: number, py: number, radius: number): number {
  return Math.hypot(px, py) - radius;
}

/**
 * Holds a corner radius inside `[0, min(halfWidth, halfHeight)]`, the range in
 * which it describes a shape.
 *
 * The upper bound is where the four corner arcs meet: at exactly that radius a
 * square is a circle and a rectangle is a stadium, and past it the arcs would
 * have to overlap, which no rounded rectangle does. Callers get a radius from a
 * theme or a style, so a radius larger than the shape is the ordinary case of a
 * small node under a design that rounds generously, not a mistake worth
 * throwing over.
 *
 * **A NEGATIVE radius clamps to 0 rather than throwing.** That is the decision,
 * and it follows the package's existing split rather than making a new one.
 * `Camera2D.setZoom` clamps a zoom that overshoots its range and rejects only a
 * zoom that no clamp could mean anything by, and the test is whether a NEUTRAL
 * answer exists. For a corner radius it does, and it is 0: a square corner, the
 * thing "no rounding" means. A function named `clampCornerRadius` that clamped
 * one end of its range and threw at the other would also be a surprise on its
 * own terms.
 *
 * The two half extents are NOT clamped, only checked. They are not a value that
 * overshoots from a gesture, they are the shape's own size, and a negative one
 * means the caller's size arithmetic is wrong; substituting 0 there would draw
 * a shape nobody asked for and hide the line that caused it. A zero-sized shape
 * is legal and clamps every radius to 0.
 *
 * Non-finite input is a `RangeError` naming the field, on all three parameters.
 */
export function clampCornerRadius(radius: number, halfWidth: number, halfHeight: number): number {
  requireFinite(radius, 'radius');
  requireNonNegative(halfWidth, 'halfWidth');
  requireNonNegative(halfHeight, 'halfHeight');
  return Math.min(Math.max(radius, 0), Math.min(halfWidth, halfHeight));
}

/**
 * How much of a fragment the shape covers, from the signed distance at that
 * fragment: 1 well inside, 0 well outside, and a smooth ramp across a band of
 * width `filterWidth` centred on the boundary.
 *
 * This is the analytic antialiasing an SDF exists to make possible. A shape
 * drawn by a hard `distance < 0` test has stair-stepped edges no amount of
 * scene-level multisampling fixes cheaply; a shape drawn through this one has
 * an edge whose softness is exactly one pixel wide at every zoom, because the
 * band is derived per fragment rather than baked in.
 *
 * **The formula, written down so the shader can be checked against it:**
 *
 * ```
 * smoothstep(filterWidth / 2, -filterWidth / 2, distance)
 * ```
 *
 * with the standard cubic `t * t * (3 - 2 * t)` over `t` clamped to `[0, 1]`,
 * and with the edges in DESCENDING order, which is what makes coverage fall as
 * the distance grows. It reads 1 at `-filterWidth / 2`, exactly 0.5 on the
 * boundary and 0 at `+filterWidth / 2`. Pinned by value in the suite, at the
 * quarter points as well as the ends, so that a linear ramp or a quintic
 * smootherstep substituted for the cubic fails rather than passes.
 *
 * **The shader computes `filterWidth` from `fwidth(distance)`; this function
 * takes it as a parameter, because a CPU has no screen-space derivative.**
 * `fwidth` is how much the distance changes between adjacent fragments, which
 * is how many world units a pixel is worth right there, and it is the whole
 * reason the edge stays one pixel soft under any zoom or any projection. There
 * is no way to compute it from a single sample, so the CPU twin is a function
 * of one more argument than its shader counterpart, and a test that wants the
 * shader's behaviour passes the pixel size in world units.
 *
 * A `filterWidth` of 0 does not divide by zero: it degenerates to a hard step,
 * 1 inside and 0 outside, with 0.5 exactly on the boundary. The half is the
 * Heaviside convention and it is chosen so that the degenerate case is the
 * limit of the smooth one at EVERY distance rather than at every distance but
 * that one. Getting this wrong is expensive out of proportion to how rare it
 * is: `NaN` coverage composites as nothing at all, so the shape does not
 * appear, and there is no error anywhere to say why.
 *
 * A negative or non-finite `filterWidth` is a `RangeError` naming the field.
 * `distance` is not validated: see the module docstring on why the functions
 * that take a distance or a point leave it to propagate.
 */
export function edgeCoverage(distance: number, filterWidth: number): number {
  requireNonNegative(filterWidth, 'filterWidth');
  if (filterWidth === 0) {
    if (Number.isNaN(distance)) return Number.NaN;
    if (distance === 0) return 0.5;
    return distance < 0 ? 1 : 0;
  }
  const t = Math.min(Math.max(0.5 - distance / filterWidth, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How bright the glow is at a fragment, from the signed distance: 1 at the
 * boundary and anywhere inside, falling to 0 at `glowRadius` beyond it.
 *
 * **The falloff is quadratic, `(1 - distance / glowRadius) ** 2`,** and the
 * reason is the far end rather than the near one: it reaches zero with zero
 * SLOPE as well as zero value, and the eye reads a discontinuity in the
 * gradient as an edge just as readily as one in the value, so a linear ramp,
 * which arrives at the quad's edge still falling at `-1 / glowRadius`, ends the
 * glow in a faint visible outline exactly where the geometry stops. The near
 * end is a bonus: dropping fast next to the shape and flattening into a long
 * dim tail is what light bloom does, where a linear ramp reads as a flat halo
 * with a rim.
 *
 * Compact support is not negotiable here, which rules out the other obvious
 * choice. An exponential falloff never reaches zero, so whatever quad it is
 * drawn on cuts it off at some non-zero value, and the symptom is a straight
 * edge across a glow. See {@link shapeQuadSize}.
 *
 * Saturated at 1 inside, rather than continuing to grow: the glow is the
 * falloff OUTSIDE the shape, and whatever draws the fill draws over the inside
 * anyway. Measured from the shape's own boundary, not from the outer edge of
 * any outline, which is what lets {@link shapeQuadSize} take the LARGER of the
 * two reaches instead of their sum.
 *
 * A `glowRadius` of 0 does not divide by zero: it degenerates to 1 inside and
 * on the boundary, 0 outside, which is the limit of the general case and also
 * what "no glow" means once the fill has drawn over it. No glow is the common
 * case, so this must not be the branch that fills the scene with `NaN`.
 *
 * A negative or non-finite `glowRadius` is a `RangeError` naming the field.
 */
export function glowIntensity(distance: number, glowRadius: number): number {
  requireNonNegative(glowRadius, 'glowRadius');
  if (glowRadius === 0) {
    if (Number.isNaN(distance)) return Number.NaN;
    return distance <= 0 ? 1 : 0;
  }
  const t = Math.min(Math.max(distance / glowRadius, 0), 1);
  const remaining = 1 - t;
  return remaining * remaining;
}

/**
 * How much of a shape's own larger HALF extent is added to its quad on every
 * side, on top of whatever the outline and the glow ask for, so that
 * {@link edgeCoverage}'s antialiasing ramp has somewhere to land.
 *
 * **The problem this solves.** The ramp is one screen pixel wide and centred on
 * the boundary, so it reaches half a pixel PAST the shape, and half a pixel in
 * WORLD units is `0.5 / zoom`. Geometry is built once and the zoom changes
 * without it being rebuilt, so a quad cannot reserve that width directly. A
 * shape with no outline and no glow therefore used to end exactly at its own
 * boundary and have the outer half of its ramp clipped at the four edge
 * midpoints, which reads as an edge slightly harder and thinner than the rest.
 *
 * **Why a proportional pad works anyway.** A pad of `f * halfExtent` world
 * units is `f * halfExtentPx` on screen, whatever the zoom, because both sides
 * scale together: the pad measured in pixels grows with the shape's on-screen
 * size while the ramp stays about a pixel. So the pad covers the ramp's outer
 * half exactly when
 *
 * ```
 * f * halfExtentPx >= 0.5   which is   halfExtentPx >= 0.5 / f
 * ```
 *
 * **At `f = 0.015` that threshold is 33.3 CSS pixels of half extent**, so about
 * 67 pixels across. A shape bigger than that on screen has its whole ramp
 * inside its quad at any zoom; below it the shape is a sub-70-pixel blob and
 * what is clipped is the outer half of a one-pixel ramp on four edge midpoints.
 *
 * The LARGER half extent drives both axes, rather than each axis padding
 * itself. The ramp is one pixel wide on every edge whichever way the edge runs,
 * so a per-axis pad would under-pad the short axis of a wide flat node, which
 * is exactly the shape whose long edges show the clipping first.
 *
 * The cost is 1.5% of the larger half extent per side: a 100 by 40 node's quad
 * grows to 101.5 by 41.5, which is a sliver against any glow and against
 * M4.4's culling bounds, both of which are built from {@link shapeQuadSize}.
 *
 * Exported so the material builder and any future geometry code read the same
 * number rather than each picking one. Two paddings that disagree would size a
 * quad for one ramp and evaluate another, with nothing anywhere reporting it.
 */
export const AA_QUAD_PADDING_FRACTION = 0.015;

/**
 * How big the quad under a shape has to be, in world units, so that nothing the
 * shader paints falls off the edge of it.
 *
 * **An SDF shape is drawn on a quad, and anything the shader paints beyond the
 * quad is simply not there.** That is the whole content of this function and it
 * is worth being blunt about, because the failure mode does not look like a
 * geometry failure. The fragment shader is only ever asked about fragments the
 * rasteriser produced, and the rasteriser produces fragments inside the
 * triangles it was given. A glow that reaches further than the quad is not
 * dimmed at the quad's edge, it stops: a soft radial falloff with a razor
 * straight cut across it, on one or two sides, changing with the shape's
 * proportions. Every instinct says shader bug, and there is nothing wrong with
 * the shader.
 *
 * **The margin on every side is**
 *
 * ```
 * max(outlineWidth / 2, glowRadius)
 *   + AA_QUAD_PADDING_FRACTION * max(halfWidth, halfHeight)
 * ```
 *
 * The outline STRADDLES the boundary, half in and half out, so it reaches
 * `outlineWidth / 2` past the edge and needs that much room, not the whole
 * width. The glow starts AT the boundary and reaches outward, so it needs all
 * of `glowRadius`. The third term is room for {@link edgeCoverage}'s ramp,
 * which is a screen-space width no geometry can know in world units, and
 * {@link AA_QUAD_PADDING_FRACTION} carries the whole argument for handling it
 * with a proportion: the pad covers the ramp's outer half once the shape's
 * larger half extent measures 33.3 CSS pixels on screen, at any zoom.
 *
 * That third term is ADDED to the first two rather than folded into the `max`,
 * because it is not a reach of the same field. The outline's and the glow's
 * outer edges are level sets of the distance and lie on top of each other; the
 * ramp is centred on whichever of those the shader draws last and spills half a
 * pixel past it.
 *
 * The two are combined with `max` and not with `+`, and this is the one line in
 * the file that depends on a decision made elsewhere in the module, so it is
 * worth stating why it is safe. Both {@link edgeCoverage} and
 * {@link glowIntensity} read the SAME signed distance, measured from the same
 * boundary: the outline's outer edge is the level set `distance ===
 * outlineWidth / 2`, and the glow's outer edge is `distance === glowRadius`.
 * The painted region is the union, so it reaches whichever level set is
 * further, and summing the two would inflate every quad in the scene and
 * M4.4's culling bounds with it. **If the TSL side ever measures the glow from
 * the OUTLINE's outer edge rather than the shape's, this becomes a sum, and
 * this function has to change with it.** A consequence of measuring from the
 * shape, worth knowing before it looks like a bug: an outline wider than twice
 * the glow radius hides the glow entirely, because the whole falloff lies under
 * it.
 *
 * **The return is FULL width and height, not half extents**, because that is
 * what `PlaneGeometry` takes. Half extents here draw every shape at a quarter
 * of its area, which looks like a layout bug rather than a geometry one.
 *
 * What this still does NOT cover, stated rather than left to be discovered:
 * the ramp of a shape SMALLER than about 67 CSS pixels across on screen. The
 * pad is a proportion of the shape, so below the 33.3-pixel half extent that
 * {@link AA_QUAD_PADDING_FRACTION} works out to, it is narrower than the half
 * pixel the ramp spills, and the outermost sliver of that ramp is clipped at
 * the four edge midpoints. There is no fix available to a function that sizes
 * geometry once for every zoom, only a bigger constant that would inflate every
 * quad in the scene to buy a fraction of a pixel on the smallest shapes in it.
 *
 * Non-finite or negative input is a `RangeError` naming the field. A ZERO-sized
 * shape is legal and does not throw: a node whose label has not been measured
 * yet is zero-sized for a frame, and taking the scene down over a shape nobody
 * can see would be the worse failure. It gets no antialiasing pad, a proportion
 * of nothing being nothing, which is right: there is no edge to ramp across.
 */
export function shapeQuadSize(size: Size, outlineWidth: number, glowRadius: number): Size {
  requireNonNegative(size.width, 'size.width');
  requireNonNegative(size.height, 'size.height');
  requireNonNegative(outlineWidth, 'outlineWidth');
  requireNonNegative(glowRadius, 'glowRadius');

  const halfExtent = Math.max(size.width, size.height) / 2;
  const margin = Math.max(outlineWidth / 2, glowRadius) + AA_QUAD_PADDING_FRACTION * halfExtent;
  return { width: size.width + 2 * margin, height: size.height + 2 * margin };
}
