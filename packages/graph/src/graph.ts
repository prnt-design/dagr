import {
  CycleError,
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
import { canReach, findCycle, reachable, topologicalOrder } from './traversal.js';
import type { AdjacencyView } from './traversal.js';
import { parseGraphJSON } from './serialize.js';
import type { EdgeJSON, GraphJSON, NodeJSON, PortJSON } from './serialize.js';
import { PatchListenerError } from './patch.js';
import type {
  AddEdgeOp,
  AddNodeOp,
  AddPortOp,
  Patch,
  PatchListener,
  PatchOp,
  RemoveEdgeOp,
  RemoveNodeOp,
  RemovePortOp,
} from './patch.js';
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
 * Freezes a bag and hands it back as a patch over the caller's attribute type.
 *
 * The counterpart of {@link sealAttrs}, and it needs an assertion for the same
 * reason: {@link AttrsPatch} is a mapped type over an unresolved type
 * parameter. The claim is true by construction here too, since every key came
 * from an `AttrsPatch<A>` and every value is either one the caller supplied or
 * one this module read back out of a bag those values built. A patch may hold
 * an `undefined` value where a stored bag may not, which is why this is a
 * second function rather than a call to `sealAttrs`.
 */
function sealPatch<A extends object>(bag: Record<string, unknown>): AttrsPatch<A> {
  return Object.freeze(bag) as AttrsPatch<A>;
}

/**
 * Stores a key on a bag under construction, defining rather than assigning.
 *
 * A plain `bag[key] = value` is an ordinary [[Set]], so a key of `__proto__`
 * reaches the accessor on `Object.prototype` and reassigns the bag's prototype
 * instead of storing an attribute: the value would vanish from `Object.keys`
 * and `JSON.stringify`, the caller's own keys would read back through the bag,
 * and `Object.hasOwn` could never see it, so no-op detection would rebuild the
 * record on every repeat of the same patch. Defining the property does none of
 * that, and it leaves deletes and `Object.hasOwn` comparisons working
 * unchanged. Every bag built here from caller-supplied keys goes through this
 * function or through `Object.fromEntries`, which also defines rather than
 * sets.
 */
function define(bag: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(bag, key, { value, writable: true, enumerable: true, configurable: true });
}

/** The two report bags while they are still being written to. */
interface DiffBags {
  readonly after: Record<string, unknown>;
  readonly before: Record<string, unknown>;
}

/**
 * What a merge did: the bag it produced, and, when the caller asked for one,
 * the description of the keys that moved.
 */
interface AttrsDiff<A extends object> {
  /** The new frozen bag. */
  readonly merged: ReadAttrs<A>;
  /**
   * Present only when the caller asked for it, which is to say only when
   * something is watching and the emitted op is going to carry it.
   *
   * Optional rather than always built, and that is the point of the shape: an
   * emission site cannot reach for a report that was never allocated, so
   * "emit only what was built" is enforced by the type rather than by a
   * second `#observed` test sitting next to the one that decided. `after`
   * names exactly the keys that changed at their new values, `before` the same
   * keys at their prior ones. Both frozen.
   */
  readonly report?: { readonly after: AttrsPatch<A>; readonly before: AttrsPatch<A> };
}

/**
 * Merges `patch` into `current` and reports what changed, or `undefined` when
 * the merge would change nothing.
 *
 * Reporting "no change" as `undefined` rather than returning `current` is what
 * lets every caller keep its record identity with a single comparison: a
 * record is rebuilt only when there is something to rebuild it for, which is
 * what makes `getNode(id) === previousNode` a usable "nothing changed here"
 * test. The same comparison decides whether a patch is emitted at all. Values
 * are compared with `Object.is`, so `NaN` matches itself and `0` does not
 * match `-0`.
 *
 * A key whose patch value is `undefined` is deleted rather than stored, so a
 * bag never holds an `undefined` value and `'k' in attrs` answers honestly.
 * The two report bags are the normalised description of that: they name only
 * the keys that moved, and a key present with `undefined` means "absent", in
 * `after` a delete and in `before` a key that was not there. That is what makes
 * swapping them a correct undo. Freezing is shallow: a nested object value is
 * stored by reference and stays the caller's to keep immutable.
 *
 * `observed` is the caller's answer to "will anyone read the report", threaded
 * in rather than asked afterwards. Building two bags and freezing them is most
 * of the cost of an attribute update, and on an unwatched graph every byte of
 * it is thrown away: the guard has to sit here, where the allocation is, not at
 * the emission site the allocation has already happened for.
 *
 * O(size of the bag plus size of the patch).
 */
function diffAttrs<A extends object>(
  current: ReadAttrs<A>,
  patch: AttrsPatch<A>,
  observed: boolean,
): AttrsDiff<A> | undefined {
  // Both listings go through entries rather than a spread so that the generic
  // bag types widen to plain `unknown` values without an assertion.
  const held: [string, unknown][] = Object.entries(current);
  const patched: [string, unknown][] = Object.entries(patch);
  const merged: Record<string, unknown> = Object.fromEntries(held);
  // One holder rather than two locals, so the loop below tests once per key
  // rather than twice and neither bag can be written without the other.
  const bags: DiffBags | undefined = observed ? { after: {}, before: {} } : undefined;
  let changed = false;

  for (const [key, value] of patched) {
    if (value === undefined) {
      if (!Object.hasOwn(merged, key)) continue;
      if (bags !== undefined) {
        define(bags.before, key, merged[key]);
        define(bags.after, key, undefined);
      }
      delete merged[key];
      changed = true;
      continue;
    }
    if (Object.hasOwn(merged, key) && Object.is(merged[key], value)) continue;
    if (bags !== undefined) {
      define(bags.before, key, Object.hasOwn(merged, key) ? merged[key] : undefined);
      define(bags.after, key, value);
    }
    define(merged, key, value);
    changed = true;
  }

  if (!changed) return undefined;
  const sealed = sealAttrs<A>(merged);
  if (bags === undefined) return { merged: sealed };
  return {
    merged: sealed,
    report: { after: sealPatch<A>(bags.after), before: sealPatch<A>(bags.before) },
  };
}

/**
 * The bag a freshly declared node or edge starts with. Never reported on: the
 * declaration emits an `add-node` or `add-edge` op carrying the whole bag, so
 * there is no diff for anything to read.
 */
function initialAttrs<A extends object>(patch: AttrsPatch<A> | undefined): ReadAttrs<A> {
  const empty = emptyAttrs<A>();
  if (patch === undefined) return empty;
  return diffAttrs(empty, patch, false)?.merged ?? empty;
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

/**
 * The `add-node` or `remove-node` op for a node record.
 *
 * The record is spread rather than copied field by field, so the op carries the
 * frozen bag and the frozen port array the record already holds: an op costs
 * one small object and no deep copy, and the payload cannot drift out of step
 * with the record shape.
 */
function nodeOp<A extends object>(
  op: 'add-node' | 'remove-node',
  node: Node<A>,
): AddNodeOp<A> | RemoveNodeOp<A> {
  return Object.freeze({ ...node, op });
}

/**
 * The `add-edge` or `remove-edge` op for an edge record. Spread for the same
 * reasons as {@link nodeOp}, with one more: an unbound end is an absent key on
 * the record, and spreading is what keeps it absent rather than present and
 * `undefined`, which is the distinction `exactOptionalPropertyTypes` draws and
 * the one `invert` and `apply` both rely on.
 */
function edgeOp<A extends object>(
  op: 'add-edge' | 'remove-edge',
  edge: Edge<A>,
): AddEdgeOp<A> | RemoveEdgeOp<A> {
  return Object.freeze({ ...edge, op });
}

/** The `add-port` or `remove-port` op for a port at a known position. */
function portOp(
  op: 'add-port' | 'remove-port',
  nodeId: NodeId,
  port: Port,
  index: number,
): AddPortOp | RemovePortOp {
  return Object.freeze({ op, nodeId, port, index });
}

/**
 * The `attrs` key of a document element, present only when the bag has a key.
 *
 * A fresh bag rather than the record's own, so the document a caller is handed
 * is theirs to edit and does not carry the record's freeze into a value that is
 * about to be written to a file. The copy is one level deep: the graph never
 * reads an attribute, so serialization has no business cloning one either, and
 * the values inside stay shared with the graph exactly as they already are
 * between the graph and whoever passed them to `addNode`.
 *
 * `fromEntries` defines rather than sets, for the same reason {@link define}
 * exists: a `__proto__` attribute key would otherwise reassign this object's
 * prototype and vanish from the document. The assertion is the one
 * {@link sealAttrs} explains, minus the freeze.
 */
function attrsJSON<A extends object>(attrs: ReadAttrs<A>): { readonly attrs?: ReadAttrs<A> } {
  const entries: [string, unknown][] = Object.entries(attrs);
  if (entries.length === 0) return {};
  return { attrs: Object.fromEntries(entries) as ReadAttrs<A> };
}

/**
 * A validated bag handed on under the attribute type the caller claimed.
 *
 * The mirror of {@link sealAttrs} on the way in, and it needs an assertion for
 * the same reason: {@link AttrsPatch} is a mapped type over an unresolved type
 * parameter and no `Record<string, unknown>` satisfies one however it was
 * built. What makes the claim safe is different here, though, and weaker: the
 * validator proved the bag is a bag and nothing more, because the graph never
 * reads an attribute and so has nothing to check a value against. The type
 * parameters on `fromJSON` are the caller's assertion about a document they
 * chose to read, which is what the docstring there says out loud.
 */
function claimAttrs<A extends object>(bag: ReadAttrs<Attrs>): AttrsPatch<A> {
  return bag as AttrsPatch<A>;
}

/** The `ports` key of a node, present only when the node declares one. */
function portsJSON(ports: readonly Port[]): { readonly ports?: readonly PortJSON[] } {
  if (ports.length === 0) return {};
  return { ports: ports.map((port) => ({ id: port.id, direction: port.direction })) };
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
 *
 * Every mutation that changes something emits one {@link Patch} to whatever
 * {@link subscribe} registered, and a mutation that changes nothing emits
 * none: the emission-side twin of the copy on write rule above. A graph nobody
 * subscribed to keeps no journal and costs nothing for it.
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

  /**
   * Patch listeners, in subscription order. A Set rather than an array, so
   * subscribing the same function twice registers it once and unsubscribing is
   * O(1). Empty on a graph nobody watches, which is what makes emission free
   * for callers who do not want it: no journal is kept anywhere.
   */
  readonly #listeners = new Set<PatchListener<NodeAttrs, EdgeAttrs, GraphAttrs>>();

  /**
   * How many {@link batch} calls are open. Zero means a mutation emits as it
   * always did, and anything above zero means it collects into {@link #batched}
   * instead. Depth rather than a flag, because a nested batch joins the one
   * around it: a caller composing two helpers that each batch must not have the
   * inner one emit halfway through the outer one's edit.
   */
  #batchDepth = 0;

  /**
   * Ops collected by the open batch, in the order the calls made them. Replaced
   * by a fresh array when the batch closes rather than emptied in place, so the
   * patch handed to the listeners is not an array this graph still writes to.
   * Only ever written while {@link #observed}, so an unwatched batch keeps no
   * journal for the same reason an unwatched mutation does not.
   */
  #batched: PatchOp<NodeAttrs, EdgeAttrs, GraphAttrs>[] = [];

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
   * Watches every mutation, and returns the function that stops watching.
   *
   * The listener is handed one frozen {@link Patch} per state-changing call,
   * after that call is committed, so a listener reads a graph that already
   * shows what the patch describes. A call that changes nothing emits nothing,
   * so a listener never has to filter empty patches out for itself.
   *
   * Listeners run over a snapshot of the listener set, so a listener that
   * subscribes or unsubscribes during emission changes who is called from the
   * next patch rather than from the middle of this one. Every listener runs
   * even if an earlier one throws, and what the listeners threw comes back out
   * of the mutating call as one {@link PatchListenerError} whatever the count.
   * The mutation stays committed either way, which is why that error is not a
   * `DagrGraphError`: the graph did not refuse anything.
   *
   * A listener that mutates the graph it is watching is served depth first: the
   * nested patch reaches every listener, the mutating one included, before this
   * emission resumes, so a later listener sees the effect before the cause.
   * There is no re-entrancy guard, so a listener that mutates on every patch
   * recurses until the stack gives out. The graph model guide traces the
   * ordering in full under "Listener semantics".
   *
   * O(listener count) per mutation, and nothing at all with no listeners.
   */
  subscribe(listener: PatchListener<NodeAttrs, EdgeAttrs, GraphAttrs>): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Runs `body` and emits everything it changed as one {@link Patch}, returning
   * whatever `body` returned.
   *
   * This holds the emission back and nothing else. Every call inside commits as
   * it is made, so the graph a later call in the body reads is the graph the
   * earlier ones made, and a batch is not a staging area, a transaction, or a
   * second way to write. What it decides is which graph states a listener is
   * shown: "add node, add edge, add edge" unbatched shows a layout consumer a
   * disconnected singleton to place, then corrects it twice, and none of those
   * states is a graph the caller meant to draw.
   *
   * A batch is a `Patch` and not a type of its own, which is what keeps the rest
   * of the package unchanged: it is an ordered array of cascade-free ops, so
   * {@link invert} reverses and inverts it into the undo of the whole edit, and
   * {@link apply} replays it. A batch that changed nothing emits nothing, the
   * same rule a single call follows.
   *
   * NOTHING ROLLS BACK. A call the graph refuses throws out of here with the
   * calls before it already committed, and the ops they made are emitted on the
   * way out rather than dropped, because a listener mirroring this graph would
   * otherwise be silently wrong from that point on. All-or-nothing would mean
   * undoing the committed part by replaying an inverse, and replay restores
   * content but not insertion order (see {@link apply}), so the rollback would
   * be a different graph while claiming to be the original one.
   *
   * There is one emission and it happens at the close, over the listener set as
   * it is then. A listener that subscribed inside the body therefore reads the
   * whole batch, ops that predate its subscription included, and a listener that
   * unsubscribed inside the body reads none of it. Both follow from where the
   * emission is, and both are reasons to leave a batch you did not open alone.
   * The depth is back to zero before the emission, so a listener that mutates
   * while reading a batch emits its own patch rather than joining the one it is
   * being handed.
   *
   * `body` must be synchronous, for the reason {@link PatchListener} must be:
   * the return type is generic, so an `async` function is accepted and nothing
   * complains, but the batch closes at the first `await` and every mutation
   * after it emits on its own. That degrades to unbatched rather than to wrong.
   *
   * O(ops collected) on top of what the calls themselves cost, and nothing at
   * all on a graph nobody subscribed to.
   */
  batch<T>(body: () => T): T {
    this.#batchDepth += 1;
    let result: T;
    try {
      result = body();
    } catch (error) {
      this.#closeBatch(true);
      throw error;
    }
    this.#closeBatch(false);
    return result;
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
    const diff = diffAttrs(this.#attrs, patch, this.#observed);
    if (diff === undefined) return this.#attrs;
    this.#attrs = diff.merged;
    // The report exists exactly when something is watching, so testing for it
    // is the emission test: there is no second condition to drift from the one
    // that decided whether to build it.
    if (diff.report !== undefined) {
      this.#emit([
        Object.freeze({
          op: 'update-graph-attrs',
          after: diff.report.after,
          before: diff.report.before,
        }),
      ]);
    }
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
    if (this.#observed) this.#emit([nodeOp('add-node', node)]);
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
    const diff = diffAttrs(node.attrs, patch, this.#observed);
    if (diff === undefined) return node;
    // The frozen array the old record already carries, passed straight through
    // rather than re-materialised from the port index: the ports did not
    // change, so the array must not change identity either. A cached array
    // keyed by node id would reach the same place, but it would be a second
    // structure that can fall out of step with `#ports`, which is exactly what
    // the `#ports` comment above argues against. There is no lookup to guard
    // here either, because `requireNode` already proved the node exists.
    const next = freezeNode(node.id, diff.merged, node.ports);
    // Overwriting an existing key leaves a Map entry where it was, so this
    // cannot reorder anything a listing depends on.
    this.#nodes.set(id, next);
    if (diff.report !== undefined) {
      this.#emit([
        Object.freeze({
          op: 'update-node-attrs',
          id,
          after: diff.report.after,
          before: diff.report.before,
        }),
      ]);
    }
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
    const node = this.requireNode(id);
    // Allocated only when something is watching, for the same reason the
    // attribute diff withholds its report bags: an unwatched cascade would
    // otherwise build an array per removal and drop it unread. Undefined here
    // is what makes the emission below unable to ask for ops nobody collected.
    const ops: PatchOp<NodeAttrs, EdgeAttrs, GraphAttrs>[] | undefined = this.#observed
      ? []
      : undefined;
    for (const edgeId of [...outgoing, ...incoming]) {
      const detached = this.#detachEdge(edgeId);
      // A self loop is visited from both sides and detaches on the first, so
      // the miss on the second is what keeps it out of the patch twice over.
      if (ops !== undefined && detached !== undefined) ops.push(edgeOp('remove-edge', detached));
    }
    this.#outEdges.delete(id);
    this.#inEdges.delete(id);
    this.#ports.delete(id);
    this.#nodeRank.delete(id);
    this.#nodes.delete(id);
    // The edge ops first, in detachment order, then the node op. Reversing
    // that array is the undo: the node comes back before the edges that need
    // it, and replaying it forwards never re-triggers the cascade, because the
    // edges are already gone by the time the node op runs.
    if (ops !== undefined) {
      ops.push(nodeOp('remove-node', node));
      this.#emit(ops);
    }
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
    // A new port always goes last, so its position is the one past the ports
    // that were already declared.
    if (this.#observed) this.#emit([portOp('add-port', nodeId, port, next.ports.length - 1)]);
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
    const port = ports.get(portId);
    if (port === undefined) throw new PortNotFoundError(nodeId, portId);
    const users = this.#edgesUsingPort(nodeId, portId);
    if (users.length > 0) throw new PortInUseError(nodeId, portId, users);
    ports.delete(portId);
    const next = freezeNode(node.id, node.attrs, ports);
    this.#nodes.set(nodeId, next);
    // `node` is the record from before the removal and its port array is a
    // frozen array of its own, so it still shows the position the port sat at
    // even though the index it was materialised from has moved on.
    if (this.#observed) {
      this.#emit([portOp('remove-port', nodeId, port, node.ports.indexOf(port))]);
    }
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
    if (this.#observed) this.#emit([edgeOp('add-edge', edge)]);
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
    const diff = diffAttrs(edge.attrs, patch, this.#observed);
    if (diff === undefined) return edge;
    const next = freezeEdge(
      edge.id,
      edge.source,
      edge.target,
      diff.merged,
      edge.sourcePort,
      edge.targetPort,
    );
    this.#edges.set(id, next);
    if (diff.report !== undefined) {
      this.#emit([
        Object.freeze({
          op: 'update-edge-attrs',
          id,
          after: diff.report.after,
          before: diff.report.before,
        }),
      ]);
    }
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

    const movedSource = sourcePort !== edge.sourcePort;
    const movedTarget = targetPort !== edge.targetPort;
    if (!movedSource && !movedTarget) return edge;
    const next = freezeEdge(edge.id, edge.source, edge.target, edge.attrs, sourcePort, targetPort);
    // Overwriting an existing key leaves a Map entry where it was, and the
    // adjacency indexes hold edge ids rather than records, so neither the edge
    // listing order nor any node record moves.
    this.#edges.set(id, next);
    if (this.#observed) {
      // Normalised the same way an attribute diff is: an end that did not move
      // is left out of both bags, and an end that is unbound is named with an
      // explicit `undefined` rather than left out, so swapping the two bags is
      // the undo. The keys are literals here, so there is no `__proto__` to
      // guard against and a spread is enough to build them.
      this.#emit([
        Object.freeze({
          op: 'update-edge-ports',
          id,
          after: Object.freeze({
            ...(movedSource ? { sourcePort } : {}),
            ...(movedTarget ? { targetPort } : {}),
          }),
          before: Object.freeze({
            ...(movedSource ? { sourcePort: edge.sourcePort } : {}),
            ...(movedTarget ? { targetPort: edge.targetPort } : {}),
          }),
        }),
      ]);
    }
    return next;
  }

  /**
   * Removes an edge. Its endpoints stay in the graph. O(1).
   *
   * @throws {EdgeNotFoundError} when the edge is not in the graph.
   */
  removeEdge(id: EdgeId): void {
    if (!this.#edges.has(id)) throw new EdgeNotFoundError(id);
    const detached = this.#detachEdge(id);
    if (this.#observed && detached !== undefined) this.#emit([edgeOp('remove-edge', detached)]);
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

  /**
   * Every node, ordered so each one comes after everything pointing at it.
   *
   * Ties go to the earliest-added node, so the answer never depends on which
   * edge was added first and adding a redundant parallel edge cannot reorder
   * anything. Node insertion order is the reference the tie-break is taken
   * against, so it does still decide how independent nodes fall. The tie-break
   * costs a heap: O((V + E) log V) rather than O(V + E).
   *
   * @throws {CycleError} when the graph has a cycle, carrying a witness. A
   * cyclic graph has no topological order, so this refuses rather than handing
   * back a partial one. {@link isAcyclic} and {@link findCycle} are the
   * tolerant forms, though unlike `hasNode` they are not free: each is a full
   * walk. To ask for the order and learn why there is none, catch instead of
   * checking first, which costs one walk rather than two.
   */
  topologicalOrder(): readonly NodeId[] {
    const order = topologicalOrder(this.#view('out'));
    if (order !== undefined) return order;
    // Only reached on a cyclic graph, so the second walk is on the error path
    // and buys a witness worth naming. The sweep above knows a cycle exists but
    // not which nodes are on one.
    const cycle = findCycle(this.#view('out'));
    // Unreachable, and loud rather than defensive: getting here means the Kahn
    // sweep called the same view cyclic and the depth-first walk called it
    // acyclic. An empty witness would render as `Graph is cyclic:  -> ` and
    // break the promise that a `CycleError` always names a real cycle.
    if (cycle === undefined) {
      throw new Error('graph invariant: topological sweep and cycle search disagree');
    }
    throw new CycleError(cycle);
  }

  /**
   * Whether the graph has no cycles. A self loop is a cycle. O(V + E).
   */
  isAcyclic(): boolean {
    return findCycle(this.#view('out')) === undefined;
  }

  /**
   * A cycle in the graph, or `undefined` when there is none.
   *
   * Consecutive entries are joined by an edge and the last closes back to the
   * first, listed once, so a cycle of n nodes has n entries and a self loop has
   * one. A graph may hold many cycles and this is a witness, not a census.
   * O(V + E).
   */
  findCycle(): readonly NodeId[] | undefined {
    return findCycle(this.#view('out'));
  }

  /**
   * Nodes with no in-edges, in insertion order. A self loop counts as an
   * in-edge, so a node carrying one is not a source. O(V).
   */
  sources(): readonly NodeId[] {
    return this.#endsWithNothingArriving(this.#inEdges);
  }

  /**
   * Nodes with no out-edges, in insertion order. A self loop counts as an
   * out-edge, so a node carrying one is not a sink. O(V).
   */
  sinks(): readonly NodeId[] {
    return this.#endsWithNothingArriving(this.#outEdges);
  }

  /**
   * Every node reachable by following out-edges, in node insertion order.
   *
   * Excludes the node itself, even when a cycle leads back to it, matching what
   * "descendants" means everywhere else it is used on directed graphs. Use
   * {@link canReach} with the same node at both ends to ask whether it sits on
   * a cycle: that is the one question this listing deliberately cannot answer,
   * and the only case where the two disagree.
   *
   * O(V + E) over the reached subgraph, plus a sort over the result.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  descendants(id: NodeId): readonly NodeId[] {
    this.#requireOut(id);
    return reachable(this.#view('out'), id);
  }

  /**
   * Every node that can reach this one by following out-edges, in node
   * insertion order. The mirror of {@link descendants}, walking in-edges.
   *
   * @throws {NodeNotFoundError} when the node is not in the graph.
   */
  ancestors(id: NodeId): readonly NodeId[] {
    this.#requireIn(id);
    return reachable(this.#view('in'), id);
  }

  /**
   * Whether `to` can be reached from `from` by following out-edges one or more
   * times.
   *
   * Stops at the first hit rather than listing everything reachable, which is
   * why it is worth having beside {@link descendants}. Always one or more
   * edges, so `canReach(a, a)` is true exactly when `a` sits on a cycle, which
   * is the question {@link descendants} drops by excluding its own node.
   * O(V + E) over the reached subgraph in the worst case.
   *
   * @throws {NodeNotFoundError} when either node is not in the graph.
   */
  canReach(from: NodeId, to: NodeId): boolean {
    this.#requireOut(from);
    this.#requireIn(to);
    return canReach(this.#view('out'), from, to);
  }

  /**
   * The graph as a plain JSON-ready value: `{ version, attrs?, nodes, edges }`.
   *
   * Named for the standard protocol on purpose, so `JSON.stringify(graph)` is
   * the whole file and no caller has to remember a second name. A plain value
   * rather than a string, so a document can be embedded in a larger one,
   * structurally cloned, or diffed without being serialised twice.
   *
   * Both arrays come out in insertion order, and {@link Graph.fromJSON} replays
   * them in that order, which is what makes the round trip restore a graph
   * rather than merely its contents. What is empty is left out: an empty
   * attribute bag, an empty port list, an unbound port end. Nothing else is:
   * `nodes` and `edges` are written even when empty, so a reader never has to
   * tell "none" from "not said".
   *
   * The bags are fresh, one level deep, and the values in them are not copied.
   * The graph never reads an attribute, so this does not validate, clone, or
   * repair one: a `Date`, a `Map`, a function, a `NaN`, or a cycle is whatever
   * `JSON.stringify` says it is, and holding the result without stringifying it
   * shares those values with the graph, the same aliasing `addNode({ attrs })`
   * already has. O(V + E + total ports and attribute keys).
   */
  toJSON(): GraphJSON<NodeAttrs, EdgeAttrs, GraphAttrs> {
    const nodes: NodeJSON<NodeAttrs>[] = [];
    for (const node of this.#nodes.values()) {
      nodes.push({ id: node.id, ...attrsJSON(node.attrs), ...portsJSON(node.ports) });
    }
    const edges: EdgeJSON<EdgeAttrs>[] = [];
    for (const edge of this.#edges.values()) {
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...attrsJSON(edge.attrs),
        ...(edge.sourcePort === undefined ? {} : { sourcePort: edge.sourcePort }),
        ...(edge.targetPort === undefined ? {} : { targetPort: edge.targetPort }),
      });
    }
    return { version: 1, ...attrsJSON(this.#attrs), nodes, edges };
  }

  /**
   * A graph from a document {@link Graph.toJSON} wrote, or a refusal.
   *
   * This is the package's only untrusted-input door: a file, a message, a hand
   * edit. One of the two signatures below takes `unknown` for exactly that
   * reason. Shape is validated in full before anything is constructed, and a
   * document that is not one throws `InvalidGraphJSONError` naming the path of
   * the offending field.
   * Content is not validated twice. Every element is added through the same
   * public constructor any other caller would use, so this cannot build a graph
   * the public API could not, and a duplicate id, an edge naming an endpoint
   * that is not there, or a port facing the wrong way comes back as the family
   * member that call always throws. The graph being built is local and is never
   * returned when construction throws, so nothing can observe a half-built one.
   *
   * Two signatures, because a document that already carries its attribute types
   * has no business handing them back as `Attrs`. A value already typed as a
   * {@link GraphJSON} infers all three, so a `toJSON` result read straight back
   * keeps the types the graph that wrote it had, and an `unknown` value (a
   * `JSON.parse` result, a message, a file) lands on the defaults exactly as it
   * always did. The overload is types only: one implementation validates both
   * and nothing about the runtime depends on which signature a call resolved to.
   *
   * Inferred or annotated, the three parameters are the caller's claim about a
   * document they chose to read, not something this checked. The graph never
   * reads an attribute, so there is nothing here that could check one; the
   * inferring overload is not stronger evidence than the annotation, it just
   * spares a caller from restating what a typed document already said.
   * `fromJSON<NodeAttrs>` over an untrusted value says "I know what wrote this
   * file" and is worth exactly what that knowledge is worth.
   *
   * Both arrays are replayed in the order they are written in, so the restored
   * graph has the iteration order, neighbour order, and `topologicalOrder` of
   * the one that wrote it, not merely its contents. Absolute insertion ranks
   * are not promised and cannot be observed: removals leave gaps in the
   * original that a replay does not reproduce, and every listing that reads
   * rank reads it as an ordering.
   *
   * The generated-id counters are re-derived rather than carried, because every
   * element arrives with an explicit id and {@link advanceSeq} already moves the
   * counter past one in generated shape. That leaves exactly one divergence,
   * and it is real rather than theoretical. Re-deriving lands the counter one
   * past the highest SURVIVING id in generated shape that {@link advanceSeq}
   * accepts, meaning one whose suffix is below `Number.MAX_SAFE_INTEGER`, so a
   * suffix above that, spent by an element the original removed before writing
   * the document, is free again here and a restored graph can generate an id the
   * original had retired. A suffix under an accepted survivor is not recovered,
   * since the counter is a maximum, which is the sense in which this is about
   * where the counter lands rather than about removal. The qualifier is not
   * decoration: a survivor at or past the boundary contributes nothing, so a
   * document whose only node is `n${Number.MAX_SAFE_INTEGER}` restores with the
   * counter at 1 and every smaller suffix free however far under the survivor it
   * sits. Ids in use are still never handed out whatever the counter says, since
   * the generators probe the maps, so nothing can collide inside either graph;
   * the two just disagree about which ids are spent.
   *
   * Nothing is emitted. Nobody can have subscribed to a graph that does not
   * exist yet, so the mutations below run on an unwatched graph and the patch
   * machinery never starts. O(V + E + total ports and attribute keys).
   *
   * @throws {InvalidGraphJSONError} when the value is not a version 1 document.
   * @throws {DagrGraphError} whatever the graph itself refuses the content for.
   */
  static fromJSON<
    NodeAttrs extends object = Attrs,
    EdgeAttrs extends object = Attrs,
    GraphAttrs extends object = Attrs,
  >(json: GraphJSON<NodeAttrs, EdgeAttrs, GraphAttrs>): Graph<NodeAttrs, EdgeAttrs, GraphAttrs>;
  static fromJSON<
    NodeAttrs extends object = Attrs,
    EdgeAttrs extends object = Attrs,
    GraphAttrs extends object = Attrs,
  >(json: unknown): Graph<NodeAttrs, EdgeAttrs, GraphAttrs>;
  static fromJSON<
    NodeAttrs extends object = Attrs,
    EdgeAttrs extends object = Attrs,
    GraphAttrs extends object = Attrs,
  >(json: unknown): Graph<NodeAttrs, EdgeAttrs, GraphAttrs> {
    const document = parseGraphJSON(json);
    const graph = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();
    if (document.attrs !== undefined) graph.updateAttrs(claimAttrs<GraphAttrs>(document.attrs));
    // Every node before any edge, since an edge needs both its endpoints. That
    // is the only ordering constraint between the two listings, and within each
    // one the document's order is the graph's.
    for (const node of document.nodes) {
      graph.addNode({
        id: node.id,
        ...(node.attrs === undefined ? {} : { attrs: claimAttrs<NodeAttrs>(node.attrs) }),
        ...(node.ports === undefined ? {} : { ports: node.ports }),
      });
    }
    for (const edge of document.edges) {
      graph.addEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.attrs === undefined ? {} : { attrs: claimAttrs<EdgeAttrs>(edge.attrs) }),
        ...(edge.sourcePort === undefined ? {} : { sourcePort: edge.sourcePort }),
        ...(edge.targetPort === undefined ? {} : { targetPort: edge.targetPort }),
      });
    }
    return graph;
  }

  /**
   * Whether anything is watching.
   *
   * Read before anything a patch would need is built, never after. The simple
   * sites test it and then build their one op; the two that would otherwise
   * allocate on the way to the decision take it as an argument instead, the
   * attribute diff for its two report bags and the `removeNode` cascade for its
   * op array. So an unwatched graph pays one comparison per mutation and
   * allocates nothing towards a patch it is not going to emit.
   */
  get #observed(): boolean {
    return this.#listeners.size > 0;
  }

  /**
   * Freezes the ops into a patch and hands it to every listener.
   *
   * The listener set is copied before the walk, so a listener that subscribes
   * or unsubscribes during emission cannot change who this emission calls. Each
   * listener is called inside a try, so one that throws does not swallow the
   * ones after it, and whatever was collected comes back out as a single
   * {@link PatchListenerError} however many listeners failed.
   *
   * One shape at every count, rather than the failure passing through as itself
   * when exactly one listener threw. The mutation is already committed by the
   * time any listener runs, so a listener's error surfacing unwrapped from the
   * mutating call is indistinguishable from the graph having refused that call,
   * `isDagrGraphError` included, and the mirroring case makes that collision
   * routine rather than exotic.
   *
   * Only reached when {@link Graph.#observed} is true, so there is no empty
   * listener set to check for here.
   */
  #emit(ops: PatchOp<NodeAttrs, EdgeAttrs, GraphAttrs>[]): void {
    if (this.#batchDepth > 0) {
      // Appended one at a time rather than spread into `push`, because a
      // `removeNode` on a high-degree node hands this an op per incident edge
      // and a spread of those is an argument list.
      for (const op of ops) this.#batched.push(op);
      return;
    }
    const patch: Patch<NodeAttrs, EdgeAttrs, GraphAttrs> = Object.freeze(ops);
    const failures: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(patch);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new PatchListenerError(failures);
  }

  /**
   * Ends one level of {@link batch}, emitting the collected ops if that was the
   * outermost one.
   *
   * The depth comes down before anything is emitted, so the emission and
   * everything a listener does inside it are outside the batch. The buffer is
   * taken and replaced rather than emptied, so the array that becomes the frozen
   * patch is nobody's to write to afterwards, this graph included.
   *
   * `bodyFailed` is what decides who wins when both halves fail. A listener that
   * throws while reading the ops of a batch its body aborted would replace the
   * error saying why the batch ended with one saying a listener misbehaved
   * afterwards, and the first is the one the caller asked about. So the listener
   * failure is dropped in that case and in that case only.
   */
  #closeBatch(bodyFailed: boolean): void {
    this.#batchDepth -= 1;
    if (this.#batchDepth > 0) return;
    const ops = this.#batched;
    this.#batched = [];
    // The listener set can have emptied during the body, and `#emit` is written
    // against a set with something in it.
    if (ops.length === 0 || !this.#observed) return;
    if (!bodyFailed) {
      this.#emit(ops);
      return;
    }
    try {
      this.#emit(ops);
    } catch {
      // Deliberately swallowed: see `bodyFailed` above.
    }
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

  /**
   * The nodes whose entry in the given index is empty, in insertion order.
   *
   * One helper for both {@link sources} and {@link sinks}, because they are the
   * same question asked of the two adjacency indexes, and two copies would be
   * two places for the self-loop rule to drift.
   */
  #endsWithNothingArriving(index: ReadonlyMap<NodeId, ReadonlySet<EdgeId>>): readonly NodeId[] {
    const found: NodeId[] = [];
    for (const id of this.#nodes.keys()) {
      // `?? 0` and not a bare `=== 0` comparison against `?.size`. A node with
      // no index entry has no edges on that side and therefore IS an end, so
      // the missing case has to fall the same way the empty case does. Without
      // the coalesce it silently drops the node instead, which is the one
      // defensive read in this file that would produce a wrong answer rather
      // than a loud one. Unreachable today, since `addNode` seeds both maps.
      if ((index.get(id)?.size ?? 0) === 0) found.push(id);
    }
    return found;
  }

  /**
   * Adjacency as `traversal.ts` reads it, pointed one way or the other.
   *
   * `'out'` walks out-edges to their targets, `'in'` walks in-edges to their
   * sources, so the reversed graph costs an argument rather than a second copy
   * of every algorithm. Nothing is cached: the object is four closures built
   * once per traversal, against a walk that is O(V + E), and a cached view
   * would be one more thing to keep in step with mutation for no measurable
   * gain.
   *
   * The closures read the adjacency indexes directly. That is the point of the
   * view: `successors` would deduplicate and sort a fresh array per node, and
   * the committed baseline puts it at about 6x the cost of `outEdges` over the
   * same nodes, which a traversal would pay once per node rather than once.
   */
  #view(direction: 'out' | 'in'): AdjacencyView {
    const walked = direction === 'out' ? this.#outEdges : this.#inEdges;
    const arriving = direction === 'out' ? this.#inEdges : this.#outEdges;
    const side = direction === 'out' ? 'target' : 'source';
    return {
      nodes: () => this.#nodes.keys(),
      neighboursOf: (id) => this.#neighbours(walked.get(id), side),
      // A node the walk reached is always in the index, so a missing entry
      // would be index skew rather than a caller's bad id, which the public
      // methods have already rejected. Zero keeps the sweep from stalling, and
      // it is the neutral answer: a node with no index entry has no edges.
      arrivingCount: (id) => arriving.get(id)?.size ?? 0,
      // `#requireRank` rather than a fallback, unlike the line above, because
      // there is no neutral rank. Defaulting to 0 would sort a skewed node to
      // the front of every listing and to the front of the heap, quietly
      // corrupting the tie-break this whole traversal surface is built on.
      rankOf: (id) => this.#requireRank(id),
    };
  }

  /**
   * The endpoints on one side of an index entry, once per edge and in edge
   * insertion order.
   *
   * A generator rather than an array: this is called once per node of a
   * traversal, and retaining a materialised neighbour array per node is what
   * the view exists to avoid, so peak memory stays O(1) per node rather than
   * O(degree) and the dedup and sort `successors` pays are skipped. It is not
   * free: the generator object itself and one iterator result per edge are
   * still allocated. Duplicates are kept, because the topological sweep counts
   * edges rather than neighbours.
   */
  *#neighbours(edgeIds: ReadonlySet<EdgeId> | undefined, side: 'source' | 'target'): Generator<NodeId> {
    if (edgeIds === undefined) return;
    for (const edgeId of edgeIds) yield this.#requireIndexedEdge(edgeId)[side];
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

  /**
   * Drops an edge from the store and from both adjacency indexes, returning
   * the record it removed so the caller can describe it in a patch, or
   * `undefined` when there was nothing to remove. O(1).
   */
  #detachEdge(id: EdgeId): Edge<EdgeAttrs> | undefined {
    const edge = this.#edges.get(id);
    // Reachable and legitimate, do not turn this into a throw: removeNode
    // walks the out set and then the in set, so a self loop is visited twice
    // and the second visit correctly finds the edge already gone.
    if (edge === undefined) return undefined;
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
    return edge;
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
