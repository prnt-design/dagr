import type { NodeId } from './types.js';

/**
 * Traversal over a directed graph: topological order, cycle witnesses, and
 * reachability.
 *
 * These are functions over an {@link AdjacencyView} rather than methods on
 * `Graph`, for two reasons. They are the only algorithms in the package with
 * enough shape to be worth testing on their own, away from a `Graph` and its
 * insertion rules. And direction becomes free: `Graph` hands in a forward view
 * for successors and a reversed one for predecessors, so every function here
 * is written once and walks whichever way it was pointed. `Graph`'s methods are
 * the public surface and delegate here.
 *
 * The walks read the graph's own adjacency indexes through the view. Going
 * through the public `successors` would be simpler and would build a fresh
 * deduplicated, sorted array per node per pass: the committed baseline puts
 * `successors` at about 6x the cost of `outEdges` over the same nodes, and a
 * traversal pays that per node rather than once.
 *
 * What the view avoids is precisely that: it never RETAINS a materialised
 * neighbour array, so peak memory stays O(1) per node rather than O(degree),
 * and it skips the dedup and sort. It is not allocation-free, and an earlier
 * version of this comment claimed it was. `neighboursOf` is generator-backed,
 * so each visited node still costs a generator object and each edge an iterator
 * result. If that churn ever matters, the fix is for the view to hand back the
 * edge-id set plus an endpoint accessor and let each algorithm drive the set's
 * own iterator, which removes the generator frame without materialising
 * anything.
 */

/**
 * The slice of a graph these algorithms need.
 *
 * Deliberately small, and deliberately not `Graph`: everything here is true of
 * a reversed view as well as a forward one, which is what lets `ancestors` be
 * `descendants` pointed the other way rather than a second implementation that
 * can drift from the first.
 */
export interface AdjacencyView {
  /** Every node id, in insertion order. */
  nodes(): Iterable<NodeId>;

  /**
   * Ids this node points at, once per edge, in edge insertion order.
   *
   * Duplicates are kept rather than collapsed. Parallel edges have to be
   * counted, not deduplicated, for {@link topologicalOrder}'s in-degree
   * bookkeeping to reach zero, and every caller here is either counting edges
   * or already keeping a visited set.
   */
  neighboursOf(id: NodeId): Iterable<NodeId>;

  /** Edges arriving at this node from the direction of the walk. O(1). */
  arrivingCount(id: NodeId): number;

  /** The node's insertion rank, for ordering results. */
  rankOf(id: NodeId): number;
}

/**
 * Every node, ordered so that each one comes after everything pointing at it,
 * or `undefined` when no such order exists because the graph has a cycle.
 *
 * A Kahn sweep: repeatedly take a node nothing points at any more, emit it, and
 * decrement the arrival count of everything it points at. O(V + E).
 *
 * ## Which order, of the many
 *
 * Most graphs have more than one valid topological order, so the tie-break is a
 * choice and not a detail. Of every valid order, this returns the one that
 * comes first when nodes are compared by insertion rank: whenever more than one
 * node is ready, the earliest-added ready node is emitted.
 *
 * That is the same contract the adjacency listings keep, and it is stronger
 * than it looks. A plain first-in-first-out queue is also deterministic, but
 * only given the whole history: when relaxing one node frees two others, the
 * order they enter the queue follows the order those two EDGES were added, so
 * adding a redundant parallel edge, or rebuilding the same graph with its edges
 * added in a different order, can permute the result. The property suite caught
 * exactly that against an earlier version of this function. Picking the
 * smallest ready rank instead makes the answer independent of edge order.
 *
 * Independent of EDGE order, and no more than that. Node insertion rank is what
 * the tie-break compares, so the same nodes and edges added in a different NODE
 * order give a different answer, and no amount of heap discipline changes that.
 * An earlier draft of this comment claimed the stronger thing.
 *
 * The cost is a heap rather than a queue, so O((V + E) log V) rather than
 * O(V + E). The committed baseline holds this sweep at about 10ms on the 10k
 * node, 40k edge corpus. A plain-queue variant did measure materially faster
 * during development, but against an implementation and an acyclic view that
 * are both gone from the tree, so NO TRACKED NUMBER STANDS BEHIND A RATIO and
 * none is quoted here: the log factor is the reason to expect a cost, and
 * anyone proposing to drop the tie-break should re-measure rather than inherit
 * a figure.
 *
 * Worth paying regardless. This is a graph model whose selling point is stable
 * identity across re-layouts, an order that permutes when an unrelated edge is
 * added is the opposite of that, and 10ms on ten thousand nodes is not the
 * bottleneck in anything that then lays them out (the whole Sugiyama pipeline
 * is about 30ms on the same corpus). A caller who wants the cheaper sweep and
 * does not care how ties fall would need a second entry point, which is an
 * additive change to make when someone asks, not a default to give away
 * quietly.
 *
 * ## Self loops
 *
 * A self loop makes a node point at itself, so its own arrival count can never
 * reach zero and it is never emitted. That is the honest answer rather than a
 * special case: a node cannot come after itself, so a graph with a self loop
 * has no topological order. `@dagr/layout`'s ranker deliberately differs and
 * drops self loops before its own sweep, because a self loop constrains nothing
 * about which rank a node belongs on. Both are right for their question.
 */
export function topologicalOrder(view: AdjacencyView): readonly NodeId[] | undefined {
  const remaining = new Map<NodeId, number>();
  const ready = new RankHeap((id) => view.rankOf(id));

  // Counted from the same sweep the algorithm walks, rather than asked of the
  // view separately, so a view whose count and iteration disagreed cannot make
  // this report a complete order over an incomplete walk.
  let total = 0;
  for (const id of view.nodes()) {
    total += 1;
    const arriving = view.arrivingCount(id);
    if (arriving === 0) ready.push(id);
    else remaining.set(id, arriving);
  }

  const order: NodeId[] = [];
  for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
    order.push(id);
    for (const next of view.neighboursOf(id)) {
      const left = remaining.get(next);
      // Absent means already emitted, which only happens if the view reported
      // an arrival count lower than the edges it then yielded. Skipping keeps
      // a malformed view from driving the count negative and looping forever.
      if (left === undefined) continue;
      if (left === 1) {
        remaining.delete(next);
        ready.push(next);
      } else {
        remaining.set(next, left - 1);
      }
    }
  }

  return order.length === total ? order : undefined;
}

/**
 * A binary min-heap of node ids ordered by insertion rank.
 *
 * Small and local on purpose. The only thing {@link topologicalOrder} needs is
 * "the earliest-added node that is ready", and the alternatives are a sort of
 * the ready set on every pop or a linear scan of it, both of which are worse
 * than the log factor this costs.
 */
class RankHeap {
  readonly #items: NodeId[] = [];
  readonly #rankOf: (id: NodeId) => number;

  constructor(rankOf: (id: NodeId) => number) {
    this.#rankOf = rankOf;
  }

  push(id: NodeId): void {
    const items = this.#items;
    items.push(id);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.#rankAt(parent) <= this.#rankAt(child)) break;
      this.#swap(parent, child);
      child = parent;
    }
  }

  pop(): NodeId | undefined {
    const items = this.#items;
    const top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < items.length && this.#rankAt(left) < this.#rankAt(smallest)) smallest = left;
        if (right < items.length && this.#rankAt(right) < this.#rankAt(smallest)) smallest = right;
        if (smallest === parent) break;
        this.#swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  #rankAt(index: number): number {
    const id = this.#items[index];
    return id === undefined ? Number.POSITIVE_INFINITY : this.#rankOf(id);
  }

  #swap(left: number, right: number): void {
    const items = this.#items;
    const holdLeft = items[left];
    const holdRight = items[right];
    if (holdLeft === undefined || holdRight === undefined) return;
    items[left] = holdRight;
    items[right] = holdLeft;
  }
}

/** How far a node has got in {@link findCycle}'s walk. */
const UNSEEN = 0;
/** On the current path: reaching one of these again closes a cycle. */
const OPEN = 1;
/** Finished, with everything below it explored and no cycle through it. */
const DONE = 2;

/**
 * A cycle, as the nodes on it in the order they are traversed, or `undefined`
 * when the graph is acyclic.
 *
 * Consecutive entries are joined by an edge and the last closes back to the
 * first. The endpoint is listed once, so a cycle of n nodes has n entries and a
 * self loop has one.
 *
 * A depth-first walk colouring nodes as it goes: reaching a node that is still
 * open means the path has come back around to it, and the cycle is the tail of
 * the current path from that node onwards. O(V + E).
 *
 * Iterative rather than recursive, with an explicit stack. Recursion here would
 * be one JavaScript frame per node on the path, and the corpora this is
 * benchmarked against are 10k nodes deep in the worst case, which overflows.
 *
 * Which cycle is found is not specified beyond being a real one. The graph may
 * hold many, and this is whichever the walk reaches first from the first node
 * in insertion order that leads to one. {@link topologicalOrder} is the
 * question to ask if what matters is whether any exist.
 */
export function findCycle(view: AdjacencyView): readonly NodeId[] | undefined {
  const state = new Map<NodeId, number>();
  /** The current root-to-node path, as ids. */
  const path: NodeId[] = [];
  /** For each node on `path`, its remaining neighbours to try. */
  const pending: Iterator<NodeId>[] = [];

  for (const root of view.nodes()) {
    if ((state.get(root) ?? UNSEEN) !== UNSEEN) continue;

    state.set(root, OPEN);
    path.push(root);
    pending.push(view.neighboursOf(root)[Symbol.iterator]());

    while (path.length > 0) {
      const top = path[path.length - 1];
      const iterator = pending[pending.length - 1];
      // Unreachable: `path` and `pending` are pushed and popped in lockstep, so
      // their lengths always match, and the loop guard says `path` is not
      // empty. Loud rather than defensive on purpose. A `break` here would
      // leave the stale path in place for the next root, and the witness below
      // slices out of that path, so it could return a sequence spanning the
      // seam between two unrelated walks: consecutive entries with no edge
      // between them, handed to a caller that was promised a cycle.
      if (top === undefined || iterator === undefined) {
        throw new Error('graph invariant: traversal path and iterator stacks fell out of step');
      }

      const step = iterator.next();
      if (step.done === true) {
        state.set(top, DONE);
        path.pop();
        pending.pop();
        continue;
      }

      const next = step.value;
      const colour = state.get(next) ?? UNSEEN;
      if (colour === OPEN) {
        // `next` is on the current path, so the path from it to `top` plus the
        // edge just followed is a cycle. A self loop is the one-entry case.
        return path.slice(path.indexOf(next));
      }
      if (colour === DONE) continue;

      state.set(next, OPEN);
      path.push(next);
      pending.push(view.neighboursOf(next)[Symbol.iterator]());
    }
  }

  return undefined;
}

/**
 * Every node reachable from `from` by following the view's direction, EXCLUDING
 * `from` itself, in node insertion order.
 *
 * ## Why the seed is dropped
 *
 * `from` is excluded even when a cycle genuinely leads back to it. That is a
 * choice, and the first version of this function made the other one. The name
 * on the public surface is `descendants`, and the widely known implementation
 * of that name, networkx's `descendants(G, source)`, works on cyclic digraphs
 * and always excludes the source. A name with a prior that strong loses to the
 * prior: a caller writing the obvious "everything strictly below `a`" loop
 * would have been silently wrong, and only on the cyclic graphs this package
 * deliberately permits.
 *
 * Nothing is lost by dropping it, because {@link canReach} still answers the
 * reflexive question exactly: `canReach(a, a)` is "is `a` on a cycle". That is
 * a DELIBERATE DIVERGENCE between the two, and the only case where they
 * disagree. `canReach(a, b)` and `reachable(a).includes(b)` agree for every
 * pair with `a !== b`; at `a === b` the first can be true while the second is
 * false by construction.
 *
 * Ordered by insertion rank rather than by the order the walk found things, for
 * the same reason `successors` sorts: what was asked is which nodes are
 * reachable, so the answer must not depend on which path arrived first. O(V + E)
 * over the reached subgraph, plus a sort over the result.
 */
export function reachable(view: AdjacencyView, from: NodeId): readonly NodeId[] {
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === undefined) continue;
    for (const next of view.neighboursOf(id)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  // Dropped after the walk rather than never visited, so a cycle through `from`
  // is still traversed and everything beyond it is still found.
  seen.delete(from);
  return [...seen].sort((left, right) => view.rankOf(left) - view.rankOf(right));
}

/**
 * Whether `to` can be reached from `from` by following the view's direction one
 * or more times.
 *
 * The same walk as {@link reachable}, stopping at the first hit and never
 * building the reached set as a list. That is the whole reason it is a separate
 * function: the common question is a yes or no, and answering it by materialising
 * and sorting every reachable node is work the caller did not ask for.
 *
 * This stays at "one or more edges" while {@link reachable} drops its seed, so
 * `canReach(a, a)` is true exactly when `a` sits on a cycle even though
 * `reachable(a)` never contains `a`. That is the one case where the two
 * disagree, and it is what makes dropping the seed there costless: the
 * reflexive question keeps a precise, cheap answer here.
 */
export function canReach(view: AdjacencyView, from: NodeId, to: NodeId): boolean {
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === undefined) continue;
    for (const next of view.neighboursOf(id)) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return false;
}
