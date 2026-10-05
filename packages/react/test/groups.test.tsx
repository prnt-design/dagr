// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@prnt/dagr-graph';
vi.mock('@prnt/dagr-render', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));
import { DagrCanvas } from '../src/DagrCanvas.js';
import { lastRenderer, resetFakes } from './fake-render.js';
import { installFrameQueue, runFrames, runFramesUntilIdle } from './frames.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';
import { installResizeObserver } from './resize.js';
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
const groups = [{ id: 'platform', nodeIds: ['a', 'b'], label: 'Platform team' }];

describe('canvas node groups', () => {
  it.each([false, true])('tracks node edits with animate=%s and cleans up', async (animate) => {
    const graph = new Graph();
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b', 'ab');
    tree = await mount(<DagrCanvas graph={graph} groups={groups} animate={animate} />);
    await runFramesUntilIdle();
    const rect = tree.container.querySelector('.dagr-node-groups rect')!;
    expect(rect).not.toBeNull();
    const before = Number(rect.getAttribute('height'));
    await flush(() =>
      graph.batch(() => {
        graph.removeEdge('ab');
        graph.addNode('c');
        graph.addEdge('a', 'c');
        graph.addEdge('c', 'b');
      }),
    );
    await runFrames(0);
    await runFrames(16);
    const intermediate = Number(rect.getAttribute('height'));
    await runFramesUntilIdle();
    const after = Number(rect.getAttribute('height'));
    expect(after).toBeGreaterThan(before);
    if (animate) {
      expect(intermediate).toBeGreaterThan(before);
      expect(intermediate).toBeLessThan(after);
    }
    const renderer = lastRenderer();
    await tree.rerender(<DagrCanvas graph={graph} groups={[]} animate={animate} />);
    await runFramesUntilIdle();
    expect(tree.container.querySelectorAll('.dagr-node-groups g')).toHaveLength(0);
    await tree.unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('.dagr-node-groups')).toBeNull();
  });
});
