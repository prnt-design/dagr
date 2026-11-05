/**
 * Where everything on the chart belongs, as a pure function of the data, the
 * mode and the canvas size. The scene springs towards this; nothing here moves.
 *
 * World units are CSS pixels with y UP and the origin at the canvas's
 * bottom-left, so the camera sits at zoom 1 over the canvas's centre and the
 * DOM labels around the canvas can use the same numbers with one y flip.
 */

import { max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import type { ChartData } from './data.js';

export type ChartMode = 'bars' | 'line' | 'both';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The plot's extents in world units. `bottom` is the baseline, below `top`. */
export interface PlotArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface BarTarget {
  readonly id: string;
  readonly seriesIndex: number;
  readonly index: number;
  readonly x: number;
  readonly width: number;
  /** Zero in line mode, so the bars sink into the baseline. */
  readonly height: number;
  readonly color: number;
  readonly value: number;
}

export interface PointTarget {
  readonly id: string;
  readonly seriesIndex: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** The marker's radius, zero in bars mode. */
  readonly radius: number;
  readonly color: number;
  readonly value: number;
}

export interface Tick {
  readonly value: number;
  readonly y: number;
}

export interface ChartLayout {
  readonly plot: PlotArea;
  readonly bars: readonly BarTarget[];
  readonly points: readonly PointTarget[];
  readonly ticks: readonly Tick[];
  /** The centre of each category's slot, for the month labels. */
  readonly categoryX: readonly number[];
  /** Label every nth category, so a narrow canvas does not run the months together. */
  readonly labelEvery: number;
  readonly maxValue: number;
  /** The line's target opacity: hidden in bars mode. */
  readonly lineAlpha: number;
}

export const MARGIN = { left: 48, right: 16, top: 24, bottom: 36 } as const;
const TICK_COUNT = 5;
const GROUP_GAP = 0.28;
const BAR_GAP = 4;
const MARKER_RADIUS = 5;
/** The narrowest slot a three-letter month label fits in. */
const LABEL_SLOT = 36;

/**
 * The most gridlines the scene ever draws. It keeps this many nodes whatever
 * the tick count, because a gridline added later would be drawn over the bars.
 */
export const GRID_SLOTS = 12;

export function layoutChart(data: ChartData, mode: ChartMode, size: Size): ChartLayout {
  const plot: PlotArea = {
    left: MARGIN.left,
    right: Math.max(MARGIN.left + 1, size.width - MARGIN.right),
    top: Math.max(MARGIN.bottom + 1, size.height - MARGIN.top),
    bottom: MARGIN.bottom,
  };
  // The scales are D3's and the pixels are the renderer's: `nice` rounds the
  // domain to the tick step, so the top gridline is always a round number.
  const y = scaleLinear()
    .domain([0, max(data.series, (s) => max(s.values)) ?? 1])
    .nice(TICK_COUNT)
    .range([plot.bottom, plot.top]);
  // An outer padding of half the inner one centres each group in its slot.
  const band = scaleBand<number>()
    .domain(data.categories.map((_, i) => i))
    .range([plot.left, plot.right])
    .paddingInner(GROUP_GAP)
    .paddingOuter(GROUP_GAP / 2);
  const yOf = (value: number): number => y(value);
  const maxValue = y.domain()[1] ?? 1;

  const slot = band.step();
  const groupWidth = band.bandwidth();
  const categoryX = data.categories.map((_, i) => (band(i) ?? plot.left) + groupWidth / 2);
  const seriesCount = Math.max(1, data.series.length);
  const barWidth = Math.max(2, (groupWidth - BAR_GAP * (seriesCount - 1)) / seriesCount);

  const bars: BarTarget[] = [];
  const points: PointTarget[] = [];
  data.series.forEach((series, seriesIndex) => {
    series.values.forEach((value, index) => {
      const centre = categoryX[index] ?? plot.left;
      const groupLeft = centre - groupWidth / 2;
      const x = groupLeft + seriesIndex * (barWidth + BAR_GAP) + barWidth / 2;
      bars.push({
        id: `bar:${series.id}:${String(index)}`,
        seriesIndex,
        index,
        x,
        width: barWidth,
        height: mode === 'line' ? 0 : yOf(value) - plot.bottom,
        color: series.color,
        value,
      });
      points.push({
        id: `point:${series.id}:${String(index)}`,
        seriesIndex,
        index,
        x: mode === 'both' ? x : centre,
        y: yOf(value),
        radius: mode === 'bars' ? 0 : MARKER_RADIUS,
        color: series.color,
        value,
      });
    });
  });

  const ticks: Tick[] = y
    .ticks(TICK_COUNT)
    .slice(0, GRID_SLOTS)
    .map((value) => ({ value, y: yOf(value) }));

  return {
    plot,
    bars,
    points,
    ticks,
    categoryX,
    labelEvery: Math.max(1, Math.ceil(LABEL_SLOT / slot)),
    maxValue,
    lineAlpha: mode === 'bars' ? 0 : 1,
  };
}
