/**
 * A graph on a canvas: the component this package exists for.
 *
 * It is the first thing in the workspace that closes the loop. `@dagr/graph`
 * holds the model, `@dagr/layout` says where everything goes, `@dagr/render`
 * draws what it is handed, and until now the code joining those three was
 * `@dagr/campaign-stage`: a private package, written for one dataset, that
 * every host had to copy to draw anything else. `<DagrCanvas>` is that wiring
 * with the campaign taken out of it.
 *
 * **The graph prop is controlled, and controlled here means watched.** An edit
 * reaches the canvas whether it arrives as a new `Graph` on the prop or as a
 * mutation of the one already there, because `useDagr` subscribes to the graph
 * itself. See that file for the one window this leaves open and for the two
 * ways of closing it that cost more than it does.
 *
 * **Three props are read once, at construction, and never again**:
 * `clearColor`, `sceneStyle` and `edgeStyle`. The renderer takes them when it
 * is built, its edge groups are declared at construction in draw order, and
 * rebuilding a device context because a colour changed would drop every
 * instance handle in the scene to honour a prop that nobody animates. A caller
 * who does want to animate one holds the renderer, through `useDagrCanvas`, and
 * `setEdgeStyle` is on it.
 *
 * **The camera is fitted once and then it is the user's.** The first frame that
 * has both a layout and a viewport frames the graph; nothing refits after that,
 * and `fit={false}` skips even the first. Refitting on every edit would be a
 * camera that jumps whenever the graph changes, which is the instability the
 * whole M3 milestone exists to keep out of the layout, reintroduced one level
 * up where no stability metric would ever see it.
 *
 * **The holder has no size of its own.** The canvas fills it and the renderer
 * is told what the holder measures, so a `<DagrCanvas>` in a container with no
 * height measures zero, draws nothing and says nothing about it. Give it a
 * height, through `style` or `className`, the way any other layout-filling
 * component needs one.
 *
 * **Children do not render until the renderer, the overlay and the layout all
 * exist.** `<Html>` and anything else reading `useDagrCanvas` would otherwise
 * have to handle a half-built canvas, and a nullable field on the handle
 * pushes that check into every consumer forever. A device takes a moment to
 * arrive and there is nothing to draw over until it has, so a caller who wants
 * a spinner in the meantime renders one OUTSIDE the canvas rather than in it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { Graph } from '@dagr/graph';
import type { LayoutConfig, LayoutResult } from '@dagr/layout';
import { createHtmlOverlay, createRenderer } from '@dagr/render';
import type {
  HtmlOverlay,
  Renderer,
  RibbonStyle,
  SceneEdgeGroup,
  SceneStyle,
  WorldBounds,
} from '@dagr/render';
import { DagrCanvasContext } from './canvas-context.js';
import type { DagrCanvasHandle } from './canvas-context.js';
import { toSceneEdges, toSceneNodes, toWorldBounds } from './scene.js';
import type { EdgeColorOf, NodeAppearanceOf } from './scene.js';
import { useDagr } from './use-dagr.js';

/**
 * The one edge group this component declares.
 *
 * One group, because a group is a draw call with its own material and the
 * component has no way to know what a caller would want to separate. A caller
 * who needs two holds the renderer and calls `setEdges` on a group of their
 * own, which is why the id is exported rather than hidden: theirs must not
 * collide with this one.
 */
export const DEFAULT_EDGE_GROUP_ID = 'dagr-edges';

/** A plain undashed ribbon, thin enough to read at any zoom the fit produces. */
const DEFAULT_EDGE_STYLE: RibbonStyle = { halfWidthPixels: 1 };

/** What `<DagrCanvas>` takes. */
export interface DagrCanvasProps {
  /** The graph to draw. Watched, so an in-place edit redraws. */
  readonly graph: Graph;

  /** The layout configuration. Compared by value; see `useDagr`. */
  readonly config?: LayoutConfig;

  /**
   * What each node looks like, by id. Compared by IDENTITY, so memoise it.
   *
   * Identity is the only comparison available for a function and it is also the
   * right one: a new appearance callback means a new picture, and there is no
   * way to tell one from an identical one re-created by a render. A caller who
   * passes an unmemoised arrow rebuilds the scene array on every render of the
   * host, which is O(nodes) and one `setNodes`, not a redraw of the device.
   */
  readonly nodeAppearance?: NodeAppearanceOf;

  /** What colour each edge is, by id. Compared by identity, as above. */
  readonly edgeColor?: EdgeColorOf;

  /** The three uniforms every node shares. Read once, at construction. */
  readonly sceneStyle?: SceneStyle;

  /** The canvas background, as `0xRRGGBB`. Read once, at construction. */
  readonly clearColor?: number;

  /** How the edge ribbons are drawn. Read once, at construction. */
  readonly edgeStyle?: RibbonStyle;

  /** Whether to frame the graph on the first drawable frame. Default true. */
  readonly fit?: boolean;

  /** The margin the fit leaves, as a fraction of the viewport. Default the camera's. */
  readonly fitPadding?: number;

  /** Passed to the element that holds the canvas and the overlay. */
  readonly className?: string;

  /** Merged into the holder's style. `position` is this component's. */
  readonly style?: CSSProperties;

  /** Rendered once the canvas is ready, inside its context. */
  readonly children?: ReactNode;

  /** Called after every layout, with the result now on screen. */
  readonly onLayout?: (result: LayoutResult) => void;

  /**
   * Called instead of throwing, for a layout that failed or a device that never
   * arrived.
   *
   * Without it the failure is thrown during render, so the nearest React error
   * boundary catches it. That is the default because the alternative for a
   * component that cannot draw is to render an empty box and say nothing, and
   * an empty box is indistinguishable from an empty graph.
   */
  readonly onError?: (error: unknown) => void;
}

/** The renderer and the overlay, which are built together and torn down together. */
interface Stage {
  readonly renderer: Renderer;
  readonly overlay: HtmlOverlay;
}

export function DagrCanvas(props: DagrCanvasProps): ReactElement {
  const { graph, config, children, className, style } = props;
  const { result, error } = useDagr(graph, config === undefined ? undefined : { config });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const frameRef = useRef<number | null>(null);
  const viewportRef = useRef(false);
  const fittedRef = useRef(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  // Read in effects, never in a dependency list. `use-campaign-scene.ts` set
  // this precedent for the same reason: a caller writes these as inline arrows
  // and an effect keyed on one would tear the renderer down and build it again
  // on any re-render that had nothing to do with it.
  const latest = useRef(props);
  latest.current = props;

  const sceneNodes = useMemo(
    () => (result === null ? null : toSceneNodes(result, props.nodeAppearance)),
    [result, props.nodeAppearance],
  );
  const sceneEdges = useMemo(
    () => (result === null ? null : toSceneEdges(result, props.edgeColor)),
    [result, props.edgeColor],
  );
  const bounds = useMemo(() => (result === null ? null : toWorldBounds(result.bounds)), [result]);
  const boundsRef = useRef<WorldBounds | null>(bounds);
  boundsRef.current = bounds;

  const requestDraw = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const current = stageRef.current;
      if (current === null) return;
      current.renderer.render();
      current.overlay.sync();
    });
  }, []);

  const fitOnce = useCallback((): void => {
    const current = stageRef.current;
    if (current === null || fittedRef.current || !viewportRef.current) return;
    const { fit: wanted = true, fitPadding: padding } = latest.current;
    if (!wanted) return;
    const bounds = boundsRef.current;
    if (bounds === null) return;
    current.renderer.camera.fitBounds(bounds, padding);
    fittedRef.current = true;
    requestDraw();
  }, [requestDraw]);

  // Built once per mount. The renderer is async, so the cleanup has two jobs:
  // stop the one that has arrived, and refuse the one still coming.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (canvas === null || host === null) return;

    const { clearColor, sceneStyle, edgeStyle } = latest.current;
    const group: SceneEdgeGroup = {
      id: DEFAULT_EDGE_GROUP_ID,
      style: edgeStyle ?? DEFAULT_EDGE_STYLE,
      curve: 'polyline',
    };

    let live = true;
    let made: Stage | null = null;

    createRenderer({
      canvas,
      edgeGroups: [group],
      ...(clearColor === undefined ? {} : { clearColor }),
      ...(sceneStyle === undefined ? {} : { sceneStyle }),
    })
      .then((renderer) => {
        if (!live) {
          // The component went away while the device was being acquired. There
          // is no overlay yet, because it is built from this renderer's camera.
          renderer.dispose();
          return;
        }
        // The overlay refuses a parent it cannot mount into, and a throw here
        // would otherwise leave a live renderer holding a device context with
        // nothing left that could dispose it: `made` is still null, so the
        // cleanup below has nothing to take back.
        let overlay;
        try {
          overlay = createHtmlOverlay({ parent: host, camera: renderer.camera });
        } catch (cause: unknown) {
          renderer.dispose();
          throw cause;
        }
        made = { renderer, overlay };
        stageRef.current = made;
        setStage(made);
      })
      .catch((cause: unknown) => {
        if (live) setFailure(cause);
      });

    return () => {
      live = false;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // The overlay first: it holds elements inside the host, and disposing the
      // renderer does not know about them.
      made?.overlay.dispose();
      made?.renderer.dispose();
      made = null;
      stageRef.current = null;
      fittedRef.current = false;
      viewportRef.current = false;
      setStage(null);
    };
  }, []);

  useEffect(() => {
    if (stage === null) return;
    const host = hostRef.current;
    if (host === null) return;

    const observer = new ResizeObserver(() => {
      const box = host.getBoundingClientRect();
      // A container inside a collapsed panel or a hidden tab measures zero, and
      // a zero viewport is a `RangeError` from the camera rather than a small
      // picture. Nothing is drawn until it has an area.
      if (box.width <= 0 || box.height <= 0) return;
      stage.renderer.resize({
        width: box.width,
        height: box.height,
        devicePixelRatio: window.devicePixelRatio,
      });
      viewportRef.current = true;
      fitOnce();
      requestDraw();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [stage, fitOnce, requestDraw]);

  useEffect(() => {
    if (stage === null || sceneNodes === null) return;
    stage.renderer.setNodes(sceneNodes);
    fitOnce();
    requestDraw();
  }, [stage, sceneNodes, fitOnce, requestDraw]);

  useEffect(() => {
    if (stage === null || sceneEdges === null) return;
    stage.renderer.setEdges(DEFAULT_EDGE_GROUP_ID, sceneEdges);
    requestDraw();
  }, [stage, sceneEdges, requestDraw]);

  useEffect(() => {
    if (result !== null) latest.current.onLayout?.(result);
  }, [result]);

  const trouble = failure ?? error;
  useEffect(() => {
    if (trouble !== null) latest.current.onError?.(trouble);
  }, [trouble]);

  const handle = useMemo<DagrCanvasHandle | null>(
    () =>
      stage === null || result === null
        ? null
        : { renderer: stage.renderer, overlay: stage.overlay, result, requestDraw },
    [stage, result, requestDraw],
  );

  // Thrown during render rather than from the effect above, so a React error
  // boundary is what catches it: an effect that threw would land outside the
  // render React is tracking and take the whole root down instead. BELOW every
  // hook, so a boundary that resets and rerenders this component finds the same
  // hook sequence it saw last time rather than a shorter one.
  if (trouble !== null && props.onError === undefined) throw trouble;

  return (
    <div
      ref={hostRef}
      className={className}
      // `position` is not the caller's to set: `createHtmlOverlay` refuses a
      // parent that is not positioned, because its two absolute divs would
      // resolve against whatever positioned ancestor happens to be further up
      // the page and cover the document with labels.
      style={{ ...style, position: 'relative' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {handle === null ? null : (
        <DagrCanvasContext.Provider value={handle}>{children}</DagrCanvasContext.Provider>
      )}
    </div>
  );
}
