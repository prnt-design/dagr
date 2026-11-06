import { describe, expect, it } from 'vitest';
import { tooltipPosition, visibleCategories } from '../src/dom-layout.js';

describe('measured chart text', () => {
  it('reserves readable endpoints and skips intersecting long labels', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => ({ left: i * 40, right: i * 40 + 120 }));
    const visible = visibleCategories(boxes);
    expect(visible).toEqual([0, 5]);
    for (let i = 1; i < visible.length; i += 1) {
      expect(boxes[visible[i]!]!.left).toBeGreaterThanOrEqual(boxes[visible[i - 1]!]!.right + 8);
    }
  });

  it('keeps a single label when both endpoints cannot fit', () => {
    expect(visibleCategories([{ left: 8, right: 260 }, { left: 52, right: 304 }])).toEqual([0]);
    expect(visibleCategories([])).toEqual([]);
  });

  it('fits a 74px wrapped tooltip near every container edge', () => {
    for (const x of [0, 160, 320]) {
      for (const top of [0, 59, 140, 280]) {
        const position = tooltipPosition({ x, top }, { width: 128, height: 74 }, { width: 320, height: 280 });
        expect(position.left).toBeGreaterThanOrEqual(8);
        expect(position.left + 128).toBeLessThanOrEqual(312);
        expect(position.top).toBeGreaterThanOrEqual(8);
        expect(position.top + 74).toBeLessThanOrEqual(272);
      }
    }
    expect(tooltipPosition({ x: 280, top: 59 }, { width: 128, height: 74 }, { width: 320, height: 280 }).below).toBe(true);
  });
});
