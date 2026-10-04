/**
 * Mounting a React tree in jsdom, sizing it, and stepping its frames.
 *
 * A NON-TEST helper: it carries no assertions, and every file that mounts a
 * component imports it. Modeled on `packages/react/test/mount.tsx`,
 * `resize.ts` and `frames.ts`, which this package may not import, and
 * written to run unchanged under React 18 and React 19.
 *
 * **`act` under both majors.** React 19 exports `act` from `react`. React 18
 * exported it from `react-dom/test-utils`, and 18.3 added the `react` export
 * as the migration path, in development builds only. So this file reads
 * `act` off the `react` namespace and, if a build does not have it, loads
 * the `react-dom/test-utils` one instead. The namespace import matters: a
 * named import of a binding React 18's CommonJS module may not declare
 * would fail at link time, before the fallback could run.
 *
 * `IS_REACT_ACT_ENVIRONMENT` is the switch both majors read, set once here.
 */

import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Act = (body: () => Promise<void>) => Promise<void>;

function isAct(value: unknown): value is Act {
  return typeof value === 'function';
}

async function loadAct(): Promise<Act> {
  const own: unknown = (React as Record<string, unknown>)['act'];
  if (isAct(own)) return own;
  const utils: unknown = await import('react-dom/test-utils');
  const legacy: unknown = (utils as Record<string, unknown>)['act'];
  if (isAct(legacy)) return legacy;
  throw new Error('neither react nor react-dom/test-utils exports act');
}

const act = await loadAct();

/** The React major the suite is running against, from the runtime. */
export const reactMajor = Number(React.version.split('.')[0]);

/** A mounted tree, and the two things a test does to one. */
export interface Mounted {
  /** The element the tree was rendered into, attached to the document. */
  readonly container: HTMLElement;
  /** Renders `node` into the same root, which is what a prop change is. */
  rerender(node: ReactNode): Promise<void>;
  /** Unmounts and detaches, so the cleanup functions run. Idempotent. */
  unmount(): Promise<void>;
}

/** Mounts `node` into a fresh container attached to the document body. */
export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  let live = true;
  return {
    container,
    async rerender(next: ReactNode): Promise<void> {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount(): Promise<void> {
      if (!live) return;
      live = false;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Runs `body` inside `act`, for a mutation whose effects a test wants flushed. */
export async function flush(body: () => void = () => undefined): Promise<void> {
  await act(async () => {
    body();
  });
}

/** Dispatches `event` on `target` inside `act`, and says whether it was not prevented. */
export async function fire(target: EventTarget, event: Event): Promise<boolean> {
  let allowed = true;
  await flush(() => {
    allowed = target.dispatchEvent(event);
  });
  return allowed;
}

// ---------------------------------------------------------------------------
// Size. jsdom has no `ResizeObserver` and lays every element out at zero by
// zero, so both halves of "the viewport got a size" are supplied here.

interface Watch {
  readonly target: Element;
  readonly notify: ResizeObserverCallback;
  readonly observer: ResizeObserver;
}

const watches: Watch[] = [];
/** Every observation ever made, disconnected or not, for a notification that arrives late. */
const everWatched: Watch[] = [];

/** Installs the observer. Call it per test, before mounting. */
export function installResizeObserver(): void {
  watches.length = 0;
  everWatched.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      readonly #notify: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.#notify = callback;
      }

      observe(target: Element): void {
        const watch = { target, notify: this.#notify, observer: this };
        watches.push(watch);
        everWatched.push(watch);
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
 * Gives `element` a size, without telling anyone. Written onto `clientWidth`,
 * `clientHeight` and `getBoundingClientRect`, at the document's top left, so
 * a reading taken at mount sees the same box an observation reports.
 */
export function setSize(element: Element, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

/** Gives every watched element a size and tells its observer, inside `act`. */
export async function resizeTo(width: number, height: number): Promise<void> {
  await flush(() => {
    for (const watch of [...watches]) {
      setSize(watch.target, width, height);
      watch.notify(
        [{ target: watch.target, contentRect: { width, height } } as ResizeObserverEntry],
        watch.observer,
      );
    }
  });
}

/**
 * Delivers a resize to every observer that ever watched, including one that
 * has since disconnected: a notification the browser queued before the
 * disconnect and delivers after it.
 */
export async function resizeLate(width: number, height: number): Promise<void> {
  await flush(() => {
    for (const watch of [...everWatched]) {
      setSize(watch.target, width, height);
      watch.notify(
        [{ target: watch.target, contentRect: { width, height } } as ResizeObserverEntry],
        watch.observer,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Frames. A queue in place of `requestAnimationFrame`, on a faked
// `performance` clock, so a frame is an event the test causes and its
// timestamp is the same clock the hook reads when it starts a flight.

const queue = new Map<number, FrameRequestCallback>();
let nextHandle = 1;

/**
 * Installs the frame queue and fakes `performance`. Only `performance`: the
 * queue stands in for frames, and React's own scheduling keeps real timers.
 */
export function installFrameQueue(): void {
  queue.clear();
  nextHandle = 1;
  vi.useFakeTimers({ toFake: ['performance'] });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const handle = nextHandle;
    nextHandle += 1;
    queue.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    queue.delete(handle);
  });
}

/** How many frames are queued and unrun. */
export function pendingFrames(): number {
  return queue.size;
}

/** The queued callbacks, without running or removing them. */
export function queuedFrames(): FrameRequestCallback[] {
  return [...queue.values()];
}

/**
 * Advances the clock by `stepMs` and runs every queued frame inside `act`.
 * A frame a callback queues for itself is the NEXT frame and does not run
 * here, so a test can look at a flight in the middle.
 */
export async function runFrame(stepMs = 16): Promise<void> {
  vi.advanceTimersByTime(stepMs);
  const due = [...queue.values()];
  queue.clear();
  const now = performance.now();
  await flush(() => {
    for (const callback of due) callback(now);
  });
}

/**
 * Runs frames `stepMs` apart until nothing asks for another, and says how
 * many it took. The cap turns a loop that never settles into a named failure.
 */
export async function runFramesUntilIdle(stepMs = 16, cap = 400): Promise<number> {
  let ran = 0;
  while (queue.size > 0) {
    if (ran >= cap) throw new Error(`the frame loop ran ${String(cap)} frames without settling`);
    await runFrame(stepMs);
    ran += 1;
  }
  return ran;
}

// ---------------------------------------------------------------------------
// The rest of what jsdom lacks.

/** `prefers-reduced-motion`, answered with `reduced`. */
export function installMatchMedia(reduced = false): void {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const list = {
      matches: reduced && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return list as MediaQueryList;
  });
}

/** Elements that hold pointer capture, by pointer id. */
export const captured = new Map<number, Element>();

type CaptureMethods = Pick<Element, 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'>;
const CAPTURE_METHODS = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const;
let savedCapture: Partial<CaptureMethods> | null = null;

/**
 * Pointer capture, which jsdom does not implement. Recorded in
 * {@link captured} so a test can see that a drag captured and released.
 * Assigned onto the prototype rather than spied, because there is no
 * original to spy on, and put back by {@link uninstallDom}.
 */
export function installPointerCapture(): void {
  captured.clear();
  const proto: CaptureMethods = Element.prototype;
  savedCapture ??= {
    setPointerCapture: proto.setPointerCapture,
    releasePointerCapture: proto.releasePointerCapture,
    hasPointerCapture: proto.hasPointerCapture,
  };
  proto.setPointerCapture = function (this: Element, id: number): void {
    captured.set(id, this);
  };
  proto.releasePointerCapture = function (id: number): void {
    captured.delete(id);
  };
  proto.hasPointerCapture = function (this: Element, id: number): boolean {
    return captured.get(id) === this;
  };
}

function uninstallPointerCapture(): void {
  if (savedCapture === null) return;
  const proto: Partial<CaptureMethods> = Element.prototype;
  for (const name of CAPTURE_METHODS) {
    const original = savedCapture[name];
    if (original === undefined) delete proto[name];
    else Object.assign(proto, { [name]: original });
  }
  savedCapture = null;
}

/**
 * A pointer event with the fields the camera reads. `buttons` defaults to
 * none for the events that end a press and the primary button otherwise.
 */
export function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  x: number,
  y: number,
  init: {
    readonly pointerType?: string;
    readonly button?: number;
    readonly buttons?: number;
    readonly pointerId?: number;
    readonly isPrimary?: boolean;
  } = {},
): PointerEvent {
  const ends = type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture';
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    buttons: init.buttons ?? (ends ? 0 : 1),
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    isPrimary: init.isPrimary ?? true,
  });
}

/**
 * A mouse event of `type` at a point, for `click` and `dblclick`. `detail` is
 * the click count, which is 0 for a click the keyboard made.
 */
export function mouse(type: 'click' | 'dblclick', x: number, y: number, detail?: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    detail: detail ?? (type === 'dblclick' ? 2 : 1),
  });
}

/** Installs every stand-in above. Call it in `beforeEach`. */
export function installDom(options: { readonly reducedMotion?: boolean } = {}): void {
  installResizeObserver();
  installFrameQueue();
  installMatchMedia(options.reducedMotion ?? false);
  installPointerCapture();
}

/** Undoes {@link installDom}. Call it in `afterEach`, after unmounting. */
export function uninstallDom(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  uninstallPointerCapture();
  queue.clear();
  watches.length = 0;
  everWatched.length = 0;
  captured.clear();
}
