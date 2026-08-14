import { describe, expect, it } from 'vitest';
import { LABEL_MIN_SCREEN_WIDTH, LADDER_SHAPES } from '../src/ladder.js';

/**
 * The ladder geometry the overlay labels, checked against the ladder it copies.
 *
 * `ladder.ts` restates `@dagr/render`'s `CRISPNESS_LADDER`, which that package
 * deliberately does not export (a hard-coded demo scene should not become part
 * of a published contract). A copy can drift, so what is asserted here is the
 * RULE the original states in prose rather than the numbers alone: rects 10,
 * 100 and 1000 across on rungs 4, 40 and 400 tall, each rung's circle as wide
 * as its rung is tall, everything growing to the right in decades, and no two
 * shapes overlapping.
 *
 * A wrong number here puts a label in the wrong place, which the committed
 * screenshot shows immediately. This is the cheaper half of that check.
 */

const width = (index: number): number => {
  const shape = LADDER_SHAPES[index];
  if (shape === undefined) throw new Error(`no shape ${String(index)}`);
  return shape.bounds.maxX - shape.bounds.minX;
};

const height = (index: number): number => {
  const shape = LADDER_SHAPES[index];
  if (shape === undefined) throw new Error(`no shape ${String(index)}`);
  return shape.bounds.maxY - shape.bounds.minY;
};

describe('LADDER_SHAPES', () => {
  it('has the six shapes of the three rungs, in order', () => {
    expect(LADDER_SHAPES.map((shape) => shape.label)).toEqual([
      'rect-10',
      'circle-10',
      'rect-100',
      'circle-100',
      'rect-1000',
      'circle-1000',
    ]);
  });

  it('puts the rects a decade apart and gives each circle its rung height', () => {
    expect([width(0), width(2), width(4)]).toEqual([10, 100, 1000]);
    expect([height(0), height(2), height(4)]).toEqual([4, 40, 400]);
    // The circles are 4, 40 and 400 across, which is each rung's HEIGHT and not
    // its rect's width. Both numbers are true of different things, and the
    // render package's own docs ask for the right one to be quoted.
    expect([width(1), width(3), width(5)]).toEqual([4, 40, 400]);
    for (const index of [1, 3, 5]) {
      expect(width(index), 'a circle is as tall as it is wide').toBe(height(index));
    }
  });

  it('keeps every shape on the horizontal axis, growing to the right', () => {
    let previousMaxX = Number.NEGATIVE_INFINITY;
    for (const shape of LADDER_SHAPES) {
      expect(shape.bounds.minY).toBe(-shape.bounds.maxY);
      expect(shape.bounds.minX).toBeGreaterThan(previousMaxX);
      previousMaxX = shape.bounds.maxX;
    }
  });

  it('overlaps nowhere, so no label can sit on another shape', () => {
    for (const [i, a] of LADDER_SHAPES.entries()) {
      for (const b of LADDER_SHAPES.slice(i + 1)) {
        const overlaps =
          a.bounds.minX <= b.bounds.maxX &&
          a.bounds.maxX >= b.bounds.minX &&
          a.bounds.minY <= b.bounds.maxY &&
          a.bounds.maxY >= b.bounds.minY;
        expect(overlaps, `${a.label} and ${b.label}`).toBe(false);
      }
    }
  });

  it('reaches the label tier for every shape inside the demo zoom range', () => {
    // The demo runs from zoom 0.1 to 100. A shape whose gate no reachable zoom
    // satisfies would be a label nobody can ever see, which is a silent way for
    // a threshold to be wrong.
    for (const shape of LADDER_SHAPES) {
      const shapeWidth = shape.bounds.maxX - shape.bounds.minX;
      expect(shapeWidth * 100).toBeGreaterThanOrEqual(LABEL_MIN_SCREEN_WIDTH);
    }
  });
});
