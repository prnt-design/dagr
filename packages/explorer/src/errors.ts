/**
 * Errors thrown by `@prnt/dagr-explorer` for data it cannot draw honestly.
 *
 * One class with a `code`, because a caller switches on the code and never on
 * the class: the failures are all "this view is malformed", and they differ
 * only in how. Codes are UPPER_SNAKE and the type is named for the package, as
 * in every sibling.
 *
 * **The offender is a field, not only a phrase in the message.** A host that
 * wants to highlight the bad node, or list the errors of one view, reads `id`
 * and `viewId` and never parses prose. What `id` names depends on the code:
 *
 * - `DUPLICATE_VIEW_ID`: the view. `viewId` is `undefined`.
 * - `INVALID_LAYOUT_OPTION`: the view. `viewId` is `undefined`.
 * - `DUPLICATE_NODE_ID`, `INVALID_NODE_SIZE`: the node.
 * - `DUPLICATE_EDGE_ID`, `MISSING_EDGE_ENDPOINT`: the edge.
 * - `DUPLICATE_GROUP_ID`, `EMPTY_GROUP`, `MISSING_GROUP_MEMBER`,
 *   `GROUP_ENCLOSES_NON_MEMBER`: the group.
 *
 * The message still names every id involved, including the second one a
 * missing endpoint or an enclosed node adds, so a log line is enough to fix it.
 *
 * The prototype is restored explicitly, as every sibling package does, so
 * `instanceof` stays correct when the output is downlevelled below ES2022.
 */

/** The `code` of every data error this package throws. */
export type DagrExplorerErrorCode =
  | 'DUPLICATE_VIEW_ID'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'DUPLICATE_GROUP_ID'
  | 'INVALID_NODE_SIZE'
  | 'INVALID_LAYOUT_OPTION'
  | 'MISSING_EDGE_ENDPOINT'
  | 'MISSING_GROUP_MEMBER'
  | 'EMPTY_GROUP'
  | 'GROUP_ENCLOSES_NON_MEMBER';

export class ExplorerDataError extends Error {
  readonly code: DagrExplorerErrorCode;

  /** The view, node, edge or group the error is about. See the table above. */
  readonly id: string;

  /** The view it was found in. `undefined` when the error is about a view. */
  readonly viewId: string | undefined;

  constructor(code: DagrExplorerErrorCode, message: string, id: string, viewId?: string) {
    super(message);
    this.name = 'ExplorerDataError';
    this.code = code;
    this.id = id;
    this.viewId = viewId;
    Object.setPrototypeOf(this, ExplorerDataError.prototype);
  }
}
