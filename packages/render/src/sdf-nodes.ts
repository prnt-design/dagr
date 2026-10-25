import { Fn, abs, clamp, float, fwidth, length, max, min, mix, step, vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * The shader twin of `sdf.ts`: the same distance fields, written in TSL.
 *
 * ## INTERNAL. Do not export this module from `index.ts`
 *
 * Every signature here mentions a three.js `Node`, and `types.ts` gives the
 * reason that keeps this file off the package's surface: three is a peer
 * dependency, so the application picks the copy and the version. A `Node` in an
 * exported signature turns two copies of three in one tree from a bundle-size
 * problem into a type error, and it makes three a build-time requirement for
 * every consumer, including one that only wants to name a viewport. `index.ts`
 * exports `shape.ts` and `sdf.ts`, which are plain numbers and plain records;
 * this file is reached only by `shape-material.ts`, which already imports three
 * because it is the thing that talks to three, and which is internal for the
 * same reason.
 *
 * This paragraph exists because the natural instinct on finding an unexported
 * module is to export it. The instinct is wrong here, and it is wrong in a way
 * that no test in this package would catch: it type-checks, it builds, and it
 * breaks in a consumer's tree.
 *
 * ## Nothing here is unit tested, and that is not laziness
 *
 * Node has no WebGPU, so a node graph cannot be executed, and emitting WGSL
 * headlessly does not work on three 0.185.1: `WGSLNodeBuilder.build()` throws
 * `TypeError: Cannot read properties of undefined (reading 'isContextNode')`,
 * with and without the third constructor argument. So the arithmetic in this
 * file is not proved here. It is proved in `test/sdf.test.ts`, against the CPU
 * twins in `sdf.ts`, and **this file's only job is to be a faithful
 * transcription of those.** Every function below names the CPU function it
 * transcribes. If a change here would make the two disagree, the change belongs
 * in `sdf.ts` first, where a test can fail over it.
 *
 * What a screenshot does check is this file's one genuine addition: the
 * compositing in {@link sdfShading}, which is colour, and colour is the thing a
 * committed reference image is good at.
 *
 * ## What the shader has that the CPU cannot
 *
 * **The filter width comes from `fwidth(distance)` rather than being passed
 * in.** `fwidth` is the screen-space derivative of the distance: how many world
 * units of distance one pixel step is worth, right here, under whatever
 * projection is live. That is exactly why one shader is crisp at 0.1x and at
 * 100x instead of at one chosen zoom, and it is the one thing a CPU twin cannot
 * have, because it needs the neighbouring fragment. `sdf.ts`'s `edgeCoverage`
 * therefore takes one more argument than its shader counterpart does.
 *
 * ## Where the shape-local point comes from, and why this file does not decide
 *
 * Everything here takes `p` in SHAPE-LOCAL space, origin at the shape's centre,
 * the same convention `sdf.ts` states. Where that node comes from
 * (`positionLocal.xy` on a centred plane, a UV remap, an instance transform,
 * scaled by the quad's own size) is material assembly, and material assembly is
 * `shape-material.ts`, which for M4.2 answers it with `positionLocal.xy` on a
 * centred plane. The question that stays open is M4.3's: one material with a
 * per-instance shape id versus one material per family, which decides where the
 * point comes from once shapes are instanced. These are composable node
 * factories with no opinion about any of it, so that question costs a rewiring
 * rather than a rewrite.
 */

/**
 * The floor put under a filter width before dividing by it.
 *
 * `fwidth` of a real distance field under a real projection is never zero, but
 * "never" in a shader means "until some driver, some degenerate matrix, or a
 * zero-sized shape". A division by zero at `distance` zero yields `0 / 0`,
 * which is `NaN`, and `NaN` coverage composites as nothing at all: the shape
 * does not appear and there is no error anywhere to say why. `sdf.ts` guards
 * the same case with an explicit `filterWidth === 0` branch.
 *
 * The floor is not merely safe, it REPRODUCES that branch exactly, which is why
 * this is a transcription rather than a divergence. At a filter width of
 * epsilon the ramp collapses onto the boundary: `t` is 1 for any negative
 * distance, 0 for any positive one, and exactly 0.5 at zero, which is the hard
 * step with a half on the boundary that `sdf.ts` specifies for the degenerate
 * case, for the reason it gives there. A branch would cost more and say less.
 */
const MIN_FILTER_WIDTH = 1e-8;

/**
 * The floor put under a glow radius, for the same reason and with the same
 * result: at epsilon the falloff collapses to 1 at or inside the boundary and 0
 * outside it, which is `sdf.ts`'s `glowRadius === 0` branch exactly.
 *
 * This one is not a theoretical case. No glow is the COMMON case, so a shading
 * node that produced `NaN` at `glowRadius` zero would make most of the scene
 * invisible.
 */
const MIN_GLOW_RADIUS = 1e-8;

/**
 * The outline width at or below which no outline is drawn at all.
 *
 * Needed because the coverage ramp is a half-space formula and an outline is a
 * BAND. At `outlineWidth` zero the band has no area, but
 * `edgeCoverage(abs(distance), filterWidth)` still reads 0.5 on the boundary
 * and tapers over the next half pixel, so a shape that asked for no outline
 * gets a half-covered hairline of outline colour along its edge. Gating on the
 * width removes it. The gate is on a per-shape value rather than a per-fragment
 * one, so it is uniform across a draw and costs a multiply.
 *
 * The related limitation this does NOT fix, stated so it is not mistaken for a
 * bug later: an outline thinner than a pixel is under-covered rather than
 * drawn thin-and-faint-but-correct, because the same half-space formula
 * measures each side of the band independently. That shows up at low zoom on a
 * hairline outline, and the fix is a band-aware coverage function, which is a
 * change to `sdf.ts` first.
 */
const MIN_OUTLINE_WIDTH = 1e-8;

/**
 * The shader twin of `roundedRectDistance` in `sdf.ts`.
 *
 * Exact everywhere, inside included, because everything downstream reads the
 * interior too: see the CPU docstring for why the cheap version that is only
 * correct outside is not good enough here.
 *
 * ```
 * q = abs(p) - halfSize + r
 * d = length(max(q, 0)) + min(max(q.x, q.y), 0) - r
 * ```
 *
 * `length(max(q, 0))` where the CPU says `Math.hypot(max(qx, 0), max(qy, 0))`:
 * the same quantity, and `hypot` is only there on the CPU side because it does
 * not overflow to infinity for a point far enough out. A fragment shader has no
 * such option and does not need one, since a point that far from a shape has
 * already been culled.
 *
 * @param p Shape-local point, origin at the shape's centre.
 * @param halfSize HALF the shape's extents, matching the CPU's `halfWidth` and
 *   `halfHeight` parameters rather than `ShapeInstance.size`.
 * @param radius Corner radius, expected to lie in
 *   `[0, min(halfSize.x, halfSize.y)]`. Pass it through `clampCornerRadius`
 *   from `sdf.ts` on the CPU side, where a clamp costs nothing per frame;
 *   clamping per fragment would pay for it at every pixel of every shape.
 */
export function roundedRectSDF(
  p: Node<'vec2'>,
  halfSize: Node<'vec2'>,
  radius: Node<'float'>,
): Node<'float'> {
  return roundedRectSDFFn(p, halfSize, radius);
}

const roundedRectSDFFn = Fn(
  ([p, halfSize, radius]: [Node<'vec2'>, Node<'vec2'>, Node<'float'>]) => {
    const q = abs(p).sub(halfSize).add(radius);
    const outside = length(max(q, vec2(0, 0)));
    const inside = min(max(q.x, q.y), float(0));
    return outside.add(inside).sub(radius);
  },
);

/**
 * The shader twin of `circleDistance` in `sdf.ts`.
 *
 * ```
 * d = length(p) - r
 * ```
 *
 * Separate from {@link roundedRectSDF} for the reason the CPU file gives: this
 * is what a circle IS, two multiplications and a subtraction against six
 * operations, and the equivalence with a square rounded rect at full radius is
 * a test rather than an implementation.
 *
 * @param p Shape-local point, origin at the circle's centre.
 * @param radius The circle's radius, so HALF `ShapeInstance.size.width`.
 */
export function circleSDF(p: Node<'vec2'>, radius: Node<'float'>): Node<'float'> {
  return circleSDFFn(p, radius);
}

const circleSDFFn = Fn(([p, radius]: [Node<'vec2'>, Node<'float'>]) => {
  return length(p).sub(radius);
});

/**
 * The shader twin of `edgeCoverage` in `sdf.ts`: how much of a fragment the
 * region `distance <= 0` covers.
 *
 * ```
 * t = clamp(0.5 - distance / filterWidth, 0, 1)
 * coverage = t * t * (3 - 2 * t)
 * ```
 *
 * Written out rather than as `smoothstep(filterWidth / 2, -filterWidth / 2,
 * distance)`, which is the same function and is how the CPU docstring names it.
 * Two reasons, and the first is decisive: those edges are in DESCENDING order,
 * and both GLSL and WGSL leave `smoothstep` undefined when `edge0 >= edge1`, so
 * the concise spelling is undefined behaviour that happens to work on the
 * drivers anyone tries first. The second is that this form is the literal
 * transcription of the CPU code, which is the property this whole file is for.
 *
 * Private, unlike its CPU twin: `sdf.ts` exports `edgeCoverage` because M4.8's
 * picking wants it, and picking happens on the CPU. Nothing assembling a
 * material needs the coverage without the colour it feeds, which is
 * {@link sdfShading}.
 */
const edgeCoverage = Fn(([distance, filterWidth]: [Node<'float'>, Node<'float'>]) => {
  const width = max(filterWidth, float(MIN_FILTER_WIDTH));
  const t = clamp(float(0.5).sub(distance.div(width)), float(0), float(1));
  return t.mul(t).mul(float(3).sub(t.mul(2)));
});

/**
 * The shader twin of `glowIntensity` in `sdf.ts`: 1 at the boundary and inside,
 * falling to 0 at `glowRadius` beyond it.
 *
 * ```
 * t = clamp(distance / glowRadius, 0, 1)
 * intensity = (1 - t) * (1 - t)
 * ```
 *
 * QUADRATIC, and the reason is at the far end rather than the near one: it
 * reaches zero with zero slope as well as zero value, and the eye reads a
 * discontinuity in the gradient as an edge just as readily as one in the value.
 * A linear ramp arrives at the quad's edge still falling, which ends the glow
 * in a faint visible outline exactly where the geometry stops. The full
 * argument, including why an exponential falloff is ruled out by the quad
 * having to be finite, is in the CPU docstring.
 *
 * Measured from the SHAPE's boundary, not from the outer edge of the outline.
 * `shapeQuadSize` in `sdf.ts` depends on that: it takes the larger of the two
 * reaches rather than their sum, and says in as many words that if this ever
 * measures from the outline instead, that function becomes a sum. It does not,
 * here.
 */
const glowIntensity = Fn(([distance, glowRadius]: [Node<'float'>, Node<'float'>]) => {
  const reach = max(glowRadius, float(MIN_GLOW_RADIUS));
  const t = clamp(distance.div(reach), float(0), float(1));
  const remaining = float(1).sub(t);
  return remaining.mul(remaining);
});

/**
 * Everything {@link sdfShading} needs, named exactly as the fields of
 * `NormalizedShapeStyle` in `shape.ts` are named.
 *
 * Deliberately identical names, so that whatever binds a normalized shape to a
 * material is a field-for-field mapping a reader can check by eye, rather than
 * a translation table in which `glowRadius` can quietly land in `outlineWidth`.
 *
 * Colours are `vec3` in the renderer's working colour space. Turning a
 * `0xRRGGBB` integer into one is not done here: it needs three's `Color` and a
 * decision about colour space, both of which belong with the material.
 *
 * A `type` rather than an `interface`, which is not a style preference: `Fn`'s
 * named-argument overload constrains its argument to
 * `{ readonly [key: string]: unknown }`, and a type alias satisfies that
 * implicitly where an interface does not. An interface here selects the wrong
 * overload and reports that the body takes a `NodeBuilder`.
 */
export type SdfShadingInputs = {
  /**
   * The signed distance at this fragment, negative inside, from
   * {@link roundedRectSDF} or {@link circleSDF} or anything else with the same
   * convention. ONE distance feeds fill, outline and glow: that is M4.2's whole
   * premise, and it is why this takes a distance rather than three of them.
   */
  readonly distance: Node<'float'>;

  /** The fill colour. */
  readonly fillColor: Node<'vec3'>;

  /**
   * The shape's opacity in `[0, 1]`, applied to the whole result rather than to
   * the fill alone, despite the name it inherits from `ShapeStyle`. A shape
   * fading out whose outline stayed solid would read as a hole rather than as a
   * fading node, and a glow that outlived its shape would read as a bug.
   */
  readonly fillOpacity: Node<'float'>;

  /** The outline colour. */
  readonly outlineColor: Node<'vec3'>;

  /**
   * Outline thickness in world units, straddling the boundary: half inside,
   * half outside. That is the same convention `shapeQuadSize` in `sdf.ts` sizes
   * the quad for, where the margin it reserves for an outline is
   * `outlineWidth / 2`. Zero draws no outline at all, exactly (see
   * {@link MIN_OUTLINE_WIDTH}).
   */
  readonly outlineWidth: Node<'float'>;

  /** The glow colour. */
  readonly glowColor: Node<'vec3'>;

  /** How far the glow reaches past the boundary, in world units. Zero is none. */
  readonly glowRadius: Node<'float'>;
};

/**
 * Fill, outline and glow, all read from ONE signed distance, antialiased from
 * the screen-space derivative of that same distance.
 *
 * This is the node M4.2 exists to prove: three visual features that would
 * otherwise be three pieces of geometry, coming out of one field, with an edge
 * that is a pixel soft at 0.1x and a pixel soft at 100x because
 * `fwidth(distance)` is measured per fragment rather than chosen once.
 *
 * ## The one derivative, and why the outline shares it
 *
 * `fwidth` is taken once, of `distance`, and used for both the fill's edge and
 * the outline's. Away from the exact boundary `fwidth(abs(distance) - w/2)`
 * equals `fwidth(distance)`, because `abs` flips the gradient's sign and a
 * constant does not change it at all, so the second derivative would be a
 * second instruction for the same number. It also keeps the promise the module
 * makes: everything is read from one distance.
 *
 * ## The compositing, which is the one thing here with no CPU twin
 *
 * Three layers, back to front, each a straight `mix` by its own coverage:
 *
 * ```
 * shaded = vec4(glowColor, glow)
 * shaded = mix(shaded, vec4(fillColor, 1), fill)
 * shaded = mix(shaded, vec4(outlineColor, 1), outline)
 * shaded.a *= fillOpacity
 * ```
 *
 * A `mix` rather than a source-over composite. Source-over is the correct
 * general answer and needs a divide by the accumulated alpha per layer; here
 * the layers are nested regions of one field rather than arbitrary overlapping
 * sprites, so each coverage is the fraction of the fragment that belongs to
 * that layer and a lerp by it IS the right average. The two agree wherever a
 * coverage is 0 or 1, which is everywhere except the antialiasing band.
 *
 * The glow is multiplied by `1 - fill` so it exists only OUTSIDE the shape.
 * `sdf.ts` saturates the glow at 1 inside on the argument that the fill draws
 * over it, and that argument holds only for an OPAQUE fill: at `fillOpacity`
 * 0.5 an unmasked glow would show through from underneath and the shape would
 * look solid. Masking here rather than changing `glowIntensity` keeps the CPU
 * twin's contract intact for M4.8, which asks about intensity and not about
 * what is drawn on top of it.
 *
 * Alpha is applied once, at the end, to the composited result. Applying it per
 * layer would double-count it wherever two layers overlap in the AA band, and
 * would make a translucent shape's outline darker than its fill for no reason a
 * reader could find.
 *
 * @returns A `vec4` of straight (non-premultiplied) RGBA in the working colour
 *   space, which is what a material's `colorNode` takes: three carries the
 *   alpha of a `vec4` colour node into the material's `diffuseColor`, where
 *   `transparent` picks it up. `shape-material.ts` assigns it there rather than
 *   to `outputNode`, so the result still goes through the material's own alpha,
 *   colour space and tone mapping handling.
 */
export function sdfShading(inputs: SdfShadingInputs): Node<'vec4'> {
  return sdfShadingFn(inputs);
}

const sdfShadingFn = Fn((inputs: SdfShadingInputs) => {
  const { distance, fillColor, fillOpacity, outlineColor, outlineWidth, glowColor, glowRadius } =
    inputs;

  // The whole reason one shader is crisp at every zoom: how much world distance
  // a pixel is worth, measured HERE, from the neighbouring fragment. `sdf.ts`
  // has to be handed this number because a CPU has no neighbouring fragment.
  const filterWidth = fwidth(distance);

  const fill = edgeCoverage(distance, filterWidth);

  // The outline is the band `|distance| <= outlineWidth / 2`, so it is the same
  // coverage function applied to the distance from that band's own boundary.
  const outlineBand = abs(distance).sub(outlineWidth.mul(0.5));
  const outline = edgeCoverage(outlineBand, filterWidth).mul(
    step(float(MIN_OUTLINE_WIDTH), outlineWidth),
  );

  const glow = glowIntensity(distance, glowRadius).mul(float(1).sub(fill));

  const glowLayer = vec4(glowColor, glow);
  const withFill = mix(glowLayer, vec4(fillColor, float(1)), fill);
  const withOutline = mix(withFill, vec4(outlineColor, float(1)), outline);

  return vec4(withOutline.xyz, withOutline.w.mul(fillOpacity));
});
