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
 * up where no stability metric would ever see it. An animated demo that refits
 * every frame would look impressive and would hide the thing it exists to show,
 * because a drawing that stays put while the camera moves is indistinguishable
 * from a drawing that moves. A caller who does want a following camera has the
 * sprung box on every {@link DagrCanvasProps.onFrame}, and `fitBounds` on it is
 * their line of code.
 *
 * **`animate` is a prop, and the scheduler option is why that is not a fork.**
 * M5.3 asked whether animation should be a prop or a hook. It is a prop, because
 * this component already owns all four things a hook would have to hand back
 * out: the coalesced frame, the renderer, the scene conversions, and the
 * `LayoutDelta` `useDagr` now reports. A hook would make the common caller
 * rewire what is already wired here. What keeps that from foreclosing the other
 * shape is `createMotionLoop`'s scheduler option: a caller who owns their own
 * frame leaves `animate` off, takes the renderer and the layout off
 * `useDagrCanvas`, and drives `createSceneMotion` from their own loop, which is
 * the worked example in the render docs. The component hands the loop ITS OWN
 * `requestDraw`, so there is one frame budget here rather than two.
 *
 * **Nothing springs on the first layout.** A scene motion built from a result
 * has no history to come from, so the first drawing is seeded at rest and drawn
 * where the layout put it. Only an edit glides.
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
import { createHtmlOverlay, createMotionLoop, createRenderer, createSceneMotion } from '@dagr/render';
import type {
  FrameScheduler,
  HtmlOverlay,
  MotionLoop,
  Renderer,
  RibbonStyle,
  SceneEdge,
  SceneEdgeGroup,
  SceneMotion,
  SceneMotionFrame,
  SceneMotionOptions,
  SceneNode,
  SceneStyle,
  WorldBounds,
} from '@dagr/render';
import { retarget, toMotionRoster } from './animation.js';
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

/**
 * The handle the motion loop's frame is requested under.
 *
 * The loop takes its scheduler's handle back opaquely, so this only has to be
 * something the `cancel` below can recognise. It is a module constant rather
 * than a counter because there is at most one loop frame outstanding: the
 * component coalesces every reason to draw into one `requestAnimationFrame`,
 * which is the whole reason the loop was given this scheduler.
 */
const LOOP_FRAME = Symbol('dagr-canvas-loop-frame');

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

  /**
   * Whether an edit glides to its new layout instead of cutting to it, and how
   * it should feel. Default false.
   *
   * `true` takes `@dagr/render`'s default half-life and rest tolerance; an
   * object sets either, and setting either is also a way of saying yes. The
   * object is compared BY VALUE, like `config`, because a caller writes it as
   * a literal in their JSX and comparing by identity would rebuild the springs
   * on every render of the host application.
   *
   * Off by default. A drawing that starts springing under a caller who did not
   * ask is not a default this component gets to choose for them, and the whole
   * of the opt-in is one word.
   */
  readonly animate?: boolean | SceneMotionOptions;

  /**
   * Called on every animated frame, with the scene as the springs have it and
   * the renderer about to draw it, after `setNodes` and `setEdges` and before
   * `render`.
   *
   * This is where a caller follows the drawing's box, in one line:
   * `if (frame.bounds !== null) renderer.camera.fitBounds(frame.bounds)`. The
   * component fits once and never again (see the file docstring), and the
   * sprung box is how that decision stays the caller's to overrule rather than
   * something they have to rebuild the animation to get at. The renderer comes
   * with it so that line needs no ref: taking it off `useDagrCanvas` in a child
   * would be three components to write `fitBounds` once. Called before the draw
   * so a camera moved here moves on this frame rather than the next.
   *
   * Not called at all when `animate` is off, because then there are no frames
   * to be handed: nothing is moving between layouts.
   */
  readonly onFrame?: (frame: SceneMotionFrame, renderer: Renderer) => void;

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

/** The `animate` prop, normalised, so nothing downstream reads a union. */
interface Animation {
  readonly enabled: boolean;
  readonly options: SceneMotionOptions;
}

const NOT_ANIMATED: Animation = Object.freeze({ enabled: false, options: Object.freeze({}) });

/** Whether two `animate` props mean the same springs. */
function sameAnimation(a: Animation, b: Animation): boolean {
  return (
    a.enabled === b.enabled &&
    a.options.halfLifeSeconds === b.options.halfLifeSeconds &&
    a.options.restEpsilon === b.options.restEpsilon
  );
}

/**
 * An `Animation` that is stable across renders as long as it keeps meaning the
 * same springs.
 *
 * The same treatment `config` gets in `use-dagr.ts`, and for the same reason:
 * this is a dependency of the effect that builds the motion, so an object
 * literal written in JSX would rebuild the springs, mid-glide, on any render of
 * the host application.
 */
function useStableAnimation(animate: boolean | SceneMotionOptions | undefined): Animation {
  const next: Animation =
    animate === undefined || animate === false
      ? NOT_ANIMATED
      : { enabled: true, options: animate === true ? {} : animate };
  const held = useRef(next);
  if (!sameAnimation(held.current, next)) held.current = next;
  return held.current;
}

/**
 * A frame's worth of nodes, dressed from the layout they came from.
 *
 * The motion reports an id and a centre; everything else a `SceneNode` carries
 * (its size, its shape, its colours) is the layout's and the caller's, so it is
 * looked up by id. A DEPARTING node is why the lookup is a retained map rather
 * than the current scene array: a node a delta removed is still in the frame
 * while its spring runs down, and it is no longer in the layout that removed it.
 * An id with no dressing at all is skipped rather than drawn from defaults,
 * because a guessed size draws a node the wrong size where skipping draws none.
 *
 * SIZES DO NOT SPRING, which is M4.7c's decision and is visible here as the
 * dressing being taken whole from the newest layout: a node that changed size is
 * in the delta as a move, its centre glides, and its box is the new one from the
 * frame the edit landed on. A label that grew measures wider instantly because
 * the text that made it wider changed instantly.
 */
function dressNodes(
  frame: readonly { readonly id: string; readonly center: SceneNode['center'] }[],
  dressing: ReadonlyMap<string, SceneNode>,
): SceneNode[] {
  const drawn: SceneNode[] = [];
  for (const moving of frame) {
    const dressed = dressing.get(moving.id);
    if (dressed !== undefined) drawn.push({ ...dressed, center: moving.center });
  }
  return drawn;
}

/** A frame's worth of edges, dressed from the layout they came from. */
function dressEdges(
  frame: readonly { readonly id: string; readonly points: SceneEdge['points'] }[],
  dressing: ReadonlyMap<string, SceneEdge>,
): SceneEdge[] {
  const drawn: SceneEdge[] = [];
  for (const moving of frame) {
    const dressed = dressing.get(moving.id);
    if (dressed !== undefined) drawn.push({ ...dressed, points: moving.points });
  }
  return drawn;
}

export function DagrCanvas(props: DagrCanvasProps): ReactElement {
  const { graph, config, children, className, style } = props;
  const layout = useDagr(graph, config === undefined ? undefined : { config });
  const { result, error } = layout;
  const animation = useStableAnimation(props.animate);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const frameRef = useRef<number | null>(null);
  const viewportRef = useRef(false);
  const fittedRef = useRef(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  // The animation, all of which lives in refs: the loop's frame runs outside
  // React entirely, and a render between two frames is not a reason to rebuild
  // a spring. `motionRef` being null is also the ONE test for "is this
  // component animating", so the effects below cannot disagree about it.
  const motionRef = useRef<SceneMotion | null>(null);
  const loopRef = useRef<MotionLoop | null>(null);
  const loopFrameRef = useRef<((nowMs: number) => void) | null>(null);
  const dressedNodesRef = useRef(new Map<string, SceneNode>());
  const dressedEdgesRef = useRef(new Map<string, SceneEdge>());
  /**
   * The layout state whose change the motion has already been told about.
   *
   * Compared by identity, which is what makes it work: `useDagr` hands back the
   * same state object until the next layout, so this is "has this delta been
   * applied" without a counter and without reading the delta. A motion that has
   * just been built records the state it was seeded from, so the effect below
   * does not then apply that state's delta on top of a scene that already
   * reflects it.
   */
  const appliedRef = useRef<typeof layout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

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
  const sceneNodesRef = useRef<SceneNode[] | null>(sceneNodes);
  sceneNodesRef.current = sceneNodes;
  const sceneEdgesRef = useRef<SceneEdge[] | null>(sceneEdges);
  sceneEdgesRef.current = sceneEdges;

  /** The drawing as the layout has it, which is what a reseat is measured from. */
  const rosterNow = useCallback(
    () => toMotionRoster(sceneNodesRef.current ?? [], sceneEdgesRef.current ?? [], boundsRef.current),
    [],
  );

  /**
   * The one queued frame, and the only place `requestAnimationFrame` is called.
   *
   * A frame can be wanted for two reasons at once: something changed and the
   * canvas should redraw, and the motion loop wants to step. THE LOOP'S FRAME
   * WINS, because stepping the motion redraws as part of its work, so running
   * both would be drawing the same frame twice. A loop frame that has been
   * cancelled leaves the plain draw, which is what a cancel means here: the
   * loop has stopped, the canvas still has a reason to draw.
   */
  const scheduleFrame = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame((nowMs) => {
      frameRef.current = null;
      const loopFrame = loopFrameRef.current;
      loopFrameRef.current = null;
      if (loopFrame !== null) {
        loopFrame(nowMs);
        return;
      }
      const current = stageRef.current;
      if (current === null) return;
      current.renderer.render();
      current.overlay.sync();
    });
  }, []);

  const requestDraw = useCallback((): void => {
    scheduleFrame();
  }, [scheduleFrame]);

  /**
   * The loop's scheduler, which is this component's own coalesced frame.
   *
   * `createMotionLoop` takes this as an option precisely so a caller who
   * already has a frame does not end up with two: two loops would be two frame
   * budgets and a frame of skew between the drawing and the HTML overlay, which
   * `HtmlOverlay.sync` already refuses on its own account.
   */
  const scheduler = useMemo<FrameScheduler>(
    () => ({
      request(callback: (nowMs: number) => void): unknown {
        loopFrameRef.current = callback;
        scheduleFrame();
        return LOOP_FRAME;
      },
      cancel(handle: unknown): void {
        if (handle === LOOP_FRAME) loopFrameRef.current = null;
      },
    }),
    [scheduleFrame],
  );

  /**
   * One animated frame: step the springs, draw what they say, and report
   * whether anything is still moving.
   *
   * The failure path returns `settled` rather than rethrowing. A throw would
   * leave the `requestAnimationFrame` callback, where React cannot see it and
   * where the next frame would throw again; `setFailure` takes it to the same
   * place a renderer that could not be built goes, which is `onError` or the
   * nearest boundary.
   */
  const runAnimationFrame = useCallback(
    (motion: SceneMotion, dtSeconds: number): boolean => {
      const current = stageRef.current;
      if (current === null) return true;
      try {
        const frame = motion.advance(dtSeconds);
        current.renderer.setNodes(dressNodes(frame.nodes, dressedNodesRef.current));
        current.renderer.setEdges(
          DEFAULT_EDGE_GROUP_ID,
          dressEdges(frame.edges, dressedEdgesRef.current),
        );
        // Before the draw, so a camera the caller moves from the sprung box
        // moves on this frame rather than on the next one.
        latest.current.onFrame?.(frame, current.renderer);
        current.renderer.render();
        current.overlay.sync();
        if (frame.settled) {
          // The departed are gone: the dressing is whatever the layout holds
          // now. Done on settling rather than per frame because that is the one
          // frame on which no node is mid-departure.
          dressedNodesRef.current = new Map(
            (sceneNodesRef.current ?? []).map((node) => [node.id, node]),
          );
          dressedEdgesRef.current = new Map(
            (sceneEdgesRef.current ?? []).map((edge) => [edge.id, edge]),
          );
        }
        return frame.settled;
      } catch (cause: unknown) {
        setFailure(cause);
        return true;
      }
    },
    [],
  );

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

  // The dressing the animated frames draw from, kept up to date whether or not
  // anything is animating: a caller who turns `animate` on has a map to seed
  // from, and one who changes an appearance callback without moving a node gets
  // the one frame that redraws it.
  useEffect(() => {
    if (sceneNodes !== null) {
      for (const node of sceneNodes) dressedNodesRef.current.set(node.id, node);
    }
    if (sceneEdges !== null) {
      for (const edge of sceneEdges) dressedEdgesRef.current.set(edge.id, edge);
    }
    if (motionRef.current !== null) loopRef.current?.wake();
  }, [sceneNodes, sceneEdges]);

  useEffect(() => {
    if (stage === null || sceneNodes === null) return;
    fitOnce();
    // The loop draws the nodes while it is running, from the springs rather
    // than from the layout, and setting them here as well would cut to the
    // layout on the frame the animation was supposed to begin.
    if (motionRef.current !== null) return;
    stage.renderer.setNodes(sceneNodes);
    requestDraw();
  }, [stage, sceneNodes, fitOnce, requestDraw]);

  useEffect(() => {
    if (stage === null || sceneEdges === null) return;
    if (motionRef.current !== null) return;
    stage.renderer.setEdges(DEFAULT_EDGE_GROUP_ID, sceneEdges);
    requestDraw();
  }, [stage, sceneEdges, requestDraw]);

  /**
   * The springs and the loop, built together and torn down together.
   *
   * The motion is SEEDED HERE, from the drawing as it stands, which is what
   * makes the first layout appear where the layout put it rather than springing
   * in from nowhere. It also records the layout state that seeding reflects, so
   * the effect below does not then apply that state's delta on top of it.
   */
  useEffect(() => {
    if (stage === null || !animation.enabled) return;

    const motion = createSceneMotion(animation.options);
    motion.resync(rosterNow());
    appliedRef.current = layoutRef.current;
    const loop = createMotionLoop({
      frame: (dtSeconds) => runAnimationFrame(motion, dtSeconds),
      scheduler,
    });
    motionRef.current = motion;
    loopRef.current = loop;

    return () => {
      loop.dispose();
      loopRef.current = null;
      motionRef.current = null;
      appliedRef.current = null;
      // Back to the layout, exactly, for a caller who turned animation off
      // while something was still moving: the springs are gone and whatever
      // half-way positions they were reporting are not the drawing. Skipped
      // when the stage has already gone, which is the unmount case: that
      // cleanup runs first and takes the renderer with it.
      const current = stageRef.current;
      if (current === null) return;
      if (sceneNodesRef.current !== null) current.renderer.setNodes(sceneNodesRef.current);
      if (sceneEdgesRef.current !== null) {
        current.renderer.setEdges(DEFAULT_EDGE_GROUP_ID, sceneEdgesRef.current);
      }
      requestDraw();
    };
  }, [stage, animation, scheduler, rosterNow, runAnimationFrame, requestDraw]);

  /**
   * One layout, one retarget, one wake.
   *
   * Keyed on the layout state rather than on the result, because the state is
   * what carries the delta and is what changes exactly once per layout. The
   * identity check is what keeps a re-render with the same layout from applying
   * the same delta twice, which a motion refuses by name.
   */
  useEffect(() => {
    const motion = motionRef.current;
    if (stage === null || motion === null || appliedRef.current === layout) return;
    appliedRef.current = layout;
    // A run that failed moved nothing, and the next delta is still measured
    // from the geometry the springs are holding.
    if (layout.result === null) return;
    try {
      retarget(motion, layout.delta, rosterNow());
    } catch (cause: unknown) {
      setFailure(cause);
      return;
    }
    loopRef.current?.wake();
  }, [stage, layout, rosterNow]);

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
