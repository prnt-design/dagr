import type { NodeId } from '@dagr/graph';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
import { forEachSegment } from './segments.js';
import type { OrderedState, Point, PositionStage, Size } from './types.js';

/**
 * Horizontal coordinate assignment: Brandes and Koepf, "Fast and Simple
 * Horizontal Coordinate Assignment" (GD 2001).
 *
 * The vertical half of a position stage is not this algorithm's business and is
 * not solved here twice: {@link rowCentres} is `gridPositionStage`'s row
 * arithmetic, reproduced so that swapping the position stage moves nodes
 * sideways and never up or down.
 */

/** The four alignments, in the order the balancing step expects them. */
const ALIGNMENTS = ['down-left', 'down-right', 'up-left', 'up-right'] as const;

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node number this file minted. The same guard `order.ts` and
 * `simplex.ts` keep, for the same reason: under `noUncheckedIndexedAccess` the
 * alternative is arithmetic on `undefined` that reads as `NaN`, and a `NaN`
 * coordinate propagates to every node placed after it before anything notices.
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

/** A size that must be present. Absence is a runner bug, as in `stages.ts`. */
function requireSize(sizes: ReadonlyMap<NodeId, Size>, id: NodeId): Size {
  const size = sizes.get(id);
  if (size === undefined) throw new InternalLayoutError(`node "${id}" was never sized`);
  return size;
}

/**
 * What a caller may say about a Brandes-Koepf run.
 *
 * Declared `?: T | undefined` rather than `?: T`, which under this repo's
 * `exactOptionalPropertyTypes` are different types: the second rejects an
 * explicitly `undefined` value, which is what a call site building an options
 * object from its own optional field has. `BarycenterOrderOptions` and
 * `NetworkSimplexOptions` both settled the same question the same way.
 */
export interface BrandesKoepfOptions {
  /**
   * Which of the algorithm's layouts to return. Defaults to `'balanced'`, the
   * median of all four, which is what the algorithm is and what
   * {@link brandesKoepfPositionStage} runs. It is `variant` rather than
   * `align` because `'balanced'` is not an alignment: it is the median of four
   * completed layouts, so the name has to be about what comes back rather than
   * about the step in the middle.
   *
   * The four named alignments each return ONE pass: the first word is the
   * direction the alignment runs (`down` aligns a node with the median of its
   * neighbours in the layer ABOVE, sweeping top to bottom; `up` is the mirror
   * image), and the second is the bias, which decides both which median is
   * taken when a node has an even number of neighbours and which side the
   * compaction packs towards.
   *
   * It exists for two reasons and neither is symmetry with another stage. The
   * spacing invariant is a property of EACH pass, not only of the median of the
   * four, so the test suite has to be able to run one; see the compaction
   * section of {@link brandesKoepfPosition}, where the counterexample that
   * decided the compaction is an up-left one and is invisible to a caller who
   * can only ask for the median. And a single pass is the cheap answer: four
   * passes cost 7.0x one of them in solve time on the 10k corpus and 6.3x on
   * the 1k, and buy 45% and 21% of the total edge length back.
   *
   * @throws {InvalidConfigError} when it is not one of the five names. Checked
   * when the stage is built rather than when it runs, so a bad value fails at
   * the call that named it, which is the rule `maxSweeps` and `maxIterations`
   * already keep. `InvalidConfigError` and not a `RangeError`: this package has
   * one error family and one member of it meaning "the caller handed in
   * nonsense". See `errors.ts`.
   */
  readonly variant?: 'balanced' | 'down-left' | 'down-right' | 'up-left' | 'up-right' | undefined;
}

/** The layout a run settled on: the option with its default filled in. */
type Variant = NonNullable<BrandesKoepfOptions['variant']>;

/** The variant, checked at the call that named it. */
function resolveVariant(variant: BrandesKoepfOptions['variant']): Variant {
  if (variant === undefined || variant === 'balanced') return 'balanced';
  if (!ALIGNMENTS.includes(variant)) {
    throw new InvalidConfigError(
      'variant',
      variant,
      'option',
      `one of ${["'balanced'", ...ALIGNMENTS.map((name) => `'${name}'`)].join(', ')}`,
    );
  }
  return variant;
}

/**
 * The whole problem as flat arrays, built once per run.
 *
 * Node numbers are assigned LAYER BY LAYER and left to right within a layer, so
 * a layer is a contiguous run of numbers and a node's position in its layer is
 * `number - layerStart[layer]`. That is what lets every loop below index by
 * number alone: the node to the left of `v` is `v - 1` when `v` is not the
 * first of its layer, and a neighbour list sorted numerically is sorted by
 * position, because the neighbours of one node in one gap all sit in one layer.
 *
 * Everything after this reads numbers, so no pass touches a string, a `Map`, or
 * the graph. Building it is the larger half of the stage's cost, and it is the
 * half all four passes share; see the cost section of
 * {@link brandesKoepfPosition} for the split and for what it was measured on.
 */
interface PositionIndex {
  /** Node number to id, in layer order. */
  readonly ids: readonly NodeId[];
  /** Layer `l` holds the numbers `layerStart[l]` up to `layerStart[l + 1]`. */
  readonly layerStart: Int32Array;
  readonly layerOf: Int32Array;
  readonly widths: Float64Array;
  /** Adjacent-layer neighbours one layer up, and one layer down, by position. */
  readonly upStart: Int32Array;
  readonly upNext: Int32Array;
  readonly upSegment: Int32Array;
  readonly downStart: Int32Array;
  readonly downNext: Int32Array;
  readonly downSegment: Int32Array;
  /** One flag per segment: whether it is in a type 1 conflict. See below. */
  readonly marked: Uint8Array;
}

/**
 * A CSR adjacency from a list of (owner, neighbour) pairs, each owner's
 * neighbours sorted by node number, which is sorted by position.
 *
 * Two counting sorts rather than one and a comparator: the entries are ordered
 * by NEIGHBOUR first, then distributed into the owner buckets in that order,
 * and a counting sort is stable, so each bucket comes out sorted. Sorting each
 * bucket instead would mean either a comparator per bucket or packing two
 * indices into one double, and the packed key on a large graph is a product of
 * two node numbers being divided back apart, which is where an off-by-one in
 * the last bit of a double lives.
 *
 * `segment` is the entry's index in the caller's own pair list, which is the
 * segment id the type 1 marks are keyed by. It is carried here because a
 * segment appears in both directions' arrays and a mark set from one has to be
 * visible from the other.
 */
function compress(
  owner: readonly number[],
  neighbour: readonly number[],
  count: number,
): { start: Int32Array; next: Int32Array; segment: Int32Array } {
  const byNeighbour = new Int32Array(owner.length);
  const tally = new Int32Array(count + 1);
  for (const node of neighbour) tally[node + 1] = at(tally, node + 1) + 1;
  for (let node = 0; node < count; node += 1) {
    tally[node + 1] = at(tally, node + 1) + at(tally, node);
  }
  for (const [index, node] of neighbour.entries()) {
    byNeighbour[at(tally, node)] = index;
    tally[node] = at(tally, node) + 1;
  }

  const start = new Int32Array(count + 1);
  for (const node of owner) start[node + 1] = at(start, node + 1) + 1;
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node + 1) + at(start, node);
  }
  const cursor = start.slice(0, count);
  const next = new Int32Array(owner.length);
  const segment = new Int32Array(owner.length);
  for (const index of byNeighbour) {
    const node = at(owner, index);
    const slot = at(cursor, node);
    next[slot] = at(neighbour, index);
    segment[slot] = index;
    cursor[node] = slot + 1;
  }
  return { start, next, segment };
}

function buildIndex(input: OrderedState): PositionIndex {
  let count = 0;
  for (const layer of input.layers) count += layer.length;

  const ids: NodeId[] = [];
  const numberOf = new Map<NodeId, number>();
  const layerStart = new Int32Array(input.layers.length + 1);
  const layerOf = new Int32Array(count);
  const widths = new Float64Array(count);
  for (const [layer, members] of input.layers.entries()) {
    for (const id of members) {
      const number = ids.length;
      numberOf.set(id, number);
      ids.push(id);
      layerOf[number] = layer;
      widths[number] = requireSize(input.sizes, id).width;
    }
    layerStart[layer + 1] = ids.length;
  }

  // One pass over the drawing's SEGMENTS, keeping the ones that join adjacent
  // layers. Segments and not edges: an edge the rank stage split is drawn as
  // its chain, so it contributes one segment per gap it crosses rather than
  // being dropped whole by the adjacent-layer test. `segments.ts` holds that
  // rule for this file, `order.ts` and `countCrossings` alike.
  //
  // It is also what makes the marking pass below able to find anything. An
  // inner segment is one whose BOTH endpoints are virtual, and the only place
  // two dummies are ever joined is inside a chain, so an index built from the
  // graph's edges alone has none by construction however many dummies the
  // roster holds.
  //
  // Which way the caller authored an edge is not consulted: an edge the ranker
  // reversed joins the same two layers, so a segment always runs from the
  // endpoint in the upper layer to the one in the lower, which is the stance
  // `countCrossings` already takes. A self loop puts both ends on one layer and
  // is dropped by the same test.
  const upper: number[] = [];
  const lower: number[] = [];
  forEachSegment(input.graph, input.virtualChains, (fromId, toId) => {
    const source = numberOf.get(fromId);
    const target = numberOf.get(toId);
    if (source === undefined || target === undefined) return;
    const sourceLayer = at(layerOf, source);
    const targetLayer = at(layerOf, target);
    if (Math.abs(sourceLayer - targetLayer) !== 1) return;
    const down = sourceLayer < targetLayer;
    upper.push(down ? source : target);
    lower.push(down ? target : source);
  });

  const up = compress(lower, upper, count);
  const down = compress(upper, lower, count);
  return {
    ids,
    layerStart,
    layerOf,
    widths,
    upStart: up.start,
    upNext: up.next,
    upSegment: up.segment,
    downStart: down.start,
    downNext: down.next,
    downSegment: down.segment,
    marked: new Uint8Array(upper.length),
  };
}

/**
 * Marks every type 1 conflict, which is a non-inner segment crossing an inner
 * one. Algorithm 1 of the paper, over every gap rather than over the interior
 * ones.
 *
 * An INNER SEGMENT joins two nodes the caller never added, and the only place
 * two dummies are ever joined is INSIDE A CHAIN. So this pass had nothing to
 * mark for as long as the index was built from `input.graph.edges()`, whatever
 * the roster held: no graph edge touches a dummy. It marks real conflicts now
 * that the index is built from the drawing's segments, which is what
 * `segments.ts` supplies, and an edge spanning three or more gaps is the
 * smallest thing that produces one.
 *
 * It was written and tested before it could fire, on the argument that a pass
 * first executed by the milestone that depends on it is not a pass that
 * milestone should have to debug. That turned out to be two milestones rather
 * than one, and the argument held across both.
 *
 * The rule: a dummy chain is meant to come out straight, so where a chain and
 * an ordinary edge disagree the chain wins. Marking the ordinary segment is how
 * that is enforced, because the alignment below refuses to follow a marked
 * segment, so the crossing edge cannot take the position bound that the chain
 * needs.
 *
 * The walk is the paper's. For each gap the lower layer is read left to right,
 * and the nodes between two consecutive inner segments are checked against the
 * window those two segments' upper endpoints leave: an upper neighbour outside
 * the window is on the far side of an inner segment, which is what a crossing
 * is. `k0` is the previous window edge and `k1` the next, and the final stretch
 * uses the last position of the upper layer, which is why a gap with no inner
 * segment marks nothing: no position is outside `0` to `count - 1`.
 *
 * The paper runs this over the interior gaps only, which is sound for the
 * layering a Sugiyama pipeline hands it, where the first layer holds no dummy.
 * Nothing here promises that: a rank stage may declare a virtual node anywhere,
 * so every gap is walked. The extra gaps cost one pass over their segments and
 * cannot mark anything they should not, by the sentence above.
 *
 * A node incident to two inner segments in one gap takes the first, which the
 * paper's setting makes unreachable: a dummy has exactly one predecessor.
 */
function markTypeOneConflicts(index: PositionIndex, virtual: Uint8Array): void {
  const { layerStart, upStart, upNext, upSegment, marked } = index;
  for (let gap = 0; gap + 2 < layerStart.length; gap += 1) {
    const upperFirst = at(layerStart, gap);
    const lowerFirst = at(layerStart, gap + 1);
    const lowerLast = at(layerStart, gap + 2);
    const upperCount = lowerFirst - upperFirst;
    if (upperCount === 0) continue;
    let window = 0;
    let pending = lowerFirst;
    for (let node = lowerFirst; node < lowerLast; node += 1) {
      let inner = -1;
      if (at(virtual, node) === 1) {
        for (let slot = at(upStart, node); slot < at(upStart, node + 1); slot += 1) {
          const neighbour = at(upNext, slot);
          if (at(virtual, neighbour) === 1) {
            inner = neighbour;
            break;
          }
        }
      }
      if (inner < 0 && node + 1 < lowerLast) continue;
      const edge = inner < 0 ? upperCount - 1 : inner - upperFirst;
      for (; pending <= node; pending += 1) {
        for (let slot = at(upStart, pending); slot < at(upStart, pending + 1); slot += 1) {
          const position = at(upNext, slot) - upperFirst;
          if (position < window || position > edge) marked[at(upSegment, slot)] = 1;
        }
      }
      window = edge;
    }
  }
}

/**
 * One pass: align each node with the median of its neighbours on one side, then
 * compact the blocks that leaves. Writes one coordinate per node into `x`.
 *
 * `downward` picks the side a node aligns to, the layer above when it is true,
 * and `leftward` picks the bias. The right-biased passes run the SAME code in a
 * mirrored coordinate space, where the node to the left is `v + 1` and a
 * position compares by `-v`, and negate at the end; there is no second copy of
 * the alignment or of the compaction to keep in step with the first.
 *
 * THE ALIGNMENT is Algorithm 2 of the paper. Each layer is walked in the
 * oriented left-to-right order and each node takes its median neighbour on the
 * chosen side, or both medians in turn when it has an even number of them. It
 * takes one only if the running bound `r` allows, which is what keeps the
 * blocks from crossing: an alignment that reached back past a neighbour already
 * used would produce two blocks that swap sides between two layers, and the
 * compaction below assumes they cannot. Marked segments are skipped and do not
 * move the bound.
 *
 * THE COMPACTION is a longest path over the blocks, and is NOT the paper's, for
 * the reason argued at {@link brandesKoepfPosition}. Each block is placed at the
 * greatest of its members' left neighbours' block coordinate plus the
 * separation that pair requires, which is exactly the constraint the spacing
 * invariant states, so the invariant is a property of the arithmetic rather
 * than something to check afterwards. Blocks are placed by an iterative
 * depth-first walk with an explicit stack, because the recursion the paper
 * writes it as is one frame per block on a chain of blocks, and a 10,000 node
 * drawing has chains long enough to overflow.
 *
 * The walk terminates because the block graph is ACYCLIC, which is what the
 * bound in the alignment buys: two blocks that share a layer sit in the same
 * order in every layer they share, so "immediately left of" cannot cycle. A
 * block found on the stack again would be a cycle, and a cycle would be a bug
 * in the alignment rather than anything a caller did, so it raises
 * {@link InternalLayoutError} rather than reading a coordinate that is not
 * finished yet.
 */
function solve(
  index: PositionIndex,
  nodeSep: number,
  downward: boolean,
  leftward: boolean,
  x: Float64Array,
): void {
  const count = index.ids.length;
  const layerCount = index.layerStart.length - 1;
  const start = downward ? index.upStart : index.downStart;
  const next = downward ? index.upNext : index.downNext;
  const segment = downward ? index.upSegment : index.downSegment;
  const sign = leftward ? 1 : -1;

  const root = new Int32Array(count);
  const align = new Int32Array(count);
  for (let node = 0; node < count; node += 1) {
    root[node] = node;
    align[node] = node;
  }

  for (let step = 1; step < layerCount; step += 1) {
    const layer = downward ? step : layerCount - 1 - step;
    const first = at(index.layerStart, layer);
    const last = at(index.layerStart, layer + 1);
    let bound = Number.NEGATIVE_INFINITY;
    for (let offset = 0; offset < last - first; offset += 1) {
      const node = leftward ? first + offset : last - 1 - offset;
      const from = at(start, node);
      const to = at(start, node + 1);
      const degree = to - from;
      if (degree === 0) continue;
      // The one or two median neighbours, in the oriented order: the mirrored
      // pair of `(degree - 1) / 2` rounded both ways is that same pair read
      // backwards, because the two indices sum to `degree - 1`.
      const low = (degree - 1) >> 1;
      const high = degree - 1 - low;
      for (let median = 0; median <= high - low; median += 1) {
        if (at(align, node) !== node) break;
        const slot = from + (leftward ? low + median : high - median);
        if (at(index.marked, at(segment, slot)) === 1) continue;
        const neighbour = at(next, slot);
        if (bound >= sign * neighbour) continue;
        align[neighbour] = node;
        root[node] = at(root, neighbour);
        align[node] = at(root, node);
        bound = sign * neighbour;
      }
    }
  }

  // One coordinate per BLOCK, read back through `root` at the end. Written
  // into its own array rather than into `x`, because a block's root can sit
  // either side of its members in the numbering (above them going down, below
  // them going up), so a pass that expanded the blocks in place would read
  // entries it had already rewritten.
  const blockX = new Float64Array(count);
  // 0 not reached, 1 on the stack, 2 placed. See the cycle guard below.
  const state = new Uint8Array(count);
  const cursor = new Int32Array(count);
  const stack: number[] = [];
  for (let block = 0; block < count; block += 1) {
    if (at(root, block) !== block || at(state, block) !== 0) continue;
    stack.push(block);
    while (stack.length > 0) {
      const head = at(stack, stack.length - 1);
      if (at(state, head) === 0) {
        state[head] = 1;
        cursor[head] = head;
      }
      for (;;) {
        const member = at(cursor, head);
        const layer = at(index.layerOf, member);
        const beside = leftward ? member - 1 : member + 1;
        const inside = leftward
          ? beside >= at(index.layerStart, layer)
          : beside < at(index.layerStart, layer + 1);
        if (inside) {
          const other = at(root, beside);
          const reached = at(state, other);
          if (reached === 0) {
            stack.push(other);
            break;
          }
          if (reached === 1) {
            throw new InternalLayoutError(
              `block ${String(other)} is left of itself in the alignment`,
            );
          }
          const delta = nodeSep + (at(index.widths, beside) + at(index.widths, member)) / 2;
          blockX[head] = Math.max(at(blockX, head), at(blockX, other) + delta);
        }
        cursor[head] = at(align, member);
        if (at(cursor, head) === head) {
          state[head] = 2;
          stack.pop();
          break;
        }
      }
    }
  }

  for (let node = 0; node < count; node += 1) x[node] = sign * at(blockX, at(root, node));
}

/**
 * The balanced layout: each node at the median of its four candidates, after
 * the four have been aligned to a common reference.
 *
 * The reference is the NARROWEST of the four, and the other three are shifted
 * onto it, left-biased layouts by their left edge and right-biased ones by
 * their right edge. Without that the four are four different translations of
 * the drawing and their median is meaningless. Dagre balances the same way.
 *
 * With four candidates the median is the average of the middle two, and that
 * average CANNOT break the spacing invariant, which is why the invariant is a
 * property of this stage rather than of one pass of it. Every candidate has
 * `x[v] >= x[u] + delta` for a node `u` immediately left of `v`, and order
 * statistics keep a pointwise inequality: the i-th smallest of `v`'s candidates
 * is at least the i-th smallest of `u`'s plus `delta`, for every i, so the
 * average of the middle two keeps it too. A translation cannot break it either.
 */
function balance(candidates: readonly Float64Array[], widths: Float64Array): Float64Array {
  const count = widths.length;
  const lefts: number[] = [];
  const rights: number[] = [];
  let reference = 0;
  let narrowest = Number.POSITIVE_INFINITY;
  for (const [index, xs] of candidates.entries()) {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let node = 0; node < count; node += 1) {
      const half = at(widths, node) / 2;
      left = Math.min(left, at(xs, node) - half);
      right = Math.max(right, at(xs, node) + half);
    }
    lefts.push(left);
    rights.push(right);
    if (right - left < narrowest) {
      narrowest = right - left;
      reference = index;
    }
  }
  for (const [index, xs] of candidates.entries()) {
    if (index === reference) continue;
    const leftBiased = index % 2 === 0;
    const shift = leftBiased
      ? at(lefts, reference) - at(lefts, index)
      : at(rights, reference) - at(rights, index);
    if (shift === 0 || !Number.isFinite(shift)) continue;
    for (let node = 0; node < count; node += 1) xs[node] = at(xs, node) + shift;
  }
  const balanced = new Float64Array(count);
  const four = new Float64Array(candidates.length);
  for (let node = 0; node < count; node += 1) {
    for (const [index, xs] of candidates.entries()) four[index] = at(xs, node);
    four.sort();
    balanced[node] = (at(four, 1) + at(four, 2)) / 2;
  }
  return balanced;
}

/**
 * The centre line of each row, which is `gridPositionStage`'s arithmetic and
 * has to stay it: a layer's nodes share a centre line, a row is as tall as its
 * tallest node, rows are `rankSep` apart edge to edge, and the stack starts at
 * `y = 0`. A short node sits centred in a tall row rather than hanging from its
 * top.
 */
function rowCentres(input: OrderedState): Float64Array {
  const centres = new Float64Array(input.layers.length);
  let top = 0;
  for (const [layer, members] of input.layers.entries()) {
    let height = 0;
    for (const id of members) height = Math.max(height, requireSize(input.sizes, id).height);
    centres[layer] = top + height / 2;
    top += height + input.config.rankSep;
  }
  return centres;
}

/**
 * Builds a position stage that assigns horizontal coordinates by Brandes and
 * Koepf's method: mark the type 1 conflicts, align each node with the median of
 * its neighbours four ways, compact each alignment, and take the median of the
 * four.
 *
 * `brandesKoepfPositionStage` is this with no options, and is what to reach for
 * unless a run needs one named alignment rather than the median of all four.
 *
 * It is a factory for one reason, and it is not symmetry with
 * `networkSimplexRank` or `barycenterOrder`: those two are factories because M3
 * and M3.6 warm start a run from state the caller passes in, and there is no
 * warm start here. {@link BrandesKoepfOptions.variant} is the whole reason.
 * Whether to spend four passes or one is a cost and quality trade a single call
 * site makes, about 6.3x to 7x the solve time and 1.6x to 2.1x the whole stage
 * for 21% of the horizontal edge length on the 1k and 45% on the 10k, and there
 * is no one answer to freeze into a second shared stage.
 *
 * ## NOT THE DEFAULT, NOT EXPORTED, and not an improvement on today's graphs
 *
 * `defaultStages.position` is still `gridPositionStage`, and this section is why
 * rather than an apology for it. The reason is structural and it is measured.
 * The same measurement is why nothing here is exported from the package:
 * `index.ts`'s rule names a stage a caller CHOOSES BETWEEN, and by the table
 * below no caller should choose this one yet. Adding the export when the
 * measurement turns round is additive; removing one is not.
 * `insertionOrderStage` is the precedent, real and tested and deliberately
 * unexported.
 *
 * **BK aligns a node with the MEDIAN OF ITS NEIGHBOURS IN THE ADJACENT LAYER,
 * so an edge that spans more than one rank joins no adjacent pair of layers and
 * is invisible to it.** Today that is most of them: 1,324 of the 1k corpus's
 * 4,000 edges span exactly one rank (33.1%) and 10,528 of the 10k's 40,000
 * (26.3%). It is the same blind spot `countCrossings` has, described in the same
 * words in `order.ts`, and it had the same cure: splitting every long edge into
 * a chain makes every edge span exactly one rank. **THE BLIND SPOT IS GONE.**
 * `buildIndex` below builds its segments from `segments.ts` rather than from
 * `input.graph.edges()`, so an edge with a chain arrives as one segment per gap
 * it crosses and every segment of the drawing is visible here. The two shares
 * above are what this stage saw before that, and they are pre-M2.2c on top of
 * it; over the view that ships they were 1,513 of 4,000 on the 1k and 13,131 of
 * 40,000 on the 10k, and they are now 18,746 and 214,222 segments, all of them
 * adjacent.
 *
 * Measured against `gridPositionStage` on the same two corpora, with everything
 * else the default. Edge length is measured HORIZONTALLY, which is the only part
 * of it either stage decides: both put the rows in the same places, so the
 * vertical component is a constant that would only dilute the comparison.
 *
 * | measure                  | corpus | grid        | this stage    |
 * | ------------------------ | ------ | ----------- | ------------- |
 * | total edge length        | 1k     | 3,793,350   | 10,191,450    |
 * | total edge length        | 10k    | 292,526,025 | 1,297,826,325 |
 * | edge length BK can see   | 1k     | 1,112,700   | 1,246,200     |
 * | edge length BK can see   | 10k    | 44,056,125  | 40,790,550    |
 * | width                    | 1k     | 17,950      | 27,550        |
 * | width                    | 10k    | 165,100     | 264,175       |
 *
 * So it was 2.7x and 4.4x worse on total edge length, and 53% and 60% wider.
 * Even RESTRICTED TO THE EDGES IT COULD SEE it only won one of the two corpora:
 * 12% worse on the 1k, 7.4% better on the 10k.
 *
 * **THE PREREQUISITE IS MET AND IT DID NOT HELP. IT HURT.** Every figure in
 * that table was taken over a drawing whose long edges were invisible here, and
 * the prediction attached to it was that the chains would fix that. They fixed
 * the visibility and made the comparison worse. Re-measured over a layering
 * with the chains consumed, summing the horizontal component over every SEGMENT
 * of the drawing (which is not the table's quantity, so read the ratios and not
 * the levels): on the 10k this stage is 15.91x `gridPositionStage`'s segment
 * length and 13.81x its width, against 9.41x and 4.53x over the same corpus
 * ordered without the chains, a baseline that still PLACES the dummies and
 * differs from the table above in that as well as in the ordering, so neither
 * its lengths nor its widths are the table's. On the 1k, 8.03x and 8.61x against 3.63x and
 * 2.76x. Both stages improved in absolute terms and grid improved far more.
 *
 * WHY IS NOT ESTABLISHED, and the suspect is named below rather than guessed at
 * here: a chain is exactly the long alignment block this algorithm is built to
 * straighten, and what ships compacts each alignment by longest path over the
 * block order because the paper's class shift is unsound. A long block under a
 * longest-path compaction pushes everything after it, and the chains made the
 * blocks long. That is a hypothesis with an obvious experiment attached and it
 * has not been run.
 *
 * So this stage stays unexported and not the default, on a stronger reason than
 * it had before rather than the same one, and the erratum-shaped compaction task
 * below is now the thing blocking it rather than the ranker.
 *
 * ## What it costs
 *
 * The spike this stage was measured in put it at 0.780ms on the 1k and 10.395ms
 * on the 10k for the stage alone, which is 19.5% and 20.5% of the committed
 * `pipeline` entries in `bench/baseline.json` (4.004ms and 50.599ms), and
 * decomposed the 10k as 5.12ms building the adjacent-layer index and 3.85ms of
 * Brandes-Koepf proper. The index was the larger half, and it is the half the
 * four passes share.
 *
 * **The code that ships is faster than the code those numbers came off, and the
 * difference is the index**, so both are here rather than one quietly standing
 * in for the other. This one measures 0.590ms and 4.491ms, median of 15 timed
 * runs of `run` alone after 5 warmups, against the `OrderedState` a default
 * pipeline produces for each corpus. The spike reoriented the whole layering
 * for each of the four passes and held one neighbour array per node; here the
 * numbering makes a layer a contiguous run, so a mirrored pass is an index
 * transform and nothing is copied per pass. That moves the ratios in the next
 * section with it. Take either as one machine's measurement rather than as a
 * baseline: `bench/baseline.json` is what anything regresses against, and its
 * `pipeline` entries measure the default pipeline, which does not run this
 * stage.
 *
 * ## The four passes are worth their cost
 *
 * Solve time only, they are about 7x one downward left-biased pass: 3.85ms
 * against 0.554ms on the 10k, and 6.3x on the 1k, 0.370ms against 0.059ms. The
 * shared index build takes that back to about 1.6x for the whole stage
 * (10.395ms against 6.538ms, and 0.780ms against 0.479ms; 4.491 against 2.810
 * for the shipping form, and 2.1x on its 1k, 0.590 against 0.278). What they
 * buy is 21% of total edge length on the 1k (12,961,500 to 10,191,450) and 45%
 * on the 10k (2,371,358,550 to 1,297,826,325), and a far narrower drawing:
 * 41,050 to 27,550 and 442,900 to 264,175. A single pass is reachable through
 * {@link BrandesKoepfOptions.variant} for a caller who wants that trade.
 *
 * ## The compaction is NOT the paper's, and this is the part to read
 *
 * **The class shift as published is unsound.** `place_block` records
 * `shift[sink[u]] = min(shift[sink[u]], x[v] - x[root[u]] - delta)` and applies
 * it once, so a class shifted against another class that is ITSELF shifted later
 * ends up short by the parent's shift. Randomised search over layerings found
 * this minimal counterexample, in the up direction with the left bias, all
 * widths 100 and `nodeSep` 50:
 *
 * ```
 * layers [3, 2, 3, 2], edges [[1, 4], [2, 3], [2, 4], [3, 6], [4, 6], [7, 9]]
 * ```
 *
 * Nodes 0 and 1 both land at x = 150: a 100-unit overlap where 150 units of gap
 * were required. It is pinned in `test/layout.position.test.ts`. Composing the
 * shifts transitively through a recorded parent class fixes that case and is
 * still not sound: it left 162 classes shifted against more than one parent on
 * the 10k corpus and one residual 25-unit overlap.
 *
 * State it precisely rather than as "the paper is wrong": what fails is a SINGLE
 * PASS of `min` over sinks, applied once. The published erratum resolves the
 * shifts by longest path over a proper class graph, which is sound, and building
 * that is a task in its own right rather than something to attempt inside this
 * milestone. **THAT IS THE NAMED NEXT STEP HERE**, and what it is worth is
 * measured: the class form reaches 28,559,325 of adjacent-layer edge length on
 * the 10k where this one reaches 40,790,550, which is 30% better. That 30% is
 * NOT CLAIMABLE, because the layout it comes from overlaps.
 *
 * What ships instead is a longest path over the block order, at
 * {@link solve}: for each node `v` with left neighbour `u` in its layer,
 * `x[root[v]] = max(x[root[v]], x[root[u]] + delta)`, with every left
 * neighbour's block placed first. The block order is acyclic, so this is a
 * longest path over a DAG and it CANNOT overlap. It was clean on both corpora
 * and over 60,000 random layerings crossed with all four alignments. On these
 * corpora it costs almost nothing in width: 27,550 against the class form's
 * 26,725 on the 1k, 3% wider, and the 10k is actually NARROWER, 264,175 against
 * 264,400.
 *
 * ## Spacing, and what it is a property of
 *
 * Two boxes side by side in a layer come out at least `nodeSep` apart edge to
 * edge, so their centres are `(width(u) + width(v)) / 2 + nodeSep` apart or
 * more, in the layer's own left-to-right order. That is stronger than "no two
 * boxes overlap" and it is what the suite asserts. It holds by construction in
 * each pass, because it is the constraint the compaction takes the longest path
 * over, and it survives the balancing by an order-statistics argument written
 * out at {@link balance}.
 *
 * The one hedge is the usual one, and it is the representation's rather than the
 * placement's: a position is a CENTRE, a consumer recovers an edge as
 * `x + width / 2`, and that round trip is not always exact. See
 * `gridPositionStage` and `docs/docs/layout.md`.
 *
 * The drawing is NOT centred on `x = 0`. `gridPositionStage` centres every row
 * on the origin; there is no such freedom here, because the whole point is that
 * a node's coordinate is decided by its neighbours in other layers. The
 * coordinates come out where the compaction put them, and `bounds` covers them
 * wherever that is.
 *
 * ## Determinism
 *
 * Same layering, same coordinates. Node numbers are the layers' own order, the
 * medians are taken by index rather than by any comparison that could tie, and
 * nothing is sorted except four doubles per node in the balancing step. The one
 * value that needs care is negative zero, which the mirrored passes produce
 * whenever a coordinate lands exactly on the origin: it is normalised to `0` on
 * the way out, because `-0` and `0` are equal under `===` and different under
 * `Object.is`, and M3's diff is the caller that would notice.
 *
 * @throws {InvalidConfigError} when `variant` is not one of the five names it
 * takes.
 */
export function brandesKoepfPosition(options?: BrandesKoepfOptions): PositionStage {
  const variant = resolveVariant(options?.variant);
  return {
    name: 'brandes-koepf-position',
    run(input) {
      const index = buildIndex(input);
      const count = index.ids.length;

      // The marking pass is skipped when the roster holds nothing the caller
      // did not add, because an inner segment needs two such nodes. That was
      // every graph until the rank stage started splitting long edges, and is
      // now only a graph with no long edge in it.
      if (input.virtualNodes.size > 0) {
        const virtual = new Uint8Array(count);
        for (const [number, id] of index.ids.entries()) {
          if (input.virtualNodes.has(id)) virtual[number] = 1;
        }
        markTypeOneConflicts(index, virtual);
      }

      const { nodeSep } = input.config;
      let xs: Float64Array;
      if (variant === 'balanced') {
        const candidates = ALIGNMENTS.map((name) => {
          const coordinates = new Float64Array(count);
          solve(index, nodeSep, name.startsWith('down'), name.endsWith('left'), coordinates);
          return coordinates;
        });
        xs = balance(candidates, index.widths);
      } else {
        xs = new Float64Array(count);
        solve(index, nodeSep, variant.startsWith('down'), variant.endsWith('left'), xs);
      }

      const centres = rowCentres(input);
      const positions = new Map<NodeId, Point>();
      for (let node = 0; node < count; node += 1) {
        const x = at(xs, node);
        positions.set(idAt(index.ids, node), {
          // `-0`, which a mirrored pass makes out of a coordinate on the
          // origin, normalised to `0`: the two are equal under `===` and not
          // under `Object.is`, and a caller diffing two runs reads the second.
          x: x === 0 ? 0 : x,
          y: at(centres, at(index.layerOf, node)),
        });
      }
      return { positions };
    },
  };
}

/**
 * The Brandes-Koepf position stage with no options: all four alignments and the
 * median between them. See {@link brandesKoepfPosition}, which is where all of
 * it is argued, including why this is not `defaultStages.position` and what
 * selecting it costs on today's graphs.
 *
 * Frozen, for the reason `defaultStages` and `barycenterOrderStage` are: it is
 * one object shared by every run in the process, and a stage's `name` is quoted
 * in every `StageContractError` the runner raises against it, so an assignment
 * to it anywhere would be an assignment to it everywhere.
 */
export const brandesKoepfPositionStage: PositionStage = Object.freeze(brandesKoepfPosition());
