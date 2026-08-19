/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * M4.1 was first light: a camera, a way to get a renderer onto a canvas, and one
 * hard-coded quad to prove the pipeline works end to end. M4.2 replaced the quad
 * with six signed-distance-field shapes, and M4.3 drew those in two instanced
 * calls instead of six. Neither added anything callable, because a scene this
 * package chose was a demonstration rather than a feature.
 *
 * **M4.4 is where that ended: this package ships no scene at all now.**
 * `createRenderer` draws an empty one and {@link Renderer.setNodes} is how
 * anything reaches the canvas: an array of {@link SceneNode}, each carrying its
 * own centre, size, shape and colours, with {@link SceneStyle} for the three
 * uniforms every node in a scene shares. A node keeps its instance handle across
 * calls, so per-instance state survives (M4.6's springs, M4.8's picking ids).
 *
 * What `setNodes` deliberately does NOT take is a `LayoutResult`. Naming one
 * would make `@dagr/layout` a dependency of this package, and the y-down to
 * y-up conversion belongs to whoever owns the layout, which `camera.ts` has said
 * since M4.1.
 *
 * Three things stay internal, and the reasons differ:
 *
 * - The TSL nodes, because a TSL node is a three.js type and `types.ts` decided
 *   that no three.js type appears in this package's public surface. Exporting
 *   `roundedRectSDF` would make two copies of three in one consumer's tree a
 *   type error rather than a bundle-size problem.
 * - The instancing machinery (`instance-buffer.ts`, `instance-attributes.ts`,
 *   `instanced-scene.ts`, `scene-nodes.ts`), because `setNodes` is the seam a
 *   caller needs and an instance HANDLE API on top of it would be a guess at
 *   what M4.8's picking pass wants, made before there is a picking pass.
 * - The pure arithmetic in `sdf.ts`, which is the closest call since it has no
 *   three.js in it at all and is exhaustively tested. A public `Arith<T>` would
 *   be a promise to keep nine primitives stable for callers who are not writing
 *   this package's shaders, and nobody has asked.
 *
 * What the instancing does put on the surface is its two ERRORS,
 * {@link UnknownInstanceHandleError} and {@link SceneDisposedError},
 * because an error is the one part of an internal module that arrives in
 * somebody else's `catch` whether or not it was exported, and one that arrives
 * as a bare `Error` gets there with no `code` and failing `instanceof
 * DagrRenderError`.
 *
 * **M4.11 added the second thing this package can put on screen, and it is not
 * drawn by a GPU at all.** `createHtmlOverlay` positions DOM elements in world
 * coordinates over the canvas and keeps them registered with a `Camera2D`. It
 * is exported where the shape scene is not, and the difference is that the
 * overlay is a feature rather than a demonstration: a caller supplies the
 * elements, so nothing hard-coded becomes part of the contract. It fills this
 * package's text gap without a glyph pipeline, since the GPU draws thousands of
 * shapes and the DOM draws the tens of readable things.
 *
 * The overlay has no three.js in it, which raises a boundary question this
 * package answers deliberately: it lives here rather than in a package of its
 * own, on the option M4.6 named for the spring integrator, and the cost is that
 * a consumer who wants only the overlay still installs the `three` peer. See
 * `specs/2026-08-14-html-overlay-design.md` for the escape hatch and what
 * taking it would cost.
 *
 * **M4.6 took that same option for the springs themselves, which are exported
 * here and touch no GPU at all.** {@link stepSpring} and
 * {@link stepSpring2D} are a critically damped integrator in closed form, and
 * they are exported rather than internal because motion is a feature a caller
 * drives: M4.7 will run them over `LayoutDelta`s, and `@dagr/react` in M5 wants
 * the same curve for interaction animation that has no graph in it at all. The
 * module imports nothing from this package but the `Vec2` type and the shared
 * validators, so the day a second consumer makes a package of it, the move is a
 * file rather than a rewrite. Its whole surface is five names and two records
 * of numbers, and nothing in it needs a device to be tested.
 *
 * Not one three.js type appears in anything exported from this file. See
 * `types.ts` for why: three is a peer dependency, so it stays an implementation
 * detail of `webgpu-renderer.ts`.
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

export { Camera2D, fitZoom } from './camera.js';
export type { Camera2DInit } from './camera.js';
export {
  DagrRenderError,
  OverlayDisposedError,
  OverlayParentError,
  RendererDisposedError,
  SceneDisposedError,
  UnknownInstanceHandleError,
} from './errors.js';
export type { DagrRenderErrorCode } from './errors.js';
export {
  OVERLAY_INV_ZOOM_PROPERTY,
  OVERLAY_ZOOM_PROPERTY,
  createHtmlOverlay,
} from './html-overlay.js';
export type { HtmlOverlay, HtmlOverlayOptions, OverlayEntry, OverlayEntryInit } from './html-overlay.js';
export { measureHtmlSizes } from './measure-html.js';
export type { MeasureItem, MeasureOptions } from './measure-html.js';
export { CENTRE_ANCHOR } from './overlay-math.js';
export type { ElementAnchor, OverlayPlacement } from './overlay-math.js';
export { createRichNodes } from './rich-nodes.js';
export type { RichNode, RichNodeTier, RichNodes } from './rich-nodes.js';
export type { SceneStyle } from './instance-attributes.js';
export { advanceDashFlow, ribbonWidthAt } from './ribbon.js';
export type { RibbonDashStyle, RibbonStyle, RibbonWidth, RibbonWidthInput } from './ribbon.js';
export type { EdgeFrameStyle, SceneEdge, SceneEdgeGroup } from './scene-edges.js';
export type { NodeShape, SceneNode } from './scene-nodes.js';
export {
  HALF_LIFE_OMEGA,
  SETTLE_OMEGA_1_PERCENT,
  omegaForHalfLife,
  stepSpring,
  stepSpring2D,
} from './spring.js';
export type { Spring2DState, SpringState } from './spring.js';
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
