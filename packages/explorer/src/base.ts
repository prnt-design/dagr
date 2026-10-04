/**
 * The base-layer seam: what draws every node the overlay does not mount.
 *
 * The viewport renders the overlay, capped, as DOM. Everything else in view
 * (nodes as marks, edges, group outlines) is the base layer's, and the base
 * is swappable: the SVG base is the default, and a native renderer can take
 * its place for graphs past the SVG ceiling.
 *
 * `space` is the one fact the viewport needs about a base. A `'plane'` base
 * renders inside the transformed plane in world coordinates, so a camera
 * frame costs it nothing. A `'viewport'` base sits outside the plane and
 * drives its own camera.
 *
 * The spec's sketch of these props also carries a camera source, for that
 * second kind. It arrives with the first base that needs it; the SVG base
 * does not.
 *
 * Internal to the package until M5.6d decides what of it is public.
 */

import type { ComponentType } from 'react';
import type { ExplorerLayout } from './layout.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';
import type { ExplorerVisibleSet } from './visible-set.js';

export interface ExplorerEmphasis {
  readonly selectedId: string | null;
  /** Node ids drawn dimmed. Edges with a dimmed end are dimmed. */
  readonly dimmed: ReadonlySet<string>;
}

export interface ExplorerBaseProps<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly view: ExplorerView<N, E>;
  readonly layout: ExplorerLayout;
  readonly visible: ExplorerVisibleSet;
  readonly emphasis: ExplorerEmphasis;
}

export interface ExplorerBase {
  readonly Layer: ComponentType<ExplorerBaseProps<ExplorerNode, ExplorerEdge>>;
  /** 'plane': rendered inside the transformed plane. 'viewport': handles the camera itself. */
  readonly space: 'plane' | 'viewport';
}
