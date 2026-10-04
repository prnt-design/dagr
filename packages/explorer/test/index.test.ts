import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  DagrExplorerProps,
  ExplorerApi,
  ExplorerBase,
  ExplorerBaseProps,
  ExplorerCameraSource,
  ExplorerConnection,
  ExplorerContextErrorCode,
  ExplorerDetailsContext,
  ExplorerDetailsProps,
  ExplorerEdge,
  ExplorerEmphasis,
  ExplorerLabels,
  ExplorerNode,
  ExplorerRootProps,
  ExplorerSearchProps,
  ExplorerState,
  ExplorerTier,
  ExplorerTiers,
  ExplorerToolbarProps,
  ExplorerTraceToggleProps,
  ExplorerViewportProps,
  ExplorerViewsContext,
  ExplorerViewsProps,
} from '../src/index.js';

/**
 * What the package exports at runtime, pinned as a list. A surface test: it
 * catches a name added or dropped without anybody deciding to. Types are
 * erased, so the other test files exercise those by importing them, and the
 * import above fails the typecheck if one of the public types goes missing.
 */
describe('@prnt/dagr-explorer', () => {
  it('exports exactly this runtime surface', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'DEFAULT_EXPLORER_LABELS',
        'DEFAULT_NODE_SEP',
        'DEFAULT_NODE_SIZE',
        'DEFAULT_RANK_SEP',
        'DagrExplorer',
        'ExplorerContextError',
        'ExplorerDataError',
        'ExplorerDetails',
        'ExplorerRoot',
        'ExplorerSearch',
        'ExplorerToolbar',
        'ExplorerTraceToggle',
        'ExplorerViewport',
        'ExplorerViews',
        'defaultSearchText',
        'layoutView',
        'resolveNodeSize',
        'searchNodes',
        'useExplorer',
        'validateView',
        'validateViews',
      ].sort(),
    );
  });

  it('exports the public types', () => {
    type Exported = [
      DagrExplorerProps,
      ExplorerApi,
      ExplorerBase,
      ExplorerBaseProps<ExplorerNode, ExplorerEdge>,
      ExplorerCameraSource,
      ExplorerConnection,
      ExplorerContextErrorCode,
      ExplorerDetailsContext,
      ExplorerDetailsProps,
      ExplorerEmphasis,
      ExplorerLabels,
      ExplorerRootProps,
      ExplorerSearchProps,
      ExplorerState,
      ExplorerTier,
      ExplorerTiers,
      ExplorerToolbarProps,
      ExplorerTraceToggleProps,
      ExplorerViewportProps,
      ExplorerViewsContext,
      ExplorerViewsProps,
    ];
    const count: Exported['length'] = 21;
    expect(count).toBe(21);
  });
});
