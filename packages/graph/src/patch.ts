/**
 * Patches: the flat, invertible description of what a mutation did.
 *
 * Every state-changing call on a `Graph` emits exactly one {@link Patch},
 * an ordered array of cascade-free {@link PatchOp}s. A call that changes
 * nothing emits nothing at all, which is the emission-side twin of the copy on
 * write identity rule the records already keep: no change, no new object, no
 * patch. The one thing that changes the unit is `Graph.batch`, which holds the
 * emission back and hands over the ops of several calls as one patch. A batch
 * is this same type and this same shape, so nothing here reads it differently.
 *
 * Cascade-free means an op names one thing and does one thing. `removeNode`
 * takes its incident edges with it, so it emits a `remove-edge` op per edge
 * followed by the `remove-node` op, rather than one op that a consumer would
 * have to expand for itself. That is what makes {@link invert} a local
 * transformation: reversing the array and swapping each op's sense is the undo,
 * with the node coming back before the edges that need it.
 */

import type { Graph } from './graph.js';
import type {
  Attrs,
  AttrsPatch,
  EdgeId,
  EdgePortsPatch,
  NodeId,
  Port,
  PortId,
  ReadAttrs,
} from './types.js';

/** A node was added, with the attributes and ports it was declared with. */
export interface AddNodeOp<N extends object = Attrs> {
  readonly op: 'add-node';
  readonly id: NodeId;
  readonly attrs: ReadAttrs<N>;
  readonly ports: readonly Port[];
}

/** A node was removed, with everything needed to declare it again. */
export interface RemoveNodeOp<N extends object = Attrs> {
  readonly op: 'remove-node';
  readonly id: NodeId;
  readonly attrs: ReadAttrs<N>;
  readonly ports: readonly Port[];
}

/** An edge was added, with the attributes and port bindings it was given. */
export interface AddEdgeOp<E extends object = Attrs> {
  readonly op: 'add-edge';
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly attrs: ReadAttrs<E>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}

/** An edge was removed, with everything needed to declare it again. */
export interface RemoveEdgeOp<E extends object = Attrs> {
  readonly op: 'remove-edge';
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly attrs: ReadAttrs<E>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}

/**
 * A port was declared on a node. `index` is where it sits in the node's
 * declaration order, which is always the end for a fresh declaration.
 */
export interface AddPortOp {
  readonly op: 'add-port';
  readonly nodeId: NodeId;
  readonly port: Port;
  readonly index: number;
}

/**
 * A port was removed from a node. `index` is where it sat in the node's
 * declaration order before it went, which is what a consumer tracking positions
 * needs even though {@link apply} appends on the way back.
 */
export interface RemovePortOp {
  readonly op: 'remove-port';
  readonly nodeId: NodeId;
  readonly port: Port;
  readonly index: number;
}

/**
 * A node's attributes changed. `after` names exactly the keys that changed and
 * holds their new values, `before` names the same keys at their prior values,
 * and a key present with `undefined` means the key was absent, so swapping the
 * two is the undo.
 */
export interface UpdateNodeAttrsOp<N extends object = Attrs> {
  readonly op: 'update-node-attrs';
  readonly id: NodeId;
  readonly after: AttrsPatch<N>;
  readonly before: AttrsPatch<N>;
}

/** An edge's attributes changed. Same normalisation as node attributes. */
export interface UpdateEdgeAttrsOp<E extends object = Attrs> {
  readonly op: 'update-edge-attrs';
  readonly id: EdgeId;
  readonly after: AttrsPatch<E>;
  readonly before: AttrsPatch<E>;
}

/** The graph's own attributes changed. Same normalisation again. */
export interface UpdateGraphAttrsOp<G extends object = Attrs> {
  readonly op: 'update-graph-attrs';
  readonly after: AttrsPatch<G>;
  readonly before: AttrsPatch<G>;
}

/**
 * An edge's port bindings changed. `after` names exactly the ends that moved
 * and `before` where they were, with a key present and `undefined` meaning that
 * end was unbound.
 */
export interface UpdateEdgePortsOp {
  readonly op: 'update-edge-ports';
  readonly id: EdgeId;
  readonly after: EdgePortsPatch;
  readonly before: EdgePortsPatch;
}

/** One thing a mutation did, as a discriminated union on `op`. */
export type PatchOp<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> =
  | AddNodeOp<NodeAttrs>
  | RemoveNodeOp<NodeAttrs>
  | AddEdgeOp<EdgeAttrs>
  | RemoveEdgeOp<EdgeAttrs>
  | AddPortOp
  | RemovePortOp
  | UpdateNodeAttrsOp<NodeAttrs>
  | UpdateEdgeAttrsOp<EdgeAttrs>
  | UpdateGraphAttrsOp<GraphAttrs>
  | UpdateEdgePortsOp;

/**
 * What one mutation did, in the order it did it. Frozen, ops included, so a
 * patch can be handed to several listeners and kept by any of them.
 */
export type Patch<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> = readonly PatchOp<NodeAttrs, EdgeAttrs, GraphAttrs>[];

/**
 * What `Graph.subscribe` takes. Called once per emitted patch.
 *
 * Must be synchronous. The return type is `void`, so an `async` function is
 * assignable with no cast and nothing complains, but the graph never sees the
 * promise: a failure inside one becomes an unhandled rejection rather than
 * being collected into a {@link PatchListenerError}, and anything after the
 * first `await` runs against a graph that may have moved on several mutations.
 * Hand the patch to a queue and drain it yourself if the work has to be
 * asynchronous.
 */
export type PatchListener<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> = (patch: Patch<NodeAttrs, EdgeAttrs, GraphAttrs>) => void;

/**
 * Thrown from a mutating call when one or more patch listeners threw.
 *
 * Deliberately not a member of the `DagrGraphError` family, and it lives here
 * rather than in `errors.ts` for the same reason: that module is the closed set
 * of ways the graph refuses a call, and this is not one. The mutation was
 * accepted and committed before any listener ran, so `isDagrGraphError` must
 * keep meaning "the graph rejected this" and must answer `false` here. Without
 * the wrapper the two are indistinguishable: mirroring with
 * `source.subscribe((patch) => apply(mirror, patch))` makes a drifted mirror
 * throw a `DuplicateNodeError` out of `source.addNode('a')`, a call the source
 * itself was perfectly happy with.
 *
 * One shape at every listener count, so a caller has no second case to write.
 * `errors` holds what the listeners threw, in listener order, and `cause` is
 * the first of them, which is the one an `instanceof` check usually wants.
 */
export class PatchListenerError extends Error {
  /** What the listeners threw, in listener order. Never empty. */
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super(`${String(errors.length)} patch listener(s) threw`, { cause: errors[0] });
    this.name = 'PatchListenerError';
    this.errors = errors;
    // Restored explicitly for the same reason the graph errors restore theirs:
    // `instanceof` has to stay correct when the output is downlevelled below
    // the ES2022 target.
    Object.setPrototypeOf(this, PatchListenerError.prototype);
  }
}

/**
 * The op that undoes one op.
 *
 * Adds and removes swap their tag and keep their payload, which works because
 * a remove op carries everything the matching add needs. The four update ops
 * swap `after` and `before`, which works because an emitted patch is
 * normalised: `after` names exactly the keys that changed and `before` their
 * prior values, with a key present and `undefined` meaning "was absent", which
 * applies as a delete and so restores absence.
 */
function invertOp<N extends object, E extends object, G extends object>(
  op: PatchOp<N, E, G>,
): PatchOp<N, E, G> {
  switch (op.op) {
    case 'add-node':
      return Object.freeze({ ...op, op: 'remove-node' });
    case 'remove-node':
      return Object.freeze({ ...op, op: 'add-node' });
    case 'add-edge':
      return Object.freeze({ ...op, op: 'remove-edge' });
    case 'remove-edge':
      return Object.freeze({ ...op, op: 'add-edge' });
    case 'add-port':
      return Object.freeze({ ...op, op: 'remove-port' });
    case 'remove-port':
      return Object.freeze({ ...op, op: 'add-port' });
    // One arm each rather than four labels on one, because a shared arm widens
    // `after` and `before` to the union of all four bag types and the result no
    // longer matches any single op. Four arms keep each swap typed by the op it
    // belongs to, which is worth more than the three lines it costs.
    case 'update-node-attrs':
      return Object.freeze({ ...op, after: op.before, before: op.after });
    case 'update-edge-attrs':
      return Object.freeze({ ...op, after: op.before, before: op.after });
    case 'update-graph-attrs':
      return Object.freeze({ ...op, after: op.before, before: op.after });
    case 'update-edge-ports':
      return Object.freeze({ ...op, after: op.before, before: op.after });
  }
}

/**
 * The patch that undoes `patch`.
 *
 * The ops are reversed and each one is inverted, which is what makes an undo of
 * a cascade land in the right order: `removeNode` emits its `remove-edge` ops
 * before the `remove-node` op, so the inverse brings the node back before the
 * edges that need it to exist. Applying `invert(p)` to a graph that `p` was
 * just applied to restores its content, up to the insertion order
 * {@link apply} does not promise.
 *
 * Pure: the patch handed in is not touched, and the one handed back is frozen,
 * ops included. O(op count).
 */
export function invert<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
>(
  patch: Patch<NodeAttrs, EdgeAttrs, GraphAttrs>,
): Patch<NodeAttrs, EdgeAttrs, GraphAttrs> {
  return Object.freeze([...patch].reverse().map(invertOp));
}

/** Replays one op through the public API of `graph`. */
function applyOp<N extends object, E extends object, G extends object>(
  graph: Graph<N, E, G>,
  op: PatchOp<N, E, G>,
): void {
  switch (op.op) {
    case 'add-node':
      graph.addNode({ id: op.id, attrs: op.attrs, ports: op.ports });
      return;
    case 'remove-node':
      graph.removeNode(op.id);
      return;
    case 'add-edge':
      // The port keys are spread in conditionally rather than passed as
      // `undefined`, because `EdgeInit` spells an unbound end as an absent key
      // and `exactOptionalPropertyTypes` keeps the two apart.
      graph.addEdge({
        id: op.id,
        source: op.source,
        target: op.target,
        attrs: op.attrs,
        ...(op.sourcePort === undefined ? {} : { sourcePort: op.sourcePort }),
        ...(op.targetPort === undefined ? {} : { targetPort: op.targetPort }),
      });
      return;
    case 'remove-edge':
      graph.removeEdge(op.id);
      return;
    case 'add-port':
      graph.addPort(op.nodeId, op.port);
      return;
    case 'remove-port':
      graph.removePort(op.nodeId, op.port.id);
      return;
    case 'update-node-attrs':
      graph.updateNodeAttrs(op.id, op.after);
      return;
    case 'update-edge-attrs':
      graph.updateEdgeAttrs(op.id, op.after);
      return;
    case 'update-graph-attrs':
      graph.updateAttrs(op.after);
      return;
    case 'update-edge-ports':
      graph.updateEdgePorts(op.id, op.after);
      return;
    default: {
      // Unreachable from typed code, so `op` is `never` here. Reachable from
      // JavaScript, and from a patch that crossed a version boundary, and both
      // deserve a named failure rather than a silently skipped op.
      const unknown: { op?: unknown } = op;
      throw new Error(`unknown patch op "${String(unknown.op)}"`);
    }
  }
}

/**
 * Replays a patch onto a graph, op by op, in order.
 *
 * This is an ordinary caller of the public API, with two consequences worth
 * knowing. The graph emits its own patch, so a mirror kept in step by
 * `source.subscribe((patch) => apply(mirror, patch))` can itself be subscribed
 * to. And nothing is transactional: an op that the graph rejects throws that
 * graph error out of here, with the ops before it already applied.
 *
 * THE REPLAY IS ONE BATCH, so a patch of any op count arrives at the mirror's
 * own listeners as one patch, exactly as it left the source. Op by op is what it
 * does and never what it says: without the batch, mirroring re-fans a batched
 * three-step edit into three patches, and a layout engine subscribed to the
 * mirror rather than to the source would see the intermediate states that
 * `Graph.batch` exists to remove. It fixes the same seam for a cascade, which
 * left one graph as a single patch and arrived at the next as two.
 *
 * Replay restores every node, edge, port, and attribute exactly, ids and values
 * included, but not insertion order. A restored element takes its place at the
 * end of iteration order, exactly as it would if the caller had re-added it,
 * because iteration order is a function of insertion history and a replayed or
 * inverted patch is new insertion history. `remove-port` still records the
 * `index` it was removed from, since that is part of an honest description of
 * the mutation and delta consumers want it, but `apply` appends. Order-faithful
 * replay is a later decision, for when incremental layout knows whether it
 * needs it.
 *
 * O(op count), each op costing what the call it replays costs.
 *
 * @throws {Error} when an op carries a tag this version does not know.
 */
export function apply<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
>(
  graph: Graph<NodeAttrs, EdgeAttrs, GraphAttrs>,
  patch: Patch<NodeAttrs, EdgeAttrs, GraphAttrs>,
): void {
  graph.batch(() => {
    for (const op of patch) applyOp(graph, op);
  });
}
