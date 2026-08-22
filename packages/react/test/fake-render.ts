/**
 * A stand-in for `@dagr/render`, so a component test can run without a GPU.
 *
 * A NON-TEST helper. `vi.mock('@dagr/render', () => import('./fake-render.js'))`
 * puts it in the renderer's place, which is what the M5.1 entry asks for when
 * it says "mocked-renderer component tests".
 *
 * **What that buys and what it costs, stated rather than assumed.** It buys the
 * only thing these tests are about: which calls `DagrCanvas` makes, in what
 * order, with what arguments, and whether it takes them all back on unmount.
 * None of that needs a device, and jsdom cannot provide one. What it costs is
 * that the renderer and the overlay are not exercised at all here: a real
 * `createHtmlOverlay` refuses a parent that is not positioned, a real
 * `resize` refuses a zero viewport, and neither refusal can happen against
 * this file. `@dagr/render`'s own suite covers both, and the two places where
 * this package has to hold up its end of those contracts are asserted directly
 * instead: the container's `position`, and the zero-size viewport guard.
 */

import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  HtmlOverlay,
  HtmlOverlayOptions,
  OverlayEntry,
  OverlayEntryInit,
  Renderer,
  RendererOptions,
} from '@dagr/render';

/** The camera calls `DagrCanvas` makes. Not a `Camera2D`: that class is nominal. */
export interface FakeCamera {
  readonly fitBounds: Mock<(bounds: unknown, padding?: number) => void>;
}

/** Every renderer method, recorded. */
export interface FakeRenderer {
  readonly camera: FakeCamera;
  readonly setNodes: Mock<(nodes: readonly unknown[]) => void>;
  readonly setEdges: Mock<(groupId: string, edges: readonly unknown[]) => void>;
  readonly resize: Mock<(viewport: unknown) => void>;
  readonly render: Mock<() => void>;
  readonly dispose: Mock<() => void>;
  /** The options it was built with, which is where the edge groups are named. */
  readonly options: RendererOptions;
}

/** Every overlay method, recorded, plus the entries still registered. */
export interface FakeOverlay {
  readonly add: Mock<(init: OverlayEntryInit) => OverlayEntry>;
  readonly sync: Mock<() => void>;
  readonly dispose: Mock<() => void>;
  readonly entries: FakeEntry[];
  readonly options: HtmlOverlayOptions;
}

/** One registered entry, and whether it is still registered. */
export interface FakeEntry {
  readonly init: OverlayEntryInit;
  placement: OverlayEntryInit['placement'];
  removed: boolean;
}

/** Everything the fake has been asked to build this test, in creation order. */
export const built: {
  renderers: FakeRenderer[];
  overlays: FakeOverlay[];
  /** Set to reject the next `createRenderer`, for the failure path. */
  rendererFailure: Error | null;
  /** Set to leave the next `createRenderer` pending, for the unmount-mid-flight path. */
  hold: boolean;
  /** Settles the held promise. Set by `createRenderer` while `hold` is true. */
  release: (() => void) | null;
} = { renderers: [], overlays: [], rendererFailure: null, hold: false, release: null };

/** Clears the record between tests. Call it from `beforeEach`. */
export function resetFakes(): void {
  built.renderers = [];
  built.overlays = [];
  built.rendererFailure = null;
  built.hold = false;
  built.release = null;
}

/** The most recent renderer, which is the one a single-mount test means. */
export function lastRenderer(): FakeRenderer {
  const last = built.renderers.at(-1);
  if (last === undefined) throw new Error('no renderer was created');
  return last;
}

/** The most recent overlay, which is the one a single-mount test means. */
export function lastOverlay(): FakeOverlay {
  const last = built.overlays.at(-1);
  if (last === undefined) throw new Error('no overlay was created');
  return last;
}

export function createRenderer(options: RendererOptions): Promise<Renderer> {
  const fake: FakeRenderer = {
    camera: { fitBounds: vi.fn() },
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    resize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    options,
  };
  built.renderers.push(fake);

  const failure = built.rendererFailure;
  if (failure !== null) return Promise.reject(failure);

  // The renderer is cast rather than implemented: `Renderer.camera` is a
  // `Camera2D`, a class with `#private` fields, so nothing outside that file
  // can be one. The cast is the honest version of that fact and it is here,
  // once, rather than at every call site in the tests.
  const renderer = fake as unknown as Renderer;

  if (!built.hold) return Promise.resolve(renderer);
  return new Promise<Renderer>((resolve) => {
    built.release = () => {
      resolve(renderer);
    };
  });
}

export function createHtmlOverlay(options: HtmlOverlayOptions): HtmlOverlay {
  const entries: FakeEntry[] = [];
  const fake: FakeOverlay = {
    add: vi.fn((init: OverlayEntryInit): OverlayEntry => {
      const entry: FakeEntry = { init, placement: init.placement, removed: false };
      entries.push(entry);
      return {
        place(placement): void {
          entry.placement = placement;
        },
        remove(): void {
          entry.removed = true;
        },
      };
    }),
    sync: vi.fn(),
    dispose: vi.fn(),
    entries,
    options,
  };
  built.overlays.push(fake);
  return fake as unknown as HtmlOverlay;
}
