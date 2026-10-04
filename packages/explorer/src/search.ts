import type { ExplorerNode } from './types.js';

/** What search reads when the caller gives no accessor: the id, then the label. */
export function defaultSearchText(node: ExplorerNode): string {
  return `${node.id} ${node.label}`;
}

/**
 * The nodes whose text contains every token of the query, in data order.
 *
 * Tokens are the query split on whitespace and lowercased. They are matched as
 * text with `includes`, never compiled into a pattern, so a query of `(v2.*)`
 * finds exactly those characters and a query of `[` is not an error.
 *
 * An empty or blank query matches nothing, which is what lets the explorer
 * treat "no query" and "no dimming" as the same state.
 *
 * `searchText` is the caller's accessor over the caller's node type. Whatever
 * it returns is coerced to a string, so an accessor with a missing branch
 * costs a miss, not a crash in the middle of typing.
 */
export function searchNodes<N extends ExplorerNode>(
  nodes: readonly N[],
  query: string,
  searchText: (node: N) => string = defaultSearchText,
): N[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return [];
  return nodes.filter((node) => {
    const text = String(searchText(node) ?? '').toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
