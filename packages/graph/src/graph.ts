import {
  DuplicateEdgeError,
  DuplicateNodeError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
} from './errors.js';
import type { Edge, EdgeId, Node, NodeId } from './types.js';

/** The exact shape node id generation produces: `n1`, `n2`, ... */
const GENERATED_NODE_ID = /^n([1-9]\d*)$/;

/** The exact shape edge id generation produces: `e1`, `e2`, ... */
const GENERATED_EDGE_ID = /^e([1-9]\d*)$/;

/**
 * The id counter after an explicit id was accepted.
 *
 * Claiming `n3` moves the counter past it, so the suffix is spent even if the
 * node is later removed and generation never hands the same id out twice. Only
 * ids in the exact generated shape count: `n007` is not one generation could
 * produce, so it leaves the counter where it is. A suffix past
 * `Number.MAX_SAFE_INTEGER` also leaves it alone, since arithmetic there is not
 * exact; the skip loop in the generators still guarantees a free id, it just
 * costs one extra probe.
 */
function advanceSeq(current: number, id: string, pattern: RegExp): number {
  const suffix = pattern.exec(id)?.[1];
  if (suffix === undefined) return current;
  const next = Number(suffix) + 1;
  if (!Number.isSafeInteger(next)) return current;
  return Math.max(current, next);
}

/**
 * A mutable multi-digraph with stable string identity.
 *
 * Parallel edges between the same ordered pair are allowed (each edge carries
 * its own id) and so are self loops. Direction matters: `a -> b` and `b -> a`
 * are two different edges.
 *
 * Nodes and edges live in insertion-ordered maps, so every listing method
 * returns elements in the order they were added. A node that is removed and
 * added again is a new insertion, so it moves to the end of iteration order.
 * There is no randomness anywhere, and the only ordering that is not raw
 * insertion order is the neighbour listing from `successors` and
 * `predecessors`, which follows node insertion order. The same sequence of
 * calls always produces the same iteration order, which is what makes layout
 * runs reproducible.
 *
 * Adjacency is indexed per node, so `successors`, `outEdges`, and friends cost
 * O(degree) rather than O(edgeCount), and the degree accessors are O(1)
 * because they read an index size rather than walking it.
 */
export class Graph {
  readonly #nodes = new Map<NodeId, Node>();
  readonly #edges = new Map<EdgeId, Edge>();

  /** Per-node out-edge ids, in insertion order. Present for every node. */
  readonly #outEdges = new Map<NodeId, Set<EdgeId>>();

  /** Per-node in-edge ids, in insertion order. Present for every node. */
  readonly #inEdges = new Map<NodeId, Set<EdgeId>>();

  /**
   * Insertion rank per node, used to order neighbour listings. Present for
   * every node, dropped with the node. Kept out of the public {@link Node}
   * record on purpose: it is an index, not part of a node's identity.
   */
  readonly #nodeRank = new Map<NodeId, number>();

  /** Rank handed to the next node added. Only ever moves forward. */
  #nextNodeRank = 0;

  /** Next candidate suffix for a generated node id (`n1`, `n2`, ...). */
  #nextNodeSeq = 1;

  /** Next candidate suffix for a generated edge id (`e1`, `e2`, ...). */
  #nextEdgeSeq = 1;

  /** Number of nodes currently in the graph. O(1). */
  get nodeCount(): number {
    return this.#nodes.size;
  }

  /** Number of edges currently in the graph. O(1). */
  get edgeCount(): number {
    return this.#edges.size;
  }

  /**
   * Adds a node and returns it. With no argument an id is generated
   * (`n1`, `n2`, ...), skipping any suffix already taken by an explicit id. A
   * single call is worst case O(k) in the taken suffixes it has to skip, and
   * the counter is monotone, so generation is amortised O(1) over the lifetime
   * of the graph. The returned record is frozen.
   *
   * @throws {InvalidIdError} when `id` is an empty string.
   * @throws {DuplicateNodeError} when `id` is already in the graph.
   */
  addNode(id?: NodeId): Node {
    const resolved = id === undefined ? this.#generateNodeId() : id;
    if (resolved === '') throw new InvalidIdError('node', resolved);
    if (this.#nodes.has(resolved)) throw new DuplicateNodeError(resolved);
    this.#nextNodeSeq = advanceSeq(this.#nextNodeSeq, resolved, GENERATED_NODE_ID);
    const node: Node = Object.freeze({ id: resolved });
    this.#nodes.set(resolved, node);
    this.#outEdges.set(resolved, new Set());
    this.#inEdges.set(resolved, new Set());
    this.#nodeRank.set(resolved, this.#nextNodeRank);
    this.#nextNodeRank += 1;
    return node;
  }

  /** Whether a node with this id is in the graph. O(1). */
  hasNode(id: NodeId): boolean {
    return this.#nodes.has(id);
  }

  /** The node with this id, or `undefined`. O(1). */
  getNode(id: NodeId): Node | undefined {
    return this.#nodes.get(id);
  }

  /**
   * The node with this id. Use this when the id is known to be in the graph,
   * such as one {@link successors} just returned, so resolving it to a record
   * does not need a non-null assertion. Use {@link getNode} when absence is a
   * normal answer. O(1).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  requireNode(id: NodeId): Node {
    const node = this.#nodes.get(id);
    if (node === undefined) throw new NodeNotFoundError(id);
    return node;
  }

  /**
   * Removes a node and every edge incident to it: out-edges, in-edges, and
   * self loops. O(degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  removeNode(id: NodeId): void {
    const outgoing = this.#outEdges.get(id);
    const incoming = this.#inEdges.get(id);
    if (outgoing === undefined || incoming === undefined) throw new NodeNotFoundError(id);
    for (const edgeId of [...outgoing, ...incoming]) this.#detachEdge(edgeId);
    this.#outEdges.delete(id);
    this.#inEdges.delete(id);
    this.#nodeRank.delete(id);
    this.#nodes.delete(id);
  }

  /** Every node, in insertion order, as a fresh array. O(nodeCount). */
  nodes(): readonly Node[] {
    return [...this.#nodes.values()];
  }

  /**
   * Adds an edge from `source` to `target` and returns it. With no `id` an id
   * is generated (`e1`, `e2`, ...), skipping any suffix already taken by an
   * explicit id. Same cost as {@link addNode}: worst case O(k) skipped
   * suffixes for one call, amortised O(1) over the lifetime of the graph. The
   * returned record is frozen.
   *
   * @throws {NodeNotFoundError} when either endpoint is not in the graph.
   * @throws {InvalidIdError} when `id` is an empty string.
   * @throws {DuplicateEdgeError} when `id` is already in the graph.
   */
  addEdge(source: NodeId, target: NodeId, id?: EdgeId): Edge {
    const outgoing = this.#outEdges.get(source);
    if (outgoing === undefined) throw new NodeNotFoundError(source);
    const incoming = this.#inEdges.get(target);
    if (incoming === undefined) throw new NodeNotFoundError(target);
    const resolved = id === undefined ? this.#generateEdgeId() : id;
    if (resolved === '') throw new InvalidIdError('edge', resolved);
    if (this.#edges.has(resolved)) throw new DuplicateEdgeError(resolved);
    this.#nextEdgeSeq = advanceSeq(this.#nextEdgeSeq, resolved, GENERATED_EDGE_ID);
    const edge: Edge = Object.freeze({ id: resolved, source, target });
    this.#edges.set(resolved, edge);
    outgoing.add(resolved);
    incoming.add(resolved);
    return edge;
  }

  /** Whether an edge with this id is in the graph. O(1). */
  hasEdge(id: EdgeId): boolean {
    return this.#edges.has(id);
  }

  /** The edge with this id, or `undefined`. O(1). */
  getEdge(id: EdgeId): Edge | undefined {
    return this.#edges.get(id);
  }

  /**
   * The edge with this id. The {@link requireNode} counterpart for edges: use
   * it when the id is known to be in the graph, and {@link getEdge} when
   * absence is a normal answer. O(1).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   */
  requireEdge(id: EdgeId): Edge {
    const edge = this.#edges.get(id);
    if (edge === undefined) throw new EdgeNotFoundError(id);
    return edge;
  }

  /**
   * Removes an edge. Its endpoints stay in the graph. O(1).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   */
  removeEdge(id: EdgeId): void {
    if (!this.#edges.has(id)) throw new EdgeNotFoundError(id);
    this.#detachEdge(id);
  }

  /** Every edge, in insertion order, as a fresh array. O(edgeCount). */
  edges(): readonly Edge[] {
    return [...this.#edges.values()];
  }

  /**
   * Edges leaving this node, in insertion order, as a fresh array.
   * A self loop appears here and in {@link inEdges}. O(out-degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  outEdges(id: NodeId): readonly Edge[] {
    return this.#resolveEdges(this.#requireOut(id));
  }

  /**
   * Edges arriving at this node, in insertion order, as a fresh array.
   * A self loop appears here and in {@link outEdges}. O(in-degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  inEdges(id: NodeId): readonly Edge[] {
    return this.#resolveEdges(this.#requireIn(id));
  }

  /**
   * Distinct targets of this node's out-edges, in node insertion order.
   * Parallel edges yield a single entry, and a self loop makes the node its own
   * successor. The result is a function of which neighbours exist, never of
   * which edge reached one first, so removing a redundant parallel edge leaves
   * it unchanged. O(out-degree), plus a sort over the distinct neighbours.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  successors(id: NodeId): readonly NodeId[] {
    return this.#distinctEndpoints(this.#requireOut(id), 'target');
  }

  /**
   * Distinct sources of this node's in-edges, in node insertion order. Same
   * deduplication and same independence from edge history as
   * {@link successors}. O(in-degree), plus a sort over the distinct neighbours.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  predecessors(id: NodeId): readonly NodeId[] {
    return this.#distinctEndpoints(this.#requireIn(id), 'source');
  }

  /**
   * Every edge from `source` to `target`, in insertion order. Direction
   * matters, so this is not symmetric. O(out-degree of `source`).
   *
   * @throws {NodeNotFoundError} when either endpoint is not in the graph.
   */
  edgesBetween(source: NodeId, target: NodeId): readonly Edge[] {
    const outgoing = this.#requireOut(source);
    this.#requireIn(target);
    const found: Edge[] = [];
    for (const edgeId of outgoing) {
      const edge = this.#requireIndexedEdge(edgeId);
      if (edge.target === target) found.push(edge);
    }
    return found;
  }

  /**
   * Number of edges leaving this node. Counted in edges, so parallel edges
   * count separately and a self loop counts once. O(1).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  outDegree(id: NodeId): number {
    return this.#requireOut(id).size;
  }

  /**
   * Number of edges arriving at this node. Counted in edges, so parallel edges
   * count separately and a self loop counts once. O(1).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  inDegree(id: NodeId): number {
    return this.#requireIn(id).size;
  }

  /**
   * Out-degree plus in-degree. A self loop contributes 1 to each side, so it
   * contributes 2 here. O(1).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  degree(id: NodeId): number {
    return this.outDegree(id) + this.inDegree(id);
  }

  /** The out-edge index for a node that must exist. */
  #requireOut(id: NodeId): ReadonlySet<EdgeId> {
    const outgoing = this.#outEdges.get(id);
    if (outgoing === undefined) throw new NodeNotFoundError(id);
    return outgoing;
  }

  /** The in-edge index for a node that must exist. */
  #requireIn(id: NodeId): ReadonlySet<EdgeId> {
    const incoming = this.#inEdges.get(id);
    if (incoming === undefined) throw new NodeNotFoundError(id);
    return incoming;
  }

  /**
   * The edge an adjacency index entry names.
   *
   * A miss is unreachable through the public API: an id enters an index in the
   * same call that stores the edge and leaves it in the same call that deletes
   * the edge. If it ever happens the index and the store disagree, which is a
   * bug in this class, so it fails loudly rather than quietly returning a
   * shorter answer that would look plausible forever.
   */
  #requireIndexedEdge(edgeId: EdgeId): Edge {
    const edge = this.#edges.get(edgeId);
    if (edge === undefined) {
      throw new Error(`graph invariant: adjacency index holds unknown edge "${edgeId}"`);
    }
    return edge;
  }

  /** Insertion rank of a node that must exist. Unreachable miss, see above. */
  #requireRank(id: NodeId): number {
    const rank = this.#nodeRank.get(id);
    if (rank === undefined) {
      throw new Error(`graph invariant: edge endpoint "${id}" is not a node`);
    }
    return rank;
  }

  /** Edge records for an index entry, as a fresh array. */
  #resolveEdges(edgeIds: ReadonlySet<EdgeId>): readonly Edge[] {
    const resolved: Edge[] = [];
    for (const edgeId of edgeIds) resolved.push(this.#requireIndexedEdge(edgeId));
    return resolved;
  }

  /**
   * Distinct endpoints of an index entry, in node insertion order. Ordering by
   * rank rather than by edge order is what makes the answer depend only on
   * which neighbours exist: dropping one of two parallel edges cannot reorder
   * anything. Degree is small, so the sort is cheap.
   */
  #distinctEndpoints(edgeIds: ReadonlySet<EdgeId>, side: 'source' | 'target'): readonly NodeId[] {
    const seen = new Set<NodeId>();
    for (const edgeId of edgeIds) seen.add(this.#requireIndexedEdge(edgeId)[side]);
    return [...seen].sort((left, right) => this.#requireRank(left) - this.#requireRank(right));
  }

  /** Drops an edge from the store and from both adjacency indexes. O(1). */
  #detachEdge(id: EdgeId): void {
    const edge = this.#edges.get(id);
    // Reachable and legitimate, do not turn this into a throw: removeNode
    // walks the out set and then the in set, so a self loop is visited twice
    // and the second visit correctly finds the edge already gone.
    if (edge === undefined) return;
    const outgoing = this.#outEdges.get(edge.source);
    const incoming = this.#inEdges.get(edge.target);
    // Unreachable: an edge is removed before either endpoint's index entry is,
    // so a live edge always has both entries. Loud failure over silent skew.
    if (outgoing === undefined || incoming === undefined) {
      throw new Error(`graph invariant: edge "${id}" has an endpoint with no adjacency index`);
    }
    outgoing.delete(id);
    incoming.delete(id);
    this.#edges.delete(id);
  }

  /**
   * Next free generated node id. The counter only moves forward and already
   * sits past every explicit id in generated shape, so a call is worst case
   * O(k) probes and amortised O(1) over the lifetime of the graph.
   */
  #generateNodeId(): NodeId {
    let candidate = `n${String(this.#nextNodeSeq)}`;
    while (this.#nodes.has(candidate)) {
      this.#nextNodeSeq += 1;
      candidate = `n${String(this.#nextNodeSeq)}`;
    }
    this.#nextNodeSeq += 1;
    return candidate;
  }

  /** Next free generated edge id. Same forward-only rule as node ids. */
  #generateEdgeId(): EdgeId {
    let candidate = `e${String(this.#nextEdgeSeq)}`;
    while (this.#edges.has(candidate)) {
      this.#nextEdgeSeq += 1;
      candidate = `e${String(this.#nextEdgeSeq)}`;
    }
    this.#nextEdgeSeq += 1;
    return candidate;
  }
}
