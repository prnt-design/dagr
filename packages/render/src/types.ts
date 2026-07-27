import type { Camera2D } from './camera.js';

/**
 * The public vocabulary of `@dagr/render`.
 *
 * Not one three.js type appears in this file, and that is a decision rather
 * than an accident. `three` is a peer dependency, which means the application
 * chooses the copy and the version; if a `Vector2` or a `WebGPURenderer`
 * appeared in an exported signature, then two copies of three in one tree would
 * stop being a bundle-size problem and start being a type error, and every
 * consumer of this package would need three installed just to name a viewport.
 * Keeping the surface in plain records means three stays an implementation
 * detail of `webgpu-renderer.ts`, and M4.9's WebGL fallback can change what is
 * constructed in there without touching a single caller.
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
 * Not a `{x, y, width, height}` record, deliberately. `@dagr/layout`'s `Rect`
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
 * see {@link Camera2D} for where the ratio is allowed to be used.
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

/**
 * What a Dagr renderer does, and, in M4.1, all it does.
 *
 * This is the seam every later M4 task plugs into. It deliberately says nothing
 * about scene contents: no node, no edge, no shape, no layout result. M4.1
 * draws a single hard-coded quad to prove the pipeline lights up, and giving
 * this interface a `setGraph` or a `setLayout` now would be guessing at the
 * shape of M4.4 with nothing to check the guess against. What it does fix is
 * the lifecycle, which is the part that will not change: something owns a
 * camera, something has to be told when the canvas resizes, something draws a
 * frame, and something has to give the GPU its memory back.
 *
 * The camera is `readonly` because it is the object callers mutate. Pan and
 * zoom go through {@link Camera2D}'s own methods, which validate; swapping in a
 * whole new camera would let a renderer and its input handlers disagree about
 * which camera is live, with no error either could raise.
 */
export interface Renderer {
  /**
   * The camera this renderer draws through. Mutate it to pan, to zoom, and to
   * tell it the canvas resized: the next {@link render} picks all three up,
   * because the whole of the camera is pulled per frame rather than two thirds
   * of it pulled and the rest pushed.
   */
  readonly camera: Camera2D;

  /**
   * Adopts a new canvas size. Call it from a `ResizeObserver` or a `resize`
   * listener. The camera's centre and zoom survive, so the visible world grows
   * with the window; see {@link Camera2D.setViewport}.
   *
   * Convenience rather than an obligation: this is
   * {@link Camera2D.setViewport} plus the sync {@link render} does anyway, so a
   * caller who sets the viewport on the camera directly gets the same frame.
   * The difference is only that this one takes effect immediately instead of at
   * the next frame.
   */
  resize(viewport: ViewportSize): void;

  /**
   * Draws one frame, after adopting whatever the camera says now. Nothing in
   * M4.1 drives a loop: the caller decides when.
   */
  render(): void;

  /**
   * Releases the GPU resources this renderer owns. Idempotent, so a component
   * that unmounts twice, or a hot reload that races, cannot double free.
   *
   * The renderer is not usable afterwards: {@link resize} and {@link render}
   * throw `RendererDisposedError`, which is a class rather than a bare `Error`
   * because use after dispose arrives from a lifecycle race in somebody else's
   * framework, making it the failure a caller is most likely to catch on
   * purpose.
   */
  dispose(): void;
}

/** What {@link createRenderer} needs to build a renderer. */
export interface RendererOptions {
  /**
   * The canvas to draw into. Required, and supplied rather than created,
   * because the page owns layout: only the caller knows where the canvas sits,
   * how CSS sizes it, and when it goes away.
   */
  readonly canvas: HTMLCanvasElement;

  /**
   * The camera to draw through. Optional: omit it and the renderer builds a
   * default one, which is what a caller that only wants to look at something
   * wants. Pass one when the camera has to outlive the renderer, or when input
   * handling was wired up before the async `createRenderer` resolved.
   *
   * **Either way, the canvas wins when it has an opinion.** A camera passed in
   * here has its viewport overwritten from the canvas's CSS box, because a
   * canvas that has been laid out knows its own size better than a camera built
   * before it had one. The exception is a canvas that is not in a document yet,
   * which measures zero: zero is not an opinion, so a viewport set deliberately
   * on the camera survives. Everything else about the camera (centre, zoom,
   * zoom range) is left exactly as it was passed.
   */
  readonly camera?: Camera2D;

  /**
   * The background, as a 24-bit `0xRRGGBB` integer. A number rather than a CSS
   * string because it is handed straight to three's `Color`, and because a
   * string invites `'transparent'`, which this cannot honour: alpha is a
   * context-creation flag, not a clear colour, so M4.9 owns it.
   *
   * Rejected with a `RangeError` if it is not an integer in `[0, 0xffffff]`.
   * three itself validates none of that, and every way of getting it wrong is
   * silent: `NaN` and `Infinity` both come out black, which is exactly the
   * "broken renderer" frame the default colours exist to rule out.
   */
  readonly clearColor?: number;

  /**
   * Abandons the renderer being built. Rejects with the signal's reason, having
   * disposed whatever had already been constructed.
   *
   * Here because every consumer mounting a renderer in an effect otherwise
   * hand-rolls the same block: a `cancelled` flag, a `if (cancelled)
   * created.dispose()` branch after the await, and a comment explaining why.
   * The one that forgets it leaks a GPU device per abandoned mount, and leaks
   * have no symptom until several have accumulated. The guarantee that makes
   * this worth an option rather than documentation: **a caller never has to
   * dispose a renderer it did not receive.**
   */
  readonly signal?: AbortSignal;
}
