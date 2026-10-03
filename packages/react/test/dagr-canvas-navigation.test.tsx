// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import type { SceneNode } from '@prnt/dagr-render';
import { DagrCanvas } from '../src/DagrCanvas.js';
import type { DagrCanvasApi } from '../src/index.js';
import { lastOverlay, lastRenderer, resetFakes } from './fake-render.js';
import { installFrameQueue, runFrames, runFramesUntilIdle } from './frames.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';
import { installResizeObserver, resizeTo } from './resize.js';

let tree: Mounted | null = null;
beforeEach(() => {
  resetFakes();
  installFrameQueue();
  installResizeObserver();
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.unstubAllGlobals();
});

const config = { defaultNodeSize: { width: 200, height: 100 } };
function twoNodes(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b');
  return graph;
}

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}

function host(): HTMLElement {
  const element = tree?.container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('no host');
  return element;
}

async function ready(element: Parameters<typeof mount>[0]): Promise<void> {
  tree = await mount(element);
  await flush(() => resizeTo(800, 600));
  await runFramesUntilIdle();
}

function screenOf(id: string): { x: number; y: number } {
  const renderer = lastRenderer();
  const nodes = renderer.setNodes.mock.calls.at(-1)?.[0] as readonly SceneNode[];
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return renderer.camera.worldToScreen(node.center);
}

function click(x: number, y: number): void {
  pointer(host(), 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
}

describe('node click and hover', () => {
  it('reports the clicked node id, and background clicks, with exact hits', async () => {
    const onNodeClick = vi.fn();
    const onBackgroundClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} onNodeClick={onNodeClick} onBackgroundClick={onBackgroundClick} />);
    const a = screenOf('a');
    const b = screenOf('b');
    await flush(() => click(a.x, a.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('a');
    await flush(() => click(b.x, b.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('b');
    expect(onBackgroundClick).not.toHaveBeenCalled();
    await flush(() => click(1, 1));
    expect(onBackgroundClick).toHaveBeenCalledOnce();
    expect(onNodeClick).toHaveBeenCalledTimes(2);
  });

  it('does not click after a drag, and a drag pans only with navigation', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} onNodeClick={onNodeClick} />);
    const camera = lastRenderer().camera;
    const before = camera.center;
    const a = screenOf('a');
    await flush(() => {
      pointer(host(), 'pointerdown', a.x, a.y);
      pointer(window, 'pointermove', a.x + 40, a.y);
      pointer(window, 'pointerup', a.x + 40, a.y);
    });
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(camera.center.x).not.toBe(before.x);
  });

  it('reports hover changes and clears on leave', async () => {
    const onNodeHover = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} onNodeHover={onNodeHover} />);
    const a = screenOf('a');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    await flush(() => pointer(host(), 'pointermove', a.x + 1, a.y));
    expect(onNodeHover.mock.calls).toEqual([['a']]);
    await flush(() => pointer(host(), 'pointermove', 1, 1));
    await flush(() => host().dispatchEvent(new Event('pointerleave')));
    expect(onNodeHover.mock.calls).toEqual([['a'], [null]]);
  });
});

describe('picking while animating', () => {
  it('hits the node where it is drawn mid-glide, and refuses a click whose drawing changed under it', async () => {
    const graph = twoNodes();
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={graph} config={config} animate cameraLimits={false} onNodeClick={onNodeClick} />);
    await flush(() => {
      graph.batch(() => {
        graph.addNode('c');
        graph.addEdge('a', 'c');
      });
    });
    await runFrames(16);
    await runFrames(32);
    const drawn = lastRenderer().setNodes.mock.calls.at(-1)?.[0] as readonly SceneNode[];
    const layoutB = drawn.find((n) => n.id === 'b');
    if (layoutB === undefined) throw new Error('no b');
    const mid = lastRenderer().camera.worldToScreen(layoutB.center);
    await flush(() => click(mid.x, mid.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('b');

    // Press, let a frame redraw the nodes, release: the revision moved, so no click.
    onNodeClick.mockClear();
    await flush(() => pointer(host(), 'pointerdown', mid.x, mid.y));
    await runFrames(48);
    await flush(() => pointer(window, 'pointerup', mid.x, mid.y));
    expect(onNodeClick).not.toHaveBeenCalled();
    await runFramesUntilIdle();
  });
});

describe('navigation', () => {
  it('is off by default: not focusable and the wheel is left alone', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} />);
    expect(host().hasAttribute('tabindex')).toBe(false);
    const camera = lastRenderer().camera;
    const zoom = camera.zoom;
    const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    await flush(() => host().dispatchEvent(event));
    expect(camera.zoom).toBe(zoom);
    expect(event.defaultPrevented).toBe(false);
  });

  it('zooms under the cursor on wheel, inside the camera limits', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="Graph" />);
    expect(host().getAttribute('tabindex')).toBe('0');
    expect(host().getAttribute('aria-label')).toBe('Graph');
    const camera = lastRenderer().camera;
    const anchor = { x: 200, y: 150 };
    const world = camera.screenToWorld(anchor);
    const zoom = camera.zoom;
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: anchor.x, clientY: anchor.y, cancelable: true, bubbles: true });
    await flush(() => host().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(camera.zoom).toBeGreaterThan(zoom);
    const after = camera.worldToScreen(world);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it('keeps wheel zoom and pan inside the default camera limits', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation />);
    const camera = lastRenderer().camera;
    for (let i = 0; i < 40; i += 1) {
      await flush(() => host().dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true })));
    }
    expect(camera.zoom).toBeCloseTo(camera.minZoom);
    for (let i = 0; i < 80; i += 1) {
      await flush(() => host().dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true })));
    }
    expect(camera.zoom).toBeCloseTo(camera.maxZoom);
  });

  it('answers the keyboard when the canvas itself has focus, and fits on 0', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation />);
    const camera = lastRenderer().camera;
    const fitZoom = camera.zoom;
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      host().dispatchEvent(event);
      return event;
    };
    await flush(() => press('+'));
    expect(camera.zoom).toBeGreaterThan(fitZoom);
    const unhandled = press('q');
    expect(unhandled.defaultPrevented).toBe(false);
    await flush(() => press('0'));
    await runFramesUntilIdle(500);
    expect(camera.zoom).toBeCloseTo(fitZoom);
  });
});

describe('camera api', () => {
  it('focusNode centres the node and zooms to it; fit frames the graph again', async () => {
    const api = createRef<DagrCanvasApi>();
    await ready(<DagrCanvas graph={twoNodes()} config={config} cameraLimits={false} apiRef={api} />);
    const camera = lastRenderer().camera;
    const fitted = camera.zoom;
    let ok = false;
    await flush(() => {
      ok = api.current?.focusNode('b', { durationMs: 0, zoom: 4 }) ?? false;
    });
    expect(ok).toBe(true);
    const b = screenOf('b');
    expect(b.x).toBeCloseTo(400, 0);
    expect(b.y).toBeCloseTo(300, 0);
    expect(camera.zoom).toBeGreaterThan(fitted);
    await flush(() => api.current?.fit({ durationMs: 0 }));
    expect(camera.zoom).toBeCloseTo(fitted);
  });

  it('flies over frames by default and refuses unknown ids', async () => {
    const api = createRef<DagrCanvasApi>();
    await ready(<DagrCanvas graph={twoNodes()} config={config} cameraLimits={false} apiRef={api} />);
    const camera = lastRenderer().camera;
    const fitted = camera.zoom;
    let missing = true;
    await flush(() => {
      missing = api.current?.focusNode('nope') ?? true;
      api.current?.focusNode('a', { zoom: 4 });
    });
    expect(missing).toBe(false);
    expect(camera.zoom).toBeCloseTo(fitted);
    await runFramesUntilIdle(100, 1000);
    expect(camera.zoom).toBeGreaterThan(fitted);
  });
});

describe('nodeTiers', () => {
  it('registers every tier per node, tags elements with the node id, and activates from the keyboard', async () => {
    const onNodeClick = vi.fn();
    const tiers = [
      {
        name: 'label',
        minScreenWidth: 20,
        maxScreenWidth: 160,
        create: () => document.createElement('div'),
        update: (element: HTMLElement, node: { id: string; data: string }) => {
          element.textContent = node.data;
        },
      },
      {
        name: 'card',
        minScreenWidth: 160,
        create: () => document.createElement('div'),
        update: (element: HTMLElement, node: { id: string; data: string }) => {
          element.textContent = `card ${node.data}`;
        },
      },
    ];
    const nodeData = (id: string): string => `data-${id}`;
    await ready(<DagrCanvas graph={twoNodes()} config={config} nodeTiers={tiers} nodeData={nodeData} onNodeClick={onNodeClick} />);
    const overlay = lastOverlay();
    expect(overlay.entries.filter((e) => !e.removed)).toHaveLength(4);
    const first = overlay.entries[0];
    const element = first?.init.create();
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    expect(element.dataset.dagrNodeId).toBe('a');
    expect(element.textContent).toBe('data-a');
    host().append(element);
    element.tabIndex = 0;
    await flush(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(onNodeClick).toHaveBeenCalledWith('a');
    await tree?.rerender(<DagrCanvas graph={twoNodes()} config={config} />);
    expect(lastOverlay().entries.every((e) => e.removed)).toBe(true);
  });
});
