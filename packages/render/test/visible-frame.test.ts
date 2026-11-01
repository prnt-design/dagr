import { describe, expect, it } from 'vitest';
import { clipInset, coverInset, visibleFrame } from '../src/visible-frame.js';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('visibleFrame', () => {
  const size = { width: 800, height: 480 };

  it('is the whole surface with no inset', () => {
    expect(visibleFrame(size)).toEqual({ x: 0, y: 0, width: 800, height: 480 });
    expect(visibleFrame(size, {})).toEqual({ x: 0, y: 0, width: 800, height: 480 });
  });

  it('takes each side in by its largest inset, ignoring a negative or non-finite one', () => {
    expect(visibleFrame(size, { top: 40, right: 360, bottom: Number.NaN, left: -10 })).toEqual({
      x: 0,
      y: 40,
      width: 440,
      height: 440,
    });
    expect(visibleFrame(size, { right: 100 }, { right: 300, top: 20 }, { top: 10 })).toEqual({
      x: 0,
      y: 20,
      width: 500,
      height: 460,
    });
  });

  it('ignores the insets on an axis they would squeeze under max(160, a quarter) or max(120, a quarter)', () => {
    expect(visibleFrame(size, { right: 600 })).toEqual({ x: 0, y: 0, width: 200, height: 480 });
    expect(visibleFrame(size, { right: 601, top: 40 })).toEqual({ x: 0, y: 40, width: 800, height: 440 });
    expect(visibleFrame({ width: 1600, height: 480 }, { left: 1201 }).width).toBe(1600);
    expect(visibleFrame(size, { top: 200, bottom: 161 })).toEqual({ x: 0, y: 0, width: 800, height: 480 });
  });
});

describe('coverInset', () => {
  const whole = rect(0, 0, 800, 480);

  it('insets the side a drawer covers by its width', () => {
    expect(coverInset(whole, rect(440, 0, 800, 480))).toEqual({ right: 360 });
    expect(coverInset(whole, rect(0, 0, 300, 480))).toEqual({ left: 300 });
    expect(coverInset(whole, rect(0, 0, 800, 60))).toEqual({ top: 60 });
  });

  it('insets the docked side of a full-height drawer wider than half the surface', () => {
    expect(coverInset(whole, rect(300, 0, 800, 480))).toEqual({ right: 500 });
  });

  it('measures against where the surface is, and only the part that overlaps it', () => {
    const placed = rect(100, 50, 900, 530);
    expect(coverInset(placed, rect(540, 0, 900, 600))).toEqual({ right: 360 });
  });

  it('ignores a cover that does not touch a side, spans under half of it, or has no size', () => {
    expect(coverInset(whole, rect(300, 100, 500, 300))).toEqual({});
    expect(coverInset(whole, rect(600, 0, 800, 200))).toEqual({});
    expect(coverInset(whole, rect(0, 0, 0, 0))).toEqual({});
    expect(coverInset(whole, rect(800, 0, 1000, 480))).toEqual({});
  });

  it('leaves the whole frame for a drawer as wide as the surface', () => {
    const phone = rect(0, 0, 375, 600);
    expect(visibleFrame({ width: 375, height: 600 }, coverInset(phone, phone))).toEqual({
      x: 0,
      y: 0,
      width: 375,
      height: 600,
    });
  });
});

describe('clipInset', () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it('clips nothing from a surface wholly inside the visible box', () => {
    expect(clipInset(rect(20, 20, 300, 400), rect(0, 0, 390, 844))).toEqual(none);
  });

  it('clips the part of a surface a scrolling ancestor has scrolled out of its box', () => {
    // A 600px-tall graph in a 400px-tall scroller, scrolled down by 150px.
    expect(clipInset(rect(0, -150, 360, 450), rect(0, 0, 360, 400))).toEqual({ ...none, top: 150, bottom: 50 });
  });

  it('clips a surface under a shrunken visual viewport, such as one with a keyboard open', () => {
    // A full-screen graph on a 390x844 layout viewport, with 336px left visible.
    const graph = rect(0, 0, 390, 844);
    const inset = clipInset(graph, rect(0, 0, 390, 336));
    expect(inset).toEqual({ ...none, bottom: 508 });
    expect(visibleFrame({ width: 390, height: 844 }, inset)).toEqual({ x: 0, y: 0, width: 390, height: 336 });
  });

  it('clips every side of a surface under a zoomed-in, scrolled visual viewport', () => {
    expect(clipInset(rect(0, 0, 800, 600), rect(200, 100, 600, 400))).toEqual({
      top: 100,
      right: 200,
      bottom: 200,
      left: 200,
    });
  });

  it('clamps each side to the surface, and clips nothing for a non-finite edge', () => {
    expect(clipInset(rect(0, 0, 100, 100), rect(0, 500, 100, 600))).toEqual({ ...none, top: 100 });
    expect(clipInset(rect(0, 0, 100, 100), rect(Number.NaN, 0, Infinity, 50))).toEqual({ ...none, bottom: 50 });
    expect(clipInset(rect(0, 0, 100, 100), rect(0, -Infinity, 100, 100))).toEqual(none);
    expect(clipInset(rect(0, 0, 0, 0), rect(10, 10, 20, 20))).toEqual(none);
  });

  it('combines with an overlay so the frame avoids both', () => {
    const graph = rect(0, 0, 800, 600);
    const keyboard = clipInset(graph, rect(0, 0, 800, 400));
    const drawer = coverInset(graph, rect(500, 0, 800, 600));
    expect(visibleFrame({ width: 800, height: 600 }, keyboard, drawer)).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });
});
