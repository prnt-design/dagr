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
 * **Validation and layout run in render,** so a data error reaches an error
 * boundary. Every view is validated; only the active one is laid out, and
 * its layout is memoized by shape, so data re-created on every render keeps
 * its layout and its camera.
 */

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { ExplorerContext, createCameraHub } from './context.js';
import type { ExplorerApi, ExplorerContextValue, ExplorerInternals, ExplorerState } from './context.js';
import { ExplorerContextError } from './errors.js';
import { resolveLabels } from './labels.js';
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

/**
 * A layout effect in the browser and a plain one on a server, where React 18
 * warns that a layout effect does nothing.
 */
export const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

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

/** What the stable methods read: the latest committed render. */
interface Latest<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly views: readonly ExplorerView<N, E>[];
  readonly activeId: string | null;
  readonly layout: ExplorerLayout | null;
  readonly nodeById: ReadonlyMap<string, N>;
  readonly rawSelected: string | null;
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

  const labels = useMemo(() => resolveLabels(labelOverrides), [labelOverrides]);

  // View.
  const [viewState, setViewState] = useState<string | null>(() => defaultViewId ?? null);
  const viewControlled = viewId !== undefined;
  const requestedView = viewControlled ? viewId : viewState;
  const activeView = views.find((view) => view.id === requestedView) ?? views[0] ?? null;
  const activeId = activeView?.id ?? null;

  // Layout, by shape. The key is a string, so the memo holds across data
  // re-created with the same shape and a label or color change.
  const key = activeView === null ? null : layoutKey(activeView);
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

  const matches = useMemo(
    () => (activeView === null ? [] : searchNodes(activeView.nodes, query, searchText)),
    [activeView, query, searchText],
  );
  const hasQuery = query.trim() !== '';
  const dimmed = useMemo<ReadonlySet<string>>(() => {
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

  const snapshot: Latest<N, E> = {
    views,
    activeId,
    layout,
    nodeById,
    rawSelected,
    selectionControlled,
    viewControlled,
    detailsOpen,
    onSelectedChange,
    onViewChange,
  };
  const latest = useRef(snapshot);
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
      searchInputRef: { current: null as HTMLInputElement | null },
    };
  });
  const openerRef = useRef<HTMLElement | null>(null);

  const [{ api, changeSelection }] = useState(() => {
    const changeSelection = (next: string | null): void => {
      const s = latest.current;
      if (next === s.rawSelected) return;
      if (!s.selectionControlled) setSelectedState(next);
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
        if (!s.selectionControlled || s.rawSelected === id) {
          setPendingOpen(null);
          setDrawerOpen(true);
        } else {
          setPendingOpen(id);
        }
        changeSelection(id);
      },
      closeDetails() {
        setPendingOpen(null);
        setDrawerOpen(false);
      },
      selectView(id) {
        const s = latest.current;
        if (id === s.activeId || !s.views.some((view) => view.id === id)) return;
        if (!s.viewControlled) setViewState(id);
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
    <ExplorerContext.Provider value={value}>
      <div data-dagr-explorer="root" className={className} style={{ position: 'relative', ...style }}>
        {children}
      </div>
    </ExplorerContext.Provider>
  );
}
