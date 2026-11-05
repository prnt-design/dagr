import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { BackendPreference, FrameScheduler, RendererBackend } from '@prnt/dagr-render';
import { layoutChart } from './layout.js';
import { createChartScene } from './scene.js';
import type { ChartScene } from './scene.js';
import { DEFAULT_THEME } from './types.js';
import type { ChartSeries, ChartSize, ChartTheme } from './types.js';
import { usePrefersReducedMotion } from './use-reduced-motion.js';

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
  readonly onBackend?: ((backend: RendererBackend) => void) | undefined;
  readonly className?: string | undefined;
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

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * A bar and line chart on Dagr's renderer. It fills the element it is given:
 * the GPU draws the marks, the DOM draws the text, and a visually hidden
 * table carries the same numbers.
 */
export function DagrChart(props: DagrChartProps): JSX.Element {
  const { categories, series, label, formatValue, backend, scheduler } = props;
  const { background, grid, baseline } = props.theme ?? DEFAULT_THEME;
  const reduced = usePrefersReducedMotion();
  const animate = (props.animate ?? true) && !reduced;

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ChartScene | null>(null);
  const picking = useRef(false);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const drawn = useRef<unknown>(null);
  const onBackend = useRef(props.onBackend);
  onBackend.current = props.onBackend;

  const [scene, setScene] = useState<ChartScene | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<ChartSize>({ width: 0, height: 0 });
  const [tip, setTip] = useState<Tip | null>(null);

  const data = useMemo(() => ({ categories, series }), [categories, series]);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (canvas === null || root === null) return;
    let live = true;
    let made: ChartScene | null = null;
    const abort = new AbortController();
    setFailure(null);

    createChartScene({
      canvas,
      theme: { background, grid, baseline },
      signal: abort.signal,
      backend,
      scheduler,
      onContextLost: () => {
        if (live) setEpoch((value) => value + 1);
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
        onBackend.current?.(created.renderer.backend);
      })
      .catch((cause: unknown) => {
        if (live) setFailure(cause instanceof Error ? cause.message : String(cause));
      });

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
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
    };
  }, [epoch, background, grid, baseline, backend, scheduler]);

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
    // The tooltip was read off the old layout, so it comes back on the next move.
    scene.setHover(null);
    setTip(null);
  }, [scene, layout, data, ready, animate]);

  const pickAt = (current: ChartScene, point: { x: number; y: number }): void => {
    picking.current = true;
    void current
      .pick(point)
      .catch(() => null)
      .then((id) => {
        picking.current = false;
        // A move that arrived mid-pick is picked now, so the pointer's resting
        // place is never the one that was dropped.
        const next = pending.current;
        pending.current = null;
        if (next !== null) pickAt(current, next);
        // A gridline is not a hover target, and it is not a reason to lose one.
        if (id !== null && id.startsWith('grid:')) return;
        const found = id === null ? undefined : tips.get(id);
        current.setHover(found === undefined ? null : id);
        setTip(found ?? null);
      });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
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

  const onPointerLeave = (): void => {
    pending.current = null;
    sceneRef.current?.setHover(null);
    setTip(null);
  };

  const format = (value: number): string => formatValue?.(value) ?? String(value);
  const flip = (y: number): number => size.height - y;

  return (
    <div
      ref={rootRef}
      className={props.className === undefined ? 'dagr-chart' : `dagr-chart ${props.className}`}
      role="group"
      aria-label={label}
    >
      <canvas
        ref={canvasRef}
        className="dagr-chart__canvas"
        aria-hidden="true"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={onPointerLeave}
      />
      {ready && (
        <div className="dagr-chart__axes" aria-hidden="true">
          {layout.leftTicks.map((tick) => (
            <span
              key={`left:${String(tick.value)}`}
              className="dagr-chart__tick dagr-chart__tick--left"
              style={{ top: flip(tick.y), left: layout.plot.left - 8 }}
            >
              {formatValue?.(tick.value) ?? tick.label}
            </span>
          ))}
          {layout.rightTicks.map((tick) => (
            <span
              key={`right:${String(tick.value)}`}
              className="dagr-chart__tick dagr-chart__tick--right"
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
                  className="dagr-chart__category"
                  style={{ left: x, top: flip(layout.plot.bottom) + 8 }}
                >
                  {categories[index]}
                </span>
              ),
          )}
        </div>
      )}
      {tip !== null && (
        <div
          className="dagr-chart__tooltip"
          aria-hidden="true"
          style={{ left: tip.x, top: tip.top, borderColor: hex(tip.color) }}
        >
          <span className="dagr-chart__tooltip-label">{tip.label}</span>
          <span className="dagr-chart__tooltip-value">{format(tip.value)}</span>
        </div>
      )}
      {failure !== null && (
        <p className="dagr-chart__failure" role="alert">
          {failure}
        </p>
      )}
      <table className="dagr-chart__table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <td />
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
