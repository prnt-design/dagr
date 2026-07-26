import {
  DuplicateEdgeError,
  DuplicateNodeError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
} from './errors.js';
import type { Edge, EdgeId, Node, NodeId } from './types.js';

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
 * There is no sorting and no randomness anywhere: the same sequence of calls
 * always produces the same iteration order, which is what makes layout runs
 * reproducible.
 *
 * Adjacency is indexed per node, so `successors`, `outEdges`, `degree`, and
 * friends cost O(degree) rather than O(edgeCount).
 */
export class Graph {
  readonly #nodes = new Map<NodeId, Node>();
  readonly #edges = new Map<EdgeId, Edge>();

  /** Per-node out-edge ids, in insertion order. Present for every node. */
  readonly #outEdges = new Map<NodeId, Set<EdgeId>>();

  /** Per-node in-edge ids, in insertion order. Present for every node. */
  readonly #inEdges = new Map<NodeId, Set<EdgeId>>();

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
   * (`n1`, `n2`, ...), skipping any suffix already taken by an explicit id.
   * O(1).
   *
   * @throws {InvalidIdError} when `id` is an empty string.
   * @throws {DuplicateNodeError} when `id` is already in the graph.
   */
  addNode(id?: NodeId): Node {
    const resolved = id === undefined ? this.#generateNodeId() : id;
    if (resolved === '') throw new InvalidIdError('node');
    if (this.#nodes.has(resolved)) throw new DuplicateNodeError(resolved);
    const node: Node = { id: resolved };
    this.#nodes.set(resolved, node);
    this.#outEdges.set(resolved, new Set());
    this.#inEdges.set(resolved, new Set());
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
    this.#nodes.delete(id);
  }

  /** Every node, in insertion order, as a fresh array. O(nodeCount). */
  nodes(): readonly Node[] {
    return [...this.#nodes.values()];
  }

  /**
   * Adds an edge from `source` to `target` and returns it. With no `id` an id
   * is generated (`e1`, `e2`, ...), skipping any suffix already taken by an
   * explicit id. O(1).
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
    if (resolved === '') throw new InvalidIdError('edge');
    if (this.#edges.has(resolved)) throw new DuplicateEdgeError(resolved);
    const edge: Edge = { id: resolved, source, target };
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
   * Distinct targets of this node's out-edges, ordered by the first edge that
   * connects to each one. Parallel edges yield a single entry, and a self loop
   * makes the node its own successor. O(out-degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  successors(id: NodeId): readonly NodeId[] {
    return this.#distinctEndpoints(this.#requireOut(id), 'target');
  }

  /**
   * Distinct sources of this node's in-edges, ordered by the first edge that
   * connects to each one. Same deduplication rules as {@link successors}.
   * O(in-degree).
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
      const edge = this.#edges.get(edgeId);
      if (edge !== undefined && edge.target === target) found.push(edge);
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

  /** Edge records for an index entry, as a fresh array. */
  #resolveEdges(edgeIds: ReadonlySet<EdgeId>): readonly Edge[] {
    const resolved: Edge[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.#edges.get(edgeId);
      if (edge !== undefined) resolved.push(edge);
    }
    return resolved;
  }

  /** Distinct endpoints of an index entry, in first-connection order. */
  #distinctEndpoints(edgeIds: ReadonlySet<EdgeId>, side: 'source' | 'target'): readonly NodeId[] {
    const seen = new Set<NodeId>();
    for (const edgeId of edgeIds) {
      const edge = this.#edges.get(edgeId);
      if (edge !== undefined) seen.add(edge[side]);
    }
    return [...seen];
  }

  /** Drops an edge from the store and from both adjacency indexes. O(1). */
  #detachEdge(id: EdgeId): void {
    const edge = this.#edges.get(id);
    if (edge === undefined) return;
    this.#outEdges.get(edge.source)?.delete(id);
    this.#inEdges.get(edge.target)?.delete(id);
    this.#edges.delete(id);
  }

  /**
   * Next free generated node id. The counter only moves forward, so the common
   * case is O(1) per insert; it advances past ids a caller claimed explicitly
   * rather than rescanning from zero.
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
