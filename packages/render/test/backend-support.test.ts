import { describe, expect, it, vi } from 'vitest';
import { detectBackendSupport } from '../src/backend-support.js';

const canvasWith = (context: unknown) => () => ({ getContext: () => context });

describe('detectBackendSupport', () => {
  it('prefers WebGPU when an adapter arrives', async () => {
    const support = await detectBackendSupport({
      gpu: { requestAdapter: () => Promise.resolve({}) },
      createCanvas: canvasWith({}),
    });
    expect(support).toEqual({ webgpu: true, webgl2: true, preferred: 'webgpu' });
  });
  it('treats navigator.gpu with no adapter as unavailable (many phones)', async () => {
    const support = await detectBackendSupport({
      gpu: { requestAdapter: () => Promise.resolve(null) },
      createCanvas: canvasWith({}),
    });
    expect(support).toEqual({ webgpu: false, webgl2: true, preferred: 'webgl2' });
  });
  it('treats a throwing adapter request or context probe as unavailable', async () => {
    const support = await detectBackendSupport({
      gpu: { requestAdapter: () => Promise.reject(new Error('blocked')) },
      createCanvas: () => {
        throw new Error('no dom');
      },
    });
    expect(support).toEqual({ webgpu: false, webgl2: false, preferred: null });
  });
  it('reports nothing when neither exists, and releases the probe context', async () => {
    expect(await detectBackendSupport({})).toEqual({ webgpu: false, webgl2: false, preferred: null });
    const loseContext = vi.fn();
    await detectBackendSupport({
      createCanvas: canvasWith({ getExtension: () => ({ loseContext }) }),
    });
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
