/**
 * `ExplorerViewport`: the graph surface, wired to the root.
 *
 * It is the internal `ViewportSurface` with its props filled from the root:
 * the active view and its layout, the selection, the dimming, and the
 * activation callbacks (a click inspects, a double click flies to the node).
 * The camera controls and the camera source go back up to the root, so
 * `ExplorerApi`'s camera methods and the toolbar's readout reach them.
 *
 * **One per root, counted in an effect.** The viewport registers with its
 * root in an effect with cleanup, and the second registration throws.
 * Counting in render would misfire under StrictMode's double render, and
 * when Suspense keeps an old tree alive beside a new one.
 *
 * **A view switch remounts the surface,** keyed by view id. That is the
 * camera reset the spec asks of a switch: a new surface fits its layout on
 * its first measure, with no flight from a camera framed on other content.
 *
 * **The surface renders only for what it shows.** It is memoized, and given
 * only the state it draws (the view, the layout, the selection, the dimming)
 * and the root's stable methods, so a keystroke that changes neither the
 * dimming nor the selection does not render the graph.
 *
 * **A stage for overlays.** The surface sits in a positioned element with
 * the part's children, such as `ExplorerDetails`, which position against it.
 * The hint, the graph's description, comes after the stage, so an overlay
 * never covers it.
 */

import { memo, useEffect, useId, useRef } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ExplorerBase, ExplorerCameraSource } from './base.js';
import { useExplorerApiContext, useExplorerContext } from './context.js';
import type { ExplorerApi, ExplorerInternals } from './context.js';
import type { ExplorerLayout } from './layout.js';
import type { ExplorerEdge, ExplorerGroup, ExplorerNode, ExplorerView } from './types.js';
import { ViewportSurface } from './viewport-surface.js';
import type { ExplorerTier, ExplorerTiers } from './visible-set.js';

/** Only the node type: nothing here takes an edge. */
export interface ExplorerViewportProps<N extends ExplorerNode = ExplorerNode> {
  /**
   * A node's content, for nodes large enough on screen to read. It sits
   * inside the explorer's own node button, so it must not be interactive.
   * Default: the label.
   */
  readonly renderNode?:
    | ((node: N, context: { readonly tier: ExplorerTier; readonly selected: boolean; readonly dimmed: boolean }) => ReactNode)
    | undefined;
  /** A node's accessible name. Default: its label, then `labels.inGroup(group)` for each group. */
  readonly nodeAriaLabel?:
    | ((node: N, context: { readonly groups: readonly ExplorerGroup[] }) => string)
    | undefined;
  /** On-screen widths, in CSS pixels, at which a node becomes a summary and then rich. Default 56 and 200. */
  readonly tiers?: ExplorerTiers | undefined;
  /** The most node elements mounted at once, before pins. Default 200. */
  readonly maxOverlayNodes?: number | undefined;
  /** What draws the nodes that have no element. Default: the SVG base. Experimental. */
  readonly base?: ExplorerBase | undefined;
  readonly className?: string | undefined;
  /**
   * Sizing and decoration pass through: `{ height: 600 }` replaces
   * `--dagr-explorer-height`. `position` and `overflow` stay the viewport's
   * own, because the graph needs them.
   */
  readonly style?: CSSProperties | undefined;
  /**
   * Overlays positioned against the graph, such as `ExplorerDetails`. They
   * share a positioned stage with the graph, and the hint comes after it.
   */
  readonly children?: ReactNode;
}

interface PaneProps<N extends ExplorerNode, E extends ExplorerEdge>
  extends Omit<ExplorerViewportProps<N>, 'children'> {
  readonly label: string;
  readonly inGroup: (groupLabel: string) => string;
  readonly view: ExplorerView<N, E>;
  readonly layout: ExplorerLayout;
  readonly selectedId: string | null;
  readonly dimmed: ReadonlySet<string>;
  readonly api: ExplorerApi;
  readonly internals: ExplorerInternals;
  readonly describedBy: string;
}

/**
 * One surface for one view, attached to the root's camera hub while it lives.
 * Memoized: every prop is stable unless what it draws changes.
 */
const ViewportPane = memo(function ViewportPane<N extends ExplorerNode, E extends ExplorerEdge>(
  props: PaneProps<N, E>,
): ReactElement {
  const { api, internals, describedBy, ...rest } = props;
  const sourceRef = useRef<ExplorerCameraSource | null>(null);

  // The surface's own effects have run by now, so its source is in the ref.
  useEffect(() => {
    const source = sourceRef.current;
    return source === null ? undefined : internals.camera.attach(source);
  }, [internals]);

  return (
    <ViewportSurface<N, E>
      {...rest}
      onNodeActivate={(id, trigger) => api.inspect(id, trigger)}
      onNodeZoom={(id) => api.focusNode(id)}
      controlsRef={internals.controlsRef}
      cameraSourceRef={sourceRef}
      describedBy={describedBy}
    />
  );
}) as <N extends ExplorerNode, E extends ExplorerEdge>(props: PaneProps<N, E>) => ReactElement;

const STAGE: CSSProperties = { position: 'relative' };

export function ExplorerViewport<N extends ExplorerNode = ExplorerNode, E extends ExplorerEdge = ExplorerEdge>(
  props: ExplorerViewportProps<N>,
): ReactElement {
  const { children, ...rest } = props;
  const { state, internals } = useExplorerContext('ExplorerViewport');
  const api = useExplorerApiContext('ExplorerViewport');
  const describedBy = useId();

  useEffect(() => internals.registerViewport(), [internals]);

  // The part's type parameters are a claim about the root's data. See context.ts.
  const view = state.activeView as ExplorerView<N, E> | null;
  const { layout, labels } = state;

  const empty = view === null || layout === null || view.nodes.length === 0;

  // One shape for both states, so the stage and its children survive a view
  // that empties and fills again.
  return (
    <>
      <div data-dagr-explorer="stage" style={STAGE}>
        {empty ? (
          <div
            data-dagr-explorer="viewport"
            data-empty="true"
            role="region"
            aria-label={state.label}
            className={rest.className}
            style={{
              position: 'relative',
              height: 'var(--dagr-explorer-height, 480px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...rest.style,
            }}
          >
            {view === null ? labels.noViews : labels.emptyView}
          </div>
        ) : (
          <ViewportPane<N, E>
            key={view.id}
            {...rest}
            label={state.label}
            inGroup={labels.inGroup}
            view={view}
            layout={layout}
            selectedId={state.selectedId}
            dimmed={state.dimmed}
            api={api}
            internals={internals}
            describedBy={describedBy}
          />
        )}
        {children}
      </div>
      {empty ? null : (
        <p id={describedBy} data-dagr-explorer="hint">
          <span>{labels.stats({ nodes: view.nodes.length, edges: view.edges.length })}</span>{' '}
          <span>{labels.hint}</span>
        </p>
      )}
    </>
  );
}
