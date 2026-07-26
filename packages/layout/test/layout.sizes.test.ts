import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, layout } from '../src/index.js';
import type { Size } from '../src/index.js';
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
