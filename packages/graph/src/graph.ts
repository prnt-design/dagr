import {
  DuplicateEdgeError,
  DuplicateNodeError,
  DuplicatePortError,
  EdgeNotFoundError,
  InvalidIdError,
  NodeNotFoundError,
  PortDirectionError,
  PortInUseError,
  PortNotFoundError,
} from './errors.js';
import type {
  Attrs,
  AttrsPatch,
  Edge,
  EdgeId,
  EdgeInit,
  EdgePortsPatch,
  Node,
  NodeId,
  NodeInit,
  Port,
  PortId,
  PortInit,
  ReadAttrs,
} from './types.js';

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
 * Freezes a bag and hands it back under the caller's attribute type.
 *
 * This is the one place the module crosses from its own untyped storage to a
 * caller's typed view, and it needs an assertion to do it: `ReadAttrs<A>` is a
 * mapped type over an unresolved type parameter, and TypeScript will not
 * accept a `Record<string, unknown>` for one however the object was built. The
 * assertion changes only what the compiler is told, never what is stored:
 * every value in `bag` arrived through an `AttrsPatch<A>`, so the claim is true
 * by construction, and keeping the assertion here means no other function in
 * the module needs one.
 */
function sealAttrs<A extends object>(bag: Record<string, unknown>): ReadAttrs<A> {
  return Object.freeze(bag) as ReadAttrs<A>;
}

/** A fresh frozen empty bag. */
function emptyAttrs<A extends object>(): ReadAttrs<A> {
  return sealAttrs<A>({});
}

/**
 * Merges `patch` into `current`, returning a new frozen bag, or `undefined`
 * when the merge would change nothing.
 *
 * Reporting "no change" as `undefined` rather than returning `current` is what
 * lets every caller keep its record identity with a single comparison: a
 * record is rebuilt only when there is something to rebuild it for, which is
 * what makes `getNode(id) === previousNode` a usable "nothing changed here"
 * test. Values are compared with `Object.is`, so `NaN` matches itself and `0`
 * does not match `-0`.
 *
 * A key whose patch value is `undefined` is deleted rather than stored, so a
 * bag never holds an `undefined` value and `'k' in attrs` answers honestly.
 * Freezing is shallow: a nested object value is stored by reference and stays
 * the caller's to keep immutable.
 *
 * O(size of the bag plus size of the patch).
 */
function mergeAttrs<A extends object>(
  current: ReadAttrs<A>,
  patch: AttrsPatch<A>,
): ReadAttrs<A> | undefined {
  // Both listings go through entries rather than a spread so that the generic
  // bag types widen to plain `unknown` values without an assertion.
  const held: [string, unknown][] = Object.entries(current);
  const patched: [string, unknown][] = Object.entries(patch);
  const merged: Record<string, unknown> = Object.fromEntries(held);
  let changed = false;

  for (const [key, value] of patched) {
    if (value === undefined) {
      if (!Object.hasOwn(merged, key)) continue;
      delete merged[key];
      changed = true;
      continue;
    }
    if (Object.hasOwn(merged, key) && Object.is(merged[key], value)) continue;
    // Defined rather than assigned. A plain `merged[key] = value` is an
    // ordinary [[Set]], so a key of `__proto__` reaches the accessor on
    // `Object.prototype` and reassigns the bag's prototype instead of storing
    // an attribute: the value would vanish from `Object.keys` and
    // `JSON.stringify`, the caller's own keys would read back through the bag,
    // and `Object.hasOwn` could never see it, so the no-op detection above
    // would rebuild the record on every repeat of the same patch. Defining the
    // property does none of that, and it leaves the delete branch and the
    // `Object.hasOwn` comparison working unchanged. `Object.fromEntries` above
    // already defines rather than sets, so this is the only site.
    Object.defineProperty(merged, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    changed = true;
  }

  return changed ? sealAttrs<A>(merged) : undefined;
}

/** The bag a freshly declared node or edge starts with. */
function initialAttrs<A extends object>(patch: AttrsPatch<A> | undefined): ReadAttrs<A> {
  const empty = emptyAttrs<A>();
  if (patch === undefined) return empty;
  return mergeAttrs(empty, patch) ?? empty;
}

/**
 * A frozen node record.
 *
 * `ports` is given either as the per-node port index, which is insertion
 * ordered, so the materialised array comes out in declaration order, or as an
 * array a previous record already materialised. The second form is what keeps
 * an attributes-only rebuild from handing back a new array with provably
 * identical contents, which would break the record identity rule for `ports`
 * the way it is already kept for `attrs`. Materialising costs O(port count);
 * passing an array through costs O(1).
 */
function freezeNode<A extends object>(
  id: NodeId,
  attrs: ReadAttrs<A>,
  ports: ReadonlyMap<PortId, Port> | readonly Port[],
): Node<A> {
  // Frozen on both branches, so this function guarantees on its own that what
  // it stores cannot be written to, rather than trusting every array-passing
  // caller to have done it. Freezing an already-frozen array returns the same
  // reference, so the identity the pass-through exists to preserve survives.
  const frozen = Array.isArray(ports) ? Object.freeze(ports) : Object.freeze([...ports.values()]);
  return Object.freeze({ id, attrs, ports: frozen });
}

/**
 * A frozen edge record. The port keys are spread in conditionally rather than
 * assigned `undefined`, because `exactOptionalPropertyTypes` draws a real
 * distinction between "absent" and "present and undefined" and only the first
 * one matches `sourcePort?: PortId`.
 */
function freezeEdge<A extends object>(
  id: EdgeId,
  source: NodeId,
  target: NodeId,
  attrs: ReadAttrs<A>,
  sourcePort: PortId | undefined,
  targetPort: PortId | undefined,
): Edge<A> {
  return Object.freeze({
    id,
    source,
    target,
    attrs,
    ...(sourcePort === undefined ? {} : { sourcePort }),
    ...(targetPort === undefined ? {} : { targetPort }),
  });
}

/**
 * A frozen port record from a declaration. Direction defaults to `'inout'`,
 * the permissive end of the range: a port only constrains an edge once its
 * author says it should.
 *
 * @throws {InvalidIdError} when the port id is an empty string.
 */
function freezePort(init: PortInit): Port {
  if (init.id === '') throw new InvalidIdError('port', init.id);
  return Object.freeze({ id: init.id, direction: init.direction ?? 'inout' });
}

/** The shorthand `addNode(id?)` form, read as the init form. */
function normaliseNodeInit<A extends object>(
  idOrInit: NodeId | NodeInit<A> | undefined,
): NodeInit<A> {
  if (idOrInit === undefined) return {};
  if (typeof idOrInit === 'object') return idOrInit;
  return { id: idOrInit };
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
 *
 * Nodes, edges, and the graph itself carry attribute bags. The three type
 * parameters name what is in them; all three default to `Attrs`, so `new
 * Graph()` and a bare `Graph` annotation keep meaning what they always did.
 * Attribute updates are copy on write: a record that changes is replaced by a
 * new frozen record, a record that does not change keeps its identity, and
 * changing one record never touches another.
 */
export class Graph<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> {
  readonly #nodes = new Map<NodeId, Node<NodeAttrs>>();
  readonly #edges = new Map<EdgeId, Edge<EdgeAttrs>>();

  /** Per-node out-edge ids, in insertion order. Present for every node. */
  readonly #outEdges = new Map<NodeId, Set<EdgeId>>();

  /** Per-node in-edge ids, in insertion order. Present for every node. */
  readonly #inEdges = new Map<NodeId, Set<EdgeId>>();

  /**
   * Per-node port index, in declaration order. Present for every node, dropped
   * with the node. A Map is both halves of what ports need: O(1) lookup for
   * `hasPort` and `getPort`, and insertion order for the declaration-ordered
   * array on the {@link Node} record, which is materialised from it. A second
   * array would only be a copy that can fall out of step.
   */
  readonly #ports = new Map<NodeId, Map<PortId, Port>>();

  /**
   * Insertion rank per node, used to order neighbour listings. Present for
   * every node, dropped with the node. Kept out of the public {@link Node}
   * record on purpose: it is an index, not part of a node's identity.
   */
  readonly #nodeRank = new Map<NodeId, number>();

  /** Graph-level attributes. Frozen, replaced copy on write. */
  #attrs: ReadAttrs<GraphAttrs> = emptyAttrs<GraphAttrs>();

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
   * Graph-level attributes: the frozen bag, not a copy. Everything the graph
   * as a whole carries lives here, such as a layout direction, so a caller
   * does not have to invent a sentinel node to hang it on. O(1).
   */
  get attrs(): ReadAttrs<GraphAttrs> {
    return this.#attrs;
  }

  /**
   * Merges rather than replaces: keys the patch does not name are untouched,
   * and a key whose patch value is `undefined` is deleted rather than stored.
   *
   * Applies `patch` to the graph attributes and returns the resulting bag. When
   * the merge changes nothing the bag that was already held comes back,
   * identity and all. Freezing is shallow, so a nested object value stays the
   * caller's to keep immutable. O(size of the bag plus size of the patch).
   */
  updateAttrs(patch: AttrsPatch<GraphAttrs>): ReadAttrs<GraphAttrs> {
    const merged = mergeAttrs(this.#attrs, patch);
    if (merged !== undefined) this.#attrs = merged;
    return this.#attrs;
  }

  /**
   * Adds a node and returns it.
   *
   * The init form is the full one: `addNode({ id, attrs, ports })`, every
   * field optional. The string form is shorthand for an id and nothing else.
   * With no id an id is generated (`n1`, `n2`, ...), skipping any suffix
   * already taken by an explicit id. A single call is worst case O(k) in the
   * taken suffixes it has to skip, and the counter is monotone, so generation
   * is amortised O(1) over the lifetime of the graph. The returned record is
   * frozen.
   *
   * Every check runs before anything is written, and the id counter moves only
   * once the call is certain to succeed, so a rejected call leaves the graph
   * exactly as it was and does not spend a generated id.
   *
   * @throws {InvalidIdError} when the node id or a port id is an empty string.
   * @throws {DuplicateNodeError} when the id is already in the graph.
   * @throws {DuplicatePortError} when the port list declares an id twice.
   */
  addNode(id?: NodeId): Node<NodeAttrs>;
  addNode(init: NodeInit<NodeAttrs>): Node<NodeAttrs>;
  addNode(idOrInit?: NodeId | NodeInit<NodeAttrs>): Node<NodeAttrs> {
    const init = normaliseNodeInit(idOrInit);
    const resolved = init.id ?? this.#peekNodeId();
    if (resolved === '') throw new InvalidIdError('node', resolved);
    if (this.#nodes.has(resolved)) throw new DuplicateNodeError(resolved);
    const ports = this.#declarePorts(resolved, init.ports);
    const attrs = initialAttrs(init.attrs);

    this.#nextNodeSeq = advanceSeq(this.#nextNodeSeq, resolved, GENERATED_NODE_ID);
    const node = freezeNode(resolved, attrs, ports);
    this.#nodes.set(resolved, node);
    this.#ports.set(resolved, ports);
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
  getNode(id: NodeId): Node<NodeAttrs> | undefined {
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
  requireNode(id: NodeId): Node<NodeAttrs> {
    const node = this.#nodes.get(id);
    if (node === undefined) throw new NodeNotFoundError(id);
    return node;
  }

  /**
   * Merges rather than replaces: keys the patch does not name are untouched,
   * and a key whose patch value is `undefined` is deleted rather than stored.
   *
   * Applies `patch` to a node's attributes and returns the node record that now
   * answers for the id. Copy on write: when the merge changes something the
   * node is replaced by a new frozen record and the old one is left intact, and
   * when it changes nothing the record already held comes back unchanged, so
   * `updateNodeAttrs(id, patch) === previousNode` is a usable "nothing
   * happened" test. Freezing is shallow, so a nested object value stays the
   * caller's to keep immutable. Nothing else moves: the node keeps its ports,
   * down to the identity of the array they are in, its adjacency, its place in
   * iteration order, and no other record changes identity.
   * O(size of the bag plus size of the patch).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  updateNodeAttrs(id: NodeId, patch: AttrsPatch<NodeAttrs>): Node<NodeAttrs> {
    const node = this.requireNode(id);
    const attrs = mergeAttrs(node.attrs, patch);
    if (attrs === undefined) return node;
    // The frozen array the old record already carries, passed straight through
    // rather than re-materialised from the port index: the ports did not
    // change, so the array must not change identity either. A cached array
    // keyed by node id would reach the same place, but it would be a second
    // structure that can fall out of step with `#ports`, which is exactly what
    // the `#ports` comment above argues against. There is no lookup to guard
    // here either, because `requireNode` already proved the node exists.
    const next = freezeNode(node.id, attrs, node.ports);
    // Overwriting an existing key leaves a Map entry where it was, so this
    // cannot reorder anything a listing depends on.
    this.#nodes.set(id, next);
    return next;
  }

  /**
   * Removes a node, its ports, and every edge incident to it: out-edges,
   * in-edges, and self loops. O(degree).
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
    this.#ports.delete(id);
    this.#nodeRank.delete(id);
    this.#nodes.delete(id);
  }

  /** Every node, in insertion order, as a fresh array. O(nodeCount). */
  nodes(): readonly Node<NodeAttrs>[] {
    return [...this.#nodes.values()];
  }

  /**
   * Declares a port on a node and returns the node record that now answers for
   * the id. Copy on write, exactly like {@link updateNodeAttrs}: the node is
   * replaced by a new frozen record and nothing else moves. There is no no-op
   * case to preserve identity for, because a duplicate id throws instead of
   * being absorbed. `direction` defaults to `'inout'`. O(port count), the cost
   * of rebuilding the declaration-ordered array. The new port goes last.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   * @throws {InvalidIdError} when the port id is an empty string.
   * @throws {DuplicatePortError} when the node already declares that port.
   */
  addPort(nodeId: NodeId, init: PortInit): Node<NodeAttrs> {
    const node = this.requireNode(nodeId);
    const ports = this.#requirePorts(nodeId);
    const port = freezePort(init);
    if (ports.has(port.id)) throw new DuplicatePortError(nodeId, port.id);
    ports.set(port.id, port);
    const next = freezeNode(node.id, node.attrs, ports);
    this.#nodes.set(nodeId, next);
    return next;
  }

  /**
   * Removes a port and returns the node record that now answers for the id.
   * Copy on write, and again with no no-op case: a missing port throws rather
   * than being absorbed. O(degree of the node plus its port count).
   *
   * A port that live edges still reference is refused rather than taken with
   * its edges. Silently deleting edges the caller did not name is a bigger
   * surprise than an error they can act on, and the error carries the edge ids
   * so they can rewire or remove them and retry. Callers who do want the
   * cascade already have {@link removeNode}, which takes the node, its ports,
   * and its incident edges together.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   * @throws {PortNotFoundError} when the node does not declare that port.
   * @throws {PortInUseError} when a live edge still references the port.
   */
  removePort(nodeId: NodeId, portId: PortId): Node<NodeAttrs> {
    const node = this.requireNode(nodeId);
    const ports = this.#requirePorts(nodeId);
    if (!ports.has(portId)) throw new PortNotFoundError(nodeId, portId);
    const users = this.#edgesUsingPort(nodeId, portId);
    if (users.length > 0) throw new PortInUseError(nodeId, portId, users);
    ports.delete(portId);
    const next = freezeNode(node.id, node.attrs, ports);
    this.#nodes.set(nodeId, next);
    return next;
  }

  /**
   * Whether a node declares this port. O(1), an index lookup rather than a
   * scan of the declaration array.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  hasPort(nodeId: NodeId, portId: PortId): boolean {
    return this.#requirePorts(nodeId).has(portId);
  }

  /**
   * The port record, or `undefined` when the node does not declare it. O(1).
   * An unknown node is still an error: the node is the context of the
   * question, not part of the answer.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  getPort(nodeId: NodeId, portId: PortId): Port | undefined {
    return this.#requirePorts(nodeId).get(portId);
  }

  /**
   * A node's ports, in declaration order. The same frozen array the node
   * record carries, so it is free to call and safe to keep. O(1).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  ports(nodeId: NodeId): readonly Port[] {
    return this.requireNode(nodeId).ports;
  }

  /**
   * Adds an edge and returns it.
   *
   * The init form is the full one: `addEdge({ source, target, id, attrs,
   * sourcePort, targetPort })`. The positional form is shorthand for the
   * endpoints and an id. With no id an id is generated (`e1`, `e2`, ...),
   * skipping any suffix already taken by an explicit id. Same cost as
   * {@link addNode}: worst case O(k) skipped suffixes for one call, amortised
   * O(1) over the lifetime of the graph. The returned record is frozen.
   *
   * A named port must be declared on the node it is named for and must face
   * the right way, since an edge leaves its source and arrives at its target.
   * A self loop may name a port at each end, either two different ports or the
   * same `'inout'` port twice, since such a port passes both checks. Every check
   * runs before anything is written and before the id counter moves, so a
   * rejected call leaves the graph exactly as it was and does not spend a
   * generated id.
   *
   * @throws {NodeNotFoundError} when either endpoint is not in the graph.
   * @throws {InvalidIdError} when the edge id or a port id is an empty string.
   * @throws {DuplicateEdgeError} when the id is already in the graph.
   * @throws {PortNotFoundError} when a named port is not declared on its node.
   * @throws {PortDirectionError} when a named port faces the wrong way.
   */
  addEdge(source: NodeId, target: NodeId, id?: EdgeId): Edge<EdgeAttrs>;
  addEdge(init: EdgeInit<EdgeAttrs>): Edge<EdgeAttrs>;
  addEdge(
    sourceOrInit: NodeId | EdgeInit<EdgeAttrs>,
    // Only reachable from JavaScript: the overloads make the second argument
    // required for the positional form. An omitted endpoint then reads as the
    // empty id and comes back as a NodeNotFoundError rather than a crash.
    target = '',
    id?: EdgeId,
  ): Edge<EdgeAttrs> {
    const init: EdgeInit<EdgeAttrs> =
      typeof sourceOrInit === 'object'
        ? sourceOrInit
        : { source: sourceOrInit, target, ...(id === undefined ? {} : { id }) };

    const outgoing = this.#outEdges.get(init.source);
    if (outgoing === undefined) throw new NodeNotFoundError(init.source);
    const incoming = this.#inEdges.get(init.target);
    if (incoming === undefined) throw new NodeNotFoundError(init.target);

    this.#requireUsablePort(init.source, init.sourcePort, 'source');
    this.#requireUsablePort(init.target, init.targetPort, 'target');

    const resolved = init.id ?? this.#peekEdgeId();
    if (resolved === '') throw new InvalidIdError('edge', resolved);
    if (this.#edges.has(resolved)) throw new DuplicateEdgeError(resolved);
    const attrs = initialAttrs(init.attrs);

    this.#nextEdgeSeq = advanceSeq(this.#nextEdgeSeq, resolved, GENERATED_EDGE_ID);
    const edge = freezeEdge(
      resolved,
      init.source,
      init.target,
      attrs,
      init.sourcePort,
      init.targetPort,
    );
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
  getEdge(id: EdgeId): Edge<EdgeAttrs> | undefined {
    return this.#edges.get(id);
  }

  /**
   * The edge with this id. The {@link requireNode} counterpart for edges: use
   * it when the id is known to be in the graph, and {@link getEdge} when
   * absence is a normal answer. O(1).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   */
  requireEdge(id: EdgeId): Edge<EdgeAttrs> {
    const edge = this.#edges.get(id);
    if (edge === undefined) throw new EdgeNotFoundError(id);
    return edge;
  }

  /**
   * Merges rather than replaces: keys the patch does not name are untouched,
   * and a key whose patch value is `undefined` is deleted rather than stored.
   *
   * Applies `patch` to an edge's attributes and returns the edge record that
   * now answers for the id. The rest of the {@link updateNodeAttrs} rules apply
   * unchanged: copy on write with identity preserved when nothing changes, and
   * a shallow freeze. The adjacency indexes hold edge ids rather than records,
   * so nothing has to be reindexed and no node record changes identity. The
   * port bindings ride along untouched; {@link updateEdgePorts} is what moves
   * those. O(size of the bag plus size of the patch).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   */
  updateEdgeAttrs(id: EdgeId, patch: AttrsPatch<EdgeAttrs>): Edge<EdgeAttrs> {
    const edge = this.requireEdge(id);
    const attrs = mergeAttrs(edge.attrs, patch);
    if (attrs === undefined) return edge;
    const next = freezeEdge(
      edge.id,
      edge.source,
      edge.target,
      attrs,
      edge.sourcePort,
      edge.targetPort,
    );
    this.#edges.set(id, next);
    return next;
  }

  /**
   * Rebinds an edge's port references and returns the edge record that now
   * answers for the id.
   *
   * This is the rewire path {@link PortInUseError} names: dragging an endpoint
   * from one port to another, or detaching it, without the edge losing
   * anything. The edge keeps its id, its endpoints, its attributes, and its
   * place in edge insertion order, which is the whole reason this exists
   * rather than a remove followed by an add.
   *
   * Merge, not replace, exactly like the attribute setters: a key the argument
   * does not name leaves that end alone, and an explicit `undefined` detaches
   * that end. Copy on write with identity preserved: rebinding an end to the
   * port it already names returns the record already held. Every check runs
   * against the edge's current `source` and `target` before anything is
   * written, so a rejected call leaves the edge exactly as it was, the valid
   * half of a patch included. O(1).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   * @throws {InvalidIdError} when a port id is an empty string.
   * @throws {PortNotFoundError} when a named port is not declared on its node.
   * @throws {PortDirectionError} when a named port faces the wrong way.
   */
  updateEdgePorts(id: EdgeId, ports: EdgePortsPatch): Edge<EdgeAttrs> {
    const edge = this.requireEdge(id);
    // `Object.hasOwn` rather than an `=== undefined` test, because absent and
    // present-and-undefined are the two different requests this takes.
    const sourcePort = Object.hasOwn(ports, 'sourcePort') ? ports.sourcePort : edge.sourcePort;
    const targetPort = Object.hasOwn(ports, 'targetPort') ? ports.targetPort : edge.targetPort;

    this.#requireUsablePort(edge.source, sourcePort, 'source');
    this.#requireUsablePort(edge.target, targetPort, 'target');

    if (sourcePort === edge.sourcePort && targetPort === edge.targetPort) return edge;
    const next = freezeEdge(edge.id, edge.source, edge.target, edge.attrs, sourcePort, targetPort);
    // Overwriting an existing key leaves a Map entry where it was, and the
    // adjacency indexes hold edge ids rather than records, so neither the edge
    // listing order nor any node record moves.
    this.#edges.set(id, next);
    return next;
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
  edges(): readonly Edge<EdgeAttrs>[] {
    return [...this.#edges.values()];
  }

  /**
   * Edges leaving this node, in insertion order, as a fresh array.
   * A self loop appears here and in {@link inEdges}. O(out-degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  outEdges(id: NodeId): readonly Edge<EdgeAttrs>[] {
    return this.#resolveEdges(this.#requireOut(id));
  }

  /**
   * Edges arriving at this node, in insertion order, as a fresh array.
   * A self loop appears here and in {@link outEdges}. O(in-degree).
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  inEdges(id: NodeId): readonly Edge<EdgeAttrs>[] {
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
  edgesBetween(source: NodeId, target: NodeId): readonly Edge<EdgeAttrs>[] {
    const outgoing = this.#requireOut(source);
    this.#requireIn(target);
    const found: Edge<EdgeAttrs>[] = [];
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

  /** The port index for a node that must exist. */
  #requirePorts(id: NodeId): Map<PortId, Port> {
    const ports = this.#ports.get(id);
    if (ports === undefined) throw new NodeNotFoundError(id);
    return ports;
  }

  /**
   * The port index a `ports` declaration list builds, validated in full before
   * any of it is stored. Declaration order is list order.
   */
  #declarePorts(nodeId: NodeId, inits: readonly PortInit[] | undefined): Map<PortId, Port> {
    const ports = new Map<PortId, Port>();
    if (inits === undefined) return ports;
    for (const init of inits) {
      const port = freezePort(init);
      if (ports.has(port.id)) throw new DuplicatePortError(nodeId, port.id);
      ports.set(port.id, port);
    }
    return ports;
  }

  /**
   * Checks that a named port exists on the node an edge names it for and faces
   * the right way. An unnamed port is always fine: naming one is optional.
   */
  #requireUsablePort(
    nodeId: NodeId,
    portId: PortId | undefined,
    end: 'source' | 'target',
  ): void {
    if (portId === undefined) return;
    if (portId === '') throw new InvalidIdError('port', portId);
    const port = this.#requirePorts(nodeId).get(portId);
    if (port === undefined) throw new PortNotFoundError(nodeId, portId);
    const wanted = end === 'source' ? 'out' : 'in';
    if (port.direction !== wanted && port.direction !== 'inout') {
      throw new PortDirectionError(nodeId, portId, port.direction, end);
    }
  }

  /**
   * Ids of the live edges still referencing a port, in out-then-in order and
   * without repeats.
   *
   * This walks the node's own adjacency indexes rather than every edge in the
   * graph, so it costs O(degree) and needs no new state to keep in step. A
   * per-port reference count would be O(1) here but would have to be
   * maintained by every edge add and remove, which is more surface for a bug
   * than a scan of a listing the node already has.
   */
  #edgesUsingPort(nodeId: NodeId, portId: PortId): EdgeId[] {
    // A self loop can name the same port at both ends, so it would otherwise
    // be reported twice.
    const users = new Set<EdgeId>();
    for (const edgeId of this.#requireOut(nodeId)) {
      if (this.#requireIndexedEdge(edgeId).sourcePort === portId) users.add(edgeId);
    }
    for (const edgeId of this.#requireIn(nodeId)) {
      if (this.#requireIndexedEdge(edgeId).targetPort === portId) users.add(edgeId);
    }
    return [...users];
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
  #requireIndexedEdge(edgeId: EdgeId): Edge<EdgeAttrs> {
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
  #resolveEdges(edgeIds: ReadonlySet<EdgeId>): readonly Edge<EdgeAttrs>[] {
    const resolved: Edge<EdgeAttrs>[] = [];
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
   * Next free generated node id, without spending it. The counter moves in the
   * commit step of `addNode` instead, so a call that peeks and then rejects
   * the node for some other reason leaves generation exactly where it was. The
   * counter only moves forward and already sits past every explicit id in
   * generated shape, so a call is worst case O(k) probes and amortised O(1)
   * over the lifetime of the graph.
   */
  #peekNodeId(): NodeId {
    let seq = this.#nextNodeSeq;
    while (this.#nodes.has(`n${String(seq)}`)) seq += 1;
    return `n${String(seq)}`;
  }

  /** Next free generated edge id. Same forward-only rule as node ids. */
  #peekEdgeId(): EdgeId {
    let seq = this.#nextEdgeSeq;
    while (this.#edges.has(`e${String(seq)}`)) seq += 1;
    return `e${String(seq)}`;
  }
}
