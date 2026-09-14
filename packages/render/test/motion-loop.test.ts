import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionLoop } from '../src/motion-loop.js';
import type { FrameScheduler, MotionLoop } from '../src/motion-loop.js';

/**
 * The loop, under a scheduler this file owns.
 *
 * `requestAnimationFrame` is the one thing in the motion modules that cannot be
 * tested by handing in a number, so the loop takes its scheduler as an option
 * and this file hands it one made of a `Map`: a frame runs when the test says
 * so, at the timestamp the test names. Every timing claim below is therefore
 * exact, and the cancel path is observable as an entry that is no longer there.
 */

interface FakeScheduler extends FrameScheduler {
  /** Runs every queued frame at `nowMs`, including any they queue themselves. */
  run(nowMs: number): void;
  /** How many frames are queued and unrun. */
  pending(): number;
}

function fakeScheduler(): FakeScheduler {
  const queue = new Map<number, (nowMs: number) => void>();
  let next = 1;
  return {
    request(callback) {
      const handle = next;
      next += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle as number);
    },
    run(nowMs) {
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(nowMs);
    },
    pending() {
      return queue.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMotionLoop', () => {
  it('runs nothing until woken', () => {
    const scheduler = fakeScheduler();
    const frame = vi.fn(() => true);
    const loop = createMotionLoop({ frame, scheduler });
    expect(loop.running).toBe(false);
    expect(scheduler.pending()).toBe(0);
    expect(frame).not.toHaveBeenCalled();
  });

  it('wakes into one frame, and is running from the moment it is woken', () => {
    const scheduler = fakeScheduler();
    const frame = vi.fn(() => true);
    const loop = createMotionLoop({ frame, scheduler });
    loop.wake();
    expect(loop.running).toBe(true);
    expect(scheduler.pending()).toBe(1);
    scheduler.run(1000);
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it('steps the first frame by zero and the next by the clock', () => {
    const scheduler = fakeScheduler();
    const seen: number[] = [];
    const loop = createMotionLoop({
      frame: (dt) => {
        seen.push(dt);
        return false;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(1000);
    scheduler.run(1016.5);
    scheduler.run(1050);
    expect(seen).toEqual([0, 0.0165, 0.0335]);
  });

  it('stops when a frame says the scene has settled', () => {
    const scheduler = fakeScheduler();
    const answers = [false, false, true];
    const loop = createMotionLoop({ frame: () => answers.shift() ?? true, scheduler });
    loop.wake();
    scheduler.run(0);
    scheduler.run(16);
    expect(loop.running).toBe(true);
    scheduler.run(32);
    expect(loop.running).toBe(false);
    expect(scheduler.pending()).toBe(0);
  });

  it('coalesces every wake while running into the one frame already queued', () => {
    const scheduler = fakeScheduler();
    const frame = vi.fn(() => false);
    const loop = createMotionLoop({ frame, scheduler });
    loop.wake();
    loop.wake();
    loop.wake();
    expect(scheduler.pending()).toBe(1);
    scheduler.run(0);
    expect(frame).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(1);
  });

  it('starts again from a zero step after settling, rather than from the idle gap', () => {
    // The gap between two animations is not motion. A loop that carried the
    // previous timestamp across its own stop would step the first frame of the
    // next animation by however long the scene sat still, which is exactly the
    // catch-up a fresh wake must not show.
    const scheduler = fakeScheduler();
    const seen: number[] = [];
    let settled = true;
    const loop = createMotionLoop({
      frame: (dt) => {
        seen.push(dt);
        return settled;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(1000);
    expect(loop.running).toBe(false);
    settled = false;
    loop.wake();
    scheduler.run(61_000);
    scheduler.run(61_016);
    expect(seen).toEqual([0, 0, 0.016]);
  });

  it('runs one more frame when woken from inside a frame that settled', () => {
    // A delta applied during a frame callback, after the advance that decided
    // the frame was the last one. The settled answer predates the wake, so the
    // wake wins and the next frame reads the new targets.
    const scheduler = fakeScheduler();
    let calls = 0;
    const loop: MotionLoop = createMotionLoop({
      frame: () => {
        calls += 1;
        if (calls === 1) loop.wake();
        return true;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(0);
    expect(loop.running).toBe(true);
    expect(scheduler.pending()).toBe(1);
    scheduler.run(16);
    expect(calls).toBe(2);
    expect(loop.running).toBe(false);
  });

  it('stops on a frame that throws, and lets the throw out', () => {
    const scheduler = fakeScheduler();
    let calls = 0;
    const loop = createMotionLoop({
      frame: () => {
        calls += 1;
        if (calls === 1) throw new Error('renderer gone');
        return true;
      },
      scheduler,
    });
    loop.wake();
    expect(() => {
      scheduler.run(0);
    }).toThrow('renderer gone');
    expect(loop.running).toBe(false);
    expect(scheduler.pending()).toBe(0);
    // And it is usable afterwards: the failure was the frame's, not the loop's.
    loop.wake();
    scheduler.run(16);
    expect(calls).toBe(2);
  });

  it('never steps backwards when the clock does', () => {
    const scheduler = fakeScheduler();
    const seen: number[] = [];
    const loop = createMotionLoop({
      frame: (dt) => {
        seen.push(dt);
        return false;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(1000);
    scheduler.run(900);
    expect(seen).toEqual([0, 0]);
  });

  it('takes its frame back on dispose, and ignores a wake afterwards', () => {
    const scheduler = fakeScheduler();
    const frame = vi.fn(() => false);
    const loop = createMotionLoop({ frame, scheduler });
    loop.wake();
    loop.dispose();
    expect(scheduler.pending()).toBe(0);
    expect(loop.running).toBe(false);
    loop.wake();
    expect(scheduler.pending()).toBe(0);
    expect(loop.running).toBe(false);
    loop.dispose();
  });

  it('uses requestAnimationFrame when no scheduler is given', () => {
    const request = vi.fn((callback: FrameRequestCallback) => {
      callback(5);
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frame = vi.fn(() => true);
    const loop = createMotionLoop({ frame });
    loop.wake();
    expect(request).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledWith(0);
    expect(loop.running).toBe(false);
  });

  it('reports itself running from inside the frame it is running', () => {
    const scheduler = fakeScheduler();
    const seen: boolean[] = [];
    const loop: MotionLoop = createMotionLoop({
      frame: () => {
        seen.push(loop.running);
        return true;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(0);
    expect(seen).toEqual([true]);
    expect(loop.running).toBe(false);
  });

  it('stops for good when disposed from inside a frame', () => {
    // The lifecycle race a `useEffect` cleanup runs: the thing the frame draws
    // to goes away while the frame is drawing to it. Disposing must take effect
    // after the callback returns rather than being overwritten by the reschedule
    // the callback's own answer would otherwise ask for.
    const scheduler = fakeScheduler();
    let calls = 0;
    const loop: MotionLoop = createMotionLoop({
      frame: () => {
        calls += 1;
        loop.dispose();
        return false;
      },
      scheduler,
    });
    loop.wake();
    scheduler.run(0);
    expect(calls).toBe(1);
    expect(loop.running).toBe(false);
    expect(scheduler.pending()).toBe(0);
    loop.wake();
    expect(scheduler.pending()).toBe(0);
  });

  it('stops rather than sticking when the scheduler refuses a later frame', () => {
    // A caller's own coalesced frame queue, torn down with the surface it draws
    // to, before they got to `dispose`. The tail of a frame asks for the next
    // one, and if that ask throws the loop must not be left claiming to run with
    // no frame queued and no frame on the stack: every later wake would return
    // early on `running` and the loop could never run again or say it had
    // stopped.
    let refuse = false;
    const inner = fakeScheduler();
    const scheduler: FrameScheduler = {
      request: (callback) => {
        if (refuse) throw new Error('frame queue is gone');
        return inner.request(callback);
      },
      cancel: (handle) => inner.cancel(handle),
    };
    const loop = createMotionLoop({ frame: () => false, scheduler });
    loop.wake();
    refuse = true;
    expect(() => {
      inner.run(0);
    }).toThrow('frame queue is gone');
    expect(loop.running).toBe(false);
    // And it recovers once the caller's queue does, which a stuck loop cannot.
    refuse = false;
    loop.wake();
    expect(loop.running).toBe(true);
    inner.run(16);
    expect(loop.running).toBe(true);
  });

  it('refuses to wake where there is no requestAnimationFrame and no scheduler', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const loop = createMotionLoop({ frame: () => true });
    expect(() => {
      loop.wake();
    }).toThrow(/scheduler/);
    expect(loop.running).toBe(false);
  });
});
