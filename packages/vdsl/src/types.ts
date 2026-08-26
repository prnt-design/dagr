import type {
  Attrs,
  AttrsPatch,
  Graph,
  Node,
  NodeId,
  NodeInit,
  PortDirection,
  PortId,
  ReadAttrs,
} from '@dagr/graph';

/**
 * A port as a node kind declares it, rather than as a node carries it.
 *
 * `@dagr/graph`'s `Port` is what a node has; this is what every node of
 * a kind is promised to have. The two differ by `maxEdges`, which is a rule
 * about a port and not a property of one, and which the graph model has no
 * business enforcing: `Graph` permits any topology by design.
 */
export interface PortSpec {
  readonly id: PortId;
  readonly direction: PortDirection;
  /**
   * The most edges this port accepts. Absent means unbounded.
   *
   * A cap rather than the usual `'single' | 'multiple'` word, for two reasons.
   * A number is the general case and the word is the two useful values of it,
   * so nothing is lost, and a union declared here is a union every consumer's
   * exhaustive `switch` breaks on when a third case arrives, which is the
   * hazard M5.5's entry plans to document `PatchOp` as an open union to
   * escape. Absent rather
   * than `Infinity` because `Infinity` does not survive `JSON.stringify`, and a
   * spec a consumer cannot serialise is a spec they cannot ship a fixture of.
   *
   * A spec says what the rule is and {@link NodeRegistry.checkConnection} is
   * where a proposed edge meets it. `defineRegistry` refuses a value that
   * check could not act on, so the number it reads is a positive integer or
   * nothing.
   *
   * It caps the edges AT a port and not the edges through it in one direction,
   * which is only visible on an `inout` port. That is `Graph.removePort`'s own
   * reading: it refuses a port with users and counts a user on either side.
   */
  readonly maxEdges?: number;
  /**
   * What this port carries, as a token this package never interprets. Absent
   * means untyped.
   *
   * A token and not a type: Dagr stores it, hands it to a consumer's own
   * {@link NodeSpecInit.canConnect}, and never compares two of them itself.
   * Comparing them would be an ontology by the back door, because the obvious
   * rule (equal tokens connect) is wrong for every language with a subtype
   * relation, an `any`, or a coercion, and this package has no way to know
   * which of those a consumer has. {@link sameType} is the equality rule
   * written out as a value, so a consumer who wants it names it.
   *
   * A string rather than a symbol or a class, for `PortId`'s reason: a spec a
   * consumer cannot `JSON.stringify` is a spec they cannot ship a fixture of.
   */
  readonly type?: string;
}

/** One end of a proposed connection, as {@link ConnectionCheck} is given it. */
export interface ConnectionEnd<K extends string = string> {
  readonly kind: K;
  /** The port as its kind declares it, resolved before the check is called. */
  readonly port: PortSpec;
}

/** Both ends of a proposed connection, in the direction the edge would run. */
export interface ConnectionEnds<K extends string = string> {
  readonly source: ConnectionEnd<K>;
  readonly target: ConnectionEnd<K>;
}

/**
 * A consumer's own rule about whether two ports may be connected. Returns
 * nothing when the pair is fine, and the reason to put in front of a user when
 * it is not.
 *
 * `string | undefined` rather than {@link ConfigCheck}'s list, because a
 * connection is a decision and a config is a report: a drag loop stops at the
 * first reason a drop is refused, where a config panel shows every problem it
 * has at once. It is still the consumer's own sentence, which is the half of
 * a refusal Dagr cannot author.
 *
 * IT IS HANDED NO GRAPH AND NO NODE IDS, and that is forced rather than
 * chosen. {@link NodeRegistry.checkPorts} exists to answer for a drag aimed at
 * a node that has not been created yet, and a predicate that could read the
 * graph would have nothing to read in exactly that case.
 */
export type ConnectionCheck<K extends string = string> = (
  ends: ConnectionEnds<K>,
) => string | undefined;

/** Why a proposed connection was refused. */
export type ConnectionRefusalCode =
  /** A kind does not declare a port of that id. */
  | 'no-such-port'
  /** An `in` port was offered as a source, or an `out` port as a target. */
  | 'wrong-direction'
  /** A {@link NodeSpecInit.canConnect} at one end or the other said no. */
  | 'incompatible'
  /** A port is already carrying its `maxEdges`. */
  | 'port-full'
  /** The edge would close a cycle, in a registry that declared none are allowed. */
  | 'would-cycle';

/** A proposed connection nothing objects to. */
export interface ConnectionAllowed {
  readonly ok: true;
}

/** A proposed connection something objects to, and the first objection. */
export interface ConnectionRefused {
  readonly ok: false;
  readonly code: ConnectionRefusalCode;
  /** A sentence for a user. The consumer's own when `code` is `incompatible`. */
  readonly reason: string;
}

/**
 * What the registry says about a proposed connection.
 *
 * A decision rather than {@link ConfigCheck}'s list of problems, and the
 * difference is who authored the strings. A config check reports what the
 * consumer's own validator found, in the consumer's own words, and a node can
 * have several things wrong with it at once. Every refusal here but one is
 * authored by Dagr, an English sentence a consumer can neither localise nor
 * branch on, so the code is what a caller reads and the reason is what it
 * shows. M6.3 filters drop targets, and the field a filter wants is `ok`.
 */
export type ConnectionCheckResult = ConnectionAllowed | ConnectionRefused;

/** One end of a proposed connection, named by kind rather than by node. */
export interface PortRef<K extends string = string> {
  readonly kind: K;
  readonly portId: PortId;
}

/** An edge a consumer is proposing to add, between two nodes the graph holds. */
export interface ProposedConnection {
  readonly source: NodeId;
  readonly sourcePort: PortId;
  readonly target: NodeId;
  readonly targetPort: PortId;
}

/**
 * A consumer's own validator for one kind's configuration.
 *
 * It is handed the node's whole attribute bag, because which keys are
 * configuration is the consumer's question and not Dagr's: a toolkit that
 * decided it would be defining the ontology this milestone exists not to
 * define. An empty result is a valid config, and every string is a problem to
 * put in front of a user.
 *
 * Strings rather than a structured issue type, deliberately. A structured
 * form is a schema format of Dagr's invention by another name, and the
 * consumer already has one: this is where `zod`'s `issues`, `valibot`'s, or a
 * hand-written check hands its own message across.
 */
export type ConfigCheck = (attrs: ReadAttrs<Attrs>) => readonly string[];

/**
 * A node kind as a consumer declares it, with the kind itself left out: the
 * key it is declared under IS the kind, so it is written once.
 */
export interface NodeSpecInit<K extends string = string> {
  /** Defaults to none. Port ids are unique within a kind. */
  readonly ports?: readonly PortSpec[];
  /** Defaults to none, which reports every config as valid. */
  readonly checkConfig?: ConfigCheck;
  /**
   * Defaults to none, which is this kind having no objection to any pair.
   *
   * Asked at BOTH ends of a proposed connection, source first, and either end
   * refusing is a refusal: a rule about what may arrive at a port belongs to
   * the kind that declares the port, and a rule about what may leave one
   * belongs to the kind at the other end just as much. A kind that only cares
   * about its inputs writes it and never sees the pairs it is the source of
   * refused for a reason it did not give.
   *
   * `K` is the consumer's own union, so a predicate can switch on
   * `ends.source.kind` exhaustively. That is the same threading
   * {@link defineRegistry} does for every other kind it hands back, pointed
   * at the one function a consumer writes about two kinds at once.
   *
   * IT IS NOT MIRRORED ONTO {@link NodeSpec}, where `checkConfig` is. A spec
   * is what one kind promises about itself and a config check is a rule about
   * one node, but a connection rule is a rule about a PAIR, so it was never a
   * property of one kind to hand back. {@link NodeRegistry.checkPorts} is the
   * door, and it asks both ends. Mirroring it would also make `NodeSpec<K>`
   * invariant in `K`, and an unparameterised `NodeRegistry` holding one built
   * from a literal is a property M6.1 shipped a test for.
   */
  readonly canConnect?: ConnectionCheck<K>;
}

/**
 * A node kind as the registry hands it back. Frozen, including its ports.
 *
 * `K` is the consumer's own union of kinds, inferred once from the object
 * literal handed to {@link defineRegistry} and threaded through everything
 * downstream. That threading is the whole point of the type parameter: a
 * hover or drag callback given a `NodeSpec<'source' | 'filter'>` can switch on
 * `kind` exhaustively, and one given a `NodeSpec<string>` cannot.
 */
export interface NodeSpec<K extends string = string> {
  readonly kind: K;
  readonly ports: readonly PortSpec[];
  readonly checkConfig?: ConfigCheck;
}

/** How a registry departs from its defaults. */
export interface RegistryOptions {
  /**
   * The node attribute a kind is read from. Defaults to `'kind'`.
   *
   * A key, not an ontology: Dagr has to look somewhere to answer "what kind is
   * this node", and the somewhere is configurable precisely so a consumer with
   * an existing attribute vocabulary does not have to rename it.
   */
  readonly kindKey?: string;
  /**
   * Whether an edge that would close a cycle is refused. Defaults to `false`.
   *
   * A policy the adapter declares rather than a default, because `Graph`
   * permits cycles by design and a feedback loop is the point of half the
   * languages this toolkit exists for. A toolkit that refused one out of the
   * box would be wrong for them and silent about it.
   *
   * The question a proposed edge asks is
   * `source === target || graph.canReach(target, source)`, which is one walk
   * over the subgraph reachable from the target. The obvious wrong
   * implementation is add-then-`findCycle`-then-remove: it emits two patches,
   * pollutes an undo stack, and answers over the whole graph rather than over
   * the part the edge could affect.
   */
  readonly rejectCycles?: boolean;
}

/**
 * What a caller may add to a node the registry builds.
 *
 * `A` is the caller's own node attribute type, the one their `Graph` is
 * parameterised by, so the attributes they pass are checked against it exactly
 * as `graph.addNode` would check them. Ports are absent on purpose: see
 * {@link NodeRegistry.nodeInit}.
 */
export interface KindNodeInit<A extends object = Attrs> {
  /** Generated by `Graph` when absent, as usual. */
  readonly id?: NodeId;
  readonly attrs?: AttrsPatch<A>;
}

/**
 * The kinds a consumer declared, and the answers Dagr gives about them.
 *
 * Every method taking a kind takes `K`, so a kind that was never declared is a
 * compile error rather than a runtime one. {@link NodeRegistry.has} is the one
 * door from `string` into `K`, and it is a real membership test rather than a
 * cast, which is what makes the narrowing honest.
 */
export interface NodeRegistry<K extends string = string> {
  /** The declared kinds, in declaration order. Frozen. */
  readonly kinds: readonly K[];
  /** The node attribute this registry reads a kind from. */
  readonly kindKey: string;
  /** Whether this registry refuses an edge that would close a cycle. */
  readonly rejectsCycles: boolean;
  /** Whether a string names a declared kind, narrowing it when it does. */
  has(kind: string): kind is K;
  /** The spec for a declared kind. Total over `K`, so it cannot fail. */
  get(kind: K): NodeSpec<K>;
  /** One declared port of a kind, or `undefined` when the kind has no such port. */
  port(kind: K, portId: PortId): PortSpec | undefined;
  /** The kind of a node, or `undefined` when it does not legibly declare one. */
  kindOf<A extends object>(node: Node<A>): K | undefined;
  /** The spec of a node. Throws rather than guessing. */
  resolve<A extends object>(node: Node<A>): NodeSpec<K>;
  /** The spec of a node, or `undefined` where {@link NodeRegistry.resolve} would throw. */
  tryResolve<A extends object>(node: Node<A>): NodeSpec<K> | undefined;
  /**
   * What the node's own kind says is wrong with its configuration. Empty means
   * nothing, and a kind that declared no check always reports nothing.
   *
   * Resolves first, so a node of an undeclared kind throws rather than passing
   * validation by having no validator.
   */
  checkConfig<A extends object>(node: Node<A>): readonly string[];
  /**
   * A `NodeInit` for a new node of this kind: the declared ports, the kind
   * attribute, and whatever the caller adds.
   *
   * The kind attribute is written LAST, so `attrs` cannot mislabel the node it
   * is building. Ports are not takeable from the caller: the spec is what says
   * which ports a kind has, and a node that quietly gained one would resolve to
   * a spec that does not describe it.
   *
   * `A` comes from the caller, usually inferred from the `Graph` the result is
   * handed to, so the attributes they pass are checked against their own type.
   * A consumer whose attribute type declares the kind key (`kind: 'source' |
   * 'filter'`, typically) has it checked like any other key; one whose type
   * does not still gets the attribute written, because `Graph` stores what it
   * is given and the registry has to be able to read the node back.
   */
  nodeInit<A extends object = Attrs>(kind: K, init?: KindNodeInit<A>): NodeInit<A>;
  /**
   * Whether two ports may be connected, asked of the kinds alone.
   *
   * This is the half of {@link NodeRegistry.checkConnection} that needs no
   * graph: the ports exist on their kinds, they face the right way, and
   * neither kind's {@link NodeSpecInit.canConnect} objects. First refusal
   * wins, in that order.
   *
   * IT IS THE ANSWER FOR A DRAG AIMED AT A NODE THAT DOES NOT EXIST YET.
   * `canReach` throws for an absent endpoint, so `checkConnection` answers for
   * an edge between two nodes the graph holds and nothing else. The two rules
   * it adds are both vacuous for a node about to be created: a node with no
   * edges occupies no port and can reach nothing, so it can neither fill a cap
   * nor close a cycle. What is left is exactly this.
   *
   * @throws {UnknownNodeKindError} when a kind is not one this registry holds.
   */
  checkPorts(source: PortRef<K>, target: PortRef<K>): ConnectionCheckResult;
  /**
   * Whether an edge may be added, asked of the kinds and of the graph.
   *
   * {@link NodeRegistry.checkPorts} first, then the two questions only the
   * graph can answer: whether either port is already carrying its `maxEdges`,
   * and whether the edge would close a cycle in a registry that refuses them.
   * First refusal wins, in that order, and the graph is not mutated to find
   * out.
   *
   * A REFUSAL IS ABOUT THE PROPOSAL AND AN ERROR IS ABOUT THE GRAPH. A port
   * the kind does not declare is an ordinary outcome of a hit test and comes
   * back as `no-such-port`; a node the graph does not hold, or one carrying a
   * kind this registry never declared, is a bug in the caller's own data and
   * throws, exactly as {@link NodeRegistry.resolve} does.
   *
   * @throws {NodeNotFoundError} when an endpoint is not in the graph.
   * @throws {NodeKindMissingError} when an endpoint declares no kind.
   * @throws {UnknownNodeKindError} when an endpoint names an undeclared kind.
   */
  checkConnection<A extends object, E extends object>(
    graph: Graph<A, E>,
    proposed: ProposedConnection,
  ): ConnectionCheckResult;
}

