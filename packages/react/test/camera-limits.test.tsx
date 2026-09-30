// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import { DagrCanvas } from '../src/DagrCanvas.js';
import { lastRenderer, resetFakes } from './fake-render.js';
import { installFrameQueue, runFramesUntilIdle } from './frames.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';
import { installResizeObserver, resizeTo } from './resize.js';
let tree: Mounted | null = null;
beforeEach(() => { resetFakes(); installFrameQueue(); installResizeObserver(); });
afterEach(async () => { await tree?.unmount(); tree = null; vi.unstubAllGlobals(); });
const config = { defaultNodeSize: { width: 200, height: 100 } };
function graphOfTwo() {
  const graph = new Graph(); graph.addNode('a'); graph.addNode('b'); graph.addEdge('a', 'b'); return graph;
}
describe('default canvas camera limits', () => {
  it.each([false, true])('tracks edits, groups, resizing and empty content with animate=%s', async (animate) => {
    const graph = graphOfTwo();
    tree = await mount(<DagrCanvas graph={graph} config={config} animate={animate} />);
    await flush(() => resizeTo(800, 600));
    await runFramesUntilIdle();
    const camera = lastRenderer().camera;
    expect(camera.minZoom).toBeGreaterThan(0.1);
    expect(camera.maxZoom).toBeCloseTo(3.6);
    const min = camera.minZoom;
    await tree.rerender(<DagrCanvas graph={graph} config={config} animate={animate} groups={[{id:'boundary',nodeIds:['a','b'],padding:200}]} />);
    await runFramesUntilIdle();
    expect(camera.minZoom).toBeLessThan(min);
    await tree.rerender(<DagrCanvas graph={graph} config={config} animate={animate} />);
    await flush(() => graph.batch(() => { graph.addNode('c'); graph.addEdge('b','c'); }));
    await runFramesUntilIdle();
    expect(camera.minZoom).toBeLessThan(min);
    await flush(() => resizeTo(400, 300));
    expect(camera.maxZoom).toBeCloseTo(1.8);
    camera.setZoom(1e-6);
    camera.panByScreen(1e9, 1e9);
    expect(Math.abs(camera.center.x)).toBeLessThan(1e4);
    await flush(() => graph.batch(() => { for (const id of ['a','b','c']) graph.removeNode(id); }));
    await runFramesUntilIdle();
    expect(camera.minZoom).toBe(Number.MIN_VALUE);
    expect(camera.maxZoom).toBe(Number.MAX_VALUE);
  });

  it('offers an explicit opt-out and re-enables bounds on demand', async () => {
    const graph = graphOfTwo();
    tree = await mount(<DagrCanvas graph={graph} config={config} cameraLimits={false} fit={false} />);
    await flush(() => resizeTo(800, 600));
    const camera = lastRenderer().camera;
    camera.setZoom(100);
    camera.setCenter({x:1e6,y:1e6});
    expect(camera.zoom).toBe(100);
    await tree.rerender(<DagrCanvas graph={graph} config={config} />);
    expect(camera.zoom).toBeCloseTo(3.6);
    expect(Math.abs(camera.center.x)).toBeLessThan(1e4);
    await tree.rerender(<DagrCanvas graph={graph} config={config} cameraLimits={false} />);
    expect(camera.maxZoom).toBe(Number.MAX_VALUE);
  });
});
