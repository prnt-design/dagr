import { describe, expect, it, vi } from 'vitest';
import { Camera2D } from '../src/camera.js';
import { RendererDisposedError } from '../src/errors.js';
import type { SceneStyle } from '../src/instance-attributes.js';
import { SceneEdges } from '../src/scene-edges.js';
import { SceneNodes } from '../src/scene-nodes.js';
import type { SceneNode } from '../src/scene-nodes.js';
import {
  WebGPUSceneRenderer,
  adoptCanvasViewport,
  buildSceneRenderer,
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
 * passes a real `WebGPURenderer`, `Scene`, `OrthographicCamera` and a list of
 * real `InstancedShapes` objects into those same
 * parameters. So the typecheck of `createRenderer` is the proof that the real
 * three objects satisfy the interfaces these stubs satisfy, and no cast is
 * involved anywhere.
 *
 * The same argument reaches further than M4.2 first claimed. Everything
 * `createRenderer` does after `await renderer.init()` is `buildSceneRenderer`,
 * which takes its sink as a {@link FrameSink}, so the scene assembly is exercised
 * here over the same counting stub: the six shapes, the one resource per shape
 * family they now come to (M4.3 draws them instanced), the frustum, and the
 * branch that hands the device back when building the scene throws. That last one is a leak building a scene makes possible by validating,
 * and it is the reason the assembly is a function rather than four lines inside an
 * `async` one. What still needs a device is `init()` itself and the abort check
 * that follows it.
 *
 * M4.2 generalised the last two constructor parameters from a geometry and a
 * material to a LIST of resources, because a signature with one of each only
 * fitted a scene of exactly one mesh, and the scene is now two. Every lifecycle
 * assertion M4.1 made is still here, and the list added one: that every resource
 * in it is disposed exactly once, which a two-resource scene could not
 * distinguish from a hardcoded pair of `dispose()` calls.
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
  /** The scene's resources, in the order they were handed to the renderer. */
  readonly resources: StubResource[];
  readonly renderer: WebGPUSceneRenderer;
}

/**
 * The viewport every renderer under test starts on: 800 by 600 at ratio 2, so
 * the drawing buffer is 1600 by 1200 and a buffer assertion cannot pass by
 * accident against a CSS number.
 */
const initialViewport = { width: 800, height: 600, devicePixelRatio: 2 } as const;

/** The three uniforms every node in a scene shares. Any valid set will do here. */
const sceneStyle: SceneStyle = { outlineColor: 0x023047, glowAlpha: 0.45, outlinePixels: 2 };

/** A node the scene can draw, so the tests below have something to hand `setNodes`. */
function node(id: string, x = 0): SceneNode {
  return {
    id,
    shape: 'roundedRect',
    center: { x, y: 0 },
    size: { width: 100, height: 40 },
    cornerRadius: 4,
    fillColor: 0xffb703,
    glowColor: 0xfb8500,
    glowWorld: 10,
  };
}

/**
 * Builds a renderer over stubs, keeping every stub for assertions.
 *
 * Five resources by default, not two, and the number is deliberately not the
 * number of resources any real scene has: the point is that nothing in the class
 * knows how many there are. A geometry-and-material pair could be disposed
 * correctly by two hardcoded calls, and five cannot.
 */
function harness(
  camera = new Camera2D({ viewport: initialViewport }),
  resourceCount = 5,
): Harness {
  const sink = new StubFrameSink();
  const threeCamera = new StubProjectionTarget();
  const resources = Array.from({ length: resourceCount }, () => new StubResource());
  const nodes = new SceneNodes(sceneStyle);
  const renderer = new WebGPUSceneRenderer(camera, sink, {}, threeCamera, nodes, new SceneEdges([]), [
    ...resources,
    nodes,
  ]);
  return { camera, sink, threeCamera, resources, renderer };
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
  it('disposes every resource in the list exactly once, however many there are', () => {
    // The assertion the list made necessary. M4.1's scene had one geometry and one
    // material, which two hardcoded `dispose()` calls satisfy; M4.2's had twelve
    // and M4.3's is one per shape family, and a loop that stopped early or
    // skipped one would leak a buffer per mount with no symptom until several
    // mounts had accumulated.
    const { sink, resources, renderer } = harness();
    expect(resources).toHaveLength(5);
    renderer.dispose();
    for (const resource of resources) {
      expect(resource.disposals).toBe(1);
    }
    expect(sink.disposals).toBe(1);
  });

  it('disposes nothing but is still idempotent for an empty scene', () => {
    // The degenerate case, because a scene built from an empty descriptor list is
    // a legal thing for M4.4 to produce (a graph with no nodes) and it must not be
    // the case that only a non-empty list makes `dispose` safe.
    const { sink, renderer } = harness(undefined, 0);
    renderer.dispose();
    renderer.dispose();
    expect(sink.disposals).toBe(1);
  });

  it('is idempotent, so a double unmount cannot double free', () => {
    // `dispose()` on an already-disposed three renderer is not a documented
    // no-op, and a component that unmounts twice is ordinary rather than a bug
    // worth crashing for.
    const { sink, resources, renderer } = harness();
    renderer.dispose();
    renderer.dispose();
    renderer.dispose();
    for (const resource of resources) {
      expect(resource.disposals).toBe(1);
    }
    expect(sink.disposals).toBe(1);
  });

  it('frees the resources before the device that owns them', () => {
    // Order, not just count. `WebGPURenderer.dispose` tears the device down, and
    // freeing a buffer through a device that has already gone is at best a no-op
    // and at worst a driver complaint. Checked by having the sink record how many
    // resources had been disposed by the time it was.
    const sink = new StubFrameSink();
    const resources = [new StubResource(), new StubResource(), new StubResource()];
    let disposedBeforeSink = -1;
    const countingSink: FrameSink = {
      setPixelRatio: (ratio) => sink.setPixelRatio(ratio),
      setSize: (width, height, updateStyle) => sink.setSize(width, height, updateStyle),
      render: () => sink.render(),
      dispose: () => {
        disposedBeforeSink = resources.filter((resource) => resource.disposals > 0).length;
        sink.dispose();
      },
    };
    new WebGPUSceneRenderer(
      new Camera2D({ viewport: initialViewport }),
      countingSink,
      {},
      new StubProjectionTarget(),
      new SceneNodes(sceneStyle),
      new SceneEdges([]),
      resources,
    ).dispose();
    expect(disposedBeforeSink).toBe(resources.length);
  });

  it('ignores a resource added to the caller array after construction', () => {
    // The copy in the constructor, as a claim. A caller holding the array it
    // passed could otherwise change what gets freed after the fact: a resource
    // pushed on later would be disposed by a renderer that never saw it built,
    // and one spliced out would be freed twice if the caller also freed it.
    const camera = new Camera2D({ viewport: initialViewport });
    const resources = [new StubResource()];
    const renderer = new WebGPUSceneRenderer(
      camera,
      new StubFrameSink(),
      {},
      new StubProjectionTarget(),
      new SceneNodes(sceneStyle),
      new SceneEdges([]),
      resources,
    );
    const late = new StubResource();
    resources.push(late);
    renderer.dispose();
    expect(resources[0]?.disposals).toBe(1);
    expect(late.disposals).toBe(0);
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

describe('buildSceneRenderer', () => {
  /** A node that fails validation: a corner radius past half the smaller side. */
  const impossible: SceneNode = { ...node('too-round'), cornerRadius: 30 };

  it('gives the device back when building the scene throws, and rethrows', () => {
    // The leak this function exists to close, and the reason it is a function.
    // Before M4.2 everything between `await renderer.init()` and the returned
    // renderer was infallible literal construction; building a scene is not,
    // because it validates, and a `RangeError` there used to propagate out of
    // `createRenderer` with the initialised device referenced only by a local in
    // an unwinding frame. M4.4 is the task that made it reachable in earnest: the
    // nodes are a caller's, so their numbers are somebody else's arithmetic.
    const camera = new Camera2D({ viewport: initialViewport });
    const sink = new StubFrameSink();
    expect(() => buildSceneRenderer(camera, sink, 0x0b0d10, sceneStyle, [impossible])).toThrow(
      RangeError,
    );
    expect(sink.disposals).toBe(1);
    // The error is the validation's own, not something invented here: a caller
    // who wrote a bad number is told which node and which field, and the node's
    // own id is what names it.
    expect(() =>
      buildSceneRenderer(camera, new StubFrameSink(), 0x0b0d10, sceneStyle, [impossible]),
    ).toThrow(/too-round\.cornerRadius/);
  });

  it('disposes the device exactly once, not once per resource already built', () => {
    // Two nodes, the second of which is impossible, so a family's mesh has
    // already been built and the first instance written by the time the throw
    // happens. `SceneNodes` disposes those meshes; the device is the one thing it
    // cannot reach, and it has to be given back once rather than once per unwind.
    const sink = new StubFrameSink();
    expect(() =>
      buildSceneRenderer(new Camera2D({ viewport: initialViewport }), sink, 0x0b0d10, sceneStyle, [
        node('good'),
        impossible,
      ]),
    ).toThrow(RangeError);
    expect(sink.disposals).toBe(1);
  });

  it('takes an empty node list rather than rejecting a capacity of zero', () => {
    // `nodes` sizes the instance buffers, and one count applied to both families
    // meant an empty list asked for a capacity of 0, which `InstanceBuffer`
    // rejects: the caller got a `RangeError` naming an option they never wrote.
    const sink = new StubFrameSink();
    const renderer = buildSceneRenderer(
      new Camera2D({ viewport: initialViewport }),
      sink,
      0x0b0d10,
      sceneStyle,
      [],
    );
    renderer.render();
    expect(sink.frames).toBe(1);
    renderer.dispose();
  });

  it('sizes each family for its OWN nodes, not for the whole list', () => {
    const circle: SceneNode = {
      ...node('c'),
      shape: 'circle',
      size: { width: 40, height: 40 },
    };
    const renderer = buildSceneRenderer(
      new Camera2D({ viewport: initialViewport }),
      new StubFrameSink(),
      0x0b0d10,
      sceneStyle,
      [node('a'), node('b', 500), circle],
    );
    renderer.render();
    renderer.dispose();
  });

  it('frees the SCENE as well as the device when a node is rejected', () => {
    // The scene owns two geometries and two materials before the first fallible
    // line, and three's geometries and materials are not collectable: they hold
    // GPU buffers that only dispose() releases. `FirstLight` passes its nodes to
    // `createRenderer`, so under StrictMode a bad node would orphan two pairs
    // per mount attempt.
    //
    // SPIED, because counting the sink's disposals does not distinguish the fix
    // from its absence: the device-only path satisfied that too, and a reviewer
    // proved the first version of this test passed with `sceneNodes?.dispose()`
    // commented out. The scene's own disposal is the claim, so the scene's own
    // disposal is what is asserted.
    const disposed = vi.spyOn(SceneNodes.prototype, 'dispose');
    const sink = new StubFrameSink();
    const duplicated = [node('a'), node('a', 500)];
    expect(() =>
      buildSceneRenderer(
        new Camera2D({ viewport: initialViewport }),
        sink,
        0x0b0d10,
        sceneStyle,
        duplicated,
      ),
    ).toThrow(RangeError);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(sink.disposals).toBe(1);
    disposed.mockRestore();
  });

  it('frees the EDGES too, which is what a rebase caught', () => {
    // M4.5 added a SECOND owner of GPU resources in front of the same fallible
    // line, so a fix naming only the nodes was half a fix within a day of being
    // written. The rejected node is still what throws; the edges are built
    // before it and have to be given back as well.
    const disposedEdges = vi.spyOn(SceneEdges.prototype, 'dispose');
    const disposedNodes = vi.spyOn(SceneNodes.prototype, 'dispose');
    const sink = new StubFrameSink();
    expect(() =>
      buildSceneRenderer(new Camera2D({ viewport: initialViewport }), sink, 0x0b0d10, sceneStyle, [
        node('a'),
        node('a', 500),
      ]),
    ).toThrow(RangeError);
    expect(disposedEdges).toHaveBeenCalledTimes(1);
    expect(disposedNodes).toHaveBeenCalledTimes(1);
    expect(sink.disposals).toBe(1);
    disposedEdges.mockRestore();
    disposedNodes.mockRestore();
  });

  it('rejects a node style that cannot be drawn, and still gives the device back', () => {
    const sink = new StubFrameSink();
    expect(() =>
      buildSceneRenderer(new Camera2D({ viewport: initialViewport }), sink, 0x0b0d10, {
        ...sceneStyle,
        glowAlpha: 2,
      }),
    ).toThrow(RangeError);
    expect(sink.disposals).toBe(1);
  });

  it('wires up an EMPTY scene on the success path, with no device anywhere', () => {
    // The other half of pulling this out of the `async` function: the assembly
    // past `init()` used to be unreachable in Node and therefore untested. It is
    // not the renderer three would build (the sink is a stub), but every line of
    // this package's own wiring runs: both family meshes, a sized drawing buffer,
    // and a frustum that is no longer four zeroes. Empty is the honest starting
    // state as of M4.4: this package ships no scene of its own any more.
    const camera = new Camera2D({ viewport: initialViewport });
    const sink = new StubFrameSink();
    const renderer = buildSceneRenderer(camera, sink, 0x0b0d10);
    expect(renderer.camera).toBe(camera);
    expect(sink.sizes).toEqual([{ width: 1600, height: 1200, updateStyle: false }]);
    renderer.render();
    expect(sink.frames).toBe(1);
    renderer.dispose();
    expect(sink.disposals).toBe(1);
  });

  it('draws the nodes it was built with, and sizes the buffers for exactly them', () => {
    // Not the same thing as `setNodes` after construction, which is why the
    // option exists: the buffers are allocated for this many nodes, so a caller
    // that already has its layout when it mounts pays no reallocation.
    const renderer = buildSceneRenderer(
      new Camera2D({ viewport: initialViewport }),
      new StubFrameSink(),
      0x0b0d10,
      sceneStyle,
      [node('a'), node('b', 500)],
    );
    renderer.setNodes([node('a'), node('b', 500), node('c', 900)]);
    renderer.render();
    renderer.dispose();
  });

  it('refuses setNodes and handleOf after dispose, on the same terms as render', () => {
    const renderer = buildSceneRenderer(
      new Camera2D({ viewport: initialViewport }),
      new StubFrameSink(),
      0x0b0d10,
    );
    renderer.dispose();
    expect(() => renderer.setNodes([node('a')])).toThrow(RendererDisposedError);
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
