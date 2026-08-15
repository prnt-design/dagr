/**
 * The layout engine: stages and config bound once, then run over as many graphs
 * as you like, here or in a worker.
 */

import type { EdgeId, Graph, NodeId, Patch } from '@dagr/graph';
import { resolveConfig } from './config.js';
import { applyDelta, diffLayout, requireEpsilon } from './delta.js';
import type { LayoutDelta } from './delta.js';
import { DagrLayoutError, EngineStateError, WorkerTransportError } from './errors.js';
import type { InfluenceSet } from './influence.js';
import { wholeRoster } from './influence.js';
import { prepare, runPipeline } from './pipeline.js';
import type {
  LayoutConfig,
  LayoutResult,
  LayoutStageOverrides,
  PreviousLayout,
} from './types.js';
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

  /**
   * The smallest move worth reporting in a relayout's delta, in node-size
   * units. Default 0, which reports any difference at all.
   *
   * The engine is where this number gets named, and M3.1 said so when it
   * declined to put it on `LayoutConfig`: the number is about two results rather
   * than about how to lay a graph out, and this is the first object that holds a
   * config and two results at once. A caller names it once here instead of on
   * every `diffLayout` call, and the engine is what makes a nonzero one safe,
   * because it retains the geometry it last REPORTED and diffs against that
   * rather than against its last computed run. See {@link LayoutEngine.relayout}.
   *
   * Refused at construction by the same rule a separation is, for the same
   * reason: where it was named beats whichever later call happened to be first.
   */
  readonly epsilon?: number | undefined;
}

/**
 * What a relayout produced: the drawing, what changed to get there, and what it
 * was entitled to change.
 *
 * Three fields rather than a bare delta because a consumer needs all three and
 * can derive none of them from the others. A renderer holding the previous
 * result applies the `delta`; one that has just been mounted, or that dropped a
 * frame, takes the `result` whole; and M3.4's stability contract is written
 * against the `influence` set, which is the object M3.5 narrows without changing
 * anything a caller reads.
 */
export interface RelayoutResult {
  /**
   * The geometry the engine is now reporting.
   *
   * At the default `epsilon` of 0 this is the pipeline's own result: nothing was
   * withheld, so there is nothing to withhold. At a nonzero one it is the
   * previous reported result with `delta` applied, which is the pipeline's
   * result with the sub-epsilon moves left out, and is therefore exactly what a
   * consumer applying every delta in order is holding. THE ENGINE REPORTS ONE
   * GEOMETRY: a caller who reads this and a caller who accumulates deltas never
   * disagree, which they would if this were the raw run and the delta were
   * measured against something else.
   *
   * Its iteration order is the graph's, except under a nonzero epsilon, where it
   * is the previous result's with additions appended. That is `applyDelta`'s one
   * documented non-reproduction and nothing in this package's contract rests on
   * it.
   */
  readonly result: LayoutResult;

  /** What changed between the last reported geometry and this one. */
  readonly delta: LayoutDelta;

  /** What this relayout was entitled to move. See {@link InfluenceSet}. */
  readonly influence: InfluenceSet;
}

/**
 * Checks that a patch describes the graph the engine is holding.
 *
 * `relayout` does not APPLY a patch, and this is what keeps that decision from
 * being a silent trap. The caller's graph is already mutated: `Graph.subscribe`
 * hands a listener one patch per mutating call, after that call is committed, so
 * `graph.subscribe((patch) => engine.relayout(patch))` is the whole adoption and
 * the patch it delivers is a description rather than an instruction. A caller
 * expecting the other contract hands over a patch nothing has applied, and
 * without this check the engine relays out an unchanged graph, hands back an
 * empty delta, and draws the same picture forever.
 *
 * Only the four ops with a presence question are checked, and only against what
 * the patch says the graph should now show. Attribute updates and port moves
 * have nothing to check against a graph that holds them either way, and checking
 * them would mean the engine re-deriving what the caller's own mutation did.
 *
 * LAST OP WINS, because a patch is an ordered list and its ops can cancel: a
 * caller who concatenates a frame's worth of patches into one call may well have
 * added and removed the same node inside it, and the graph shows the net effect.
 * Cost is one pass over the patch, which is proportional to the edit rather than
 * to the graph.
 *
 * @throws {EngineStateError} at the first op the graph disagrees with.
 */
function checkPatchApplied(graph: Graph, patch: Patch): void {
  const nodes = new Map<NodeId, boolean>();
  const edges = new Map<EdgeId, boolean>();
  for (const op of patch) {
    switch (op.op) {
      case 'add-node':
        nodes.set(op.id, true);
        break;
      case 'remove-node':
        nodes.set(op.id, false);
        break;
      case 'add-edge':
        edges.set(op.id, true);
        break;
      case 'remove-edge':
        edges.set(op.id, false);
        break;
      default:
        break;
    }
  }
  for (const [id, expected] of nodes) {
    if (graph.hasNode(id) !== expected) throw mismatch('node', id, expected);
  }
  for (const [id, expected] of edges) {
    if (graph.hasEdge(id) !== expected) throw mismatch('edge', id, expected);
  }
}

/** The one message both halves of the patch check raise. */
function mismatch(kind: 'node' | 'edge', id: string, expected: boolean): EngineStateError {
  const verb = expected ? 'adds' : 'removes';
  const state = expected ? 'does not hold it' : 'still holds it';
  return new EngineStateError(
    `the patch ${verb} ${kind} "${id}" and the graph ${state}. ` +
      'relayout describes an edit you have already made to your own graph rather than ' +
      'applying one, so apply the patch before handing it over',
  );
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

  /**
   * Lays the last graph this engine ran out again, after you have edited it.
   *
   * IT DOES NOT APPLY THE PATCH. Your graph is already the graph you changed:
   * `Graph.subscribe` hands a listener one patch per mutating call, after that
   * call is committed, so `graph.subscribe((p) => engine.relayout(p))` is the
   * whole of the wiring and the patch is a description of what you did rather
   * than an instruction for the engine to carry out. Applying it here would mean
   * the engine mutating an object it does not own, from the one method that
   * holds a long-lived reference to it, and would make a caller who wants to
   * read their own graph between edits route every mutation through the layout
   * package. A patch that disagrees with the graph is refused rather than
   * quietly relaid, which is the trap that decision would otherwise set.
   *
   * IT IS NO FASTER THAN A COLD RUN, on purpose, and the tests hold it to
   * landing the same geometry a cold run of the same graph does. The whole
   * pipeline runs again. That is what makes the delta contract, the engine
   * lifetime and the retained state testable before any incremental algorithm
   * exists, and it gives M3.5 through M3.9 a correct baseline to be measured
   * against rather than nothing. The patch is read for one thing today, which is
   * checking that it happened; M3.5 is where its contents start to confine the
   * work.
   *
   * The delta is measured against the geometry this engine last REPORTED rather
   * than against its last computed run, which is what makes a nonzero
   * `epsilon` safe: fifty edits each moving a node by nine tenths of the
   * tolerance report nothing each, and a consumer diffing against the last
   * computed result would end forty five tolerances out of position with nothing
   * able to notice. See {@link LayoutEngineOptions.epsilon}.
   *
   * @throws {EngineStateError} when this engine has never run, has been
   * disposed, or is holding a graph the patch does not describe.
   * @throws {StageContractError} when a stage breaks the pipeline contract.
   */
  relayout(patch: Patch): RelayoutResult;

  /**
   * {@link relayout}, in the bound worker, or on this thread when there is none.
   *
   * The call a consumer who adopted `runAsync` for a large graph reaches for,
   * and it answers with the same three fields the synchronous one does. Rejects
   * rather than throws, for every failure, on the same argument `runAsync`
   * makes.
   *
   * THE DELTA IS COMPUTED ON THIS THREAD whatever the worker did, because the
   * geometry the engine last reported is this side's bookkeeping and not the
   * pipeline's. So the wire protocol is untouched by this method: what crosses
   * is a run, and what comes back is a result, exactly as for `runAsync`.
   *
   * What does NOT cross is the warm-start state, because it lives where the
   * pipeline ran. A relayout served by a worker is therefore cold in a way one
   * served here is not, which in M3.2 is a distinction with no consequence at
   * all: no stage reads that state yet, and the tests assert both paths produce
   * the same deltas. M3.6 is the first task for which it will matter, and it is
   * the task that has to decide whether the state crosses or the worker retains
   * it and the patch crosses instead.
   */
  relayoutAsync(patch: Patch): Promise<RelayoutResult>;

  /**
   * Releases everything this engine is holding, and ends it.
   *
   * M2.10 declined to build this because the port listener is already transient
   * and there was nothing else to release. M3.2 gives it something: the graph,
   * the previous run's pipeline state, and the reported-geometry snapshot are
   * all retained for the life of the engine, and on a large graph they are
   * larger than the result a caller can see.
   *
   * Every entry point after this raises {@link EngineStateError}, the two
   * asynchronous ones as a rejection. Runs still in flight are rejected the same
   * way rather than left pending: this detaches the port listener, so an answer
   * that arrived afterwards would reach nobody, and a promise that can never
   * settle is worse than one that settles badly.
   *
   * Calling it twice is a no-op, which is what a `useEffect` cleanup and a
   * `finally` both want.
   */
  dispose(): void;
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
 * @throws {InvalidConfigError} when a separation or a size in `config`, or
 * `epsilon`, is not a finite number that is zero or greater. Sizes from the
 * `nodeSize` callback are a per-run matter and are still reported by the run
 * that asked for them.
 */
export function createLayout(options: LayoutEngineOptions = {}): LayoutEngine {
  const config = resolveConfig(options.config);
  const nodeSize = options.config?.nodeSize;
  const epsilon = requireEpsilon(options.epsilon);
  const { stages, worker } = options;

  /**
   * What the engine retains between runs, which is what M3.2 built it for.
   *
   * Three separate things rather than one record, because they are retained for
   * three different reasons and are not always all present. `held` is the graph
   * a relayout re-runs, kept by reference and never mutated here. `warm` is the
   * previous run's pipeline state, absent after a run that happened in a worker
   * because that is where it stayed. `reported` is the geometry the caller was
   * last told about, which is what a delta is measured against and is NOT the
   * same object as the last computed result once `epsilon` is nonzero.
   *
   * All three are proportional to the live graph and never to patch history:
   * every relayout rebuilds them whole from the run it just did, which is what
   * makes a removed node's entry impossible to leak rather than merely unlikely.
   * The incremental implementations from M3.5 on will not have that for free,
   * and M3.10's churn sequence is written to catch it when they do not.
   */
  let held: Graph | undefined;
  let warm: PreviousLayout | undefined;
  let reported: LayoutResult | undefined;
  let disposed = false;

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

  /** Refuses every entry point once the engine has been disposed. */
  const requireLive = (): void => {
    if (disposed) throw new EngineStateError('this engine has been disposed');
  };

  /**
   * A run on this thread, retaining what it leaves behind.
   *
   * `previous` is the warm start, which only a relayout has: `run` lays out
   * whatever graph it is handed and that need not be the graph the last run saw,
   * so seeding it from the previous state would seed one graph's ordering from
   * another graph's.
   */
  const runHere = (graph: Graph, previous: PreviousLayout | undefined): LayoutResult => {
    const { result, routed } = runPipeline(prepare(graph, config, nodeSize, previous), stages);
    held = graph;
    // The routed record itself, narrowed to {@link PreviousLayout} by the
    // assignment. Copying it to strip the two fields that type subtracts would
    // be an allocation per run buying nothing: the narrowing is what keeps a
    // stage from reading them, and it holds no reference this engine is not
    // already holding.
    warm = routed;
    return result;
  };

  /** The graph a relayout re-runs, or the refusal to do one. */
  const forRelayout = (patch: Patch): Graph => {
    requireLive();
    if (held === undefined || reported === undefined) {
      throw new EngineStateError(
        'relayout was called before this engine ran, so there is no previous layout to ' +
          'compute a delta against. Call run or runAsync first',
      );
    }
    checkPatchApplied(held, patch);
    return held;
  };

  /**
   * The three fields a relayout answers with, from the run it just did.
   *
   * The reported geometry is the previous reported geometry with this delta
   * applied, which at `epsilon` 0 is the new result itself: nothing was withheld,
   * so rebuilding an equal map in a different iteration order would be work
   * spent making the common case worse.
   *
   * `reported` IS READ HERE rather than captured before the run, and that is
   * about the one case where the two differ: `relayoutAsync` has an await
   * between the check and this, and the protocol lets runs overlap, so another
   * one may have settled inside it. Diffing against the geometry that was
   * current when this relayout STARTED would hand the caller a delta that does
   * not apply to what they are holding, which is the one promise this whole
   * design rests on. Overlapping a stale run with a fresh one still gives an odd
   * ANSWER, because the worker laid out the graph as it was when the run was
   * sent; what it does not give is an inconsistent one.
   */
  const report = (graph: Graph, next: LayoutResult): RelayoutResult => {
    const previous = reported;
    if (previous === undefined) {
      throw new EngineStateError('this engine was reset while a relayout was in flight');
    }
    const delta = diffLayout(previous, next, { epsilon });
    reported = epsilon === 0 ? next : applyDelta(previous, delta);
    return { result: reported, delta, influence: wholeRoster(graph, previous) };
  };

  /**
   * A run in the bound worker, retaining what a run over there leaves behind on
   * this side, which is the graph and nothing else.
   *
   * The warm-start state stayed in the worker, so this engine holds none after
   * one of these and the next `relayout` served here is cold. In M3.2 that is a
   * distinction without a consequence, because no stage reads that state yet;
   * see {@link LayoutEngine.relayoutAsync} for whose problem it becomes.
   *
   * Runs may overlap, so what an engine ends up holding belongs to whichever run
   * SETTLED last rather than to whichever was sent last. That is the answer the
   * caller most recently received, and therefore the one the next delta should
   * be measured against.
   */
  const runThere = async (graph: Graph, port: LayoutPort): Promise<LayoutResult> => {
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
    listen(port);
    try {
      port.postMessage(message, transfer);
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
    const result = await answer;
    held = graph;
    warm = undefined;
    return result;
  };

  return {
    run(graph) {
      requireLive();
      reported = runHere(graph, undefined);
      return reported;
    },

    async runAsync(graph) {
      requireLive();
      reported = worker === undefined ? runHere(graph, undefined) : await runThere(graph, worker);
      return reported;
    },

    relayout(patch) {
      const graph = forRelayout(patch);
      return report(graph, runHere(graph, warm));
    },

    async relayoutAsync(patch) {
      const graph = forRelayout(patch);
      const next = worker === undefined ? runHere(graph, warm) : await runThere(graph, worker);
      return report(graph, next);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      held = undefined;
      warm = undefined;
      reported = undefined;
      // Rejected before the listener goes, because an answer arriving afterwards
      // reaches nobody and a promise that can never settle is worse than one
      // that settles badly.
      for (const [id, waiting] of [...pending]) {
        pending.delete(id);
        waiting.reject(new EngineStateError('this engine was disposed while a run was in flight'));
      }
      idle();
    },
  };
}
