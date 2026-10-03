import type { RendererBackend } from './types.js';

/**
 * Which GPU backends this browser can actually start, probed before a renderer
 * is built.
 *
 * `createRenderer({ backend: 'auto' })` already falls back from WebGPU to
 * WebGL 2 on its own. What it cannot do is draw when NEITHER exists (a locked
 * down WebView, a headless crawler, a device with GPU access disabled): it
 * rejects with the browser's error. A host that wants to render a static or
 * DOM/SVG alternative instead of an error probes first.
 */
export interface BackendSupport {
  /** A WebGPU adapter was obtained. `navigator.gpu` alone is not enough: many phones expose the object and return no adapter. */
  readonly webgpu: boolean;
  /** A WebGL 2 context could be created. */
  readonly webgl2: boolean;
  /** What `backend: 'auto'` will pick: WebGPU, else WebGL 2, else `null`. */
  readonly preferred: Exclude<RendererBackend, 'unknown'> | null;
}

/** The slice of the browser the probe reads. Injectable so it is testable without one. */
export interface BackendProbeEnvironment {
  /** `navigator.gpu`, when the browser has it. */
  readonly gpu?: { requestAdapter(): Promise<unknown> } | null | undefined;
  /** Makes a throwaway canvas. Default `document.createElement('canvas')`. */
  readonly createCanvas?: (() => { getContext(id: string): unknown }) | undefined;
}

function defaultEnvironment(): BackendProbeEnvironment {
  const nav = (globalThis as { navigator?: { gpu?: BackendProbeEnvironment['gpu'] } }).navigator;
  const doc = (globalThis as { document?: { createElement(tag: string): unknown } }).document;
  return {
    gpu: nav?.gpu ?? null,
    createCanvas:
      doc === undefined
        ? undefined
        : () => doc.createElement('canvas') as { getContext(id: string): unknown },
  };
}

/**
 * Probes WebGPU and WebGL 2 availability. Never throws: a probe that fails is
 * a backend that is not available.
 *
 * Takes one adapter request and, at most, one throwaway WebGL context (released
 * straight away), so it is cheap enough to call once at startup. Do not infer
 * WebGPU performance from this: it says a backend starts, not how fast.
 */
export async function detectBackendSupport(
  env: BackendProbeEnvironment = defaultEnvironment(),
): Promise<BackendSupport> {
  let webgpu = false;
  if (env.gpu) {
    try {
      webgpu = (await env.gpu.requestAdapter()) != null;
    } catch {
      webgpu = false;
    }
  }
  let webgl2 = false;
  if (env.createCanvas) {
    try {
      const context = env.createCanvas().getContext('webgl2') as
        | { getExtension?(name: string): { loseContext?(): void } | null }
        | null;
      webgl2 = context != null;
      context?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    } catch {
      webgl2 = false;
    }
  }
  return { webgpu, webgl2, preferred: webgpu ? 'webgpu' : webgl2 ? 'webgl2' : null };
}
