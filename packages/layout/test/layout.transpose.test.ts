import { Graph } from '@dagr/graph';
import { largeCorpus, smallCorpus } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { barycenterOrder, countCrossings, transposeLayers } from '../src/order.js';
import { forEachSegment } from '../src/segments.js';
import { longestPathRankStage } from '../src/rank.js';
import { measureNodes, resolveConfig } from '../src/config.js';
import { mulberry32, randomLayered } from './random.js';
import { buildCorpusGraph, goldenCorpus } from './golden-corpus.js';
import type { GraphSpec } from '@dagr/bench';
import type { EdgeId, NodeId } from '@dagr/graph';
import type { TransposeAdjacency } from '../src/order.js';
import type { RankedState, Size } from '../src/types.js';

/**
 * The transpose refinement pass: the swap delta, the tie rule, what stops the
 * loop, and where in the run the pass is applied.
 *
 * Most of this file tests `transposeLayers` directly rather than through
 * `barycenterOrder`, and that is the point rather than a convenience. The stage
 * keeps the BEST layering it has seen and takes the transposed one only when it
 * scores strictly lower, so a pass that quietly made a drawing worse would be
 * invisible at the stage's boundary: the acceptance check would throw the
 * damage away and the stage would look fine while the pass was broken. Two
 * claims here are about the pass and not about the stage, so they are made
 * where they can fail. That the delta is exact, and that a pass never raises
 * the crossing count.
 *
 * The second solver is `referenceTranspose` below, and it stands in the same
 * relation to the shipped pass as `layout.crossings.test.ts`'s pair loop does
 * to the accumulator tree. It makes the same decisions from the definition, by
 * swapping and rescoring the whole layering with `countCrossings`, which is far
 * too slow to ship and too simple to get wrong. Agreement between the two is
 * what says the O(deg v * deg w) delta really is the change a full rescore
 * would report.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/** A `RankedState` with the ranks written out as the layers they stand for. */
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

/** A CSR adjacency from one neighbour list per node, written out in full. */
function csr(lists: readonly (readonly number[])[]): { start: Int32Array; next: Int32Array } {
  const start = new Int32Array(lists.length + 1);
  const next: number[] = [];
  for (const [node, list] of lists.entries()) {
    for (const neighbour of list) next.push(neighbour);
    start[node + 1] = next.length;
  }
  return { start, next: Int32Array.from(next) };
}

/**
 * A layering as the flat arrays the pass reads: node numbers, where each sits,
 * and who neighbours whom one layer up and one layer down.
 *
 * A second implementation of what `buildIndex` does inside the stage, for the
 * same reason the pair loop is a second implementation of the counter: a test
 * that reached for the shipped index would be handing the pass its own idea of
 * the graph and could not disagree with it. Numbers are assigned in layer
 * order, which is nothing the pass may depend on.
 */
function flatten(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]> = new Map(),
): { rows: number[][]; position: Int32Array; adjacency: TransposeAdjacency; ids: NodeId[] } {
  const ids: NodeId[] = [];
  const numberOf = new Map<NodeId, number>();
  const layerOf = new Map<NodeId, number>();
  const rows: number[][] = [];
  for (const [layer, members] of layers.entries()) {
    const row: number[] = [];
    for (const id of members) {
      numberOf.set(id, ids.length);
      layerOf.set(id, layer);
      row.push(ids.length);
      ids.push(id);
    }
    rows.push(row);
  }
  const position = new Int32Array(ids.length);
  for (const row of rows) {
    for (const [slot, node] of row.entries()) position[node] = slot;
  }
  const up: number[][] = ids.map(() => []);
  const down: number[][] = ids.map(() => []);
  // Over segments rather than edges, so that a chained drawing builds the index
  // the shipping stage builds. A dummy has degree 2 here and degree 0 without
  // the chains, which is exactly the difference the delta has to survive.
  forEachSegment(graph, virtualChains, (fromId, toId) => {
    const from = layerOf.get(fromId);
    const to = layerOf.get(toId);
    if (from === undefined || to === undefined) return;
    if (Math.abs(from - to) !== 1) return;
    const upper = numberOf.get(from < to ? fromId : toId) ?? 0;
    const lower = numberOf.get(from < to ? toId : fromId) ?? 0;
    up[lower]?.push(upper);
    down[upper]?.push(lower);
  });
  const upper = csr(up);
  const lower = csr(down);
  return {
    rows,
    position,
    ids,
    adjacency: {
      upStart: upper.start,
      upNext: upper.next,
      downStart: lower.start,
      downNext: lower.next,
    },
  };
}

/** The layers of a flattened layering, back as ids. */
function idsOf(rows: readonly (readonly number[])[], ids: readonly NodeId[]): NodeId[][] {
  return rows.map((row) => row.map((node) => ids[node] ?? 'missing'));
}

/**
 * The definition of the pass, deciding every swap by a full rescore.
 *
 * One pass walks the layers in index order and each layer left to right,
 * considering the pair at slots `slot` and `slot + 1`, and takes the swap when
 * the rescore is no worse. `gate` is what ends the loop, and it is the whole of
 * D4: `improving` stops after a pass that lowered the count by nothing, which
 * is what ships, and `any` stops after a pass that swapped nothing, which is
 * the rule that hangs. Both are here because a test that only ran the shipping
 * rule could not show that the other one does not terminate.
 */
/**
 * The ids at least one adjacent layer has something to say about, worked out
 * from the graph and the layering alone.
 *
 * Deliberately NOT read off the stage's CSR adjacency, even though that is
 * where the shipping pass reads the same fact. This function is half of a
 * second solver, and a second solver that borrowed the first one's index would
 * agree with it about exactly the thing worth checking.
 */
function anchoredIds(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]> = new Map(),
): ReadonlySet<NodeId> {
  const layerOf = new Map<NodeId, number>();
  for (const [index, layer] of layers.entries()) {
    for (const id of layer) layerOf.set(id, index);
  }
  const anchored = new Set<NodeId>();
  forEachSegment(graph, virtualChains, (fromId, toId) => {
    const source = layerOf.get(fromId);
    const target = layerOf.get(toId);
    if (source === undefined || target === undefined) return;
    if (Math.abs(source - target) !== 1) return;
    anchored.add(fromId);
    anchored.add(toId);
  });
  return anchored;
}

function referenceTranspose(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  maxPasses: number,
  gate: 'improving' | 'any' = 'improving',
  virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]> = new Map(),
): { layers: NodeId[][]; passes: number } {
  const working = layers.map((layer) => [...layer]);
  const anchors = anchoredIds(graph, layers, virtualChains);
  let passes = 0;
  while (passes < maxPasses) {
    passes += 1;
    let improved = false;
    let swapped = false;
    let before = countCrossings({ graph, layers: working, virtualChains });
    for (const layer of working) {
      for (let slot = 0; slot + 1 < layer.length; slot += 1) {
        const one = layer[slot];
        const other = layer[slot + 1];
        if (one === undefined || other === undefined) continue;
        if (!anchors.has(one) || !anchors.has(other)) continue;
        layer[slot] = other;
        layer[slot + 1] = one;
        const after = countCrossings({ graph, layers: working, virtualChains });
        if (after > before) {
          layer[slot] = one;
          layer[slot + 1] = other;
          continue;
        }
        swapped = true;
        if (after < before) improved = true;
        before = after;
      }
    }
    if (!(gate === 'improving' ? improved : swapped)) break;
  }
  return { layers: working, passes };
}

/**
 * The witness for D4, three nodes and two edges, and the smallest shape that
 * produces a zero-delta swap with both nodes anchored.
 *
 * Layer 0 has no gap above it, so only the gap below contributes anything.
 * `downNeighbours(n1)` and `downNeighbours(n2)` are both `{n0}`, so the one
 * pair the delta sums over is `(n0, n0)`, whose positions are EQUAL: it
 * contributes neither the +1 of a crossing created nor the -1 of one removed.
 * The delta is exactly zero, and it stays zero after the swap, which is what a
 * loop gated on "did anything move" cannot get out of.
 *
 * Not a contrived shape. It is two nodes sharing one common neighbour, which
 * every fan-in and every fan-out produces.
 */
function sharedNeighbour(): { graph: Graph; layers: NodeId[][] } {
  const graph = build(
    ['n0', 'n1', 'n2'],
    [
      ['n2', 'n0'],
      ['n1', 'n0'],
    ],
  );
  return { graph, layers: [['n1', 'n2'], ['n0']] };
}

/**
 * A layer holding one node the adjacent layers say NOTHING about, between two
 * the ranker anchored.
 *
 * `n1` has no edge to either adjacent layer, so it contributes no segment to
 * either gap and no swap involving it can change a crossing count. That makes
 * every delta it takes part in exactly zero, which under the tie rule alone
 * would mean every such pair is taken.
 */
function unanchoredMiddle(): { graph: Graph; layers: NodeId[][] } {
  const graph = build(
    ['a0', 'a1', 'n0', 'n1', 'n2'],
    [
      ['a0', 'n0'],
      ['a1', 'n2'],
    ],
  );
  return {
    graph,
    layers: [
      ['a0', 'a1'],
      ['n0', 'n1', 'n2'],
    ],
  };
}

describe('transposeLayers, the nodes it may not move', () => {
  /**
   * The stage's own rule, which the sweeps already keep and the pass must not
   * quietly override: A NODE THE FIXED LAYER SAYS NOTHING ABOUT KEEPS ITS
   * INDEX. `reorder` pins such a node and permutes the rest into the slots that
   * leaves, and that was measured rather than assumed, so a pass that undoes it
   * is not a smaller version of the same policy, it is the opposite one.
   *
   * The tie rule is what puts this in reach. An unanchored node contributes no
   * segment to either gap, so both sides of its delta are zero, so its delta is
   * zero, so a pass that swaps on a zero delta swaps EVERY pair containing one
   * unconditionally. That is not a crossing-neutral shuffle that happens to be
   * harmless: it is a drift of exactly one slot per pass in a fixed direction,
   * which at the default cap is sixteen, and it compounds across re-layouts
   * because the warm start hands the drifted order back in.
   *
   * Found by algorithms-review on 41 of 41 unanchored nodes in one generated
   * corpus and 371 of 371 in another, every one displaced by exactly the pass
   * budget. Reproduced at corpus scale in M2.6d on 24 of 24 unanchored nodes on
   * the 1k and 162 of 162 on the 10k, displaced by exactly the pass budget at a
   * cap of 16 and again at 32.
   */
  it('leaves a node with no neighbour in either adjacent layer where it was', () => {
    const { graph, layers } = unanchoredMiddle();
    const flat = flatten(graph, layers);
    transposeLayers(flat.rows, flat.position, flat.adjacency, 8);
    expect(idsOf(flat.rows, flat.ids)).toEqual([
      ['a0', 'a1'],
      ['n0', 'n1', 'n2'],
    ]);
  });

  /**
   * The same rule stated as the property that actually bites a caller: running
   * the stage on its own output must not move anything. A drift of one slot per
   * pass is invisible in a single run and obvious across three.
   */
  it('is idempotent across re-layouts on a graph with unanchored nodes', () => {
    const { graph, layers } = unanchoredMiddle();
    const first = flatten(graph, layers);
    transposeLayers(first.rows, first.position, first.adjacency, 8);
    const settled = idsOf(first.rows, first.ids);

    const second = flatten(graph, settled);
    transposeLayers(second.rows, second.position, second.adjacency, 8);
    expect(idsOf(second.rows, second.ids)).toEqual(settled);
  });
});

describe('transposeLayers, the swap delta', () => {
  /**
   * D2 and D3 together, against the rescoring definition: the delta a swap is
   * decided on is exactly the change a full `countCrossings` rescore reports,
   * and the swap is taken when that change is negative OR EXACTLY ZERO.
   *
   * Layer-for-layer equality rather than equal crossing counts, because two
   * runs that disagreed about a zero-delta swap would agree about the count
   * and say nothing. Every pair the pass considers is a chance for the two to
   * diverge, and once they have diverged they stay diverged, so this is a much
   * stronger check than it looks.
   */
  it('agrees with a rescoring transpose, swap for swap', () => {
    const random = mulberry32(0x7a3);
    let moved = 0;
    for (const [nodes, depth, edges] of [
      [40, 4, 90],
      [60, 5, 150],
      [80, 3, 200],
      [30, 6, 60],
      [50, 4, 250],
    ] as const) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { graph, layers } = randomLayered(random, nodes, depth, edges);
        const flat = flatten(graph, layers);
        transposeLayers(flat.rows, flat.position, flat.adjacency, 4);
        const reference = referenceTranspose(graph, layers, 4);
        expect(idsOf(flat.rows, flat.ids)).toEqual(reference.layers);
        if (!reference.layers.every((layer, at) => layer.join() === layers[at]?.join())) {
          moved += 1;
        }
      }
    }
    // Not a vacuous agreement: the pass rearranges all 30 of these.
    expect(moved).toBe(30);
  });

  /**
   * The same agreement on drawings that HAVE chains in them, which is the case
   * that gained meaning when the order stage started reading `virtualChains`.
   *
   * It holds by construction, both sides reading the same segment rule, and
   * that is exactly why it is worth a test: nothing above executes the delta
   * with a dummy in the index. Without the chains a dummy has degree ZERO here,
   * so every case above exercises the delta only on nodes the graph itself
   * connects, and a delta that mishandled a degree-2 virtual node would pass
   * all of them.
   */
  it('agrees with a rescoring transpose on a drawing whose long edges are split', () => {
    const config = resolveConfig(undefined);
    let moved = 0;
    let dummies = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { graph } = randomLayered(mulberry32(0x51d + attempt), 70, 7, 170);
      const sizes = measureNodes(graph, config, undefined);
      const out = longestPathRankStage.run({ graph, config, sizes });
      const virtualChains = out.virtualChains ?? new Map<EdgeId, readonly NodeId[]>();
      const merged = new Map(sizes);
      for (const [id, size] of out.virtualNodes ?? []) merged.set(id, size);
      const layers = barycenterOrder({ maxTransposePasses: 0 }).run({
        graph,
        config,
        sizes: merged,
        ranks: out.ranks,
        reversedEdges: out.reversedEdges,
        virtualNodes: new Set<NodeId>(out.virtualNodes?.keys() ?? []),
        virtualChains,
      }).layers;
      dummies += out.virtualNodes?.size ?? 0;
      const flat = flatten(graph, layers, virtualChains);
      transposeLayers(flat.rows, flat.position, flat.adjacency, 4);
      const reference = referenceTranspose(graph, layers, 4, 'improving', virtualChains);
      expect(idsOf(flat.rows, flat.ids)).toEqual(reference.layers);
      if (!reference.layers.every((layer, at) => layer.join() === layers[at]?.join())) {
        moved += 1;
      }
    }
    // Not vacuous: there really are dummies in the index and the pass really
    // rearranges every one of these drawings.
    expect(dummies).toBeGreaterThan(200);
    expect(moved).toBe(8);
  }, 120_000);

  /**
   * D6, and it is tested here rather than at the stage because the stage keeps
   * the best layering it has seen and would throw away the evidence. The
   * deltas are exact and only non-increasing swaps are taken, so the count
   * after a pass cannot exceed the count before it. This is a property test and
   * NOT a runtime guard on purpose: a guard that kept whichever layering scored
   * better would make every arithmetic error in the delta invisible, which is
   * the one bug this property exists to catch.
   */
  it('never raises the crossing count of the layering it is given', () => {
    const random = mulberry32(0x9e11);
    let lowered = 0;
    let total = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const { graph, layers } = randomLayered(random, 90, 5, 260);
      const before = countCrossings({ graph, layers });
      const flat = flatten(graph, layers);
      transposeLayers(flat.rows, flat.position, flat.adjacency, 8);
      const after = countCrossings({ graph, layers: idsOf(flat.rows, flat.ids) });
      expect(after).toBeLessThanOrEqual(before);
      if (after < before) lowered += 1;
      total += 1;
    }
    // The property is not holding because the pass does nothing.
    expect(lowered).toBe(total);
  });

  /**
   * The pass leaves `position` describing the layers it produced, which is what
   * lets the next pass compute a delta rather than a fiction. Checked by
   * running the same pass budget in one call and in single-pass calls: the
   * second only reaches the same answer if the state it hands on is right.
   */
  it('leaves the positions it was given describing the layers it produced', () => {
    const { graph, layers } = randomLayered(mulberry32(5), 70, 5, 180);
    const once = flatten(graph, layers);
    transposeLayers(once.rows, once.position, once.adjacency, 3);
    const stepped = flatten(graph, layers);
    for (let pass = 0; pass < 3; pass += 1) {
      transposeLayers(stepped.rows, stepped.position, stepped.adjacency, 1);
    }
    expect(idsOf(stepped.rows, stepped.ids)).toEqual(idsOf(once.rows, once.ids));
    for (const row of once.rows) {
      for (const [slot, node] of row.entries()) expect(once.position[node]).toBe(slot);
    }
  });
});

describe('transposeLayers, what stops the loop', () => {
  /**
   * D4, first half: the shipping gate. Termination is on a pass that made no
   * STRICTLY IMPROVING swap, so the one zero-delta swap this graph offers is
   * taken, the pass reports no improvement, and the loop ends after one pass
   * out of a cap of 400.
   */
  it('stops after one pass on two nodes sharing a neighbour', () => {
    const { graph, layers } = sharedNeighbour();
    const flat = flatten(graph, layers);
    expect(transposeLayers(flat.rows, flat.position, flat.adjacency, 400)).toBe(1);
    expect(idsOf(flat.rows, flat.ids)).toEqual([['n2', 'n1'], ['n0']]);
    // The swap it took was worth nothing, which is the case that makes the gate
    // load bearing rather than obvious.
    expect(countCrossings({ graph, layers })).toBe(0);
    expect(countCrossings({ graph, layers: idsOf(flat.rows, flat.ids) })).toBe(0);
  });

  /**
   * D4, second half, and the half that says why the first one is a rule rather
   * than an accident. A loop gated on "did this pass swap anything" never ends
   * on this graph: the same two nodes swap back and forth in a clean period-2
   * cycle, every pass reporting a swap and no improvement.
   *
   * Pinned through the rescoring reference rather than through the shipped
   * pass, because the shipped pass has one gate and shipping a second one so a
   * test could select it would be dead code in the stage. The reference makes
   * the same decisions from the definition, so the cycle it falls into is the
   * cycle the rule falls into.
   *
   * Both halves are needed. The hang takes the zero-delta rule AND the any-swap
   * gate together: a build that refused zero-delta swaps would terminate under
   * either gate, so a test that only asserted "the loop ends" would pass on a
   * strict-only build and catch nothing.
   */
  it('oscillates forever when the gate is any swap rather than an improving one', () => {
    const { graph, layers } = sharedNeighbour();
    const even = referenceTranspose(graph, layers, 400, 'any');
    expect(even.passes).toBe(400);
    expect(even.layers).toEqual([['n1', 'n2'], ['n0']]);
    const odd = referenceTranspose(graph, layers, 401, 'any');
    expect(odd.passes).toBe(401);
    expect(odd.layers).toEqual([['n2', 'n1'], ['n0']]);
    // The shipping gate on the same graph, from the same reference, so that the
    // two rules are compared on one implementation rather than across two.
    expect(referenceTranspose(graph, layers, 400).passes).toBe(1);
  });

  it('runs no pass at all at a cap of zero', () => {
    const { graph, layers } = randomLayered(mulberry32(13), 60, 4, 140);
    const flat = flatten(graph, layers);
    expect(transposeLayers(flat.rows, flat.position, flat.adjacency, 0)).toBe(0);
    expect(idsOf(flat.rows, flat.ids)).toEqual(layers);
  });
});

describe('barycenterOrder, where the transpose pass runs', () => {
  /** The layers a stage produces for a state, as plain arrays for comparison. */
  const ordered = (
    state: RankedState,
    options?: Parameters<typeof barycenterOrder>[0],
  ): NodeId[][] =>
    barycenterOrder(options)
      .run(state)
      .layers.map((layer) => [...layer]);

  /**
   * D1: the pass is applied to the BEST layering the sweeps saw and not to the
   * last one they left behind, and this is the case where the two differ.
   *
   * The trap is that the stage's `position` array tracks the last working
   * layering rather than the best one, so a pass that transposed `best` without
   * repositioning from it first would compute every delta against the wrong
   * permutation. That does not throw and does not produce an illegal layering.
   * What it does is decide arbitrarily, and that is why this case compares
   * LAYERS rather than a crossing count: measured on a build with the
   * repositioning removed, the arbitrary decisions are not reliably worse. On
   * this graph at a budget of 5 the broken build reaches 100 crossings against
   * the correct 102, and on a 150-node graph at a budget of 8 it reaches 673
   * against 675, while on the same 150-node graph at a budget of 5 and on a
   * 120-node one at 5 it is behind. A count-based assertion would have to be an
   * inequality, and the inequality points the wrong way often enough to pass.
   *
   * The graph is the one the sweeps are already known to be non-monotone on,
   * from the sweep-budget test: budget 5 returns the same layering as budget 4,
   * so the best seen was found no later than sweep 4 and sweep 5 left a
   * different, worse layering behind as the working one.
   */
  it('transposes the best layering the sweeps saw, not the last one', () => {
    const { graph, layers } = randomLayered(mulberry32(1), 40, 4, 90);
    const state = stateOf(graph, layers);
    const best = ordered(state, { maxSweeps: 5, maxTransposePasses: 0 });
    expect(best).toEqual(ordered(state, { maxSweeps: 4, maxTransposePasses: 0 }));
    const transposed = referenceTranspose(graph, best, 8).layers;
    expect(countCrossings({ graph, layers: transposed })).toBeLessThan(
      countCrossings({ graph, layers: best }),
    );
    expect(ordered(state, { maxSweeps: 5, maxTransposePasses: 8 })).toEqual(transposed);
  });

  /**
   * The stage runs the pass once, after the sweeps, rather than inside them.
   * A run whose sweeps are capped at zero is a seed with the pass applied to
   * it, and it agrees with the reference applied to that same seed.
   */
  it('runs the pass once after the sweeps, on the layering they settled on', () => {
    const { graph, layers } = randomLayered(mulberry32(2), 80, 5, 220);
    const state = stateOf(graph, layers);
    for (const maxSweeps of [0, 1, 8]) {
      const base = ordered(state, { maxSweeps, maxTransposePasses: 0 });
      const expected = referenceTranspose(graph, base, 8).layers;
      expect(ordered(state, { maxSweeps, maxTransposePasses: 8 })).toEqual(expected);
    }
  });

  /**
   * A zero-delta swap never reaches the output for nothing. The stage takes the
   * transposed layering only when it scores STRICTLY lower, which is the same
   * best-seen rule the sweeps already run under, so on the witness graph, where
   * the only available swap is worth exactly zero, the layers that come back
   * are the ones that went in. That is what answers the churn objection to D3:
   * the tie rule lets the pass walk through a plateau to reach something
   * better, and when it finds nothing better the walk is discarded.
   */
  it('does not return a reordering that bought nothing', () => {
    const { graph, layers } = sharedNeighbour();
    const state = stateOf(graph, layers);
    const off = ordered(state, { maxTransposePasses: 0 });
    expect(ordered(state, { maxTransposePasses: 8 })).toEqual(off);
  });

  it('defaults to a cap of 16 passes', () => {
    const { graph, layers } = randomLayered(mulberry32(17), 120, 6, 400);
    const state = stateOf(graph, layers);
    expect(ordered(state)).toEqual(ordered(state, { maxTransposePasses: 16 }));
    expect(ordered(state)).not.toEqual(ordered(state, { maxTransposePasses: 0 }));
    // And not the 8 it was until M2.6c re-derived it, which is the assertion
    // that fails if the constant is reverted rather than changed to something
    // else. The two caps reach different layerings on this graph, so a stage
    // that quietly went back to 8 does not pass by reaching the same answer.
    expect(ordered(state)).not.toEqual(ordered(state, { maxTransposePasses: 8 }));
  });

  /**
   * The stage is monotone in the transpose cap for the same reason it is
   * monotone in the sweep budget: the pass only takes non-increasing swaps and
   * the best layering seen is what comes back. A larger cap is a weakly better
   * answer rather than a different one, which is what makes the cap a time
   * decision rather than a quality gamble.
   */
  it('is monotone in the transpose cap', () => {
    const random = mulberry32(23);
    for (const [nodes, depth, edges] of [
      [120, 6, 400],
      [200, 8, 700],
      [60, 4, 150],
    ] as const) {
      const { graph, layers } = randomLayered(random, nodes, depth, edges);
      const state = stateOf(graph, layers);
      const scores = [0, 1, 2, 4, 8, 16].map((maxTransposePasses) =>
        countCrossings({ graph, layers: ordered(state, { maxTransposePasses }) }),
      );
      for (const [step, crossings] of scores.entries()) {
        if (step === 0) continue;
        expect(crossings).toBeLessThanOrEqual(scores[step - 1] ?? crossings);
      }
      expect(scores.at(-1)).toBeLessThan(scores[0] ?? 0);
    }
  });
});

/**
 * The pass with D3 REFUSED: a swap is taken only when the delta is strictly
 * negative. The third solver in this file, and the only one that does not
 * describe anything the package ships.
 *
 * It is here because the tie rule is a DECISION rather than a mechanism, and
 * the evidence for a decision is a comparison against the thing it beat. That
 * evidence went stale once already: the rule was chosen before M2.2c, on a
 * drawing where the counter saw a quarter of the 10k's edges, and by M2.6c the
 * configurations it had won in were budgets the stage no longer used over a
 * population twenty times smaller. Prose could not show that; a column that
 * moves when the drawing moves can.
 *
 * ONE LINE APART FROM {@link transposeLayers}, deliberately: same traversal,
 * same gate, same O(deg v * deg w) delta, and `delta >= 0` where the shipping
 * pass has `delta > 0`. Everything else being identical is what makes the
 * comparison below about the tie rule rather than about two implementations.
 * The one addition is `exclude`, which the shipping pass has no need of AS A
 * PARAMETER because it never wants the exclusion off: it takes ties, so it
 * always needs it, and it applies it unconditionally. Here it is a switch
 * because the second case below asserts that the two are one argument.
 *
 * WHY IT REPRODUCES THE SHIPPING PASS EXACTLY under this rule, and it is worth
 * being precise because the tempting answer is wrong: BECAUSE THE TRAVERSAL IS
 * THE SAME ONE, layers in index order and each layer left to right, with
 * `position` updated at the swap. Not because strict descent has one answer.
 * It does not: the "swap v past w" relation can be cyclic, so which local
 * minimum a strict pass reaches depends on the order it walks pairs in.
 * Measured, 200 random layered graphs of 40 nodes, 4 layers and 90 edges, run
 * left to right against right to left at a cap of 64: 198 of 200 end in
 * different layers and 191 of 200 at a different crossing count. So the strict
 * column below is a property of THIS TRAVERSAL over these graphs, which is the
 * right thing for it to be, because the traversal is the shipping pass's and
 * the column exists to isolate the tie rule from everything else.
 */
function strictTranspose(
  layers: readonly number[][],
  position: Int32Array,
  adjacency: TransposeAdjacency,
  maxPasses: number,
  exclude = true,
): number {
  // The shipping pass reads every flat array through an accessor that THROWS on
  // a missing entry, and this one has to as well. A `?? 0` fallback would turn
  // an index out of range under some later change to `TransposeAdjacency` into
  // a plausible-looking strict column instead of a failure, which is the one
  // deviation from "one line apart" that would hide rather than announce
  // itself.
  const at = (values: { readonly [index: number]: number | undefined }, index: number): number => {
    const value = values[index];
    if (value === undefined) throw new Error(`strictTranspose read past the end at ${index}`);
    return value;
  };
  const side = (start: Int32Array, next: Int32Array, before: number, after: number): number => {
    let delta = 0;
    for (let entry = at(start, before); entry < at(start, before + 1); entry += 1) {
      const left = at(position, at(next, entry));
      for (let other = at(start, after); other < at(start, after + 1); other += 1) {
        const right = at(position, at(next, other));
        if (left < right) delta += 1;
        else if (left > right) delta -= 1;
      }
    }
    return delta;
  };
  const unanchored = (node: number): boolean =>
    at(adjacency.upStart, node) === at(adjacency.upStart, node + 1) &&
    at(adjacency.downStart, node) === at(adjacency.downStart, node + 1);
  let passes = 0;
  while (passes < maxPasses) {
    passes += 1;
    let improved = false;
    for (const layer of layers) {
      for (let slot = 0; slot + 1 < layer.length; slot += 1) {
        const before = at(layer, slot);
        const after = at(layer, slot + 1);
        if (exclude && (unanchored(before) || unanchored(after))) continue;
        const delta =
          side(adjacency.upStart, adjacency.upNext, before, after) +
          side(adjacency.downStart, adjacency.downNext, before, after);
        if (delta >= 0) continue;
        layer[slot] = after;
        layer[slot + 1] = before;
        position[after] = slot;
        position[before] = slot + 1;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return passes;
}

/**
 * WHY TAKING TIES BEATS REFUSING THEM, measured on the drawing the stage orders
 * today and at the budgets it ships, which is the whole of M2.6d.
 *
 * The rule and the exclusion beside it are one argument, so both are pinned
 * here. What each column is, and why the pair is the comparison rather than
 * either number alone:
 *
 * | corpus         | sweeps only | strict, cap 16 | ties, cap 16 | ties lower |
 * | -------------- | ----------- | -------------- | ------------ | ---------- |
 * | 1k             |     210,163 |        207,110 |      185,028 |     10.66% |
 * | 10k            |   8,972,421 |      8,921,937 |    8,586,890 |      3.76% |
 * | tall-600       |      31,572 |         30,309 |       25,210 |     16.82% |
 * | wide-600       |     224,924 |        222,653 |      207,140 |      6.97% |
 * | dense-1200     |     931,903 |        927,135 |      878,459 |      5.25% |
 * | sparse-2000    |      47,393 |         44,592 |       39,969 |     10.37% |
 * | self-loops-800 |     127,837 |        125,408 |      112,709 |     10.13% |
 * | parallel-800   |     144,451 |        141,083 |      126,710 |     10.19% |
 *
 * ALL EIGHT ARE PINNED, the two bench corpora in the first case below and the
 * six golden graphs in the third. Pinning only the corpora would have left six
 * of the eight rows as prose in the milestone whose whole thesis is that prose
 * figures go stale, and the golden file is not the obstacle it first looks
 * like: those six graphs are `layeredDag` calls in `golden-corpus.ts`, so a
 * second file can rebuild them without touching the golden file's schema.
 *
 * THE STRICT RULE CAPTURES ABOUT AN EIGHTH OF WHAT THE PASS IS WORTH, 12.1% of
 * it on the 1k and 13.1% on the 10k, and that is the finding rather than the
 * margin: a pass that may not cross a plateau is not a weaker version of this
 * one, it is a different and much smaller thing.
 *
 * AT EQUAL CAP OR AT EQUAL TIME, BOTH READINGS AGREE, which the question has to
 * be asked in because the two rules TERMINATE differently. At cap 16 neither
 * has terminated on either corpus, so equal cap is equal pass count here and a
 * strict pass is if anything the cheaper of the two because it writes less. The
 * first case ASSERTS the strict half of that rather than stating it. The ties
 * half is not asserted and does not need to be, because it fails safe: a ties
 * run that terminated early would only make the winning column cheaper than it
 * is claimed to be.
 *
 * Run to its own fixed point instead, the strict rule stops after 35 passes on
 * the 1k at 207,068 and 207 on the 10k at 8,914,087, pinned in the second case,
 * so it never reaches what the tie rule reaches in 16 and takes several times as
 * long about it. The two figures it settles on are 10.64% and 3.67% above the
 * shipping column. Those 35 and 207 passes are a long grind for very little:
 * strict is within 0.2% of its own fixed point after FOUR passes on both
 * corpora, so what the remaining 31 and 203 buy is a fifth of one percent.
 *
 * WHAT THE COUNT CASES CATCH AND WHAT THEY DO NOT, checked by breaking the pass
 * rather than by reading the assertions. Reverting D3, `delta >= 0` in the
 * shipping pass, fails both of them: the ties column comes back reading the
 * strict one. Removing the EXCLUSION fails NEITHER and cannot, because that
 * drift is crossing-neutral and every column in both is a count. The exclusion
 * is covered by the two witness cases at the top of this file and by the
 * corpus-scale pins in `layout.order.test.ts`, all of which compare layers.
 *
 * WHAT THIS REPLACES. "Allowing zero-delta swaps wins all six configurations it
 * was tested in, by between 2.7% and 13.5%, and on the 10k run to a fixed point
 * it reaches 29,260 crossings against 32,677 for the strict rule." Those six
 * were sweep budgets and caps this stage no longer uses, over the pre-M2.2c
 * population of 10,528 visible edges rather than today's 214,222 segments, so
 * no figure in that sentence compares with a figure in this one. The conclusion
 * survived the move and the numbers did not.
 */
describe('transposeLayers, the tie rule against a strict one', () => {
  const corpora = [
    ['1k', smallCorpus()],
    ['10k', largeCorpus()],
  ] as const;

  /** The corpus ranked by the default stage, chains and all. */
  function rankedCorpus(spec: GraphSpec): RankedState {
    const graph = new Graph();
    for (const id of spec.nodes) graph.addNode(id);
    for (const [source, target] of spec.edges) graph.addEdge(source, target);
    const config = resolveConfig(undefined);
    const sizes = measureNodes(graph, config, undefined);
    const out = longestPathRankStage.run({ graph, config, sizes });
    const merged = new Map(sizes);
    for (const [id, size] of out.virtualNodes ?? []) merged.set(id, size);
    return {
      graph,
      config,
      sizes: merged,
      ranks: out.ranks,
      reversedEdges: out.reversedEdges,
      virtualNodes: new Set<NodeId>(out.virtualNodes?.keys() ?? []),
      virtualChains: out.virtualChains ?? new Map<EdgeId, readonly NodeId[]>(),
    };
  }

  /**
   * The ranked corpus and the layering the sweeps settle on it, once per
   * corpus for the whole block.
   *
   * All three cases below want exactly this and nothing else about it, and on
   * the 10k it is 184,222 nodes to rank and four sweeps to run. Computing it
   * per case ran the same work three times for one answer. Safe to share
   * because nothing here mutates it: `flatten` copies the layers into rows of
   * its own, and the stage is handed the state read-only.
   */
  const prepared = new Map<string, { state: RankedState; swept: readonly (readonly NodeId[])[] }>();
  function prepare(name: string, spec: GraphSpec): {
    state: RankedState;
    swept: readonly (readonly NodeId[])[];
  } {
    const cached = prepared.get(name);
    if (cached !== undefined) return cached;
    const state = rankedCorpus(spec);
    const swept = barycenterOrder({ maxSweeps: 4, maxTransposePasses: 0 }).run(state).layers;
    const fresh = { state, swept };
    prepared.set(name, fresh);
    return fresh;
  }

  it('reaches these counts on the bench corpora, where the strict rule stalls', () => {
    const table = corpora.map(([name, spec]) => {
      // The layering the sweeps settle on is what the stage hands the pass.
      // Both rules start from it, so the two columns differ in the rule and in
      // nothing else.
      const { state, swept } = prepare(name, spec);
      const score = (layers: readonly (readonly NodeId[])[]): number =>
        countCrossings({ graph: state.graph, layers, virtualChains: state.virtualChains });
      const base = score(swept);

      const strict = flatten(state.graph, swept, state.virtualChains);
      // The pass count is an assertion and not a diagnostic. It is the premise
      // the whole comparison rests on: NEITHER RULE TERMINATES BEFORE 16 on
      // either corpus, so equal cap is equal pass count and the two columns are
      // comparable without a stopwatch. Leave it unasserted and that premise
      // goes stale silently, which is the failure this milestone is correcting.
      const passes = strictTranspose(strict.rows, strict.position, strict.adjacency, 16);
      // The stage's own acceptance rule: the transposed layering is taken only
      // when it scores strictly lower. Applied to the strict column too, so
      // that the comparison is between two stages rather than between a stage
      // and a bare pass.
      const strictScore = Math.min(base, score(idsOf(strict.rows, strict.ids)));

      // The ties column through the stage itself rather than through `flatten`,
      // because that column is what ships and the file it is quoted in is about
      // the shipping stage.
      return [name, base, strictScore, score(barycenterOrder().run(state).layers), passes];
    });
    expect(table).toEqual([
      ['1k', 210_163, 207_110, 185_028, 16],
      ['10k', 8_972_421, 8_921_937, 8_586_890, 16],
    ]);
    for (const [, sweepsOnly, strict, ties] of table) {
      // Not a vacuous comparison: the strict pass does move both corpora, it
      // just does not move them far.
      expect(Number(strict)).toBeLessThan(Number(sweepsOnly));
      expect(Number(ties)).toBeLessThan(Number(strict));
    }
  }, 300_000);

  /**
   * WHERE THE STRICT RULE STOPS ON ITS OWN, which is the other half of the
   * equal-cap-or-equal-time question and the half a cap of 16 cannot answer.
   *
   * 35 passes on the 1k and 207 on the 10k, and neither settles anywhere near
   * what the tie rule reaches in 16. Both figures are pinned because the
   * argument uses them twice: they are why a cap of 16 is not cutting the
   * strict rule short in the case above, and they are the cost side of "run it
   * to exhaustion and it still loses".
   *
   * The fourth column is what four passes already have, and it is the reason
   * the long tail is not the strict rule's missing quality: it is within 0.2%
   * of its own fixed point after four passes on both corpora, so the other 31
   * and 203 passes buy a fifth of one percent between them. The tie rule at a
   * cap of 4 is already below where strict finishes.
   */
  it('runs out of strictly improving swaps here, and it does not help', () => {
    const table = corpora.map(([name, spec]) => {
      const { state, swept } = prepare(name, spec);
      const score = (rows: readonly (readonly number[])[], ids: readonly NodeId[]): number =>
        countCrossings({
          graph: state.graph,
          layers: idsOf(rows, ids),
          virtualChains: state.virtualChains,
        });
      const settled = flatten(state.graph, swept, state.virtualChains);
      // A cap far past where either corpus stops, so what comes back is the
      // fixed point and not the cap. It is asserted to be the fixed point by
      // the pass count coming back below the cap.
      const passes = strictTranspose(settled.rows, settled.position, settled.adjacency, 1_000);
      const early = flatten(state.graph, swept, state.virtualChains);
      strictTranspose(early.rows, early.position, early.adjacency, 4);
      return [name, passes, score(settled.rows, settled.ids), score(early.rows, early.ids)];
    });
    expect(table).toEqual([
      ['1k', 35, 207_068, 207_474],
      ['10k', 207, 8_914_087, 8_931_507],
    ]);
    for (const [, passes] of table) {
      // The run really did end on its own rather than on the cap, which is what
      // makes these fixed points rather than another pair of budgeted figures.
      expect(Number(passes)).toBeLessThan(1_000);
    }
  }, 300_000);

  /**
   * THE SAME COMPARISON ON THE SIX GRAPHS THE STAGE REGRESSES AGAINST, which is
   * the corpus that decides anything the two bench graphs cannot: it is the one
   * that showed M2.6c the sweep cut had to be paid for, because five of these
   * six are still improving at 8 sweeps where both bench corpora floor at 3.
   *
   * Here it says something simpler and more useful, which is that the tie rule
   * is not an artefact of two graphs from one generator's two size settings.
   * Ties is lower on all six, by 5.25% on `dense-1200` up to 16.82% on
   * `tall-600`, and the shape that moves the margin is long-edge share: the two
   * densest in long edges, `dense-1200` at 40% and `tall-600` at 25%, are the
   * two ends of the range.
   *
   * The graphs come from `golden-corpus.ts` rather than from a copy here, so
   * these numbers and the golden file's are numbers for the same six graphs.
   * The `sweepsOnly` column is deliberately the golden file's own, which is
   * what makes a drift between the two files a failure in both.
   */
  it('beats the strict rule on all six golden graphs too', () => {
    const table = goldenCorpus.map((entry) => {
      const graph = buildCorpusGraph(entry);
      const config = resolveConfig(undefined);
      const sizes = measureNodes(graph, config, undefined);
      const out = longestPathRankStage.run({ graph, config, sizes });
      const merged = new Map(sizes);
      for (const [id, size] of out.virtualNodes ?? []) merged.set(id, size);
      const virtualChains = out.virtualChains ?? new Map<EdgeId, readonly NodeId[]>();
      const state: RankedState = {
        graph,
        config,
        sizes: merged,
        ranks: out.ranks,
        reversedEdges: out.reversedEdges,
        virtualNodes: new Set<NodeId>(out.virtualNodes?.keys() ?? []),
        virtualChains,
      };
      const score = (layers: readonly (readonly NodeId[])[]): number =>
        countCrossings({ graph, layers, virtualChains });
      const swept = barycenterOrder({ maxSweeps: 4, maxTransposePasses: 0 }).run(state).layers;
      const base = score(swept);
      const strict = flatten(graph, swept, virtualChains);
      strictTranspose(strict.rows, strict.position, strict.adjacency, 16);
      return [
        entry.name,
        base,
        Math.min(base, score(idsOf(strict.rows, strict.ids))),
        score(barycenterOrder().run(state).layers),
      ];
    });
    expect(table).toEqual([
      ['tall-600', 31_572, 30_309, 25_210],
      ['wide-600', 224_924, 222_653, 207_140],
      ['dense-1200', 931_903, 927_135, 878_459],
      ['sparse-2000', 47_393, 44_592, 39_969],
      ['self-loops-800', 127_837, 125_408, 112_709],
      ['parallel-800', 144_451, 141_083, 126_710],
    ]);
    for (const [, sweepsOnly, strict, ties] of table) {
      expect(Number(strict)).toBeLessThan(Number(sweepsOnly));
      expect(Number(ties)).toBeLessThan(Number(strict));
    }
  }, 300_000);

  /**
   * THE EXCLUSION IS A NO-OP UNDER THE STRICT RULE, which is the claim that
   * makes it D3's dependent rather than a rule of its own, and it is asserted
   * rather than argued because the argument is short enough to look obvious and
   * is the kind of thing that stops being true quietly. An unanchored node
   * carries no segment in either gap, so every delta it takes part in is
   * exactly zero, so a rule that refuses zero-delta swaps already refuses every
   * pair the exclusion would have skipped.
   *
   * Byte-identical LAYERS rather than equal counts, because the drift the
   * exclusion prevents is crossing-neutral: two runs that disagreed about it
   * would agree about every count in the table above.
   */
  it('needs no unanchored exclusion once ties are refused', () => {
    for (const [name, spec] of corpora) {
      const { state, swept } = prepare(name, spec);
      const kept = flatten(state.graph, swept, state.virtualChains);
      strictTranspose(kept.rows, kept.position, kept.adjacency, 16);
      const dropped = flatten(state.graph, swept, state.virtualChains);
      strictTranspose(dropped.rows, dropped.position, dropped.adjacency, 16, false);
      expect(idsOf(dropped.rows, dropped.ids)).toEqual(idsOf(kept.rows, kept.ids));
    }
  }, 300_000);

  /**
   * HOW MANY NODES THE PINNING RULES ARE ABOUT, on the drawing the stage orders
   * now and over the SEGMENT adjacency, which is the population `reorder` and
   * this pass both read.
   *
   * 118 and 814 have nothing above them, so the sweeps pin them going down.
   * 24 and 162 have nothing on either side, so every sweep pins them and this
   * pass excludes them. Both pairs are quoted in `barycenterOrder`'s docstring
   * and neither had a test until M2.6d, which is how the second came to be
   * recorded as 120 and 1,101: those were taken before M2.4b's chains were
   * consumed, and the fall is the chains doing their job rather than the rule
   * losing its point. A node whose only edges spanned several ranks had no
   * neighbour in an adjacent layer and was unanchored; it now has a dummy one
   * rank away on each of them. What is left is genuinely isolated and still
   * drifts a slot per pass without the exclusion, which is what the two cases
   * above and the witness cases at the top of this file are between them for.
   *
   * The same two facts over the graph's OWN edges are 118 and 814 again and 48
   * and 438, pinned in `layout.order.test.ts`. Only the second moves between the
   * populations, and it moves for the reason the chains exist. The first not
   * moving is a measurement rather than a theorem: splitting a long edge can
   * only ADD an upward neighbour, so the segment set is a subset of the edge set
   * and equal counts mean equal sets, which rules out any node in either corpus
   * whose in-edges are all long ones. Nothing makes that impossible, so it is
   * pinned here rather than reasoned about.
   *
   * Pinned because the argument for both rules is "this is not a corner case",
   * and that is a claim about a number which two milestones moved without
   * anyone re-measuring it.
   */
  it('has this many nodes the adjacent layers say nothing about', () => {
    const counts = corpora.map(([name, spec]) => {
      const { state, swept } = prepare(name, spec);
      const flat = flatten(state.graph, swept, state.virtualChains);
      let noneAbove = 0;
      let unanchored = 0;
      for (let node = 0; node < flat.ids.length; node += 1) {
        const above =
          (flat.adjacency.upStart[node] ?? 0) === (flat.adjacency.upStart[node + 1] ?? 0);
        const below =
          (flat.adjacency.downStart[node] ?? 0) === (flat.adjacency.downStart[node + 1] ?? 0);
        if (above) noneAbove += 1;
        if (above && below) unanchored += 1;
      }
      return [name, flat.ids.length, noneAbove, unanchored];
    });
    expect(counts).toEqual([
      ['1k', 15_746, 118, 24],
      ['10k', 184_222, 814, 162],
    ]);
  }, 300_000);
});
