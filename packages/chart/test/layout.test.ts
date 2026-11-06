import { describe, expect, it } from 'vitest';

import { GRID_SLOTS, layoutChart } from '../src/layout.js';
import type { ChartSeries } from '../src/types.js';

const SIZE = { width: 600, height: 400 };
const CATEGORIES = ['a', 'b', 'c', 'd'];

function series(id: string, values: number[], over: Partial<ChartSeries> = {}): ChartSeries {
  return { id, label: id, color: 0xff0000, values, ...over };
}

describe('the plot area', () => {
  it('leaves room for an axis only on a side that has one', () => {
    const leftOnly = layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2, 3, 4])] }, SIZE);
    const both = layoutChart(
      {
        categories: CATEGORIES,
        series: [series('s', [1, 2, 3, 4]), series('t', [1, 2, 3, 4], { mark: 'line', axis: 'right' })],
      },
      SIZE,
    );
    expect(SIZE.width - both.plot.right).toBeGreaterThan(SIZE.width - leftOnly.plot.right);
    expect(both.plot.left).toBe(leftOnly.plot.left);
  });

  it('stays a positive area on a canvas smaller than its margins', () => {
    const { plot } = layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2, 3, 4])] }, { width: 10, height: 10 });
    expect(plot.right).toBeGreaterThan(plot.left);
    expect(plot.top).toBeGreaterThan(plot.bottom);
  });
});

describe('bars', () => {
  it('stand on zero and reach their value', () => {
    const layout = layoutChart({ categories: CATEGORIES, series: [series('s', [10, 20, 30, 40])] }, SIZE);
    const [first, , , last] = layout.bars;
    expect(first?.base).toBe(layout.plot.bottom);
    expect(last?.height).toBeCloseTo(layout.plot.top - layout.plot.bottom);
    expect(first?.height).toBeCloseTo((layout.plot.top - layout.plot.bottom) / 4);
  });

  it('hang below the zero line for a negative value', () => {
    const layout = layoutChart({ categories: ['a', 'b'], series: [series('s', [10, -10])] }, SIZE);
    const [up, down] = layout.bars;
    expect(up?.base).toBeGreaterThan(layout.plot.bottom);
    expect(up?.height).toBeGreaterThan(0);
    expect(down?.height).toBeCloseTo(-(up?.height ?? 0));
    expect(layout.gridlines.filter((line) => line.baseline)).toHaveLength(1);
  });

  it('sit side by side within a category, in series order', () => {
    const layout = layoutChart(
      { categories: CATEGORIES, series: [series('s', [1, 2, 3, 4]), series('t', [4, 3, 2, 1])] },
      SIZE,
    );
    const s = layout.bars.find((bar) => bar.id === 'bar:s:0');
    const t = layout.bars.find((bar) => bar.id === 'bar:t:0');
    expect(t?.x).toBeGreaterThan(s?.x ?? Infinity);
    expect((t?.x ?? 0) - (s?.x ?? 0)).toBeGreaterThanOrEqual(s?.width ?? Infinity);
    expect(((s?.x ?? 0) + (t?.x ?? 0)) / 2).toBeCloseTo(layout.categoryX[0] ?? NaN);
  });

  it('hang from the top of the plot when every value is negative', () => {
    const layout = layoutChart({ categories: ['a', 'b'], series: [series('s', [-10, -20])] }, SIZE);
    expect(layout.bars[0]?.base).toBeCloseTo(layout.plot.top);
    expect(layout.bars.every((bar) => bar.height < 0)).toBe(true);
  });

  it('stay centred without crossing neighboring dense category bands', () => {
    const categories = Array.from({ length: 60 }, (_, index) => String(index));
    const values = categories.map(() => 1);
    const layout = layoutChart(
      { categories, series: [series('s', values), series('t', values), series('u', values)] },
      { width: 320, height: 300 },
    );
    for (let index = 0; index < categories.length - 1; index += 1) {
      const current = layout.bars.filter((bar) => bar.index === index);
      const next = layout.bars.filter((bar) => bar.index === index + 1);
      expect(Math.max(...current.map((bar) => bar.x + bar.width / 2)))
        .toBeLessThan(Math.min(...next.map((bar) => bar.x - bar.width / 2)));
    }
    const group = layout.bars.filter((bar) => bar.index === 0);
    expect(group.every((bar) => bar.width > 0 && bar.width < 2)).toBe(true);
    expect((Math.min(...group.map((bar) => bar.x)) + Math.max(...group.map((bar) => bar.x))) / 2).toBeCloseTo(
      layout.categoryX[0] ?? NaN,
    );
  });

  it('are not narrowed by a line series beside them', () => {
    const alone = layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2, 3, 4])] }, SIZE);
    const withLine = layoutChart(
      { categories: CATEGORIES, series: [series('s', [1, 2, 3, 4]), series('t', [1, 2, 3, 4], { mark: 'line' })] },
      SIZE,
    );
    expect(withLine.bars[0]?.width).toBe(alone.bars[0]?.width);
  });
});

describe('lines', () => {
  it('put a point at each category centre, in order', () => {
    const layout = layoutChart(
      { categories: CATEGORIES, series: [series('t', [1, 2, 3, 4], { mark: 'line' })] },
      SIZE,
    );
    expect(layout.bars).toEqual([]);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]?.points.map((point) => point.x)).toEqual(layout.categoryX);
    expect(layout.lines[0]?.points.map((point) => point.id)).toEqual(['point:t:0', 'point:t:1', 'point:t:2', 'point:t:3']);
  });

  it('fit their own data on an axis with no bars, instead of starting at zero', () => {
    const layout = layoutChart(
      { categories: CATEGORIES, series: [series('t', [1000, 1010, 1020, 1030], { mark: 'line' })] },
      SIZE,
    );
    expect(layout.leftTicks[0]?.value).toBeGreaterThanOrEqual(990);
    expect(layout.gridlines.some((line) => line.baseline)).toBe(false);
  });

  it('share the zero of the bars on an axis that has them', () => {
    const layout = layoutChart(
      {
        categories: CATEGORIES,
        series: [series('s', [1, 2, 3, 4]), series('t', [1000, 1010, 1020, 1030], { mark: 'line' })],
      },
      SIZE,
    );
    expect(layout.leftTicks[0]?.value).toBe(0);
  });

  it('give a flat series a domain with some height', () => {
    const layout = layoutChart({ categories: CATEGORIES, series: [series('t', [5, 5, 5, 5], { mark: 'line' })] }, SIZE);
    const y = layout.lines[0]?.points[0]?.y ?? NaN;
    expect(y).toBeGreaterThan(layout.plot.bottom);
    expect(y).toBeLessThan(layout.plot.top);
  });
});

describe('axes', () => {
  it('scale each side from its own series', () => {
    const layout = layoutChart(
      {
        categories: CATEGORIES,
        series: [series('daily', [1, 2, 3, 4]), series('total', [100, 300, 600, 1000], { mark: 'line', axis: 'right' })],
      },
      SIZE,
    );
    expect(Math.max(...layout.leftTicks.map((tick) => tick.value))).toBe(4);
    expect(Math.max(...layout.rightTicks.map((tick) => tick.value))).toBe(1000);
    expect(layout.lines[0]?.points.at(-1)?.y).toBeCloseTo(layout.plot.top);
  });

  it('labels ticks in the D3 format for the step', () => {
    const layout = layoutChart({ categories: CATEGORIES, series: [series('s', [0.1, 0.2, 0.3, 0.4])] }, SIZE);
    expect(layout.leftTicks.map((tick) => tick.label)).toEqual(['0.0', '0.1', '0.2', '0.3', '0.4']);
  });

  it('draws gridlines from the right axis when nothing is on the left', () => {
    const layout = layoutChart(
      { categories: CATEGORIES, series: [series('t', [1, 2, 3, 4], { axis: 'right' })] },
      SIZE,
    );
    expect(layout.leftTicks).toEqual([]);
    expect(layout.gridlines.map((line) => line.y)).toEqual(layout.rightTicks.map((tick) => tick.y));
  });

  it('draws the zero line of right-hand bars under left-hand lines', () => {
    const layout = layoutChart(
      {
        categories: CATEGORIES,
        series: [series('t', [1000, 1010, 1020, 1030], { mark: 'line' }), series('s', [1, 2, 3, 4], { axis: 'right' })],
      },
      SIZE,
    );
    expect(layout.gridlines.map((line) => line.y)).toEqual(layout.rightTicks.map((tick) => tick.y));
    expect(layout.gridlines[0]).toEqual({ y: layout.bars[0]?.base, baseline: true });
  });

  it('never carries more gridlines than the scene has slots for', () => {
    const layout = layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2, 3, 97])] }, SIZE);
    expect(layout.gridlines.length).toBeLessThanOrEqual(GRID_SLOTS);
    expect(layout.gridlines.length).toBeGreaterThan(1);
  });

  it('thins the category labels on a narrow canvas', () => {
    const categories = Array.from({ length: 12 }, (_, index) => String(index));
    const values = categories.map((_, index) => index);
    const wide = layoutChart({ categories, series: [series('s', values)] }, { width: 900, height: 300 });
    const narrow = layoutChart({ categories, series: [series('s', values)] }, { width: 300, height: 300 });
    expect(wide.labelEvery).toBe(1);
    expect(narrow.labelEvery).toBeGreaterThan(1);
  });
});

describe('an empty or invalid chart', () => {
  it('lays out no marks and no gridlines for no series', () => {
    const layout = layoutChart({ categories: CATEGORIES, series: [] }, SIZE);
    expect(layout).toMatchObject({ bars: [], lines: [], leftTicks: [], rightTicks: [], gridlines: [] });
  });

  it('lays out no marks for no categories', () => {
    const layout = layoutChart({ categories: [], series: [series('s', [])] }, SIZE);
    expect(layout).toMatchObject({ bars: [], categoryX: [] });
    expect(layout.lines).toEqual([]);
  });

  it('centres a single category in the plot', () => {
    const layout = layoutChart({ categories: ['a'], series: [series('s', [3])] }, SIZE);
    expect(layout.categoryX).toEqual([(layout.plot.left + layout.plot.right) / 2]);
    expect(layout.bars[0]?.x).toBeCloseTo(layout.categoryX[0] ?? NaN);
  });

  it('refuses a size that is not finite', () => {
    expect(() => layoutChart({ categories: CATEGORIES, series: [] }, { width: NaN, height: 300 })).toThrow(
      /size has to be finite, got NaN by 300/,
    );
  });

  it('refuses two series with one id', () => {
    expect(() =>
      layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2, 3, 4]), series('s', [1, 2, 3, 4])] }, SIZE),
    ).toThrow(/two series share the id s/);
  });

  it('refuses a series without one value per category', () => {
    expect(() => layoutChart({ categories: CATEGORIES, series: [series('s', [1, 2])] }, SIZE)).toThrow(
      /series s has 2 values for 4 categories/,
    );
  });

  it('refuses a value that is not finite, naming it', () => {
    expect(() => layoutChart({ categories: CATEGORIES, series: [series('s', [1, NaN, 3, 4])] }, SIZE)).toThrow(
      /series s value 1 has to be finite, got NaN/,
    );
  });
});
