import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { BackendPreference, FrameScheduler, RendererBackend } from '@prnt/dagr-render';
import { layoutChart } from './layout.js';
import { createChartScene } from './scene.js';
import type { ChartScene } from './scene.js';
import { DEFAULT_THEME } from './types.js';
import type { ChartSeries, ChartSize, ChartTheme } from './types.js';
import { classes } from './styling.js';
import type { ChartClassNames, ChartCssColors, ChartStyle } from './styling.js';
import { useCssColors } from './use-css-colors.js';
import { usePrefersReducedMotion } from './use-reduced-motion.js';

export type ChartBackend = RendererBackend | 'svg';

export interface DagrChartProps {
  readonly categories: readonly string[];
  /** Drawn in this order. A series keeps its marks, and their motion, by `id`. */
  readonly series: readonly ChartSeries[];
  /** What the chart shows. It names the chart and captions its data table for assistive technology. */
  readonly label: string;
  /** Whether a change glides. Default true, and off whenever the reader prefers reduced motion. */
  readonly animate?: boolean | undefined;
  /** Formats tick labels, the tooltip and the data table. Default: D3's tick format, and the plain number. */
  readonly formatValue?: ((value: number) => string) | undefined;
  /** The colours the GPU draws. Changing one rebuilds the renderer. */
  readonly theme?: ChartTheme | undefined;
  /** Default `'auto'`: WebGPU where the browser has it, WebGL2 where it does not. */
  readonly backend?: BackendPreference | undefined;
  /** Called once per renderer with the backend it came up on. */
  readonly onBackend?: ((backend: ChartBackend) => void) | undefined;
  readonly className?: string | undefined;
  readonly classNames?: ChartClassNames | undefined;
  readonly style?: ChartStyle | undefined;
  /** GPU by default. SVG shares the layout and springs without acquiring a device. */
  readonly rendering?: 'gpu' | 'svg' | undefined;
  /** Bind GPU/SVG colours to inherited CSS variables, including Tailwind theme tokens. */
  readonly cssColors?: ChartCssColors | undefined;
  /** Where frames come from, for a host that already runs a frame loop. Keep it stable. */
  readonly scheduler?: FrameScheduler | undefined;
}

interface Tip {
  readonly label: string;
  readonly value: number;
  readonly color: number;
  readonly x: number;
  readonly top: number;
}

/** More losses than this inside the window is a device that will not stay up. */
const MAX_LOSSES = 3;
const LOSS_WINDOW_MS = 10_000;
/** The room a tooltip needs above its mark, and to either side of its centre. */
const TOOLTIP_ROOM = 44;
const TOOLTIP_EDGE = 64;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * A bar and line chart on Dagr's renderer. It fills the element it is given:
 * the GPU draws the marks, the DOM draws the text, and a visually hidden
 * table carries the same numbers.
 */
export function DagrChart(props: DagrChartProps): JSX.Element {
  const { label, formatValue, backend, scheduler } = props;
  const reduced = usePrefersReducedMotion();
  const animate = (props.animate ?? true) && !reduced;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const css = useCssColors(rootRef, props.cssColors);
  const theme = props.theme ?? DEFAULT_THEME;
  const background = css[props.cssColors?.background ?? ''] ?? theme.background;
  const grid = css[props.cssColors?.grid ?? ''] ?? theme.grid;
  const baseline = css[props.cssColors?.baseline ?? ''] ?? theme.baseline;
  const slots = props.classNames ?? {};
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const rendering = props.rendering ?? 'gpu';
  const sceneRef = useRef<ChartScene | null>(null);
  const picking = useRef(false);
  const hoverGeneration = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const drawn = useRef<unknown>(null);
  const losses = useRef<number[]>([]);
  const onBackend = useRef(props.onBackend);
  onBackend.current = props.onBackend;

  const [scene, setScene] = useState<ChartScene | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Keyed by content, not identity: a caller's inline `series={[...]}` is a
  // new array every render, and that is not a change to animate.
  const resolvedSeries = props.series.map((series) => ({ ...series,
    color: css[props.cssColors?.series?.[series.id] ?? ''] ?? series.color,
  }));
  const dataKey = JSON.stringify([props.categories, resolvedSeries]);
  const data = useMemo(
    () => ({ categories: props.categories, series: resolvedSeries }),
    [dataKey],
  );
  const { categories, series } = data;
  const layout = useMemo(() => layoutChart(data, size), [data, size]);
  const ready = size.width > 0 && size.height > 0;

  const tips = useMemo(() => {
    const found = new Map<string, Tip>();
    const labelOf = (seriesId: string, index: number): string =>
      `${categories[index] ?? ''} ${series.find((s) => s.id === seriesId)?.label ?? ''}`.trim();
    for (const bar of layout.bars) {
      found.set(bar.id, {
        label: labelOf(bar.seriesId, bar.index),
        value: bar.value,
        color: bar.color,
        x: bar.x,
        top: size.height - (bar.base + Math.max(bar.height, 0)),
      });
    }
    for (const line of layout.lines) {
      for (const point of line.points) {
        found.set(point.id, {
          label: labelOf(point.seriesId, point.index),
          value: point.value,
          color: point.color,
          x: point.x,
          top: size.height - point.y - point.radius,
        });
      }
    }
    return found;
  }, [layout, categories, series, size.height]);

  const latestTips = useRef(tips);
  latestTips.current = tips;

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const svg = svgRef.current;
    if (root === null || (rendering === 'svg' ? svg === null : canvas === null)) return;
    let live = true;
    let made: ChartScene | null = null;
    const abort = new AbortController();
    setFailure(null);

    createChartScene({
      ...(rendering === 'svg' ? { svg: svg! } : { canvas: canvas! }),
      getClasses: () => slotsRef.current,
      theme: { background, grid, baseline },
      signal: abort.signal,
      backend,
      scheduler,
      onContextLost: (info) => {
        if (!live) return;
        const now = Date.now();
        losses.current = [...losses.current.filter((at) => now - at < LOSS_WINDOW_MS), now];
        if (losses.current.length > MAX_LOSSES) {
          setFailure(
            `the GPU ${info.backend} context was lost ${String(losses.current.length)} times in ten seconds: ${info.reason}`,
          );
          return;
        }
        setEpoch((value) => value + 1);
      },
    })
      .then((created) => {
        if (!live) {
          created.dispose();
          return;
        }
        made = created;
        sceneRef.current = created;
        setScene(created);
        onBackend.current?.(rendering === 'svg' ? 'svg' : created.renderer.backend);
      })
      .catch((cause: unknown) => {
        if (live) setFailure(cause instanceof Error ? cause.message : String(cause));
      });

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    });
    observer.observe(root);

    return () => {
      live = false;
      abort.abort();
      observer.disconnect();
      picking.current = false;
      pending.current = null;
      drawn.current = null;
      made?.dispose();
      sceneRef.current = null;
      setScene(null);
      setHoverId(null);
    };
  }, [epoch, background, grid, baseline, backend, scheduler, rendering]);

  useEffect(() => {
    if (scene === null || !ready) return;
    scene.resize(size);
  }, [scene, size, ready]);

  useEffect(() => {
    if (scene === null || !ready) return;
    // The same data at a new size is a resize, and a resize does not glide.
    const resized = drawn.current === data;
    drawn.current = data;
    scene.retarget(layout, { snap: !animate || resized, stagger: true });
  }, [scene, layout, data, ready, animate]);

  // Keep the current value and target anchor while a mark changes.
  const tip = hoverId === null ? undefined : tips.get(hoverId);
  useEffect(() => {
    if (hoverId === null || tips.has(hoverId)) return;
    sceneRef.current?.setHover(null);
    setHoverId(null);
  }, [hoverId, tips]);

  const pickAt = (current: ChartScene, point: { x: number; y: number }): void => {
    picking.current = true;
    const generation = hoverGeneration.current;
    void current
      .pick(point)
      .catch(() => null)
      .then((id) => {
        // A renderer built meanwhile owns the two flags now.
        if (sceneRef.current !== current) return;
        picking.current = false;
        // A move that arrived mid-pick is picked now, so the pointer's resting
        // place is never the one that was dropped.
        const next = pending.current;
        pending.current = null;
        if (next !== null) pickAt(current, next);
        if (generation !== hoverGeneration.current) return;
        // A gridline is not a hover target, and it is not a reason to lose one.
        if (id !== null && id.startsWith('grid:')) return;
        const found = id !== null && latestTips.current.has(id) ? id : null;
        current.setHover(found);
        setHoverId(found);
      });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement | SVGSVGElement>): void => {
    const current = sceneRef.current;
    if (current === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (picking.current) {
      pending.current = point;
      return;
    }
    pickAt(current, point);
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLCanvasElement | SVGSVGElement>): void => {
    // A finger leaves the moment it lifts, and a tap is how touch asks.
    if (event.pointerType === 'touch') return;
    hoverGeneration.current += 1;
    pending.current = null;
    sceneRef.current?.setHover(null);
    setHoverId(null);
  };

  const slotKey = JSON.stringify(slots);
  useEffect(() => { scene?.refresh(); }, [scene, slotKey]);

  const format = (value: number): string => formatValue?.(value) ?? String(value);
  const flip = (y: number): number => size.height - y;

  return (
    <div
      ref={rootRef}
      className={props.className === undefined ? 'dagr-chart' : `dagr-chart ${props.className}`}
      style={props.style}
      data-rendering={rendering}
      role="group"
      aria-label={label}
    >
      {rendering === 'svg' ? (
        <svg ref={svgRef} className={classes('dagr-chart__canvas', slots.canvas)} aria-hidden="true"
          onPointerMove={onPointerMove} onPointerDown={onPointerMove} onPointerLeave={onPointerLeave} />
      ) : (
        <canvas ref={canvasRef} className={classes('dagr-chart__canvas', slots.canvas)} aria-hidden="true"
          onPointerMove={onPointerMove} onPointerDown={onPointerMove} onPointerLeave={onPointerLeave} />
      )}
      {ready && (
        <div className={classes('dagr-chart__axes', slots.axes)} aria-hidden="true">
          {layout.leftTicks.map((tick) => (
            <span
              key={`left:${String(tick.value)}`}
              className={classes(classes('dagr-chart__tick dagr-chart__tick--left', slots.tick), slots.leftTick)}
              style={{ top: flip(tick.y), left: layout.plot.left - 8 }}
            >
              {formatValue?.(tick.value) ?? tick.label}
            </span>
          ))}
          {layout.rightTicks.map((tick) => (
            <span
              key={`right:${String(tick.value)}`}
              className={classes(classes('dagr-chart__tick dagr-chart__tick--right', slots.tick), slots.rightTick)}
              style={{ top: flip(tick.y), left: layout.plot.right + 8 }}
            >
              {formatValue?.(tick.value) ?? tick.label}
            </span>
          ))}
          {layout.categoryX.map(
            (x, index) =>
              index % layout.labelEvery === 0 && (
                <span
                  key={index}
                  className={classes('dagr-chart__category', slots.category)}
                  style={{ left: x, top: flip(layout.plot.bottom) + 8 }}
                >
                  {categories[index]}
                </span>
              ),
          )}
        </div>
      )}
      {tip !== undefined && (
        <div
          className={
            classes(tip.top < TOOLTIP_ROOM ? 'dagr-chart__tooltip dagr-chart__tooltip--below' : 'dagr-chart__tooltip', slots.tooltip)
          }
          aria-hidden="true"
          style={{
            left: size.width < TOOLTIP_EDGE * 2
              ? size.width / 2
              : Math.min(Math.max(tip.x, TOOLTIP_EDGE), size.width - TOOLTIP_EDGE),
            top: tip.top,
            '--dagr-chart-series-color': hex(tip.color),
          } as ChartStyle}
        >
          <span className={classes('dagr-chart__tooltip-label', slots.tooltipLabel)}>{tip.label}</span>
          <span className={classes('dagr-chart__tooltip-value', slots.tooltipValue)}>{format(tip.value)}</span>
        </div>
      )}
      {failure !== null && (
        <p className={classes('dagr-chart__failure', slots.failure)} role="alert">
          {failure}
        </p>
      )}
      <table className={classes('dagr-chart__table', slots.table)}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={index}>
              <th scope="row">{category}</th>
              {series.map((s) => (
                <td key={s.id}>{format(s.values[index] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
