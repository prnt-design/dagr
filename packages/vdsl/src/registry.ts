import type {
  Attrs,
  AttrsPatch,
  EdgeId,
  Graph,
  Node,
  NodeId,
  NodeInit,
  PortId,
  PortInit,
  ReadAttrs,
} from '@dagr/graph';
import { InvalidSpecError, NodeKindMissingError, UnknownNodeKindError } from './errors.js';
import type {
  ConnectionAllowed,
  ConnectionCheck,
  ConnectionCheckResult,
  ConnectionEnds,
  ConnectionRefusalCode,
  ConnectionRefused,
  KindNodeInit,
  NodeRegistry,
  NodeSpec,
  NodeSpecInit,
  PortRef,
  PortSpec,
  ProposedConnection,
  RegistryOptions,
} from './types.js';

/** The node attribute a registry reads a kind from unless told otherwise. */
export const DEFAULT_KIND_KEY = 'kind';

/**
 * Declare the node kinds a consumer's own language has.
 *
 * The kinds are the keys of the object literal, and `K` is inferred from them
 * once, here, and threaded through every spec the registry hands back. That is
 * the reason this is a factory taking a literal rather than an
 * `attrs -> spec` predicate a consumer writes: `Node.attrs` is
 * `Readonly<Partial<A>>`, so `attrs.kind` is `string | undefined` however
 * carefully the consumer typed their graph, and a predicate reading it erases
 * the kind union at the boundary. Every hover and drag callback downstream
 * would then land on a cast, which is the opposite of what a typed toolkit is
 * for.
 *
 * Dagr defines this interface and nothing behind it. There is no built-in kind,
 * no opinion about what a `source` or a `transform` is, and no config schema
 * format of Dagr's invention: a kind is whatever the consumer says, and its
 * configuration is checked by a function the consumer supplies.
 *
 * @example
 * ```ts
 * const registry = defineRegistry({
 *   source: { ports: [{ id: 'out', direction: 'out' }] },
 *   filter: {
 *     ports: [
 *       { id: 'in', direction: 'in', maxEdges: 1 },
 *       { id: 'out', direction: 'out' },
 *     ],
 *     checkConfig: (attrs) =>
 *       typeof attrs.threshold === 'number' ? [] : ['threshold must be a number'],
 *   },
 * });
 * // registry.kinds is readonly ('source' | 'filter')[]
 * ```
 */
export function defineRegistry<K extends string>(
  // `NodeSpecInit<K>` rather than `NodeSpecInit`: threading `K` into the value
  // type is what gives a `canConnect` written inline the consumer's own union
  // on both ends rather than `string`. Erasing it there would repeat, in the
  // one function a consumer writes about two kinds at once, exactly the
  // mistake this factory exists to avoid.
  //
  // `NoInfer` because `K` now appears in a parameter position inside the value
  // type as well as in the keys, and without it a consumer handing in a
  // pre-declared `NodeSpecInit` widens `K` to `string` for the whole registry.
  // The keys are the kinds, and they are the only thing `K` is inferred from.
  specs: Readonly<Record<K, NodeSpecInit<NoInfer<K>>>>,
  options: RegistryOptions = {},
): NodeRegistry<K> {
  const kindKey = options.kindKey ?? DEFAULT_KIND_KEY;
  const rejectCycles = options.rejectCycles ?? false;
  // `Object.keys` widens to `string[]`, and the keys of a `Record<K, ...>` are
  // exactly `K`. This is the one place the kind union is asserted rather than
  // proved, and it is sound for the same reason `Object.keys` is unsound in
  // general and safe here: the parameter type says what the keys are.
  const kinds = Object.freeze(Object.keys(specs) as K[]);
  const byKind = new Map<string, NodeSpec<K>>();
  // A second map rather than a field on the spec: a connection rule is about a
  // pair and a spec is what one kind promises about itself, so there is no one
  // kind for it to belong to. `checkPorts` is where the pair exists.
  const connectChecks = new Map<string, ConnectionCheck<K>>();
  for (const kind of kinds) {
    byKind.set(kind, freezeSpec(kind, specs[kind]));
    const canConnect = specs[kind].canConnect;
    if (canConnect !== undefined) connectChecks.set(kind, canConnect);
  }
  return new Registry(kinds, kindKey, rejectCycles, byKind, connectChecks);
}

/**
 * A {@link ConnectionCheck} that refuses two ports whose type tokens differ.
 *
 * The equality rule written out as a value, so a consumer who wants it names
 * it. It is not the default, because equality is wrong for every language with
 * a subtype relation, an `any`, or a coercion, and this package cannot tell
 * which of those a consumer has. It is provided, because exact match is what
 * most languages want and nobody should have to write it twice.
 *
 * A port declaring no token is untyped and has no opinion, so a pair is
 * refused only when BOTH ends name a token and the two differ.
 *
 * @example
 * ```ts
 * const registry = defineRegistry({
 *   source: { ports: [{ id: 'out', direction: 'out', type: 'number' }] },
 *   sink: { ports: [{ id: 'in', direction: 'in', type: 'number' }], canConnect: sameType },
 * });
 * ```
 */
export const sameType: ConnectionCheck = ({ source, target }) => {
  const from = source.port.type;
  const to = target.port.type;
  if (from === undefined || to === undefined || from === to) return undefined;
  return `port "${source.port.id}" carries "${from}" and port "${target.port.id}" takes "${to}"`;
};

/** Validate one declared kind and turn it into the frozen spec handed back. */
function freezeSpec<K extends string>(kind: K, init: NodeSpecInit<K>): NodeSpec<K> {
  if (kind === '') {
    throw new InvalidSpecError(kind, 'a kind must not be empty');
  }
  const seen = new Set<PortId>();
  const ports: PortSpec[] = [];
  for (const port of init.ports ?? []) {
    if (port.id === '') {
      throw new InvalidSpecError(kind, 'a port id must not be empty');
    }
    if (seen.has(port.id)) {
      throw new InvalidSpecError(kind, `port "${port.id}" is declared twice`);
    }
    seen.add(port.id);
    if (port.maxEdges !== undefined && !isPositiveInteger(port.maxEdges)) {
      throw new InvalidSpecError(
        kind,
        `port "${port.id}" has maxEdges ${port.maxEdges}, and a cap must be a positive integer`,
      );
    }
    if (port.type === '') {
      throw new InvalidSpecError(kind, `port "${port.id}" has an empty type token`);
    }
    // Copied rather than kept, so a caller mutating the array or the object
    // they passed cannot change a registry that has already been built. An
    // absent optional stays absent rather than becoming an explicit
    // `undefined`, which is what makes a spec survive `JSON.stringify` and
    // come back the shape it went in as.
    const copy: { id: PortId; direction: PortSpec['direction']; maxEdges?: number; type?: string } =
      { id: port.id, direction: port.direction };
    if (port.maxEdges !== undefined) copy.maxEdges = port.maxEdges;
    if (port.type !== undefined) copy.type = port.type;
    ports.push(Object.freeze(copy));
  }
  const frozenPorts = Object.freeze(ports);
  return Object.freeze(
    init.checkConfig === undefined
      ? { kind, ports: frozenPorts }
      : { kind, ports: frozenPorts, checkConfig: init.checkConfig },
  );
}

/**
 * `Infinity` is excluded here rather than allowed as "unbounded", because
 * absence already spells unbounded and two spellings of one value is a case
 * every consumer of `maxEdges` has to remember. `Number.isInteger` rejects it
 * and `NaN` on its own.
 */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * A node's attributes as an unknown-valued bag.
 *
 * This is one of the package's two casts, and the reading one. `Node.attrs` is
 * `Readonly<Partial<A>>` for the consumer's own `A`, which cannot be indexed by
 * a key chosen at runtime, and indexing it by exactly that key is what the
 * registry is for. The cast widens a known-shaped bag to an unknown-valued one,
 * which is the safe direction: every value out of it is `unknown`, and the two
 * callers either check it is a string first or hand the whole bag to the
 * consumer's own validator, which is where it came from.
 *
 * One helper rather than one cast per reader, so the argument is written once
 * and a third reader cannot arrive without it.
 */
function attrsOf<A extends object>(node: Node<A>): ReadAttrs<Attrs> {
  return node.attrs as ReadAttrs<Attrs>;
}

/** One shared empty result, so a kind with no config check allocates nothing. */
const NO_ISSUES: readonly string[] = Object.freeze([]);

/**
 * One shared allowed result, so the answer a drag loop asks for most often
 * allocates nothing. There is nothing to distinguish two of them by: the
 * refused form carries the code and the reason, and this one is the absence of
 * both.
 */
const ALLOWED: ConnectionAllowed = Object.freeze({ ok: true });

/** A refusal, frozen for the same reason every spec here is. */
function refuse(code: ConnectionRefusalCode, reason: string): ConnectionRefused {
  return Object.freeze({ ok: false as const, code, reason });
}

/**
 * How many edges name this port, counted from both sides.
 *
 * `maxEdges` caps the edges AT a port and not the edges through it in one
 * direction, which is only visible on an `inout` port. That is the graph
 * model's own reading: `Graph.removePort` refuses a port with users, and it
 * counts a user on either side. Edge ids go through a set for that method's
 * reason too, because a self loop can name the same port at both ends.
 */
function edgesAtPort<A extends object, E extends object, G extends object>(
  graph: Graph<A, E, G>,
  nodeId: NodeId,
  portId: PortId,
): number {
  const users = new Set<EdgeId>();
  for (const edge of graph.outEdges(nodeId)) {
    if (edge.sourcePort === portId) users.add(edge.id);
  }
  for (const edge of graph.inEdges(nodeId)) {
    if (edge.targetPort === portId) users.add(edge.id);
  }
  return users.size;
}

class Registry<K extends string> implements NodeRegistry<K> {
  readonly kinds: readonly K[];
  readonly kindKey: string;
  readonly rejectsCycles: boolean;
  readonly #byKind: ReadonlyMap<string, NodeSpec<K>>;

  readonly #connectChecks: ReadonlyMap<string, ConnectionCheck<K>>;

  constructor(
    kinds: readonly K[],
    kindKey: string,
    rejectsCycles: boolean,
    byKind: ReadonlyMap<string, NodeSpec<K>>,
    connectChecks: ReadonlyMap<string, ConnectionCheck<K>>,
  ) {
    this.kinds = kinds;
    this.kindKey = kindKey;
    this.rejectsCycles = rejectsCycles;
    this.#byKind = byKind;
    this.#connectChecks = connectChecks;
  }

  has(kind: string): kind is K {
    // A `Map`, not an object lookup: `'toString' in specs` is true for every
    // object literal a consumer writes, and a membership test that answers yes
    // for an inherited property name is a narrowing that lies.
    return this.#byKind.has(kind);
  }

  get(kind: K): NodeSpec<K> {
    const spec = this.#byKind.get(kind);
    if (spec === undefined) {
      // Unreachable through the declared type, which is why it throws the same
      // error a bad runtime kind gets rather than asserting: `get` is on the
      // public surface, and JavaScript reaches it with any string at all.
      throw new UnknownNodeKindError(kind, this.kinds);
    }
    return spec;
  }

  port(kind: K, portId: PortId): PortSpec | undefined {
    return this.get(kind).ports.find((port) => port.id === portId);
  }

  kindOf<A extends object>(node: Node<A>): K | undefined {
    const value = attrsOf(node)[this.kindKey];
    return typeof value === 'string' && this.has(value) ? value : undefined;
  }

  resolve<A extends object>(node: Node<A>): NodeSpec<K> {
    const value = attrsOf(node)[this.kindKey];
    if (typeof value !== 'string') {
      throw new NodeKindMissingError(this.kindKey, value);
    }
    if (!this.has(value)) {
      throw new UnknownNodeKindError(value, this.kinds);
    }
    return this.get(value);
  }

  tryResolve<A extends object>(node: Node<A>): NodeSpec<K> | undefined {
    const kind = this.kindOf(node);
    return kind === undefined ? undefined : this.get(kind);
  }

  checkConfig<A extends object>(node: Node<A>): readonly string[] {
    const spec = this.resolve(node);
    return spec.checkConfig === undefined ? NO_ISSUES : spec.checkConfig(attrsOf(node));
  }

  nodeInit<A extends object = Attrs>(kind: K, init: KindNodeInit<A> = {}): NodeInit<A> {
    const spec = this.get(kind);
    const ports: PortInit[] = spec.ports.map((port) => ({
      id: port.id,
      direction: port.direction,
    }));
    // The kind goes in LAST, so a caller's own `attrs` cannot overwrite it and
    // leave a node that resolves to a kind it was not built as. The cast is
    // the package's other one and the writing mirror of `attrsOf`:
    // `AttrsPatch<A>` cannot be written to under a key chosen at runtime, and
    // the value written is the kind the caller just asked for.
    const attrs = { ...init.attrs, [this.kindKey]: kind } as AttrsPatch<A>;
    return init.id === undefined ? { attrs, ports } : { id: init.id, attrs, ports };
  }

  checkPorts(source: PortRef<K>, target: PortRef<K>): ConnectionCheckResult {
    const sourceSpec = this.get(source.kind);
    const targetSpec = this.get(target.kind);
    const sourcePort = sourceSpec.ports.find((port) => port.id === source.portId);
    if (sourcePort === undefined) {
      return refuse('no-such-port', `kind "${source.kind}" declares no port "${source.portId}"`);
    }
    const targetPort = targetSpec.ports.find((port) => port.id === target.portId);
    if (targetPort === undefined) {
      return refuse('no-such-port', `kind "${target.kind}" declares no port "${target.portId}"`);
    }
    // The same rule `Graph.addEdge` enforces by throwing, asked rather than
    // tried. A drag offering every port on the canvas as a drop target cannot
    // catch its way through the ones that face the wrong way.
    if (sourcePort.direction === 'in') {
      return refuse(
        'wrong-direction',
        `port "${sourcePort.id}" on "${source.kind}" is "in" and cannot be an edge's source`,
      );
    }
    if (targetPort.direction === 'out') {
      return refuse(
        'wrong-direction',
        `port "${targetPort.id}" on "${target.kind}" is "out" and cannot be an edge's target`,
      );
    }
    const ends: ConnectionEnds<K> = {
      source: { kind: source.kind, port: sourcePort },
      target: { kind: target.kind, port: targetPort },
    };
    // Source first, then target, and the first reason wins. Both are asked
    // because either kind may hold a rule about the pair, and neither is asked
    // about a pair already refused: a predicate handed a port facing the wrong
    // way would be answering a question that is not live.
    const fromSource = this.#connectChecks.get(source.kind)?.(ends);
    if (fromSource !== undefined) return refuse('incompatible', fromSource);
    const fromTarget = this.#connectChecks.get(target.kind)?.(ends);
    if (fromTarget !== undefined) return refuse('incompatible', fromTarget);
    return ALLOWED;
  }

  checkConnection<A extends object, E extends object, G extends object>(
    graph: Graph<A, E, G>,
    proposed: ProposedConnection,
  ): ConnectionCheckResult {
    // Both endpoints resolved first, so a node the graph does not hold and a
    // node carrying an undeclared kind both throw before anything is refused.
    const sourceKind = this.resolve(graph.requireNode(proposed.source)).kind;
    const targetKind = this.resolve(graph.requireNode(proposed.target)).kind;
    const ports = this.checkPorts(
      { kind: sourceKind, portId: proposed.sourcePort },
      { kind: targetKind, portId: proposed.targetPort },
    );
    if (!ports.ok) return ports;
    const full =
      this.#capRefusal(graph, sourceKind, proposed.source, proposed.sourcePort) ??
      this.#capRefusal(graph, targetKind, proposed.target, proposed.targetPort);
    if (full !== undefined) return full;
    // `source === target` is the shortest cycle there is and `canReach` covers
    // every longer one, in one walk over the subgraph the target reaches
    // rather than over the whole graph. Nothing is added to answer this, so no
    // patch is emitted and no undo stack learns about a question.
    if (
      this.rejectsCycles &&
      (proposed.source === proposed.target || graph.canReach(proposed.target, proposed.source))
    ) {
      return refuse(
        'would-cycle',
        proposed.source === proposed.target
          ? `node "${proposed.source}" would connect to itself, and this registry refuses cycles`
          : `node "${proposed.source}" is already reachable from "${proposed.target}", so this edge would close a cycle`,
      );
    }
    return ALLOWED;
  }

  /** The cap this port carries and whether the graph has already filled it. */
  #capRefusal<A extends object, E extends object, G extends object>(
    graph: Graph<A, E, G>,
    kind: K,
    nodeId: NodeId,
    portId: PortId,
  ): ConnectionRefused | undefined {
    const cap = this.port(kind, portId)?.maxEdges;
    if (cap === undefined) return undefined;
    const used = edgesAtPort(graph, nodeId, portId);
    if (used < cap) return undefined;
    return refuse(
      'port-full',
      `port "${portId}" on node "${nodeId}" already carries ${used} of its ${cap} edges`,
    );
  }
}
