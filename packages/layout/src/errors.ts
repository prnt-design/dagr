/**
 * Errors thrown by the layout pipeline.
 *
 * Deliberately the same shape as the `@dagr/graph` error family, so a caller
 * who has learned one has learned both: every error extends
 * {@link DagrLayoutError} and can be caught with one `instanceof` check, every
 * error carries a `code` string literal for callers who would rather switch on
 * a value than on a class, and the base declares `code` abstractly so a switch
 * through a value typed as the base class stays exhaustive. Each subclass
 * restores its own prototype explicitly, so `instanceof` stays correct even
 * when the output is downlevelled below the ES2022 target.
 *
 * The two members cover the two ways a layout run can go wrong: the caller
 * handed in nonsense ({@link InvalidConfigError}), or a stage did not hold up
 * its end of the pipeline contract ({@link StageContractError}).
 */

/** The `code` of every error the layout pipeline throws. */
export type DagrLayoutErrorCode = 'INVALID_CONFIG' | 'STAGE_CONTRACT';

/**
 * Base class for every error the layout pipeline throws. Abstract on purpose,
 * for the same reason as `DagrGraphError`: a family member with no `code` would
 * defeat the point of the union, and tightening this later would break callers.
 */
export abstract class DagrLayoutError extends Error {
  /** Discriminant for switching on the error without naming its class. */
  abstract readonly code: DagrLayoutErrorCode;

  constructor(message: string) {
    super(message);
    this.name = 'DagrLayoutError';
    Object.setPrototypeOf(this, DagrLayoutError.prototype);
  }
}

/**
 * Renders a rejected config value for a message. `String` is enough for the
 * numbers this is used on (`NaN`, `Infinity`, `-1` all read fine), and the
 * `JSON.stringify` fallback keeps a rejected object such as a bad
 * `defaultNodeSize` legible instead of printing `[object Object]`.
 */
function describeValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Thrown when a separation or a size is not a finite number that is zero or
 * greater. Covers `nodeSep`, `rankSep`, `edgeSep`, `defaultNodeSize`, and every
 * size the `nodeSize` callback returns.
 *
 * Zero is allowed: a zero separation or a zero-sized node is a strange layout
 * but a well defined one. `NaN` and `Infinity` are not, because they propagate
 * silently through every later coordinate and the failure would surface as an
 * unrenderable scene rather than as a bad input.
 *
 * `field` is a path rather than a bare name, so a size rejected inside the
 * `nodeSize` callback says which node it came from: `nodeSize("n1").width`.
 */
export class InvalidConfigError extends DagrLayoutError {
  readonly code = 'INVALID_CONFIG';

  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(
      `Invalid layout config: ${field} must be a finite number that is not negative, ` +
        `received ${describeValue(value)}`,
    );
    this.name = 'InvalidConfigError';
    Object.setPrototypeOf(this, InvalidConfigError.prototype);
  }
}

/**
 * Thrown when a stage returns a result that later stages, or the caller, could
 * not work with: a node with no rank or no size, an edge that runs up the page
 * without being declared reversed, a node missing from the layers or listed
 * twice, a layer that mixes ranks or is empty, a node with no position, an edge
 * with no route, a route with fewer than two points, a result that mentions
 * something the graph does not hold, bounds that do not enclose the drawing.
 *
 * This is the payoff of swappable stages. The runner checks each stage's output
 * at that stage's own boundary, so a half-finished ranker is reported as a
 * ranker problem rather than surfacing three stages later as an edge that
 * routes to `undefined`. `stage` is the offending stage's `name` and `id` is
 * the node or edge it left behind, both also quoted in the message. A few
 * checks are about the whole result rather than one id, and those use a plain
 * label instead: `bounds`, or `layer 3`.
 */
export class StageContractError extends DagrLayoutError {
  readonly code = 'STAGE_CONTRACT';

  constructor(
    readonly stage: string,
    readonly id: string,
    readonly detail: string,
  ) {
    super(`Layout stage "${stage}" left work undone for "${id}": ${detail}`);
    this.name = 'StageContractError';
    Object.setPrototypeOf(this, StageContractError.prototype);
  }
}
