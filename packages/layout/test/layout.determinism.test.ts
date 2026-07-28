import { largeCorpus, smallCorpus } from '@dagr/bench';
import type { GraphSpec } from '@dagr/bench';
import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { barycenterOrder, layout } from '../src/index.js';
import type { LayoutConfig, LayoutResult } from '../src/index.js';

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

/**
 * The same guarantee at a size where a heuristic could plausibly break it.
 *
 * The four cases above run on a four-node script, which was enough while the
 * order stage returned the roster untouched. M2.6b pointed
 * `defaultStages.order` at `barycenterOrderStage`, so a run that names no
 * stages now makes thousands of tie decisions inside sweeps and a transpose
 * pass, and `layout()` is the entry point every other package and the demo
 * reach for. The stage's own determinism cases pin `barycenterOrder().run()`
 * directly and so cannot see the runner, which is the layer that builds the
 * state, hands it across and merges what comes back.
 *
 * Nothing here is a discovery: all three held before it was written. That is
 * the point of a pin, and both arms below were checked by mutation rather than
 * by reading, because the first version of the third arm was VACUOUS: it
 * passed the override as `{ stages: { order } }`, which is not the shape
 * `layout`'s second argument takes, so the override was silently ignored and
 * the arm compared the default path to itself. A stage carrying leftover
 * per-process state fails the first arm and both of the four-node cases above;
 * a default built at a different sweep budget fails ONLY the two cases here,
 * which is the work the four-node cases cannot do.
 */
describe('layout determinism at corpus scale, through the default path', () => {
  const corpora = [
    ['1k', smallCorpus()],
    ['10k', largeCorpus()],
  ] as const;

  function graphOf(spec: GraphSpec): Graph {
    const graph = new Graph();
    for (const id of spec.nodes) graph.addNode(id);
    for (const [source, target] of spec.edges) graph.addEdge(source, target);
    return graph;
  }

  /**
   * Positions and route points as one string, rather than `toEqual` over two
   * result objects. The comparison is the same one, and at 10k nodes a failure
   * that prints a diff of two whole `LayoutResult`s is a failure nobody reads.
   */
  function digest(result: LayoutResult): string {
    return JSON.stringify([[...result.nodes.entries()], [...result.edges.entries()]]);
  }

  for (const [name, spec] of corpora) {
    it(`gives the ${name} corpus the same drawing three ways`, () => {
      const graph = graphOf(spec);
      const first = digest(layout({ graph }));
      // The same graph object again: nothing survives a run to change the next.
      expect(digest(layout({ graph }))).toBe(first);
      // A graph rebuilt from the spec: no identity of any node object is read.
      expect(digest(layout({ graph: graphOf(spec) }))).toBe(first);
      // A fresh stage object, since the default is one frozen instance shared
      // by every run in the process and could be accumulating state.
      expect(digest(layout({ graph }, { order: barycenterOrder() }))).toBe(first);
    });
  }
});
