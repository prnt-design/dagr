/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * The surface is a camera, a way to get a renderer onto a canvas, and the plain
 * data that describes what it draws. M4.1 lit the pipeline up with a hard-coded
 * quad; M4.2 removed it, and a renderer now starts empty and draws whatever
 * `Renderer.setShapes` was last given. Real layout arrives in M4.4, behind that
 * same seam.
 *
 * The shape math is exported alongside the renderer rather than hidden inside
 * it, because two later tasks need the numbers without the GPU: M4.8's picking
 * asks whether a world point is inside a shape, which is the sign of
 * `roundedRectDistance`, and M4.4's bounds ask how much room a shape needs,
 * which is `shapeQuadSize`. A second copy of a distance field is a second
 * chance to get a sign wrong.
 *
 * Not one three.js type appears in anything exported from this file. See
 * `types.ts` for why: three is a peer dependency, so it stays an implementation
 * detail of `webgpu-renderer.ts`. That is what keeps `sdf-nodes.ts` and
 * `shape-material.ts` off this list: every signature in those two mentions a
 * `Node`, a `Mesh` or a material, and exporting either would make two copies of
 * three in one tree a type error rather than a bundle-size problem.
 * `test/index.test.ts` pins the runtime surface as an exact set for that
 * reason, so adding one is a failing test rather than a well-meaning edit.
 *
 * `PKG_NAME` is gone. It was scaffolding from the workspace's first commit,
 * nothing imported it, and an exported constant nobody uses is one more thing a
 * consumer can depend on by accident.
 *
 * The renderer implementation class is not exported either, only
 * {@link createRenderer}, because the factory is the only thing that awaits
 * `init()` and a renderer that exists but cannot draw is not worth being able
 * to construct. `webgpu-renderer.ts` exports the class to its own test, which
 * is a different thing from putting it on the package's surface.
 */

export { Camera2D } from './camera.js';
export type { Camera2DInit } from './camera.js';
export { RendererDisposedError } from './errors.js';
export {
  AA_QUAD_PADDING_FRACTION,
  circleDistance,
  clampCornerRadius,
  edgeCoverage,
  glowIntensity,
  roundedRectDistance,
  shapeQuadSize,
} from './sdf.js';
export { normalizeShape } from './shape.js';
export type {
  NormalizedShape,
  NormalizedShapeStyle,
  ShapeInstance,
  ShapeKind,
  ShapeStyle,
} from './shape.js';
export { createRenderer } from './webgpu-renderer.js';
export type {
  OrthoFrustum,
  Renderer,
  RendererOptions,
  Size,
  Vec2,
  ViewportSize,
  WorldBounds,
} from './types.js';
