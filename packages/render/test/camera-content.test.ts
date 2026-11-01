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

describe('frame inset', () => {
  const inset = { left: 300, bottom: 200 };
  const frameMiddle = { x: 300 + 700 / 2, y: 400 / 2 };

  it('changes nothing until an inset is set, and nothing after it is cleared', () => {
    const plain = new Camera2D({ viewport });
    const cleared = new Camera2D({ viewport });
    cleared.setInset(inset);
    cleared.setInset({});
    for (const camera of [plain, cleared]) {
      camera.setContentBounds(bounds, node);
      camera.fitBounds(bounds);
      camera.panByScreen(123, -45);
      camera.zoomAtScreen({ x: 10, y: 20 }, 1.7);
    }
    expect(cleared.frame).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
    expect(cleared.center).toEqual(plain.center);
    expect(cleared.zoom).toBe(plain.zoom);
  });

  it('fits the bounds in the middle of the frame, at the frame-sized zoom', () => {
    const camera = new Camera2D({ viewport });
    camera.setInset(inset);
    expect(camera.frame).toEqual({ x: 300, y: 0, width: 700, height: 400 });
    camera.fitBounds(bounds);
    expect(camera.zoom).toBe(fitZoom(bounds, { width: 700, height: 400 }));
    const middle = camera.worldToScreen({ x: 900, y: 300 });
    expect(middle.x).toBeCloseTo(frameMiddle.x, 9);
    expect(middle.y).toBeCloseTo(frameMiddle.y, 9);
  });

  it('takes the content limits from the frame and keeps the fit through them', () => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    camera.setInset(inset);
    expect(camera.minZoom).toBe(fitZoom(bounds, { width: 700, height: 400 }));
    camera.fitBounds(bounds);
    expect(camera.zoom).toBe(camera.minZoom);
    const middle = camera.worldToScreen({ x: 900, y: 300 });
    expect(middle.x).toBeCloseTo(frameMiddle.x, 9);
    expect(middle.y).toBeCloseTo(frameMiddle.y, 9);
    camera.panByScreen(1e6, -1e6);
    expect(camera.worldToScreen({ x: 900, y: 300 }).x).toBeCloseTo(frameMiddle.x, 9);
  });

  it.each([[1, 1], [-1, 1], [1, -1], [-1, -1]])('stops a pan toward %s,%s with content still in the frame', (x, y) => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    camera.setInset(inset);
    camera.setZoom(camera.maxZoom);
    camera.panByScreen(x * 1e9, y * 1e9);
    const topLeft = camera.screenToWorld({ x: 300, y: 0 });
    const bottomRight = camera.screenToWorld({ x: 1000, y: 400 });
    expect(topLeft.x).toBeLessThan(bounds.maxX);
    expect(bottomRight.x).toBeGreaterThan(bounds.minX);
    expect(bottomRight.y).toBeLessThan(bounds.maxY);
    expect(topLeft.y).toBeGreaterThan(bounds.minY);
  });

  it('stops each pan with the padded content edge at the frame edge', () => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    camera.setInset(inset);
    camera.setZoom(camera.maxZoom);
    camera.panByScreen(1e9, 0);
    expect(camera.worldToScreen({ x: bounds.minX, y: 0 }).x).toBeCloseTo(300 + 700 * 0.05, 6);
    camera.panByScreen(-1e9, 0);
    expect(camera.worldToScreen({ x: bounds.maxX, y: 0 }).x).toBeCloseTo(1000 - 700 * 0.05, 6);
    camera.panByScreen(0, 1e9);
    expect(camera.worldToScreen({ x: 0, y: bounds.maxY }).y).toBeCloseTo(400 * 0.05, 6);
    camera.panByScreen(0, -1e9);
    expect(camera.worldToScreen({ x: 0, y: bounds.minY }).y).toBeCloseTo(400 - 400 * 0.05, 6);
  });

  it('keeps a node in the frame, not under the inset, in a sparse corner', () => {
    const camera = new Camera2D({ viewport });
    const nodes = [
      { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      { minX: 8000, minY: 9000, maxX: 8200, maxY: 9100 },
    ];
    camera.setContentBounds({ minX: 0, minY: 0, maxX: 8200, maxY: 9100 }, node, 0.05, nodes);
    camera.setInset(inset);
    camera.setZoom(camera.maxZoom);
    camera.setCenter(camera.centerFor({ x: 4000, y: 4500 }));
    const topLeft = camera.screenToWorld({ x: 300, y: 0 });
    const bottomRight = camera.screenToWorld({ x: 1000, y: 400 });
    expect(nodes.some((n) => n.maxX > topLeft.x && n.minX < bottomRight.x && n.maxY > bottomRight.y && n.minY < topLeft.y)).toBe(true);
  });

  it('keeps a negative zero with no inset', () => {
    const camera = new Camera2D({ viewport });
    camera.setContentBounds(bounds, node);
    camera.setZoom(camera.maxZoom);
    camera.setCenter({ x: 900, y: -0 });
    expect(Object.is(camera.center.y, -0)).toBe(true);
    expect(Object.is(camera.centerFor({ x: -0, y: -0 }).y, -0)).toBe(true);
  });

  it('re-derives the frame on resize and ignores an inset that leaves too little', () => {
    const camera = new Camera2D({ viewport });
    camera.setInset(inset);
    camera.setViewport({ width: 1200, height: 800, devicePixelRatio: 2 });
    expect(camera.frame).toEqual({ x: 300, y: 0, width: 900, height: 600 });
    camera.setInset({ left: 950, top: Number.NaN, bottom: -5 });
    expect(camera.frame).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it('centres a point in the frame at a given zoom', () => {
    const camera = new Camera2D({ viewport });
    camera.setInset(inset);
    camera.setZoom(2);
    camera.setCenter(camera.centerFor({ x: 50, y: -20 }));
    const at = camera.worldToScreen({ x: 50, y: -20 });
    expect(at.x).toBeCloseTo(frameMiddle.x, 9);
    expect(at.y).toBeCloseTo(frameMiddle.y, 9);
    expect(() => camera.centerFor({ x: Number.NaN, y: 0 })).toThrow(RangeError);
  });
});
