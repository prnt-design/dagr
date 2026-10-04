/**
 * Every string the parts show or announce, in one object.
 *
 * No part writes copy of its own: a host that translates, or names things in
 * its own voice, passes `labels` to `ExplorerRoot` and replaces any subset.
 * Counts and names arrive through formatters, so a language with other plural
 * rules, or another word order, is a function and not a template.
 *
 * The defaults are neutral English and name no host framework.
 */
export interface ExplorerLabels {
  /** The search field's label. */
  readonly search: string;
  readonly searchPlaceholder: string;
  /** The accessible name of the search result list. */
  readonly searchResults: string;
  /** The live match count, shown while the query is not blank. */
  readonly matches: (count: number) => string;
  /** The line under a capped result list: how many matches it does not show. */
  readonly moreMatches: (count: number) => string;
  /** The graph's node and edge counts, part of its accessible description. */
  readonly stats: (counts: { readonly nodes: number; readonly edges: number }) => string;
  /** How to use the graph, the rest of its accessible description. */
  readonly hint: string;
  /** The accessible name of the view switcher. */
  readonly views: string;
  /** One group a node is in, as part of the node's default accessible name. */
  readonly inGroup: (groupLabel: string) => string;
  /** The trace toggle while trace is off, so pressing it turns trace on. */
  readonly traceOn: string;
  /** The trace toggle while trace is on. */
  readonly traceOff: string;
  /** The accessible name of the zoom toolbar. */
  readonly zoomControls: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  /** The zoom readout, from the zoom as a whole percent. */
  readonly zoomLevel: (percent: number) => string;
  readonly fit: string;
  /** The zoom-to-selected button, with a node selected. */
  readonly zoomTo: (label: string) => string;
  /** The zoom-to-selected button, disabled, with nothing selected. */
  readonly zoomToSelected: string;
  /** Shown in place of the graph for a view with no nodes. */
  readonly emptyView: string;
  /** Shown in place of the graph when there are no views. */
  readonly noViews: string;
  /** The drawer's title and accessible name. */
  readonly drawerTitle: string;
  /** The drawer's close button. */
  readonly close: string;
  /** The heading of the drawer's default connection list. */
  readonly connections: string;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

export const DEFAULT_EXPLORER_LABELS: ExplorerLabels = Object.freeze({
  search: 'Search nodes',
  searchPlaceholder: 'Name or id',
  searchResults: 'Search results',
  matches: (count: number) => (count === 0 ? 'No matches' : plural(count, 'match', 'matches')),
  moreMatches: (count: number) => plural(count, 'more match', 'more matches'),
  stats: ({ nodes, edges }: { readonly nodes: number; readonly edges: number }) =>
    `${plural(nodes, 'node', 'nodes')}, ${plural(edges, 'edge', 'edges')}.`,
  hint: 'Search reaches every node. Click the graph to zoom with the wheel, drag to pan, and press Escape to leave it.',
  views: 'Views',
  inGroup: (groupLabel: string) => `in ${groupLabel}`,
  traceOn: 'Trace connections',
  traceOff: 'Stop tracing',
  zoomControls: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomLevel: (percent: number) => `${String(percent)}%`,
  fit: 'Fit',
  zoomTo: (label: string) => `Zoom to ${label}`,
  zoomToSelected: 'Zoom to selection',
  emptyView: 'This view has no nodes.',
  noViews: 'Nothing to show.',
  drawerTitle: 'Details',
  close: 'Close',
  connections: 'Connections',
});

/**
 * The defaults with the caller's overrides on top. A key the caller set to
 * `undefined`, which a JavaScript caller can do, keeps its default rather
 * than rendering nothing.
 */
export function resolveLabels(overrides: Partial<ExplorerLabels> | undefined): ExplorerLabels {
  if (overrides === undefined) return DEFAULT_EXPLORER_LABELS;
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<ExplorerLabels>;
  return { ...DEFAULT_EXPLORER_LABELS, ...defined };
}

/** Whether two label objects hold the same value under every key, by `Object.is`. */
export function sameLabels(a: ExplorerLabels, b: ExplorerLabels): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is((a as unknown as Record<string, unknown>)[key], (b as unknown as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
