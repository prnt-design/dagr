/**
 * Errors thrown by the graph model.
 *
 * Every error extends {@link DagrGraphError}, so a caller can catch the whole
 * family with one `instanceof` check, and every subclass carries a `code`
 * string literal for callers that would rather switch on a value than on a
 * class. Each subclass restores its own prototype explicitly, so `instanceof`
 * stays correct even when the output is downlevelled below the ES2022 target.
 */

/** Base class for every error the graph model throws. */
export class DagrGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DagrGraphError';
    Object.setPrototypeOf(this, DagrGraphError.prototype);
  }
}

/** Thrown when a caller supplies an id that is not usable, such as `''`. */
export class InvalidIdError extends DagrGraphError {
  readonly code = 'INVALID_ID';

  constructor(kind: 'node' | 'edge') {
    super(`Invalid ${kind} id: ids must be non-empty strings`);
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
