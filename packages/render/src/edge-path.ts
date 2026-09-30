import type { Vec2 } from './types.js';
import { flattenCubic, smoothCentreline } from './ribbon.js';

export interface EdgePathOptions {
  /** Routed segments by default. Smoothing passes through every route anchor. */
  readonly style?: 'polyline' | 'smooth' | 'orthogonal' | undefined;
  /** Direction of orthogonal doglegs and two-anchor curve tangents. Default horizontal. */
  readonly direction?: 'horizontal' | 'vertical' | undefined;
  /** Maximum smoothing deviation in world units. Default 0.5. */
  readonly tolerance?: number | undefined;
}

/**
 * Shape a routed centreline for SVG, canvas, or renderer edge points.
 * Endpoints and route anchors survive. Orthogonal doglegs and smooth curves
 * are presentation choices, not obstacle avoidance. Inputs are never mutated.
 */
export function shapeEdgePath(points: readonly Vec2[], options: EdgePathOptions = {}): Vec2[] {
  const { style = 'polyline', direction = 'horizontal', tolerance = 0.5 } = options;
  if (!['polyline', 'smooth', 'orthogonal'].includes(style)) throw new RangeError('Invalid edge path style');
  if (!['horizontal', 'vertical'].includes(direction)) throw new RangeError('Invalid edge path direction');
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('Edge path tolerance must be positive and finite');
  const clean: Vec2[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new RangeError('Edge path points must be finite');
    const last = clean.at(-1);
    if (!last || last.x !== p.x || last.y !== p.y) clean.push({ x: p.x, y: p.y });
  }
  if (style === 'polyline' || clean.length < 2) return clean;
  if (style === 'smooth') {
    if (clean.length !== 2) return smoothCentreline(clean, tolerance);
    const a = clean[0]!, b = clean[1]!;
    if (a.x === b.x || a.y === b.y) return clean;
    const x = a.x / 2 + b.x / 2, y = a.y / 2 + b.y / 2;
    const out = [a];
    flattenCubic(out, a,
      direction === 'horizontal' ? { x, y: a.y } : { x: a.x, y },
      direction === 'horizontal' ? { x, y: b.y } : { x: b.x, y },
      b, tolerance, 0);
    return out;
  }
  const out: Vec2[] = [];
  const add = (p: Vec2) => {
    const last = out.at(-1);
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  };
  for (const p of clean) {
    const last = out.at(-1);
    if (last && last.x !== p.x && last.y !== p.y) {
      if (direction === 'horizontal') {
        const x = last.x / 2 + p.x / 2;
        add({ x, y: last.y }); add({ x, y: p.y });
      } else {
        const y = last.y / 2 + p.y / 2;
        add({ x: last.x, y }); add({ x: p.x, y });
      }
    }
    add(p);
  }
  return out;
}
