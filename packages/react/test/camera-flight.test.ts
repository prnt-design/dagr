import { describe, expect, it } from 'vitest';
import { Camera2D } from '@prnt/dagr-render';
import { interpolateCamera, startCameraFlight } from '../src/camera-flight.js';

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

describe('startCameraFlight', () => {
  it('steps to the target over its duration and reports completion', () => {
    const camera = new Camera2D();
    const flight = startCameraFlight(camera, to, 400);
    expect(flight.step(1000)).toBe(false);
    expect(camera.zoom).toBeCloseTo(1);
    expect(flight.step(1200)).toBe(false);
    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.zoom).toBeLessThan(4);
    expect(flight.step(1400)).toBe(true);
    expect(camera.zoom).toBeCloseTo(4);
    expect(camera.center.x).toBeCloseTo(100);
  });

  it('finishes on the first step for a zero duration', () => {
    const camera = new Camera2D();
    expect(startCameraFlight(camera, to, 0).step(0)).toBe(true);
    expect(camera.zoom).toBe(4);
  });

  it('lands on the nearest legal view when the target is outside the limits', () => {
    const camera = new Camera2D({ minZoom: 0.5, maxZoom: 2 });
    startCameraFlight(camera, { center: { x: 0, y: 0 }, zoom: 50 }, 0).step(0);
    expect(camera.zoom).toBe(2);
  });
});
