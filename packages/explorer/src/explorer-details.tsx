/**
 * `ExplorerDetails`: the drawer that shows the inspected node.
 *
 * It renders nothing while closed. Open, it is an adaptive overlay,
 * positioned against the nearest positioned ancestor (the viewport's stage
 * when it is `ExplorerViewport`'s child, else the root or a host's own
 * wrapper), so opening it never resizes the graph. Below 720 CSS pixels
 * of available width it docks to the bottom, leaving at least half the graph
 * uncovered. This follows container space, including embedded explorers.
 *
 * The body is a keyboard scroll stop and scrolls to the top when the
 * inspected node changes. Its content is the slot's, or by default the
 * node's label and its connections as buttons, each following its edge: it
 * inspects the node at the other end and pans it into view. Those buttons
 * keep the drawer's original opener, so `Escape` after following three edges
 * still returns where the reader began.
 *
 * A default connection shows its direction as an arrow, hidden from a
 * screen reader, which hears `labels.connectionTo` or `labels.connectionFrom`
 * instead. Content from `renderConnection` replaces all of it, and is given
 * the direction to show its own.
 *
 * Open, it registers with the root as an obstruction, so the camera frames
 * the part of the graph it leaves uncovered. See `use-explorer-camera.ts`.
 *
 * Closing restores focus, and the root does it, because every way the drawer
 * closes (this part's `Escape` and close button, the api, the selected node
 * leaving the data) ends in the same place. See `ExplorerRoot`.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useExplorerContext } from './context.js';
import { CloseIcon } from './icons.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
import { VISUALLY_HIDDEN } from './root.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';

/** An edge touching the inspected node, and the node at its other end. */
export interface ExplorerConnection<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  readonly edge: E;
  /** The other end. For a self loop, the node itself. */
  readonly node: N;
}

/** What the drawer's slot receives. */
export interface ExplorerDetailsContext<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  readonly node: N;
  /** Every edge touching `node`, in data order. */
  readonly connections: readonly ExplorerConnection<N, E>[];
  /** Inspects another node, keeping the drawer's opener. */
  readonly inspect: (id: string) => void;
  /** Inspects another node, as `inspect` does, and pans the least distance that brings it into view. */
  readonly follow: (id: string) => void;
}

export interface ExplorerDetailsProps<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  /** The drawer's content. Default: the label and the connection list. */
  readonly children?: ((context: ExplorerDetailsContext<N, E>) => ReactNode) | undefined;
  /**
   * One connection's whole content in the default list. `direction` is
   * `'self'` for a self loop. Default: an arrow and the other node's label.
   */
  readonly renderConnection?: ((edge: E, otherNode: N, direction: 'to' | 'from' | 'self') => ReactNode) | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

export function ExplorerDetails<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>(
  props: ExplorerDetailsProps<N, E>,
): ReactElement | null {
  const { children, renderConnection, className, style } = props;
  const { state, internals } = useExplorerContext('ExplorerDetails');
  const { labels, activeView, detailsOpen } = state;
  // The part's type parameters are a claim about the root's data. See context.ts.
  const node = detailsOpen ? (state.selectedNode as N | null) : null;
  const nodeId = node?.id ?? null;
  const titleId = useId();
  const connectionsId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const revealedOnOpen = useRef(false);
  const open = node !== null;
  const [compact, setCompact] = useState(false);

  // Observe the containing surface, never the panel itself: changing docking
  // must not feed back into the measurement. The initial server render is
  // deterministic, and the first client measurement runs before paint.
  useIsomorphicLayoutEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (!open || parent === undefined || parent === null) return undefined;
    const measure = (): void => {
      const width = parent.getBoundingClientRect().width;
      if (width > 0) setCompact(width < 720);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [open]);

  // Before paint, so the camera has made room for the drawer by the frame it shows in.
  useIsomorphicLayoutEffect(() => {
    const aside = asideRef.current;
    return open && aside !== null ? internals.obstructions.add(aside) : undefined;
  }, [open, internals]);

  useEffect(() => {
    if (nodeId !== null && bodyRef.current !== null) bodyRef.current.scrollTop = 0;
  }, [nodeId]);

  // In a short viewport a search result can be above the entire panel.
  // Reveal an offscreen compact panel once it opens, without moving focus
  // or scrolling again when the reader follows a connection inside it.
  useEffect(() => {
    const aside = asideRef.current;
    if (!open) {
      revealedOnOpen.current = false;
      return;
    }
    if (!compact || aside === null || revealedOnOpen.current) return;
    // A prior compact placement can survive while closed. The layout effect
    // has measured a wider host, but this passive effect may still see the
    // previous render while React flushes that layout update.
    if ((aside.parentElement?.getBoundingClientRect().width ?? 0) >= 720) return;
    revealedOnOpen.current = true;
    const box = aside.getBoundingClientRect();
    const view = aside.ownerDocument.defaultView;
    if (view === null) return;
    const top = view.visualViewport?.offsetTop ?? 0;
    const bottom = top + (view.visualViewport?.height ?? view.innerHeight);
    if (box.height > 0 && (box.top >= bottom || box.bottom <= top)) {
      aside.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }, [open, compact]);

  const connections = useMemo(() => {
    if (nodeId === null || activeView === null) return [];
    const byId = new Map(activeView.nodes.map((each) => [each.id, each as N]));
    const list: ExplorerConnection<N, E>[] = [];
    for (const edge of activeView.edges as readonly E[]) {
      if (edge.source !== nodeId && edge.target !== nodeId) continue;
      const other = byId.get(edge.source === nodeId ? edge.target : edge.source);
      if (other !== undefined) list.push({ edge, node: other });
    }
    return list;
  }, [nodeId, activeView]);

  if (node === null) return null;

  // No trigger, and the drawer is open: the root keeps the opener it has.
  const inspect = (id: string): void => state.inspect(id);
  const follow = (id: string): void => {
    state.inspect(id);
    state.reveal(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    state.closeDetails();
  };

  return (
    <aside
      ref={asideRef}
      data-dagr-explorer="details"
      data-placement={compact ? 'bottom' : 'right'}
      aria-labelledby={titleId}
      className={className}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        top: compact ? 'auto' : 0,
        right: 0,
        bottom: 0,
        height: compact ? '50%' : undefined,
        maxHeight: compact ? '50dvh' : undefined,
        width: compact ? '100%' : 'min(360px, 100%)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1,
        // The stylesheet's fallback, so the drawer looks the same with or without it.
        background: 'var(--dagr-explorer-bg, #ffffff)',
        ...style,
      }}
    >
      <div
        data-dagr-explorer="details-header"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 'none' }}
      >
        <span id={titleId}>{labels.drawerTitle}</span>
        <button
          type="button"
          data-dagr-explorer="details-close"
          aria-label={labels.close}
          title={labels.close}
          style={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}
          onClick={() => state.closeDetails()}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        ref={bodyRef}
        data-dagr-explorer="details-body"
        tabIndex={0}
        // A keyboard scroll stop is announced, so it needs a name: the drawer's title.
        role="region"
        aria-labelledby={titleId}
        style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}
      >
        {children !== undefined ? (
          children({ node, connections, inspect, follow })
        ) : (
          <>
            <p data-dagr-explorer="details-label">{node.label}</p>
            {connections.length === 0 ? null : (
              <>
                <p id={connectionsId}>{labels.connections}</p>
                <ul
                  data-dagr-explorer="connections"
                  aria-labelledby={connectionsId}
                  style={{ listStyle: 'none', margin: 0, padding: 0 }}
                >
                  {connections.map(({ edge, node: other }) => {
                    const outward = edge.source === node.id;
                    const direction = outward ? (edge.target === node.id ? 'self' : 'to') : 'from';
                    return (
                      <li key={edge.id}>
                        <button type="button" style={{ minWidth: 44, minHeight: 44 }} data-node-id={other.id} onClick={() => follow(other.id)}>
                          {renderConnection !== undefined ? (
                            renderConnection(edge, other, direction)
                          ) : (
                            <>
                              <span data-dagr-explorer="connection-arrow" aria-hidden="true">
                                {direction === 'self' ? '↻' : outward ? '→' : '←'}
                              </span>{' '}
                              <span data-dagr-explorer="connection-direction" style={VISUALLY_HIDDEN}>
                                {outward ? labels.connectionTo(other.label) : labels.connectionFrom(other.label)}
                              </span>
                              <span aria-hidden="true">{other.label}</span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
