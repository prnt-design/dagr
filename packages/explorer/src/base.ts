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
 * drives its own camera from `camera`, which tells it of every frame in the
 * same frame the overlay moves, so the two never drift apart.
 *
 * Internal to the package until M5.6d decides what of it is public.
 */

import type { ComponentType } from 'react';
import type { ExplorerCamera } from './camera.js';
import type { ExplorerLayout } from './layout.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';
import type { ExplorerVisibleSet } from './visible-set.js';

export interface ExplorerEmphasis {
  readonly selectedId: string | null;
  /** Node ids drawn dimmed. Edges with a dimmed end are dimmed. */
  readonly dimmed: ReadonlySet<string>;
}

/** The camera on screen, and every frame of it. */
export interface ExplorerCameraSource {
  /** The camera on screen, or `null` before the first fit. */
  get(): ExplorerCamera | null;
  /**
   * Calls `listener` on each drawn frame, right after the plane's transform
   * is written. Returns the unsubscribe.
   */
  subscribe(listener: (camera: ExplorerCamera) => void): () => void;
}

export interface ExplorerBaseProps<N extends ExplorerNode, E extends ExplorerEdge> {
  /**
   * The view as given, less its layout options: `nodeSize` there is a
   * function of `N`, which a base typed over the base node cannot accept,
   * and the layout is already done.
   */
  readonly view: Omit<ExplorerView<N, E>, 'layout'>;
  readonly layout: ExplorerLayout;
  readonly visible: ExplorerVisibleSet;
  readonly emphasis: ExplorerEmphasis;
  readonly camera: ExplorerCameraSource;
}

export interface ExplorerBase {
  readonly Layer: ComponentType<ExplorerBaseProps<ExplorerNode, ExplorerEdge>>;
  /** 'plane': rendered inside the transformed plane. 'viewport': handles the camera itself. */
  readonly space: 'plane' | 'viewport';
}
