/**
 * The chart on the GPU: bars and markers are instanced SDF nodes, each series'
 * line is a smooth ribbon, and every number that changes gets there on a
 * critically damped spring.
 *
 * The renderer draws exactly what it is handed each frame, so this module owns
 * the springs and the loop and builds a fresh `SceneNode` list from them. The
 * camera is pinned at zoom 1 over the canvas, which is what makes world units
 * CSS pixels (see `chart-layout.ts`).
 */

import {
  createMotionLoop,
  createRenderer,
  omegaForHalfLife,
  stepSpring,
} from '@prnt/dagr-render';
import type {
  ContextLostInfo,
  Renderer,
  SceneEdge,
  SceneNode,
  SpringState,
  Vec2,
} from '@prnt/dagr-render';
import { GRID_SLOTS } from './chart-layout.js';
import type { ChartLayout } from './chart-layout.js';

export const CLEAR_COLOR = 0x11161b;
const GRID_COLOR = 0x222a32;
const BASELINE_COLOR = 0x3a4653;
const HOVER_GLOW_WORLD = 12;
const LINE_GROUP = 'lines';
const LINE_HALF_WIDTH_PIXELS = 1.6;

/** Values a spring at rest is allowed to be off by before it snaps. */
const REST_DISTANCE = 0.05;
const REST_VELOCITY = 0.5;
/** The cascade across a series: each bar starts this much later than the last. */
const STAGGER_SECONDS = 0.025;

const OMEGA = omegaForHalfLife(0.11);

interface Sprung {
  x: SpringState;
  y: SpringState;
  size: SpringState;
  /** Seconds left before this spring starts moving. The stagger. */
  delay: number;
  readonly color: number;
}

export interface RetargetOptions {
  /** Jump straight to the layout. Reduced motion, and the first resize. */
  readonly snap: boolean;
  /** Cascade the motion across the categories. */
  readonly stagger: boolean;
}

export interface ChartScene {
  readonly renderer: Renderer;
  retarget(layout: ChartLayout, options: RetargetOptions): void;
  /** Lights one bar's halo, or none. */
  setHover(id: string | null): void;
  pick(point: Vec2): Promise<string | null>;
  resize(size: { width: number; height: number }): void;
  dispose(): void;
}

export interface ChartSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly onContextLost: (info: ContextLostInfo) => void;
}

function at(value: number): SpringState {
  return { position: value, velocity: 0 };
}

function settled(spring: SpringState, target: number): boolean {
  return (
    Math.abs(spring.position - target) < REST_DISTANCE &&
    Math.abs(spring.velocity) < REST_VELOCITY
  );
}

/** Steps one axis, honouring its delay, and reports whether it is still moving. */
function advance(spring: SpringState, target: number, dt: number): { state: SpringState; moving: boolean } {
  if (settled(spring, target)) return { state: at(target), moving: false };
  return { state: stepSpring(spring, target, OMEGA, dt), moving: true };
}

export async function createChartScene(options: ChartSceneOptions): Promise<ChartScene> {
  const renderer = await createRenderer({
    canvas: options.canvas,
    signal: options.signal,
    clearColor: CLEAR_COLOR,
    sceneStyle: { outlineColor: CLEAR_COLOR, glowAlpha: 0.55, outlinePixels: 1 },
    edgeGroups: [
      { id: LINE_GROUP, style: { halfWidthPixels: LINE_HALF_WIDTH_PIXELS }, curve: 'smooth' },
    ],
    onContextLost: options.onContextLost,
  });

  const bars = new Map<string, Sprung>();
  const points = new Map<string, Sprung>();
  let lineAlpha = at(0);
  let layout: ChartLayout | null = null;
  let hovered: string | null = null;
  const dpr = (): number => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);

  const frame = (dtSeconds: number): boolean => {
    if (layout === null) return true;
    let moving = false;
    const stepAxis = (sprung: Sprung, key: 'x' | 'y' | 'size', target: number, dt: number): void => {
      const result = advance(sprung[key], target, dt);
      sprung[key] = result.state;
      if (result.moving) moving = true;
    };
    const stepSprung = (sprung: Sprung, x: number, y: number, size: number): void => {
      let dt = dtSeconds;
      if (sprung.delay > 0) {
        const consumed = Math.min(sprung.delay, dt);
        sprung.delay -= consumed;
        dt -= consumed;
        if (dt <= 0) {
          moving = true;
          return;
        }
      }
      stepAxis(sprung, 'x', x, dt);
      stepAxis(sprung, 'y', y, dt);
      stepAxis(sprung, 'size', size, dt);
    };

    const nodes: SceneNode[] = [];
    const { plot } = layout;
    // Keyed by position, not value, and always GRID_SLOTS of them, so a
    // rescale moves the lines rather than adding or replacing any: blend order
    // within a shape family is slot order, and a line created later would be
    // appended after the bars and drawn over them. Spare slots sit on the
    // first tick.
    const first = layout.ticks[0];
    for (let index = 0; first !== undefined && index < GRID_SLOTS; index += 1) {
      const tick = layout.ticks[index] ?? first;
      const baseline = tick.value === 0;
      nodes.push({
        id: `grid:${String(index)}`,
        shape: 'roundedRect',
        center: { x: (plot.left + plot.right) / 2, y: tick.y },
        size: { width: plot.right - plot.left, height: 1 },
        cornerRadius: 0,
        fillColor: baseline ? BASELINE_COLOR : GRID_COLOR,
        glowColor: GRID_COLOR,
        glowWorld: 0,
      });
    }

    for (const target of layout.bars) {
      const sprung = bars.get(target.id);
      if (sprung === undefined) continue;
      stepSprung(sprung, target.x, target.height, target.width);
      const height = sprung.y.position;
      if (height < 0.5) continue;
      const lit = hovered === target.id;
      nodes.push({
        id: target.id,
        shape: 'roundedRect',
        center: { x: sprung.x.position, y: plot.bottom + height / 2 },
        size: { width: sprung.size.position, height },
        cornerRadius: Math.min(3, sprung.size.position / 2, height / 2),
        fillColor: target.color,
        glowColor: target.color,
        glowWorld: lit ? HOVER_GLOW_WORLD : 0,
      });
    }

    const lines = new Map<number, Vec2[]>();
    for (const target of layout.points) {
      const sprung = points.get(target.id);
      if (sprung === undefined) continue;
      stepSprung(sprung, target.x, target.y, target.radius);
      const position = { x: sprung.x.position, y: sprung.y.position };
      const route = lines.get(target.seriesIndex) ?? [];
      route.push(position);
      lines.set(target.seriesIndex, route);
      const diameter = sprung.size.position * 2;
      if (diameter < 1) continue;
      nodes.push({
        id: target.id,
        shape: 'circle',
        center: position,
        size: { width: diameter, height: diameter },
        fillColor: target.color,
        glowColor: target.color,
        glowWorld: 0,
      });
    }

    // In percent, so the pixel-scale rest thresholds do not snap the fade
    // while it is still visible.
    const alpha = advance(lineAlpha, layout.lineAlpha * 100, dtSeconds);
    lineAlpha = alpha.state;
    if (alpha.moving) moving = true;

    const edges: SceneEdge[] = [];
    for (const [seriesIndex, route] of lines) {
      if (route.length < 2) continue;
      const color = layout.points.find((p) => p.seriesIndex === seriesIndex)?.color ?? GRID_COLOR;
      edges.push({ id: `line:${String(seriesIndex)}`, points: route, color });
    }

    renderer.setNodes(nodes);
    renderer.setEdges(LINE_GROUP, edges);
    renderer.setEdgeStyle(LINE_GROUP, {
      halfWidthPixels: LINE_HALF_WIDTH_PIXELS * dpr(),
      alpha: Math.min(1, Math.max(0, lineAlpha.position / 100)),
    });
    renderer.render();
    return !moving;
  };

  const loop = createMotionLoop({ frame });

  const reseat = (
    store: Map<string, Sprung>,
    targets: readonly { id: string; x: number; index: number; color: number }[],
    valueOf: (target: { id: string }) => { y: number; size: number },
    options: RetargetOptions,
    restY: number,
  ): void => {
    const seen = new Set<string>();
    for (const target of targets) {
      seen.add(target.id);
      const { y, size } = valueOf(target);
      const existing = store.get(target.id);
      if (options.snap) {
        store.set(target.id, { x: at(target.x), y: at(y), size: at(size), delay: 0, color: target.color });
      } else if (existing === undefined) {
        store.set(target.id, {
          x: at(target.x),
          y: at(restY),
          size: at(0),
          delay: options.stagger ? target.index * STAGGER_SECONDS : 0,
          color: target.color,
        });
      } else {
        existing.delay = options.stagger ? target.index * STAGGER_SECONDS : 0;
      }
    }
    for (const id of store.keys()) if (!seen.has(id)) store.delete(id);
  };

  const scene: ChartScene = {
    renderer,
    retarget(next, options) {
      layout = next;
      const byId = new Map<string, { y: number; size: number }>();
      for (const bar of next.bars) byId.set(bar.id, { y: bar.height, size: bar.width });
      for (const point of next.points) byId.set(point.id, { y: point.y, size: point.radius });
      const lookup = (target: { id: string }): { y: number; size: number } =>
        byId.get(target.id) ?? { y: 0, size: 0 };
      reseat(bars, next.bars, lookup, options, 0);
      reseat(points, next.points, lookup, options, next.plot.bottom);
      if (options.snap) lineAlpha = at(next.lineAlpha * 100);
      loop.wake();
    },
    setHover(id) {
      if (id === hovered) return;
      hovered = id;
      loop.wake();
    },
    pick: (point) => renderer.pickNode(point),
    resize(size) {
      renderer.camera.setViewport({ ...size, devicePixelRatio: dpr() });
      renderer.camera.setZoom(1);
      renderer.camera.setCenter({ x: size.width / 2, y: size.height / 2 });
      loop.wake();
    },
    dispose() {
      loop.dispose();
      renderer.dispose();
    },
  };
  return scene;
}
