import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Camera2D,
  advanceDashFlow,
  createHtmlOverlay,
  createRenderer,
  createRichNodes,
  ribbonWidthAt,
} from '@dagr/render';
import type { Renderer, Vec2, ViewportSize, WorldBounds } from '@dagr/render';
import {
  FIT_PADDING,
  INITIAL_ZOOM,
  canvasPoint,
  initialZoomFromHash,
  keyCommand,
  nodeIdFromHash,
  wheelZoomFactor,
  zoomLimits,
} from './camera-input.js';
import type { CampaignScene } from './campaign-scene.js';
import type { CampaignEdges } from './campaign-edges.js';
import {
  CROSS_TILE_GROUP,
  EDGE_GROUPS,
  OVERLAY_GROUP,
  ROUTED_GROUP,
  overlayFade,
} from './campaign-edges.js';
import { nodeAtPoint } from './hover.js';
import { nodeColor } from './campaign-style.js';
import { createCampaignTiers } from './campaign-tiers.js';
import type { CampaignNode } from '@dagr/campaign';

/**
 * `@dagr/render` on a canvas, with pan and zoom wired to a real
 * {@link Camera2D}.
 *
 * **The scene is the campaign, as of M4.4.** Three thousand nodes of a mock D&D
 * campaign, cut into about a hundred tiles, laid out one tile at a time by
 * `@dagr/layout` in a worker, shelf-packed into a roughly 16:9 canvas and drawn
 * instanced. `campaign-scene.ts` does all of that and hands back a list this
 * component passes straight to `Renderer.setNodes`.
 *
 * What was here before was M4.2's crispness ladder: six shapes that existed to
 * prove a shader claim. The module doc said the ladder died on the day a real
 * layout arrived, and this is that day. Its evidence survives as the committed
 * screenshots and in the M4.2 commit, which is what a placeholder should do.
 *
 * The overlay stays, and stays deliberately small. M4.11 and M4.12 shipped
 * `createHtmlOverlay` and `createRichNodes`, and this component consumes them
 * with ONE tier: a name over a node once the node is wide enough on screen to
 * carry it. The campaign's cards are P6, which owns the tier set and the card
 * content; what P4 owes it is the node bounds to bind to, which
 * {@link CampaignScene.nodeBounds} is.
 *
 * There is no test file for this component, and that is the same decision
 * `@dagr/render` documents for its own renderer rather than a gap. Everything
 * here needs a GPU adapter, a laid-out canvas, a worker and live input events;
 * a jsdom suite could only assert that a mock was called, which would pass just
 * as happily if nothing were ever drawn. The arithmetic that CAN be checked
 * lives in `camera-input.ts`, `tiles.ts` and `campaign-style.ts`, the overlay's
 * own wiring is tested in `@dagr/render`, and what is left is wiring, verified
 * by a committed screenshot.
 *
 * The name is M4.1's and outlives its accuracy on purpose: renaming a file
 * costs more review than it saves, and the history is where a name is explained.
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
  /** How many overlay elements the last sync left attached, across all tiers. */
  readonly labels: number;
  /** The derived zoom range, which moves with the viewport: see the hint. */
  readonly minZoom: number;
  readonly maxZoom: number;
}

/**
 * The campaign's tiers, from `campaign-tiers.ts`, which owns the card content,
 * the per-kind declared sizes and both gates.
 *
 * This module passes the palette in rather than the tier module importing it:
 * the instanced shapes and the card badges agree about what colour a scene is
 * because they call ONE function, `nodeColor`, and it takes the node because
 * `location` is one kind and four blues.
 *
 * P4's single name tier is gone rather than kept beside these. Its gate opened
 * at 24 with no upper bound, and `createRichNodes` throws a `RangeError` on
 * gates that overlap, so a card tier could not be added next to it: the tier
 * set is replaced, which is what P4's own comment said P6 would do.
 */
const CAMPAIGN_TIERS = createCampaignTiers({ nodeColor });

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

/**
 * How wide an edge would be if it scaled with the scene, as a half width in
 * world units.
 *
 * **This sets where the FADE begins, and nothing else.** Against the groups'
 * maxima of 1.5, 1.2 and 1.0 device pixels, a world half width of 1.5 saturates
 * at the ceiling from about 1 device pixel per world unit upward and only
 * engages the fade below 0.33, so across the campaign's zoom range the
 * proportional band is a narrow sliver in the middle. The maxima are the width
 * at every zoom a reader spends time at; this number is the one that moves the
 * fitted frame's ink, where the maxima do nothing at all.
 */
const EDGE_WORLD_HALF_WIDTH = 1.5;

/**
 * The longest a single frame may advance the dash, in seconds.
 *
 * `advanceDashFlow` deliberately does not clamp its own delta, saying the
 * opinion belongs to the caller, and this is the opinion: a demo that renders
 * on demand measures the gap between DRAWN frames, and after an idle that gap
 * is the idle. Uncapped, the first frame of a gesture would land an arbitrary
 * phase, which is the same defect as reading the absolute clock.
 */
const MAX_DASH_STEP_SECONDS = 1 / 30;

/** The thinnest a ribbon is drawn before the fade takes over instead. */
const MIN_EDGE_HALF_WIDTH_PIXELS = 0.5;

/**
 * The band, in CSS pixels per world unit, over which the overlay kinds arrive.
 *
 * CSS and not device pixels, unlike every width in this file: whether a KIND of
 * edge is worth showing is a fact about apparent scale, so the same campaign at
 * the same zoom shows the same graph on every display. Keyed on device pixels
 * this band would halve on a retina screen, and measured at CSS zoom 2 the
 * overlay alpha came out 0.20 at dpr 1 against 1.00 at dpr 2.
 *
 * The demo's derived range is about 0.05 to 19.2 CSS pixels per world unit at
 * 1003x597, both ends moving with the viewport, so this band sits well above
 * the overview and well below a card: the dense, cyclic kinds are absent while
 * a reader is looking at the shape of the campaign, and fully there once they
 * are asking about one node's neighbourhood.
 */
const OVERLAY_FADE_START = 1.5;
const OVERLAY_FADE_FULL = 4;

/**
 * Hands one build of the campaign's edges to a renderer.
 *
 * One function and two call sites, because the two are unavoidable and
 * duplicating the three calls between them is how they drift: `createRenderer`
 * is asynchronous, so edges that arrived before it resolved have to be pushed
 * when it does, and edges that arrive afterwards have to be pushed by the
 * effect watching them.
 */
function applyEdges(renderer: Renderer, edges: CampaignEdges | null): void {
  if (edges === null) return;
  renderer.setEdges(ROUTED_GROUP, edges.routed);
  renderer.setEdges(CROSS_TILE_GROUP, edges.crossTile);
  renderer.setEdges(OVERLAY_GROUP, edges.overlay);
}

/** The message to show a user when `createRenderer` rejects. */
function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function FirstLight({
  scene,
  edges,
}: {
  scene: CampaignScene | null;
  edges: CampaignEdges | null;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<CameraReadout | null>(null);
  // The renderer and the frame request, reachable from the edges effect below.
  // `createRenderer` is asynchronous, so the effect that builds it cannot also
  // be the one that watches `edges`: the first `edges` may arrive before the
  // renderer and the tenth after it.
  const rendererRef = useRef<Renderer | null>(null);
  const requestDrawRef = useRef<() => void>(() => undefined);
  // Read by the construction effect, which must not re-run when the edges
  // change: rebuilding a renderer to recolour a line would throw away the GPU
  // resources and the camera's place.
  const edgesRef = useRef<CampaignEdges | null>(edges);
  edgesRef.current = edges;
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
    // The scene arrives asynchronously, because a hundred layout runs do: the
    // effect is a no-op until it does, and re-runs when it lands. Building a
    // renderer over an empty scene first and calling `setNodes` after would
    // draw one frame of nothing and size the instance buffers for it.
    if (canvas === null || container === null || scene === null) return;

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
    //
    // No limits at construction: the demo's range is derived from the scene
    // and the viewport, and the viewport has not been measured yet. The first
    // `applyViewport` below binds the real range and clamps whatever the hash
    // asked for into it, so an out-of-range `#zoom=` is corrected before
    // anything beyond one frame can be drawn at it.
    //
    // `NaN` as the fallback rather than `INITIAL_ZOOM`, because this component
    // has to know whether the hash SPOKE, not only what it said.
    // `initialZoomFromHash` returns its fallback as given, so a non-finite one
    // is a usable "absent" signal, and comparing against `INITIAL_ZOOM` instead
    // would read `#zoom=1` as silence.
    const hashZoom = initialZoomFromHash(window.location.hash, Number.NaN);
    const camera = new Camera2D({
      zoom: Number.isFinite(hashZoom) ? hashZoom : INITIAL_ZOOM,
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

    // Sizes are DECLARED rather than measured, which is the default the overlay
    // design argues for: a node's box is the box layout gave it, so it is known
    // by construction. `measureHtmlSizes` is for the other case, where a node's
    // size is a fact about its text. Three thousand offscreen mounts at startup
    // would buy nothing here and would cost a layout flush each.
    const richNodes = createRichNodes<CampaignNode>({ overlay, tiers: CAMPAIGN_TIERS });
    richNodes.setNodes(
      // The record itself is the tier's data, which is what `cardRows` takes.
      // No id-keyed lookup: `campaign-scene.ts` carries the record on the
      // overlay node for exactly this, in the same pass that fixed its box.
      scene.overlayNodes.map((overlay) => ({
        id: overlay.id,
        bounds: overlay.bounds,
        data: overlay.node,
      })),
    );

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
        minZoom: camera.minZoom,
        maxZoom: camera.maxZoom,
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
    /**
     * The three edge groups' per-frame values: the width the zoom implies, the
     * alpha that keeps the far view honest, and where the dash has flowed to.
     *
     * **The width and the fade are the debt M4.5's core recorded.** A ribbon is
     * a constant number of device pixels wide, which is right in the middle of
     * the range and wrong at both ends: at the fitted zoom the campaign has far
     * more centreline than viewport, and a constant width paints a mat of edge
     * ink over the structure it is supposed to reveal. `ribbonWidthAt` draws it
     * at the floor and fades it by the same ratio, so the coverage on screen is
     * the coverage the scene's own world width asks for.
     *
     * **The dash advances by the time between DRAWN frames**, which is the
     * only phase that behaves in a demo with no animation loop. Counting
     * frames would tie the flow speed to how much the user is moving the
     * camera; reading the absolute clock, which this did first, is worse: wall
     * time accrues while the scene sits idle and discharges into the first
     * frame of the next gesture, so at 18 px/s over a 14 px period any pause
     * over 0.8 seconds teleports every dashed ribbon by up to a full period
     * while the picture moves one pixel. Accumulating the delta instead means
     * the pattern drifts while you pan and holds where it was while you do
     * not, which is what this comment claimed before the code did it, and it
     * animates on its own the moment M4.6 brings a loop.
     */
    /** Where each dashed group's pattern has flowed to, wrapped into its period. */
    const flowPixels = new Map<string, number>();
    /** When the last frame was drawn, so the dash advances by drawn time only. */
    let lastDrawSeconds: number | null = null;

    const advanceFlow = (
      groupId: string,
      speed: number,
      elapsed: number,
      period: number,
    ): number => {
      const flow = advanceDashFlow(flowPixels.get(groupId) ?? 0, speed, elapsed, period);
      flowPixels.set(groupId, flow);
      return flow;
    };

    const styleEdges = (): void => {
      if (renderer === null) return;
      const pixelsPerWorldUnit = camera.zoom * camera.viewport.devicePixelRatio;
      const now = performance.now() / 1000;
      // The FIRST frame has no previous one to measure from, so it advances by
      // nothing rather than by however long the page took to load.
      // CAPPED, and the cap is the whole of what makes this hold still: the
      // gap since the last drawn frame IS the idle, so an uncapped delta lands
      // an arbitrary phase on a gesture's first frame exactly as reading the
      // absolute clock did. At 18 px/s over a 14 px period any pause over 0.8
      // seconds would wrap. A thirtieth of a second never binds at 60fps and
      // moves the pattern 0.6 px on the frame after an idle.
      const elapsed =
        lastDrawSeconds === null ? 0 : Math.min(now - lastDrawSeconds, MAX_DASH_STEP_SECONDS);
      lastDrawSeconds = now;
      for (const group of EDGE_GROUPS) {
        const width = ribbonWidthAt({
          worldHalfWidth: EDGE_WORLD_HALF_WIDTH,
          pixelsPerWorldUnit,
          minHalfWidthPixels: MIN_EDGE_HALF_WIDTH_PIXELS,
          maxHalfWidthPixels: group.style.halfWidthPixels,
        });
        // The band is keyed on the CSS zoom and not on device pixels, unlike
        // the width above it, and the split is deliberate: how crisp a line is
        // drawn is a fact about the display's pixels, while whether a KIND of
        // edge is worth showing is a fact about apparent scale. Keyed on
        // device pixels, the same campaign at the same zoom would show its
        // social graph on a retina laptop and hide it on an external monitor.
        const fade = group.id === OVERLAY_GROUP
          ? overlayFade(camera.zoom, OVERLAY_FADE_START, OVERLAY_FADE_FULL)
          : 1;
        renderer.setEdgeStyle(group.id, {
          halfWidthPixels: width.halfWidthPixels,
          alpha: width.alpha * fade,
          ...(group.style.dash === undefined
            ? {}
            : {
                dashFlowPixels: advanceFlow(
                  group.id,
                  group.style.dash.speedPixelsPerSecond,
                  elapsed,
                  group.style.dash.periodPixels,
                ),
              }),
        });
      }
    };

    const draw = (): void => {
      styleEdges();
      renderer?.render();
      overlay.sync();
      // AFTER the sync, because the sync is what attaches, detaches and
      // recycles elements, and a tier's `update` clears the highlight class
      // precisely so a pooled element cannot carry it to another node. Doing it
      // here rather than only on `pointermove` is also what keeps the answer
      // TRUE: the world moves under a still pointer on every zoom, pan and fit,
      // so hover has to be recomputed per frame, not per gesture.
      refreshHovered();
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
    /**
     * Where the canvas sits on the page, for turning a client point into a
     * world point without a layout flush per frame.
     *
     * Refreshed on RESIZE and on SCROLL, and the second one is not optional:
     * the rect is viewport-relative, a `ResizeObserver` never fires for a
     * scroll, and a page scrolled between two pointer moves leaves every hover
     * answer offset by the scroll delta, which at title tier is several nodes
     * over. `onWheel` reads the rect per event for the same reason.
     *
     * Declared HERE rather than beside the hover state that reads it, because
     * `applyViewport` runs synchronously further down this effect and a `let`
     * below that call would be in its temporal dead zone.
     */
    let canvasRect: DOMRect = canvas.getBoundingClientRect();

    const applyViewport = (): void => {
      const viewport = measureViewport(canvas);
      if (viewport === null) return;
      // The canvas's position on the page, cached for the hover recompute.
      // Reading it per frame would be a layout flush per frame, and the read
      // would land right after `overlay.sync()` has written a transform per
      // element, which is the worst moment to ask the browser to settle.
      canvasRect = canvas.getBoundingClientRect();
      // Onto the camera rather than through `Renderer.resize`, which is this
      // call plus the sync the next `render` does anyway. The camera is the
      // durable half of the pair and outlives a pending `createRenderer`, so
      // the size lands whether or not there is anything to draw with yet, and
      // the first frame is right the moment there is.
      camera.setViewport(viewport);
      // The zoom range follows the viewport, because both of its ends are
      // statements about the viewport: "the whole scene in frame with
      // padding" and "the smallest shape filling the short side". This is the
      // call that clamps an out-of-range `#zoom=` on the first measurement,
      // and on every resize after it the camera is carried along.
      const limits = zoomLimits(scene.bounds, scene.smallestNodeSize, viewport);
      camera.setZoomLimits(limits.minZoom, limits.maxZoom);
      requestDraw();
    };

    // Synchronously, before any listener attaches: the effect runs after the
    // canvas has layout, so the measurement works here, and it closes the
    // window in which the camera is unbounded. Without this, the first
    // ResizeObserver delivery is what binds the limits, and the platform runs
    // rAF callbacks BEFORE ResizeObserver observations in the same rendering
    // update, so a queued wheel event could draw, and worse, derive an
    // anchored centre from, an unclamped `#zoom=1e9` before the clamp landed.
    applyViewport();

    // The whole campaign in frame on load, which is the first thing a reader
    // should see: the shape of it, before any of the words. After
    // `applyViewport`, so the fit is against a measured viewport and lands
    // inside the range that measurement has just bound.
    //
    // **Unless the hash asked for a zoom**, and that exception is the whole
    // reason `#zoom=` survived P4. A fit that ran unconditionally would
    // override the hash on every load, which is not a smaller feature than it
    // sounds: the hash is how a committed screenshot is reproduced by opening a
    // link rather than by landing on a zoom with a trackpad, and it would have
    // gone on advertising itself in the readout while doing nothing.
    // `#node=` frames ONE node instead of the whole campaign, which is what
    // makes a link to "the 88-room finale" possible. An entry point, not a live
    // binding: read once here, never written back, exactly as `#zoom=` is, and
    // `camera-input.ts` carries the argument for that pattern.
    //
    // The two hash keys compose rather than compete. `#node=` decides WHERE,
    // through the node's own box; `#zoom=` still decides HOW CLOSE when it is
    // present, so `#node=dungeon-21&zoom=8` centres the finale at 8x. An id the
    // scene does not hold falls back to the whole campaign, the same frame a
    // reader would have got with no hash at all: a mangled link should show the
    // scene rather than an empty patch of world where nothing is.
    const hashNodeId = nodeIdFromHash(window.location.hash);
    const hashNodeBounds =
      hashNodeId === null ? undefined : scene.nodeBounds.get(hashNodeId);
    if (hashNodeBounds !== undefined) {
      camera.fitBounds(hashNodeBounds, FIT_PADDING);
      if (Number.isFinite(hashZoom)) camera.setZoom(hashZoom);
    } else if (!Number.isFinite(hashZoom)) {
      camera.fitBounds(scene.bounds, FIT_PADDING);
    }

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

    /**
     * Which node the pointer is over, and the element wearing the highlight.
     *
     * Held here rather than in React state: this changes on pointer moves, and
     * one `setState` per move would reconcile the whole component to add a
     * class. The overlay owns the elements, so the highlight is found by the id
     * the tiers write onto them and applied with a class, which costs one
     * lookup per CHANGE of hovered node rather than per move.
     */
    let hoveredId: string | null = null;
    let hoveredElement: HTMLElement | null = null;
    /**
     * The last place the pointer was, in client coordinates, or null if it has
     * never been over the canvas or has left it.
     *
     * Kept because hover is a question about where the pointer is in WORLD
     * space, and the world moves under a still pointer: a wheel zoom, a
     * keyboard pan, a fit. Recomputing only on `pointermove` leaves the
     * highlight on a node the pointer stopped being over, and the per-frame
     * re-apply then follows that wrong node faithfully, across the tier gate
     * and into its card.
     */
    let lastHoverPoint: { readonly clientX: number; readonly clientY: number } | null = null;

    /** Puts the class on whatever element currently answers for the hovered id. */
    const applyHovered = (): void => {
      const next =
        hoveredId === null
          ? null
          : container.querySelector<HTMLElement>(`[data-node-id="${hoveredId}"]`);
      if (next !== hoveredElement) hoveredElement?.classList.remove('is-hovered');
      hoveredElement = next;
      // Added unconditionally, even when the element is the one already held.
      // A tier's `update` clears this class on every bind, and an element that
      // is already attached is re-bound in place when its data changes, so an
      // early return here would leave the highlight cleared until the pointer
      // moved to a different node.
      hoveredElement?.classList.add('is-hovered');
    };

    const setHovered = (id: string | null): void => {
      if (id === hoveredId) {
        applyHovered();
        return;
      }
      hoveredId = id;
      applyHovered();
    };

    /**
     * Answers "what is under the pointer" from where the pointer last was.
     *
     * Called from the draw callback, so it is correct after ANY camera change
     * rather than only after a pointer move, and it costs the same linear scan
     * the move handler was already paying for.
     */
    const refreshHovered = (): void => {
      if (lastHoverPoint === null) {
        setHovered(null);
        return;
      }
      const point = camera.screenToWorld(canvasPoint(lastHoverPoint, canvasRect));
      setHovered(nodeAtPoint(point, scene.overlayNodes));
    };

    const onPointerMove = (event: PointerEvent): void => {
      // Recorded whether or not this is a drag, because the pointer's position
      // is what hover is a question about and the draw callback answers it from
      // here every frame. Hover during a drag is therefore correct rather than
      // suppressed: the world moves, the pointer does not, and the node under
      // it changes.
      lastHoverPoint = { clientX: event.clientX, clientY: event.clientY };
      if (!panning) {
        // Hover, from the same boxes the overlay is positioned from. No picking
        // pass and no readback: see `hover.ts` for why a box test is the right
        // answer here and the wrong one for a click target.
        refreshHovered();
        return;
      }
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

    /**
     * The keyboard, while the canvas has focus. Attached to the CANVAS, which
     * is what scopes it: `keydown` only fires here while the canvas is the
     * focused element (it is focusable via `tabIndex` in the JSX below), so an
     * unfocused canvas leaves every key, including the scrolling ones, to the
     * page. That is the whole feature: focus is the mode switch, and there is
     * no global listener to fight the rest of the page over arrows.
     *
     * `preventDefault` only for keys the map claims, so Tab still leaves and
     * unclaimed keys still scroll. Escape blurs, which is the way back out
     * that keyboard users are owed, and is deliberately not in `keyCommand`:
     * it is about focus, which is this component's business, not the camera's.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      // Ctrl, Meta and Alt chords belong to the browser: Ctrl+'+'/'-'/'0' is
      // accessibility page zoom and Alt+Arrow is history navigation, and a
      // focused canvas hijacking either would block features a user cannot
      // do without. Shift is not in this list because the key map binds it.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        canvas.blur();
        return;
      }
      const command = keyCommand(event.key, event.shiftKey);
      if (command === null) return;
      event.preventDefault();
      if (command.kind === 'zoom') {
        // Anchored at the viewport centre: a keyboard zoom has no cursor, and
        // the centre is the one point a reader can predict.
        camera.zoomAtScreen(
          { x: camera.viewport.width / 2, y: camera.viewport.height / 2 },
          command.factor,
        );
      } else if (command.kind === 'pan') {
        camera.panByScreen(command.dx, command.dy);
      } else {
        camera.fitBounds(scene.bounds, FIT_PADDING);
      }
      requestDraw();
    };

    // The pointer leaving the canvas has to clear the highlight: without it a
    // node stays lit while the reader is reading the page below, which reads as
    // a selection rather than as a hover.
    const onPointerLeave = (): void => {
      lastHoverPoint = null;
      setHovered(null);
    };

    // Capture, so a scrolling ANCESTOR is caught too: a scroll event from an
    // element between the canvas and the document does not bubble to the
    // window, and it moves the canvas just as a page scroll does. Passive,
    // because this only reads.
    const onScroll = (): void => {
      canvasRect = canvas.getBoundingClientRect();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);

    const ready = teardownRef.current
      .then(async () => {
        // No flag to check before the await and no `created.dispose()` branch
        // after it: `createRenderer` checks the signal before it asks for an
        // adapter and again once it has one, giving the device back itself on
        // the second. Its guarantee is that a caller never has to dispose a
        // renderer it did not receive, so an abandoned mount here simply throws.
        // The nodes go in through the OPTION rather than through a `setNodes`
        // after the await, so the instance buffers are allocated for exactly
        // this many nodes and the first frame costs no reallocation. At three
        // thousand nodes that is one allocation instead of eight.
        renderer = await createRenderer({
          canvas,
          camera,
          signal: abort.signal,
          nodes: scene.nodes,
          edgeGroups: EDGE_GROUPS,
        });
        rendererRef.current = renderer;
        requestDrawRef.current = requestDraw;
        applyEdges(renderer, edgesRef.current);
        setFailure(null);
        // Draws the first frame as a side effect, at whatever size the canvas
        // has now rather than the size it had when the effect started.
        applyViewport();
        // A signal that a REAL frame has been drawn, for anything watching from
        // outside: `apps/demo/scripts/capture.mjs` waits on it before opening
        // the shutter. The readout is not that signal, and the difference is
        // what put a black canvas in a committed screenshot: `publish` runs from
        // the first `draw`, which happens while `renderer` is still null and
        // `renderer?.render()` is a no-op, so a readout full of live numbers can
        // sit over a canvas nothing has drawn to yet. This attribute is set
        // after `createRenderer` has resolved AND `applyViewport` has drawn
        // through it.
        container.dataset.rendererDrawn = 'true';
      })
      .catch((cause: unknown) => {
        // An abort is this component's own doing, so the reason is not news and
        // there is nobody left to show it to.
        if (abort.signal.aborted) return;
        setFailure(describeFailure(cause));
      });

    return () => {
      abort.abort();
      delete container.dataset.rendererDrawn;
      // Any frame already scheduled would draw through a renderer that is about
      // to be disposed, and publish into an unmounted component.
      cancelAnimationFrame(frame);
      // Straight away rather than in the teardown chain below: the overlay owns
      // no GPU resource, so nothing has to be awaited before its two divs can
      // go. Leaving it would show a second StrictMode mount two layers of
      // labels, one of them belonging to a camera nobody is driving any more.
      richNodes.dispose();
      overlay.dispose();
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onPixelRatioChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, { capture: true });
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointermove', onPointerMove);
      setHovered(null);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      // The next mount waits on this, so it has to cover both orders: a
      // renderer already installed is disposed here, and one still in flight is
      // disposed inside `ready` before this runs. Either way the promise
      // settles only once the canvas is free. `ready` never rejects, so the
      // chain cannot be poisoned for the next mount.
      teardownRef.current = ready.then(() => {
        renderer?.dispose();
        renderer = null;
        rendererRef.current = null;
        requestDrawRef.current = () => undefined;
      });
    };
  }, [scene]);

  /**
   * Pushes new edges to a renderer that already exists.
   *
   * Separate from the effect above and keyed on `edges` alone, because the two
   * change independently: P7's hover highlight rebuilds `edges` with the SAME
   * scene by swapping the colour function, and an effect keyed on `[scene]`
   * would never see it. Nothing would fail; the canvas would simply keep the
   * old colours, which is the kind of staleness that survives a review.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    applyEdges(renderer, edges);
    requestDrawRef.current();
  }, [edges]);

  return (
    <div className="stage" ref={containerRef}>
      {/*
        Focusable, because focus is the keyboard's mode switch: focused, the
        scrolling keys zoom and pan the scene; unfocused, they belong to the
        page. A click focuses it natively, Tab reaches it, Escape leaves.
      */}
      <canvas
        className="stage__canvas"
        ref={canvasRef}
        tabIndex={0}
        aria-label="Campaign viewport. Arrow keys zoom and pan, 0 fits the campaign, Escape leaves."
      />
      {failure === null ? (
        <Overlay readout={readout} scene={scene} />
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
 * actually looking at, and that the zoom a caption claims is the zoom the frame
 * was taken at. The campaign row is the one that says how much of the dataset
 * reached the canvas, which a picture of three thousand dots cannot.
 */
function Overlay({
  readout,
  scene,
}: {
  readout: CameraReadout | null;
  scene: CampaignScene | null;
}): JSX.Element {
  if (scene === null) {
    return (
      <div className="stage__readout">
        <p className="stage__readout-row">laying out the campaign</p>
      </div>
    );
  }
  if (readout === null) {
    return (
      <div className="stage__readout">
        <p className="stage__readout-row">starting renderer</p>
      </div>
    );
  }

  const { zoom, center, world, viewport, labels, minZoom, maxZoom } = readout;
  return (
    <div className="stage__readout">
      <p className="stage__readout-row">
        <span className="stage__readout-key">campaign</span>
        {scene.nodes.length} nodes, {scene.tiles.length} tiles, {scene.layoutRuns} layout runs
      </p>
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
        <span className="stage__readout-key">overlay</span>
        {labels} of {scene.nodes.length} in DOM
      </p>
      {/*
        The limits are read off the camera rather than typed out, because a
        hint that disagrees with the camera is worse than no hint, and these
        limits are derived from the scene and the viewport: they genuinely
        move when the window does.
      */}
      <p className="stage__readout-hint">
        drag to pan, scroll to zoom ({fixed(minZoom, 2)} to {fixed(maxZoom, 1)}), or load #zoom=
        {fixed(maxZoom, 1)}
      </p>
      <p className="stage__readout-hint">
        click the canvas, then arrows zoom and pan, 0 fits, Escape leaves
      </p>
    </div>
  );
}
