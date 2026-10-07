/**
 * `ExplorerRoot`: the data, its validation and layout, and the state every
 * part reads.
 *
 * **Controllable, and never past the owner.** `viewId` and `selectedId` are
 * controllable because they are what a host syncs to a URL. Under a
 * controlled value, every change that starts inside the explorer (a click, a
 * search pick, an `ExplorerApi` call, a view switch reselecting, the selected
 * node leaving the data, the active view being removed) calls the callback
 * and changes nothing on screen until the prop does. A controlled value the
 * data lacks renders as its fallback, with no corrective callback: a
 * callback fired to fix the owner's own prop is how update loops start.
 *
 * **Changes the explorer makes on its own are found after commit,** in a
 * layout effect, not in render: they call the owner's callbacks, which must
 * not run during render. A layout effect re-renders before paint, so the
 * stale frame is never seen.
 *
 * **Closing the drawer restores focus here,** whichever way it closed: to
 * the element that opened it, else to the search field, else to the root
 * element itself, never to the page. Only when focus was lost with the
 * drawer (it was inside it, or on a node that left the data), so a host
 * control that closes the drawer keeps its focus. `Escape` anywhere in the
 * root closes the drawer, except where a part has its own precedence (the
 * search field, the drawer) or a host control handled the key. On a node or
 * the graph's surface it closes the drawer and nothing else, so focus stays
 * where it is and a second `Escape` leaves the graph. It is taken in the
 * capture phase for that, before the camera's own `Escape` would blur the
 * graph and drop focus to the page.
 *
 * **Validation and layout run in render,** so a data error reaches an error
 * boundary. Every view is validated; only the active one is laid out, and
 * its layout is memoized by shape, so data re-created on every render keeps
 * its layout and its camera.
 */

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, Ref } from 'react';
import { ExplorerApiContext, ExplorerContext, createCameraHub, createObstructions } from './context.js';
import type { ExplorerApi, ExplorerContextValue, ExplorerInternals, ExplorerState } from './context.js';
import { ExplorerContextError } from './errors.js';
import { useIsomorphicLayoutEffect } from './isomorphic-layout-effect.js';
import { resolveLabels, sameLabels } from './labels.js';
import type { ExplorerLabels } from './labels.js';
import { layoutKey, layoutView } from './layout.js';
import type { ExplorerLayout } from './layout.js';
import { defaultSearchText, searchNodes } from './search.js';
import type {
  ExplorerEdge,
  ExplorerGroup,
  ExplorerLayoutOptions,
  ExplorerNode,
  ExplorerView,
} from './types.js';
import type { ExplorerCameraControls } from './use-explorer-camera.js';
import { validateViews } from './validate.js';

/** The id of the one view the `nodes` and `edges` shorthand makes. */
const DEFAULT_VIEW_ID = 'default';
const NOTHING: ReadonlySet<string> = new Set();

/** Hidden from sight and not from a screen reader. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * `value`, or the one this hook returned last render if `same` says they are
 * equal, so a value re-created with the same contents keeps its identity.
 */
function useSame<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);
  if (!same(kept.current, value)) kept.current = value;
  return kept.current;
}

const sameItems = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((item, i) => item === b[i]));

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a === b || (a.size === b.size && [...a].every((id) => b.has(id)));

interface ExplorerRootCommonProps<N extends ExplorerNode, E extends ExplorerEdge> {
  /** Required. The accessible name the parts derive theirs from. */
  readonly label: string;
  /** Controlled active view. An id no view has renders the first view. */
  readonly viewId?: string | undefined;
  /** The view to start on, read once at mount. Default: the first. */
  readonly defaultViewId?: string | undefined;
  readonly onViewChange?: ((viewId: string) => void) | undefined;
  /** Controlled selection. `null` is controlled and empty. An unknown id renders as none. */
  readonly selectedId?: string | null | undefined;
  /** The node to start with, read once at mount. */
  readonly defaultSelectedId?: string | null | undefined;
  readonly onSelectedChange?: ((id: string | null) => void) | undefined;
  /** The node to select when a view becomes active. Without it, a switch clears the selection. */
  readonly selectOnViewChange?: ((view: ExplorerView<N, E>) => string | null) | undefined;
  /** What search reads from a node. Default: the id and the label. */
  readonly searchText?: ((node: N) => string) | undefined;
  /** Throw `GROUP_ENCLOSES_NON_MEMBER` when a group outline would enclose a non-member. */
  readonly strictGroups?: boolean | undefined;
  readonly labels?: Partial<ExplorerLabels> | undefined;
  readonly apiRef?: Ref<ExplorerApi> | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly children?: ReactNode;
}

interface ExplorerRootViews<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly views: readonly ExplorerView<N, E>[];
  readonly nodes?: never;
  readonly edges?: never;
  readonly groups?: never;
  readonly layout?: never;
}

interface ExplorerRootGraph<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly views?: never;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
  readonly groups?: readonly ExplorerGroup[] | undefined;
  readonly layout?: ExplorerLayoutOptions<N> | undefined;
}

/**
 * The root's props. The data is exactly one of two shapes, `views` or the
 * single-graph shorthand (`nodes`, `edges`, `groups`, `layout`), and each
 * types the other's props as `never`, so passing both is a compile error and
 * not a silent precedence rule. The shorthand is one view whose id is
 * `'default'` and whose label is `label`.
 */
export type ExplorerRootProps<
  N extends ExplorerNode = ExplorerNode,
  E extends ExplorerEdge = ExplorerEdge,
> = ExplorerRootCommonProps<N, E> & (ExplorerRootViews<N, E> | ExplorerRootGraph<N, E>);

/**
 * What the stable methods read: the latest committed render, with each
 * method's own writes on top until the next commit, so two calls in one tick
 * see each other.
 */
interface Latest<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly views: readonly ExplorerView<N, E>[];
  /** The active view, or the one a call asked for since the last commit. */
  readonly activeId: string | null;
  readonly layout: ExplorerLayout | null;
  readonly nodeById: ReadonlyMap<string, N>;
  /** The selection, or the one a call asked for since the last commit. */
  readonly rawSelected: string | null;
  /** The selection as committed: under control, the owner's prop. */
  readonly committedSelected: string | null;
  readonly selectionControlled: boolean;
  readonly viewControlled: boolean;
  readonly detailsOpen: boolean;
  readonly onSelectedChange: ((id: string | null) => void) | undefined;
  readonly onViewChange: ((viewId: string) => void) | undefined;
}

export function ExplorerRoot<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>(
  props: ExplorerRootProps<N, E>,
): ReactElement {
  const {
    label,
    viewId,
    defaultViewId,
    onViewChange,
    selectedId: selectedProp,
    defaultSelectedId,
    onSelectedChange,
    selectOnViewChange,
    searchText = defaultSearchText,
    strictGroups = false,
    labels: labelOverrides,
    apiRef,
    className,
    style,
    children,
  } = props;
  const { views: viewsProp, nodes, edges, groups, layout: layoutOptions } = props;

  const views = useMemo<readonly ExplorerView<N, E>[]>(() => {
    if (viewsProp !== undefined) return viewsProp;
    if (nodes === undefined) return [];
    return [{ id: DEFAULT_VIEW_ID, label, nodes, edges: edges ?? [], groups, layout: layoutOptions }];
  }, [viewsProp, nodes, edges, groups, layoutOptions, label]);

  // Every view, not only the active one, so a broken view fails on the page
  // that ships it and not on the day somebody switches to it.
  useMemo(() => validateViews(views), [views]);

  // Kept by value, so an inline `labels={{ search: 'Find' }}` re-created on
  // every parent render changes nothing downstream while it says the same.
  const labels = useSame(resolveLabels(labelOverrides), sameLabels);

  // View.
  const [viewState, setViewState] = useState<string | null>(() => defaultViewId ?? null);
  const viewControlled = viewId !== undefined;
  const requestedView = viewControlled ? viewId : viewState;
  const activeView = views.find((view) => view.id === requestedView) ?? views[0] ?? null;
  const activeId = activeView?.id ?? null;

  // Layout, by shape. The key is a string, so the memo holds across data
  // re-created with the same shape and a label or color change. The key
  // itself is linear in the view and calls the host's `nodeSize`, so it is
  // computed once per view object, not on every render.
  const key = useMemo(() => (activeView === null ? null : layoutKey(activeView)), [activeView]);
  const layout = useMemo(
    () => (activeView === null ? null : layoutView(activeView, { strictGroups })),
    // Keyed by shape, on purpose: `activeView` is read for the key's sake.
    [key, strictGroups],
  );

  const nodeById = useMemo(
    () => new Map((activeView?.nodes ?? []).map((node) => [node.id, node])),
    [activeView],
  );

  // Selection.
  const [selectedState, setSelectedState] = useState<string | null>(() => defaultSelectedId ?? null);
  const selectionControlled = selectedProp !== undefined;
  const rawSelected = selectionControlled ? selectedProp : selectedState;
  const selectedNode = rawSelected === null ? null : (nodeById.get(rawSelected) ?? null);
  const selectedId = selectedNode === null ? null : selectedNode.id;

  // Query, trace, drawer.
  const [query, setQueryState] = useState('');
  const [trace, setTraceState] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A node `inspect` asked for under a controlled selection: the drawer opens
  // when the owner's prop arrives at it, and not before.
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [lastRaw, setLastRaw] = useState(rawSelected);
  if (lastRaw !== rawSelected) {
    setLastRaw(rawSelected);
    if (pendingOpen !== null) {
      setPendingOpen(null);
      if (pendingOpen === rawSelected) setDrawerOpen(true);
    }
  }
  // No selection, no drawer, and none that reopens on the next selection.
  if (selectedId === null && drawerOpen) setDrawerOpen(false);
  const detailsOpen = drawerOpen && selectedId !== null;

  // Kept while the same nodes match, so a keystroke that changes nothing
  // found re-renders no list and re-dims nothing.
  const matches = useSame(
    useMemo(
      () => (activeView === null ? [] : searchNodes(activeView.nodes, query, searchText)),
      [activeView, query, searchText],
    ),
    sameItems,
  );
  const hasQuery = query.trim() !== '';
  // Kept by value too: the graph renders again only when the dimming does.
  const dimmedNow = useMemo<ReadonlySet<string>>(() => {
    if (activeView === null || (!hasQuery && !(trace && selectedId !== null))) return NOTHING;
    const out = new Set<string>();
    if (hasQuery) {
      const hit = new Set(matches.map((node) => node.id));
      for (const node of activeView.nodes) if (!hit.has(node.id)) out.add(node.id);
    }
    if (trace && selectedId !== null) {
      const keep = new Set([selectedId]);
      for (const edge of activeView.edges) {
        if (edge.source === selectedId) keep.add(edge.target);
        if (edge.target === selectedId) keep.add(edge.source);
      }
      for (const node of activeView.nodes) if (!keep.has(node.id)) out.add(node.id);
    }
    return out.size === 0 ? NOTHING : out;
  }, [activeView, hasQuery, matches, trace, selectedId]);
  const dimmed = useSame(dimmedNow, sameSet);

  const snapshot: Latest<N, E> = {
    views,
    activeId,
    layout,
    nodeById,
    rawSelected,
    committedSelected: rawSelected,
    selectionControlled,
    viewControlled,
    detailsOpen,
    onSelectedChange,
    onViewChange,
  };
  const latest = useRef(snapshot);
  // A render after a call under control, so the commit puts the owner's
  // value back in `latest` even when the owner does not move.
  const [, recommit] = useReducer((n: number) => n + 1, 0);
  useIsomorphicLayoutEffect(() => {
    latest.current = snapshot;
  });

  const [internals] = useState<ExplorerInternals>(() => {
    let viewports = 0;
    return {
      registerViewport() {
        if (viewports > 0) {
          throw new ExplorerContextError(
            'SECOND_VIEWPORT',
            'An ExplorerRoot has a second ExplorerViewport. Render exactly one per root',
          );
        }
        viewports += 1;
        return () => {
          viewports -= 1;
        };
      },
      controlsRef: { current: null as ExplorerCameraControls | null },
      camera: createCameraHub(),
      obstructions: createObstructions(),
      searchInputRef: { current: null as HTMLInputElement | null },
    };
  });
  const openerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Set by Escape inside the graph, whose close restores nothing.
  const skipRestore = useRef(false);

  const [{ api, changeSelection }] = useState(() => {
    const changeSelection = (next: string | null): void => {
      const s = latest.current;
      if (next === s.rawSelected) return;
      latest.current = { ...s, rawSelected: next };
      if (s.selectionControlled) recommit();
      else setSelectedState(next);
      s.onSelectedChange?.(next);
    };
    const box = (id: string) => latest.current.layout?.boxes.get(id);
    const methods: ExplorerApi = {
      fit() {
        internals.controlsRef.current?.fit();
      },
      zoomBy(factor) {
        internals.controlsRef.current?.zoomBy(factor);
      },
      focusNode(id) {
        const found = box(id);
        if (found !== undefined) internals.controlsRef.current?.focusBox(found);
      },
      reveal(id) {
        const found = box(id);
        if (found !== undefined) internals.controlsRef.current?.revealBox(found);
      },
      focusViewport() {
        internals.controlsRef.current?.focus();
      },
      select(id) {
        if (id !== null && !latest.current.nodeById.has(id)) return;
        setPendingOpen(null);
        changeSelection(id);
      },
      inspect(id, trigger) {
        const s = latest.current;
        if (!s.nodeById.has(id)) return;
        if (trigger !== undefined) openerRef.current = trigger;
        else if (!s.detailsOpen) {
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        }
        if (!s.selectionControlled || s.committedSelected === id) {
          setPendingOpen(null);
          setDrawerOpen(true);
          latest.current = { ...s, detailsOpen: true };
        } else {
          setPendingOpen(id);
        }
        changeSelection(id);
      },
      closeDetails() {
        setPendingOpen(null);
        setDrawerOpen(false);
        latest.current = { ...latest.current, detailsOpen: false };
      },
      selectView(id) {
        const s = latest.current;
        if (id === s.activeId || !s.views.some((view) => view.id === id)) return;
        latest.current = { ...s, activeId: id };
        if (s.viewControlled) recommit();
        else setViewState(id);
        s.onViewChange?.(id);
      },
      setQuery(next) {
        setQueryState(next);
      },
      setTrace(on) {
        setTraceState(on);
      },
    };
    return { api: methods, changeSelection };
  });

  useImperativeHandle(apiRef, () => api, [api]);

  // The changes the explorer makes on its own, found after commit. See the
  // file comment for why here and not in render.
  const seenView = useRef(activeId);
  const present = useRef<{ readonly view: string | null; readonly id: string } | null>(null);
  useIsomorphicLayoutEffect(() => {
    // A removed view, or an unknown default, is forgotten, so it is not
    // reselected if it appears later.
    if (!viewControlled && activeId !== null && viewState !== activeId) setViewState(activeId);

    // Data arriving after mount, or after every view was gone, is not a
    // switch: there was nothing to switch from. Recorded, and nothing reset,
    // so a deep-linked selection survives data that starts empty.
    if (seenView.current === null && activeId !== null) seenView.current = activeId;

    if (seenView.current !== activeId) {
      const previous = seenView.current;
      seenView.current = activeId;
      present.current = null;
      setQueryState('');
      setTraceState(false);
      setDrawerOpen(false);
      setPendingOpen(null);
      // The camera resets because the viewport remounts per view.
      changeSelection(
        activeView !== null && selectOnViewChange !== undefined ? selectOnViewChange(activeView) : null,
      );
      const removed = previous !== null && !views.some((view) => view.id === previous);
      if (removed && activeId !== null) onViewChange?.(activeId);
      return;
    }

    // The selected node leaving the data is a transition: reported once,
    // when an id that resolved last commit no longer does. An unknown id the
    // owner passes never resolved, so it is never reported.
    if (selectedId !== null) {
      present.current = { view: activeId, id: selectedId };
      return;
    }
    const was = present.current;
    present.current = null;
    if (was !== null && was.view === activeId && rawSelected === was.id) changeSelection(null);
  });

  const wasOpen = useRef(detailsOpen);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = detailsOpen;
    if (detailsOpen || !was) return;
    const skip = skipRestore.current;
    skipRestore.current = false;
    if (skip) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const opener = openerRef.current;
    // Never the page: the root takes focus when nothing better is left.
    const target =
      opener !== null && opener.isConnected ? opener : (internals.searchInputRef.current ?? rootRef.current);
    target?.focus();
  }, [detailsOpen, internals]);

  // The capture phase, so it runs before the camera's listener on the
  // viewport, which blurs the graph on an Escape nobody has handled. Only a
  // node's own button or the surface: content a host renders inside a node
  // gets the key first, as everywhere else.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (event.key !== 'Escape' || !detailsOpen || !(target instanceof HTMLElement)) return;
    const viewport = target.closest('[data-dagr-explorer="viewport"]');
    if (viewport === null || viewport.closest('[data-dagr-explorer="root"]') !== rootRef.current) return;
    if (target !== viewport && target.getAttribute('data-dagr-explorer') !== 'node') return;
    event.preventDefault();
    api.closeDetails();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (event.key !== 'Escape' || !detailsOpen || !(target instanceof Element)) return;
    // A root nested in this one handles its own.
    if (target.closest('[data-dagr-explorer="root"]') !== rootRef.current) return;
    if (target.closest('[data-dagr-explorer="viewport"]') !== null) {
      // Closed already in the capture phase, or handled by content in a node.
      if (event.defaultPrevented) return;
      // The camera has already released graph focus by now: its listener is
      // on the viewport, below this one.
      skipRestore.current = true;
      api.closeDetails();
      return;
    }
    // The search field and the drawer keep their own precedence, and so
    // does a host control that handled the key.
    if (event.defaultPrevented || target === internals.searchInputRef.current) return;
    api.closeDetails();
  };

  const state = useMemo<ExplorerState>(
    () =>
      ({
        ...api,
        label,
        labels,
        views,
        activeView,
        layout,
        selectedId,
        selectedNode,
        query,
        matches,
        trace,
        detailsOpen,
        dimmed,
        camera: internals.camera,
      }) as unknown as ExplorerState,
    [api, label, labels, views, activeView, layout, selectedId, selectedNode, query, matches, trace, detailsOpen, dimmed, internals],
  );
  const value = useMemo<ExplorerContextValue>(() => ({ state, internals }), [state, internals]);

  return (
    <ExplorerApiContext.Provider value={api}>
      <ExplorerContext.Provider value={value}>
        <div
          ref={rootRef}
          data-dagr-explorer="root"
          // Where focus goes when the drawer closes with nothing else to take it.
          tabIndex={-1}
          className={className}
          style={{ position: 'relative', ...style }}
          onKeyDownCapture={onKeyDownCapture}
          onKeyDown={onKeyDown}
        >
          {children}
          <div data-dagr-explorer="announcer" aria-live="polite" style={VISUALLY_HIDDEN}>
            {detailsOpen && selectedNode !== null ? selectedNode.label : ''}
          </div>
        </div>
      </ExplorerContext.Provider>
    </ExplorerApiContext.Provider>
  );
}
