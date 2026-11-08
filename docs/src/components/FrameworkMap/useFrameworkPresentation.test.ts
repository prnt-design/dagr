// @vitest-environment jsdom
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount } from '../../../../packages/react/test/mount.js';
import type { Mounted } from '../../../../packages/react/test/mount.js';
import { useFrameworkPresentation } from './useFrameworkPresentation';

let tree: Mounted | null = null;
let width = 390;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
function Harness() {
  const { hostRef, mode, chooseMode } = useFrameworkPresentation();
  return createElement(
    'div',
    { ref: hostRef, 'data-mode': mode },
    createElement('button', { onClick: () => chooseMode('map') }, 'Map'),
    createElement(
      'button',
      { onClick: () => chooseMode('outline') },
      'Outline',
    ),
  );
}
const host = () => tree!.container.firstElementChild as HTMLElement;
async function resizeTo(next: number) {
  width = next;
  await act(() =>
    resize(
      [
        {
          target: host(),
          contentRect: new DOMRect(0, 0, width, 480),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver,
    ),
  );
}
beforeEach(() => {
  width = 390;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  disconnect.mockClear();
});
it('server-renders a readable outline and measures the host, not the viewport', async () => {
  expect(renderToString(createElement(Harness))).toContain(
    'data-mode="outline"',
  );
  tree = await mount(createElement(Harness));
  expect(host().dataset.mode).toBe('outline');
  await resizeTo(959);
  expect(host().dataset.mode).toBe('outline');
  await resizeTo(960);
  expect(host().dataset.mode).toBe('map');
  await resizeTo(390);
  expect(host().dataset.mode).toBe('outline');
});
it('starts wide hosts in map after measurement and preserves both explicit choices across resizing', async () => {
  width = 1400;
  tree = await mount(createElement(Harness));
  expect(host().dataset.mode).toBe('map');
  await act(() =>
    (host().querySelectorAll('button')[1] as HTMLButtonElement).click(),
  );
  await resizeTo(390);
  await resizeTo(1400);
  expect(host().dataset.mode).toBe('outline');
  await act(() =>
    (host().querySelector('button') as HTMLButtonElement).click(),
  );
  await resizeTo(390);
  expect(host().dataset.mode).toBe('map');
  await tree.unmount();
  tree = null;
  expect(disconnect).toHaveBeenCalled();
});
