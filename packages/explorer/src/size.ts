import type { ExplorerLayoutOptions, ExplorerNode, Size } from './types.js';

/** The size of a node that declares none, in world pixels. */
export const DEFAULT_NODE_SIZE: Size = Object.freeze({ width: 240, height: 120 });

/**
 * A node's size: its own `size`, else the view's `nodeSize`, else the default.
 *
 * Sizes are declared and never measured, because a virtualized node has no
 * element to measure. This is the one place that order is written down, so
 * validation, layout and the shape key cannot disagree about it.
 */
export function resolveNodeSize<N extends ExplorerNode>(
  layout: ExplorerLayoutOptions<N> | undefined,
  node: N,
): Size {
  if (node.size !== undefined && node.size !== null) return node.size;
  const configured = layout?.nodeSize;
  if (configured === undefined) return DEFAULT_NODE_SIZE;
  // The `??` is for a function that returns nothing: a JavaScript caller, or a
  // branch the type checker was told not to look at.
  return (typeof configured === 'function' ? configured(node) : configured) ?? DEFAULT_NODE_SIZE;
}
