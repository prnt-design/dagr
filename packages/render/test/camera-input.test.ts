import { describe, expect, it } from 'vitest';
import {
  FIT,
  KEY_PAN_STEP,
  KEY_ZOOM_FACTOR,
  WHEEL_MAX_PIXELS,
  ZOOM_IN,
  ZOOM_OUT,
  canvasPoint,
  keyCommand,
  wheelPixels,
  wheelZoomFactor,
} from '../src/camera-input.js';

describe('wheel arithmetic', () => {
  it('converts line and page modes and clamps a fling', () => {
    expect(wheelPixels({ deltaY: 10, deltaMode: 0 })).toBe(10);
    expect(wheelPixels({ deltaY: 2, deltaMode: 1 })).toBe(32);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 })).toBe(WHEEL_MAX_PIXELS);
    expect(wheelPixels({ deltaY: -1e9, deltaMode: 0 })).toBe(-WHEEL_MAX_PIXELS);
    expect(wheelPixels({ deltaY: Number.NaN, deltaMode: 0 })).toBe(0);
  });
  it('zooms in on wheel up and out on wheel down, symmetrically', () => {
    const up = wheelZoomFactor({ deltaY: -100, deltaMode: 0 });
    const down = wheelZoomFactor({ deltaY: 100, deltaMode: 0 });
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
    expect(up * down).toBeCloseTo(1);
  });
});

describe('keyCommand', () => {
  it('maps navigation keys and ignores the rest', () => {
    expect(keyCommand('+')).toBe(ZOOM_IN);
    expect(keyCommand('-')).toBe(ZOOM_OUT);
    expect(keyCommand('0')).toBe(FIT);
    expect(keyCommand('ArrowLeft')).toEqual({ kind: 'pan', dx: KEY_PAN_STEP, dy: 0 });
    expect(keyCommand('ArrowUp', true)).toEqual({ kind: 'pan', dx: 0, dy: KEY_PAN_STEP });
    expect(keyCommand('a')).toBeNull();
    expect(ZOOM_IN).toEqual({ kind: 'zoom', factor: KEY_ZOOM_FACTOR });
  });
});

it('canvasPoint is relative to the rect corner', () => {
  expect(canvasPoint({ clientX: 30, clientY: 50 }, { left: 10, top: 20 })).toEqual({ x: 20, y: 30 });
});
