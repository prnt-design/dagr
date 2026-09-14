/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@dagr/graph';
import type { LayoutDelta, LayoutResult } from '@dagr/layout';

// Only the two builders are faked; see `fake-render.ts`. The scene motion and
// the loop this file is about are the real ones, so what it asserts about a
// node halfway to its target is the spring's own answer.
vi.mock('@dagr/render', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./fake-render.js')),
}));

import type { SceneMotionFrame, SceneNode } from '@dagr/render';
import { DagrCanvas } from '../src/DagrCanvas.js';
import type { DagrCanvasProps } from '../src/DagrCanvas.js';
import { toSceneNodes } from '../src/scene.js';
import { lastRenderer, resetFakes } from './fake-render.js';
import { flush, mount } from './mount.js';
import type { Mounted } from './mount.js';
import { installFrameQueue, pendingFrames, runFrames, runFramesUntilIdle } from './frames.js';
import { installResizeObserver, resizeTo } from './resize.js';

let tree: Mounted | null = null;

beforeEach(() => {
  resetFakes();
  installFrameQueue();
  installResizeObserver();
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
  vi.unstubAllGlobals();
});

/** Two nodes on two ranks. Giving `b` a sibling is what moves `b`. */
function chain(): Graph {
  const graph = new Graph();
  graph.addNode({ id: 'a' });
  graph.addNode({ id: 'b' });
  graph.addEdge({ id: 'a-b', source: 'a', target: 'b' });
  return graph;
}

/** The edit every test here makes: a sibling for `b`, which moves `b` sideways. */
function addSibling(graph: Graph): void {
  graph.batch(() => {
    graph.addNode({ id: 'c' });
    graph.addEdge({ id: 'a-c', source: 'a', target: 'c' });
  });
}

/** Where the renderer was last told to draw a node. */
function drawnAt(id: string): { readonly x: number; readonly y: number } {
  const nodes = lastRenderer().setNodes.mock.calls.at(-1)?.[0] as SceneNode[] | undefined;
  const node = nodes?.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`the renderer was never told about ${id}`);
  return node.center;
}

/** Where a layout puts a node, which is where the animation has to end up. */
function laidOutAt(result: LayoutResult, id: string): { readonly x: number; readonly y: number } {
  const node = toSceneNodes(result).find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`the layout has no node ${id}`);
  return node.center;
}

/** A mounted canvas with a viewport, settled, and the layouts it has reported. */
async function mountAnimated(
  graph: Graph,
  extra: { readonly onFrame?: DagrCanvasProps['onFrame'] } = {},
): Promise<{ readonly layouts: LayoutResult[] }> {
  const layouts: LayoutResult[] = [];
  tree = await mount(
    <DagrCanvas
      graph={graph}
      animate
      onLayout={(result) => layouts.push(result)}
      {...(extra.onFrame === undefined ? {} : { onFrame: extra.onFrame })}
    />,
  );
  resizeTo(800, 600);
  await flush();
  await runFramesUntilIdle();
  return { layouts };
}

describe('DagrCanvas animate', () => {
  it('draws the first layout where it is, because a scene with no history has nowhere to come from', async () => {
    const graph = chain();
    const { layouts } = await mountAnimated(graph);

    const first = layouts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(drawnAt('b')).toEqual(laidOutAt(first, 'b'));
  });

  it('glides a node to its new place instead of cutting to it', async () => {
    const graph = chain();
    const { layouts } = await mountAnimated(graph);
    const from = drawnAt('b');

    await flush(() => {
      addSibling(graph);
    });
    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    const to = laidOutAt(after, 'b');
    expect(to.x).not.toBe(from.x);

    // The first frame after every wake steps by zero, so it draws the scene
    // where it is: an edit that cut to the new layout would already be there.
    await runFrames(16);
    expect(drawnAt('b').x).toBe(from.x);

    await runFrames(32);
    const halfway = drawnAt('b').x;
    expect(Math.min(from.x, to.x)).toBeLessThan(halfway);
    expect(halfway).toBeLessThan(Math.max(from.x, to.x));

    await runFramesUntilIdle();
    expect(drawnAt('b')).toEqual(to);
    expect(pendingFrames()).toBe(0);
  });

  it('asks for one frame however many reasons there are to draw', async () => {
    const graph = chain();
    await mountAnimated(graph);

    await flush(() => {
      addSibling(graph);
    });

    expect(pendingFrames()).toBe(1);
  });

  it('cuts to the new layout when it is not asked to animate', async () => {
    const graph = chain();
    const layouts: LayoutResult[] = [];
    tree = await mount(
      <DagrCanvas graph={graph} onLayout={(result) => layouts.push(result)} />,
    );
    resizeTo(800, 600);
    await flush();
    await runFramesUntilIdle();

    await flush(() => {
      addSibling(graph);
    });
    await runFrames(16);

    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(drawnAt('b')).toEqual(laidOutAt(after, 'b'));
    expect(pendingFrames()).toBe(0);
  });

  /**
   * React coalesces store updates, so two mutating calls in one task are one
   * render holding the LAST state: the first delta never reaches the motion and
   * the second describes a drawing the motion is not holding. The recovery is
   * `resync`, which describes a whole state rather than a difference, and the
   * observable claim is that the drawing arrives where the layout says rather
   * than that nothing was thrown.
   */
  it('reseats the scene when a burst of edits skips a delta past it', async () => {
    const graph = chain();
    const { layouts } = await mountAnimated(graph);

    await flush(() => {
      graph.addNode({ id: 'c' });
      graph.addEdge({ id: 'a-c', source: 'a', target: 'c' });
    });
    await runFramesUntilIdle();

    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(drawnAt('b')).toEqual(laidOutAt(after, 'b'));
    expect(drawnAt('c')).toEqual(laidOutAt(after, 'c'));
  });

  /**
   * The same skip as above, with the one difference that decides whether it is
   * caught: the surviving delta names nothing the dropped one introduced, so it
   * applies cleanly and NOTHING REFUSES IT. The scene is then a delta behind for
   * good, because the loop draws from the springs and the `setNodes` effect
   * stands down while it does.
   *
   * A no-op attribute edit is the cleanest instance and an ordinary flow:
   * create a node, then label it. The drawing has to be right afterwards, and a
   * motion that refuses nothing is exactly why the continuity check cannot be
   * left to the motion.
   */
  it('reseats when the surviving delta is one the motion would not refuse', async () => {
    const graph = chain();
    const { layouts } = await mountAnimated(graph);

    await flush(() => {
      addSibling(graph);
      graph.updateNodeAttrs('a', { label: 'hello' });
    });
    await runFramesUntilIdle();

    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(drawnAt('b')).toEqual(laidOutAt(after, 'b'));
    expect(drawnAt('c')).toEqual(laidOutAt(after, 'c'));
  });

  it('never refits the camera, not even while the drawing box is moving', async () => {
    const graph = chain();
    await mountAnimated(graph);
    expect(lastRenderer().camera.fitBounds).toHaveBeenCalledTimes(1);

    await flush(() => {
      addSibling(graph);
    });
    await runFramesUntilIdle();

    expect(lastRenderer().camera.fitBounds).toHaveBeenCalledTimes(1);
  });

  /**
   * The box is sprung and the component does not read it, which is the camera
   * decision: following it is the caller's line of code, and this is the handle
   * they write it on.
   */
  it('hands every frame, and the renderer about to draw it, to whoever asked', async () => {
    const graph = chain();
    const frames: SceneMotionFrame[] = [];
    const renderers = new Set<unknown>();
    await mountAnimated(graph, {
      onFrame: (frame, renderer) => {
        frames.push(frame);
        renderers.add(renderer);
      },
    });
    frames.length = 0;

    await flush(() => {
      addSibling(graph);
    });
    await runFramesUntilIdle();

    expect(frames.length).toBeGreaterThan(2);
    expect(frames.at(-1)?.settled).toBe(true);
    expect(frames.at(-1)?.bounds).not.toBeNull();
    // The box moved while the nodes did, rather than arriving with the first frame.
    expect(frames[0]?.bounds).not.toEqual(frames.at(-1)?.bounds);
    // One renderer, and the one that drew: `fitBounds` on it is the whole of a
    // following camera.
    expect(renderers.size).toBe(1);
    expect([...renderers][0]).toBe(lastRenderer());
  });

  it('stops asking for frames once nothing is moving', async () => {
    const graph = chain();
    await mountAnimated(graph);

    await flush(() => {
      addSibling(graph);
    });
    const ran = await runFramesUntilIdle();

    expect(ran).toBeGreaterThan(2);
    expect(pendingFrames()).toBe(0);
  });

  it('goes back to the layout when animation is turned off mid-flight', async () => {
    const graph = chain();
    const layouts: LayoutResult[] = [];
    tree = await mount(
      <DagrCanvas graph={graph} animate onLayout={(result) => layouts.push(result)} />,
    );
    resizeTo(800, 600);
    await flush();
    await runFramesUntilIdle();

    await flush(() => {
      addSibling(graph);
    });
    await runFrames(16);
    await runFrames(32);

    await tree.rerender(
      <DagrCanvas graph={graph} onLayout={(result) => layouts.push(result)} />,
    );
    await runFramesUntilIdle();

    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(drawnAt('b')).toEqual(laidOutAt(after, 'b'));
  });

  it('takes its frame back when the component goes mid-animation', async () => {
    const graph = chain();
    await mountAnimated(graph);

    await flush(() => {
      addSibling(graph);
    });
    await runFrames(16);
    expect(pendingFrames()).toBe(1);

    await tree?.unmount();
    tree = null;

    expect(pendingFrames()).toBe(0);
  });

  it('redraws a node that changed how it looks but not where it is', async () => {
    const graph = chain();
    await mountAnimated(graph);
    const before = lastRenderer().setNodes.mock.calls.length;

    await tree?.rerender(
      <DagrCanvas graph={graph} animate nodeAppearance={() => ({ fillColor: 0xff0000 })} />,
    );
    await runFramesUntilIdle();

    expect(lastRenderer().setNodes.mock.calls.length).toBeGreaterThan(before);
    const nodes = lastRenderer().setNodes.mock.calls.at(-1)?.[0] as SceneNode[];
    expect(nodes.every((node) => node.fillColor === 0xff0000)).toBe(true);
  });
});

describe('DagrCanvas and what it reports', () => {
  it('hands the delta to onLayout beside the result, so a consumer can show it', async () => {
    const graph = chain();
    const seen: (LayoutDelta | null)[] = [];
    tree = await mount(
      <DagrCanvas graph={graph} animate onLayout={(_result, delta) => seen.push(delta)} />,
    );
    resizeTo(800, 600);
    await flush();

    expect(seen).toEqual([null]);

    await flush(() => {
      addSibling(graph);
    });

    expect(seen).toHaveLength(2);
    expect(seen[1]?.nodes.added.map((node) => node.id)).toEqual(['c']);
  });

  /**
   * `onLayout` runs once per COMMIT, like every other effect here, so a burst
   * hands over one delta for two layouts. A consumer counting "what this edit
   * moved" off that delta alone would count the last hop only, and `from` is
   * what lets them notice: it is not the result they were last told about.
   */
  it('tells onLayout what the delta is a difference from, because a burst skips one', async () => {
    const graph = chain();
    const seen: { result: LayoutResult; from: LayoutResult | null }[] = [];
    tree = await mount(
      <DagrCanvas
        graph={graph}
        animate
        onLayout={(result, _delta, from) => seen.push({ result, from })}
      />,
    );
    resizeTo(800, 600);
    await flush();
    const told = seen.at(-1)?.result;

    await flush(() => {
      graph.addNode({ id: 'c' });
      graph.addNode({ id: 'd' });
    });

    expect(seen).toHaveLength(2);
    const last = seen.at(-1);
    expect(last?.result.nodes.size).toBe(4);
    // The drawing it skipped: three nodes, which is neither what the caller was
    // last told about nor what they are being told about now.
    expect(last?.from?.nodes.size).toBe(3);
    expect(last?.from).not.toBe(told);
  });

  /**
   * A node removed while it was standing still is gone on the next frame rather
   * than gliding out, because `advance` drops an entry that is departing and not
   * moving. The claim worth pinning is the one a consumer sees: the drawing ends
   * up holding exactly what the layout holds, and the renderer is never asked to
   * draw a node the graph no longer has.
   */
  it('stops drawing a node the graph no longer has', async () => {
    const graph = chain();
    const { layouts } = await mountAnimated(graph);
    await flush(() => {
      addSibling(graph);
    });
    await runFramesUntilIdle();
    expect(drawnAt('c')).toBeDefined();

    await flush(() => {
      graph.batch(() => {
        graph.removeEdge('a-c');
        graph.removeNode('c');
      });
    });
    await runFramesUntilIdle();

    const after = layouts.at(-1);
    expect(after).toBeDefined();
    if (after === undefined) return;
    const drawn = lastRenderer().setNodes.mock.calls.at(-1)?.[0] as SceneNode[];
    expect(drawn.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(drawnAt('b')).toEqual(laidOutAt(after, 'b'));
  });

  /**
   * The motion cleanup snaps the renderer back to the layout, and on unmount
   * there is no renderer left to snap: the stage cleanup has already run and
   * taken it. What this pins is the guard that makes that safe, which is the
   * cleanup reading `stageRef.current` rather than the `stage` it closed over.
   * Reading the closure would put a `setNodes` after `dispose`, which is the
   * one thing a disposed renderer must never see.
   */
  it('touches nothing after the renderer has been disposed', async () => {
    const graph = chain();
    await mountAnimated(graph);
    await flush(() => {
      addSibling(graph);
    });
    await runFrames(16);

    const renderer = lastRenderer();
    await tree?.unmount();
    tree = null;

    const disposedAt = renderer.dispose.mock.invocationCallOrder[0];
    expect(disposedAt).toBeDefined();
    if (disposedAt === undefined) return;
    for (const mock of [renderer.setNodes, renderer.setEdges, renderer.render, renderer.resize]) {
      for (const order of mock.mock.invocationCallOrder) expect(order).toBeLessThan(disposedAt);
    }
  });
});
