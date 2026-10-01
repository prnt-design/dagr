// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { useGraphInteraction } from '../src/index.js';
import type {
  GraphHitProvider,
  GraphHitTarget,
} from '../src/index.js';
import { mount } from './mount.js';
import type { Mounted } from './mount.js';

let tree: Mounted | null = null;

function dispatchPointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
  overrides: { readonly button?: number; readonly isPrimary?: boolean } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: overrides.button ?? 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    isPrimary: { value: overrides.isPrimary ?? true },
  });
  target.dispatchEvent(event);
  return event;
}

interface HarnessProps {
  readonly hitTarget: GraphHitProvider<number>;
  readonly onSelectionChange: (target: GraphHitTarget | null) => void;
  readonly onPanBy?: (delta: { readonly x: number; readonly y: number }) => void;
  readonly onPanEnd?: (cancelled: boolean) => void;
  readonly screenToWorld?: (css: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  };
}

function Harness({
  hitTarget,
  onSelectionChange,
  onPanBy = () => undefined,
  onPanEnd,
  screenToWorld = ({ x, y }) => ({ x: x / 2, y: -y / 2 }),
}: HarnessProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  useGraphInteraction({
    surfaceRef,
    displayedRevision: 4,
    devicePixelRatio: 2,
    screenToWorld,
    hitTarget,
    selection: null,
    onSelectionChange,
    onPanBy,
    onPanEnd,
  });
  const keyboardSelect = (event: ReactPointerEvent<HTMLButtonElement> | React.MouseEvent) => {
    if (event.detail === 0) onSelectionChange({ kind: 'node', nodeId: 'checkout' });
  };
  return createElement(
    'div',
    { ref: surfaceRef, tabIndex: 0, 'data-surface': true },
    createElement(
      'button',
      {
        type: 'button',
        'data-dagr-interaction-target': true,
        'data-node': true,
        onClick: keyboardSelect,
      },
      'Checkout',
    ),
    createElement('button', { type: 'button', 'data-toolbar': true }, 'Fit'),
    createElement('summary', { 'data-summary': true }, 'Details'),
    createElement(
      'div',
      {
        contentEditable: false,
        'data-dagr-interaction-target': true,
        'data-noneditable': true,
      },
      'Node',
    ),
    createElement(
      'div',
      { 'data-dagr-interaction-target': true },
      createElement('input', { 'data-nested-input': true }),
    ),
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 200,
    left: 100,
    top: 200,
    right: 500,
    bottom: 500,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  });
  vi.stubGlobal('devicePixelRatio', 2);
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('selects opted-in graph controls with surface-relative CSS and current world coordinates', async () => {
  const selected: Array<GraphHitTarget | null> = [];
  const queries: Parameters<GraphHitProvider<number>>[0][] = [];
  const hitTarget: GraphHitProvider<number> = (query) => {
    queries.push(query);
    return {
      target: { kind: 'node', nodeId: 'checkout' },
      displayedRevision: query.displayedRevision,
    };
  };
  tree = await mount(
    createElement(Harness, {
      hitTarget,
      onSelectionChange: (target) => selected.push(target),
    }),
  );
  const node = tree.container.querySelector('[data-node]')!;

  dispatchPointer(node, 'pointerdown', 110, 220);
  dispatchPointer(window, 'pointerup', 110, 220);

  expect(selected).toEqual([{ kind: 'node', nodeId: 'checkout' }]);
  expect(queries).toEqual([
    {
      css: { x: 10, y: 20 },
      world: { x: 5, y: -10 },
      devicePixelRatio: 2,
      displayedRevision: 4,
    },
    {
      css: { x: 10, y: 20 },
      world: { x: 5, y: -10 },
      devicePixelRatio: 2,
      displayedRevision: 4,
    },
  ]);
});

it('leaves native, shadow, and nested controls alone without excluding noneditable targets', async () => {
  const hitTarget = vi.fn<GraphHitProvider<number>>((query) => ({
    target: null,
    displayedRevision: query.displayedRevision,
  }));
  tree = await mount(
    createElement(Harness, {
      hitTarget,
      onSelectionChange: () => undefined,
    }),
  );
  const toolbar = tree.container.querySelector('[data-toolbar]')!;
  const input = tree.container.querySelector('[data-nested-input]')!;
  const summary = tree.container.querySelector('[data-summary]')!;
  const noneditable = tree.container.querySelector('[data-noneditable]')!;
  const surface = tree.container.querySelector('[data-surface]')!;
  const shadowHost = document.createElement('div');
  const shadowButton = document.createElement('button');
  shadowHost.attachShadow({ mode: 'open' }).append(shadowButton);
  surface.append(shadowHost);

  dispatchPointer(toolbar, 'pointerdown', 110, 220);
  dispatchPointer(input, 'pointerdown', 110, 220);
  dispatchPointer(summary, 'pointerdown', 110, 220);
  dispatchPointer(shadowButton, 'pointerdown', 110, 220);
  expect(hitTarget).not.toHaveBeenCalled();

  dispatchPointer(noneditable, 'pointerdown', 110, 220);
  dispatchPointer(window, 'pointerup', 110, 220);
  expect(hitTarget).toHaveBeenCalledTimes(2);

  await tree.unmount();
  tree = null;
  dispatchPointer(surface, 'pointerdown', 110, 220);
  expect(hitTarget).toHaveBeenCalledTimes(2);
});

it('does not convert unrelated window pointer movement', async () => {
  const screenToWorld = vi.fn(({ x, y }) => ({ x, y }));
  tree = await mount(
    createElement(Harness, {
      hitTarget: (query) => ({ target: null, displayedRevision: query.displayedRevision }),
      onSelectionChange: () => undefined,
      screenToWorld,
    }),
  );

  dispatchPointer(window, 'pointermove', 110, 220);

  expect(screenToWorld).not.toHaveBeenCalled();
});

it('captures touch only after threshold, cancels without selection, and preserves keyboard clicks', async () => {
  const selected: Array<GraphHitTarget | null> = [];
  const pans: Array<{ readonly x: number; readonly y: number }> = [];
  const hitTarget: GraphHitProvider<number> = (query) => ({
    target: { kind: 'node', nodeId: 'checkout' },
    displayedRevision: query.displayedRevision,
  });
  tree = await mount(
    createElement(Harness, {
      hitTarget,
      onSelectionChange: (target) => selected.push(target),
      onPanBy: (delta) => pans.push(delta),
    }),
  );
  const node = tree.container.querySelector('[data-node]') as HTMLElement;
  const surface = tree.container.querySelector('[data-surface]') as HTMLElement;
  const capture = vi.fn();
  const release = vi.fn();
  surface.setPointerCapture = capture;
  surface.hasPointerCapture = vi.fn(() => true);
  surface.releasePointerCapture = release;

  dispatchPointer(node, 'pointerdown', 110, 220, 8);
  dispatchPointer(window, 'pointermove', 113, 223.99, 8);
  expect(capture).not.toHaveBeenCalled();
  dispatchPointer(window, 'pointermove', 113, 224, 8);
  expect(capture).toHaveBeenCalledWith(8);
  expect(surface.dataset.dagrDragging).toBe('true');
  expect(pans).toEqual([{ x: 3, y: 4 }]);
  dispatchPointer(node, 'pointerdown', 113, 224, 9, { isPrimary: false });

  dispatchPointer(window, 'pointercancel', 113, 224, 8);
  expect(release).toHaveBeenCalledWith(8);
  expect(surface.dataset.dagrDragging).toBeUndefined();
  expect(selected).toEqual([]);

  const pointerClick = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 1,
  });
  const pointerDoubleClick = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  expect(node.dispatchEvent(pointerClick)).toBe(false);
  expect(node.dispatchEvent(pointerDoubleClick)).toBe(false);
  expect(selected).toEqual([]);

  node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  expect(selected).toEqual([{ kind: 'node', nodeId: 'checkout' }]);
});

it('cancels an active pan and releases capture on unmount', async () => {
  const ended: boolean[] = [];
  tree = await mount(
    createElement(Harness, {
      hitTarget: (query) => ({ target: null, displayedRevision: query.displayedRevision }),
      onSelectionChange: () => undefined,
      onPanEnd: (cancelled) => ended.push(cancelled),
    }),
  );
  const surface = tree.container.querySelector('[data-surface]') as HTMLElement;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = vi.fn(() => true);
  surface.releasePointerCapture = vi.fn();

  dispatchPointer(surface, 'pointerdown', 110, 220, 6);
  dispatchPointer(window, 'pointermove', 115, 220, 6);
  await tree.unmount();
  tree = null;

  expect(surface.releasePointerCapture).toHaveBeenCalledWith(6);
  expect(ended).toEqual([true]);
});
