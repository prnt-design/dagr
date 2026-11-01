import { describe, expect, it, vi } from 'vitest';

// Every way this package reaches three.js, made to throw on load. A factory
// that throws fails the import of whatever asked for the module, so the core
// entry loading under these three mocks is the evidence that nothing in its
// import graph asks.
vi.mock('three', () => {
  throw new Error('loaded three');
});
vi.mock('three/webgpu', () => {
  throw new Error('loaded three/webgpu');
});
vi.mock('three/tsl', () => {
  throw new Error('loaded three/tsl');
});

describe('@prnt/dagr-render/core', () => {
  it('loads and works with three.js unavailable', async () => {
    const core = await import('../src/core.js');
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const camera = new core.Camera2D({
      viewport: { width: 320, height: 200, devicePixelRatio: 1 },
    });
    const pinch = core.createPinchGesture();
    pinch.down(1, { x: 0, y: 0 });
    pinch.down(2, { x: 100, y: 0 });
    expect(pinch.move(2, { x: 200, y: 0 })?.factor).toBe(2);
    expect(core.visibleFrame({ width: 320, height: 200 }, { right: 100 })).toEqual({ x: 0, y: 0, width: 220, height: 200 });
    camera.fitBounds(bounds);
    expect(core.fitZoom(bounds, camera.viewport)).toBe(camera.zoom);
    expect(core.shapeEdgePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('exports the explicit GPU-free runtime surface', async () => {
    // Keep the GPU-free public surface explicit; type exports are erased.
    const core = await import('../src/core.js');
    expect(Object.keys(core).sort()).toEqual([
      'Camera2D',
      'clipInset',
      'coverInset',
      'createPinchGesture',
      'fitZoom',
      'shapeEdgePath',
      'visibleFrame',
      'visualViewportInset',
    ]);
  });

  it('is guarded by mocks that do fail the full entry', async () => {
    // The control. Without it, mocks that never fired would let the first
    // test pass for the wrong reason.
    await expect(import('../src/index.js')).rejects.toThrow();
  });
});
