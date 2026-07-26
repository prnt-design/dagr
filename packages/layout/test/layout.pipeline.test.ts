import { Graph } from '@dagr/graph';
import type { EdgeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { defaultStages, layout } from '../src/index.js';
import type { Point, PositionStage, RankStage, RouteStage } from '../src/index.js';
import { recordingStages } from './fakes.js';

function chain(): Graph {
  const graph = new Graph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addEdge('a', 'b', 'ab');
  return graph;
}

describe('layout pipeline plumbing', () => {
  it('runs the stages in the order rank, order, position, route', () => {
    const recorder = recordingStages();
    layout({ graph: chain() }, recorder.stages);
    expect(recorder.log).toEqual(['rank', 'order', 'position', 'route']);
  });

  it('runs each stage exactly once', () => {
    const recorder = recordingStages();
    layout({ graph: chain() }, recorder.stages);
    expect(recorder.log).toHaveLength(4);
  });

  it('hands every stage the same resolved config', () => {
    const recorder = recordingStages();
    layout({ graph: chain(), config: { nodeSep: 3 } }, recorder.stages);
    const config = recorder.inputs.rank?.config;
    expect(config).toEqual({
      nodeSep: 3,
      rankSep: 50,
      edgeSep: 10,
      defaultNodeSize: { width: 100, height: 40 },
    });
    expect(recorder.inputs.order?.config).toBe(config);
    expect(recorder.inputs.position?.config).toBe(config);
    expect(recorder.inputs.route?.config).toBe(config);
  });

  it('hands every stage the graph it was given, unwrapped', () => {
    const graph = chain();
    const recorder = recordingStages();
    layout({ graph }, recorder.stages);
    expect(recorder.inputs.rank?.graph).toBe(graph);
    expect(recorder.inputs.route?.graph).toBe(graph);
  });

  it('hands each stage the exact output of the previous stage', () => {
    const recorder = recordingStages();
    layout({ graph: chain() }, recorder.stages);
    expect(recorder.inputs.order).toBe(recorder.outputs.rank);
    expect(recorder.inputs.position).toBe(recorder.outputs.order);
    expect(recorder.inputs.route).toBe(recorder.outputs.position);
  });

  it('returns a result built from what the route stage returned', () => {
    const recorder = recordingStages();
    const result = layout({ graph: chain() }, recorder.stages);
    // The runner assembles the result rather than passing the last record
    // through, so the polyline is the stage's and the nodes, the bounds, and
    // the edge's own labels are not.
    expect(result.edges.get('ab')?.points).toBe(recorder.outputs.route?.routes.get('ab'));
    expect(result.edges.get('ab')).toMatchObject({ id: 'ab', source: 'a', target: 'b' });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.bounds).toEqual({ x: -50, y: 0, width: 100, height: 130 });
  });

  it('lets a later stage read everything computed upstream', () => {
    const recorder = recordingStages();
    layout({ graph: chain() }, recorder.stages);
    const route = recorder.inputs.route;
    expect(route?.sizes.get('a')).toEqual({ width: 100, height: 40 });
    expect(route?.ranks.get('a')).toBe(0);
    expect(route?.ranks.get('b')).toBe(1);
    expect(route?.reversedEdges.size).toBe(0);
    expect(route?.layers).toEqual([['a'], ['b']]);
    expect(route?.positions.get('a')).toEqual({ x: 0, y: 20 });
  });

  it('uses the defaults for every phase the caller does not override', () => {
    const recorder = recordingStages();
    layout({ graph: chain() }, { rank: recorder.stages.rank });
    expect(recorder.log).toEqual(['rank']);
  });

  it('substitutes a custom stage for exactly one phase and keeps the other three defaults', () => {
    let positionCalls = 0;
    const shifted: PositionStage = {
      name: 'shifted',
      run(input) {
        positionCalls += 1;
        const positions = new Map(input.graph.nodes().map((node) => [node.id, { x: 1000, y: 5 }]));
        return { ...input, positions };
      },
    };
    const recorder = recordingStages();
    const result = layout(
      { graph: chain() },
      { ...recorder.stages, position: shifted },
    );
    expect(positionCalls).toBe(1);
    expect(recorder.log).toEqual(['rank', 'order', 'route']);
    expect(result.nodes.get('a')).toEqual({ id: 'a', x: 1000, y: 5, width: 100, height: 40 });
    // The default router still ran, so the edge is a two-point line.
    expect(result.edges.get('ab')?.points).toHaveLength(2);
  });

  it('never mutates the graph it was given', () => {
    const graph = chain();
    // A stage that claims the one edge runs the other way, which means ranking
    // `b` above `a` as well: the runner rejects a reversal the ranks disagree
    // with.
    const reversing: RankStage = {
      name: 'reversing',
      run(input) {
        return {
          ...defaultStages.rank.run(input),
          ranks: new Map([
            ['a', 1],
            ['b', 0],
          ]),
          reversedEdges: new Set(['ab']),
        };
      },
    };
    // Snapshotted before the run rather than written out as a literal, so this
    // asserts the graph is unchanged rather than pinning @dagr/graph's record
    // shape. Records are frozen there and gain fields over time (`attrs` and
    // ports arrived in M1.2), and none of that is this test's business.
    const edgeBefore = graph.getEdge('ab');
    const nodesBefore = graph.nodes();
    const result = layout({ graph }, { rank: reversing });
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
    expect(graph.getEdge('ab')).toEqual(edgeBefore);
    expect(graph.nodes()).toEqual(nodesBefore);
    // The reversal was bookkeeping on the record, so the edge still runs the
    // way the caller authored it, in the graph and in the result alike.
    expect(graph.getEdge('ab')?.source).toBe('a');
    expect(result.edges.get('ab')?.source).toBe('a');
  });

  it('assembles the result around a route stage that only routes', () => {
    // The point of the route stage returning a `RoutedState`: a third-party
    // router writes the routes and nothing else. Building the node map and
    // computing `bounds` is neither routing nor something each router should be
    // trusted to redo, so the runner does both.
    const routesOnly: RouteStage = {
      name: 'routes-only',
      run(input) {
        const routes = new Map<EdgeId, readonly Point[]>();
        for (const edge of input.graph.edges()) {
          const from = input.positions.get(edge.source);
          const to = input.positions.get(edge.target);
          if (from === undefined || to === undefined) throw new Error('unreachable');
          routes.set(edge.id, [from, to]);
        }
        return { ...input, routes };
      },
    };
    const result = layout({ graph: chain() }, { route: routesOnly });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
    expect(result.nodes.get('a')).toEqual({ id: 'a', x: 0, y: 20, width: 100, height: 40 });
    expect(result.nodes.get('b')).toEqual({ id: 'b', x: 0, y: 110, width: 100, height: 40 });
    expect(result.bounds).toEqual({ x: -50, y: 0, width: 100, height: 130 });
    expect(result.edges.get('ab')?.points).toHaveLength(2);
  });

  it('keeps a virtual node out of the result it assembles, by construction', () => {
    // Node completeness and the absence of virtual nodes used to be checks on
    // the route stage's output. The runner builds the node map from the graph
    // now, so neither can fail; this pins that the construction is the one that
    // was being checked for.
    const dummyRank: RankStage = {
      name: 'dummy-rank',
      run(input) {
        const sizes = new Map(input.sizes);
        sizes.set('ab#1', { width: 1, height: 40 });
        return {
          ...defaultStages.rank.run(input),
          sizes,
          ranks: new Map([
            ['a', 0],
            ['ab#1', 1],
            ['b', 2],
          ]),
          virtualNodes: new Set(['ab#1']),
        };
      },
    };
    const result = layout({ graph: chain() }, { rank: dummyRank });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('exposes the four defaults as a stage set', () => {
    expect(Object.keys(defaultStages).sort()).toEqual(['order', 'position', 'rank', 'route']);
    expect(defaultStages.rank.name).toBe('longest-path-rank');
    expect(defaultStages.order.name).toBe('insertion-order');
    expect(defaultStages.position.name).toBe('grid-position');
    expect(defaultStages.route.name).toBe('straight-route');
  });
});
