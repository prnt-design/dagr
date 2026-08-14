/**
 * The far side of worker mode: the handful of lines a worker module runs to
 * answer layout requests.
 */

import type { LayoutPort } from './engine.js';
import { runPrepared } from './pipeline.js';
import type { LayoutStageOverrides } from './types.js';
import { decodeRun, encodeFailure, encodeResult, isLayoutMessage } from './wire.js';

/**
 * Serves layout on a port: decode each request, run the pipeline, post the
 * answer back.
 *
 * The stages are this side's, and the config is not. That split is the protocol
 * in one sentence. Stages are functions and cannot cross a structured clone, so
 * the worker module is where a caller names the ranker they want and passes any
 * options to its factory; the config is numbers, and it crosses with every
 * request already resolved, so the two sides cannot disagree about what
 * `nodeSep` meant on a run and there is no second place to keep it in sync.
 *
 * Returns the function that stops serving. A worker module that serves for its
 * whole life can ignore it; a caller who put layout on a port they were already
 * using has something to call when they are done, and the listener is theirs to
 * remove rather than this package's to hold forever.
 *
 * Nothing here throws. A run that fails comes back as a failure message, which
 * `runAsync` turns into the rejection on the calling side: a worker that threw
 * into its own global scope instead would leave the caller's promise pending
 * forever, which is the one failure mode worse than the error itself. The
 * two members of the error family that survive the trip do so as themselves.
 * See `wire.ts`.
 */
export function serveLayout(port: LayoutPort, stages?: LayoutStageOverrides): () => void {
  const receive = (event: { readonly data: unknown }): void => {
    const message = event.data;
    // Answers are not ours to read, and neither is traffic that is not this
    // protocol's: serving layout on a port does not claim the port.
    if (!isLayoutMessage(message) || message.dagr !== 'layout-run') return;
    try {
      const { message: result, transfer } = encodeResult(
        message.id,
        runPrepared(decodeRun(message), stages),
      );
      port.postMessage(result, transfer);
    } catch (error) {
      const failure = encodeFailure(message.id, error);
      port.postMessage(failure.message, failure.transfer);
    }
  };
  port.addEventListener('message', receive);
  port.start?.();
  return () => {
    port.removeEventListener('message', receive);
  };
}
