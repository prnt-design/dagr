/**
 * A renderer with no GPU: `createRenderer` is the one thing these tests
 * replace, so the scene's springs and the motion loop under test are the
 * real ones. Each fake records what the scene last handed it.
 */

import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { Camera2D } from '../../render/src/camera.js';
import type {
  EdgeFrameStyle,
  FrameScheduler,
  Renderer,
  RendererBackend,
  RendererOptions,
  SceneEdge,
  SceneNode,
} from '@prnt/dagr-render';

export interface FakeRenderer extends Renderer {
  readonly options: RendererOptions;
  readonly render: Mock<() => void>;
  readonly dispose: Mock<() => void>;
  readonly pickNode: Mock<Renderer['pickNode']>;
  /** What the last frame drew. */
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
  edgeStyle: EdgeFrameStyle | null;
  intensityOf: (edgeId: string) => number;
}

export const built: {
  renderers: FakeRenderer[];
  backend: RendererBackend;
  /** Set to reject the next `createRenderer`. */
  failure: Error | null;
  /** Set to leave the next `createRenderer` pending until `release` is called. */
  hold: boolean;
  release: (() => void) | null;
} = { renderers: [], backend: 'webgpu', failure: null, hold: false, release: null };

export function resetFakes(): void {
  built.renderers = [];
  built.backend = 'webgpu';
  built.failure = null;
  built.hold = false;
  built.release = null;
}

export function lastRenderer(): FakeRenderer {
  const last = built.renderers.at(-1);
  if (last === undefined) throw new Error('no renderer was created');
  return last;
}

export function createRenderer(options: RendererOptions): Promise<Renderer> {
  if (built.failure !== null) {
    const failure = built.failure;
    built.failure = null;
    return Promise.reject(failure);
  }
  const fake: FakeRenderer = {
    options,
    camera: new Camera2D({ viewport: { width: 300, height: 150, devicePixelRatio: 1 } }),
    backend: built.backend,
    nodes: [],
    edges: [],
    edgeStyle: null,
    intensityOf: () => 1,
    setNodes(nodes) {
      fake.nodes = nodes;
    },
    setEdges(_groupId, edges) {
      fake.edges = edges;
    },
    setEdgeStyle(_groupId, style) {
      fake.edgeStyle = style;
    },
    setEdgeIntensity(_groupId, intensityOf) {
      fake.intensityOf = intensityOf;
    },
    resize: vi.fn(),
    pickNode: vi.fn(() => Promise.resolve(null)),
    render: vi.fn(),
    dispose: vi.fn(),
  };
  built.renderers.push(fake);
  if (!built.hold) return Promise.resolve(fake);
  built.hold = false;
  return new Promise((resolve) => {
    built.release = () => {
      resolve(fake);
    };
  });
}

export interface ManualFrames {
  readonly scheduler: FrameScheduler;
  pending(): boolean;
  /** Runs the queued frame, `stepMs` after the last. */
  tick(stepMs?: number): void;
  /** Runs frames until the loop stops asking, and says how many that took. */
  runUntilIdle(stepMs?: number): number;
}

/** A frame scheduler a test steps by hand, so a spring's progress is a function of the test and not of the clock. */
export function manualFrames(): ManualFrames {
  let queued: ((nowMs: number) => void) | null = null;
  let nowMs = 0;
  const frames: ManualFrames = {
    scheduler: {
      request(callback) {
        queued = callback;
        return 1;
      },
      cancel() {
        queued = null;
      },
    },
    pending: () => queued !== null,
    tick(stepMs = 16) {
      const callback = queued;
      queued = null;
      nowMs += stepMs;
      callback?.(nowMs);
    },
    runUntilIdle(stepMs = 16) {
      let ran = 0;
      while (queued !== null) {
        if (ran >= 2000) throw new Error('the frame loop ran 2000 frames without settling');
        frames.tick(stepMs);
        ran += 1;
      }
      return ran;
    },
  };
  return frames;
}
