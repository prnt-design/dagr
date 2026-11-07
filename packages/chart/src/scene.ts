/**
 * The chart on the GPU: bars and markers are instanced SDF nodes, each line is
 * a linear ribbon, and every number that changes gets there on a critically
 * damped spring.
 *
 * Marks are keyed by id across layouts, which is the whole of the animation
 * model. A mark in both layouts glides, a new one grows in, and one that left
 * shrinks out before it is dropped. The renderer draws exactly what it is
 * handed each frame, so this module owns the springs and the loop.
 */

import { createMotionLoop, createRenderer, omegaForHalfLife, stepSpring } from '@prnt/dagr-render';
import type {
  BackendPreference,
  ContextLostInfo,
  FrameScheduler,
  Renderer,
  SceneEdge,
  SceneNode,
  SpringState,
  Vec2,
} from '@prnt/dagr-render';
import { createSvgRenderer } from './svg-renderer.js';
import type { ChartClassNames } from './styling.js';
import { GRID_SLOTS } from './layout.js';
import type { ChartLayout, Gridline } from './layout.js';
import type { ChartSize, ChartTheme } from './types.js';

const LINE_GROUP = 'lines';
const LINE_HALF_WIDTH_PIXELS = 1.6;
const HOVER_GLOW_WORLD = 12;
const BAR_CORNER_RADIUS = 3;

/** How far a spring may be from its target, in world units, before it snaps. */
const REST_DISTANCE = 0.05;
const REST_VELOCITY = 0.5;
/** The cascade across the categories: each mark starts this much after the last. */
const STAGGER_SECONDS = 0.025;
const OMEGA = omegaForHalfLife(0.11);
/**
 * A line's intensity is sprung from 0 to this rather than to 1, so the rest
 * thresholds above, which are sized for pixels, do not snap a fade that is
 * still visible.
 */
const FULL = 100;

interface Channel {
  state: SpringState;
  target: number;
}

interface Bar {
  readonly x: Channel;
  readonly base: Channel;
  readonly height: Channel;
  readonly width: Channel;
  delay: number;
  color: number;
  exiting: boolean;
}

interface Point {
  readonly x: Channel;
  readonly y: Channel;
  readonly radius: Channel;
  delay: number;
}

interface Line {
  readonly intensity: Channel;
  /** In layout order, which is the order the ribbon runs in. */
  points: Map<string, Point>;
  color: number;
  exiting: boolean;
}

export interface RetargetOptions {
  /** Jump straight to the layout: reduced motion, and a resize. */
  readonly snap: boolean;
  /** Cascade the motion across the categories. */
  readonly stagger: boolean;
}

export interface ChartScene {
  readonly renderer: Renderer;
  retarget(layout: ChartLayout, options: RetargetOptions): void;
  /** Lights one mark's halo, or none. */
  setHover(id: string | null): void;
  /** The id of the mark under a pointer, in CSS pixels from the canvas's top-left. */
  pick(point: Vec2): Promise<string | null>;
  resize(size: ChartSize): void;
  refresh(): void;
  dispose(): void;
}

export interface ChartSceneOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly svg?: SVGSVGElement;
  readonly getClasses?: () => ChartClassNames;
  readonly theme: ChartTheme;
  readonly signal?: AbortSignal | undefined;
  readonly backend?: BackendPreference | undefined;
  readonly onContextLost?: ((info: ContextLostInfo) => void) | undefined;
  readonly scheduler?: FrameScheduler | undefined;
}

function channel(value: number, target = value): Channel {
  return { state: { position: value, velocity: 0 }, target };
}

/** Steps one channel and says whether it is still moving. */
function step(moved: Channel, dtSeconds: number): boolean {
  const { position, velocity } = moved.state;
  if (Math.abs(position - moved.target) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY) {
    moved.state = { position: moved.target, velocity: 0 };
    return false;
  }
  moved.state = stepSpring(moved.state, moved.target, OMEGA, dtSeconds);
  return true;
}

/** Whether every channel is exactly on its target, as a settled one is left. */
function resting(channels: readonly Channel[]): boolean {
  return channels.every((moved) => moved.state.position === moved.target && moved.state.velocity === 0);
}

function pixelRatio(): number {
  return typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
}

export async function createChartScene(options: ChartSceneOptions): Promise<ChartScene> {
  const { theme } = options;
  if (options.svg === undefined && options.canvas === undefined) throw new Error("a chart needs a drawing surface");
  const renderer = options.svg !== undefined
    ? createSvgRenderer(options.svg, theme.background, options.getClasses ?? (() => ({})))
    : await createRenderer({
    canvas: options.canvas!,
    clearColor: theme.background,
    sceneStyle: { outlineColor: theme.background, glowAlpha: 0.55, outlinePixels: 1 },
    edgeGroups: [{ id: LINE_GROUP, style: { halfWidthPixels: LINE_HALF_WIDTH_PIXELS }, curve: 'polyline' }],
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.backend === undefined ? {} : { backend: options.backend }),
    ...(options.onContextLost === undefined ? {} : { onContextLost: options.onContextLost }),
  });

  const bars = new Map<string, Bar>();
  const lines = new Map<string, Line>();
  let layout: ChartLayout | null = null;
  let gridlines: readonly Gridline[] = [];
  let hovered: string | null = null;

  const frame = (dtSeconds: number): boolean => {
    if (layout === null) return true;
    let moving = false;
    /** Steps one mark, after its delay, and says whether it is still moving. */
    const advance = (mark: { delay: number }, channels: readonly Channel[]): boolean => {
      let dt = dtSeconds;
      if (mark.delay > 0) {
        const waited = Math.min(mark.delay, dt);
        mark.delay -= waited;
        dt -= waited;
        if (dt <= 0) {
          moving = true;
          return true;
        }
      }
      let still = false;
      for (const moved of channels) {
        if (step(moved, dt)) still = true;
      }
      if (still) moving = true;
      return still;
    };

    const nodes: SceneNode[] = [];
    const { plot } = layout;
    // Always GRID_SLOTS of them, keyed by position: blend order within a shape
    // family is slot order, so a line created after the bars would be drawn
    // over them. Spare slots sit on the first line. A layout with nothing to
    // measure keeps the last grid until its marks have left, for the same
    // reason: a grid dropped and recreated under exiting bars lands above them.
    if (layout.gridlines.length > 0) gridlines = layout.gridlines;
    else if (bars.size === 0 && lines.size === 0) gridlines = [];
    const first = gridlines[0];
    for (let index = 0; first !== undefined && index < GRID_SLOTS; index += 1) {
      const line = gridlines[index] ?? first;
      nodes.push({
        id: `grid:${String(index)}`,
        shape: 'roundedRect',
        center: { x: (plot.left + plot.right) / 2, y: line.y },
        size: { width: plot.right - plot.left, height: 1 },
        cornerRadius: 0,
        fillColor: line.baseline ? theme.baseline : theme.grid,
        glowColor: theme.grid,
        glowWorld: 0,
      });
    }

    for (const [id, bar] of bars) {
      const still = advance(bar, [bar.x, bar.base, bar.height, bar.width]);
      const height = bar.height.state.position;
      const extent = Math.abs(height);
      if (bar.exiting && !still) {
        bars.delete(id);
        continue;
      }
      if (extent < 0.5) continue;
      const width = bar.width.state.position;
      nodes.push({
        id,
        shape: 'roundedRect',
        center: { x: bar.x.state.position, y: bar.base.state.position + height / 2 },
        size: { width, height: extent },
        cornerRadius: Math.min(BAR_CORNER_RADIUS, width / 2, extent / 2),
        fillColor: bar.color,
        glowColor: bar.color,
        glowWorld: hovered === id ? HOVER_GLOW_WORLD : 0,
      });
    }

    const edges: SceneEdge[] = [];
    const intensities = new Map<string, number>();
    for (const [seriesId, line] of lines) {
      const fading = step(line.intensity, dtSeconds);
      if (fading) moving = true;
      if (line.exiting && !fading) {
        lines.delete(seriesId);
        continue;
      }
      const route: Vec2[] = [];
      for (const [id, point] of line.points) {
        advance(point, [point.x, point.y, point.radius]);
        const center = { x: point.x.state.position, y: point.y.state.position };
        route.push(center);
        const diameter = point.radius.state.position * 2;
        if (diameter < 1) continue;
        nodes.push({
          id,
          shape: 'circle',
          center,
          size: { width: diameter, height: diameter },
          fillColor: line.color,
          glowColor: line.color,
          glowWorld: hovered === id ? HOVER_GLOW_WORLD / 2 : 0,
        });
      }
      if (route.length < 2) continue;
      const edgeId = `line:${seriesId}`;
      edges.push({ id: edgeId, points: route, color: line.color });
      intensities.set(edgeId, Math.min(1, Math.max(0, line.intensity.state.position / FULL)));
    }

    // The final exit can settle in this frame, after the grid was queued.
    if (layout.gridlines.length === 0 && bars.size === 0 && lines.size === 0) {
      gridlines = [];
      nodes.length = 0;
    }

    renderer.setNodes(nodes);
    renderer.setEdges(LINE_GROUP, edges);
    renderer.setEdgeIntensity(LINE_GROUP, (edgeId) => intensities.get(edgeId) ?? 1);
    renderer.setEdgeStyle(LINE_GROUP, { halfWidthPixels: LINE_HALF_WIDTH_PIXELS * pixelRatio(), alpha: 1 });
    renderer.render();
    return !moving;
  };

  const loop = createMotionLoop({ frame, scheduler: options.scheduler });

  return {
    renderer,
    retarget(next, { snap, stagger }) {
      layout = next;
      const delayOf = (index: number): number => (snap || !stagger ? 0 : index * STAGGER_SECONDS);

      const keptBars = new Set<string>();
      for (const target of next.bars) {
        keptBars.add(target.id);
        const bar = bars.get(target.id);
        if (bar === undefined || snap) {
          bars.set(target.id, {
            x: channel(target.x),
            base: channel(target.base),
            height: channel(snap ? target.height : 0, target.height),
            width: channel(target.width),
            delay: delayOf(target.index),
            color: target.color,
            exiting: false,
          });
          continue;
        }
        // A bar already on its way is retargeted at once: a fresh delay would
        // hold it still in mid-flight.
        const wasResting = resting([bar.x, bar.base, bar.height, bar.width]);
        bar.x.target = target.x;
        bar.base.target = target.base;
        bar.height.target = target.height;
        bar.width.target = target.width;
        bar.delay = wasResting && !resting([bar.x, bar.base, bar.height, bar.width]) ? delayOf(target.index) : 0;
        bar.color = target.color;
        bar.exiting = false;
      }
      for (const [id, bar] of bars) {
        if (keptBars.has(id)) continue;
        if (snap) {
          bars.delete(id);
          continue;
        }
        bar.height.target = 0;
        bar.delay = 0;
        bar.exiting = true;
      }

      const keptLines = new Set<string>();
      for (const target of next.lines) {
        keptLines.add(target.seriesId);
        let line = lines.get(target.seriesId);
        if (line === undefined || snap) {
          line = {
            intensity: channel(snap ? FULL : 0, FULL),
            points: new Map<string, Point>(),
            color: target.color,
            exiting: false,
          };
          lines.set(target.seriesId, line);
        } else {
          line.intensity.target = FULL;
          line.color = target.color;
          line.exiting = false;
        }
        // Rebuilt in layout order. A point the layout dropped goes at once: a
        // ribbon cannot keep a vertex its series no longer has.
        const points = new Map<string, Point>();
        for (const to of target.points) {
          const point = line.points.get(to.id);
          if (point === undefined || snap) {
            points.set(to.id, {
              x: channel(to.x),
              y: channel(snap ? to.y : next.plot.bottom, to.y),
              radius: channel(snap ? to.radius : 0, to.radius),
              delay: delayOf(to.index),
            });
            continue;
          }
          const wasResting = resting([point.x, point.y, point.radius]);
          point.x.target = to.x;
          point.y.target = to.y;
          point.radius.target = to.radius;
          point.delay = wasResting && !resting([point.x, point.y, point.radius]) ? delayOf(to.index) : 0;
          points.set(to.id, point);
        }
        line.points = points;
      }
      for (const [seriesId, line] of lines) {
        if (keptLines.has(seriesId)) continue;
        if (snap) {
          lines.delete(seriesId);
          continue;
        }
        line.intensity.target = 0;
        line.exiting = true;
        for (const point of line.points.values()) {
          point.radius.target = 0;
          point.delay = 0;
        }
      }
      loop.wake();
    },
    setHover(id) {
      if (id === hovered) return;
      hovered = id;
      loop.wake();
    },
    pick: (point) => renderer.pickNode(point),
    resize(size) {
      renderer.camera.setViewport({ ...size, devicePixelRatio: pixelRatio() });
      renderer.camera.setZoom(1);
      renderer.camera.setCenter({ x: size.width / 2, y: size.height / 2 });
      loop.wake();
    },
    refresh: () => loop.wake(),
    dispose() {
      loop.dispose();
      renderer.dispose();
    },
  };
}
