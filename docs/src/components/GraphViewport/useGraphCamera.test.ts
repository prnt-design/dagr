// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { installFrameQueue, runFramesUntilIdle } from '../../../../packages/react/test/frames.js';
import { mount } from '../../../../packages/react/test/mount.js';
import type { Mounted } from '../../../../packages/react/test/mount.js';
import { useGraphInteraction } from '@prnt/dagr-react';
import type { GraphHitTarget } from '@prnt/dagr-react';
import { useGraphCamera } from './useGraphCamera';
let tree: Mounted | null = null;
let bounds = { x: 0, y: 0, width: 2000, height: 1000 };
const getBounds = () => bounds;
let nodes: { x?: number; y?: number; width: number; height: number }[] = [{ width: 200, height: 100 }];
const getNodes = () => nodes;
function Harness({
  revision,
  onSelected = () => undefined,
}: {
  revision: number;
  onSelected?: (target: GraphHitTarget | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const camera = useGraphCamera(viewport, plane, 2000, 1000, true, undefined, getBounds, getNodes, revision);
  useGraphInteraction({
    surfaceRef: viewport,
    displayedRevision: revision,
    screenToWorld: (point) => camera.current.screenToWorld(point),
    hitTarget: (query) => ({
      target: { kind: 'node', nodeId: 'test' },
      displayedRevision: query.displayedRevision,
    }),
    selection: null,
    onSelectionChange: onSelected,
    onPanStart: () => camera.current.beginPan(),
    onPanBy: (delta) => camera.current.panBy(delta),
  });
  return createElement('div', { ref: viewport },
    createElement('div', { ref: plane, 'data-plane': true }),
    createElement('button', { onClick: () => camera.current.zoom(100) }, 'zoom'),
    createElement('button', { onClick: () => camera.current.focus({x:0,y:0,width:200,height:100}) }, 'first'),
    createElement('button', { onClick: () => camera.current.focus({x:8000,y:9000,width:200,height:100}) }, 'last'),
    createElement('button', {
      'data-graph-node': 'test',
      'data-dagr-interaction-target': true,
      onClick: (event) => {
        if (event.detail === 0) onSelected({ kind: 'node', nodeId: 'test' });
      },
    }, 'node'));
}
beforeEach(() => {
  installFrameQueue();
  nodes = [{ width: 200, height: 100 }];
  bounds = { x: 0, y: 0, width: 2000, height: 1000 };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(async () => { await tree?.unmount(); tree = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('refreshes changed content while idle without resetting a valid close-up', async () => {
  tree = await mount(createElement(Harness, { revision: 0 }));
  const plane = tree.container.querySelector('[data-plane]') as HTMLElement;
  (tree.container.querySelector('button') as HTMLElement).click();
  const closeup = plane.style.transform;
  await tree.rerender(createElement(Harness, { revision: 1 }));
  expect(plane.style.transform).toBe(closeup);
  bounds = { x: 10000, y: 10000, width: 200, height: 100 };
  await tree.rerender(createElement(Harness, { revision: 2 }));
  expect(plane.style.transform).not.toBe(closeup);
  // Fixed adapter-relative origin: a moved node is recentered immediately.
  expect(plane.style.transform).toContain('translate(-35960px, -35880px)');
  expect(plane.style.transform).toContain('scale(3.6)');
});

it('finishes animated focus across empty gaps while rendering a visible node', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(0);
  bounds = {x:0,y:0,width:8200,height:9100};
  nodes = [{x:0,y:0,width:200,height:100},{x:8000,y:9000,width:200,height:100}];
  tree = await mount(createElement(Harness, {revision:0}));
  await runFramesUntilIdle();
  const buttons = tree.container.querySelectorAll('button');
  buttons[1]!.click();
  await runFramesUntilIdle();
  buttons[2]!.click();
  await runFramesUntilIdle();
  const plane = tree.container.querySelector('[data-plane]') as HTMLElement;
  const [x, y, scale] = plane.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(x! + 8000 * scale!).toBeGreaterThanOrEqual(0);
  expect(x! + 8200 * scale!).toBeLessThanOrEqual(800);
  expect(y! + 9000 * scale!).toBeGreaterThanOrEqual(0);
  expect(y! + 9100 * scale!).toBeLessThanOrEqual(600);
  expect(plane.style.transform).toContain('scale(3.6)');
});

it('pans from node buttons after a threshold without selecting, while preserving clicks and controls', async () => {
  const selected = vi.fn();
  tree = await mount(createElement(Harness, { revision: 0, onSelected: selected }));
  const viewport = tree.container.firstElementChild as HTMLElement;
  const plane = tree.container.querySelector('[data-plane]') as HTMLElement;
  const node = viewport.querySelector('[data-graph-node]') as HTMLElement;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = vi.fn(() => true);
  viewport.releasePointerCapture = vi.fn();
  const pointer = (target: EventTarget, type: string, x: number, y: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    Object.defineProperty(event, 'isPrimary', { value: true });
    target.dispatchEvent(event);
  };
  const click = () => node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  pointer(node, 'pointerdown', 100, 100);
  pointer(node, 'pointermove', 102, 102);
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  pointer(node, 'pointerup', 102, 102);
  click();
  expect(selected).toHaveBeenCalledTimes(1);
  (viewport.querySelector('button') as HTMLElement).click();
  const before = plane.style.transform;
  pointer(node, 'pointerdown', 100, 100);
  pointer(node, 'pointermove', 140, 140);
  expect(plane.style.transform).not.toBe(before);
  expect(viewport.dataset.dagrDragging).toBe('true');
  pointer(node, 'lostpointercapture', 140, 140);
  expect(viewport.dataset.dagrDragging).toBe('true');
  pointer(window, 'pointerup', 140, 140, 2);
  expect(viewport.dataset.dagrDragging).toBe('true');
  pointer(window, 'pointerup', 140, 140);
  click();
  expect(selected).toHaveBeenCalledTimes(1);
  expect(viewport.dataset.dagrDragging).toBeUndefined();
  const toolbar = viewport.querySelector('button')!;
  const action = vi.fn();
  toolbar.addEventListener('click', action);
  pointer(toolbar, 'pointerdown', 10, 10);
  pointer(toolbar, 'pointerup', 10, 10);
  toolbar.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(action).toHaveBeenCalledOnce();
  node.click(); // Keyboard activation must not be swallowed after a drag.
  expect(selected).toHaveBeenCalledTimes(2);
  pointer(node, 'pointerdown', 100, 100);
  pointer(node, 'pointerup', 100, 100);
  click();
  expect(selected).toHaveBeenCalledTimes(3);
  const after = plane.style.transform;
  const control = viewport.querySelector('button')!;
  pointer(control, 'pointerdown', 100, 100);
  pointer(control, 'pointermove', 150, 150);
  pointer(control, 'pointerup', 150, 150);
  expect(plane.style.transform).toBe(after);
});
