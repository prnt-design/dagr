/** Identity of a node. Stable for the lifetime of the node in a graph. */
export type NodeId = string;

/** Identity of an edge. Stable for the lifetime of the edge in a graph. */
export type EdgeId = string;

/** Identity of a port. Unique within its node, not across the graph. */
export type PortId = string;

/**
 * An attribute bag: arbitrary string keys, caller-defined value types.
 *
 * The graph never reads an attribute. It stores what it is given and hands it
 * back, so layout, rendering, and application code can all keep their own
 * facts on the same records without the model growing a field per consumer.
 *
 * This is the DEFAULT for every attribute type parameter, not the constraint
 * on one. The constraint is `object`, because only a `type` alias picks up the
 * implicit index signature that satisfies `Attrs` and an `interface` would be
 * rejected for no reason: storage here is `Record<string, unknown>` whatever
 * the caller's shape is, so nothing in the implementation needs the index
 * signature.
 */
export type Attrs = Record<string, unknown>;

/**
 * Attributes as they are stored and read back. Every key is optional because
 * any key can be absent or deleted, so a read is honestly `T | undefined`.
 * Pretending otherwise would push a non-null assertion onto every caller.
 */
export type ReadAttrs<A extends object> = Readonly<Partial<A>>;

/**
 * A merge patch. An explicit `undefined` deletes the key, an absent key is
 * left alone. `exactOptionalPropertyTypes` is on, so the `| undefined` in the
 * value position is what makes the delete form expressible at all: without it
 * the compiler would reject `{ width: undefined }` as a value for an optional
 * property, and there would be no way to say "remove this".
 */
export type AttrsPatch<A extends object> = { readonly [K in keyof A]?: A[K] | undefined };

/** Whether a port may be an edge's source end, its target end, or either. */
export type PortDirection = 'in' | 'out' | 'inout';

/**
 * An attachment point on a node. Layout and routing aim edges at ports rather
 * than at node centres, so a port is structure, not decoration.
 */
export interface Port {
  readonly id: PortId;
  readonly direction: PortDirection;
}

/** A port as a caller declares it. */
export interface PortInit {
  readonly id: PortId;
  /** Defaults to `'inout'`. */
  readonly direction?: PortDirection;
}

/** A vertex of the graph. */
export interface Node<A extends object = Attrs> {
  readonly id: NodeId;
  readonly attrs: ReadAttrs<A>;
  /** Declared ports, in declaration order. Frozen. */
  readonly ports: readonly Port[];
}

/** A directed connection from `source` to `target`, with its own identity. */
export interface Edge<A extends object = Attrs> {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly attrs: ReadAttrs<A>;
  /** Port on `source` this edge leaves from, when the caller named one. */
  readonly sourcePort?: PortId;
  /** Port on `target` this edge arrives at, when the caller named one. */
  readonly targetPort?: PortId;
}

/** A node as a caller declares it. Every field is optional. */
export interface NodeInit<A extends object = Attrs> {
  /** Generated when absent. */
  readonly id?: NodeId;
  readonly attrs?: AttrsPatch<A>;
  readonly ports?: readonly PortInit[];
}

/**
 * A rebinding of an edge's port ends. An absent key leaves that end alone, an
 * explicit `undefined` detaches it. Named and exported for the same reason
 * {@link AttrsPatch} is: a caller building one in a variable needs something
 * to annotate it with.
 */
export interface EdgePortsPatch {
  readonly sourcePort?: PortId | undefined;
  readonly targetPort?: PortId | undefined;
}

/** An edge as a caller declares it. Only the endpoints are required. */
export interface EdgeInit<A extends object = Attrs> {
  readonly source: NodeId;
  readonly target: NodeId;
  /** Generated when absent. */
  readonly id?: EdgeId;
  readonly attrs?: AttrsPatch<A>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}
