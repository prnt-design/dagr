// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import type { RichNodeTier, SceneNode } from '@prnt/dagr-render';
import { DagrCanvas } from '../src/DagrCanvas.js';
import type { DagrCanvasApi } from '../src/index.js';
import { built, lastOverlay, lastRenderer, resetFakes } from './fake-render.js';
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

/**
 * Makes the latest renderer's `pickNode` answer from the node boxes it was last
 * given, a frame later when `nextFrame` is set, as a device readback does.
 */
function pickFromBoxes(nextFrame = false): void {
  const renderer = lastRenderer();
  renderer.pickNode.mockImplementation((css) => {
    if (nextFrame) {
      return new Promise((resolve) => requestAnimationFrame(() => resolve(boxAt(renderer, css))));
    }
    return Promise.resolve(boxAt(renderer, css));
  });
}

function boxAt(renderer: ReturnType<typeof lastRenderer>, css: { readonly x: number; readonly y: number }): string | null {
  const world = renderer.camera.screenToWorld(css);
  const nodes = renderer.setNodes.mock.calls.at(-1)?.[0] as readonly SceneNode[];
  const node = nodes.find(
    (n) => Math.abs(world.x - n.center.x) <= n.size.width / 2 && Math.abs(world.y - n.center.y) <= n.size.height / 2,
  );
  return node?.id ?? null;
}

function tap(pointerType: string, x: number, y: number): void {
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 2 }, isPrimary: { value: true }, pointerType: { value: pointerType } });
    (type === 'pointerdown' ? host() : window).dispatchEvent(event);
  }
}

describe('GPU hit testing', () => {
  it('answers hover and a hovered click from settled picks, and ignores a press nothing picked', async () => {
    const onNodeHover = vi.fn();
    const onNodeClick = vi.fn();
    await ready(
      <DagrCanvas graph={twoNodes()} config={config} hitTesting="gpu" onNodeHover={onNodeHover} onNodeClick={onNodeClick} />,
    );
    pickFromBoxes();
    const a = screenOf('a');
    const b = screenOf('b');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    expect(lastRenderer().pickNode).toHaveBeenCalledWith({ x: a.x, y: a.y });
    expect(onNodeHover.mock.calls).toEqual([['a']]);
    await flush(() => click(a.x, a.y));
    expect(onNodeClick.mock.calls).toEqual([['a']]);

    await flush(() => click(b.x, b.y));
    expect(onNodeClick.mock.calls).toEqual([['a']]);
    await flush(() => pointer(host(), 'pointermove', b.x, b.y));
    await flush(() => click(b.x, b.y));
    expect(onNodeClick.mock.calls).toEqual([['a'], ['b']]);
    expect(onNodeHover.mock.calls).toEqual([['a'], ['b']]);
  });

  it('asks a resting mouse again after a wheel zoom, so the next click lands without a move', async () => {
    const onNodeClick = vi.fn();
    await ready(
      <DagrCanvas graph={twoNodes()} config={config} navigation label="graph" cameraLimits={false} hitTesting="gpu" onNodeClick={onNodeClick} />,
    );
    pickFromBoxes();
    const a = screenOf('a');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    const before = lastRenderer().camera.screenToWorld(a);
    const wheel = new WheelEvent('wheel', { deltaY: -100, clientX: a.x + 30, clientY: a.y + 20, cancelable: true, bubbles: true });
    await flush(() => host().dispatchEvent(wheel));
    await runFramesUntilIdle();
    expect(lastRenderer().camera.screenToWorld(a)).not.toEqual(before);
    await flush(() => click(a.x, a.y));
    expect(onNodeClick.mock.calls).toEqual([['a']]);
  });

  it('primes picks for a background click with no hover or node handler', async () => {
    const onBackgroundClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} hitTesting="gpu" onBackgroundClick={onBackgroundClick} />);
    await flush(() => pointer(host(), 'pointermove', 1, 1));
    await flush(() => click(1, 1));
    expect(onBackgroundClick).toHaveBeenCalledOnce();
  });

  it('keeps the CPU index for touch and pen, and by default', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} hitTesting="gpu" onNodeClick={onNodeClick} />);
    const a = screenOf('a');
    const b0 = screenOf('b');
    await flush(() => tap('touch', a.x, a.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('a');
    await flush(() => tap('pen', b0.x, b0.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('b');
    expect(lastRenderer().pickNode).not.toHaveBeenCalled();
    await tree?.unmount();

    await ready(<DagrCanvas graph={twoNodes()} config={config} onNodeHover={vi.fn()} onNodeClick={onNodeClick} />);
    const b = screenOf('b');
    await flush(() => pointer(host(), 'pointermove', b.x, b.y));
    await flush(() => click(b.x, b.y));
    expect(onNodeClick).toHaveBeenLastCalledWith('b');
    expect(lastRenderer().pickNode).not.toHaveBeenCalled();
  });

  it('never answers from a pick the lost renderer settled', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} hitTesting="gpu" onNodeClick={onNodeClick} />);
    pickFromBoxes();
    const before = screenOf('a');
    await flush(() => pointer(host(), 'pointermove', before.x, before.y));
    const options = built.renderers.at(-1)?.options;
    await flush(() => options?.onContextLost?.({ backend: 'webgpu', reason: 'device-lost' }));
    await runFramesUntilIdle();
    expect(built.renderers).toHaveLength(2);
    // Same drawing under the same camera, so only a new provider keeps the old pick from answering.
    const [lost, rebuilt] = built.renderers;
    if (lost === undefined || rebuilt === undefined) throw new Error('no rebuild');
    expect(rebuilt.setNodes.mock.calls.at(-1)?.[0]).toBe(lost.setNodes.mock.calls.at(-1)?.[0]);
    rebuilt.camera.setZoom(lost.camera.zoom);
    rebuilt.camera.setCenter(lost.camera.center);
    pickFromBoxes();
    const a = screenOf('a');
    expect(a).toEqual(before);
    expect(rebuilt.camera.screenToWorld(a)).toEqual(lost.camera.screenToWorld(before));
    await flush(() => click(a.x, a.y));
    expect(onNodeClick).not.toHaveBeenCalled();
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    await flush(() => click(a.x, a.y));
    expect(onNodeClick.mock.calls).toEqual([['a']]);
  });

  it('picks one at a time under a resting pointer while nodes glide, and stops at rest', async () => {
    const graph = twoNodes();
    const onNodeHover = vi.fn();
    await ready(
      <DagrCanvas graph={graph} config={config} animate cameraLimits={false} hitTesting="gpu" onNodeHover={onNodeHover} />,
    );
    pickFromBoxes(true);
    const a = screenOf('a');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    await flush(() => {
      graph.batch(() => {
        graph.addNode('c');
        graph.addEdge('a', 'c');
      });
    });
    const frames = await runFramesUntilIdle();
    const picks = lastRenderer().pickNode.mock.calls.length;
    expect(picks).toBeGreaterThan(1);
    expect(picks).toBeLessThanOrEqual(frames + 2);
    await runFrames(16);
    expect(lastRenderer().pickNode.mock.calls.length).toBe(picks);
    expect(onNodeHover).toHaveBeenCalled();
  });

  it('reports nothing for a pick that settles after unmount', async () => {
    const onNodeHover = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} hitTesting="gpu" onNodeHover={onNodeHover} />);
    let settle: (id: string | null) => void = () => undefined;
    lastRenderer().pickNode.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const a = screenOf('a');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    await tree?.unmount();
    tree = null;
    await flush(() => settle('a'));
    expect(onNodeHover).not.toHaveBeenCalled();
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

  it('zooms from the keyboard about the middle of the inset frame', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} cameraLimits={false} inset={{ right: 300 }} navigation />);
    const camera = lastRenderer().camera;
    const middle = camera.screenToWorld({ x: 250, y: 300 });
    await flush(() => host().dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })));
    const after = camera.worldToScreen(middle);
    expect(after.x).toBeCloseTo(250, 6);
    expect(after.y).toBeCloseTo(300, 6);
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

  it('frames the first fit, fit and focusNode in what the inset leaves', async () => {
    const api = createRef<DagrCanvasApi>();
    const inset = { right: 300, top: 100 };
    const graph = twoNodes();
    await ready(<DagrCanvas graph={graph} config={config} inset={inset} apiRef={api} />);
    const camera = lastRenderer().camera;
    expect(camera.frame).toEqual({ x: 0, y: 100, width: 500, height: 500 });
    const middle = { x: 250, y: 350 };
    const centreOfAB = (): { x: number; y: number } => {
      const a = screenOf('a');
      const b = screenOf('b');
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    expect(centreOfAB().x).toBeCloseTo(middle.x, 6);
    expect(centreOfAB().y).toBeCloseTo(middle.y, 6);
    const fitted = camera.zoom;
    camera.setZoom(camera.maxZoom);
    camera.panByScreen(-80, 40);
    await flush(() => api.current?.fit({ durationMs: 0 }));
    expect(camera.zoom).toBeCloseTo(fitted, 9);
    expect(centreOfAB().x).toBeCloseTo(middle.x, 6);
    expect(centreOfAB().y).toBeCloseTo(middle.y, 6);
    // Limits off: at the content's edge they would stop a node short of the middle, inset or not.
    await tree?.rerender(<DagrCanvas graph={graph} config={config} inset={inset} cameraLimits={false} apiRef={api} />);
    await flush(() => api.current?.focusNode('b', { durationMs: 0 }));
    expect(screenOf('b').x).toBeCloseTo(middle.x, 6);
    expect(screenOf('b').y).toBeCloseTo(middle.y, 6);
    await flush(() => api.current?.fit({ durationMs: 0 }));
    expect(centreOfAB().x).toBeCloseTo(middle.x, 6);
    expect(centreOfAB().y).toBeCloseTo(middle.y, 6);
  });

  it('keeps the camera when the inset changes, and frames the whole canvas without one', async () => {
    const api = createRef<DagrCanvasApi>();
    const graph = twoNodes();
    await ready(<DagrCanvas graph={graph} config={config} cameraLimits={false} apiRef={api} />);
    const camera = lastRenderer().camera;
    const center = { ...camera.center };
    const zoom = camera.zoom;
    await tree?.rerender(<DagrCanvas graph={graph} config={config} cameraLimits={false} inset={{ left: 200 }} apiRef={api} />);
    expect(camera.frame).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    expect(camera.center).toEqual(center);
    expect(camera.zoom).toBe(zoom);
    await tree?.rerender(<DagrCanvas graph={graph} config={config} cameraLimits={false} apiRef={api} />);
    expect(camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('re-clamps a camera at the content edge into the new frame', async () => {
    const graph = twoNodes();
    await ready(<DagrCanvas graph={graph} config={config} />);
    const camera = lastRenderer().camera;
    camera.setZoom(camera.maxZoom);
    camera.panByScreen(1e9, 0);
    const leftEdge = (): number => Math.min(...['a', 'b'].map((id) => screenOf(id).x)) - camera.zoom * 100;
    expect(leftEdge()).toBeCloseTo(800 * 0.05, 6);
    await tree?.rerender(<DagrCanvas graph={graph} config={config} inset={{ left: 200 }} />);
    expect(leftEdge()).toBeCloseTo(200 + 600 * 0.05, 6);
  });

  describe('under a visual viewport', () => {
    class FakeVisualViewport extends EventTarget {
      offsetLeft = 0;
      offsetTop = 0;
      width = 800;
      height = 600;
      scale = 1;
    }
    let visual: FakeVisualViewport;
    const root = document.documentElement;
    beforeEach(() => {
      visual = new FakeVisualViewport();
      vi.stubGlobal('visualViewport', visual);
      Object.defineProperty(root, 'clientWidth', { configurable: true, value: 800 });
      Object.defineProperty(root, 'clientHeight', { configurable: true, value: 600 });
    });
    afterEach(() => {
      Reflect.deleteProperty(root, 'clientWidth');
      Reflect.deleteProperty(root, 'clientHeight');
    });
    async function change(next: Partial<FakeVisualViewport>, type = 'resize'): Promise<void> {
      Object.assign(visual, next);
      await flush(() => visual.dispatchEvent(new Event(type)));
    }

    it('fits first in what a short visual viewport leaves, and keeps the camera as it grows back', async () => {
      visual.height = 400;
      await ready(<DagrCanvas graph={twoNodes()} config={config} cameraLimits={false} />);
      const camera = lastRenderer().camera;
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 400 });
      expect((screenOf('a').y + screenOf('b').y) / 2).toBeCloseTo(200, 6);
      const center = { ...camera.center };
      const zoom = camera.zoom;
      await change({ height: 600 });
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
      expect(camera.center).toEqual(center);
      expect(camera.zoom).toBe(zoom);
      await change({ offsetTop: 150, height: 450 }, 'scroll');
      expect(camera.frame).toEqual({ x: 0, y: 150, width: 800, height: 450 });
    });

    it('takes the larger of the inset and the visual viewport on each side, and nothing while the page is zoomed', async () => {
      const graph = twoNodes();
      await ready(<DagrCanvas graph={graph} config={config} inset={{ right: 300, bottom: 100 }} />);
      const camera = lastRenderer().camera;
      await change({ width: 700, height: 400 });
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 500, height: 400 });
      await tree?.rerender(<DagrCanvas graph={graph} config={config} inset={{ bottom: Infinity }} />);
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 700, height: 400 });
      await tree?.rerender(<DagrCanvas graph={graph} config={config} inset={{ bottom: 300 }} />);
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 700, height: 300 });
      await tree?.rerender(<DagrCanvas graph={graph} config={config} />);
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 700, height: 400 });
      await change({ scale: 2 });
      expect(camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    });

    it('leaves out what the layout viewport already hides of the canvas', async () => {
      Object.defineProperty(root, 'clientHeight', { configurable: true, value: 500 });
      visual.height = 500;
      await ready(<DagrCanvas graph={twoNodes()} config={config} />);
      expect(lastRenderer().camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
      await change({ height: 300 });
      expect(lastRenderer().camera.frame).toEqual({ x: 0, y: 0, width: 800, height: 400 });
    });

    it('stops listening when unmounted', async () => {
      const added = vi.spyOn(visual, 'addEventListener');
      const removed = vi.spyOn(visual, 'removeEventListener');
      await ready(<DagrCanvas graph={twoNodes()} config={config} />);
      await tree?.rerender(<DagrCanvas graph={twoNodes()} config={config} inset={{ top: 10 }} />);
      expect(added.mock.calls.length).toBeGreaterThan(0);
      await tree?.unmount();
      tree = null;
      expect(removed.mock.calls).toEqual(added.mock.calls);
    });
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

describe('keyboard activation and wheel ownership', () => {
  it('leaves Enter and Space to native controls inside a tagged card', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation onNodeClick={onNodeClick} />);
    const card = document.createElement('div');
    card.dataset.dagrNodeId = 'a';
    const input = document.createElement('input');
    card.append(input);
    host().append(card);
    const key = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await flush(() => input.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('lets a marked scroller keep the wheel, and rejects a non-positive focus zoom', async () => {
    const api = createRef<DagrCanvasApi>();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} apiRef={api} />);
    const scroller = document.createElement('div');
    scroller.dataset.dagrNoZoom = '';
    host().append(scroller);
    const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    await flush(() => scroller.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
    expect(api.current?.focusNode('a', { zoom: 0 })).toBe(false);
  });
});

function tierFor(): RichNodeTier<string> {
  return {
    name: 'card',
    minScreenWidth: 20,
    create: () => document.createElement('div'),
    update: (element, node) => {
      element.textContent = node.data;
    },
  };
}

describe('tier typing', () => {
  it('requires nodeData when tiers are written for your own data type', () => {
    interface Item {
      readonly title: string;
    }
    const itemTier: RichNodeTier<Item> = {
      name: 'item',
      create: () => document.createElement('div'),
      update: (element, node) => {
        element.textContent = node.data.title;
      },
    };
    const graph = twoNodes();
    // Fine: tiers over the node id, no nodeData.
    void (<DagrCanvas graph={graph} nodeTiers={[tierFor()]} />);
    // Fine: tiers over Item with the function that produces Item.
    void (<DagrCanvas graph={graph} nodeTiers={[itemTier]} nodeData={() => ({ title: 't' })} />);
    // @ts-expect-error tiers over Item without nodeData would receive an id as an Item
    void (<DagrCanvas graph={graph} nodeTiers={[itemTier]} />);
    // @ts-expect-error nodeData without nodeTiers has nothing to feed
    void (<DagrCanvas graph={graph} nodeData={() => 'x'} />);
  });
});

describe('focus, labels and fit', () => {
  it('moves focus to the node\'s new element when a pooled card is replaced, or to the canvas when it has none', async () => {
    const api = createRef<DagrCanvasApi>();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation label="g" apiRef={api} nodeTiers={[tierFor()]} onNodeClick={() => undefined} />);
    const entries = lastOverlay().entries;
    const make = (): HTMLElement => {
      const element = entries[0]?.init.create();
      if (!(element instanceof HTMLElement)) throw new Error('no element');
      host().append(element);
      return element;
    };
    const first = make();
    expect(first.getAttribute('role')).toBe('button');
    expect(first.tabIndex).toBe(0);
    await flush(() => first.focus());
    expect(document.activeElement).toBe(first);

    first.remove();
    const second = make();
    await flush(() => api.current?.fit({ durationMs: 0 }));
    await runFramesUntilIdle();
    expect(document.activeElement).toBe(second);

    second.remove();
    await flush(() => api.current?.fit({ durationMs: 0 }));
    await runFramesUntilIdle();
    expect(document.activeElement).toBe(host());
  });

  it('lets go once the user moves focus elsewhere', async () => {
    const api = createRef<DagrCanvasApi>();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation label="g" apiRef={api} nodeTiers={[tierFor()]} onNodeClick={() => undefined} />);
    const element = lastOverlay().entries[0]?.init.create();
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    host().append(element);
    const outside = document.createElement('button');
    document.body.append(outside);
    await flush(() => element.focus());
    await flush(() => outside.focus());
    await Promise.resolve();
    await flush(() => api.current?.fit({ durationMs: 0 }));
    await runFramesUntilIdle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('does not swallow Enter without onNodeClick, and fit reports whether it moved', async () => {
    const api = createRef<DagrCanvasApi>();
    expect(api.current).toBeNull();
    await ready(<DagrCanvas graph={twoNodes()} config={config} apiRef={api} nodeTiers={[tierFor()]} />);
    const element = lastOverlay().entries[0]?.init.create();
    if (!(element instanceof HTMLElement)) throw new Error('no element');
    host().append(element);
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await flush(() => element.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    expect(element.hasAttribute('role')).toBe(false);
    let moved = false;
    await flush(() => {
      moved = api.current?.fit({ durationMs: 0 }) ?? false;
    });
    expect(moved).toBe(true);
  });

  it('names the region whenever a label is given, and warns at most once about an unlabelled navigation canvas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ready(<DagrCanvas graph={twoNodes()} config={config} label="Plain" />);
    expect(host().getAttribute('aria-label')).toBe('Plain');
    expect(host().getAttribute('role')).toBe('group');
    expect(host().hasAttribute('tabindex')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    await tree?.unmount();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation />);
    await tree?.unmount();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation />);
    // The flag is per page, and earlier tests in this file may have spent it.
    expect(warn.mock.calls.filter(([m]) => String(m).includes('accessible name')).length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });
});

describe('touch pinch', () => {
  function touch(target: EventTarget, type: string, id: number, x: number, y: number): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
      pointerId: { value: id },
      isPrimary: { value: id === 1 },
      pointerType: { value: 'touch' },
    });
    target.dispatchEvent(event);
  }

  it.each(['node', 'edge'] as const)('does not hover a %s while two touches are down', async (kind) => {
    const onNodeHover = vi.fn();
    const onEdgeHover = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} onNodeHover={onNodeHover} onEdgeHover={onEdgeHover} />);
    const a = screenOf('a');
    const b = screenOf('b');
    await flush(() => {
      touch(host(), 'pointerdown', 1, a.x - 100, a.y);
      touch(host(), 'pointerdown', 2, a.x, a.y);
      const target = kind === 'node' ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      touch(host(), 'pointermove', 2, target.x, target.y);
    });
    expect(onNodeHover).not.toHaveBeenCalled();
    expect(onEdgeHover).not.toHaveBeenCalled();
  });

  it('keeps selection and single-pointer pan suppressed during a hybrid press', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} onNodeClick={onNodeClick} />);
    const camera = lastRenderer().camera;
    const zoom = camera.zoom;
    const world = camera.screenToWorld({ x: 150, y: 100 });
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
    });
    const a = screenOf('a');
    await flush(() => {
      for (const [target, type] of [[host(), 'pointerdown'], [window, 'pointerup']] as const) {
        const event = new MouseEvent(type, { bubbles: true, clientX: a.x, clientY: a.y, button: 0 });
        Object.defineProperties(event, { pointerId: { value: 99 }, isPrimary: { value: true }, pointerType: { value: 'mouse' } });
        target.dispatchEvent(event);
      }
    });
    expect(onNodeClick).not.toHaveBeenCalled();
    await flush(() => touch(host(), 'pointermove', 1, 120, 100));
    expect(camera.zoom).toBeCloseTo(zoom * 0.8);
    const after = camera.worldToScreen(world);
    expect(after.x).toBeCloseTo(160);
    expect(after.y).toBeCloseTo(100);
  });

  it('allows a mouse click after a completed pinch', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} onNodeClick={onNodeClick} />);
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
      touch(window, 'pointermove', 2, 220, 100);
      touch(window, 'pointerup', 2, 220, 100);
      touch(window, 'pointerup', 1, 100, 100);
    });
    expect(onNodeClick).not.toHaveBeenCalled();
    const a = screenOf('a');
    await flush(() => click(a.x, a.y));
    expect(onNodeClick).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('continues pinching when a third finger arrives and ignores that finger', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" />);
    const camera = lastRenderer().camera;
    const zoom = camera.zoom;
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
      touch(host(), 'pointerdown', 3, 600, 100);
      touch(window, 'pointermove', 2, 300, 100);
    });
    expect(camera.zoom).toBeCloseTo(zoom * 2);
    const center = { ...camera.center };
    await flush(() => {
      touch(window, 'pointermove', 3, 700, 100);
      touch(window, 'pointerup', 3, 700, 100);
    });
    expect(camera.center).toEqual(center);
    expect(camera.zoom).toBeCloseTo(zoom * 2);
  });

  it.each(['pointercancel', 'lostpointercapture'])('ends a pinch on %s without a later jump', async (end) => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" />);
    const camera = lastRenderer().camera;
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
      touch(host(), end, 2, 200, 100);
    });
    const zoom = camera.zoom;
    const center = { ...camera.center };
    await flush(() => {
      touch(window, 'pointermove', 2, 400, 100);
      touch(window, 'pointermove', 1, 130, 100);
    });
    expect(camera.zoom).toBe(zoom);
    expect(camera.center).toEqual(center);
    await flush(() => {
      touch(host(), 'pointerdown', 3, 230, 100);
      touch(window, 'pointermove', 3, 330, 100);
    });
    expect(camera.zoom).toBeCloseTo(zoom * 2);
  });

  it('keeps pinching when a pan hands a touch from the canvas to the host', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" />);
    const camera = lastRenderer().camera;
    const canvas = host().querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    await flush(() => {
      touch(canvas, 'pointerdown', 1, 100, 100);
      touch(window, 'pointermove', 1, 120, 100);
      touch(canvas, 'lostpointercapture', 1, 120, 100);
    });
    const zoom = camera.zoom;
    await flush(() => {
      touch(canvas, 'pointerdown', 2, 220, 100);
      touch(window, 'pointermove', 2, 320, 100);
    });
    expect(camera.zoom).toBeCloseTo(zoom * 2);
  });

  it('lets a new primary sequence replace contacts whose releases were missed', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" />);
    const camera = lastRenderer().camera;
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
      touch(window, 'pointermove', 2, 300, 100);
    });
    const zoom = camera.zoom;
    // A new primary touch proves the previous physical sequence ended,
    // even if the surface did not hear its releases.
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 200, 100);
      touch(window, 'pointermove', 2, 300, 100);
    });
    expect(camera.zoom).toBeCloseTo(zoom * 2);
  });

  it('pans when coincident fingers first separate without a zoom spike', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" />);
    const camera = lastRenderer().camera;
    const zoom = camera.zoom;
    const before = camera.worldToScreen({ x: 0, y: 0 });
    await flush(() => {
      touch(host(), 'pointerdown', 1, 100, 100);
      touch(host(), 'pointerdown', 2, 100, 100);
      touch(window, 'pointermove', 2, 120, 100);
    });
    expect(camera.zoom).toBe(zoom);
    const after = camera.worldToScreen({ x: 0, y: 0 });
    expect(after.x - before.x).toBeCloseTo(10);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zooms about the midpoint, keeps the midpoint fixed, and never clicks a node', async () => {
    const onNodeClick = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" onNodeClick={onNodeClick} />);
    const camera = lastRenderer().camera;
    const a = screenOf('a');
    const mid = { x: a.x + 50, y: a.y };
    const world = camera.screenToWorld(mid);
    const zoom = camera.zoom;
    await flush(() => {
      touch(host(), 'pointerdown', 1, a.x, a.y);
      touch(host(), 'pointerdown', 2, a.x + 100, a.y);
      touch(window, 'pointermove', 2, a.x + 200, a.y);
    });
    // Fingers went 100 apart to 200 apart: zoom doubles about the new midpoint.
    expect(camera.zoom).toBeCloseTo(zoom * 2);
    const after = camera.worldToScreen(world);
    expect(after.x).toBeCloseTo(a.x + 100);
    expect(after.y).toBeCloseTo(a.y);
    await flush(() => {
      touch(window, 'pointerup', 2, a.x + 200, a.y);
      touch(window, 'pointerup', 1, a.x, a.y);
    });
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});

describe('lifecycle, failure and phones', () => {
  it('survives StrictMode: the abandoned renderer is aborted and disposed, one stays live', async () => {
    const { StrictMode } = await import('react');
    tree = await mount(
      <StrictMode>
        <DagrCanvas graph={twoNodes()} config={config} />
      </StrictMode>,
    );
    await flush(() => resizeTo(800, 600));
    expect(built.renderers.length).toBe(2);
    const [first, second] = built.renderers;
    expect(first?.options.signal?.aborted).toBe(true);
    expect(second?.options.signal?.aborted).toBe(false);
    expect(first?.dispose).toHaveBeenCalled();
    expect(second?.dispose).not.toHaveBeenCalled();
    await tree.unmount();
    tree = null;
    expect(second?.dispose).toHaveBeenCalled();
  });

  it('rebuilds after a lost context, tells the caller, and gives up after repeated loss', async () => {
    const onContextLost = vi.fn();
    const onError = vi.fn();
    await ready(<DagrCanvas graph={twoNodes()} config={config} onContextLost={onContextLost} onError={onError} />);
    const lose = async (): Promise<void> => {
      const options = built.renderers.at(-1)?.options;
      await flush(() => options?.onContextLost?.({ backend: 'webgl2', reason: 'context-lost' }));
    };
    await lose();
    expect(onContextLost).toHaveBeenCalledOnce();
    expect(built.renderers).toHaveLength(2);
    expect(built.renderers[0]?.dispose).toHaveBeenCalled();
    await lose();
    await lose();
    expect(built.renderers).toHaveLength(4);
    expect(onError).not.toHaveBeenCalled();
    await lose();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]?.[0])).toContain('lost 4 times');
  });

  it('shows the fallback instead of throwing when the device cannot be built', async () => {
    built.rendererFailure = new Error('no adapter');
    const onError = vi.fn();
    tree = await mount(
      <DagrCanvas graph={twoNodes()} config={config} onError={onError} fallback={<p>plain list</p>} />,
    );
    expect(tree.container.textContent).toContain('plain list');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('caps the pixel ratio it renders at', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    await ready(<DagrCanvas graph={twoNodes()} config={config} maxPixelRatio={2} />);
    const last = lastRenderer().resize.mock.calls.at(-1)?.[0] as { devicePixelRatio: number };
    expect(last.devicePixelRatio).toBe(2);
  });

  it('chooses touch-action by touch mode, and in two-finger mode a lone finger does not pan', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation cameraLimits={false} label="g" touchNavigation="two-finger" />);
    expect(host().style.touchAction).toBe('pan-x pan-y');
    const camera = lastRenderer().camera;
    const before = camera.center.x;
    const a = screenOf('a');
    const touch = (target: EventTarget, type: string, x: number): void => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: a.y, button: 0 });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'touch' } });
      target.dispatchEvent(event);
    };
    await flush(() => {
      touch(host(), 'pointerdown', a.x);
      touch(window, 'pointermove', a.x + 60);
      touch(window, 'pointerup', a.x + 60);
    });
    expect(camera.center.x).toBe(before);
    await tree?.rerender(<DagrCanvas graph={twoNodes()} config={config} navigation label="g" />);
    expect(host().style.touchAction).toBe('none');
  });

  it('a finger lands on a tiny far-out node by tolerance, a mouse needs to be close', async () => {
    const onNodeClick = vi.fn();
    const graph = twoNodes();
    await ready(<DagrCanvas graph={graph} config={{ defaultNodeSize: { width: 4, height: 4 } }} cameraLimits={false} fit={false} onNodeClick={onNodeClick} />);
    const camera = lastRenderer().camera;
    await flush(() => {
      camera.setZoom(1);
      camera.setCenter({ x: 0, y: 0 });
    });
    const a = screenOf('a');
    const near = { x: a.x + 15, y: a.y };
    const tap = (type: 'touch' | 'mouse'): void => {
      const mk = (name: string, target: EventTarget): void => {
        const event = new MouseEvent(name, { bubbles: true, cancelable: true, composed: true, clientX: near.x, clientY: near.y, button: 0 });
        Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: type } });
        target.dispatchEvent(event);
      };
      mk('pointerdown', host());
      mk('pointerup', window);
    };
    await flush(() => tap('mouse'));
    expect(onNodeClick).not.toHaveBeenCalled();
    await flush(() => tap('touch'));
    expect(onNodeClick).toHaveBeenCalledWith('a');
  });

  it('leaves the wheel to editable content inside the canvas', async () => {
    await ready(<DagrCanvas graph={twoNodes()} config={config} navigation label="g" />);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    host().append(editor);
    const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    await flush(() => editor.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
  });
});
