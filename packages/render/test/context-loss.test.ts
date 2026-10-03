import { describe, expect, it, vi } from 'vitest';
import { watchForContextLoss } from '../src/context-loss.js';
import type { Renderer } from '../src/types.js';

function fakeRenderer(): { renderer: Renderer; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return { renderer: { dispose } as unknown as Renderer, dispose };
}

function fakeCanvas() {
  const listeners = new Set<(event: Event) => void>();
  return {
    listeners,
    addEventListener: (_t: 'webglcontextlost', l: (e: Event) => void) => listeners.add(l),
    removeEventListener: (_t: 'webglcontextlost', l: (e: Event) => void) => listeners.delete(l),
  };
}

describe('watchForContextLoss', () => {
  it('reports a WebGL context loss once and cancels the default so the caller decides', () => {
    const canvas = fakeCanvas();
    const { renderer } = fakeRenderer();
    const notify = vi.fn();
    watchForContextLoss(renderer, canvas, undefined, notify);
    const event = new Event('webglcontextlost', { cancelable: true });
    [...canvas.listeners][0]?.(event);
    expect(event.defaultPrevented).toBe(true);
    expect(notify).toHaveBeenCalledWith({ backend: 'webgl2', reason: 'context-lost' });
    expect(canvas.listeners.size).toBe(0);
  });

  it('reports a lost WebGPU device with its message, and ignores a normal destroy', async () => {
    const notify = vi.fn();
    watchForContextLoss(fakeRenderer().renderer, fakeCanvas(), { lost: Promise.resolve({ reason: 'unknown', message: 'GPU hung' }) }, notify);
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith({ backend: 'webgpu', reason: 'GPU hung' });
    const quiet = vi.fn();
    watchForContextLoss(fakeRenderer().renderer, fakeCanvas(), { lost: Promise.resolve({ reason: 'destroyed' }) }, quiet);
    await Promise.resolve();
    await Promise.resolve();
    expect(quiet).not.toHaveBeenCalled();
  });

  it('stops watching on dispose and still disposes the renderer', () => {
    const canvas = fakeCanvas();
    const { renderer, dispose } = fakeRenderer();
    const notify = vi.fn();
    watchForContextLoss(renderer, canvas, undefined, notify);
    renderer.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(canvas.listeners.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
