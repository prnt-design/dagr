import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { DagrChart } from '@prnt/dagr-chart';
import type { ChartSeries, ChartBackend } from '@prnt/dagr-chart';
import { usePrefersReducedMotion } from '@dagr/living-stage';
import { generateData } from './data.js';
import type { ChartData } from './data.js';

/**
 * `<DagrChart>` with something to change: the kind of mark, the data, and a
 * second axis. Each control only builds a new `series` prop, and the chart
 * works out what glides, what grows in and what shrinks out.
 */

type Mode = 'bars' | 'lines' | 'both' | 'total';

const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: 'bars', label: 'bars' },
  { id: 'lines', label: 'lines' },
  { id: 'both', label: 'both' },
  { id: 'total', label: 'daily + total' },
];
const AUTOPLAY_MS = 2400;
const FIRST_SEED = 7;
const TOTAL_COLOR = 0xe6edf3;

function runningTotal(values: readonly number[]): number[] {
  let sum = 0;
  return values.map((value) => (sum += value));
}

function seriesFor(data: ChartData, mode: Mode): ChartSeries[] {
  const [first] = data.series;
  if (mode === 'total' && first !== undefined) {
    return [
      first,
      {
        id: 'total',
        label: `${first.label}, running total`,
        color: TOTAL_COLOR,
        values: runningTotal(first.values),
        mark: 'line',
        axis: 'right',
      },
    ];
  }
  if (mode === 'bars') return [...data.series];
  const lines = data.series.map((series) => ({ ...series, id: `${series.id}:line`, mark: 'line' as const }));
  return mode === 'lines' ? lines : [...data.series, ...lines];
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function describeBackend(backend: ChartBackend | null): string {
  if (backend === null) return 'acquiring a device';
  if (backend === 'svg') return 'SVG';
  return backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2 fallback' : 'unknown backend';
}

function useAutoplay(on: boolean, step: () => void): void {
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    if (!on) return;
    const handle = window.setInterval(() => {
      latest.current();
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [on]);
}

export function ChartStage(): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [rendering, setRendering] = useState<'gpu' | 'svg'>('gpu');
  const [mode, setMode] = useState<Mode>('bars');
  const [seed, setSeed] = useState(FIRST_SEED);
  const [playing, setPlaying] = useState(false);
  const [backend, setBackend] = useState<ChartBackend | null>(null);

  const data = useMemo(() => generateData(seed), [seed]);
  const series = useMemo(() => seriesFor(data, mode), [data, mode]);
  const legend = series.filter((entry) => !entry.id.endsWith(':line') || mode === 'lines');

  // Reduced motion pauses the play button as well as the timer.
  const autoplaying = playing && !reduced;
  useAutoplay(autoplaying, () => {
    setSeed((value) => value + 1);
  });

  return (
    <div className="chart">
      <div className="chart__canvas">
        <DagrChart
          categories={data.categories}
          series={series}
          label="Orders and returns by month"
          onBackend={setBackend}
          rendering={rendering}
        />
      </div>

      <div className="chart__controls">
        <div className="chart__group" role="group" aria-label="Rendering">
          {(['gpu', 'svg'] as const).map((value) => (
            <button key={value} type="button" className="chart__button" aria-pressed={rendering === value}
              onClick={() => { setBackend(null); setRendering(value); }}>{value.toUpperCase()}</button>
          ))}
        </div>
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
          aria-pressed={autoplaying}
          disabled={reduced}
          onClick={() => {
            setPlaying((value) => !value);
          }}
        >
          {autoplaying ? 'pause' : 'play'}
        </button>
        <span className="chart__badge">{describeBackend(backend)}</span>
        <ul className="chart__legend" aria-label="Series">
          {legend.map((entry) => (
            <li key={entry.id} className="chart__legend-item">
              <span className="chart__swatch" style={{ background: hex(entry.color) }} />
              {entry.label}
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
