/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * M4.1 is first light. The surface is a camera and a way to get a renderer onto
 * a canvas, and nothing yet about what is drawn: `createRenderer` puts one quad
 * on screen to prove the pipeline works end to end. Shapes arrive in M4.2 and
 * real layout in M4.4, both behind the `Renderer` seam exported here.
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
