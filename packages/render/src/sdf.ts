import type { Size } from './types.js';

/**
 * The signed distance fields M4.2 draws with, and the coverage functions that
 * turn one into an alpha, written ONCE for two backends.
 *
 * **A TSL node graph builds in Node but does not evaluate.** `Fn(([p]) => ...)`
 * returns a node with `isNode === true` under bare Node with no device, so the
 * graph is constructible; `getNodeType` needs a builder and code generation
 * needs a real renderer backend, so the arithmetic inside it cannot be run
 * without a GPU. The obvious response is to write each formula twice, once in
 * TSL for the shader and once in TypeScript for the tests, and that is the thing
 * this file exists not to do. Two copies of a rounded-box SDF are two chances to
 * get the `min` term wrong, and the test suite would then be checking the copy
 * that never runs on a GPU against nothing at all.
 *
 * So every formula here is generic over {@link Arith}, an interface of NINE
 * arithmetic primitives. `numberArith` below implements them with `Math`;
 * `sdf-nodes.ts` implements them with TSL. `test/sdf.test.ts` therefore executes
 * the exact expression tree the fragment shader evaluates, node for node, and
 * the surface no Node test can reach shrinks from six formulas to nine one-line
 * adapters plus three pieces of TSL that cannot be written over a float interface
 * at all. `sdf-nodes.ts`'s module docstring names all three and says which of them
 * a structural assertion stands in for.
 *
 * One consequence worth spelling out: a shader computes a hypotenuse as
 * `sqrt(x*x + y*y)`, and there is no `hypot` in WGSL. Written twice, the scalar
 * copy would reach for `Math.hypot`, which is a DIFFERENT function: it rescales
 * to avoid intermediate overflow and is accurate to under an ulp where the naive
 * form is not. The two spellings then disagree in the last bits, and a test
 * asserting exact equality between a distance and a hand-computed euclidean
 * length either fails for a reason that is not a bug or is loosened until it
 * stops catching real ones. Sharing one definition removes the question.
 *
 * ## Units, stated once
 *
 * Distances, radii and glow radii are WORLD units. Outline widths are CSS
 * PIXELS, because the whole point of an SDF is that a two pixel outline is two
 * pixels wide at every zoom. `aaWidth` is the bridge: one CSS pixel measured in
 * world units, which is exactly `1 / zoom`. In the shader it is not read off the
 * camera but measured from the field itself, as
 * `length(vec2(dFdx(d), dFdy(d)))`. That works because these are TRUE euclidean
 * distances, so the gradient of the field has magnitude 1 in world space and its
 * screen-space gradient magnitude is world units per pixel and nothing else. It
 * also means the antialiasing follows any transform the mesh picks up without
 * being told about it.
 *
 * ## Validation
 *
 * **Validated at the scene boundary, never inside a coverage function.** The
 * package rule from `errors.ts` applies as written (an out-of-range value is a
 * `RangeError` naming the field), and the only decision left is where. A
 * coverage function is called once per fragment per frame, which is millions of
 * times a second on the GPU and zero times in JavaScript for the path that
 * matters, so a check inside one costs real ALU on every pixel and cannot throw
 * anywhere a caller would see it. {@link requireShapeStyle},
 * {@link requireCornerRadius} and {@link requireCircleRadius} are the boundary
 * instead: they run once per shape, at the moment a caller's number is turned into
 * geometry, and {@link quadPadding} calls the first of them because sizing a quad is
 * the first thing any style is used for. Every one of them takes the field name from
 * its caller, so the message says which shape and which field rather than which
 * variable.
 */

/**
 * The nine arithmetic primitives every formula in this file is built from.
 *
 * Nine, and not ten. Each member is one line in `sdf-nodes.ts` that no Node test
 * can execute, and it is worth keeping the count small enough to read. It is NOT
 * the whole of this package's untested arithmetic surface, which is these nine plus
 * the three pieces of TSL named in the module docstring above: writing the two as
 * the same thing is the mistake that got copied into five files before
 * api-design-review caught it. `clamp`, `smoothstep`, `oneMinus` and `length` all
 * exist as TSL builtins and as WGSL intrinsics, and the first three are absent here
 * deliberately, because adding them would move a formula out of the tested half of
 * the file for the sake of a few instructions. `length` is the exception and is used
 * as an intrinsic in exactly one place. See {@link smoothstepBetween} for what
 * building the others costs.
 *
 * `literal` is what lifts a plain number into the backend's value type. Every
 * other member takes and returns `T` only, so a formula written over this
 * interface cannot accidentally depend on a JavaScript number reaching the
 * shader as a constant when it should have been a uniform.
 *
 * The two implementations agree on finite values. They are free to disagree
 * about `NaN` (WGSL leaves `min(NaN, x)` implementation defined where `Math.min`
 * returns `NaN`), about signed zero and about denormals. Nothing here makes a
 * claim about a non-finite input, which is why the inputs that could produce one
 * are rejected at the boundary instead.
 */
export interface Arith<T> {
  /** Lifts a plain number into the backend's value type. */
  literal(value: number): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  abs(a: T): T;
  min(a: T, b: T): T;
  max(a: T, b: T): T;
  sqrt(a: T): T;
}

/**
 * The nine primitives on plain numbers: what `test/sdf.test.ts` runs every
 * formula through.
 *
 * Deliberately thin to the point of looking pointless. Anything clever in here
 * (a fast reciprocal, a guard against a zero denominator) would be a difference
 * between what the test executes and what the shader executes, which is the one
 * property this whole arrangement exists to buy.
 */
export const numberArith: Arith<number> = {
  literal: (value) => value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  abs: (a) => Math.abs(a),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  sqrt: (a) => Math.sqrt(a),
};

/**
 * The signed distance from `px, py` to a rounded rectangle centred on the
 * origin, in the same units as its inputs.
 *
 * Negative inside, zero on the boundary, and the TRUE euclidean distance
 * outside. The last of those is what the `sqrt` buys and what the whole file
 * depends on: an L1 or L-infinity approximation would be cheaper and would give
 * an antialiasing ramp whose width depended on the angle of the edge, which is
 * visible as corners softer than the sides they join.
 *
 * The standard form, and the standard form's `min` term is the part worth
 * reading twice. `q` is the offset from the corner arc's centre, pushed out by
 * the radius on both axes. Outside the shape at least one component of `q` is
 * positive and the euclidean length of the clamped `q` is the distance to the
 * arc; inside, both components are negative, the length term is zero, and
 * `min(max(qx, qy), 0)` is the distance to the nearest of the four straight
 * edges. Dropping that `min` leaves a field that is zero everywhere inside, so
 * every shape becomes a hollow outline and nothing else in this file notices.
 *
 * `radius` is the corner radius, and it has to lie in `[0, min(halfWidth,
 * halfHeight)]`. Not checked here: see the module docstring on where validation
 * lives, and {@link requireCornerRadius} for the check itself. At radius 0 this
 * is exactly a box SDF, and at radius equal to half the smaller dimension it is
 * a stadium, or a circle if the rectangle is square.
 */
export function roundedRectDistance<T>(
  m: Arith<T>,
  px: T,
  py: T,
  halfWidth: T,
  halfHeight: T,
  radius: T,
): T {
  const zero = m.literal(0);
  const qx = m.add(m.sub(m.abs(px), halfWidth), radius);
  const qy = m.add(m.sub(m.abs(py), halfHeight), radius);
  const outsideX = m.max(qx, zero);
  const outsideY = m.max(qy, zero);
  const outside = m.sqrt(m.add(m.mul(outsideX, outsideX), m.mul(outsideY, outsideY)));
  const inside = m.min(m.max(qx, qy), zero);
  return m.sub(m.add(inside, outside), radius);
}

/**
 * The signed distance from `px, py` to a circle of radius `radius` centred on
 * the origin.
 *
 * Kept as its own function rather than spelled as a square rounded rect, even
 * though {@link roundedRectDistance} reduces to this expression when `halfWidth
 * === halfHeight === radius`: the `min` term is then identically zero, so both
 * formulas are the same euclidean term minus the same radius and the two shape
 * families AGREE ABOUT WHERE THEIR EDGES ARE, which is the property that lets the
 * scene draw circles with the cheap one. Five operations against eleven, per
 * fragment, for the shape a graph draws most of after boxes.
 *
 * They agree to within a few ulps and not bit for bit, which is worth stating
 * precisely because the difference used to be asserted with `toBe`. The rect
 * computes `qx = (|px| - halfWidth) + radius`, and that does not round back to
 * `|px|` when `halfWidth === radius`, so the `sqrt` argument differs in the last
 * bits even where the `min` term contributes nothing. Measured over 200k
 * pseudo-random points on the 20/20/20 square: 1.9% of them differ, worst
 * absolute difference 7.105e-15, which is two ulps of a distance of 20 and
 * thirteen orders of magnitude below the 1/255 a fragment can show. The zero level
 * sets are not identical either, in the same sense: at 20 units out along an
 * arbitrary angle the rect can read -3.6e-15 where the circle reads exactly 0.
 * `test/sdf.test.ts` sweeps both and asserts the agreement to 12 decimal places.
 */
export function circleDistance<T>(m: Arith<T>, px: T, py: T, radius: T): T {
  return m.sub(m.sqrt(m.add(m.mul(px, px), m.mul(py, py))), radius);
}

/**
 * `smoothstep`, built from the nine primitives: a clamp and the cubic `t * t *
 * (3 - 2t)`.
 *
 * **What this costs against the intrinsic: approximately nothing.** WGSL has a
 * `smoothstep` and TSL exposes it, so this function reads at first like ALU paid
 * for testability. It is not. `smoothstep` is not a hardware instruction on any
 * GPU this package targets: in SPIR-V it is a GLSL.std.450 extended instruction,
 * and a driver expands it inline to a clamp and `t * t * (3 - 2t)`, which is
 * exactly the expression below. `clamp` expands the same way, to a `min` and a
 * `max`. So what is written here IS the intrinsic's own expansion, and the
 * difference in instructions issued is somewhere between zero and one register
 * copy.
 *
 * What it buys is that the ramp the test suite exercises is the ramp the shader
 * evaluates. A builtin `smoothstep` would be an unexecutable tenth primitive,
 * and its clamping behaviour at reversed edges (relied on below) would be a
 * property of somebody else's hardware rather than of a line in this file. That
 * property is therefore had for free, which is worth saying plainly because this
 * docstring used to apologise for 15 to 24 operations per fragment that no
 * hardware ever charged.
 *
 * `edge0` may be GREATER than `edge1`, which gives a descending ramp and is how
 * every coverage function below spells one. Undefined when `edge0 === edge1`:
 * the denominator is zero, and both backends then produce a non-finite ramp
 * parameter rather than a step. `x` exactly halfway between two equal edges is
 * worse again, because `0 / 0` is `NaN` rather than a clamped end.
 *
 * That used to be argued unreachable on the grounds that every denominator below
 * is "an `aaWidth` or a glow radius floored at one pixel, and a pixel has
 * positive width". The argument was about a quantity the shader does not use:
 * `aaWidth` is not one pixel handed down from the camera, it is
 * `length(vec2(dFdx(d), dFdy(d)))`, and that MEASURED gradient is exactly zero
 * wherever the field is locally symmetric across a 2x2 quad. What actually makes
 * the denominator positive is {@link MIN_AA_WIDTH}, which each of the three
 * coverage functions applies to its own `aaWidth` argument before dividing. A
 * caller reaching this function directly is on its own.
 */
export function smoothstepBetween<T>(m: Arith<T>, edge0: T, edge1: T, x: T): T {
  const t = m.min(
    m.max(m.div(m.sub(x, edge0), m.sub(edge1, edge0)), m.literal(0)),
    m.literal(1),
  );
  return m.mul(m.mul(t, t), m.sub(m.literal(3), m.mul(m.literal(2), t)));
}

/**
 * The floor every coverage function puts under its `aaWidth` before dividing by
 * it: `2^-20` world units per pixel, which is a zoom of about a million.
 *
 * **`aaWidth` can be exactly zero.** The module docstring above calls it one CSS
 * pixel measured in world units, and at the top of a frame that is what it is,
 * `1 / zoom`. In the shader it is never read off the camera: it is measured from
 * the field as `length(vec2(dFdx(d), dFdy(d)))`, and both derivatives vanish
 * TOGETHER wherever the field is locally symmetric across the 2x2 quad the
 * hardware differentiates over. A circle at its centre is one such place. So is
 * the strip through a rounded rect where the interior field depends on one axis
 * only: for the 10 by 4 rung with radius 1, `d = |py| - 2` for every `|px| < 3`,
 * so `dFdx(d)` is zero along the whole middle of the shape and `dFdy(d)` is zero
 * on its centre line.
 *
 * What that costs unguarded, measured over `numberArith`: `fillCoverage(-5, 0)`
 * is 0, so a fragment five units INSIDE reports no coverage at all;
 * `outlineCoverage(-2, 2, 0)` is 1, so the same fragment reports a fully covered
 * outline, which composites to a hard band of the outline colour through the
 * middle of a shape; and `fillCoverage(0, 0)` is `NaN`. With the floor the three
 * become 1, 0 and exactly 0.5, which is what each of them means.
 *
 * **Not a demonstrated defect on hardware, and worth saying so.**
 * graphics-feel-review could not reproduce it on a GPU, and the committed 100x
 * frame is clean at the alignment where it would show: a driver is free to pick a
 * 2x2 quad that straddles the symmetry, and evidently these ones do. This is a
 * latent hazard with a severe failure mode, which is the case for a floor rather
 * than for a redesign.
 *
 * **Why here and not in `antialiasWidth`.** One `max` in `sdf-nodes.ts` would be
 * cheaper than one per coverage function, and it was the first thing tried. It
 * also puts the guard in the one part of this package no test can execute:
 * `antialiasWidth` is TSL, it is on the untested list its own module docstring
 * keeps, and a floor written there is a floor whose behaviour at zero is asserted
 * by nothing at all. Here it is three `max` instructions on a fragment shader that
 * already runs a `sqrt` and two derivatives, and every degenerate input above is
 * pinned in `test/sdf.test.ts`.
 *
 * **Why `2^-20` rather than a round number.** Three bounds, and this is the power
 * of two that clears all of them. It has to sit far below any `aaWidth` a real
 * frame produces: `2^-20` is a zoom of 1048576, four orders of magnitude past the
 * 100x the committed screenshots cover and three past the 1024 the zoom
 * invariance tests reach. It has to sit below the point where the shader's float32
 * coordinates run out of resolution, and they run out long first: one ulp of a
 * 1000 unit coordinate in float32 is 6.1e-5, sixty-four times WIDER than this
 * floor, so a frame in which the floor is active is a frame whose distance field
 * has no precision left to antialias with. And it has to keep `distance / aaWidth`
 * finite in float32, which at `2^-20` holds for every distance below `2^108`. A
 * power of two, so the division introduces no rounding of its own and the
 * bit-identical zoom assertions in `test/sdf.test.ts` survive a floor being put
 * underneath them.
 */
export const MIN_AA_WIDTH = 2 ** -20;

/**
 * `aaWidth` with {@link MIN_AA_WIDTH} under it: the first line of all three
 * coverage functions, and the only thing between a measured gradient of zero and
 * a division by it.
 *
 * A `max` and not an added epsilon, deliberately. Adding a small constant would
 * shift the ramp at every fragment in every frame by that constant; a `max`
 * returns the identical double for every `aaWidth` at or above the floor, so no
 * pixel any real zoom produces moves at all.
 */
function flooredAaWidth<T>(m: Arith<T>, aaWidth: T): T {
  return m.max(aaWidth, m.literal(MIN_AA_WIDTH));
}

/**
 * How much of a pixel a filled shape covers, given the signed distance at the
 * pixel's centre and the width of one pixel in world units.
 *
 * 1 well inside, 0 well outside, **exactly 0.5 at distance 0**, monotone across
 * the boundary, and the whole transition is one `aaWidth` wide centred on the
 * boundary. The exact half is the property that matters: it is what makes a
 * shape's apparent edge sit where its geometry says it does, at every zoom and
 * for every `aaWidth`, and it is asserted rather than assumed because a ramp
 * that ran from 0 to 1 over `[0, aaWidth]` instead would inflate every shape by
 * half a pixel and pass a screenshot review.
 *
 * Spelled as a descending `smoothstep` with reversed edges rather than as
 * `1 - smoothstep(-h, h, d)`. Identical output, one subtract fewer per
 * fragment, and the clamp is already the clamp that is wanted.
 *
 * `aaWidth` is floored at {@link MIN_AA_WIDTH}, because the shader measures it and
 * the measurement is exactly zero in places a shape actually has. At zero this
 * would otherwise report no coverage deep inside a shape and `NaN` on its
 * boundary.
 */
export function fillCoverage<T>(m: Arith<T>, distance: T, aaWidth: T): T {
  const half = m.div(flooredAaWidth(m, aaWidth), m.literal(2));
  return smoothstepBetween(m, half, m.sub(m.literal(0), half), distance);
}

/**
 * How much of a pixel an INSET outline band covers.
 *
 * A one-dimensional annulus, spelled as the larger of two signed distances: `d`
 * is the distance out through the band's OUTER edge, `-(d + bandWorld)` is the
 * distance in through its INNER one, and the greater of the two is negative only
 * between them. {@link fillCoverage} of that antialiases a band's edge exactly
 * the way it antialiases a shape's edge, so the band's outer ramp is CENTRED on
 * the boundary, precisely like the fill's, and the band's two 50% points are the
 * boundary itself and `widthPixels` pixels in. That is what "a two pixel outline"
 * means, and it is the sense in which this band is inset: it is drawn over the
 * fill and never against the background, not that its coverage is zero at
 * `d = 0`. At the boundary it is exactly 0.5, the same as the fill's.
 *
 * **A band of `w` pixels has a total coverage of exactly `w` at every sub-pixel
 * phase, and `w` fully covered pixel centres when the boundary is pixel aligned.**
 * The first clause holds unconditionally; the second is the one this docstring
 * used to state on its own, and it is phase dependent. A rasteriser samples
 * coverage at PIXEL CENTRES, which sit at `d = -0.5, -1.5, ...` pixels only when
 * the boundary falls on a pixel EDGE, and where the grid falls is not something a
 * shape controls. Measured at `aaWidth = 1`:
 *
 * ```
 * w=1  boundary on a pixel edge    [1.000, 0.000]         max 1.0  total 1
 * w=1  boundary on a pixel centre  [0.500, 0.500]         max 0.5  total 1
 * w=2  boundary on a pixel edge    [1.000, 1.000, 0.000]  max 1.0  total 2
 * w=2  boundary on a pixel centre  [0.500, 1.000, 0.500]  max 1.0  total 2
 * ```
 *
 * So "even a hairline draws one fully opaque pixel" was true of one phase out of a
 * continuum and false at the other end of it: a one pixel band whose boundary
 * lands on a pixel centre draws two half covered pixels and no opaque one, which
 * is the same defect this milestone already fixed at a different width. What is
 * phase independent is the TOTAL, and the total is what makes the rendering right
 * rather than merely defensible: a `w` pixel band deposits exactly `w` pixels
 * worth of outline colour however the grid falls across it, so a border neither
 * thins nor fattens as a shape moves by a fraction of a pixel, and no energy is
 * invented or lost at any phase. `test/sdf.test.ts` sweeps the phase and asserts
 * the total. What a chosen width then costs at the worst phase is
 * `OUTLINE_PIXELS`'s problem in `shape-scene.ts`, and it is a stronger reason for 2
 * than the legibility argument that constant used to give.
 *
 * **The footprint does not grow, and that is arithmetic rather than a hope.**
 * `max(d, anything)` is never less than `d`, and {@link fillCoverage} is
 * decreasing, so outline coverage is at most fill coverage at every distance,
 * every width and every `aaWidth`, whatever the sign of any of them. Since the
 * alpha a shape writes is `max(glowAlpha * glow, max(fill, outline))`, an outline
 * can never make a pixel more covered than the fill alone already makes it, and
 * so cannot make a shape one pixel bigger than its fill. Read as a cutoff rather
 * than as an inequality: the fill's own ramp already reaches half an `aaWidth`
 * PAST the boundary, and outside the band's centre line this expression returns
 * `d` itself, so the two ramps end at the same place. Identical support,
 * identical alpha at the boundary.
 *
 * **Why the `max` and not `abs(d + half) - half`,** which is the textbook
 * annulus and is algebraically the same field. Because `abs(u) = max(u, -u)`,
 * that form expands to `max(d, -(d + bandWorld))` and the two agree exactly in
 * real arithmetic. In floating point they do not: the textbook form computes
 * `(d + half) - half`, which does not land back on `d`, so the outer ramp is a
 * few ulps off the fill's instead of bit identical to it, coverage at the outer
 * cutoff comes out 1e-29 rather than 0, and zoom invariance holds to 1.4e-16
 * rather than exactly. Written this way the outer branch returns `d` UNROUNDED
 * and all three become exact, at four primitives instead of five and with no
 * `div`. `test/sdf.test.ts` asserts each of them with `toBe`, and pins the one
 * remaining inexactness: the inner branch has real arithmetic in it, so for an
 * aaWidth that is not a dyadic rational the inner cutoff leaves a residue of order
 * `(widthPixels * 2^-53)^2`, GROWING QUADRATICALLY in the width, because the ramp
 * parameter's error is a couple of ulps of `widthPixels * aaWidth` measured
 * against `aaWidth` and `smoothstep` squares it. 2.73e-30 at width 7 is an example
 * rather than a ceiling: it was quoted as a flat 3e-30 bound until that was
 * measured, and width 7 at `aaWidth = 1.1`, which is zoom 0.91 and inside the
 * range the screenshots cover, already exceeds it at 3.06e-30. Thirty orders of
 * magnitude under the 1/255 an 8 bit framebuffer can represent at every width
 * either way, so what is worth asserting is the scaling and not the constant.
 *
 * Shifting the ramp inward by half an `aaWidth`, so that its outermost sample
 * landed on the boundary, is a different thing again and is what this
 * deliberately does NOT do. It buys nothing the footprint paragraph above does
 * not already give, and it costs the pixel grid: the opaque plateau becomes
 * `abs(d + w/2) <= w/2 - 1` in pixel units, which is EMPTY for every band two
 * pixels wide or narrower, so no pixel centre inside a 2 pixel band is ever
 * fully covered. Measured on a zoom 100 frame drawn that way, both pixels of the
 * border came out #bc8932: the amber fill `0xffb703` half mixed with the navy
 * outline `0x023047`, rather than the navy asked for.
 *
 * `widthPixels` is in CSS pixels, so an outline is the same thickness on screen
 * at every zoom, which is the reason to draw one from a distance field at all.
 *
 * `aaWidth` is floored at {@link MIN_AA_WIDTH} HERE and not only inside
 * {@link fillCoverage}, because the band's world width is `widthPixels * aaWidth`
 * and the two have to agree about what a pixel is. At a measured `aaWidth` of zero
 * the unfloored form reported full outline coverage in the middle of a shape;
 * flooring both makes the band `widthPixels * MIN_AA_WIDTH` wide, which reports
 * nothing anywhere but on the boundary itself. The `max` inside `fillCoverage` then
 * sees an already floored width and returns it unchanged, at the cost of one
 * instruction and no reader having to check whether the two agree.
 */
export function outlineCoverage<T>(m: Arith<T>, distance: T, widthPixels: T, aaWidth: T): T {
  const width = flooredAaWidth(m, aaWidth);
  const bandWorld = m.mul(widthPixels, width);
  const inner = m.sub(m.literal(0), m.add(distance, bandWorld));
  return fillCoverage(m, m.max(distance, inner), width);
}

/**
 * How much of a pixel the glow halo covers: 1 on the boundary, falling to 0 at
 * `radiusWorld` outside it, and **1 everywhere inside**.
 *
 * The last clause is the one with a bug behind it. The glow is composited UNDER
 * the fill, so a halo that faded back out towards the middle of the shape would
 * cut a hole wherever the fill is itself less than fully opaque, which is the
 * whole of its antialiasing ramp. Clamping to 1 inside is what makes the glow
 * safe to draw under anything.
 *
 * `radiusWorld` is in WORLD units, not pixels, unlike the outline. A glow is a
 * property of the shape rather than of the screen: a halo that stayed six pixels
 * wide while its shape grew from one pixel to a thousand would read as a
 * different effect at each end of the zoom range, and the shape ladder in
 * `shape-scene.ts` scales each shape's glow with the shape for exactly that
 * reason.
 *
 * `aaWidth` floors the ramp at one pixel. A halo narrower than the sample
 * spacing is a hard step, which is the one thing this file exists to avoid. The
 * cost is that `radiusWorld === 0` still draws a one pixel halo rather than
 * nothing, which is why the scene expresses "no glow" through the glow colour or
 * its alpha and not through a zero radius. Since {@link shapeColorChannel} weights
 * the glow by its own alpha, `glowAlpha === 0` now removes the halo's hue as well
 * as its alpha, so that is the way to say it.
 *
 * That `aaWidth` is itself floored at {@link MIN_AA_WIDTH} first, so the edge is
 * positive even where the shader measures a gradient of zero. Unguarded, a
 * `radiusWorld` and an `aaWidth` both zero made this return 1 OUTSIDE the shape,
 * which is a halo of unbounded reach.
 */
export function glowCoverage<T>(m: Arith<T>, distance: T, radiusWorld: T, aaWidth: T): T {
  const edge = m.max(radiusWorld, flooredAaWidth(m, aaWidth));
  return smoothstepBetween(m, edge, m.literal(0), distance);
}

/**
 * How much of a pixel the SHAPE covers: the alpha a fragment writes, from the
 * three coverages and the glow's own alpha.
 *
 * `max(glowAlpha * glow, max(fill, outline))`, and the `max` rather than the
 * usual `over` chain (`a + b * (1 - a)`) is the whole content of this function.
 * These three coverages are not three independent layers: they are three regions
 * of ONE shape, so the alpha wanted is "how much of this pixel does the shape
 * cover", not "how opaque is a stack of three sheets".
 *
 * **What the `over` chain costs, in numbers rather than in adjectives.** At the
 * boundary the fill and the outline are both exactly 0.5 (see
 * {@link fillCoverage} and {@link outlineCoverage}) and the glow is 1, so for the
 * scene's `glowAlpha` of 0.45 this returns exactly 0.5 while `over` of the glow
 * and the fill returns 0.725 and `over` of all three returns 0.8625. Following
 * the 0.5 alpha contour out, that moves a shape's APPARENT edge 0.36 pixels
 * outward from where its geometry is, all the way round every shape that has a
 * glow under it, which is exactly the inflation `fillCoverage`'s exact half at
 * the boundary exists to rule out. The damage is confined to the band where the
 * fill's ramp overlaps the glow, because past half a pixel out the fill and the
 * outline are both zero and the two forms agree identically.
 *
 * Exactly 0.5 holds for any `glowAlpha` at or below 0.5. Above that the halo
 * itself sets the floor at the boundary and the shape's edge reads as the glow's
 * alpha instead, which is a statement about how strong a halo is rather than
 * about compositing: `shape-scene.ts` picks 0.45 deliberately, and
 * {@link requireShapeStyle} allows the whole unit interval because a halo at 0.8
 * is a legitimate if unsubtle choice.
 *
 * Here rather than in `sdf-nodes.ts` because it is pure float arithmetic, so
 * `test/sdf.test.ts` can execute the decision instead of reading it: `mul` and
 * `max` were already two of the nine primitives and this needs no tenth. Its
 * partner, the colour, USED to be the counterexample: a `vec3 mix` is not one of
 * the nine, so it stayed in TSL and was checked structurally, and the asymmetry
 * was documented as deliberate. It was not necessary. A `mix` between two colours
 * is three independent scalar blends, so {@link shapeColorChannel} composites ONE
 * channel over the same nine primitives and `sdf-nodes.ts` calls it three times.
 * Both halves of the compositing decision are now executed by
 * `test/sdf.test.ts`, and {@link Arith} is still nine members wide.
 */
export function shapeAlpha<T>(
  m: Arith<T>,
  glowAlpha: T,
  glow: T,
  fill: T,
  outline: T,
): T {
  return m.max(m.mul(glowAlpha, glow), m.max(fill, outline));
}

/**
 * The floor under {@link shapeFillWeight}'s denominator: `2^-100`.
 *
 * The denominator is `fill + glowAlpha * glow * (1 - fill)`, and it is zero in
 * exactly one case, which is worth stating as an identity rather than as a
 * tolerance. Write `g` for `glowAlpha * glow`. Then `sum - fill = g * (1 - fill)`
 * and `sum - g = fill * (1 - g)`, both of which are at or above zero for inputs in
 * the unit interval, so `sum >= max(fill, g)`. {@link shapeAlpha} is
 * `max(g, max(fill, outline))` and {@link outlineCoverage} never exceeds
 * {@link fillCoverage}, so `sum >= alpha`: the denominator vanishes only where the
 * fragment writes an alpha of exactly zero and nothing is drawn at all.
 *
 * So the floor's only job is to keep `0 / 0` out of the shader, and a `max` is the
 * spelling that does it without touching anything else. An added epsilon would
 * move the weight at every fragment in every frame; `max` returns the identical
 * double wherever the sum is at or above `2^-100`, which is every fragment with any
 * alpha whatsoever. The degenerate fragment then gets a fill weight of 0, which is
 * the glow colour at alpha 0, rather than the `NaN` that propagates through a
 * `mix` into a black or undefined pixel.
 *
 * `2^-100` rather than something nearer the framebuffer's `1 / 255`, and the
 * difference matters. The weight is `fill / max(sum, floor)`, so a floor the fill
 * can exceed scales the weight DOWN and biases a faint fragment towards the glow;
 * at `1 / 255` that is every fragment under one 8-bit alpha step, which is
 * invisible but is also not nothing. At `2^-100` the weight is exactly 1 whenever
 * the glow's contribution is zero and the fill's is not, which is what makes
 * "`glowAlpha = 0` paints exactly the fill colour" an exact statement rather than
 * an approximate one. The lower bound is float32: `fill / 2^-100` is at most
 * `2^100`, eight orders of magnitude inside float32's range, where a floor at the
 * smallest normal `2^-126` would leave under a factor of four. A power of two, so
 * the division introduces no rounding of its own.
 */
export const MIN_COLOR_WEIGHT_SUM = 2 ** -100;

/**
 * How much of the blend under the outline the FILL colour gets, against the glow
 * colour: a scalar in `[0, 1]`.
 *
 * **This exists because `glowAlpha` used to reach the alpha and not the colour.**
 * The shape's alpha was `max(glowAlpha * glow, max(fill, outline))` and its colour
 * was `mix(mix(glowColor, fillColor, fill), outlineColor, outline)`, so the glow
 * was weighted by its alpha in one and by `1 - fill` in the other. Two measured
 * consequences at `aaWidth = 1`, both on the ladder's own colours:
 *
 * - `glowAlpha = 0`, which {@link glowCoverage} recommends as the way to say "no
 *   glow" because radius 0 still draws a one pixel halo, did not remove the glow's
 *   HUE. At `d = +0.25` pixels the fill is 0.15625, so the colour under the outline
 *   came out `#fc8d00` on the amber rect against the `#ffb703` it is painted, and
 *   `#7dc3df` on the blue circle against `#219ebc`. The circle's is 84% of the way
 *   from its own fill to its glow. A caller who asked for no glow got the glow's
 *   colour over the outer half of every antialiasing ramp on the shape.
 * - `glowAlpha = 0.45` and a 10 unit glow, at `d = +0.25` pixels: the alpha is
 *   0.44917 and all of it comes from the halo, while the fill and the outline are
 *   both 0.15625. The old weighting gave the fill 0.15625 of that pixel's colour
 *   where its share of the light reaching the pixel is 0.29193, a ring one pixel
 *   wide that is darker and more glow-coloured than the shape it surrounds.
 *
 * The fix is to weight the two layers by what each contributes: the fill by its own
 * coverage, and the glow by its alpha times the part of the pixel the fill has not
 * already claimed, `glowAlpha * glow * (1 - fill)`. Normalising by the sum turns
 * two contributions into a blend, and the normalised FILL share is all a caller
 * needs, because the glow's is one minus it.
 *
 * Three properties, all asserted in `test/sdf.test.ts`. `glowAlpha = 0` gives
 * exactly 1, so the fill colour is painted exactly. A fill coverage of 1 gives
 * exactly 1 whatever the glow does, so the inside of a shape is never tinted. And
 * the alpha is untouched by any of this, so the boundary is still exactly 0.5: the
 * two halves of the compositing decision are now consistent rather than merely
 * both documented.
 *
 * `glowAlpha` and `glow` are taken apart rather than pre-multiplied, so the
 * signature reads the same way {@link shapeAlpha}'s does. The product is therefore
 * computed twice per fragment, which is one `mul` on a shader that already runs a
 * `sqrt` and two derivatives, against a call site where the two functions could
 * otherwise disagree about which of them owns the multiply.
 */
export function shapeFillWeight<T>(m: Arith<T>, glowAlpha: T, glow: T, fill: T): T {
  const glowShare = m.mul(m.mul(glowAlpha, glow), m.sub(m.literal(1), fill));
  const sum = m.add(glowShare, fill);
  return m.div(fill, m.max(sum, m.literal(MIN_COLOR_WEIGHT_SUM)));
}

/**
 * ONE channel of the colour a fragment writes: the glow under the fill under the
 * outline, composited in that order.
 *
 * Per channel, and that is the whole reason this is here rather than as a pair of
 * `mix` calls in `sdf-nodes.ts`. A colour `mix` is a `vec3` operation, so hoisting
 * it into {@link Arith} would mean a tenth primitive that no Node test can execute;
 * a single CHANNEL of the same blend is scalar arithmetic over four of the nine
 * that are already there. `sdf-nodes.ts` calls this three times, with `.r`, `.g`
 * and `.b`, and the layer order is then something `test/sdf.test.ts` runs rather
 * than something a structural assertion can only shape-match. Two mutations that
 * used to leave the whole suite green are the reason: dropping the glow from the
 * blend entirely, and swapping the fill and the outline so that the fill paints
 * OVER the border, which makes "inset outline" false everywhere the fill is opaque.
 *
 * `fillWeight` comes from {@link shapeFillWeight} and is a normalised share, not a
 * coverage. `outlineCov` is a coverage, because the outline is composited OVER the
 * result rather than blended into it: it is the topmost layer, so nothing has to be
 * normalised against it.
 *
 * Each blend is spelled `a * (1 - t) + b * t` rather than `a + (b - a) * t`. Four
 * primitives against three, and the extra `mul` buys exactness at both ends: at
 * `t = 1` the second form computes `a + (b - a)`, which does not round back to `b`,
 * so `glowAlpha = 0` would paint a colour a few ulps off the fill's rather than the
 * fill's. It is also the form the GLSL and WGSL `mix` intrinsics are specified as,
 * so this composites bit-identically to the `mix` chain it replaces wherever the
 * weights agree.
 */
export function shapeColorChannel<T>(
  m: Arith<T>,
  glow: T,
  fill: T,
  outline: T,
  fillWeight: T,
  outlineCov: T,
): T {
  const one = m.literal(1);
  const under = m.add(m.mul(glow, m.sub(one, fillWeight)), m.mul(fill, fillWeight));
  return m.add(m.mul(under, m.sub(one, outlineCov)), m.mul(outline, outlineCov));
}

/**
 * How a shape is painted: three colours, an outline width in CSS pixels, and a
 * glow radius in world units.
 *
 * One record rather than a colour record and a geometry record, on the same
 * argument `ViewportSize` in `types.ts` makes for keeping a canvas size and its
 * device pixel ratio together: these five numbers always travel together,
 * because sizing a shape's quad needs the glow radius and painting it needs the
 * colours, and both happen in the same breath for the same shape. Splitting them
 * is how a scene ends up sizing one shape's quad from another shape's glow.
 *
 * Colours are 24-bit `0xRRGGBB` integers, which is what `createRenderer` already
 * takes for the clear colour, and they are converted through three's `Color` so
 * that the sRGB to linear step happens once, in three, rather than being got
 * wrong here.
 */
export interface ShapeStyle {
  /** The interior colour, as `0xRRGGBB`. */
  readonly fillColor: number;

  /** The inset outline's colour, as `0xRRGGBB`. */
  readonly outlineColor: number;

  /** The halo's colour, as `0xRRGGBB`. */
  readonly glowColor: number;

  /**
   * The halo's alpha where it meets the boundary, in `[0, 1]`. Separate from
   * {@link glowColor} because a glow at full alpha reads as a second, blurrier
   * shape rather than as a halo, and because the colour is a palette decision
   * while this is a strength decision.
   */
  readonly glowAlpha: number;

  /**
   * The inset outline's width in CSS PIXELS. Pixels rather than world units
   * because a border that thickened as you zoomed in is a border drawn by a
   * geometry pipeline, and not having to do that is the reason to use an SDF.
   *
   * A width of `w` reaches full coverage at `w` pixel centres, so 1 is a crisp
   * hairline and 2 is a crisp two pixel border. Below 1 the outline fades: half a
   * pixel covers its one pixel centre at 0.5.
   *
   * **0 turns it off at every pixel a rasteriser samples**, which is the claim
   * that matters and the one a caller can rely on. It is worth stating that
   * precisely rather than as "0 draws nothing", because the continuous function
   * does not vanish: with the band's outer ramp centred on the boundary (see
   * {@link outlineCoverage}), a zero width band still has two coincident 50%
   * ramps and reads 0.5 exactly ON the boundary. No pixel centre lands there,
   * since centres sit half a pixel off it, so nothing is drawn. A caller
   * sampling this function directly rather than from a fragment shader is the one
   * who needs to know the difference.
   */
  readonly outlinePixels: number;

  /** The halo's reach past the boundary, in WORLD units. See {@link glowCoverage}. */
  readonly glowWorld: number;
}

/**
 * How much world space a shape's quad has to leave past the shape itself for the
 * FILL's own antialiasing ramp, on top of the glow.
 *
 * One world unit, and what that buys is a number rather than a feeling. The fill
 * ramp reaches half an `aaWidth` past the boundary, which is `1 / (2 * zoom)`
 * world units, so this unit of padding is exhausted at zoom
 * {@link FILL_AA_CROSSOVER_ZOOM}.
 *
 * **That is the budget the fill has ON ITS OWN, and not the zoom at which anything
 * gets clipped.** The quad's edge is {@link quadPadding} out, which is `glowWorld +
 * FILL_AA_PADDING_WORLD` and not one unit, so the ramp is clipped by the quad only
 * below `1 / (2 * (glowWorld + 1))`. 0.5 is therefore the GLOW-FREE worst case, and
 * no shape in `shape-scene.ts` is glow-free: every rung's glow is a quarter of its
 * height, so the 40 unit tall rung clips below 0.0455 (eleven times lower) and the
 * 400 unit one below 0.00495. The 4 unit tall rungs are the exception worth
 * stating, because they are the ones with a real crossover: a 1 unit glow gives 2
 * units of padding and a crossover at 0.25, so at the committed 0.1x screenshot
 * their ramps ARE clipped. At that zoom they are 1.0 by 0.4 and 0.4 by 0.4 CSS
 * pixels, so what is clipped is the antialiasing of a shape smaller than a pixel.
 *
 * What is lost when it is clipped is the tail of a monotonically decreasing
 * coverage below 0.5, so the symptom is an edge that hardens rather than a missing
 * pixel, and it only happens when a shape is already being drawn at under a pixel
 * per two world units.
 *
 * A quad sized from the camera's current zoom would remove the crossover
 * entirely, and that is M4.4's problem, not this one: it needs the geometry to
 * be rebuilt or scaled when the camera moves, which is a per-frame decision this
 * file has no camera to make.
 */
export const FILL_AA_PADDING_WORLD = 1;

/**
 * The zoom, in CSS pixels per world unit, at and above which the fill's
 * antialiasing ramp fits inside {@link FILL_AA_PADDING_WORLD}.
 *
 * Derived rather than written down, so the two numbers cannot drift apart. Half
 * an `aaWidth` is `1 / (2 * zoom)`, and setting that equal to the padding gives
 * 0.5. `test/sdf.test.ts` pins both the value and the relation.
 */
export const FILL_AA_CROSSOVER_ZOOM = 1 / (2 * FILL_AA_PADDING_WORLD);

/**
 * Rejects a value that is not a finite number, naming the field. The package
 * rule from `errors.ts`, spelled the same way `camera.ts` spells it.
 */
function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} has to be a finite number, got ${String(value)}`);
  }
  return value;
}

/** Rejects a value that is not a finite number at or above zero. */
function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${field} has to be a finite number at or above zero, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Rejects a colour that is not a 24-bit `0xRRGGBB` integer.
 *
 * The same check `createRenderer` applies to `clearColor`, for the same measured
 * reason: three's `Color.setHex` validates nothing, and against 0.185.1 `NaN`
 * and `Infinity` both come out #000000 while `-1` and `0x1ffffff` both saturate
 * to #ffffff. A shape that silently turns black on a near-black background is a
 * shape that is not there.
 */
function requireColor(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(
      `${field} has to be an integer between 0x000000 and 0xffffff, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Rejects a {@link ShapeStyle} that cannot describe a shape, naming the field
 * and the record it came from.
 *
 * **This is the boundary.** Every number in a style comes from a line somebody
 * wrote, and this is the first place one of them does anything, so it is the
 * place where a `RangeError` still points at the line. The alternative, checking
 * inside {@link fillCoverage} or {@link outlineCoverage}, is worse twice over: on
 * the GPU those functions run once per fragment and cannot throw anywhere a
 * caller would see, and in JavaScript they are the hot path of nothing at all.
 *
 * The record is validated whole rather than field by field at each use, so a
 * style that has been through {@link quadPadding} is known good everywhere
 * downstream and no later function has to ask again. The `field` argument is
 * what makes that usable in a scene of six shapes: the message says
 * `ladder[3].style.glowWorld`, not `glowWorld`.
 *
 * Returns a copy, so a caller cannot hold a reference and mutate a validated
 * style afterwards.
 */
export function requireShapeStyle(style: ShapeStyle, field: string): ShapeStyle {
  const glowAlpha = requireFinite(style.glowAlpha, `${field}.glowAlpha`);
  if (glowAlpha < 0 || glowAlpha > 1) {
    throw new RangeError(
      `${field}.glowAlpha has to lie between 0 and 1, got ${String(glowAlpha)}`,
    );
  }
  return {
    fillColor: requireColor(style.fillColor, `${field}.fillColor`),
    outlineColor: requireColor(style.outlineColor, `${field}.outlineColor`),
    glowColor: requireColor(style.glowColor, `${field}.glowColor`),
    glowAlpha,
    // A negative width puts the band's inner edge outside its outer one, and it
    // fails SILENTLY in two different ways rather than drawing anything a
    // reviewer would question. At or below -1 pixel the band vanishes entirely
    // and the shape simply has no border. Between -1 and 0 it is worse: the band
    // lands OUTSIDE the boundary and tints the fill's own outer antialiasing ramp
    // with the outline colour, peaking at 0.15625 coverage at `d = +0.25` pixels
    // for a width of -0.5, which is exactly the fill's coverage there.
    //
    // Note what is NOT the reason. The footprint contract holds regardless of
    // sign, because {@link outlineCoverage} is a `max` against `distance` and so
    // can never exceed the fill's coverage whatever the width does. This check
    // buys a `RangeError` naming the field instead of a missing or subtly tinted
    // edge, and nothing else.
    outlinePixels: requireNonNegative(style.outlinePixels, `${field}.outlinePixels`),
    // A negative glow would SHRINK the quad below the shape it is drawn on, so
    // the fill would be clipped by a straight line unrelated to the shape.
    glowWorld: requireNonNegative(style.glowWorld, `${field}.glowWorld`),
  };
}

/**
 * Rejects a corner radius that {@link roundedRectDistance} cannot honour on a
 * shape of `size`, and the size itself if it is not a positive area.
 *
 * The upper bound is half the smaller dimension. Past it the corner arcs of
 * opposite corners overlap, the `min` term goes positive at the shape's centre,
 * and the field stops being a distance to anything: the shape reads inside out.
 * Rejected rather than clamped, because a caller who wrote a 30 unit radius on a
 * 40 unit tall box has a bug in the number, and quietly drawing a stadium hides
 * it behind a shape that looks intentional.
 *
 * Validated here, at the point a descriptor becomes geometry, and not inside the
 * distance function: see the module docstring.
 */
export function requireCornerRadius(
  radius: number,
  size: Size,
  radiusField: string,
  sizeField: string,
): number {
  const width = requireFinite(size.width, `${sizeField}.width`);
  const height = requireFinite(size.height, `${sizeField}.height`);
  if (width <= 0) {
    throw new RangeError(`${sizeField}.width has to be above zero, got ${String(width)}`);
  }
  if (height <= 0) {
    throw new RangeError(`${sizeField}.height has to be above zero, got ${String(height)}`);
  }
  const limit = Math.min(width, height) / 2;
  requireNonNegative(radius, radiusField);
  if (radius > limit) {
    throw new RangeError(
      `${radiusField} has to be at most half the smaller dimension (${String(limit)}), got ${String(radius)}`,
    );
  }
  return radius;
}

/**
 * Rejects a circle radius that is not a finite number above zero, naming the field
 * the CALLER wrote.
 *
 * Separate from {@link requireCornerRadius}, and the reason is the message rather
 * than the arithmetic. A circle descriptor has a `radius` and no `size`, so putting
 * its radius through the corner-radius check reported the derived size instead:
 * `circle-10.size.width has to be above zero, got -2` for a caller who wrote
 * `radius: -1`, naming a field that does not exist on a circle and quoting a number
 * the caller never typed. Both halves of that are the kind of error message that
 * costs a reader more time than no message at all.
 *
 * Nothing else about a circle needs checking, which is the discriminated union in
 * `shape-scene.ts` paying for itself: a circle's radius IS half its smaller
 * dimension by construction, so the bound {@link requireCornerRadius} exists to
 * enforce cannot be violated and there is no second invariant to validate.
 */
export function requireCircleRadius(radius: number, field: string): number {
  const value = requireFinite(radius, field);
  if (value <= 0) {
    throw new RangeError(`${field} has to be above zero, got ${String(value)}`);
  }
  return value;
}

/**
 * How far a shape's quad has to reach past the shape on every side: the whole
 * glow, plus {@link FILL_AA_PADDING_WORLD} for the fill's own ramp.
 *
 * Validates the style, because sizing the quad is the first thing any style is
 * used for and this is therefore the boundary described in the module docstring.
 * Once per shape, not once per fragment.
 *
 * `field` names the record in the `RangeError`, and it is a parameter rather than
 * the hardcoded `'style'` it used to be because this function has callers that know
 * a better name. `shapeQuadBounds` in `shape-scene.ts` is the one that matters:
 * `shape-scene.ts` advertises it for overlap and fits-in-view tests, and M4.4 will
 * call it on layout-derived descriptors, where `style.glowWorld` sends a caller to
 * look at six identical records and `rect-100.style.glowWorld` does not. Defaulted,
 * so a caller with nothing better to say says nothing.
 */
export function quadPadding(style: ShapeStyle, field = 'style'): number {
  return requireShapeStyle(style, field).glowWorld + FILL_AA_PADDING_WORLD;
}

/**
 * The size of the PLANE a shape is drawn on: the shape grown by
 * {@link quadPadding} on all four sides.
 *
 * Twice the padding on each axis, since the padding is per side. `field` is passed
 * straight through to {@link quadPadding}, which is where the validation and the
 * `RangeError` live. The quad is not the shape and confusing the two is the failure
 * this function exists to prevent: a plane the size of the shape clips the glow
 * entirely (the halo lives outside the boundary by definition) and clips the outer
 * half of the fill's own antialiasing ramp, which turns a soft edge into a hard one
 * along a rectangle that has nothing to do with the shape.
 */
export function shapeQuadSize(size: Size, style: ShapeStyle, field = 'style'): Size {
  const padding = quadPadding(style, field);
  return { width: size.width + 2 * padding, height: size.height + 2 * padding };
}
