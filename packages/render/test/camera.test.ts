import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Camera2D } from '../src/camera.js';
import type { Vec2, ViewportSize } from '../src/types.js';
import { CAMERA_FAR, CAMERA_NEAR, CAMERA_Z } from '../src/webgpu-renderer.js';

/**
 * The whole of M4.1's automated coverage. `webgpu-renderer.ts` needs a GPU
 * adapter to do anything at all, so the package's testing split is deliberate:
 * every claim that can be checked without a device is a claim about the camera,
 * and this file checks all of them.
 *
 * Two habits from the graph and layout suites carry over. Random cases come
 * from a seeded PRNG, so a failure reproduces exactly rather than once. And
 * where a test measures a numerical error, it asserts the bound it actually
 * measured rather than a comfortable round number, because a bound nobody has
 * seen the suite approach is a bound nobody has tested.
 */

/** mulberry32, a 32-bit seeded PRNG, as in `@dagr/graph` and `@dagr/layout`. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many random cases each property test draws. */
const RUNS = 2000;

/** The seed every property test in this file starts from. */
const SEED = 20260727;

/**
 * One random camera setup: zoom spanning six orders of magnitude, a centre far
 * enough from the origin that the subtraction in `screenToWorld` actually
 * cancels significant digits, and a viewport in the range a real canvas lives
 * in. The DPR is drawn too, so every property below is also a statement that
 * the DPR did not matter.
 */
function randomCamera(random: () => number): Camera2D {
  return new Camera2D({
    zoom: 10 ** (random() * 6 - 3),
    center: { x: (random() * 2 - 1) * 1e4, y: (random() * 2 - 1) * 1e4 },
    viewport: {
      width: 1 + random() * 2000,
      height: 1 + random() * 1200,
      devicePixelRatio: [1, 1.5, 2, 3.5][Math.floor(random() * 4)] ?? 1,
    },
  });
}

/** A random screen point, drawn over the canvas and a little beyond it. */
function randomScreenPoint(random: () => number, viewport: ViewportSize): Vec2 {
  return {
    x: (random() * 1.4 - 0.2) * viewport.width,
    y: (random() * 1.4 - 0.2) * viewport.height,
  };
}

/** The larger of the two coordinate-wise absolute differences. */
function maxAbsDiff(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

describe('Camera2D conventions', () => {
  it('puts world +y up the screen and screen +y down the canvas', () => {
    const camera = new Camera2D({ viewport: { width: 200, height: 100, devicePixelRatio: 1 } });
    const origin = camera.worldToScreen({ x: 0, y: 0 });
    const up = camera.worldToScreen({ x: 0, y: 10 });
    expect(origin).toEqual({ x: 100, y: 50 });
    expect(up.y).toBeLessThan(origin.y);
  });

  it('treats zoom as CSS pixels per world unit', () => {
    const camera = new Camera2D({
      zoom: 2,
      viewport: { width: 200, height: 100, devicePixelRatio: 1 },
    });
    const left = camera.worldToScreen({ x: 0, y: 0 });
    const right = camera.worldToScreen({ x: 1, y: 0 });
    expect(right.x - left.x).toBe(2);
  });

  it('puts the screen origin at the canvas top-left corner', () => {
    const camera = new Camera2D({
      zoom: 4,
      center: { x: 3, y: -7 },
      viewport: { width: 640, height: 480, devicePixelRatio: 2 },
    });
    const topLeft = camera.screenToWorld({ x: 0, y: 0 });
    const bounds = camera.visibleWorldBounds();
    expect(topLeft.x).toBeCloseTo(bounds.minX, 12);
    expect(topLeft.y).toBeCloseTo(bounds.maxY, 12);
  });
});

describe('Camera2D screen and world round trips', () => {
  it('returns a screen point unchanged through world and back, to within 1e-8 CSS px', () => {
    // Measured worst case over these 2000 seeded cases: 7.393e-10 CSS pixels.
    // The bound asserted is 1e-8, about thirteen times the worst case seen, so
    // the assertion is a claim the suite actually approaches rather than a
    // comfortable round number nothing has ever come near. The error comes from
    // the cancellation in `screenToWorld`: a centre 1e4 world units out and a
    // zoom of 1e3 puts a whole ulp of the centre at 1e-9 of a CSS pixel.
    const random = mulberry32(SEED);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const camera = randomCamera(random);
      const screen = randomScreenPoint(random, camera.viewport);
      const back = camera.worldToScreen(camera.screenToWorld(screen));
      worst = Math.max(worst, maxAbsDiff(screen, back));
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it('returns a world point unchanged through screen and back, to within 1e-11 CSS px equivalent', () => {
    // The error is scaled by the zoom so that it is reported in the same unit
    // as the forward round trip: a world error only matters in proportion to
    // how many CSS pixels it moves the point on screen. Measured worst case:
    // 2.113e-13 CSS pixels equivalent. This direction is the more accurate of
    // the two because the subtraction that cancels happens against the screen
    // centre, which is at most a thousand or so, rather than against a world
    // centre that may be four orders of magnitude out.
    const random = mulberry32(SEED + 1);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const camera = randomCamera(random);
      const world = camera.screenToWorld(randomScreenPoint(random, camera.viewport));
      const back = camera.screenToWorld(camera.worldToScreen(world));
      worst = Math.max(worst, maxAbsDiff(world, back) * camera.zoom);
    }
    expect(worst).toBeLessThan(1e-11);
  });
});

describe('Camera2D visibleWorldBounds', () => {
  it('has the viewport aspect ratio at any zoom', () => {
    // The same claim the `Rect`-shaped version made, in extents: the width of
    // the visible world over its height is the width of the canvas over its
    // height, whatever the zoom. Changing the shape of the return value was not
    // allowed to change what it says.
    const random = mulberry32(SEED + 2);
    for (let run = 0; run < 500; run += 1) {
      const camera = randomCamera(random);
      const bounds = camera.visibleWorldBounds();
      const viewportAspect = camera.viewport.width / camera.viewport.height;
      expect((bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)).toBeCloseTo(
        viewportAspect,
        9,
      );
    }
  });

  it('has corners equal to screenToWorld of the canvas corners', () => {
    const random = mulberry32(SEED + 3);
    for (let run = 0; run < 500; run += 1) {
      const camera = randomCamera(random);
      const { width, height } = camera.viewport;
      const bounds = camera.visibleWorldBounds();
      const bottomLeft = camera.screenToWorld({ x: 0, y: height });
      const topRight = camera.screenToWorld({ x: width, y: 0 });
      expect(bottomLeft.x).toBeCloseTo(bounds.minX, 9);
      expect(bottomLeft.y).toBeCloseTo(bounds.minY, 9);
      expect(topRight.x).toBeCloseTo(bounds.maxX, 9);
      expect(topRight.y).toBeCloseTo(bounds.maxY, 9);
    }
  });

  it('gives the minimum and maximum world extents on each axis', () => {
    const camera = new Camera2D({
      zoom: 2,
      center: { x: 10, y: 20 },
      viewport: { width: 400, height: 200, devicePixelRatio: 1 },
    });
    expect(camera.visibleWorldBounds()).toEqual({
      minX: -90,
      minY: -30,
      maxX: 110,
      maxY: 70,
    });
  });

  it('orders every minimum below its maximum, world y being up', () => {
    // What the extents shape buys over `{x, y, width, height}`: there is no
    // corner to name, so "which corner is x, y" is not a question a caller can
    // get wrong. What is left to assert is the ordering itself.
    const random = mulberry32(SEED + 8);
    for (let run = 0; run < 500; run += 1) {
      const bounds = randomCamera(random).visibleWorldBounds();
      expect(bounds.minX).toBeLessThan(bounds.maxX);
      expect(bounds.minY).toBeLessThan(bounds.maxY);
    }
  });
});

describe('Camera2D device pixel ratio isolation', () => {
  it('gives bit-identical screen and world results across DPR 1, 2 and 3.5', () => {
    const random = mulberry32(SEED + 4);
    for (let run = 0; run < 500; run += 1) {
      const zoom = 10 ** (random() * 6 - 3);
      const center = { x: (random() * 2 - 1) * 1e4, y: (random() * 2 - 1) * 1e4 };
      const width = 1 + random() * 2000;
      const height = 1 + random() * 1200;
      const screen = { x: random() * width, y: random() * height };
      const world = { x: center.x + (random() * 2 - 1) * 500, y: center.y + (random() * 2 - 1) * 500 };

      const cameras = [1, 2, 3.5].map(
        (devicePixelRatio) =>
          new Camera2D({ zoom, center, viewport: { width, height, devicePixelRatio } }),
      );
      const [first] = cameras;
      if (first === undefined) throw new Error('unreachable: three cameras were built');
      for (const camera of cameras) {
        // Exact equality, not closeness. The DPR never enters the arithmetic,
        // so any difference at all would mean it had.
        expect(camera.screenToWorld(screen)).toEqual(first.screenToWorld(screen));
        expect(camera.worldToScreen(world)).toEqual(first.worldToScreen(world));
        expect(camera.visibleWorldBounds()).toEqual(first.visibleWorldBounds());
        expect(camera.orthoFrustum()).toEqual(first.orthoFrustum());
      }
    }
  });

  it('consumes the DPR in drawingBufferSize and nowhere else', () => {
    const viewport = { width: 300, height: 150, devicePixelRatio: 2 } as const;
    const camera = new Camera2D({ viewport });
    expect(camera.drawingBufferSize()).toEqual({ width: 600, height: 300 });

    const plain = new Camera2D({ viewport: { ...viewport, devicePixelRatio: 1 } });
    expect(camera.drawingBufferSize()).not.toEqual(plain.drawingBufferSize());
    expect(camera.visibleWorldBounds()).toEqual(plain.visibleWorldBounds());
  });

  it('rounds the drawing buffer to the nearest whole device pixel', () => {
    const camera = new Camera2D({
      viewport: { width: 100.5, height: 100.4, devicePixelRatio: 1.5 },
    });
    // 100.5 * 1.5 = 150.75 rounds to 151; 100.4 * 1.5 = 150.6 rounds to 151.
    expect(camera.drawingBufferSize()).toEqual({ width: 151, height: 151 });
  });

  it('never rounds the drawing buffer down to zero', () => {
    const camera = new Camera2D({
      viewport: { width: 0.4, height: 0.2, devicePixelRatio: 1 },
    });
    expect(camera.drawingBufferSize()).toEqual({ width: 1, height: 1 });
  });
});

describe('Camera2D panByScreen', () => {
  it('moves a world point by the pan delta in CSS pixels, to within 1e-8 px', () => {
    // Measured worst case: 8.731e-10 CSS pixels, same cancellation as the
    // screen round trip and for the same reason.
    const random = mulberry32(SEED + 5);
    let worst = 0;
    for (let run = 0; run < 1000; run += 1) {
      const camera = randomCamera(random);
      const world = camera.screenToWorld(randomScreenPoint(random, camera.viewport));
      const before = camera.worldToScreen(world);
      const dx = (random() * 2 - 1) * 500;
      const dy = (random() * 2 - 1) * 500;
      camera.panByScreen(dx, dy);
      const after = camera.worldToScreen(world);
      worst = Math.max(worst, Math.abs(after.x - before.x - dx), Math.abs(after.y - before.y - dy));
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it('leaves the zoom alone', () => {
    const camera = new Camera2D({ zoom: 3 });
    camera.panByScreen(120, -40);
    expect(camera.zoom).toBe(3);
  });
});

describe('Camera2D zoomAtScreen', () => {
  it('keeps the world point under the anchor fixed, to within 1e-6 CSS px', () => {
    // Measured worst case: 4.397e-8 CSS pixels, over factors from 1e-2 to 1e2.
    // Looser than the round trips because the anchor survives two cancellations
    // rather than one: once into world space and once back out at the new zoom.
    // Still far below the smallest subdivision of a CSS pixel a pointer event
    // can express, which is the standard that matters for a zoom gesture.
    const random = mulberry32(SEED + 6);
    let worst = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const camera = randomCamera(random);
      const anchor = randomScreenPoint(random, camera.viewport);
      const world = camera.screenToWorld(anchor);
      const factor = 10 ** (random() * 4 - 2);
      camera.zoomAtScreen(anchor, factor);
      worst = Math.max(worst, maxAbsDiff(camera.worldToScreen(world), anchor));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('multiplies the zoom by the factor when no clamp is in the way', () => {
    const camera = new Camera2D({ zoom: 2 });
    camera.zoomAtScreen({ x: 10, y: 10 }, 1.5);
    expect(camera.zoom).toBeCloseTo(3, 12);
  });

  it('keeps the anchor fixed even when the zoom lands on a clamp boundary', () => {
    // The trap this test exists for: clamping the zoom AFTER deriving the new
    // centre leaves the centre correcting for a zoom the camera never adopted,
    // and the anchor drifts. Both boundaries, and a factor that overshoots each
    // by a wide margin.
    for (const factor of [1e6, 1e-6]) {
      const camera = new Camera2D({
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 4,
        center: { x: 12, y: -34 },
        viewport: { width: 800, height: 600, devicePixelRatio: 2 },
      });
      const anchor = { x: 137, y: 511 };
      const world = camera.screenToWorld(anchor);
      camera.zoomAtScreen(anchor, factor);
      expect(camera.zoom).toBe(factor > 1 ? 4 : 0.5);
      expect(maxAbsDiff(camera.worldToScreen(world), anchor)).toBeLessThan(1e-9);
    }
  });

  it('clamps the zoom to minZoom and maxZoom', () => {
    const camera = new Camera2D({ zoom: 1, minZoom: 0.25, maxZoom: 8 });
    camera.zoomAtScreen({ x: 0, y: 0 }, 1000);
    expect(camera.zoom).toBe(8);
    camera.zoomAtScreen({ x: 0, y: 0 }, 0.0001);
    expect(camera.zoom).toBe(0.25);
  });

  it('stays finite when the zoom times the factor overflows to Infinity', () => {
    // Both operands finite, the product not. Without the clamp the camera would
    // hold a non-finite zoom, and every coordinate downstream of it would be
    // NaN with nothing having thrown.
    const camera = new Camera2D({ zoom: 1e308 });
    camera.zoomAtScreen({ x: 10, y: 10 }, 1e10);
    expect(camera.zoom).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(camera.screenToWorld({ x: 0, y: 0 }).x)).toBe(true);
  });
});

describe('Camera2D setZoom', () => {
  it('clamps into the camera range rather than throwing, unlike the constructor', () => {
    const camera = new Camera2D({ zoom: 1, minZoom: 0.5, maxZoom: 4 });
    camera.setZoom(100);
    expect(camera.zoom).toBe(4);
    camera.setZoom(0.001);
    expect(camera.zoom).toBe(0.5);
    // The constructor is the strict one: the same value is rejected there.
    expect(() => new Camera2D({ zoom: 100, minZoom: 0.5, maxZoom: 4 })).toThrow(RangeError);
  });
});

describe('Camera2D resize semantics', () => {
  it('preserves the centre and the zoom, so the visible world grows with the canvas', () => {
    const camera = new Camera2D({
      zoom: 2,
      center: { x: 5, y: 6 },
      viewport: { width: 400, height: 200, devicePixelRatio: 1 },
    });
    const before = camera.visibleWorldBounds();
    camera.setViewport({ width: 800, height: 400, devicePixelRatio: 1 });
    const after = camera.visibleWorldBounds();

    expect(camera.zoom).toBe(2);
    expect(camera.center).toEqual({ x: 5, y: 6 });
    expect(after.maxX - after.minX).toBe((before.maxX - before.minX) * 2);
    expect(after.maxY - after.minY).toBe((before.maxY - before.minY) * 2);
  });
});

describe('Camera2D orthoFrustum', () => {
  it('is centre-relative, so it is symmetric about zero', () => {
    const camera = new Camera2D({
      zoom: 4,
      center: { x: 1000, y: -1000 },
      viewport: { width: 800, height: 400, devicePixelRatio: 1 },
    });
    expect(camera.orthoFrustum()).toEqual({ left: -100, right: 100, bottom: -50, top: 50 });
  });

  it('agrees with worldToScreen about where a real three.js camera puts a point', () => {
    // The seam a screenshot cannot check cheaply. `render()` hands the frustum
    // and the centre to a three.js `OrthographicCamera` and lets three build
    // the projection; every hit test in later M4 tasks goes through
    // `screenToWorld`. If the two disagree, clicks land next to the shape they
    // were aimed at and nothing in either path looks wrong on its own.
    //
    // The projection is RUN, not reproduced. An earlier version of this test
    // composed the orthographic algebra by hand and claimed it was what
    // `Matrix4.makeOrthographic` does, which made the claim an assertion about
    // three rather than a test of it. Three things only the real object can
    // catch: that `OrthographicCamera(left, right, top, bottom, near, far)` is
    // NOT the field order of `OrthoFrustum` (the renderer dodges it by
    // assigning each field by name, and this test dodges it the same way, on
    // purpose, because that is the code under test); that `updateProjectionMatrix`
    // divides by a live `camera.zoom` this package never sets; and any change
    // three makes under the `<1.0.0` peer ceiling. It needs no GPU: building a
    // matrix and multiplying a vector by it is arithmetic.
    const random = mulberry32(SEED + 7);
    const threeCamera = new OrthographicCamera(0, 0, 0, 0, CAMERA_NEAR, CAMERA_FAR);
    let worst = 0;
    let worstZ = 0;

    for (let run = 0; run < RUNS; run += 1) {
      const camera = randomCamera(random);
      const world = camera.screenToWorld(randomScreenPoint(random, camera.viewport));
      const { left, right, bottom, top } = camera.orthoFrustum();

      // Exactly what `WebGPUSceneRenderer` does per frame, by field name.
      threeCamera.left = left;
      threeCamera.right = right;
      threeCamera.bottom = bottom;
      threeCamera.top = top;
      threeCamera.position.set(camera.center.x, camera.center.y, CAMERA_Z);
      threeCamera.updateProjectionMatrix();
      threeCamera.updateMatrixWorld(true);

      const projected = new Vector3(world.x, world.y, 0).project(threeCamera);

      const screen = camera.worldToScreen(world);
      const ndcFromScreen = {
        x: (2 * screen.x) / camera.viewport.width - 1,
        y: 1 - (2 * screen.y) / camera.viewport.height,
      };

      worst = Math.max(worst, maxAbsDiff(projected, ndcFromScreen));
      worstZ = Math.max(worstZ, Math.abs(projected.z));
    }

    // Measured worst case: 6.661e-16, which is three ulps of an NDC coordinate.
    // The two paths are algebraically identical, so the only difference is the
    // order the same multiplications happen in; anything larger than this would
    // mean they are not the same formula any more. The bound asserted is 1e-9,
    // the bound the reviewer who ran three against this asked for, which is far
    // above the measurement and still six orders below anything visible.
    expect(worst).toBeLessThan(1e-9);

    // And, one line, an item off the package's untested list: the z = 0 plane
    // every 2D shape lives on projects strictly inside the near and far planes.
    // Measured: 0.8002, from a camera 100 units away in a range of 0.1 to 1000.
    // A quad outside that range is clipped and the frame is empty, which is a
    // failure that looks exactly like the renderer not working at all.
    expect(worstZ).toBeLessThan(1);
  });
});

describe('Camera2D validation', () => {
  it('rejects a zoom that is not a positive finite number', () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Camera2D({ zoom })).toThrow(RangeError);
    }
  });

  it('rejects a centre that is not finite', () => {
    expect(() => new Camera2D({ center: { x: Number.NaN, y: 0 } })).toThrow(RangeError);
    expect(() => new Camera2D({ center: { x: 0, y: Number.POSITIVE_INFINITY } })).toThrow(
      RangeError,
    );
  });

  it('rejects a viewport with a non-positive or non-finite width, height or DPR', () => {
    const good = { width: 100, height: 50, devicePixelRatio: 1 };
    const bad = [
      { ...good, width: 0 },
      { ...good, width: -1 },
      { ...good, width: Number.NaN },
      { ...good, height: 0 },
      { ...good, height: Number.POSITIVE_INFINITY },
      { ...good, devicePixelRatio: 0 },
      { ...good, devicePixelRatio: -2 },
      { ...good, devicePixelRatio: Number.NaN },
    ];
    for (const viewport of bad) {
      expect(() => new Camera2D({ viewport })).toThrow(RangeError);
      expect(() => new Camera2D().setViewport(viewport)).toThrow(RangeError);
    }
  });

  it('rejects a zoom range that is empty or does not contain the zoom', () => {
    // Matched on the MESSAGE, not just the class, and that is load bearing. An
    // empty range contains no zoom at all, so the in-range check below would
    // throw a `RangeError` for `{ minZoom: 4, maxZoom: 2 }` even with the
    // ordering check deleted, and a bare `toThrow(RangeError)` here passes for
    // the wrong reason. Found by mutating the ordering check away and watching
    // the suite stay green.
    expect(() => new Camera2D({ minZoom: 4, maxZoom: 2 })).toThrow(
      /minZoom has to be at most maxZoom/,
    );
    expect(() => new Camera2D({ zoom: 10, minZoom: 0.5, maxZoom: 4 })).toThrow(RangeError);
    expect(() => new Camera2D({ zoom: 0.1, minZoom: 0.5, maxZoom: 4 })).toThrow(RangeError);
    expect(() => new Camera2D({ minZoom: 0 })).toThrow(RangeError);
    expect(() => new Camera2D({ maxZoom: Number.NaN })).toThrow(RangeError);
  });

  it('rejects a pan by a non-finite number of pixels', () => {
    expect(() => new Camera2D().panByScreen(Number.NaN, 0)).toThrow(RangeError);
    expect(() => new Camera2D().panByScreen(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a zoom factor or an anchor that is not usable', () => {
    expect(() => new Camera2D().zoomAtScreen({ x: 0, y: 0 }, 0)).toThrow(RangeError);
    expect(() => new Camera2D().zoomAtScreen({ x: 0, y: 0 }, -2)).toThrow(RangeError);
    expect(() => new Camera2D().zoomAtScreen({ x: 0, y: 0 }, Number.NaN)).toThrow(RangeError);
    expect(() => new Camera2D().zoomAtScreen({ x: Number.NaN, y: 0 }, 2)).toThrow(RangeError);
    expect(() => new Camera2D().zoomAtScreen({ x: 0, y: Number.NaN }, 2)).toThrow(RangeError);
  });

  it('rejects a centre or a zoom set after construction', () => {
    const camera = new Camera2D();
    expect(() => camera.setCenter({ x: Number.NaN, y: 0 })).toThrow(RangeError);
    expect(() => camera.setZoom(0)).toThrow(RangeError);
  });

  it('names the field it rejected in the message', () => {
    expect(() => new Camera2D({ zoom: -1 })).toThrow(/zoom/);
    expect(() => new Camera2D({ viewport: { width: 0, height: 1, devicePixelRatio: 1 } })).toThrow(
      /width/,
    );
    expect(() => new Camera2D({ center: { x: 0, y: Number.NaN } })).toThrow(/center\.y/);
  });
});

describe('Camera2D defaults', () => {
  it('starts at the world origin, zoom 1, and the HTML default canvas size', () => {
    const camera = new Camera2D();
    expect(camera.center).toEqual({ x: 0, y: 0 });
    expect(camera.zoom).toBe(1);
    expect(camera.viewport).toEqual({ width: 300, height: 150, devicePixelRatio: 1 });
  });

  it('leaves the zoom effectively unbounded when no range is given', () => {
    const camera = new Camera2D({ zoom: 1e-9 });
    expect(camera.zoom).toBe(1e-9);
    camera.setZoom(1e9);
    expect(camera.zoom).toBe(1e9);
  });
});
