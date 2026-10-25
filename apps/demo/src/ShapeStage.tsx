import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Camera2D, createRenderer } from '@dagr/render';
import type { Renderer, ShapeInstance, Vec2, ViewportSize, WorldBounds } from '@dagr/render';
import {
  DETAIL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  OVERVIEW_ZOOM,
  canvasPoint,
  wheelZoomFactor,
} from './camera-input.js';
import { DETAIL_CENTER, OVERVIEW_CENTER, SCENE_SHAPES } from './scene.js';

/**
 * M4.2's crispness reference: one scene, two cameras, three orders of magnitude
 * apart.
 *
 * The requirement is "the same shape at 0.1x and 100x", and the point of
 * putting them side by side rather than behind a zoom control is that the
 * comparison ends up in front of the reader instead of in their memory. Both
 * panes get the same `SCENE_SHAPES` through the same `setShapes` call and
 * differ only in the camera they were built with, so anything that differs
 * between the two frames is the renderer's doing. `scene.ts` carries the
 * arithmetic behind every world-unit number and explains what each pane is for.
 *
 * There is no test file for this component, and that is the same decision
 * `@dagr/render` documents for its own renderer rather than a gap. Everything
 * here needs a GPU adapter, a laid-out canvas and live input events; a jsdom
 * suite could only assert that a mock was called, which would pass just as
 * happily if the shapes never appeared. The arithmetic that CAN be checked was
 * moved out: the input math to `camera-input.ts` and the scene to `scene.ts`,
 * both tested, and what is left is wiring, verified by the committed
 * screenshot.
 *
 * The one thing worth reading closely is the lifecycle in {@link ShapePane}.
 *
 * This file used to be `FirstLight.tsx`, which is what M4.1 needed it to be: it
 * drew nothing, because the renderer drew one hard-coded quad and the demo only
 * had to put a camera in front of it. `createRenderer` now starts empty, so a
 * demo that never calls `setShapes` is a blank canvas, and the component that
 * chooses the shapes is not a first light any more.
 */

/**
 * The camera state the overlay shows. A snapshot rather than the camera itself:
 * {@link Camera2D} is a mutable object with no change notification, so React
 * would never see a pan, and copying the numbers out after each interaction is
 * what makes the overlay follow the gesture.
 */
interface CameraReadout {
  readonly zoom: number;
  readonly center: Vec2;
  readonly world: WorldBounds;
  readonly viewport: ViewportSize;
}

/**
 * The canvas's size in CSS pixels and the current device pixel ratio, or `null`
 * for a canvas that has no layout yet.
 *
 * `null` rather than a substituted size, because {@link Camera2D} rejects a
 * zero dimension and it is right to: a zero-sized canvas is not a viewport with
 * a neutral default, it is a canvas that is not ready to be measured. Every
 * caller here treats `null` as "wait for the next observation".
 */
function measureViewport(canvas: HTMLCanvasElement): ViewportSize | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/** The message to show a user when `createRenderer` rejects. */
function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * The two panes and the prose that says what to look at in each.
 *
 * The labels are not decoration. A screenshot of two canvases is two pictures
 * of coloured shapes unless it says which zoom is which and what the reader is
 * supposed to be checking, and this whole demo exists to be looked at rather
 * than to be run.
 */
export function ShapeStage(): JSX.Element {
  return (
    <section className="crispness">
      <h2 className="crispness__title">one distance field, two zooms</h2>
      <p className="crispness__lead">
        Both panes draw the same four shapes through the same <code>setShapes</code> call and differ
        only in their camera. Fill, outline and glow come off one signed distance field per shape,
        and the antialiasing band is derived per fragment from the screen-space derivative of that
        same field. That is why the edge is a pixel soft in both panes instead of in whichever one
        it was tuned for. Each pane has its own camera: drag to pan, scroll to zoom.
      </p>
      <div className="crispness__panes">
        <ShapePane
          shapes={SCENE_SHAPES}
          zoom={OVERVIEW_ZOOM}
          center={OVERVIEW_CENTER}
          zoomLabel="0.1x"
          subject="the whole scene"
          note="One world unit is 0.1 CSS pixels here, so the amber chip's 700 units come out 70
            pixels wide and the circle 76 across. This is the end where aliasing shows first: at a
            few dozen pixels a curve either steps or it does not, and no amount of scene-level
            multisampling makes a cheap edge test look like this."
        />
        <ShapePane
          shapes={SCENE_SHAPES}
          zoom={DETAIL_ZOOM}
          center={DETAIL_CENTER}
          zoomLabel="100x"
          subject="the same chip's top-right corner"
          note="One world unit is 100 CSS pixels, a thousand times the pane on the left. The pale
            band is the same 2-unit outline that measured 0.2 pixels there and measures 200 here:
            still an even width, still a pixel soft along both of its edges, and the arc carrying it
            is still an arc rather than a run of facets."
        />
      </div>
    </section>
  );
}

/** One canvas, one camera, and the batch both panes share. */
interface PaneProps {
  /** The batch to draw. Both panes are given the same one, unchanged. */
  readonly shapes: readonly ShapeInstance[];

  /** CSS pixels per world unit this pane starts at. */
  readonly zoom: number;

  /** The world point this pane starts looking at. */
  readonly center: Vec2;

  /** The zoom, for a reader: the number the whole comparison turns on. */
  readonly zoomLabel: string;

  /** What this pane is pointed at, in words. */
  readonly subject: string;

  /** What to look for in this pane, and why it is worth looking. */
  readonly note: string;
}

function ShapePane({ shapes, zoom, center, zoomLabel, subject, note }: PaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<CameraReadout | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Serialises renderer lifetimes across effect runs, and it is the reason this
   * component works in development at all.
   *
   * React 19's StrictMode mounts, unmounts and remounts in a single tick, so
   * the sequence is: effect body, cleanup, effect body, with no await point
   * between them. `createRenderer` is asynchronous (it waits on a GPU adapter),
   * so at the moment the second effect body runs, the first renderer is still a
   * pending promise. Constructing a second `WebGPURenderer` on the same canvas
   * then gives both of them the SAME `GPUCanvasContext`, because a canvas only
   * ever has one, and whichever promise settles second wins a canvas the other
   * is about to unconfigure. The symptom is a blank canvas that a page reload
   * fixes, which is the worst kind of bug to chase.
   *
   * So the second run waits for the first to finish tearing down. A ref rather
   * than a module constant because the chain belongs to this canvas, not to the
   * program, which is what makes two panes on one page safe: they have
   * independent chains and never wait on each other.
   *
   * **The `signal` passed to `createRenderer` below does not replace this, and
   * could not.** That signal abandons ONE renderer's construction, which is the
   * callee's problem and is now the callee's job. This orders TWO renderers
   * against each other, which only a caller can do, because only a caller knows
   * that the two StrictMode mounts are the same canvas. Delete it as
   * redundant-looking ceremony and the bug above comes straight back, signal or
   * no signal.
   */
  const teardownRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    // The OTHER half of the StrictMode problem: cleanup can run while
    // `createRenderer` is still in flight. `teardownRef` orders the mounts; this
    // is what lets an abandoned one let go, and it replaces a hand-rolled
    // `cancelled` flag now that `createRenderer` takes a signal.
    const abort = new AbortController();
    let renderer: Renderer | null = null;
    let panning = false;
    let lastPointer = { x: 0, y: 0 };

    /**
     * The frame a draw is already scheduled for, or 0 for none. Zero is a safe
     * sentinel because `requestAnimationFrame` returns a handle above it.
     */
    let frame = 0;

    // Built synchronously, before the renderer exists, and handed to
    // `createRenderer` rather than taken from it. That is what makes the input
    // handlers below safe to attach immediately: a drag during adapter
    // acquisition moves this camera, and the first frame is already in the
    // right place when it arrives.
    const camera = new Camera2D({ center, zoom, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });

    /**
     * Copies the camera's state into React, for {@link Overlay}.
     *
     * Still a `useState` update, and still on the frame path, which is a choice
     * with a shelf life rather than a permanent one. One `setReadout` is one
     * full reconciliation, which is affordable while frames only happen when a
     * user moves and stops being affordable once M4.6's springs run a
     * continuous loop: the overlay would then be the thing making the renderer
     * look slow when it is not. It stays for now because React state is what
     * keeps `Overlay`'s null and failure cases readable, and the coalescing
     * below already caps it at one per refresh. **M4.6 should move it off the
     * frame path**, to a ref plus `textContent` or to publishing every few
     * frames.
     */
    const publish = (): void => {
      setReadout({
        zoom: camera.zoom,
        center: camera.center,
        world: camera.visibleWorldBounds(),
        viewport: camera.viewport,
      });
    };

    /** Draws one frame and refreshes the overlay. Only ever called from a frame. */
    const draw = (): void => {
      renderer?.render();
      publish();
    };

    /**
     * Asks for a frame, and coalesces every request that arrives before it.
     *
     * **Render on demand, not on a free-running loop, but through one
     * `requestAnimationFrame` either way.** Nothing in this scene moves on its
     * own: it changes only when a pointer or a wheel changes the camera, so a
     * loop would wake the GPU sixty times a second to redraw a frame identical
     * to the last one, on a laptop battery, forever. That decision stands. What
     * it never settled is how many frames ONE gesture gets, and calling
     * `render` straight from a handler answered "as many as the platform sends
     * events", which is a different number.
     *
     * Measured on this demo: 60 wheel events dispatched in a single task cost
     * 38.1ms of main thread and painted ZERO frames, because a task has to
     * finish before the browser can paint at all. That is 60 GPU submits and 60
     * React reconciliations spent on one frame a user ever sees. Pointer moves
     * never showed it, since the browser already aligns `pointermove` to the
     * refresh rate; `wheel` is dispatched per input event, and a trackpad fling
     * outruns any display.
     *
     * So "every frame this component draws is one a user asked for" is still
     * exactly true, and is now also capped at one per refresh. Doing it in M4.1
     * rather than in M4.6 was the cheaper order: springs need a scheduler, and
     * this leaves them one to extend instead of a dozen call sites to unpick.
     */
    const requestDraw = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    /** Re-measures the canvas and pushes the new size through to the camera. */
    const applyViewport = (): void => {
      const viewport = measureViewport(canvas);
      if (viewport === null) return;
      // Onto the camera rather than through `Renderer.resize`, which is this
      // call plus the sync the next `render` does anyway. The camera is the
      // durable half of the pair and outlives a pending `createRenderer`, so
      // the size lands whether or not there is anything to draw with yet, and
      // the first frame is right the moment there is.
      camera.setViewport(viewport);
      requestDraw();
    };

    // Observe the CONTAINER, and measure the CANVAS. The container is the
    // element page layout sizes; the canvas is the element with the pixels, and
    // it is the one whose CSS box has to match the drawing buffer. They are the
    // same size today and this stays correct if a border or a padding ever
    // separates them.
    const observer = new ResizeObserver(() => {
      applyViewport();
    });
    observer.observe(container);

    /**
     * `devicePixelRatio` can change with no resize whatsoever: drag the window
     * to a display with a different scale factor and the CSS size is byte for
     * byte identical while every device pixel behind it changed size. A
     * `ResizeObserver` cannot see that, which is why re-reading the ratio in
     * `measureViewport` is necessary but not sufficient, and why this watcher
     * exists. `matchMedia` on a resolution query is the only event the platform
     * offers for it, and the query has to be rebuilt after every change because
     * it pins the ratio that has just stopped being current.
     */
    let ratioQuery: MediaQueryList | null = null;

    const onPixelRatioChange = (): void => {
      watchPixelRatio();
      applyViewport();
    };

    const watchPixelRatio = (): void => {
      ratioQuery?.removeEventListener('change', onPixelRatioChange);
      ratioQuery = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      ratioQuery.addEventListener('change', onPixelRatioChange);
    };

    watchPixelRatio();

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      panning = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      // Capture, so the drag survives the pointer leaving the canvas: without
      // it a fast pan that crosses the edge stops dead and the next move over
      // the canvas jumps, because the moves in between went to another element.
      // With two panes on one page it also stops a drag off the left pane from
      // being picked up by the right one.
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!panning) return;
      // `panByScreen` takes the pointer's OWN delta and moves the camera the
      // other way, so drag right and the content goes right. Checked on screen,
      // not inferred: see Camera2D.panByScreen for the sign, which is a minus
      // on x and a plus on y because screen y and world y point opposite ways.
      camera.panByScreen(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
      lastPointer = { x: event.clientX, y: event.clientY };
      requestDraw();
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!panning) return;
      panning = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    const onWheel = (event: WheelEvent): void => {
      // Stop the page scrolling under the gesture. This is why the listener is
      // added here rather than through React's `onWheel` prop: React attaches
      // wheel PASSIVELY at the root, and a passive listener's `preventDefault`
      // is ignored with a console warning, so the canvas would zoom and the
      // page would scroll at the same time.
      event.preventDefault();
      // The anchor has to be canvas-relative, since that is the space
      // `zoomAtScreen` reads. Measured per event because a scroll or a layout
      // change between events moves the rect.
      const anchor = canvasPoint(event, canvas.getBoundingClientRect());
      camera.zoomAtScreen(anchor, wheelZoomFactor(event));
      requestDraw();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const ready = teardownRef.current
      .then(async () => {
        // No flag to check before the await and no `created.dispose()` branch
        // after it: `createRenderer` checks the signal before it asks for an
        // adapter and again once it has one, giving the device back itself on
        // the second. Its guarantee is that a caller never has to dispose a
        // renderer it did not receive, so an abandoned mount here simply throws.
        renderer = await createRenderer({ canvas, camera, signal: abort.signal });
        // The scene, all of it, in one call. `setShapes` validates the whole
        // batch before it touches anything, so a bad shape is a `RangeError`
        // here and an empty canvas rather than half a scene: `test/scene.test.ts`
        // runs the same validator on the same batch so that never lands here
        // first.
        renderer.setShapes(shapes);
        setFailure(null);
        // Draws the first frame as a side effect, at whatever size the canvas
        // has now rather than the size it had when the effect started.
        applyViewport();
      })
      .catch((cause: unknown) => {
        // An abort is this component's own doing, so the reason is not news and
        // there is nobody left to show it to.
        if (abort.signal.aborted) return;
        setFailure(describeFailure(cause));
      });

    return () => {
      abort.abort();
      // Any frame already scheduled would draw through a renderer that is about
      // to be disposed, and publish into an unmounted component.
      cancelAnimationFrame(frame);
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onPixelRatioChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      // The next mount waits on this, so it has to cover both orders: a
      // renderer already installed is disposed here, and one still in flight is
      // disposed inside `ready` before this runs. Either way the promise
      // settles only once the canvas is free. `ready` never rejects, so the
      // chain cannot be poisoned for the next mount.
      teardownRef.current = ready.then(() => {
        renderer?.dispose();
        renderer = null;
      });
    };
    // Every one of these is a module constant threaded through props, so the
    // list is stable and the effect runs once per mount. They are listed rather
    // than omitted because the day one of them becomes state, a renderer built
    // against the old value is exactly the bug this file already has one
    // paragraph about.
  }, [shapes, zoom, center]);

  return (
    <figure className="pane">
      <figcaption className="pane__caption">
        <span className="pane__zoom">{zoomLabel}</span>
        <span className="pane__subject">{subject}</span>
      </figcaption>
      <div className="stage" ref={containerRef}>
        <canvas className="stage__canvas" ref={canvasRef} />
        {failure === null ? (
          <Overlay readout={readout} />
        ) : (
          <div className="stage__failure" role="alert">
            <p className="stage__failure-title">No renderer</p>
            <p className="stage__failure-message">{failure}</p>
            <p className="stage__failure-hint">
              <code>@dagr/render</code> needs WebGPU, or WebGL2 for three.js to fall back to. A
              blank canvas would have told you nothing, so here is what the adapter said.
            </p>
          </div>
        )}
      </div>
      <p className="pane__note">{note}</p>
    </figure>
  );
}

/** Two decimals, or a compact exponent once a number stops fitting. */
function fixed(value: number, digits: number): string {
  return Math.abs(value) >= 1e6 ? value.toExponential(2) : value.toFixed(digits);
}

/**
 * The live camera state, over the canvas.
 *
 * This exists to make the screenshot mean something. Two panes of amber on near
 * black prove that two frames were drawn; only the numbers say that one of them
 * is at 0.1 CSS pixels per world unit and the other at 100, which is the entire
 * claim the picture is making. They also move when you drag, which is what
 * proves the camera behind them is real.
 */
function Overlay({ readout }: { readout: CameraReadout | null }): JSX.Element {
  if (readout === null) {
    return (
      <div className="stage__readout">
        <p className="stage__readout-row">starting renderer</p>
      </div>
    );
  }

  const { zoom, center, world, viewport } = readout;
  return (
    <div className="stage__readout">
      <p className="stage__readout-row">
        <span className="stage__readout-key">zoom</span>
        {fixed(zoom, 3)} px/unit
      </p>
      <p className="stage__readout-row">
        <span className="stage__readout-key">centre</span>
        {fixed(center.x, 1)}, {fixed(center.y, 1)}
      </p>
      <p className="stage__readout-row">
        <span className="stage__readout-key">world x</span>
        {fixed(world.minX, 1)} to {fixed(world.maxX, 1)}
      </p>
      <p className="stage__readout-row">
        <span className="stage__readout-key">world y</span>
        {fixed(world.minY, 1)} to {fixed(world.maxY, 1)}
      </p>
      <p className="stage__readout-row">
        <span className="stage__readout-key">canvas</span>
        {Math.round(viewport.width)} x {Math.round(viewport.height)} css at{' '}
        {fixed(viewport.devicePixelRatio, 2)}x
      </p>
      <p className="stage__readout-hint">drag to pan, scroll to zoom</p>
    </div>
  );
}
