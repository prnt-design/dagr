import type { Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
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
const DEFAULT_MAX_SWEEPS = 8;

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
}

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
 * **What it counts, and this is the honest limit of the metric today.** A
 * crossing is only defined between two segments joining the same pair of
 * ADJACENT layers. An edge whose endpoints are more than one layer apart is
 * invisible here, and so is a self loop, which spans none. Under the default
 * ranker most edges are in that first category, so this is a real quantity
 * counted over a proper subset of the drawing rather than over all of it. See
 * `docs/docs/layout.md` for the measured share, and note what changes it:
 * M2.4b's dummy chains make every edge span exactly one rank, at which point
 * every edge is a segment and this sees the whole graph without a line
 * changing here.
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
  for (const edge of input.graph.edges()) {
    const from = places.get(edge.source);
    const to = places.get(edge.target);
    if (from === undefined || to === undefined) continue;
    if (Math.abs(from.layer - to.layer) !== 1) continue;
    const gap = Math.min(from.layer, to.layer);
    const [upper, lower] = from.layer < to.layer ? [from, to] : [to, from];
    const stride = input.layers[gap + 1]?.length ?? 0;
    const encoded = upper.index * stride + lower.index;
    const segments = gaps.get(gap);
    if (segments === undefined) gaps.set(gap, [encoded]);
    else segments.push(encoded);
  }
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
   * How many sweeps the stage may run. Defaults to 8. Zero is legal and means
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
  // allowed to leave gaps or start below zero, `insertionOrderStage` has always
  // said so, and adjacency here is adjacency of layers: two ranks with nothing
  // between them are one gap apart however far apart the numbers are.
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

  // One pass over the edges, keeping only the ones that join adjacent layers.
  // A self loop puts both endpoints on one layer and is dropped by the same
  // test, which is what "a self loop spans zero ranks" comes to here.
  const from: number[] = [];
  const to: number[] = [];
  const segUpper: number[] = [];
  const segLower: number[] = [];
  const segGap: number[] = [];
  for (const edge of input.graph.edges()) {
    const source = numberOf.get(edge.source);
    const target = numberOf.get(edge.target);
    if (source === undefined || target === undefined) continue;
    const sourceLayer = at(layerOf, source);
    const targetLayer = at(layerOf, target);
    if (Math.abs(sourceLayer - targetLayer) !== 1) continue;
    from.push(source);
    to.push(target);
    const down = sourceLayer < targetLayer;
    segUpper.push(down ? source : target);
    segLower.push(down ? target : source);
    segGap.push(Math.min(sourceLayer, targetLayer));
  }

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
  const walkAt = new Int32Array(ids.length);
  const named: number[] = [];
  const slots: number[] = [];
  for (const layer of layers) {
    named.length = 0;
    slots.length = 0;
    for (const [slot, node] of layer.entries()) {
      const position = hintIndex.get(idAt(ids, node));
      if (position === undefined) continue;
      key[node] = position;
      walkAt[node] = slot;
      named.push(node);
      slots.push(slot);
    }
    if (named.length < 2) continue;
    named.sort(
      (left, right) => at(key, left) - at(key, right) || at(walkAt, left) - at(walkAt, right),
    );
    for (const [rank, node] of named.entries()) layer[at(slots, rank)] = node;
  }
}

/**
 * Builds an order stage that reduces edge crossings by barycenter sweeps.
 *
 * `barycenterOrderStage` is this with no options, and is what to reach for
 * unless a run needs a warm start or a different sweep budget. It is NOT the
 * default order stage; see the last section here for why not.
 *
 * ## The seed, which is the part M3.6 warm starts from
 *
 * Barycenter sweeps are sensitive to where they start, so the starting
 * permutation is a decision rather than an implementation detail, and it is
 * this: a connected DEPTH-FIRST WALK over adjacent-layer edges. See
 * {@link seedWalk} for the rule itself. It is not the roster order the
 * placeholder used.
 *
 * Measured on the bench corpora, crossings after 8 sweeps, lower is better:
 *
 * | seed                             | 1k    | 10k    |
 * | -------------------------------- | ----- | ------ |
 * | roster order (the placeholder's) | 3,943 | 54,744 |
 * | walk over adjacent-layer edges   | 3,605 | 35,114 |
 * | walk over all edges              | 3,459 | 38,152 |
 *
 * and before any sweep runs: roster order 12,890 and 425,394, the
 * adjacent-layer walk 7,933 and 94,991, the all-edges walk 9,722 and 191,023.
 *
 * The adjacent-layer walk is chosen over the all-edges walk for two reasons. It
 * wins the 10k by 8.0% and loses the 1k by 4.2%, and the 10k is the corpus
 * every later milestone commits against. And the two walks COINCIDE once M2.4b
 * splits every long edge into a chain, because then every edge spans exactly
 * one rank, so choosing the adjacent-layer rule is choosing the behaviour this
 * stage will have anyway rather than one that changes character under it.
 *
 * The hypothesis that was refuted is the interesting part, and it was the
 * all-edges walk's: the seed is the only place a long edge can influence this
 * stage at all, since neither the sweeps nor the counter can see one, so
 * feeding the walk every edge looked like the way to spend that one chance. It
 * loses. A start built from edges the sweeps cannot see is worth less than one
 * built from the edges they can.
 *
 * ## The sort key: barycenter, then median, then current index
 *
 * A node's barycenter is the arithmetic mean of its neighbours' positions in
 * the fixed layer. Ties break on the median of the same positions, and any
 * remaining tie on the node's own current index, which makes the sort stable
 * and the stage deterministic.
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
 * It is not a corner case either. 120 of the 1k corpus's nodes and 1,101 of the
 * 10k's have no neighbour in the layer above, and 49 and 572 respectively have
 * none in either adjacent layer.
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
 * A full down-and-up round that lowers the best seen by nothing stops the run.
 * That rule is a time saving with a QUALITY COST, and the cost is measured
 * rather than assumed away: the layering carried into the next round is the last
 * one rather than the best one, so a round that improved nothing is not proof
 * that the next one will not. On the 1k at a budget of 16 the stop fires after
 * sweep 14 and the answer is 3,532 where running all 16 reaches 3,467, which is
 * 1.9%. At the default budget of 8 it fires on neither corpus, so it costs
 * nothing there, and the 10k is unaffected at 16 as well.
 *
 * Measured, crossings by budget on the chosen seed: the 1k is 7,933 at the seed
 * and 4,619, 3,880, 3,605 and 3,532 at 2, 4, 8 and 16 sweeps; the 10k is 94,991
 * at the seed and 50,735, 40,217, 35,114 and 32,503. The 10k cost about 5.5ms
 * for the seed alone and 9.5ms, 13.5ms, 21ms and 38ms at 2, 4, 8 and 16 sweeps,
 * scoring included, on the maintainer's machine. Read those as one machine's
 * measurements taken to justify a default, not as baselines: the committed
 * benchmark medians are the only numbers anything regresses against.
 *
 * `maxSweeps` defaults to 8, where the curve has given up most of what it will
 * give: 8 sweeps take the 10k to 8.3% of the roster-order seed's crossings and
 * 16 take it to 7.6%, so doubling the budget buys another 7% of what is left
 * for something under double the time.
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
 * Same graph, same layers, always. Node numbers are the roster's own order,
 * every tie in the seed walk is edge insertion order, and every tie in a sort
 * key falls through to the node's current index. Unlike the rank stages this
 * one is also invariant to nothing in particular about the graph's history: it
 * reads the ranks it is given, so a graph assembled in a different order that
 * ranks the same and rosters the same orders the same.
 *
 * ## Why this is not the default order stage
 *
 * `defaultStages.order` is still `insertionOrderStage`, and this stage is
 * exported by name beside it, which is the precedent M2.3 set with
 * `networkSimplexRankStage`: a real stage is exported by name, and which stage
 * is the default is a separate decision from whether the algorithm exists.
 *
 * Two things beyond the precedent. It costs about 21ms on the 10k corpus against
 * a `pipeline > 10k` benchmark baseline of 30.15ms, and the gate's base
 * tolerance is 10%, so making it the default would put that entry about 70%
 * over and the bench gate would fail; the baseline refresh that would absorb it
 * is owed already and deferred to a quiet machine, because `pnpm bench:baseline`
 * recaptures wholesale. And M2.6's transpose refinement improves this same
 * stage, so flipping the default once, after both, is one decision and one
 * rebaseline instead of two.
 *
 * Those two numbers, the baseline and the tolerance, are why the argument is
 * made here and nowhere else. Both expire the moment either one is recaptured,
 * so `index.ts` and `docs/docs/layout.md` say that the stage is opt-in and how
 * to opt into it and then point back at this section, which leaves one
 * paragraph to correct rather than three.
 *
 * @throws {InvalidConfigError} when `maxSweeps` is not a whole number of sweeps
 * that is zero or greater.
 */
export function barycenterOrder(options?: BarycenterOrderOptions): OrderStage {
  const budget = resolveBudget(options?.maxSweeps);
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
            at(median, left) - at(median, right) ||
            at(position, left) - at(position, right),
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
      for (let sweep = 1; sweep <= budget; sweep += 1) {
        if (sweep % 2 === 1) sweepDown();
        else sweepUp();
        const current = score();
        if (current < bestScore) {
          bestScore = current;
          best = layers.map((layer) => [...layer]);
        }
        // A full down-and-up round that lowered the best seen by nothing ends
        // the run. Checked on the round rather than on the sweep, because a
        // single sweep going nowhere is normal and a single sweep going
        // backwards is normal too.
        //
        // This is a heuristic and NOT a fixed point. What carries into the next
        // round is the last layering, not the best one, so the run really can
        // improve again after a round that did not: it does on the 1k corpus at
        // a budget of 16, which stops after sweep 14 at 3,532 where the full 16
        // reach 3,467. Measured at 1.9% there and at nothing at all at the
        // default budget, where it fires on neither corpus. See the sweeps
        // section of the docstring above.
        if (sweep % 2 === 0) {
          if (bestScore >= roundScore) break;
          roundScore = bestScore;
        }
      }

      return { layers: best.map((layer) => layer.map((node) => idAt(index.ids, node))) };
    },
  };
}

/**
 * The barycenter order stage with no options: eight sweeps and a cold start.
 * See {@link barycenterOrder}, which is where all of it is argued, including
 * why this is not the default stage.
 *
 * Frozen, for the reason `defaultStages` and `networkSimplexRankStage` are: it
 * is one object shared by every run in the process, and a stage's `name` is
 * quoted in every `StageContractError` the runner raises against it, so an
 * assignment to it anywhere would be an assignment to it everywhere.
 */
export const barycenterOrderStage: OrderStage = Object.freeze(barycenterOrder());
