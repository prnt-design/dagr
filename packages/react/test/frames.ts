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

/** Runs every queued frame inside `act`, including any they queue themselves. */
export async function runFrames(): Promise<void> {
  const due = [...queue.entries()];
  queue.clear();
  await flush(() => {
    for (const [, callback] of due) callback(0);
  });
}
