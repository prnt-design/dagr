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
 *
 * **Map or outline, at any width.** A pair of pressed buttons chooses the
 * presentation. Selection, the query, trace and the drawer are the root's, so
 * they carry across a switch. The map stays mounted while the outline shows,
 * hidden, so it is out of the tab order and keeps its camera, which a zero
 * size leaves where it was (see `use-explorer-camera.ts`). The outline mounts
 * the first time it is chosen and is kept after, hidden, for its scroll and
 * tab stop. The toolbar shows only with the map, and the drawer with
 * whichever presentation shows. Focus on a switch stays where it is, unless it was in the
 * presentation that left: then it moves to the same node in the other one
 * (the outline's tab stop, the graph's tab stop node), else to the pressed
 * button.
 */

import { useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { ExplorerBase } from './base.js';
import { ExplorerDetails } from './explorer-details.js';
import type { ExplorerDetailsProps } from './explorer-details.js';
import { ExplorerOutline } from './explorer-outline.js';
import { ExplorerSearch } from './explorer-search.js';
import { ExplorerToolbar } from './explorer-toolbar.js';
import { ExplorerTraceToggle } from './explorer-trace-toggle.js';
import { ExplorerViewport } from './explorer-viewport.js';
import type { ExplorerViewportProps } from './explorer-viewport.js';
import { ExplorerViews } from './explorer-views.js';
import type { ExplorerViewsProps } from './explorer-views.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
import { resolveLabels } from './labels.js';
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
  /** Controlled presentation. */
  readonly mode?: DagrExplorerMode | undefined;
  /** The presentation to start with, read once at mount. Default: `'map'`. */
  readonly defaultMode?: DagrExplorerMode | undefined;
  readonly onModeChange?: ((mode: DagrExplorerMode) => void) | undefined;
  /** Preassembled: compose the parts to add your own. */
  readonly children?: never;
}

export type DagrExplorerMode = 'map' | 'outline';

const MODES: readonly DagrExplorerMode[] = ['map', 'outline'];
const HIDDEN: CSSProperties = { display: 'none' };
const READER: CSSProperties = { position: 'relative', height: 'var(--dagr-explorer-height, 480px)' };
const READER_LIST: CSSProperties = { height: '100%', overflowY: 'auto' };

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
    mode: modeProp,
    defaultMode = 'map',
    onModeChange,
    ...root
  } = props;
  const labels = resolveLabels(root.labels);
  const [modeState, setModeState] = useState(defaultMode);
  const mode = modeProp ?? modeState;
  const [outlineKept, setOutlineKept] = useState(mode === 'outline');
  if (mode === 'outline' && !outlineKept) setOutlineKept(true);

  const mapRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  const shown = useRef(mode);
  useIsomorphicLayoutEffect(() => {
    const was = shown.current;
    shown.current = mode;
    const from = (was === 'map' ? mapRef : outlineRef).current;
    const to = (mode === 'map' ? mapRef : outlineRef).current;
    const active = document.activeElement;
    if (was === mode || from === null || to === null || active === null || !from.contains(active)) return;
    const target =
      mode === 'map'
        ? (to.querySelector<HTMLElement>('[data-dagr-explorer="node"][tabindex="0"]') ??
          to.querySelector<HTMLElement>('[data-dagr-explorer="viewport"]'))
        : to.querySelector<HTMLElement>('[data-dagr-explorer="outline"] button[tabindex="0"]');
    (target ?? buttonsRef.current?.querySelector<HTMLElement>(`[data-mode="${mode}"]`))?.focus();
  }, [mode]);

  const choose = (next: DagrExplorerMode): void => {
    if (next === mode) return;
    if (modeProp === undefined) setModeState(next);
    onModeChange?.(next);
  };

  const details = <ExplorerDetails<N, E> renderConnection={renderConnection}>{renderDetails}</ExplorerDetails>;
  return (
    <ExplorerRoot<N, E> {...(root as ExplorerRootProps<N, E>)}>
      <ExplorerViews<N, E>>{renderViews}</ExplorerViews>
      <div ref={buttonsRef} data-dagr-explorer="mode" role="group" aria-label={labels.presentation}>
        {MODES.map((each) => (
          <button
            key={each}
            type="button"
            data-mode={each}
            aria-pressed={each === mode}
            onClick={() => choose(each)}
          >
            {each === 'map' ? labels.mapMode : labels.outlineMode}
          </button>
        ))}
      </div>
      <ExplorerSearch />
      <ExplorerTraceToggle />
      <div ref={mapRef} hidden={mode !== 'map'} style={mode === 'map' ? undefined : HIDDEN}>
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
          {mode === 'map' ? details : null}
        </ExplorerViewport>
      </div>
      {outlineKept ? (
        <div ref={outlineRef} hidden={mode !== 'outline'} style={mode === 'outline' ? READER : HIDDEN}>
          <ExplorerOutline style={READER_LIST} />
          {mode === 'outline' ? details : null}
        </div>
      ) : null}
      {mode === 'map' ? <ExplorerToolbar /> : null}
    </ExplorerRoot>
  );
}
