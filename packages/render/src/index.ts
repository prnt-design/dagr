/**
 * `@dagr/render`: a WebGPU renderer for Dagr, built on three.js.
 *
 * M4.1 was first light: a camera, a way to get a renderer onto a canvas, and one
 * flat quad to prove the pipeline worked end to end. **M4.2 has landed, and
 * added nothing to the list below.** `createRenderer` now draws a rounded
 * rectangle and a circle as signed distance fields, with fill, outline and glow
 * all read from the same distance and antialiased from its screen-space
 * derivative, but every one of those pieces is internal. Real layout arrives in
 * M4.4, behind the same `Renderer` seam.
 *
 * ## Why the shape nodes are NOT exported
 *
 * `sdf-tsl.ts` returns three.js node objects. `types.ts` records the rule they
 * would break: three is a peer dependency, so the application chooses the copy
 * and the version, and a three type on this package's surface turns two copies
 * of three in one dependency tree from a bundle-size problem into a TYPE ERROR.
 * It would also make three mandatory for anyone who merely wanted to name a
 * shape, when today they need it only to draw one.
 *
 * There is a second reason, and it would stand even without the first. M4.3 owns
 * the per-instance attribute and therefore the material assembly decision (one
 * material with a shape id, or one material per family), and it is the first
 * real caller of any of this. Publishing a shader-node API now would be fixing a
 * public surface at the point of MINIMUM information about what its only
 * consumer wants, and a public surface is the one kind of decision that cannot
 * be quietly revised later.
 *
 * `packages/render/src/shapes.ts` is the internal caller in the meantime, and
 * `test/sdf-tsl.test.ts` is what holds the nodes to account.
 *
 * Not one three.js type appears in anything exported from this file. See
 * `types.ts` for why: three stays an implementation detail of
 * `webgpu-renderer.ts`, `shapes.ts` and `sdf-tsl.ts`.
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
