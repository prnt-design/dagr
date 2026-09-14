import { describe, expect, it } from 'vitest';
import { Graph } from '@dagr/graph';
import { createLayout } from '@dagr/layout';
import type { LayoutDelta } from '@dagr/layout';
import { MotionDesyncError } from '@dagr/render';
import type {
  SceneEdge,
  SceneMotion,
  SceneMotionDelta,
  SceneMotionFrame,
  SceneMotionRoster,
  SceneNode,
  WorldBounds,
} from '@dagr/render';
import { toMotionDelta, toMotionRoster, retarget } from '../src/animation.js';
import { toSceneEdges, toSceneNodes, toWorldBounds } from '../src/scene.js';

/** A scene motion that records what it was told, and can be made to refuse. */
function recordingMotion(refuse?: Error): {
  readonly motion: SceneMotion;
  readonly applied: SceneMotionDelta[];
  readonly resynced: SceneMotionRoster[];
} {
  const applied: SceneMotionDelta[] = [];
  const resynced: SceneMotionRoster[] = [];
  const motion: SceneMotion = {
    apply(delta) {
      if (refuse !== undefined) throw refuse;
      applied.push(delta);
    },
    resync(roster) {
      resynced.push(roster);
    },
    advance(): SceneMotionFrame {
      return { nodes: [], edges: [], bounds: null, settled: true };
    },
  };
  return { motion, applied, resynced };
}

/** A three-node chain, which is the smallest graph an edit can restructure. */
function chain(): Graph {
  const graph = new Graph();
  graph.addNode({ id: 'a' });
  graph.addNode({ id: 'b' });
  graph.addEdge({ id: 'a-b', source: 'a', target: 'b' });
  return graph;
}

const EMPTY_ROSTER: SceneMotionRoster = { nodes: [], edges: [] };

describe('toMotionDelta', () => {
  it('flips every y it carries, and only the y', () => {
    const delta: LayoutDelta = {
      nodes: {
        added: [{ id: 'new', x: 10, y: 20, width: 4, height: 2 }],
        removed: ['gone'],
        moved: [
          {
            id: 'moves',
            from: { x: 0, y: 0, width: 4, height: 2 },
            to: { x: 30, y: 40, width: 4, height: 2 },
          },
        ],
      },
      edges: {
        added: [
          {
            id: 'e-new',
            source: 'a',
            target: 'b',
            points: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
          },
        ],
        removed: ['e-gone'],
        rerouted: [
          {
            id: 'e-moves',
            from: [{ x: 0, y: 0 }],
            to: [
              { x: 5, y: 6 },
              { x: 7, y: 8 },
            ],
          },
        ],
      },
      bounds: { from: { x: 0, y: 0, width: 1, height: 1 }, to: { x: 2, y: 3, width: 10, height: 20 } },
    };

    const motion = toMotionDelta(delta);

    expect(motion.nodes?.added).toEqual([{ id: 'new', center: { x: 10, y: -20 } }]);
    expect(motion.nodes?.removed).toEqual(['gone']);
    expect(motion.nodes?.moved).toEqual([{ id: 'moves', center: { x: 30, y: -40 } }]);
    expect(motion.edges?.added).toEqual([
      {
        id: 'e-new',
        points: [
          { x: 1, y: -2 },
          { x: 3, y: -4 },
        ],
      },
    ]);
    expect(motion.edges?.removed).toEqual(['e-gone']);
    expect(motion.edges?.rerouted).toEqual([
      {
        id: 'e-moves',
        points: [
          { x: 5, y: -6 },
          { x: 7, y: -8 },
        ],
      },
    ]);
    expect(motion.bounds).toEqual({ minX: 2, maxX: 12, minY: -23, maxY: -3 });
  });

  it('says the box did not change by saying undefined, the way the layout does', () => {
    const delta: LayoutDelta = {
      nodes: { added: [], removed: [], moved: [] },
      edges: { added: [], removed: [], rerouted: [] },
      bounds: undefined,
    };

    expect(toMotionDelta(delta).bounds).toBeUndefined();
  });

  /**
   * The check a hand-built fixture cannot make, and the one `scene.ts` already
   * makes for its own three conversions: a delta's targets are where the scene
   * conversions put the same things, so half a flip is a failure rather than a
   * picture that is half upside down with every unit test green.
   */
  it('lands its targets exactly where the scene conversions put the new layout', () => {
    const graph = chain();
    const engine = createLayout();
    engine.run(graph);
    const { result, delta } = ((): { result: ReturnType<typeof engine.run>; delta: LayoutDelta } => {
      let seen: { result: ReturnType<typeof engine.run>; delta: LayoutDelta } | null = null;
      const stop = graph.subscribe((patch) => {
        const answer = engine.relayout(patch);
        seen = { result: answer.result, delta: answer.delta };
      });
      graph.batch(() => {
        graph.addNode({ id: 'c' });
        graph.addEdge({ id: 'b-c', source: 'b', target: 'c' });
      });
      stop();
      if (seen === null) throw new Error('the graph delivered no patch');
      return seen;
    })();

    const motion = toMotionDelta(delta);
    const sceneNodes = new Map(toSceneNodes(result).map((node) => [node.id, node]));
    const sceneEdges = new Map(toSceneEdges(result).map((edge) => [edge.id, edge]));

    // Something has to have moved, or the assertions below are vacuous.
    expect(delta.nodes.added.length + delta.nodes.moved.length).toBeGreaterThan(0);
    for (const target of [...(motion.nodes?.added ?? []), ...(motion.nodes?.moved ?? [])]) {
      expect(target.center).toEqual(sceneNodes.get(target.id)?.center);
    }
    for (const target of [...(motion.edges?.added ?? []), ...(motion.edges?.rerouted ?? [])]) {
      expect(target.points).toEqual(sceneEdges.get(target.id)?.points);
    }
    expect(motion.bounds).toEqual(toWorldBounds(result.bounds));
    engine.dispose();
  });
});

describe('toMotionRoster', () => {
  it('takes the dressed scene as it stands, because a dressed node is a target', () => {
    const nodes: SceneNode[] = [
      {
        id: 'a',
        center: { x: 1, y: 2 },
        size: { width: 3, height: 4 },
        shape: 'roundedRect',
        cornerRadius: 1,
        fillColor: 0,
        glowColor: 0,
        glowWorld: 0,
      },
    ];
    const edges: SceneEdge[] = [
      {
        id: 'e',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: 0,
      },
    ];
    const bounds: WorldBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

    const roster = toMotionRoster(nodes, edges, bounds);

    expect(roster.nodes).toBe(nodes);
    expect(roster.edges).toBe(edges);
    expect(roster.bounds).toBe(bounds);
  });

  it('turns a scene with no box into a roster with no box', () => {
    expect(toMotionRoster([], [], null).bounds).toBeUndefined();
  });
});

describe('retarget', () => {
  it('applies a delta the motion can take', () => {
    const { motion, applied, resynced } = recordingMotion();
    const delta: LayoutDelta = {
      nodes: { added: [{ id: 'new', x: 1, y: 2, width: 1, height: 1 }], removed: [], moved: [] },
      edges: { added: [], removed: [], rerouted: [] },
      bounds: undefined,
    };

    expect(retarget(motion, delta, EMPTY_ROSTER)).toBe('applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]?.nodes?.added).toEqual([{ id: 'new', center: { x: 1, y: -2 } }]);
    expect(resynced).toHaveLength(0);
  });

  /**
   * A cold run is the one thing a delta cannot describe, and `useDagr` reports
   * one by having no delta at all: there is no previous drawing the geometry is
   * a difference FROM.
   */
  it('reseats the scene when there is no delta, because that is a cold run', () => {
    const { motion, applied, resynced } = recordingMotion();
    const roster: SceneMotionRoster = { nodes: [], edges: [], bounds: undefined };

    expect(retarget(motion, null, roster)).toBe('resynced');
    expect(resynced).toEqual([roster]);
    expect(applied).toHaveLength(0);
  });

  it('reseats the scene when the motion says the delta and the drawing disagree', () => {
    const { motion, resynced } = recordingMotion(new MotionDesyncError('x', 'moved[0]', 'absent'));
    const delta: LayoutDelta = {
      nodes: { added: [], removed: [], moved: [] },
      edges: { added: [], removed: [], rerouted: [] },
      bounds: undefined,
    };

    expect(retarget(motion, delta, EMPTY_ROSTER)).toBe('resynced');
    expect(resynced).toHaveLength(1);
  });

  /**
   * A resync cannot fix a number, so swallowing this one would draw the same
   * picture forever and say nothing, which is what the desync recovery exists
   * to avoid rather than to cause.
   */
  it('lets a refusal that is not a desync out', () => {
    const { motion } = recordingMotion(new RangeError('target x is not finite'));
    const delta: LayoutDelta = {
      nodes: { added: [], removed: [], moved: [] },
      edges: { added: [], removed: [], rerouted: [] },
      bounds: undefined,
    };

    expect(() => retarget(motion, delta, EMPTY_ROSTER)).toThrow(RangeError);
  });
});
