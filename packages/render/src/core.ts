/**
 * `@prnt/dagr-render/core`: the arithmetic of this package that never touches a
 * GPU, as its own entry.
 *
 * The full entry re-exports `createRenderer`, and `webgpu-renderer.ts` imports
 * `three/webgpu` at module scope. A bundler drops that for a consumer who only
 * wanted the camera, because this package is side-effect free. A server that
 * externalizes its dependencies does not: it evaluates the whole entry, and
 * with it three.js, to draw an SVG.
 *
 * Everything here is ALSO exported from the full entry, and is the same object
 * there. This file adds a way in. It moves nothing.
 *
 * **The rule for adding to this file: the module you export from must not
 * import `three`, directly or through anything it imports at runtime.**
 * `import type` does not count, because it is erased. `test/core.test.ts`
 * holds the rule at source level and the packaging gate holds it on the built
 * tarball, so a mistake here is a red test rather than a production surprise.
 */

export { Camera2D, fitZoom } from './camera.js';
export type { Camera2DInit } from './camera.js';
export { shapeEdgePath } from './edge-path.js';
export type { EdgePathOptions } from './edge-path.js';
export type { OrthoFrustum, Size, Vec2, ViewportSize, WorldBounds } from './types.js';
