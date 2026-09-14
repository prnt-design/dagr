/**
 * The loop: the starting half of the clock this package has declined to own
 * since M4.6.
 *
 * `render.md` has said since the springs landed that this package needs an
 * opinion about starting and stopping a `requestAnimationFrame`. The stopping
 * half arrived with M4.7a as `settled`, and every frame type since has carried
 * it. This is the starting half, and the whole of the opinion is three
 * sentences. A LOOP IS WOKEN, NOT STARTED: a caller who has just applied a
 * delta calls `wake()`, and a loop already running takes the wake as the one
 * frame it was going to run anyway. A LOOP STOPS ITSELF: the frame callback
 * says whether anything is still moving, and the loop asks for no frame after
 * the one that said no. A LOOP OWNS NO STATE BUT ITS TIMESTAMP: what to step
 * and what to draw are the callback's, so the same loop drives a scene motion,
 * a dash flow, or a caller's own springs.
 *
 * **THE FIRST FRAME AFTER A WAKE STEPS BY ZERO, EVERY TIME.** Not only the
 * first frame ever. A loop that carried its previous timestamp across its own
 * stop would step the first frame of the next animation by however long the
 * scene sat still, and a spring stepped by a minute lands on its target: the
 * drawing would cut to the new layout on the frame the animation was supposed
 * to begin. The timestamp is cleared on every stop, so a wake after an hour
 * idle and a wake after a millisecond both draw the scene where it is and
 * begin from there. This is the same rule `render.md`'s five-line loop stated
 * for its first frame, made to hold for every restart.
 *
 * **THE SCHEDULER IS AN OPTION, AND THAT IS HOW THIS COEXISTS WITH A CALLER
 * WHO ALREADY HAS A LOOP.** The campaign stage and `<DagrCanvas>` each
 * coalesce their own `requestAnimationFrame`, and M4.7c's entry asked how a
 * package loop lives beside one. Two loops would be two frame budgets and a
 * frame of skew, which is the failure `HtmlOverlay.sync` already refuses on
 * its own account. So the loop does not insist on `requestAnimationFrame`: a
 * {@link FrameScheduler} is two functions, and a caller with a coalesced
 * frame hands in theirs, so the loop's frame IS their frame. A caller with no
 * loop of their own passes nothing and gets the platform's. A test passes a
 * `Map`, which is what makes every timing claim in `motion-loop.test.ts`
 * exact rather than sampled.
 *
 * **A WAKE DURING A FRAME WINS OVER THAT FRAME'S SETTLED.** A delta applied
 * inside a frame callback, after the advance that decided the frame was the
 * last one, would otherwise be a delta nobody animates until the next
 * unrelated wake. The loop notes a wake that arrives while a frame is running
 * and asks for one more frame whatever the callback returned.
 *
 * **A FRAME THAT THROWS STOPS THE LOOP AND LETS THE THROW OUT.** Rescheduling
 * after a throw would be a loop throwing sixty times a second into the
 * platform's error handler until the tab is closed. Swallowing it would be
 * this package's polarity reversed. The loop is usable afterwards: the failure
 * was the frame's, and the next wake runs a fresh first frame.
 *
 * **A LONG FRAME IS NOT CLAMPED HERE EITHER.** `spring.ts` says why an exact
 * step needs no clamp and `ribbon.ts` says why a periodic one does not; a
 * clamp in the loop would impose one on both. A clock that runs BACKWARDS is
 * the one thing the loop does refuse: a negative step is clamped to zero,
 * because `advance` rejects it by name and a scheduler is not obliged to be
 * monotonic.
 *
 * What the loop deliberately does NOT do is render. `render()` and
 * `overlay.sync()` are the callback's to call, in the order the overlay's
 * docstring asks for, because the loop cannot know what else the caller draws
 * in a frame and a loop that rendered would draw before the caller's own
 * per-frame work.
 */

/**
 * Where the loop gets its frames.
 *
 * The shape of `requestAnimationFrame` and `cancelAnimationFrame`, with the
 * handle left opaque so a caller's own scheduler can hand back whatever it
 * likes. The callback receives the scheduler's clock in MILLISECONDS, which is
 * what the platform's gives; the loop is what turns two of those into the
 * seconds `advance` takes.
 */
export interface FrameScheduler {
  /** Asks for one frame. Returns a handle {@link cancel} accepts. */
  request(callback: (nowMs: number) => void): unknown;
  /** Takes back a frame not yet run. A handle already run is a no-op. */
  cancel(handle: unknown): void;
}

/** What {@link createMotionLoop} takes. */
export interface MotionLoopOptions {
  /**
   * One frame: step by `dtSeconds`, draw, and say whether anything is still
   * moving. Return `true` when the scene has settled and the loop should stop
   * asking for frames; that is `SceneMotionFrame.settled` when the loop
   * drives a scene motion. Zero on the first frame after every wake.
   */
  readonly frame: (dtSeconds: number) => boolean;

  /**
   * Where frames come from. Defaults to `requestAnimationFrame`, read from
   * the global at the first wake rather than at construction, so the module
   * imports cleanly where there is none and a loop built on a server throws
   * only if it is woken there.
   *
   * `?: T | undefined` rather than `?: T`, which is redundant under a default
   * tsconfig and is not under `exactOptionalPropertyTypes`, which this repo
   * sets and a careful consumer sets too. Under that flag `?: T` means the key
   * may be ABSENT but may not be present holding `undefined`, and a React
   * wrapper threading `scheduler` out of a ref, which is the ordinary shape
   * here, stops compiling. `engine.ts` widened `LayoutEngineOptions` for the
   * same reason.
   */
  readonly scheduler?: FrameScheduler | undefined;
}

/** A loop, and the three things done to it. */
export interface MotionLoop {
  /**
   * Asks for frames until a frame says the scene has settled.
   *
   * Idempotent while running: a loop already running takes the wake as the
   * frame it was going to run anyway. After {@link dispose} it does nothing,
   * on `HtmlOverlay.sync`'s terms rather than `Renderer.render`'s: a wake that
   * arrives after an unmount is a lifecycle race with nothing to draw, not a
   * frame drawn wrong.
   *
   * @throws {TypeError} when there is no scheduler and no
   *   `requestAnimationFrame` to fall back to.
   */
  wake(): void;

  /** Whether a frame is queued or running. True from a wake until a frame settles. */
  readonly running: boolean;

  /** Takes back any queued frame, and ends the loop. Idempotent. */
  dispose(): void;
}

/** What the platform is expected to have, as this module reads it. */
interface FrameHost {
  requestAnimationFrame?: (callback: (nowMs: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/**
 * A scheduler that goes through the platform, or `null` where there is none.
 *
 * Resolved at the first wake rather than at import, so importing this package on
 * a server is not an error and only waking a loop there is. Read through
 * `globalThis` for the same reason.
 *
 * **IT DOES NOT PIN THE FUNCTION IT FOUND.** Each call reads
 * `requestAnimationFrame` off the host again, so a loop woken before a test
 * replaced the global does not go on driving the old one, and a loop that
 * outlives a jsdom teardown fails at the call rather than into a detached
 * window. What is decided once is WHETHER the platform has one at all, which is
 * what the wake needs an answer to; which function that is, is the host's
 * business every time.
 */
function platformScheduler(): FrameScheduler | null {
  const host = globalThis as FrameHost;
  if (typeof host.requestAnimationFrame !== 'function') return null;
  return {
    request: (callback) => {
      const request = (globalThis as FrameHost).requestAnimationFrame;
      if (typeof request !== 'function') {
        throw new TypeError(
          'createMotionLoop: requestAnimationFrame has gone away since this loop was woken, ' +
            'so pass a scheduler',
        );
      }
      return request.call(globalThis, callback);
    },
    cancel: (handle) => {
      const cancel = (globalThis as FrameHost).cancelAnimationFrame;
      if (typeof cancel === 'function') cancel.call(globalThis, handle as number);
    },
  };
}

/**
 * Creates a loop over `options.frame`.
 *
 * @param options The frame callback and, optionally, the scheduler. See
 *   {@link MotionLoopOptions}.
 */
export function createMotionLoop(options: MotionLoopOptions): MotionLoop {
  const { frame } = options;
  let scheduler = options.scheduler ?? null;

  /** The queued frame's handle, or `undefined` when none is queued. */
  let queued: unknown = undefined;
  let running = false;
  let disposed = false;
  /** Whether a frame callback is on the stack right now. */
  let inFrame = false;
  /** A wake that arrived while {@link inFrame}, to be honoured after it. */
  let wokenDuringFrame = false;
  /** The last frame's clock, cleared on every stop so a restart steps by zero. */
  let previousMs: number | undefined = undefined;

  function resolveScheduler(): FrameScheduler {
    if (scheduler !== null) return scheduler;
    const platform = platformScheduler();
    if (platform === null) {
      throw new TypeError(
        'createMotionLoop: no scheduler was given and there is no requestAnimationFrame here, ' +
          'so pass a scheduler',
      );
    }
    scheduler = platform;
    return scheduler;
  }

  function stop(): void {
    running = false;
    previousMs = undefined;
  }

  /**
   * Asks for the next frame, and stops the loop if asking fails.
   *
   * ONE function for both call sites, and the reason is the state a second
   * spelling left reachable. `wake` guarded its own `schedule` and the tail of
   * `onFrame` did not, so a scheduler that threw at the end of a frame (a
   * caller's own frame queue, torn down with the surface it draws to, before
   * they got to `dispose`) left the loop with `running` true, no frame queued
   * and no frame on the stack. Every later `wake` then returned early on
   * `running` and the loop could never run again or report that it had stopped.
   */
  function startFrame(): void {
    try {
      queued = resolveScheduler().request(onFrame);
    } catch (cause: unknown) {
      stop();
      throw cause;
    }
  }

  function onFrame(nowMs: number): void {
    queued = undefined;
    if (disposed) return;
    // Zero rather than negative: `advance` refuses a negative step by name and
    // a scheduler is not obliged to hand out a monotonic clock.
    const dtSeconds = previousMs === undefined ? 0 : Math.max(0, nowMs - previousMs) / 1000;
    previousMs = nowMs;

    inFrame = true;
    wokenDuringFrame = false;
    let settled: boolean;
    try {
      settled = frame(dtSeconds);
    } catch (cause: unknown) {
      inFrame = false;
      stop();
      throw cause;
    }
    inFrame = false;

    if (disposed) return;
    if (settled && !wokenDuringFrame) {
      stop();
      return;
    }
    startFrame();
  }

  function wake(): void {
    if (disposed) return;
    if (inFrame) {
      wokenDuringFrame = true;
      return;
    }
    if (running) return;
    // Running from the moment of the wake, not from the first frame: a second
    // wake before the frame arrives has to see a loop that is already going.
    running = true;
    startFrame();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (queued !== undefined && scheduler !== null) scheduler.cancel(queued);
    queued = undefined;
    stop();
  }

  return {
    wake,
    dispose,
    get running(): boolean {
      return running;
    },
  };
}
