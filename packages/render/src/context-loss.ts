import type { Renderer, RendererBackend } from './types.js';

/** Why a renderer stopped being able to draw. */
export interface ContextLostInfo {
  /** The backend that was lost. */
  readonly backend: Exclude<RendererBackend, 'unknown'>;
  /** The browser's reason or message, or `'context-lost'` for WebGL, which gives none. */
  readonly reason: string;
}

/** The parts of a canvas the watcher reads. */
interface LossTarget {
  addEventListener(type: 'webglcontextlost', listener: (event: Event) => void): void;
  removeEventListener(type: 'webglcontextlost', listener: (event: Event) => void): void;
}

/** The slice of a WebGPU device the watcher reads. */
interface LossDevice {
  readonly lost?: Promise<{ readonly reason?: string; readonly message?: string }>;
}

/**
 * Calls `notify` once if the renderer's device or context is lost, and stops
 * watching when the renderer is disposed.
 *
 * WebGL 2 reports loss as a `webglcontextlost` event on the canvas, and the
 * default is to never restore, so the event is cancelled to leave the choice to
 * the caller (a rebuilt renderer is the supported recovery). WebGPU reports it
 * as the device's `lost` promise, which also resolves with reason `destroyed`
 * on a normal dispose; that one is ignored. Wraps `dispose` on the instance so
 * the listener cannot outlive it.
 */
export function watchForContextLoss(
  renderer: Renderer,
  canvas: LossTarget,
  device: LossDevice | undefined,
  notify: (info: ContextLostInfo) => void,
): void {
  let done = false;
  const fire = (info: ContextLostInfo): void => {
    if (done) return;
    done = true;
    canvas.removeEventListener('webglcontextlost', onWebGL);
    notify(info);
  };
  const onWebGL = (event: Event): void => {
    event.preventDefault();
    fire({ backend: 'webgl2', reason: 'context-lost' });
  };
  canvas.addEventListener('webglcontextlost', onWebGL);
  void device?.lost?.then((info) => {
    if (info.reason === 'destroyed') return;
    fire({ backend: 'webgpu', reason: info.message || info.reason || 'device-lost' });
  });
  const dispose = renderer.dispose.bind(renderer);
  Object.defineProperty(renderer, 'dispose', {
    value(): void {
      done = true;
      canvas.removeEventListener('webglcontextlost', onWebGL);
      dispose();
    },
  });
}
