/**
 * The geometry vocabulary: plain records for points, sizes and regions.
 *
 * **This file imports nothing, and that is its whole reason to exist.** These
 * five types used to live in `types.ts`, beside the renderer's own types.
 * `types.ts` names the scene types, and their declarations import
 * `three/webgpu`. A type import is erased at runtime but not from a `.d.ts`,
 * so anything whose declarations reached `types.d.ts` reached three's types
 * too, and a consumer type-checking `@prnt/dagr-render/core` with no
 * `@types/three` installed got a missing-module error from inside this
 * package.
 *
 * `types.ts` re-exports all five, so every existing import keeps working and
 * no public name moved. The modules behind the core entry import them from
 * here directly. Adding an import to this file undoes the fix, and the
 * packaging gate's core typecheck is what will say so.
 */

/** A point or a vector in two dimensions. Whose space it is, the field says. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A width and a height. Whose unit it is, the field or the return type says. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * An axis-aligned region of WORLD space, as explicit extents: everything from
 * `minX` to `maxX` across, and from `minY` to `maxY` up.
 *
 * Not a `{x, y, width, height}` record, deliberately. `@prnt/dagr-layout`'s `Rect`
 * is that shape with the opposite corner convention (its y grows downward, so
 * its `x, y` is the TOP-left corner, where world y up would make it the
 * bottom-left one). Two structurally identical four-number records distinguished
 * only by a sentence in a docstring are freely interchangeable to the compiler,
 * so a layout rectangle could flow into a world slot with nothing red anywhere,
 * and the symptom was a scene mirrored about the horizontal axis. A phantom
 * brand does not close that: an optional marker property still leaves the two
 * mutually assignable, and only a required one raises an error, which then has
 * to be constructed by hand at every call site.
 *
 * Extents are not structurally assignable from either shape, so the mistake is
 * a type error rather than a naming convention, and "which corner is x, y"
 * stops being a question instead of being answered. It is also the shape a
 * culling test wants: an overlap check is four comparisons on these fields and
 * four additions plus four comparisons on the other shape.
 */
export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * How big the canvas is, in CSS pixels, plus the ratio between a CSS pixel and
 * a device pixel.
 *
 * Both units are in one record on purpose. They always travel together (a
 * resize handler reads `clientWidth` and `devicePixelRatio` in the same breath)
 * and keeping them apart is how a renderer ends up sizing a drawing buffer from
 * last frame's ratio. Everything downstream of this record is in CSS pixels:
 * see `Camera2D` for where the ratio is allowed to be used.
 */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/**
 * The extents an orthographic projection needs, in world units.
 *
 * These are CENTRE-RELATIVE: `left` is negative and `right` positive for any
 * camera, and where the camera actually is comes from its centre, carried
 * separately. That is the three.js idiom (an `OrthographicCamera` holds a
 * frustum and a `position`, and moving the camera does not touch the frustum),
 * and it means a pan re-uses the frustum object unchanged where an absolute
 * frustum would have to be rebuilt on every mouse move.
 */
export interface OrthoFrustum {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}
