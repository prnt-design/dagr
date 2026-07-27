/**
 * The JSON document form of a graph: what `toJSON` writes and what
 * `Graph.fromJSON` reads.
 *
 * A document describes CONTENT, not HISTORY. It holds the graph attributes,
 * the nodes with their ports, and the edges, each listing in insertion order,
 * and nothing about how the graph got that way. The id generation counters in
 * particular are not in it. That is what makes a document usable as a golden
 * key: two graphs holding the same elements in the same order write the same
 * document whatever sequence of calls built them, so a committed fixture
 * compares equal to a rebuilt one without a normalisation step in between.
 *
 * It costs one thing, and it is documented rather than glossed. A generated
 * suffix the original spent on an element it has since removed is free again
 * after a round trip, because the counters are rebuilt from the ids that are
 * actually present. So a round trip is not a way to continue an instance's
 * generation sequence. Uniqueness within a graph is unaffected: replay passes
 * every id through `addNode` and `addEdge`, which advance the counters past an
 * explicit id exactly as they always do.
 *
 * Reading is deliberately in two halves. {@link readDocument} decides whether
 * this is a graph document at all and refuses with an
 * {@link InvalidDocumentError} naming the offending field; {@link restore}
 * replays the validated document through the graph's own public mutators, so
 * every consistency rule (unknown endpoint, duplicate id, port direction) is
 * checked by the one implementation that already owns it and fails the way the
 * equivalent bad call fails. The two questions are worth keeping apart because
 * a caller can act on them differently: "this file is not a graph document" is
 * corruption, while "this document names a node that is not there" is a
 * consistent file describing a graph that does not hold together.
 */

import { InvalidDocumentError } from './errors.js';
import type { Graph } from './graph.js';
import type {
  Attrs,
  EdgeId,
  NodeId,
  PortDirection,
  PortId,
  ReadAttrs,
} from './types.js';

/**
 * The format version every document carries, and the only one this build
 * reads.
 *
 * Constant on purpose. A field that moved with the content, a timestamp or a
 * writer version, would make every golden file churn on every unrelated
 * change, which is the whole reason the document holds no history. This is
 * cheap insurance while the format is pre-1.0: it costs one integer per
 * document and buys a clear refusal instead of a confusing structural error
 * the day the shape changes.
 */
const VERSION = 1;

/** A port as a document holds it. Both fields always present, see below. */
export interface PortDocument {
  readonly id: PortId;
  readonly direction: PortDirection;
}

/** A node as a document holds it, with its ports in declaration order. */
export interface NodeDocument<N extends object = Attrs> {
  readonly id: NodeId;
  readonly attrs: ReadAttrs<N>;
  readonly ports: readonly PortDocument[];
}

/**
 * An edge as a document holds it. An unbound end is an absent key rather than
 * a `null` or a key present and `undefined`, which is the same distinction the
 * edge records and the patch ops draw, and the one `exactOptionalPropertyTypes`
 * makes expressible.
 */
export interface EdgeDocument<E extends object = Attrs> {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly attrs: ReadAttrs<E>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}

/**
 * A whole graph as JSON.
 *
 * Named and exported so a caller holding one in a variable, a field, or a
 * function signature has something to annotate it with, the same reason
 * {@link AttrsPatch} and {@link EdgePortsPatch} are exported. It takes the
 * same three attribute type parameters `Graph` does, in the same order and
 * with the same defaults, so the bags inside a `GraphDocument<NodeAttrs,
 * EdgeAttrs, GraphAttrs>` are typed rather than `unknown`.
 *
 * These are document types rather than the record types reused under new
 * names, even though the two shapes match today. The document is a wire
 * format with a version field and the records are what the model holds in
 * memory, and they are allowed to diverge: when `Port` grows an attribute bag
 * the record changes on the spot, while the document changing is a format
 * decision with a version bump attached to it. Sharing the type would hide
 * that choice behind a field addition.
 *
 * Every field is required, including empty bags and empty port lists. That
 * makes the mapping between graphs and documents one to one in both
 * directions: `fromJSON` never has to invent a default, and there is exactly
 * one document for a given graph rather than a family of documents differing
 * in what they left out. A canonical form is the point when documents are
 * compared as golden files. It costs a hand-written document a few `{}`s, and
 * hand writing is not what this format is for.
 */
export interface GraphDocument<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> {
  readonly version: typeof VERSION;
  readonly attrs: ReadAttrs<GraphAttrs>;
  readonly nodes: readonly NodeDocument<NodeAttrs>[];
  readonly edges: readonly EdgeDocument<EdgeAttrs>[];
}

/**
 * The document for a graph, in insertion order throughout.
 *
 * Attribute bags are handed back by reference, frozen as the graph already
 * holds them, and are never inspected on the way out. So writing a document is
 * O(nodes plus edges plus ports) with no deep copy, and a caller who stored a
 * value JSON cannot express gets `JSON.stringify`'s own behaviour for it: a
 * function or an `undefined` is dropped, a cyclic object throws, a `Date`
 * becomes a string. That is what any other object holding those values does,
 * and rewriting them here would be this module inventing a value the caller
 * never stored.
 *
 * The document and the arrays and objects this builds are frozen, like
 * everything else the package hands out. The bags and port arrays inside were
 * frozen already.
 */
export function toDocument<N extends object, E extends object, G extends object>(
  graph: Graph<N, E, G>,
): GraphDocument<N, E, G> {
  return Object.freeze({
    version: VERSION,
    attrs: graph.attrs,
    nodes: Object.freeze(
      graph.nodes().map((node) =>
        Object.freeze({ id: node.id, attrs: node.attrs, ports: node.ports }),
      ),
    ),
    edges: Object.freeze(
      graph.edges().map((edge) =>
        // Spread conditionally rather than assigned `undefined`, so an unbound
        // end stays an absent key: `JSON.stringify` would drop it either way,
        // but a document handed straight back to `fromJSON` without a trip
        // through JSON text has to draw the same distinction the records do.
        Object.freeze({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          attrs: edge.attrs,
          ...(edge.sourcePort === undefined ? {} : { sourcePort: edge.sourcePort }),
          ...(edge.targetPort === undefined ? {} : { targetPort: edge.targetPort }),
        }),
      ),
    ),
  });
}

/**
 * Replays a validated document onto a graph, in array order.
 *
 * Order faithful, and deliberately unlike `apply`. Replaying a patch cannot
 * restore insertion order because one op does not know where in the order it
 * belongs, so a replayed element lands at the end of its listing. A document
 * holds the whole graph at once, so that reason does not apply here and
 * restoring order costs nothing: replay in array order and every listing comes
 * back exactly as it was, node order, edge order, and each node's port
 * declaration order.
 *
 * Everything goes through the public mutators. Validation is reused rather
 * than reimplemented, so a document describing an impossible graph is refused
 * by the call that owns that rule, and nothing half built escapes: the throw
 * comes out of `fromJSON` and the partly filled graph is never handed to
 * anyone. Attributes are handed over as merge patches onto empty bags, which
 * is what makes the two graphs hold separate bags afterwards even though the
 * document's own bags were passed by reference.
 *
 * A fresh graph has no listeners, so the patches these calls emit are observed
 * by nobody. Restoring onto a graph that is already watched is not what this
 * is for and is not reachable through `fromJSON`.
 */
export function restore<N extends object, E extends object, G extends object>(
  graph: Graph<N, E, G>,
  document: GraphDocument<N, E, G>,
): void {
  graph.updateAttrs(document.attrs);
  for (const node of document.nodes) {
    graph.addNode({ id: node.id, attrs: node.attrs, ports: node.ports });
  }
  for (const edge of document.edges) {
    graph.addEdge({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      attrs: edge.attrs,
      ...(edge.sourcePort === undefined ? {} : { sourcePort: edge.sourcePort }),
      ...(edge.targetPort === undefined ? {} : { targetPort: edge.targetPort }),
    });
  }
}

/**
 * Every member of {@link PortDirection}, keyed so the compiler keeps the list
 * complete: adding a direction to the union without adding it here is a type
 * error. The same trick `KNOWN_CODES` uses in `errors.ts`, and for the same
 * reason, a runtime check that would otherwise fall quietly behind the union
 * it is supposed to enforce.
 */
const DIRECTIONS: Readonly<Record<PortDirection, true>> = { in: true, out: true, inout: true };

/** Whether a value is one of the three port directions. */
function isDirection(value: unknown): value is PortDirection {
  return typeof value === 'string' && Object.hasOwn(DIRECTIONS, value);
}

/**
 * What was found where something else was expected, for the error message.
 *
 * Strings are quoted and numbers and booleans are printed, because a wrong
 * enum value or a version this build does not read is worth naming; anything
 * larger is described by kind rather than dumped into the message, since the
 * path already says where to look.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/** A field that has to be a JSON object: not null, and not an array. */
function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidDocumentError(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

/** A field that has to be a JSON array. */
function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidDocumentError(path, `expected an array, got ${describe(value)}`);
  }
  return value as readonly unknown[];
}

/** A field that has to be a string. Emptiness is the mutators' rule, not this one. */
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new InvalidDocumentError(path, `expected a string, got ${describe(value)}`);
  }
  return value;
}

/**
 * An attribute bag, checked for being an object and nothing else.
 *
 * The assertion is the one place this module takes the caller at their word,
 * and unlike the assertion in `graph.ts` the claim is not true by
 * construction: the values in a document came from a file, not from an
 * `AttrsPatch<A>`. Checking them is not possible anyway, since a type
 * parameter is gone by runtime, and it would be a new rule rather than an
 * enforced one: attribute types are an unchecked caller claim everywhere else
 * the model stores caller data, and a document is caller data. So the bag is
 * required to be an object, and what is in it is the caller's business.
 */
function readAttrs<A extends object>(value: unknown, path: string): ReadAttrs<A> {
  return requireObject(value, path) as ReadAttrs<A>;
}

/** One port of a node. */
function readPort(value: unknown, path: string): PortDocument {
  const raw = requireObject(value, path);
  const id = requireString(raw.id, `${path}.id`);
  // Required rather than defaulted to `'inout'` the way `PortInit` defaults
  // it. A declaration is written by hand and deserves the shorthand; a
  // document is written by `toDocument`, which always states the direction, so
  // accepting an absent one would only add a second spelling of a document
  // that no writer produces and that does not round trip back to itself.
  if (!isDirection(raw.direction)) {
    throw new InvalidDocumentError(
      `${path}.direction`,
      `expected "in", "out" or "inout", got ${describe(raw.direction)}`,
    );
  }
  return { id, direction: raw.direction };
}

/** One node, with its ports in declaration order. */
function readNode<N extends object>(value: unknown, path: string): NodeDocument<N> {
  const raw = requireObject(value, path);
  return {
    id: requireString(raw.id, `${path}.id`),
    attrs: readAttrs<N>(raw.attrs, `${path}.attrs`),
    ports: requireArray(raw.ports, `${path}.ports`).map((port, index) =>
      readPort(port, `${path}.ports[${String(index)}]`),
    ),
  };
}

/**
 * One end of an edge's port binding. Absent and present-and-`undefined` both
 * read as unbound: `JSON.parse` never produces the second, but a document
 * built in memory can, and the two mean the same thing to `addEdge`. A `null`
 * is not the same thing and is refused, because it is what a writer that
 * spelled "unbound" its own way would produce, and quietly accepting it would
 * make this format two formats.
 */
function readEnd(
  raw: Record<string, unknown>,
  key: 'sourcePort' | 'targetPort',
  path: string,
): PortId | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  return requireString(value, `${path}.${key}`);
}

/** One edge, with its endpoints and whatever ports it binds. */
function readEdge<E extends object>(value: unknown, path: string): EdgeDocument<E> {
  const raw = requireObject(value, path);
  // The four required fields are read into locals first, so that a document
  // wrong in two places reports the earlier field rather than whichever check
  // the spread happened to run first. Only the two optional ends have to be
  // resolved before the object literal, since an unbound end is spelled by
  // leaving its key out and that cannot be decided inside the literal.
  const id = requireString(raw.id, `${path}.id`);
  const source = requireString(raw.source, `${path}.source`);
  const target = requireString(raw.target, `${path}.target`);
  const attrs = readAttrs<E>(raw.attrs, `${path}.attrs`);
  const sourcePort = readEnd(raw, 'sourcePort', path);
  const targetPort = readEnd(raw, 'targetPort', path);
  return {
    id,
    source,
    target,
    attrs,
    ...(sourcePort === undefined ? {} : { sourcePort }),
    ...(targetPort === undefined ? {} : { targetPort }),
  };
}

/**
 * Reads an unknown value as a graph document, or refuses it.
 *
 * Structure only: this decides whether the value is shaped like a document,
 * and says nothing about whether the graph it describes holds together.
 * {@link restore} answers that, through the mutators. The result is rebuilt
 * rather than the input handed back under a new type, which drops fields this
 * version does not know (a document from a future version is refused on its
 * `version` before that can matter, so what this drops is a writer's own
 * annotations) and leaves nothing typed `unknown` for the replay to trip over.
 * Attribute bags are the exception and are carried by reference, because
 * copying one would have to rebuild it key by key and `__proto__` is a key.
 *
 * O(nodes plus edges plus ports). Fails on the first problem it finds rather
 * than collecting them: the first is the one worth reporting, and a document
 * with two problems is a document with one problem twice as often as it is a
 * report worth reading.
 *
 * @throws {InvalidDocumentError} carrying the path of the offending field.
 */
export function readDocument<N extends object, E extends object, G extends object>(
  value: unknown,
): GraphDocument<N, E, G> {
  // The empty path is the document itself. There is no field to name here, and
  // rendering `at ` with nothing after it would be worse than saying nothing.
  const raw = requireObject(value, '');
  if (raw.version !== VERSION) {
    throw new InvalidDocumentError(
      'version',
      `expected version ${String(VERSION)}, got ${describe(raw.version)}`,
    );
  }
  return {
    version: VERSION,
    attrs: readAttrs<G>(raw.attrs, 'attrs'),
    nodes: requireArray(raw.nodes, 'nodes').map((node, index) =>
      readNode<N>(node, `nodes[${String(index)}]`),
    ),
    edges: requireArray(raw.edges, 'edges').map((edge, index) =>
      readEdge<E>(edge, `edges[${String(index)}]`),
    ),
  };
}
