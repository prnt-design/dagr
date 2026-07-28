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
  shapeAlpha,
} from './sdf.js';
import type { Arith } from './sdf.js';

/**
 * The TSL half of M4.2: the nine primitives wired to their shader spellings, and
 * the shape nodes built on top of them.
 *
 * **This file contains no formulas.** Every piece of arithmetic it draws with
 * lives in `sdf.ts`, written once over {@link Arith}, and is imported here.
 * `tslArith` below is nine one-line adapters long on purpose: see the module
 * docstring in `sdf.ts` for why that arrangement was chosen over writing each
 * formula twice.
 *
 * **The untested surface is those nine adapters PLUS THREE pieces of TSL,** which
 * is worth counting honestly rather than rounding down to the adapters:
 *
 * - the `max` of two `length(vec2(dFdx(p.c), dFdy(p.c)))` in {@link antialiasWidth}.
 *   `length` and the derivatives are WGSL intrinsics and cannot go through a float
 *   interface. Compensating control: `test/sdf-nodes.test.ts` asserts the graph
 *   structurally, that the outermost operation is a `max` over two `length`s, that
 *   each is a two component join of `dFdx` and `dFdy` differentiating ONE component,
 *   that the two branches take DIFFERENT components, and that no arithmetic stands
 *   between the position and the derivative. What it cannot assert is the reason the
 *   operand is the position at all, so `test/sdf.test.ts` executes that separately:
 *   it runs the real distance formulas at the four fragment centres of one quad and
 *   pins the gradient at exactly zero, which is the fold this signature avoids.
 * - the colour `mix` in {@link shapeShading}, which is a `vec3` operation and would
 *   widen {@link Arith} for one call site. Compensating control: the same file
 *   asserts that the outermost node of the colour is a `mix` and of the alpha a
 *   `max`. That rules out an `add` or a `mul` blend and says nothing about the
 *   order of the three layers.
 * - `mul(size, 0.5)` and the `half.x` / `half.y` swizzles inside
 *   {@link roundedRectSDF}'s `Fn` body. This one has NO compensating control, and
 *   the reason is the `Fn`: its body is deferred until a `NodeBuilder` runs, so
 *   calling it in Node builds a call node and never constructs the halving, and the
 *   test that builds the body eagerly passes pre-halved literals to
 *   `roundedRectDistance` and so bypasses it. A factor of two in the wrong place
 *   there would draw every rect at half or twice its size, and the committed
 *   screenshot is the whole of the evidence against that.
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
 * One DEVICE pixel, measured in world units, at the fragment being shaded: the
 * larger of the two per-axis screen-space gradients of the interpolated POSITION.
 *
 * **It takes the position, not the distance, and that is the whole point.** Every
 * field in `sdf.ts` folds: `roundedRectDistance` runs both coordinates through
 * `abs`, `circleDistance` squares them. A derivative is a finite difference across
 * a 2x2 fragment quad, so on the quad containing a shape's centre, where both
 * symmetry axes cross, all four fragments see the SAME distance and the difference
 * is zero in both directions. An `aaWidth` read off the distance gradient collapses
 * there, and since `outlineCoverage` derives its band as `outlinePixels * aaWidth`,
 * the inset outline vanishes at exactly those fragments and the fill's ramp becomes
 * a hard step.
 *
 * Invisible on large shapes, whose centre is deep in the fill where the outline is
 * zero anyway. Severe on small ones, and NOT STATIC: whether the centre lands on an
 * even or odd quad boundary depends on the shape's sub-pixel position, so a 4 pixel
 * circle measured on a real device flipped between all fill and all outline on
 * alternate pan phases. On a graph of ten thousand small nodes that is a field
 * strobing in checkerboard phase, which is the opposite of what an SDF is for.
 * The position has no `abs` and no square in front of it, so it cannot fold.
 * `test/sdf.test.ts` executes the fold; `test/sdf-nodes.test.ts` pins this graph.
 *
 * **`max` of two `length`s, and NOT `fwidth`.** `fwidth` is `abs(dFdx) + abs(dFdy)`,
 * the L1 norm, which exceeds the L2 norm by up to `sqrt(2)`, 41% too wide, when the
 * two derivatives are equal. Equal derivatives means an edge at 45 degrees, and a
 * rounded corner is a continuum of diagonals: with `fwidth` the ramp is right along
 * the flat sides and up to 41% too soft at the corner, which reads as corners
 * blurrier than the edges they join, at every zoom.
 *
 * The `max` over the two axes costs a second `length` against differentiating one
 * scalar. The cheaper `max(abs(dFdx(p.x)), abs(dFdy(p.y)))` is exact for the
 * axis-aligned orthographic camera this package has today and WRONG under rotation,
 * which M4.4 may want, so the general form is taken now rather than swapped in later.
 *
 * **DEVICE pixels, not CSS pixels.** The derivative is taken across a framebuffer
 * pixel, and `#syncSize` sizes the framebuffer from `Camera2D.drawingBufferSize()`,
 * which is the CSS size times the device pixel ratio. So this is `1 / (zoom * dpr)`
 * world units, and `1 / zoom` only at dpr 1. That is correct for antialiasing, which
 * wants device pixels, and it is why `ShapeStyle.outlinePixels` is documented in
 * device pixels too: making the outline a true CSS width would need the ratio in the
 * shader as a uniform, putting a second reader of `devicePixelRatio` beside
 * `drawingBufferSize` and breaking the rule `camera.ts` states.
 *
 * Nothing here reads the camera: the width follows whatever transform the mesh has
 * picked up, because the position Jacobian IS that transform.
 */
export function antialiasWidth(position: Node<'vec2'>): FloatNode {
  return max(
    length(vec2(dFdx(position.x), dFdy(position.x))),
    length(vec2(dFdx(position.y), dFdy(position.y))),
  );
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
  /**
   * The interpolated position this fragment sits at, in the same space the
   * distance was measured in. Used ONLY for the pixel width, and it has to be the
   * position rather than the distance because every distance folds: see
   * {@link antialiasWidth}.
   */
  readonly position: Node<'vec2'>;
  readonly fillColor: ColorNode;
  readonly outlineColor: ColorNode;
  readonly glowColor: ColorNode;
  /** The halo's alpha where it meets the boundary, in `[0, 1]`. */
  readonly glowAlpha: FloatNode;
  /** The inset outline's width, in DEVICE pixels. See {@link antialiasWidth}. */
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
 * **The alpha is not written here.** It is `shapeAlpha` in `sdf.ts`, over the
 * same nine primitives as every other formula, because it is pure float
 * arithmetic and `mul` and `max` were already two of the nine: no tenth
 * primitive, and `test/sdf.test.ts` executes the compositing decision rather than
 * reading it. That docstring carries the argument for `max` over the `over` chain
 * and the measured numbers (0.5 against 0.725 at the boundary, a 0.36 pixel
 * outward shift of the apparent edge), and the test asserts both.
 *
 * The colour could NOT come along, and the asymmetry is visible right here in the
 * two lines below. `mix` is a `vec3` operation, so hoisting it into `Arith` would
 * widen the interface for one call site and add a tenth line to `tslArith` that
 * no Node test can execute, which is precisely the cost the nine-primitive count
 * exists to keep visible. So the colour stays in TSL and `test/sdf-nodes.test.ts`
 * checks it structurally instead: the outermost node of the alpha is a `max` and
 * the outermost node of the colour is a `mix`.
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
  const aaWidth = antialiasWidth(input.position);
  const fill = fillCoverage(tslArith, input.distance, aaWidth);
  const outline = outlineCoverage(tslArith, input.distance, input.outlinePixels, aaWidth);
  const glow = glowCoverage(tslArith, input.distance, input.glowWorld, aaWidth);

  return {
    color: mix(mix(input.glowColor, input.fillColor, fill), input.outlineColor, outline),
    alpha: shapeAlpha(tslArith, input.glowAlpha, glow, fill, outline),
  };
}
