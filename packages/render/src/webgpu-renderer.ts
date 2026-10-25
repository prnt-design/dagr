import { Color, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { Camera2D } from './camera.js';
import { RendererDisposedError } from './errors.js';
import { createShapeMesh } from './shape-material.js';
import { normalizeShape } from './shape.js';
import type { NormalizedShape, ShapeInstance } from './shape.js';
import type { Renderer, RendererOptions, Size, ViewportSize } from './types.js';

/**
 * A three.js `WebGPURenderer` drawing a batch of SDF shapes through a
 * {@link Camera2D}.
 *
 * **What needs a GPU is not tested here, and what does not, is.** Drawing needs
 * an adapter: `WebGPURenderer.init()` requests one, `setSize` writes to a real
 * canvas, and `render` submits a command buffer. Node has none, and a headless
 * browser runner is CI infrastructure M4.1 does not have. So the arithmetic
 * lives in `camera.ts` and is tested exhaustively there, and the wiring is kept
 * as declarative as it can be.
 *
 * The lifecycle is the exception, and calling it "wiring" was a mistake worth
 * naming: when the drawing buffer is reallocated, whether `dispose` is
 * idempotent, whether a disposed renderer refuses to draw, and what
 * {@link WebGPUSceneRenderer.setShapes} does to the scene and to the batch it
 * replaces are decisions made in plain JavaScript about when to call methods on
 * a handful of collaborators. `test/webgpu-renderer.test.ts` builds this class
 * over stubs that implement {@link FrameSink}, {@link ProjectionTarget},
 * {@link SceneGraph}, {@link GpuResource} and {@link ShapeMeshFactory} and
 * counts those calls, with no device anywhere.
 *
 * What is therefore still UNVERIFIED, stated plainly rather than left to be
 * discovered:
 *
 * - That a shape appears at all, in the right place, at the right size, or in
 *   the intended colour, and that the distance field, the antialiasing and the
 *   glow look like anything. The camera suite proves the frustum agrees with
 *   `worldToScreen` and reaches a real `OrthographicCamera` intact, and
 *   `test/sdf.test.ts` proves the arithmetic the shader transcribes; neither
 *   can prove a mesh is drawn, or that the winding faces the camera.
 * - That the drawing buffer sizes computed here reach a real canvas, or that
 *   the canvas is not stretched by CSS afterwards.
 * - That `dispose` actually frees GPU memory, only that it is called once.
 * - That `init()` succeeds, or that the WebGL2 fallback below engages, and
 *   therefore that any of {@link createRenderer} past `init()` runs at all.
 *   That last one has a named casualty: the abort check AFTER `init()`, which
 *   is the branch that gives a device back when a caller aborts mid-request,
 *   cannot be reached without a device to give back. Deleting it leaves the
 *   suite green, which was measured rather than assumed. The check before
 *   `init()` is tested.
 *
 * A screenshot test in a browser runner is what closes this, and M4.9 owns it
 * along with the fallback story.
 */

/**
 * A three.js object this class only ever holds and hands back, reading no
 * property of one: the camera once it reaches {@link FrameSink.render}, and
 * each shape's mesh on its way into and out of the scene. Saying so in the type
 * is what lets the lifecycle be exercised without three, and it is also an
 * accurate statement of how much this file knows about a mesh, which is
 * nothing beyond its identity.
 */
type OpaqueThreeObject = object;

/**
 * What this renderer needs from a three.js renderer: four methods.
 *
 * Declared structurally rather than as `WebGPURenderer` so that the class can
 * be built over a counting stub in a test. That is not a weakening of the
 * types: {@link createRenderer} passes a real `WebGPURenderer` into this
 * parameter, so the package's own typecheck is the proof that the real object
 * satisfies this interface, and the day three changes one of these signatures
 * is the day `createRenderer` stops compiling.
 */
export interface FrameSink {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: OpaqueThreeObject, camera: OpaqueThreeObject): void;
  dispose(): void;
}

/** What this renderer writes onto a three.js `OrthographicCamera`. */
export interface ProjectionTarget {
  left: number;
  right: number;
  bottom: number;
  top: number;
  readonly position: { set(x: number, y: number, z: number): void };
  updateProjectionMatrix(): void;
}

/** A GPU resource this renderer owns and has to give back: a geometry or a material. */
export interface GpuResource {
  dispose(): void;
}

/**
 * What this renderer does to a three.js `Scene`: put a mesh in, take a mesh
 * out. Declared structurally for the same reason {@link FrameSink} is, and it
 * is again an accurate statement of the contact: nothing here reads a scene.
 */
export interface SceneGraph {
  add(object: OpaqueThreeObject): void;
  remove(object: OpaqueThreeObject): void;
}

/**
 * One shape's three.js objects, as this file needs them: something to put in
 * the scene, and the two resources to give back when it leaves.
 *
 * `shape-material.ts` returns a `Mesh`, a `PlaneGeometry` and a
 * `MeshBasicNodeMaterial`, which satisfy this without knowing it exists. Naming
 * them structurally is what lets `setShapes` be tested by counting, and the
 * typecheck of {@link createRenderer} passing the real {@link createShapeMesh}
 * into {@link ShapeMeshFactory} is the proof the two agree.
 */
export interface DrawnShape {
  readonly object: OpaqueThreeObject;
  readonly geometry: GpuResource;
  readonly material: GpuResource;
}

/**
 * How a validated shape becomes something drawable. One function, so the whole
 * of what this renderer knows about materials is that it can ask for one.
 */
export type ShapeMeshFactory = (shape: NormalizedShape) => DrawnShape;

/**
 * The background behind everything. Chosen to be obviously deliberate:
 * near-black rather than black, so a frame that comes out grey, white or a flat
 * black is a frame that did not come from this file.
 *
 * The amber `FIRST_LIGHT_COLOR` that used to sit beside it is gone with M4.1's
 * hard-coded quad: the renderer now starts empty and every colour on screen
 * comes from a `ShapeStyle` the caller chose.
 */
const DEFAULT_CLEAR_COLOR = 0x0b0d10;

/**
 * Where the camera sits on the z axis, and the depth range it sees.
 *
 * An orthographic projection does not scale with distance, so the only job
 * these numbers have is to put the z = 0 plane every 2D shape lives on
 * comfortably inside the frustum, with room either side for the layering M4.5
 * will want (edges behind nodes, selection in front).
 *
 * Exported so `test/camera.test.ts` can build a real `OrthographicCamera` from
 * the numbers this file actually uses rather than from copies of them, which
 * makes "z = 0 is inside the near and far planes" a claim about this renderer
 * instead of a claim about three arithmetic in general.
 */
export const CAMERA_Z = 100;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1000;

/**
 * The viewport a laid-out canvas implies.
 *
 * `clientWidth` is the CSS box, which is what the camera wants. Only called
 * once both client dimensions are known to be positive, so there is no fallback
 * left in here: {@link adoptCanvasViewport} owns the question of whether the
 * canvas has been measured at all, and this owns what the measurement says.
 */
function viewportFromCanvas(canvas: HTMLCanvasElement): ViewportSize {
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    devicePixelRatio: globalThis.devicePixelRatio || 1,
  };
}

/**
 * Points a camera at the canvas it is about to draw into: **the canvas wins
 * when it has an opinion.**
 *
 * One rule, applied whether or not the caller brought their own camera, and
 * that is the fix rather than an implementation detail. The canvas used to be
 * measured only on the branch that BUILT the camera, so a caller following this
 * package's own advice (bring a camera, so input handling can be wired before
 * the async factory resolves) kept the HTML default 300 by 150 viewport, and an
 * 800 by 600 canvas got a 300 by 150 drawing buffer stretched across it, with
 * `worldToScreen` describing a canvas nobody was looking at.
 *
 * Skipped when the canvas has no layout, because `clientWidth` is zero for a
 * canvas that is not in a document yet, and zero is not an opinion: there is
 * nothing to learn from it, and a viewport the caller set deliberately is the
 * better answer. Both axes have to be positive, since half a measurement is not
 * a viewport and {@link Camera2D} would reject it anyway.
 */
export function adoptCanvasViewport(camera: Camera2D, canvas: HTMLCanvasElement): void {
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    camera.setViewport(viewportFromCanvas(canvas));
  }
}

/**
 * Rejects a clear colour that is not a 24-bit `0xRRGGBB` integer.
 *
 * The only public input this package did not validate, and the one where the
 * silent answer is worst. three's `Color.setHex` validates nothing: measured
 * against 0.185.1, `NaN` and `Infinity` both come out #000000, `-1` and
 * `0x1ffffff` both saturate to #ffffff, and `1.7` floors to #000001. A black
 * frame is precisely the "broken renderer" look that the amber-on-near-black
 * default was chosen to rule out, so an arithmetic slip that produced a `NaN`
 * produced the exact frame the colour scheme exists to make impossible.
 *
 * A `RangeError` naming the field, which is `camera.ts`'s rule for a bad
 * number and now this package's rule for every bad number. See `errors.ts`.
 */
function requireClearColor(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(
      `clearColor has to be an integer between 0x000000 and 0xffffff, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Throws the signal's reason if the caller has abandoned this renderer.
 *
 * `throwIfAborted` rather than a hand-rolled check, so the reason a caller gets
 * is the one the platform gives (their own `abort(reason)` value, or a
 * `DOMException` named `AbortError` if they gave none) rather than something
 * invented here.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/**
 * The one {@link Renderer} implementation M4.1 ships.
 *
 * Exported from this module for `test/webgpu-renderer.test.ts`, and
 * deliberately NOT from `index.ts`: {@link createRenderer} is the only thing
 * that awaits `init()`, so it is the only supported way to get one of these,
 * and a class a caller can `new` themselves is a half-initialised renderer
 * waiting to happen. The test constructs it directly precisely because it never
 * wants a device.
 */
export class WebGPUSceneRenderer implements Renderer {
  readonly camera: Camera2D;
  readonly #renderer: FrameSink;
  readonly #scene: SceneGraph;
  readonly #threeCamera: ProjectionTarget;
  readonly #meshFactory: ShapeMeshFactory;
  #disposed = false;

  /**
   * The batch on screen, in the order it was given. Every entry is owned: it
   * came out of {@link #meshFactory}, it is in the scene, and it is released by
   * {@link setShapes} or {@link dispose}, whichever comes first.
   */
  readonly #shapes: DrawnShape[] = [];

  /**
   * The drawing buffer the sink was last told to allocate, in device pixels.
   * Starts at a size {@link Camera2D.drawingBufferSize} cannot return, since
   * that method floors at 1 on both axes, so the first sync always happens.
   */
  #lastBuffer: Size = { width: 0, height: 0 };

  constructor(
    camera: Camera2D,
    renderer: FrameSink,
    scene: SceneGraph,
    threeCamera: ProjectionTarget,
    meshFactory: ShapeMeshFactory,
  ) {
    this.camera = camera;
    this.#renderer = renderer;
    this.#scene = scene;
    this.#threeCamera = threeCamera;
    this.#meshFactory = meshFactory;
  }

  /**
   * See {@link Renderer.resize}. Sugar for {@link Camera2D.setViewport} plus
   * the sync path {@link render} runs anyway, kept because it is the name a
   * resize handler looks for and because it leaves the renderer consistent
   * immediately rather than at the next frame.
   */
  resize(viewport: ViewportSize): void {
    this.#assertLive('resize');
    this.camera.setViewport(viewport);
    this.#syncSize();
    this.#syncCamera();
  }

  /**
   * See {@link Renderer.setShapes}. Replaces the whole batch: validate
   * everything, release everything, build everything.
   *
   * **The three phases are in that order and the order is the contract.**
   * `normalizeShape` runs over the entire batch before a single mesh is
   * released, so a `RangeError` from shape seventeen leaves the previous batch
   * whole and on screen rather than leaving sixteen new shapes and whatever
   * survived of the old ones. That costs one array of normalized records per
   * call, which is the price of a batch that either applies or does not.
   *
   * Nothing here is incremental: a shape unchanged since the last call still
   * gets a new geometry and a new material. That is the naive implementation on
   * purpose, and M4.3's instancing is what replaces it, behind this signature.
   */
  setShapes(shapes: readonly ShapeInstance[]): void {
    this.#assertLive('setShapes');
    const normalized = shapes.map((shape) => normalizeShape(shape));
    this.#releaseShapes();
    for (const shape of normalized) {
      const drawn = this.#meshFactory(shape);
      this.#scene.add(drawn.object);
      this.#shapes.push(drawn);
    }
  }

  /** See {@link Renderer.render}. */
  render(): void {
    this.#assertLive('render');
    this.#syncSize();
    this.#syncCamera();
    this.#renderer.render(this.#scene, this.#threeCamera);
  }

  /**
   * See {@link Renderer.dispose}. Idempotent through the `#disposed` flag: a
   * second call returns without touching three, because `dispose()` on an
   * already-disposed three renderer is not a documented no-op and a component
   * that unmounts twice is an ordinary thing rather than a bug worth crashing
   * for.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#releaseShapes();
    this.#renderer.dispose();
  }

  /**
   * Takes the current batch out of the scene and gives its GPU memory back.
   *
   * Shared by {@link setShapes} and {@link dispose} because they want exactly
   * the same thing, and because a second copy of this loop is how one of them
   * ends up disposing a geometry it left in the scene. Emptying the list is
   * part of the job: a disposed entry left in it would be disposed again by
   * whichever of the two ran next.
   */
  #releaseShapes(): void {
    for (const drawn of this.#shapes) {
      this.#scene.remove(drawn.object);
      drawn.geometry.dispose();
      drawn.material.dispose();
    }
    this.#shapes.length = 0;
  }

  /**
   * Fails loudly on use after {@link dispose}, rather than rendering into a
   * released device and getting whatever the driver feels like. `dispose` is
   * the one method that tolerates being called twice, because it is the one
   * with a well defined answer for the second call.
   */
  #assertLive(method: string): void {
    if (this.#disposed) {
      throw new RendererDisposedError(method);
    }
  }

  /**
   * Sizes the drawing buffer from {@link Camera2D.drawingBufferSize}, if it is
   * not already that size.
   *
   * Called from {@link render} as well as {@link resize}, and the guard is why
   * it can be. The camera is a plain mutable object a caller is invited to
   * mutate, and `setViewport` is the documented way to tell it the canvas
   * resized, so half the camera state cannot be pushed by one method while the
   * other half is pulled by another: a `ResizeObserver` that called
   * `camera.setViewport` and then `render` used to get a correct frustum in a
   * buffer sized for the previous canvas, which the browser stretches. Pulling
   * both halves per frame makes `resize` an optimisation and a convenience
   * rather than a correctness requirement.
   *
   * The guard is not a micro-optimisation. `setSize` writes `canvas.width`,
   * which reallocates the drawing buffer and drops whatever was in it, so an
   * unconditional call at 60fps is a real cost paid for nothing.
   *
   * The pixel ratio is pinned at 1 and the buffer size is passed in DEVICE
   * pixels, rather than the usual `setSize(cssW, cssH, false)` plus
   * `setPixelRatio(dpr)`. Both spellings produce the same buffer for integer
   * ratios, and only this one keeps the camera's claim true: the device pixel
   * ratio is read in exactly one place in this package, and it is
   * `drawingBufferSize`. Handing three the ratio would put a second consumer of
   * it here, rounding by its own rule (three truncates where the camera rounds
   * to nearest), so a 1.5x display could get a buffer one pixel off from what
   * every other calculation in the package assumed.
   *
   * `updateStyle: false` because the canvas's CSS size belongs to the page. A
   * renderer that wrote `style.width` would fight whatever layout put the
   * canvas there, and the caller already told us the CSS size in the viewport.
   */
  #syncSize(): void {
    const buffer = this.camera.drawingBufferSize();
    if (buffer.width === this.#lastBuffer.width && buffer.height === this.#lastBuffer.height) {
      return;
    }
    this.#lastBuffer = buffer;
    this.#renderer.setPixelRatio(1);
    this.#renderer.setSize(buffer.width, buffer.height, false);
  }

  /**
   * Copies the {@link Camera2D} state onto the three camera.
   *
   * The frustum is centre-relative (see `OrthoFrustum`), so the position and
   * the extents are two separate pieces of the same answer and both have to be
   * written before `updateProjectionMatrix`. Called from `render` rather than
   * from a pan handler, because `Camera2D` is a plain mutable object with no
   * change notification: pulling the state once per frame is the only way to be
   * sure a mutation between frames is not missed. {@link #syncSize} pulls the
   * rest of that state on the same terms, which it did not always do, and the
   * two thirds of the camera this method reads were never the whole of it.
   *
   * Unguarded, unlike the size sync, because this writes six numbers and calls
   * one method that rebuilds a 4x4 matrix. There is no allocation to avoid and
   * a comparison would cost about as much as the work.
   */
  #syncCamera(): void {
    const { left, right, bottom, top } = this.camera.orthoFrustum();
    const { x, y } = this.camera.center;
    this.#threeCamera.left = left;
    this.#threeCamera.right = right;
    this.#threeCamera.bottom = bottom;
    this.#threeCamera.top = top;
    this.#threeCamera.position.set(x, y, CAMERA_Z);
    this.#threeCamera.updateProjectionMatrix();
  }
}

/**
 * Builds a renderer on a canvas, with an empty scene. Await it, tell it what to
 * draw with {@link Renderer.setShapes}, then call {@link Renderer.render}.
 *
 * A renderer with no shapes draws the clear colour and nothing else, which is a
 * legal frame rather than a broken one: it is what an application shows before
 * its first layout arrives.
 *
 * **Asynchronous because `WebGPURenderer.init()` is.** Getting a WebGPU device
 * means requesting an adapter from the browser, which is a promise, so there is
 * no synchronous moment at which a WebGPU renderer is usable. Awaiting it here
 * rather than inside every method means the object handed back is ready, and no
 * caller has to think about a renderer that exists but cannot draw.
 *
 * three's `WebGPURenderer` falls back to WebGL2 by itself when WebGPU is
 * unavailable, so this function resolving is not a promise that WebGPU is in
 * use. `forceWebGL` is the flag that takes the decision away from three. M4.1
 * neither sets it nor reports which backend won; M4.9 owns the fallback story,
 * including telling the caller which one they got.
 *
 * **A caller never has to dispose a renderer it did not receive.** Pass a
 * `signal` and every early exit below cleans up whatever had been built before
 * rejecting with the abort reason, so an effect that unmounts mid-`init()`
 * needs no flag, no `created.dispose()` branch and no comment explaining them.
 */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
  const { canvas, signal } = options;
  const clearColor = requireClearColor(options.clearColor ?? DEFAULT_CLEAR_COLOR);

  // Before the device is requested, not only after. An adapter this function
  // has already been told to throw away is worth not asking for: it is the
  // expensive part of everything below, and on an abandoned mount it is pure
  // waste. Validation comes first so that a bad `clearColor` is a `RangeError`
  // whatever the signal says, since it is a bug either way.
  throwIfAborted(signal);

  const camera = options.camera ?? new Camera2D();
  adoptCanvasViewport(camera, canvas);

  const renderer = new WebGPURenderer({
    canvas,
    // OFF, and M4.1 asked M4.2 to make exactly this call rather than carry the
    // flag forward because it was already there. Still not exposed in
    // `RendererOptions`: it is a device capability question rather than a scene
    // one, and it belongs with the rest of the backend choices in M4.9.
    //
    // MSAA antialiases GEOMETRY SILHOUETTES, and this renderer no longer has
    // any. Every shape is painted into a quad that is strictly larger than the
    // shape (see `shapeQuadSize`, which pads for the outline, the glow and the
    // antialiasing ramp), so no shape boundary ever lies on a triangle edge.
    // A fragment shader runs once per pixel and its result is written to every
    // covered sample, so wherever a quad covers a pixel completely the resolve
    // reproduces the single-sampled answer exactly, and where it does not, the
    // shader's alpha there is zero. The shape edges are antialiased by
    // `edgeCoverage` from the distance field's own screen-space derivative,
    // which is what makes them hold at 0.1x and at 100x from one shader.
    //
    // Evidence, and its limit. The quality side was checked rather than
    // reasoned alone: the M4.2 demo was captured at both zooms with this flag
    // true and false, and the crops are indistinguishable. The COST side is
    // NOT measured. MSAA buys a 4x-sampled target plus a resolve every frame,
    // which on a 4K canvas at ratio 2 is a real bandwidth line against M4.10's
    // 10k-nodes-at-60fps budget, but no number here says how much. Turning it
    // off is therefore justified by the quality measurement (nothing is lost)
    // rather than by the saving (unquantified). Revisit if this renderer ever
    // draws geometry whose silhouette is its own edge, a hairline or a mesh
    // rather than a padded quad, because the argument above is what fails
    // first.
    antialias: false,
  });
  await renderer.init();

  // The one check that can catch an abort that happened while this function was
  // suspended, which is why it is here and why there is not a third before the
  // return: nothing between this line and `return instance` awaits, so no other
  // task can run and no signal can change. What it does have to do that the
  // check above does not is give the device back.
  if (signal?.aborted === true) {
    renderer.dispose();
    signal.throwIfAborted();
  }

  // Nothing is added to the scene here, and that is the change M4.2 makes to
  // this function. M4.1 put a hard-coded amber quad in it to prove the pipeline
  // lit up, which it did; a renderer that keeps drawing something nobody asked
  // for is a renderer whose caller cannot get a blank canvas and cannot tell
  // their own shapes from its. It stays empty until `setShapes` is called.
  const scene = new Scene();
  scene.background = new Color(clearColor);

  const threeCamera = new OrthographicCamera(0, 0, 0, 0, CAMERA_NEAR, CAMERA_FAR);

  const instance = new WebGPUSceneRenderer(
    camera,
    renderer,
    scene,
    threeCamera,
    createShapeMesh,
  );

  // Adopt the camera's current viewport, which sizes the buffer and fills in
  // the frustum the `OrthographicCamera` was constructed with zeroes for. Not
  // load bearing any more, since the first `render()` would do both, but a
  // renderer handed back in a state where the frustum is four zeroes is a
  // renderer a caller can read the wrong answer out of before drawing anything.
  instance.resize(camera.viewport);
  return instance;
}
