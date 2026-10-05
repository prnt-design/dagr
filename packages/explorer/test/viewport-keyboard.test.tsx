// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerBase, ExplorerBaseProps } from '../src/base.js';
import type { ExplorerCamera } from '../src/camera.js';
import { REVEAL_MARGIN } from '../src/camera.js';
import { ExplorerRoot } from '../src/root.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import type { ExplorerApi } from '../src/context.js';
import { layoutView } from '../src/index.js';
import type { ExplorerEdge, ExplorerLayout, ExplorerNode, ExplorerView } from '../src/index.js';
import { svgBase } from '../src/svg-base.js';
import type { ExplorerCameraControls } from '../src/use-explorer-camera.js';
import { ViewportSurface } from '../src/viewport-surface.js';
import type { ViewportSurfaceProps } from '../src/viewport-surface.js';
import { fire, flush, installDom, key, mount, pointer, resizeTo, runFramesUntilIdle, tab, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { empty, overview } from './fixtures.js';
import type { Item } from './fixtures.js';

/** a -> b -> c, in a row, boxes 240 by 120. */
const chainView: ExplorerView<Item> = {
  id: 'chain',
  label: 'Chain',
  nodes: [
    { id: 'a', label: 'Alpha', kind: 'service' },
    { id: 'b', label: 'Beta', kind: 'store' },
    { id: 'c', label: 'Gamma', kind: 'queue' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
  ],
};
const chain = layoutView(chainView);

/** p above q and r, which sit side by side. */
const fanView: ExplorerView<Item> = {
  id: 'fan',
  label: 'Fan',
  layout: { direction: 'down' },
  nodes: [
    { id: 'p', label: 'P', kind: 'x' },
    { id: 'q', label: 'Q', kind: 'x' },
    { id: 'r', label: 'R', kind: 'x' },
  ],
  edges: [
    { id: 'pq', source: 'p', target: 'q' },
    { id: 'pr', source: 'p', target: 'r' },
  ],
};
const fan = layoutView(fanView);

const SIZE = { width: 800, height: 480 };

let tree: Mounted | null = null;
const controlsRef: MutableRefObject<ExplorerCameraControls | null> = { current: null };

beforeEach(() => {
  installDom();
  controlsRef.current = null;
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

type Props = Partial<ViewportSurfaceProps<Item, ExplorerEdge>>;

/** The surface between two buttons, so Tab has somewhere to come from and go to. */
function surface(props: Props = {}): ReactNode {
  return (
    <>
      <button type="button" data-testid="before">
        before
      </button>
      <ViewportSurface<Item, ExplorerEdge>
        label="Graph"
        view={chainView}
        layout={chain}
        controlsRef={controlsRef}
        {...props}
      />
      <button type="button" data-testid="after">
        after
      </button>
    </>
  );
}

async function ready(props: Props = {}): Promise<void> {
  tree = await mount(surface(props));
  await resizeTo(SIZE.width, SIZE.height);
  await runFramesUntilIdle();
}

function byTestId(id: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${id}`);
  return element;
}

function viewport(): HTMLElement {
  const element = document.querySelector('[data-dagr-explorer="viewport"]');
  if (!(element instanceof HTMLElement)) throw new Error('no viewport');
  return element;
}

function button(id: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[data-dagr-explorer="node"][data-node-id="${id}"]`);
}

function mustButton(id: string): HTMLButtonElement {
  const element = button(id);
  if (element === null) throw new Error(`no button ${id}`);
  return element;
}

/** The ids of the node buttons in the tab order. */
function tabStops(): string[] {
  return [...document.querySelectorAll<HTMLElement>('button[data-dagr-explorer="node"]')]
    .filter((element) => element.tabIndex >= 0)
    .map((element) => element.dataset['nodeId'] ?? '');
}

function focusedNode(): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.dataset['dagrExplorer'] === 'node'
    ? (active.dataset['nodeId'] ?? null)
    : null;
}

function controls(): ExplorerCameraControls {
  if (controlsRef.current === null) throw new Error('no controls');
  return controlsRef.current;
}

function cameraNow(): ExplorerCamera {
  const camera = controls().getCamera();
  if (camera === null) throw new Error('no camera');
  return camera;
}

function boxOf(layout: ExplorerLayout, id: string): { x: number; y: number; width: number; height: number } {
  const box = layout.boxes.get(id);
  if (box === undefined) throw new Error(`no box ${id}`);
  return box;
}

/** Whether a node's box is on screen, inside the reveal margin, under the current camera. */
function revealed(layout: ExplorerLayout, id: string): boolean {
  const box = boxOf(layout, id);
  const camera = cameraNow();
  const left = camera.x + box.x * camera.scale;
  const top = camera.y + box.y * camera.scale;
  const right = left + box.width * camera.scale;
  const bottom = top + box.height * camera.scale;
  const slack = 0.5;
  return (
    left >= REVEAL_MARGIN - slack &&
    top >= REVEAL_MARGIN - slack &&
    right <= SIZE.width - REVEAL_MARGIN + slack &&
    bottom <= SIZE.height - REVEAL_MARGIN + slack
  );
}

/** Zooms in on a node, flown and settled. */
async function zoomOn(layout: ExplorerLayout, id: string): Promise<void> {
  controls().focusBox(boxOf(layout, id));
  await runFramesUntilIdle();
}

async function press(name: string, init: Parameters<typeof key>[1] = {}): Promise<boolean> {
  const target = document.activeElement ?? document.body;
  const allowed = await fire(target, key(name, init));
  await runFramesUntilIdle();
  return allowed;
}

describe('ViewportSurface: one tab stop', () => {
  it('has exactly one tabbable node, and Tab enters on it and Tab again leaves the graph', async () => {
    await ready();
    expect(viewport().tabIndex).toBe(-1);
    // b is the node nearest the center of the fitted chain.
    expect(tabStops()).toEqual(['b']);
    expect(document.querySelectorAll('button[data-dagr-explorer="node"]')).toHaveLength(3);

    byTestId('before').focus();
    await tab();
    expect(focusedNode()).toBe('b');
    await tab();
    expect(document.activeElement).toBe(byTestId('after'));
    await tab({ shift: true });
    expect(focusedNode()).toBe('b');
    await tab({ shift: true });
    expect(document.activeElement).toBe(byTestId('before'));
  });

  it('enters on the selected node when there is one', async () => {
    await ready({ selectedId: 'c' });
    expect(tabStops()).toEqual(['c']);
    byTestId('before').focus();
    await tab();
    expect(focusedNode()).toBe('c');
  });

  it('enters on the node nearest the center of the camera, which follows a move of the camera', async () => {
    await ready();
    await zoomOn(chain, 'c');
    expect(tabStops()).toEqual(['c']);
    byTestId('before').focus();
    await tab();
    expect(focusedNode()).toBe('c');
  });

  it('pins the tab target, so the graph has a tab stop with every node a mark', async () => {
    await ready({ tiers: { summary: 10_000, rich: 20_000 } });
    expect(tabStops()).toEqual(['b']);
    expect(document.querySelectorAll('button[data-dagr-explorer="node"]')).toHaveLength(1);
  });

  it('keeps the tab target mounted through a pan that would otherwise unmount it, and reveals it on Tab', async () => {
    await ready();
    byTestId('before').focus();
    await tab();
    await press('ArrowRight');
    expect(focusedNode()).toBe('c');
    await tab();
    expect(document.activeElement).toBe(byTestId('after'));

    await zoomOn(chain, 'a');
    // The premise: c is far outside the view, and only the pin keeps it.
    expect(revealed(chain, 'c')).toBe(false);
    expect(cameraNow().x + boxOf(chain, 'c').x * cameraNow().scale).toBeGreaterThan(SIZE.width * 1.5);
    expect(tabStops()).toEqual(['c']);

    await tab({ shift: true });
    await runFramesUntilIdle();
    expect(focusedNode()).toBe('c');
    expect(revealed(chain, 'c')).toBe(true);
  });

  it('remembers the last node focused from the keyboard when the selection is cleared', async () => {
    await ready({ selectedId: 'a' });
    expect(tabStops()).toEqual(['a']);
    byTestId('before').focus();
    await tab();
    await press('ArrowRight');
    expect(focusedNode()).toBe('b');
    // The selection still holds the tab stop.
    expect(tabStops()).toEqual(['a']);
    await tab();
    await tree?.rerender(surface({ selectedId: null }));
    expect(tabStops()).toEqual(['b']);
  });

  it('moves the target when its node leaves the data, without throwing', async () => {
    await ready();
    byTestId('before').focus();
    await tab();
    await press('ArrowRight');
    await tab();
    expect(tabStops()).toEqual(['c']);

    const shorterView: ExplorerView<Item> = { ...chainView, nodes: chainView.nodes.slice(0, 2), edges: chainView.edges.slice(0, 1) };
    const shorter = layoutView(shorterView);
    await tree?.rerender(surface({ view: shorterView, layout: shorter }));
    await runFramesUntilIdle();
    expect(tabStops()).toHaveLength(1);
    expect(['a', 'b']).toContain(tabStops()[0]);
  });
});

describe('ViewportSurface: arrows on a focused node', () => {
  it('moves focus to the nearest node in each direction, and is a no-op with none', async () => {
    await ready({ view: fanView, layout: fan });
    byTestId('before').focus();
    await tab();
    const start = focusedNode();
    expect(start).not.toBeNull();
    mustButton('p').focus();

    // q and r are equally far below p: the tie goes to the lower id.
    expect(await press('ArrowDown')).toBe(false);
    expect(focusedNode()).toBe('q');
    await press('ArrowRight');
    expect(focusedNode()).toBe('r');
    await press('ArrowUp');
    expect(focusedNode()).toBe('p');
    await press('ArrowDown');
    await press('ArrowRight');
    await press('ArrowLeft');
    expect(focusedNode()).toBe('q');

    const camera = cameraNow();
    // Nothing is left of q: focus stays, the camera stays, the page does not scroll.
    expect(await press('ArrowLeft')).toBe(false);
    expect(focusedNode()).toBe('q');
    expect(cameraNow()).toEqual(camera);
  });

  it('reveals the node it moves to, at the current zoom', async () => {
    await ready();
    await zoomOn(chain, 'b');
    const scale = cameraNow().scale;
    byTestId('before').focus();
    await tab();
    expect(focusedNode()).toBe('b');
    await press('ArrowLeft');
    expect(focusedNode()).toBe('a');
    expect(revealed(chain, 'a')).toBe(true);
    expect(cameraNow().scale).toBe(scale);
  });

  it('mounts, focuses and reveals an off-screen node, and focus never falls to the body on the way', async () => {
    const log: string[] = [];
    // A base whose layout effect runs in every commit that changes the
    // overlay, after the DOM changed and before the surface moves focus.
    function Probe(props: ExplorerBaseProps<ExplorerNode, ExplorerEdge>): ReactNode {
      useLayoutEffect(() => {
        const active = document.activeElement;
        log.push(active === document.body ? 'body' : active instanceof HTMLElement ? (active.dataset['nodeId'] ?? active.tagName) : 'none');
      });
      return <svgBase.Layer {...props} />;
    }
    const probe: ExplorerBase = { space: 'plane', Layer: Probe };
    await ready({ base: probe });
    await zoomOn(chain, 'b');
    byTestId('before').focus();
    await tab();
    expect(focusedNode()).toBe('b');
    // The premise: c is not mounted.
    expect(button('c')).toBeNull();

    log.length = 0;
    await press('ArrowRight');
    expect(focusedNode()).toBe('c');
    expect(revealed(chain, 'c')).toBe(true);
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain('body');
  });

  it('pans with Shift and an arrow, and does not move focus', async () => {
    await ready();
    await zoomOn(chain, 'b');
    byTestId('before').focus();
    await tab();
    const before = cameraNow();
    expect(await press('ArrowRight', { shiftKey: true })).toBe(false);
    expect(focusedNode()).toBe('b');
    expect(cameraNow().x).toBeLessThan(before.x);
    expect(cameraNow().scale).toBe(before.scale);
  });

  it('leaves an arrow with Ctrl, Command or Alt to the browser', async () => {
    await ready();
    byTestId('before').focus();
    await tab();
    const before = cameraNow();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(await press('ArrowRight', { [modifier]: true })).toBe(true);
      expect(focusedNode()).toBe('b');
    }
    expect(cameraNow()).toEqual(before);
  });

  it('inspects on Enter and on Space, with the button as the trigger', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    byTestId('before').focus();
    await tab();
    expect(await press('Enter')).toBe(false);
    expect(onNodeActivate).toHaveBeenCalledWith('b', mustButton('b'));
    await press('ArrowRight');
    expect(await press(' ')).toBe(false);
    expect(onNodeActivate).toHaveBeenLastCalledWith('c', mustButton('c'));
    expect(onNodeActivate).toHaveBeenCalledTimes(2);
    // A held key's repeats are not more activations.
    await press('Enter', { repeat: true });
    expect(onNodeActivate).toHaveBeenCalledTimes(2);
  });

  it('activates once for Space, whose click a browser may fire on keyup', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    byTestId('before').focus();
    await tab();
    const target = mustButton('b');
    await press(' ');
    const up = await fire(target, new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    // A button's click follows an unprevented Space keyup, with no pointer.
    if (up) await fire(target, new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    expect(onNodeActivate).toHaveBeenCalledTimes(1);
  });

  it('still activates once for a lone click from assistive technology', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    await fire(mustButton('b'), new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    expect(onNodeActivate).toHaveBeenCalledTimes(1);
  });

  it('leaves keys typed into a host element inside a node to that element', async () => {
    const onNodeActivate = vi.fn();
    await ready({
      onNodeActivate,
      renderNode: (node) => (
        <span tabIndex={0} data-testid={`inner-${node.id}`}>
          {node.label}
        </span>
      ),
    });
    byTestId('before').focus();
    await tab();
    const inner = byTestId('inner-b');
    inner.focus();
    for (const name of [' ', 'Enter', 'ArrowRight']) {
      expect(await fire(inner, key(name))).toBe(true);
    }
    await runFramesUntilIdle();
    expect(onNodeActivate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(inner);
  });
});

describe('ViewportSurface: focus and the camera', () => {
  it('does not move the camera for a pointer focus, and does for a keyboard one', async () => {
    await ready();
    await zoomOn(chain, 'b');
    // Back out a little, so a and c are mounted and partly off screen.
    controls().zoomBy(0.6);
    await runFramesUntilIdle();
    expect(button('c')).not.toBeNull();
    expect(revealed(chain, 'c')).toBe(false);
    const before = cameraNow();

    const c = mustButton('c');
    await fire(c, pointer('pointerdown', 700, 240));
    await flush(() => c.focus());
    await runFramesUntilIdle();
    expect(focusedNode()).toBe('c');
    expect(cameraNow()).toEqual(before);

    await flush(() => c.blur());
    await fire(document.body, key('Tab'));
    await flush(() => c.focus());
    await runFramesUntilIdle();
    expect(revealed(chain, 'c')).toBe(true);
  });

  it('undoes a scroll of the viewport, which a browser makes to show a focused node', async () => {
    await ready();
    const element = viewport();
    element.scrollTop = 40;
    element.scrollLeft = 30;
    await fire(element, new Event('scroll'));
    expect(element.scrollTop).toBe(0);
    expect(element.scrollLeft).toBe(0);
  });
});

describe('ExplorerViewport: keyboard through the root', () => {
  const apiRef: { current: ExplorerApi | null } = { current: null };

  function explorer(views: readonly ExplorerView<Item>[]): ReactNode {
    return (
      <>
        <button type="button" data-testid="before">
          before
        </button>
        <ExplorerRoot<Item, ExplorerEdge> label="Map" views={views} apiRef={apiRef}>
          <ExplorerViewport<Item, ExplorerEdge> />
        </ExplorerRoot>
        <button type="button" data-testid="after">
          after
        </button>
      </>
    );
  }

  it('inspects the focused node on Enter, the first Escape closes the drawer, the second releases graph focus', async () => {
    tree = await mount(explorer([overview]));
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    byTestId('before').focus();
    await tab();
    const id = focusedNode();
    expect(id).not.toBeNull();
    await press('Enter');
    expect(mustButton(id ?? '').dataset['selected']).toBe('true');
    await press('Escape');
    expect(focusedNode()).toBe(id);
    await press('Escape');
    expect(viewport().contains(document.activeElement)).toBe(false);
  });

  it('has nothing tabbable in an empty view', async () => {
    tree = await mount(explorer([empty]));
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    const stage = document.querySelector('[data-dagr-explorer="stage"]');
    const tabbable = [...(stage?.querySelectorAll<HTMLElement>('*') ?? [])].filter((element) => element.tabIndex >= 0);
    expect(tabbable).toEqual([]);
    byTestId('before').focus();
    await tab();
    expect(document.activeElement).toBe(byTestId('after'));
  });
});
