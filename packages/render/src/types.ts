import type { Camera2D } from './camera.js';
import type { SceneStyle } from './instance-attributes.js';
import type { SceneNode } from './scene-nodes.js';
import type { EdgeFrameStyle, SceneEdge, SceneEdgeGroup } from './scene-edges.js';

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
 * A GPU resource somebody owns and has to give back: a geometry, a material, or
 * anything else with a `dispose`.
 *
 * Here rather than in `webgpu-renderer.ts`, where it started, because the module
 * that BUILDS a scene is a lower layer than the module that renders one, and
 * a scene module naming a type out of `webgpu-renderer.ts` pointed the
 * dependency the wrong way round and closed a cycle, since the renderer imports
 * the scene. Nothing broke, because it was `import type` and
 * `verbatimModuleSyntax` erases those, and there are three scene-side modules
 * now that would each have copied whichever direction they found. This file is
 * the vocabulary every layer imports, so it is where a type they all name
 * belongs.
 *
 * Structural on purpose, and it keeps this file's no-three.js rule: `dispose` is
 * the whole of what a renderer does to a resource, three's `BufferGeometry` and
 * `Material` both satisfy this, and so does a counting stub in a test.
 * `webgpu-renderer.ts` re-exports it for its own test, which is a convenience and
 * not a second definition.
 */
export interface GpuResource {
  dispose(): void;
}

/**
 * What a Dagr renderer does.
 *
 * This is the seam every later M4 task plugs into, and M4.4 is the task that
 * gave it scene contents. M4.1 drew a single hard-coded quad and M4.2 a
 * hard-coded set of SDF shapes, and this interface deliberately said nothing
 * about either: naming a `setGraph` then would have been guessing at M4.4's
 * shape with nothing to check the guess against. {@link setNodes} is the answer
 * that survived contact with a real dataset, and what it is NOT is as
 * deliberate as what it is. It takes NODES and not a `LayoutResult`, so
 * `@dagr/layout` is not a dependency of this package and the y-down to y-up
 * conversion stays with the caller who owns the layout (see {@link Camera2D});
 * it takes an ARRAY and not a graph, because a renderer has no use for
 * adjacency; and every node carries its own colours and size, because those are
 * the caller's decisions about their data rather than this package's.
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
   * Replaces the scene's nodes, keeping the instances of nodes that are in both
   * this list and the last one.
   *
   * The diff is by `id` and it is the property M4.4 owed the tasks after it: a
   * node present in two consecutive calls keeps its instance handle, so
   * per-instance state keyed to it (M4.6's spring velocity, M4.8's picking id)
   * survives a call that moved every other node in the graph. A node that
   * changes SHAPE is the exception, and it is a removal and an addition, because
   * the two shape families are two meshes.
   *
   * Idempotent in the sense that matters: calling it twice with the same list
   * writes the same floats twice and changes nothing else. Not free, though, so
   * a caller with a delta in hand should apply the delta rather than rebuilding
   * the list.
   *
   * Rejects a list with two nodes sharing an id, because the second would
   * silently take the first's place and the picture would be one node short.
   */
  setNodes(nodes: readonly SceneNode[]): void;

  /**
   * Replaces one edge group's edges, which rebuilds that group's buffers.
   *
   * Groups are declared at construction, through
   * {@link RendererOptions.edgeGroups}, and drawn in the order they were
   * declared: that order is the only layering this package offers, because
   * M4.3 established that blend order WITHIN a mesh is slot order and a slot is
   * not durable across a removal. Dashed routed edges under solid overlay lines
   * is two groups.
   *
   * Whole rather than incremental, unlike {@link setNodes}. An edge has no
   * durable per-instance state to preserve across a rebuild, and its input is a
   * layout's routes: a layout that moved has moved most of them.
   *
   * Throws a `RangeError` naming a group that was never declared.
   */
  setEdges(groupId: string, edges: readonly SceneEdge[]): void;

  /**
   * Writes one edge group's per-frame values: its width in device pixels, the
   * pixels per world unit the camera implies, an alpha multiplier, and how far
   * its dash has flowed.
   *
   * Touches no buffer, which is the point of it being a separate call. The
   * screen-space width decision makes this a PER FRAME concern (see
   * `ribbonWidthAt` for the clamp and the fade a scene owes its far view), and
   * a seam that made width a property of the geometry would re-tessellate every
   * route to change a uniform.
   */
  setEdgeStyle(groupId: string, style: EdgeFrameStyle): void;

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
   * The outline, the halo strength and the outline width every node shares.
   *
   * Optional, with the ladder's numbers as the default: a caller who has nodes
   * to draw should be able to draw them. The per-node half of a shape's look
   * (its fill, its halo colour and how far the halo reaches) is on each
   * {@link SceneNode}, because those are facts about the data.
   */
  readonly sceneStyle?: SceneStyle;

  /**
   * Nodes to draw immediately, equivalent to {@link Renderer.setNodes} on the
   * renderer this returns.
   *
   * Here as well as on the interface because the two are not the same in one
   * respect that matters at campaign scale: the buffers are allocated for
   * exactly this many nodes, so the first frame costs no reallocation. A caller
   * that already has its layout when it mounts should pass it.
   */
  readonly nodes?: readonly SceneNode[];

  /**
   * The edge groups to build, in DRAW ORDER. Omit it for a scene with no edges.
   *
   * Fixed at construction for the reason the two shape families are: a mesh
   * created later would have to be added to a `Scene` the renderer owns and the
   * edge scene does not, which is a reference pointing the wrong way. An
   * unfilled group costs one material and an empty geometry.
   */
  readonly edgeGroups?: readonly SceneEdgeGroup[];

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
