// TEMPORARY reviewer scratch file: the docs attrs example with the widened cast.
import { Graph } from '@dagr/graph';
import { expect, it } from 'vitest';
import { layout } from '../src/index.js';
import type { Size } from '../src/index.js';

it('sized node reads its size from attrs', () => {
  const graph = new Graph();
  graph.addNode({ id: 'sized', attrs: { size: { width: 20, height: 10 } } });
  const result = layout({
    graph,
    config: { nodeSize: (node) => node.attrs.size as Size | undefined },
  });
  console.log('sized ->', JSON.stringify(result.nodes.get('sized')));
  expect(result.nodes.get('sized')?.width).toBe(20);
});

it('bare node falls back to defaultNodeSize', () => {
  const graph = new Graph();
  graph.addNode('bare');
  const result = layout({
    graph,
    config: { nodeSize: (node) => node.attrs.size as Size | undefined },
  });
  console.log('bare  ->', JSON.stringify(result.nodes.get('bare')));
  expect(result.nodes.get('bare')?.width).toBe(100);
});
