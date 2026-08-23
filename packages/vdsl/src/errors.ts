/**
 * Errors thrown by the node spec toolkit.
 *
 * The shape is `@dagr/graph`'s and the reasons are its reasons: one abstract
 * base so a caller can catch the family with one `instanceof`, a `code` string
 * literal on every member for callers who would rather switch on a value, and
 * an explicit prototype restore per subclass so `instanceof` survives being
 * downlevelled below the ES2022 target.
 *
 * It is a separate family rather than a subclass of `DagrGraphError`, on that
 * module's own instruction: each package keeps its own root, its own code
 * union and its own predicate, so each package's exhaustive switch stays
 * exhaustive over its own errors.
 */

/** The `code` of every error this package throws. */
export type DagrVdslErrorCode = 'INVALID_SPEC' | 'NODE_KIND_MISSING' | 'UNKNOWN_NODE_KIND';

/**
 * Base class for every error this package throws. Abstract on purpose: a
 * family member with no `code` would defeat the point of the union.
 *
 * This is a catch base, not an extension point, and the family is exactly the
 * three classes below. {@link isDagrVdslError} narrows to those three and
 * rejects anything else, a subclass declared elsewhere included.
 */
export abstract class DagrVdslError extends Error {
  /** Discriminant for switching on the error without naming its class. */
  abstract readonly code: DagrVdslErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DagrVdslError';
    Object.setPrototypeOf(this, DagrVdslError.prototype);
  }
}

/**
 * Thrown by `defineRegistry` when a declared kind is not one the toolkit could
 * act on: an empty id, a port id declared twice in one kind, or a `maxEdges`
 * that is not a positive integer.
 *
 * It throws at define time rather than reporting at use time because a
 * registry is built once from a literal, usually at module scope, and a bad
 * spec is a bug in the consumer's own source rather than in their data.
 */
export class InvalidSpecError extends DagrVdslError {
  readonly code = 'INVALID_SPEC';

  constructor(
    readonly kind: string,
    readonly problem: string,
  ) {
    super(`Invalid spec for node kind "${kind}": ${problem}`);
    this.name = 'InvalidSpecError';
    Object.setPrototypeOf(this, InvalidSpecError.prototype);
  }
}

/**
 * Thrown when a node does not legibly declare a kind: the kind attribute is
 * absent, or it holds something that is not a string.
 *
 * One error for both, because the caller's remedy is the same sentence in both
 * cases (write a string under this key) and the difference is a detail of what
 * was there, which is what {@link NodeKindMissingError.value} carries. Folding
 * them does not hide the numeric case: the message names the type it found.
 */
export class NodeKindMissingError extends DagrVdslError {
  readonly code = 'NODE_KIND_MISSING';

  constructor(
    readonly kindKey: string,
    readonly value: unknown,
  ) {
    super(
      value === undefined
        ? `Node has no "${kindKey}" attribute, so it declares no kind`
        : `Node attribute "${kindKey}" is a ${typeof value}, and a kind must be a string`,
    );
    this.name = 'NodeKindMissingError';
    Object.setPrototypeOf(this, NodeKindMissingError.prototype);
  }
}

/** Thrown when a node names a kind the registry was never given. */
export class UnknownNodeKindError extends DagrVdslError {
  readonly code = 'UNKNOWN_NODE_KIND';

  /** The kinds the registry does hold, in declaration order. Frozen. */
  readonly kinds: readonly string[];

  constructor(
    readonly kind: string,
    kinds: readonly string[],
  ) {
    super(
      kinds.length === 0
        ? `Unknown node kind "${kind}": the registry declares no kinds`
        : `Unknown node kind "${kind}": the registry declares ${kinds.map((known) => `"${known}"`).join(', ')}`,
    );
    this.name = 'UnknownNodeKindError';
    this.kinds = Object.freeze([...kinds]);
    Object.setPrototypeOf(this, UnknownNodeKindError.prototype);
  }
}

/** The closed union of this package's errors, for {@link isDagrVdslError}. */
export type DagrVdslErrorLike = InvalidSpecError | NodeKindMissingError | UnknownNodeKindError;

/**
 * The codes as a record rather than only as a union, so adding a code without
 * adding it here is a compile error and the runtime check cannot fall behind
 * the union it enforces.
 */
const KNOWN_CODES: Readonly<Record<DagrVdslErrorCode, true>> = {
  INVALID_SPEC: true,
  NODE_KIND_MISSING: true,
  UNKNOWN_NODE_KIND: true,
};

/** The same three codes as a set, for the membership test in the predicate. */
const KNOWN_CODE_SET: ReadonlySet<string> = new Set(Object.keys(KNOWN_CODES));

/**
 * Whether a caught value is one of this package's errors, narrowed to the
 * union rather than to the abstract base.
 *
 * The check is `instanceof DagrVdslError` AND a membership test of `code`. The
 * second half is what makes the runtime test as closed as
 * {@link DagrVdslErrorLike} claims to be: the base class is exported, so a
 * further subclass carrying a code of its own would pass the `instanceof`
 * alone and be narrowed to a union it is not a member of, at which point an
 * exhaustive-looking `switch` falls through and an arm reads a field off a
 * class that does not have one.
 */
export function isDagrVdslError(value: unknown): value is DagrVdslErrorLike {
  return value instanceof DagrVdslError && KNOWN_CODE_SET.has(value.code);
}
