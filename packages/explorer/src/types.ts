import type { ReactNode } from 'react';
import type { Size } from '@prnt/dagr-render/core';

export type { Size };

/**
 * One node. `id` and `label` are all the explorer itself reads: the label is
 * the accessible name, the search result text, and the default content.
 * Everything else about a node is the caller's own fields on a type that
 * extends this one, and every slot receives that type.
 *
 * Optional fields are spelled `T | undefined` so a caller compiling with
 * `exactOptionalPropertyTypes` can pass a value it computed, including
 * `undefined`, without a conditional spread.
 */
export interface ExplorerNode {
  readonly id: string;
  readonly label: string;
  /** World size in CSS pixels at zoom 1. Declared, never measured. */
  readonly size?: Size | undefined;
  /** Any CSS color. */
  readonly color?: string | undefined;
}

export interface ExplorerEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string | undefined;
  /** Any CSS color. */
  readonly color?: string | undefined;
  /** Draw the edge dashed. */
  readonly dash?: boolean | undefined;
}

/** A labeled outline around its members. An annotation: it moves no node. */
export interface ExplorerGroup {
  readonly id: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  /** Any CSS color. */
  readonly color?: string | undefined;
}

export interface ExplorerLayoutOptions<N extends ExplorerNode = ExplorerNode> {
  /** Which way edges flow. Default `'right'`. */
  readonly direction?: 'right' | 'down' | undefined;
  /** Size for nodes with no `size` of their own. Default 240 by 120. */
  readonly nodeSize?: Size | ((node: N) => Size) | undefined;
  /** Gap between neighbors across the flow. Default 40. */
  readonly nodeSep?: number | undefined;
  /** Gap between ranks along the flow. Default 120. */
  readonly rankSep?: number | undefined;
  /** Default `'smooth'`. */
  readonly edgeStyle?: 'smooth' | 'orthogonal' | undefined;
}

export interface ExplorerView<
  N extends ExplorerNode = ExplorerNode,
  E extends ExplorerEdge = ExplorerEdge,
> {
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode | undefined;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
  readonly groups?: readonly ExplorerGroup[] | undefined;
  readonly layout?: ExplorerLayoutOptions<N> | undefined;
}
