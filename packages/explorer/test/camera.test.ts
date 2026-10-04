import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import type { ExplorerBox } from '../src/index.js';
import {
  cameraSettled,
  createCameraLimits,
  easeCamera,
  fitCamera,
  focusCamera,
  panCamera,
  revealCamera,
  screenToWorld,
  visibleWorld,
  zoomCamera,
} from '../src/camera.js';
import type { CameraLimits } from '../src/camera.js';

/** a -> b -> c with default sizes: a plane 1040 by 200, boxes 240 by 120. */
const chain = layoutView({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ],
});
const viewport = { width: 800, height: 480 };

function limitsOf(): CameraLimits {
  const limits = createCameraLimits(chain, viewport);
  if (limits === null) throw new Error('no limits');
  return limits;
}

function boxOf(id: string): ExplorerBox {
  const box = chain.boxes.get(id);
  if (box === undefined) throw new Error(`no box for ${id}`);
  return box;
}

describe('createCameraLimits', () => {
  it('fits the whole plane at the floor and one node at the ceiling', () => {
    const limits = limitsOf();
    // 800 * 0.9 / 1040: the plane's width, with 5% of the viewport left each side.
    expect(limits.minScale).toBeCloseTo(0.6923, 4);
    // min(800 / 240, 480 / 120) * 0.9: one 240 by 120 node fills the viewport.
    expect(limits.maxScale).toBeCloseTo(3, 6);
  });

  it('has nothing to limit without a viewport or without content', () => {
    expect(createCameraLimits(chain, { width: 0, height: 480 })).toBeNull();
    expect(createCameraLimits(chain, { width: 800, height: 0 })).toBeNull();
    const empty = layoutView({ id: 'v', label: 'View', nodes: [], edges: [] });
    expect(createCameraLimits(empty, viewport)).toBeNull();
  });

  it('pulls a camera panned far away back to the content', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    for (const lost of [panCamera(fit, 5000, 5000), panCamera(fit, -5000, -5000)]) {
      const back = limits.constrain(lost);
      expect(back.x).toBeCloseTo(fit.x, 6);
      expect(back.y).toBeCloseTo(fit.y, 6);
      expect(back.scale).toBeCloseTo(fit.scale, 6);
    }
  });

  it('clamps a scale outside the range', () => {
    const limits = limitsOf();
    expect(limits.constrain({ x: 0, y: 0, scale: 100 }).scale).toBeCloseTo(3, 6);
    expect(limits.constrain({ x: 0, y: 0, scale: 0.001 }).scale).toBeCloseTo(0.6923, 4);
  });
});

describe('fitCamera', () => {
  it('centers the plane at the floor scale, and is already inside the limits', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    expect(fit.scale).toBeCloseTo(0.6923, 4);
    expect(fit.x).toBeCloseTo(40, 6);
    expect(fit.y).toBeCloseTo(170.7692, 4);
    const constrained = limits.constrain(fit);
    expect(constrained.x).toBeCloseTo(fit.x, 6);
    expect(constrained.y).toBeCloseTo(fit.y, 6);
  });
});

describe('zoomCamera', () => {
  it('keeps the world point under the anchor where it was', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    const anchor = { x: 400, y: 240 };
    const before = screenToWorld(fit, anchor);
    const zoomed = zoomCamera(fit, 2, anchor, limits);
    expect(zoomed.scale).toBeCloseTo(1.3846, 4);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('stops at the floor and the ceiling', () => {
    const limits = limitsOf();
    const fit = fitCamera(chain, viewport, limits);
    expect(zoomCamera(fit, 0.5, { x: 400, y: 240 }, limits)).toEqual(fit);
    expect(zoomCamera(fit, 100, { x: 0, y: 0 }, limits).scale).toBeCloseTo(3, 6);
  });
});

describe('focusCamera', () => {
  it('centers a node and fills the viewport with it, up to the ceiling', () => {
    const limits = limitsOf();
    const camera = focusCamera(boxOf('b'), viewport, limits);
    // (800 - 48) / 240 is 3.13, over the ceiling, so 3.
    expect(camera.scale).toBeCloseTo(3, 6);
    // b's center is (520, 100): 400 - 520 * 3 and 240 - 100 * 3.
    expect(camera.x).toBeCloseTo(-1160, 6);
    expect(camera.y).toBeCloseTo(-60, 6);
  });
});

describe('revealCamera', () => {
  const one = { x: 0, y: 0, scale: 1 };

  it('does not move for a node already inside the margin', () => {
    expect(revealCamera(one, boxOf('a'), viewport)).toEqual(one);
  });

  it('pans the least distance that brings a node 12 inside the edge', () => {
    // c spans 760 to 1000. The viewport is 800 wide, so it must move 1000 - 788.
    expect(revealCamera(one, boxOf('c'), viewport)).toEqual({ x: -212, y: 0, scale: 1 });
  });

  it('centers a node that is larger than the viewport', () => {
    // At scale 4, a is 960 by 480 on screen, centered on (640, 400).
    expect(revealCamera({ x: 0, y: 0, scale: 4 }, boxOf('a'), viewport)).toEqual({
      x: -240,
      y: -160,
      scale: 4,
    });
  });

  it('never changes the scale', () => {
    expect(revealCamera({ x: 0, y: 0, scale: 2 }, boxOf('c'), viewport).scale).toBe(2);
  });
});

describe('visibleWorld and screenToWorld', () => {
  it('invert the plane transform', () => {
    const camera = { x: 40, y: -20, scale: 2 };
    expect(visibleWorld(camera, viewport)).toEqual({ x: -20, y: 10, width: 400, height: 240 });
    expect(screenToWorld(camera, { x: 40, y: -20 })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(camera, { x: 240, y: 180 })).toEqual({ x: 100, y: 100 });
  });
});

describe('easeCamera and cameraSettled', () => {
  const from = { x: 0, y: 0, scale: 1 };
  const to = { x: 100, y: 50, scale: 2 };

  it('moves part of the way, more for a longer frame', () => {
    const short = easeCamera(from, to, 16);
    expect(short.x).toBeCloseTo(25.2416, 4);
    expect(short.y).toBeCloseTo(12.6208, 4);
    expect(short.scale).toBeCloseTo(1.2524, 4);
    expect(easeCamera(from, to, 32).x).toBeGreaterThan(short.x);
  });

  it('treats a frame longer than 64ms as 64ms, so a stalled tab does not jump', () => {
    expect(easeCamera(from, to, 1000)).toEqual(easeCamera(from, to, 64));
  });

  it('does not move for a zero or negative frame', () => {
    expect(easeCamera(from, to, 0)).toEqual(from);
    expect(easeCamera(from, to, -5)).toEqual(from);
  });

  it('settles within a twentieth of a pixel and a ten-thousandth of scale', () => {
    expect(cameraSettled(to, to)).toBe(true);
    expect(cameraSettled({ x: 100.02, y: 50.02, scale: 2 }, to)).toBe(true);
    expect(cameraSettled({ x: 100.1, y: 50, scale: 2 }, to)).toBe(false);
    expect(cameraSettled({ x: 100, y: 50, scale: 2.001 }, to)).toBe(false);
  });
});
