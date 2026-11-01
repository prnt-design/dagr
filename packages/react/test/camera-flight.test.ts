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

  it('retargets from where the camera is, without a jump, and lands when it would have', () => {
    const camera = new Camera2D();
    const flight = startCameraFlight(camera, to, 400);
    flight.step(1000);
    flight.step(1200);
    const midway = camera.zoom;
    const elsewhere = { center: { x: -50, y: 20 }, zoom: 2 };
    flight.retarget(elsewhere);
    expect(flight.step(1300)).toBe(false);
    expect(camera.zoom).toBe(midway);
    expect(flight.step(1450)).toBe(false);
    expect(flight.step(1500)).toBe(true);
    expect(camera.zoom).toBeCloseTo(2);
    expect(camera.center.x).toBeCloseTo(-50);
    expect(camera.center.y).toBeCloseTo(20);
  });

  it('takes a target given before the first step as its own, keeping the duration', () => {
    const camera = new Camera2D();
    const flight = startCameraFlight(camera, to, 400);
    flight.retarget({ center: { x: 10, y: 10 }, zoom: 2 });
    expect(flight.step(0)).toBe(false);
    expect(flight.step(399)).toBe(false);
    expect(flight.step(400)).toBe(true);
    expect(camera.zoom).toBeCloseTo(2);
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
