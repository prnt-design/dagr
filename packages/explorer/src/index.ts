/**
 * `@prnt/dagr-explorer`: an interactive graph explorer.
 *
 * As of M5.6b this entry is the headless core only: the data model, its
 * validation, layout into world coordinates, and search. The React parts
 * arrive in M5.6c to M5.6e. Nothing exported here touches the DOM or imports
 * React at runtime.
 *
 * From `@prnt/dagr-render` this package imports only the `core` entry, which
 * never loads three.js. `test/imports.test.ts` holds that.
 */

export { ExplorerDataError } from './errors.js';
export type { DagrExplorerErrorCode } from './errors.js';
// `layoutKey` and the fixed spacing constants stay internal on purpose. A
// public constant cannot change value, or become an option, without a break.
export { DEFAULT_NODE_SEP, DEFAULT_RANK_SEP, layoutView } from './layout.js';
export type {
  ExplorerBox,
  ExplorerGroupBox,
  ExplorerLayout,
  LayoutViewOptions,
} from './layout.js';
export { DEFAULT_NODE_SIZE, resolveNodeSize } from './size.js';
export { validateView, validateViews } from './validate.js';
export type {
  ExplorerEdge,
  ExplorerGroup,
  ExplorerLayoutOptions,
  ExplorerNode,
  ExplorerView,
  Size,
} from './types.js';
export type { Vec2 } from '@prnt/dagr-render/core';
