// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import type { SceneEdge, SceneNode } from '@prnt/dagr-render';
import { DagrCanvas } from '../src/DagrCanvas.js';
import { lastRenderer, resetFakes } from './fake-render.js';
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
function chain(): Graph {
  const graph = new Graph();
  graph.addNode({ id: 'a' });
  graph.addNode({ id: 'b' });
  graph.addEdge({ id: 'a-b', source: 'a', target: 'b' });
  return graph;
}
function addSibling(graph: Graph): void {
  graph.batch(() => {
    graph.addNode({ id: 'c' });
    graph.addEdge({ id: 'a-c', source: 'a', target: 'c' });
  });
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
function click(x: number, y: number): void {
  pointer(host(), 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
}
async function ready(element: Parameters<typeof mount>[0]): Promise<void> {
  tree = await mount(element);
  await flush(() => resizeTo(800, 600));
  await runFramesUntilIdle();
}

function drawnEdges(): readonly SceneEdge[] {
  return lastRenderer().setEdges.mock.calls.at(-1)?.[1] as readonly SceneEdge[];
}
/** The midpoint of an edge's middle segment as last drawn, on screen. */
function edgeMiddle(id: string): { x: number; y: number } {
  const edge = drawnEdges().find((e) => e.id === id);
  if (edge === undefined) throw new Error(`no edge ${id}`);
  const k = Math.max(1, Math.floor(edge.points.length / 2));
  const a = edge.points[k - 1];
  const b = edge.points[k];
  if (a === undefined || b === undefined) throw new Error(`edge ${id} has no segment`);
  return lastRenderer().camera.worldToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}
function nodeCentre(id: string): { x: number; y: number } {
  const nodes = lastRenderer().setNodes.mock.calls.at(-1)?.[0] as readonly SceneNode[];
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return lastRenderer().camera.worldToScreen(node.center);
}

describe('DagrCanvas edge hits', () => {
  it('clicks an edge on no node, gives a node precedence, and leaves the background a background', async () => {
    const onEdgeClick = vi.fn();
    const onNodeClick = vi.fn();
    const onBackgroundClick = vi.fn();
    await ready(
      <DagrCanvas graph={chain()} config={config} onEdgeClick={onEdgeClick} onNodeClick={onNodeClick} onBackgroundClick={onBackgroundClick} />,
    );
    const middle = edgeMiddle('a-b');
    await flush(() => click(middle.x, middle.y));
    expect(onEdgeClick.mock.calls).toEqual([['a-b']]);

    // The edge ends under its target, so its last point is on the node.
    const end = drawnEdges()[0]?.points.at(-1);
    if (end === undefined) throw new Error('no edge end');
    const onNode = lastRenderer().camera.worldToScreen(end);
    await flush(() => click(onNode.x, onNode.y + 2));
    expect(onNodeClick.mock.calls).toEqual([['b']]);
    expect(onEdgeClick).toHaveBeenCalledOnce();

    await flush(() => click(middle.x + 40, middle.y));
    expect(onBackgroundClick).toHaveBeenCalledOnce();
    expect(onEdgeClick).toHaveBeenCalledOnce();
  });

  it('is a background click on an edge when no edge handler is set', async () => {
    const onBackgroundClick = vi.fn();
    await ready(<DagrCanvas graph={chain()} config={config} onBackgroundClick={onBackgroundClick} />);
    const middle = edgeMiddle('a-b');
    await flush(() => click(middle.x, middle.y));
    expect(onBackgroundClick).toHaveBeenCalledOnce();
  });

  it('reports edge hover, hands over to a node, and clears on leave', async () => {
    const onEdgeHover = vi.fn();
    const onNodeHover = vi.fn();
    await ready(<DagrCanvas graph={chain()} config={config} onEdgeHover={onEdgeHover} onNodeHover={onNodeHover} />);
    const middle = edgeMiddle('a-b');
    await flush(() => pointer(host(), 'pointermove', middle.x, middle.y));
    await flush(() => pointer(host(), 'pointermove', middle.x, middle.y + 1));
    expect(onEdgeHover.mock.calls).toEqual([['a-b']]);
    expect(onNodeHover).not.toHaveBeenCalled();

    const a = nodeCentre('a');
    await flush(() => pointer(host(), 'pointermove', a.x, a.y));
    expect(onEdgeHover.mock.calls).toEqual([['a-b'], [null]]);
    expect(onNodeHover.mock.calls).toEqual([['a']]);

    await flush(() => pointer(host(), 'pointermove', middle.x, middle.y));
    expect(onNodeHover.mock.calls).toEqual([['a'], [null]]);
    await flush(() => host().dispatchEvent(new Event('pointerleave')));
    expect(onEdgeHover.mock.calls).toEqual([['a-b'], [null], ['a-b'], [null]]);
    expect(host().style.cursor).toBe('');
  });

  it('misses a removed edge and hits a rerouted one on its new route', async () => {
    const graph = chain();
    const onEdgeClick = vi.fn();
    const onBackgroundClick = vi.fn();
    await ready(<DagrCanvas graph={graph} config={config} onEdgeClick={onEdgeClick} onBackgroundClick={onBackgroundClick} />);
    const before = edgeMiddle('a-b');

    await flush(() => addSibling(graph));
    await runFramesUntilIdle();
    const after = edgeMiddle('a-b');
    expect(after).not.toEqual(before);
    await flush(() => click(after.x, after.y));
    expect(onEdgeClick.mock.calls).toEqual([['a-b']]);

    const sibling = edgeMiddle('a-c');
    await flush(() => graph.removeEdge('a-c'));
    await runFramesUntilIdle();
    await flush(() => click(sibling.x, sibling.y));
    expect(onEdgeClick.mock.calls).toEqual([['a-b']]);
    expect(onBackgroundClick).toHaveBeenCalledOnce();
  });

  it('hits an edge where the frame drew it while edges glide', async () => {
    const graph = chain();
    const onEdgeClick = vi.fn();
    await ready(<DagrCanvas graph={graph} config={config} animate onEdgeClick={onEdgeClick} />);
    const from = edgeMiddle('a-b');

    await flush(() => addSibling(graph));
    await runFrames(16);
    await runFrames(32);
    const gliding = edgeMiddle('a-b');
    await flush(() => click(gliding.x, gliding.y));
    expect(onEdgeClick.mock.calls).toEqual([['a-b']]);

    await runFramesUntilIdle();
    const to = edgeMiddle('a-b');
    expect(Math.min(from.x, to.x)).toBeLessThan(gliding.x);
    expect(gliding.x).toBeLessThan(Math.max(from.x, to.x));
  });
});

