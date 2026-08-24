import type { Attrs, AttrsPatch, Node, NodeInit, PortId, PortInit, ReadAttrs } from '@dagr/graph';
import { InvalidSpecError, NodeKindMissingError, UnknownNodeKindError } from './errors.js';
import type {
  KindNodeInit,
  NodeRegistry,
  NodeSpec,
  NodeSpecInit,
  PortSpec,
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
  specs: Readonly<Record<K, NodeSpecInit>>,
  options: RegistryOptions = {},
): NodeRegistry<K> {
  const kindKey = options.kindKey ?? DEFAULT_KIND_KEY;
  // `Object.keys` widens to `string[]`, and the keys of a `Record<K, ...>` are
  // exactly `K`. This is the one place the kind union is asserted rather than
  // proved, and it is sound for the same reason `Object.keys` is unsound in
  // general and safe here: the parameter type says what the keys are.
  const kinds = Object.freeze(Object.keys(specs) as K[]);
  const byKind = new Map<string, NodeSpec<K>>();
  for (const kind of kinds) {
    byKind.set(kind, freezeSpec(kind, specs[kind]));
  }
  return new Registry(kinds, kindKey, byKind);
}

/** Validate one declared kind and turn it into the frozen spec handed back. */
function freezeSpec<K extends string>(kind: K, init: NodeSpecInit): NodeSpec<K> {
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
    // Copied rather than kept, so a caller mutating the array or the object
    // they passed cannot change a registry that has already been built.
    ports.push(
      Object.freeze(
        port.maxEdges === undefined
          ? { id: port.id, direction: port.direction }
          : { id: port.id, direction: port.direction, maxEdges: port.maxEdges },
      ),
    );
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

class Registry<K extends string> implements NodeRegistry<K> {
  readonly kinds: readonly K[];
  readonly kindKey: string;
  readonly #byKind: ReadonlyMap<string, NodeSpec<K>>;

  constructor(kinds: readonly K[], kindKey: string, byKind: ReadonlyMap<string, NodeSpec<K>>) {
    this.kinds = kinds;
    this.kindKey = kindKey;
    this.#byKind = byKind;
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
}
