import { abs, float, fwidth, max, min, positionLocal, sqrt, vec4 } from 'three/tsl';
import { Color } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { Pair, SdfOps } from './sdf-ops.js';
import { circleDistance, roundedRectDistance } from './sdf.js';
import { shadeDistance } from './shading.js';
import type { Rgb, ShapeStyle } from './shading.js';
import type { Size } from './types.js';

/**
 * The TSL half of the shape algebra: the same maths, compiled to WGSL.
 *
 * **Everything in this file is a thin instantiation, and that is the whole
 * design.** `sdf-ops.ts` says why at length: the distance fields and the shading
 * are written ONCE, generically over {@link SdfOps}, and `test/sdf.test.ts` and
 * `test/shading.test.ts` run those exact lines over doubles. This file supplies
 * the second implementation of the arithmetic, hands it to the same functions,
 * and adds nothing. If a formula ever appears below, the design has been
 * abandoned and the suite is no longer evidence about the shader: there would be
 * two copies of the maths, and a copy that drifts still passes.
 *
 * ## `fwidth` is called here and nowhere else
 *
 * A screen-space derivative exists only inside a fragment shader. There is no
 * value a Node test could pass for it and no way for a Node test to evaluate
 * one, so `shading.ts` takes a filter width as an argument and this file is what
 * supplies it. That factoring is what leaves `coverage` a function of two
 * numbers, and therefore the reason the antialiasing is tested at all rather
 * than looked at.
 *
 * ## Every parameter is a plain `number`
 *
 * Sizes, radii, colours, widths and opacities all arrive as numbers and are
 * lifted with `tslOps.literal`, which puts them in the shader source as
 * constants. Deliberately no uniforms and no per-instance attributes: M4.3 owns
 * the per-instance attribute and therefore owns the material assembly decision
 * (one uber-material with a shape id, or one material per family), and adding a
 * uniform here would be that decision taken early under a different name. The
 * roadmap is explicit that M4.2 must not pre-empt it.
 *
 * ## Not exported from `index.ts`
 *
 * These are three.js node objects. `types.ts` records the rule that no three
 * type appears on this package's public surface, and see `index.ts` for the
 * consequences of breaking it.
 */

/** A scalar in the shader. The TSL spelling of the `T` in {@link SdfOps}. */
export type FloatNode = Node<'float'>;

/** A four-component colour in the shader: what a fragment has to be. */
export type Vec4Node = Node<'vec4'>;

/**
 * The TSL implementation of the nine operations.
 *
 * Method chaining (`a.add(b)`) for the binary arithmetic and the free functions
 * for the rest, which is simply what TSL offers: `min`, `max`, `abs` and `sqrt`
 * exist as both, and the free spelling reads closer to the WGSL it becomes.
 *
 * Every method is a one-liner and there is nothing to test in any of them beyond
 * "it returns a node", which is exactly what `test/sdf-tsl.test.ts` asserts. The
 * interesting claim is not made here at all: it is that this object and
 * {@link numberOps} agree about what the nine operations MEAN, and that is
 * carried by the operations being primitives on both sides rather than by any
 * assertion. `sdf-ops.ts` states the one place they are allowed to differ
 * (`NaN`, which no caller may hand in).
 */
export const tslOps: SdfOps<FloatNode> = {
  literal: (value) => float(value),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  abs: (a) => abs(a),
  sqrt: (a) => sqrt(a),
};

/**
 * A hex colour, decoded into the colour space three actually renders in.
 *
 * **This is the colour-space fix, and it is small because the investigation was
 * not.** Read out of three 0.185.1's own source rather than guessed:
 *
 *  - `ColorManagement.workingColorSpace` is `LinearSRGBColorSpace` and
 *    `ColorManagement.enabled` is `true` (`src/math/ColorManagement.js`).
 *  - `new Color(0xffb703)` therefore does NOT store 0xff, 0xb7, 0x03 over 255.
 *    `Color.setHex` defaults its `colorSpace` argument to `SRGBColorSpace` and
 *    ends with `ColorManagement.colorSpaceToWorking(this, colorSpace)`, so the
 *    stored channels are the sRGB values DECODED to linear
 *    (`src/math/Color.js`). M4.1's `MeshBasicNodeMaterial({ color })` uniform
 *    held those decoded numbers.
 *  - `renderer.outputColorSpace` defaults to `SRGBColorSpace` and
 *    `renderer.toneMapping` to `NoToneMapping` (`src/renderers/common/Renderer.js`).
 *    Because the output space differs from the working space,
 *    `needsFrameBufferTarget` is true, the scene is drawn into a LINEAR
 *    intermediate target, and a full-screen output pass encodes it to sRGB on
 *    the way to the canvas (`_renderOutput`, `NodeManager.getOutputNode`,
 *    `RenderOutputNode`).
 *  - That encode is applied to whatever a `fragmentNode` wrote.
 *    `NodeMaterial.setupFragment` passes a `fragmentNode` through
 *    `setupOutput` and nothing else, and `setupOutput` does fog and
 *    premultiplied alpha only: no colour transform lives in the material at all,
 *    on either branch.
 *
 * So a fragment that wrote `0xb7 / 255` straight would be treated as a linear
 * value, encoded on the way out, and land at about 0xdc: a visibly lighter,
 * washed-out amber that reads as a design change rather than as a bug. Decoding
 * here puts the same working-space numbers into the pipeline that M4.1's uniform
 * did, so the two frames are the same amber.
 *
 * Done by CONSTRUCTING A `Color` rather than by writing the sRGB EOTF out. The
 * point is not to compute the transfer function, it is to agree with three: if a
 * later version moves the working space, both M4.1's material and this move
 * together, where a hand-written formula would silently stop matching.
 *
 * **What is still unverified without a device:** that the output pass runs as
 * the source above says. The screenshot comparison is what settles it, and what
 * it will show if this is wrong is a lighter amber, not a broken frame.
 */
export function linearRgb(hex: number): Rgb<number> {
  const colour = new Color(hex);
  return { r: colour.r, g: colour.g, b: colour.b };
}

/**
 * A shape's appearance in plain numbers: colours as `0xRRGGBB`, widths in WORLD
 * units, opacities in `[0, 1]`.
 *
 * The number-valued twin of {@link ShapeStyle}, which is the generic one the
 * maths is written over. Two types rather than one because the boundary is real:
 * a caller thinks in hex colours and world units, and the shading thinks in
 * whatever arithmetic it was handed. {@link liftStyle} is the whole of the
 * conversion.
 */
export interface ShapeStyleSpec {
  readonly fill: number;
  readonly fillOpacity: number;
  readonly outline: number;
  /** The band's total thickness, measured INWARD from the boundary. */
  readonly outlineWidth: number;
  readonly outlineOpacity: number;
  readonly glow: number;
  /** How far outside the boundary the glow reaches before it is fully out. */
  readonly glowWidth: number;
  readonly glowOpacity: number;
}

/** Lifts one hex colour into three `float` constants, decoded to working space. */
function liftColour(hex: number): Rgb<FloatNode> {
  const { r, g, b } = linearRgb(hex);
  return { r: tslOps.literal(r), g: tslOps.literal(g), b: tslOps.literal(b) };
}

/** Lifts a whole {@link ShapeStyleSpec} into the node algebra. */
function liftStyle(style: ShapeStyleSpec): ShapeStyle<FloatNode> {
  return {
    fill: liftColour(style.fill),
    fillOpacity: tslOps.literal(style.fillOpacity),
    outline: liftColour(style.outline),
    outlineWidth: tslOps.literal(style.outlineWidth),
    outlineOpacity: tslOps.literal(style.outlineOpacity),
    glow: liftColour(style.glow),
    glowWidth: tslOps.literal(style.glowWidth),
    glowOpacity: tslOps.literal(style.glowOpacity),
  };
}

/**
 * The signed distance to a rounded rectangle of the given FULL size, centred on
 * the local origin, as a shader node.
 *
 * `size` is the whole width and height, not the half extents: that is
 * `@dagr/layout`'s vocabulary and `sdf.ts`'s, and putting a factor of two at
 * every call site is one of the few arithmetic mistakes that survives review.
 * Everything the caller passes is a number and everything the field does with
 * one is documented in {@link roundedRectDistance}, including the radius clamp,
 * which is a correctness fix rather than a guard.
 */
export function roundedRectSDF(point: Pair<FloatNode>, size: Size, radius: number): FloatNode {
  return roundedRectDistance(
    tslOps,
    point,
    { x: tslOps.literal(size.width), y: tslOps.literal(size.height) },
    tslOps.literal(radius),
  );
}

/** The signed distance to a circle centred on the local origin, as a shader node. */
export function circleSDF(point: Pair<FloatNode>, radius: number): FloatNode {
  return circleDistance(tslOps, point, tslOps.literal(radius));
}

/**
 * Fill, outline and glow for one fragment, from one signed distance, as a
 * PREMULTIPLIED `vec4`.
 *
 * Premultiplied because {@link shadeDistance} composites three layers and
 * premultiplied "over" is one expression on all four channels with no divide and
 * no undefined region; see `shading.ts`. **The material must therefore not
 * premultiply again**, and three will if it is asked to: see `shapes.ts` for the
 * blend state that gets the right equation without the second multiply.
 *
 * The four scalars are joined into a `vec4` here, at the very end, and nowhere
 * earlier. That is what keeps the whole composite inside the scalar algebra the
 * suite can run.
 */
export function shapeShading(
  distance: FloatNode,
  filterWidth: FloatNode,
  style: ShapeStyleSpec,
): Vec4Node {
  const shaded = shadeDistance(tslOps, distance, filterWidth, liftStyle(style));
  return vec4(shaded.r, shaded.g, shaded.b, shaded.a);
}

/**
 * A whole fragment: read the local position, measure the shape, take the filter
 * width from the derivative of that measurement, shade.
 *
 * `positionLocal` is the vertex position in the mesh's OWN space, which for a
 * `PlaneGeometry` is centred on the mesh origin. Both distance fields are also
 * centred on the origin, so a shape is positioned by moving its mesh and the
 * field never learns where it is. That is also what lets the plane be padded
 * beyond the shape without moving anything: see `shapes.ts`.
 *
 * **`fwidth(distance)` rather than `fwidth(position)`.** The derivative is taken
 * of the distance field itself, so it is the rate at which the distance changes
 * across one pixel, in the distance's own units. Because the fields are eikonal
 * (`|grad d| = 1`, which `test/sdf.test.ts` pins), that is exactly one pixel
 * measured in world units, which is what {@link coverage} divides by. Taking it
 * from the position would give the same number for an axis-aligned edge and the
 * wrong one everywhere the boundary turns, which is precisely the corners a
 * rounded rectangle exists for.
 *
 * The shape is passed as a function rather than as a tagged union so that adding
 * a shape is adding a function, and so that this composition has nothing to
 * switch on: whatever M6's VDSL asks for gets the same edge quality for free.
 */
export function shapeFragment(
  distanceAt: (point: Pair<FloatNode>) => FloatNode,
  style: ShapeStyleSpec,
): Vec4Node {
  const local = positionLocal.xy;
  const distance = distanceAt({ x: local.x, y: local.y });
  return shapeShading(distance, fwidth(distance), style);
}

/** {@link shapeFragment} for a rounded rectangle of the given FULL size. */
export function roundedRectFragment(size: Size, radius: number, style: ShapeStyleSpec): Vec4Node {
  return shapeFragment((point) => roundedRectSDF(point, size, radius), style);
}

/** {@link shapeFragment} for a circle of the given radius. */
export function circleFragment(radius: number, style: ShapeStyleSpec): Vec4Node {
  return shapeFragment((point) => circleSDF(point, radius), style);
}
