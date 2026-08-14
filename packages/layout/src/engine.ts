/**
 * The layout engine: stages and config bound once, then run over as many graphs
 * as you like, here or in a worker.
 */

import type { Graph } from '@dagr/graph';
import { resolveConfig } from './config.js';
import { DagrLayoutError, WorkerTransportError } from './errors.js';
import { prepare, runPrepared } from './pipeline.js';
import type { LayoutConfig, LayoutResult, LayoutStageOverrides } from './types.js';
import type { RunSnapshot } from './wire.js';
import { decodeFailure, decodeResult, encodeRun, isLayoutMessage } from './wire.js';

/**
 * Request ids, counted once for the whole module rather than once per engine.
 *
 * Module scope is the only scope in which this is correct, because it is the
 * only one two engines can share, and sharing a port is a case this protocol
 * invites rather than tolerates. Two engines that each counted from 1 would
 * hand out the same id for their first run, both listeners would match the
 * first answer, and the loser would decode the winner's numbers against its own
 * ids: with equal node and edge counts that is a wrong layout and NO error,
 * which is the failure this whole file checks lengths to avoid. Counting here
 * costs nothing and makes the ids disjoint by construction.
 */
let nextRequest = 1;

/**
 * The part of a worker this package uses: post a message, hear the answer.
 *
 * Structural rather than a named class, because the things a caller might hand
 * over are several different classes in two different runtimes. A browser
 * `Worker`, a dedicated worker's own `self`, a `MessagePort` from either a
 * browser `MessageChannel` or Node's `worker_threads`, and anything else that
 * speaks the same four members all satisfy it without a cast, and this package
 * imports none of them: `@dagr/layout` has no DOM dependency and no Node
 * dependency, and taking one to name a parameter type would be a strange way to
 * spend that.
 *
 * `start` is optional because only some of them have it. A `MessagePort` queues
 * its messages until something calls `start`, and `addEventListener` does not
 * imply it; a `Worker` has no such method and needs none. So the engine calls
 * it when it is there, which is the one line that makes both work.
 *
 * The transfer list is REQUIRED and is a mutable `ArrayBuffer[]`, which reads
 * like an oversight and is neither. Required, because every post this package
 * makes states its transfer list, empty or not, so "what moves rather than
 * being copied" is decided by the encoder and never by whoever wrote the call.
 * Mutable and specifically `ArrayBuffer`, because that is what the real classes
 * accept: their own signatures take a mutable `Transferable[]`, and a
 * `readonly` list or a widened element type stops a `MessagePort` satisfying
 * this interface at all. The type is narrower than what those classes allow,
 * which is the right direction: this protocol transfers buffers and nothing
 * else.
 *
 * Node's `worker_threads.Worker` is deliberately NOT among the classes above:
 * it is an `EventEmitter`, with `on` rather than `addEventListener`, so it does
 * not fit. Handing it a `MessagePort` does, and it is one line at the call
 * site. See the worker mode section of the layout docs page.
 */
export interface LayoutPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  start?(): void;
}

/**
 * What {@link createLayout} binds for the life of an engine.
 *
 * Every field is `?: T | undefined` rather than plain `?: T`, which is
 * redundant under a default tsconfig and is not under
 * `exactOptionalPropertyTypes`, which this repo sets and which a careful
 * consumer sets too. Under that flag `?: T` means the key may be ABSENT but may
 * not be present holding `undefined`, and `createLayout({ worker })` where
 * `worker` is `LayoutPort | undefined` stops compiling. That is precisely the
 * ordinary shape here: a port held in a ref, or absent while rendering on the
 * server, which is the case the docs point a reader at. Widening is safe to do
 * later and pointless to postpone.
 */
export interface LayoutEngineOptions {
  /** Any subset of the four stages; the rest fall back to `defaultStages`. */
  readonly stages?: LayoutStageOverrides | undefined;

  /** Resolved once, when the engine is built, and reused by every run. */
  readonly config?: LayoutConfig | undefined;

  /**
   * Where `runAsync` sends its work. Without one, `runAsync` runs the pipeline
   * on this thread and resolves, so a consumer can write against the async API
   * before deciding whether the run belongs off the main thread. See
   * {@link LayoutEngine.runAsync}.
   */
  readonly worker?: LayoutPort | undefined;
}

/**
 * An engine with its stages and its config already bound.
 *
 * Two entry points, one pipeline. `run` is the same call `layout` makes and
 * returns the same thing; `runAsync` returns a promise for it, and is where a
 * bound worker changes anything. Crossing a boundary is not supposed to be
 * visible in a result, and the tests hold both entry points to that: the same
 * graph through `run` and through `runAsync` over a real port produces the same
 * node boxes, the same routes and the same bounds.
 *
 * WHEN THE SAME STAGES RUN ON BOTH SIDES, which is a condition rather than a
 * given. Stages are functions and cannot cross, so the worker module names its
 * own set, and an engine bound to a worker serving a different ranker will
 * disagree with its own `run` and nothing will report it. That is not a defect
 * to fix here: a caller who puts a different ranker in the worker has asked for
 * a different layout. It is a thing to know when reaching for `run` as the
 * fallback path, and the docs page says so where it suggests naming the stages
 * in the worker module alone.
 */
export interface LayoutEngine {
  /**
   * Lays a graph out on the calling thread, whatever `worker` says.
   *
   * A bound worker does not make this asynchronous, because a caller who asked
   * for the sync call wants the answer in hand: the alternative would be an
   * engine whose sync method silently stops working once a worker is attached.
   */
  run(graph: Graph): LayoutResult;

  /**
   * Lays a graph out in the bound worker, or on this thread when there is none.
   *
   * Rejects rather than throws, for every failure including a config this
   * engine could never have accepted: an async entry point that sometimes
   * throws synchronously is the shape that gets a `try` and a `.catch` written
   * around the same call.
   *
   * Runs may overlap. Each one carries a request id, answers are matched back
   * by it, and a message that is not this protocol's, or is an answer to a run
   * that already settled, is ignored: a port may be carrying somebody else's
   * traffic too.
   *
   * There is no timeout. A worker that never answers leaves a promise pending,
   * because how long is too long belongs to the caller and to the graph, and a
   * worker that has been terminated is an event on the caller's own object
   * rather than something this package can see.
   */
  runAsync(graph: Graph): Promise<LayoutResult>;
}

/**
 * Builds a layout engine over a stage set and a config.
 *
 * The object exists to bind the three things that must not disagree between one
 * run and the next: the stages, the config, and (from M3.2) the state a warm
 * start reads. `layout()` is still there for the one-shot case and is sugar
 * over the same runner.
 *
 * Binding buys two things immediately, before any of M3 arrives. The config is
 * resolved HERE rather than on each run, so an unusable separation is refused
 * where it was named, at construction, rather than on whichever later run
 * happened to be the first; and the `nodeSize` callback stays on this side of
 * any worker boundary, which is what lets a run cross one at all. See
 * `wire.ts`.
 *
 * @throws {InvalidConfigError} when a separation or a size in `config` is not a
 * finite number that is zero or greater. Sizes from the `nodeSize` callback are
 * a per-run matter and are still reported by the run that asked for them.
 */
export function createLayout(options: LayoutEngineOptions = {}): LayoutEngine {
  const config = resolveConfig(options.config);
  const nodeSize = options.config?.nodeSize;
  const { stages, worker } = options;

  /** The runs waiting on an answer, by request id. */
  const pending = new Map<
    number,
    {
      /**
       * The ids the run was SENT with, not the graph they came from. See
       * {@link RunSnapshot}: the graph is the caller's and is mutable, and an
       * answer means what it meant when it was asked for.
       */
      readonly snapshot: RunSnapshot;
      readonly resolve: (result: LayoutResult) => void;
      readonly reject: (error: unknown) => void;
    }
  >();
  let listening = false;

  const receive = (event: { readonly data: unknown }): void => {
    const message = event.data;
    // Not ours, or a request rather than an answer: another engine may be
    // serving layout on this very port.
    if (!isLayoutMessage(message) || message.dagr === 'layout-run') return;
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    try {
      if (message.dagr === 'layout-result') {
        waiting.resolve(decodeResult(message, waiting.snapshot));
      } else {
        waiting.reject(decodeFailure(message));
      }
    } catch (error) {
      // A malformed answer. The run is the caller's, so the refusal is theirs
      // to see rather than this listener's to swallow, and it arrives as this
      // family's own member: `isLayoutMessage` checks a tag and not a shape, so
      // an answer wearing the right tag with the wrong contents reaches the
      // decoder and fails there in whatever way it fails. Wrapping is what
      // keeps that a `WorkerTransportError` rather than a bare `TypeError`
      // about a property of undefined, which would say nothing about where the
      // run went wrong. Members of the family that arrive as themselves, which
      // is what `decodeResult` raises for a length that disagrees, pass through.
      waiting.reject(
        error instanceof DagrLayoutError
          ? error
          : new WorkerTransportError(
              `the answer to run ${String(message.id)} carried the right tag and could not be ` +
                `read: ${error instanceof Error ? error.message : String(error)}`,
            ),
      );
    }
    idle();
  };

  /**
   * The listener is attached while runs are in flight and not otherwise, which
   * is what lets an engine share a port it does not own without leaving
   * anything behind on it. Nothing can arrive for us while nothing is pending,
   * so nothing is missed.
   */
  const listen = (port: LayoutPort): void => {
    if (listening) return;
    listening = true;
    port.addEventListener('message', receive);
    // A `MessagePort` queues everything until this is called; a `Worker` has no
    // such method. Calling it twice is harmless, which is why re-attaching is.
    port.start?.();
  };

  const idle = (): void => {
    if (!listening || pending.size > 0 || worker === undefined) return;
    listening = false;
    worker.removeEventListener('message', receive);
  };

  return {
    run(graph) {
      return runPrepared(prepare(graph, config, nodeSize), stages);
    },

    async runAsync(graph) {
      if (worker === undefined) return runPrepared(prepare(graph, config, nodeSize), stages);
      const request = nextRequest;
      nextRequest += 1;
      // Prepared, and so measured, on this thread: see `wire.ts` for why that
      // is the point rather than a step on the way to posting.
      const { message, transfer } = encodeRun(request, prepare(graph, config, nodeSize));
      // The ids as they were at the moment of the send. `encodeRun` built them
      // already, so the snapshot is those same arrays rather than a second walk.
      const { nodes, edges, sources, targets } = message;
      const answer = new Promise<LayoutResult>((resolve, reject) => {
        pending.set(request, { snapshot: { nodes, edges, sources, targets }, resolve, reject });
      });
      listen(worker);
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        // A port that refuses the message never answers it, so the entry it
        // would have been matched against has to go with it. Nothing this
        // package puts in a message can be refused (ids are strings, the rest
        // is numbers), so a throw here is the port object itself objecting.
        //
        // A CLOSED PORT AND A TERMINATED WORKER DO NOT COME THROUGH HERE:
        // posting to either is a silent no-op in both runtimes, not a throw. So
        // that run stays pending, which is the same outcome as a worker that is
        // simply slow, and is the outcome "there is no timeout" chooses on
        // purpose. A caller who needs to give up races the promise themselves.
        pending.delete(request);
        idle();
        throw error;
      }
      return answer;
    },
  };
}
