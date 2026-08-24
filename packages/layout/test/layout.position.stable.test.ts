import { smallCorpus } from '@dagr/bench';
import type { GraphSpec } from '@dagr/bench';
import { Graph } from '@dagr/graph';
import type { NodeId, Patch } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, createLayout, measureStability } from '../src/index.js';
import type { LayoutResult, OrderedState, Point, PreviousLayout, Size } from '../src/index.js';
import { brandesKoepfPosition, brandesKoepfPositionStage } from '../src/position.js';
import { defaultStages } from '../src/stages.js';

/**
 * M3.8a: the full relayout that keeps its place.
 *
 * THE CHANNEL is `PreparedState.previous.positions`, which M3.2 opened and
 * nobody read. THE RULE is that Brandes-Koepf decides a drawing up to a
 * horizontal translation and nothing in the algorithm decides which one, so a
 * warm run picks the translation that leaves the drawing where the user is
 * already looking at it rather than the one the compaction happened to reach.
 *
 * Every case here is about the SHIFT and not about the layout under it. The
 * layout is the one `layout.position.test.ts` pins, unchanged, and the two
 * facts that make this task safe are that the shift is rigid, so every
 * invariant that file asserts is preserved by construction, and that the shift
 * is zero whenever zero is as good, so a run whose drawing did not move is
 * returned byte for byte.
 */

/** An entry that has to be there, so a missing one fails as itself. */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/**
 * An `OrderedState`, which is what a position stage reads, with the previous
 * run's coordinates hanging off it.
 *
 * The same shape `layout.position.test.ts` builds, plus the one field this file
 * is about. `previousXs` is written as a map from id to x because y is not this
 * task's: the rows are stacked from `y = 0` by `rowCentres` and that anchor is
 * not a freedom anything here may spend. See the vertical section of
 * `brandesKoepfPosition`.
 */
function stateOf(
  graph: Graph,
  layers: readonly (readonly NodeId[])[],
  width: number,
  previousXs?: ReadonlyMap<NodeId, number>,
): OrderedState {
  const ranks = new Map<NodeId, number>();
  const sizes = new Map<NodeId, Size>();
  for (const [rank, layer] of layers.entries()) {
    for (const id of layer) {
      ranks.set(id, rank);
      sizes.set(id, { width, height: 40 });
    }
  }
  const state: OrderedState = {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks,
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
    layers,
  };
  if (previousXs === undefined) return state;
  return { ...state, previous: previousLayoutOf(previousXs) };
}

/**
 * A `PreviousLayout` carrying nothing but the coordinates, which is all this
 * stage reads of one.
 *
 * The other seven fields are empties for the reason `layout.warmstart.test.ts`
 * fills them that way: a stage that started reading one of them would be
 * reading a record no engine ever produces, and that is a change to catch here
 * rather than to accommodate.
 */
function previousLayoutOf(xs: ReadonlyMap<NodeId, number>): PreviousLayout {
  const positions = new Map<NodeId, Point>();
  for (const [id, x] of xs) positions.set(id, { x, y: 0 });
  return {
    sizes: new Map(),
    ranks: new Map(),
    reversedEdges: new Set(),
    virtualNodes: new Set(),
    virtualChains: new Map(),
    layers: [],
    positions,
    routes: new Map(),
  };
}

/** A graph and a layering of it, nodes numbered layer by layer. */
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

/** The witness every case that does not need its own shape runs over. */
function witness(): { graph: Graph; layers: NodeId[][] } {
  return layered(
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
}

/** The x of every node of a run, by id. */
function xsOf(positions: ReadonlyMap<NodeId, Point>): Map<NodeId, number> {
  const xs = new Map<NodeId, number>();
  for (const [id, point] of positions) xs.set(id, point.x);
  return xs;
}

/** Every x moved by `by`, which is what a drawing that only translated looks like. */
function translated(xs: ReadonlyMap<NodeId, number>, by: number): Map<NodeId, number> {
  const moved = new Map<NodeId, number>();
  for (const [id, x] of xs) moved.set(id, x + by);
  return moved;
}

describe('brandesKoepfPosition, the drawing that keeps its place', () => {
  it('draws a cold run exactly where it drew it before the channel existed', () => {
    const { graph, layers } = witness();
    const cold = brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions;
    // The channel is `previous`, and `layout()` never fills it in: only an
    // engine has a run before this one. So a caller who wants the unshifted
    // drawing already has it, which is why there is no option to turn this off.
    expect([...cold].map(([id, point]) => [id, point.x, point.y])).toEqual([
      ['n0', 75, 20],
      ['n1', 300, 20],
      ['n2', 450, 20],
      ['n3', 0, 110],
      ['n4', 150, 110],
      ['n5', 300, 110],
      ['n6', 450, 110],
      ['n7', 75, 200],
      ['n8', 375, 200],
    ]);
  });

  it('puts a drawing that only translated back where it was', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    for (const by of [1, -1, 1_000, -1_000, 0.5, 1e6]) {
      const warm = brandesKoepfPositionStage.run(
        stateOf(graph, layers, 100, translated(cold, by)),
      ).positions;
      // Exactly, and not within a tolerance: the shift is one subtraction of
      // one number that every node's displacement agrees on.
      expect(xsOf(warm)).toEqual(translated(cold, by));
    }
  });

  it('leaves the drawing alone when the run before it drew the same one', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    const warm = brandesKoepfPositionStage.run(stateOf(graph, layers, 100, cold)).positions;
    expect(xsOf(warm)).toEqual(cold);
  });

  it('leaves the drawing alone when a majority of it did not move', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    // Four of nine nodes claim to have been somewhere else, and they all claim
    // the same direction, which is the strongest a minority can be. Zero is
    // still an optimum of the total displacement, so zero is what is taken and
    // the six that were right stay exactly right.
    const previous = new Map(cold);
    for (const id of ['n0', 'n1', 'n2', 'n3']) {
      previous.set(id, required(cold.get(id), id) - 500);
    }
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      cold,
    );
  });

  it('leaves the drawing alone when the two halves disagree about which way', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    // Four left, four right, one still. No majority either way, so the interval
    // of optimal shifts straddles zero and zero is what is taken.
    const previous = new Map(cold);
    for (const id of ['n0', 'n1', 'n2', 'n3']) previous.set(id, required(cold.get(id), id) - 500);
    for (const id of ['n5', 'n6', 'n7', 'n8']) previous.set(id, required(cold.get(id), id) + 500);
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      cold,
    );
  });

  it('moves the drawing when a majority of it moved the same way', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    // Five of nine, which is the smallest majority this witness has.
    const previous = new Map(cold);
    for (const id of ['n0', 'n1', 'n2', 'n3', 'n4']) {
      previous.set(id, required(cold.get(id), id) - 500);
    }
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      translated(cold, -500),
    );
  });

  it('takes the smallest shift that is optimal, not the largest', () => {
    const { graph, layers } = layered([4], []);
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    // Three of four moved left by 100, 200 and 300, one did not move. Every
    // shift in [-200, -100] costs the same total displacement, so the rule has
    // to say which, and it says the one nearest zero.
    const previous = new Map(cold);
    previous.set('n0', required(cold.get('n0'), 'n0') - 300);
    previous.set('n1', required(cold.get('n1'), 'n1') - 200);
    previous.set('n2', required(cold.get('n2'), 'n2') - 100);
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      translated(cold, -100),
    );
  });

  it('reads only the nodes both runs hold', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    // A previous run holding nodes this one does not, all of them claiming a
    // wild displacement, next to five shared nodes that agree on 40. An id this
    // run is not placing has no displacement to contribute.
    const previous = new Map<NodeId, number>();
    for (const id of ['n0', 'n1', 'n2', 'n3', 'n4']) {
      previous.set(id, required(cold.get(id), id) - 40);
    }
    for (const id of ['gone0', 'gone1', 'gone2', 'gone3', 'gone4', 'gone5']) previous.set(id, 1e9);
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      translated(cold, -40),
    );
  });

  it('does not shift when the two runs share no node', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    const previous = new Map<NodeId, number>([['stranger', 1e9]]);
    expect(xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions)).toEqual(
      cold,
    );
    expect(
      xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100, new Map())).positions),
    ).toEqual(cold);
  });

  it('shifts the single-alignment variants too', () => {
    const { graph, layers } = witness();
    for (const variant of ['down-left', 'down-right', 'up-left', 'up-right'] as const) {
      const stage = brandesKoepfPosition({ variant });
      const cold = xsOf(stage.run(stateOf(graph, layers, 100)).positions);
      const warm = stage.run(stateOf(graph, layers, 100, translated(cold, 250))).positions;
      expect(xsOf(warm)).toEqual(translated(cold, 250));
    }
  });

  it('moves the drawing rigidly, so every distance in it is the one it had', () => {
    const { graph, layers } = witness();
    const cold = brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions;
    const previous = translated(xsOf(cold), 777);
    const warm = brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions;
    // Pairwise rather than one offset checked nine times: a rigid motion is
    // exactly the statement that every pair kept its separation, and that is
    // what carries the spacing invariant across without re-asserting it.
    for (const [left, leftPoint] of cold) {
      for (const [right, rightPoint] of cold) {
        const before = rightPoint.x - leftPoint.x;
        const after =
          required(warm.get(right), right).x - required(warm.get(left), left).x;
        expect(after).toBe(before);
      }
    }
  });

  it('leaves y alone, because the rows are anchored at the top', () => {
    const { graph, layers } = witness();
    const cold = brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions;
    const previous = translated(xsOf(cold), -3_000);
    const warm = brandesKoepfPositionStage.run(stateOf(graph, layers, 100, previous)).positions;
    for (const [id, point] of cold) expect(required(warm.get(id), id).y).toBe(point.y);
  });

  it('normalises a negative zero the shift produced', () => {
    const { graph, layers } = layered([1], []);
    const cold = xsOf(brandesKoepfPosition({ variant: 'down-right' }).run(stateOf(graph, layers, 100)).positions);
    // A lone node lands on the origin, so a shift of `0` off `-0`, or of `0`
    // off `0`, is the one arithmetic that reaches `-0` through this pass.
    const warm = brandesKoepfPosition({ variant: 'down-right' }).run(
      stateOf(graph, layers, 100, cold),
    ).positions;
    expect(Object.is(required(warm.get('n0'), 'n0').x, 0)).toBe(true);
  });

  it('gives the same previous run the same shift twice', () => {
    const { graph, layers } = witness();
    const cold = xsOf(brandesKoepfPositionStage.run(stateOf(graph, layers, 100)).positions);
    const state = stateOf(graph, layers, 100, translated(cold, 61));
    const first = [...brandesKoepfPositionStage.run(state).positions];
    expect([...brandesKoepfPositionStage.run(state).positions]).toEqual(first);
    expect([...brandesKoepfPosition().run(state).positions]).toEqual(first);
  });
});

/** A graph from a corpus spec, edges named so a patch can remove one. */
function graphOf(spec: GraphSpec): Graph {
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [index, [source, target]] of spec.edges.entries()) {
    graph.addEdge(source, target, `e${String(index)}`);
  }
  return graph;
}

/** The patch kinds the table in `brandesKoepfPosition` is measured over. */
type PatchKind = 'add-leaf' | 'add-middle' | 'remove-leaf' | 'add-edge' | 'remove-edge';

/** One relayout of the 1k corpus, and how far it moved the drawing. */
function relayoutOnce(spec: GraphSpec, kind: PatchKind, shifted: boolean): number {
  const graph = graphOf(spec);
  const position = shifted
    ? brandesKoepfPositionStage
    : {
        name: 'unshifted-brandes-koepf',
        // The stage as it was before this task: the same run with the channel
        // taken away, so the two columns of the table differ in the shift and
        // in nothing else. `previous` is set to `undefined` rather than deleted
        // because the field is declared `?: T | undefined` under this repo's
        // `exactOptionalPropertyTypes`, which is exactly the shape that makes
        // the two spellings interchangeable here.
        run(input: OrderedState) {
          return brandesKoepfPositionStage.run({ ...input, previous: undefined });
        },
      };
  const engine = createLayout({ stages: { ...defaultStages, position } });
  const before: LayoutResult = engine.run(graph);
  let captured: Patch | undefined;
  const stop = graph.subscribe((patch) => {
    captured = patch;
  });
  const anchor = required(spec.nodes[Math.floor(spec.nodes.length / 2)], 'anchor');
  const other = required(spec.nodes[Math.floor(spec.nodes.length / 2) + 7], 'second anchor');
  graph.batch(() => {
    if (kind === 'add-leaf') {
      graph.addNode('added');
      graph.addEdge(anchor, 'added', 'e-added');
    } else if (kind === 'add-middle') {
      graph.addNode('added');
      graph.addEdge(anchor, 'added', 'e-added-in');
      graph.addEdge('added', other, 'e-added-out');
    } else if (kind === 'remove-leaf') {
      graph.removeNode(anchor);
    } else if (kind === 'add-edge') {
      graph.addEdge(anchor, other, 'e-added');
    } else {
      graph.removeEdge('e0');
    }
  });
  stop();
  const after = engine.relayout(required(captured, 'patch'));
  return measureStability(before, after.result, { epsilon: 1e-9 }).nodes.meanDisplacement;
}

describe('brandesKoepfPosition, what the shift is worth on a corpus', () => {
  /**
   * The measurement the M3.8 decision was taken on, as a test rather than as a
   * number in a document nothing checks.
   *
   * The ceilings are the shifted column of the table in `brandesKoepfPosition`,
   * rounded up, and the assertion beside each is that the unshifted stage is
   * over it. A ceiling alone would pass on a stage that had never read the
   * channel, since it would also pass if the drawing simply got more stable for
   * some other reason; the pair is what pins the shift as the cause. See the
   * vacuous-guard rule this repo has kept since M3.4.
   */
  it.each([
    { kind: 'add-edge' as const, ceiling: 14_000, floor: 100_000 },
    { kind: 'add-middle' as const, ceiling: 12_500, floor: 13_500 },
    { kind: 'remove-leaf' as const, ceiling: 1_200, floor: 1_500 },
  ])('moves the 1k corpus less on a $kind patch', ({ kind, ceiling, floor }, ...rest) => {
    void rest;
    const spec = smallCorpus();
    expect(relayoutOnce(spec, kind, true)).toBeLessThanOrEqual(ceiling);
    expect(relayoutOnce(spec, kind, false)).toBeGreaterThanOrEqual(floor);
  });

  it.each([{ kind: 'add-leaf' as const }, { kind: 'remove-edge' as const }])(
    'takes no shift at all on a $kind patch, which changes no layering',
    ({ kind }) => {
      const spec = smallCorpus();
      // The two patches that leave every surviving node's rank and slot where
      // they were. The drawing did not translate, so the optimal shift is zero
      // and the two columns are the same number rather than a smaller one.
      expect(relayoutOnce(spec, kind, true)).toBe(relayoutOnce(spec, kind, false));
    },
  );
});
