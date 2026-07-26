import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/index.js';
import type { LayoutConfig } from '../src/index.js';

/**
 * A graph built from a script that exercises explicit ids, generated ids,
 * parallel edges, a self loop, and a removal, mirroring the determinism script
 * in `@dagr/graph`. Layout reproducibility rests on graph iteration order, so
 * the graph this runs on should be one whose order is not simply alphabetical.
 */
function build(): Graph {
  const graph = new Graph();
  graph.addNode('zeta');
  graph.addNode('alpha');
  graph.addNode();
  graph.addNode('mid');
  graph.addEdge('zeta', 'alpha');
  graph.addEdge('zeta', 'alpha', 'explicit');
  graph.addEdge('alpha', 'n1');
  graph.addEdge('mid', 'mid');
  graph.removeNode('alpha');
  graph.addNode('alpha');
  graph.addEdge('mid', 'alpha');
  return graph;
}

const config: LayoutConfig = {
  nodeSep: 12,
  rankSep: 34,
  nodeSize: (node) => ({ width: node.id.length * 10, height: 20 }),
};

describe('layout determinism', () => {
  it('gives the same graph the same result twice', () => {
    const graph = build();
    expect(layout({ graph, config })).toEqual(layout({ graph, config }));
  });

  it('gives two graphs from the same script the same result', () => {
    expect(layout({ graph: build(), config })).toEqual(layout({ graph: build(), config }));
  });

  it('iterates result nodes and edges in graph insertion order', () => {
    const graph = build();
    const result = layout({ graph });
    expect([...result.nodes.keys()]).toEqual(graph.nodes().map((node) => node.id));
    expect([...result.edges.keys()]).toEqual(graph.edges().map((edge) => edge.id));
  });

  it('does not depend on anything left over from a previous run', () => {
    const first = layout({ graph: build(), config });
    layout({ graph: build(), config: { nodeSep: 999, rankSep: 999 } });
    expect(layout({ graph: build(), config })).toEqual(first);
  });
});
