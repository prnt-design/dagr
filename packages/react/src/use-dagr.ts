/**
 * The layout of a graph, as a React value that keeps up with edits to it.
 *
 * **A `Graph` is a mutable external store, and React has exactly one primitive
 * for one.** `useSyncExternalStore` wants a `subscribe` that returns an
 * unsubscribe and a cheap snapshot, and `Graph.subscribe` is already the first
 * of those to the character: it takes a listener and hands back the function
 * that stops watching. So the hook does not ask a caller to signal an edit with
 * a `revision` prop or to replace the graph object to force a redraw. It
 * watches the graph, and an edit anywhere reaches the canvas.
 *
 * **An edit is a relayout, and a relayout is where the delta comes from.** Until
 * M5.3a this hook called the one-shot `layout()` on every revision, so every edit
 * was a cold run and there was no `LayoutDelta` anywhere in this package to
 * animate from. It holds a `createLayout` engine instead and calls
 * `relayout(patch)`, which hands back the drawing AND what changed to get there.
 * {@link DagrLayoutState.delta} is that, and `<DagrCanvas animate>` is the first
 * consumer of it.
 *
 * **THE ENGINE RUNS IN THE GRAPH LISTENER, WHICH IS NEITHER RENDER NOR AN
 * EFFECT, AND THAT IS THE DESIGN DECISION THIS FILE TURNS ON.** `relayout` does
 * not apply its patch: the caller's graph is already mutated and the patch
 * describes an edit already made, so the engine refuses one the graph disagrees
 * with rather than silently drawing the same picture forever. A hook that kept
 * patches in a queue and drained the queue during render would be doing a side
 * effect in render, which concurrent rendering is entitled to discard and run
 * again, and a discarded drain is a patch consumed twice or not at all. So there
 * is no queue. `Graph.subscribe` delivers one patch per mutating call, straight
 * after that call commits, and the relayout happens right there: exactly once
 * per patch, in the order the graph emitted them, in a callback that is neither
 * replayed nor discarded. Render then only reads a cached object.
 *
 * What still happens during render is the FIRST run for a new graph or config,
 * memoised, which is the same synchronous `layout()` this hook has always done
 * there and is idempotent: it produces a result and touches nothing outside the
 * engine it just built.
 *
 * The cost of running in the listener is that the relayout is inside the
 * caller's own `graph.addNode(...)` call, so a layout that throws would throw
 * out of a mutation nobody expects to raise one. Nothing is thrown out of it.
 * ONE class is recovered from and the rest are reported: `EngineStateError`
 * means the engine and the graph are out of step, which a cold run fixes, and
 * every other failure is reported through {@link DagrLayoutState.error} exactly
 * as the same failure from a cold run already is. See `onPatch` for why
 * recovering from all of them hides a bug rather than surviving one, and note
 * what it costs: a warm-only pipeline failure now reports rather than quietly
 * degrading to a correct cold drawing, which for `<DagrCanvas>` with no
 * `onError` means the nearest error boundary.
 *
 * **THE ENGINE'S LIFE IS THE SUBSCRIPTION'S, WITH ONE EXCEPTION.** It is
 * disposed from the `subscribe` cleanup, which is what `LayoutEngine.dispose`
 * is for: the graph,
 * the previous run's pipeline state and the reported-geometry snapshot are
 * retained for the life of an engine and on a large graph they are larger than
 * the result a caller can see. React under `StrictMode` unsubscribes and
 * resubscribes, which leaves a live component holding a disposed engine, so a
 * resubscribe REBUILDS: one cold run, published with no delta, and the canvas
 * reseats its springs from it. That path is not a `StrictMode` curiosity, it is
 * the designed recovery for an engine and a graph that have fallen out of step,
 * and it runs in development on every mount, which is the best place for a
 * recovery path to be exercised.
 *
 * The first exception is a render React discards. The session and its cold run happen
 * in a `useMemo` during render, and a render that never commits never
 * subscribes, so that engine is never disposed. It is unreachable and holds
 * nothing outside itself (no worker port, no listener), so it is collected
 * rather than leaked. What it does cost is real and worth naming: a `StrictMode`
 * mount double-renders and remounts its effects, so it lays the graph out three
 * times where production lays it out once.
 *
 * The second is the recovery below: an `EngineStateError` disposes the engine
 * and builds another one mid-subscription, which is the same lifetime rule
 * seen from the other side, since an engine that has fallen out of step with
 * its graph is not the engine this subscription started with.
 *
 * **The snapshot is the layout state, and the mount window it used to leave is
 * still there.** React subscribes in an effect, after the render that read the
 * snapshot, and effects run child first, so a CHILD's mount effect that edits
 * the graph runs before this hook has subscribed and that patch reaches no
 * listener. Two fixes were considered when the snapshot was a counter and both
 * are still worse than the window: laying out twice on every mount is the
 * flagship component paying for a case that needs a child editing the graph on
 * mount, and subscribing during the first render through a registry keyed on the
 * graph never unsubscribes, so a graph that had ever been rendered would build a
 * `Patch` on every mutation forever, which is precisely the cost `Graph`
 * documents itself as not paying for a graph nobody subscribed to.
 *
 * WHAT THE ENGINE DOES ABOUT A DROPPED PATCH IS THE HALF WORTH KNOWING. Today
 * `relayout` re-runs the whole pipeline over the graph it holds and diffs
 * against the geometry it last reported, so an edit nobody heard about is not a
 * divergence that persists: the next edit reports both, and the drawing catches
 * up. The window is one edit of latency rather than a permanent disagreement,
 * and it closes on any resubscribe. What a dropped patch DOES cost is exactness
 * in `RelayoutResult.region`, which is a bound computed from the patch, and this
 * hook does not expose it. A future incremental path that CONSUMES a patch
 * rather than bounding one would make a drop matter, which is the other reason
 * the patches are consumed one per delivery rather than batched into a queue
 * somebody has to keep in order.
 *
 * **The layout runs synchronously.** This hook does not reach for a worker.
 * `useCampaignScene` shows what the async version costs: the `Worker` has to be
 * the CALLER's, because `new Worker(new URL(...))` is an expression a bundler
 * reads statically and this package would have to resolve under every host's
 * bundler to own one. A `createWorker` prop invented here, before M3.9b has
 * built the worker-side session that would make a per-edit round trip worth
 * taking, would be a guess at a shape M3.9b is going to decide. `relayoutAsync`
 * is the further reason to wait: without that session it is the UNSTABLE entry
 * point, because the warm-start state lives where the pipeline ran.
 */

import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { Graph, Patch } from '@dagr/graph';
import { EngineStateError, createLayout } from '@dagr/layout';
import type { LayoutConfig, LayoutDelta, LayoutEngine, LayoutResult, Size } from '@dagr/layout';

/** What a caller may say about the layout run. */
export interface UseDagrOptions {
  /**
   * The layout configuration, compared BY VALUE. See {@link sameConfig}: a
   * caller writes this as an object literal in their JSX and it would otherwise
   * relayout the whole graph on every render of the host application.
   */
  readonly config?: LayoutConfig | undefined;
}

/** The layout, or what stopped it. Exactly one of the first two is set. */
export interface DagrLayoutState {
  /** Where every node and edge went, or `null` when the run failed. */
  readonly result: LayoutResult | null;

  /**
   * What the run threw, or `null`.
   *
   * Reported rather than rethrown, which is the opposite of what a hook usually
   * does with an exception. A layout runs on every edit, and a graph a user is
   * editing passes through states the layout refuses; throwing would unmount
   * the subtree to the nearest error boundary on the keystroke that made the
   * graph momentarily invalid and leave nothing on screen. The last good result
   * is not held either: a stale picture presented as the current one is the
   * failure mode that is hardest to notice. The caller decides, which
   * `<DagrCanvas>` does by throwing it into a boundary unless an `onError` says
   * otherwise.
   */
  readonly error: Error | null;

  /**
   * How this drawing differs from the one before it, or `null` when there is no
   * "before it" to differ from.
   *
   * `null` IS A STATEMENT AND NOT AN ABSENCE OF ONE: this run is a cold run, so
   * nothing here describes it as a change and a consumer animating from deltas
   * has to reseat rather than retarget. It is what the first run of a graph
   * reports, what a config change reports, and what the recovery from an engine
   * that fell out of step with its graph reports. `@dagr/react`'s `retarget`
   * is where that decision is written down, and `<DagrCanvas animate>` is where
   * it is taken.
   *
   * `null` as well whenever `result` is, because a run that failed changed
   * nothing and describing it as a change would be describing a drawing that
   * does not exist.
   */
  readonly delta: LayoutDelta | null;

  /**
   * The drawing {@link delta} is a difference FROM, or `null` when it is not a
   * difference from anything.
   *
   * **APPLY A DELTA ONLY WHEN THIS IS THE RESULT YOU ARE ALREADY DRAWING, AND
   * RESEAT OTHERWISE.** That is the whole of the field and it is not optional
   * care: a state is a snapshot in an external store, and React is obliged to
   * render the LATEST snapshot rather than every one. Two mutating calls in one
   * task are two patches, two relayouts and two states, and ONE commit holding
   * the second. A consumer whose effect applies `delta` on every commit
   * therefore applies the second delta on top of a drawing the first one was
   * supposed to move, and the two disagree from then on.
   *
   * THE MOTION CANNOT CATCH THAT FOR YOU. `SceneMotion.apply` refuses a delta
   * that names an id whose presence it disagrees about, which catches some of
   * these by luck, and a delta that names only ids it holds (or names nothing at
   * all, which an attribute edit produces) applies cleanly and leaves the scene
   * wrong in silence. "Add a node, then label it" is enough to reach it.
   *
   * So the test is an identity comparison and this field is what makes it one:
   * `state.from === theResultIAmDrawing`. It is the previous state's `result`,
   * the same object, because the engine measures each delta against the geometry
   * it last reported and that is exactly what this hook last handed over.
   * `null` whenever `delta` is, and `null` after a run that failed, which is
   * conservative in the one direction that costs a reseat rather than a wrong
   * picture.
   */
  readonly from: LayoutResult | null;
}

/**
 * Every field of {@link LayoutConfig}, so a new one cannot be forgotten here.
 *
 * The comparison below names its fields one at a time, which is the only way to
 * compare `defaultNodeSize` (an object literal, written inline like the config
 * around it) correctly. The cost of naming fields is that a field added
 * upstream is silently not compared, so it is spelled out as a type and
 * asserted: the declaration below fails to compile the day `LayoutConfig` grows
 * a field this file does not read.
 */
type ComparedConfigField = 'nodeSep' | 'rankSep' | 'edgeSep' | 'defaultNodeSize' | 'nodeSize';

/** `never` when every config field is compared, which is what makes it a check. */
type UncomparedConfigField = Exclude<keyof LayoutConfig, ComparedConfigField>;

// Fails with "Type 'true' is not assignable to type 'never'" naming the field
// that was added and not compared.
const everyConfigFieldIsCompared: [UncomparedConfigField] extends [never] ? true : never = true;
void everyConfigFieldIsCompared;

function sameSize(a: Size | undefined, b: Size | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.width === b.width && a.height === b.height;
}

/**
 * Whether two configs mean the same run.
 *
 * `nodeSize` is compared by IDENTITY and it is the one field that cannot be
 * anything else: it is a function, and two functions that agree on every node
 * are indistinguishable without calling them on every node, which is the work
 * the comparison exists to avoid. A caller passing `nodeSize` memoises it, the
 * way React asks for every callback prop.
 */
function sameConfig(a: LayoutConfig | undefined, b: LayoutConfig | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.nodeSep === b.nodeSep &&
    a.rankSep === b.rankSep &&
    a.edgeSep === b.edgeSep &&
    a.nodeSize === b.nodeSize &&
    sameSize(a.defaultNodeSize, b.defaultNodeSize)
  );
}

/** A config that is stable across renders as long as it keeps meaning the same run. */
function useStableConfig(config: LayoutConfig | undefined): LayoutConfig | undefined {
  const held = useRef(config);
  if (!sameConfig(held.current, config)) held.current = config;
  return held.current;
}

/** Whatever was thrown, as the `Error` this hook reports. */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * One engine, one graph, one config, and the state React reads: the external
 * store this hook puts `useSyncExternalStore` over.
 *
 * An object rather than a set of refs because the three have to be replaced
 * together. A new graph or a new config means a new engine, a cold run and a
 * `delta` of `null`, and there is no state from the old one that survives.
 */
interface LayoutSession {
  /** React's `subscribe`: starts watching the graph, and stops on the cleanup. */
  subscribe(onStoreChange: () => void): () => void;
  /** React's `getSnapshot`, and its `getServerSnapshot`. Cheap: it returns a field. */
  read(): DagrLayoutState;
}

/**
 * Builds the store for one graph and one config, and lays the graph out once.
 *
 * The cold run happens here, during the render that first asked for this
 * session, which is where this hook has always run a layout. Everything after
 * it happens in the listener.
 */
function createSession(graph: Graph, config: LayoutConfig | undefined): LayoutSession {
  let engine: LayoutEngine | null = null;
  /** Whether the last thing to happen to this session was its cleanup. */
  let released = false;

  /**
   * Throws away whatever engine there is, builds one, and lays the graph out
   * from nothing.
   *
   * The answer carries no delta by construction, which is the whole point: a
   * cold run has no previous drawing to be a difference from, and saying so is
   * what lets a consumer reseat instead of retargeting.
   */
  function cold(): DagrLayoutState {
    engine?.dispose();
    engine = null;
    try {
      const made = createLayout({ config });
      // The run before the assignment, so a config the engine binds happily and
      // a run it refuses both leave `engine` null and this session cold rather
      // than holding an engine that has never run.
      const result = made.run(graph);
      engine = made;
      return { result, error: null, delta: null, from: null };
    } catch (cause: unknown) {
      return { result: null, error: asError(cause), delta: null, from: null };
    }
  }

  let state: DagrLayoutState = cold();

  /**
   * One patch, one relayout, one new state.
   *
   * ONE FAILURE IS RECOVERED FROM AND THE REST ARE REPORTED, and the line
   * between them is the class. `EngineStateError` is what a disposed engine and
   * a patch the graph disagrees with both raise: the engine and the graph are
   * out of step, the drawing is still obtainable, and a cold run is the designed
   * way back. Everything else is the same kind of failure a COLD run already
   * reports through {@link DagrLayoutState.error} (a stage that broke the
   * pipeline contract, a `nodeSize` callback that threw), and it is reported the
   * same way here rather than recovered from, because a recovery that always
   * succeeds is a bug that never surfaces: a failure reachable only under a warm
   * start would leave every edit cold, undelta'd and unanimated, with nothing
   * anywhere saying why.
   *
   * Nothing is thrown out of this either way. It runs inside the caller's own
   * `graph.addNode(...)`, which is not a call anyone expects to raise a layout
   * error.
   */
  function onPatch(patch: Patch): void {
    const held = engine;
    if (held === null) {
      state = cold();
      return;
    }
    try {
      // Captured BEFORE the relayout: `from` has to be the geometry the engine
      // measured this delta against, which is the one this hook last reported.
      const before = state.result;
      const { result, delta } = held.relayout(patch);
      state = { result, error: null, delta, from: before };
    } catch (cause: unknown) {
      // `instanceof` rather than the `code` membership test `@dagr/graph`'s own
      // predicate argues for, and the difference is which engine threw: this
      // one was built by this module from this module's import of
      // `createLayout`, so the class it raises is this module's class. The
      // duplicate-copy hazard that makes `instanceof` unsafe across a package
      // boundary needs an object built somewhere else, and there is none here.
      if (cause instanceof EngineStateError) {
        state = cold();
        return;
      }
      state = { result: null, error: asError(cause), delta: null, from: null };
    }
  }

  return {
    subscribe(onStoreChange: () => void): () => void {
      // A resubscribe finds a disposed engine, so it rebuilds one and catches
      // up on whatever was edited while nothing was listening. React re-reads
      // the snapshot straight after subscribing, which is what turns the new
      // state into a render without a notification of its own.
      if (released) {
        released = false;
        state = cold();
      }
      const stop = graph.subscribe((patch) => {
        onPatch(patch);
        onStoreChange();
      });
      return () => {
        stop();
        engine?.dispose();
        engine = null;
        released = true;
      };
    },
    read(): DagrLayoutState {
      return state;
    },
  };
}

/**
 * Lays `graph` out, and lays it out again whenever it changes.
 *
 * The result is referentially stable: a render that changed neither the graph
 * nor the config hands back the same {@link DagrLayoutState}, so a `useMemo` or
 * a `useEffect` downstream keyed on it does not run.
 *
 * STABLE IS NOT THE SAME AS SEEN. The state changes once per layout and an
 * effect keyed on it runs once per COMMIT, and those are different counts: React
 * renders the latest snapshot of an external store rather than every one, so two
 * mutating calls in one task are two layouts and one commit. A consumer applying
 * deltas has to check {@link DagrLayoutState.from} rather than assume it was
 * handed every one, and that field exists to make the check an identity
 * comparison. `graph.batch` is the other half of the answer: one patch, one
 * layout, one delta, nothing to miss.
 */
export function useDagr(graph: Graph, options?: UseDagrOptions): DagrLayoutState {
  const config = useStableConfig(options?.config);
  const session = useMemo(() => createSession(graph, config), [graph, config]);
  return useSyncExternalStore(session.subscribe, session.read, session.read);
}
