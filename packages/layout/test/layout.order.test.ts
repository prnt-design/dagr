import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { InvalidConfigError } from '../src/errors.js';
import { barycenterOrder, barycenterOrderStage, countCrossings } from '../src/order.js';
import { forEachSegment } from '../src/segments.js';
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
 * is what a relayout starts from before the warm start is imposed on it, so it
 * is the part a future change is most likely to break by accident and least
 * likely to be caught breaking: a different seed still produces a legal
 * layering with a plausible crossing count, and only the M3 stability metrics
 * would ever notice.
 *
 * The warm start itself is `layout.warmstart.test.ts`, which is where M3.6 put
 * it: `initialOrder` and `PreparedState.previous` are the same object arriving
 * by two routes, and since M3.6 both are a CONSTRAINT carried through the run
 * rather than a permutation the sweeps are free to leave. Several cases below
 * used a complete hint to force a seed, and could not once a complete hint
 * froze the layering; each one says how it was rewritten.
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
   * They are in different COHORTS instead, so the hint says nothing about the
   * pair and the walk decides. Since M3.6 that holds whatever their two indices
   * are; before it, it held only when the indices happened to coincide, as they
   * do here.
   */
  it('leaves two ids the hint lists in different layers to the walk', () => {
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
   * An id takes its FIRST position in a hint layer, and a repeat is
   * unobservable. `initialOrder` is untrusted input, so a hint that lists an id
   * twice is a case rather than a curiosity.
   *
   * THE SECOND HALF USED TO BE OBSERVABLE AND M3.6 MADE IT NOT, which is worth
   * recording rather than quietly restating: this case used to assert that a
   * repeat consumed no INDEX, and it could only assert it across two hint
   * layers, because within one layer only the ORDER of the keys is read and an
   * eaten index shifts every later key equally. M3.6 stopped comparing keys
   * across hint layers at all, so there is nothing left for an eaten index to
   * change and both hints below produce the same layering by construction. What
   * survives is the first half, and it is observable within one layer: if the
   * LAST occurrence won, `[['y', 'x', 'y']]` would order `x` before `y`.
   */
  it("takes an id's first position in a hint layer, and a repeat is unobservable", () => {
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
    const first = ordered(fanState, { maxSweeps: 0, initialOrder: [['y', 'x', 'y']] });
    expect(first).toEqual([['a'], ['y', 'x', 'z', 'w']]);
    expect(first).toEqual(ordered(fanState, { maxSweeps: 0, initialOrder: [['y', 'x']] }));
    const duplicated = ordered(fanState, {
      maxSweeps: 0,
      initialOrder: [
        ['x', 'x', 'y'],
        ['z', 'w'],
      ],
    });
    expect(duplicated).toEqual([['a'], ['x', 'y', 'z', 'w']]);
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

/**
 * The witness for the pinning rule, and the reason it looks the way it does.
 *
 * The rule is that a node the fixed layer says nothing about keeps its index
 * while the nodes around it sort into the indices left over, so the witness
 * needs an unanchored node BETWEEN two anchored ones that the sweep wants to
 * swap. THE WALK CANNOT PRODUCE THAT SEED ON ITS OWN, which is a fact about the
 * walk rather than an inconvenience: it visits a layer left to right and pulls
 * each node's neighbours into the layer above in that same order, so the layer
 * it builds is already in barycenter order and the first sweep has nothing to
 * swap. Searched exhaustively over every roster order and every parent set of
 * two anchored nodes and three fixed ones before it was written down.
 *
 * So the seed is arranged with a hint, and since M3.6 a hint is a CONSTRAINT
 * rather than a starting point: a hint naming both `x` and `y` would hold them
 * in the order it named them and there would be no swap to observe. The hint
 * here therefore names the FIXED layer and only the fixed layer. It reverses
 * `p q` into `q p`, which is what puts `x`'s parent at index 1 and `y`'s at
 * index 0, and it leaves the swept layer entirely free.
 *
 * `u` is unanchored ABOVE and has a child below, which is what lets the walk
 * reach it in the middle of its layer: a node with no edge at all is appended
 * when the outer loop arrives at it and is therefore always last.
 */
function pinningWitness(): { readonly graph: Graph; readonly state: RankedState } {
  const graph = build(
    ['x', 'u', 'y', 'p', 'q', 'd'],
    [
      ['p', 'x'],
      ['u', 'd'],
      ['q', 'y'],
    ],
  );
  return {
    graph,
    state: stateOf(graph, [
      ['p', 'q'],
      ['x', 'u', 'y'],
      ['d'],
    ]),
  };
}

describe('barycenterOrder, the sweeps', () => {
  /**
   * D2 on the smallest layering that shows it. Fixing `q p` above, `y` wants
   * index 0 and `x` wants index 1, so the pair has to swap; `u` has no
   * neighbour above at all, so it keeps index 1 and the pair sorts into the
   * indices left over, which are 0 and 2.
   */
  it('pins a node the fixed layer says nothing about at its own index', () => {
    const { graph, state } = pinningWitness();
    // The hint names the FIXED layer and nothing else, which is what leaves the
    // swept layer free to be swept. See `pinningWitness` for why the seed can
    // only be arranged that way since M3.6.
    const fixed = [['q', 'p']];
    expect(ordered(state, { maxSweeps: 0, initialOrder: fixed })).toEqual([
      ['q', 'p'],
      ['x', 'u', 'y'],
      ['d'],
    ]);
    expect(ordered(state, { maxSweeps: 1, initialOrder: fixed })).toEqual([
      ['q', 'p'],
      ['y', 'u', 'x'],
      ['d'],
    ]);
    expect(graph.hasNode('u')).toBe(true);
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
    const { state } = pinningWitness();
    expect(
      barycenterOrder({ initialOrder: [['q', 'p']] })
        .run(state)
        .layers.map((layer) => [...layer]),
    ).toEqual([
      ['q', 'p'],
      ['y', 'u', 'x'],
      ['d'],
    ]);
  });

  /**
   * A hint that names nothing must stay silent at the default cap too, for the
   * same reason: the warm-start constraint and the pass are the two things that
   * can move a node without the sweeps asking, and turning one off to test the
   * other leaves the pair untested together.
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
   *
   * The budget is named rather than left to the default, and that is the point
   * of the case rather than a detail of it: the comparison is between two stop
   * rules at ONE budget, and M2.6c moved the default to 4, at which this graph
   * has only two rounds to run and the two rules cannot come apart. Reading
   * the budget off the default would have silently turned this into a case
   * that asserts nothing the moment the default moved.
   */
  it('does not stop on the first fruitless round, which used to cost 18%', () => {
    const { graph, layers } = randomLayered(mulberry32(69), 150, 7, 320);
    const state = stateOf(graph, layers);
    expect(countCrossings({ graph, layers: ordered(state, { maxSweeps: 8 }) })).toBe(893);
  });

  /**
   * The word CONSECUTIVE in that same rule, which is a separate claim from the
   * one above and takes a bigger budget to make. Two fruitless rounds end the
   * run only when they are adjacent, and the reset of the counter is the whole
   * of what makes them so.
   *
   * At a budget of 8, which was the default until M2.6c and is twice it now,
   * the two rules are indistinguishable, which is why no case above and no
   * corpus pin below can defend this one. Eight sweeps
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
    // A budget of zero runs no sweep at all, at a size where a single sweep
    // moves hundreds of nodes. Pinned against the walk rather than against a
    // hint fed back in, which is how this said it until M3.6: a hint naming
    // every node now holds the layering at EVERY budget, so a hint-based
    // version of this line would pass over a stage that had stopped sweeping.
    const seed = ordered(state, { maxSweeps: 0 });
    expect(ordered(state, { maxSweeps: 1 })).not.toEqual(seed);
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

  /**
   * The corpus ranked by the default stage, chains and all, which is what a
   * default run hands this stage.
   *
   * It passed empty chains until they were consumed, and every count in this
   * file moved when that changed, upward and by a lot. That is not a regression
   * and the note on the segment test below is the argument: the stage went from
   * seeing 13,131 of the 10k's 40,000 edges to seeing all 214,222 segments of
   * the drawing, so the population being counted grew by a factor of sixteen at
   * the same moment the layering got better on it.
   */
  function rankedCorpus(spec: GraphSpec): RankedState {
    const graph = new Graph();
    for (const id of spec.nodes) graph.addNode(id);
    for (const [source, target] of spec.edges) graph.addEdge(source, target);
    const sizes = new Map<NodeId, Size>();
    for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
    const out = longestPathRankStage.run({ graph, config: DEFAULT_LAYOUT_CONFIG, sizes });
    for (const [id, size] of out.virtualNodes ?? []) sizes.set(id, size);
    return {
      graph,
      config: DEFAULT_LAYOUT_CONFIG,
      sizes,
      ranks: out.ranks,
      reversedEdges: out.reversedEdges,
      virtualNodes: new Set(out.virtualNodes?.keys() ?? []),
      virtualChains: out.virtualChains ?? new Map(),
    };
  }

  /** Counting over the drawing this stage actually orders, chains included. */
  function crossingsOf(state: RankedState, layers: readonly (readonly NodeId[])[]): number {
    return countCrossings({ graph: state.graph, layers, virtualChains: state.virtualChains });
  }

  /** The layers a sweep budget settles on, the pass off, as plain arrays. */
  function layersAt(state: RankedState, maxSweeps: number): NodeId[][] {
    return barycenterOrder({ maxSweeps, maxTransposePasses: 0 })
      .run(state)
      .layers.map((layer) => [...layer]);
  }

  /**
   * What this stage can see, which since the chains were consumed is all of it.
   *
   * Two numbers, and the gap between them is the point. `adjacent` counts the
   * graph's OWN edges whose endpoints land in adjacent layers, which is what
   * this stage saw when it read `graph.edges()` and is a property of the
   * ranking: 1,513 of the 1k's 4,000 and 13,131 of the 10k's 40,000, the
   * longest edge spanning 61 layers and 153. `segments` counts what the stage
   * actually orders now, the drawing's segments, an edge with a chain
   * contributing one per gap it crosses. Every one of those joins adjacent
   * layers by construction, which is what completeness buys, so the share this
   * test used to measure is 100% and the assertion below is that it is.
   *
   * The old share is kept rather than deleted because every crossing count in
   * this file and in the golden corpus rose by more than an order of magnitude
   * when the chains were consumed, and this is the reason: the population went
   * from 13,131 segments to 214,222 on the 10k. A count taken over the first is
   * not comparable with a count taken over the second, and reading the rise as
   * a quality regression is the trap. The like-for-like comparison, both
   * layerings scored on the full population, is
   * `cuts crossings by two thirds against a layering that ignores the chains`,
   * thirty lines below in this file.
   */
  it('sees every segment of the drawing, not a third of the edges', () => {
    const spans = corpora.map(([, spec]) => {
      const state = rankedCorpus(spec);
      const layerOf = new Map<number, number>();
      for (const [index, rank] of [...new Set(state.ranks.values())]
        .sort((left, right) => left - right)
        .entries()) {
        layerOf.set(rank, index);
      }
      const layerIndex = (id: NodeId): number => layerOf.get(state.ranks.get(id) ?? 0) ?? 0;
      let adjacent = 0;
      let longest = 0;
      for (const edge of state.graph.edges()) {
        const gap = Math.abs(layerIndex(edge.source) - layerIndex(edge.target));
        if (gap === 1) adjacent += 1;
        longest = Math.max(longest, gap);
      }
      // What the stage orders: an edge with a chain is drawn as the chain.
      let segments = 0;
      let spanning = 0;
      let loops = 0;
      forEachSegment(state.graph, state.virtualChains, (from, to) => {
        segments += 1;
        const gap = Math.abs(layerIndex(from) - layerIndex(to));
        if (gap === 1) spanning += 1;
        if (gap === 0) loops += 1;
      });
      return { adjacent, longest, edges: state.graph.edges().length, segments, spanning, loops };
    });
    expect(spans).toEqual([
      { adjacent: 1_513, longest: 61, edges: 4_000, segments: 18_746, spanning: 18_746, loops: 0 },
      {
        adjacent: 13_131,
        longest: 153,
        edges: 40_000,
        segments: 214_222,
        spanning: 214_222,
        loops: 0,
      },
    ]);
    // Every segment joins adjacent layers, so the share this stage cannot see
    // is zero on a corpus with no self loop in it. A self loop would land in
    // `loops`, spanning no layer for a chain to split, and both corpora have
    // none.
    for (const row of spans) expect(row.spanning).toBe(row.segments);
  }, 120_000);

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
      { noneAbove: 118, neither: 48 },
      { noneAbove: 814, neither: 438 },
    ]);
  }, 120_000);

  /**
   * WHAT CONSUMING THE CHAINS ACTUALLY BUYS, which is the only comparison in
   * this file that is like for like and is why every other number here rose.
   *
   * Two layerings, both scored on the SAME population: every segment of the
   * drawing. The first is what this stage produces when it reads the chains,
   * the second what it produces when it ignores them, which is what it did
   * until they were consumed. Ignoring them does not make the crossings go
   * away, it makes them invisible: the long edges are still drawn and still
   * cross, and a stage that cannot see them arranges the layers for the quarter
   * of the drawing it can.
   *
   * The counts in the tables below are the first column of this one, so a
   * reader who reaches them after the golden file jumped by an order of
   * magnitude has the answer here rather than having to derive it.
   *
   * BOTH COLUMNS ARE THE STAGE AT ITS DEFAULTS, so M2.6c moved both of them: it
   * is 74.7% on the 10k and 73.0% on the 1k at 4 sweeps and a cap of 16, where
   * it was 74.2% and 71.7% at 8 and 8. The right-hand column moved too, up by
   * 0.02% and 0.03%, which is the whole of what four fewer sweeps and eight
   * more passes do to a layering arranged for a third of the drawing and
   * scored over all of it. Both figures are
   * therefore this milestone's rather than M2.4b's, and M2.4b's own pair is
   * kept in the changelog entry that measured it.
   */
  it('cuts crossings by two thirds against a layering that ignores the chains', () => {
    const rows = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);
      const ignoring: RankedState = { ...state, virtualChains: new Map() };
      const consuming = crossingsOf(state, barycenterOrder().run(state).layers);
      const ignored = crossingsOf(state, barycenterOrder().run(ignoring).layers);
      return [name, consuming, ignored];
    });
    expect(rows).toEqual([
      ['1k', 185_028, 685_764],
      ['10k', 8_586_890, 33_939_378],
    ]);
    for (const [, consuming, ignored] of rows) {
      expect(Number(consuming)).toBeLessThan(Number(ignored) * 0.3);
    }
  }, 300_000);

  /**
   * The seed decision and the sweep budget, in one table. The roster-order
   * column is `insertionOrderStage`'s own layering, scored directly. That stage
   * is named rather than reached through `defaultStages`, which used to hold
   * it: this column is the roster order specifically, and reading it off the
   * default would have rewritten what the table compares the moment M2.6b moved
   * the default here.
   *
   * THE COLUMN M3.6 REMOVED, and it is removed rather than re-measured because
   * the configuration it described no longer exists. It was the roster
   * permutation fed back in as `initialOrder` and swept eight times, 210,611 on
   * the 1k and 9,150,607 on the 10k, and it was the comparison D1 chose the
   * seed on. Since M3.6 a hint is a CONSTRAINT and not a starting point, so
   * feeding a complete layering in and sweeping it returns that layering
   * unchanged: the same call now scores 703,757 and 34,510,321, which is the
   * roster column beside it and says nothing about seeds. That is asserted
   * below as the fact it now is. The seed comparison itself survives in
   * {@link barycenterOrder}'s own table, where it is what it always was, a
   * measurement taken on a drawing this corpus no longer produces.
   *
   * THE SWEEP COLUMNS ARE WHY `maxSweeps` IS 4, and the two corpora reach that
   * floor at different sweeps: the 10k at ONE, which is why every column from 1
   * on holds the same number, and the 1k at THREE. Sweeps 5 through 8 buy
   * nothing on either, which is what the shipped budget of 8 was spending.
   * Columns at 1 and 3 are here for that reason rather than for symmetry: they
   * are the two floors, and without them the table cannot say where either one
   * is. The budget is not 2 because the 1k is still 2.8% above its floor there,
   * and it is not 1 because `wide-600` in the golden corpus loses 9.7% there.
   * See the sweeps section of {@link barycenterOrder}.
   */
  it('pins the seed comparison and the sweep curve, with the pass off', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);

      const roster = insertionOrderStage.run(state).layers;
      const at = (maxSweeps: number, initialOrder?: readonly (readonly NodeId[])[]): number =>
        crossingsOf(
          state,
          barycenterOrder(
            initialOrder === undefined
              ? { maxSweeps, maxTransposePasses: 0 }
              : { maxSweeps, maxTransposePasses: 0, initialOrder },
          ).run(state).layers,
        );
      // The floor is a LAYERING and not just a score, which is the stronger
      // claim and the one the argument for `maxSweeps: 4` rests on: `best` is
      // replaced only when a sweep scores strictly lower, and a 16-sweep run's
      // first four sweeps ARE the 4-sweep run, so a floor found by sweep 4 can
      // never be displaced afterwards. Equal counts in the table below would
      // also be satisfied by two different layerings that happen to tie.
      //
      // What it catches, checked by breaking it rather than by reasoning: a
      // stage that returns the LAST layering the sweeps produced instead of the
      // best seen fails here, on the 1k. What it does NOT catch, also checked,
      // is `current <= bestScore` in place of `current <`, because no sweep
      // after the floor ties it on either corpus; the strictness of that
      // comparison is a claim this case cannot make.
      expect(layersAt(state, 4)).toEqual(layersAt(state, 16));
      // A complete hint is a complete constraint (M3.6): eight sweeps over the
      // roster layering hand the roster layering back, at a size where a single
      // sweep would otherwise move tens of thousands of nodes. This is the
      // corpus-scale form of the small witnesses in `layout.warmstart.test.ts`.
      expect(at(8, roster)).toBe(crossingsOf(state, roster));
      return [
        name,
        crossingsOf(state, roster),
        at(0),
        at(1),
        at(2),
        at(3),
        at(4),
        at(8),
        at(16),
      ];
    });
    expect(table).toEqual([
      ['1k', 703_757, 456_261, 215_975, 215_975, 210_163, 210_163, 210_163, 210_163],
      [
        '10k',
        34_510_321,
        19_753_239,
        8_972_421,
        8_972_421,
        8_972_421,
        8_972_421,
        8_972_421,
        8_972_421,
      ],
    ]);
  }, 120_000);

  /**
   * The transpose curve at the default sweep budget, which is the measurement
   * `maxTransposePasses` is chosen on.
   *
   * THE CAP OF 8 WAS BOUGHT AT A KNEE AND THERE IS NO LONGER A KNEE THERE, or
   * anywhere else, which is the finding that moved it. Read the differences
   * along either row: on the 10k every four passes buy between 124,007 and
   * 76,699 crossings from 0 out to 32, and the rate keeps declining by about a
   * fifth per doubling for hundreds of passes after that. Nothing on this curve
   * picks out a cap. The old one had the marginal rate falling by a factor of
   * three immediately past 8 and by half at every step after, over a drawing
   * where a long edge was invisible to the counter.
   *
   * SO 16 IS BOUGHT AGAINST THE SWEEPS RATHER THAN AGAINST THIS CURVE, which
   * is the other half of M2.6c and the reason the two budgets stopped being
   * equal. The sweep table above floors at 1 sweep on the 10k and 3 on the 1k,
   * so a sweep past 4 buys nothing there, while a sweep costs 5 to 6 passes
   * of this pass's time. The pair that ships, 4 and 16, is faster AND lower on
   * both corpora and on all six golden graphs than the 8 and 8 it replaces.
   * The full argument is the transpose section of {@link barycenterOrder}.
   *
   * THE LAST COLUMN IS THE FIXED POINT AND THE OLD ONE WAS NOT. It used to be
   * read off a cap of 200, described here as "far beyond the pass count either
   * corpus needs". That is no longer true and was already false when it was
   * written for the 10k: the pass now runs 187 times on the 1k and 675 on the
   * 10k before it finds no improving swap, so a cap of 200 stops the 10k two
   * thirds of the way and its 7,689,100 was never a fixed point. 1,000 is
   * asked for instead, and `Number.POSITIVE_INFINITY` is still not a legal cap
   * for the reason argued beside the option.
   */
  it('pins the transpose curve and the fixed point it is bought against', () => {
    const table = corpora.map(([name, spec]) => {
      const state = rankedCorpus(spec);

      const at = (maxTransposePasses: number): number =>
        crossingsOf(state, barycenterOrder({ maxTransposePasses }).run(state).layers);
      return [name, at(0), at(4), at(8), at(12), at(16), at(24), at(32), at(1_000)];
    });
    expect(table).toEqual([
      ['1k', 210_163, 201_029, 194_289, 189_048, 185_028, 178_469, 174_318, 162_662],
      [
        '10k',
        8_972_421,
        8_848_414,
        8_748_361,
        8_663_589,
        8_586_890,
        8_453_276,
        8_344_656,
        7_637_257,
      ],
    ]);
  }, 300_000);

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
  }, 120_000);

  /*
   * M2.6b briefly added a case here pinning what the flip bought, roster order
   * against the default on both corpora. It was cut before it merged, because
   * algorithms-review measured it against six mutants (the median tiebreak,
   * the sweep direction, both default caps, a differently configured stage
   * object, and the default repointed) and it made ZERO unique kills: its left
   * column is column one of the seed table above, its right column is the
   * cap-of-8 row of the transpose table above, and the substitution it was
   * meant to catch is caught harder by `index.test.ts`'s identity check on
   * `defaultStages.order`. A test that only restates two committed tables
   * costs a run of the 10k corpus and buys nothing. What the flip did NOT
   * already have a pin for was determinism through `layout()` itself, and that
   * case lives in `layout.determinism.test.ts` instead.
   */
});
