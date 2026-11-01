import type { Size } from './geometry.js';

/** A box on screen in CSS pixels, as `getBoundingClientRect` reports one. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** CSS pixels taken off each side of a surface. */
export interface FrameInset {
  readonly top?: number | undefined;
  readonly right?: number | undefined;
  readonly bottom?: number | undefined;
  readonly left?: number | undefined;
}

/** The part of a surface left to frame content in, in CSS pixels from the surface's top left. */
export interface VisibleFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The narrowest and shortest a frame may be, at least, before its insets are ignored. */
const MIN_FRAME_WIDTH = 160;
const MIN_FRAME_HEIGHT = 120;
const MIN_FRAME_SHARE = 0.25;

/**
 * The surface less the insets, the largest on each side. A negative or
 * non-finite inset counts as none, and an axis the insets would squeeze under
 * max(160 or 120 pixels, a quarter of the axis) keeps the whole axis: a drawer
 * as wide as a phone, or a surface scrolled almost out of view, must not
 * shrink the graph to nothing.
 */
export function visibleFrame(size: Size, ...insets: readonly FrameInset[]): VisibleFrame {
  const side = (key: keyof FrameInset): number => {
    let most = 0;
    for (const inset of insets) {
      const value = inset[key];
      if (value !== undefined && Number.isFinite(value) && value > most) most = value;
    }
    return most;
  };
  const axis = (extent: number, start: number, end: number, least: number): [number, number] => {
    const remaining = extent - start - end;
    return remaining < Math.max(least, extent * MIN_FRAME_SHARE) ? [0, extent] : [start, remaining];
  };
  const [x, width] = axis(size.width, side('left'), side('right'), MIN_FRAME_WIDTH);
  const [y, height] = axis(size.height, side('top'), side('bottom'), MIN_FRAME_HEIGHT);
  return { x, y, width, height };
}

/**
 * What an overlay drawn over the surface takes off it: one side, by the
 * overlap, when the overlay touches that side (within a pixel) and spans at
 * least half of it. Of the sides it qualifies on, the one it reaches in from
 * least as a share of its axis, so a drawer the full height of the surface
 * insets the side it is docked to however wide it is. An overlay in the
 * middle of the surface takes nothing.
 */
export function coverInset(surface: ScreenRect, cover: ScreenRect): FrameInset {
  const left = Math.max(surface.left, cover.left);
  const right = Math.min(surface.right, cover.right);
  const top = Math.max(surface.top, cover.top);
  const bottom = Math.min(surface.bottom, cover.bottom);
  const across = right - left;
  const down = bottom - top;
  if (!(across > 0) || !(down > 0)) return {};
  const width = surface.right - surface.left;
  const height = surface.bottom - surface.top;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  const sides: [keyof FrameInset, number, number][] = [];
  if (down >= height / 2) {
    if (near(cover.left, surface.left) || cover.left < surface.left) sides.push(['left', right - surface.left, width]);
    if (near(cover.right, surface.right) || cover.right > surface.right) sides.push(['right', surface.right - left, width]);
  }
  if (across >= width / 2) {
    if (near(cover.top, surface.top) || cover.top < surface.top) sides.push(['top', bottom - surface.top, height]);
    if (near(cover.bottom, surface.bottom) || cover.bottom > surface.bottom) sides.push(['bottom', surface.bottom - top, height]);
  }
  let best: [keyof FrameInset, number, number] | null = null;
  for (const each of sides) if (best === null || each[1] / each[2] < best[1] / best[2]) best = each;
  return best === null ? {} : { [best[0]]: best[1] };
}

/**
 * How far each side of the surface lies outside `visible`: a clipping
 * ancestor's client box (its border box moved in by `clientLeft` and
 * `clientTop`, sized by `clientWidth` and `clientHeight`), or the visual
 * viewport. Current engines report `getBoundingClientRect` relative to the
 * layout viewport, so the visual viewport's box there is `offsetLeft`,
 * `offsetTop`, and those plus `width` and `height`. Each side is clamped to
 * the surface, and a non-finite edge clips nothing.
 */
export function clipInset(surface: ScreenRect, visible: ScreenRect): FrameInset {
  const width = surface.right - surface.left;
  const height = surface.bottom - surface.top;
  const clip = (outside: number, extent: number): number =>
    Number.isFinite(outside) ? Math.min(Math.max(outside, 0), Math.max(extent, 0)) : 0;
  return {
    top: clip(visible.top - surface.top, height),
    right: clip(surface.right - visible.right, width),
    bottom: clip(surface.bottom - visible.bottom, height),
    left: clip(visible.left - surface.left, width),
  };
}
