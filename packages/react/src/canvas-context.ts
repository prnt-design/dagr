/**
 * What a `<DagrCanvas>` publishes to everything inside it.
 *
 * The M5.1 entry called this out before there was a line of it: `<Html>` has to
 * FIND the overlay, either by taking one as a prop, which nobody would accept
 * for a component used once per node, or by reading a context, and the context
 * is `<DagrCanvas>`'s to provide. This file is that context, and it is its own
 * module rather than living beside the component so that `<Html>` can import
 * the hook without importing the canvas, which would be a cycle.
 *
 * **The handle carries the layout as well as the renderer.** That is the
 * decision here and it is not obvious: a context of `{ renderer, overlay }`
 * would be smaller and would make `<Html node="a">` impossible, because
 * knowing where node `a` sits means holding the layout the canvas ran. The
 * alternative is a consumer running the layout themselves with `useDagr` and
 * passing coordinates down, which is the same layout computed twice and two
 * answers that can disagree while an edit is in flight.
 *
 * The context value is only ever provided once the renderer, the overlay and
 * the layout all exist, so nothing on the handle is nullable. The cost is that
 * children do not render at all until the device is ready, which is stated
 * where it can be acted on: in `<DagrCanvas>`'s own docstring, next to what to
 * render in the meantime.
 */

import { createContext, useContext } from 'react';
import type { LayoutResult } from '@dagr/layout';
import type { HtmlOverlay, Renderer } from '@dagr/render';
import { CanvasContextError } from './errors.js';

/** The canvas, as everything inside it sees it. */
export interface DagrCanvasHandle {
  /** The renderer drawing this canvas. Its camera is the one the overlay follows. */
  readonly renderer: Renderer;

  /** The overlay `<Html>` registers with. */
  readonly overlay: HtmlOverlay;

  /** The layout currently on screen, which is what places anything by node id. */
  readonly result: LayoutResult;

  /**
   * Asks for one frame, coalescing every caller in the same frame into one.
   *
   * Anything that changes what the canvas should look like calls this, and
   * nothing calls `renderer.render()` directly. The overlay's own `sync` runs
   * inside the same callback for the reason `HtmlOverlay.sync` gives: a second
   * loop is a second frame budget and a frame of skew, which reads as the
   * labels swimming over the graph during a pan.
   */
  requestDraw(): void;
}

/**
 * `null` is the unprovided value, and the hook below is the only reader.
 *
 * Exported so `<DagrCanvas>` can provide it and for no other reason. A consumer
 * reaching for the context object rather than the hook gets the unchecked
 * `null` the hook exists to turn into a named error.
 */
export const DagrCanvasContext = createContext<DagrCanvasHandle | null>(null);

/**
 * The canvas this component is inside.
 *
 * @throws {CanvasContextError} when there is no `<DagrCanvas>` above it.
 */
export function useDagrCanvas(): DagrCanvasHandle {
  const handle = useContext(DagrCanvasContext);
  if (handle === null) throw new CanvasContextError('useDagrCanvas');
  return handle;
}
