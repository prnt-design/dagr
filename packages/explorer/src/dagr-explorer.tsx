/**
 * `DagrExplorer`: the explorer, preassembled.
 *
 * It is composed only from the public parts, with no private access, so
 * anything it does a host can do by composing the parts itself. Its props are
 * the root's, plus the parts' slots and options under the names below.
 *
 * `N` and `E` are inferred from `views` (or `nodes` and `edges`), and every
 * slot is typed from them. That is the check hand-composed parts cannot
 * give, because they talk through a context.
 */

import type { ReactElement } from 'react';
import type { ExplorerBase } from './base.js';
import { ExplorerDetails } from './explorer-details.js';
import type { ExplorerDetailsProps } from './explorer-details.js';
import { ExplorerSearch } from './explorer-search.js';
import { ExplorerToolbar } from './explorer-toolbar.js';
import { ExplorerTraceToggle } from './explorer-trace-toggle.js';
import { ExplorerViewport } from './explorer-viewport.js';
import type { ExplorerViewportProps } from './explorer-viewport.js';
import { ExplorerViews } from './explorer-views.js';
import type { ExplorerViewsProps } from './explorer-views.js';
import { ExplorerRoot } from './root.js';
import type { ExplorerRootProps } from './root.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';
import type { ExplorerTiers } from './visible-set.js';

interface DagrExplorerParts<N extends ExplorerNode, E extends ExplorerEdge> {
  /** `ExplorerViewport`'s `renderNode`. */
  readonly renderNode?: ExplorerViewportProps<N>['renderNode'];
  /** `ExplorerViewport`'s `nodeAriaLabel`. */
  readonly nodeAriaLabel?: ExplorerViewportProps<N>['nodeAriaLabel'];
  readonly tiers?: ExplorerTiers | undefined;
  readonly maxOverlayNodes?: number | undefined;
  /** Experimental. See `ExplorerBase`. */
  readonly base?: ExplorerBase | undefined;
  /** `ExplorerViewport`'s `inset`. */
  readonly inset?: ExplorerViewportProps<N>['inset'];
  /** `ExplorerViewport`'s `contentPadding`. */
  readonly contentPadding?: ExplorerViewportProps<N>['contentPadding'];
  /** `ExplorerDetails`'s children. */
  readonly renderDetails?: ExplorerDetailsProps<N, E>['children'];
  /** `ExplorerDetails`'s `renderConnection`. */
  readonly renderConnection?: ExplorerDetailsProps<N, E>['renderConnection'];
  /** `ExplorerViews`'s children. */
  readonly renderViews?: ExplorerViewsProps<N, E>['children'];
  /** Preassembled: compose the parts to add your own. */
  readonly children?: never;
}

export type DagrExplorerProps<
  N extends ExplorerNode = ExplorerNode,
  E extends ExplorerEdge = ExplorerEdge,
> = ExplorerRootProps<N, E> & DagrExplorerParts<N, E>;

export function DagrExplorer<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>(
  props: DagrExplorerProps<N, E>,
): ReactElement {
  const {
    renderNode,
    nodeAriaLabel,
    tiers,
    maxOverlayNodes,
    base,
    inset,
    contentPadding,
    renderDetails,
    renderConnection,
    renderViews,
    ...root
  } = props;
  return (
    <ExplorerRoot<N, E> {...(root as ExplorerRootProps<N, E>)}>
      <ExplorerViews<N, E>>{renderViews}</ExplorerViews>
      <ExplorerSearch />
      <ExplorerTraceToggle />
      {/* The drawer in the viewport's stage overlays the graph, not the whole explorer or the hint. */}
      <ExplorerViewport<N, E>
        renderNode={renderNode}
        nodeAriaLabel={nodeAriaLabel}
        tiers={tiers}
        maxOverlayNodes={maxOverlayNodes}
        base={base}
        inset={inset}
        contentPadding={contentPadding}
      >
        <ExplorerDetails<N, E> renderConnection={renderConnection}>{renderDetails}</ExplorerDetails>
      </ExplorerViewport>
      <ExplorerToolbar />
    </ExplorerRoot>
  );
}
