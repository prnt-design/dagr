import { ExplorerDataError } from './errors.js';
import { resolveNodeSize } from './size.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Throws {@link ExplorerDataError} for a view that cannot be drawn honestly.
 *
 * Sizes are checked here rather than left to the layout engine, which accepts
 * a zero-size node and reports `NaN` as a fault in its own config. Neither
 * tells the caller which node to fix.
 *
 * Layout options are checked for the same reason: the engine rejects a bad
 * spacing with an error that names no view, the renderer throws a bare
 * `RangeError` for an unknown edge style, and an unknown direction would be
 * read as `'down'` without a word.
 *
 * A self loop and parallel edges are valid data. What happens to them is
 * `layout.ts`'s business.
 */
export function validateView<N extends ExplorerNode, E extends ExplorerEdge>(
  view: ExplorerView<N, E>,
): void {
  const where = `view "${view.id}"`;

  if (view.id === '') {
    throw new ExplorerDataError('INVALID_ID', 'A view has an empty id. Ids must not be empty', '');
  }

  const layoutOptions = view.layout;
  if (layoutOptions !== undefined) {
    for (const key of ['nodeSep', 'rankSep'] as const) {
      const value = layoutOptions[key];
      if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
        throw new ExplorerDataError(
          'INVALID_LAYOUT_OPTION',
          `View "${view.id}" has layout.${key} ${String(value)}. It must be a finite number that is zero or greater`,
          view.id,
        );
      }
    }
    const { direction, edgeStyle } = layoutOptions;
    if (direction !== undefined && direction !== 'right' && direction !== 'down') {
      throw new ExplorerDataError(
        'INVALID_LAYOUT_OPTION',
        `View "${view.id}" has layout.direction ${JSON.stringify(direction)}. It must be "right" or "down"`,
        view.id,
      );
    }
    if (edgeStyle !== undefined && edgeStyle !== 'smooth' && edgeStyle !== 'orthogonal') {
      throw new ExplorerDataError(
        'INVALID_LAYOUT_OPTION',
        `View "${view.id}" has layout.edgeStyle ${JSON.stringify(edgeStyle)}. It must be "smooth" or "orthogonal"`,
        view.id,
      );
    }
  }

  const nodeIds = new Set<string>();
  for (const node of view.nodes) {
    if (node.id === '') {
      throw new ExplorerDataError(
        'INVALID_ID',
        `A node in view "${view.id}" has an empty id. Ids must not be empty`,
        '',
        view.id,
      );
    }
    if (nodeIds.has(node.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_NODE_ID',
        `Duplicate node id "${node.id}" in ${where}`,
        node.id,
        view.id,
      );
    }
    nodeIds.add(node.id);
    const size = resolveNodeSize(view.layout, node);
    if (!positive(size.width) || !positive(size.height)) {
      throw new ExplorerDataError(
        'INVALID_NODE_SIZE',
        `Node "${node.id}" in ${where} has size ${String(size.width)} by ${String(size.height)}. Width and height must be finite and greater than zero`,
        node.id,
        view.id,
      );
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of view.edges) {
    if (edge.id === '') {
      throw new ExplorerDataError(
        'INVALID_ID',
        `An edge in view "${view.id}" has an empty id. Ids must not be empty`,
        '',
        view.id,
      );
    }
    if (edgeIds.has(edge.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_EDGE_ID',
        `Duplicate edge id "${edge.id}" in ${where}`,
        edge.id,
        view.id,
      );
    }
    edgeIds.add(edge.id);
    for (const end of [edge.source, edge.target]) {
      if (!nodeIds.has(end)) {
        throw new ExplorerDataError(
          'MISSING_EDGE_ENDPOINT',
          `Edge "${edge.id}" in ${where} names missing node "${end}"`,
          edge.id,
          view.id,
        );
      }
    }
  }

  const groupIds = new Set<string>();
  for (const group of view.groups ?? []) {
    if (group.id === '') {
      throw new ExplorerDataError(
        'INVALID_ID',
        `A group in view "${view.id}" has an empty id. Ids must not be empty`,
        '',
        view.id,
      );
    }
    if (groupIds.has(group.id)) {
      throw new ExplorerDataError(
        'DUPLICATE_GROUP_ID',
        `Duplicate group id "${group.id}" in ${where}`,
        group.id,
        view.id,
      );
    }
    groupIds.add(group.id);
    if (group.nodeIds.length === 0) {
      throw new ExplorerDataError(
        'EMPTY_GROUP',
        `Group "${group.id}" in ${where} has no nodes`,
        group.id,
        view.id,
      );
    }
    for (const id of group.nodeIds) {
      if (!nodeIds.has(id)) {
        throw new ExplorerDataError(
          'MISSING_GROUP_MEMBER',
          `Group "${group.id}" in ${where} names missing node "${id}"`,
          group.id,
          view.id,
        );
      }
    }
  }
}

/** Validates every view, and that no two share an id. Ids may repeat across views. */
export function validateViews<N extends ExplorerNode, E extends ExplorerEdge>(
  views: readonly ExplorerView<N, E>[],
): void {
  const viewIds = new Set<string>();
  for (const view of views) {
    if (viewIds.has(view.id)) {
      throw new ExplorerDataError('DUPLICATE_VIEW_ID', `Duplicate view id "${view.id}"`, view.id);
    }
    viewIds.add(view.id);
    validateView(view);
  }
}
