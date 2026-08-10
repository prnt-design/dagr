import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
import { forEachSegment } from './segments.js';
import type { OrderStage, RankedState } from './types.js';

/**
 * Crossing reduction: the metric first, then the stage that minimises it.
 *
 * The metric is {@link countCrossings} and it is exported, because a number
 * nobody outside this file can compute is a number nobody can hold this stage
 * to. M2.6 commits a regression corpus against it, M3.4 reports it as a quality
 * signal, and both need the same counter this stage optimises rather than a
 * second one that might disagree.
 */

/** The sweep budget a stage built with no `maxSweeps` runs to. See D5 below. */
const DEFAULT_MAX_SWEEPS = 4;

/**
 * The transpose budget a stage built with no `maxTransposePasses` runs to.
 *
 * That this is 16 and {@link DEFAULT_MAX_SWEEPS} is 4 IS A MEASUREMENT. Both
 * were 8 until M2.6c and that WAS a coincidence, stated as one here for two
 * milestones. They bound different loops, they were re-derived independently
 * over the drawing this stage sees now that M2.4b's chains are read, and they
 * came apart: the sweeps have nothing left to buy past 4 and the pass is still
 * buying at 16. See the transpose section of {@link barycenterOrder} for the
 * curve, and the sweeps section for the other half of the same trade.
 */
const DEFAULT_MAX_TRANSPOSE_PASSES = 16;

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node number this file minted. Mirrors the guard in
 * `simplex.ts` for the same reason: under `noUncheckedIndexedAccess` the
 * alternative is arithmetic on `undefined` that quietly reads as `NaN`, and a
 * `NaN` barycenter sorts unpredictably instead of failing.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/** The id of a node number this file minted. Absence is a bug here, see above. */
function idAt(ids: readonly NodeId[], number: number): NodeId {
  const id = ids[number];
  if (id === undefined) throw new InternalLayoutError(`no node numbered ${String(number)}`);
  return id;
}

/** A rank that must be present. Absence is a runner bug, as in `stages.ts`. */
function requireRank(ranks: ReadonlyMap<NodeId, number>, id: NodeId): number {
  const rank = ranks.get(id);
  if (rank === undefined) throw new InternalLayoutError(`node "${id}" was never ranked`);
  return rank;
}

/**
 * A graph and a layering of it: the layers its nodes are drawn in, top to
 * bottom and each left to right.
 *
 * Named for what it is rather than for who takes it, because more than one
 * thing takes it. {@link countCrossings} scores one, M2.6's transpose pass
 * refines one, and M3.4 reports the crossings of one, and a type named after
 * the first of those would leave the others either borrowing a name that lies
 * or minting a structural twin the compiler cannot tell apart.
 *
 * An `OrderedState` satisfies this structurally, so a caller holding one passes
 * it straight in. `ranks` is deliberately not part of it: which pairs of layers
 * are adjacent is decided by layer INDEX alone, and taking a second source of
 * the same fact would only give the two something to disagree about.
 */
export interface Layering {
  readonly graph: Graph;
  readonly layers: readonly (readonly NodeId[])[];

  /**
   * The chains the rank stage split each long edge into, if the drawing has
   * any. Omitted and an empty map mean the same thing: the drawing's segments
   * are its edges.
   *
   * Optional so that every call written before chains were consumed keeps
   * compiling and keeps meaning what it meant. What it costs to omit it on a
   * drawing that HAS chains is that a long edge is counted as nothing rather
   * than as its pieces, which is the pre-M2.4b limit and is a real
   * undercount: on the 10k bench corpus the counter sees 13,131 of 40,000
   * edges without it and 214,222 segments with it. Pass it whenever the rank
   * stage produced one.
   */
  readonly virtualChains?: ReadonlyMap<EdgeId, readonly NodeId[]> | undefined;
}

/**
 * The chains of a drawing that has none, shared rather than rebuilt per call.
 * `countCrossings` is called once per sweep per stage run, so an empty map a
 * call allocates and throws away is an allocation per sweep for nothing.
 */
const EMPTY_CHAINS: ReadonlyMap<EdgeId, readonly NodeId[]> = new Map();

/** Where a node sits in a drawing: which layer, and where in it. */
interface Place {
  readonly layer: number;
  readonly index: number;
}

/**
 * Counts inversions of the lower endpoints of one gap's segments, which is that
 * gap's crossing count.
 *
 * `encoded` holds one entry per segment, `upper * stride + lower`, and is
 * SORTED, so reading it in order is reading the segments left to right by their
 * upper endpoint. Two segments cross exactly when the later one in that order
 * ends strictly further left, so the crossings are the inversions of the lower
 * endpoints, and the accumulator tree counts them in O(n log n) rather than the
 * O(n^2) of comparing every pair.
 *
 * The tree is Barth, Junger and Mutzel's: a complete binary tree over the lower
 * layer's indices, held as an array, with `firstLeaf` the offset of index 0's
 * leaf. Adding a segment walks from its leaf to the root incrementing counts,
 * and every step up from a LEFT child adds the right sibling's total, which is
 * exactly the segments already placed that end strictly to the right of this
 * one. Encoding the two endpoints into one number is what lets the sort be a
 * numeric `TypedArray.sort` with no comparator function, and the sort is most
 * of what scoring a layering costs.
 *
 * The encoding is a `Float64Array` rather than an `Int32Array` because it
 * multiplies two indices: 32 bits overflows at layers of about 46,000 nodes,
 * and a double holds every product two layer indices can make on a graph that
 * fits in memory.
 *
 * `tree` is supplied by the caller and only has to be big enough: the sweeps
 * score a layering once per sweep and reuse one buffer for every gap of every
 * one of them.
 */
function gapCrossings(encoded: Float64Array, stride: number, tree: Int32Array): number {
  if (encoded.length === 0) return 0;
  let firstLeaf = 1;
  while (firstLeaf < stride) firstLeaf *= 2;
  tree.fill(0, 0, 2 * firstLeaf - 1);
  firstLeaf -= 1;
  let crossings = 0;
  for (const value of encoded) {
    let index = (value % stride) + firstLeaf;
    tree[index] = at(tree, index) + 1;
    while (index > 0) {
      // A left child has an odd array index and its right sibling is the next
      // slot. Everything counted there was placed earlier and ends further
      // right, so every one of those segments crosses this one.
      if (index % 2 === 1) crossings += at(tree, index + 1);
      index = (index - 1) >> 1;
      tree[index] = at(tree, index) + 1;
    }
  }
  return crossings;
}

/** The accumulator tree size that covers a lower layer of `stride` nodes. */
function treeSizeFor(stride: number): number {
  let firstLeaf = 1;
  while (firstLeaf < stride) firstLeaf *= 2;
  return 2 * firstLeaf - 1;
}

/**
 * How many pairs of edges cross in a drawing of `layers`.
 *
 * **What it counts.** A crossing is only defined between two segments joining
 * the same pair of ADJACENT layers, and what a SEGMENT is comes from
 * `segments.ts`: an edge the rank stage split is drawn as its chain and
 * contributes one segment per gap it crosses, an edge with no chain is drawn as
 * itself. So on a drawing whose long edges were split this sees the whole graph
 * bar its self loops, both benchmark corpora included, and a self loop stays
 * invisible because it spans no rank for a chain to split.
 *
 * On a drawing with NO chains it sees only the edges whose endpoints happen to
 * land in adjacent layers, which under the default ranker is 1,513 of the 1k
 * bench corpus's 4,000 and 13,131 of the 10k's 40,000. That was the honest
 * limit of this metric until the chains were consumed, and it is still what a
 * caller gets who passes `layers` without `virtualChains`, so pass them: the
 * two answers differ by more than an order of magnitude in segment count.
 *
 * Direction is not consulted. An edge the ranker reversed still joins the same
 * two layers and still crosses whatever it crosses, so a segment runs from the
 * endpoint in the upper layer to the endpoint in the lower one whichever way
 * the caller authored it.
 *
 * Two segments that share an endpoint touch rather than cross, and two parallel
 * edges lie on top of each other rather than crossing.
 *
 * An id no layer mentions is skipped rather than rejected: this is a metric
 * over the drawing it was handed, and a node no layer holds is not drawn. The
 * pipeline's own check for that is `checkOrdered`, which runs at the order
 * stage's boundary and names the stage that dropped the node.
 *
 * O(E log V), not the O(E^2) of comparing every pair of segments.
 */
export function countCrossings(input: Layering): number {
  const places = new Map<NodeId, Place>();
  for (const [layer, ids] of input.layers.entries()) {
    for (const [index, id] of ids.entries()) places.set(id, { layer, index });
  }
  // One list per gap that has a segment in it, so a 200-layer drawing whose
  // edges all sit in one gap allocates one array here rather than 199.
  const gaps = new Map<number, number[]>();
  const chains = input.virtualChains ?? EMPTY_CHAINS;
  forEachSegment(input.graph, chains, (fromId, toId) => {
    const from = places.get(fromId);
    const to = places.get(toId);
    if (from === undefined || to === undefined) return;
    if (Math.abs(from.layer - to.layer) !== 1) return;
    const gap = Math.min(from.layer, to.layer);
    const [upper, lower] = from.layer < to.layer ? [from, to] : [to, from];
    const stride = input.layers[gap + 1]?.length ?? 0;
    const encoded = upper.index * stride + lower.index;
    const segments = gaps.get(gap);
    if (segments === undefined) gaps.set(gap, [encoded]);
    else segments.push(encoded);
  });
  let crossings = 0;
  for (const [gap, segments] of gaps) {
    const stride = input.layers[gap + 1]?.length ?? 0;
    if (stride === 0) continue;
    const tree = new Int32Array(treeSizeFor(stride));
    crossings += gapCrossings(Float64Array.from(segments).sort(), stride, tree);
  }
  return crossings;
}

/**
 * What a caller may say about a barycenter ordering run.
 *
 * Both are declared `?: T | undefined` rather than `?: T`, which under this
 * repo's `exactOptionalPropertyTypes` are different types: the second rejects
 * an explicitly `undefined` value, and that is exactly what a call site has on
 * the first run of a session, when there is no previous layering to hand over.
 * `NetworkSimplexOptions` settled the same question the same way.
 */
export interface BarycenterOrderOptions {
  /**
   * How many sweeps the stage may run. Defaults to 4. Zero is legal and means
   * "seed only": build the starting permutation and return it.
   *
   * It bounds the SWEEPS and nothing else, the way `maxIterations` bounds
   * pivots only in `simplex.ts`. The seed walk and the crossing count after
   * each sweep are not sweeps and are not bounded by it.
   *
   * @throws {InvalidConfigError} when it is not a whole number of sweeps that
   * is zero or greater. Checked when the stage is built rather than when it
   * runs, so a bad budget fails at the call that named it.
   * `Number.POSITIVE_INFINITY` is rejected too, unlike `maxIterations`, and the
   * asymmetry is deliberate. There is nothing here for an unbounded run to
   * converge to: `maxIterations` bounds a solver that stops at an optimality
   * condition, and these sweeps have none, so "as many as it takes" has no
   * meaning to give a caller. The stop that does exist is a heuristic and a
   * sweep is cheap, so a number is the honest way to ask for more.
   */
  readonly maxSweeps?: number | undefined;

  /**
   * How many transpose passes the stage may run over the layering the sweeps
   * settled on. Defaults to 16. Zero is legal and means no transpose at all.
   *
   * It bounds PASSES, exactly as `maxSweeps` bounds sweeps: one pass is one
   * walk over every adjacent pair of every layer, and the loop stops early when
   * a pass makes no strictly improving swap. `Number.POSITIVE_INFINITY` is
   * rejected for the same reason it is on `maxSweeps`, and here there is a
   * second one: the pass takes zero-delta swaps, so an unbounded loop is not
   * merely unmotivated, it is a way to ask for a run that has no reason to end.
   *
   * @throws {InvalidConfigError} when it is not a whole number of passes that
   * is zero or greater. Checked when the stage is built rather than when it
   * runs, so a bad budget fails at the call that named it.
   */
  readonly maxTransposePasses?: number | undefined;

  /**
   * A previous run's layers to start from. A HINT, never trusted: see the warm
   * start section of {@link barycenterOrder}.
   */
  readonly initialOrder?: readonly (readonly NodeId[])[] | undefined;
}

/**
 * The budget, checked at the call that named it: a whole number of sweeps that
 * is not negative.
 */
function resolveBudget(maxSweeps: number | undefined): number {
  if (maxSweeps === undefined) return DEFAULT_MAX_SWEEPS;
  if (!Number.isInteger(maxSweeps) || maxSweeps < 0) {
    throw new InvalidConfigError(
      'maxSweeps',
      maxSweeps,
      'option',
      'a whole number of sweeps that is zero or greater',
    );
  }
  return maxSweeps;
}

/**
 * The transpose budget, checked at the call that named it: a whole number of
 * passes that is not negative. The same rule as `maxSweeps` above, written out
 * beside it rather than folded into a shared helper, because the two fields
 * differ in the noun they count and the message quotes it.
 */
function resolveTransposeBudget(maxTransposePasses: number | undefined): number {
  if (maxTransposePasses === undefined) return DEFAULT_MAX_TRANSPOSE_PASSES;
  if (!Number.isInteger(maxTransposePasses) || maxTransposePasses < 0) {
    throw new InvalidConfigError(
      'maxTransposePasses',
      maxTransposePasses,
      'option',
      'a whole number of passes that is zero or greater',
    );
  }
  return maxTransposePasses;
}

/**
 * The whole problem as flat arrays: who is in which layer, who neighbours whom
 * one layer up and one layer down, and which segments sit in which gap.
 *
 * Built once per run and never rebuilt. Everything after this reads node
 * NUMBERS, so no sweep touches a string, a `Map`, or the graph: the roadmap's
 * worry about this stage churning adjacency arrays (every `@dagr/graph`
 * adjacency query returns a fresh one) is answered by asking the graph nothing
 * after this function returns.
 */
interface OrderIndex {
  /** Node number to id, in roster order: graph nodes, then virtual ids. */
  readonly ids: readonly NodeId[];
  /** Node number to layer index, layers being the distinct ranks sorted. */
  readonly layerOf: Int32Array;
  readonly layerCount: number;
  /** Adjacent-layer out- and in-neighbours, in edge insertion order. */
  readonly outStart: Int32Array;
  readonly outNext: Int32Array;
  readonly inStart: Int32Array;
  readonly inNext: Int32Array;
  /** Neighbours one layer up, and one layer down, whichever way the edge runs. */
  readonly upStart: Int32Array;
  readonly upNext: Int32Array;
  readonly downStart: Int32Array;
  readonly downNext: Int32Array;
  /** Segments grouped by gap: `gapStart[g]` to `gapStart[g + 1]`. */
  readonly gapStart: Int32Array;
  readonly segUpper: Int32Array;
  readonly segLower: Int32Array;
}

/** A CSR adjacency from a list of (owner, neighbour) pairs, order preserved. */
function compress(
  owner: readonly number[],
  neighbour: readonly number[],
  count: number,
): { start: Int32Array; next: Int32Array } {
  const start = new Int32Array(count + 1);
  for (const node of owner) start[node + 1] = at(start, node + 1) + 1;
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node + 1) + at(start, node);
  }
  const cursor = start.slice(0, count);
  const next = new Int32Array(owner.length);
  for (const [index, node] of owner.entries()) {
    next[at(cursor, node)] = at(neighbour, index);
    cursor[node] = at(cursor, node) + 1;
  }
  return { start, next };
}

function buildIndex(input: RankedState): OrderIndex {
  const ids: NodeId[] = [];
  const numberOf = new Map<NodeId, number>();
  for (const node of input.graph.nodes()) {
    numberOf.set(node.id, ids.length);
    ids.push(node.id);
  }
  for (const id of input.virtualNodes) {
    if (numberOf.has(id)) continue;
    numberOf.set(id, ids.length);
    ids.push(id);
  }
  const count = ids.length;

  // Layers are the DISTINCT RANKS SORTED, not the ranks themselves. A ranker is
  // allowed to leave gaps or start below zero, every order stage this package
  // has shipped has said so, and adjacency here is adjacency of layers: two
  // ranks with nothing between them are one gap apart however far apart the
  // numbers are.
  const rankOf = new Float64Array(count);
  const distinct = new Set<number>();
  for (const [number, id] of ids.entries()) {
    const rank = requireRank(input.ranks, id);
    rankOf[number] = rank;
    distinct.add(rank);
  }
  const sorted = [...distinct].sort((left, right) => left - right);
  const layerIndexOf = new Map<number, number>();
  for (const [index, rank] of sorted.entries()) layerIndexOf.set(rank, index);
  const layerOf = new Int32Array(count);
  for (let number = 0; number < count; number += 1) {
    layerOf[number] = layerIndexOf.get(at(rankOf, number)) ?? 0;
  }

  // One pass over the drawing's SEGMENTS, keeping only the ones that join
  // adjacent layers. A self loop puts both endpoints on one layer and is
  // dropped by the same test, which is what "a self loop spans zero ranks"
  // comes to here.
  //
  // Segments and not edges, and that distinction is the whole of what
  // `virtualChains` buys: an edge the ranker split is drawn as its chain, so it
  // contributes one segment per gap it crosses instead of contributing nothing
  // at all. Before those chains were read here, a long edge failed the adjacent
  // layer test and was invisible to the sweeps and to the counter alike, which
  // is the limit `countCrossings` still documents for a graph nobody split.
  // `segments.ts` holds the rule, because this file, that counter and
  // `position.ts` all need the same answer.
  const from: number[] = [];
  const to: number[] = [];
  const segUpper: number[] = [];
  const segLower: number[] = [];
  const segGap: number[] = [];
  forEachSegment(input.graph, input.virtualChains, (fromId, toId) => {
    const source = numberOf.get(fromId);
    const target = numberOf.get(toId);
    if (source === undefined || target === undefined) return;
    const sourceLayer = at(layerOf, source);
    const targetLayer = at(layerOf, target);
    if (Math.abs(sourceLayer - targetLayer) !== 1) return;
    from.push(source);
    to.push(target);
    const down = sourceLayer < targetLayer;
    segUpper.push(down ? source : target);
    segLower.push(down ? target : source);
    segGap.push(Math.min(sourceLayer, targetLayer));
  });

  const out = compress(from, to, count);
  const incoming = compress(to, from, count);
  // Up and down are about LAYERS, not about direction: an edge the ranker
  // reversed runs from a lower layer to a higher one, and its source is then
  // the neighbour below rather than above.
  const up = compress(segLower, segUpper, count);
  const down = compress(segUpper, segLower, count);

  const layerCount = sorted.length;
  const gapStart = new Int32Array(Math.max(layerCount, 1));
  for (const gap of segGap) gapStart[gap + 1] = at(gapStart, gap + 1) + 1;
  for (let gap = 1; gap < gapStart.length; gap += 1) {
    gapStart[gap] = at(gapStart, gap) + at(gapStart, gap - 1);
  }
  const cursor = gapStart.slice(0, Math.max(layerCount - 1, 0));
  const upperByGap = new Int32Array(segGap.length);
  const lowerByGap = new Int32Array(segGap.length);
  for (const [index, gap] of segGap.entries()) {
    const slot = at(cursor, gap);
    upperByGap[slot] = at(segUpper, index);
    lowerByGap[slot] = at(segLower, index);
    cursor[gap] = slot + 1;
  }

  return {
    ids,
    layerOf,
    layerCount,
    outStart: out.start,
    outNext: out.next,
    inStart: incoming.start,
    inNext: incoming.next,
    upStart: up.start,
    upNext: up.next,
    downStart: down.start,
    downNext: down.next,
    gapStart,
    segUpper: upperByGap,
    segLower: lowerByGap,
  };
}

/**
 * The two adjacency directions the transpose delta reads, as CSR arrays.
 *
 * A named interface rather than a `Pick` of {@link OrderIndex} because it is
 * the more readable contract: it says what the four arrays are for, which a
 * structural `Pick` at the call site does not. `OrderIndex` satisfies it
 * structurally, so the stage passes its own index straight in.
 *
 * NOT because the compiler forces it. The earlier version of this comment
 * claimed a signature naming a type this module kept to itself would not
 * survive declaration emit, and that is false: TypeScript emits a non-exported
 * local interface into the `.d.ts` when an exported signature references it,
 * checked with `tsc --declaration` on exactly that shape. TS4023 bites on a
 * name IMPORTED but not re-exported, which is a different case. Recorded so
 * that nobody adds a named type here believing they had no choice.
 */
export interface TransposeAdjacency {
  readonly upStart: Int32Array;
  readonly upNext: Int32Array;
  readonly downStart: Int32Array;
  readonly downNext: Int32Array;
}

/**
 * What swapping the adjacent pair (`before`, `after`) costs on one side of the
 * layer, in crossings, as a signed change.
 *
 * `before` sits immediately left of `after`, so for a pair of neighbours `a` of
 * `before` and `b` of `after` in the fixed layer, the two segments cross NOW
 * exactly when `a` sits right of `b`, and cross AFTER THE SWAP exactly when `a`
 * sits left of `b`. Equal positions are the same node, which is two segments
 * sharing an endpoint: they touch either way and contribute nothing. So the
 * side contributes the number of pairs with `a` left of `b` minus the number
 * with `a` right of `b`, and no other pair of segments in the gap can change,
 * because every other segment keeps both its endpoints where they were.
 *
 * O(deg(before) * deg(after)) against the O(E log V) of rescoring the drawing,
 * which is the whole reason the pass is affordable. It is also EXACT rather
 * than an estimate, and the test suite holds it to that by running the pass
 * against a transpose that decides every swap by a full rescore.
 */
function sideDelta(
  start: Int32Array,
  next: Int32Array,
  position: Int32Array,
  before: number,
  after: number,
): number {
  const leftFirst = at(start, before);
  const leftLast = at(start, before + 1);
  const rightFirst = at(start, after);
  const rightLast = at(start, after + 1);
  let delta = 0;
  for (let entry = leftFirst; entry < leftLast; entry += 1) {
    const left = at(position, at(next, entry));
    for (let other = rightFirst; other < rightLast; other += 1) {
      const right = at(position, at(next, other));
      if (left < right) delta += 1;
      else if (left > right) delta -= 1;
    }
  }
  return delta;
}

/**
 * The transpose refinement pass, run over `layers` in place, and the number of
 * passes it took.
 *
 * One pass walks every layer in index order and every layer left to right,
 * swapping the pair at each adjacent slot when the swap costs nothing or saves
 * something. `position` is read for every delta and updated with every swap, so
 * a caller handing in a layering has to hand in the positions OF THAT LAYERING;
 * see the transpose section of {@link barycenterOrder} for the trap that is.
 *
 * The loop ends after a pass that made no STRICTLY IMPROVING swap, or when
 * `maxPasses` is spent. Gating on strictly improving swaps is a requirement and
 * not a refinement: zero-delta swaps are taken (D3), and a zero-delta swap
 * leaves a zero-delta swap available, so a loop that continued whenever
 * anything moved would swap one pair back and forth forever. Two nodes sharing
 * a single neighbour are enough to produce it.
 *
 * Exported for the test suite and NOT from `index.ts`. Two of the claims made
 * about it, that the delta is exact and that a pass never raises the crossing
 * count, are claims about the pass rather than about the stage, and the stage
 * keeps the best layering it has seen, so it would quietly discard the evidence
 * of either one failing.
 */
/**
 * Whether either adjacent layer has anything to say about where this node goes.
 *
 * An empty CSR range on BOTH sides means no segment in either gap, which is the
 * same condition `reorder` reads when it pins a node rather than sorting it.
 */
function anchored(adjacency: TransposeAdjacency, node: number): boolean {
  return (
    at(adjacency.upStart, node) !== at(adjacency.upStart, node + 1) ||
    at(adjacency.downStart, node) !== at(adjacency.downStart, node + 1)
  );
}

export function transposeLayers(
  layers: readonly number[][],
  position: Int32Array,
  adjacency: TransposeAdjacency,
  maxPasses: number,
): number {
  let passes = 0;
  while (passes < maxPasses) {
    passes += 1;
    let improved = false;
    for (const layer of layers) {
      for (let slot = 0; slot + 1 < layer.length; slot += 1) {
        const before = at(layer, slot);
        const after = at(layer, slot + 1);
        // A node neither adjacent layer says anything about KEEPS ITS INDEX,
        // which is the rule `reorder` already keeps and this pass must not
        // quietly reverse. It matters here only because of the tie rule: such a
        // node carries no segment in either gap, so both sides of its delta are
        // zero, so every pair containing one would otherwise be swapped
        // unconditionally and drift it a slot per pass in a fixed direction.
        // Crossing-neutral, and still wrong: the warm start hands the drifted
        // order back in, so it compounds across re-layouts.
        if (!anchored(adjacency, before) || !anchored(adjacency, after)) continue;
        const delta =
          sideDelta(adjacency.upStart, adjacency.upNext, position, before, after) +
          sideDelta(adjacency.downStart, adjacency.downNext, position, before, after);
        if (delta > 0) continue;
        layer[slot] = after;
        layer[slot + 1] = before;
        position[after] = slot;
        position[before] = slot + 1;
        if (delta < 0) improved = true;
      }
    }
    if (!improved) break;
  }
  return passes;
}

/**
 * The seed permutation: a connected walk over adjacent-layer edges.
 *
 * The roster is iterated in its own order, and each node it reaches that has
 * not been seen starts a depth-first walk that may only step along an edge
 * whose two endpoints sit in adjacent layers, in either direction. Every node
 * is appended to its own layer the first time it is visited, so a layer's order
 * is the order the walk found its members in, and a node no such edge reaches
 * is appended when the outer loop arrives at it.
 *
 * Neighbours are taken in the order `outEdges` gives them and then the order
 * `inEdges` does, which is edge insertion order in both cases, so the walk is a
 * function of the graph and not of anything about this run. The stack marks a
 * node on the way OUT rather than on the way in, and pushes its neighbours in
 * reverse, which is what makes it visit them in the same order a recursive walk
 * would.
 *
 * See {@link barycenterOrder} for why this seed and not another one.
 */
function seedWalk(index: OrderIndex): number[][] {
  const count = index.ids.length;
  const layers: number[][] = Array.from({ length: index.layerCount }, () => []);
  const visited = new Uint8Array(count);
  const stack: number[] = [];
  for (let seed = 0; seed < count; seed += 1) {
    if (at(visited, seed) === 1) continue;
    stack.push(seed);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined || at(visited, node) === 1) continue;
      visited[node] = 1;
      layers[at(index.layerOf, node)]?.push(node);
      for (let slot = at(index.inStart, node + 1) - 1; slot >= at(index.inStart, node); slot -= 1) {
        stack.push(at(index.inNext, slot));
      }
      for (let slot = at(index.outStart, node + 1) - 1; slot >= at(index.outStart, node); slot -= 1) {
        stack.push(at(index.outNext, slot));
      }
    }
  }
  return layers;
}

/**
 * Reorders each layer by a hint, in place, dropping everything unusable.
 *
 * An id's key is its index WITHIN ITS OWN HINT LAYER, first occurrence winning
 * and a repeat consuming nothing. Then each layer of the seed is reordered by
 * that key, and only the nodes the hint names move: they are collected with the
 * indices they hold, sorted, and written back into those same indices. A node
 * the hint does not name stays exactly where the walk put it, which is this
 * stage's own rule for silence stated once rather than twice: a node the fixed
 * layer has no opinion about does not move either, see {@link barycenterOrder}.
 * The alternative, keying an unnamed node after everything named, reads silence
 * as the assertion "put it last", and gets the M3.6 case it exists for exactly
 * backwards: the dominant warm start is a patch that ADDED nodes, so the hint
 * names every old node and no new one, and sweeping the new ones into a cluster
 * at one end of the layer throws away the walk that actually saw their edges.
 *
 * Keying within the hint layer rather than within the flattened hint is what
 * keeps the key about IDENTITY rather than position, which is what M3.6
 * requires of a warm start. Two ids listed in different hint layers say nothing
 * about each other, so when they land in one layer here they TIE, and the tie
 * falls through to the walk order, which means structure decides. A global
 * index would instead let a node whose rank rose carry a small key to the front
 * of its new layer and a node whose rank fell go to the back, which is the
 * `(rank, index)` coupling M3.6 names as the obvious and incorrect approach.
 *
 * The tie falls through to the walk with no tiebreaking term to make it: `named`
 * is collected in slot order and `Array.prototype.sort` has been stable since
 * ES2019, so equal keys come out in the order they went in, which is the walk's.
 * A second term comparing the walk index would be that same order written twice.
 *
 * An id the roster does not hold has no node to be a position for and is
 * ignored, and an id the hint puts in the wrong layer only ever contributes its
 * position among the ids of its own hint layer that landed in the same real
 * layer, because the reordering happens inside a layer built from the ranks. So
 * nothing here can produce an invalid layering, which is what makes "never
 * trusted" a property rather than a promise.
 */
function applyHint(
  layers: number[][],
  ids: readonly NodeId[],
  hint: readonly (readonly NodeId[])[],
): void {
  const hintIndex = new Map<NodeId, number>();
  for (const layer of hint) {
    let next = 0;
    for (const id of layer) {
      if (hintIndex.has(id)) continue;
      hintIndex.set(id, next);
      next += 1;
    }
  }
  if (hintIndex.size === 0) return;
  // Named by node number, the way the sweeps hold a barycenter, so that the
  // comparator reads two array entries rather than two map lookups.
  const key = new Int32Array(ids.length);
  const named: number[] = [];
  const slots: number[] = [];
  for (const layer of layers) {
    named.length = 0;
    slots.length = 0;
    for (const [slot, node] of layer.entries()) {
      const position = hintIndex.get(idAt(ids, node));
      if (position === undefined) continue;
      key[node] = position;
      named.push(node);
      slots.push(slot);
    }
    if (named.length < 2) continue;
    named.sort((left, right) => at(key, left) - at(key, right));
    for (const [rank, node] of named.entries()) layer[at(slots, rank)] = node;
  }
}

/**
 * Builds an order stage that reduces edge crossings by barycenter sweeps.
 *
 * `barycenterOrderStage` is this with no options, and is what to reach for
 * unless a run needs a warm start or a different sweep budget. It is what
 * `defaultStages.order` points at, so a run that names no order stage gets it;
 * what that costs and what it buys is the last section here.
 *
 * ## The seed, which is the part M3.6 warm starts from
 *
 * Barycenter sweeps are sensitive to where they start, so the starting
 * permutation is a decision rather than an implementation detail, and it is
 * this: a connected DEPTH-FIRST WALK over adjacent-layer edges. See
 * {@link seedWalk} for the rule itself. It is not the roster order the stage
 * this one replaced as the default lays out.
 *
 * Measured on the bench corpora, crossings after 8 sweeps, lower is better:
 *
 * | seed                                 | 1k    | 10k    |
 * | ------------------------------------ | ----- | ------ |
 * | roster order (`insertionOrderStage`) | 3,943 | 54,744 |
 * | walk over adjacent-layer edges       | 3,605 | 35,114 |
 * | walk over all edges                  | 3,459 | 38,152 |
 *
 * and before any sweep runs: the adjacent-layer walk 7,933 and 94,991, the
 * all-edges walk 9,722 and 191,023. Roster order's pair is the `crossings
 * before` column of the trade section below, quoted there rather than twice.
 *
 * The adjacent-layer walk is chosen over the all-edges walk for two reasons. It
 * wins the 10k by 8.0% and loses the 1k by 4.2%, and the 10k is the corpus
 * every later milestone commits against. And the two walks COINCIDE now that
 * every long edge is split into a chain and the chains are read here, because
 * every segment then spans exactly one layer and the two rules have the same
 * segments to walk. So choosing the adjacent-layer rule turned out to be
 * choosing the behaviour this stage has anyway, which is what the argument
 * predicted. The three counts in the table above predate that and predate
 * M2.2c: they are the measurement that chose the seed, a comparison between
 * three columns rather than a level, and the level is in
 * `test/layout.order.test.ts`.
 *
 * The hypothesis that was refuted is the interesting part, and it was the
 * all-edges walk's: the seed is the only place a long edge can influence this
 * stage at all, since neither the sweeps nor the counter can see one, so
 * feeding the walk every edge looked like the way to spend that one chance. It
 * loses. A start built from edges the sweeps cannot see is worth less than one
 * built from the edges they can.
 *
 * ## The sort key: barycenter, then median
 *
 * A node's barycenter is the arithmetic mean of its neighbours' positions in
 * the fixed layer. Ties break on the median of the same positions, and a node
 * both keys tie on keeps its position relative to the other: the nodes to sort
 * are collected in index order and `Array.prototype.sort` has been stable since
 * ES2019, so a third term comparing their current indices would decide nothing
 * the first two had not already left in that order.
 *
 * That order of the two keys is measured rather than assumed, and the measurement
 * is close enough that it decides nothing on its own. Median first with the
 * barycenter as the tiebreak splits the four seed-and-corpus combinations two
 * and two: it is worse on the 1k from the all-edges walk (3,955 against 3,459)
 * and worse on the 10k from the adjacent-layer walk (35,396 against 35,114),
 * and better on the other two (1k adjacent 3,589 against 3,605, 10k all-edges
 * 37,530 against 38,152). What breaks the tie is the same thing that breaks it
 * in the seed decision: barycenter first wins the 10k from the walk this stage
 * actually uses, by 0.8%, and the 10k is the corpus every later milestone
 * commits against. Against roster order, which is not this stage's seed but is
 * the third data point, barycenter first wins both (3,943 against 4,172 and
 * 54,744 against 56,328).
 *
 * ## A node the fixed layer says nothing about keeps its index
 *
 * A node with no neighbour at all in the fixed layer is PINNED at its current
 * index, and the nodes that do have neighbours are sorted among the indices
 * left over.
 *
 * This was measured against the alternative, which is to give an unanchored node
 * a key equal to its current index rescaled into the fixed layer's index space
 * so that everything moves. On the two seeds this stage does not use it is a
 * near wash, and pinning is ahead in three of those four combinations (1k
 * all-edges walk 3,459 against 3,557 and roster order 3,943 against 3,992; 10k
 * all-edges walk 38,152 against 38,839, and behind at 54,744 against 54,502 for
 * roster order). On the seed this stage does use it is not a wash on the corpus
 * that counts: 3,605 against 3,621 on the 1k, and 35,114 against 40,276 on the
 * 10k, which is 12.8%. So the rule is chosen on a measurement AND it is a rule
 * that can be stated and tested, which is the part worth keeping: a node the
 * fixed layer has no opinion about does not move. Recorded with the near-wash
 * columns included so that nobody re-derives it as a principle.
 *
 * It is not a corner case either, and the count has to name a population to
 * mean anything, so here are both. Over the SEGMENT adjacency, which is what
 * `reorder` reads and therefore the one this rule is about: 118 of the 1k
 * drawing's nodes and 814 of the 10k's have no neighbour in the layer above and
 * are pinned on every downward sweep, and 24 and 162 have none in EITHER
 * adjacent layer and are pinned on every sweep in both directions. That second
 * pair is the transpose section's exclusion counted here, the same condition off
 * the same adjacency. Over the graph's OWN edges, which is what
 * `test/layout.order.test.ts` pins because it is a fact about the ranking rather
 * than about the drawing, the first pair is the same 118 and 814 and the second
 * is 48 and 438.
 *
 * THE SECOND FIGURE MOVES FOR THE REASON THE WHOLE OF M2.4b EXISTS: a node whose
 * only edges span several ranks has no neighbour in an adjacent layer of the
 * graph and has a dummy one rank away on each of them in the drawing, so 48 and
 * 438 over edges become 24 and 162 over segments.
 *
 * THE FIRST FIGURE NOT MOVING IS A MEASUREMENT AND NOT A THEOREM, which is
 * worth saying because the obvious argument for it is wrong. Splitting a long
 * edge can only ADD an upward neighbour, so the segment set is a subset of the
 * edge set and the count can only fall; equal counts therefore mean equal sets.
 * What that rules out is any node in either corpus whose in-edges are ALL long,
 * and nothing makes that impossible, it is just true of these two graphs. A
 * corpus with one such node would separate the pair exactly as the second one
 * is separated. Both are pinned, so a corpus that grew one would say so.
 *
 * All four read 120, 1,101, 49 and 572 until M2.6d, and all four of those were
 * pre-M2.2c, taken before the cycle breaker that decides the ranking every one
 * of them is a property of.
 *
 * ## The sweeps, and why the best is kept rather than the last
 *
 * A downward sweep fixes layer `i` and reorders layer `i + 1` from the
 * neighbours above it, top to bottom; an upward sweep does the mirror image.
 * They alternate, starting downward, `maxSweeps` in total.
 *
 * The layering is scored after every sweep and the BEST ONE SEEN is what comes
 * back, not the last one, because the sweeps are not monotone: a sweep can and
 * does make a drawing worse, and on a random layered graph of 40 nodes the
 * fifth sweep is worse than the fourth. That is the whole reason this stage can
 * be recommended without a caveat about the budget, and it is what makes a
 * larger `maxSweeps` a weakly better answer rather than a different one.
 *
 * TWO CONSECUTIVE full down-and-up rounds that lower the best seen by nothing
 * stop the run. That is a time saving with no measured quality cost: it leaves
 * every number in this docstring where it is, on both corpora and at both
 * budgets, and it matches running the full budget on all 200 of the random
 * layered graphs the test suite's stop case is drawn from.
 *
 * It takes two rounds rather than one because the rule is not a fixed point: the
 * layering carried into the next round is the last one rather than the best one,
 * so a round that improved nothing is not proof that the next one will not.
 * Stopping on the FIRST such round is what the extra counter exists to avoid,
 * and it was measured before it was rejected. It cost quality on 32 of those 200
 * graphs at a budget of 8, worst 1,055 crossings against 893, for 188,602
 * against 187,340 in aggregate; and on the 1k at a budget of 16 it fired after
 * sweep 14 for 3,532 where the full 16 reach 3,467. Waiting for a second round
 * recovers all of that, exactly, and costs about 21.6ms on the 10k against
 * 21.9ms for the one-round stop. Those five figures were measured when 8 was
 * the default and the counter saw a quarter of the edges, so read them as a
 * comparison between the two stop rules rather than as a level; the rule they
 * chose is unchanged and the budget they were taken at is now 4.
 *
 * `maxSweeps` DEFAULTS TO 4, and it defaulted to 8 until M2.6c re-derived it
 * over the drawing this stage sees now that M2.4b's chains are read. Measured,
 * crossings by budget on the chosen seed, the pass off:
 *
 * | sweeps | 1k      | 10k        |
 * | ------ | ------- | ---------- |
 * | 0      | 456,261 | 19,753,239 |
 * | 1      | 215,975 |  8,972,421 |
 * | 2      | 215,975 |  8,972,421 |
 * | 3      | 210,163 |  8,972,421 |
 * | 4      | 210,163 |  8,972,421 |
 * | 8      | 210,163 |  8,972,421 |
 * | 16     | 210,163 |  8,972,421 |
 *
 * THE 10k IS AT ITS FLOOR AFTER ONE SWEEP AND THE 1k AFTER THREE. Sweeps 5
 * through 8 buy exactly nothing on either corpus, and the layering they return
 * is not merely equal-scoring but identical: the best seen was found early and
 * never beaten, so `best` is the same object's contents at 4 as at 16. That is
 * what the shipped budget of 8 was spending, and the sweep loop's own
 * two-round stop only clips it to 6 on the 10k.
 *
 * Four rather than three because both floors are inside it and the sweeps
 * alternate down and up, so an even budget is whole rounds; not two, because
 * the 1k is 2.8% above its floor there; and not one, because the golden corpus
 * is a different shape from the bench pair and `wide-600` loses 9.7% at one
 * sweep, 246,749 against the 224,924 it reaches at four; it loses 8.4% at two,
 * which is a second argument against 2 rather than the argument against 1.
 * That corpus is the reason this is a reallocation and not simply a
 * cut: five of its six graphs are STILL IMPROVING at 8 sweeps, by 1.35% to
 * 3.48%, where both bench corpora floored by 3. Those sweeps are not free
 * everywhere. They are just worth less than the same milliseconds spent in the
 * transpose pass, which is the trade the next section makes and measures.
 *
 * THE TABLE THIS REPLACES IS KEPT HERE, marked, because this file and
 * `docs/docs/layout.md` are the only copies of it and the argument above is
 * partly an argument about its shape:
 *
 * | sweeps | 1k    | 10k    | 10k cost |
 * | ------ | ----- | ------ | -------- |
 * | 0      | 7,933 | 94,991 |    5.5ms |
 * | 2      | 4,619 | 50,735 |    9.5ms |
 * | 4      | 3,880 | 40,217 |   13.5ms |
 * | 8      | 3,605 | 35,114 |     21ms |
 * | 16     | 3,467 | 32,503 |     38ms |
 *
 * taken when a long edge was invisible to the counter, so no row of it compares
 * with a row of the table above. The shape is what does: that curve was still
 * falling at 16 and this one is flat from 3.
 *
 * ## The transpose pass
 *
 * After the sweeps stop, one transpose refinement pass runs over the layering
 * they settled on: every layer is walked left to right and each adjacent pair
 * is swapped when the swap costs nothing or saves something, repeatedly, until
 * a walk finds no strictly improving swap or `maxTransposePasses` is spent. It
 * is {@link transposeLayers}, and at the budgets that ship it removes 4.30% of
 * the crossings the sweeps leave on the 10k corpus and 11.96% on the 1k.
 *
 * WHERE IT RUNS. Once, at the end, on the BEST layering the sweeps saw. The
 * alternatives were measured at a sweep budget of 8 on the 10k corpus: once at
 * the end reaches 32,677 crossings, after every full round 32,798, after every
 * sweep 32,854, so the cheapest placement is also the best one. It is cheapest
 * by a wide margin, 30.1ms against 48.6ms and 125.5ms in the prototype those
 * three were compared in. All three of those numbers are from before ties were
 * allowed and from before the chains were counted, which is why none of them is
 * anywhere near the 8,586,890 this stage now reaches; what they compare is the
 * placements against each other, and the placement they chose is unchanged.
 *
 * The trap that placement sets is worth naming, because it does not announce
 * itself. `position` tracks `layers`, the last working layering, and the pass
 * is applied to `best`, so the best layering is copied back over `layers` and
 * `reposition` is called BEFORE a single delta is computed. A pass run against
 * stale positions still returns a legal layering and still returns it quickly;
 * what it does is decide arbitrarily, and measured on a build with that
 * repositioning removed the arbitrary decisions are not reliably worse, which
 * is why `layout.transpose.test.ts` pins the layers rather than a count.
 *
 * THE SWAP DELTA, and it is EXACT rather than an estimate. For an adjacent pair
 * with `v` at slot `i` and `w` at slot `i + 1`, the only crossings that can
 * change are those in the gap above and the gap below involving edges incident
 * to `v` or `w`, because every other segment keeps both endpoints where they
 * were. Taking one neighbour `a` of `v` and one neighbour `b` of `w` in the
 * fixed layer, that pair of segments crosses now exactly when `a` is right of
 * `b` and crosses after the swap exactly when `a` is left of `b`, so the side
 * contributes the count of one minus the count of the other. Both sides sum.
 * That makes a swap decision O(deg(v) * deg(w)) rather than the O(E log V) of
 * rescoring the drawing, and the suite holds it to being exact by running the
 * pass against a transpose that decides every swap by a full rescore.
 *
 * TIES ARE TAKEN. A swap is made when the delta is negative OR EXACTLY ZERO.
 * That contradicts the obvious prior, which is to move only on an improvement,
 * and it is measured rather than reasoned. A plateau of equal-scoring
 * permutations is a thing to walk across to reach something better, not a wall.
 *
 * Re-derived in M2.6d over the drawing the stage orders now and at the budgets
 * it ships, against the same layering the sweeps hand the pass:
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
 * EVERY ROW OF IT IS PINNED, in `test/layout.transpose.test.ts`, which is not a
 * detail of where the numbers live: this is the milestone whose thesis is that
 * an unpinned figure goes stale without anyone noticing. The first two are the
 * bench corpora and the other six are the golden regression corpus, rebuilt
 * there from the same `test/golden-corpus.ts` the golden file's own test uses,
 * so the two files cannot end up pinning numbers for different graphs.
 *
 * THIS PARAGRAPH USED TO SAY M2.8 WOULD MOVE ALL EIGHT AND THAT WAS WRONG. It
 * landed and moved none of them, which was not luck: every one of these is a
 * crossing count over the LAYERS this stage produces, routing is downstream of
 * positions and positions are downstream of order, and no route stage is an
 * input to any of it. The claim was inherited from M2.4b, where consuming the
 * chains really did move the counted population from 13,131 segments to
 * 214,222, and carried forward one milestone too many. What M2.8 does move is
 * the pipeline TIMINGS, which is a different sentence in a different paragraph
 * of this docstring and is still true.
 *
 * THE MARGIN IS NOT THE FINDING. THE STRICT RULE CAPTURES ABOUT AN EIGHTH OF
 * WHAT THE PASS IS WORTH: 12.1% of it on the 1k and 13.1% on the 10k, 8.9% to
 * 37.7% across the golden six. A pass that may not cross a plateau is not a
 * weaker version of this one, it is a different and much smaller thing, and
 * that is what makes the rule load-bearing rather than a tuning choice. It also
 * says the margin will not close with a larger budget, which is the reading a
 * single cap cannot rule out: the same comparison at caps of 4, 8 and 16 puts
 * the 10k margin at 0.93%, 2.00% and 3.76% and the 1k's at 3.11%, 6.25% and
 * 10.66%, widening at every step because ties keep buying and strict has
 * stopped.
 *
 * AT EQUAL CAP OR AT EQUAL TIME, AND BOTH READINGS AGREE, which the comparison
 * has to say because the two rules TERMINATE differently: a zero-delta swap
 * leaves one available, so the strict rule runs out of improving swaps far
 * sooner. It does not run out before 16 on either corpus, so equal cap IS equal
 * pass count here, and that settles the time question without a stopwatch. The
 * strict half of that is asserted; the ties half fails safe, since a ties run
 * that stopped early would only make the winning column cheaper. What
 * timing adds is that a strict pass is if anything the cheaper of the two, by
 * 1.5% to 4.0% of whole-stage time across two interleaved runs, which is at the
 * edge of what this machine resolves and is why the pass count is quoted first.
 * Run to its own fixed point instead, the strict rule stops after 35 passes on
 * the 1k at 207,068 and 207 on the 10k at 8,914,087, which is still 10.64% and
 * 3.67% above what the tie rule reaches in 16, for 1.35x and about 4.7x the
 * whole-stage time. Those are a long grind for very little: strict is within
 * 0.2% of its own fixed point after FOUR passes on both corpora, so the other
 * 31 and 203 passes buy a fifth of one percent between them. There is no budget
 * at which refusing ties is the better answer on either corpus. Both pass counts
 * and both fixed points are pinned with the table above.
 *
 * WHAT THIS REPLACES, kept rather than overwritten because it is the same
 * conclusion reached on a drawing that no longer exists: "allowing zero-delta
 * swaps wins all six configurations it was tested in, by between 2.7% and
 * 13.5%, and on the 10k run to a fixed point it reaches 29,260 crossings
 * against 32,677 for the strict rule". Those six were sweep budgets and caps
 * this stage no longer uses, measured before M2.2c when the counter saw 10,528
 * of the 10k's 40,000 edges against today's 214,222 segments, so not one figure
 * in that sentence compares with one above it. Read the two as a conclusion
 * that survived a change of drawing, and never as a trend.
 *
 * The strict column comes from a third solver in
 * `test/layout.transpose.test.ts`, the same pass with `delta >= 0`, one line
 * apart from {@link transposeLayers}. Nothing in the package ships a strict
 * build, so without that column the evidence for this rule would be prose again
 * the next time the drawing moves, which is exactly how it went stale the first
 * time. It agrees with the shipping pass exactly BECAUSE ITS TRAVERSAL IS THE
 * SAME ONE, and not because a strict descent has a single answer: the "swap v
 * past w" relation can be cyclic, and on 200 random layered graphs run left to
 * right against right to left, 198 end in different layers and 191 at a
 * different count.
 *
 * WITH ONE EXCLUSION THE TIE RULE MAKES NECESSARY: A PAIR IS SKIPPED WHEN
 * EITHER NODE HAS NO NEIGHBOUR IN EITHER ADJACENT LAYER. Such a node carries no
 * segment in either gap, so both sides of its delta are zero, so its delta is
 * zero, so without this the pass would swap every pair containing one
 * UNCONDITIONALLY. That is crossing-neutral and still wrong, for two reasons.
 * It reverses this stage's own measured rule that a node the fixed layer says
 * nothing about keeps its index, which `reorder` keeps. And because the drift
 * is one slot per pass in a fixed direction, the warm start hands the drifted
 * order back in and it compounds across re-layouts, which is the one thing
 * `initialOrder` exists to prevent.
 *
 * THE EXCLUSION IS A NO-OP UNDER THE STRICT RULE, which is what makes it the
 * tie rule's dependent rather than a rule of its own, and M2.6d asserted it
 * rather than leaving it as the short argument it looks like: an unanchored
 * node's delta is exactly zero, so a pass that refuses zero-delta swaps already
 * refuses every pair this would skip. A strict build with the exclusion and one
 * without return byte-identical layers on both corpora and on all six golden
 * graphs. So the tie rule, this exclusion and M3.6's warm-start stability are
 * one argument, and re-deriving the first is re-deriving all three.
 *
 * HOW MANY NODES IT IS ABOUT, and this figure has moved by a factor of seven:
 * 24 of the 1k drawing's 15,746 nodes and 162 of the 10k's 184,222, against the
 * 120 and 1,101 the rule was justified with before M2.4b's chains were
 * consumed. That fall is the chains working rather than the rule losing its
 * point. A node whose only edges spanned several ranks had no neighbour in an
 * adjacent layer and was unanchored; it now has a dummy one rank away on each
 * of them. What is left is genuinely isolated, and every one of those still
 * drifts by exactly the pass budget without the exclusion, measured at a cap of
 * 16 and again at 32 on both corpora, all in the same direction, and
 * crossing-neutral to the last unit both times.
 *
 * ONE CONSEQUENCE OF STATING IT THIS WAY, since the alternative readings are
 * not obviously worse: an unanchored node becomes a PERMANENT BARRIER, because
 * a pair is skipped when EITHER member is unanchored, so the pass can never
 * move an anchored node past one. Measured, that costs nothing on either
 * corpus. It is the price of the pin being absolute, and the pin is absolute
 * because that is what `reorder` already does.
 *
 * Found by algorithms-review after the pass was built, on 41 of 41 unanchored
 * nodes in one generated corpus and 371 of 371 in another, every one displaced
 * by exactly the pass budget. Worth recording that IT COST NOTHING: the corpora
 * read 3,605 and 3,005 on the 1k and 35,114 and 30,318 on the 10k both before
 * the exclusion and after it, which is what a crossing-neutral change has to
 * do. Those four are pre-chain figures and are kept as the pair they are, a
 * before and an after of one change rather than a level, because what they
 * claim is that two counts taken either side of it agree, and that claim is
 * about the change and not about the drawing. M2.6d took the same pair on the
 * drawing that ships and it still costs nothing: 185,028 and 8,586,890 either
 * way, on 24 of 24 unanchored nodes and 162 of 162.
 *
 * TERMINATION IS GATED ON STRICTLY IMPROVING SWAPS ONLY, and that is a
 * constraint rather than a detail. A zero-delta swap leaves a zero-delta swap
 * available, so a loop that continued whenever anything moved swaps one pair
 * back and forth forever: the prototype hung on exactly this. Two nodes sharing
 * a single neighbour are enough to produce it, which is to say every fan-in and
 * every fan-out produces it. The witness is three nodes and two edges, and the
 * suite pins both halves of the rule on it: the shipping gate stops after one
 * pass, and an any-swap gate runs a clean period-2 cycle for as long as it is
 * allowed to. It takes both the tie rule and the wrong gate to hang, so a test
 * that only asserted "the loop ends" would pass on a strict-only build and
 * catch nothing.
 *
 * THE CAP, `maxTransposePasses`, DEFAULTS TO 16, and defaulted to 8 until
 * M2.6c. Measured at the shipping sweep budget of 4 on the 10k, against
 * 8,972,421 crossings with the pass off:
 *
 * | cap               | 10k crossings | saving | extra time | per pass | per ms |
 * | ----------------- | ------------- | ------ | ---------- | -------- | ------ |
 * | 4                 |     8,848,414 |  1.38% |   +81.43ms |   31,002 |  2,230 |
 * | 8                 |     8,748,361 |  2.50% |  +131.09ms |   25,013 |  1,800 |
 * | 12                |     8,663,589 |  3.44% |  +197.71ms |   21,193 |  1,525 |
 * | 16 (the default)  |     8,586,890 |  4.30% |  +235.72ms |   19,175 |  1,379 |
 * | 24                |     8,453,276 |  5.79% |  +345.24ms |   16,702 |  1,202 |
 * | 32                |     8,344,656 |  7.00% |  +454.17ms |   13,578 |    977 |
 * | 48                |     8,175,278 |  8.88% |  +685.73ms |   10,586 |    762 |
 * | fixed point (675) |     7,637,257 | 14.88% |   +9.4sec* |      858 |     62 |
 *
 * HOW EACH COLUMN IS MEASURED, because two of them cannot be measured the same
 * way. `extra time` is the whole stage at that cap minus the whole stage with
 * the pass off, min of 8 INTERLEAVED runs: interleaved so that a drift in load
 * hits every configuration equally, min because the fastest run of a
 * deterministic function is the least contaminated. `per pass` is MARGINAL and
 * exact, the crossings a row buys over the row above it divided by the passes
 * in the step, and it needs no timing at all. `per ms` is `per pass` divided by
 * 13.9ms, the measured cost of one pass, and NOT by the step's own extra time:
 * the steps are 38ms to 232ms apart and the per-step timings do not resolve
 * their own differences, which is what makes a per-step rate column read as
 * noise. Turning the pass on also costs a one-off 26ms on the 10k to build its
 * index, which is why the cap-4 row's extra time is more than four passes. The
 * starred figure is the only modelled one, 26ms plus 675 passes at 13.9ms: the
 * fixed point was run and its crossings are measured, but timing a nine-second
 * configuration eight times over to gate one row was not worth the machine.
 *
 * THERE IS NO KNEE ON THIS CURVE, and that is the finding rather than a caveat
 * on it. The rate falls by a fifth per doubling early and a third by the end
 * (19.3% from 4 to 8, 23.3% from 8 to 16, 29.2% from 16 to 32, 36.6% from 24 to
 * 48), smoothly and with no step, and it keeps going for hundreds of passes:
 * the fixed point is 675 passes away and the last 627 of them still average 858
 * crossings each. Compare the table this replaces, where the rate fell by more
 * than half immediately past 8, threefold past 4, and by at least half at every
 * step after. That knee was real and it was a property of a drawing where a long
 * edge was invisible to the counter. It is gone, so a cap read off this curve
 * alone would be "as many as you can afford", which is not a default.
 *
 * SO 16 IS BOUGHT AGAINST THE SWEEPS, NOT AGAINST THIS CURVE, and that is what
 * makes the pair a re-derivation of two budgets rather than two separate
 * decisions. THE EXCHANGE RATE IS 5 TO 6 PASSES PER SWEEP on both corpora,
 * measured in one interleaved run: a sweep is 5.38ms on the 1k and 78ms on the
 * 10k, a pass 1.11ms and 13.9ms. The sweeps section shows sweeps 5 through 8
 * buying nothing at all on either bench corpus and 1.35% to 3.48% on the golden
 * corpus. The same milliseconds in this pass buy 4.30% on the 10k and 11.96% on
 * the 1k. So the four sweeps come off and the cap goes up, and the pair that
 * ships beats the 8 and 8 it replaces on BOTH axes everywhere it was measured:
 * 1.85% and 4.77% fewer crossings on the 10k and the 1k, all six golden graphs
 * lower, and the stage faster on both.
 *
 * HOW MUCH FASTER, and this is the number to distrust first because it is a
 * difference of two timings. Min of 8 interleaved runs: 670.38ms against
 * 729.60ms on the 10k and 48.89ms against 61.95ms on the 1k, so 8.1% and 21.1%.
 * The components predict 6.1% and 20.4% from the sweep and pass costs above,
 * and three earlier runs on a busier machine read 4.0%, 7.1% and 7.7% on the
 * 10k. Take 4% to 8% as the honest 10k range and 21% as the 1k.
 *
 * WHY 16 AND NOT MORE, since the curve says spend. Because 16 is the last cap
 * in the table that leaves the whole stage faster than the pair it replaces on
 * both corpora: 24 makes the 10k slower than it is today, for a further 1.5%.
 * Break-even is a cap of about 19 on the 10k, where cutting the budget from 8
 * to 4 saves a measured 151.46ms and a pass is 13.9ms, and about 28 on the 1k.
 * That 151.46ms is about TWO sweeps at 78ms and not four, because the
 * two-round stop already clips a budget of 8 to six on this corpus, so cutting
 * to 4 removes the two sweeps it actually runs rather than the four it is
 * allowed. Reading it as four would put break-even at 30. Sixteen is deliberately
 * inside both, so the pair is an improvement on either axis read alone rather
 * than a trade that has to be argued. This is a BUDGET rather than a knee and is
 * stated as one, which is the honest reading of a curve with no knee in it.
 *
 * The 1k agrees without deciding anything: 185,028 against 210,163 for
 * +19.27ms, its fixed point 162,662 after 187 passes. Sixteen captures 28.9%
 * of the fixed point's saving on the 10k and 52.9% on the 1k, for 2.5% and 9.2%
 * of its time. The fixed point is not affordable on either and is here for the
 * last column.
 *
 * A LARGER CAP IS A WEAKLY BETTER ANSWER, never a different one, for the same
 * reason a larger `maxSweeps` is: the deltas are exact and only non-increasing
 * swaps are taken, so a pass cannot raise the count. That is a property of the
 * pass and it is tested as one, over random layerings, rather than defended at
 * runtime by keeping whichever layering scores better. A runtime guard there
 * would hide exactly the arithmetic bug the property exists to catch.
 *
 * What the stage does do at the end is score the transposed layering and take
 * it only if it is STRICTLY better, which is the same best-seen rule the sweeps
 * already run under. That cannot cost a crossing, since the pass never raises
 * the count, and it answers the churn objection to taking zero-delta swaps: a
 * reordering that bought nothing does not reach the output. On the three-node
 * witness above, where the only available swap is worth exactly zero, the
 * layers that come back are the ones that went in.
 *
 * DETERMINISM SURVIVES THE TIE RULE, which is the part worth checking rather
 * than assuming, because taking zero-delta swaps means thousands of decisions
 * that could have gone either way. Both corpora return byte-identical layers
 * across a rerun on the same state, a second graph built from scratch in the
 * same insertion order, and a fresh stage object.
 *
 * THE CAP TABLE THIS REPLACES, KEPT WHOLE AND MARKED rather than summarised,
 * for the reason it gave for carrying its own last three rows: without the
 * marginal column the claim above about its shape cannot be checked against it.
 * Measured at a sweep budget of 8 on the 10k, against 35,114 crossings and
 * 16.32ms with the pass off, when the counter saw about a quarter of the edges:
 *
 * | cap             | 10k crossings | saving | extra time | crossings per ms |
 * | --------------- | ------------- | ------ | ---------- | ---------------- |
 * | 4               | 31,369        | 10.7%  | +2.65ms    | 1,413            |
 * | 6               | 30,677        | 12.6%  | +4.15ms    | 461              |
 * | 8 (the default) | 30,318        | 13.7%  | +4.93ms    | 460              |
 * | 12              | 29,892        | 14.9%  | +6.92ms    | 214              |
 * | 16              | 29,658        | 15.5%  | +9.29ms    | 99               |
 * | 32              | 29,358        | 16.4%  | +16.91ms   | 39               |
 * | fixed point     | 29,260        | 16.7%  | +30.61ms   | 7                |
 *
 * where the fixed point took 60 passes, and the 1k reached 3,005 against 3,605
 * for +0.41ms with its own fixed point at 2,959 after 19. Eight captured 81.9%
 * of the full saving for 16.1% of the extra time: the rate held at or above 460
 * up to 8, fell to 214 immediately past it, then by at least half at every
 * further step. That is a knee, and it was a real one.
 *
 * THE PREDICTION THAT TABLE CARRIED WAS SETTLED AND IT WAS RIGHT. This section
 * predicted, from a hand-expanded 10k before any of it was built, that the
 * saving would collapse once every edge became visible: from 10.7% to 1.4% AT A
 * CAP OF 4. A cap of 4 now measures 1.38%, so it reproduced to two figures on
 * the real thing. Everything above was still re-measured rather than reasoned
 * about from that agreement.
 *
 * TWO THINGS DID NOT SURVIVE THE RE-DERIVATION AND ARE WORTH NAMING, because
 * both were stated here as settled. The knee, above. And the FIXED POINT: this
 * section said 60 passes on the 10k and 19 on the 1k, and the pass now runs 675
 * and 187 times before it finds no improving swap. A cap of 200, which the
 * corpus test used to ask for as "far beyond the pass count either corpus
 * needs", stops the 10k two thirds of the way, so the 7,689,100 it reported was
 * never a fixed point.
 *
 * THE TIE RULE WAS OWED ONE AND M2.6d PAID IT. It had been measured on the same
 * pre-chain drawing as the cap, winning all six configurations it was tried in
 * there, and M2.6c re-ran neither those configurations nor that population. The
 * strict-versus-ties comparison is now re-run at 4 and 16, on both corpora and
 * all six golden graphs, and the rule is unchanged: see TIES ARE TAKEN above
 * for the table, and note that nothing in this section moves as a result,
 * because keeping a rule changes no count.
 *
 * ## The warm start
 *
 * `initialOrder` is a previous run's layers, handed back so that a re-layout
 * does not churn an ordering the user has already read. It is a HINT and is
 * never taken on trust, exactly as `initialRanks` is a hint in `simplex.ts`:
 * see {@link applyHint} for what is dropped and why nothing it can say produces
 * an invalid layering.
 *
 * Two of its rules are rules from the sections above rather than rules of their
 * own, and both are argued at {@link applyHint}. An id keys by its position
 * within its OWN hint layer, so two ids the hint listed in different layers tie
 * when they meet in one layer here and the walk breaks the tie, which is what
 * keeps the hint keyed by node identity rather than by the `(rank, index)`
 * position M3.6 rules out. And an id the hint does not name keeps the index the
 * walk gave it, exactly as a node the fixed layer says nothing about keeps its
 * index through a sweep.
 *
 * ## Determinism
 *
 * Same graph, same layers, always. Node numbers are the roster's own order, and
 * every tie in the seed walk is edge insertion order. Every tie in a sort key
 * comes down to two facts together: the nodes to sort are collected in index
 * order, and `Array.prototype.sort` is stable by specification, so a tie leaves
 * them in the order they already sat in. Neither fact is a comparator term, and
 * a comparator term restating the second one would not add a guarantee. Unlike
 * the rank stages this one is also invariant to nothing in particular about the
 * graph's history: it reads the ranks it is given, so a graph assembled in a
 * different order that ranks the same and rosters the same orders the same.
 *
 * ## What the default costs and what it buys
 *
 * M2.6b pointed `defaultStages.order` at this stage, so what follows is what a
 * caller who names no order stage now pays and now gets, measured against the
 * roster order `insertionOrderStage` produces. Full default pipeline, median of
 * 25 timed iterations after 5 warmups, and the crossings of the layering each
 * one produces:
 *
 * | corpus | roster order | this stage | crossings before | after     |
 * | ------ | ------------ | ---------- | ---------------- | --------- |
 * | 1k     | 24.893ms     | 74.686ms   | 703,757          | 185,028   |
 * | 10k    | 474.701ms    | 1206.009ms | 34,510,321       | 8,586,890 |
 *
 * So the pipeline is 3.00x slower on the 1k (+49.79ms) and 2.54x slower on the
 * 10k (+731.31ms), and the drawing has 73.7% fewer crossings on the one and
 * 75.1% fewer on the other. The two after-counts are this stage at its own
 * defaults, the cap-of-16 row of the transpose table above, which is what ties
 * the trade to the stage that actually ships rather than to some configuration
 * of it. The timings are one machine's, as every timing here is, and that
 * machine was carrying a load of about six while these were taken.
 *
 * ALL FOUR WERE RE-DERIVED IN M2.6c AND THREE THINGS MOVED THEM, so read the
 * shape rather than the arithmetic against the M2.6b table this replaces
 * (1k 2.502ms and 3.992ms for 12,890 against 3,005; 10k 26.257ms and 47.229ms
 * for 425,394 against 30,318). M2.4b's chains made every stage of the pipeline
 * place 184,222 nodes on the 10k rather than 10,000, which is most of the
 * timings; consuming them took the counted population from 13,131 edges to
 * 214,222 segments, which is most of the counts; and this milestone moved the
 * budgets, which is the smallest of the three and the only one this section is
 * about. The ratios fell from 92.9% to 75.1% on the 10k for the second of
 * those reasons and not because the stage got worse: the like-for-like
 * comparison, both layerings scored over the same population, is in
 * `test/layout.order.test.ts` and it is 74.7% on the 10k.
 *
 * M2.8 EXPIRED TWO OF THE FOUR AND NOT THE OTHER TWO, and the split is worth
 * stating because this docstring predicted the wrong half. Both timings are of
 * the FULL pipeline, so both now include a router that attaches every route at
 * a box border, which is arithmetic per edge that neither column paid when they
 * were taken; the two crossing counts are of the layering THIS STAGE produces
 * and no route stage is an input to it, so they are untouched and were verified
 * untouched rather than assumed so. The timings are not re-derived here. What
 * M2.8 adds is bounded and small, both pipeline benchmarks came back inside
 * their own run-to-run drift on the gate, and both columns pay it equally, so a
 * fresh pair taken on a machine under a different load would move these numbers
 * for a reason that is not this milestone.
 *
 * THOSE FOUR FIGURES ARE LIVE ADVICE HERE AND NOWHERE ELSE. Each is a
 * measurement with a scheduled expiry: a bench recapture moves the timings. So
 * `index.ts`, `ROADMAP.md` and `docs/docs/layout.md` describe the trade in a
 * sentence and point back at this section rather than copying the table, which
 * leaves one paragraph to correct rather than four. `CHANGELOG.md` is the
 * deliberate exception: a dated entry records what a past change measured at
 * the time, so M2.6's entry keeps its
 * own 3,005 and 30,318 and is marked superseded in place rather than swept,
 * which is this file's own precedent. The crossing counts are pinned against
 * both stages in `test/layout.order.test.ts`, so a stage that quietly gave the
 * saving back fails there; the timings are pinned by nothing, which is what the
 * bench baseline is for.
 *
 * Being the default was always a separate decision from existing, which is the
 * precedent M2.3 set with `networkSimplexRankStage`: a real stage is exported
 * by name whether or not it is the default, and this one was exported by name
 * for two milestones before it took it.
 *
 * @throws {InvalidConfigError} when `maxSweeps` is not a whole number of sweeps
 * that is zero or greater, or when `maxTransposePasses` is not a whole number
 * of passes that is zero or greater.
 */
export function barycenterOrder(options?: BarycenterOrderOptions): OrderStage {
  const budget = resolveBudget(options?.maxSweeps);
  const passBudget = resolveTransposeBudget(options?.maxTransposePasses);
  const hint = options?.initialOrder;
  return {
    name: 'barycenter-order',
    run(input) {
      const index = buildIndex(input);
      const layers = seedWalk(index);
      if (hint !== undefined) applyHint(layers, index.ids, hint);

      const count = index.ids.length;
      const position = new Int32Array(count);
      const reposition = (): void => {
        for (const layer of layers) {
          for (const [slot, node] of layer.entries()) position[node] = slot;
        }
      };
      reposition();

      let widest = 0;
      for (const layer of layers) widest = Math.max(widest, layer.length);
      let busiest = 0;
      for (let gap = 0; gap + 1 < index.layerCount; gap += 1) {
        busiest = Math.max(busiest, at(index.gapStart, gap + 1) - at(index.gapStart, gap));
      }
      const encoded = new Float64Array(busiest);
      const tree = new Int32Array(treeSizeFor(widest));
      const neighbours = new Int32Array(Math.max(index.segUpper.length, 1));
      const barycenter = new Float64Array(count);
      const median = new Float64Array(count);
      const movable: number[] = [];
      const slots: number[] = [];

      /** What the layering costs as it stands, over every gap. */
      const score = (): number => {
        let total = 0;
        for (let gap = 0; gap + 1 < index.layerCount; gap += 1) {
          const start = at(index.gapStart, gap);
          const end = at(index.gapStart, gap + 1);
          const stride = layers[gap + 1]?.length ?? 0;
          if (end === start || stride === 0) continue;
          const view = encoded.subarray(0, end - start);
          for (let slot = start; slot < end; slot += 1) {
            view[slot - start] =
              at(position, at(index.segUpper, slot)) * stride +
              at(position, at(index.segLower, slot));
          }
          view.sort();
          total += gapCrossings(view, stride, tree);
        }
        return total;
      };

      /**
       * Reorders one layer against the fixed layer on one side of it. A node
       * with no neighbour there is pinned where it is, and the rest are sorted
       * into the indices that leaves.
       *
       * `movable` is collected in index order and the sort is stable, so two
       * nodes with the same barycenter and the same median come out in the
       * order they were in. That is where this stage's determinism comes from,
       * along with the node numbering; it is not something a further comparator
       * term supplies, which is why there is not one.
       */
      const reorder = (layer: number[], fromAbove: boolean): void => {
        const start = fromAbove ? index.upStart : index.downStart;
        const next = fromAbove ? index.upNext : index.downNext;
        movable.length = 0;
        slots.length = 0;
        for (const [slot, node] of layer.entries()) {
          const first = at(start, node);
          const last = at(start, node + 1);
          if (first === last) continue;
          const seen = neighbours.subarray(0, last - first);
          let total = 0;
          for (let entry = first; entry < last; entry += 1) {
            const where = at(position, at(next, entry));
            seen[entry - first] = where;
            total += where;
          }
          seen.sort();
          const middle = seen.length >> 1;
          barycenter[node] = total / seen.length;
          median[node] =
            seen.length % 2 === 1
              ? at(seen, middle)
              : (at(seen, middle - 1) + at(seen, middle)) / 2;
          movable.push(node);
          slots.push(slot);
        }
        if (movable.length < 2) return;
        movable.sort(
          (left, right) =>
            at(barycenter, left) - at(barycenter, right) ||
            at(median, left) - at(median, right),
        );
        for (const [rank, node] of movable.entries()) {
          const slot = at(slots, rank);
          layer[slot] = node;
          position[node] = slot;
        }
      };

      const sweepDown = (): void => {
        for (let layer = 1; layer < layers.length; layer += 1) {
          const row = layers[layer];
          if (row !== undefined) reorder(row, true);
        }
      };
      const sweepUp = (): void => {
        for (let layer = layers.length - 2; layer >= 0; layer -= 1) {
          const row = layers[layer];
          if (row !== undefined) reorder(row, false);
        }
      };

      let best = layers.map((layer) => [...layer]);
      let bestScore = score();
      let roundScore = bestScore;
      let dry = 0;
      for (let sweep = 1; sweep <= budget; sweep += 1) {
        if (sweep % 2 === 1) sweepDown();
        else sweepUp();
        const current = score();
        if (current < bestScore) {
          bestScore = current;
          best = layers.map((layer) => [...layer]);
        }
        // TWO CONSECUTIVE full down-and-up rounds that lowered the best seen by
        // nothing end the run. Checked on the round rather than on the sweep,
        // because a single sweep going nowhere is normal and a single sweep
        // going backwards is normal too.
        //
        // The counter is the only difference from a one-round stop, and the
        // one-round stop is why it is here. This is a heuristic and NOT a fixed
        // point: what carries into the next round is the last layering, not the
        // best one, so the run really can improve again after a round that did
        // not. Stopping on the first such round cost quality on 32 of 200 random
        // layered graphs at the default budget, worst 1,055 crossings against
        // 893, and took the 1k corpus at a budget of 16 to 3,532 where the full
        // 16 sweeps reach 3,467. Waiting for a second one recovers every
        // crossing of that on all three, at no measured cost in time. See the
        // sweeps section of the docstring above.
        if (sweep % 2 === 0) {
          if (bestScore >= roundScore) {
            dry += 1;
            if (dry >= 2) break;
          } else dry = 0;
          roundScore = bestScore;
        }
      }

      // The transpose pass, once, on the BEST layering rather than on the last
      // working one. `layers` and `position` describe the last one at this
      // point, so the best one is copied back over both before a single delta
      // is computed: a pass run against stale positions computes every delta
      // for a permutation the layering is not in, which does not throw and does
      // not produce an illegal layering, it decides arbitrarily. Arbitrary is
      // not the same as worse, and measured it is sometimes better by luck,
      // which is why the test for this pins layers rather than a count.
      if (passBudget > 0) {
        for (const [number, row] of best.entries()) {
          const layer = layers[number];
          if (layer === undefined) continue;
          layer.length = 0;
          for (const node of row) layer.push(node);
        }
        reposition();
        transposeLayers(layers, position, index, passBudget);
        // Scored and accepted on the same rule the sweeps run under, which is
        // the best seen and a STRICTLY lower score. The pass cannot raise the
        // count, so this never costs a crossing; what it rules out is a
        // zero-delta reordering reaching the output having bought nothing,
        // which is the churn objection to taking those swaps at all.
        if (score() < bestScore) best = layers.map((layer) => [...layer]);
      }

      return { layers: best.map((layer) => layer.map((node) => idAt(index.ids, node))) };
    },
  };
}

/**
 * The barycenter order stage with no options: four sweeps, a transpose cap of
 * 16, and a cold start. It said eight sweeps until M2.6d noticed that M2.6c had
 * moved the constant and left this line behind.
 * See {@link barycenterOrder}, which is where all of it is argued, including
 * what being the default costs and what it buys.
 *
 * Frozen, for the reason `defaultStages` and `networkSimplexRankStage` are: it
 * is one object shared by every run in the process, and a stage's `name` is
 * quoted in every `StageContractError` the runner raises against it, so an
 * assignment to it anywhere would be an assignment to it everywhere.
 */
export const barycenterOrderStage: OrderStage = Object.freeze(barycenterOrder());
