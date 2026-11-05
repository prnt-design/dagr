/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@prnt/dagr-render', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRenderer: (await import('./fake-render.js')).createRenderer,
}));

import { DagrChart } from '../src/DagrChart.js';
import type { JSX } from 'react';
import type { DagrChartProps } from '../src/DagrChart.js';
import { layoutChart } from '../src/layout.js';
import type { ChartSeries } from '../src/types.js';
import { built, lastRenderer, manualFrames, resetFakes } from './fake-render.js';
import type { ManualFrames } from './fake-render.js';
import { flush, installResizeObserver, mount, resizeTo } from './mount.js';
import type { Mounted } from './mount.js';

const CATEGORIES = ['Jan', 'Feb', 'Mar'];
const ORDERS: ChartSeries = { id: 'orders', label: 'Orders', color: 0xffb703, values: [10, 20, 30] };
const TOTAL: ChartSeries = {
  id: 'total',
  label: 'Total',
  color: 0x4ebdc4,
  values: [100, 120, 150],
  mark: 'line',
  axis: 'right',
};
const SERIES = [ORDERS, TOTAL];
const SIZE = { width: 600, height: 400 };

let frames: ManualFrames;
let tree: Mounted | null = null;

async function show(over: Partial<DagrChartProps> = {}): Promise<Mounted> {
  tree = await mount(
    <DagrChart categories={CATEGORIES} series={SERIES} label="Orders by month" scheduler={frames.scheduler} {...over} />,
  );
  return tree;
}

const text = (selector: string): string[] =>
  [...document.querySelectorAll(selector)].map((element) => element.textContent ?? '');

function move(type: string, x = 0, y = 0): void {
  const canvas = document.querySelector('canvas');
  canvas?.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}

beforeEach(() => {
  resetFakes();
  installResizeObserver();
  frames = manualFrames();
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.unstubAllGlobals();
});

describe('what it renders before a frame', () => {
  it('names the chart and carries its numbers in a table', async () => {
    await show();
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Orders by month');
    expect(document.querySelector('caption')?.textContent).toBe('Orders by month');
    expect(text('thead th')).toEqual(['Category', 'Orders', 'Total']);
    expect(text('tbody tr').map((row) => row)).toEqual(['Jan10100', 'Feb20120', 'Mar30150']);
    expect(document.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('formats the table with formatValue', async () => {
    await show({ formatValue: (value) => `${String(value)} units` });
    expect(text('tbody td')[0]).toBe('10 units');
  });

  it('draws no axis text until it has a size', async () => {
    await show();
    expect(text('.dagr-chart__tick')).toEqual([]);
  });

  it('adds a class from the caller beside its own', async () => {
    await show({ className: 'mine' });
    expect(document.querySelector('.dagr-chart')?.className).toBe('dagr-chart mine');
  });
});

describe('the renderer', () => {
  it('is built once, with the theme and the backend asked for, and reports what it came up on', async () => {
    built.backend = 'webgl2';
    const onBackend = vi.fn();
    await show({ backend: 'webgl2', onBackend, theme: { background: 0x000001, grid: 0x000002, baseline: 0x000003 } });
    expect(built.renderers).toHaveLength(1);
    expect(lastRenderer().options).toMatchObject({ backend: 'webgl2', clearColor: 0x000001 });
    expect(onBackend).toHaveBeenCalledExactlyOnceWith('webgl2');
  });

  it('is disposed on unmount', async () => {
    const mounted = await show();
    const renderer = lastRenderer();
    await mounted.unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('is disposed when it arrives after the unmount', async () => {
    built.hold = true;
    const mounted = await show();
    await mounted.unmount();
    await flush(() => built.release?.());
    expect(lastRenderer().dispose).toHaveBeenCalledOnce();
  });

  it('is rebuilt when a theme colour changes, and not when an equal theme is passed again', async () => {
    const mounted = await show({ theme: { background: 1, grid: 2, baseline: 3 } });
    await mounted.rerender(
      <DagrChart
        categories={CATEGORIES}
        series={SERIES}
        label="Orders by month"
        scheduler={frames.scheduler}
        theme={{ background: 1, grid: 2, baseline: 3 }}
      />,
    );
    expect(built.renderers).toHaveLength(1);
    await mounted.rerender(
      <DagrChart
        categories={CATEGORIES}
        series={SERIES}
        label="Orders by month"
        scheduler={frames.scheduler}
        theme={{ background: 9, grid: 2, baseline: 3 }}
      />,
    );
    expect(built.renderers).toHaveLength(2);
    expect(built.renderers[0]?.dispose).toHaveBeenCalledOnce();
  });

  it('says why when it cannot be built', async () => {
    built.failure = new Error('no adapter');
    await show();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('no adapter');
  });
});

describe('once it has a size', () => {
  it('labels both axes and the categories from the layout', async () => {
    await show();
    await resizeTo(SIZE.width, SIZE.height);
    const layout = layoutChart({ categories: CATEGORIES, series: SERIES }, SIZE);
    expect(text('.dagr-chart__tick--left')).toEqual(layout.leftTicks.map((tick) => tick.label));
    expect(text('.dagr-chart__tick--right')).toEqual(layout.rightTicks.map((tick) => tick.label));
    expect(text('.dagr-chart__category')).toEqual(CATEGORIES);
  });

  it('formats tick labels with formatValue', async () => {
    await show({ formatValue: (value) => `$${String(value)}` });
    await resizeTo(SIZE.width, SIZE.height);
    expect(text('.dagr-chart__tick--left')[0]).toBe('$0');
  });

  it('glides the first draw, so the first frame has no bar yet', async () => {
    await show();
    await resizeTo(SIZE.width, SIZE.height);
    frames.tick();
    expect(lastRenderer().nodes.some((node) => node.id.startsWith('bar:'))).toBe(false);
    frames.runUntilIdle();
    expect(lastRenderer().nodes.filter((node) => node.id.startsWith('bar:'))).toHaveLength(3);
  });

  it('draws at once with animate off', async () => {
    await show({ animate: false });
    await resizeTo(SIZE.width, SIZE.height);
    frames.tick();
    expect(lastRenderer().nodes.filter((node) => node.id.startsWith('bar:'))).toHaveLength(3);
    expect(frames.pending()).toBe(false);
  });

  it('draws at once for a reader who prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    await show();
    await resizeTo(SIZE.width, SIZE.height);
    frames.tick();
    expect(lastRenderer().nodes.filter((node) => node.id.startsWith('bar:'))).toHaveLength(3);
  });

  it('snaps to a new size and glides to new data', async () => {
    const mounted = await show();
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();

    await resizeTo(300, 400);
    frames.tick();
    expect(frames.pending()).toBe(false);

    const taller = [{ ...ORDERS, values: [30, 20, 30] }, TOTAL];
    await mounted.rerender(
      <DagrChart categories={CATEGORIES} series={taller} label="Orders by month" scheduler={frames.scheduler} />,
    );
    frames.tick();
    frames.tick();
    expect(frames.pending()).toBe(true);
  });
});

describe('what counts as a change', () => {
  it('is the data, not the arrays it arrives in', async () => {
    const mounted = await show({ animate: false });
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();
    const drawn = lastRenderer().render.mock.calls.length;
    await mounted.rerender(
      <DagrChart
        categories={[...CATEGORIES]}
        series={SERIES.map((series) => ({ ...series, values: [...series.values] }))}
        label="Orders by month"
        scheduler={frames.scheduler}
        animate={false}
      />,
    );
    expect(frames.pending()).toBe(false);
    expect(lastRenderer().render.mock.calls).toHaveLength(drawn);
  });

  it('is not a resize to the size it already has', async () => {
    await show({ animate: false });
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();
    await resizeTo(SIZE.width + 0.3, SIZE.height);
    expect(frames.pending()).toBe(false);
  });
});

describe('a lost GPU context', () => {
  const lose = (): Promise<void> =>
    flush(() => {
      lastRenderer().options.onContextLost?.({ backend: 'webgpu', reason: 'device reset' });
    });

  it('rebuilds the renderer', async () => {
    await show();
    await lose();
    expect(built.renderers).toHaveLength(2);
    expect(built.renderers[0]?.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('stops rebuilding, and says so, when it keeps happening', async () => {
    await show();
    for (let loss = 0; loss < 4; loss += 1) await lose();
    expect(built.renderers).toHaveLength(4);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'the GPU webgpu context was lost 4 times in ten seconds: device reset',
    );
  });
});

describe('hover', () => {
  async function shown(): Promise<void> {
    await show({ animate: false });
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();
  }

  it('shows the category, series and value of the picked bar, and lights it', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:1');
    await flush(() => {
      move('pointermove', 40, 50);
    });
    expect(lastRenderer().pickNode).toHaveBeenCalledWith({ x: 40, y: 50 });
    expect(document.querySelector('.dagr-chart__tooltip-label')?.textContent).toBe('Feb Orders');
    expect(document.querySelector('.dagr-chart__tooltip-value')?.textContent).toBe('20');
    frames.tick();
    expect(lastRenderer().nodes.find((node) => node.id === 'bar:orders:1')?.glowWorld).toBeGreaterThan(0);
  });

  it('shows a point on a line the same way', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValueOnce('point:total:2');
    await flush(() => {
      move('pointermove');
    });
    expect(document.querySelector('.dagr-chart__tooltip-label')?.textContent).toBe('Mar Total');
    expect(document.querySelector('.dagr-chart__tooltip-value')?.textContent).toBe('150');
  });

  it('keeps the tooltip over a gridline and clears it over nothing', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:1');
    await flush(() => {
      move('pointermove');
    });
    lastRenderer().pickNode.mockResolvedValueOnce('grid:2');
    await flush(() => {
      move('pointermove');
    });
    expect(document.querySelector('.dagr-chart__tooltip')).not.toBeNull();
    await flush(() => {
      move('pointermove');
    });
    expect(document.querySelector('.dagr-chart__tooltip')).toBeNull();
  });

  it('clears when the pointer leaves, but not when a finger lifts', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValue('bar:orders:1');
    await flush(() => {
      move('pointermove');
    });
    await flush(() => {
      document
        .querySelector('canvas')
        ?.dispatchEvent(Object.assign(new MouseEvent('pointerout', { bubbles: true }), { pointerType: 'touch' }));
    });
    expect(document.querySelector('.dagr-chart__tooltip')).not.toBeNull();
    await flush(() => {
      move('pointerout');
    });
    expect(document.querySelector('.dagr-chart__tooltip')).toBeNull();
  });

  it('follows its mark through new data, and goes when the mark does', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:1');
    await flush(() => {
      move('pointermove');
    });
    const again = (series: ChartSeries[]): JSX.Element => (
      <DagrChart
        categories={CATEGORIES}
        series={series}
        label="Orders by month"
        scheduler={frames.scheduler}
        animate={false}
      />
    );
    await tree?.rerender(again([{ ...ORDERS, values: [10, 25, 30] }, TOTAL]));
    expect(document.querySelector('.dagr-chart__tooltip-value')?.textContent).toBe('25');
    await tree?.rerender(again([TOTAL]));
    expect(document.querySelector('.dagr-chart__tooltip')).toBeNull();
  });

  it('sits below a mark that reaches the top of the plot', async () => {
    await shown();
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:0');
    await flush(() => {
      move('pointermove');
    });
    expect(document.querySelector('.dagr-chart__tooltip')?.className).toBe('dagr-chart__tooltip');
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:2');
    await flush(() => {
      move('pointermove');
    });
    expect(document.querySelector('.dagr-chart__tooltip')?.className).toContain('dagr-chart__tooltip--below');
  });

  it('ignores a pick that finishes after the pointer leaves', async () => {
    await shown();
    let finish: (id: string) => void = () => undefined;
    lastRenderer().pickNode.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await flush(() => { move('pointermove'); });
    await flush(() => { move('pointerout'); });
    await flush(() => { finish('bar:orders:1'); });
    expect(document.querySelector('.dagr-chart__tooltip')).toBeNull();
  });

  it('ignores a pick from a renderer that has been replaced', async () => {
    await shown();
    let finish: (id: string) => void = () => undefined;
    const old = lastRenderer();
    old.pickNode.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await flush(() => { move('pointermove'); });
    await flush(() => { old.options.onContextLost?.({ backend: 'webgpu', reason: 'reset' }); });
    await flush(() => { finish('bar:orders:1'); });
    expect(document.querySelector('.dagr-chart__tooltip')).toBeNull();
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:0');
    await flush(() => { move('pointermove'); });
    expect(document.querySelector('.dagr-chart__tooltip-label')?.textContent).toBe('Jan Orders');
  });

  it('survives a pick that rejects, and picks the move that arrived meanwhile', async () => {
    await shown();
    let fail: (cause: Error) => void = () => undefined;
    lastRenderer().pickNode.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    await flush(() => {
      move('pointermove', 1, 1);
    });
    await flush(() => {
      move('pointermove', 7, 8);
    });
    expect(lastRenderer().pickNode).toHaveBeenCalledTimes(1);
    lastRenderer().pickNode.mockResolvedValueOnce('bar:orders:0');
    await flush(() => {
      fail(new Error('device lost'));
    });
    expect(lastRenderer().pickNode).toHaveBeenLastCalledWith({ x: 7, y: 8 });
    expect(document.querySelector('.dagr-chart__tooltip-label')?.textContent).toBe('Jan Orders');
  });
});


describe('SVG rendering and styling', () => {
  it('draws bars, points and lines without constructing a GPU renderer', async () => {
    const onBackend = vi.fn();
    await show({ rendering: 'svg', animate: false, onBackend, className: 'rounded-xl',
      style: { '--dagr-chart-text': '#123456', borderRadius: 12 },
      classNames: { bar: 'fill-blue-500', line: 'stroke-violet-500', tick: 'text-xs', tooltip: 'bg-white' } });
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();
    expect(built.renderers).toHaveLength(0);
    expect(onBackend).toHaveBeenCalledWith('svg');
    expect(document.querySelectorAll('svg rect.dagr-chart__bar')).toHaveLength(3);
    expect(document.querySelectorAll('svg circle')).toHaveLength(3);
    expect(document.querySelector('svg path')?.getAttribute('d')).toContain(' C');
    expect(document.querySelector('svg rect.dagr-chart__bar')?.classList.contains('fill-blue-500')).toBe(true);
    expect(document.querySelector('svg path')?.classList.contains('stroke-violet-500')).toBe(true);
    expect(document.querySelector('.dagr-chart__tick')?.classList.contains('text-xs')).toBe(true);
    expect((document.querySelector('.dagr-chart') as HTMLElement).style.getPropertyValue('--dagr-chart-text')).toBe('#123456');
    const bar = layoutChart({ categories: CATEGORIES, series: SERIES }, SIZE).bars[1]!;
    await flush(() => {
      document.querySelector('svg')?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true,
        clientX: bar.x, clientY: SIZE.height - bar.base - bar.height / 2 }));
    });
    expect(document.querySelector('.dagr-chart__tooltip-value')?.textContent).toBe('20');
    expect(document.querySelector('.dagr-chart__tooltip')?.classList.contains('bg-white')).toBe(true);
  });

  it('animates SVG marks and disposes them when switching to the GPU', async () => {
    const mounted = await show({ rendering: 'svg' });
    await resizeTo(SIZE.width, SIZE.height);
    frames.tick();
    expect(document.querySelectorAll('svg .dagr-chart__bar')).toHaveLength(0);
    frames.runUntilIdle();
    expect(document.querySelectorAll('svg .dagr-chart__bar')).toHaveLength(3);
    const svg = document.querySelector('svg')!;
    await mounted.rerender(<DagrChart categories={CATEGORIES} series={SERIES} label="Orders" scheduler={frames.scheduler} />);
    expect(svg.children).toHaveLength(0);
    expect(document.querySelector('svg')).toBeNull();
    expect(built.renderers).toHaveLength(1);
    await mounted.rerender(<DagrChart categories={CATEGORIES} series={SERIES} label="Orders" scheduler={frames.scheduler} rendering="svg" />);
    frames.runUntilIdle();
    expect(lastRenderer().dispose).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('svg .dagr-chart__bar')).toHaveLength(3);
  });

  it('updates SVG classes without recreating marks or restarting animation', async () => {
    const mounted = await show({ rendering: 'svg', animate: false });
    await resizeTo(SIZE.width, SIZE.height);
    frames.runUntilIdle();
    const bar = document.querySelector('.dagr-chart__bar');
    await mounted.rerender(<DagrChart categories={CATEGORIES} series={SERIES} label="Orders" scheduler={frames.scheduler}
      rendering="svg" animate={false} classNames={{ bar: 'fill-red-500' }} />);
    frames.runUntilIdle();
    expect(document.querySelector('.dagr-chart__bar')).toBe(bar);
    expect(bar?.classList.contains('fill-red-500')).toBe(true);
  });
});
