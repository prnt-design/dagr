/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Graph } from '@dagr/graph';
import type { LayoutResult } from '@dagr/layout';
import { useDagr } from '../src/use-dagr.js';
import type { DagrLayoutState, UseDagrOptions } from '../src/use-dagr.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';

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

afterEach(async () => {
  await tree?.unmount();
  tree = null;
});

/** Records every state the hook returned, in render order. */
function Probe({
  graph,
  options,
  seen,
}: {
  readonly graph: Graph;
  readonly options?: UseDagrOptions;
  readonly seen: DagrLayoutState[];
}): null {
  seen.push(useDagr(graph, options));
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
