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
 * the first time it is chosen and is kept after, hidden, for its tab stop and
 * its scroll offset. The toolbar is hidden with the map, and the drawer goes with
 * whichever presentation shows, keeping its scroll and the control focused in
 * it; over the outline it leaves scroll room below the last item. Focus on a
 * switch stays where it is, unless it was in the presentation that left: then
 * it moves to the same node in the other one if that has a control for it,
 * else to the other's tab stop, else to the pressed button.
 */

import { Component, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode, Ref, RefObject } from 'react';
import type { ExplorerBase } from './base.js';
import { ExplorerDetails } from './explorer-details.js';
import type { ExplorerDetailsProps } from './explorer-details.js';
import { ExplorerOutline } from './explorer-outline.js';
import type { ExplorerOutlineProps } from './explorer-outline.js';
import { ExplorerSearch } from './explorer-search.js';
import { ExplorerToolbar } from './explorer-toolbar.js';
import { ExplorerTraceToggle } from './explorer-trace-toggle.js';
import { ExplorerViewport } from './explorer-viewport.js';
import type { ExplorerViewportProps } from './explorer-viewport.js';
import { ExplorerViews } from './explorer-views.js';
import type { ExplorerViewsProps } from './explorer-views.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
import { ExplorerRoot } from './root.js';
import { useExplorer } from './use-explorer.js';
import type { ExplorerRootProps } from './root.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';
import type { ExplorerTiers } from './visible-set.js';

interface DagrExplorerParts<N extends ExplorerNode, E extends ExplorerEdge> {
  /** `ExplorerViewport`'s `renderNode`. */
  readonly renderNode?: ExplorerViewportProps<N>['renderNode'];
  /** `ExplorerViewport`'s and `ExplorerOutline`'s `nodeAriaLabel`. */
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
// The wrapper adds no box, so the stage, the hint and the toolbar stay the root's flex items.
const SHOWN: CSSProperties = { display: 'contents' };
const READER: CSSProperties = { position: 'relative', height: 'var(--dagr-explorer-height, 480px)' };

function ModeButtons(props: {
  readonly groupRef: Ref<HTMLDivElement>;
  readonly mode: DagrExplorerMode;
  readonly choose: (mode: DagrExplorerMode) => void;
}): ReactElement {
  const { labels } = useExplorer();
  return (
    <div ref={props.groupRef} data-dagr-explorer="mode" role="group" aria-label={labels.presentation}>
      {MODES.map((each) => (
        <button
          key={each}
          type="button"
          data-mode={each}
          aria-pressed={each === props.mode}
          onClick={() => props.choose(each)}
        >
          {each === 'map' ? labels.mapMode : labels.outlineMode}
        </button>
      ))}
    </div>
  );
}

/**
 * The outline's scroll area. An open drawer leaves the items room to scroll clear of it when docked over the lower half.
 * A browser drops the offset of a box `display: none` removes, so the area keeps its own and puts it back when shown.
 */
function OutlineScroll<N extends ExplorerNode>(props: {
  readonly nodeAriaLabel: ExplorerOutlineProps<N>['nodeAriaLabel'];
  readonly shown: boolean;
}): ReactElement {
  const { detailsOpen } = useExplorer();
  const scrollRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  useIsomorphicLayoutEffect(() => {
    if (props.shown && scrollRef.current !== null) scrollRef.current.scrollTop = offset.current;
  }, [props.shown]);
  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        if (props.shown) offset.current = event.currentTarget.scrollTop;
      }}
      style={{ height: '100%', overflowY: 'auto', scrollPaddingBottom: detailsOpen ? '50%' : undefined }}
    >
      <ExplorerOutline<N> nodeAriaLabel={props.nodeAriaLabel} />
      {detailsOpen ? <div aria-hidden="true" style={{ height: '50%' }} /> : null}
    </div>
  );
}

interface DrawerSnapshot {
  /** `null` when the inspected node changes too: the new node's body starts at the top. */
  readonly scrollTop: number | null;
  /** The focused control's key (see `controlKey`) and its place among controls with that key, or `null`. */
  readonly focus: { readonly key: string; readonly index: number } | null;
}

const CONTROLS = '[data-node-id], [data-dagr-explorer]';

/** A connection's other node or a part name. Two connections can lead to the same node. */
function controlKey(element: HTMLElement): string {
  const node = element.dataset['nodeId'];
  return node === undefined ? `part:${element.dataset['dagrExplorer'] ?? ''}` : `node:${node}`;
}

function findDrawer(containers: readonly RefObject<HTMLDivElement | null>[]): HTMLElement | null {
  for (const container of containers) {
    const drawer = container.current?.querySelector<HTMLElement>('[data-dagr-explorer="details"]');
    if (drawer !== null && drawer !== undefined) return drawer;
  }
  return null;
}

interface DrawerCarryProps {
  readonly mode: DagrExplorerMode;
  readonly selectedId: string | null;
  readonly containers: readonly RefObject<HTMLDivElement | null>[];
  readonly children: ReactNode;
}

/**
 * Carries the drawer's scroll and focus across a switch. The drawer renders inside whichever presentation shows, so a
 * switch mounts a new one, and the old one has left the document before any effect runs. `getSnapshotBeforeUpdate` is
 * the one place that can still read it.
 */
class DrawerCarry extends Component<DrawerCarryProps> {
  override getSnapshotBeforeUpdate(previous: Readonly<DrawerCarryProps>): DrawerSnapshot | null {
    if (previous.mode === this.props.mode) return null;
    const drawer = findDrawer(this.props.containers);
    if (drawer === null) return null;
    const active = drawer.ownerDocument.activeElement;
    let focus: DrawerSnapshot['focus'] = null;
    // A control the slot leaves unnamed resolves to the body around it.
    const control = active instanceof HTMLElement && drawer.contains(active) ? active.closest<HTMLElement>(CONTROLS) : null;
    if (control !== null) {
      const key = controlKey(control);
      const same = [...drawer.querySelectorAll<HTMLElement>(CONTROLS)].filter((each) => controlKey(each) === key);
      focus = { key, index: same.indexOf(control) };
    }
    const body = drawer.querySelector('[data-dagr-explorer="details-body"]');
    return { scrollTop: previous.selectedId === this.props.selectedId ? (body?.scrollTop ?? 0) : null, focus };
  }

  override componentDidUpdate(_previous: unknown, _state: unknown, snapshot: DrawerSnapshot | null): void {
    const drawer = snapshot === null ? null : findDrawer(this.props.containers);
    if (snapshot === null || drawer === null) return;
    const body = drawer.querySelector<HTMLElement>('[data-dagr-explorer="details-body"]');
    const { scrollTop, focus } = snapshot;
    // After the new drawer's first measurement re-renders it docked below, which React flushes before a microtask
    // runs. Written now, the offset would be clamped to the taller side panel's scroll range.
    if (body !== null && scrollTop !== null) {
      queueMicrotask(() => {
        body.scrollTop = scrollTop;
      });
    }
    const active = drawer.ownerDocument.activeElement;
    if (focus === null || (active !== null && active !== drawer.ownerDocument.body)) return;
    const same = [...drawer.querySelectorAll<HTMLElement>(CONTROLS)].filter((each) => controlKey(each) === focus.key);
    (same[focus.index] ?? same[0] ?? body)?.focus({ preventScroll: true });
  }

  override render(): ReactNode {
    return this.props.children;
  }
}

function KeepDrawer(props: Omit<DrawerCarryProps, 'selectedId'>): ReactElement {
  const { selectedId } = useExplorer();
  return <DrawerCarry {...props} selectedId={selectedId} />;
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
    mode: modeProp,
    defaultMode = 'map',
    onModeChange,
    ...root
  } = props;
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
    const control = mode === 'map' ? '[data-dagr-explorer="node"]' : '[data-dagr-explorer="outline"] button';
    const id = active.closest<HTMLElement>('[data-node-id]')?.dataset['nodeId'];
    const same = [...to.querySelectorAll<HTMLElement>(control)].find((element) => element.dataset['nodeId'] === id);
    const target =
      same ??
      to.querySelector<HTMLElement>(`${control}[tabindex="0"]`) ??
      (mode === 'map' ? to.querySelector<HTMLElement>('[data-dagr-explorer="viewport"]') : null);
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
      <ModeButtons groupRef={buttonsRef} mode={mode} choose={choose} />
      <ExplorerSearch />
      <ExplorerTraceToggle />
      <KeepDrawer mode={mode} containers={[mapRef, outlineRef]}>
        <div ref={mapRef} hidden={mode !== 'map'} style={mode === 'map' ? SHOWN : HIDDEN}>
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
          <ExplorerToolbar />
        </div>
        {outlineKept ? (
          <div ref={outlineRef} hidden={mode !== 'outline'} style={mode === 'outline' ? READER : HIDDEN}>
            <OutlineScroll<N> nodeAriaLabel={nodeAriaLabel} shown={mode === 'outline'} />
            {mode === 'outline' ? details : null}
          </div>
        ) : null}
      </KeepDrawer>
    </ExplorerRoot>
  );
}
