import { Graph } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { barycenterOrder, countCrossings, transposeLayers } from '../src/order.js';
import { forEachSegment } from '../src/segments.js';
import { longestPathRankStage } from '../src/rank.js';
import { measureNodes, resolveConfig } from '../src/config.js';
import { mulberry32, randomLayered } from './random.js';
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
   * which at the default cap is eight, and it compounds across re-layouts
   * because the warm start hands the drifted order back in.
   *
   * Found by algorithms-review on 41 of 41 unanchored nodes in one generated
   * corpus and 371 of 371 in another, every one displaced by exactly the pass
   * budget.
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
