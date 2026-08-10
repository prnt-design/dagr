import { Graph } from '@dagr/graph';
import type { EdgeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { defaultStages, layout } from '../src/index.js';
import type {
  Point,
  PositionStage,
  PreparedState,
  RankStage,
  RouteStage,
} from '../src/index.js';
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

  it('carries each stage output into the record the next stage is handed', () => {
    // This replaces an identity check ("what a stage returned is what the next
    // one got"), which M2.4a made false and which was the weaker claim anyway:
    // a runner that never read a stage's record would have satisfied it. A
    // stage now returns its own fields, the runner builds the record, and what
    // is asserted is that each field arrived, by identity, in the right one.
    const recorder = recordingStages();
    layout({ graph: chain() }, recorder.stages);
    expect(recorder.inputs.order?.ranks).toBe(recorder.outputs.rank?.ranks);
    expect(recorder.inputs.order?.reversedEdges).toBe(recorder.outputs.rank?.reversedEdges);
    expect(recorder.inputs.position?.layers).toBe(recorder.outputs.order?.layers);
    expect(recorder.inputs.route?.positions).toBe(recorder.outputs.position?.positions);
  });

  it('merges a stage that returns its own fields alone into a record carrying the runner graph', () => {
    // The property that replaced "what a stage returned is what the next one
    // got". A stage hands back its own contribution and nothing else, so the
    // record the next stage reads is one the RUNNER built: its graph by
    // identity, the config it resolved, and the fields the stage did return.
    const graph = chain();
    const ranks = new Map([
      ['a', 0],
      ['b', 1],
    ]);
    let prepared: PreparedState | undefined;
    const bare: RankStage = {
      name: 'bare-rank',
      run(input) {
        prepared = input;
        return { ranks, reversedEdges: new Set<EdgeId>() };
      },
    };
    const recorder = recordingStages();
    layout({ graph }, { ...recorder.stages, rank: bare });
    const ordered = recorder.inputs.order;
    expect(ordered?.graph).toBe(graph);
    expect(ordered?.config).toBe(prepared?.config);
    // The prepared sizes by identity, not a copy: this ranker declared nothing,
    // so there was nothing to merge and nothing to copy a map for.
    expect(ordered?.sizes).toBe(prepared?.sizes);
    expect(ordered?.ranks).toBe(ranks);
    expect(ordered?.virtualNodes.size).toBe(0);
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
        return { positions };
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
    // The point of the route stage returning a `RouteOutput`: a third-party
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
        return { routes };
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
        return {
          ...defaultStages.rank.run(input),
          ranks: new Map([
            ['a', 0],
            ['ab#1', 1],
            ['b', 2],
          ]),
          virtualNodes: new Map([['ab#1', { width: 1, height: 40 }]]),
        };
      },
    };
    const result = layout({ graph: chain() }, { rank: dummyRank });
    expect([...result.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('exposes the four defaults as a stage set', () => {
    expect(Object.keys(defaultStages).sort()).toEqual(['order', 'position', 'rank', 'route']);
    expect(defaultStages.rank.name).toBe('longest-path-rank');
    expect(defaultStages.order.name).toBe('barycenter-order');
    expect(defaultStages.position.name).toBe('grid-position');
    expect(defaultStages.route.name).toBe('polyline-route');
  });
});
