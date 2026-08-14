import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Camera2D, createHtmlOverlay, createRenderer } from '@dagr/render';
import type { Renderer, Vec2, ViewportSize, WorldBounds } from '@dagr/render';
import {
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  canvasPoint,
  initialZoomFromHash,
  wheelZoomFactor,
} from './camera-input.js';
import { LABEL_MIN_SCREEN_WIDTH, LADDER_SHAPES } from './ladder.js';
import type { LadderShape } from './ladder.js';

/**
 * `@dagr/render` on a canvas, with pan and zoom wired to a real
 * {@link Camera2D}.
 *
 * The scene is M4.2's crispness ladder: rounded rects and circles spanning two
 * orders of magnitude in world units, whose fill, outline and glow all come out
 * of one signed distance field. What this component owes it is a camera that can
 * reach both ends of that range, so a reader can watch a single edge stay crisp
 * from 0.1x to 100x, and a way to arrive at a named zoom without a gesture (see
 * {@link initialZoomFromHash}) so the committed screenshots are reproducible.
 *
 * M4.11 added a second thing over the same camera: an HTML overlay, from
 * `@dagr/render`, labelling each ladder shape once it is at least
 * {@link LABEL_MIN_SCREEN_WIDTH} CSS pixels wide. It is the demo's first text,
 * and it arrives without a glyph pipeline: the GPU draws the shapes and the DOM
 * draws the tens of readable things, with the camera keeping them registered.
 *
 * There is no test file for this component, and that is the same decision
 * `@dagr/render` documents for its own renderer rather than a gap. Everything
 * here needs a GPU adapter, a laid-out canvas and live input events; a jsdom
 * suite could only assert that a mock was called, which would pass just as
 * happily if nothing were ever drawn. The arithmetic and the hash parsing that
 * CAN be checked live in `camera-input.ts`, the overlay's own arithmetic and
 * wiring are tested in `@dagr/render`, the ladder geometry copied into
 * `ladder.ts` is checked in `test/ladder.test.ts`, and what is left is wiring,
 * verified by the committed screenshots.
 *
 * The name is M4.1's and outlives its accuracy on purpose: M4.4 replaces this
 * scene with real layout, and renaming a file twice costs more review than it
 * saves.
 *
 * The one thing worth reading closely is the lifecycle in the effect below.
 */

/**
 * The camera state the overlay shows. A snapshot rather than the camera itself:
 * {@link Camera2D} is a mutable object with no change notification, so React
 * would never see a pan, and copying the three numbers out after each
 * interaction is what makes the overlay follow the gesture.
 */
interface CameraReadout {
  readonly zoom: number;
  readonly center: Vec2;
  readonly world: WorldBounds;
  readonly viewport: ViewportSize;
  /** How many overlay elements the last sync left attached. */
  readonly labels: number;
}

/**
 * One label for one ladder shape: the element the overlay asks for when the
 * shape crosses {@link LABEL_MIN_SCREEN_WIDTH} on screen.
 *
 * The OUTER element is what the overlay positions and sizes, so it is the
 * shape's world box and it scales with the zoom. The INNER element carries the
 * text and counter-scales through `--dagr-overlay-inv-zoom`, which the overlay
 * publishes on its layer each sync. That split is the answer to a label wanting
 * two things at once: to be GATED by how big its node is on screen, which needs
 * a world box, and to be READ at a constant size, which a box cannot do. The
 * stylesheet does the second half, so nothing here reads the camera.
 */
function createLabel(shape: LadderShape): HTMLElement {
  const box = document.createElement('div');
  box.className = 'stage__label';

  const text = document.createElement('div');
  text.className = 'stage__label-text';

  const name = document.createElement('span');
  name.className = 'stage__label-name';
  name.textContent = shape.label;

  const detail = document.createElement('span');
  detail.className = 'stage__label-detail';
  detail.textContent = shape.detail;

  text.append(name, detail);
  box.appendChild(text);
  return box;
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

export function FirstLight(): JSX.Element {
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
   * program; two `FirstLight` components would have independent chains.
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
    //
    // The hash is read ONCE, here, and there is deliberately no `hashchange`
    // listener: a live binding would fight the wheel. `#zoom=` goes stale the
    // instant a user zooms, and a listener re-applying it would yank the camera
    // back out from under the gesture. So the hash is an entry point, not a
    // binding, and it is spelled that way in the overlay's hint.
    const camera = new Camera2D({
      zoom: initialZoomFromHash(window.location.hash, INITIAL_ZOOM),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });

    /**
     * The HTML overlay, over the same camera.
     *
     * Built here rather than after `createRenderer` resolves, and disposed in
     * the cleanup below rather than in the teardown chain, because it needs no
     * GPU: it is two divs and a camera. That independence is worth noticing,
     * since it means labels are on screen and following a drag while the
     * adapter is still being acquired, and they survive a renderer that never
     * arrives at all.
     *
     * The parent is the CONTAINER and not the canvas. A canvas cannot have
     * children, and the container is the element whose box the canvas fills and
     * which already clips (`overflow: hidden` in `styles.css`).
     */
    const overlay = createHtmlOverlay({ parent: container, camera });
    for (const shape of LADDER_SHAPES) {
      overlay.add({
        placement: {
          kind: 'box',
          bounds: shape.bounds,
          minScreenWidth: LABEL_MIN_SCREEN_WIDTH,
        },
        create: () => createLabel(shape),
      });
    }

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
        labels: overlay.activeCount,
      });
    };

    /**
     * Draws one frame and refreshes the readout. Only ever called from a frame.
     *
     * `overlay.sync()` goes HERE, on the same callback as `render()`, and not
     * on a `requestAnimationFrame` of its own. Two loops would be two frame
     * budgets, and worse, a frame of skew: the labels would trail the shapes
     * during a pan, which reads as the text swimming over the graph. Syncing
     * before the readout is what makes `activeCount` describe the frame the
     * user is looking at rather than the one before it.
     */
    const draw = (): void => {
      renderer?.render();
      overlay.sync();
      publish();
    };

    /**
     * Asks for a frame, and coalesces every request that arrives before it.
     *
     * **Render on demand, not on a free-running loop, but through one
     * `requestAnimationFrame` either way.** Nothing in M4.1 moves on its own:
     * the scene changes only when a pointer or a wheel changes the camera, so a
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
     * exactly true, and is now also capped at one per refresh. Doing it here
     * rather than in M4.6 is the cheaper order: springs need a scheduler, and
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
      // Straight away rather than in the teardown chain below: the overlay owns
      // no GPU resource, so nothing has to be awaited before its two divs can
      // go. Leaving it would show a second StrictMode mount two layers of
      // labels, one of them belonging to a camera nobody is driving any more.
      overlay.dispose();
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
  }, []);

  return (
    <div className="stage" ref={containerRef}>
      <canvas className="stage__canvas" ref={canvasRef} />
      {failure === null ? (
        <Overlay readout={readout} />
      ) : (
        <div className="stage__failure" role="alert">
          <p className="stage__failure-title">No renderer</p>
          <p className="stage__failure-message">{failure}</p>
          <p className="stage__failure-hint">
            <code>@dagr/render</code> needs WebGPU, or WebGL2 for three.js to fall back to. A blank
            canvas would have told you nothing, so here is what the adapter said.
          </p>
        </div>
      )}
    </div>
  );
}

/** Two decimals, or a compact exponent once a number stops fitting. */
function fixed(value: number, digits: number): string {
  return Math.abs(value) >= 1e6 ? value.toExponential(2) : value.toFixed(digits);
}

/**
 * The live camera state, over the canvas.
 *
 * This exists to make the screenshots mean something. Shapes on near black prove
 * a frame was drawn; only numbers that move when you drag prove the camera
 * behind them is real, that the world bounds it reports are the region you are
 * actually looking at, and, for the crispness reference, that the frame you are
 * looking at really is the 0.1x or 100x one and not a gesture that stopped
 * nearby. The zoom row is the caption of both screenshots.
 */
function Overlay({ readout }: { readout: CameraReadout | null }): JSX.Element {
  if (readout === null) {
    return (
      <div className="stage__readout">
        <p className="stage__readout-row">starting renderer</p>
      </div>
    );
  }

  const { zoom, center, world, viewport, labels } = readout;
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
      {/*
        The overlay is invisible in a screenshot when it is doing its job and
        showing nothing, so it says how many elements it has. It is also the
        only place a cap that has been hit is visible: a picture missing labels
        looks the same as a picture that never had any.
      */}
      <p className="stage__readout-row">
        <span className="stage__readout-key">labels</span>
        {labels} of {LADDER_SHAPES.length} in DOM
      </p>
      {/*
        The limits and the example are interpolated from the constants rather
        than typed out, because a hint that disagrees with the camera is worse
        than no hint: this is the only place a user is told what `#zoom=` does,
        and the range moved once already.
      */}
      <p className="stage__readout-hint">
        drag to pan, scroll to zoom ({MIN_ZOOM} to {MAX_ZOOM}), or load #zoom=
        {MAX_ZOOM}
      </p>
    </div>
  );
}
