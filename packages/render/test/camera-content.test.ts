import { describe, expect, it } from 'vitest';
import { Camera2D, fitZoom } from '../src/camera.js';
const bounds = { minX: -100, minY: -200, maxX: 1900, maxY: 800 };
const viewport = { width: 1000, height: 600, devicePixelRatio: 1 };
const node = { width: 200, height: 100 };

describe('content navigation limits', () => {
  it('stops at overview and node detail and keeps repeated limit gestures stable', () => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    expect(camera.minZoom).toBe(fitZoom(bounds, viewport));
    expect(camera.maxZoom).toBe(4.5);
    camera.zoomAtScreen({ x: 0, y: 0 }, 1e-6);
    expect(camera.zoom).toBe(camera.minZoom);
    expect(camera.center).toEqual({ x: 900, y: 300 });
    const overview = camera.visibleWorldBounds();
    expect(overview.minX).toBeLessThan(bounds.minX);
    expect(overview.maxY).toBeGreaterThan(bounds.maxY);
    camera.panByScreen(1e6, -1e6);
    expect(camera.center).toEqual({ x: 900, y: 300 });
    camera.zoomAtScreen({ x: 500, y: 300 }, 1e6);
    expect(camera.zoom).toBe(camera.maxZoom);
    const center = camera.center;
    for (let i = 0; i < 20; i++) camera.zoomAtScreen({ x: 10, y: 20 }, 2);
    expect(camera.center.x).toBeCloseTo(center.x);
    expect(camera.center.y).toBeCloseTo(center.y);
  });

  it.each([[1, 1], [-1, 1], [1, -1], [-1, -1]])('keeps content visible when panning toward %s,%s', (x, y) => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    camera.setZoom(4.5);
    camera.panByScreen(x * 1e9, y * 1e9);
    const visible = camera.visibleWorldBounds();
    expect(visible.minX).toBeLessThan(bounds.maxX);
    expect(visible.maxX).toBeGreaterThan(bounds.minX);
    expect(visible.minY).toBeLessThan(bounds.maxY);
    expect(visible.maxY).toBeGreaterThan(bounds.minY);
    camera.setCenter({ x: x * 1e9, y: y * 1e9 });
    expect(camera.center.x).toBeGreaterThan(bounds.minX);
    expect(camera.center.x).toBeLessThan(bounds.maxX);
  });

  it('recomputes limits on resize, preserves legal exploration, and releases on clear', () => {
    const camera = new Camera2D({ viewport, minZoom: 0.1, maxZoom: 20 });
    camera.setContentBounds(bounds, node);
    camera.setCenter({ x: 900, y: 300 });
    camera.setZoom(2);
    camera.setViewport({ width: 800, height: 400, devicePixelRatio: 3 });
    expect(camera.zoom).toBe(2);
    expect(camera.center).toEqual({ x: 900, y: 300 });
    expect(camera.minZoom).toBeCloseTo(0.36);
    expect(camera.maxZoom).toBeCloseTo(3.6);
    camera.setContentBounds(null);
    expect(camera.minZoom).toBe(0.1);
    expect(camera.maxZoom).toBe(20);
    camera.setCenter({ x: 1e6, y: 1e6 });
    expect(camera.center.x).toBe(1e6);
  });

  it('handles a single node and rejects invalid updates atomically', () => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, node);
    expect(camera.minZoom).toBe(camera.maxZoom);
    camera.fitBounds(bounds);
    expect(camera.center).toEqual({ x: 100, y: 50 });
    const before = camera.zoom;
    expect(() => camera.setContentBounds(bounds, { width: 0, height: 100 })).toThrow(RangeError);
    expect(camera.zoom).toBe(before);
    camera.setZoom(1e3);
    expect(camera.zoom).toBe(before);
  });
});

it('keeps an actual node visible in sparse corners and across anchored zooms', () => {
  const camera = new Camera2D({ viewport });
  const nodes = [
    { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    { minX: 8000, minY: 9000, maxX: 8200, maxY: 9100 },
  ];
  camera.setContentBounds({ minX: 0, minY: 0, maxX: 8200, maxY: 9100 }, node, 0.05, nodes);
  for (const point of [{x:0,y:9000},{x:8000,y:0},{x:4000,y:4500},{x:-1e9,y:1e9}]) {
    camera.setZoom(camera.maxZoom);
    camera.setCenter(point);
    camera.zoomAtScreen({x:0,y:0},0.9);
    const visible = camera.visibleWorldBounds();
    expect(nodes.some(n => n.maxX > visible.minX && n.minX < visible.maxX && n.maxY > visible.minY && n.minY < visible.maxY)).toBe(true);
  }
});
