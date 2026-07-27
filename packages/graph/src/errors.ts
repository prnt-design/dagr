/**
 * Errors thrown by the graph model.
 *
 * Every error extends {@link DagrGraphError}, so a caller can catch the whole
 * family with one `instanceof` check, and every error carries a `code` string
 * literal for callers that would rather switch on a value than on a class. The
 * base declares `code` abstractly, so the switch narrows through a value typed
 * as the base class and stays exhaustive. Each subclass restores its own
 * prototype explicitly, so `instanceof` stays correct even when the output is
 * downlevelled below the ES2022 target.
 */

import type { PortDirection } from './types.js';

/** The `code` of every error the graph model throws. */
export type DagrGraphErrorCode =
  | 'INVALID_ID'
  | 'DUPLICATE_NODE'
  | 'NODE_NOT_FOUND'
  | 'DUPLICATE_EDGE'
  | 'EDGE_NOT_FOUND'
  | 'DUPLICATE_PORT'
  | 'PORT_NOT_FOUND'
  | 'PORT_IN_USE'
  | 'PORT_DIRECTION'
  | 'CYCLE'
  | 'INVALID_GRAPH_JSON';

/**
 * Base class for every error the graph model throws. Abstract on purpose: a
 * family member with no `code` would defeat the point of the union, and
 * tightening this later would be a breaking change.
 *
 * This is a catch base, not an extension point. It is exported so one
 * `instanceof` can catch the family and so `code` can be switched on through
 * it, and the family is exactly the eleven classes below.
 * {@link isDagrGraphError} narrows to a closed union of those eleven and rejects
 * anything else, a subclass declared elsewhere included. A sibling package
 * that wants the same `code` ergonomics should declare its own root class,
 * its own code union, and its own predicate rather than extending this one:
 * that way each package's exhaustive switch stays exhaustive over its own
 * errors.
 */
export abstract class DagrGraphError extends Error {
  /** Discriminant for switching on the error without naming its class. */
  abstract readonly code: DagrGraphErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DagrGraphError';
    Object.setPrototypeOf(this, DagrGraphError.prototype);
  }
}

/** Thrown when a caller supplies an id that is not usable, such as `''`. */
export class InvalidIdError extends DagrGraphError {
  readonly code = 'INVALID_ID';

  constructor(
    readonly kind: 'node' | 'edge' | 'port',
    readonly id: string,
  ) {
    super(`Invalid ${kind} id: ids must not be empty`);
    this.name = 'InvalidIdError';
    Object.setPrototypeOf(this, InvalidIdError.prototype);
  }
}

/** Thrown when adding a node whose id is already in the graph. */
export class DuplicateNodeError extends DagrGraphError {
  readonly code = 'DUPLICATE_NODE';

  constructor(readonly id: string) {
    super(`Node "${id}" already exists`);
    this.name = 'DuplicateNodeError';
    Object.setPrototypeOf(this, DuplicateNodeError.prototype);
  }
}

/** Thrown when an operation names a node the graph does not hold. */
export class NodeNotFoundError extends DagrGraphError {
  readonly code = 'NODE_NOT_FOUND';

  constructor(readonly id: string) {
    super(`Node "${id}" does not exist`);
    this.name = 'NodeNotFoundError';
    Object.setPrototypeOf(this, NodeNotFoundError.prototype);
  }
}

/** Thrown when adding an edge whose id is already in the graph. */
export class DuplicateEdgeError extends DagrGraphError {
  readonly code = 'DUPLICATE_EDGE';

  constructor(readonly id: string) {
    super(`Edge "${id}" already exists`);
    this.name = 'DuplicateEdgeError';
    Object.setPrototypeOf(this, DuplicateEdgeError.prototype);
  }
}

/** Thrown when an operation names an edge the graph does not hold. */
export class EdgeNotFoundError extends DagrGraphError {
  readonly code = 'EDGE_NOT_FOUND';

  constructor(readonly id: string) {
    super(`Edge "${id}" does not exist`);
    this.name = 'EdgeNotFoundError';
    Object.setPrototypeOf(this, EdgeNotFoundError.prototype);
  }
}

/**
 * Thrown when declaring a port whose id the node already has. Port ids are
 * unique per node, not per graph, so this always names both.
 */
export class DuplicatePortError extends DagrGraphError {
  readonly code = 'DUPLICATE_PORT';

  constructor(
    readonly nodeId: string,
    readonly portId: string,
  ) {
    super(`Port "${portId}" already exists on node "${nodeId}"`);
    this.name = 'DuplicatePortError';
    Object.setPrototypeOf(this, DuplicatePortError.prototype);
  }
}

/** Thrown when an operation names a port the node does not declare. */
export class PortNotFoundError extends DagrGraphError {
  readonly code = 'PORT_NOT_FOUND';

  constructor(
    readonly nodeId: string,
    readonly portId: string,
  ) {
    super(`Port "${portId}" does not exist on node "${nodeId}"`);
    this.name = 'PortNotFoundError';
    Object.setPrototypeOf(this, PortNotFoundError.prototype);
  }
}

/**
 * Thrown when removing a port that live edges still reference. The offending
 * edge ids come with it so the caller can rewire or remove them and retry
 * without having to rediscover which edges were in the way. Rewiring is
 * `updateEdgePorts`, which moves an edge off the port while keeping the edge's
 * id, attributes, and place in insertion order; removing is `removeEdge`.
 */
export class PortInUseError extends DagrGraphError {
  readonly code = 'PORT_IN_USE';

  constructor(
    readonly nodeId: string,
    readonly portId: string,
    readonly edgeIds: readonly string[],
  ) {
    super(
      `Port "${portId}" on node "${nodeId}" is still used by ${String(edgeIds.length)} edge(s): ${edgeIds.join(', ')}`,
    );
    this.name = 'PortInUseError';
    Object.setPrototypeOf(this, PortInUseError.prototype);
  }
}

/**
 * Thrown when an edge asks a port to be an end it does not face. An edge
 * leaves its source, so a source port must be `'out'` or `'inout'`, and it
 * arrives at its target, so a target port must be `'in'` or `'inout'`.
 */
export class PortDirectionError extends DagrGraphError {
  readonly code = 'PORT_DIRECTION';

  constructor(
    readonly nodeId: string,
    readonly portId: string,
    readonly direction: PortDirection,
    readonly end: 'source' | 'target',
  ) {
    super(
      `Port "${portId}" on node "${nodeId}" is "${direction}" and cannot be an edge's ${end}`,
    );
    this.name = 'PortDirectionError';
    Object.setPrototypeOf(this, PortDirectionError.prototype);
  }
}

/**
 * Thrown when a call needs an acyclic graph and did not get one.
 *
 * Refusing rather than returning a partial order is the same rule the rest of
 * this package keeps: a node the graph does not hold is an error and not an
 * empty result, and a topological order of a cyclic graph does not exist, so
 * handing back something order-shaped would invite a caller to use it.
 *
 * `isAcyclic` and `findCycle` are the tolerant forms, but unlike `hasNode`
 * before a lookup they are not free: each is a full walk, and the call they
 * guard is another. To ask for the order and learn why there is none, catch
 * this rather than checking first. It carries the witness the check would have
 * gone looking for, so the happy path costs one walk instead of two.
 *
 * `cycle` is a witness, not the whole story: a graph can hold many cycles and
 * this is the one the search reached first. Consecutive entries are joined by
 * an edge and the last closes back to the first, with the endpoint listed once,
 * so a cycle of n nodes has n entries and a self loop has one.
 */
export class CycleError extends DagrGraphError {
  readonly code = 'CYCLE';

  constructor(readonly cycle: readonly string[]) {
    super(`Graph is cyclic: ${cycle.join(' -> ')} -> ${cycle[0] ?? ''}`);
    this.name = 'CycleError';
    Object.setPrototypeOf(this, CycleError.prototype);
  }
}

/**
 * Thrown when a value handed to `Graph.fromJSON` is not the shape the
 * serialization format describes.
 *
 * Shape is what one field decides on its own: a value is refusable from the
 * format alone, without knowing anything about the rest of the document. A
 * missing `version`, a `nodes` that is not an array, an id that is not a string
 * or is the empty string, a `direction` outside the three it may be. Content is
 * the rest, which is to say everything the graph itself already has an opinion
 * about because it depends on what else is in the file: a duplicate id, an edge
 * naming an endpoint that is not there, a port facing the wrong way. `fromJSON`
 * builds by calling the same public constructors any other caller would, so it
 * cannot construct a graph the public API could not, and those failures come
 * back as the family members they always were. One error per kind of wrongness
 * rather than one per entry point.
 *
 * The empty id is the case where the line was worth drawing carefully.
 * `InvalidIdError` still owns the rule for `addNode`, `addEdge`, and `addPort`,
 * which see a call rather than a document; it just is not what a document earns,
 * because it carries a kind and an id that is the empty string, so it would be
 * the one refusal here naming nothing a reader could search a file for.
 *
 * `path` is where the offending field sits in the document, written the way a
 * reader would index into it: `nodes[3].ports[1].direction`. The whole document
 * is `(root)`, which is a path rather than the empty string so a message never
 * reads as though the field had no name. A file edited by hand is the reason
 * this is carried at all: "expected a string" is not actionable on its own, and
 * a document large enough to be worth serialising is too large to search.
 */
export class InvalidGraphJSONError extends DagrGraphError {
  readonly code = 'INVALID_GRAPH_JSON';

  constructor(
    readonly path: string,
    readonly expected: string,
  ) {
    super(`Invalid graph JSON at ${path}: expected ${expected}`);
    this.name = 'InvalidGraphJSONError';
    Object.setPrototypeOf(this, InvalidGraphJSONError.prototype);
  }
}

/**
 * Every concrete error the graph model throws, as a discriminated union.
 *
 * {@link DagrGraphError} narrows the `code` but not the object it came from,
 * because an abstract base cannot know its subclasses. This union closes that
 * gap: switching on `code` through a value of this type narrows to the class,
 * so a `PORT_IN_USE` arm can read `edgeIds` without a cast. Use
 * {@link isDagrGraphError} to get here from a `catch`.
 */
export type DagrGraphErrorLike =
  | InvalidIdError
  | DuplicateNodeError
  | NodeNotFoundError
  | DuplicateEdgeError
  | EdgeNotFoundError
  | DuplicatePortError
  | PortNotFoundError
  | PortInUseError
  | PortDirectionError
  | CycleError
  | InvalidGraphJSONError;

/**
 * Every member of {@link DagrGraphErrorCode}, keyed so the compiler keeps the
 * list complete: adding a code to the union without adding it here is a type
 * error, which is what stops the runtime check below from silently falling
 * behind the union it enforces.
 */
const KNOWN_CODES: Readonly<Record<DagrGraphErrorCode, true>> = {
  INVALID_ID: true,
  DUPLICATE_NODE: true,
  NODE_NOT_FOUND: true,
  DUPLICATE_EDGE: true,
  EDGE_NOT_FOUND: true,
  DUPLICATE_PORT: true,
  PORT_NOT_FOUND: true,
  PORT_IN_USE: true,
  PORT_DIRECTION: true,
  CYCLE: true,
  INVALID_GRAPH_JSON: true,
};

/** The same eleven codes as a set, for the membership test in the predicate. */
const KNOWN_CODE_SET: ReadonlySet<string> = new Set(Object.keys(KNOWN_CODES));

/**
 * Whether a caught value is one of this package's errors, narrowed to the
 * union rather than to the abstract base.
 *
 * The check is `instanceof DagrGraphError` AND a membership test of `code`
 * against the eleven known codes. The second half is what makes the runtime test
 * as closed as {@link DagrGraphErrorLike} claims to be: the base class is
 * exported, so a further subclass carrying a code of its own would pass the
 * `instanceof` alone and be narrowed to a union it is not a member of, at
 * which point an exhaustive-looking `switch` falls through and a case arm
 * reads a field off a class that does not have one.
 */
export function isDagrGraphError(value: unknown): value is DagrGraphErrorLike {
  return value instanceof DagrGraphError && KNOWN_CODE_SET.has(value.code);
}
