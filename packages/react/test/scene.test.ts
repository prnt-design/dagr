import { describe, expect, it } from 'vitest';
import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';
import type { LayoutResult, PositionedNode, RoutedEdge } from '@dagr/layout';
import {
  DEFAULT_EDGE_COLOR,
  DEFAULT_NODE_APPEARANCE,
  nodeWorldBounds,
  toSceneEdges,
  toSceneNodes,
  toWorldBounds,
} from '../src/scene.js';

/** A hand-built result, so a flip can be asserted against numbers chosen for it. */
function resultOf(
  nodes: readonly PositionedNode[],
  edges: readonly RoutedEdge[] = [],
  bounds = { x: 0, y: 0, width: 0, height: 0 },
): LayoutResult {
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
    bounds,
  };
}

describe('toWorldBounds', () => {
  it('flips a y-down rectangle into a y-up box', () => {
    expect(toWorldBounds({ x: 10, y: 4, width: 30, height: 6 })).toEqual({
      minX: 10,
      maxX: 40,
      minY: -10,
      maxY: -4,
    });
  });

  it('keeps a box the right way up, however the rectangle sat', () => {
    const box = toWorldBounds({ x: -5, y: -20, width: 2, height: 3 });
    expect(box.minX).toBeLessThan(box.maxX);
    expect(box.minY).toBeLessThan(box.maxY);
  });
});

describe('toSceneNodes', () => {
  it('negates y, keeps x and the size, and carries the id', () => {
    const scene = toSceneNodes(resultOf([{ id: 'a', x: 12, y: 40, width: 100, height: 20 }]));
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({
      id: 'a',
      center: { x: 12, y: -40 },
      size: { width: 100, height: 20 },
    });
  });

  it('takes every appearance field from the defaults when nothing is said', () => {
    const scene = toSceneNodes(resultOf([{ id: 'a', x: 0, y: 0, width: 4, height: 4 }]));
    expect(scene[0]).toMatchObject(DEFAULT_NODE_APPEARANCE);
  });

  it('merges an appearance per field rather than wholesale', () => {
    const scene = toSceneNodes(resultOf([{ id: 'a', x: 0, y: 0, width: 4, height: 4 }]), () => ({
      fillColor: 0x112233,
    }));
    expect(scene[0]?.fillColor).toBe(0x112233);
    expect(scene[0]?.glowColor).toBe(DEFAULT_NODE_APPEARANCE.glowColor);
    expect(scene[0]?.shape).toBe(DEFAULT_NODE_APPEARANCE.shape);
  });

  it('falls back to the defaults for a node the callback has no opinion about', () => {
    const scene = toSceneNodes(
      resultOf([
        { id: 'a', x: 0, y: 0, width: 4, height: 4 },
        { id: 'b', x: 8, y: 0, width: 4, height: 4 },
      ]),
      (id) => (id === 'a' ? { shape: 'circle' } : undefined),
    );
    expect(scene[0]?.shape).toBe('circle');
    expect(scene[1]?.shape).toBe(DEFAULT_NODE_APPEARANCE.shape);
  });

  it('emits in the iteration order of the result it was given', () => {
    const scene = toSceneNodes(
      resultOf([
        { id: 'first', x: 0, y: 0, width: 1, height: 1 },
        { id: 'second', x: 1, y: 0, width: 1, height: 1 },
        { id: 'third', x: 2, y: 0, width: 1, height: 1 },
      ]),
    );
    expect(scene.map((node) => node.id)).toEqual(['first', 'second', 'third']);
  });
});

describe('toSceneEdges', () => {
  it('negates every route point and keeps the source-to-target direction', () => {
    const scene = toSceneEdges(
      resultOf(
        [],
        [
          {
            id: 'e',
            source: 'a',
            target: 'b',
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 10 },
              { x: 5, y: 30 },
            ],
          },
        ],
      ),
    );
    expect(scene[0]?.points).toEqual([
      { x: 0, y: -0 },
      { x: 5, y: -10 },
      { x: 5, y: -30 },
    ]);
  });

  it('colours an edge from the default when nothing is said', () => {
    const scene = toSceneEdges(
      resultOf([], [{ id: 'e', source: 'a', target: 'b', points: [{ x: 0, y: 0 }] }]),
    );
    expect(scene[0]?.color).toBe(DEFAULT_EDGE_COLOR);
  });

  it('takes a colour per edge, and the default for an edge with none', () => {
    const scene = toSceneEdges(
      resultOf(
        [],
        [
          { id: 'lit', source: 'a', target: 'b', points: [{ x: 0, y: 0 }] },
          { id: 'plain', source: 'b', target: 'c', points: [{ x: 0, y: 0 }] },
        ],
      ),
      (id) => (id === 'lit' ? 0xff0000 : undefined),
    );
    expect(scene[0]?.color).toBe(0xff0000);
    expect(scene[1]?.color).toBe(DEFAULT_EDGE_COLOR);
  });
});

describe('nodeWorldBounds', () => {
  it('is the y-up box around a centred node', () => {
    expect(nodeWorldBounds({ id: 'a', x: 10, y: 20, width: 8, height: 4 })).toEqual({
      minX: 6,
      maxX: 14,
      minY: -22,
      maxY: -18,
    });
  });

  it('agrees with the scene node it stands over', () => {
    const node: PositionedNode = { id: 'a', x: 3, y: 7, width: 10, height: 6 };
    const box = nodeWorldBounds(node);
    const scene = toSceneNodes(resultOf([node]))[0];
    expect((box.minX + box.maxX) / 2).toBe(scene?.center.x);
    expect((box.minY + box.maxY) / 2).toBe(scene?.center.y);
  });
});

describe('the flip over a real layout', () => {
  // The one check a hand-built fixture cannot make: nodes, routes and bounds
  // are flipped by three separate expressions, and a flip applied to two of
  // the three is a picture drawn half upside down with every unit test green.
  const graph = new Graph();
  for (const id of ['a', 'b', 'c', 'd']) graph.addNode({ id });
  graph.addEdge({ source: 'a', target: 'b' });
  graph.addEdge({ source: 'a', target: 'c' });
  graph.addEdge({ source: 'b', target: 'd' });
  graph.addEdge({ source: 'c', target: 'd' });
  const result = layout({ graph });

  it('puts every node centre inside the flipped bounds', () => {
    const box = toWorldBounds(result.bounds);
    for (const node of toSceneNodes(result)) {
      expect(node.center.x).toBeGreaterThanOrEqual(box.minX);
      expect(node.center.x).toBeLessThanOrEqual(box.maxX);
      expect(node.center.y).toBeGreaterThanOrEqual(box.minY);
      expect(node.center.y).toBeLessThanOrEqual(box.maxY);
    }
  });

  it('puts every route point inside the flipped bounds', () => {
    const box = toWorldBounds(result.bounds);
    for (const edge of toSceneEdges(result)) {
      for (const point of edge.points) {
        expect(point.x).toBeGreaterThanOrEqual(box.minX);
        expect(point.x).toBeLessThanOrEqual(box.maxX);
        expect(point.y).toBeGreaterThanOrEqual(box.minY);
        expect(point.y).toBeLessThanOrEqual(box.maxY);
      }
    }
  });

  it('draws the source above the target, which is what the flip is for', () => {
    // Layout ranks downwards in y-down space. After the flip a source has to
    // sit ABOVE its target in y-up space, or the whole picture is inverted.
    const nodes = new Map(toSceneNodes(result).map((node) => [node.id, node]));
    expect(nodes.get('a')?.center.y).toBeGreaterThan(nodes.get('b')?.center.y ?? 0);
    expect(nodes.get('b')?.center.y).toBeGreaterThan(nodes.get('d')?.center.y ?? 0);
  });
});
