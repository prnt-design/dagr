/**
 * `ExplorerSearch`: a labeled field, a live match count, and the matches as
 * a list of buttons.
 *
 * Search is the complete way to every node. A virtualized node has no
 * element, so the graph alone cannot reach it by keyboard or screen reader,
 * and search can: every match is counted, and `Enter` reaches the first.
 *
 * **The list is capped,** at `maxResults` (default 50), in data order, with
 * a plain line from `labels.moreMatches` for the rest, so a short query on a
 * large graph does not mount thousands of buttons. A longer query narrows
 * it. The list is memoized on the matches, which the root keeps by identity
 * while the same nodes match.
 *
 * `Enter` inspects the first match and flies the camera to it, and choosing
 * a result does the same for that result. The list stays mounted while a
 * node is inspected, so its scroll position survives.
 *
 * `Escape` in the field closes the drawer if it is open, and only then
 * clears the query, so a reader who opened a result from here can close it
 * without losing the list.
 */

import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import { useExplorerContext } from './context.js';

/** How many results the list shows before it says how many more there are. */
const DEFAULT_MAX_RESULTS = 50;

export interface ExplorerSearchProps {
  /** The most results listed, in data order. Default 50. The count and `Enter` cover every match. */
  readonly maxResults?: number | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

export function ExplorerSearch(props: ExplorerSearchProps): ReactElement {
  const { state, internals } = useExplorerContext('ExplorerSearch');
  const { labels, query, matches, detailsOpen, selectedId, inspect, focusNode } = state;
  const { maxResults } = props;
  const cap =
    maxResults !== undefined && Number.isFinite(maxResults) && maxResults >= 0
      ? Math.floor(maxResults)
      : DEFAULT_MAX_RESULTS;
  const inputId = useId();
  const countId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The field is where focus goes when the drawer closes and its opener is gone.
  useEffect(() => {
    const field = inputRef.current;
    internals.searchInputRef.current = field;
    return () => {
      if (internals.searchInputRef.current === field) internals.searchInputRef.current = null;
    };
  }, [internals]);

  const blank = query.trim() === '';

  // `inspect` and `focusNode` are the root's stable methods.
  const pick = (id: string, trigger: HTMLElement): void => {
    inspect(id, trigger);
    focusNode(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      const first = matches[0];
      if (first === undefined) return;
      event.preventDefault();
      pick(first.id, event.currentTarget);
    } else if (event.key === 'Escape') {
      if (detailsOpen) state.closeDetails();
      else if (query !== '') state.setQuery('');
      else return;
      // A search field clears itself on Escape in some browsers, which would
      // skip the drawer's turn.
      event.preventDefault();
    }
  };

  const { searchResults, moreMatches } = labels;
  const list = useMemo(() => {
    if (matches.length === 0) return null;
    const shown = cap < matches.length ? matches.slice(0, cap) : matches;
    const more = matches.length - shown.length;
    return (
      <>
        {shown.length === 0 ? null : (
          <ul
            data-dagr-explorer="search-results"
            aria-label={searchResults}
            style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}
          >
            {shown.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  data-node-id={node.id}
                  data-selected={node.id === selectedId ? 'true' : undefined}
                  onClick={(event) => {
                    inspect(node.id, event.currentTarget);
                    focusNode(node.id);
                  }}
                >
                  {node.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {more === 0 ? null : <p data-dagr-explorer="search-more">{moreMatches(more)}</p>}
      </>
    );
  }, [matches, cap, selectedId, searchResults, moreMatches, inspect, focusNode]);

  return (
    <div data-dagr-explorer="search" role="search" className={props.className} style={props.style}>
      <label htmlFor={inputId}>{labels.search}</label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={query}
        placeholder={labels.searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={countId}
        onChange={(event) => state.setQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <p id={countId} data-dagr-explorer="search-count" aria-live="polite">
        {blank ? '' : labels.matches(matches.length)}
      </p>
      {list}
    </div>
  );
}
