import type { NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks } from './acyclic.js';
import type { AcyclicView } from './acyclic.js';
import { authored } from './authorship.js';
import { splitLongEdges } from './chains.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError, InvalidConfigError } from './errors.js';
import type { RankStage } from './types.js';

/**
 * The rank stage that minimises total edge length: Gansner, Koutsofios, North
 * and Vo, "A Technique for Drawing Directed Graphs" (1993), section 2.
 */

/** The iteration budget a stage built with no `maxIterations` runs to. */
const DEFAULT_MAX_ITERATIONS = 20_000;

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node or edge number `acyclicView` minted. Absence is a bug
 * here rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * What a caller may say about a network simplex run.
 *
 * Both are declared `?: T | undefined` rather than `?: T`, which under this
 * repo's `exactOptionalPropertyTypes` are different types: the second rejects
 * an explicitly `undefined` value, and that is exactly what a call site has.
 * On the first run of a session there is no previous ranking to hand over, so
 * the variable holding one is `Map | undefined` by construction, and `?: T`
 * would make the caller build the options object conditionally to say nothing.
 * `@dagr/graph` settled the same question the same way.
 */
export interface NetworkSimplexOptions {
  /**
   * How many pivots the solver may take before returning what it has. Shared
   * across the whole graph rather than granted per connected component.
   * Defaults to 20,000, which converges every graph the test corpus and the 1k
   * bench corpus contain. `Number.POSITIVE_INFINITY` is how to say "run to
   * convergence, however long that takes".
   *
   * The budget is a safety valve rather than a quality knob. Whatever it stops,
   * the ranking returned is feasible, and it is never worse than the
   * longest-path ranking the stage computes before pivoting, which is the cold
   * one when no hint was given.
   *
   * It bounds the PIVOTS and nothing else. The tight tree is grown before the
   * first one and is not counted, which is why the growth carries a bound of
   * its own: see {@link tighten}.
   *
   * @throws {InvalidConfigError} when it is not a whole number of pivots that
   * is zero or greater, and not `Number.POSITIVE_INFINITY`. A count, so 2.5 is
   * rejected rather than truncated and 0.5 is rejected rather than quietly
   * meaning no pivots at all. Checked when the stage is built rather than when
   * it runs, so a bad budget fails at the call that named it.
   */
  readonly maxIterations?: number | undefined;

  /**
   * A previous ranking to start from. A HINT, never trusted: see the warm start
   * section of {@link networkSimplexRank}.
   */
  readonly initialRanks?: ReadonlyMap<NodeId, number> | undefined;
}

/**
 * The floor per node number that a hint asks for, or `undefined` for no hint.
 *
 * Everything unusable is dropped rather than repaired into something else, and
 * dropping is safe because a floor is only ever a preference: the sweep in
 * `longestPathRanks` pushes a node below its predecessors whatever its floor
 * said, so a node whose entry was dropped is constrained by its predecessors
 * alone, exactly as it would be with no hint at all. That is not the same as
 * landing where a cold run would have put it, and it is worth being exact about
 * which is claimed: a floor that survives propagates down the sweep, so a node
 * with no entry of its own still moves when an ancestor of it has one. Three
 * things are dropped, all for the same reason, which is that they carry no
 * information a feasible ranking of THIS graph could use.
 *
 * An id the graph does not hold has no node to be a floor for. A value that is
 * not an integer is not a rank. And a value outside `[-count, count]` is wider
 * than any ranking of `count` nodes needs to be, so honouring one would not
 * express a preference between two optima, it would hand the solver a ranking
 * stretched over a window it then has to pivot back closed, one unit of
 * nonsense per pivot. That is the case that turns a stale hint from a tie-break
 * into a denial of service.
 */
function floorFrom(
  hint: ReadonlyMap<NodeId, number> | undefined,
  view: AcyclicView,
): Int32Array | undefined {
  if (hint === undefined || hint.size === 0) return undefined;
  const count = view.nodes.length;
  const floor = new Int32Array(count);
  for (const [id, value] of hint) {
    const number = view.numbers.get(id);
    if (number === undefined) continue;
    if (!Number.isInteger(value) || value < -count || value > count) continue;
    floor[number] = value;
  }
  return floor;
}

/**
 * The budget, checked at the call that named it: a whole number of pivots that
 * is not negative, or an infinite one.
 *
 * `Number.isInteger` rather than `Number.isFinite`, and it subsumes the finite
 * check: 2.5 pivots is not a count, and 0.5 is a budget of none at all dressed
 * up as a budget of some. Infinity is the exception because it is the one value
 * that is not a count and still means something here, which is to run until the
 * pivots stop rather than until a number does.
 */
function resolveBudget(maxIterations: number | undefined): number {
  if (maxIterations === undefined) return DEFAULT_MAX_ITERATIONS;
  const counted = Number.isInteger(maxIterations) || maxIterations === Number.POSITIVE_INFINITY;
  if (!counted || maxIterations < 0) {
    throw new InvalidConfigError(
      'maxIterations',
      maxIterations,
      'option',
      'a whole number of pivots that is zero or greater, or Number.POSITIVE_INFINITY',
    );
  }
  return maxIterations;
}

/**
 * Moves a feasible ranking to one of minimum total edge length, in place.
 *
 * The ranking handed in has to be feasible already, which is what
 * `longestPathRanks` guarantees whatever floor it was given. Everything here is
 * a rank shift of one side of a cut, and every shift preserves feasibility, so
 * the array is a feasible ranking at every point in the run and the caller can
 * stop it anywhere.
 *
 * ## The cut value, and why there is no leaf elimination here
 *
 * The textbook computes a tree edge's cut value by eliminating leaves. There is
 * a shorter route. For a tree edge `f` joining `p` to its child `c`, let `S` be
 * the node set of `c`'s subtree, and give every node `v` the weight
 * `netInflow(v) = indegree(v) - outdegree(v)` over the view's edges. Then
 *
 *     sum over v in S of netInflow(v) = (edges entering S) - (edges leaving S)
 *
 * because an edge with both endpoints in `S` is counted once each way and
 * cancels, an edge entering `S` is counted once as an in-degree, and an edge
 * leaving `S` once as an out-degree. The cut value of `f` is defined as the
 * edges running from `f`'s tail side to its head side minus those running back,
 * so it is that sum when `f` runs `p -> c` (the tail side is then everything
 * outside `S`) and its negation when `f` runs `c -> p`. One postorder
 * accumulation therefore gives every cut value in the tree, and the sign
 * depends only on which way `f` points, which is the part worth reading twice:
 * a sign error here does not produce a wrong answer, it produces a confident
 * pessimiser, and `test/layout.simplex.test.ts` compares these numbers against
 * cut values counted edge by edge for exactly that reason.
 *
 * ## What the tight tree costs, and what the budget does not bound
 *
 * The budget counts PIVOTS, and the tree is grown before the first one, so
 * `maxIterations` bounds none of this section and a caller cannot ask for less
 * of it.
 *
 * The obvious growth is quadratic and this is not it. Rescanning every node
 * already in the tree at every stall, to find the crossing edge of least slack,
 * is Theta(V * E) on a chain with one extra source hanging off every link:
 * every source sits at rank 0 and every link one rank lower than the last, so
 * no two of the crossing slacks are equal, each stall admits exactly one node,
 * and the tree that gets rescanned is half the graph by the end. With the
 * budget at zero, so that the growth is all that ran, that cost 1.8 seconds at
 * 8,000 nodes and 21 seconds at 32,000, against 18ms and 50ms for the whole of
 * `longestPathRankStage` on the same two graphs.
 *
 * What runs instead is O(E log E) for a component, and it is 23ms and 65ms on
 * those two. Every edge crossing out of the tree sits in one of two heaps, by
 * whether it runs out of the tree or into it, and a node feeds the heaps as it
 * JOINS: an edge whose other endpoint is already in the tree is internal, and
 * since nothing ever leaves the tree it will never cross again, so it is never
 * pushed. A shift moves every tree node together, so within one direction class
 * every crossing slack moves by the same amount, `-shift` out of the tree and
 * `+shift` into it. Each heap therefore carries a running offset and stores a
 * key that the offset has been taken out of, which no later shift changes, so
 * heap order stays current-slack order for the whole growth and the price of a
 * whole heap is one subtraction. An entry whose outside endpoint has since
 * joined is dropped when it reaches the top rather than deleted where it lies,
 * which is what keeps a decrease-key out of this. Each edge is pushed at most
 * once and popped at most once.
 *
 * The shifts are recorded rather than performed, which is the other half of the
 * same bound: shifting the tree at each stall is O(V) a stall and quadratic
 * over a run of them. Each node keeps the running total it joined at, which is
 * the share of the shifting that happened before it and therefore does not
 * apply to it, and one pass at the end applies the rest.
 *
 * ## Cost per pivot
 *
 * A pivot exchanges `f` for a non-tree edge crossing the same cut the other
 * way, and the PARTITION into `S` and the rest does not change: only the edge
 * joining the two sides, and how `S` is rooted inside itself. So the work is
 * proportional to `S` and to the edges incident to it, not to the graph:
 * `S` is walked to mark it, the entering candidates are enumerated from `S`'s
 * own nodes rather than by scanning every edge, `S` alone is shifted, and `S`
 * alone is re-rooted. Outside `S` only the two paths from the old and the new
 * attachment point up to their common ancestor change, by plus or minus the one
 * subtree sum, which is why the tree is kept rooted at a node that is never in
 * `S`: the root is the component's first node, and `S` is always a subtree of
 * one of its descendants.
 *
 * What that leaves O(V) per pivot is the search for a tree edge with a negative
 * cut value, which is the paper's own weak spot too. It resumes where the last
 * one left off and wraps rather than restarting at the first node, which is
 * what the paper recommends, but the bound is the bound: a structure that keeps
 * the candidates is the next thing to try if a measurement asks for it. That
 * one the budget does bound, at `maxIterations` searches.
 *
 * ## Determinism
 *
 * Same graph, same ranks, always, and every tie is broken by the graph's own
 * iteration order. Components are visited in node insertion order and each is
 * rooted at its first node. The tight tree grows by taking the crossing edge of
 * minimum slack, and among equal slacks the one added to the graph first,
 * compared by edge number rather than by the order the incidence lists or the
 * heaps happen to reach it. The leave-edge search walks the component's nodes
 * in insertion order, resuming after the last edge it found. The entering edge
 * is chosen by the same rule as the growth: minimum slack, then lowest edge
 * number, so the answer does not depend on the shape of the tree at the time.
 */
function tighten(view: AcyclicView, rank: Int32Array, budget: number): void {
  const { from, to } = view;
  const count = view.nodes.length;
  const edgeCount = from.length;
  if (count === 0) return;

  // Undirected incidence as CSR: every edge appears under both endpoints. The
  // simplex walks a SPANNING TREE, which ignores direction, and rebuilding an
  // adjacency per pivot is what the whole cost argument above is about.
  const start = new Int32Array(count + 1);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    start[at(from, edge) + 1] = at(start, at(from, edge) + 1) + 1;
    start[at(to, edge) + 1] = at(start, at(to, edge) + 1) + 1;
  }
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node + 1) + at(start, node);
  }
  const cursor = start.slice(0, count);
  const incident = new Int32Array(edgeCount * 2);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(from, edge);
    incident[at(cursor, source)] = edge;
    cursor[source] = at(cursor, source) + 1;
    const target = at(to, edge);
    incident[at(cursor, target)] = edge;
    cursor[target] = at(cursor, target) + 1;
  }
  const other = (edge: number, node: number): number =>
    at(from, edge) === node ? at(to, edge) : at(from, edge);
  const slackOf = (edge: number): number =>
    at(rank, at(to, edge)) - at(rank, at(from, edge)) - 1;

  // indegree - outdegree per node, which is every cut value in the tree once it
  // has been summed over a subtree. See the identity above.
  const netInflow = new Int32Array(count);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    netInflow[at(to, edge)] = at(netInflow, at(to, edge)) + 1;
    netInflow[at(from, edge)] = at(netInflow, at(from, edge)) - 1;
  }

  // Every walk below is a depth-first one over distinct nodes, so one array of
  // node numbers with a top index serves them all, and no `pop` returns
  // `undefined` for a defensive branch to have an opinion about.
  const stack = new Int32Array(count);
  let top = 0;

  // Connected components of the UNDIRECTED view. Two nodes with no path between
  // them constrain each other not at all, so each component is its own problem
  // and its own ranking, normalised to start at rank 0 like every other.
  const componentOf = new Int32Array(count).fill(-1);
  let componentCount = 0;
  for (let seed = 0; seed < count; seed += 1) {
    if (at(componentOf, seed) >= 0) continue;
    componentOf[seed] = componentCount;
    stack[0] = seed;
    top = 1;
    while (top > 0) {
      top -= 1;
      const node = at(stack, top);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const next = other(at(incident, slot), node);
        if (at(componentOf, next) >= 0) continue;
        componentOf[next] = componentCount;
        stack[top] = next;
        top += 1;
      }
    }
    componentCount += 1;
  }
  // The components as one array of node numbers grouped by component, each
  // group in node insertion order, with a start index per group. An array of
  // arrays would allocate a row per component, and a graph of isolated nodes
  // has as many components as nodes.
  const componentStart = new Int32Array(componentCount + 1);
  for (let node = 0; node < count; node += 1) {
    const group = at(componentOf, node) + 1;
    componentStart[group] = at(componentStart, group) + 1;
  }
  for (let group = 0; group < componentCount; group += 1) {
    componentStart[group + 1] = at(componentStart, group + 1) + at(componentStart, group);
  }
  const grouped = new Int32Array(count);
  const groupCursor = componentStart.slice(0, componentCount);
  for (let node = 0; node < count; node += 1) {
    const group = at(componentOf, node);
    grouped[at(groupCursor, group)] = node;
    groupCursor[group] = at(groupCursor, group) + 1;
  }

  const treeEdge = new Uint8Array(edgeCount);
  const inTree = new Uint8Array(count);
  const parent = new Int32Array(count).fill(-1);
  const parentEdge = new Int32Array(count).fill(-1);
  const depth = new Int32Array(count);
  const subtree = new Int32Array(count);
  // 0 outside the region being re-rooted, 1 inside it, 2 inside and already
  // walked. One array rather than two because the walk that assigns parents is
  // confined to the region the walk before it marked, and reusing the mark as
  // the visited flag saves clearing a second array per pivot.
  const region = new Uint8Array(count);
  const marked = new Int32Array(count);
  let markedCount = 0;
  const order = new Int32Array(count);
  const saved = new Int32Array(count);

  // The tight tree's two heaps, and the bookkeeping that lets the shifts it
  // makes be recorded rather than performed. See the growth loop below, and the
  // cost section of the docstring above for why they are here at all.
  //
  // A heap holds the edges crossing out of the tree in one DIRECTION class,
  // ordered by a key the shifts do not move, with the edge number as the
  // tie-break. Capacity is the edge count because an edge is pushed at most
  // once: it goes in when the first of its endpoints joins, and by the time the
  // second joins it is internal and is skipped.
  const newHeap = () => ({
    key: new Int32Array(edgeCount),
    edge: new Int32Array(edgeCount),
    size: 0,
  });
  type Heap = ReturnType<typeof newHeap>;
  /** Minimum slack, and among equal slacks the lowest edge number. */
  const before = (key: number, edge: number, otherKey: number, otherEdge: number): boolean =>
    key < otherKey || (key === otherKey && edge < otherEdge);
  const heapPush = (heap: Heap, key: number, edge: number): void => {
    let slot = heap.size;
    heap.size += 1;
    while (slot > 0) {
      const holder = (slot - 1) >> 1;
      if (!before(key, edge, at(heap.key, holder), at(heap.edge, holder))) break;
      heap.key[slot] = at(heap.key, holder);
      heap.edge[slot] = at(heap.edge, holder);
      slot = holder;
    }
    heap.key[slot] = key;
    heap.edge[slot] = edge;
  };
  const heapPop = (heap: Heap): void => {
    heap.size -= 1;
    if (heap.size === 0) return;
    const key = at(heap.key, heap.size);
    const edge = at(heap.edge, heap.size);
    let slot = 0;
    for (;;) {
      let child = slot * 2 + 1;
      if (child >= heap.size) break;
      const right = child + 1;
      if (
        right < heap.size &&
        before(at(heap.key, right), at(heap.edge, right), at(heap.key, child), at(heap.edge, child))
      ) {
        child = right;
      }
      if (!before(at(heap.key, child), at(heap.edge, child), key, edge)) break;
      heap.key[slot] = at(heap.key, child);
      heap.edge[slot] = at(heap.edge, child);
      slot = child;
    }
    heap.key[slot] = key;
    heap.edge[slot] = edge;
  };
  /**
   * The lowest edge still crossing out of a heap's side, or -1 when the heap
   * holds nothing but edges that have gone internal. Nothing ever leaves the
   * tree, so an entry whose outside endpoint has joined is dead rather than
   * stale, and dropping it here is what keeps the heaps free of a decrease-key.
   */
  const heapTop = (heap: Heap, outsideIsTarget: boolean): number => {
    while (heap.size > 0) {
      const edge = at(heap.edge, 0);
      if (at(inTree, outsideIsTarget ? at(to, edge) : at(from, edge)) === 0) return edge;
      heapPop(heap);
    }
    return -1;
  };
  // Edges running out of the tree, and edges running into it. A shift of the
  // whole tree changes every slack in one class by `-shift` and every slack in
  // the other by `+shift`, so one running offset per class prices them all.
  const outward = newHeap();
  const inward = newHeap();
  let shifted = 0;
  let treeSize = 0;
  // What `shifted` stood at when a node joined, which is the part of the total
  // shift that happened before it and therefore does not apply to it.
  const joinShift = new Int32Array(count);

  /**
   * Adds a node to the tight tree and feeds the heaps every edge that crosses
   * out of it. Both endpoints of such an edge read at their true rank here: the
   * one outside the tree has never been shifted, and the one joining is shifted
   * by everything after this moment and nothing before it, which is what
   * recording `shifted` says.
   */
  const admit = (node: number): void => {
    inTree[node] = 1;
    joinShift[node] = shifted;
    treeSize += 1;
    for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
      const edge = at(incident, slot);
      if (at(inTree, other(edge, node)) === 1) continue;
      // The key is the current slack undone by the class offset, so heap order
      // is current-slack order however far the tree goes on to move: an outward
      // edge's slack is `key - shifted` from here on, an inward edge's is
      // `key + shifted`.
      if (at(from, edge) === node) heapPush(outward, slackOf(edge) + shifted, edge);
      else heapPush(inward, slackOf(edge) - shifted, edge);
    }
  };

  /**
   * What a component's edges cost as the ranks stand. Each edge is priced once,
   * from its source, and both its endpoints are in one component because the
   * components are the components of the undirected view.
   */
  const componentTotal = (base: number, size: number): number => {
    let total = 0;
    for (let index = 0; index < size; index += 1) {
      const node = at(grouped, base + index);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const edge = at(incident, slot);
        if (at(from, edge) !== node) continue;
        total += at(rank, at(to, edge)) - at(rank, node);
      }
    }
    return total;
  };

  /**
   * Roots the region marked 1 at `entry`, hanging it under `above` by
   * `edgeAbove`, and accumulates the subtree sums over it. Every node it
   * reaches is marked 2, so the walk consumes the marks it walks on.
   */
  const rootRegion = (entry: number, above: number, edgeAbove: number): void => {
    let ordered = 0;
    parent[entry] = above;
    parentEdge[entry] = edgeAbove;
    depth[entry] = above < 0 ? 0 : at(depth, above) + 1;
    region[entry] = 2;
    order[ordered] = entry;
    ordered += 1;
    stack[0] = entry;
    top = 1;
    while (top > 0) {
      top -= 1;
      const node = at(stack, top);
      for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
        const edge = at(incident, slot);
        if (at(treeEdge, edge) !== 1 || at(region, other(edge, node)) !== 1) continue;
        const next = other(edge, node);
        region[next] = 2;
        parent[next] = node;
        parentEdge[next] = edge;
        depth[next] = at(depth, node) + 1;
        order[ordered] = next;
        ordered += 1;
        stack[top] = next;
        top += 1;
      }
    }
    // Children always follow their parent in preorder, so one reverse sweep is
    // a valid postorder accumulation, without a second traversal to produce it.
    for (let index = 0; index < ordered; index += 1) {
      const node = at(order, index);
      subtree[node] = at(netInflow, node);
    }
    for (let index = ordered - 1; index >= 1; index -= 1) {
      const node = at(order, index);
      const holder = at(parent, node);
      subtree[holder] = at(subtree, holder) + at(subtree, node);
    }
  };

  let iterations = 0;

  for (let group = 0; group < componentCount; group += 1) {
    const base = at(componentStart, group);
    const size = at(componentStart, group + 1) - base;
    const root = at(grouped, base);
    // What the component started at, kept so that the run can be abandoned for
    // it. See the restore below.
    let startedAt = 0;
    if (size > 1) {
      for (let index = 0; index < size; index += 1) {
        const node = at(grouped, base + index);
        saved[node] = at(rank, node);
      }
      startedAt = componentTotal(base, size);

      // A tight tree: a spanning tree of the component using only edges with no
      // slack. Grown from the root by repeatedly taking the edge of minimum
      // slack with exactly one endpoint in it, and shifting everything already
      // in the tree by that slack to close it. A tight edge is a slack of zero
      // and costs no shift, so this absorbs every tight edge it can reach
      // before it moves anything. A shift moves both ends of every edge inside
      // the tree, so the tree stays tight, and it preserves feasibility because
      // the edge it closes is the tightest one crossing: every other crossing
      // edge of that class had at least as much slack to give up, and every
      // edge of the other class gains.
      outward.size = 0;
      inward.size = 0;
      shifted = 0;
      treeSize = 0;
      for (let index = 0; index < size; index += 1) inTree[at(grouped, base + index)] = 0;
      admit(root);
      while (treeSize < size) {
        // The candidates are the two heap tops, priced by their class offset,
        // and one comparison settles the class and the tie-break together:
        // minimum slack, and among equal slacks the lowest edge number. A slack
        // read off an empty heap is never used, because the edge number beside
        // it is then -1 and every branch below tests that first.
        const outEdge = heapTop(outward, true);
        const inEdge = heapTop(inward, false);
        const outSlack = at(outward.key, 0) - shifted;
        const inSlack = at(inward.key, 0) + shifted;
        const takeOutward =
          outEdge >= 0 &&
          (inEdge < 0 || outSlack < inSlack || (outSlack === inSlack && outEdge < inEdge));
        // Unreachable: the component is connected in the undirected view, so a
        // tree that does not span it has an edge leaving it. Throwing rather
        // than breaking out, because breaking out would leave a tree that is
        // not spanning and every pivot after it would read a parent pointer
        // that was never set.
        if (!takeOutward && inEdge < 0) {
          throw new InternalLayoutError(
            `no edge leaves the tight tree of ${String(treeSize)} of ` +
              `${String(size)} nodes, so the component is not connected after all`,
          );
        }
        const closing = takeOutward ? outEdge : inEdge;
        // Down to meet an edge running out of the tree, up to meet one running
        // into it, which is the direction that shortens the edge either way.
        shifted += takeOutward ? outSlack : -inSlack;
        treeEdge[closing] = 1;
        heapPop(takeOutward ? outward : inward);
        admit(takeOutward ? at(to, closing) : at(from, closing));
      }
      // The shifts, performed at last. A node keeps its own share of the total,
      // which is everything that happened after it joined, so the ranking is
      // exactly the one shifting the tree at every stall would have left and
      // costs one pass rather than one pass per stall.
      for (let index = 0; index < size; index += 1) {
        const node = at(grouped, base + index);
        rank[node] = at(rank, node) + shifted - at(joinShift, node);
      }

      for (let index = 0; index < size; index += 1) region[at(grouped, base + index)] = 1;
      rootRegion(root, -1, -1);
      for (let index = 0; index < size; index += 1) region[at(grouped, base + index)] = 0;
    }

    // Pivots. A tree edge with a negative cut value is one the ranking would be
    // shorter without, so it leaves, and the tightest non-tree edge crossing
    // the same cut the other way takes its place.
    let scan = 0;
    while (size > 1 && iterations < budget) {
      let leave = -1;
      let leaveIsDown = false;
      for (let step = 0; step < size; step += 1) {
        const index = (scan + step) % size;
        const node = at(grouped, base + index);
        const edge = at(parentEdge, node);
        if (edge < 0) continue;
        const down = at(from, edge) !== node;
        const cut = down ? at(subtree, node) : -at(subtree, node);
        if (cut < 0) {
          leave = node;
          leaveIsDown = down;
          scan = (index + 1) % size;
          break;
        }
      }
      if (leave < 0) break;

      // The subtree below the leaving edge, which is one side of the cut. Found
      // by walking the tree from `leave` without crossing the edge above it.
      const leaveEdge = at(parentEdge, leave);
      markedCount = 0;
      region[leave] = 1;
      marked[markedCount] = leave;
      markedCount += 1;
      stack[0] = leave;
      top = 1;
      while (top > 0) {
        top -= 1;
        const node = at(stack, top);
        for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
          const edge = at(incident, slot);
          if (at(treeEdge, edge) !== 1 || edge === leaveEdge) continue;
          const next = other(edge, node);
          if (at(region, next) !== 0) continue;
          region[next] = 1;
          marked[markedCount] = next;
          markedCount += 1;
          stack[top] = next;
          top += 1;
        }
      }

      // The entering edge: minimum slack among the non-tree edges crossing the
      // cut the other way from the one leaving. Enumerated from the marked
      // side's own nodes, so a pivot never looks at an edge both of whose
      // endpoints are somewhere else entirely.
      let enter = -1;
      let enterSlack = Number.POSITIVE_INFINITY;
      for (let index = 0; index < markedCount; index += 1) {
        const node = at(marked, index);
        for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
          const edge = at(incident, slot);
          if (at(treeEdge, edge) === 1 || at(region, other(edge, node)) !== 0) continue;
          // `leaveIsDown` means the leaving edge runs into the marked side, so
          // what replaces it has to run out of it, and the other way round.
          if ((at(from, edge) === node) !== leaveIsDown) continue;
          const slack = slackOf(edge);
          if (slack < enterSlack || (slack === enterSlack && edge < enter)) {
            enterSlack = slack;
            enter = edge;
          }
        }
      }
      // Unreachable: a negative cut value counts strictly more edges crossing
      // the cut against the leaving edge than with it, and the leaving edge is
      // the only tree edge crossing at all, so at least one non-tree edge runs
      // the way this search wants. Throwing rather than breaking, because
      // breaking here is an infinite loop: nothing about the tree would have
      // changed, and the next pass would pick the same leaving edge again.
      if (enter < 0) {
        throw new InternalLayoutError(
          `the cut below node ${String(leave)} has a negative cut value and no edge ` +
            'crossing it the other way, which the cut value says cannot happen',
        );
      }

      const shift = leaveIsDown ? enterSlack : -enterSlack;
      if (shift !== 0) {
        for (let index = 0; index < markedCount; index += 1) {
          const node = at(marked, index);
          rank[node] = at(rank, node) + shift;
        }
      }
      treeEdge[leaveEdge] = 0;
      treeEdge[enter] = 1;

      // The marked side keeps its nodes and loses its attachment point, so
      // every subtree sum strictly above the old attachment loses it and every
      // one above the new attachment gains it. The two paths meet at a common
      // ancestor and cancel from there up, which is what the depths are for.
      const sum = at(subtree, leave);
      const inside = at(region, at(from, enter)) === 1 ? at(from, enter) : at(to, enter);
      const outside = other(enter, inside);
      let losing = at(parent, leave);
      let gaining = outside;
      while (losing !== gaining) {
        if (at(depth, losing) >= at(depth, gaining)) {
          subtree[losing] = at(subtree, losing) - sum;
          losing = at(parent, losing);
        } else {
          subtree[gaining] = at(subtree, gaining) + sum;
          gaining = at(parent, gaining);
        }
      }

      rootRegion(inside, outside, enter);
      for (let index = 0; index < markedCount; index += 1) region[at(marked, index)] = 0;
      iterations += 1;
    }

    // A run cut short by the budget can be worse than the ranking it was given,
    // and the culprit is the tight tree rather than any pivot. Growing it
    // shifts a partly grown tree to close its tightest crossing edge, which
    // lengthens every edge running into the tree while it shortens every edge
    // running out, and the arithmetic can come out against it. Every pivot
    // after that only shortens, so a run with pivots left to take wins it back
    // and this restore never fires; a run with none is why the promise is
    // checked here rather than argued for. `test/layout.simplex.test.ts` holds
    // the eight-node graph that reaches it.
    if (size > 1 && componentTotal(base, size) > startedAt) {
      for (let index = 0; index < size; index += 1) {
        const node = at(grouped, base + index);
        rank[node] = at(saved, node);
      }
    }

    let lowest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < size; index += 1) {
      lowest = Math.min(lowest, at(rank, at(grouped, base + index)));
    }
    for (let index = 0; index < size; index += 1) {
      const node = at(grouped, base + index);
      rank[node] = at(rank, node) - lowest;
    }
  }
}

/**
 * Builds a rank stage that minimises the TOTAL EDGE LENGTH: the sum, over the
 * edges of the acyclic view, of how many ranks each edge crosses.
 *
 * `networkSimplexRankStage` is this with no options, and is what to reach for
 * unless a run needs a warm start or a budget.
 *
 * ## What it optimises, and what it costs
 *
 * Total edge length minus the edge count is exactly the number of dummy nodes
 * the splitter over this ranking mints, so it is the quantity that decides how
 * much of the drawing is chains of stand-in nodes rather than the caller's own.
 * On the 1k bench corpus it takes `longestPathRankStage`'s 14,746 dummies down
 * to 10,660 at the default 20,000-pivot budget, a 28% cut, and that is the
 * optimum: 200,000 pivots return the same 10,660. On the 10k corpus it reaches
 * 105,975 from 174,222 inside the default budget, and 99,698 given ten times it.
 *
 * **THAT CUT IS COLLECTABLE AS OF M2.4c AND WAS NOT BEFORE IT.** M2.4b put the
 * splitter in `longestPathRankStage` and nowhere else, so until M2.4c this stage
 * declared no `virtualNodes` and no `virtualChains`, minted no dummy, and the
 * counts above were a cost nobody was paying: what a caller who switched
 * actually got was a rank stage that cost far more, a drawing that is never
 * shorter and may be taller, zero dummy nodes saved because it minted none to
 * save, and long edges reaching the order stage, the position stage and the
 * router unsplit. The splitter now lives in `chains.ts` and both rankers call
 * it, so the figures above are what this stage puts in the roster rather than
 * what it would put there.
 *
 * What has not changed is the rest of the trade. A caller who switches still
 * pays seconds against milliseconds on the 10k corpus and still risks a taller
 * drawing, and the dummies saved are what they are buying with it.
 *
 * That 28% read 31% after M2.2b and 57% before it, and the stage did not get
 * worse either time: its INPUT got better. M2.2b scoped the cycle breaker's
 * reversals to the strongly connected components and M2.2c replaced the greedy
 * order it scoped with a least-squares one, which together took the 1k view
 * both rank stages rank from 40,430 dummies to 14,746 and the 10k view from
 * 1,414,263 to 174,222, so there is less left here to win each time.
 * `cycles.ts` is where both changes are argued.
 *
 * WHAT M2.2c DID TO THE BUDGET is worth reading before quoting any figure here.
 * The 10k used to be nowhere near converged at 20,000 pivots, which is why the
 * old record insisted on quoting a budget beside every number: the default and
 * the ten-times budget disagreed by 16% on the old view (268,589 against
 * 226,676) and cost 1.80s against 51.1s. On the new view they disagree by 6%
 * (105,975 against 99,698) and the default budget is reached in 3.4s. The
 * caveat has not gone away, it has shrunk with the problem, because a view with
 * an eighth of the span has an eighth of the length to pivot out of it.
 *
 * **It cannot make the drawing shorter, and it can make it taller.** Every
 * feasible ranking sends each edge down at least one rank, so along a path of L
 * edges the ranks differ by at least L, the maximum rank is at least the longest
 * path in the acyclic view, and `longestPathRankStage` hits that bound exactly.
 * Nothing here can beat that bound and nothing here defends it either: six
 * nodes are enough to lose a rank of height for a unit of length. With
 * `v8 -> v4 -> v5`, `v6 -> v5`, `v6 -> v9 -> v0`, longest path draws three
 * layers and pays 6; pulling `v6` down one rank tightens `v6 -> v5` and pays 5,
 * and it drags `v9` and `v0` down into a fourth layer to do it. Minimum total
 * edge length and minimum height are DIFFERENT OBJECTIVES and this stage
 * optimises the first. Pick `longestPathRankStage` if a short drawing is what
 * matters, naming that stage rather than whichever one is the default today,
 * which is a thing that changes. (Both corpora happen to come out the same
 * height either way, 64 ranks and 160 ranks, re-measured over M2.2c's view
 * after being true over M2.2b's as well, so this is a real risk rather than a
 * certainty.)
 *
 * Ranks come out contiguous from zero per connected component, as
 * `longestPathRankStage`'s do, and both halves of that hold WHATEVER STOPPED THE
 * RUN.
 *
 * GAP-FREE is a property of the tight tree rather than of optimality. What stood
 * here argued it from optimality (a ranking with an empty rank between two
 * occupied ones is never optimal, because sliding everything below the gap up by
 * one shortens every edge that crossed it and breaks none) and therefore
 * concluded that an exhausted budget could leave a gap. That conclusion was
 * wrong, and M2.4c had to settle it because the shared splitter reads these
 * ranks. {@link tighten} keeps a TIGHT SPANNING TREE of each component: the
 * growth loop runs to a spanning tree whatever the budget, since only the pivots
 * are bounded, every tree edge has slack zero when it closes, a shift moves both
 * ends of every edge already inside the tree, and a pivot shifts one whole side
 * of a cut so the entering edge becomes tight while every edge with both ends on
 * one side keeps the slack it had. So any two nodes of a component are joined by
 * a walk of ±1 steps and the component's ranks are contiguous.
 *
 * The one path that does not cover is the restore below, which hands back the
 * longest-path sweep run over a hint as a FLOOR, and a floor can in principle
 * spread a component out. That path is covered by a witness rather than by an
 * argument: the eight-node graph in `test/layout.simplex.test.ts` reaches it
 * deterministically at a budget of zero, cold and floored, and comes back
 * contiguous. It is barely reached by a random population, which is worth
 * knowing before quoting one as evidence: instrumented with a counter, 21,462
 * hinted runs across budgets 0 to 2 fire it 60 times. The reason a gapped
 * restore is hard to reach at all is that the two conditions pull against each
 * other, a floor big enough to spread a component makes the ranking it saves
 * long and the tight tree then beats it, and that is an observation rather than
 * a proof. `chains.ts` does not depend on any of it: the splitter walks the
 * occupied ranks, which is what the runner checks completeness against.
 *
 * FROM ZERO is a construction: the last thing {@link tighten} does to a
 * component is subtract its lowest rank, unconditionally, whatever stopped the
 * run. So a run out of budget can never hand back a floor that is not zero.
 *
 * ## How
 *
 * Cycles are broken exactly as `longestPathRankStage` breaks them, with the
 * least-squares feedback arc set of `cycles.ts`, and the ranking runs over the
 * same acyclic view. Then: a longest-path ranking to start from, a spanning tree of
 * zero-slack edges, and a sequence of pivots, each of which finds a tree edge
 * the ranking would be shorter without and swaps it for the tightest edge
 * crossing the same cut the other way. It stops when no tree edge has a
 * negative cut value, which is the optimality condition for this LP. See
 * {@link tighten}, which is where the cut-value identity and the per-pivot cost
 * are argued.
 *
 * ## The budget
 *
 * `maxIterations` bounds the pivots, and defaults to 20,000, which is a safety
 * valve and not a quality knob. It is about nine times what the 1k bench corpus
 * needs to converge, which is about 2,200 pivots (0 pivots leaves it at 13,454
 * dummies, which is what growing the first tight tree is worth on its own,
 * 1,500 at 11,012, 2,000 at 10,688, 3,000 at 10,660 which is the optimum, first
 * reached at exactly 2,182, and 20,000 and 200,000 both return that same
 * 10,660), and it is what bounds the 10k corpus, which does not converge inside
 * any budget worth spending, to a few seconds. Give it more if a run is worth
 * it: the 10k corpus is still improving at 200,000 pivots, where about 49
 * seconds buys 99,698 against the default budget's 105,975, and
 * `Number.POSITIVE_INFINITY` is how to ask for as many as it takes.
 *
 * That landmark has moved twice and in both directions: DOWN to about 1,150
 * pivots with M2.2b's acyclic view, from about 1,300, and UP to about 2,200
 * with M2.2c's. Up is not a regression here and the direction is the wrong
 * thing to read. M2.2c cut the 1k view's starting span from 22,726 dummies to
 * 14,746, so the pivots that remain are working on a view that has already had
 * most of the easy length taken out of it, and each one buys less. What matters
 * for the default is the ratio, and at nine times the 1k's requirement the
 * budget is still a safety valve rather than a cap that bites, which is why the
 * default did not move with the numbers.
 *
 * Whatever stops it, the ranking returned is feasible, and never worse than the
 * longest-path ranking it computes before pivoting, which is the cold one when
 * no hint was given. Feasible because every step here is a rank shift of
 * one side of a cut, which preserves every edge's descent. Never worse because
 * it is CHECKED, and not because it is obvious: growing the first tight tree
 * can shift a partly grown tree in a direction that lengthens more edges than
 * it shortens, and with no pivots left to win that back the run would return
 * something worse than it was given. Each component therefore keeps the better
 * of that longest-path ranking and the one it ended with. Eight nodes are
 * enough to reach it, and the graph that does is in the test suite.
 *
 * ## The warm start
 *
 * `initialRanks` is a previous ranking to start from, and it exists because the
 * ranking LP is DEGENERATE: many different spanning trees reach the same total
 * edge length, and which optimum a cold run lands on depends on the tree it
 * started from. Without a warm start, a one-edge patch can move the solver to a
 * different optimum of equal cost, churning ranks across a region that did not
 * change and improving nothing. M3 re-runs layout on every patch, so that is
 * not a hypothetical.
 *
 * A supplied ranking is a HINT and never a starting point taken on trust. It is
 * used as a floor for the longest-path sweep, which pushes any node the hint put
 * too high back down below its predecessors, so the ranking the solver actually
 * starts from is feasible whatever the hint said. Three kinds of entry are
 * dropped: an id the graph does not hold, a value that is not an integer, and a
 * value outside `[-count, count]`, which is wider than any ranking of `count`
 * nodes needs. A hint therefore cannot make the result infeasible, and cannot
 * make it non-optimal either as long as the budget holds; all it can do is
 * choose between optima, which is the whole point.
 *
 * THERE ARE TWO WARM STARTS HERE AND THEY ARRIVE BY DIFFERENT ROUTES, which is
 * worth knowing before adding a third. `initialRanks` is an OPTION, bound when
 * the stage is constructed, so it is the same hint on every run and an engine
 * cannot refresh it. `PreparedState.previous.ranks` is the per-run one, added
 * by M3.7b, and it WINS over the option when both are there for the reason
 * M3.6's order stage gives: a constant preferred to the run before it is a
 * frozen answer handed back for the life of the engine. The cycle breaker's
 * seed is per-run too: this stage hands `feedbackArcSet` the previous run's
 * `reversedEdges` (M3.7a), so the view it ranks stops moving under patches that
 * changed no cycle. Both stages do all of it, because a splitter that lives in
 * one ranker and not the other is the shape of bug M2.4c already fixed once.
 *
 * WHAT THE TWO STAGES DO WITH `previous.ranks` IS NOT THE SAME THING, AND THE
 * DIFFERENCE IS WHY ONLY ONE OF THEM VALIDATES IT. Here it is a FLOOR: the
 * sweep only ever pushes a node further down, so a hint that put one too high
 * stays too high, the answer is feasible but longer than it needed to be, and
 * `floorFrom` therefore drops the three kinds of entry that would do it.
 * `longestPathRankStage` CHECKS the same map against the view instead and
 * corrects it in both directions, so its answer is the cold answer whatever it
 * was handed and it validates nothing. One channel, two stages, two meanings,
 * and the reason is that this stage is choosing between optima where that one
 * has only the one.
 *
 * ## Determinism
 *
 * Same graph, same ranks, always. Every tie-break is the graph's own iteration
 * order and every intermediate structure is an array indexed by node or edge
 * number: see {@link tighten}. What is NOT claimed is invariance to the order
 * the graph was built in. Cycle breaking is order-sensitive before ranking
 * starts, and among two optima of equal cost this stage returns whichever its
 * tie-breaks reach first, so the same graph assembled in another order may rank
 * differently. On a graph with a unique optimum it may not, and the test suite
 * pins that narrower claim rather than the one it would be nice to make.
 *
 * @throws {InvalidConfigError} when `maxIterations` is not a whole number of
 * pivots that is zero or greater, and not `Number.POSITIVE_INFINITY`.
 */
export function networkSimplexRank(options?: NetworkSimplexOptions): RankStage {
  const budget = resolveBudget(options?.maxIterations);
  const hint = options?.initialRanks;
  return authored({
    name: 'network-simplex-rank',
    run(input) {
      const { graph } = input;
      const reversedEdges = feedbackArcSet(graph, input.previous?.reversedEdges);
      const view = acyclicView(graph, reversedEdges);
      // THE FRESHEST RANKING WINS, which is M3.6's precedence rule arriving at
      // the second stage that reads this record, and it is the same argument
      // there and here: `previous` is the run immediately before this one, and
      // `initialRanks` is a constant bound when the stage was built, so a stage
      // that preferred it would choose the same optimum on every relayout for
      // the life of the engine. That is the churn the channel exists to stop.
      const warm = input.previous?.ranks ?? hint;
      const rank = longestPathRanks(view, floorFrom(warm, view));
      tighten(view, rank, budget);

      const ranks = new Map<NodeId, number>();
      for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rank, number));

      // The same splitter the default ranker uses, and the same one it has to
      // be: a chain is a contract with the order stage, the position stage and
      // the router, not a private convenience of whichever stage minted it.
      // Shared since M2.4c; before that this stage declared no chain at all and
      // its long edges reached those three unsplit.
      const split = splitLongEdges('network-simplex-rank', graph, ranks);
      if (split === undefined) return { ranks, reversedEdges };
      return { ranks, reversedEdges, ...split };
    },
  });
}

/**
 * The network simplex rank stage with no options: a 20,000 pivot budget and no
 * warm start. See {@link networkSimplexRank}, which is where all of it is
 * argued, including why this is not the default stage.
 *
 * Frozen, for the reason `defaultStages` is: it is one object shared by every
 * run in the process, and a stage's `name` is quoted in every
 * `StageContractError` the runner raises against it, so an assignment to it
 * anywhere would be an assignment to it everywhere.
 */
export const networkSimplexRankStage: RankStage = Object.freeze(networkSimplexRank());
