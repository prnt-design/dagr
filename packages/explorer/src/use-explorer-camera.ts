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
 * size places the fitted camera at once, without a flight, and every later
 * size refits by easing.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Vec2 } from '@prnt/dagr-render/core';
import {
  cameraSettled,
  createCameraLimits,
  easeCamera,
  fitCamera,
  focusCamera,
  panCamera,
  revealCamera,
  screenToWorld,
  zoomCamera,
} from './camera.js';
import type { CameraLimits, ExplorerCamera, ExplorerViewportSize } from './camera.js';
import type { ExplorerBox, ExplorerLayout } from './layout.js';

export interface ExplorerCameraControls {
  fit(): void;
  /** Anchored at the viewport center. */
  zoomBy(factor: number): void;
  /** A flight to fit the box. */
  focusBox(box: ExplorerBox): void;
  /** The least pan that brings the box into view, at the current scale. */
  revealBox(box: ExplorerBox): void;
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
}

/** CSS pixels a press travels before it is a pan rather than a click. */
const DRAG_THRESHOLD = 5;
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
  dispose(): void;
}

const isFiniteBox = (box: ExplorerBox): boolean =>
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  Number.isFinite(box.width) &&
  Number.isFinite(box.height);

function createEngine(
  viewport: HTMLElement,
  plane: HTMLElement,
  initialLayout: ExplorerLayout,
  onFrame: (camera: ExplorerCamera, size: ExplorerViewportSize) => void,
): Engine {
  const reduced =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  let layout = initialLayout;
  let size: ExplorerViewportSize = { width: 0, height: 0 };
  let limits: CameraLimits | null = null;
  // `current` is what the ease has reached and `target` where it is going,
  // both as asked for. `drawn` is `current` constrained, which is what the
  // plane shows and what every reading of the camera answers with.
  let current: ExplorerCamera | null = null;
  let target: ExplorerCamera | null = null;
  let drawn: ExplorerCamera | null = null;
  let frame = 0;
  let lastTime = 0;
  let disposed = false;

  const stop = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  };

  const draw = (): void => {
    if (disposed || limits === null || current === null) return;
    const next = limits.constrain(current);
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
    const elapsed = time - lastTime;
    lastTime = time;
    const next = easeCamera(current, target, elapsed);
    if (cameraSettled(next, target)) {
      current = target;
      draw();
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
      current = target;
      draw();
    } else if (frame === 0) {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };

  /** Rebuilds the limits for the layout and size, and fits. */
  const refit = (place: boolean): void => {
    limits = createCameraLimits(layout, size);
    if (limits === null) {
      stop();
      current = target = drawn = null;
      return;
    }
    if (place) {
      stop();
      current = null;
    }
    aim(fitCamera(layout, size, limits));
  };

  const measure = (): void => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    // A zero dimension is a hidden viewport, not a tiny one. Keeping the last
    // camera means showing it again needs no refit when the size comes back.
    if (!(width > 0) || !(height > 0)) return;
    if (width === size.width && height === size.height && limits !== null) return;
    const first = drawn === null;
    size = { width, height };
    refit(first);
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
  // Set when a drag ends, and cleared by the next press: the click and
  // dblclick in between belong to the drag.
  let suppress = false;
  // Clicks let through since the last one suppressed. A dblclick follows
  // two clicks, and is the drag's own if either of them was.
  let clicksSinceSuppressed = Number.POSITIVE_INFINITY;

  const containsFocus = (): boolean => viewport.contains(document.activeElement);
  const focusViewport = (): void => {
    if (!containsFocus()) viewport.focus({ preventScroll: true });
  };

  const endPress = (pointerId: number): void => {
    if (press === null || press.id !== pointerId) return;
    if (press.panning) {
      suppress = true;
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      viewport.removeAttribute('data-dragging');
    }
    press = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    suppress = false;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element) {
      const control = event.target.closest(CONTROL);
      if (control !== null && viewport.contains(control) && !control.matches(NODE)) return;
    }
    if (event.pointerType === 'touch' && !containsFocus()) {
      // The first tap only focuses, so an unfocused graph never traps a swipe
      // meant to scroll the page.
      focusViewport();
      return;
    }
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
    if (press === null || press.id !== event.pointerId) return;
    if (!press.panning) {
      const travelled = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (travelled <= DRAG_THRESHOLD) return;
      if (limits === null || current === null) {
        press = null;
        return;
      }
      press.panning = true;
      focusViewport();
      viewport.setPointerCapture(event.pointerId);
      viewport.setAttribute('data-dragging', 'true');
      // Take the pan from where the camera is on screen, not from the end of
      // a flight in progress.
      stop();
      current = drawn ?? limits.constrain(current);
      target = current;
    }
    const dx = event.clientX - press.lastX;
    const dy = event.clientY - press.lastY;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    if (target !== null) aim(panCamera(target, dx, dy));
  };

  const onPointerUp = (event: PointerEvent): void => endPress(event.pointerId);

  const onClick = (event: MouseEvent): void => {
    if (!suppress) {
      clicksSinceSuppressed += 1;
      return;
    }
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
    // Ctrl and Command wheel are the browser's zoom, and an unfocused wheel
    // scrolls the page.
    if (event.ctrlKey || event.metaKey || !containsFocus()) return;
    if (limits === null || target === null) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    if (event.shiftKey) {
      aim(panCamera(target, -(event.deltaX || event.deltaY) * unit, 0));
      return;
    }
    const box = viewport.getBoundingClientRect();
    const anchor = {
      x: event.clientX - box.left - viewport.clientLeft,
      y: event.clientY - box.top - viewport.clientTop,
    };
    const factor = Math.exp(-Math.max(-150, Math.min(150, event.deltaY * unit)) * 0.002);
    aim(zoomCamera(target, factor, anchor, limits));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && viewport.contains(active)) active.blur();
      return;
    }
    if (event.target instanceof Element && event.target.closest(TEXT_ENTRY) !== null) return;
    // Ctrl and Command with + - 0 are the browser's zoom.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (limits === null || target === null) return;
    const center = { x: size.width / 2, y: size.height / 2 };
    switch (event.key) {
      case '+':
      case '=':
        aim(zoomCamera(target, KEY_ZOOM_IN, center, limits));
        break;
      case '-':
        aim(zoomCamera(target, KEY_ZOOM_OUT, center, limits));
        break;
      case '0':
        aim(fitCamera(layout, size, limits));
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

  // `touch-action: none` only while the graph holds focus, so an unfocused
  // graph never traps a page scroll on touch.
  const onFocusIn = (): void => {
    viewport.style.touchAction = 'none';
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && viewport.contains(next)) return;
    viewport.style.touchAction = '';
  };

  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('keydown', onKeyDown);
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  // Capture, so a suppressed click is gone before any listener on the
  // viewport or below it sees it.
  viewport.addEventListener('click', onClick, true);
  viewport.addEventListener('dblclick', onDoubleClick, true);
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('focusout', onFocusOut);
  if (containsFocus()) onFocusIn();
  measure();

  return {
    fit() {
      if (limits !== null) aim(fitCamera(layout, size, limits));
    },
    zoomBy(factor) {
      if (limits === null || target === null || !(factor > 0) || !Number.isFinite(factor)) return;
      aim(zoomCamera(target, factor, { x: size.width / 2, y: size.height / 2 }, limits));
    },
    focusBox(box) {
      if (limits === null || !isFiniteBox(box)) return;
      aim(focusCamera(box, size, limits));
    },
    revealBox(box) {
      if (target === null || !isFiniteBox(box)) return;
      aim(revealCamera(target, box, size));
    },
    getCamera() {
      return drawn;
    },
    screenToWorld(point) {
      return drawn === null ? null : screenToWorld(drawn, point);
    },
    setLayout(next) {
      if (next === layout) return;
      layout = next;
      // New content is placed, not flown to: easing from a camera framed on
      // other content shows nothing meaningful on the way.
      if (size.width > 0 && size.height > 0) refit(true);
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('keydown', onKeyDown);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      viewport.removeEventListener('click', onClick, true);
      viewport.removeEventListener('dblclick', onDoubleClick, true);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
      if (press?.panning === true) {
        if (viewport.hasPointerCapture(press.id)) viewport.releasePointerCapture(press.id);
        viewport.removeAttribute('data-dragging');
      }
      press = null;
      viewport.style.touchAction = '';
      limits = null;
      current = target = drawn = null;
    },
  };
}

export function useExplorerCamera(options: UseExplorerCameraOptions): ExplorerCameraControls {
  const { viewportRef, planeRef, layout, onFrame } = options;
  const engineRef = useRef<Engine | null>(null);
  const layoutRef = useRef(layout);
  const onFrameRef = useRef(onFrame);

  // Declared first, so it has run by the time the effects below draw: a
  // frame drawn for a new layout reaches the `onFrame` of the same render.
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  const [controls] = useState<ExplorerCameraControls>(() => ({
    fit: () => engineRef.current?.fit(),
    zoomBy: (factor) => engineRef.current?.zoomBy(factor),
    focusBox: (box) => engineRef.current?.focusBox(box),
    revealBox: (box) => engineRef.current?.revealBox(box),
    getCamera: () => engineRef.current?.getCamera() ?? null,
    screenToWorld: (point) => engineRef.current?.screenToWorld(point) ?? null,
  }));

  useEffect(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (viewport === null || plane === null) return undefined;
    const engine = createEngine(viewport, plane, layoutRef.current, (camera, size) => {
      onFrameRef.current(camera, size);
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [viewportRef, planeRef]);

  useEffect(() => {
    layoutRef.current = layout;
    engineRef.current?.setLayout(layout);
  }, [layout]);

  return controls;
}
