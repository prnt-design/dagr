/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * M4.1 was first light: a camera, a way to get a renderer onto a canvas, and one
 * hard-coded quad to prove the pipeline works end to end.
 *
 * **M4.2 changed what is drawn and not what is callable, and that is
 * deliberate.** `createRenderer` now puts six signed-distance-field shapes on
 * screen instead of one quad, spanning 100:1 in size so that one frame shows what
 * an SDF does at both ends of the zoom range. Not one export was added for it.
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
export { RendererDisposedError } from './errors.js';
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
