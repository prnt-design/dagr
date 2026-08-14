/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * M4.1 was first light: a camera, a way to get a renderer onto a canvas, and one
 * hard-coded quad to prove the pipeline works end to end.
 *
 * **M4.2 changed what is drawn and not what is callable, and that is
 * deliberate.** `createRenderer` now puts six signed-distance-field shapes on
 * screen instead of one quad, on three rungs a decade apart so that one frame shows
 * what an SDF does at both ends of the zoom range. The RECTS are 10, 100 and 1000
 * world units across, which is the 100:1 the rest of the package quotes; the
 * circles are 4, 40 and 400, so the shapes themselves span 250:1. Both numbers are
 * true of different things and the tests assert them separately, so quote the one
 * you mean. Not one export was added for any of it.
 * Two reasons, and neither is an oversight:
 *
 * - The TSL nodes stay internal because a TSL node is a three.js type, and
 *   `types.ts` decided that no three.js type appears in this package's public
 *   surface. Exporting `roundedRectSDF` would make two copies of three in one
 *   consumer's tree a type error rather than a bundle-size problem.
 * - The shape scene stays internal because it is a demonstration, not a feature.
 *   M4.4 owns feeding a real layout in, and exporting a hard-coded ladder of six
 *   shapes now would make a placeholder part of the contract, which is the kind
 *   of thing that survives three milestones because something depends on it.
 *
 * The pure arithmetic in `sdf.ts` is a closer call, since it has no three.js in
 * it at all and is exhaustively tested. It stays internal too, because a public
 * `Arith<T>` would be a promise to keep nine primitives stable for callers who
 * are not writing this package's shaders, and nobody has asked.
 *
 * Shapes are therefore M4.2's contribution to what is on screen; real layout
 * arrives in M4.4, both behind the `Renderer` seam exported here.
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

export { Camera2D } from './camera.js';
export type { Camera2DInit } from './camera.js';
export {
  DagrRenderError,
  OverlayDisposedError,
  OverlayParentError,
  RendererDisposedError,
} from './errors.js';
export type { DagrRenderErrorCode } from './errors.js';
export { createHtmlOverlay } from './html-overlay.js';
export type { HtmlOverlay, HtmlOverlayOptions, OverlayEntry, OverlayEntryInit } from './html-overlay.js';
export { CENTRE_ANCHOR } from './overlay-math.js';
export type { ElementAnchor, OverlayPlacement } from './overlay-math.js';
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
