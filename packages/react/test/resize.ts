/**
 * A `ResizeObserver` a test can fire, and the element size jsdom will not give.
 *
 * A NON-TEST helper. jsdom has no `ResizeObserver` at all and every element it
 * lays out is zero by zero, so both halves of "the canvas got bigger" have to
 * be supplied here: the observer that reports it, and the box it reports.
 *
 * `DagrCanvas` requires a real `ResizeObserver` rather than falling back to a
 * `window` resize listener, and this file is the reason that costs nothing: the
 * fallback would exist for jsdom alone. Every browser that can give the
 * renderer a WebGPU context has had `ResizeObserver` for years, and a container
 * that changes size without the window doing so (a collapsing sidebar, a split
 * pane) is the common case rather than the exotic one.
 */

import { vi } from 'vitest';

interface Watch {
  readonly target: Element;
  readonly notify: ResizeObserverCallback;
  readonly observer: ResizeObserver;
}

const watches: Watch[] = [];

/** Installs the observer. Call it per test, before mounting. */
export function installResizeObserver(): void {
  watches.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      readonly #notify: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.#notify = callback;
      }

      observe(target: Element): void {
        watches.push({ target, notify: this.#notify, observer: this });
      }

      unobserve(target: Element): void {
        const at = watches.findIndex((watch) => watch.target === target);
        if (at >= 0) watches.splice(at, 1);
      }

      disconnect(): void {
        for (let at = watches.length - 1; at >= 0; at -= 1) {
          if (watches[at]?.observer === this) watches.splice(at, 1);
        }
      }
    },
  );
}

/** How many elements are being watched, which is how a disconnect is observed. */
export function watchCount(): number {
  return watches.length;
}

/**
 * Gives every watched element a size and tells its observer about it.
 *
 * The size is written onto the element's own `getBoundingClientRect` as well,
 * because a component reading the box itself (at creation, before the first
 * observation) has to see the same number the observer reports.
 */
export function resizeTo(width: number, height: number): void {
  for (const watch of watches) {
    watch.target.getBoundingClientRect = () =>
      ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
    watch.notify(
      [{ target: watch.target, contentRect: { width, height } } as ResizeObserverEntry],
      watch.observer,
    );
  }
}
