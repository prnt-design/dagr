/**
 * `ExplorerOutline`: the active view's nodes as a list, a second way to read
 * the same graph.
 *
 * It holds no state of its own beyond which item is the tab stop. Selection,
 * the query, trace and the drawer are the root's, so a node inspected here is
 * the one the map and the drawer show, and the reverse. Items are buttons in
 * data order, and choosing one inspects its node, recording the button as the
 * drawer's opener, so closing the drawer returns focus to it.
 *
 * **One tab stop,** like the graph: the selected node's item, else the last
 * one focused, else the first. The arrow keys, `Home` and `End` move between
 * items. A node the query or trace dims keeps its place and is marked
 * `data-dimmed`, so the reader's position does not move as they type.
 *
 * Every node has an item, so on a large view this mounts one button per
 * node. It is not virtualized.
 */

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import { useExplorerContext } from './context.js';

export interface ExplorerOutlineProps {
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

const STEP: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function ExplorerOutline(props: ExplorerOutlineProps): ReactElement {
  const { className, style } = props;
  const { state } = useExplorerContext('ExplorerOutline');
  const { labels, views, activeView, selectedId, dimmed, inspect } = state;
  const listRef = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const nodes = activeView?.nodes;
  const stop = useMemo(() => {
    if (nodes === undefined || nodes.length === 0) return null;
    if (selectedId !== null) return selectedId;
    if (focused !== null && nodes.some((node) => node.id === focused)) return focused;
    return nodes[0]?.id ?? null;
  }, [nodes, selectedId, focused]);

  const items = useMemo(
    () =>
      nodes?.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            data-node-id={node.id}
            data-selected={node.id === selectedId ? 'true' : undefined}
            data-dimmed={dimmed.has(node.id) ? 'true' : undefined}
            aria-current={node.id === selectedId ? 'true' : undefined}
            tabIndex={node.id === stop ? 0 : -1}
            style={{ minHeight: 44 }}
            onFocus={() => setFocused(node.id)}
            onClick={(event) => inspect(node.id, event.currentTarget)}
          >
            {node.label}
          </button>
        </li>
      )),
    [nodes, selectedId, dimmed, stop, inspect],
  );

  if (nodes === undefined || nodes.length === 0) {
    return (
      <p data-dagr-explorer="outline-empty" className={className} style={style}>
        {views.length === 0 ? labels.noViews : labels.emptyView}
      </p>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const step = STEP[event.key];
    const list = listRef.current;
    if (step === undefined || list === null || event.altKey || event.ctrlKey || event.metaKey) return;
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
