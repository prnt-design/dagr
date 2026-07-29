import { largeCorpus, smallCorpus } from '@dagr/bench';
import type { GraphSpec } from '@dagr/bench';
import { Graph } from '@dagr/graph';
import type { NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_CONFIG,
  InvalidConfigError,
  brandesKoepfPosition,
  brandesKoepfPositionStage,
  layout,
} from '../src/index.js';
import type {
  BrandesKoepfOptions,
  LayoutResult,
  OrderedState,
  Point,
  PositionedNode,
  Size,
} from '../src/index.js';
// The placeholder this stage does not displace, reached through the module that
// defines it because it is not part of the public surface. The row arithmetic
// below is asserted against it rather than against a copy of its numbers.
import { gridPositionStage } from '../src/stages.js';
import { mulberry32, randomLayered } from './random.js';

/**
 * Tolerance for comparing two coordinates, scaled to their magnitude. Copied in
 * shape from `layout.result.test.ts`, where the argument for it lives: a box
 * edge is recovered as `x + width / 2` from an `x` computed as `left + w / 2`,
 * and `(l + w / 2) + w / 2` is not always exactly `l + w`.
 */
function epsilonFor(...values: number[]): number {
  let magnitude = 1;
  for (const value of values) magnitude = Math.max(magnitude, Math.abs(value));
  return magnitude * 1e-9;
}

/** An entry that has to be there, so a missing one fails as itself. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/**
 * An `OrderedState`, which is what a position stage reads and all it reads.
 * Built here rather than run through `layout` so that a case pins THIS stage
 * against a layering it states, rather than against whatever the default rank
 * and order stages happen to produce for a graph.
 */
function stateOf(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  widthOf: (id: NodeId, index: number) => number,
  separations: { readonly nodeSep: number; readonly rankSep: number },
): OrderedState {
  const ranks = new Map<NodeId, number>();
  const sizes = new Map<NodeId, Size>();
  let index = 0;
  for (const [rank, layer] of layers.entries()) {
    for (const id of layer) {
      ranks.set(id, rank);
      sizes.set(id, { width: widthOf(id, index), height: 40 });
      index += 1;
    }
  }
  return {
    graph,
    config: { ...DEFAULT_LAYOUT_CONFIG, ...separations },
    sizes,
    ranks,
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
    layers,
  };
}

/**
 * A graph and a layering of it from layer sizes and endpoint pairs, with nodes
 * numbered LAYER BY LAYER: layer 0 holds `n0` upwards, then layer 1 continues
 * the run. That numbering is what lets a case be written as the counterexample
 * search reported it, `layers [3, 2, 3, 2]` with `edges [[1, 4], ...]`.
 */
function layered(
  layerSizes: readonly number[],
  edges: readonly (readonly [number, number])[],
): { graph: Graph; layers: NodeId[][] } {
  const graph = new Graph();
  const layers: NodeId[][] = [];
  let next = 0;
  for (const size of layerSizes) {
    const layer: NodeId[] = [];
    for (let slot = 0; slot < size; slot += 1) {
      layer.push(graph.addNode(`n${String(next)}`).id);
      next += 1;
    }
    layers.push(layer);
  }
  for (const [source, target] of edges) {
    graph.addEdge(`n${String(source)}`, `n${String(target)}`);
  }
  return { graph, layers };
}

/**
 * The worst violation of the SPACING invariant over every layer, in layout
 * units, or zero when there is none.
 *
 * The invariant is that two boxes side by side in a layer are at least
 * `nodeSep` apart edge to edge, so their centres are at least
 * `(width(u) + width(v)) / 2 + nodeSep` apart, in the layer's own left-to-right
 * order. It is strictly stronger than "no two boxes overlap": every overlap
 * within a layer breaks it, and it also catches a pair that respects the boxes
 * but not the separation, and a pair the stage placed in the wrong order.
 */
function worstSpacing(state: OrderedState, positions: ReadonlyMap<NodeId, Point>): number {
  let worst = 0;
  for (const layer of state.layers) {
    for (let slot = 1; slot < layer.length; slot += 1) {
      const left = required(layer[slot - 1], 'left node');
      const right = required(layer[slot], 'right node');
      const leftAt = required(positions.get(left), `position for ${left}`).x;
      const rightAt = required(positions.get(right), `position for ${right}`).x;
      const leftWidth = required(state.sizes.get(left), `size for ${left}`).width;
      const rightWidth = required(state.sizes.get(right), `size for ${right}`).width;
      const need = (leftWidth + rightWidth) / 2 + state.config.nodeSep;
      const slack = rightAt - leftAt - need;
      if (slack < -epsilonFor(leftAt, rightAt, need) && slack < worst) worst = slack;
    }
  }
  return worst;
}

/** Every node of a laid-out result, grouped by its row's centre line. */
function rows(result: LayoutResult): PositionedNode[][] {
  const byCentre = new Map<number, PositionedNode[]>();
  for (const node of result.nodes.values()) {
    const row = byCentre.get(node.y);
    if (row === undefined) byCentre.set(node.y, [node]);
    else row.push(node);
  }
  return [...byCentre.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row.sort((left, right) => left.x - right.x));
}

/**
 * No two node boxes overlap, argued over the rows rather than over all
 * O(n^2) pairs, which at 10,000 nodes is 50 million comparisons of a predicate
 * that is about the rows anyway.
 *
 * The argument has two halves and both are asserted. Two nodes in the same row
 * cannot overlap when their centres are far enough apart horizontally, which is
 * the spacing check. Two nodes in different rows cannot overlap when the rows'
 * vertical spans are disjoint, which is the second loop. Together they cover
 * every pair. The 1k case below also runs the full pairwise sweep, so the
 * argument is checked against the predicate `layout.result.test.ts` uses rather
 * than only reasoned about.
 */
function expectNoOverlaps(result: LayoutResult, nodeSep: number, label: string): void {
  const grouped = rows(result);
  for (const row of grouped) {
    for (let slot = 1; slot < row.length; slot += 1) {
      const left = required(row[slot - 1], 'left node');
      const right = required(row[slot], 'right node');
      const need = (left.width + right.width) / 2 + nodeSep;
      const gap = right.x - left.x;
      expect(gap, `${label}: ${left.id} to ${right.id}`).toBeGreaterThanOrEqual(
        need - epsilonFor(left.x, right.x, need),
      );
    }
  }
  for (let index = 1; index < grouped.length; index += 1) {
    const above = required(grouped[index - 1], 'row above');
    const below = required(grouped[index], 'row below');
    let bottom = Number.NEGATIVE_INFINITY;
    for (const node of above) bottom = Math.max(bottom, node.y + node.height / 2);
    let top = Number.POSITIVE_INFINITY;
    for (const node of below) top = Math.min(top, node.y - node.height / 2);
    expect(top, `${label}: row ${String(index)} against the one above`).toBeGreaterThanOrEqual(
      bottom - epsilonFor(top, bottom),
    );
  }
}

/** The box a positioned node occupies, as `layout.result.test.ts` computes it. */
function box(node: PositionedNode) {
  return {
    left: node.x - node.width / 2,
    right: node.x + node.width / 2,
    top: node.y - node.height / 2,
    bottom: node.y + node.height / 2,
  };
}

/** Whether two node boxes share any interior area. Touching edges are fine. */
function overlaps(left: PositionedNode, right: PositionedNode): boolean {
  const one = box(left);
  const other = box(right);
  const epsX = epsilonFor(one.left, one.right, other.left, other.right);
  const epsY = epsilonFor(one.top, one.bottom, other.top, other.bottom);
  return (
    one.left < other.right - epsX &&
    other.left < one.right - epsX &&
    one.top < other.bottom - epsY &&
    other.top < one.bottom - epsY
  );
}

function graphOf(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  return graph;
}

const alignments = ['down-left', 'down-right', 'up-left', 'up-right'] as const;

describe('brandesKoepfPosition, the spacing invariant', () => {
  /**
   * The counterexample that decided the compaction, run as a regression test.
   *
   * Randomised search over layerings found it against the paper's class shift,
   * which records `shift[sink[u]] = min(shift[sink[u]], x[v] - x[root[u]] -
   * delta)` and applies it once: a class shifted against a class that is ITSELF
   * shifted later ends up short by the parent's shift. On this layering, in the
   * up direction with the left bias, `n0` and `n1` both land at x = 150, a
   * 100-unit overlap where 150 units of gap were required.
   *
   * It is asserted against the alignment the defect was found in AND against
   * the balanced default, because the median of four layouts can hide one
   * broken pass: the four candidates are sorted per node, so a single bad
   * coordinate can end up outside the middle two.
   */
  it('holds on the layering that the paper class shift overlaps', () => {
    const { graph, layers } = layered(
      [3, 2, 3, 2],
      [
        [1, 4],
        [2, 3],
        [2, 4],
        [3, 6],
        [4, 6],
        [7, 9],
      ],
    );
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const positions = brandesKoepfPosition({ align: 'up-left' }).run(state).positions;
    expect(worstSpacing(state, positions)).toBe(0);
    // The two nodes the class shift collided, named so that a failure says
    // which pair rather than only that some pair broke.
    const first = required(positions.get('n0'), 'position for n0').x;
    const second = required(positions.get('n1'), 'position for n1').x;
    expect(second - first).toBeGreaterThanOrEqual(150);
    expect(worstSpacing(state, brandesKoepfPositionStage.run(state).positions)).toBe(0);
  });

  const corpora = [
    ['1k', smallCorpus()],
    ['10k', largeCorpus()],
  ] as const;

  for (const [name, spec] of corpora) {
    it(`never overlaps a box and never crowds a layer on the ${name} corpus`, () => {
      // An override the runner cannot silently ignore. `layout` falls back to
      // `defaultStages.position` for an `undefined` override, so a test that
      // only passed the stage would have run `grid-position` and passed, which
      // is exactly what happened while this file was red.
      expect(brandesKoepfPositionStage.name).toBe('brandes-koepf-position');
      const result = layout({ graph: graphOf(spec) }, { position: brandesKoepfPositionStage });
      expect(result.nodes.size).toBe(spec.nodes.length);
      expectNoOverlaps(result, DEFAULT_LAYOUT_CONFIG.nodeSep, name);
      // The workload, pinned so that a corpus that stopped being one cannot
      // leave this green: rows with something to space, and a widest row that
      // makes the spacing a real constraint rather than a formality.
      const grouped = rows(result);
      const crowded = grouped.filter((row) => row.length > 1);
      expect(grouped.length).toBe(name === '1k' ? 81 : 203);
      expect(crowded.length).toBe(name === '1k' ? 79 : 203);
      expect(Math.max(...grouped.map((row) => row.length))).toBe(name === '1k' ? 120 : 1101);
    });
  }

  it('agrees with the pairwise overlap predicate on the 1k corpus', () => {
    // The row argument in `expectNoOverlaps` checked against the O(n^2) sweep
    // `layout.result.test.ts` uses, on the larger of the two corpora that can
    // afford it: 1,000 nodes is half a million pairs, 10,000 is fifty million.
    const graph = graphOf(smallCorpus());
    const result = layout({ graph }, { position: brandesKoepfPositionStage });
    const nodes = [...result.nodes.values()];
    let overlapping = 0;
    for (let index = 0; index < nodes.length; index += 1) {
      for (let other = index + 1; other < nodes.length; other += 1) {
        const left = required(nodes[index], 'node');
        const right = required(nodes[other], 'node');
        if (overlaps(left, right)) overlapping += 1;
      }
    }
    expect(overlapping).toBe(0);
  });
});

describe('brandesKoepfPosition over random layerings', () => {
  /**
   * Every alignment, over a population of random layerings with mixed widths
   * and separations.
   *
   * WHAT IT COVERS, stated because a random test that stopped covering it would
   * otherwise stay green: 240 layerings, 12,617 nodes over 1,460 layers, each
   * run at all four alignments and at the balanced default, which is 1,200
   * solves and about 50ms. 1,421 of those layers hold more than one node and so
   * have spacing to get wrong, over 11,157 side-by-side pairs. Widths vary per
   * node, including whole layerings of zero-width nodes, and `nodeSep` varies
   * including zero, because a uniform width hides a delta computed from the
   * wrong pair of boxes.
   *
   * The counters below are the guard against it going vacuous. The spike this
   * stage came from ran 60,000 layerings; a committed test runs a couple of
   * hundred, so it has to say what those few hundred contained. The three
   * counting the population are pinned EXACTLY, because they are facts about
   * the generator and the seeds and nothing here should be able to move them.
   * The fourth is a floor, because it counts what the stage did.
   */
  it('never breaks the spacing invariant, at every alignment', () => {
    let pairs = 0;
    let crowdedLayers = 0;
    let aligned = 0;
    let solves = 0;
    for (let seed = 1; seed <= 240; seed += 1) {
      const random = mulberry32(seed);
      const { graph, layers } = randomLayered(
        random,
        20 + Math.floor(random() * 70),
        3 + Math.floor(random() * 7),
        30 + Math.floor(random() * 90),
      );
      if (layers.length < 2) continue;
      const nodeSep = seed % 5 === 0 ? 0 : 1 + Math.floor(random() * 60);
      const widths = new Map<NodeId, number>();
      for (const layer of layers) {
        for (const id of layer) widths.set(id, seed % 7 === 0 ? 0 : Math.floor(random() * 120));
      }
      const state = stateOf(graph, layers, (id) => widths.get(id) ?? 0, { nodeSep, rankSep: 30 });
      for (const layer of state.layers) {
        if (layer.length > 1) crowdedLayers += 1;
        pairs += Math.max(layer.length - 1, 0);
      }
      for (const align of [...alignments, 'balanced'] as const) {
        const positions = brandesKoepfPosition({ align }).run(state).positions;
        solves += 1;
        expect(worstSpacing(state, positions), `seed ${String(seed)} at ${align}`).toBe(0);
      }
      // How much ALIGNING the passes did on this seed, counted as adjacent-layer
      // neighbours the down-left pass gave exactly the same x. A stage that
      // never aligned anything would still satisfy the invariant above, by
      // packing every layer left, and this is what says it did not.
      const packed = brandesKoepfPosition({ align: 'down-left' }).run(state).positions;
      const rankOf = state.ranks;
      for (const edge of graph.edges()) {
        const source = packed.get(edge.source);
        const target = packed.get(edge.target);
        const from = rankOf.get(edge.source);
        const to = rankOf.get(edge.target);
        if (source === undefined || target === undefined) continue;
        if (from === undefined || to === undefined || Math.abs(from - to) !== 1) continue;
        if (source.x === target.x) aligned += 1;
      }
    }
    expect(solves).toBe(1200);
    expect(crowdedLayers).toBe(1421);
    expect(pairs).toBe(11157);
    expect(aligned).toBeGreaterThan(3000);
  });
});

describe('brandesKoepfPosition, the four passes and the balancing', () => {
  /**
   * The case where all four passes and the median between them are visible in
   * three coordinates: one node fanning out to two.
   *
   * A single downward left-biased pass aligns `a` with the first of its two
   * children and packs the second beside it, so `a` sits over `b` at x = 0.
   * The right-biased pass is the mirror image and puts `a` over `c`. The
   * median of the four puts `a` half way between them, which is the whole
   * point of running four of them: the drawing that comes back is one no
   * single pass produces.
   */
  it('centres a fan-out over its children, which no single pass does', () => {
    const { graph, layers } = layered(
      [1, 2],
      [
        [0, 1],
        [0, 2],
      ],
    );
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const balanced = brandesKoepfPositionStage.run(state).positions;
    expect(required(balanced.get('n0'), 'n0').x).toBe(75);
    expect(required(balanced.get('n1'), 'n1').x).toBe(0);
    expect(required(balanced.get('n2'), 'n2').x).toBe(150);
    // The vertical arithmetic is `gridPositionStage`'s, unchanged: a row is as
    // tall as its tallest node, rows are `rankSep` apart edge to edge, and a
    // layer's nodes share a centre line.
    expect(required(balanced.get('n0'), 'n0').y).toBe(20);
    expect(required(balanced.get('n1'), 'n1').y).toBe(110);
    expect(required(balanced.get('n2'), 'n2').y).toBe(110);

    const single = brandesKoepfPosition({ align: 'down-left' }).run(state).positions;
    expect(required(single.get('n0'), 'n0').x).toBe(0);
    // The four candidates are not four copies of one another, which is what a
    // balancing step has to have to be worth running.
    const mirrored = brandesKoepfPosition({ align: 'down-right' }).run(state).positions;
    expect(required(mirrored.get('n1'), 'n1').x).not.toBe(
      required(single.get('n1'), 'n1').x,
    );
  });

  it('aligns a node with the median of its neighbours, and the bias picks which', () => {
    // Four parents and one child, so the median is a PAIR, indices 1 and 2 of
    // the four. The left bias takes the first of the two and the right bias the
    // second, which is the whole difference between those two passes, and
    // neither takes the outermost parent, which is what an alignment that
    // followed the first neighbour it found would do.
    const { graph, layers } = layered(
      [4, 1],
      [
        [0, 4],
        [1, 4],
        [2, 4],
        [3, 4],
      ],
    );
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const left = brandesKoepfPosition({ align: 'down-left' }).run(state).positions;
    expect(required(left.get('n4'), 'n4').x).toBe(required(left.get('n1'), 'n1').x);
    const right = brandesKoepfPosition({ align: 'down-right' }).run(state).positions;
    expect(required(right.get('n4'), 'n4').x).toBe(required(right.get('n2'), 'n2').x);
  });

  it('puts every row exactly where grid-position puts it, whatever the heights', () => {
    // The vertical convention is `gridPositionStage`'s and only the horizontal
    // coordinate is this stage's business, so it is asserted against that stage
    // rather than against a second copy of its arithmetic. Reached through the
    // module that defines it, as `test/index.test.ts` does, because a
    // placeholder is not part of the public surface.
    const { graph, layers } = layered(
      [2, 3, 1],
      [
        [0, 2],
        [1, 3],
        [1, 4],
        [2, 5],
      ],
    );
    const heights = [9, 90, 3, 40, 7, 60];
    const state: OrderedState = {
      ...stateOf(graph, layers, (_id, index) => 10 + index * 7, { nodeSep: 11, rankSep: 13 }),
      sizes: new Map(
        [...layers.flat()].map((id, index) => [
          id,
          { width: 10 + index * 7, height: heights[index] ?? 1 },
        ]),
      ),
    };
    const mine = brandesKoepfPositionStage.run(state).positions;
    const grid = gridPositionStage.run(state).positions;
    for (const id of layers.flat()) {
      expect(required(mine.get(id), id).y, `y of ${id}`).toBe(required(grid.get(id), id).y);
    }
    // A row is as tall as its TALLEST node and its nodes share a centre line,
    // which is what makes the second row start at 90 + 13 rather than at 9 + 13.
    expect(required(mine.get('n0'), 'n0').y).toBe(45);
    expect(required(mine.get('n1'), 'n1').y).toBe(45);
    expect(required(mine.get('n2'), 'n2').y).toBe(90 + 13 + 20);
    expect(required(mine.get('n5'), 'n5').y).toBe(90 + 13 + 40 + 13 + 30);
  });

  it('reads back a coordinate of zero as zero rather than as negative zero', () => {
    // The mirrored passes negate their coordinates, and negating zero gives
    // `-0`, which is a legal double that compares equal under `===` and NOT
    // under `Object.is`. A caller diffing two runs for M3 would see a node
    // move from `0` to `-0`.
    const { graph, layers } = layered([1], []);
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    // A mirrored pass on its own is where the sign survives to the output. The
    // balanced default averages the middle two of four candidates, and the two
    // in the middle of `[-0, -0, 0, 0]` average to `0` on their own, so it is
    // the single pass that pins this rather than the default.
    const mirrored = brandesKoepfPosition({ align: 'down-right' }).run(state).positions;
    expect(Object.is(required(mirrored.get('n0'), 'n0').x, 0)).toBe(true);
    const positions = brandesKoepfPositionStage.run(state).positions;
    expect(Object.is(required(positions.get('n0'), 'n0').x, 0)).toBe(true);
  });
});

describe('brandesKoepfPosition, determinism and options', () => {
  it('gives the same layering the same coordinates twice', () => {
    const { graph, layers } = layered(
      [3, 4, 2],
      [
        [0, 3],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
        [4, 7],
        [5, 8],
        [6, 8],
      ],
    );
    const state = stateOf(graph, layers, (_id, index) => 20 + index * 10, {
      nodeSep: 13,
      rankSep: 7,
    });
    const first = [...brandesKoepfPositionStage.run(state).positions];
    expect([...brandesKoepfPositionStage.run(state).positions]).toEqual(first);
    // A fresh stage object, since the exported one is a frozen singleton shared
    // by every run in the process and could be accumulating state.
    expect([...brandesKoepfPosition().run(state).positions]).toEqual(first);
  });

  it('rejects an alignment it does not have, naming the option', () => {
    let caught: unknown;
    try {
      brandesKoepfPosition({ align: 'sideways' as BrandesKoepfOptions['align'] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    // NOT a `RangeError`: that is `@dagr/render`'s rule for an out-of-range
    // value and it does not reach this package, which has one error family and
    // one member of it meaning "the caller handed in nonsense".
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as InvalidConfigError).field).toBe('align');
    expect((caught as InvalidConfigError).code).toBe('INVALID_CONFIG');
    expect((caught as Error).message).toContain('Invalid layout option');
  });

  it('is rejected at the call that named the alignment, not at the run', () => {
    const { graph, layers } = layered([1], []);
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    // The good ones all build and all run, which is what makes the rejection
    // above about the value rather than about the option existing.
    for (const align of [...alignments, 'balanced'] as const) {
      expect(brandesKoepfPosition({ align }).run(state).positions.size).toBe(1);
    }
    expect(brandesKoepfPosition({}).run(state).positions.size).toBe(1);
    expect(brandesKoepfPosition({ align: undefined }).run(state).positions.size).toBe(1);
  });
});

describe('brandesKoepfPosition and type 1 conflicts', () => {
  /**
   * The type 1 marking, which has nothing to mark until M2.4b.
   *
   * An inner segment joins two nodes the caller never added, and no stage in
   * this package declares one yet, so on every graph the pipeline produces
   * today the marking pass marks nothing. It is implemented and tested anyway,
   * because M2.4b's dummy chains are inner segments and a pass that was never
   * executed is not a pass anyone should trust when they arrive.
   *
   * The layering here is the paper's own picture: an inner segment from `d0`
   * down to `d1`, and a real edge from `r0` down to `r1` that crosses it. The
   * left-biased downward pass reaches `r1` first, and without the marking it
   * aligns `r1` with `r0`, which raises the running position bound past `d0`
   * and leaves the chain bent. Marking the crossing segment stops that, and the
   * chain comes out vertical.
   */
  it('keeps a dummy chain straight through an edge that crosses it', () => {
    const graph = new Graph();
    for (const id of ['d0', 'r0', 'r1', 'd1']) graph.addNode(id);
    graph.addEdge('d0', 'd1', 'inner');
    graph.addEdge('r0', 'r1', 'crossing');
    const layers = [
      ['d0', 'r0'],
      ['r1', 'd1'],
    ];
    const base = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const state: OrderedState = { ...base, virtualNodes: new Set(['d0', 'd1']) };
    const positions = brandesKoepfPosition({ align: 'down-left' }).run(state).positions;
    // The chain is vertical: the inner segment aligned and the crossing one did
    // not. Without the marking `d1` lands 150 to the right of `d0` instead.
    expect(required(positions.get('d1'), 'd1').x).toBe(required(positions.get('d0'), 'd0').x);
    expect(worstSpacing(state, positions)).toBe(0);
    // The same layering with nothing declared virtual has no inner segment, so
    // nothing is marked and the chain does bend. That is the arm that says the
    // assertion above is about the marking rather than about the layering.
    const unmarked = brandesKoepfPosition({ align: 'down-left' }).run(base).positions;
    expect(required(unmarked.get('d1'), 'd1').x).not.toBe(
      required(unmarked.get('d0'), 'd0').x,
    );
  });
});
