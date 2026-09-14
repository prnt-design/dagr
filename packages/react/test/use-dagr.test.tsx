/**
 * @vitest-environment jsdom
 */

import { StrictMode, useEffect } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@dagr/graph';
import type { LayoutEngine, LayoutEngineOptions, LayoutResult } from '@dagr/layout';
import { useDagr } from '../src/use-dagr.js';
import type { DagrLayoutState, UseDagrOptions } from '../src/use-dagr.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';

/** As much of `@dagr/layout` as the wrapper below reads, plus the rest of it. */
type RealLayout = Record<string, unknown> & {
  createLayout: (options?: LayoutEngineOptions) => LayoutEngine;
};

/**
 * Every engine this hook built, and every call it made to one.
 *
 * The three claims M5.3 makes about the hook are claims about an ENGINE rather
 * than about a layout: that one is held across edits, that an edit is a
 * `relayout` and not a `run`, and that it is disposed when the component goes.
 * None of the three is visible in a `LayoutResult`, and inferring them from a
 * delta would be inferring the mechanism from one of its symptoms. So
 * `createLayout` is wrapped rather than replaced: every method is the real one
 * and the wrapper only counts.
 */
const spy = vi.hoisted(() => ({
  built: 0,
  runs: 0,
  relayouts: 0,
  disposals: 0,
}));

vi.mock('@dagr/layout', async (importOriginal) => {
  const actual = await importOriginal<RealLayout>();
  return {
    ...actual,
    createLayout(options?: Parameters<typeof actual.createLayout>[0]) {
      const engine = actual.createLayout(options);
      spy.built += 1;
      return {
        ...engine,
        run(graph: Parameters<typeof engine.run>[0]) {
          spy.runs += 1;
          return engine.run(graph);
        },
        relayout(patch: Parameters<typeof engine.relayout>[0]) {
          spy.relayouts += 1;
          return engine.relayout(patch);
        },
        dispose() {
          spy.disposals += 1;
          engine.dispose();
        },
      };
    },
  };
});

/**
 * The second test the config guard needs, because the first one is vacuous.
 *
 * `use-dagr.ts` asserts that every `LayoutConfig` field is named in its
 * comparison, and that assertion passes today precisely because they all are:
 * it can never fail against the type it guards until somebody adds a field, so
 * on its own it is evidence of nothing. These two lines run the same expression
 * over a stand-in in both directions, so the failing branch is demonstrated
 * rather than assumed. `pnpm typecheck` reads this file, which is what makes
 * `@ts-expect-error` an assertion rather than a comment.
 */
type ComparedHere = 'nodeSep' | 'rankSep';
type UncomparedIn<T> = Exclude<keyof T, ComparedHere>;

// @ts-expect-error `edgeSep` is named nowhere in `ComparedHere`, so the guard's
// type is `never` and this is the compile error the real one would raise.
const guardFires: [UncomparedIn<{ nodeSep?: 1; rankSep?: 1; edgeSep?: 1 }>] extends [never]
  ? true
  : never = true;
void guardFires;

const guardPasses: [UncomparedIn<{ nodeSep?: 1; rankSep?: 1 }>] extends [never] ? true : never =
  true;
void guardPasses;

let tree: Mounted | null = null;

beforeEach(() => {
  spy.built = 0;
  spy.runs = 0;
  spy.relayouts = 0;
  spy.disposals = 0;
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
});

/** Records every state the hook returned, in render order. */
function Probe({
  graph,
  options,
  seen,
  children,
}: {
  readonly graph: Graph;
  readonly options?: UseDagrOptions;
  readonly seen: DagrLayoutState[];
  readonly children?: ReactNode;
}): ReactNode {
  seen.push(useDagr(graph, options));
  return children ?? null;
}

/**
 * A child that edits the graph as it mounts, which is the one window the hook
 * documents and cannot close.
 *
 * Idempotent, because `StrictMode` runs a mount effect twice and the second
 * `addNode` of the same id is a refusal rather than a second node.
 */
function EditsOnMount({ graph, id }: { readonly graph: Graph; readonly id: string }): null {
  useEffect(() => {
    if (!graph.hasNode(id)) graph.addNode({ id });
  }, [graph, id]);
  return null;
}

function twoNodes(): Graph {
  const graph = new Graph();
  graph.addNode({ id: 'a' });
  graph.addNode({ id: 'b' });
  graph.addEdge({ source: 'a', target: 'b' });
  return graph;
}

/** The last state the probe saw, which is the one the caller would be holding. */
function latest(seen: DagrLayoutState[]): DagrLayoutState {
  const last = seen.at(-1);
  if (last === undefined) throw new Error('the probe never rendered');
  return last;
}

describe('useDagr', () => {
  it('lays the graph out on the first render', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} seen={seen} />);

    const { result, error } = latest(seen);
    expect(error).toBeNull();
    expect(result?.nodes.size).toBe(2);
    expect(result?.edges.size).toBe(1);
  });

  it('hands back the same result on a re-render that changed nothing', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);
    const first = latest(seen).result;

    await tree.rerender(<Probe graph={graph} seen={seen} />);

    expect(seen.length).toBeGreaterThan(1);
    expect(latest(seen).result).toBe(first);
  });

  it('lays out again when the graph is mutated in place', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);
    const first = latest(seen).result;

    await flush(() => {
      graph.addNode({ id: 'c' });
    });

    const after = latest(seen).result;
    expect(after).not.toBe(first);
    expect(after?.nodes.size).toBe(3);
  });

  it('lays out again when a different graph arrives on the prop', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} seen={seen} />);
    const first = latest(seen).result;

    const replacement = new Graph();
    replacement.addNode({ id: 'only' });
    await tree.rerender(<Probe graph={replacement} seen={seen} />);

    expect(latest(seen).result).not.toBe(first);
    expect(latest(seen).result?.nodes.size).toBe(1);
  });

  it('runs the layout once per edit rather than once per render', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);

    const results = new Set<LayoutResult>();
    for (let round = 0; round < 3; round += 1) {
      await tree.rerender(<Probe graph={graph} seen={seen} />);
      const { result } = latest(seen);
      if (result !== null) results.add(result);
    }

    expect(results.size).toBe(1);
  });

  it('stops listening to the graph once the component is gone', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);
    const renders = seen.length;

    await tree.unmount();
    tree = null;
    graph.addNode({ id: 'c' });

    expect(seen.length).toBe(renders);
  });

  it('reports a config the layout refuses instead of throwing through the render', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} options={{ config: { nodeSep: -1 } }} seen={seen} />);

    const { result, error } = latest(seen);
    expect(result).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('nodeSep');
  });

  it('recovers on the next render once the config is usable again', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} options={{ config: { nodeSep: -1 } }} seen={seen} />);
    expect(latest(seen).error).toBeInstanceOf(Error);

    await tree.rerender(<Probe graph={graph} options={{ config: { nodeSep: 10 } }} seen={seen} />);

    expect(latest(seen).error).toBeNull();
    expect(latest(seen).result?.nodes.size).toBe(2);
  });

  it('treats an equal config written inline as the same config', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} options={{ config: { nodeSep: 10 } }} seen={seen} />);
    const first = latest(seen).result;

    // The shape a caller actually writes: a fresh object literal every render.
    // Keyed on identity this would relayout the whole graph on every keystroke
    // anywhere in the host application.
    await tree.rerender(<Probe graph={graph} options={{ config: { nodeSep: 10 } }} seen={seen} />);

    expect(latest(seen).result).toBe(first);
  });
});

describe('useDagr over the incremental engine', () => {
  it('holds one engine across every edit, so an edit is a relayout and not a cold run', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);

    for (const id of ['c', 'd', 'e']) {
      await flush(() => {
        graph.addNode({ id });
      });
    }

    expect(spy.built).toBe(1);
    expect(spy.runs).toBe(1);
    expect(spy.relayouts).toBe(3);
    expect(latest(seen).result?.nodes.size).toBe(5);
  });

  it('reports the first run with no delta, because a cold run is not a difference', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} seen={seen} />);

    expect(latest(seen).result).not.toBeNull();
    expect(latest(seen).delta).toBeNull();
  });

  it('reports what the edit changed', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);

    await flush(() => {
      graph.batch(() => {
        graph.addNode({ id: 'c' });
        graph.addEdge({ id: 'b-c', source: 'b', target: 'c' });
      });
    });

    const { delta } = latest(seen);
    expect(delta?.nodes.added.map((node) => node.id)).toEqual(['c']);
    expect(delta?.edges.added.map((edge) => edge.id)).toEqual(['b-c']);
    expect(delta?.bounds).not.toBeUndefined();
  });

  /**
   * The property a held engine has and a per-edit `layout()` cannot: `from` is
   * the geometry this hook last handed the caller, so a consumer applying every
   * delta in order is never a delta behind the result it is drawing.
   */
  it('measures the delta from the drawing it last reported', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} seen={seen} />);
    const before = latest(seen).result;

    // A sibling for `b`, which is an edit that MOVES something: the two of them
    // now share a rank and the rank is centred under `a`.
    await flush(() => {
      graph.batch(() => {
        graph.addNode({ id: 'c' });
        graph.addEdge({ id: 'a-c', source: 'a', target: 'c' });
      });
    });

    const moved = latest(seen).delta?.nodes.moved ?? [];
    expect(moved.length).toBeGreaterThan(0);
    for (const node of moved) {
      const was = before?.nodes.get(node.id);
      expect(node.from.x).toBe(was?.x);
      expect(node.from.y).toBe(was?.y);
    }
  });

  it('runs cold, with no delta, when the config changes', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={graph} options={{ config: { nodeSep: 10 } }} seen={seen} />);
    await flush(() => {
      graph.addNode({ id: 'c' });
    });
    expect(latest(seen).delta).not.toBeNull();

    await tree.rerender(<Probe graph={graph} options={{ config: { nodeSep: 40 } }} seen={seen} />);

    expect(latest(seen).delta).toBeNull();
    expect(spy.built).toBe(2);
  });

  it('runs cold, with no delta, when a different graph arrives', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} seen={seen} />);

    await tree.rerender(<Probe graph={twoNodes()} seen={seen} />);

    expect(latest(seen).delta).toBeNull();
    expect(spy.built).toBe(2);
  });

  it('gives the engine back when the component goes', async () => {
    const seen: DagrLayoutState[] = [];
    tree = await mount(<Probe graph={twoNodes()} seen={seen} />);
    expect(spy.disposals).toBe(0);

    await tree.unmount();
    tree = null;

    expect(spy.disposals).toBe(1);
  });

  /**
   * The mount window, pinned rather than fixed. A child's mount effect runs
   * before the parent has subscribed, so that edit reaches no listener. What
   * the engine does about it is the half worth knowing: `relayout` re-runs the
   * pipeline over the graph it holds and diffs against the geometry it last
   * reported, so the next edit reports BOTH, and the drawing catches up rather
   * than diverging forever.
   */
  it('is one edit behind when a child edits the graph as it mounts, and catches up on the next', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(
      <Probe graph={graph} seen={seen}>
        <EditsOnMount graph={graph} id="c" />
      </Probe>,
    );
    expect(latest(seen).result?.nodes.size).toBe(2);

    await flush(() => {
      graph.addNode({ id: 'd' });
    });

    expect(latest(seen).result?.nodes.size).toBe(4);
    expect(latest(seen).delta?.nodes.added.map((node) => node.id).sort()).toEqual(['c', 'd']);
  });

  /**
   * StrictMode unsubscribes and resubscribes, which leaves the engine disposed
   * behind a component that is still mounted. Rebuilding it at the resubscribe
   * rather than at the next edit is what makes that edit an animation rather
   * than a cut, and it closes the mount window above for the one mode that
   * opens it twice.
   */
  it('rebuilds the engine when React resubscribes, and catches up while doing it', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    tree = await mount(
      <StrictMode>
        <Probe graph={graph} seen={seen}>
          <EditsOnMount graph={graph} id="c" />
        </Probe>
      </StrictMode>,
    );

    expect(latest(seen).result?.nodes.size).toBe(3);
    expect(latest(seen).delta).toBeNull();

    await flush(() => {
      graph.addNode({ id: 'd' });
    });

    expect(latest(seen).delta?.nodes.added.map((node) => node.id)).toEqual(['d']);
  });

  /**
   * The relayout runs inside the caller's own mutating call, which is the one
   * place a throw would be a surprise: `graph.addNode` is not a function anyone
   * expects to raise a layout error.
   */
  it('reports a run that failed rather than throwing out of the mutation that caused it', async () => {
    const graph = twoNodes();
    const seen: DagrLayoutState[] = [];
    const refuse = (): never => {
      throw new Error('the measurer refused');
    };
    tree = await mount(<Probe graph={graph} options={{ config: { nodeSize: refuse } }} seen={seen} />);
    expect(latest(seen).error?.message).toBe('the measurer refused');

    await flush(() => {
      graph.addNode({ id: 'c' });
    });

    expect(latest(seen).result).toBeNull();
    expect(latest(seen).error?.message).toBe('the measurer refused');
    expect(graph.hasNode('c')).toBe(true);
  });
});
