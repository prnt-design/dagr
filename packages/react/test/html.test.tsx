/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@dagr/graph';
import type { ReactElement } from 'react';

vi.mock('@dagr/render', () => import('./fake-render.js'));

import { DagrCanvas } from '../src/DagrCanvas.js';
import { Html } from '../src/Html.js';
import { useDagrCanvas } from '../src/canvas-context.js';
import { CanvasContextError } from '../src/errors.js';
import { lastOverlay, resetFakes } from './fake-render.js';
import { installFrameQueue, runFrames } from './frames.js';
import { flush, mount, mountCatching } from './mount.js';
import type { Mounted } from './mount.js';
import { installResizeObserver } from './resize.js';

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
  graph.addEdge({ source: 'a', target: 'b' });
  return graph;
}

describe('Html', () => {
  it('registers one overlay entry over the node it names', async () => {
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html node="a">label</Html>
      </DagrCanvas>,
    );

    const entries = lastOverlay().entries;
    expect(entries).toHaveLength(1);
    const placement = entries[0]?.placement;
    expect(placement?.kind).toBe('box');
  });

  it('renders its children into the element the overlay asks for', async () => {
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html node="a">
          <span className="label">Alpha</span>
        </Html>
      </DagrCanvas>,
    );

    const element = lastOverlay().entries[0]?.init.create();
    expect(element?.querySelector('.label')?.textContent).toBe('Alpha');
  });

  it('hands back the same element every time the overlay asks', async () => {
    // The overlay builds lazily and releases on a cull, so `create` runs again
    // every time an entry comes back into view. A fresh element each time would
    // be an empty box, because the portal is bound to the first one.
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html node="a">label</Html>
      </DagrCanvas>,
    );

    const init = lastOverlay().entries[0]?.init;
    expect(init?.create()).toBe(init?.create());
  });

  it('places the entry again after a relayout', async () => {
    const graph = chain();
    tree = await mount(
      <DagrCanvas graph={graph}>
        <Html node="b">label</Html>
      </DagrCanvas>,
    );
    const entry = lastOverlay().entries[0];
    const before = entry?.placement;

    await flush(() => {
      graph.addNode({ id: 'c' });
      graph.addEdge({ source: 'a', target: 'c' });
    });

    expect(lastOverlay().entries).toHaveLength(1);
    expect(entry?.placement).not.toBe(before);
  });

  it('takes an explicit placement for something that is not a node', async () => {
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html placement={{ kind: 'point', at: { x: 3, y: 4 } }}>legend</Html>
      </DagrCanvas>,
    );

    const placement = lastOverlay().entries[0]?.placement;
    expect(placement).toEqual({ kind: 'point', at: { x: 3, y: 4 } });
  });

  it('registers nothing for a node the layout does not have', async () => {
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html node="missing">label</Html>
      </DagrCanvas>,
    );

    expect(lastOverlay().entries).toHaveLength(0);
  });

  it('asks for a frame when it registers, so the label appears without a pan', async () => {
    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Html node="a">label</Html>
      </DagrCanvas>,
    );

    await runFrames();

    expect(lastOverlay().sync).toHaveBeenCalled();
  });

  it('takes its entry back when it unmounts', async () => {
    function Host({ show }: { readonly show: boolean }): ReactElement {
      return <DagrCanvas graph={chain()}>{show ? <Html node="a">label</Html> : null}</DagrCanvas>;
    }

    tree = await mount(<Host show={true} />);
    const entry = lastOverlay().entries[0];
    expect(entry?.removed).toBe(false);

    await tree.rerender(<Host show={false} />);

    expect(entry?.removed).toBe(true);
  });

  it('refuses to be used outside a canvas, by name', async () => {
    const caught = await mountCatching(<Html node="a">label</Html>);
    tree = caught.tree;

    expect(caught.errors[0]).toBeInstanceOf(CanvasContextError);
    expect((caught.errors[0] as CanvasContextError).code).toBe('OUTSIDE_CANVAS');
  });
});

describe('useDagrCanvas', () => {
  it('gives a child the stage its parent built', async () => {
    let sizes: number | null = null;
    function Reader(): null {
      sizes = useDagrCanvas().result.nodes.size;
      return null;
    }

    tree = await mount(
      <DagrCanvas graph={chain()}>
        <Reader />
      </DagrCanvas>,
    );

    expect(sizes).toBe(2);
  });

  it('refuses outside a canvas, by name', async () => {
    function Reader(): null {
      useDagrCanvas();
      return null;
    }

    const caught = await mountCatching(<Reader />);
    tree = caught.tree;

    expect(caught.errors[0]).toBeInstanceOf(CanvasContextError);
  });
});
