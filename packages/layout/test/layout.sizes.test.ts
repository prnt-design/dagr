import { Graph } from '@prnt/dagr-graph';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, layout } from '../src/index.js';
import type { Size } from '../src/index.js';
import { heldSizes } from '../src/pipeline.js';
import { recordingStages } from './fakes.js';

function threeNodes(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  return graph;
}

describe('layout node sizes', () => {
  it('sizes every node with defaultNodeSize when no callback is given', () => {
    const result = layout({
      graph: threeNodes(),
      config: { defaultNodeSize: { width: 8, height: 4 } },
    });
    for (const node of result.nodes.values()) {
      expect(node.width).toBe(8);
      expect(node.height).toBe(4);
    }
  });

  it('honours the nodeSize callback per node', () => {
    const sizes: Record<string, Size> = {
      a: { width: 10, height: 10 },
      b: { width: 20, height: 30 },
      c: { width: 5, height: 60 },
    };
    const result = layout({
      graph: threeNodes(),
      config: { nodeSize: (node) => sizes[node.id] },
    });
    expect(result.nodes.get('a')).toMatchObject({ width: 10, height: 10 });
    expect(result.nodes.get('b')).toMatchObject({ width: 20, height: 30 });
    expect(result.nodes.get('c')).toMatchObject({ width: 5, height: 60 });
  });

  it('falls back to defaultNodeSize for a node the callback does not size', () => {
    const result = layout({
      graph: threeNodes(),
      config: {
        defaultNodeSize: { width: 7, height: 3 },
        nodeSize: (node) => (node.id === 'b' ? { width: 20, height: 30 } : undefined),
      },
    });
    expect(result.nodes.get('a')).toMatchObject({ width: 7, height: 3 });
    expect(result.nodes.get('b')).toMatchObject({ width: 20, height: 30 });
    expect(result.nodes.get('c')).toMatchObject({ width: 7, height: 3 });
  });

  it('calls the callback exactly once per node', () => {
    const seen: string[] = [];
    layout({
      graph: threeNodes(),
      config: {
        nodeSize: (node) => {
          seen.push(node.id);
          return { width: 10, height: 10 };
        },
      },
    });
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('hands the resolved sizes to the stages', () => {
    const recorder = recordingStages();
    layout(
      { graph: threeNodes(), config: { nodeSize: () => ({ width: 12, height: 6 }) } },
      recorder.stages,
    );
    const sizes = recorder.inputs.rank?.sizes;
    expect([...(sizes?.keys() ?? [])]).toEqual(['a', 'b', 'c']);
    expect(sizes?.get('b')).toEqual({ width: 12, height: 6 });
  });

  it('spaces nodes by their own widths, not by the default', () => {
    const widths: Record<string, number> = { a: 10, b: 100, c: 10 };
    const result = layout({
      graph: threeNodes(),
      config: { nodeSep: 10, nodeSize: (node) => ({ width: widths[node.id] ?? 0, height: 20 }) },
    });
    // Row width is 10 + 10 + 100 + 10 + 10 = 140, so it starts at -70.
    expect(result.nodes.get('a')?.x).toBe(-65);
    expect(result.nodes.get('b')?.x).toBe(0);
    expect(result.nodes.get('c')?.x).toBe(65);
  });

  it.each([
    ['a negative width', { width: -1, height: 10 }, 'nodeSize("b").width'],
    ['a NaN height', { width: 10, height: Number.NaN }, 'nodeSize("b").height'],
    ['an infinite width', { width: Number.POSITIVE_INFINITY, height: 10 }, 'nodeSize("b").width'],
  ])('rejects %s from the callback', (_label, bad, field) => {
    const run = () =>
      layout({
        graph: threeNodes(),
        config: { nodeSize: (node) => (node.id === 'b' ? bad : undefined) },
      });
    expect(run).toThrow(InvalidConfigError);
    try {
      run();
      expect.unreachable('layout should have thrown');
    } catch (error) {
      if (!(error instanceof InvalidConfigError)) throw error;
      expect(error.field).toBe(field);
      expect(error.message).toContain('b');
    }
  });

  it('rejects a bad size before running any stage', () => {
    const recorder = recordingStages();
    expect(() => {
      layout(
        { graph: threeNodes(), config: { nodeSize: () => ({ width: -1, height: 1 }) } },
        recorder.stages,
      );
    }).toThrow(InvalidConfigError);
    expect(recorder.log).toEqual([]);
  });
});

describe('the sizes a fast path hands its stages', () => {
  const dummy = { width: 0, height: 0 };
  const one = { width: 1, height: 1 };
  const full = new Map<string, Size>([
    ['a', one],
    ['b', one],
    ['#dummy:e:0', dummy],
  ]);
  const dummies = new Set(['#dummy:e:0']);

  it("hands over the full run's map when every node keeps its size", () => {
    const nodes = new Map<string, Size>([
      ['a', { width: 1, height: 1 }],
      ['b', one],
    ]);
    expect(heldSizes(nodes, dummies, full)).toBe(full);
  });

  it('answers a resized, an added and a removed node from this run', () => {
    const nodes = new Map<string, Size>([
      ['a', { width: 5, height: 5 }],
      ['leaf', one],
    ]);
    const sizes = heldSizes(nodes, dummies, full);
    expect(sizes.get('a')).toEqual({ width: 5, height: 5 });
    expect(sizes.get('leaf')).toBe(one);
    expect(sizes.get('#dummy:e:0')).toBe(dummy);
    expect(sizes.get('b')).toBeUndefined();
    expect(sizes.has('b')).toBe(false);
    expect(sizes.size).toBe(3);
    expect(new Map(sizes)).toEqual(
      new Map([
        ['a', { width: 5, height: 5 }],
        ['#dummy:e:0', dummy],
        ['leaf', one],
      ]),
    );
  });

  it('keeps a node removed through later fast paths, and answers it again once it is back', () => {
    const big = { width: 9, height: 9 };
    let sizes = heldSizes(new Map([['a', one]]), dummies, full);
    sizes = heldSizes(new Map([['a', big]]), dummies, sizes);
    expect(sizes.has('b')).toBe(false);
    expect(sizes.size).toBe(2);
    sizes = heldSizes(
      new Map([
        ['a', big],
        ['b', big],
      ]),
      dummies,
      sizes,
    );
    expect(sizes.get('b')).toBe(big);
    expect(sizes.size).toBe(3);
  });

  it("hands over the full run's map again once a leaf a fast path added is removed", () => {
    const nodes = new Map<string, Size>([
      ['a', one],
      ['b', one],
    ]);
    const added = heldSizes(new Map([...nodes, ['leaf', one]]), dummies, full);
    expect(added).not.toBe(full);
    expect(heldSizes(nodes, dummies, added)).toBe(full);
  });
});
