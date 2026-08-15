import { abs, add, div, float, fract, max, min, mul, sqrt, sub } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { RIBBON_AA_PADDING_PIXELS, ribbonCoverage } from './ribbon.js';
import type { DashArith, RibbonCoverageInput } from './ribbon.js';
import type { FloatNode } from './sdf-nodes.js';

/**
 * The TSL half of M4.5: ten primitives wired to their shader spellings, the one
 * multiply that turns a ribbon's offset into a world position, and the alpha
 * its fragments write.
 *
 * **This file contains no formula.** `ribbon.ts` holds the arithmetic, written
 * once over {@link DashArith} and executed by `test/ribbon.test.ts` on plain
 * numbers; the same expression tree is what the shader evaluates. That is the
 * arrangement `sdf.ts` and `sdf-nodes.ts` set up for M4.2, and the reason to
 * repeat it rather than write a dash pattern straight into TSL is that a dash
 * that drifts, or a ramp on one side of a dash and a hard step on the other,
 * are exactly the defects a Node test can catch and a screenshot cannot.
 *
 * **The untested surface is the ten adapters plus ONE expression**, which is
 * {@link ribbonWorldPosition}'s `vec2` multiply-add. It cannot go through the
 * float interface: it scales a two component offset. The compensating control
 * is in `test/ribbon-nodes.test.ts`, which asserts that the graph's outermost
 * operation is an `add` over the position and a `mul`, so a shader that
 * REPLACED the position with the offset, or added the width instead of scaling
 * by it, fails there. What no test in this process can see is that the built
 * graph compiles to WGSL and puts a lit pixel on screen; the committed
 * screenshot is the whole of that evidence, as it is for the shapes.
 *
 * Nothing here is exported from `index.ts`, for the reason `sdf-nodes.ts`
 * gives: a TSL node is a three.js type, three is a peer dependency, and
 * `types.ts` keeps every three.js type out of this package's public surface.
 */

/**
 * The ten primitives, in TSL: the nine `tslArith` has plus `fract`.
 *
 * Written out rather than spread over `tslArith` and extended with one member.
 * Spreading would read as the cheaper spelling and would tie this object's
 * shape to another file's, which is precisely the coupling the test asserting
 * "exactly the members `numberDashArith` has" exists to check independently.
 *
 * Arrow functions rather than the TSL functions themselves, again as
 * `tslArith`: the TSL functions are variadic and overloaded on vector width, so
 * assigning `add` straight into a two argument slot typechecks through a wider
 * overload and would silently allow a `vec2` where every formula assumes a
 * float.
 */
export const tslDashArith: DashArith<FloatNode> = {
  literal: (value) => float(value),
  add: (a, b) => add(a, b),
  sub: (a, b) => sub(a, b),
  mul: (a, b) => mul(a, b),
  div: (a, b) => div(a, b),
  abs: (a) => abs(a),
  min: (a, b) => min(a, b),
  max: (a, b) => max(a, b),
  sqrt: (a) => sqrt(a),
  fract: (a) => fract(a),
};

/** What the vertex stage needs to put a ribbon vertex where it belongs. */
export interface RibbonVertexInput {
  /** The centreline point, from `RibbonGeometry.position`. World units. */
  readonly position: Node<'vec2'>;

  /** Which way and how far this vertex leaves it, from `RibbonGeometry.offset`. Half widths. */
  readonly offset: Node<'vec2'>;

  /** Half the ribbon's visible width, in DEVICE pixels. A uniform, not an attribute. */
  readonly halfWidthPixels: FloatNode;

  /**
   * How many device pixels one world unit covers: the camera's zoom times the
   * device pixel ratio, which is what `Camera2D.drawingBufferSize` already
   * measures the framebuffer in.
   */
  readonly pixelsPerWorldUnit: FloatNode;
}

/**
 * Where a ribbon vertex goes: its centreline point, plus its offset scaled to
 * the half width the CAMERA implies.
 *
 * This one multiply is the whole cost of the screen-space width decision, and
 * it is the reason the geometry never has to be rebuilt when the camera moves.
 * `ribbon.ts`'s module docstring carries the argument for the decision itself.
 *
 * The scale is the visible half width PLUS {@link RIBBON_AA_PADDING_PIXELS},
 * because the geometry is built one pixel proud of the ribbon it draws so that
 * the antialiasing ramp is inside the triangles rather than clipped by them.
 * {@link ribbonAlpha} subtracts the same padding back off, so the pair have to
 * agree and the constant is imported by both rather than written twice.
 *
 * A `vec2` in world units, which is what a mesh's `positionNode` wants a `z` of
 * zero appended to. Appending it is the scene's business: this file has no
 * opinion about materials, as `sdf-nodes.ts` has none about meshes.
 */
export function ribbonWorldPosition(input: RibbonVertexInput): Node<'vec2'> {
  const expandPixels = add(input.halfWidthPixels, float(RIBBON_AA_PADDING_PIXELS));
  return add(input.position, mul(input.offset, div(expandPixels, input.pixelsPerWorldUnit)));
}

/**
 * The arc length at this vertex in DEVICE pixels: the world arc length times
 * the pixels per world unit.
 *
 * A named function for one multiply, because WHERE it happens is the point. In
 * the vertex stage it is one multiply per vertex and the interpolator carries
 * the result, which is exact: an orthographic camera is an affine map, so a
 * length that is linear along the ribbon in world units is linear along it in
 * pixels. In the fragment stage it would be the same number computed millions
 * of times a second. Under a PERSPECTIVE camera the interpolation would no
 * longer be affine and this would have to move; nothing in M4 has one.
 */
export function ribbonArcPixels(arc: FloatNode, pixelsPerWorldUnit: FloatNode): FloatNode {
  return mul(arc, pixelsPerWorldUnit);
}

/**
 * The alpha a ribbon fragment writes: {@link ribbonCoverage} over the ten
 * primitives.
 *
 * An alpha and not a colour, which is the difference from `shapeShading`. A
 * ribbon's colour is one flat value per edge, so it is a per-vertex attribute
 * or a uniform the caller already owns, and there is nothing here to composite
 * it with: no fill, no inset outline, no halo. Handing back the coverage alone
 * keeps this file out of the material assembly that M4.3's instancing work
 * owns.
 */
export function ribbonAlpha(input: RibbonCoverageInput<FloatNode>): FloatNode {
  return ribbonCoverage(tslDashArith, input);
}
