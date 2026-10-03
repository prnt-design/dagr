import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera2D } from '@prnt/dagr-render';
import { flyCamera, interpolateCamera } from '../src/camera-flight.js';

const from = { center: { x: 0, y: 0 }, zoom: 1 };
const to = { center: { x: 100, y: -40 }, zoom: 4 };

describe('interpolateCamera', () => {
  it('hits both endpoints exactly', () => {
    expect(interpolateCamera(from, to, 0)).toEqual(from);
    expect(interpolateCamera(from, to, 1)).toEqual(to);
  });
  it('is geometric in zoom and symmetric at the midpoint', () => {
    const mid = interpolateCamera(from, to, 0.5);
    expect(mid.zoom).toBeCloseTo(2);
    expect(mid.center.x).toBeCloseTo(50);
    expect(mid.center.y).toBeCloseTo(-20);
  });
  it('clamps progress outside 0 to 1', () => {
    expect(interpolateCamera(from, to, -3)).toEqual(from);
    expect(interpolateCamera(from, to, 9)).toEqual(to);
  });
});

describe('flyCamera', () => {
  let queue: FrameRequestCallback[] = [];
  beforeEach(() => {
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const run = (now: number): void => {
    const cb = queue.shift();
    cb?.(now);
  };

  it('jumps without scheduling a frame for a zero duration', () => {
    const camera = new Camera2D();
    const onStep = vi.fn();
    flyCamera(camera, to, 0, onStep);
    expect(camera.zoom).toBe(4);
    expect(camera.center).toEqual(to.center);
    expect(onStep).toHaveBeenCalledOnce();
    expect(queue).toHaveLength(0);
  });

  it('steps to the target over its duration and stops scheduling', () => {
    const camera = new Camera2D();
    const onStep = vi.fn();
    flyCamera(camera, to, 400, onStep);
    run(1000);
    expect(camera.zoom).toBeCloseTo(1);
    run(1200);
    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.zoom).toBeLessThan(4);
    run(1400);
    expect(camera.zoom).toBeCloseTo(4);
    expect(camera.center.x).toBeCloseTo(100);
    expect(queue).toHaveLength(0);
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it('cancel stops mid-flight and is idempotent', () => {
    const camera = new Camera2D();
    const flight = flyCamera(camera, to, 400, () => undefined);
    run(0);
    run(100);
    const zoom = camera.zoom;
    flight.cancel();
    flight.cancel();
    expect(queue).toHaveLength(0);
    expect(camera.zoom).toBe(zoom);
  });

  it('lands on the nearest legal view when the target is outside the limits', () => {
    const camera = new Camera2D({ minZoom: 0.5, maxZoom: 2 });
    flyCamera(camera, { center: { x: 0, y: 0 }, zoom: 50 }, 0, () => undefined);
    expect(camera.zoom).toBe(2);
  });
});
