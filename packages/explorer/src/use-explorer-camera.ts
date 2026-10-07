/**
 * The explorer's camera: one animation frame loop, a resize observer and the
 * gestures, bound to a viewport element and the plane inside it.
 *
 * A port of the docs' `useGraphCamera` with its arithmetic taken out: every
 * camera this file holds comes from `camera.ts`. What is left here is time
 * (the frame loop), input (wheel, pointer, keys) and the DOM writes.
 *
 * **The camera never causes a React render.** A frame is one
 * `style.transform` write on the plane, and `onFrame` is how the owner
 * learns the camera moved. Whether that is worth a render (the visible set
 * changed) is the owner's decision, not this hook's.
 *
 * **One engine per effect.** Everything mutable lives in a closure the
 * effect creates and its cleanup disposes, so StrictMode's mount, cleanup,
 * mount leaves exactly one loop and one set of listeners, and a frame that
 * fires after cleanup finds the engine disposed and writes nothing. The
 * controls the hook returns are stable for the component's lifetime and
 * forward to whichever engine is live, or do nothing.
 *
 * **No size, no camera.** A viewport measured at zero (a hidden tab,
 * `display: none`, the server) has no limits, so there is no camera to
 * draw: the controls are no-ops and the plane stays hidden. The first real
 * size places the fitted camera at once, without a flight.
 *
 * **A resize or a new layout keeps the user's place:** the world point at
 * the center and the scale, under the new limits. Only a camera that was at
 * fit is fitted again, so a user zoomed in on a node keeps it.
 *
 * **The camera frames what nothing covers.** The frame is the viewport less
 * the host's `inset` and the overlays registered as obstructions (the
 * drawer), measured on every resize of either. A frame that changes refits a
 * camera at fit, and otherwise keeps the camera and reveals the `keepInView`
 * box (the selected node) if the change covered it.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Vec2 } from '@prnt/dagr-render/core';
import {
  CONTENT_PADDING,
  cameraFrame,
  cameraSettled,
  createCameraLimits,
  easeCamera,
  fitCamera,
  focusCamera,
  frameCenter,
  obstructionInset,
  panCamera,
  revealCamera,
  screenToWorld,
  zoomCamera,
} from './camera.js';
import type { CameraFrame, CameraLimits, ExplorerCamera, ExplorerInset, ExplorerViewportSize } from './camera.js';
import type { ExplorerBox, ExplorerLayout } from './layout.js';

/** Overlays the camera keeps its frame clear of. */
export interface CameraObstructions {
  list(): readonly Element[];
  /** Calls `listener` when one is added or removed. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface ExplorerCameraControls {
  fit(): void;
  /** Anchored at the frame's center. */
  zoomBy(factor: number): void;
  /** A flight to fit the box. */
  focusBox(box: ExplorerBox): void;
  /** The least pan that brings the box into view, at the current scale. */
  revealBox(box: ExplorerBox): void;
  /** Focuses the viewport without scrolling, unless focus is already inside it. */
  focus(): void;
  /** The camera on screen, or `null` before the first fit. */
  getCamera(): ExplorerCamera | null;
  screenToWorld(point: Vec2): Vec2 | null;
}

export interface UseExplorerCameraOptions {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly planeRef: RefObject<HTMLElement | null>;
  readonly layout: ExplorerLayout;
  /** Called on every drawn frame, after the transform is written. */
  readonly onFrame: (camera: ExplorerCamera, viewport: ExplorerViewportSize) => void;
  readonly obstructions?: CameraObstructions | undefined;
  /** CSS pixels the host's own overlays cover on each side. */
  readonly inset?: ExplorerInset | undefined;
  /** The fraction of the frame content may be panned past its edge. Default 0.05. */
  readonly contentPadding?: number | undefined;
  /** The box to bring back into the frame when a change of frame covers it. */
  readonly keepInView?: (() => ExplorerBox | null) | undefined;
}

interface FrameOptions {
  readonly inset: ExplorerInset;
  readonly contentPadding: number;
}

/** CSS pixels a press travels before it is a pan rather than a click. */
const DRAG_THRESHOLD = 5;
/** Zoom per unit of wheel delta, for a wheel and for a trackpad pinch. */
const WHEEL_GAIN = 0.002;
const PINCH_GAIN = 0.01;
/** The most wheel delta one event counts, in pixels. */
const WHEEL_CLAMP = 150;
/** What a flight's first frame counts as elapsed: one frame at 60 Hz. */
const FIRST_FRAME_MS = 16.7;
const KEY_ZOOM_IN = 1.25;
const KEY_ZOOM_OUT = 0.8;
const KEY_PAN = 60;
/** A press on one of these does not drag, unless it is a node. */
const CONTROL = 'a[href], button, input, select, textarea';
const NODE = '[data-dagr-explorer="node"]';
/** Keys typed in one of these belong to it. */
const TEXT_ENTRY = 'input, select, textarea, [contenteditable]';

interface Engine extends ExplorerCameraControls {
  setLayout(layout: ExplorerLayout): void;
  setFrameOptions(options: FrameOptions): void;
  dispose(): void;
}

const isFiniteBox = (box: ExplorerBox): boolean =>
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  Number.isFinite(box.width) &&
  Number.isFinite(box.height);

/** What a frame leaves covered on each side: how a change of frame differs from a resize. */
const covered = (area: CameraFrame, size: ExplorerViewportSize): string =>
  [
    area.x ?? 0,
    area.y ?? 0,
    size.width - (area.x ?? 0) - area.width,
    size.height - (area.y ?? 0) - area.height,
  ].join(' ');

function createEngine(
  viewport: HTMLElement,
  plane: HTMLElement,
  initialLayout: ExplorerLayout,
  onFrame: (camera: ExplorerCamera, size: ExplorerViewportSize) => void,
  initialOptions: FrameOptions,
  obstructions: CameraObstructions | undefined,
  keepInView: () => ExplorerBox | null,
): Engine {
  const reduced =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  let layout = initialLayout;
  let size: ExplorerViewportSize = { width: 0, height: 0 };
  // The part of the viewport nothing covers, which the camera frames.
  let area: CameraFrame = size;
  let options = initialOptions;
  let limits: CameraLimits | null = null;
  // `current` is what the ease has reached and `target` where it is going,
  // both as asked for. `drawn` is `current` constrained, which is what the
  // plane shows and what every reading of the camera answers with.
  let current: ExplorerCamera | null = null;
  let target: ExplorerCamera | null = null;
  let drawn: ExplorerCamera | null = null;
  // Set by a change of frame at the same size, until its flight settles or a
  // gesture takes over: `current` is drawn unconstrained, because the new
  // limits would snap it to their edge before the ease could move it.
  let framing = false;
  let frame = 0;
  let lastTime = 0;
  let disposed = false;
  // Whether a drag or a pinch is moving the camera, which `composite` reads.
  let dragging = false;
  let composited = false;

  /**
   * A composited layer while the camera moves, and none at rest. Moving, it
   * spares a repaint per frame. At rest, the content is rasterized again at
   * the scale it is shown at: a layer cached at one scale and enlarged by the
   * camera shows text blurred.
   */
  const composite = (): void => {
    const moving = !disposed && (frame !== 0 || dragging);
    if (moving === composited) return;
    composited = moving;
    if (moving) plane.style.willChange = 'transform';
    else plane.style.removeProperty('will-change');
  };

  const stop = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    composite();
  };

  const draw = (): void => {
    if (disposed || limits === null || current === null) return;
    const next = framing ? current : limits.constrain(current);
    plane.style.transform = `translate(${String(next.x)}px, ${String(next.y)}px) scale(${String(next.scale)})`;
    if (drawn === null || drawn.scale !== next.scale) {
      plane.style.setProperty('--dagr-explorer-inv-zoom', String(1 / next.scale));
    }
    if (plane.style.visibility !== 'visible') plane.style.visibility = 'visible';
    drawn = next;
    onFrame(next, size);
  };

  const tick = (time: number): void => {
    frame = 0;
    if (disposed || current === null || target === null) return;
    // A frame's timestamp is when the frame began, which can be before the
    // flight did. Counted as no time, the first frame would not move.
    const elapsed = time > lastTime ? time - lastTime : FIRST_FRAME_MS;
    lastTime = time;
    const next = easeCamera(current, target, elapsed);
    if (cameraSettled(next, target)) {
      framing = false;
      current = target;
      draw();
      composite();
      return;
    }
    current = next;
    draw();
    frame = requestAnimationFrame(tick);
  };

  /** Sets where the camera is going, constrained, and starts the flight. */
  const aim = (next: ExplorerCamera): void => {
    if (disposed || limits === null) return;
    target = limits.constrain(next);
    if (reduced?.matches === true || current === null) {
      stop();
      framing = false;
      current = target;
      draw();
    } else if (frame === 0) {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
      composite();
    }
  };

  /**
   * Whether the camera is at the fit for the current layout and `at`, the
   * frame `bounds` were built for. Read from the target, so a flight to the
   * fit counts as at fit.
   */
  const atFit = (bounds: CameraLimits | null, at: CameraFrame): boolean =>
    bounds !== null && target !== null && cameraSettled(target, bounds.constrain(fitCamera(layout, at, bounds)));

  /** Rebuilds the limits for the layout and frame. With none, there is no camera. */
  const rebuild = (): CameraLimits | null => {
    limits = createCameraLimits(layout, area, options.contentPadding);
    if (limits === null) {
      stop();
      current = target = drawn = null;
    }
    return limits;
  };

  /** Puts `camera` on screen at once, with no flight. */
  const place = (camera: ExplorerCamera): void => {
    stop();
    current = null;
    aim(camera);
  };

  /** What the registered obstructions cover, measured against the viewport's content box. */
  const obstructed = (): ExplorerInset[] => {
    const overlays = obstructions?.list() ?? [];
    if (overlays.length === 0) return [];
    const box = viewport.getBoundingClientRect();
    const left = box.left + viewport.clientLeft;
    const top = box.top + viewport.clientTop;
    const inner = { left, top, right: left + viewport.clientWidth, bottom: top + viewport.clientHeight };
    return overlays.map((overlay) => obstructionInset(inner, overlay.getBoundingClientRect()));
  };

  /** `force` rebuilds the limits even when neither the size nor the frame changed. */
  const measure = (force = false): void => {
    if (disposed) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    // A zero dimension is a hidden viewport, not a tiny one. Keeping the last
    // camera means showing it again needs no refit when the size comes back.
    if (!(width > 0) || !(height > 0)) return;
    const nextSize = { width, height };
    const nextFrame = cameraFrame(nextSize, options.inset, ...obstructed());
    const resized = width !== size.width || height !== size.height;
    const uncovered = covered(nextFrame, nextSize) !== covered(area, size);
    if (!force && !resized && !uncovered && limits !== null) return;
    const previous = size;
    const wasAtFit = atFit(limits, area);
    size = nextSize;
    area = nextFrame;
    const bounds = rebuild();
    if (bounds === null) return;
    if (current === null || target === null) {
      place(fitCamera(layout, area, bounds));
      return;
    }
    // The user's place is the world point at the center and the scale. The
    // plane is anchored at its top left, so keeping the center is a pan by
    // half the change in size, drawn now so the content does not jump.
    if (resized) {
      const dx = (size.width - previous.width) / 2;
      const dy = (size.height - previous.height) / 2;
      framing = false;
      current = panCamera(current, dx, dy);
      target = panCamera(target, dx, dy);
      draw();
    } else {
      framing = true;
    }
    if (wasAtFit) {
      aim(fitCamera(layout, area, bounds));
      return;
    }
    const keep = uncovered ? keepInView() : null;
    aim(keep !== null && isFiniteBox(keep) ? revealCamera(target, keep, area) : target);
  };

  // The obstructions are observed with the viewport, so a drawer that
  // resizes moves the frame.
  const watched = new Set<Element>();
  const observeObstructions = (): void => {
    const now = new Set(obstructions?.list() ?? []);
    for (const element of watched) {
      if (now.has(element)) continue;
      watched.delete(element);
      observer.unobserve(element);
    }
    for (const element of now) {
      if (watched.has(element)) continue;
      watched.add(element);
      observer.observe(element);
    }
    measure();
  };

  // Gestures. A press records where it began, and becomes a pan only past
  // the threshold, so a tap keeps its target and its click.
  let press: {
    readonly id: number;
    readonly startX: number;
    readonly startY: number;
    lastX: number;
    lastY: number;
    panning: boolean;
  } | null = null;
  // Touch pointers down on the viewport, at their last point in viewport
  // coordinates. Two of them are a pinch, which `pinch` holds the last
  // reading of.
  const touches = new Map<number, Vec2>();
  let pinch: { readonly distance: number; readonly mid: Vec2 } | null = null;
  // Set when a drag or a focusing tap ends: the click that follows is the
  // gesture's own. Cleared once that click is swallowed, and by the next
  // press or key, so a gesture that makes no click cannot eat a later one.
  let suppress = false;
  // Clicks let through since the last one suppressed. A dblclick follows
  // two clicks, and is the drag's own if either of them was.
  let clicksSinceSuppressed = Number.POSITIVE_INFINITY;

  const containsFocus = (): boolean => viewport.contains(document.activeElement);
  const focusViewport = (): void => {
    if (!containsFocus()) viewport.focus({ preventScroll: true });
  };
  const local = (event: MouseEvent): Vec2 => {
    const box = viewport.getBoundingClientRect();
    return {
      x: event.clientX - box.left - viewport.clientLeft,
      y: event.clientY - box.top - viewport.clientTop,
    };
  };
  const capture = (pointerId: number): boolean => {
    try {
      viewport.setPointerCapture(pointerId);
      return true;
    } catch {
      // The pointer is already gone, which ends the gesture it began.
      return false;
    }
  };
  const release = (pointerId: number): void => {
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  };

  /** Takes a gesture's camera from where it is on screen, not from the end of a flight. */
  const grab = (): boolean => {
    if (limits === null || current === null) return false;
    stop();
    current = target = framing || drawn === null ? limits.constrain(current) : drawn;
    framing = false;
    return true;
  };

  const endPress = (pointerId: number): void => {
    if (press === null || press.id !== pointerId) return;
    const panned = press.panning;
    press = null;
    if (panned) {
      suppress = true;
      release(pointerId);
      if (pinch === null) {
        viewport.removeAttribute('data-dragging');
        dragging = false;
        composite();
      }
    }
  };

  const pinchReading = (): { readonly distance: number; readonly mid: Vec2 } | null => {
    const [a, b] = [...touches.values()];
    if (a === undefined || b === undefined) return null;
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const startPinch = (): void => {
    const reading = pinchReading();
    if (reading === null || !grab()) return;
    // The pinch takes over the press its first finger began.
    press = null;
    pinch = reading;
    for (const id of touches.keys()) capture(id);
    viewport.setAttribute('data-dragging', 'true');
    dragging = true;
    composite();
  };

  const movePinch = (): void => {
    const reading = pinchReading();
    if (pinch === null || reading === null || limits === null || current === null) return;
    const factor = pinch.distance > 0 && reading.distance > 0 ? reading.distance / pinch.distance : 1;
    const moved = panCamera(current, reading.mid.x - pinch.mid.x, reading.mid.y - pinch.mid.y);
    current = target = limits.constrain(zoomCamera(moved, factor, reading.mid, limits));
    pinch = reading;
    draw();
  };

  const endPinch = (): void => {
    pinch = null;
    for (const id of touches.keys()) release(id);
    viewport.removeAttribute('data-dragging');
    suppress = true;
    dragging = false;
    composite();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && event.isPrimary) {
      // The first finger of a new gesture: any finger still recorded lifted
      // where this viewport did not hear it.
      if (pinch !== null) endPinch();
      touches.clear();
    }
    suppress = false;
    if (event.button !== 0) return;
    if (event.target instanceof Element) {
      const control = event.target.closest(CONTROL);
      if (control !== null && viewport.contains(control) && !control.matches(NODE)) return;
    }
    if (event.pointerType === 'touch') {
      if (!containsFocus()) {
        // The first tap only focuses, so an unfocused graph never traps a
        // swipe meant to scroll the page, and the click it makes activates
        // nothing.
        focusViewport();
        suppress = true;
        return;
      }
      if (touches.size >= 2) return;
      touches.set(event.pointerId, local(event));
      if (touches.size === 2) {
        startPinch();
        return;
      }
    }
    if (!event.isPrimary) return;
    press = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      panning: false,
    };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, local(event));
      if (pinch !== null) {
        movePinch();
        return;
      }
    }
    if (press === null || press.id !== event.pointerId) return;
    // No button down is a press released where this viewport did not hear it.
    if (event.buttons === 0) {
      endPress(event.pointerId);
      return;
    }
    if (!press.panning) {
      const travelled = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (travelled <= DRAG_THRESHOLD) return;
      focusViewport();
      if (!grab() || !capture(event.pointerId)) {
        press = null;
        return;
      }
      press.panning = true;
      viewport.setAttribute('data-dragging', 'true');
      dragging = true;
      composite();
    }
    const dx = event.clientX - press.lastX;
    const dy = event.clientY - press.lastY;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    // A drag is drawn in the event that moved it, with no ease: the content
    // stays under the pointer.
    if (limits === null || current === null) return;
    current = target = limits.constrain(panCamera(current, dx, dy));
    draw();
  };

  /** `pointerup`, `pointercancel` and `lostpointercapture` all end what the pointer began. */
  const onPointerEnd = (event: PointerEvent): void => {
    endPress(event.pointerId);
    if (touches.delete(event.pointerId) && pinch !== null) endPinch();
  };

  const onClick = (event: MouseEvent): void => {
    // A click with no count came from a key or a script, never from a drag.
    if (!suppress || event.detail === 0) {
      clicksSinceSuppressed += 1;
      return;
    }
    suppress = false;
    clicksSinceSuppressed = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (!suppress && clicksSinceSuppressed >= 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onWheel = (event: WheelEvent): void => {
    // Command wheel is the browser's zoom, and an unfocused wheel, a pinch
    // included, belongs to the page.
    if (event.metaKey || !containsFocus()) return;
    if (limits === null || target === null) return;
    // A trackpad pinch arrives as a Ctrl wheel.
    const pinching = event.ctrlKey;
    // A sideways swipe has nothing to do here, so the page or a scroller
    // around the graph keeps it.
    if (event.deltaY === 0 && (pinching || !event.shiftKey)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    if (event.shiftKey && !pinching) {
      aim(panCamera(target, -(event.deltaX || event.deltaY) * unit, 0));
      return;
    }
    const delta = Math.max(-WHEEL_CLAMP, Math.min(WHEEL_CLAMP, event.deltaY * unit));
    const factor = Math.exp(-delta * (pinching ? PINCH_GAIN : WHEEL_GAIN));
    aim(zoomCamera(target, factor, local(event), limits));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    suppress = false;
    // Keys typed in a field are the field's, Escape included.
    if (event.target instanceof Element && event.target.closest(TEXT_ENTRY) !== null) return;
    if (event.key === 'Escape') {
      // Handled above, as the root does when the Escape closes the drawer:
      // the graph keeps focus, and the next Escape leaves it.
      if (event.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && viewport.contains(active)) active.blur();
      return;
    }
    // Ctrl and Command with + - 0 are the browser's zoom.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // An arrow on a node moves focus, which the viewport surface does. With
    // Shift it pans, as it does on the surface.
    const onNode = event.target instanceof Element && event.target.closest(NODE) !== null;
    if (onNode && !event.shiftKey && event.key.startsWith('Arrow')) return;
    if (limits === null || target === null) return;
    const center = frameCenter(area);
    switch (event.key) {
      case '+':
      case '=':
        aim(zoomCamera(target, KEY_ZOOM_IN, center, limits));
        break;
      case '-':
        aim(zoomCamera(target, KEY_ZOOM_OUT, center, limits));
        break;
      case '0':
        aim(fitCamera(layout, area, limits));
        break;
      case 'ArrowLeft':
        aim(panCamera(target, KEY_PAN, 0));
        break;
      case 'ArrowRight':
        aim(panCamera(target, -KEY_PAN, 0));
        break;
      case 'ArrowUp':
        aim(panCamera(target, 0, KEY_PAN));
        break;
      case 'ArrowDown':
        aim(panCamera(target, 0, -KEY_PAN));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // A wheel listener only while the graph holds focus, when it can act.
  // Unfocused it would do nothing, and its mere presence costs the page its
  // scroll in WebKit under a root with `overscroll-behavior: none`: a
  // non-passive wheel listener under the pointer, even one that returns at
  // once, and the page does not move (found by the M5.6f-2 browser check).
  let wheeling = false;
  const listenForWheel = (on: boolean): void => {
    if (on === wheeling) return;
    wheeling = on;
    if (on) viewport.addEventListener('wheel', onWheel, { passive: false });
    else viewport.removeEventListener('wheel', onWheel);
  };

  // `touch-action: none` only while the graph holds focus, so an unfocused
  // graph never traps a page scroll on touch.
  const onFocusIn = (): void => {
    viewport.style.touchAction = 'none';
    listenForWheel(true);
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && viewport.contains(next)) return;
    viewport.style.touchAction = '';
    listenForWheel(false);
  };

  const observer = new ResizeObserver(() => measure());
  observer.observe(viewport);
  const unsubscribe = obstructions?.subscribe(observeObstructions);
  viewport.addEventListener('keydown', onKeyDown);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('lostpointercapture', onPointerEnd);
  // Capture, so a suppressed click is gone before any listener on the
  // viewport or below it sees it.
  viewport.addEventListener('click', onClick, true);
  viewport.addEventListener('dblclick', onDoubleClick, true);
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('focusout', onFocusOut);
  if (containsFocus()) onFocusIn();
  observeObstructions();

  return {
    fit() {
      if (limits !== null) aim(fitCamera(layout, area, limits));
    },
    zoomBy(factor) {
      if (limits === null || target === null || !(factor > 0) || !Number.isFinite(factor)) return;
      aim(zoomCamera(target, factor, frameCenter(area), limits));
    },
    focusBox(box) {
      if (limits === null || !isFiniteBox(box)) return;
      aim(focusCamera(box, area, limits));
    },
    revealBox(box) {
      if (target === null || !isFiniteBox(box)) return;
      aim(revealCamera(target, box, area));
    },
    focus() {
      if (!disposed) focusViewport();
    },
    getCamera() {
      return drawn;
    },
    screenToWorld(point) {
      return drawn === null ? null : screenToWorld(drawn, point);
    },
    setFrameOptions(next) {
      const same =
        next.contentPadding === options.contentPadding &&
        (['top', 'right', 'bottom', 'left'] as const).every((side) => next.inset[side] === options.inset[side]);
      if (disposed || same) return;
      options = next;
      measure(true);
    },
    setLayout(next) {
      if (disposed || next === layout) return;
      const wasAtFit = atFit(limits, area);
      const kept = drawn;
      layout = next;
      if (!(size.width > 0 && size.height > 0)) return;
      const bounds = rebuild();
      if (bounds === null) return;
      // New content is placed, not flown to: easing from a camera framed on
      // other content shows nothing meaningful on the way. At the same size,
      // the same camera keeps the center's world point and the scale.
      place(kept === null || wasAtFit ? fitCamera(layout, area, bounds) : kept);
    },
    dispose() {
      disposed = true;
      stop();
      unsubscribe?.();
      observer.disconnect();
      listenForWheel(false);
      viewport.removeEventListener('keydown', onKeyDown);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerEnd);
      viewport.removeEventListener('pointercancel', onPointerEnd);
      viewport.removeEventListener('lostpointercapture', onPointerEnd);
      viewport.removeEventListener('click', onClick, true);
      viewport.removeEventListener('dblclick', onDoubleClick, true);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
      if (press?.panning === true) release(press.id);
      for (const id of touches.keys()) release(id);
      viewport.removeAttribute('data-dragging');
      press = null;
      pinch = null;
      touches.clear();
      dragging = false;
      viewport.style.touchAction = '';
      limits = null;
      current = target = drawn = null;
    },
  };
}

export function useExplorerCamera(options: UseExplorerCameraOptions): ExplorerCameraControls {
  const { viewportRef, planeRef, layout, onFrame, obstructions, keepInView } = options;
  const engineRef = useRef<Engine | null>(null);
  const layoutRef = useRef(layout);
  const onFrameRef = useRef(onFrame);
  const keepInViewRef = useRef(keepInView);
  const { top, right, bottom, left } = options.inset ?? {};
  const contentPadding = options.contentPadding ?? CONTENT_PADDING;
  const frameOptionsRef = useRef<FrameOptions>({ inset: { top, right, bottom, left }, contentPadding });

  // Declared first, so it has run by the time the effects below draw: a
  // frame drawn for a new layout reaches the `onFrame` of the same render.
  useEffect(() => {
    onFrameRef.current = onFrame;
    keepInViewRef.current = keepInView;
  });

  const [controls] = useState<ExplorerCameraControls>(() => ({
    fit: () => engineRef.current?.fit(),
    zoomBy: (factor) => engineRef.current?.zoomBy(factor),
    focusBox: (box) => engineRef.current?.focusBox(box),
    revealBox: (box) => engineRef.current?.revealBox(box),
    focus: () => engineRef.current?.focus(),
    getCamera: () => engineRef.current?.getCamera() ?? null,
    screenToWorld: (point) => engineRef.current?.screenToWorld(point) ?? null,
  }));

  useEffect(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (viewport === null || plane === null) return undefined;
    const engine = createEngine(
      viewport,
      plane,
      layoutRef.current,
      (camera, size) => {
        onFrameRef.current(camera, size);
      },
      frameOptionsRef.current,
      obstructions,
      () => keepInViewRef.current?.() ?? null,
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [viewportRef, planeRef, obstructions]);

  useEffect(() => {
    frameOptionsRef.current = { inset: { top, right, bottom, left }, contentPadding };
    engineRef.current?.setFrameOptions(frameOptionsRef.current);
  }, [top, right, bottom, left, contentPadding]);

  useEffect(() => {
    layoutRef.current = layout;
    engineRef.current?.setLayout(layout);
  }, [layout]);

  return controls;
}
