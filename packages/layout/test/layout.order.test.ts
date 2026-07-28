import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { InvalidConfigError } from '../src/errors.js';
import { barycenterOrder, barycenterOrderStage, countCrossings } from '../src/order.js';
import { longestPathRankStage } from '../src/rank.js';
import { defaultStages, insertionOrderStage } from '../src/stages.js';
import { layout } from '../src/pipeline.js';
import { mulberry32, randomDigraph, randomLayered } from './random.js';
import type { GraphSpec } from '@dagr/bench';
import type { NodeId } from '@dagr/graph';
import type { RankedState, Size } from '../src/types.js';

/**
 * The barycenter order stage: its seed, its sweeps, its options, and the one
 * guarantee that makes it safe to reach for, which is that it never hands back
 * a worse drawing than the one it started from.
 *
 * Most of what is pinned here is pinned through `maxSweeps: 0`, which runs no
 * sweep at all and returns the seed permutation. That is deliberate. The seed
 * is the part M3.6 warm starts from, so it is the part a future change is most
 * likely to break by accident and least likely to be caught breaking: a
 * different seed still produces a legal layering with a plausible crossing
 * count, and only the M3 stability metrics would ever notice.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/**
 * A `RankedState` with the ranks written out as the layers they stand for.
 *
 * The order stage is the one stage whose input is easier to state than to
 * produce: going through a real ranker would tie every case below to whatever
 * `longestPathRankStage` happens to do with the witness graph, which is not
 * what any of them is about. The runner's own checks are exercised separately,
 * through `layout` with this stage as an override.
 */
function stateOf(graph: Graph, layers: readonly (readonly NodeId[])[]): RankedState {
  const ranks = new Map<NodeId, number>();
  for (const [rank, ids] of layers.entries()) {
    for (const id of ids) ranks.set(id, rank);
  }
  const sizes = new Map<NodeId, Size>();
  for (const id of ranks.keys()) sizes.set(id, { width: 10, height: 10 });
  return {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks,
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
  };
}

/**
 * The layers a stage produces for a state, as plain arrays for comparison.
 *
 * The transpose pass is OFF unless a case here turns it on, which is a choice
 * about what this file is for. Everything below is about the seed, the hint or
 * the sweeps, and a refinement pass running after all three would be answering
 * for them: a seed test would stop failing when a bad seed was tidied up
 * afterwards. The pass has a suite of its own in `layout.transpose.test.ts`,
 * and the figures it reaches on the bench corpora are pinned at the foot of
 * this one.
 */
function ordered(state: RankedState, options?: Parameters<typeof barycenterOrder>[0]): NodeId[][] {
  return barycenterOrder({ maxTransposePasses: 0, ...options })
    .run(state)
    .layers.map((layer) => [...layer]);
}

describe('barycenterOrder, the seed permutation', () => {
  /**
   * The rule M3.6 warm starts from, on the smallest graph that shows it. Roster
   * order puts `c` before `d` because that is the order they were added in; the
   * walk reaches `d` first, from `a`, and reaches `c` afterwards from `b`.
   */
  it('seeds a layer by the walk over adjacent-layer edges, not by roster order', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'd'],
        ['b', 'c'],
      ],
    );
    const state = stateOf(graph, [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ]);
    // What roster order does with the same input, so that the difference is in
    // the file rather than in a reader's head. `insertionOrderStage` by name
    // rather than through `defaultStages`, because what this needs is that one
    // stage: a fixture that tracks the default silently changes what the case
    // measures the moment the default moves, which is what M2.6b did to it.
    expect(insertionOrderStage.run(state).layers).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  /**
   * The walk follows an adjacent-layer edge in BOTH directions. Here the outer
   * loop starts at `c`, which is the first node the roster holds, and the only
   * way out of it is up its two in-edges.
   */
  it('follows an adjacent-layer edge upward as well as downward', () => {
    const graph = build(
      ['c', 'b', 'a'],
      [
        ['a', 'c'],
        ['b', 'c'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['c']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a', 'b'], ['c']]);
    expect(insertionOrderStage.run(state).layers).toEqual([['b', 'a'], ['c']]);
  });

  /**
   * An edge whose endpoints are more than one layer apart is not a step the
   * walk can take, which is the decision D1 records: the seed is built from the
   * edges the sweeps can see rather than from every edge. Following `a -> z`
   * would put `z` in front of `y`, and it does not.
   */
  it('does not follow an edge that spans more than one layer', () => {
    const graph = build(
      ['a', 'b', 'm', 'y', 'z'],
      [
        ['a', 'z'],
        ['m', 'y'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['m'], ['y', 'z']]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([['a', 'b'], ['m'], ['y', 'z']]);
  });

  /** A node nothing reaches is appended when the outer loop gets to it. */
  it('appends an unreached node in roster order', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'e'],
        ['b', 'd'],
      ],
    );
    const state = stateOf(graph, [
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
    expect(ordered(state, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['e', 'd', 'c'],
    ]);
  });
});

describe('barycenterOrder, the initialOrder hint', () => {
  const graph = build(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'd'],
      ['b', 'c'],
    ],
  );
  const state = stateOf(graph, [
    ['a', 'b'],
    ['c', 'd'],
  ]);

  it('reproduces a hint that names every node', () => {
    const hint = [
      ['b', 'a'],
      ['c', 'd'],
    ];
    expect(ordered(state, { maxSweeps: 0, initialOrder: hint })).toEqual(hint);
  });

  it('ignores hint entries the roster does not hold', () => {
    const layers = ordered(state, {
      maxSweeps: 0,
      initialOrder: [['ghost', 'b', 'a'], ['phantom']],
    });
    expect(layers).toEqual([
      ['b', 'a'],
      ['d', 'c'],
    ]);
  });

  /**
   * An id the hint puts in the wrong layer contributes nothing but its position
   * within its own hint layer, and that position is only ever compared with the
   * positions of ids listed in the SAME hint layer. The hint below claims `d`
   * sits above `a`, so all it says about the second layer is where `c` sits in
   * it, which is a layer of one and therefore nothing. `d` stays in front of
   * `c` because the walk put it there.
   */
  it('reads a misplaced id as a position within its own hint layer', () => {
    const layers = ordered(state, { maxSweeps: 0, initialOrder: [['d', 'b', 'a'], ['c']] });
    expect(layers).toEqual([
      ['b', 'a'],
      ['d', 'c'],
    ]);
  });

  /**
   * The same hint against a graph whose walk disagrees with it, which is what
   * separates "keys are per hint layer" from "keys are positions in the whole
   * flattened hint". Here the walk reaches `c` first, and the hint lists `d` in
   * its first layer and `c` in its second. A flattened key would put `d` ahead
   * of `c` on the strength of `d` having been listed earlier, which is a
   * relation between two hint layers rather than one the hint ever expressed.
   * Their keys tie instead, and the tie falls through to the walk, so structure
   * decides.
   */
  it('ties two ids the hint lists in different layers, and the walk breaks it', () => {
    const crossed = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'c'],
        ['b', 'd'],
      ],
    );
    const crossedState = stateOf(crossed, [
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(ordered(crossedState, { maxSweeps: 0 })).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const layers = ordered(crossedState, {
      maxSweeps: 0,
      initialOrder: [['d', 'b', 'a'], ['c']],
    });
    expect(layers).toEqual([
      ['b', 'a'],
      ['c', 'd'],
    ]);
  });

  /**
   * A hint that names some of a layer's nodes moves those and only those. `u`
   * is unnamed, so it holds the index the walk gave it, index 1, and `x` and
   * `y` permute among the two indices that leaves. The M3.6 case this is: a
   * re-layout of a patch that added nodes hands back a hint naming every old
   * node and no new one, and the new ones have to keep the walk that saw their
   * edges rather than being swept to one end of the layer.
   */
  it('leaves an id the hint does not name at its walk index', () => {
    const partial = build(
      ['p', 'x', 'u', 'q', 'y'],
      [
        ['p', 'x'],
        ['q', 'y'],
      ],
    );
    const partialState = stateOf(partial, [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ]);
    expect(ordered(partialState, { maxSweeps: 0 })).toEqual([
      ['p', 'q'],
      ['x', 'u', 'y'],
    ]);
    const layers = ordered(partialState, {
      maxSweeps: 0,
      initialOrder: [
        ['p', 'q'],
        ['y', 'x'],
      ],
    });
    expect(layers).toEqual([
      ['p', 'q'],
      ['y', 'u', 'x'],
    ]);
  });

  /**
   * Both halves of the rule that keys a hint layer: an id takes its FIRST
   * position there, and a repeat consumes no index. `initialOrder` is untrusted
   * input, so a hint that lists an id twice is a case rather than a curiosity.
   *
   * The witness needs a second hint layer before the second half is visible at
   * all. Within one hint layer only the ORDER of the keys is ever read, so an
   * index a repeat had eaten would push every later key up by one and change
   * nothing. It is against a key from ANOTHER hint layer that the shift shows:
   * `y` and `w` are keyed 1 apiece and therefore tie, the walk breaks the tie,
   * and a consumed index would be what took that tie away.
   *
   * Pinned against the concrete layering as well as against the same hint with
   * the duplicate removed, because two runs that broke the same way would agree
   * with each other and say nothing.
   */
  it("takes an id's first position in a hint layer, and a repeat consumes no index", () => {
    const fan = build(
      ['a', 'x', 'y', 'z', 'w'],
      [
        ['a', 'x'],
        ['a', 'y'],
        ['a', 'z'],
        ['a', 'w'],
      ],
    );
    const fanState = stateOf(fan, [['a'], ['x', 'y', 'z', 'w']]);
    expect(ordered(fanState, { maxSweeps: 0 })).toEqual([['a'], ['x', 'y', 'z', 'w']]);
    const duplicated = ordered(fanState, {
      maxSweeps: 0,
      initialOrder: [
        ['x', 'x', 'y'],
        ['z', 'w'],
      ],
    });
    expect(duplicated).toEqual([['a'], ['x', 'z', 'y', 'w']]);
    expect(duplicated).toEqual(
      ordered(fanState, {
        maxSweeps: 0,
        initialOrder: [
          ['x', 'y'],
          ['z', 'w'],
        ],
      }),
    );
  });

  it('leaves the walk order alone when the hint names nothing it holds', () => {
    const cold = ordered(state, { maxSweeps: 0 });
    expect(ordered(state, { maxSweeps: 0, initialOrder: [] })).toEqual(cold);
    expect(ordered(state, { maxSweeps: 0, initialOrder: [['ghost'], ['phantom']] })).toEqual(cold);
  });
});

describe('barycenterOrder, the sweeps', () => {
  /**
   * D2 on the smallest layering that shows it. Fixing `p q` above, `y` wants
   * index 0 and `x` wants index 1, so the pair has to swap; `u` has no
   * neighbour above at all, so it keeps index 1 and the pair sorts into the
   * indices left over, which are 0 and 2.
   */
  it('pins a node the fixed layer says nothing about at its own index', () => {
    const graph = build(
      ['p', 'q', 'x', 'u', 'y'],
      [
        ['p', 'y'],
        ['q', 'x'],
      ],
    );
    const state = stateOf(graph, [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ]);
    const seed = [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ];
    expect(ordered(state, { maxSweeps: 0, initialOrder: seed })).toEqual(seed);
    expect(ordered(state, { maxSweeps: 1, initialOrder: seed })).toEqual([
      ['p', 'q'],
      ['y', 'u', 'x'],
    ]);
  });

  /**
   * The same rule, asserted where the SHIPPING stage actually runs it.
   *
   * `ordered` turns the pass off so that the sweep and seed rules above are
   * tested without a later pass answering for them, which is right for those.
   * It is wrong for this one: the pinning rule is precisely the rule the
   * transpose pass was found to override, because an unanchored node has a
   * delta of zero on both sides and the pass takes zero-delta swaps. Asserting
   * it only with the pass off would assert it only in the configuration where
   * it happens to survive, which is the shape of test that let the defect
   * through in the first place.
   */
  it('pins that node at its own index with the transpose pass on as well', () => {
    const graph = build(
      ['a', 'b', 'x', 'y', 'u'],
      [
        ['a', 'y'],
        ['b', 'x'],
      ],
    );
    const seed = [
      ['a', 'b'],
      ['x', 'y', 'u'],
    ];
    const state = stateOf(graph, seed);
    expect(
      barycenterOrder({ maxSweeps: 0, initialOrder: seed })
        .run(state)
        .layers.map((layer) => [...layer]),
    ).toEqual([
      ['b', 'a'],
      ['x', 'y', 'u'],
    ]);
  });

  /**
   * A hint that names nothing must stay silent at the default cap too, for the
   * same reason: `applyHint` and the pass are the two things that can move a
   * node without the sweeps asking, and turning one off to test the other
   * leaves the pair untested together.
   */
  it('ignores a hint that names nothing, with the transpose pass on', () => {
    const graph = build(
      ['p', 'q', 'x', 'u', 'y'],
      [
        ['p', 'y'],
        ['q', 'x'],
      ],
    );
    const state = stateOf(graph, [
      ['p', 'q'],
      ['x', 'u', 'y'],
    ]);
    const cold = barycenterOrder({ maxSweeps: 0 })
      .run(state)
      .layers.map((layer) => [...layer]);
    for (const hint of [[], [['ghost'], ['phantom']]]) {
      expect(
        barycenterOrder({ maxSweeps: 0, initialOrder: hint })
          .run(state)
          .layers.map((layer) => [...layer]),
      ).toEqual(cold);
    }
  });

  it('never returns more crossings than its own seed', () => {
    const random = mulberry32(0x5eed);
    let seedTotal = 0;
    let sweptTotal = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { graph, layers } = randomLayered(random, 120, 6, 400);
      const state = stateOf(graph, layers);
      const seed = ordered(state, { maxSweeps: 0 });
      const swept = ordered(state);
      seedTotal += countCrossings({ graph, layers: seed });
      sweptTotal += countCrossings({ graph, layers: swept });
      expect(countCrossings({ graph, layers: swept })).toBeLessThanOrEqual(
        countCrossings({ graph, layers: seed }),
      );
    }
    // Not a vacuous property: the sweeps really do move these graphs. The
    // margin is a floor rather than a pin, because what is being ruled out is
    // an implementation that returns its seed and passes the loop above.
    expect(sweptTotal).toBeLessThan(seedTotal * 0.75);
  });

  /**
   * The property "keep the best layering seen" exists to guarantee, and the one
   * that fails if it is dropped: a bigger budget is never a worse answer.
   *
   * The sweeps are NOT monotone. On the first graph below the layering after
   * five sweeps is worse than the layering after four, and on the second it
   * alternates for the whole run, so a stage that returned its last layering
   * would return the worse of the two at half the budgets it is given. Only the
   * comparison across budgets catches that: comparing against the seed does
   * not, because even a bad sweep is far better than the seed.
   */
  it('is monotone in the sweep budget, because the best seen is what comes back', () => {
    const random = mulberry32(1);
    for (const [nodes, depth, edges] of [
      [40, 4, 90],
      [120, 6, 400],
      [30, 3, 70],
      [200, 8, 700],
    ] as const) {
      const { graph, layers } = randomLayered(random, nodes, depth, edges);
      const state = stateOf(graph, layers);
      const scores = [];
      for (let budget = 0; budget <= 8; budget += 1) {
        scores.push(countCrossings({ graph, layers: ordered(state, { maxSweeps: budget }) }));
      }
      for (const [budget, crossings] of scores.entries()) {
        if (budget === 0) continue;
        expect(crossings).toBeLessThanOrEqual(scores[budget - 1] ?? crossings);
      }
    }
  });

  /**
   * The early stop, on the graph that shows what a one-round stop cost.
   *
   * Stopping on the FIRST round that lowered the best seen by nothing gave 1,055
   * crossings here where the full budget of 8 reaches 893, because the layering
   * carried into the next round is the last one rather than the best one, so a
   * round that improved nothing is not proof that the next one will not. Two
   * consecutive fruitless rounds is the rule that ships, and on this graph it
   * runs the budget out and reaches the same 893 the full budget does.
   *
   * A pin rather than an inequality, because what is being ruled out is a stop
   * that fires a round too early, and 893 is what firing at the right time is
   * worth. See the sweeps section of {@link barycenterOrder}.
   */
  it('does not stop on the first fruitless round, which used to cost 18%', () => {
    const { graph, layers } = randomLayered(mulberry32(69), 150, 7, 320);
    const state = stateOf(graph, layers);
    expect(countCrossings({ graph, layers: ordered(state) })).toBe(893);
  });

  /**
   * The word CONSECUTIVE in that same rule, which is a separate claim from the
   * one above and takes a bigger budget to make. Two fruitless rounds end the
   * run only when they are adjacent, and the reset of the counter is the whole
   * of what makes them so.
   *
   * At the DEFAULT budget of 8 the two rules are indistinguishable, which is
   * why no case above and no corpus pin below can defend this one. Eight sweeps
   * are four rounds, so there are only four round checks, and a fruitless round
   * with a fruitful one after it and a second fruitless one after that needs
   * three of them plus sweeps still left to run before the difference is worth
   * anything. A budget of 16 gives it the room: on this graph a counter that
   * accumulated across non-adjacent rounds stops early at 1,118 crossings,
   * which is already what a budget of 8 reaches, and resetting it carries the
   * run on to 1,016.
   */
  it('counts two fruitless rounds only when they are consecutive', () => {
    const { graph, layers } = randomLayered(mulberry32(111), 150, 7, 320);
    const state = stateOf(graph, layers);
    expect(countCrossings({ graph, layers: ordered(state, { maxSweeps: 16 }) })).toBe(1_016);
  });

  it('improves with a bigger sweep budget, and runs no sweep at all at zero', () => {
    const random = mulberry32(11);
    const { graph, layers } = randomLayered(random, 200, 8, 700);
    const state = stateOf(graph, layers);
    const at = (maxSweeps: number): number =>
      countCrossings({ graph, layers: ordered(state, { maxSweeps }) });
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThanOrEqual(at(8));
    // A budget of zero returns its seed untouched, at a size where a single
    // sweep would move hundreds of nodes: the hint names every node, so the
    // seed is exactly the hint, and it comes back exactly as it went in.
    const seed = ordered(state, { maxSweeps: 0 });
    expect(ordered(state, { maxSweeps: 0, initialOrder: seed })).toEqual(seed);
    expect(ordered(state, { maxSweeps: 1, initialOrder: seed })).not.toEqual(seed);
  });
});

describe('barycenterOrder, the options', () => {
  const state = stateOf(build(['a'], []), [['a']]);

  it('rejects a maxSweeps that is not a whole number of sweeps', () => {
    for (const maxSweeps of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => barycenterOrder({ maxSweeps })).toThrow(InvalidConfigError);
      expect(() => barycenterOrder({ maxSweeps })).toThrow(/maxSweeps/);
    }
  });

  it('rejects the budget when the stage is built, not when it runs', () => {
    expect(() => barycenterOrder({ maxSweeps: -1 })).toThrow(InvalidConfigError);
    const stage = barycenterOrder({ maxSweeps: 0 });
    expect(() => stage.run(state)).not.toThrow();
  });

  /**
   * `maxTransposePasses` takes the same rule as `maxSweeps`, down to rejecting
   * `Number.POSITIVE_INFINITY`, and for the same reason: it bounds a heuristic
   * with no optimality condition to converge to. The error is an
   * `InvalidConfigError` naming the field, which is `@dagr/layout`'s rule and
   * not `@dagr/render`'s `RangeError`.
   */
  it('rejects a maxTransposePasses that is not a whole number of passes', () => {
    for (const maxTransposePasses of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => barycenterOrder({ maxTransposePasses })).toThrow(InvalidConfigError);
      expect(() => barycenterOrder({ maxTransposePasses })).toThrow(/maxTransposePasses/);
    }
  });

  it('rejects the transpose budget when the stage is built, not when it runs', () => {
    expect(() => barycenterOrder({ maxTransposePasses: -1 })).toThrow(InvalidConfigError);
    const stage = barycenterOrder({ maxTransposePasses: 0 });
    expect(() => stage.run(state)).not.toThrow();
  });

  it('is named barycenter-order and is the default order stage', () => {
    expect(barycenterOrderStage.name).toBe('barycenter-order');
    expect(defaultStages.order.name).toBe('barycenter-order');
  });
});

describe('barycenterOrder, in the pipeline', () => {
  it('satisfies the order contract on random graphs', () => {
    const random = mulberry32(0xbeef);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const graph = randomDigraph(random);
      expect(() => layout({ graph }, { order: barycenterOrderStage })).not.toThrow();
    }
  });

  it('places every roster member in exactly one layer, in rank order', () => {
    const random = mulberry32(3);
    const graph = randomDigraph(random);
    const result = layout({ graph }, { order: barycenterOrderStage });
    expect(result.nodes.size).toBe(graph.nodes().length);
  });

  it('gives the same graph the same layers twice', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'd'],
        ['b', 'c'],
        ['c', 'e'],
        ['d', 'e'],
      ],
    );
    const state = stateOf(graph, [['a', 'b'], ['c', 'd'], ['e']]);
    expect(ordered(state)).toEqual(ordered(state));
  });

  it('gives two graphs built by the same script the same result', () => {
    const script = (): Graph =>
      build(
        ['a', 'b', 'c', 'd', 'e'],
        [
          ['a', 'd'],
          ['b', 'c'],
          ['c', 'e'],
          ['d', 'e'],
        ],
      );
    const one = layout({ graph: script() }, { order: barycenterOrderStage });
    const other = layout({ graph: script() }, { order: barycenterOrderStage });
    expect(one).toEqual(other);
  });
});

/**
 * The numbers `order.ts` and `docs/docs/layout.md` quote, pinned so that a
 * change to either has to come here and say so.
 *
 * The same arrangement `layout.cycles.quality.test.ts` uses, and for the same
 * reason: a stage that got worse still passes every property above, because
 * every property above is about legality and about beating its own seed, and
 * both survive a large regression in quality. These are exact pins of a
 * deterministic run over a generated corpus, not ceilings, so a failure here
 * means "the answer moved", not "the answer is wrong".
 */
describe('barycenterOrder, on the bench corpora', () => {
  const corpora = [
    ['1k', smallCorpus()],
    ['10k', largeCorpus()],
  ] as const;

  /** The corpus ranked by the default stage, which is what the numbers assume. */
  function rankedCorpus(spec: GraphSpec): RankedState {
    const graph = new Graph();
    for (const id of spec.nodes) graph.addNode(id);
    for (const [source, target] of spec.edges) graph.addEdge(source, target);
    const sizes = new Map<NodeId, Size>();
    for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
    const out = longestPathRankStage.run({ graph, config: DEFAULT_LAYOUT_CONFIG, sizes });
    return {
      graph,
      config: DEFAULT_LAYOUT_CONFIG,
      sizes,
      ranks: out.ranks,
      reversedEdges: out.reversedEdges,
      virtualNodes: new Set(),
      virtualChains: new Map(),
    };
  }

  /**
   * The share of the drawing this stage can see at all: an edge is a segment
   * only if its endpoints land in adjacent layers, and today most do not. This
   * is the number that goes to 100% when M2.4b splits the long edges, so it is
   * pinned here as the thing that is expected to move rather than as a fact.
   */
  it('sees a third of the 1k corpus and a quarter of the 10k', () => {
    const spans = corpora.map(([, spec]) => {
      const state = rankedCorpus(spec);
      const layerOf = new Map<number, number>();
      for (const [index, rank] of [...new Set(state.ranks.values())]
        .sort((left, right) => left - right)
        .entries()) {
        layerOf.set(rank, index);
      }
      let adjacent = 0;
      let longest = 0;
      for (const edge of state.graph.edges()) {
        const from = layerOf.get(state.ranks.get(edge.source) ?? 0) ?? 0;
        const to = layerOf.get(state.ranks.get(edge.target) ?? 0) ?? 0;
        if (Math.abs(from - to) === 1) adjacent += 1;
        longest = Math.max(longest, Math.abs(from - to));
      }
      return { adjacent, longest, edges: state.graph.edges().length };
    });
    expect(spans).toEqual([
      { adjacent: 1_324, longest: 78, edges: 4_000 },
      { adjacent: 10_528, longest: 201, edges: 40_000 },
    ]);
  });

  /** D2 is not a corner case: this many nodes are pinned on every sweep. */
  it('has this many nodes the layer above says nothing about', () => {
    const counts = corpora.map(([, spec]) => {
      const state = rankedCorpus(spec);
      const layerOf = new Map<number, number>();
      for (const [index, rank] of [...new Set(state.ranks.values())]
        .sort((left, right) => left - right)
        .entries()) {
        layerOf.set(rank, index);
      }
      const above = new Set<NodeId>();
      const below = new Set<NodeId>();
      for (const edge of state.graph.edges()) {
        const from = layerOf.get(state.ranks.get(edge.source) ?? 0) ?? 0;
        const to = layerOf.get(state.ranks.get(edge.target) ?? 0) ?? 0;
        if (Math.abs(from - to) !== 1) continue;
        below.add(from < to ? edge.source : edge.target);
        above.add(from < to ? edge.target : edge.source);
      }
      let noneAbove = 0;
      let neither = 0;
      for (const node of state.graph.nodes()) {
        if (above.has(node.id)) continue;
        noneAbove += 1;
        if (!below.has(node.id)) neither += 1;
      }
      return { noneAbove, neither };
    });
    expect(counts).toEqual([
      { noneAbove: 120, neither: 49 },
      { noneAbove: 1_101, neither: 572 },
    ]);
  });

  /**
   * The seed decision and the sweep budget, in one table. The roster-order row
   * is `insertionOrderStage`'s permutation fed back in as a hint, which is both
   * the comparison D1 was decided on and a test that a hint naming every node
   * really does reproduce itself at this size. That stage is named rather than
   * reached through `defaultStages`, which used to hold it: this column is the
   * roster order specifically, and reading it off the default would have
   * rewritten what the table compares the moment M2.6b moved the default here.
   */
  it('pins the seed comparison and the sweep curve, with the pass off', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);
      const { graph } = state;
      const roster = insertionOrderStage.run(state).layers;
      const at = (maxSweeps: number, initialOrder?: readonly (readonly NodeId[])[]): number =>
        countCrossings({
          graph,
          layers: barycenterOrder(
            initialOrder === undefined
              ? { maxSweeps, maxTransposePasses: 0 }
              : { maxSweeps, maxTransposePasses: 0, initialOrder },
          ).run(state).layers,
        });
      return [
        name,
        countCrossings({ graph, layers: roster }),
        at(8, roster),
        at(0),
        at(2),
        at(4),
        at(8),
        at(16),
      ];
    });
    expect(table).toEqual([
      ['1k', 12_890, 3_943, 7_933, 4_619, 3_880, 3_605, 3_467],
      ['10k', 425_394, 54_744, 94_991, 50_735, 40_217, 35_114, 32_503],
    ]);
  });

  /**
   * The transpose curve at the default sweep budget, which is the measurement
   * the cap of 8 was chosen on. Caps 0, 4, 8 and 16, and then the full fixed
   * point, which is what the cap is bought against: on the 10k it reaches
   * 29,260 after 60 passes, and 8 passes capture 81.9% of that saving.
   *
   * `Number.POSITIVE_INFINITY` is not a legal cap, deliberately and for the
   * reason argued beside the option, so the fixed point is asked for as a cap
   * far beyond the pass count either corpus needs.
   */
  it('pins the transpose curve and the fixed point it is bought against', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);
      const { graph } = state;
      const at = (maxTransposePasses: number): number =>
        countCrossings({
          graph,
          layers: barycenterOrder({ maxTransposePasses }).run(state).layers,
        });
      return [name, at(0), at(4), at(8), at(16), at(200)];
    });
    expect(table).toEqual([
      ['1k', 3_605, 3_116, 3_005, 2_961, 2_959],
      ['10k', 35_114, 31_369, 30_318, 29_658, 29_260],
    ]);
  });

  /**
   * Determinism at the default cap, on the corpora rather than on a witness,
   * because the tie rule is what makes it worth restating: the pass takes
   * swaps worth exactly nothing, so "the same graph twice" is a claim about
   * thousands of arbitrary-looking choices rather than a handful.
   *
   * Three ways of asking for the same answer: the same state again, a second
   * graph built from scratch in the same insertion order, and a fresh stage
   * object rather than the one that ran first.
   */
  it('returns identical layers for the same graph at the default cap', () => {
    for (const [, spec] of corpora) {
      const state = rankedCorpus(spec);
      const first = barycenterOrder().run(state).layers;
      expect(barycenterOrder().run(state).layers).toEqual(first);
      expect(barycenterOrderStage.run(state).layers).toEqual(first);
      expect(barycenterOrder().run(rankedCorpus(spec)).layers).toEqual(first);
    }
  });

  /**
   * What M2.6b bought, which is the one thing the name pins cannot say. Those
   * pin the IDENTITY of the default order stage, so they fail when it moves and
   * pass whatever the stage that took it is worth. This pins the REASON: a
   * default run now leaves 76.7% fewer crossings on the 1k corpus and 92.9%
   * fewer on the 10k than the roster order it replaced.
   *
   * Both columns are exact pins rather than an inequality, on the same argument
   * as every other table here: an ordering that regressed badly without
   * regressing all the way back to roster order would satisfy "substantially
   * fewer" and change nothing that fails. The right column is the default cap's
   * row of the transpose table above, which is what ties these numbers to the
   * stage that ships rather than to any stage that beats roster order.
   */
  it('leaves far fewer crossings through the default stage set than roster order does', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);
      const { graph } = state;
      const roster = insertionOrderStage.run(state).layers;
      const byDefault = defaultStages.order.run(state).layers;
      return [
        name,
        countCrossings({ graph, layers: roster }),
        countCrossings({ graph, layers: byDefault }),
      ];
    });
    expect(table).toEqual([
      ['1k', 12_890, 3_005],
      ['10k', 425_394, 30_318],
    ]);
  });
});
