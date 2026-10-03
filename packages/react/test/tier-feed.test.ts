import { describe, expect, it, vi } from 'vitest';
import type { RichNodes, SceneNode } from '@prnt/dagr-render';
import { createTierFeed } from '../src/tier-feed.js';

function node(id: string, x: number, y = 0): SceneNode {
  return {
    id,
    shape: 'roundedRect',
    center: { x, y },
    size: { width: 100, height: 50 },
    fillColor: 0,
    glowColor: 0,
    glowWorld: 0,
  };
}

function fakeRich() {
  const rich = { setNodes: vi.fn(), setNode: vi.fn(), nodeCount: 0, dispose: vi.fn() };
  return { rich, as: rich as unknown as RichNodes<unknown> };
}

describe('createTierFeed', () => {
  it('full replaces the set and calls nodeData once per id', () => {
    const { rich, as } = fakeRich();
    const dataOf = vi.fn((id: string) => `d-${id}`);
    const feed = createTierFeed(as, () => dataOf);
    feed.full([node('a', 0), node('b', 200)]);
    expect(rich.setNodes).toHaveBeenCalledOnce();
    const records = rich.setNodes.mock.calls[0]?.[0] as { id: string; data: string }[];
    expect(records.map((r) => r.data)).toEqual(['d-a', 'd-b']);
    feed.full([node('a', 10), node('b', 200)]);
    expect(dataOf).toHaveBeenCalledTimes(2);
  });

  it('step touches only nodes that moved or are new, and never removes', () => {
    const { rich, as } = fakeRich();
    const feed = createTierFeed(as, () => undefined);
    feed.full([node('a', 0), node('b', 200)]);
    feed.step([node('a', 0), node('b', 200)]);
    expect(rich.setNode).not.toHaveBeenCalled();
    feed.step([node('a', 5), node('b', 200), node('c', 400)]);
    expect(rich.setNode.mock.calls.map(([n]) => (n as { id: string }).id)).toEqual(['a', 'c']);
    expect(rich.setNodes).toHaveBeenCalledOnce();
  });

  it('defaults data to the id and re-asks nodeData after invalidate', () => {
    const { rich, as } = fakeRich();
    const holder: { produce?: (id: string) => unknown } = {};
    const feed = createTierFeed(as, () => holder.produce);
    feed.full([node('a', 0)]);
    expect((rich.setNodes.mock.calls[0]?.[0] as { data: unknown }[])[0]?.data).toBe('a');
    holder.produce = (id) => ({ id });
    feed.invalidate();
    feed.full([node('a', 0)]);
    expect((rich.setNodes.mock.calls[1]?.[0] as { data: unknown }[])[0]?.data).toEqual({ id: 'a' });
  });
});
