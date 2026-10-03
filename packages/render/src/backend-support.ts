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
  readonly createCanvas?: (() => { getContext(id: string, attributes?: object): unknown }) | undefined;
  /**
   * Refuse a software-rendered WebGL 2 context (`failIfMajorPerformanceCaveat`).
   * A phone or VM that reports WebGL 2 through a CPU rasterizer draws a large
   * graph at a few frames per second; strict mode reports it as unavailable so
   * the host can choose its fallback instead. Default false.
   */
  readonly strict?: boolean | undefined;
}

function defaultEnvironment(): BackendProbeEnvironment {
  const nav = (globalThis as { navigator?: { gpu?: BackendProbeEnvironment['gpu'] } }).navigator;
  const doc = (globalThis as { document?: { createElement(tag: string): unknown } }).document;
  return {
    gpu: nav?.gpu ?? null,
    createCanvas:
      doc === undefined
        ? undefined
        : () => doc.createElement('canvas') as { getContext(id: string, attributes?: object): unknown },
  };
}

/**
 * Probes WebGPU and WebGL 2 availability. Never throws: a probe that fails is
 * a backend that is not available.
 *
 * Takes one adapter request and, at most, one throwaway WebGL context (released
 * straight away), and the default environment's answer is memoised, so it is
 * cheap to call from any component. This is what a browser CAN start, not what
 * `createRenderer` will end up with: read `renderer.backend` for that. Do not infer
 * WebGPU performance from this: it says a backend starts, not how fast.
 */
export function detectBackendSupport(env?: BackendProbeEnvironment): Promise<BackendSupport> {
  // The default environment is memoised for the page: the answer does not
  // change within a session, and each probe takes an adapter request and a
  // WebGL context. An explicit environment (tests, server rendering) never is.
  if (env !== undefined) return probe(env);
  memo ??= probe(defaultEnvironment());
  return memo;
}

let memo: Promise<BackendSupport> | undefined;

async function probe(env: BackendProbeEnvironment): Promise<BackendSupport> {
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
      const context = env.createCanvas().getContext(
        'webgl2',
        env.strict === true ? { failIfMajorPerformanceCaveat: true } : undefined,
      ) as
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
