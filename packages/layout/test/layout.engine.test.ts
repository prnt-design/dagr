import { Graph } from '@dagr/graph';
import type { Node } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, createLayout, layout } from '../src/index.js';
import { recordingStages } from './fakes.js';

function diamond(): Graph {
  const graph = new Graph();
  for (const id of ['a', 'b', 'c', 'd']) graph.addNode(id);
  graph.addEdge('a', 'b', 'ab');
  graph.addEdge('a', 'c', 'ac');
  graph.addEdge('b', 'd', 'bd');
  graph.addEdge('c', 'd', 'cd');
  return graph;
}

describe('the layout engine', () => {
  it('runs the same layout the one-shot call does', () => {
    expect(createLayout().run(diamond())).toEqual(layout({ graph: diamond() }));
  });

  it('binds its config for every run', () => {
    const engine = createLayout({ config: { nodeSep: 7, rankSep: 11 } });
    expect(engine.run(diamond())).toEqual(
      layout({ graph: diamond(), config: { nodeSep: 7, rankSep: 11 } }),
    );
  });

  it('binds its stages for every run', () => {
    const recorder = recordingStages();
    const engine = createLayout({ stages: recorder.stages });
    engine.run(diamond());
    engine.run(diamond());
    expect(recorder.log).toEqual([
      'rank',
      'order',
      'position',
      'route',
      'rank',
      'order',
      'position',
      'route',
    ]);
  });

  // The config is resolved once, when the engine is built, so a caller learns
  // their separation is unusable where they named it rather than on whichever
  // later run happened to be the first.
  it('refuses an unusable config when the engine is built', () => {
    expect(() => createLayout({ config: { nodeSep: -1 } })).toThrow(InvalidConfigError);
  });

  it('sizes every node once per run, and only through the callback it was built with', () => {
    const seen: string[] = [];
    const nodeSize = (node: Node): undefined => {
      seen.push(node.id);
      return undefined;
    };
    const engine = createLayout({ config: { nodeSize } });
    engine.run(diamond());
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never mutates the graph it is handed', () => {
    const graph = diamond();
    createLayout().run(graph);
    expect(graph.nodeCount).toBe(4);
    expect(graph.edgeCount).toBe(4);
  });
});

describe('runAsync without a worker', () => {
  it('resolves to what the sync run returns', async () => {
    const engine = createLayout();
    await expect(engine.runAsync(diamond())).resolves.toEqual(engine.run(diamond()));
  });

  // An async entry point that sometimes throws synchronously is the shape that
  // gets a `try` and a `.catch` written around the same call.
  it('rejects rather than throws when a size cannot be used', async () => {
    const engine = createLayout({ config: { nodeSize: () => ({ width: Number.NaN, height: 1 }) } });
    await expect(engine.runAsync(diamond())).rejects.toThrow(InvalidConfigError);
  });
});
