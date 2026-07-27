import { describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { RendererDisposedError } from '../src/errors.js';
import {
  WebGPUSceneRenderer,
  adoptCanvasViewport,
  createRenderer,
} from '../src/webgpu-renderer.js';
import type { FrameSink, GpuResource, ProjectionTarget } from '../src/webgpu-renderer.js';

/**
 * The renderer's bookkeeping, tested without a GPU.
 *
 * The package's rule is that a GPU adapter is what stops `webgpu-renderer.ts`
 * being tested, and that is true of drawing: nothing here proves a pixel
 * arrives. It was never true of the lifecycle. `#disposed`, the idempotence of
 * `dispose`, the refusal to draw afterwards, and the decision about when the
 * drawing buffer is reallocated are all decisions made in plain JavaScript
 * about when to call four methods on three collaborators, and every one of them
 * is checkable by counting those calls.
 *
 * The stubs below are honest for one specific reason: the collaborator types
 * they implement are the ones the class actually declares, and `createRenderer`
 * passes a real `WebGPURenderer`, `Scene`, `OrthographicCamera`, `PlaneGeometry`
 * and `MeshBasicNodeMaterial` into those same parameters. So the typecheck of
 * `createRenderer` is the proof that the real three objects satisfy the
 * interfaces these stubs satisfy, and no cast is involved anywhere.
 */

/** A three-shaped position: the two lines of `Vector3` this renderer touches. */
class StubPosition {
  x = 0;
  y = 0;
  z = 0;

  set(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

/** An `OrthographicCamera` reduced to the six fields the renderer writes. */
class StubProjectionTarget implements ProjectionTarget {
  left = 0;
  right = 0;
  bottom = 0;
  top = 0;
  readonly position = new StubPosition();
  projectionUpdates = 0;

  updateProjectionMatrix(): void {
    this.projectionUpdates += 1;
  }
}

/** A `WebGPURenderer` reduced to a call log. */
class StubFrameSink implements FrameSink {
  readonly pixelRatios: number[] = [];
  readonly sizes: { width: number; height: number; updateStyle: boolean | undefined }[] = [];
  frames = 0;
  disposals = 0;

  setPixelRatio(ratio: number): void {
    this.pixelRatios.push(ratio);
  }

  setSize(width: number, height: number, updateStyle?: boolean): void {
    this.sizes.push({ width, height, updateStyle });
  }

  render(): void {
    this.frames += 1;
  }

  dispose(): void {
    this.disposals += 1;
  }
}

/** A geometry or a material, reduced to a disposal count. */
class StubResource implements GpuResource {
  disposals = 0;

  dispose(): void {
    this.disposals += 1;
  }
}

/** Everything one renderer under test is built from, kept for assertions. */
interface Harness {
  readonly camera: Camera2D;
  readonly sink: StubFrameSink;
  readonly threeCamera: StubProjectionTarget;
  readonly geometry: StubResource;
  readonly material: StubResource;
  readonly renderer: WebGPUSceneRenderer;
}

/**
 * The viewport every renderer under test starts on: 800 by 600 at ratio 2, so
 * the drawing buffer is 1600 by 1200 and a buffer assertion cannot pass by
 * accident against a CSS number.
 */
const initialViewport = { width: 800, height: 600, devicePixelRatio: 2 } as const;

/** Builds a renderer over stubs, keeping every stub for assertions. */
function harness(camera = new Camera2D({ viewport: initialViewport })): Harness {
  const sink = new StubFrameSink();
  const threeCamera = new StubProjectionTarget();
  const geometry = new StubResource();
  const material = new StubResource();
  const renderer = new WebGPUSceneRenderer(camera, sink, {}, threeCamera, geometry, material);
  return { camera, sink, threeCamera, geometry, material, renderer };
}

describe('WebGPUSceneRenderer drawing buffer', () => {
  it('sizes the drawing buffer on the first render', () => {
    const { sink, renderer } = harness();
    renderer.render();
    expect(sink.sizes).toEqual([{ width: 1600, height: 1200, updateStyle: false }]);
    expect(sink.pixelRatios).toEqual([1]);
  });

  it('resizes the buffer when the camera viewport changed without a resize() call', () => {
    // The bug this test exists for. `Renderer.camera` is documented as the
    // object callers mutate, and `setViewport` is documented as how you tell it
    // the canvas resized. A `ResizeObserver` that calls `camera.setViewport`
    // and then `render` therefore got a correct frustum drawn into a buffer
    // still sized for the old canvas, which the browser stretches: a blurry
    // frame at the wrong aspect ratio, with `worldToScreen` disagreeing with
    // what is on screen, and nothing thrown anywhere.
    const { camera, sink, renderer } = harness();
    renderer.render();
    camera.setViewport({ width: 400, height: 300, devicePixelRatio: 2 });
    renderer.render();
    expect(sink.sizes).toEqual([
      { width: 1600, height: 1200, updateStyle: false },
      { width: 800, height: 600, updateStyle: false },
    ]);
  });

  it('does not resize the buffer when nothing about it changed', () => {
    // The other half of the fix. `setSize` writes `canvas.width`, which
    // reallocates the drawing buffer, so an unguarded call every frame is a
    // real cost rather than a redundant assignment.
    const { sink, renderer } = harness();
    renderer.render();
    renderer.render();
    renderer.render();
    expect(sink.sizes).toHaveLength(1);
    expect(sink.pixelRatios).toHaveLength(1);
  });

  it('notices a device pixel ratio change at an unchanged CSS size', () => {
    // Dragging a window between a retina display and an external monitor moves
    // the ratio and nothing else, and it is the buffer that has to change.
    const { camera, sink, renderer } = harness();
    renderer.render();
    camera.setViewport({ ...initialViewport, devicePixelRatio: 1 });
    renderer.render();
    expect(sink.sizes).toEqual([
      { width: 1600, height: 1200, updateStyle: false },
      { width: 800, height: 600, updateStyle: false },
    ]);
  });

  it('notices a change on either axis alone', () => {
    // Both of these are ordinary: dragging a window edge sideways moves the
    // width and nothing else. Found by mutation, since every other test here
    // changes both axes at once, and a guard comparing only one of them
    // survived the whole suite. A window dragged taller would then keep drawing
    // into the old buffer, stretched, until something moved the width too.
    const shorter = harness();
    shorter.renderer.render();
    shorter.camera.setViewport({ ...initialViewport, height: 300 });
    shorter.renderer.render();
    expect(shorter.sink.sizes).toEqual([
      { width: 1600, height: 1200, updateStyle: false },
      { width: 1600, height: 600, updateStyle: false },
    ]);

    const narrower = harness();
    narrower.renderer.render();
    narrower.camera.setViewport({ ...initialViewport, width: 400 });
    narrower.renderer.render();
    expect(narrower.sink.sizes).toEqual([
      { width: 1600, height: 1200, updateStyle: false },
      { width: 800, height: 1200, updateStyle: false },
    ]);
  });

  it('draws on every render even when the buffer did not change', () => {
    // The size guard must skip the reallocation, not the frame.
    const { sink, renderer } = harness();
    renderer.render();
    renderer.render();
    expect(sink.frames).toBe(2);
  });

  it('leaves the canvas CSS size alone', () => {
    const { sink, renderer } = harness();
    renderer.render();
    expect(sink.sizes.every((size) => size.updateStyle === false)).toBe(true);
  });
});

describe('WebGPUSceneRenderer camera sync', () => {
  it('writes the frustum and the centre onto the three camera every frame', () => {
    const { camera, threeCamera, renderer } = harness();
    camera.setCenter({ x: 12, y: -34 });
    camera.setZoom(2);
    renderer.render();

    // 800 by 600 CSS at zoom 2 is 400 by 300 world units, centre-relative.
    expect(threeCamera.left).toBe(-200);
    expect(threeCamera.right).toBe(200);
    expect(threeCamera.bottom).toBe(-150);
    expect(threeCamera.top).toBe(150);
    expect(threeCamera.position.x).toBe(12);
    expect(threeCamera.position.y).toBe(-34);
    expect(threeCamera.projectionUpdates).toBe(1);
  });

  it('picks up a pan between frames, having no change notification to rely on', () => {
    const { camera, threeCamera, renderer } = harness();
    renderer.render();
    camera.panByScreen(100, 0);
    renderer.render();
    expect(threeCamera.position.x).toBe(-100);
    expect(threeCamera.projectionUpdates).toBe(2);
  });

  it('adopts a viewport passed to resize, and syncs both halves of it', () => {
    // `resize` is sugar: the camera setter plus the sync path `render` runs.
    const { camera, sink, threeCamera, renderer } = harness();
    renderer.resize({ width: 200, height: 100, devicePixelRatio: 1 });
    expect(camera.viewport).toEqual({ width: 200, height: 100, devicePixelRatio: 1 });
    expect(sink.sizes).toEqual([{ width: 200, height: 100, updateStyle: false }]);
    expect(threeCamera.right).toBe(100);
    expect(threeCamera.top).toBe(50);
  });

  it('rejects a viewport the camera would reject', () => {
    const { renderer } = harness();
    expect(() => renderer.resize({ width: 0, height: 100, devicePixelRatio: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('WebGPUSceneRenderer disposal', () => {
  it('disposes every resource it owns exactly once', () => {
    const { sink, geometry, material, renderer } = harness();
    renderer.dispose();
    expect(geometry.disposals).toBe(1);
    expect(material.disposals).toBe(1);
    expect(sink.disposals).toBe(1);
  });

  it('is idempotent, so a double unmount cannot double free', () => {
    // `dispose()` on an already-disposed three renderer is not a documented
    // no-op, and a component that unmounts twice is ordinary rather than a bug
    // worth crashing for.
    const { sink, geometry, material, renderer } = harness();
    renderer.dispose();
    renderer.dispose();
    renderer.dispose();
    expect(geometry.disposals).toBe(1);
    expect(material.disposals).toBe(1);
    expect(sink.disposals).toBe(1);
  });

  it('refuses to render afterwards, with a catchable error', () => {
    const { sink, renderer } = harness();
    renderer.dispose();
    expect(() => renderer.render()).toThrow(RendererDisposedError);
    expect(() => renderer.render()).toThrow(/render\(\)/);
    expect(sink.frames).toBe(0);
  });

  it('refuses to resize afterwards, naming the method that was called', () => {
    const { sink, renderer } = harness();
    renderer.dispose();
    expect(() => renderer.resize(initialViewport)).toThrow(RendererDisposedError);
    expect(() => renderer.resize(initialViewport)).toThrow(/resize\(\)/);
    expect(sink.sizes).toHaveLength(0);
  });

  it('throws an error a caller can catch by class rather than by message', () => {
    // The point of the class. Use after dispose arrives from a lifecycle race
    // in somebody else's framework, which makes it the failure a caller is most
    // likely to want to catch deliberately, and a message match is not a way to
    // catch anything.
    const { renderer } = harness();
    renderer.dispose();
    try {
      renderer.render();
      expect.unreachable('render() on a disposed renderer has to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RendererDisposedError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('RendererDisposedError');
    }
  });
});

/**
 * A canvas with the four properties this package reads off one.
 *
 * A cast rather than a DOM implementation, because a real `HTMLCanvasElement`
 * would need a document, and a document would need a DOM environment this suite
 * deliberately does not have: the point of these tests is that they run in
 * plain Node. The cast is narrow, it is in one place, and every property the
 * package reads is present on the object, so nothing here is pretending to be
 * more of a canvas than the code under test asks for.
 */
function fakeCanvas(measurements: {
  clientWidth: number;
  clientHeight: number;
  width?: number;
  height?: number;
}): HTMLCanvasElement {
  return {
    clientWidth: measurements.clientWidth,
    clientHeight: measurements.clientHeight,
    width: measurements.width ?? 300,
    height: measurements.height ?? 150,
  } as unknown as HTMLCanvasElement;
}

describe('adoptCanvasViewport', () => {
  it('lets a laid-out canvas overrule a camera the caller supplied', () => {
    // The bug this test exists for. The canvas was measured only on the branch
    // that BUILT the camera, so a caller following the documented advice (bring
    // your own camera, so input can be wired before the async factory resolves)
    // got a camera still on the HTML default 300 by 150, and an 800 by 600
    // canvas rendered a 300 by 150 buffer stretched across it.
    const camera = new Camera2D();
    adoptCanvasViewport(camera, fakeCanvas({ clientWidth: 800, clientHeight: 600 }));
    expect(camera.viewport.width).toBe(800);
    expect(camera.viewport.height).toBe(600);
  });

  it('leaves a deliberately set viewport alone when the canvas has no layout', () => {
    // A canvas outside a document measures zero, and zero is not an opinion.
    // Falling back to its `width` attribute here would overwrite a viewport the
    // caller chose with a number nobody chose.
    const camera = new Camera2D({
      viewport: { width: 1024, height: 768, devicePixelRatio: 2 },
    });
    adoptCanvasViewport(camera, fakeCanvas({ clientWidth: 0, clientHeight: 0 }));
    expect(camera.viewport).toEqual({ width: 1024, height: 768, devicePixelRatio: 2 });
  });

  it('is what createRenderer points a supplied camera with, before any device', () => {
    // The wiring, as far as a Node test can reach it. `createRenderer` cannot
    // succeed here (no GPU), but it adopts the canvas viewport BEFORE it
    // requests a device, so the camera it was handed carries the answer out
    // through the failure. Without this the helper and its one caller are
    // tested separately and never together, which mutation testing caught:
    // deleting the call from `createRenderer` left the whole suite green.
    const camera = new Camera2D();
    const canvas = fakeCanvas({ clientWidth: 800, clientHeight: 600 });
    return createRenderer({ canvas, camera })
      .catch(() => undefined)
      .then(() => {
        expect(camera.viewport.width).toBe(800);
        expect(camera.viewport.height).toBe(600);
      });
  });

  it('treats a canvas with only one measured axis as having no layout', () => {
    // Half a measurement is not a viewport: `Camera2D` rejects a zero-width
    // one, so this would be a throw rather than a stretched drawing.
    const camera = new Camera2D();
    adoptCanvasViewport(camera, fakeCanvas({ clientWidth: 800, clientHeight: 0 }));
    expect(camera.viewport).toEqual({ width: 300, height: 150, devicePixelRatio: 1 });
  });
});

describe('createRenderer validation', () => {
  it('rejects a clearColor that is not a 24-bit colour', () => {
    // Measured against three 0.185.1, which validates none of these: `NaN` and
    // `Infinity` both give #000000, `-1` gives #ffffff, `0x1ffffff` saturates
    // to #ffffff, and `1.7` floors to #000001. A black frame is exactly the
    // "broken renderer" look the amber-on-near-black default exists to rule
    // out, so an accidental `NaN` produced the one frame the colour scheme was
    // chosen to make impossible.
    const canvas = fakeCanvas({ clientWidth: 800, clientHeight: 600 });
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0x1000000, 1.7];
    return Promise.all(
      bad.map((clearColor) =>
        expect(createRenderer({ canvas, clearColor })).rejects.toThrow(RangeError),
      ),
    );
  });

  it('names the field it rejected, as camera.ts does', async () => {
    const canvas = fakeCanvas({ clientWidth: 800, clientHeight: 600 });
    await expect(createRenderer({ canvas, clearColor: -1 })).rejects.toThrow(/clearColor/);
  });

  it('accepts the ends of the 24-bit range', () => {
    // Not a claim that these build a renderer, which needs a device. Only that
    // the validation lets them past, which is checked by the failure NOT being
    // the RangeError above.
    const canvas = fakeCanvas({ clientWidth: 800, clientHeight: 600 });
    return Promise.all(
      [0x000000, 0xffffff].map(async (clearColor) => {
        await expect(createRenderer({ canvas, clearColor })).rejects.not.toThrow(RangeError);
      }),
    );
  });
});

describe('createRenderer cancellation', () => {
  it('rejects with the abort reason when the signal is already aborted', async () => {
    // Every consumer mounting a renderer in an effect otherwise hand-rolls
    // this: a flag, a `if (cancelled) created.dispose()` branch, and a comment.
    // The one that forgets leaks a GPU device per abandoned mount, with no
    // symptom until several have leaked.
    const controller = new AbortController();
    const reason = new Error('the component unmounted');
    controller.abort(reason);
    await expect(
      createRenderer({
        canvas: fakeCanvas({ clientWidth: 800, clientHeight: 600 }),
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });

  it('rejects with an AbortError when the caller gave no reason', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createRenderer({
        canvas: fakeCanvas({ clientWidth: 800, clientHeight: 600 }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not ask for a GPU device it has already been told to throw away', async () => {
    // The check is before the `WebGPURenderer` is constructed as well as after
    // `init()` resolves, so an already-aborted mount costs nothing. Proven here
    // by the rejection being the abort reason rather than the adapter failure
    // this environment produces: Node has no GPU, so anything that reached
    // `init()` would reject with something else.
    const controller = new AbortController();
    const reason = new Error('aborted before any device was requested');
    controller.abort(reason);
    const failure = await createRenderer({
      canvas: fakeCanvas({ clientWidth: 800, clientHeight: 600 }),
      signal: controller.signal,
    }).catch((error: unknown) => error);
    expect(failure).toBe(reason);
  });
});
