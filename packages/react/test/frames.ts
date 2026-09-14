/**
 * A hand-driven `requestAnimationFrame`, so a test can say when a frame runs.
 *
 * A NON-TEST helper. jsdom does implement `requestAnimationFrame`, on a timer,
 * which makes "has the canvas drawn yet" a race against a real clock inside an
 * `act` that has no reason to wait for it. Replacing it with a queue makes the
 * frame an event the test causes, which is what every assertion about drawing
 * in this package actually wants to talk about.
 *
 * It also makes the cancel path observable: {@link pendingFrames} counts the
 * callbacks still queued, so a test can assert that unmounting took its frame
 * back rather than leaving one to run against a disposed renderer.
 */

import { vi } from 'vitest';
import { flush } from './mount.js';

const queue = new Map<number, FrameRequestCallback>();
let nextHandle = 1;

/** Installs the queue in place of the environment's own. Call it per test. */
export function installFrameQueue(): void {
  queue.clear();
  nextHandle = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const handle = nextHandle;
    nextHandle += 1;
    queue.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    queue.delete(handle);
  });
}

/** How many frames are queued and unrun. */
export function pendingFrames(): number {
  return queue.size;
}

/**
 * Runs every queued frame inside `act`, at `nowMs` on the frame clock.
 *
 * A frame a callback queues for itself is NOT run here: it is the next frame,
 * and running it in this call would make one animation's whole settling happen
 * inside one `runFrames`, with no way for a test to say what the drawing looked
 * like in between. The timestamp is the caller's for the same reason. A spring
 * is stepped by the gap between two frames, so a test that wants to talk about
 * a node halfway to its target has to be the thing that decides how much time
 * has passed. See {@link runFramesUntilIdle} for the other half.
 */
export async function runFrames(nowMs = 0): Promise<void> {
  const due = [...queue.entries()];
  queue.clear();
  await flush(() => {
    for (const [, callback] of due) callback(nowMs);
  });
}

/**
 * Runs frames at `stepMs` apart until nothing asks for another, and says how
 * many it took.
 *
 * The cap is what makes a loop that never stops a failing test rather than a
 * hung one: it throws by name instead of running until vitest gives up.
 */
export async function runFramesUntilIdle(stepMs = 16, cap = 400): Promise<number> {
  let ran = 0;
  let nowMs = 0;
  while (queue.size > 0) {
    if (ran >= cap) throw new Error(`the frame loop ran ${String(cap)} frames without settling`);
    nowMs += stepMs;
    await runFrames(nowMs);
    ran += 1;
  }
  return ran;
}
