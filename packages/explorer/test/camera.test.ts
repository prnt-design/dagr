import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/index.js';
import type { ExplorerBox } from '../src/index.js';
import {
  CONTENT_PADDING,
  cameraFrame,
  cameraSettled,
  createCameraLimits,
  easeCamera,
  fitCamera,
  focusCamera,
  obstructionInset,
  panCamera,
  revealCamera,
  screenToWorld,
  visibleWorld,
  zoomCamera,
} from '../src/camera.js';
import type { CameraLimits } from '../src/camera.js';

/** A fan, a -> b and a -> c: a plane 680 by 360, off-center on both axes. */
const fan = layoutView({
  id: 'v',
  label: 'View',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'ac', source: 'a', target: 'c' },
  ],
});

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

describe('CameraLimits.constrain, zoomed in', () => {
  const plane = { x: 0, y: 0, width: 680, height: 360 };
  const fanLimits = (): CameraLimits => {
    const limits = createCameraLimits(fan, viewport);
    if (limits === null) throw new Error('no limits');
    return limits;
  };
  const fanBox = (id: string): ExplorerBox => {
    const box = fan.boxes.get(id);
    if (box === undefined) throw new Error(`no box for ${id}`);
    return box;
  };
  const overlaps = (a: ExplorerBox, b: ExplorerBox): boolean =>
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y;

  it.each(['c', 'b'])('leaves a camera focused on node %s unchanged', (id) => {
    const limits = fanLimits();
    const focused = focusCamera(fanBox(id), viewport, limits);
    const back = limits.constrain(focused);
    expect(back.x).toBeCloseTo(focused.x, 6);
    expect(back.y).toBeCloseTo(focused.y, 6);
    expect(back.scale).toBeCloseTo(focused.scale, 6);
  });

  it('clamps opposite pans to different cameras that both still see the plane', () => {
    const limits = fanLimits();
    const focused = focusCamera(fanBox('c'), viewport, limits);
    const down = limits.constrain(panCamera(focused, 5000, 5000));
    const up = limits.constrain(panCamera(focused, -5000, -5000));
    expect(down.x).not.toBeCloseTo(up.x, 1);
    expect(down.y).not.toBeCloseTo(up.y, 1);
    expect(overlaps(visibleWorld(down, viewport), plane)).toBe(true);
    expect(overlaps(visibleWorld(up, viewport), plane)).toBe(true);
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
    const floor = zoomCamera(fit, 0.5, { x: 400, y: 240 }, limits);
    expect(floor.x).toBeCloseTo(fit.x, 6);
    expect(floor.y).toBeCloseTo(fit.y, 6);
    expect(floor.scale).toBeCloseTo(fit.scale, 6);
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

  it('centers one axis and pans the other when a node is too big on one axis only', () => {
    // A box 900 by 50 at (100, 450), at scale 1, camera at the origin.
    // x: 900 > 800 - 24, so it centers: lo 100, hi 1000, middle 550, so
    //    the offset moves by 400 - 550 = -150.
    // y: 50 fits. lo 450, hi 500 is past 480 - 12 = 468, so the least pan
    //    is 468 - 500 = -32.
    const wide = { x: 100, y: 450, width: 900, height: 50 };
    expect(revealCamera(one, wide, viewport)).toEqual({ x: -150, y: -32, scale: 1 });
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

describe('a frame: the part of the viewport nothing covers', () => {
  // The drawer's 360 pixels off the right of an 800 by 480 viewport.
  const frame = { x: 0, y: 0, width: 440, height: 480 };
  const frameLimits = (): CameraLimits => {
    const limits = createCameraLimits(chain, frame);
    if (limits === null) throw new Error('no limits');
    return limits;
  };

  it('lets a node on the right edge be panned fully left of the inset', () => {
    const limits = frameLimits();
    const focused = focusCamera(boxOf('c'), frame, limits);
    const back = limits.constrain(focused);
    expect(back.x).toBeCloseTo(focused.x, 6);
    expect(back.scale).toBeCloseTo(focused.scale, 6);
    // c spans 760 to 1000.
    expect(focused.x + 1000 * focused.scale).toBeLessThanOrEqual(440);
    expect(limitsOf().constrain(focused).x).not.toBeCloseTo(focused.x, 1);
  });

  it('fits the plane in the frame, centered on it', () => {
    const limits = frameLimits();
    const fit = fitCamera(chain, frame, limits);
    // 440 * 0.9 / 1040: the plane's width, with 5% of the frame left each side.
    expect(fit.scale).toBeCloseTo(0.3808, 4);
    expect(fit.x + (chain.width * fit.scale) / 2).toBeCloseTo(220, 6);
    expect(fit.y + (chain.height * fit.scale) / 2).toBeCloseTo(240, 6);
    const shifted = { x: 360, y: 0, width: 440, height: 480 };
    const right = fitCamera(chain, shifted, limits);
    expect(right.x).toBeCloseTo(fit.x + 360, 6);
    const constrained = limits.constrain(fit);
    expect(constrained.x).toBeCloseTo(fit.x, 6);
    expect(constrained.y).toBeCloseTo(fit.y, 6);
  });

  it('focuses a node at the center of the frame, filling the frame', () => {
    const limits = frameLimits();
    const camera = focusCamera(boxOf('b'), { x: 100, y: 0, width: 440, height: 480 }, limits);
    // (440 - 48) / 240 is 1.633, under the frame's ceiling of 1.65.
    expect(camera.scale).toBeCloseTo(392 / 240, 6);
    // b's center is (520, 100), placed at the frame's center (320, 240).
    expect(camera.x + 520 * camera.scale).toBeCloseTo(320, 6);
    expect(camera.y + 100 * camera.scale).toBeCloseTo(240, 6);
  });

  it('reveals a node within the frame, 12 inside its edges', () => {
    const one = { x: 0, y: 0, scale: 1 };
    // c's right edge, 1000, goes to 440 - 12.
    expect(revealCamera(one, boxOf('c'), frame)).toEqual({ x: -572, y: 0, scale: 1 });
    // a starts at 40, left of a frame that begins at 100: it moves to 112.
    expect(revealCamera(one, boxOf('a'), { x: 100, y: 0, width: 700, height: 480 })).toEqual({ x: 72, y: 0, scale: 1 });
  });

  it('pans content past the edge by the contentPadding, clamped to [0, 0.45]', () => {
    const scaleAt = (padding: number): number => {
      const limits = createCameraLimits(chain, viewport, padding);
      if (limits === null) throw new Error('no limits');
      return limits.minScale;
    };
    expect(CONTENT_PADDING).toBe(0.05);
    // 800 * (1 - 2 * padding) / 1040.
    expect(scaleAt(0.2)).toBeCloseTo((800 * 0.6) / 1040, 6);
    expect(scaleAt(0.9)).toBeCloseTo((800 * 0.1) / 1040, 6);
    expect(scaleAt(-1)).toBeCloseTo(800 / 1040, 6);
    expect(scaleAt(Number.NaN)).toBeCloseTo(limitsOf().minScale, 6);
    expect(scaleAt(Number.POSITIVE_INFINITY)).toBeCloseTo(limitsOf().minScale, 6);

    // At a scale of 2, a padding of 0.3 lets the plane's left edge come
    // 0.3 of the viewport in from the left; 0.05 lets it come 0.05 in.
    const far = { x: 5000, y: 0, scale: 2 };
    const loose = createCameraLimits(chain, viewport, 0.3);
    if (loose === null) throw new Error('no limits');
    expect(loose.constrain(far).x).toBeCloseTo(240, 6);
    expect(limitsOf().constrain(far).x).toBeCloseTo(40, 6);
  });
});

describe('cameraFrame and obstructionInset', () => {
  const size = { width: 800, height: 480 };
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  const whole = rect(0, 0, 800, 480);

  it('is the whole viewport with no inset', () => {
    expect(cameraFrame(size, {})).toEqual({ x: 0, y: 0, width: 800, height: 480 });
  });

  it('takes each side in, ignoring a negative or non-finite inset', () => {
    expect(cameraFrame(size, { top: 40, right: 360, bottom: Number.NaN, left: -10 })).toEqual({
      x: 0,
      y: 40,
      width: 440,
      height: 440,
    });
  });

  it('ignores the insets on an axis they would squeeze under max(160, a quarter) or max(120, a quarter)', () => {
    expect(cameraFrame(size, { right: 600 })).toEqual({ x: 0, y: 0, width: 200, height: 480 });
    expect(cameraFrame(size, { right: 601, top: 40 })).toEqual({ x: 0, y: 40, width: 800, height: 440 });
    expect(cameraFrame({ width: 1600, height: 480 }, { left: 1201 }).width).toBe(1600);
    expect(cameraFrame(size, { top: 200, bottom: 161 })).toEqual({ x: 0, y: 0, width: 800, height: 480 });
  });

  it('insets the side a drawer covers by its width', () => {
    expect(obstructionInset(whole, rect(440, 0, 800, 480))).toEqual({ right: 360 });
    expect(obstructionInset(whole, rect(0, 0, 300, 480))).toEqual({ left: 300 });
    expect(obstructionInset(whole, rect(0, 0, 800, 60))).toEqual({ top: 60 });
  });

  it('measures against where the viewport is, and only the part that overlaps it', () => {
    const placed = rect(100, 50, 900, 530);
    expect(obstructionInset(placed, rect(540, 0, 900, 600))).toEqual({ right: 360 });
  });

  it('ignores an obstruction that does not touch a side, spans under half of it, or has no size', () => {
    expect(obstructionInset(whole, rect(300, 100, 500, 300))).toEqual({});
    expect(obstructionInset(whole, rect(600, 0, 800, 200))).toEqual({});
    expect(obstructionInset(whole, rect(0, 0, 0, 0))).toEqual({});
    expect(obstructionInset(whole, rect(800, 0, 1000, 480))).toEqual({});
  });

  it('leaves the whole frame for a drawer as wide as the viewport', () => {
    const phone = rect(0, 0, 375, 600);
    expect(cameraFrame({ width: 375, height: 600 }, obstructionInset(phone, phone))).toEqual({
      x: 0,
      y: 0,
      width: 375,
      height: 600,
    });
  });
});
