/**
 * Stable, machine-readable reasons a layout run can be rejected.
 *
 * Codes are part of the public API: match on `error.code`, never on the
 * message text, which is written for humans and may be reworded.
 */
export type LayoutErrorCode =
  /** Two input nodes share the same `id`. */
  | 'DUPLICATE_NODE_ID'
  /** Two input edges share the same `id`. */
  | 'DUPLICATE_EDGE_ID'
  /** A node `id` is the empty string. */
  | 'EMPTY_NODE_ID'
  /** A node `width` or `height` is negative, `NaN`, or infinite. */
  | 'INVALID_NODE_SIZE'
  /** An edge `source` does not name any input node. */
  | 'UNKNOWN_EDGE_SOURCE'
  /** An edge `target` does not name any input node. */
  | 'UNKNOWN_EDGE_TARGET'
  /** `rankDir` is not one of `TB`, `BT`, `LR`, `RL`. */
  | 'INVALID_RANK_DIR'
  /** `rankSpacing` or `nodeSpacing` is negative, `NaN`, or infinite. */
  | 'INVALID_SPACING'
  /** `marginX` or `marginY` is negative, `NaN`, or infinite. */
  | 'INVALID_MARGIN';

/**
 * The only error type `@dagr/layout` throws for invalid input or config.
 *
 * Carries a {@link LayoutErrorCode} so callers can branch on the cause
 * without parsing the message.
 */
export class LayoutError extends Error {
  /** Stable machine-readable cause. */
  readonly code: LayoutErrorCode;

  constructor(code: LayoutErrorCode, message: string) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
  }
}
