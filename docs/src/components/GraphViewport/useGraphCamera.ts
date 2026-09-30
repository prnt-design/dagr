import { useEffect, useRef } from 'react';
import { Camera2D, fitZoom } from '@prnt/dagr-render';
import type { RefObject } from 'react';

export type FocusBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Camera = { x: number; y: number; scale: number };

/** Keep camera changes out of document layout and React's render cycle. */
export function useGraphCamera(
  viewportRef: RefObject<HTMLDivElement | null>,
  diagramRef: RefObject<HTMLDivElement | null>,
  width: number,
  height: number,
  enabled: boolean,
  apply?: (camera: Camera, width: number, height: number) => void,
  getBounds?: () => { x: number; y: number; width: number; height: number },
  getNodes?: () => readonly { width: number; height: number; x?: number; y?: number }[],
  contentVersion?: unknown,
) {
  const controls = useRef<{
    zoom: (factor: number) => void;
    reset: () => void;
    refresh: () => void;
    focus: (bounds: FocusBounds) => void;
  }>({ zoom: () => {}, reset: () => {}, refresh: () => {}, focus: () => {} });
  useEffect(() => {
    const viewport = viewportRef.current;
    const diagram = diagramRef.current;
    if (!enabled || !viewport || !diagram) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let fit = 1;
    const limiter = new Camera2D();
    let viewportWidth = viewport.clientWidth;
    let viewportHeight = viewport.clientHeight;
    let current: Camera = { x: 0, y: 0, scale: 1 };
    let target = { ...current };
    let frame = 0;
    let lastTime = 0;
    let drag: { id: number; x: number; y: number } | undefined;
    const syncLimits = () => {
      if (viewportWidth <= 0 || viewportHeight <= 0) return;
      limiter.setViewport({ width: viewportWidth, height: viewportHeight, devicePixelRatio: 1 });
      const bounds = getBounds?.() ?? { x: 0, y: 0, width, height };
      if (bounds.width <= 0 || bounds.height <= 0) { limiter.setContentBounds(null); return; }
      let detail = { width: 160, height: 80 };
      let max = 0;
      const nodes = getNodes?.() ?? [];
      for (const size of nodes) {
        if (size.width <= 0 || size.height <= 0) continue;
        const zoom = fitZoom({ minX: 0, minY: 0, maxX: size.width, maxY: size.height }, limiter.viewport);
        if (zoom > max) { max = zoom; detail = size; }
      }
      const regions = nodes.flatMap((node) => node.x === undefined || node.y === undefined || node.width <= 0 || node.height <= 0 ? [] : [{
        minX: node.x, maxX: node.x + node.width, minY: -node.y - node.height, maxY: -node.y,
      }]);
      limiter.setContentBounds({ minX: bounds.x, maxX: bounds.x + bounds.width, minY: -bounds.y - bounds.height, maxY: -bounds.y }, detail, 0.05, regions);
      fit = limiter.minZoom;
    };
    const constrain = (value: Camera): Camera => {
      limiter.setZoom(value.scale);
      limiter.setCenter({ x: (viewportWidth / 2 - value.x) / value.scale, y: -(viewportHeight / 2 - value.y) / value.scale });
      return { x: viewportWidth / 2 - limiter.center.x * limiter.zoom, y: viewportHeight / 2 + limiter.center.y * limiter.zoom, scale: limiter.zoom };
    };
    const draw = () => {
      // Keep interpolation independent of clamping so a focus transition can
      // cross a sparse gap without getting trapped against the nearest node.
      const rendered = constrain(current);
      if (apply) {
        apply(rendered, viewportWidth, viewportHeight);
        return;
      }
      diagram.style.transform = `translate(${rendered.x}px, ${rendered.y}px) scale(${rendered.scale})`;
    };
    const tick = (time: number) => {
      frame = 0;
      const alpha = reduced.matches
        ? 1
        : 1 - Math.exp(-Math.min(64, time - lastTime) / 55);
      lastTime = time;
      current = {
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
        scale: current.scale + (target.scale - current.scale) * alpha,
      };
      if (
        Math.abs(current.x - target.x) + Math.abs(current.y - target.y) <
          0.05 &&
        Math.abs(current.scale - target.scale) < 0.0001
      ) {
        current = { ...target };
        draw();
        return;
      }
      draw();
      frame = requestAnimationFrame(tick);
    };
    const animate = () => {
      syncLimits();
      target = constrain(target);
      if (reduced.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        current = { ...target };
        draw();
      } else if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const reset = () => {
      viewportWidth = viewport.clientWidth;
      viewportHeight = viewport.clientHeight;
      const bounds = getBounds?.() ?? { x: 0, y: 0, width, height };
      if (viewportWidth <= 0 || viewportHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) return;
      syncLimits();
      target = {
        x: (viewportWidth - bounds.width * fit) / 2 - bounds.x * fit,
        y: (viewportHeight - bounds.height * fit) / 2 - bounds.y * fit,
        scale: fit,
      };
      animate();
    };
    const zoom = (
      factor: number,
      x = viewport.clientWidth / 2,
      y = viewport.clientHeight / 2,
    ) => {
      syncLimits();
      const scale = Math.max(fit, Math.min(limiter.maxZoom, target.scale * factor));
      const ratio = scale / target.scale;
      target = {
        x: x - (x - target.x) * ratio,
        y: y - (y - target.y) * ratio,
        scale,
      };
      animate();
    };
    const wheel = (event: WheelEvent) => {
      if (
        !viewport.contains(document.activeElement) ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1;
      if (event.shiftKey) {
        target.x -= (event.deltaX || event.deltaY) * unit;
        animate();
      } else {
        const bounds = viewport.getBoundingClientRect();
        zoom(
          Math.exp(-Math.max(-150, Math.min(150, event.deltaY * unit)) * 0.002),
          event.clientX - bounds.left,
          event.clientY - bounds.top,
        );
      }
    };
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        (event.target as Element).closest(
          'button, [role="button"], a, input, select, textarea, [contenteditable]',
        )
      )
        return;
      viewport.focus({ preventScroll: true });
      cancelAnimationFrame(frame);
      frame = 0;
      current = constrain(current);
      target = { ...current };
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.dragging = 'true';
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      target.x += event.clientX - drag.x;
      target.y += event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      animate();
    };
    const up = () => {
      drag = undefined;
      delete viewport.dataset.dragging;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        up();
        return;
      }
      if (
        (event.target as Element).closest(
          'input, select, textarea, [contenteditable]',
        )
      )
        return;
      if (event.key === '+' || event.key === '=') zoom(1.25);
      else if (event.key === '-') zoom(0.8);
      else if (event.key === '0') reset();
      else if (event.key.startsWith('Arrow')) {
        target.x +=
          event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0;
        target.y +=
          event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0;
        animate();
      } else return;
      event.preventDefault();
    };
    const reveal = (event: FocusEvent) => {
      if (
        apply ||
        event.target === viewport ||
        !(event.target instanceof HTMLElement)
      )
        return;
      const node = event.target.getBoundingClientRect();
      const box = viewport.getBoundingClientRect();
      const dx =
        node.left < box.left + 12
          ? box.left + 12 - node.left
          : node.right > box.right - 12
            ? box.right - 12 - node.right
            : 0;
      const dy =
        node.top < box.top + 12
          ? box.top + 12 - node.top
          : node.bottom > box.bottom - 12
            ? box.bottom - 12 - node.bottom
            : 0;
      target.x += dx;
      target.y += dy;
      animate();
    };
    const focus = (bounds: FocusBounds) => {
      syncLimits();
      const scale = Math.max(fit, Math.min(
        limiter.maxZoom,
        Math.min(
          (viewportWidth - 48) / bounds.width,
          (viewportHeight - 48) / bounds.height,
        ),
      ));
      target = {
        x: viewportWidth / 2 - (bounds.x + bounds.width / 2) * scale,
        y: viewportHeight / 2 - (bounds.y + bounds.height / 2) * scale,
        scale,
      };
      animate();
    };
    controls.current = { zoom, reset, focus, refresh: () => {
      syncLimits();
      current = constrain(current);
      animate();
    } };
    const observer = new ResizeObserver(reset);
    observer.observe(viewport);
    reset();
    current = { ...target };
    draw();
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('pointerdown', down);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
    viewport.addEventListener('pointercancel', up);
    viewport.addEventListener('lostpointercapture', up);
    viewport.addEventListener('keydown', key);
    viewport.addEventListener('focusin', reveal);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('pointerdown', down);
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
      viewport.removeEventListener('pointercancel', up);
      viewport.removeEventListener('lostpointercapture', up);
      viewport.removeEventListener('keydown', key);
      viewport.removeEventListener('focusin', reveal);
      controls.current = { zoom: () => {}, reset: () => {}, refresh: () => {}, focus: () => {} };
    };
  }, [viewportRef, diagramRef, width, height, enabled, apply, getBounds, getNodes]);
  useEffect(() => { controls.current.refresh(); }, [contentVersion]);
  return controls;
}
