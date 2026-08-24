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
 * That is the whole design. What follows is what it costs, because two of the
 * three costs are permanent and the reader should not have to discover them.
 *
 * **The snapshot is a counter this hook keeps, not something the graph
 * exposes.** `Graph` has no O(1) mutation counter, so there is nothing cheap to
 * read that changes when the graph does; the listener increments a number
 * instead. That works and it leaves ONE window open. React subscribes in an
 * effect, after the render that read the snapshot, and effects run child first,
 * so a CHILD's mount effect that edits the graph runs before this hook has
 * subscribed. The counter does not move, the post-subscribe re-check sees the
 * same value, and that one edit is not drawn until the next one arrives.
 *
 * Both fixes were considered and both are worse than the window:
 *
 * - Bumping the counter inside `subscribe` closes it and makes the
 *   post-subscribe re-check ALWAYS differ, so every mount lays the graph out
 *   twice. That is the flagship component paying for a case that needs a child
 *   editing the graph on mount.
 * - Subscribing during the first render, through a registry keyed on the graph,
 *   closes it properly and never unsubscribes: the listener has to outlive the
 *   component to be there before the next one renders. A graph that has ever
 *   been rendered would then build a `Patch` on every mutation forever, which
 *   is precisely the cost `Graph` documents itself as not paying for a graph
 *   nobody subscribed to.
 *
 * The durable fix belongs to `@dagr/graph`: an O(1) monotonic revision on the
 * graph itself would be a true snapshot, and the window closes with no
 * bookkeeping here at all. That is queued rather than done, because it is a
 * change to a different package's public surface.
 *
 * **The layout runs synchronously, during render.** `layout()` is synchronous
 * and this hook does not reach for a worker. `useCampaignScene` shows what the
 * async version costs: the `Worker` has to be the CALLER's, because `new
 * Worker(new URL(...))` is an expression a bundler reads statically and this
 * package would have to resolve under every host's bundler to own one. A
 * `createWorker` prop invented here, before M3.9 has built the worker-side
 * session that would make a per-edit round trip worth taking, would be a guess
 * at a shape M3.9 is going to decide.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';
import type { LayoutConfig, LayoutResult, Size } from '@dagr/layout';

/** What a caller may say about the layout run. */
export interface UseDagrOptions {
  /**
   * The layout configuration, compared BY VALUE. See {@link sameConfig}: a
   * caller writes this as an object literal in their JSX and it would otherwise
   * relayout the whole graph on every render of the host application.
   */
  readonly config?: LayoutConfig;
}

/** The layout, or what stopped it. Exactly one of the two is set. */
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

/**
 * A number that changes whenever the graph does.
 *
 * The counter lives in a ref rather than in state because it is the SNAPSHOT
 * and not the state: `useSyncExternalStore` is what turns a change in it into a
 * render, and a `setState` beside it would be a second path to the same render
 * with no ordering between them.
 */
function useGraphRevision(graph: Graph): number {
  const revision = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      graph.subscribe(() => {
        revision.current += 1;
        onStoreChange();
      }),
    [graph],
  );

  // Stable, and the same function for the server snapshot: this hook never runs
  // a layout differently on a server, so a divergent server snapshot would be
  // inventing a difference in order to declare it.
  const read = useCallback(() => revision.current, []);

  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Lays `graph` out, and lays it out again whenever it changes.
 *
 * The result is referentially stable: a render that changed neither the graph
 * nor the config hands back the same `LayoutResult` object, so a `useMemo` or a
 * `useEffect` downstream keyed on it does not run.
 */
export function useDagr(graph: Graph, options?: UseDagrOptions): DagrLayoutState {
  const config = useStableConfig(options?.config);
  const revision = useGraphRevision(graph);

  return useMemo<DagrLayoutState>(() => {
    try {
      return {
        result: layout(config === undefined ? { graph } : { graph, config }),
        error: null,
      };
    } catch (cause: unknown) {
      return { result: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
    // `revision` is not read in the body and is the whole point of the list: it
    // is how an in-place mutation, which changes no identity anywhere, becomes
    // a reason to run again.
  }, [graph, config, revision]);
}
