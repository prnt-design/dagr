// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
import type { SceneEdge } from '@prnt/dagr-render';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import { DagrCanvas } from '../src/DagrCanvas.js';
import { lastRenderer, resetFakes } from './fake-render.js';
import { installFrameQueue, runFramesUntilIdle } from './frames.js';
import { mount } from './mount.js';
import type { Mounted } from './mount.js';
import { installResizeObserver } from './resize.js';
let tree: Mounted | null = null;
beforeEach(() => { resetFakes(); installFrameQueue(); installResizeObserver(); });
afterEach(async () => { await tree?.unmount(); tree = null; vi.unstubAllGlobals(); });
it.each([false, true])('changes route style live without rebuilding the renderer, animate=%s', async (animate) => {
  const graph = new Graph();
  graph.addNode('a'); graph.addNode('b'); graph.addNode('c');
  graph.addEdge('a','b'); graph.addEdge('a','c');
  tree = await mount(<DagrCanvas graph={graph} animate={animate} />);
  await runFramesUntilIdle();
  const renderer = lastRenderer();
  const edges = () => renderer.setEdges.mock.lastCall![1] as SceneEdge[];
  const original = edges();
  await tree.rerender(<DagrCanvas graph={graph} animate={animate} edgePath={{style:'orthogonal'}} />);
  await runFramesUntilIdle();
  expect(lastRenderer()).toBe(renderer);
  expect(edges().map(e=>e.id)).toEqual(original.map(e=>e.id));
  expect(edges().some(e=>e.points.length > original.find(o=>o.id===e.id)!.points.length)).toBe(true);
  for (const edge of edges()) {
    for (let i=1; i<edge.points.length; i++) {
      const a=edge.points[i-1]!, b=edge.points[i]!;
      expect(a.x===b.x || a.y===b.y).toBe(true);
    }
  }
  await tree.rerender(<DagrCanvas graph={graph} animate={animate} edgePath={{style:'smooth'}} />);
  await runFramesUntilIdle();
  expect(edges().some(e=>e.points.length > original.find(o=>o.id===e.id)!.points.length)).toBe(true);
  await tree.rerender(<DagrCanvas graph={graph} animate={animate} />);
  await runFramesUntilIdle();
  expect(edges()).toEqual(original);
});
