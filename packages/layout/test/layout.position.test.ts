import { largeCorpus, smallCorpus } from '@dagr/bench';
import type { GraphSpec } from '@dagr/bench';
import { Graph } from '@dagr/graph';
import type { NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, InvalidConfigError, layout } from '../src/index.js';
import type { LayoutResult, OrderedState, Point, PositionedNode, Size } from '../src/index.js';
// The stage under test, reached through the module that defines it because it
// is not part of the public surface: it is implemented and not exported, for
// the reason on it. The placeholder it does not displace is reached the same
// way, and the row arithmetic below is asserted against that stage rather than
// against a copy of its numbers.
import { brandesKoepfPosition, brandesKoepfPositionStage } from '../src/position.js';
import type { BrandesKoepfOptions } from '../src/position.js';
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
 * every pair, because {@link rows} groups by the exact `y` a node came back
 * with and so partitions them. The pairwise predicate itself is exercised in
 * `layout.result.test.ts`; a copy of that sweep used to run here on the 1k
 * corpus and was removed, because over 47 mutants of `position.ts` it killed a
 * strict subset of what the 1k row case below kills, nothing of its own, and it
 * cost half a million comparisons a run.
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
    const positions = brandesKoepfPosition({ variant: 'up-left' }).run(state).positions;
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
   * The last two are floors, because they count what the stage did, and there
   * are two of them because there are two sweep directions.
   */
  it('never breaks the spacing invariant, at every alignment', () => {
    let pairs = 0;
    let crowdedLayers = 0;
    const alignedDown = { total: 0 };
    const alignedUp = { total: 0 };
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
      for (const variant of [...alignments, 'balanced'] as const) {
        const positions = brandesKoepfPosition({ variant }).run(state).positions;
        solves += 1;
        expect(worstSpacing(state, positions), `seed ${String(seed)} at ${variant}`).toBe(0);
      }
      // How much ALIGNING the passes did on this seed, counted as adjacent-layer
      // neighbours a pass gave exactly the same x. A stage that never aligned
      // anything would still satisfy the invariant above, by packing every layer
      // left, and this is what says it did not.
      //
      // Counted for an UP pass as well as a down one, and kept apart. The two
      // directions are separate code paths through the same loop, so one
      // counter over `down-left` alone leaves the up direction with nothing at
      // all counting its alignments: a pass that swept the wrong way, and so
      // never reached the layer the sweep starts from, would move no number
      // here.
      const rankOf = state.ranks;
      for (const [variant, counts] of [
        ['down-left', alignedDown],
        ['up-left', alignedUp],
      ] as const) {
        const packed = brandesKoepfPosition({ variant }).run(state).positions;
        for (const edge of graph.edges()) {
          const source = packed.get(edge.source);
          const target = packed.get(edge.target);
          const from = rankOf.get(edge.source);
          const to = rankOf.get(edge.target);
          if (source === undefined || target === undefined) continue;
          if (from === undefined || to === undefined || Math.abs(from - to) !== 1) continue;
          if (source.x === target.x) counts.total += 1;
        }
      }
    }
    expect(solves).toBe(1200);
    expect(crowdedLayers).toBe(1421);
    expect(pairs).toBe(11157);
    expect(alignedDown.total).toBeGreaterThan(3000);
    expect(alignedUp.total).toBeGreaterThan(3000);
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

    const single = brandesKoepfPosition({ variant: 'down-left' }).run(state).positions;
    expect(required(single.get('n0'), 'n0').x).toBe(0);
    // The four candidates are not four copies of one another, which is what a
    // balancing step has to have to be worth running.
    const mirrored = brandesKoepfPosition({ variant: 'down-right' }).run(state).positions;
    expect(required(mirrored.get('n1'), 'n1').x).not.toBe(
      required(single.get('n1'), 'n1').x,
    );
  });

  /**
   * The balancing step itself, on a case where every one of its decisions is
   * visible in a coordinate.
   *
   * The fan-out above has equal widths and symmetric candidates, so it cannot
   * see any of this: the four layouts there are the same width, so which one is
   * the reference does not matter, and they are symmetric, so aligning them by
   * their left edges and by their right edges agree. Here the four come out
   * 270, 205, 210 and 270 wide, so there is exactly one narrowest and it is
   * neither the first candidate nor the widest, and the widths differ per node,
   * so a shift measured from the wrong edge lands somewhere else.
   *
   * What the expected coordinates pin, in order: the reference is the NARROWEST
   * of the four (`down-right` here, not `down-left` and not one of the two
   * widest); a left-biased layout is shifted by its LEFT edge and a right-biased
   * one by its right; and each node takes the median of the four, which is the
   * mean of the middle two AFTER sorting. Drop the sort and `n1` reads
   * `down-right` and `up-left` instead of the middle two and comes out at
   * -62.5.
   */
  it('balances four layouts of different widths onto the narrowest of them', () => {
    const { graph, layers } = layered(
      [3, 3],
      [
        [0, 3],
        [0, 5],
        [1, 3],
        [1, 4],
        [2, 3],
        [2, 4],
        [2, 5],
      ],
    );
    const widths = [90, 10, 30, 70, 40, 70];
    const state = stateOf(graph, layers, (_id, index) => widths[index] ?? 0, {
      nodeSep: 10,
      rankSep: 10,
    });
    // The four extents, asserted so that a case which stopped having exactly
    // one narrowest cannot leave the reference choice below untested.
    const extents = alignments.map((variant) => {
      const positions = brandesKoepfPosition({ variant }).run(state).positions;
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      for (const [index, id] of layers.flat().entries()) {
        const half = (widths[index] ?? 0) / 2;
        const at = required(positions.get(id), id).x;
        left = Math.min(left, at - half);
        right = Math.max(right, at + half);
      }
      return right - left;
    });
    expect(extents).toEqual([270, 205, 210, 270]);

    const balanced = brandesKoepfPositionStage.run(state).positions;
    const expected = new Map([
      ['n0', -125],
      ['n1', -65],
      ['n2', -15],
      ['n3', -127.5],
      ['n4', -62.5],
      ['n5', 2.5],
    ]);
    for (const [id, x] of expected) {
      expect(required(balanced.get(id), id).x, `balanced ${id}`).toBe(x);
    }
    expect(worstSpacing(state, balanced)).toBe(0);
  });

  it('aligns a node with the median of its neighbours, and the bias picks which', () => {
    // Four parents and one child, so the median is a PAIR, indices 1 and 2 of
    // the four. The left bias takes the first of the two and the right bias the
    // second, which is the whole difference between those two passes, and
    // neither takes the outermost parent, which is what an alignment that
    // followed the first neighbour it found would do.
    //
    // The four edges are authored OUT OF POSITION ORDER, and the expected
    // result is the same as if they were in it. That is the only thing in this
    // suite that defends the two counting sorts in `compress`: a median taken
    // by index is a median only if the bucket it indexes into is sorted by
    // position, and nothing about a caller's edge order says it is. Distribute
    // the entries in the caller's order instead of the neighbour-sorted one and
    // this bucket reads `n2 n0 n3 n1`, so the left bias takes `n0` and the
    // right bias `n3`: both OUTERMOST parents, which is what the assertions
    // below already say an alignment must not do.
    const { graph, layers } = layered(
      [4, 1],
      [
        [2, 4],
        [0, 4],
        [3, 4],
        [1, 4],
      ],
    );
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const left = brandesKoepfPosition({ variant: 'down-left' }).run(state).positions;
    expect(required(left.get('n4'), 'n4').x).toBe(required(left.get('n1'), 'n1').x);
    const right = brandesKoepfPosition({ variant: 'down-right' }).run(state).positions;
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

  it('sweeps the up passes bottom to top, so the TOP layer is aligned too', () => {
    // The same three-layer graph the row test below uses, pinned at the two UP
    // alignments. Nothing else in the suite pins an exact `up-left` or
    // `up-right` coordinate, and the spacing invariant cannot: a pass that
    // stopped aligning anything and packed every layer left still satisfies it.
    //
    // What an up pass has to do that a down pass does not is start at the
    // BOTTOM: `layer` counts down from `layerCount - 1` so that a node is
    // placed after the children it aligns with. Sweep top to bottom instead and
    // layer 0 is never visited at all, because the loop starts at step 1, so
    // `n0` and `n1` come out packed against each other at 0 and 24.5 rather
    // than aligned with the children below them.
    const { graph, layers } = layered(
      [2, 3, 1],
      [
        [0, 2],
        [1, 3],
        [1, 4],
        [2, 5],
      ],
    );
    const state = stateOf(graph, layers, (_id, index) => 10 + index * 7, {
      nodeSep: 11,
      rankSep: 13,
    });
    const up = brandesKoepfPosition({ variant: 'up-left' }).run(state).positions;
    const expected = new Map([
      ['n0', 0],
      ['n1', 38.5],
      ['n2', 0],
      ['n3', 38.5],
      ['n4', 84],
      ['n5', 0],
    ]);
    for (const [id, x] of expected) expect(required(up.get(id), id).x, `up-left ${id}`).toBe(x);
    // `n1` sits over `n3`, its median child, which is the alignment the top
    // layer only gets if the sweep reached it.
    expect(required(up.get('n1'), 'n1').x).toBe(required(up.get('n3'), 'n3').x);
    const mirrored = brandesKoepfPosition({ variant: 'up-right' }).run(state).positions;
    const mirroredExpected = new Map([
      ['n0', -84],
      ['n1', 0],
      ['n2', -84],
      ['n3', -45.5],
      ['n4', 0],
      ['n5', -84],
    ]);
    for (const [id, x] of mirroredExpected) {
      expect(required(mirrored.get(id), id).x, `up-right ${id}`).toBe(x);
    }
    expect(worstSpacing(state, up)).toBe(0);
    expect(worstSpacing(state, mirrored)).toBe(0);
  });

  it('reads back a coordinate of zero as zero rather than as negative zero', () => {
    // The mirrored passes negate their coordinates, and negating zero gives
    // `-0`, which is a legal double that compares equal under `===` and NOT
    // under `Object.is`. A caller diffing two runs for M3 would see a node
    // move from `0` to `-0`.
    const { graph, layers } = layered([1], []);
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    // A mirrored pass on its own is where the sign survives to the output, and
    // it is the ONLY place: the balanced default cannot fail this, so it is not
    // asserted. Its four candidates for a lone node are `[0, -0, 0, -0]`, a
    // typed-array sort orders `-0` before `0`, so the middle two are `-0` and
    // `0` and `(-0 + 0) / 2` is `+0` whatever the normalisation does. An arm on
    // the default here would have been an assertion that cannot go red.
    const mirrored = brandesKoepfPosition({ variant: 'down-right' }).run(state).positions;
    expect(Object.is(required(mirrored.get('n0'), 'n0').x, 0)).toBe(true);
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
    // A fresh stage object, since the module-level one is a frozen singleton
    // shared by every run in the process and could be accumulating state.
    expect([...brandesKoepfPosition().run(state).positions]).toEqual(first);
  });

  it('rejects a variant it does not have, naming the option', () => {
    let caught: unknown;
    try {
      brandesKoepfPosition({ variant: 'sideways' as BrandesKoepfOptions['variant'] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidConfigError);
    // NOT a `RangeError`: that is `@dagr/render`'s rule for an out-of-range
    // value and it does not reach this package, which has one error family and
    // one member of it meaning "the caller handed in nonsense".
    expect(caught).not.toBeInstanceOf(RangeError);
    expect((caught as InvalidConfigError).field).toBe('variant');
    expect((caught as InvalidConfigError).code).toBe('INVALID_CONFIG');
    expect((caught as Error).message).toContain('Invalid layout option');
  });

  it('is rejected at the call that named the variant, not at the run', () => {
    const { graph, layers } = layered([1], []);
    const state = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    // The good ones all build and all run, which is what makes the rejection
    // above about the value rather than about the option existing.
    for (const variant of [...alignments, 'balanced'] as const) {
      expect(brandesKoepfPosition({ variant }).run(state).positions.size).toBe(1);
    }
    expect(brandesKoepfPosition({}).run(state).positions.size).toBe(1);
    expect(brandesKoepfPosition({ variant: undefined }).run(state).positions.size).toBe(1);
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
    const positions = brandesKoepfPosition({ variant: 'down-left' }).run(state).positions;
    // The chain is vertical: the inner segment aligned and the crossing one did
    // not. Without the marking `d1` lands 150 to the right of `d0` instead.
    expect(required(positions.get('d1'), 'd1').x).toBe(required(positions.get('d0'), 'd0').x);
    expect(worstSpacing(state, positions)).toBe(0);
    // The same layering with nothing declared virtual has no inner segment, so
    // nothing is marked and the chain does bend. That is the arm that says the
    // assertion above is about the marking rather than about the layering.
    const unmarked = brandesKoepfPosition({ variant: 'down-left' }).run(base).positions;
    expect(required(unmarked.get('d1'), 'd1').x).not.toBe(
      required(unmarked.get('d0'), 'd0').x,
    );
  });

  /**
   * The marking walk over a gap that has TWO inner segments and something on
   * either side of both, which is the case the picture above cannot reach.
   *
   * That one has a single gap, one inner segment and two nodes per layer, so
   * the conflict window `k0` never leaves 0 and no upper endpoint is ever below
   * it. Everything the walk does with a window, with a second boundary, or with
   * the two virtuality tests is invisible there. Two chains and three layers:
   *
   * ```
   *   layer 0   u0   a0   c0   b0
   *   layer 1   x1   a1   w1   y1   b1
   *   layer 2   a2   b2
   * ```
   *
   * (Left to right is the layer's own order, so `a2` and `b2` are at positions
   * 0 and 1 of the bottom layer, not under the columns they line up with here.)
   *
   * `a0 a1 a2` and `b0 b1 b2` are dummy chains, so every link of both is an
   * inner segment, and the four other edges are each a case of their own:
   *
   * - `u0 -> y1` runs from LEFT of the first chain to between the two, so it is
   *   caught by `position < window` and by nothing else. That half of the test
   *   is what a left-biased pass cannot see, because its own alignment bound
   *   already refuses a neighbour to the left of one it used; a RIGHT-biased
   *   pass walks the layer the other way and would follow this edge happily.
   *   So the coordinates below are `down-right` ones.
   * - `u0 -> w1` gives a VIRTUAL lower node a real upper neighbour, so the walk
   *   finds no inner segment at `w1` and `w1` starts no window.
   * - `b0 -> x1` gives a REAL lower node a virtual upper neighbour, which is
   *   the mirror case: it is not an inner segment either, because an inner
   *   segment needs both ends virtual. Those two are what tell the walk's two
   *   virtuality tests apart; drop either and the window boundaries move.
   * - `c0 -> a1` puts a second inner segment on one node, which a dummy chain
   *   cannot do (a dummy has one predecessor) and which the walk resolves by
   *   taking the FIRST. Take the last and `c0 -> a1` stops being marked, `a1`
   *   follows it, and chain `a` bends.
   *
   * The assertion is the one the pass exists for: BOTH chains come out
   * straight, and every other node sits where the compaction leaves it.
   */
  it('marks around two inner segments in one gap, and both chains stay straight', () => {
    const graph = new Graph();
    const layers = [
      ['u0', 'a0', 'c0', 'b0'],
      ['x1', 'a1', 'w1', 'y1', 'b1'],
      ['a2', 'b2'],
    ];
    for (const id of layers.flat()) graph.addNode(id);
    for (const [source, target] of [
      ['a0', 'a1'],
      ['c0', 'a1'],
      ['b0', 'b1'],
      ['u0', 'y1'],
      ['u0', 'w1'],
      ['b0', 'x1'],
      ['a1', 'a2'],
      ['b1', 'b2'],
    ] as const) {
      graph.addEdge(source, target);
    }
    const base = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const state: OrderedState = {
      ...base,
      virtualNodes: new Set(['a0', 'c0', 'b0', 'a1', 'w1', 'b1', 'a2', 'b2']),
    };
    const positions = brandesKoepfPosition({ variant: 'down-right' }).run(state).positions;
    const expected = new Map([
      ['u0', -600],
      ['a0', -450],
      ['c0', -150],
      ['b0', 0],
      ['x1', -600],
      ['a1', -450],
      ['w1', -300],
      ['y1', -150],
      ['b1', 0],
      ['a2', -450],
      ['b2', 0],
    ]);
    for (const [id, x] of expected) {
      expect(required(positions.get(id), id).x, `down-right ${id}`).toBe(x);
    }
    // Said again as the property rather than as eleven numbers, because that is
    // what a reader has to be able to check: neither chain bends.
    for (const chain of [
      ['a0', 'a1', 'a2'],
      ['b0', 'b1', 'b2'],
    ]) {
      const [head, ...rest] = chain;
      const straight = required(positions.get(required(head, 'head')), 'head').x;
      for (const id of rest) {
        expect(required(positions.get(id), id).x, `${id} on its chain`).toBe(straight);
      }
    }
    expect(worstSpacing(state, positions)).toBe(0);
  });

  /**
   * A node whose FIRST median is marked, so the alignment has to try its
   * second.
   *
   * `v1` has two parents: `u0`, which is real, and `q0`, which is virtual and
   * so forms an inner segment with it. The chain `m0 m1` to their left sets the
   * conflict window past `u0`, so `u0 -> v1` is marked and `q0 -> v1` is not.
   * The left-biased downward pass therefore reads median index 0, finds it
   * marked, and takes index 1 instead.
   *
   * `z0` is a spacer and is load bearing: it pushes `q0` far enough right that
   * `q0`'s own block, not `v1`'s left neighbour, is what decides where the pair
   * lands, so aligning and not aligning give different coordinates rather than
   * the same one.
   *
   * Stop after the first median and `v1` aligns with nothing and packs against
   * `m1` at 300, which is the whole fallback going missing. It is not a corner:
   * every even-degree node whose first median is marked or blocked by the bound
   * runs it.
   */
  it('falls through to the second median when the first one is marked', () => {
    const graph = new Graph();
    const layers = [
      ['u0', 'm0', 'z0', 'q0'],
      ['m1', 'v1'],
    ];
    for (const id of layers.flat()) graph.addNode(id);
    for (const [source, target] of [
      ['m0', 'm1'],
      ['u0', 'v1'],
      ['q0', 'v1'],
    ] as const) {
      graph.addEdge(source, target);
    }
    const base = stateOf(graph, layers, () => 100, { nodeSep: 50, rankSep: 50 });
    const state: OrderedState = {
      ...base,
      virtualNodes: new Set(['m0', 'm1', 'q0', 'v1']),
    };
    const positions = brandesKoepfPosition({ variant: 'down-left' }).run(state).positions;
    // The second median, `q0`, is what `v1` ends up under. Not `u0`, which is
    // the first one and is marked, and not nothing.
    expect(required(positions.get('v1'), 'v1').x).toBe(required(positions.get('q0'), 'q0').x);
    expect(required(positions.get('v1'), 'v1').x).toBe(450);
    expect(required(positions.get('m1'), 'm1').x).toBe(required(positions.get('m0'), 'm0').x);
    expect(worstSpacing(state, positions)).toBe(0);
  });
});
