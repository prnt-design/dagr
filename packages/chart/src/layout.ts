/**
 * Where every mark belongs, as a pure function of the data and the canvas
 * size. The scene springs towards this; nothing here moves.
 *
 * World units are CSS pixels with y UP and the origin at the canvas's
 * bottom-left, so the camera sits at zoom 1 over the canvas's centre and the
 * DOM text around the canvas uses the same numbers with one y flip. The scales
 * are D3's and the pixels are the renderer's.
 */

import { extent } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import type { ScaleLinear } from 'd3-scale';
import type { ChartAxis, ChartData, ChartSeries, ChartSize } from './types.js';

/** The plot's extents in world units. `bottom` is below `top`. */
export interface PlotArea {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface BarTarget {
  readonly id: string;
  readonly seriesId: string;
  readonly index: number;
  readonly x: number;
  readonly width: number;
  /** Where its axis puts zero. */
  readonly base: number;
  /** Signed: a negative value hangs below `base`. */
  readonly height: number;
  readonly color: number;
  readonly value: number;
}

export interface PointTarget {
  readonly id: string;
  readonly seriesId: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
  readonly value: number;
}

export interface LineTarget {
  readonly seriesId: string;
  readonly color: number;
  readonly points: readonly PointTarget[];
}

export interface Tick {
  readonly value: number;
  readonly y: number;
  /** D3's formatting for this axis's tick step. */
  readonly label: string;
}

export interface Gridline {
  readonly y: number;
  /** The line at zero, drawn in the theme's baseline colour. */
  readonly baseline: boolean;
}

export interface ChartLayout {
  readonly size: ChartSize;
  readonly plot: PlotArea;
  readonly bars: readonly BarTarget[];
  readonly lines: readonly LineTarget[];
  readonly leftTicks: readonly Tick[];
  readonly rightTicks: readonly Tick[];
  /** From the left axis, or the right when only the right one carries bars or has any series. */
  readonly gridlines: readonly Gridline[];
  /** The centre of each category's slot. */
  readonly categoryX: readonly number[];
  /** Label every nth category, so a narrow canvas does not run them together. */
  readonly labelEvery: number;
}

/**
 * The most gridlines a layout carries. The scene keeps exactly this many
 * nodes whatever the tick count, because one created later would be drawn
 * over the bars.
 */
export const GRID_SLOTS = 12;

const MARGIN = { top: 24, bottom: 36, withAxis: 52, withoutAxis: 16 } as const;
const TICK_COUNT = 5;
const GROUP_GAP = 0.28;
const BAR_GAP = 4;
const MARKER_RADIUS = 5;
/** The narrowest slot a short category label fits in. */
const LABEL_SLOT = 36;

const axisOf = (series: ChartSeries): ChartAxis => series.axis ?? 'left';
const isBar = (series: ChartSeries): boolean => (series.mark ?? 'bar') === 'bar';

function requireInput(data: ChartData, size: ChartSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    throw new RangeError(`the chart's size has to be finite, got ${String(size.width)} by ${String(size.height)}`);
  }
  const seen = new Set<string>();
  for (const series of data.series) {
    if (seen.has(series.id)) throw new RangeError(`two series share the id ${series.id}`);
    seen.add(series.id);
    if (series.values.length !== data.categories.length) {
      throw new RangeError(
        `series ${series.id} has ${String(series.values.length)} values for ${String(data.categories.length)} categories`,
      );
    }
    const bad = series.values.findIndex((value) => !Number.isFinite(value));
    if (bad >= 0) {
      throw new RangeError(`series ${series.id} value ${String(bad)} has to be finite, got ${String(series.values[bad])}`);
    }
  }
}

/**
 * One axis's scale, or null when no series is on it.
 *
 * An axis that carries a bar includes zero, because a bar's length is its
 * value. An axis of lines alone fits its data, which is what keeps a large,
 * slowly moving total readable beside small daily bars.
 */
function axisScale(series: readonly ChartSeries[], plot: PlotArea): ScaleLinear<number, number> | null {
  if (series.length === 0) return null;
  const [low = 0, high = 0] = extent(series.flatMap((s) => s.values));
  const anchored = series.some(isBar);
  let domain: [number, number] = anchored ? [Math.min(0, low), Math.max(0, high)] : [low, high];
  if (domain[0] === domain[1]) domain = anchored ? [0, 1] : [domain[0] - 1, domain[1] + 1];
  return scaleLinear().domain(domain).nice(TICK_COUNT).range([plot.bottom, plot.top]);
}

function ticksOf(scale: ScaleLinear<number, number> | null): Tick[] {
  if (scale === null) return [];
  const format = scale.tickFormat(TICK_COUNT);
  return scale
    .ticks(TICK_COUNT)
    .slice(0, GRID_SLOTS)
    .map((value) => ({ value, y: scale(value), label: format(value) }));
}

/**
 * @throws {RangeError} when two series share an id, a series does not have one
 *   value per category, or a value or the size is not finite.
 */
export function layoutChart(data: ChartData, size: ChartSize): ChartLayout {
  requireInput(data, size);
  const onLeft = data.series.filter((series) => axisOf(series) === 'left');
  const onRight = data.series.filter((series) => axisOf(series) === 'right');
  const left = onLeft.length > 0 ? MARGIN.withAxis : MARGIN.withoutAxis;
  const right = onRight.length > 0 ? MARGIN.withAxis : MARGIN.withoutAxis;
  const plot: PlotArea = {
    left,
    right: Math.max(left + 1, size.width - right),
    top: Math.max(MARGIN.bottom + 1, size.height - MARGIN.top),
    bottom: MARGIN.bottom,
  };
  const scales = { left: axisScale(onLeft, plot), right: axisScale(onRight, plot) };
  // An outer padding of half the inner one centres each group in its slot.
  const band = scaleBand<number>()
    .domain(data.categories.map((_, index) => index))
    .range([plot.left, plot.right])
    .paddingInner(GROUP_GAP)
    .paddingOuter(GROUP_GAP / 2);
  const groupWidth = band.bandwidth();
  const categoryX = data.categories.map((_, index) => (band(index) ?? plot.left) + groupWidth / 2);

  const barSeries = data.series.filter(isBar);
  const barWidth = Math.max(2, (groupWidth - BAR_GAP * (barSeries.length - 1)) / Math.max(1, barSeries.length));
  // What the bars take up, which is wider than the group once the width is
  // floored, so a crowded group still straddles its category.
  const barsWidth = barSeries.length * barWidth + (barSeries.length - 1) * BAR_GAP;

  const bars: BarTarget[] = [];
  const lines: LineTarget[] = [];
  for (const series of data.series) {
    const scale = scales[axisOf(series)];
    if (scale === null) continue;
    if (isBar(series)) {
      const slot = barSeries.indexOf(series);
      const base = scale(0);
      series.values.forEach((value, index) => {
        const centre = categoryX[index] ?? plot.left;
        bars.push({
          id: `bar:${series.id}:${String(index)}`,
          seriesId: series.id,
          index,
          x: centre - barsWidth / 2 + slot * (barWidth + BAR_GAP) + barWidth / 2,
          width: barWidth,
          base,
          height: scale(value) - base,
          color: series.color,
          value,
        });
      });
    } else {
      lines.push({
        seriesId: series.id,
        color: series.color,
        points: series.values.map((value, index) => ({
          id: `point:${series.id}:${String(index)}`,
          seriesId: series.id,
          index,
          x: categoryX[index] ?? plot.left,
          y: scale(value),
          radius: MARKER_RADIUS,
          color: series.color,
          value,
        })),
      });
    }
  }

  const leftTicks = ticksOf(scales.left);
  const rightTicks = ticksOf(scales.right);
  // The grid follows the left axis, unless only the right one carries bars:
  // their zero line is the one that has to be drawn.
  const gridFromRight = onLeft.length === 0 || (!onLeft.some(isBar) && onRight.some(isBar));
  return {
    size,
    plot,
    bars,
    lines,
    leftTicks,
    rightTicks,
    gridlines: (gridFromRight ? rightTicks : leftTicks).map((tick) => ({
      y: tick.y,
      baseline: tick.value === 0,
    })),
    categoryX,
    labelEvery: Math.max(1, Math.ceil(LABEL_SLOT / Math.max(1, band.step()))),
  };
}
