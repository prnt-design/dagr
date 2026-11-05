import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  readonly container: HTMLElement;
  rerender(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

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
    async rerender(next) {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount() {
      if (!live) return;
      live = false;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Runs `body` and lets React, and any promise it settled, finish. */
export async function flush(body: () => void = () => undefined): Promise<void> {
  await act(async () => {
    body();
  });
}

const observers: { notify: ResizeObserverCallback; observer: ResizeObserver; targets: Element[] }[] = [];

/** jsdom lays nothing out, so a size is something a test announces. */
export function installResizeObserver(): void {
  observers.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      readonly #entry: (typeof observers)[number];
      constructor(notify: ResizeObserverCallback) {
        this.#entry = { notify, observer: this, targets: [] };
        observers.push(this.#entry);
      }
      observe(target: Element): void {
        this.#entry.targets.push(target);
      }
      unobserve(target: Element): void {
        this.#entry.targets = this.#entry.targets.filter((watched) => watched !== target);
      }
      disconnect(): void {
        this.#entry.targets = [];
      }
    },
  );
}

export async function resizeTo(width: number, height: number): Promise<void> {
  await flush(() => {
    for (const { notify, observer, targets } of observers) {
      if (targets.length === 0) continue;
      notify(
        targets.map((target) => ({ target, contentRect: { width, height } }) as ResizeObserverEntry),
        observer,
      );
    }
  });
}
