import {
  AddEquation,
  CustomBlending,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
} from 'three/webgpu';
import { circleFragment, roundedRectFragment } from './sdf-tsl.js';
import type { ShapeStyleSpec, Vec4Node } from './sdf-tsl.js';
import type { Size, Vec2 } from './types.js';
import type { GpuResource } from './webgpu-renderer.js';

/**
 * The scene M4.2 draws: one rounded rectangle and one circle, both shaded from
 * their own signed distance field.
 *
 * Split out of `webgpu-renderer.ts` because the two files answer different
 * questions. That one owns the lifecycle (when the buffer is reallocated,
 * whether `dispose` is idempotent, what happens after it) and is tested by
 * counting calls on stubs. This one owns what is in the scene, which is a pile
 * of numbers and three constructor calls, and is verified by looking at the
 * screenshot. Keeping them apart is also what keeps the renderer's collaborator
 * list honest: it takes a list of {@link GpuResource}, and never learns that a
 * resource is a geometry or a material.
 *
 * `GpuResource` is imported from `webgpu-renderer.ts` as a TYPE only, so there
 * is no runtime cycle: it is erased, and the import direction at runtime is one
 * way, from the renderer to here.
 */

/**
 * The shapes' colours, and the widths of the two bands drawn from the same
 * distance.
 *
 * The fill is M4.1's amber, kept deliberately: amber on near-black is nobody's
 * default, so a frame in this colour is provably a frame from this package, and
 * keeping the number identical is what makes the M4.1 and M4.2 screenshots
 * comparable at all. The outline is a paler tint of it rather than a contrasting
 * hue, because its job here is to prove that a second band read from the SAME
 * distance lands exactly on the shape's own edge; a contrasting colour would
 * make a misplaced outline look like a design choice.
 *
 * The widths are in WORLD units, which is what makes them scale with the shape
 * rather than with the screen: see {@link ShapeStyle}. Two units of outline on a
 * 40 unit tall box is a hairline that stays a hairline, and it is the case that
 * exercises the "a thin outline fades, it does not alias" property `shading.ts`
 * measures. The glow is 18 units at 0.55 opacity, wide enough that its outer
 * edge is unmistakable in a screenshot and therefore that the padding below is
 * doing something visible.
 */
export const SHOWCASE_STYLE: ShapeStyleSpec = {
  fill: 0xffb703,
  fillOpacity: 1,
  outline: 0xfff3d0,
  outlineWidth: 2,
  outlineOpacity: 1,
  glow: 0xffb703,
  glowWidth: 18,
  glowOpacity: 0.55,
};

/** The rounded rectangle: `@dagr/layout`'s `defaultNodeSize`, as M4.1 drew it. */
export const SHOWCASE_RECT = {
  size: { width: 100, height: 40 } satisfies Size,
  radius: 10,
  center: { x: -90, y: 0 } satisfies Vec2,
} as const;

/** The circle, placed the same distance the other side of the origin. */
export const SHOWCASE_CIRCLE = {
  radius: 24,
  center: { x: 90, y: 0 } satisfies Vec2,
} as const;

/**
 * Extra world units added to the glow width when a quad is sized.
 *
 * The glow's falloff is `clamp((glowWidth - d) / glowWidth, 0, 1)` squared, so
 * it is EXACTLY zero at `d = glowWidth` and beyond: `glowWidth` alone is enough
 * padding in exact arithmetic. This slack covers the two places exact arithmetic
 * is not what runs. A fragment is shaded from its CENTRE, so the outermost
 * shaded row of pixels sits half a pixel inside the quad's edge and reports a
 * distance slightly under the width; at a very low zoom, where one pixel is many
 * world units, "slightly" is not small. And the shader computes in 32-bit float,
 * where the subtraction near the ramp's end has no guard digits left.
 *
 * Two units against an 18 unit glow is about 11 per cent, which costs a few per
 * cent of fill rate on a quad that is mostly transparent anyway. Cheap insurance
 * against the one artefact this padding exists to prevent.
 */
export const GLOW_PADDING_SLACK = 2;

/**
 * The quad a shape has to be drawn on: its own extent, plus room for the glow.
 *
 * **The padding is the decision here, and clipping the glow is what it
 * prevents.** A shape's geometry is not its silhouette. The fragment shader can
 * only run where there are fragments, so anything a shape draws OUTSIDE its own
 * boundary, which for this style is a glow reaching 18 world units, needs quad
 * to run on. A quad sized to the shape ends the glow in a hard straight line at
 * the shape's bounding box: a rectangular halo with square corners around a
 * rounded rectangle, which looks like a bug in the shape rather than a bug in
 * the geometry, and which is exactly the sort of thing that gets diagnosed as
 * "the SDF is wrong".
 *
 * So every quad is grown by `glowWidth + GLOW_PADDING_SLACK` on every side, on
 * BOTH axes, which is 20 units here: a 100 by 40 rectangle is drawn on a 140 by
 * 80 plane, and a radius 24 circle on an 88 by 88 one.
 *
 * The alternative, drawing the glow as a second larger quad behind the shape,
 * was not taken: it doubles the draw calls and the vertex count, and it
 * reintroduces the seam at the boundary that `shading.ts` composites the glow
 * UNDER the fill to avoid.
 */
export function paddedQuadSize(size: Size, style: ShapeStyleSpec): Size {
  const padding = 2 * (style.glowWidth + GLOW_PADDING_SLACK);
  return { width: size.width + padding, height: size.height + padding };
}

/**
 * The material that draws one SDF fragment, with the blend state premultiplied
 * "over" needs.
 *
 * ## Why `premultipliedAlpha` is FALSE, which is not what it looks like
 *
 * {@link shapeShading} returns premultiplied colour, so the obvious spelling is
 * `premultipliedAlpha: true`. It is wrong, and it was read out of three
 * 0.185.1's source rather than assumed. `NodeMaterial.setupOutput` runs on the
 * `fragmentNode` branch as well as on the lit one, and it contains:
 *
 * ```js
 * if ( this.premultipliedAlpha === true ) {
 *   outputNode = this.setupPremultipliedAlpha( builder, outputNode );
 * }
 * ```
 *
 * which is `premultiplyAlpha(outputNode)`, i.e. `vec4(rgb * a, a)`. Setting the
 * flag would multiply an already premultiplied colour by its alpha a SECOND
 * time. That is not an error anywhere: it is a shape that looks right in the
 * middle with a dark halo around every antialiased edge and around the whole
 * glow, which reads as "the antialiasing is a bit off" rather than as "the blend
 * mode is wrong". `shading.ts` warns about exactly this failure, and three's
 * convenience flag is the way to walk into it.
 *
 * What that flag is otherwise good for is the BLEND EQUATION, so that is set
 * directly instead. `WebGPUPipelineUtils._getBlending` maps
 * `premultipliedAlpha: true` plus `NormalBlending` to
 * `(One, OneMinusSrcAlpha)` on both colour and alpha, and `CustomBlending` to
 * whatever the material's `blendSrc`/`blendDst` say. The four factors below are
 * that same equation, written out. `WebGLState` in the WebGL2 fallback maps
 * `CustomBlending` the same way, which matters because `WebGPURenderer` falls
 * back on its own and M4.9 owns that story rather than this file.
 *
 * ## `depthWrite: false`
 *
 * Every fragment of these quads would write depth, including the padding, which
 * is fully transparent. Two shapes whose padded quads overlap would then have
 * the second one's glow depth-rejected by the first one's INVISIBLE rectangle:
 * the clipped halo the padding exists to prevent, reintroduced through the depth
 * buffer, and harder to explain because there is nothing on screen where the
 * clipping happens. A 2D scene gets its ordering from draw order anyway (M4.5
 * owns layering), so there is nothing for a depth write to contribute.
 *
 * `depthTest` is left alone. With no shape writing depth there is nothing to
 * test against, so turning it off would change no pixel and would lose the
 * ability for M4.5 to put something opaque behind these.
 *
 * ## Why `MeshBasicNodeMaterial` when none of it is used
 *
 * With `fragmentNode` set, `NodeMaterial.setupFragment` skips the diffuse
 * colour, the variants, the lighting and the output node entirely, so nothing
 * that makes this material "basic" runs. It is used because it is the
 * `NodeMaterial` three's own `StandardNodeLibrary` maps by type, which is one
 * fewer thing to be surprised by. M4.3 owns the real material decision and is
 * free to replace all of this.
 */
export function createShapeMaterial(fragment: Vec4Node): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = fragment;
  material.transparent = true;
  material.premultipliedAlpha = false;
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendEquationAlpha = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  material.depthWrite = false;
  return material;
}

/** Everything a scene needs from this module, and everything it has to give back. */
export interface SceneShapes {
  /** Ready to `scene.add`, positioned in world units. */
  readonly meshes: readonly Mesh[];
  /**
   * Every geometry and every material built above, in one list. The renderer
   * disposes these and reads nothing else off them, which is what lets its
   * lifecycle be tested with counting stubs and no three at all.
   */
  readonly resources: readonly GpuResource[];
}

/** One mesh, its padded quad, and the two resources it owns. */
function shapeMesh(quad: Size, center: Vec2, fragment: Vec4Node): [Mesh, GpuResource, GpuResource] {
  const geometry = new PlaneGeometry(quad.width, quad.height);
  const material = createShapeMaterial(fragment);
  const mesh = new Mesh(geometry, material);
  // z stays 0: the orthographic frustum is set up around that plane (see
  // CAMERA_NEAR and CAMERA_FAR), and layering is M4.5's, through draw order
  // rather than through depth.
  mesh.position.set(center.x, center.y, 0);
  return [mesh, geometry, material];
}

/**
 * Builds the M4.2 showcase: both shapes, both drawn through the SDF path.
 *
 * Two shapes rather than one because the claim M4.2 owes is that fill, outline
 * and glow come from ONE distance and that a second shape inherits the edge
 * quality for free. One rounded rectangle proves the first half and none of the
 * second: a circle next to it, shaded by the same {@link shapeShading} over a
 * different distance field, is what makes the shared shading visible in a single
 * frame.
 */
export function createShowcaseShapes(): SceneShapes {
  const [rect, rectGeometry, rectMaterial] = shapeMesh(
    paddedQuadSize(SHOWCASE_RECT.size, SHOWCASE_STYLE),
    SHOWCASE_RECT.center,
    roundedRectFragment(SHOWCASE_RECT.size, SHOWCASE_RECT.radius, SHOWCASE_STYLE),
  );

  const diameter = 2 * SHOWCASE_CIRCLE.radius;
  const [circle, circleGeometry, circleMaterial] = shapeMesh(
    paddedQuadSize({ width: diameter, height: diameter }, SHOWCASE_STYLE),
    SHOWCASE_CIRCLE.center,
    circleFragment(SHOWCASE_CIRCLE.radius, SHOWCASE_STYLE),
  );

  return {
    meshes: [rect, circle],
    resources: [rectGeometry, rectMaterial, circleGeometry, circleMaterial],
  };
}
