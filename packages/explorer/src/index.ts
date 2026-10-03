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
