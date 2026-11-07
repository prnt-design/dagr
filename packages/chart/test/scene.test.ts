import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneNode } from '@prnt/dagr-render';

vi.mock('@prnt/dagr-render', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRenderer: (await import('./fake-render.js')).createRenderer,
}));

import { GRID_SLOTS, layoutChart } from '../src/layout.js';
import { createChartScene } from '../src/scene.js';
import type { ChartScene } from '../src/scene.js';
import { DEFAULT_THEME } from '../src/types.js';
import type { ChartSeries } from '../src/types.js';
import { lastRenderer, manualFrames, resetFakes } from './fake-render.js';
import type { FakeRenderer, ManualFrames } from './fake-render.js';

const SIZE = { width: 600, height: 400 };
const CATEGORIES = ['a', 'b', 'c', 'd'];
const GLIDE = { snap: false, stagger: false };
const SNAP = { snap: true, stagger: false };

function bars(id: string, values: number[]): ChartSeries {
  return { id, label: id, color: 0xff0000, values };
}

function line(id: string, values: number[]): ChartSeries {
  return { id, label: id, color: 0x00ff00, values, mark: 'line' };
}

const chart = (...series: ChartSeries[]) => layoutChart({ categories: CATEGORIES, series }, SIZE);

let frames: ManualFrames;
let scene: ChartScene;
let renderer: FakeRenderer;

const node = (id: string): SceneNode | undefined => renderer.nodes.find((drawn) => drawn.id === id);
const drawnIds = (prefix: string): string[] =>
  renderer.nodes.filter((drawn) => drawn.id.startsWith(prefix)).map((drawn) => drawn.id);

beforeEach(async () => {
  resetFakes();
  frames = manualFrames();
  scene = await createChartScene({
    canvas: {} as HTMLCanvasElement,
    theme: DEFAULT_THEME,
    scheduler: frames.scheduler,
  });
  renderer = lastRenderer();
});

describe('the renderer it builds', () => {
  it('clears to the theme background and declares one linear edge group', () => {
    expect(renderer.options.clearColor).toBe(DEFAULT_THEME.background);
    expect(renderer.options.edgeGroups).toEqual([expect.objectContaining({ curve: 'polyline' })]);
  });

  it('pins the camera at zoom 1 over the canvas on resize', () => {
    scene.resize(SIZE);
    expect(renderer.camera.zoom).toBe(1);
    expect(renderer.camera.center).toEqual({ x: 300, y: 200 });
    expect(renderer.camera.viewport).toMatchObject(SIZE);
  });
});

describe('a first layout', () => {
  it('grows each bar from the zero line to its value', () => {
    const layout = chart(bars('s', [10, 20, 30, 40]));
    scene.retarget(layout, GLIDE);
    frames.tick();
    expect(drawnIds('bar:')).toEqual([]);

    frames.tick();
    const rising = node('bar:s:3');
    expect(rising?.size.height).toBeGreaterThan(0);
    expect(rising?.size.height).toBeLessThan(layout.bars[3]?.height ?? 0);

    frames.runUntilIdle();
    for (const target of layout.bars) {
      expect(node(target.id)).toMatchObject({
        center: { x: target.x, y: target.base + target.height / 2 },
        size: { width: target.width, height: target.height },
        fillColor: target.color,
      });
    }
    expect(renderer.render).toHaveBeenCalled();
  });

  it('is drawn at its targets in one frame when snapped, and the loop stops', () => {
    const layout = chart(bars('s', [10, 20, 30, 40]));
    scene.retarget(layout, SNAP);
    frames.tick();
    expect(node('bar:s:0')?.size.height).toBe(layout.bars[0]?.height);
    expect(frames.pending()).toBe(false);
  });

  it('starts later bars later when staggered', () => {
    scene.retarget(chart(bars('s', [40, 40, 40, 40])), { snap: false, stagger: true });
    frames.tick();
    frames.tick();
    frames.tick();
    const first = node('bar:s:0')?.size.height ?? 0;
    const last = node('bar:s:3')?.size.height ?? 0;
    expect(first).toBeGreaterThan(last);
  });
});

describe('a later layout', () => {
  it('glides a bar from where it is, not from zero', () => {
    const before = chart(bars('s', [40, 40, 40, 40]));
    scene.retarget(before, SNAP);
    frames.runUntilIdle();
    const after = chart(bars('s', [20, 40, 40, 40]));
    scene.retarget(after, GLIDE);
    frames.tick();
    frames.tick();
    const height = node('bar:s:0')?.size.height ?? 0;
    expect(height).toBeLessThan(before.bars[0]?.height ?? 0);
    expect(height).toBeGreaterThan(after.bars[0]?.height ?? 0);
    frames.runUntilIdle();
    expect(node('bar:s:0')?.size.height).toBeCloseTo(after.bars[0]?.height ?? 0);
  });

  it('shrinks a bar that left before dropping it', () => {
    scene.retarget(chart(bars('s', [40, 40, 40, 40]), bars('t', [40, 40, 40, 40])), SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(bars('s', [40, 40, 40, 40])), GLIDE);
    frames.tick();
    frames.tick();
    expect(node('bar:t:0')?.size.height).toBeGreaterThan(0);
    frames.runUntilIdle();
    expect(drawnIds('bar:t:')).toEqual([]);
    expect(drawnIds('bar:s:')).toHaveLength(4);
  });

  it('brings back a bar that returns before it has finished leaving', () => {
    const both = chart(bars('s', [40, 40, 40, 40]), bars('t', [40, 40, 40, 40]));
    scene.retarget(both, SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(bars('s', [40, 40, 40, 40])), GLIDE);
    frames.tick();
    frames.tick();
    scene.retarget(both, GLIDE);
    frames.runUntilIdle();
    expect(drawnIds('bar:t:')).toHaveLength(4);
    expect(node('bar:t:0')?.size.height).toBeCloseTo(both.bars.find((bar) => bar.id === 'bar:t:0')?.height ?? NaN);
  });

  it('does not hold a bar still when it is retargeted in mid-flight', () => {
    const cascade = { snap: false, stagger: true };
    scene.retarget(chart(bars('s', [40, 40, 40, 80])), SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(bars('s', [10, 10, 10, 80])), cascade);
    for (let tick = 0; tick < 8; tick += 1) frames.tick();
    const before = node('bar:s:2')?.size.height;
    scene.retarget(chart(bars('s', [30, 30, 30, 80])), cascade);
    frames.tick();
    expect(node('bar:s:2')?.size.height).not.toBe(before);
  });

  it('drops a bar that left at once when snapped', () => {
    scene.retarget(chart(bars('s', [40, 40, 40, 40]), bars('t', [40, 40, 40, 40])), SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(bars('s', [40, 40, 40, 40])), SNAP);
    frames.tick();
    expect(drawnIds('bar:t:')).toEqual([]);
  });

  it('draws a negative bar below the zero line with a positive size', () => {
    const layout = layoutChart({ categories: ['a', 'b'], series: [bars('s', [10, -10])] }, SIZE);
    scene.retarget(layout, SNAP);
    frames.tick();
    const down = node('bar:s:1');
    expect(down?.size.height).toBeCloseTo(Math.abs(layout.bars[1]?.height ?? 0));
    expect(down?.center.y).toBeLessThan(layout.bars[1]?.base ?? 0);
  });
});

describe('gridlines', () => {
  it('are always the first GRID_SLOTS nodes, whatever the tick count', () => {
    for (const values of [
      [1, 2, 3, 4],
      [10, 20, 30, 97],
    ]) {
      scene.retarget(chart(bars('s', values)), SNAP);
      frames.tick();
      expect(renderer.nodes.slice(0, GRID_SLOTS).map((drawn) => drawn.id)).toEqual(
        Array.from({ length: GRID_SLOTS }, (_, index) => `grid:${String(index)}`),
      );
      expect(renderer.nodes[GRID_SLOTS]?.id).toBe('bar:s:0');
    }
  });

  it('draw the zero line in the baseline colour', () => {
    scene.retarget(chart(bars('s', [1, 2, 3, 4])), SNAP);
    frames.tick();
    expect(node('grid:0')?.fillColor).toBe(DEFAULT_THEME.baseline);
    expect(node('grid:1')?.fillColor).toBe(DEFAULT_THEME.grid);
  });

  it('stay under bars that are leaving, and under ones that come back', () => {
    const gridIds = Array.from({ length: GRID_SLOTS }, (_, index) => `grid:${String(index)}`);
    const firstIds = (): string[] => renderer.nodes.slice(0, GRID_SLOTS).map((drawn) => drawn.id);
    scene.retarget(chart(bars('s', [10, 20, 30, 40])), SNAP);
    frames.runUntilIdle();

    scene.retarget(chart(), GLIDE);
    frames.tick();
    frames.tick();
    expect(drawnIds('bar:').length).toBeGreaterThan(0);
    expect(firstIds()).toEqual(gridIds);

    scene.retarget(chart(bars('s', [10, 20, 30, 40])), GLIDE);
    frames.tick();
    expect(firstIds()).toEqual(gridIds);

    scene.retarget(chart(), GLIDE);
    frames.runUntilIdle();
    expect(renderer.nodes).toEqual([]);
  });

  it('are absent when there is nothing to measure', () => {
    scene.retarget(chart(), SNAP);
    frames.tick();
    expect(renderer.nodes).toEqual([]);
  });
});

describe('lines', () => {
  it('run one ribbon through the points in category order, with a marker on each', () => {
    const layout = chart(line('t', [1, 2, 3, 4]));
    scene.retarget(layout, SNAP);
    frames.tick();
    expect(renderer.edges).toEqual([
      {
        id: 'line:t',
        color: 0x00ff00,
        points: layout.lines[0]?.points.map((point) => ({ x: point.x, y: point.y })),
      },
    ]);
    expect(renderer.intensityOf('line:t')).toBe(1);
    expect(drawnIds('point:t:')).toHaveLength(4);
    expect(node('point:t:0')).toMatchObject({ shape: 'circle', size: { width: 10, height: 10 } });
  });

  it('fade in, with points rising from the bottom of the plot', () => {
    const layout = chart(line('t', [1, 2, 3, 4]));
    scene.retarget(layout, GLIDE);
    frames.tick();
    expect(renderer.intensityOf('line:t')).toBe(0);
    expect(renderer.edges[0]?.points[3]?.y).toBe(layout.plot.bottom);
    frames.tick();
    frames.tick();
    expect(renderer.intensityOf('line:t')).toBeGreaterThan(0);
    expect(renderer.intensityOf('line:t')).toBeLessThan(1);
    frames.runUntilIdle();
    expect(renderer.intensityOf('line:t')).toBe(1);
    expect(renderer.edges[0]?.points[3]?.y).toBeCloseTo(layout.lines[0]?.points[3]?.y ?? NaN);
  });

  it('fade out before they are dropped', () => {
    scene.retarget(chart(bars('s', [1, 2, 3, 4]), line('t', [1, 2, 3, 4])), SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(bars('s', [1, 2, 3, 4])), GLIDE);
    frames.tick();
    frames.tick();
    expect(renderer.edges).toHaveLength(1);
    expect(renderer.intensityOf('line:t')).toBeLessThan(1);
    frames.runUntilIdle();
    expect(renderer.edges).toEqual([]);
    expect(drawnIds('point:')).toEqual([]);
  });

  it('turn a series from bars into a line without a frame that has neither', () => {
    scene.retarget(chart(bars('s', [10, 20, 30, 40])), SNAP);
    frames.runUntilIdle();
    scene.retarget(chart(line('s', [10, 20, 30, 40])), GLIDE);
    frames.tick();
    frames.tick();
    expect(drawnIds('bar:s:').length).toBeGreaterThan(0);
    expect(renderer.edges).toHaveLength(1);
    frames.runUntilIdle();
    expect(drawnIds('bar:s:')).toEqual([]);
    expect(drawnIds('point:s:')).toHaveLength(4);
  });

  it('keep the edge width in device pixels', () => {
    scene.retarget(chart(line('t', [1, 2, 3, 4])), SNAP);
    frames.tick();
    expect(renderer.edgeStyle).toEqual({ halfWidthPixels: expect.any(Number), alpha: 1 });
  });
});

describe('hover', () => {
  it('lights the hovered bar and no other', () => {
    scene.retarget(chart(bars('s', [10, 20, 30, 40])), SNAP);
    frames.runUntilIdle();
    scene.setHover('bar:s:1');
    frames.tick();
    expect(node('bar:s:1')?.glowWorld).toBeGreaterThan(0);
    expect(node('bar:s:0')?.glowWorld).toBe(0);
    scene.setHover(null);
    frames.tick();
    expect(node('bar:s:1')?.glowWorld).toBe(0);
  });

  it('asks for no frame when the hover did not change', () => {
    scene.retarget(chart(bars('s', [10, 20, 30, 40])), SNAP);
    frames.runUntilIdle();
    scene.setHover(null);
    expect(frames.pending()).toBe(false);
  });

  it('picks through the renderer', async () => {
    renderer.pickNode.mockResolvedValueOnce('bar:s:2');
    await expect(scene.pick({ x: 5, y: 6 })).resolves.toBe('bar:s:2');
    expect(renderer.pickNode).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});

describe('dispose', () => {
  it('takes back the queued frame and the renderer', () => {
    scene.retarget(chart(bars('s', [10, 20, 30, 40])), GLIDE);
    expect(frames.pending()).toBe(true);
    scene.dispose();
    expect(frames.pending()).toBe(false);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
