import { describe, expect, it } from 'vitest';
import { Camera2D, createPinchGesture } from '../src/core.js';

const point = (x: number, y = 0) => ({ x, y });

describe('shared pinch gesture', () => {
  it('reports screen translation and zoom at the new midpoint', () => {
    const pinch = createPinchGesture();
    pinch.down(1, point(100, 50));
    pinch.down(2, point(200, 50));
    expect(pinch.move(2, point(300, 70))).toEqual({
      pan: point(50, 10), anchor: point(200, 60), factor: Math.hypot(200, 20) / 100,
    });
  });

  it.each([1, 3])('preserves the midpoint world point in CSS coordinates at DPR %s', (devicePixelRatio) => {
    const camera = new Camera2D({ viewport: { width: 320, height: 200, devicePixelRatio } });
    const world = camera.screenToWorld(point(150, 50));
    const pinch = createPinchGesture();
    pinch.down(1, point(100, 50));
    pinch.down(2, point(200, 50));
    const change = pinch.move(2, point(300, 70));
    expect(change).not.toBeNull();
    if (change === null) throw new Error('expected pinch');
    camera.panByScreen(change.pan.x, change.pan.y);
    camera.zoomAtScreen(change.anchor, change.factor);
    const screen = camera.worldToScreen(world);
    expect(screen.x).toBeCloseTo(200);
    expect(screen.y).toBeCloseTo(60);
  });

  it('keeps the first two contacts stable when another finger arrives', () => {
    const pinch = createPinchGesture();
    expect(pinch.down(1, point(0))).toBe(true);
    expect(pinch.down(2, point(100))).toBe(true);
    expect(pinch.down(3, point(900))).toBe(false);
    expect(pinch.size).toBe(2);
    expect(pinch.pointerIds).toEqual([1, 2]);
    expect(pinch.move(3, point(800))).toBeNull();
    expect(pinch.up(3)).toBe(false);
    expect(pinch.move(2, point(200))).toEqual({ pan: point(50), anchor: point(100), factor: 2 });
  });

  it('stops on release/cancel and starts a new pair without a jump', () => {
    const pinch = createPinchGesture();
    pinch.down(1, point(0));
    pinch.down(2, point(100));
    expect(pinch.up(2)).toBe(true);
    expect(pinch.move(1, point(50))).toBeNull();
    expect(pinch.move(2, point(300))).toBeNull();
    pinch.down(3, point(150));
    expect(pinch.move(3, point(250))).toEqual({ pan: point(50), anchor: point(150), factor: 2 });
    pinch.reset();
    expect(pinch.size).toBe(0);
    expect(pinch.pointerIds).toEqual([]);
    expect(pinch.move(1, point(500))).toBeNull();
  });

  it('pans coincident contacts without dividing by zero, then resumes zoom', () => {
    const pinch = createPinchGesture();
    pinch.down(1, point(100));
    pinch.down(2, point(100));
    expect(pinch.move(2, point(120))).toEqual({ pan: point(10), anchor: point(110), factor: 1 });
    expect(pinch.move(2, point(140))).toEqual({ pan: point(10), anchor: point(120), factor: 2 });
    expect(pinch.move(2, point(100))).toEqual({ pan: point(-20), anchor: point(100), factor: 1 });
  });

  it('copies inputs and does not let a caller mutate the active pointer list', () => {
    const pinch = createPinchGesture();
    const a = point(0);
    pinch.down(1, a);
    pinch.down(2, point(100));
    a.x = 800;
    const ids = pinch.pointerIds as number[];
    ids.length = 0;
    expect(pinch.has(1)).toBe(true);
    expect(pinch.move(2, point(200))?.factor).toBe(2);
  });

  it('ignores duplicate downs and invalid input without poisoning the next move', () => {
    const pinch = createPinchGesture();
    expect(pinch.down(Number.NaN, point(0))).toBe(false);
    expect(pinch.down(1, point(Number.POSITIVE_INFINITY))).toBe(false);
    pinch.down(1, point(0));
    pinch.down(2, point(100));
    expect(pinch.down(2, point(300))).toBe(false);
    expect(pinch.move(2, point(Number.NaN))).toBeNull();
    expect(pinch.move(2, point(200))).toEqual({ pan: point(50), anchor: point(100), factor: 2 });
  });

  it('does not couple independent surfaces', () => {
    const first = createPinchGesture();
    const second = createPinchGesture();
    first.down(1, point(0));
    second.down(2, point(100));
    expect(first.move(1, point(50))).toBeNull();
    expect(second.size).toBe(1);
  });
});
