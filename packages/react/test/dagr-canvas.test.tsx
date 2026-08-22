/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@dagr/graph';

vi.mock('@dagr/render', () => import('./fake-render.js'));

import { DagrCanvas } from '../src/DagrCanvas.js';
import { built, lastOverlay, lastRenderer, resetFakes } from './fake-render.js';
import { flush, mount, mountCatching } from './mount.js';
import type { Mounted } from './mount.js';
import { installFrameQueue, pendingFrames, runFrames } from './frames.js';
import { installResizeObserver, resizeTo, watchCount } from './resize.js';

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

function chain(): Graph {
  const graph = new Graph();
  graph.addNode({ id: 'a' });
  graph.addNode({ id: 'b' });
  graph.addEdge({ id: 'a-b', source: 'a', target: 'b' });
  return graph;
}

describe('DagrCanvas', () => {
  it('builds one renderer over the canvas it rendered', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    expect(built.renderers).toHaveLength(1);
    const canvas = tree.container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(lastRenderer().options.canvas).toBe(canvas);
  });

  it('positions the container, because the overlay refuses a static parent', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    const host = tree.container.firstElementChild as HTMLElement;
    expect(host.style.position).toBe('relative');
    expect(lastOverlay().options.parent).toBe(host);
  });

  it('declares its edge group at construction, where the renderer needs it', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    expect(lastRenderer().options.edgeGroups).toHaveLength(1);
  });

  it('sets the flipped nodes and edges from the layout', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    const nodes = lastRenderer().setNodes.mock.calls[0]?.[0] as { id: string; center: { y: number } }[];
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b']);
    // y-up: the source of the only edge sits above its target.
    expect(nodes[0]?.center.y).toBeGreaterThan(nodes[1]?.center.y ?? 0);

    const [groupId, edges] = lastRenderer().setEdges.mock.calls[0] as [string, { id: string }[]];
    expect(groupId).toBe(lastRenderer().options.edgeGroups?.[0]?.id);
    expect(edges.map((edge) => edge.id)).toEqual(['a-b']);
  });

  it('draws one frame and syncs the overlay in it', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);
    expect(lastRenderer().render).not.toHaveBeenCalled();

    await runFrames();

    expect(lastRenderer().render).toHaveBeenCalledTimes(1);
    expect(lastOverlay().sync).toHaveBeenCalledTimes(1);
  });

  it('coalesces every reason to draw into one frame', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);
    resizeTo(800, 600);
    await flush();

    expect(pendingFrames()).toBe(1);
    await runFrames();
    expect(lastRenderer().render).toHaveBeenCalledTimes(1);
  });

  it('fits the camera to the layout once, and not again on an edit', async () => {
    const graph = chain();
    tree = await mount(<DagrCanvas graph={graph} />);
    resizeTo(800, 600);
    await flush();
    expect(lastRenderer().camera.fitBounds).toHaveBeenCalledTimes(1);

    await flush(() => {
      graph.addNode({ id: 'c' });
    });

    expect(lastRenderer().camera.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('never fits when told not to', async () => {
    tree = await mount(<DagrCanvas graph={chain()} fit={false} />);
    resizeTo(800, 600);
    await flush();

    expect(lastRenderer().camera.fitBounds).not.toHaveBeenCalled();
  });

  it('sets the nodes again when the graph is mutated', async () => {
    const graph = chain();
    tree = await mount(<DagrCanvas graph={graph} />);
    const before = lastRenderer().setNodes.mock.calls.length;

    await flush(() => {
      graph.addNode({ id: 'c' });
    });

    const calls = lastRenderer().setNodes.mock.calls;
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)?.[0]).toHaveLength(3);
  });

  it('resizes with the container and takes the device pixel ratio with it', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    resizeTo(640, 480);

    expect(lastRenderer().resize).toHaveBeenCalledWith({
      width: 640,
      height: 480,
      devicePixelRatio: window.devicePixelRatio,
    });
  });

  it('says nothing to the renderer about a container with no area', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);

    resizeTo(0, 0);

    expect(lastRenderer().resize).not.toHaveBeenCalled();
  });

  it('gives everything back on unmount', async () => {
    tree = await mount(<DagrCanvas graph={chain()} />);
    const renderer = lastRenderer();
    const overlay = lastOverlay();

    await tree.unmount();
    tree = null;

    expect(overlay.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(watchCount()).toBe(0);
    expect(pendingFrames()).toBe(0);
  });

  it('disposes a renderer that arrives after the component is gone', async () => {
    built.hold = true;
    tree = await mount(<DagrCanvas graph={chain()} />);
    expect(built.renderers).toHaveLength(1);
    expect(built.overlays).toHaveLength(0);

    await tree.unmount();
    tree = null;
    await flush(() => {
      built.release?.();
    });

    expect(lastRenderer().dispose).toHaveBeenCalledTimes(1);
    expect(built.overlays).toHaveLength(0);
  });

  it('reports a renderer that cannot be built', async () => {
    built.rendererFailure = new Error('no adapter');
    const failures: unknown[] = [];

    tree = await mount(<DagrCanvas graph={chain()} onError={(cause) => failures.push(cause)} />);

    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).message).toBe('no adapter');
    expect(built.overlays).toHaveLength(0);
  });

  it('throws a failure nobody is listening for into the nearest boundary', async () => {
    built.rendererFailure = new Error('no adapter');

    const caught = await mountCatching(<DagrCanvas graph={chain()} />);
    tree = caught.tree;

    expect((caught.errors[0] as Error).message).toBe('no adapter');
  });

  it('reports a layout it could not run the same way it reports a device', async () => {
    const failures: unknown[] = [];

    tree = await mount(
      <DagrCanvas
        graph={chain()}
        config={{ nodeSep: -1 }}
        onError={(cause) => failures.push(cause)}
      />,
    );

    expect((failures[0] as Error).message).toContain('nodeSep');
    // The device is still built: a layout that failed is not a reason to give
    // up the canvas, since the next edit may well produce one that works.
    expect(built.renderers).toHaveLength(1);
  });

  it('does not leave a renderer running when the overlay refuses its parent', async () => {
    built.overlayFailure = new Error('parent is static');
    const failures: unknown[] = [];

    tree = await mount(<DagrCanvas graph={chain()} onError={(cause) => failures.push(cause)} />);

    expect((failures[0] as Error).message).toBe('parent is static');
    // The renderer holds a device context and `made` is still null at this
    // point, so nothing else would ever take it back.
    expect(lastRenderer().dispose).toHaveBeenCalledTimes(1);
  });

  it('hands the layout to whoever asked for it', async () => {
    const seen: number[] = [];
    tree = await mount(<DagrCanvas graph={chain()} onLayout={(result) => seen.push(result.nodes.size)} />);

    expect(seen).toEqual([2]);
  });

  it('keeps its children out of the tree until there is a stage for them', async () => {
    built.hold = true;
    let rendered = 0;
    function Child(): null {
      rendered += 1;
      return null;
    }

    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Child />
      </DagrCanvas>,
    );
    expect(rendered).toBe(0);

    await flush(() => {
      built.release?.();
    });

    expect(rendered).toBe(1);
  });
});
