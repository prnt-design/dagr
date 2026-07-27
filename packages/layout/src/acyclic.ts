import type { EdgeId, Graph, Node, NodeId } from '@dagr/graph';
import { InternalLayoutError } from './errors.js';

/**
 * The view every rank stage ranks over, and the longest-path ranking of it.
 *
 * Both halves live here rather than in `rank.ts` because two stages want them.
 * `longestPathRankStage` is the ranking, and `networkSimplexRankStage` needs
 * exactly the same view and the same initial feasible ranking before it can
 * start pivoting. A second copy of either would be a second place for the
 * self-loop rule and the reversal rule to drift, and a ranker that disagreed
 * with the other about what the acyclic view IS would disagree about which
 * rankings are feasible, which is the one thing both have to agree on.
 */

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node or edge number this module minted. Absence is a bug
 * here rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * The graph as a ranker sees it: every node numbered, and every edge that
 * constrains a ranking listed by endpoint number, pointing the way it has to
 * point for the view to be acyclic.
 *
 * Numbers rather than ids, and parallel arrays rather than records, because
 * both consumers index arrays by node number for the whole of their run and
 * neither has any use for an id until it writes its answer back out.
 *
 * Self loops are dropped. A self loop constrains nothing (a node cannot be
 * below itself), it is never in the feedback set, and counting one would give
 * its node an in-degree the sweep below could never clear, stalling the whole
 * ranking on an edge that means nothing here.
 *
 * Parallel edges are kept, one entry each. Two copies of `a -> b` are two units
 * of total edge length to the network simplex ranker, which is the right answer
 * for it: M2.4b mints a dummy per copy per rank spanned, so the second copy
 * costs exactly what the first one does.
 */
export interface AcyclicView {
  /** The graph's nodes, in insertion order. A node's number is its index here. */
  readonly nodes: readonly Node[];

  /** Node number by id, for writing an answer back out against the graph. */
  readonly numbers: ReadonlyMap<NodeId, number>;

  /** Source node number per edge, after any reversal. Parallel to {@link to}. */
  readonly from: Int32Array;

  /** Target node number per edge, after any reversal. Parallel to {@link from}. */
  readonly to: Int32Array;
}

/**
 * The acyclic view of a graph given the edges to treat as running the other
 * way, which is what `feedbackArcSet` computed.
 *
 * It reads the graph and builds arrays; it never touches either. The edges come
 * out in `graph.edges()` order, which `@dagr/graph` guarantees to be insertion
 * order, and that order is what a ranker's tie-breaks are stated against.
 */
export function acyclicView(graph: Graph, reversedEdges: ReadonlySet<EdgeId>): AcyclicView {
  const nodes = graph.nodes();
  const numbers = new Map<NodeId, number>();
  for (const [number, node] of nodes.entries()) numbers.set(node.id, number);

  const from: number[] = [];
  const to: number[] = [];
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    const reversed = reversedEdges.has(edge.id);
    const source = numbers.get(reversed ? edge.target : edge.source);
    const target = numbers.get(reversed ? edge.source : edge.target);
    // Unreachable: an edge's endpoints are always nodes of the graph.
    if (source === undefined || target === undefined) continue;
    from.push(source);
    to.push(target);
  }
  return { nodes, numbers, from: Int32Array.from(from), to: Int32Array.from(to) };
}

/**
 * Ranks every node of a view by the longest path that reaches it, or by the
 * longest path that reaches it from a floor the caller supplies.
 *
 * A Kahn-style sweep: repeatedly take a node whose remaining in-degree is zero,
 * and relax its out-edges. Every node and every edge is visited once, so this is
 * O(V + E) like the cycle breaker it follows. Nodes enter the queue in node
 * number order, which is graph insertion order, and are relaxed in edge order,
 * so the run is reproducible. Longest path is far less order-sensitive than
 * cycle breaking: it has one answer per view whatever order the sweep visits it
 * in, because a node's rank is settled only once every predecessor is settled.
 *
 * `floor` is what makes this serve the network simplex ranker's warm start as
 * well as the default ranker. With no floor a node with nothing pointing at it
 * gets rank 0, which is the minimum-height ranking `longestPathRankStage`
 * promises. With one, each node starts at the floor the caller named and is
 * still pushed down by its predecessors, so the answer is feasible whatever the
 * floor said: a floor is a preference, and the sweep is what makes a preference
 * safe to express. The floor is read once per node and never written back, so a
 * caller's array is not modified.
 *
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the view still had a cycle. That is a bug in the cycle breaker or in
 * the view rather than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export function longestPathRanks(view: AcyclicView, floor?: Int32Array): Int32Array {
  const count = view.nodes.length;
  const edgeCount = view.from.length;

  // The out-edges as CSR: one array of targets, grouped by source, with an
  // index per source. An array of arrays would allocate a row per node, and on
  // a 10k node graph that is 10k allocations to walk once.
  const outDegree = new Int32Array(count);
  const inDegree = new Int32Array(count);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(view.from, edge);
    const target = at(view.to, edge);
    outDegree[source] = at(outDegree, source) + 1;
    inDegree[target] = at(inDegree, target) + 1;
  }
  const start = new Int32Array(count + 1);
  for (let node = 0; node < count; node += 1) {
    start[node + 1] = at(start, node) + at(outDegree, node);
  }
  const cursor = start.slice(0, count);
  const successors = new Int32Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = at(view.from, edge);
    successors[at(cursor, source)] = at(view.to, edge);
    cursor[source] = at(cursor, source) + 1;
  }

  const rankOf = floor === undefined ? new Int32Array(count) : Int32Array.from(floor);
  // An array walked with a read index rather than `shift`, which is O(n) per
  // call on most engines and would make this O(V^2) on a wide graph.
  const queue: number[] = [];
  for (let node = 0; node < count; node += 1) {
    if (at(inDegree, node) === 0) queue.push(node);
  }
  let read = 0;
  let swept = 0;
  while (read < queue.length) {
    const node = at(queue, read);
    read += 1;
    swept += 1;
    const rank = at(rankOf, node);
    for (let slot = at(start, node); slot < at(start, node + 1); slot += 1) {
      const successor = at(successors, slot);
      // Longest path, not shortest: a node sits below the LOWEST thing that
      // points at it, so a diamond's tail lands one rank under its longer side
      // rather than under whichever side the sweep reached first.
      if (rank + 1 > at(rankOf, successor)) rankOf[successor] = rank + 1;
      inDegree[successor] = at(inDegree, successor) - 1;
      if (at(inDegree, successor) === 0) queue.push(successor);
    }
  }
  if (swept !== count) {
    throw new InternalLayoutError(
      `${String(count - swept)} of ${String(count)} nodes could not be ` +
        'ranked, so the cycle breaker left a cycle in the acyclic view',
    );
  }
  return rankOf;
}
