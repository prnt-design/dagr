import { describe, expect, it } from 'vitest';
import { addDummyNode, layout, reverseEdge, runPipeline } from '../src/index.js';
import type { LayoutEdgeState, LayoutInput, RankDir, RankStage } from '../src/index.js';

/** Three same-sized nodes in a row, no edges. */
const threeNodes: LayoutInput = {
  nodes: [
    { id: 'a', width: 20, height: 10 },
    { id: 'b', width: 20, height: 10 },
    { id: 'c', width: 20, height: 10 },
  ],
  edges: [],
};

/** Rank stage that puts node i on rank i, so rank direction is observable. */
const oneNodePerRank: RankStage = (state) => {
  state.nodes.forEach((node, index) => {
    node.rank = index;
  });
};

describe('layout with default stages', () => {
  it('centers a single node inside its own bounding box', () => {
    const result = layout({ nodes: [{ id: 'a', width: 40, height: 20 }], edges: [] });
    expect(result.nodes).toEqual([{ id: 'a', x: 20, y: 10, width: 40, height: 20 }]);
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
  });

  it('honors nodeSpacing between nodes in one rank', () => {
    const result = layout(threeNodes, { nodeSpacing: 30 });
    expect(result.nodes.map((node) => node.x)).toEqual([10, 60, 110]);
    expect(result.nodes.map((node) => node.y)).toEqual([5, 5, 5]);
    // Three 20 wide nodes and two 30 wide gaps.
    expect(result.width).toBe(120);
    expect(result.height).toBe(10);
  });

  it('packs nodes edge to edge when nodeSpacing is zero', () => {
    const result = layout(threeNodes, { nodeSpacing: 0 });
    expect(result.nodes.map((node) => node.x)).toEqual([10, 30, 50]);
    expect(result.width).toBe(60);
  });

  it('keeps output in input order', () => {
    const result = layout(threeNodes);
    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
  });

  it('adds margins on both sides of the content', () => {
    const result = layout({ nodes: [{ id: 'a', width: 40, height: 20 }], edges: [] }, { marginX: 5, marginY: 7 });
    expect(result.nodes[0]).toEqual({ id: 'a', x: 25, y: 17, width: 40, height: 20 });
    expect(result.width).toBe(50);
    expect(result.height).toBe(34);
  });

  it('reports an empty bounding box for an empty graph, margins included', () => {
    const result = layout({ nodes: [], edges: [] }, { marginX: 5, marginY: 7 });
    expect(result.width).toBe(10);
    expect(result.height).toBe(14);
  });
});

describe('content origin', () => {
  const single: LayoutInput = { nodes: [{ id: 'a', width: 40, height: 20 }], edges: [] };

  it('reports the origin at 0, 0 when the position stage honors the margins', () => {
    const plain = layout(single);
    expect([plain.minX, plain.minY]).toEqual([0, 0]);

    // The default position stage starts the content at (marginX, marginY),
    // so the margin box still starts at the origin.
    const margined = layout(single, { marginX: 5, marginY: 7 });
    expect([margined.minX, margined.minY]).toEqual([0, 0]);
    expect(margined.width).toBe(50);
    expect(margined.height).toBe(34);
  });

  it('spans the content: the box is minX, minY, width, height', () => {
    const result = layout(threeNodes, { nodeSpacing: 10, marginX: 5, marginY: 7 });
    const left = Math.min(...result.nodes.map((node) => node.x - node.width / 2));
    const right = Math.max(...result.nodes.map((node) => node.x + node.width / 2));

    expect(result.minX).toBe(left - 5);
    expect(result.minX + result.width).toBe(right + 5);
  });

  it('goes negative when a position stage places content left of the origin', () => {
    const result = runPipeline(single, { marginX: 5, marginY: 7 }, {
      position: (state) => {
        for (const node of state.nodes) {
          node.x = -100;
          node.y = -50;
        }
      },
    });

    // Node spans x -120 to -80 and y -60 to -40, plus the margins.
    expect(result.minX).toBe(-125);
    expect(result.minY).toBe(-67);
    expect(result.width).toBe(50);
    expect(result.height).toBe(34);
    expect(result.minX + result.width).toBe(-75);
    expect(result.minY + result.height).toBe(-33);
  });

  it('puts the degenerate box of an empty graph at the origin', () => {
    const empty = layout({ nodes: [], edges: [] });
    expect([empty.minX, empty.minY, empty.width, empty.height]).toEqual([0, 0, 0, 0]);

    const margined = layout({ nodes: [], edges: [] }, { marginX: 5, marginY: 7 });
    expect([margined.minX, margined.minY]).toEqual([0, 0]);
    expect([margined.width, margined.height]).toEqual([10, 14]);
  });

  it('does not normalize: moving one node leaves the others where they were', () => {
    // The M3 animation-stability contract. A run whose extreme node moves
    // must not shift every other node, so the engine never re-origins the
    // drawing, it reports where the drawing ended up instead.
    const drift = (x: number): ReturnType<typeof runPipeline> =>
      runPipeline(
        {
          nodes: [
            { id: 'a', width: 20, height: 10 },
            { id: 'b', width: 20, height: 10 },
          ],
          edges: [],
        },
        undefined,
        {
          position: (state) => {
            const [a, b] = state.nodes;
            if (a !== undefined) {
              a.x = 10;
              a.y = 5;
            }
            if (b !== undefined) {
              b.x = x;
              b.y = 5;
            }
          },
        },
      );

    const before = drift(-100);
    const after = drift(-500);

    expect(before.nodes[0]).toEqual(after.nodes[0]);
    expect(before.minX).toBe(-110);
    expect(after.minX).toBe(-510);
  });
});

describe('rank direction', () => {
  it('lays a single rank across the x axis for TB and BT', () => {
    for (const rankDir of ['TB', 'BT'] as const) {
      const result = layout(threeNodes, { rankDir, nodeSpacing: 10 });
      expect(result.nodes.map((node) => node.x)).toEqual([10, 40, 70]);
      expect(result.nodes.map((node) => node.y)).toEqual([5, 5, 5]);
    }
  });

  it('lays a single rank down the y axis for LR and RL', () => {
    for (const rankDir of ['LR', 'RL'] as const) {
      const result = layout(threeNodes, { rankDir, nodeSpacing: 10 });
      expect(result.nodes.map((node) => node.x)).toEqual([10, 10, 10]);
      expect(result.nodes.map((node) => node.y)).toEqual([5, 25, 45]);
    }
  });

  it('stacks ranks in the configured direction', () => {
    const expected: Record<RankDir, readonly (readonly [number, number])[]> = {
      // Rank 0 on top, rank 1 below it, 50 apart.
      TB: [
        [10, 5],
        [10, 65],
      ],
      // Rank 0 at the bottom.
      BT: [
        [10, 65],
        [10, 5],
      ],
      // Rank 0 on the left. The rank band is 20 wide here, not 10 tall.
      LR: [
        [10, 5],
        [80, 5],
      ],
      // Rank 0 on the right.
      RL: [
        [80, 5],
        [10, 5],
      ],
    };

    for (const [rankDir, positions] of Object.entries(expected) as [
      RankDir,
      readonly (readonly [number, number])[],
    ][]) {
      const result = runPipeline(
        {
          nodes: [
            { id: 'a', width: 20, height: 10 },
            { id: 'b', width: 20, height: 10 },
          ],
          edges: [],
        },
        { rankDir, rankSpacing: 50 },
        { rank: oneNodePerRank },
      );
      expect(result.nodes.map((node) => [node.x, node.y])).toEqual(positions.map((pair) => [...pair]));
    }
  });
});

describe('edge routes', () => {
  it('routes a straight line between the two node centers', () => {
    const result = layout({
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 20, height: 10 },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    });

    const [a, b] = result.nodes;
    const route = result.edges[0];
    expect(route?.id).toBe('e');
    expect(route?.source).toBe('a');
    expect(route?.target).toBe('b');
    expect(route?.points).toEqual([
      { x: a?.x, y: a?.y },
      { x: b?.x, y: b?.y },
    ]);
  });

  it('routes parallel edges identically and keeps both', () => {
    const result = layout({
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 20, height: 10 },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'b' },
      ],
    });

    expect(result.edges.map((edge) => edge.id)).toEqual(['e1', 'e2']);
    expect(result.edges[0]?.points).toEqual(result.edges[1]?.points);
  });

  it('routes a self loop as a degenerate two point line at the node center', () => {
    const result = layout({
      nodes: [{ id: 'a', width: 20, height: 10 }],
      edges: [{ id: 'loop', source: 'a', target: 'a' }],
    });

    expect(result.edges[0]?.points).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 5 },
    ]);
  });
});

describe('result provenance', () => {
  const single: LayoutInput = { nodes: [{ id: 'a', width: 40, height: 20 }], edges: [] };

  it('keeps a stage-inserted dummy node out of the nodes and out of the size', () => {
    const plain = layout(single);
    // The dummy joins rank 0, so the default position stage places it one
    // nodeSpacing to the right of `a`, at x 70. Counting it would stretch
    // the bounding box from 40 to 70 wide.
    const withDummy = runPipeline(single, undefined, {
      rank: (state) => {
        addDummyNode(state, { rank: 0 });
      },
    });

    expect(withDummy.nodes).toEqual(plain.nodes);
    expect(withDummy.nodes).toHaveLength(1);
    expect(withDummy.width).toBe(plain.width);
    expect(withDummy.height).toBe(plain.height);
    expect(withDummy.minX).toBe(plain.minX);
    expect(withDummy.minY).toBe(plain.minY);
  });

  it('emits whole input edges only, not the segments a stage splits them into', () => {
    const chain: LayoutInput = {
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 20, height: 10 },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    };

    const result = runPipeline(chain, undefined, {
      rank: (state) => {
        const dummy = addDummyNode(state, { rank: 0 });
        // A stage-created record numbers itself with the master list length
        // at the moment it is created, so `first` lands before `second`.
        const first: LayoutEdgeState = {
          id: 'e/0',
          index: state.edges.length,
          source: 'a',
          target: dummy.id,
          of: 'e',
          reversed: false,
          points: [],
        };
        state.edges.push(first);
        const second: LayoutEdgeState = {
          id: 'e/1',
          index: state.edges.length,
          source: dummy.id,
          target: 'b',
          of: 'e',
          reversed: false,
          points: [],
        };
        state.edges.push(second);
        state.outEdges.get('a')?.push(first);
        state.inEdges.get(dummy.id)?.push(first);
        state.outEdges.get(dummy.id)?.push(second);
        state.inEdges.get('b')?.push(second);
      },
    });

    expect(result.edges.map((edge) => edge.id)).toEqual(['e']);
  });

  it('reports an edge a stage reversed with its input endpoints, source end first', () => {
    const chain: LayoutInput = {
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 20, height: 10 },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    };

    const result = runPipeline(chain, undefined, {
      rank: (state) => {
        for (const edge of state.edges) {
          reverseEdge(state, edge);
        }
      },
    });

    const [a, b] = result.nodes;
    const route = result.edges[0];
    expect(route?.source).toBe('a');
    expect(route?.target).toBe('b');
    // The router ran over the reversed edge, so it drew b to a. The result
    // undoes the reversal, points included.
    expect(route?.points).toEqual([
      { x: a?.x, y: a?.y },
      { x: b?.x, y: b?.y },
    ]);
  });
});

describe('purity', () => {
  it('does not mutate the caller input object, arrays, or records', () => {
    const nodes = [
      { id: 'a', width: 20, height: 10 },
      { id: 'b', width: 20, height: 10 },
    ];
    const edges = [{ id: 'e', source: 'a', target: 'b' }];
    const input: LayoutInput = { nodes, edges };
    const snapshot = structuredClone({ nodes, edges });

    Object.freeze(input);
    nodes.forEach((node) => Object.freeze(node));
    edges.forEach((edge) => Object.freeze(edge));
    Object.freeze(nodes);
    Object.freeze(edges);

    expect(() => layout(input)).not.toThrow();
    expect({ nodes, edges }).toEqual(snapshot);
  });

  it('produces deeply equal results for repeated runs', () => {
    const input: LayoutInput = {
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 35, height: 12 },
        { id: 'c', width: 5, height: 40 },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'c' },
      ],
    };

    expect(layout(input, { rankDir: 'LR' })).toEqual(layout(input, { rankDir: 'LR' }));
  });

  it('returns results that share no structure with a previous run', () => {
    const input: LayoutInput = { nodes: [{ id: 'a', width: 20, height: 10 }], edges: [] };
    const first = layout(input);
    const second = layout(input);
    expect(first.nodes[0]).not.toBe(second.nodes[0]);
  });
});
