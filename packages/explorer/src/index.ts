/**
 * `@prnt/dagr-explorer`: an interactive graph explorer.
 *
 * Two ways in, from one implementation: `DagrExplorer`, preassembled, and
 * the named parts it is built from (`ExplorerRoot`, `ExplorerViewport`,
 * `ExplorerSearch` and the rest) with `useExplorer()`, for a host that owns
 * the layout. Beside them, the headless core: the data model, validation,
 * layout into world coordinates, and search, none of which touches the DOM.
 *
 * The optional stylesheet is its own entry, `@prnt/dagr-explorer/styles.css`.
 * Nothing here imports it.
 *
 * From `@prnt/dagr-render` this package imports only the `core` entry, which
 * never loads three.js. `test/imports.test.ts` holds that.
 */

export { DagrExplorer } from './dagr-explorer.js';
export type { DagrExplorerProps } from './dagr-explorer.js';
export { ExplorerRoot } from './root.js';
export type { ExplorerRootProps } from './root.js';
export { ExplorerViews } from './explorer-views.js';
export type { ExplorerViewsContext, ExplorerViewsProps } from './explorer-views.js';
export { ExplorerSearch } from './explorer-search.js';
export type { ExplorerSearchProps } from './explorer-search.js';
export { ExplorerViewport } from './explorer-viewport.js';
export type { ExplorerViewportProps } from './explorer-viewport.js';
export { ExplorerDetails } from './explorer-details.js';
export type {
  ExplorerConnection,
  ExplorerDetailsContext,
  ExplorerDetailsProps,
} from './explorer-details.js';
export { ExplorerToolbar } from './explorer-toolbar.js';
export type { ExplorerToolbarProps } from './explorer-toolbar.js';
export { ExplorerTraceToggle } from './explorer-trace-toggle.js';
export type { ExplorerTraceToggleProps } from './explorer-trace-toggle.js';
export { useExplorer } from './use-explorer.js';
export type { ExplorerApi, ExplorerState } from './context.js';
export { DEFAULT_EXPLORER_LABELS } from './labels.js';
export type { ExplorerLabels } from './labels.js';
// The base-layer seam is experimental until a native base confirms it.
export type {
  ExplorerBase,
  ExplorerBaseProps,
  ExplorerCameraSource,
  ExplorerEmphasis,
} from './base.js';
// Only the tier types. The camera arithmetic and the visible set stay
// internal: their shapes are the viewport's business.
export type { ExplorerTier, ExplorerTiers } from './visible-set.js';

export { ExplorerContextError, ExplorerDataError } from './errors.js';
export type { DagrExplorerErrorCode, ExplorerContextErrorCode } from './errors.js';
// `layoutKey` and the fixed spacing constants stay internal on purpose. A
// public constant cannot change value, or become an option, without a break.
export { DEFAULT_NODE_SEP, DEFAULT_RANK_SEP, layoutView } from './layout.js';
export type {
  ExplorerBox,
  ExplorerLayout,
  LayoutViewOptions,
} from './layout.js';
export { defaultSearchText, searchNodes } from './search.js';
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
