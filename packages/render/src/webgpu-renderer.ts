import { Color, OrthographicCamera, Scene, WebGPURenderer } from 'three/webgpu';
import {
  DEFAULT_BACKEND,
  backendOf,
  forceWebGLFor,
  requireBackendHonoured,
  requireBackendPreference,
} from './backend.js';
import { Camera2D } from './camera.js';
import { RendererDisposedError } from './errors.js';
import type { SceneStyle } from './instance-attributes.js';
import { SceneEdges } from './scene-edges.js';
import type { EdgeFrameStyle, SceneEdge, SceneEdgeGroup } from './scene-edges.js';
import { SceneNodes } from './scene-nodes.js';
import type { SceneNode } from './scene-nodes.js';
import type {
  GpuResource,
  Renderer,
  RendererBackend,
  RendererOptions,
  Size,
  ViewportSize,
} from './types.js';

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
 * **M4.9a moved four entries off the list below, on ONE backend of two.**
 * `bench/browser/backend-probe.mjs` opens this package's own `dist` in a
 * headless Chromium and draws two shapes, and on 2026-08-23 it reported a
 * WebGL2 backend, a 480 by 320 drawing buffer, and 10,780 pixels above the
 * clear colour, of which 3,908 are the rounded rect's amber fill and 2,432 the
 * circle's blue. `assets/screenshots/m4.9a-webgl2-shapes.png` is that frame.
 * **The two fill counts agree with the geometry**, which is what makes this
 * evidence about SIZE rather than only about presence: the amber region is the
 * 90 by 50 rounded rect inset by the 2 device pixel outline, 3,901 pixels of
 * area against 3,908 counted, and the blue is the 60 diameter circle inset the
 * same way, 2,463 against 2,432. So a shape appears, in the right place, at the
 * right size and in the intended colour; the shader computes; the derivatives
 * antialias; and the buffer size computed here reaches a real canvas. What is NOT covered is WebGPU, because
 * this box has no adapter (see `backend.ts`), so every claim in this paragraph
 * is scoped to the backend that drew it. That scope is the whole of why M4.9
 * is split, and M4.9b owns closing it.
 *
 * What is therefore still UNVERIFIED, stated plainly rather than left to be
 * discovered. M4.2 amended M4.1's list rather than replacing it, and M4.9a is
 * the first task to take entries OFF it:
 *
 * - Everything above, ON WEBGPU. The TSL graphs are compiled by a different
 *   backend into a different shading language there, and "it compiles on
 *   WebGL2" is not evidence about WGSL. M4.9b's parity check is exactly this
 *   entry and it needs a machine with both.
 * - That `dispose` actually frees GPU memory, only that every resource in the
 *   list is disposed exactly once.
 * - The abort check AFTER `init()`, which is the branch that gives a device back
 *   when a caller aborts mid-request: reaching it needs a device to give back
 *   AND an abort in the window between the request and the resolution, which the
 *   probe cannot arrange. Deleting it leaves the suite green, which was measured
 *   rather than assumed. The check before `init()` is tested.
 * - That a page's CSS does not stretch the canvas after the buffer is sized.
 *   The probe states its CSS box and its device pixel ratio, so what it checks
 *   is that the buffer this file computes is the buffer the canvas gets. Whether
 *   somebody else's stylesheet then scales it is theirs.
 *
 * The nine one-line TSL adapters in `sdf-nodes.ts` and the three pieces of TSL
 * beside them (the `length` in `antialiasWidth`, the colour `mix` in
 * `shapeShading`, and the `mul(size, 0.5)` inside `roundedRectSDF`'s deferred
 * `Fn` body) were the sharpest form of the shader entry, and they are now
 * covered on WebGL2 by a drawn frame rather than by structural assertions
 * standing in for execution. `sdf.ts` still tests the arithmetic as arithmetic,
 * which is what makes a WRONG picture diagnosable rather than merely visible.
 *
 * Making the probe a CI gate is not done and is not this task's: a runner's GPU
 * story is not this box's, which is the same argument M4.10's entry makes about
 * frame times and which `bench/browser/README.md` applies to everything in that
 * directory.
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
 * A GPU resource this renderer owns and has to give back: a geometry, a material,
 * or a whole family of instances. Defined in `types.ts` and re-exported here, so
 * that this module's own test keeps importing it from the module under test while
 * the scene modules name it without importing the renderer. See
 * {@link GpuResource} for why the direction matters.
 */
export type { GpuResource };

/**
 * The background the scene is drawn on, as `0xRRGGBB`.
 *
 * Near-black, and the palette that went with it lived in the crispness ladder
 * M4.4 retired: a caller's nodes carry their own colours now. The background
 * stays chosen to be obviously deliberate, which is the half this package still
 * owns: amber on near-black was nobody's default, so a frame that comes out
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
const DEFAULT_SCENE_STYLE: SceneStyle = {
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
  readonly backend: RendererBackend;
  readonly #renderer: FrameSink;
  readonly #scene: OpaqueThreeObject;
  readonly #threeCamera: ProjectionTarget;
  readonly #resources: readonly GpuResource[];
  readonly #nodes: SceneNodes;
  readonly #edges: SceneEdges;
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
    backend: RendererBackend,
    scene: OpaqueThreeObject,
    threeCamera: ProjectionTarget,
    nodes: SceneNodes,
    edges: SceneEdges,
    resources: readonly GpuResource[],
  ) {
    this.camera = camera;
    // Passed in rather than read off the sink, and that is the {@link FrameSink}
    // decision applied one field further: the sink is four methods so that this
    // class can be built over a stub, and a `backend` marker on it would be a
    // fifth member of that contract existing only to be copied here.
    this.backend = backend;
    this.#renderer = renderer;
    this.#scene = scene;
    this.#threeCamera = threeCamera;
    this.#nodes = nodes;
    this.#edges = edges;
    this.#resources = [...resources];
  }

  /** See {@link Renderer.setEdges}. */
  setEdges(groupId: string, edges: readonly SceneEdge[]): void {
    this.#assertLive('setEdges');
    this.#edges.setEdges(groupId, edges);
  }

  /** See {@link Renderer.setEdgeIntensity}. */
  setEdgeIntensity(groupId: string, intensityOf: (edgeId: string) => number): void {
    this.#assertLive('setEdgeIntensity');
    this.#edges.setEdgeIntensity(groupId, intensityOf);
  }

  /** See {@link Renderer.setEdgeStyle}. */
  setEdgeStyle(groupId: string, style: EdgeFrameStyle): void {
    this.#assertLive('setEdgeStyle');
    this.#edges.setStyle(groupId, style);
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
    // The edges' one camera-derived uniform, written here rather than asked of
    // a caller: a ribbon's width is in DEVICE pixels and the conversion needs
    // the zoom and the ratio, both of which this object already holds. Left to
    // a caller it would be a mandatory call with a default that draws at world
    // scale, which at the campaign's fitted zoom is a third of a device pixel:
    // nothing on screen and nothing raised.
    this.#edges.setPixelsPerWorldUnit(
      this.camera.zoom * this.camera.viewport.devicePixelRatio,
    );
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
 * How many nodes of each shape a list holds, for sizing the instance buffers.
 *
 * PER SHAPE, because the two families are two buffers: one count applied to both
 * reserved twice what a mixed scene needs, which is not the "exactly this many"
 * `RendererOptions.nodes` promises. `undefined` for an absent list, so the
 * buffers keep their default capacity rather than being sized for nothing.
 */
function countByShape(
  nodes: readonly SceneNode[] | undefined,
): Readonly<Partial<Record<SceneNode['shape'], number>>> | undefined {
  if (nodes === undefined) return undefined;
  const counts: Partial<Record<SceneNode['shape'], number>> = {};
  for (const node of nodes) {
    counts[node.shape] = (counts[node.shape] ?? 0) + 1;
  }
  return counts;
}

/**
 * Everything between a live device and a usable renderer: the scene, the meshes,
 * the projection camera, and the first viewport sync. **Gives the device back if
 * any of it throws.**
 *
 * A function rather than four more lines in {@link createRenderer}, for two
 * reasons that are really one. The first is the `catch`: this is the window where
 * `createRenderer`'s promise (a caller never has to dispose a renderer it did not
 * receive) can be broken, because building a scene VALIDATES, so a bad
 * node raises a `RangeError` at a point where the only reference to an
 * initialised `WebGPURenderer` is a local variable in an unwinding frame. That
 * was a leak waiting for M4.4 while the scene was hard-coded, and M4.4 is what
 * made it reachable: the nodes are a parameter precisely so a layout result can
 * be converted into them, and a layout result is somebody else's arithmetic. One `try` around the
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
 * `test/scene-nodes.test.ts`).
 *
 * The scene it builds is EMPTY by default, which is what M4.4 changed: this
 * package used to ship a hard-coded crispness ladder and now ships nothing.
 * {@link SceneNodes} builds one mesh per shape family with no instances in
 * either, `nodes` fills them if the caller already has a layout, and
 * `setNodes` is how anything arrives afterwards. What is drawn and how it is
 * coloured is entirely the caller's business, down to the two colours on each
 * node; this function's job is to put the meshes in a scene and to remember what
 * has to be given back.
 */
export function buildSceneRenderer(
  camera: Camera2D,
  renderer: FrameSink,
  backend: RendererBackend,
  clearColor: number,
  sceneStyle?: SceneStyle,
  nodes?: readonly SceneNode[],
  edgeGroups?: readonly SceneEdgeGroup[],
): Renderer {
  // BOTH held outside the `try` so the `catch` can free them, and the second is
  // why this is a comment rather than a line. Building a scene validates, so a
  // rejected node throws with GPU resources already allocated, and three's
  // geometries and materials are not collectable: they hold buffers that only
  // `dispose()` releases. The `catch` used to say everything but the device was
  // "unreferenced and collectable", which stopped being true the moment a scene
  // owned resources before the first fallible line. M4.5's edges then added a
  // SECOND owner in front of that same line, which a rebase surfaced: a fix
  // naming only the nodes would have been half a fix within a day of writing.
  let sceneNodes: SceneNodes | null = null;
  let sceneEdges: SceneEdges | null = null;
  try {
    const scene = new Scene();
    scene.background = new Color(clearColor);

    // ONE OBJECT, not one per family and not one per shape, and it is both the
    // meshes to add and the resource to give back: an `InstancedShapes` replaces
    // its own geometry when its buffer grows, so a geometry captured here would
    // be the stale one by the time anything disposed it.
    // EDGES FIRST, and the order is the whole of the layering: three draws a
    // scene's children in the order they were added for objects that share a
    // depth, and every mesh in this package is transparent with `depthWrite`
    // off, so ribbons added before nodes are drawn under them.
    sceneEdges = new SceneEdges(edgeGroups ?? []);
    for (const mesh of sceneEdges.meshes) {
      scene.add(mesh);
    }
    sceneNodes = new SceneNodes(sceneStyle ?? DEFAULT_SCENE_STYLE, countByShape(nodes));
    for (const mesh of sceneNodes.meshes) {
      scene.add(mesh);
    }
    if (nodes !== undefined) sceneNodes.setNodes(nodes);
    const resources: readonly GpuResource[] = [sceneEdges, sceneNodes];

    const threeCamera = new OrthographicCamera(0, 0, 0, 0, CAMERA_NEAR, CAMERA_FAR);
    const instance = new WebGPUSceneRenderer(
      camera,
      renderer,
      backend,
      scene,
      threeCamera,
      sceneNodes,
      sceneEdges,
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
    // The scene's GPU resources first, then the device that owns them, which is
    // the order `WebGPUSceneRenderer.dispose` uses and for the same reason:
    // freeing a buffer through a device that has already gone is at best a
    // no-op. All of it is disposed here rather than in `createRenderer`, so
    // nothing can be disposed twice: three's `WebGPURenderer.dispose` is not a
    // documented no-op on a second call.
    sceneEdges?.dispose();
    sceneNodes?.dispose();
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
 * **This function resolving is not a promise that WebGPU is in use, and as of
 * M4.9a it is not silent about that either.** three's `WebGPURenderer` falls
 * back to WebGL2 by itself when WebGPU is unavailable; `options.backend` says
 * whether that is acceptable and {@link Renderer.backend} says what happened.
 * The default is `auto`, which takes either and reports which. See `backend.ts`
 * for why the check is after `init()` rather than a capability probe before it,
 * and for the measurement behind that.
 *
 * **A caller never has to dispose a renderer it did not receive.** Pass a
 * `signal` and every early exit below cleans up whatever had been built before
 * rejecting with the abort reason, so an effect that unmounts mid-`init()`
 * needs no flag, no `created.dispose()` branch and no comment explaining them.
 */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
  const { canvas, signal } = options;
  const clearColor = requireClearColor(options.clearColor ?? DEFAULT_CLEAR_COLOR);
  // Beside the clear colour and before the abort check for the same reason it
  // is: a preference that is not one of the three is a bug in the caller's
  // source whatever the signal says, and a `RangeError` that only appears on
  // the runs nobody aborted is a `RangeError` found by a user.
  const preference = requireBackendPreference(options.backend ?? DEFAULT_BACKEND);

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
    // `true` only for an explicit `webgl2`. `webgpu` is constructed exactly like
    // `auto`, because three's constructor writes its own `getFallback` over
    // anything passed in and there is no supported way to ask it not to fall
    // back; the strict request is enforced below instead, by reading what came
    // up. See `backend.ts`.
    forceWebGL: forceWebGLFor(preference),
    // On by default because a graph is edges and box corners, and every one of
    // them is a diagonal that reads as a staircase without it. Not exposed in
    // `RendererOptions`, and M4.9a did NOT expose it while it was adding the
    // option next to it, deliberately: `backend` is a choice about which API
    // draws, and this is a choice about how many samples it draws with, which
    // is M4.10's bandwidth question and needs the measurement below.
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

  // AFTER `init()`, which is the whole finding: three requests the adapter in
  // there, and a browser that advertises `navigator.gpu` can still have none to
  // give. Measured on this box on 2026-08-23, through
  // `bench/browser/backend-probe.mjs`: `'gpu' in navigator` is true, the
  // adapter request comes back null, and three falls back. A probe before this
  // line would have told a caller who asked for WebGPU that they had it.
  //
  // Refusing disposes, so `createRenderer`'s promise holds here too: a caller
  // never has to dispose a renderer it did not receive. The abort check comes
  // first because a caller who has gone away does not care which backend it was.
  const backend = backendOf(renderer.backend);
  try {
    requireBackendHonoured(preference, backend);
  } catch (error) {
    renderer.dispose();
    throw error;
  }

  // An EMPTY scene, and the device handed back if building it throws.
  // Everything from here to the returned renderer lives in one function with one
  // `catch` for that reason: see {@link buildSceneRenderer}. What is drawn now
  // comes from `setNodes`, which is M4.4's whole point: the package stopped
  // shipping a hard-coded scene the day it could take a real one.
  return buildSceneRenderer(
    camera,
    renderer,
    backend,
    clearColor,
    options.sceneStyle,
    options.nodes,
    options.edgeGroups,
  );
}
