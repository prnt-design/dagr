import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_SIZE, resolveNodeSize } from '../src/index.js';
import type { ExplorerNode } from '../src/index.js';

const node: ExplorerNode = { id: 'a', label: 'A' };

describe('resolveNodeSize', () => {
  it('falls back to 240 by 120', () => {
    expect(DEFAULT_NODE_SIZE).toEqual({ width: 240, height: 120 });
    expect(resolveNodeSize(undefined, node)).toEqual({ width: 240, height: 120 });
    expect(resolveNodeSize({}, node)).toEqual({ width: 240, height: 120 });
  });

  it('takes a size the view gives for every node', () => {
    expect(resolveNodeSize({ nodeSize: { width: 100, height: 50 } }, node)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('calls a view function with the node', () => {
    const size = resolveNodeSize(
      { nodeSize: (n: ExplorerNode) => ({ width: n.id.length * 10, height: 30 }) },
      { id: 'abcd', label: 'ABCD' },
    );
    expect(size).toEqual({ width: 40, height: 30 });
  });

  it("lets the node's own size win over the view's", () => {
    const sized: ExplorerNode = { id: 'a', label: 'A', size: { width: 7, height: 9 } };
    expect(resolveNodeSize({ nodeSize: { width: 100, height: 50 } }, sized)).toEqual({
      width: 7,
      height: 9,
    });
  });

  it('falls back when a view function returns nothing', () => {
    // A JavaScript caller, or a function with a missing branch.
    const broken = (() => undefined) as unknown as (n: ExplorerNode) => { width: number; height: number };
    expect(resolveNodeSize({ nodeSize: broken }, node)).toEqual({ width: 240, height: 120 });
  });
});
