import { describe, expect, it } from 'vitest';
import { buildResult, createLayoutState, defaultStages, resolveConfig, runPipeline, runStages } from '../src/index.js';
import type { LayoutInput, LayoutState, PositionStage, ResolvedLayoutConfig } from '../src/index.js';

const input: LayoutInput = {
  nodes: [
    { id: 'a', width: 20, height: 10 },
    { id: 'b', width: 20, height: 10 },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
};

describe('stage plumbing', () => {
  it('runs the stages in rank, order, position, route sequence', () => {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (state: LayoutState, config: ResolvedLayoutConfig): void => {
        expect(state.nodes).toHaveLength(2);
        expect(config.rankDir).toBe('TB');
        calls.push(name);
      };

    runPipeline(input, undefined, {
      rank: record('rank'),
      order: record('order'),
      position: record('position'),
      route: record('route'),
    });

    expect(calls).toEqual(['rank', 'order', 'position', 'route']);
  });

  it('passes the resolved config, not the raw options, to every stage', () => {
    const seen: ResolvedLayoutConfig[] = [];
    runPipeline(input, { nodeSpacing: 4 }, { rank: (_state, config) => seen.push(config) });
    expect(seen).toEqual([resolveConfig({ nodeSpacing: 4 })]);
  });

  it('substitutes one stage and keeps the other three defaults', () => {
    const position: PositionStage = (state) => {
      for (const node of state.nodes) {
        node.x = 100;
        node.y = 200;
      }
    };

    const result = runPipeline(input, undefined, { position });

    expect(result.nodes.map((node) => [node.x, node.y])).toEqual([
      [100, 200],
      [100, 200],
    ]);
    // The default route stage still ran, over the substituted positions.
    expect(result.edges[0]?.points).toEqual([
      { x: 100, y: 200 },
      { x: 100, y: 200 },
    ]);
  });

  it('exposes the default stages both individually and as a bundle', () => {
    expect(Object.keys(defaultStages).sort()).toEqual(['order', 'position', 'rank', 'route']);
  });

  it('lets a custom rank stage drive the default order and position stages', () => {
    const result = runPipeline(
      input,
      { rankSpacing: 40, nodeSpacing: 0, marginX: 0, marginY: 0 },
      {
        rank: (state) => {
          state.nodes.forEach((node, index) => {
            node.rank = index;
          });
        },
      },
    );

    // Two ranks of one node each: 10 tall, 40 apart, centers at 5 and 55.
    expect(result.nodes.map((node) => node.y)).toEqual([5, 55]);
    expect(result.height).toBe(60);
  });

  it('numbers nodes of a single rank in input order', () => {
    const state = runStagesAndCapture();
    expect(state.nodes.map((node) => node.order)).toEqual([0, 1]);
    expect(state.nodes.map((node) => node.rank)).toEqual([0, 0]);
  });

  it('restarts the default order counter at 0 on every rank', () => {
    // Four nodes, two per rank, interleaved so a single running counter
    // would produce [0, 1, 2, 3] instead of the expected per-rank reset.
    const twoRanks: LayoutInput = {
      nodes: [
        { id: 'a', width: 20, height: 10 },
        { id: 'b', width: 20, height: 10 },
        { id: 'c', width: 20, height: 10 },
        { id: 'd', width: 20, height: 10 },
      ],
      edges: [],
    };
    const ranks = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 0],
      ['d', 1],
    ]);

    let captured: LayoutState | undefined;
    runPipeline(twoRanks, undefined, {
      rank: (state) => {
        for (const node of state.nodes) {
          node.rank = ranks.get(node.id);
        }
      },
      position: (state) => {
        captured = state;
      },
    });

    expect(captured?.nodes.map((node) => [node.id, node.rank, node.order])).toEqual([
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 0, 1],
      ['d', 1, 1],
    ]);
  });

  it('centers every node of a rank in the rank band, whatever its own size', () => {
    // One rank holding a 10 tall node and a 30 tall node: the band is 30
    // tall, so both centers sit at the band center, not at their own halves.
    const mixedHeights: LayoutInput = {
      nodes: [
        { id: 'short', width: 20, height: 10 },
        { id: 'tall', width: 20, height: 30 },
      ],
      edges: [],
    };

    const result = runPipeline(mixedHeights, { nodeSpacing: 0, rankSpacing: 40 });

    expect(result.nodes.map((node) => node.y)).toEqual([15, 15]);
    expect(result.height).toBe(30);
  });
});

describe('runStages', () => {
  it('runs the four stages in order over a state the caller built', () => {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (state: LayoutState): void => {
        expect(state.nodes).toHaveLength(2);
        calls.push(name);
      };

    const state = createLayoutState(input);
    runStages(state, resolveConfig(), {
      rank: record('rank'),
      order: record('order'),
      position: record('position'),
      route: record('route'),
    });

    expect(calls).toEqual(['rank', 'order', 'position', 'route']);
  });

  it('falls back to the default bundle for the stages left out', () => {
    const state = createLayoutState(input);
    runStages(state, resolveConfig({ nodeSpacing: 0 }), {
      rank: (each) => {
        each.nodes.forEach((node, index) => {
          node.rank = index;
        });
      },
    });

    // The default order, position and route stages all ran over that ranking.
    expect(state.nodes.map((node) => node.rank)).toEqual([0, 1]);
    expect(state.nodes.map((node) => node.order)).toEqual([0, 0]);
    expect(state.nodes.map((node) => node.y)).toEqual([5, 65]);
    expect(state.edges[0]?.points).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 65 },
    ]);
  });

  it('runs every default stage when given no bundle at all', () => {
    const state = createLayoutState(input);
    runStages(state, resolveConfig());
    expect(state.nodes.every((node) => node.x !== undefined)).toBe(true);
  });

  it('warm starts: hand-built state, stages, result matches runPipeline', () => {
    const config = resolveConfig({ nodeSpacing: 4, marginX: 3, marginY: 6 });
    const state = createLayoutState(input);
    runStages(state, config);

    expect(buildResult(state, config)).toEqual(runPipeline(input, { nodeSpacing: 4, marginX: 3, marginY: 6 }));
  });

  it('keeps the positions a warm-started state already carries', () => {
    const config = resolveConfig();
    const state = createLayoutState(input);

    // Pretend this state came back from a previous run with x, y and order
    // already on it, then run only the stages that do not overwrite them.
    state.nodes.forEach((node, index) => {
      node.rank = 0;
      node.order = 1 - index;
      node.x = 100 * index;
      node.y = 7;
    });
    const keep = (): void => {};
    runStages(state, config, { rank: keep, order: keep, position: keep });

    const result = buildResult(state, config);
    expect(result.nodes.map((node) => [node.x, node.y])).toEqual([
      [0, 7],
      [100, 7],
    ]);
    expect(result.edges[0]?.points).toEqual([
      { x: 0, y: 7 },
      { x: 100, y: 7 },
    ]);
  });
});

/** Run the default rank and order stages and hand back the state they produced. */
function runStagesAndCapture(): LayoutState {
  let captured: LayoutState | undefined;
  runPipeline(input, undefined, {
    position: (state) => {
      captured = state;
      defaultStages.position(state, resolveConfig());
    },
  });
  if (captured === undefined) {
    throw new Error('position stage never ran');
  }
  return captured;
}
