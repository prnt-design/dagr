/**
 * `ExplorerDetails`: the drawer that shows the inspected node.
 *
 * It renders nothing while closed. Open, it is an overlay at every width,
 * positioned against the nearest positioned ancestor (the viewport's stage
 * when it is `ExplorerViewport`'s child, else the root or a host's own
 * wrapper), so opening it never resizes the graph.
 *
 * The body is a keyboard scroll stop and scrolls to the top when the
 * inspected node changes. Its content is the slot's, or by default the
 * node's label and its connections as buttons, each inspecting the node at
 * the other end. Those buttons keep the drawer's original opener, so
 * `Escape` after following three edges still returns where the reader began.
 *
 * Open, it registers with the root as an obstruction, so the camera frames
 * the part of the graph it leaves uncovered. See `use-explorer-camera.ts`.
 *
 * Closing restores focus, and the root does it, because every way the drawer
 * closes (this part's `Escape` and close button, the api, the selected node
 * leaving the data) ends in the same place. See `ExplorerRoot`.
 */

import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useExplorerContext } from './context.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
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
}

export interface ExplorerDetailsProps<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge> {
  /** The drawer's content. Default: the label and the connection list. */
  readonly children?: ((context: ExplorerDetailsContext<N, E>) => ReactNode) | undefined;
  /** One connection's content in the default list. Default: the other node's label. */
  readonly renderConnection?: ((edge: E, otherNode: N) => ReactNode) | undefined;
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
  const open = node !== null;

  // Before paint, so the camera has made room for the drawer by the frame it shows in.
  useIsomorphicLayoutEffect(() => {
    const aside = asideRef.current;
    return open && aside !== null ? internals.obstructions.add(aside) : undefined;
  }, [open, internals]);

  useEffect(() => {
    if (nodeId !== null && bodyRef.current !== null) bodyRef.current.scrollTop = 0;
  }, [nodeId]);

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

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    state.closeDetails();
  };

  return (
    <aside
      ref={asideRef}
      data-dagr-explorer="details"
      aria-labelledby={titleId}
      className={className}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(360px, 100%)',
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
        <button type="button" data-dagr-explorer="details-close" onClick={() => state.closeDetails()}>
          {labels.close}
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
          children({ node, connections, inspect })
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
                  {connections.map(({ edge, node: other }) => (
                    <li key={edge.id}>
                      <button type="button" data-node-id={other.id} onClick={() => inspect(other.id)}>
                        {renderConnection === undefined ? other.label : renderConnection(edge, other)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
