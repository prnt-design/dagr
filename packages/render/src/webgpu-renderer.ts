import { Color, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { Camera2D } from './camera.js';
import { RendererDisposedError } from './errors.js';
import type { NodeStyle } from './instance-attributes.js';
import { SceneNodes } from './scene-nodes.js';
import type { SceneNode } from './scene-nodes.js';
import type { GpuResource, Renderer, RendererOptions, Size, ViewportSize } from './types.js';

/**
 * A three.js `WebGPURenderer` drawing M4.2's SDF shapes through a
 * {@link Camera2D}.
 *
 * **What needs a GPU is not tested here, and what does not, is.** Drawing needs
 * an adapter: `WebGPURenderer.init()` requests one, `setSize` writes to a real
 * canvas, and `render` submits a command buffer. Node has none, and a headless
 * browser runner is CI infrastructure this milestone does not have. So the
 * arithmetic lives in `camera.ts` and `sdf.ts` and is tested exhaustively there,
 * and the wiring is kept as declarative as it can be.
 *
 * The lifecycle is the exception, and calling it "wiring" was a mistake worth
 * naming: when the drawing buffer is reallocated, whether `dispose` is
 * idempotent, and whether a disposed renderer refuses to draw are decisions
 * made in plain JavaScript about when to call four methods on three
 * collaborators. `test/webgpu-renderer.test.ts` builds this class over stubs
 * that implement {@link FrameSink}, {@link ProjectionTarget} and
 * {@link GpuResource} and counts those calls, with no device anywhere.
 *
 * What is therefore still UNVERIFIED, stated plainly rather than left to be
 * discovered. M4.2 amended this list rather than replacing it, because every
 * entry M4.1 wrote is still true and the SDF path added to it:
 *
 * - That any shape appears at all, in the right place, at the right size, or in
 *   the intended colour. The camera suite proves the frustum agrees with
 *   `worldToScreen` and reaches a real `OrthographicCamera` intact; it cannot
 *   prove a mesh is drawn, or that the winding faces the camera.
 * - **That the shader computes anything.** This is the big one M4.2 added. A TSL
 *   graph builds in Node and does not evaluate: there is no builder and no
 *   backend, so `getNodeType` and code generation are both out of reach. The
 *   arithmetic is therefore tested as arithmetic, over plain numbers, by writing
 *   each formula once against `Arith<T>` in `sdf.ts` and running it through
 *   `numberArith` (see `test/sdf.test.ts`). What that leaves unverified is the nine
 *   one-line adapters in `sdf-nodes.ts` and THREE pieces of TSL beside them (the
 *   `length` in `antialiasWidth`, the colour `mix` in `shapeShading`, and the
 *   `mul(size, 0.5)` inside `roundedRectSDF`'s deferred `Fn` body, which no test
 *   builds), plus the assumption that WGSL agrees with `Math` about all of it. The
 *   first two have structural assertions standing in for execution; the third has
 *   nothing but the screenshot. See the module docstring in `sdf-nodes.ts`, which
 *   carries the list. `test/sdf-nodes.test.ts` proves those graphs are
 *   CONSTRUCTIBLE and nothing more.
 * - That antialiasing is actually crisp on a display. `test/sdf.test.ts` proves
 *   the coverage at k pixels from a boundary is identical at zoom 0.1 and zoom
 *   100, which is the claim; whether a real fragment shader's derivatives agree
 *   with that arithmetic is a screenshot's job.
 * - That the drawing buffer sizes computed here reach a real canvas, or that
 *   the canvas is not stretched by CSS afterwards.
 * - That `dispose` actually frees GPU memory, only that every resource in the
 *   list is disposed exactly once.
 * - That `init()` succeeds, or that the WebGL2 fallback below engages, and
 *   therefore that {@link createRenderer} itself gets past `await
 *   renderer.init()` at all. This bullet used to swallow the whole assembly with
 *   it, and no longer does: everything after that line is
 *   {@link buildSceneRenderer}, which takes the sink as a {@link FrameSink} and is
 *   therefore built over a stub in the test, scene, meshes, resources, frustum and
 *   all. What is left is the two lines that need a device to exist. One has a
 *   named casualty: the abort check AFTER `init()`, which is the branch that gives
 *   a device back when a caller aborts mid-request, cannot be reached without a
 *   device to give back. Deleting it leaves the suite green, which was measured
 *   rather than assumed. The check before `init()` is tested.
 *
 * A screenshot test in a browser runner is what closes this. The orchestrator
 * takes one per milestone with a real browser; M4.9 owns making it a CI gate,
 * along with the fallback story.
 */

/**
 * A three.js object this class only ever holds and hands back, reading no
 * property of one: the `Scene`, and the camera once it reaches
 * {@link FrameSink.render}. Saying so in the type is what lets the lifecycle be
 * exercised without three, and it is also an accurate statement of how much
 * this file knows about a scene, which is nothing.
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

/**
 * A GPU resource this renderer owns and has to give back: a geometry or a
 * material. Defined in `types.ts` and re-exported here, so that this module's own
 * test keeps importing it from the module under test while `shape-scene.ts` names
 * it without importing the renderer. See {@link GpuResource} for why the direction
 * matters.
 */
export type { GpuResource };

/**
 * The background the scene is drawn on, as `0xRRGGBB`.
 *
 * Near-black, and the shape palette that goes with it lives in `shape-scene.ts`
 * with the reasoning for each colour. The pair is chosen to be obviously
 * deliberate: amber on near-black is nobody's default, so a frame that comes out
 * grey, white or black is a frame that did not come from this package.
 */
const DEFAULT_CLEAR_COLOR = 0x0b0d10;

/**
 * The outline, the halo strength and the outline width a scene gets when its
 * caller does not say.
 *
 * The ladder's numbers, carried over rather than re-argued, because the argument
 * is unchanged and is written down in `sdf.ts` and in the M4.2 ROADMAP entry: an
 * inset outline is always drawn over a fill rather than against the background,
 * so the contrast that has to work is outline against fill and the set's darkest
 * member is a large luminance step against every one of them; 2 DEVICE pixels is
 * the smallest width whose edge reads as a deliberate line at dpr 1; and a halo
 * over 0.45 alpha stops reading as a halo and starts reading as a second,
 * blurrier shape behind the first.
 *
 * A default rather than a required option, because a caller who has nodes to
 * draw should be able to draw them, and because these three are the parts of a
 * shape's look that are least likely to be what a first-time caller cares about.
 */
const DEFAULT_NODE_STYLE: NodeStyle = {
  outlineColor: 0x023047,
  glowAlpha: 0.45,
  outlinePixels: 2,
};

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
 * The one {@link Renderer} implementation this package ships.
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
  readonly #scene: OpaqueThreeObject;
  readonly #threeCamera: ProjectionTarget;
  readonly #resources: readonly GpuResource[];
  readonly #nodes: SceneNodes;
  #disposed = false;

  /**
   * The drawing buffer the sink was last told to allocate, in device pixels.
   * Starts at a size {@link Camera2D.drawingBufferSize} cannot return, since
   * that method floors at 1 on both axes, so the first sync always happens.
   */
  #lastBuffer: Size = { width: 0, height: 0 };

  /**
   * The last two parameters used to be a geometry and a material, which was a
   * signature that only fitted a scene of exactly one mesh. A LIST of resources
   * fits any scene, and the copy is taken here so that a caller mutating the
   * array afterwards cannot change what gets freed: a resource added to the array
   * after construction would never be disposed, and one removed would be freed
   * twice if the caller also disposed it themselves.
   */
  constructor(
    camera: Camera2D,
    renderer: FrameSink,
    scene: OpaqueThreeObject,
    threeCamera: ProjectionTarget,
    nodes: SceneNodes,
    resources: readonly GpuResource[],
  ) {
    this.camera = camera;
    this.#renderer = renderer;
    this.#scene = scene;
    this.#threeCamera = threeCamera;
    this.#nodes = nodes;
    this.#resources = [...resources];
  }

  /** See {@link Renderer.setNodes}. */
  setNodes(nodes: readonly SceneNode[]): void {
    this.#assertLive('setNodes');
    this.#nodes.setNodes(nodes);
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
   *
   * Every resource in the list, then the renderer, in that order: three's
   * `WebGPURenderer.dispose` tears down the device, and freeing a buffer through a
   * device that has already gone is at best a no-op and at worst a driver
   * complaint. The list is a scene's worth of resources rather than the one pair
   * M4.1 had, and what is in it changed at M4.3: one `InstancedShapes` per shape
   * family, each of which frees its current geometry and its material, rather
   * than two entries per shape. A loop is still the difference between one leak
   * per mount and none.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#resources) {
      resource.dispose();
    }
    this.#renderer.dispose();
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
 * Everything between a live device and a usable renderer: the scene, the meshes,
 * the projection camera, and the first viewport sync. **Gives the device back if
 * any of it throws.**
 *
 * A function rather than four more lines in {@link createRenderer}, for two
 * reasons that are really one. The first is the `catch`: this is the window where
 * `createRenderer`'s promise (a caller never has to dispose a renderer it did not
 * receive) can be broken, because `createShapeMeshes` VALIDATES, so a bad
 * descriptor raises a `RangeError` at a point where the only reference to an
 * initialised `WebGPURenderer` is a local variable in an unwinding frame. Nothing
 * in the shipped ladder can trigger it, and it was still a leak waiting for M4.4:
 * the descriptor list is a parameter precisely so a layout result can be passed
 * in, and a layout result is somebody else's arithmetic. One `try` around the
 * whole window, rather than one per fallible call, so a fallible line added later
 * is covered by construction.
 *
 * The second is that pulling it out of the `async` function makes it TESTABLE.
 * `createRenderer` cannot reach past `await renderer.init()` in Node, which is why
 * the module docstring lists everything after that line as unverified; this
 * function takes the sink as a {@link FrameSink}, so `test/webgpu-renderer.test.ts`
 * builds the whole scene over a counting stub, with no device, and asserts both
 * that the failure path disposes exactly once and that the success path wires up
 * one resource per shape family and a filled-in frustum. `Scene`, `Color` and
 * `OrthographicCamera` are real three objects here: none of the three needs an
 * adapter, and the meshes are already built device-free (see
 * `test/shape-scene.test.ts`).
 *
 * The scene it builds is the crispness ladder by default: a rounded rect and a
 * circle on each of three rungs a decade apart, the rects 10, 100 and 1000 world
 * units across, so one frame shows what an SDF does at both ends of the zoom range.
 * What is drawn and how it is coloured is entirely `shape-scene.ts`'s business,
 * including the palette and the padding every quad needs; this function's job is to
 * put the meshes in a scene and to remember what has to be given back.
 */
export function buildSceneRenderer(
  camera: Camera2D,
  renderer: FrameSink,
  clearColor: number,
  nodeStyle?: NodeStyle,
  nodes?: readonly SceneNode[],
): Renderer {
  try {
    const scene = new Scene();
    scene.background = new Color(clearColor);

    // ONE OBJECT, not one per family and not one per shape, and it is both the
    // meshes to add and the resource to give back: an `InstancedShapes` replaces
    // its own geometry when its buffer grows, so a geometry captured here would
    // be the stale one by the time anything disposed it.
    const sceneNodes = new SceneNodes(nodeStyle ?? DEFAULT_NODE_STYLE, nodes?.length);
    for (const mesh of sceneNodes.meshes) {
      scene.add(mesh);
    }
    if (nodes !== undefined) sceneNodes.setNodes(nodes);
    const resources: readonly GpuResource[] = [sceneNodes];

    const threeCamera = new OrthographicCamera(0, 0, 0, 0, CAMERA_NEAR, CAMERA_FAR);
    const instance = new WebGPUSceneRenderer(
      camera,
      renderer,
      scene,
      threeCamera,
      sceneNodes,
      resources,
    );

    // Adopt the camera's current viewport, which sizes the buffer and fills in
    // the frustum the `OrthographicCamera` was constructed with zeroes for. Not
    // load bearing any more, since the first `render()` would do both, but a
    // renderer handed back in a state where the frustum is four zeroes is a
    // renderer a caller can read the wrong answer out of before drawing anything.
    instance.resize(camera.viewport);
    return instance;
  } catch (error) {
    // The device, and nothing else. Whatever was built before the throw is
    // unreferenced and collectable; the device is the one thing the garbage
    // collector cannot give back, and this is the only remaining reference to it.
    // Disposed here rather than in `createRenderer`, so it cannot be disposed
    // twice: three's `WebGPURenderer.dispose` is not a documented no-op on a
    // second call.
    renderer.dispose();
    throw error;
  }
}

/**
 * Builds a renderer on a canvas and draws the first frame's worth of scene into
 * memory. Await it, then call {@link Renderer.render}.
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
    // On by default because a graph is edges and box corners, and every one of
    // them is a diagonal that reads as a staircase without it. Not exposed in
    // `RendererOptions` yet: it is a device capability question rather than a
    // scene one, and it belongs with the rest of the backend choices in M4.9.
    //
    // M4.1 asked for this to be revisited rather than carried forward, and M4.2
    // has now landed the SDF path without changing it, deliberately. The argument
    // for turning it off is unchanged and still expected to win: SDF shapes
    // antialias their own edges analytically, per pixel (`sdf.ts` proves the
    // coverage ramp is identical at zoom 0.1 and zoom 100), and gain nothing from
    // MSAA, while MSAA costs a 4x-sampled target plus a resolve every frame, which
    // on a 4K canvas at ratio 2 is a real bandwidth line against the
    // 10k-nodes-at-60fps budget. What is missing is the MEASUREMENT, and it needs
    // a device: both the visual comparison (does anything look worse with it off)
    // and the bandwidth cost belong to a browser run. M4.10 owns the bandwidth
    // number; the orchestrator's screenshot covers the visual half. Flipping the
    // flag on reasoning alone would be trading a known-good frame for an
    // unmeasured saving.
    antialias: true,
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

  // An EMPTY scene, and the device handed back if building it throws.
  // Everything from here to the returned renderer lives in one function with one
  // `catch` for that reason: see {@link buildSceneRenderer}. What is drawn now
  // comes from `setNodes`, which is M4.4's whole point: the package stopped
  // shipping a hard-coded scene the day it could take a real one.
  return buildSceneRenderer(camera, renderer, clearColor, options.nodeStyle, options.nodes);
}
