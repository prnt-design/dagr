import type { Size } from './types.js';
import { requireColor, requireFinite, requireNonNegative } from './validate.js';

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
 * Distances, radii and glow radii are WORLD units. Outline widths are DEVICE
 * PIXELS, because the whole point of an SDF is that a two pixel outline is two
 * pixels wide at every zoom. `aaWidth` is the bridge: one DEVICE pixel measured in
 * world units, which is `1 / (zoom * devicePixelRatio)`.
 *
 * **Device and not CSS, and the distinction is load bearing.** A derivative is
 * taken across a FRAMEBUFFER pixel, and `#syncSize` in `webgpu-renderer.ts` sizes
 * the framebuffer from `Camera2D.drawingBufferSize()`, which is the CSS size times
 * the ratio. So `1 / zoom` is right only at dpr 1, which happens to be the ratio
 * the committed screenshots were captured at. A 2 pixel outline is therefore 2.00
 * CSS pixels at dpr 1, 1.00 at dpr 2 and 0.67 at dpr 3: thinner on exactly the
 * displays most people read this on.
 *
 * That is CORRECT for the antialiasing, which wants device pixels and nothing else,
 * and it is a deliberate choice for the outline rather than an oversight. Making
 * the outline a true CSS width means multiplying by the ratio in the shader, which
 * needs the ratio as a uniform and so puts a SECOND reader of `devicePixelRatio`
 * beside `drawingBufferSize`, against the rule `camera.ts` states. One reader is
 * worth more than a display-independent border, so the unit is stated honestly here
 * instead. If that trade is ever revisited, revisit it in `camera.ts` first.
 *
 * In the shader `aaWidth` is not read off the camera but measured from the mesh, as
 * the `max` of the two per-axis gradients of the interpolated POSITION. Not of the
 * distance: every field here folds through `abs` or a square, and a folded quantity
 * has a zero gradient on the quad containing the shape's centre. See
 * `antialiasWidth` in `sdf-nodes.ts` for what that cost before it was fixed. Taking
 * it from the position also means the antialiasing follows any transform the mesh
 * picks up without being told about it, because the position Jacobian IS that
 * transform.
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
 *
 * WHERE THAT BOUNDARY IS AS OF M4.3: `requireShapeInstance` in
 * `instance-attributes.ts`, which is the last place an instance's numbers are a
 * caller's numbers rather than twelve floats in a buffer. It DELEGATES the two
 * shape checks here rather than restating them, which is what the field-name
 * arguments buy: the same bound reports through `chapter-3.cornerRadius` for a
 * campaign node and through `rect-100.cornerRadius` for a ladder descriptor.
 * Restating them was the first draft and it left two copies of "at most half the
 * smaller dimension" to drift apart.
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
 * **What this costs, since WGSL has a `smoothstep` intrinsic and TSL exposes
 * it.** The intrinsic is one instruction on most hardware where this is a clamp
 * (two instructions), a subtract, a divide and four multiply-adds: call it five
 * to eight ALU operations per fragment more than the builtin, times three
 * coverage functions, on a fragment shader that is already doing a `sqrt` and
 * two derivatives. On the 10k-node scene M4.10 has to hit 60fps on, that is
 * arithmetic against a budget that is far more likely to be bound by overdraw
 * and bandwidth (every shape is a transparent, padded quad), so it is worth
 * measuring before it is worth optimising, and M4.10 owns the measurement.
 *
 * What it buys is that the ramp the test suite exercises is the ramp the shader
 * evaluates. A builtin `smoothstep` would be an unexecutable tenth primitive,
 * and its clamping behaviour at reversed edges (relied on below) would be a
 * property of somebody else's hardware rather than of a line in this file.
 *
 * `edge0` may be GREATER than `edge1`, which gives a descending ramp and is how
 * every coverage function below spells one. Undefined when `edge0 === edge1`:
 * the denominator is zero, and both backends then produce a non-finite ramp
 * parameter rather than a step. No caller can reach that, because every
 * denominator below is an `aaWidth` or a glow radius floored at one pixel, and a
 * pixel has positive width.
 */
export function smoothstepBetween<T>(m: Arith<T>, edge0: T, edge1: T, x: T): T {
  const t = m.min(
    m.max(m.div(m.sub(x, edge0), m.sub(edge1, edge0)), m.literal(0)),
    m.literal(1),
  );
  return m.mul(m.mul(t, t), m.sub(m.literal(3), m.mul(m.literal(2), t)));
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
 */
export function fillCoverage<T>(m: Arith<T>, distance: T, aaWidth: T): T {
  const half = m.div(aaWidth, m.literal(2));
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
 * **A band of `w` pixels draws `w` fully covered pixel centres.** This is the
 * property to hold onto, because it is the only one a user can see. A rasteriser
 * samples coverage at PIXEL CENTRES, which at one pixel per `aaWidth` sit at
 * `d = -0.5, -1.5, ... ` pixels, and with the ramp centred on the boundary the
 * coverage at the first `w` of them is exactly 1, so the outline reaches its own
 * colour. Even a hairline draws one fully opaque pixel.
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
 * `widthPixels` is in DEVICE pixels, so an outline is the same thickness on screen
 * at every zoom, which is the reason to draw one from a distance field at all. The
 * pixel grid claim above is stated in the same unit and is unaffected by which one
 * is meant: a band of `w` DEVICE pixels covers `w` device pixel centres. What the
 * unit does change is the border's apparent thickness across displays, which the
 * units section at the top of this file states in full.
 */
export function outlineCoverage<T>(m: Arith<T>, distance: T, widthPixels: T, aaWidth: T): T {
  const bandWorld = m.mul(widthPixels, aaWidth);
  const inner = m.sub(m.literal(0), m.add(distance, bandWorld));
  return fillCoverage(m, m.max(distance, inner), aaWidth);
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
 * a caller scales each node's glow with the node for exactly that
 * reason.
 *
 * `aaWidth` floors the ramp at one pixel. A halo narrower than the sample
 * spacing is a hard step, which is the one thing this file exists to avoid. The
 * cost is that `radiusWorld === 0` still draws a one pixel halo rather than
 * nothing, which is why the scene expresses "no glow" through the glow colour or
 * its alpha and not through a zero radius.
 */
export function glowCoverage<T>(m: Arith<T>, distance: T, radiusWorld: T, aaWidth: T): T {
  const edge = m.max(radiusWorld, aaWidth);
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
 * about compositing: the renderer's default node style picks 0.45 deliberately, and
 * {@link requireShapeStyle} allows the whole unit interval because a halo at 0.8
 * is a legitimate if unsubtle choice.
 *
 * Here rather than in `sdf-nodes.ts` because it is pure float arithmetic, so
 * `test/sdf.test.ts` can execute the decision instead of reading it: `mul` and
 * `max` were already two of the nine primitives and this needs no tenth. Its
 * partner, the colour, could not come along. That `mix` is a `vec3` operation,
 * and adding a vector `mix` to {@link Arith} would widen the interface for one
 * call site and put a tenth unexecutable line in `sdf-nodes.ts`, so the colour
 * stays in TSL and is checked structurally. The asymmetry is deliberate and it is
 * the reason the two halves of the compositing decision are documented in two
 * files.
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
 * no rung of the M4.2 ladder was glow-free: every rung's glow was a quarter of its
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
 * entirely, and M4.4 did NOT take it. The quad is now scaled per instance in the
 * vertex stage rather than baked into a geometry, so resizing it per frame is
 * cheaper than it was, and it is still a per-frame decision this file has no
 * camera to make. What M4.4 changed is who computes the padding:
 * {@link quadPadding} is built with `tslArith` and evaluated in the shader,
 * which is what puts it back inside the tested half of this file.
 */
export const FILL_AA_PADDING_WORLD = 1;

/**
 * How far a shape's quad has to reach past the shape on every side: the whole
 * glow, plus {@link FILL_AA_PADDING_WORLD} for the fill's own ramp.
 *
 * Over {@link Arith} like every other formula here, and that is a change M4.4
 * made rather than a shape it always had. It used to take a `ShapeStyle` record
 * and validate it, because a quad was a `PlaneGeometry` built once per shape in
 * JavaScript. The quad is now scaled PER INSTANCE in the vertex stage, so the
 * expression runs on the GPU, and the choice was a second copy of it in TSL or
 * this. The whole argument for the nine primitives applies unchanged: the suite
 * executes the expression tree the vertex shader evaluates rather than a copy of
 * it that never reaches a GPU.
 *
 * No validation, for the same reason no other formula here validates: this runs
 * once per vertex on the GPU, where it cannot throw anywhere a caller would see.
 * `requireShapeInstance` in `instance-attributes.ts` is the boundary, and it
 * rejects a negative reach before one ever reaches a buffer.
 *
 * The quad's SIZE is the shape grown by twice this on each axis, and it is not a
 * function here because it is a `vec2` operation: widening {@link Arith} for one
 * call site is the cost the nine-primitive count exists to keep visible, and the
 * addition is one line in `instanced-scene.ts` either way.
 */
export function quadPadding<T>(m: Arith<T>, glowWorld: T): T {
  return m.add(glowWorld, m.literal(FILL_AA_PADDING_WORLD));
}

/**
 * The zoom, in CSS pixels per world unit, at and above which the fill's
 * antialiasing ramp fits inside {@link FILL_AA_PADDING_WORLD}.
 *
 * Derived rather than written down, so the two numbers cannot drift apart. Half
 * an `aaWidth` is `1 / (2 * zoom)`, and setting that equal to the padding gives
 * 0.5. `test/sdf.test.ts` pins both the value and the relation.
 *
 * That derivation assumes dpr 1. Above it `aaWidth` is `1 / (zoom * dpr)`, so the
 * ramp is NARROWER than this constant expects and fits inside the padding at a
 * lower zoom than 0.5. The constant is therefore conservative on every display
 * finer than dpr 1, never optimistic, which is the safe direction for a padding
 * bound and is why it is left at the dpr 1 figure rather than made dynamic.
 */
export const FILL_AA_CROSSOVER_ZOOM = 1 / (2 * FILL_AA_PADDING_WORLD);


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
 * `instance-attributes.ts` paying for itself: a circle's radius IS half its smaller
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


