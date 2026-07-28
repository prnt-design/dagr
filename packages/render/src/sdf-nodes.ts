import {
  Fn,
  abs,
  add,
  dFdx,
  dFdy,
  div,
  float,
  length,
  max,
  min,
  mix,
  mul,
  sqrt,
  sub,
  vec2,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  circleDistance,
  fillCoverage,
  glowCoverage,
  outlineCoverage,
  roundedRectDistance,
} from './sdf.js';
import type { Arith } from './sdf.js';

/**
 * The TSL half of M4.2: the nine primitives wired to their shader spellings, and
 * the shape nodes built on top of them.
 *
 * **This file contains no formulas.** Every piece of arithmetic it draws with
 * lives in `sdf.ts`, written once over {@link Arith}, and is imported here.
 * `tslArith` below is the only thing in the package that cannot be executed by a
 * Node test, and it is nine one-line adapters long on purpose: see the module
 * docstring in `sdf.ts` for why that arrangement was chosen over writing each
 * formula twice.
 *
 * Nothing here is exported from `index.ts`. A TSL node is a three.js type, and
 * `types.ts` decided that no three.js type appears in this package's public
 * surface, because three is a peer dependency and an exported `Node<'float'>`
 * would make two copies of three in one tree a type error for every consumer.
 * These are internal to `shape-scene.ts` and to the tests.
 */

/** A node carrying a single float. The value type every formula here is built over. */
export type FloatNode = Node<'float'>;

/**
 * A node carrying a colour: either a `vec3` or three's own `color` type, which
 * are the same three components with different provenance. Accepting both is
 * what lets `shape-scene.ts` hand over a `Color` converted by three (so the sRGB
 * to linear step is three's problem and not this file's) while a test can hand
 * over a literal `vec3`.
 */
export type ColorNode = Node<'vec3'> | Node<'color'>;

/**
 * The nine primitives, in TSL.
 *
 * The whole untested arithmetic surface of this package, and the reason it is
 * worth counting: every line here is a line that only a GPU can check. They are
 * kept to one call each so that reading them IS reviewing them, and
 * `test/sdf-nodes.test.ts` pins that this object has exactly the members
 * `numberArith` has, so an operation added to one backend and not the other fails
 * a test rather than a shader compilation on somebody's machine.
 *
 * Written as arrow functions rather than as `add` directly, because the TSL
 * functions are variadic and overloaded on vector width: assigning `add` to a
 * two-argument slot would typecheck through a wider overload and silently allow
 * a `vec3` where the formulas assume a float.
 */
export const tslArith: Arith<FloatNode> = {
  literal: (value) => float(value),
  add: (a, b) => add(a, b),
  sub: (a, b) => sub(a, b),
  mul: (a, b) => mul(a, b),
  div: (a, b) => div(a, b),
  abs: (a) => abs(a),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  sqrt: (a) => sqrt(a),
};

/**
 * One CSS pixel, measured in world units, at the fragment being shaded: the
 * length of the screen-space gradient of the distance field.
 *
 * **`length(vec2(dFdx(d), dFdy(d)))`, and NOT `fwidth(d)`.** `fwidth` is defined
 * as `abs(dFdx(d)) + abs(dFdy(d))`, which is the L1 norm of the same gradient,
 * and the L1 norm exceeds the L2 norm by up to a factor of `sqrt(2)`, 41% too
 * wide, when the two derivatives are equal. Equal derivatives means an edge at 45
 * degrees, and a rounded corner is nothing but a continuum of diagonals: with
 * `fwidth` the antialiasing ramp is correct along the flat sides and up to 41%
 * too soft at the corner's diagonal, which reads as corners that are blurrier
 * than the edges they join, at every zoom, and is exactly the artefact an SDF is
 * supposed to remove.
 *
 * It costs one `sqrt` per fragment against `fwidth`'s two `abs` and an add. That
 * is the trade, taken deliberately, and there is already a `sqrt` in the rounded
 * rect distance so the unit is not new to the shader.
 *
 * This is one CSS pixel in world units because the fields in `sdf.ts` are TRUE
 * euclidean distances: the gradient of such a field has magnitude 1 in world
 * space, so differentiating it across a pixel gives world units per pixel and
 * nothing else. That is also why nothing here reads the camera: the width follows
 * whatever transform the mesh has picked up, including one M4.4 has not written.
 */
export function antialiasWidth(distance: FloatNode): FloatNode {
  return length(vec2(dFdx(distance), dFdy(distance)));
}

/**
 * The signed distance to a rounded rectangle of `size`, centred on the origin of
 * whatever space `p` is in, with corner radius `radius`.
 *
 * An `Fn`, so it composes: a caller can put it through
 * {@link shapeShading}, through a different compositing pass, or through nothing
 * at all. It has no opinion about materials, colours or meshes, and that is what
 * makes M4.5's layering somebody else's decision rather than a rewrite of this.
 *
 * Takes the FULL size and halves it here, because a caller thinks in the size a
 * layout gave them and `PlaneGeometry` takes a full size too. The half extents
 * the SDF wants are an implementation detail of the formula.
 *
 * Note what an `Fn` does not buy: its body is deferred until a `NodeBuilder`
 * runs, so calling this in Node builds a call node and does not construct the
 * arithmetic inside. `test/sdf-nodes.test.ts` therefore also builds the body
 * directly, by calling `roundedRectDistance` with `tslArith`.
 */
export const roundedRectSDF = Fn(
  ([p, size, radius]: [Node<'vec2'>, Node<'vec2'>, FloatNode]): FloatNode => {
    const half = mul(size, 0.5);
    return roundedRectDistance(tslArith, p.x, p.y, half.x, half.y, radius);
  },
);

/**
 * The signed distance to a circle of `radius` centred on the origin of `p`'s
 * space. The cheap sibling of {@link roundedRectSDF}: five operations against
 * eleven, for the shape a graph draws most of after boxes.
 */
export const circleSDF = Fn(([p, radius]: [Node<'vec2'>, FloatNode]): FloatNode => {
  return circleDistance(tslArith, p.x, p.y, radius);
});

/** Everything {@link shapeShading} needs. See {@link ShapeStyle} for the units. */
export interface ShapeShadingInput {
  /** The signed distance at this fragment, in world units. Any field will do. */
  readonly distance: FloatNode;
  readonly fillColor: ColorNode;
  readonly outlineColor: ColorNode;
  readonly glowColor: ColorNode;
  /** The halo's alpha where it meets the boundary, in `[0, 1]`. */
  readonly glowAlpha: FloatNode;
  /** The inset outline's width, in CSS pixels. */
  readonly outlinePixels: FloatNode;
  /** The halo's reach past the boundary, in world units. */
  readonly glowWorld: FloatNode;
}

/** What a material needs: a colour for `colorNode` and an alpha for `opacityNode`. */
export interface ShapeShading {
  readonly color: Node<'vec3'>;
  readonly alpha: FloatNode;
}

/**
 * Turns a DISTANCE into a colour and an alpha: fill, inset outline and glow,
 * composited once for every shape there will ever be.
 *
 * It takes a distance rather than a shape, which is the seam that matters. Any
 * field can go through it, including one M4.5 writes for an edge or a selection
 * halo, and the compositing decisions below are then made in one place instead of
 * once per shape kind.
 *
 * A plain function rather than an `Fn`, deliberately, and for a testability
 * reason rather than a performance one: an `Fn` defers its body until a builder
 * runs, so nothing in Node could check that this graph builds at all, whereas a
 * plain function constructs every node the moment it is called. The generated
 * shader is the same either way for a graph used once per material, since TSL
 * inlines a single call.
 *
 * ## Compositing
 *
 * Standard non-premultiplied alpha, in two expressions:
 *
 * ```
 * alpha = max(glowAlpha * glowCoverage, max(fillCoverage, outlineCoverage))
 * rgb   = mix(mix(glowColor, fillColor, fillCoverage), outlineColor, outlineCoverage)
 * ```
 *
 * `max` on the alpha rather than the usual `over` chain (`a + b * (1 - a)`),
 * because these three coverages are not three independent layers: they are three
 * regions of ONE shape, and the alpha wanted is "how much of this pixel does the
 * shape cover", not "how opaque is a stack of three sheets". The `over` form
 * would push the alpha towards 1 wherever the glow and the fill ramps overlap,
 * which is a one pixel band all the way round every shape, and the visible result
 * is a shape whose edge is slightly darker and slightly bigger than its geometry:
 * exactly the half-pixel inflation `fillCoverage`'s exact 0.5 at the boundary
 * exists to rule out. `max` leaves the boundary at 0.5 alpha, where it belongs.
 *
 * `mix` on the colour in glow, then fill, then outline order, which is
 * back-to-front and therefore the order the layers actually sit in. The outline
 * wins where it is opaque because it is drawn last, which is what "inset outline"
 * means, and the fill's own ramp still shows through the outline's antialiased
 * edges because a `mix` weight of 0.5 is a 50/50 blend rather than a decision.
 *
 * A colour is produced for every fragment including the ones with alpha 0, which
 * costs two `mix` instructions in the fully transparent region outside the glow.
 * Discarding instead would save them and cost the early-z rejection the GPU can
 * do for a `discard`-free shader, which is the wrong trade for a scene of
 * transparent overlapping quads. Worth revisiting with M4.10's numbers rather
 * than on this reasoning alone.
 */
export function shapeShading(input: ShapeShadingInput): ShapeShading {
  const aaWidth = antialiasWidth(input.distance);
  const fill = fillCoverage(tslArith, input.distance, aaWidth);
  const outline = outlineCoverage(tslArith, input.distance, input.outlinePixels, aaWidth);
  const glow = glowCoverage(tslArith, input.distance, input.glowWorld, aaWidth);

  return {
    color: mix(mix(input.glowColor, input.fillColor, fill), input.outlineColor, outline),
    alpha: max(mul(input.glowAlpha, glow), max(fill, outline)),
  };
}
