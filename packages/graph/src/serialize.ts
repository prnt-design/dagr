/**
 * The JSON form of a graph: what a document looks like, and the validator that
 * decides whether an untrusted value is one.
 *
 * Construction is deliberately not here. `Graph.toJSON` projects a graph into
 * these types and `Graph.fromJSON` replays a validated document through the
 * public constructors, both in `graph.ts`, which lets this module be what
 * `traversal.ts` is: a leaf `Graph` imports and that imports no `Graph` back.
 * The seam buys more than the absent cycle. Validation is a pure function from
 * `unknown` to a document, which is the half worth reading and testing on its
 * own, and keeping it away from a `Graph` under construction is what makes
 * "every shape error is found before anything is built" a fact about where the
 * code sits rather than a discipline someone has to keep.
 *
 * A document is a plain JavaScript value, not a string. `JSON.stringify` and
 * `JSON.parse` stay the caller's to call, which is what lets a document be
 * embedded in a larger file, structurally cloned, or diffed without being
 * serialised twice.
 */

import { InvalidGraphJSONError } from './errors.js';
import type { Attrs, EdgeId, NodeId, PortDirection, PortId, ReadAttrs } from './types.js';

/**
 * A port as a document holds it.
 *
 * Structurally the same as `Port` today, and a separate type on purpose: the
 * record is what this version of the package happens to store and the document
 * is a format other tools read. Ports are already scheduled to grow an
 * attribute bag in M2.1, and when they do the record gains a field on the day
 * that lands while the document gains one on the day the format says it does.
 *
 * `direction` is required here even though `PortInit` defaults it. The format
 * omits what is empty, and a port with no direction is not empty, it is
 * unstated, so writing it out keeps the field a reader is most likely to get
 * wrong by hand in front of them.
 */
export interface PortJSON {
  readonly id: PortId;
  readonly direction: PortDirection;
}

/** A node as a document holds it. An absent key reads as the empty thing. */
export interface NodeJSON<N extends object = Attrs> {
  readonly id: NodeId;
  /** Absent when the node's bag is empty. */
  readonly attrs?: ReadAttrs<N>;
  /** Absent when the node declares no ports. */
  readonly ports?: readonly PortJSON[];
}

/** An edge as a document holds it. */
export interface EdgeJSON<E extends object = Attrs> {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  /** Absent when the edge's bag is empty. */
  readonly attrs?: ReadAttrs<E>;
  /** Absent when that end is unbound, exactly as on the record. */
  readonly sourcePort?: PortId;
  /** Absent when that end is unbound, exactly as on the record. */
  readonly targetPort?: PortId;
}

/**
 * A whole graph as a document.
 *
 * `nodes` and `edges` are always present, empty arrays included, so a reader
 * never has to tell "no nodes" from "a writer that forgot to say". Everything
 * else is omitted when it is empty, which is what keeps a file small enough to
 * read, edit by hand, and diff.
 *
 * Both arrays are in insertion order, and that is part of the contract rather
 * than an incidental property of how they were written. Insertion order is
 * observable in this model (iteration order, neighbour order, the
 * `topologicalOrder` tie-break), so a reader that replays them in some other
 * order restores the content and changes the graph.
 *
 * `version` is the format's, not the package's. It moves when a document this
 * version writes would be misread by a later reader, or the other way round,
 * and never merely because the package released. Version 1 is the only one this
 * package writes and the only one it reads: an unrecognised version is refused
 * rather than guessed at.
 */
export interface GraphJSON<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> {
  readonly version: 1;
  /** Absent when the graph's own bag is empty. */
  readonly attrs?: ReadAttrs<GraphAttrs>;
  /** Every node, in insertion order. */
  readonly nodes: readonly NodeJSON<NodeAttrs>[];
  /** Every edge, in insertion order. */
  readonly edges: readonly EdgeJSON<EdgeAttrs>[];
}

/**
 * The only version this package writes or reads. A document tagged anything
 * else is refused at the door: a reader that guessed would corrupt a graph
 * quietly, and there is nothing yet to be backwards compatible with.
 */
const VERSION = 1;

/**
 * Every member of {@link PortDirection}, keyed so the compiler keeps the list
 * complete. The same trick `KNOWN_CODES` uses in `errors.ts`: widening the
 * union without widening this is a type error, so the runtime check cannot fall
 * behind the type it enforces.
 */
const PORT_DIRECTIONS: Readonly<Record<PortDirection, true>> = {
  in: true,
  out: true,
  inout: true,
};

/** The same three directions as a set, for the membership test below. */
const PORT_DIRECTION_SET: ReadonlySet<string> = new Set(Object.keys(PORT_DIRECTIONS));

/** The path of the document itself, so a root failure still names a field. */
const ROOT = '(root)';

/**
 * A record, meaning an object that is neither `null` nor an array.
 *
 * Arrays are excluded explicitly. `typeof [] === 'object'` and an array is
 * missing every key a record needs, so without this one test an array would
 * reach the field checks and fail somewhere less honest than here.
 */
function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidGraphJSONError(path, 'an object');
  }
  return value as Record<string, unknown>;
}

/** An array, which is the one shape a listing may take. */
function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidGraphJSONError(path, 'an array');
  return value;
}

/**
 * A string. Emptiness is deliberately not checked: an empty id is a content
 * error `InvalidIdError` already answers for, and a second copy of that rule
 * here would be a second place for it to drift.
 */
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new InvalidGraphJSONError(path, 'a string');
  return value;
}

/** An optional string, an absent key and an `undefined` reading the same way. */
function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path);
}

/**
 * An attribute bag, checked for being a bag and not for what is in it.
 *
 * The graph never reads an attribute, so serialization has no business
 * validating, repairing, or cloning one: values pass through by reference and
 * are the caller's problem exactly as they are on `addNode({ attrs })`. The bag
 * itself is still checked, because a `nodes[0].attrs` of `7` is a document that
 * means nothing rather than a value the graph would have taken.
 */
function optionalAttrs(value: unknown, path: string): ReadAttrs<Attrs> | undefined {
  if (value === undefined) return undefined;
  return requireRecord(value, path);
}

/** One port declaration. */
function parsePort(value: unknown, path: string): PortJSON {
  const port = requireRecord(value, path);
  const direction = port['direction'];
  if (typeof direction !== 'string' || !PORT_DIRECTION_SET.has(direction)) {
    throw new InvalidGraphJSONError(`${path}.direction`, '"in", "out", or "inout"');
  }
  return {
    id: requireString(port['id'], `${path}.id`),
    // The membership test above is what makes this assertion true. It is the
    // one place the module crosses from an untrusted string to the union, and
    // `PORT_DIRECTIONS` is what stops the two drifting apart.
    direction: direction as PortDirection,
  };
}

/** One node declaration, with its ports when it has any. */
function parseNode(value: unknown, path: string): NodeJSON {
  const node = requireRecord(value, path);
  const id = requireString(node['id'], `${path}.id`);
  const attrs = optionalAttrs(node['attrs'], `${path}.attrs`);
  const rawPorts = node['ports'];
  const ports =
    rawPorts === undefined
      ? undefined
      : requireArray(rawPorts, `${path}.ports`).map((port, index) =>
          parsePort(port, `${path}.ports[${String(index)}]`),
        );
  // Spread rather than assigned, because `exactOptionalPropertyTypes` draws the
  // distinction between absent and present-and-undefined, and the format says
  // absent.
  return {
    id,
    ...(attrs === undefined ? {} : { attrs }),
    ...(ports === undefined ? {} : { ports }),
  };
}

/** One edge declaration. */
function parseEdge(value: unknown, path: string): EdgeJSON {
  const edge = requireRecord(value, path);
  const attrs = optionalAttrs(edge['attrs'], `${path}.attrs`);
  const sourcePort = optionalString(edge['sourcePort'], `${path}.sourcePort`);
  const targetPort = optionalString(edge['targetPort'], `${path}.targetPort`);
  return {
    id: requireString(edge['id'], `${path}.id`),
    source: requireString(edge['source'], `${path}.source`),
    target: requireString(edge['target'], `${path}.target`),
    ...(attrs === undefined ? {} : { attrs }),
    ...(sourcePort === undefined ? {} : { sourcePort }),
    ...(targetPort === undefined ? {} : { targetPort }),
  };
}

/**
 * Reads an untrusted value as a document, or refuses it.
 *
 * Pure: nothing is constructed, nothing is mutated, and the attribute bags come
 * back by reference. Every shape failure throws {@link InvalidGraphJSONError}
 * carrying the path of the offending field, and the whole document is checked
 * before `Graph.fromJSON` builds any of it, so a shape error can never leave a
 * half-built graph behind.
 *
 * Keys the format does not name are ignored rather than refused. `version` is
 * how a document says it means something new, so refusing unknown keys would
 * buy a typo check at the price of making every additive change a breaking one,
 * and a document annotated by some other tool stays readable here.
 *
 * @throws {InvalidGraphJSONError} when the value is not a version 1 document.
 */
export function parseGraphJSON(value: unknown): GraphJSON {
  const document = requireRecord(value, ROOT);
  if (document['version'] !== VERSION) {
    throw new InvalidGraphJSONError('version', String(VERSION));
  }
  const attrs = optionalAttrs(document['attrs'], 'attrs');
  const nodes = requireArray(document['nodes'], 'nodes').map((node, index) =>
    parseNode(node, `nodes[${String(index)}]`),
  );
  const edges = requireArray(document['edges'], 'edges').map((edge, index) =>
    parseEdge(edge, `edges[${String(index)}]`),
  );
  return { version: VERSION, ...(attrs === undefined ? {} : { attrs }), nodes, edges };
}
