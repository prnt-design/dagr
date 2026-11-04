import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { usePrefersReducedMotion } from '@dagr/living-stage';
import type { RendererBackend } from '@prnt/dagr-render';
import { layoutChart } from './chart-layout.js';
import type { ChartMode, Size } from './chart-layout.js';
import { createChartScene } from './chart-scene.js';
import type { ChartScene } from './chart-scene.js';
import { generateData } from './data.js';

/**
 * A bar and line chart drawn by `@prnt/dagr-render`: the experiment that asks
 * whether the graph renderer has a charting story. The GPU draws the marks,
 * the DOM draws the text, and every change glides on the renderer's springs.
 */

const MODES: readonly { readonly id: ChartMode; readonly label: string }[] = [
  { id: 'bars', label: 'bars' },
  { id: 'line', label: 'line' },
  { id: 'both', label: 'both' },
];
const AUTOPLAY_MS = 2400;
const FIRST_SEED = 7;

interface Hover {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color: number;
  readonly x: number;
  readonly top: number;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function describeBackend(backend: RendererBackend | null): string {
  if (backend === null) return 'acquiring a device';
  return backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2 fallback' : 'unknown backend';
}

export function ChartStage(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ChartScene | null>(null);
  const pickingRef = useRef(false);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const reduced = usePrefersReducedMotion();

  const [scene, setScene] = useState<ChartScene | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [mode, setMode] = useState<ChartMode>('bars');
  const [seed, setSeed] = useState(FIRST_SEED);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  const data = useMemo(() => generateData(seed), [seed]);
  const layout = useMemo(() => layoutChart(data, mode, size), [data, mode, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (canvas === null || host === null) return;
    let live = true;
    let made: ChartScene | null = null;
    const abort = new AbortController();
    setFailure(null);

    createChartScene({
      canvas,
      signal: abort.signal,
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
      })
      .catch((cause: unknown) => {
        if (live) setFailure(cause instanceof Error ? cause.message : String(cause));
      });

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(host);

    return () => {
      live = false;
      abort.abort();
      observer.disconnect();
      pickingRef.current = false;
      pendingRef.current = null;
      made?.dispose();
      sceneRef.current = null;
      setScene(null);
    };
  }, [epoch]);

  useEffect(() => {
    if (scene === null || size.width === 0 || size.height === 0) return;
    scene.resize(size);
  }, [scene, size]);

  useEffect(() => {
    if (scene === null || size.width === 0 || size.height === 0) return;
    // A resize alone snaps: the data did not change, so nothing should glide.
    const key = `${String(seed)}:${mode}`;
    const resizeOnly = lastKeyRef.current === key;
    lastKeyRef.current = key;
    scene.retarget(layout, { snap: reduced || resizeOnly, stagger: true });
    // The tooltip was read off the old layout, so it comes back on the next move.
    scene.setHover(null);
    setHover(null);
  }, [scene, layout, seed, mode, size, reduced]);

  useEffect(() => {
    if (!playing || reduced) return;
    const handle = window.setInterval(() => {
      setSeed((value) => value + 1);
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [playing, reduced]);

  const pickAt = (current: ChartScene, point: { x: number; y: number }): void => {
    pickingRef.current = true;
    void current
      .pick(point)
      .catch(() => null)
      .then((id) => {
        pickingRef.current = false;
        // A move that arrived mid-pick is picked now, so the pointer's resting
        // place is never the one that was dropped.
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) pickAt(current, pending);
        // A gridline is not a hover target, and it is not a reason to lose one.
        if (id !== null && id.startsWith('grid:')) return;
        const bar = id === null ? undefined : layout.bars.find((b) => b.id === id);
        if (bar === undefined) {
          current.setHover(null);
          setHover(null);
          return;
        }
        current.setHover(bar.id);
        setHover({
          id: bar.id,
          label: `${data.categories[bar.index] ?? ''} ${data.series[bar.seriesIndex]?.label ?? ''}`,
          value: bar.value,
          color: bar.color,
          x: bar.x,
          top: size.height - (layout.plot.bottom + bar.height),
        });
      });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = sceneRef.current;
    if (current === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (pickingRef.current) {
      pendingRef.current = point;
      return;
    }
    pickAt(current, point);
  };

  const onPointerLeave = (): void => {
    sceneRef.current?.setHover(null);
    setHover(null);
  };

  const ready = size.width > 0 && size.height > 0;

  return (
    <div className="chart">
      <div className="chart__canvas" ref={hostRef}>
        <canvas
          className="chart__surface"
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
        {ready &&
          layout.ticks.map((tick) => (
            <span
              key={tick.value}
              className="chart__tick"
              style={{ top: size.height - tick.y, left: layout.plot.left - 8 }}
            >
              {tick.value}
            </span>
          ))}
        {ready &&
          layout.categoryX.map((x, index) => index % layout.labelEvery === 0 && (
            <span
              key={data.categories[index]}
              className="chart__category"
              style={{ left: x, top: size.height - layout.plot.bottom + 8 }}
            >
              {data.categories[index]}
            </span>
          ))}
        {hover !== null && (
          <div
            className="chart__tooltip"
            style={{ left: hover.x, top: hover.top, borderColor: hex(hover.color) }}
          >
            <span className="chart__tooltip-label">{hover.label}</span>
            <span className="chart__tooltip-value">{hover.value}</span>
          </div>
        )}
        <span className="chart__badge">{describeBackend(scene?.renderer.backend ?? null)}</span>
        {failure !== null && <p className="chart__failure">renderer failed: {failure}</p>}
      </div>

      <div className="chart__controls">
        <div className="chart__group" role="group" aria-label="Chart kind">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="chart__button"
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="chart__button"
          onClick={() => {
            setSeed((value) => value + 1);
          }}
        >
          new data
        </button>
        <button
          type="button"
          className="chart__button"
          aria-pressed={playing}
          disabled={reduced}
          onClick={() => {
            setPlaying((value) => !value);
          }}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <ul className="chart__legend" aria-label="Series">
          {data.series.map((series) => (
            <li key={series.id} className="chart__legend-item">
              <span className="chart__swatch" style={{ background: hex(series.color) }} />
              {series.label}
            </li>
          ))}
        </ul>
        {reduced && (
          <p className="chart__reduced">
            Reduced motion is on, so changes cut to the new chart instead of gliding.
          </p>
        )}
      </div>
    </div>
  );
}
