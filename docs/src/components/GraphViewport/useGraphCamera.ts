import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

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
) {
  const controls = useRef<{
    zoom: (factor: number) => void;
    reset: () => void;
  }>({ zoom: () => {}, reset: () => {} });
  useEffect(() => {
    const viewport = viewportRef.current;
    const diagram = diagramRef.current;
    if (!enabled || !viewport || !diagram) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let fit = 1;
    let viewportWidth = viewport.clientWidth;
    let viewportHeight = viewport.clientHeight;
    let current: Camera = { x: 0, y: 0, scale: 1 };
    let target = { ...current };
    let frame = 0;
    let lastTime = 0;
    let drag: { id: number; x: number; y: number } | undefined;
    const draw = () => {
      if (apply) {
        apply(current, viewportWidth, viewportHeight);
        return;
      }
      diagram.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
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
      fit = Math.max(
        0.000001,
        Math.min(
          (viewportWidth - 32) / bounds.width,
          (viewportHeight - 32) / bounds.height,
        ),
      );
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
      const scale = Math.max(
        fit * 0.5,
        Math.min(fit * 40, target.scale * factor),
      );
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
          'button, a, input, select, textarea, [contenteditable]',
        )
      )
        return;
      viewport.focus({ preventScroll: true });
      cancelAnimationFrame(frame);
      frame = 0;
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
    controls.current = { zoom, reset };
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
      controls.current = { zoom: () => {}, reset: () => {} };
    };
  }, [viewportRef, diagramRef, width, height, enabled, apply, getBounds]);
  return controls;
}
