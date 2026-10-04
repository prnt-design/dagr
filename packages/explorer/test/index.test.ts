import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import type {
  DagrExplorerProps,
  ExplorerApi,
  ExplorerBase,
  ExplorerBaseProps,
  ExplorerCamera,
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
  ExplorerVisibleSet,
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
        'useExplorerApi',
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
      ExplorerCamera,
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
      ExplorerVisibleSet,
    ];
    const count: Exported['length'] = 23;
    expect(count).toBe(23);
  });

  it('exports the camera and the visible set as the shapes the public api hands out', () => {
    const camera: ExplorerCamera = { x: 1, y: 2, scale: 0.5 };
    const visible: ExplorerVisibleSet = { overlay: new Map([['a', 'rich']]), baseNodes: ['b'], edges: ['ab'] };
    // What `ExplorerCameraSource.get` returns, and what a base layer is given.
    const read: ExplorerCameraSource['get'] = () => camera;
    const given: ExplorerBaseProps<ExplorerNode, ExplorerEdge>['visible'] = visible;
    expect([read(), given]).toEqual([camera, visible]);
  });
});
