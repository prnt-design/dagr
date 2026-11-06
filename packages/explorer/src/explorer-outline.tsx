/**
 * `ExplorerOutline`: the active view's nodes as a list, a second way to read
 * the same graph.
 *
 * It holds no state of its own beyond which item is the tab stop. Selection,
 * the query, trace and the drawer are the root's, so a node inspected here is
 * the one the map and the drawer show, and the reverse. Items are buttons in
 * data order, and choosing one inspects its node, recording the button as the
 * drawer's opener, so closing the drawer returns focus to it. Once the drawer
 * has mounted, a map beside the outline pans the least distance that brings
 * the node into view, and the item scrolls clear of a drawer docked over the
 * list.
 *
 * **One tab stop:** the selected node's item, else the last one focused,
 * else the first. The arrow keys, `Home` and `End` move between items. A
 * node the query or trace dims keeps its place and is marked `data-dimmed`,
 * so the reader's position does not move as they type.
 *
 * Items are named by `nodeAriaLabel`, as the viewport names its nodes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import { useExplorerContext } from './context.js';
import { defaultNodeName, groupsByNode } from './node-name.js';
import type { ExplorerGroup, ExplorerNode } from './types.js';

const NO_GROUPS: readonly ExplorerGroup[] = [];

export interface ExplorerOutlineProps<N extends ExplorerNode = ExplorerNode> {
  /** An item's accessible name. Default: its label, then `labels.inGroup(group)` for each group. */
  readonly nodeAriaLabel?:
    | ((node: N, context: { readonly groups: readonly ExplorerGroup[] }) => string)
    | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

const STEP: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function ExplorerOutline<N extends ExplorerNode = ExplorerNode>(props: ExplorerOutlineProps<N>): ReactElement {
  const { nodeAriaLabel, className, style } = props;
  const { state } = useExplorerContext('ExplorerOutline');
  const { labels, views, activeView, selectedId, detailsOpen, dimmed, inspect, reveal } = state;
  const listRef = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ id: string } | null>(null);

  const reading = useRef({ detailsOpen, selectedId });
  reading.current = { detailsOpen, selectedId };

  // After the drawer's commit, so the pan uses the space it leaves. See ExplorerSearch.
  useEffect(() => {
    if (revealRequest === null) return undefined;
    const frame = requestAnimationFrame(() => {
      const current = reading.current;
      if (current.detailsOpen && current.selectedId === revealRequest.id) {
        reveal(revealRequest.id);
        // Clear of a drawer docked over the list, where its scroll container leaves room for one.
        const chosen = [...(listRef.current?.querySelectorAll<HTMLElement>(':scope > li > button') ?? [])].find(
          (button) => button.dataset['nodeId'] === revealRequest.id,
        );
        if (typeof chosen?.scrollIntoView === 'function') chosen.scrollIntoView({ block: 'nearest' });
      }
      setRevealRequest(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealRequest, reveal]);

  // The part's type parameter is a claim about the root's data. See context.ts.
  const nodes = activeView?.nodes as readonly N[] | undefined;
  const viewGroups = activeView?.groups;
  const groupsOf = useMemo(() => groupsByNode(viewGroups), [viewGroups]);
  const stop = useMemo(() => {
    if (nodes === undefined || nodes.length === 0) return null;
    if (selectedId !== null) return selectedId;
    if (focused !== null && nodes.some((node) => node.id === focused)) return focused;
    return nodes[0]?.id ?? null;
  }, [nodes, selectedId, focused]);

  const items = useMemo(
    () =>
      nodes?.map((node) => {
        const groups = groupsOf.get(node.id) ?? NO_GROUPS;
        return (
          <li key={node.id}>
            <button
              type="button"
              data-node-id={node.id}
              data-selected={node.id === selectedId ? 'true' : undefined}
              data-dimmed={dimmed.has(node.id) ? 'true' : undefined}
              aria-current={node.id === selectedId ? 'true' : undefined}
              aria-label={
                nodeAriaLabel === undefined ? defaultNodeName(node, groups, labels.inGroup) : nodeAriaLabel(node, { groups })
              }
              tabIndex={node.id === stop ? 0 : -1}
              style={{ minHeight: 44 }}
              onFocus={() => setFocused(node.id)}
              onClick={(event) => {
                inspect(node.id, event.currentTarget);
                setRevealRequest({ id: node.id });
              }}
            >
              {node.label}
            </button>
          </li>
        );
      }),
    [nodes, groupsOf, labels.inGroup, nodeAriaLabel, selectedId, dimmed, stop, inspect],
  );

  if (nodes === undefined || nodes.length === 0) {
    return (
      <p data-dagr-explorer="outline" data-empty="true" className={className} style={style}>
        {views.length === 0 ? labels.noViews : labels.emptyView}
      </p>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const step = STEP[event.key];
    const list = listRef.current;
    if (step === undefined || list === null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>(':scope > li > button')];
    const at = buttons.findIndex((button) => button === event.target);
    if (at < 0) return;
    event.preventDefault();
    buttons[step(at, buttons.length - 1)]?.focus();
  };

  return (
    <ul
      ref={listRef}
      data-dagr-explorer="outline"
      aria-label={labels.outline}
      className={className}
      style={{ listStyle: 'none', margin: 0, padding: 0, ...style }}
      onKeyDown={onKeyDown}
    >
      {items}
    </ul>
  );
}
