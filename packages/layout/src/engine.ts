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
import { influenceRegion, wholeRoster } from './influence.js';
import { prepare, runPipeline } from './pipeline.js';
import type {
  LayoutConfig,
  LayoutResult,
  LayoutStageOverrides,
  PreparedState,
  PreviousLayout,
  RoutedState,
  Size,
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
 * Four fields rather than a bare delta because a consumer needs them and can
 * derive none of them from the others. A renderer holding the previous result
 * applies the `delta`; one that has just been mounted, or that dropped a frame,
 * takes the `result` whole; M3.4's `stabilityViolations` is written against the
 * `influence` set; and `region` is the bound M3.5 added beside it, which is what
 * the stages after it are confined to and what `influence` becomes once they
 * are.
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

  /**
   * What the PATCH can affect, which is not the same claim as `influence`.
   *
   * Two fields rather than one because they are two different statements and
   * today they disagree. `influence` is a GUARANTEE about the run that just
   * happened, so while `relayout` re-runs the whole pipeline it has to name the
   * whole roster: a cold sweep is entitled to reorder a rank the patch never
   * came near. This is a BOUND ON THE PATCH, computed from the patch and the
   * retained pipeline state before the run, and it is what M3.6's warm-started
   * ordering, M3.7's incremental ranking, M3.8's anchored coordinates and M3.9's
   * fast paths are each allowed to touch. The distance between the two is what
   * is left of this milestone, and it is measurable rather than notional:
   * `stabilityViolations(previous, result, region)` is exactly what a run does
   * outside the bound.
   *
   * THAT DISTANCE IS NOW ZERO ON THE CORPUS AND THE FIELDS STILL DIFFER, which
   * is worth stating because the two are easy to confuse. M3.6's warm start took
   * `layout.influence.test.ts` from 8, 11, 15 and 0 escaping runs to none at
   * all, so on those thirty graphs the run does respect the bound. `influence`
   * still names the whole roster anyway, because it is a GUARANTEE and not a
   * measurement: no stage is CONFINED yet, so a run is still entitled to move
   * anything, and it happens not to. Narrowing it wants a stage that cannot
   * reach outside the band rather than a corpus that says it did not.
   *
   * They converge rather than staying two. When every stage is confined to the
   * region, the guarantee IS the region and this field becomes the same set as
   * the one beside it. See {@link influenceRegion}.
   *
   * A relayout the engine cannot bound reports the whole roster here too, and
   * there is one way to be in that state: the run before it was served by a
   * worker, so it left no pipeline state on this side and there are no ranks to
   * build a band out of. That is the same absence that makes such a relayout
   * cold, and M3.6 decided what to do about it: the worker retains the state
   * and the patch crosses, which is a protocol M3.9 owns. See
   * {@link LayoutEngine.relayoutAsync}.
   */
  readonly region: InfluenceSet;
}

/**
 * What the engine retains from a run, which is that run and not the one before.
 *
 * A REBUILT RECORD RATHER THAN THE ROUTED ONE, and the difference is a leak. The
 * warm-start channel is a field on the record every stage reads, so the runner
 * carries it forward and a `RoutedState` holds the `previous` its own run was
 * given. Retaining that whole record and feeding it back in as the next warm
 * start puts one full pipeline state on the front of the last on every single
 * relayout: twenty edits retained twenty runs, each with its own `sizes`,
 * `ranks`, `layers`, `positions` and `routes`. That grows with PATCH HISTORY
 * rather than with the live graph, which is exactly what this milestone says
 * retained state must never do, and it is invisible to any assertion that looks
 * only at the newest link, which is why the first version of this file shipped
 * it and the review of the merged tree is what caught it.
 *
 * Written out field by field rather than by rest destructuring because the rule
 * in this repo's lint config refuses the unused bindings that pattern needs. It
 * cannot drift for it: {@link PreviousLayout} is an `Omit` of the record this
 * reads, so a field added to `RoutedState` widens the return type and stops this
 * function compiling until it is carried too.
 */
function warmStartOf(routed: RoutedState): PreviousLayout {
  return {
    sizes: routed.sizes,
    ranks: routed.ranks,
    reversedEdges: routed.reversedEdges,
    virtualNodes: routed.virtualNodes,
    virtualChains: routed.virtualChains,
    layers: routed.layers,
    positions: routed.positions,
    routes: routed.routes,
  };
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
 * Only the ops that make a checkable claim are checked, and only against what
 * the patch says the graph should now show: the four with a presence question,
 * plus `update-node-parent`, which has no presence question and does say where
 * a node now sits. Attribute updates and port moves have nothing to check
 * against a graph that holds them either way, and checking them would mean the
 * engine re-deriving what the caller's own mutation did.
 *
 * LAST OP WINS, because a patch is an ordered list and its ops can cancel: a
 * caller who concatenates a frame's worth of patches into one call, or wraps the
 * frame in `graph.batch`, may well have added and removed the same node inside
 * it, and the graph shows the net effect.
 * Cost is one pass over the patch, which is proportional to the edit rather than
 * to the graph.
 *
 * @throws {EngineStateError} at the first op the graph disagrees with.
 */
function checkPatchApplied(graph: Graph, patch: Patch): void {
  const nodes = new Map<NodeId, boolean>();
  const edges = new Map<EdgeId, boolean>();
  const parents = new Map<NodeId, NodeId | undefined>();
  for (const op of patch) {
    switch (op.op) {
      case 'add-node':
        nodes.set(op.id, true);
        parents.set(op.id, op.parent);
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
      // A reparent has no presence question and does make a claim, so it is
      // checked on the claim it makes. Without this arm a patch of nothing but
      // reparents is the one edit a caller can hand over unapplied and hear
      // nothing about, which is the mistake this whole function exists for.
      // Nothing here reads containment for the layout: see `influence.ts`.
      case 'update-node-parent':
        parents.set(op.id, op.after);
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
  for (const [id, expected] of parents) {
    // A node the patch ends by removing has no parent left to check, and the
    // presence pass above has already had the last word on it.
    if (nodes.get(id) === false) continue;
    const actual = graph.getNode(id)?.parent;
    if (actual !== expected) throw parentMismatch(id, expected, actual);
  }
}

/** The message the containment half of the patch check raises. */
function parentMismatch(
  id: NodeId,
  expected: NodeId | undefined,
  actual: NodeId | undefined,
): EngineStateError {
  const where = (parent: NodeId | undefined): string =>
    parent === undefined ? 'no parent' : `parent "${parent}"`;
  return new EngineStateError(
    `the patch gives node "${id}" ${where(expected)} and the graph shows ${where(actual)}. ` +
      'relayout describes an edit you have already made to your own graph rather than ' +
      'applying one, so apply the patch before handing it over',
  );
}

/** The one message both presence halves of the patch check raise. */
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
   * WRAP A MULTI-STEP EDIT IN `graph.batch`. That wiring relays out once per
   * mutating call, so adding a node and then wiring it up is three relayouts,
   * and the first ones place the node somewhere it does not stay: an unattached
   * node still gets a rank and a position. A batch emits the whole edit as one
   * patch, so the engine sees the one graph state you meant.
   *
   * IT IS NO FASTER THAN A COLD RUN, on purpose, and the tests hold it to
   * landing the same geometry a cold run of the same graph does. The whole
   * pipeline runs again. That is what makes the delta contract, the engine
   * lifetime and the retained state testable before any incremental algorithm
   * exists, and it gives M3.6 through M3.9 a correct baseline to be measured
   * against rather than nothing. The patch is read for two things today: whether
   * it happened, and what it can affect, which is the `region` on the result.
   * Nothing yet confines the WORK to that region, which is what M3.7 onwards are
   * for and is measurable in the meantime. M3.6 confined the ANSWER without
   * confining the work: the order stage holds the previous run's permutation, so
   * a relayout costs what a cold run costs and lands inside the region anyway.
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
   * and it answers with the same four fields the synchronous one does. Rejects
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
   * served here is not, and since M3.6 that is a real difference rather than a
   * bookkeeping one: the order stage reads that state, so a relayout over there
   * re-sweeps freely and a relayout here holds the drawing still. THIS METHOD
   * IS THE UNSTABLE ONE, and it says so rather than pretending otherwise.
   *
   * M3.6's DECISION, which its entry owed: THE WORKER RETAINS THE STATE AND THE
   * PATCH CROSSES INSTEAD. Sending the state the other way was the alternative
   * and it loses on every reading. It is proportional to the DRAWING and not to
   * the patch, and the drawing is the thing a worker was reached for because it
   * was too big: a 4k-node graph carries 233k dummies (see `influence.ts`), so a
   * one-attribute edit would post a whole pipeline state across the boundary to
   * ask for a run of the same size. It also puts the same state on both sides,
   * which is two copies to disagree, where retaining it over there is the same
   * arrangement `run` already has. And the patch is already the unit this API is
   * built on, already structured-cloneable, and already what `relayout` takes.
   *
   * WHAT IT COSTS IS A PROTOCOL, and that is why the decision ships here and the
   * implementation does not. Today `encodeRun` posts the whole graph per run and
   * the worker holds nothing between them, so retaining state over there means a
   * session on that side: an engine id, a run that says "the graph you have,
   * with this patch applied", and a failure mode for a worker that has lost it.
   * That is M2.10's wire protocol reopened, it is a task rather than a
   * paragraph, and it belongs with M3.9, where the async path is what the frame
   * budget is measured on. Until it lands, a consumer who wants stability calls
   * {@link relayout}.
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
   * That is a property of {@link warmStartOf} rather than a free consequence of
   * rebuilding, and the first version of this file did not have it. The
   * incremental implementations from M3.5 on will not have it for free either,
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
  const runPrepared = (graph: Graph, prepared: PreparedState): LayoutResult => {
    const { result, routed } = runPipeline(prepared, stages);
    held = graph;
    warm = warmStartOf(routed);
    return result;
  };

  const runHere = (graph: Graph, previous: PreviousLayout | undefined): LayoutResult =>
    runPrepared(graph, prepare(graph, config, nodeSize, previous));

  /**
   * The band this patch is bounded to, or the whole roster when it cannot be
   * bounded at all.
   *
   * READ BEFORE THE RUN, in both entry points, and in the asynchronous one that
   * means before the await as well. The band is built out of the ranks of the
   * run BEFORE this patch, and `runPrepared` replaces them, so a region computed
   * afterwards would be a region computed against the answer. That is the
   * opposite of the M3.2 rule about `reported`, which is read as late as
   * possible because it is bookkeeping about what the caller was last told; this
   * is a prediction, and a prediction read after the fact is a measurement.
   *
   * No retained pipeline state means no ranks, which is the state an engine is
   * in after a run served by a worker. The honest answer there is the whole
   * roster, and it is the same answer that engine's warm start gives.
   */
  const regionFor = (
    graph: Graph,
    patch: Patch,
    previous: LayoutResult,
    sizes: ReadonlyMap<NodeId, Size>,
  ): InfluenceSet =>
    warm === undefined
      ? wholeRoster(graph, previous)
      : influenceRegion({ graph, patch, previous: warm, sizes });

  /**
   * The graph a relayout re-runs and the geometry it starts from, or the
   * refusal to do one.
   *
   * It hands back the reported geometry as well as the graph because the region
   * needs one to fall back to when the engine retained no pipeline state, and
   * reading `reported` again at that point would be reading a `let` the compiler
   * has already forgotten this check narrowed.
   */
  const forRelayout = (patch: Patch): { readonly graph: Graph; readonly previous: LayoutResult } => {
    requireLive();
    if (held === undefined || reported === undefined) {
      throw new EngineStateError(
        'relayout was called before this engine ran, so there is no previous layout to ' +
          'compute a delta against. Call run or runAsync first',
      );
    }
    checkPatchApplied(held, patch);
    return { graph: held, previous: reported };
  };

  /**
   * The four fields a relayout answers with, from the run it just did, given
   * the region computed before it.
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
  const report = (graph: Graph, next: LayoutResult, region: InfluenceSet): RelayoutResult => {
    const previous = reported;
    if (previous === undefined) {
      throw new EngineStateError('this engine was reset while a relayout was in flight');
    }
    const delta = diffLayout(previous, next, { epsilon });
    reported = epsilon === 0 ? next : applyDelta(previous, delta);
    return { result: reported, delta, influence: wholeRoster(graph, previous), region };
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
  const runThere = async (
    graph: Graph,
    prepared: PreparedState,
    port: LayoutPort,
  ): Promise<LayoutResult> => {
    const request = nextRequest;
    nextRequest += 1;
    // Prepared, and so measured, on this thread: see `wire.ts` for why that
    // is the point rather than a step on the way to posting. The caller does
    // the preparing since M3.5, because the sizes it produces are also what the
    // region reads, and measuring every node twice per relayout to answer one
    // question about row heights would be a strange way to pay for a bound.
    const { message, transfer } = encodeRun(request, prepared);
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
      reported =
        worker === undefined
          ? runHere(graph, undefined)
          : await runThere(graph, prepare(graph, config, nodeSize), worker);
      return reported;
    },

    relayout(patch) {
      const { graph, previous } = forRelayout(patch);
      const prepared = prepare(graph, config, nodeSize, warm);
      const region = regionFor(graph, patch, previous, prepared.sizes);
      return report(graph, runPrepared(graph, prepared), region);
    },

    async relayoutAsync(patch) {
      const { graph, previous } = forRelayout(patch);
      if (worker === undefined) {
        const prepared = prepare(graph, config, nodeSize, warm);
        const region = regionFor(graph, patch, previous, prepared.sizes);
        return report(graph, runPrepared(graph, prepared), region);
      }
      // The warm start does not cross, so the run over there is prepared
      // without one, exactly as it was before this method had a region to
      // compute. Both the region and the state it reads are taken before the
      // await, since the pipeline state this engine holds belongs to whichever
      // run settled last and the patch was described against the one it holds
      // now.
      const prepared = prepare(graph, config, nodeSize);
      const region = regionFor(graph, patch, previous, prepared.sizes);
      const next = await runThere(graph, prepared, worker);
      return report(graph, next, region);
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
