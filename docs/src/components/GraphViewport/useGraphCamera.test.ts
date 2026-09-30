// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { installFrameQueue, runFramesUntilIdle } from '../../../../packages/react/test/frames.js';
import { mount } from '../../../../packages/react/test/mount.js';
import type { Mounted } from '../../../../packages/react/test/mount.js';
import { useGraphCamera } from './useGraphCamera';
let tree: Mounted | null = null;
let bounds = { x: 0, y: 0, width: 2000, height: 1000 };
const getBounds = () => bounds;
let nodes: { x?: number; y?: number; width: number; height: number }[] = [{ width: 200, height: 100 }];
const getNodes = () => nodes;
function Harness({ revision }: { revision: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const camera = useGraphCamera(viewport, plane, 2000, 1000, true, undefined, getBounds, getNodes, revision);
  return createElement('div', { ref: viewport },
    createElement('div', { ref: plane, 'data-plane': true }),
    createElement('button', { onClick: () => camera.current.zoom(100) }, 'zoom'),
    createElement('button', { onClick: () => camera.current.focus({x:0,y:0,width:200,height:100}) }, 'first'),
    createElement('button', { onClick: () => camera.current.focus({x:8000,y:9000,width:200,height:100}) }, 'last'));
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
