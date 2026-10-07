/**
 * The contexts the parts talk through, and the public shapes they carry.
 *
 * `ExplorerRoot` provides two. The api context holds only the stable
 * `ExplorerApi`, and its value never changes, so a component that only calls
 * methods (`useExplorerApi()`) never re-renders for a keystroke. The main
 * context holds two things:
 * the state a host may read and the methods it may call (`useExplorer()`
 * returns exactly that), and a few internals only the built-in parts use to
 * wire themselves to the root: the viewport's registration, its camera
 * controls, and the elements focus is restored to.
 *
 * **The type parameters are a claim, not a check.** A context erases them, so
 * the state is stored over the base node and edge types and each part casts
 * to the `N` and `E` it was given. See the spec's Composition section.
 */

import { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';
import type { ExplorerCameraSource } from './base.js';
import type { ExplorerCamera } from './camera.js';
import { ExplorerContextError } from './errors.js';
import type { ExplorerLabels } from './labels.js';
import type { ExplorerLayout } from './layout.js';
import type { ExplorerEdge, ExplorerNode, ExplorerView } from './types.js';
import type { ExplorerCameraControls } from './use-explorer-camera.js';

/**
 * Everything a host can do to an explorer. `ExplorerRoot`'s `apiRef` and
 * `useExplorer()` hand out the same functions, stable for the root's life.
 *
 * Under a controlled `viewId` or `selectedId`, a method that would change it
 * calls `onViewChange` or `onSelectedChange` and changes nothing on screen
 * until the prop does. An id the active view lacks is ignored.
 */
export interface ExplorerApi {
  /** Fits the whole view. A no-op before a viewport has a size. */
  fit(): void;
  /** Zooms about the viewport center. */
  zoomBy(factor: number): void;
  /** Flies the camera to fit the node. */
  focusNode(id: string): void;
  /** Pans the least distance that brings the node into view, at the current zoom. */
  reveal(id: string): void;
  /**
   * Gives the graph keyboard focus, so the wheel and the camera keys apply
   * at once. A no-op before a viewport exists, or while focus is already in
   * the graph.
   */
  focusViewport(): void;
  /** Sets the current node, or clears it. Does not open the drawer. */
  select(id: string | null): void;
  /**
   * Selects the node and opens the drawer on it. `trigger` is the element
   * focus returns to when the drawer closes. Without one, the element that
   * has focus is recorded, unless the drawer is already open, in which case
   * the opener it has is kept: that is how a connection in the drawer
   * inspects its neighbor and `Escape` still returns to the first opener.
   */
  inspect(id: string, trigger?: HTMLElement | null): void;
  closeDetails(): void;
  /** Switches view. Resets the query, trace, drawer and camera. */
  selectView(id: string): void;
  setQuery(query: string): void;
  setTrace(on: boolean): void;
}

/** What `useExplorer()` returns: the explorer's current state, and its methods. */
export interface ExplorerState<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>
  extends ExplorerApi {
  /** The root's `label`, the accessible name the parts derive theirs from. */
  readonly label: string;
  readonly labels: ExplorerLabels;
  readonly views: readonly ExplorerView<N, E>[];
  /** `null` only when there are no views. */
  readonly activeView: ExplorerView<N, E> | null;
  /** The active view, placed. `null` only when there are no views. */
  readonly layout: ExplorerLayout | null;
  /** The current node, or `null`. Never an id the active view lacks. */
  readonly selectedId: string | null;
  readonly selectedNode: N | null;
  readonly query: string;
  /** The nodes the query matches, in data order. Empty for a blank query. */
  readonly matches: readonly N[];
  readonly trace: boolean;
  /** Whether the drawer is showing the selected node. */
  readonly detailsOpen: boolean;
  /** Node ids drawn dimmed: by the query, by trace, or by both. */
  readonly dimmed: ReadonlySet<string>;
  /** The camera on screen and every frame of it, for a host's own zoom readout. */
  readonly camera: ExplorerCameraSource;
}

/**
 * The camera source the root hands out before and after a viewport exists:
 * it forwards to whichever viewport is attached, and stays the same object
 * across a view switch, which remounts the viewport.
 */
export interface CameraHub extends ExplorerCameraSource {
  /** Attaches a viewport's source. Returns the detach. */
  attach(source: ExplorerCameraSource): () => void;
}

export function createCameraHub(): CameraHub {
  let attached: ExplorerCameraSource | null = null;
  const listeners = new Set<(camera: ExplorerCamera) => void>();
  const emit = (camera: ExplorerCamera): void => {
    for (const listener of [...listeners]) listener(camera);
  };
  return {
    get: () => attached?.get() ?? null,
    subscribe(listener) {
      // Wrapped, so one listener subscribed twice is two subscriptions.
      const own = (camera: ExplorerCamera): void => listener(camera);
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
    attach(source) {
      attached = source;
      const off = source.subscribe(emit);
      // The viewport drew its first frame before it could be attached, so a
      // readout that subscribed early would otherwise wait for the next one.
      const now = source.get();
      if (now !== null) emit(now);
      return () => {
        off();
        if (attached === source) attached = null;
      };
    },
  };
}

/** What only the built-in parts use. Stable for the root's life. */
export interface ExplorerInternals {
  /** Called from the viewport's effect. Throws `SECOND_VIEWPORT` for a second. */
  registerViewport(): () => void;
  readonly controlsRef: MutableRefObject<ExplorerCameraControls | null>;
  readonly camera: CameraHub;
  /** Where focus goes when the drawer closes and its opener is gone. */
  readonly searchInputRef: MutableRefObject<HTMLInputElement | null>;
}

export interface ExplorerContextValue {
  readonly state: ExplorerState;
  readonly internals: ExplorerInternals;
}

export const ExplorerContext = createContext<ExplorerContextValue | null>(null);

/** The root's context, or `OUTSIDE_EXPLORER` naming `part`. */
export function useExplorerContext(part: string): ExplorerContextValue {
  const value = useContext(ExplorerContext);
  if (value === null) {
    throw new ExplorerContextError(
      'OUTSIDE_EXPLORER',
      `${part} must be used inside an ExplorerRoot`,
    );
  }
  return value;
}

/** The root's stable methods alone. Its value is the same object for the root's life. */
export const ExplorerApiContext = createContext<ExplorerApi | null>(null);

/** The root's stable methods, or `OUTSIDE_EXPLORER` naming `part`. */
export function useExplorerApiContext(part: string): ExplorerApi {
  const value = useContext(ExplorerApiContext);
  if (value === null) {
    throw new ExplorerContextError('OUTSIDE_EXPLORER', `${part} must be used inside an ExplorerRoot`);
  }
  return value;
}
