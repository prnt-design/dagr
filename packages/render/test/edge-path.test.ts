import { expect, it } from 'vitest';
import { shapeEdgePath } from '../src/edge-path.js';
const points = [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 200, y: -20 }];
it.each(['horizontal', 'vertical'] as const)('makes %s orthogonal doglegs with preserved anchors', (direction) => {
  const out = shapeEdgePath(points, { style: 'orthogonal', direction });
  for (let i = 1; i < out.length; i++) {
    expect(out[i]!.x === out[i - 1]!.x || out[i]!.y === out[i - 1]!.y).toBe(true);
    expect(out[i]).not.toEqual(out[i - 1]);
  }
  for (const point of points) expect(out).toContainEqual(point);
  expect(out[0]).toEqual(points[0]); expect(out.at(-1)).toEqual(points.at(-1));
  expect(out[1]![direction === 'horizontal' ? 'y' : 'x']).toBe(0);
});
it('smooths without losing anchors and leaves inputs intact', () => {
  const before = structuredClone(points);
  const out = shapeEdgePath(points, { style: 'smooth' });
  expect(out.length).toBeGreaterThan(points.length);
  for (const point of points) expect(out).toContainEqual(point);
  expect(points).toEqual(before);
  expect(shapeEdgePath(points)).toEqual(points);
});
it('handles empty, single, repeated, and aligned anchors', () => {
  for (const style of ['polyline', 'smooth', 'orthogonal'] as const) {
    expect(shapeEdgePath([], { style })).toEqual([]);
    expect(shapeEdgePath([points[0]!, points[0]!], { style })).toEqual([points[0]]);
    expect(shapeEdgePath([{x:0,y:0},{x:0,y:20}], {style})).toEqual([{x:0,y:0},{x:0,y:20}]);
  }
  expect(() => shapeEdgePath([{x:NaN,y:0}])).toThrow(RangeError);
  expect(() => shapeEdgePath(points, {tolerance:0})).toThrow(RangeError);
});
