// @vitest-environment jsdom
import { StrictMode } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerBase, ExplorerBaseProps } from '../src/base.js';
import type { ExplorerCamera } from '../src/camera.js';
import { layoutView } from '../src/index.js';
import type { ExplorerEdge, ExplorerLayout, ExplorerNode, ExplorerView } from '../src/index.js';
import type { ExplorerCameraControls } from '../src/use-explorer-camera.js';
import { ViewportSurface } from '../src/viewport-surface.js';
import type { ViewportSurfaceProps } from '../src/viewport-surface.js';
import {
  DEFAULT_MAX_OVERLAY_NODES,
  DEFAULT_TIERS,
  computeVisibleSet,
  indexLayout,
  sameVisibleSet,
} from '../src/visible-set.js';
import type { ExplorerTiers, ExplorerVisibleSet } from '../src/visible-set.js';
import {
  fire,
  flush,
  installDom,
  mount,
  mouse,
  pendingFrames,
  pointer,
  resizeTo,
  runFramesUntilIdle,
  uninstallDom,
} from './dom.js';
import type { Mounted } from './dom.js';

interface Item extends ExplorerNode {
  readonly kind: string;
}

/** a -> b -> c, boxes 240 by 120, with a and b in one group and b in another. */
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
  groups: [
    { id: 'trust', label: 'Trust boundary', nodeIds: ['a', 'b'] },
    { id: 'data', label: 'Data plane', nodeIds: ['b'] },
  ],
};
const chain = layoutView(chainView);

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

/** `count` nodes 40 by 20 in rows of 25, laid out by hand: the layout engine is not under test. */
function grid(count: number): { view: ExplorerView<Item>; layout: ExplorerLayout } {
  const nodes: Item[] = [];
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (let i = 0; i < count; i += 1) {
    const id = `n${String(i).padStart(3, '0')}`;
    nodes.push({ id, label: id, kind: 'cell' });
    boxes.set(id, { x: 40 + (i % 25) * 60, y: 40 + Math.floor(i / 25) * 40, width: 40, height: 20 });
  }
  const rows = Math.ceil(count / 25);
  return {
    view: { id: 'grid', label: 'Grid', nodes, edges: [] },
    layout: { boxes, routes: new Map(), groups: new Map(), width: 80 + 25 * 60, height: 80 + rows * 40 },
  };
}

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

function surface(props: Props = {}): ReactNode {
  return (
    <ViewportSurface<Item, ExplorerEdge>
      label="Graph"
      view={chainView}
      layout={chain}
      controlsRef={controlsRef}
      {...props}
    />
  );
}

async function ready(props: Props = {}): Promise<void> {
  tree = await mount(surface(props));
  await resizeTo(SIZE.width, SIZE.height);
  await runFramesUntilIdle();
}

function part(name: string): HTMLElement {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${name}`);
  return element;
}

function buttons(): HTMLButtonElement[] {
  return [...(tree?.container.querySelectorAll<HTMLButtonElement>('button[data-dagr-explorer="node"]') ?? [])];
}

function button(id: string): HTMLButtonElement | null {
  return buttons().find((element) => element.dataset['nodeId'] === id) ?? null;
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

function expected(
  layout: ExplorerLayout,
  options: { tiers?: ExplorerTiers; maxOverlayNodes?: number; pinned?: string[] } = {},
): ExplorerVisibleSet {
  return computeVisibleSet(indexLayout(layout), cameraNow(), SIZE, options);
}

/** The screen point at the center of a node's box, under the current camera. */
function screenOf(layout: ExplorerLayout, id: string): { x: number; y: number } {
  const box = layout.boxes.get(id);
  if (box === undefined) throw new Error(`no box ${id}`);
  const camera = cameraNow();
  return {
    x: camera.x + (box.x + box.width / 2) * camera.scale,
    y: camera.y + (box.y + box.height / 2) * camera.scale,
  };
}

/** Every node a mark: no node is 10,000 pixels wide on screen. */
const MARKS_ONLY: ExplorerTiers = { summary: 10_000, rich: 20_000 };

describe('ViewportSurface: shape', () => {
  it('renders the viewport, the plane and the base, with the plane hidden until the first fit', async () => {
    tree = await mount(surface({ className: 'host', style: { border: '1px solid' } }));
    const viewport = part('viewport');
    const plane = part('plane');
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('Graph');
    expect(viewport.getAttribute('tabindex')).toBe('-1');
    expect(viewport.className).toBe('host');
    expect(viewport.style.position).toBe('relative');
    expect(viewport.style.overflow).toBe('hidden');
    expect(viewport.style.height).toBe('var(--dagr-explorer-height, 480px)');
    expect(viewport.style.border).toBe('1px solid');
    expect(viewport.style.touchAction).toBe('');
    expect(plane.parentElement).toBe(viewport);
    expect(plane.style.position).toBe('absolute');
    expect(plane.style.transformOrigin).toBe('0 0');
    expect(plane.style.width).toBe(`${String(chain.width)}px`);
    expect(plane.style.height).toBe(`${String(chain.height)}px`);
    expect(plane.style.visibility).toBe('hidden');
    // Before a size, the base draws everything and the overlay nothing.
    expect(plane.querySelector('svg')?.querySelectorAll('rect[data-node-id]')).toHaveLength(3);
    expect(buttons()).toEqual([]);

    await resizeTo(SIZE.width, SIZE.height);
    expect(plane.style.visibility).toBe('visible');
    expect(plane.style.willChange).toBe('');
    expect(plane.style.transform).not.toContain('translateZ');
  });

  it('puts a viewport-space base beside the plane rather than inside it', async () => {
    const seen: ExplorerBaseProps<ExplorerNode, ExplorerEdge>[] = [];
    const native: ExplorerBase = {
      space: 'viewport',
      Layer: (props) => {
        seen.push(props);
        return <canvas data-testid="native" />;
      },
    };
    await ready({ base: native, selectedId: 'a', dimmed: new Set(['c']) });
    const canvas = tree?.container.querySelector('[data-testid="native"]');
    expect(canvas?.parentElement).toBe(part('viewport'));
    expect(part('plane').querySelector('svg')).toBeNull();
    const last = seen.at(-1);
    expect(last?.layout).toBe(chain);
    expect(last?.emphasis.selectedId).toBe('a');
    expect([...(last?.emphasis.dimmed ?? [])]).toEqual(['c']);
  });

  it('hands the controls out through controlsRef, and takes them back on unmount', async () => {
    await ready();
    expect(controlsRef.current).not.toBeNull();
    await tree?.unmount();
    expect(controlsRef.current).toBeNull();
  });

  it('renders nothing that names a host framework', async () => {
    await ready({ selectedId: 'b' });
    const html = tree?.container.innerHTML ?? '';
    expect(html).not.toMatch(/docusaurus|ifm-|theme-|navbar|tailwind|chakra|mui|bootstrap|data-theme/i);
    // The only class on the tree is the one the host passed, and none was.
    expect(tree?.container.querySelector('[class]')).toBeNull();
  });
});

describe('ViewportSurface: the overlay follows the visible set', () => {
  it('mounts overlay nodes for the visible set only, at the right tier and box', async () => {
    await ready();
    const visible = expected(chain);
    expect(visible.overlay.size).toBeGreaterThan(0);
    expect(buttons().map((b) => b.dataset['nodeId'])).toEqual([...visible.overlay.keys()]);
    for (const [id, tier] of visible.overlay) {
      const element = button(id);
      const box = chain.boxes.get(id);
      expect(element?.dataset['tier']).toBe(tier);
      expect(element?.getAttribute('type')).toBe('button');
      expect(element?.getAttribute('tabindex')).toBe('-1');
      expect(element?.style.position).toBe('absolute');
      expect(element?.style.left).toBe(`${String(box?.x)}px`);
      expect(element?.style.top).toBe(`${String(box?.y)}px`);
      expect(element?.style.width).toBe(`${String(box?.width)}px`);
      expect(element?.style.height).toBe(`${String(box?.height)}px`);
      expect(element?.textContent).toBe(chainView.nodes.find((n) => n.id === id)?.label);
    }
  });

  it('gives a node under the summary gate no button, and leaves it to the base', async () => {
    await ready({ tiers: MARKS_ONLY });
    expect(buttons()).toEqual([]);
    const marks = part('plane').querySelectorAll('svg rect[data-node-id]');
    expect([...marks].map((m) => m.getAttribute('data-node-id'))).toEqual(['a', 'b', 'c']);
  });

  it('mounts the selected node even when it is off screen', async () => {
    await ready();
    const a = chain.boxes.get('a');
    if (a === undefined) throw new Error('no a');
    controls().focusBox(a);
    await runFramesUntilIdle();
    expect(expected(chain).overlay.has('c')).toBe(false);
    expect(button('c')).toBeNull();

    await tree?.rerender(surface({ selectedId: 'c' }));
    const pinnedTier = expected(chain, { pinned: ['c'] }).overlay.get('c');
    expect(pinnedTier).toBeDefined();
    expect(button('c')?.dataset['tier']).toBe(pinnedTier);
    expect(button('c')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('c')?.dataset['selected']).toBe('true');
  });

  it('pins the ids in pinned, and ignores a selectedId the layout does not have', async () => {
    await ready({ tiers: MARKS_ONLY, pinned: ['b'], selectedId: 'nowhere' });
    expect(buttons().map((b) => b.dataset['nodeId'])).toEqual(['b']);
  });

  it('does not re-render for a pan inside the overscan margin', async () => {
    const renderNode = vi.fn((node: Item) => node.label);
    await ready({ renderNode });
    const b = chain.boxes.get('b');
    if (b === undefined) throw new Error('no b');
    controls().focusBox(b);
    await runFramesUntilIdle();
    const before = expected(chain);
    const transform = part('plane').style.transform;
    const calls = renderNode.mock.calls.length;

    await fire(part('viewport'), new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await runFramesUntilIdle();
    // The premise: the camera moved, and the set it gives is the same.
    expect(part('plane').style.transform).not.toBe(transform);
    expect(sameVisibleSet(before, expected(chain))).toBe(true);
    expect(renderNode.mock.calls.length).toBe(calls);
  });

  it('changes data-tier when a zoom crosses a gate', async () => {
    await ready();
    expect(button('b')?.dataset['tier']).toBe('summary');
    controls().zoomBy(2);
    await runFramesUntilIdle();
    expect(expected(chain).overlay.get('b')).toBe('rich');
    expect(button('b')?.dataset['tier']).toBe('rich');
  });

  it('holds the cap with 500 nodes in view, plus pins', async () => {
    const { view, layout } = grid(500);
    tree = await mount(
      <ViewportSurface<Item, ExplorerEdge>
        label="Grid"
        view={view}
        layout={layout}
        tiers={{ summary: 0, rich: 10_000 }}
        maxOverlayNodes={40}
        selectedId="n499"
        pinned={['n000']}
        controlsRef={controlsRef}
      />,
    );
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    // The premise: every node is in view, and would be mounted uncapped.
    const all = computeVisibleSet(indexLayout(layout), cameraNow(), SIZE, {
      tiers: { summary: 0, rich: 10_000 },
      maxOverlayNodes: 1_000,
    });
    expect(all.overlay.size).toBe(500);
    const mounted = buttons().map((b) => b.dataset['nodeId']);
    expect(mounted.length).toBeLessThanOrEqual(40 + 2);
    expect(mounted).toContain('n499');
    expect(mounted).toContain('n000');
  });

  it('falls back to the defaults for tiers and a cap that are not finite and non-negative', async () => {
    await ready({
      tiers: { summary: Number.NaN, rich: -1 },
      maxOverlayNodes: Number.NaN,
    });
    const visible = expected(chain, { tiers: DEFAULT_TIERS, maxOverlayNodes: DEFAULT_MAX_OVERLAY_NODES });
    expect(buttons().map((b) => [b.dataset['nodeId'], b.dataset['tier']])).toEqual([...visible.overlay]);

    for (const maxOverlayNodes of [-5, Number.POSITIVE_INFINITY]) {
      await tree?.rerender(
        surface({ tiers: { summary: Number.POSITIVE_INFINITY, rich: Number.NaN }, maxOverlayNodes }),
      );
      expect(buttons().map((b) => [b.dataset['nodeId'], b.dataset['tier']])).toEqual([...visible.overlay]);
    }
  });

  it('keeps the camera and rebuilds the visible set when the layout is swapped', async () => {
    await ready();
    controls().zoomBy(3);
    await runFramesUntilIdle();
    await tree?.rerender(surface({ view: fanView, layout: fan }));
    expect(part('plane').style.width).toBe(`${String(fan.width)}px`);
    const visible = expected(fan);
    expect(buttons().map((b) => b.dataset['nodeId'])).toEqual([...visible.overlay.keys()]);
    expect([...part('plane').querySelectorAll('svg path[data-edge-id]')].map((p) => p.getAttribute('data-edge-id'))).toEqual(
      visible.edges,
    );
    expect(pendingFrames()).toBe(0);
  });
});

describe('ViewportSurface: a layout swap', () => {
  it('windows the first commit for a new layout from the current camera, rather than drawing every mark', async () => {
    const seen: ExplorerBaseProps<ExplorerNode, ExplorerEdge>[] = [];
    const recording: ExplorerBase = {
      space: 'plane',
      Layer: (props) => {
        seen.push(props);
        return null;
      },
    };
    await ready({ base: recording });
    controls().zoomBy(3);
    await runFramesUntilIdle();

    const big = grid(2000);
    await tree?.rerender(surface({ base: recording, view: big.view, layout: big.layout }));
    const forBig = seen.filter((props) => props.layout === big.layout);
    expect(forBig.length).toBeGreaterThan(0);
    for (const props of forBig) {
      expect(props.visible.overlay.size + props.visible.baseNodes.length).toBeLessThanOrEqual(
        DEFAULT_MAX_OVERLAY_NODES,
      );
    }
    expect(buttons().length).toBeLessThanOrEqual(DEFAULT_MAX_OVERLAY_NODES);
  });

  it('draws every mark before the first fit, and only then', async () => {
    const seen: ExplorerVisibleSet[] = [];
    const recording: ExplorerBase = {
      space: 'plane',
      Layer: (props) => {
        seen.push(props.visible);
        return null;
      },
    };
    const big = grid(2000);
    tree = await mount(surface({ base: recording }));
    await tree.rerender(surface({ base: recording, view: big.view, layout: big.layout }));
    expect(seen.at(-1)?.baseNodes).toHaveLength(2000);
  });
});

describe('ViewportSurface: content and names', () => {
  it('passes tier, selected and dimmed to renderNode', async () => {
    const renderNode = vi.fn(
      (node: Item, context: { tier: string; selected: boolean; dimmed: boolean }) =>
        `${node.kind}:${context.tier}:${String(context.selected)}:${String(context.dimmed)}`,
    );
    await ready({ renderNode, selectedId: 'a', dimmed: new Set(['c']) });
    expect(button('a')?.textContent).toBe('service:summary:true:false');
    expect(button('c')?.textContent).toBe('queue:summary:false:true');
    expect(button('c')?.dataset['dimmed']).toBe('true');
    expect(button('a')?.hasAttribute('data-dimmed')).toBe(false);
    expect(button('b')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('b')?.hasAttribute('data-selected')).toBe(false);
  });

  it('names a node by its label and the groups it is in', async () => {
    await ready();
    expect(button('a')?.getAttribute('aria-label')).toBe('Alpha, in Trust boundary');
    expect(button('b')?.getAttribute('aria-label')).toBe('Beta, in Trust boundary, in Data plane');
    expect(button('c')?.getAttribute('aria-label')).toBe('Gamma');
  });

  it('uses nodeAriaLabel when given, with the groups', async () => {
    const nodeAriaLabel = vi.fn(
      (node: Item, context: { groups: readonly { label: string }[] }) =>
        `${node.kind} ${node.label} (${context.groups.map((g) => g.label).join('/')})`,
    );
    await ready({ nodeAriaLabel });
    expect(button('b')?.getAttribute('aria-label')).toBe('store Beta (Trust boundary/Data plane)');
  });
});

describe('ViewportSurface: activation', () => {
  it('activates a node button with the button as the trigger', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    const b = button('b');
    if (b === null) throw new Error('no b');
    await flush(() => b.click());
    expect(onNodeActivate).toHaveBeenCalledWith('b', b);
  });

  it('activates a mark through the layout, with a null trigger', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate, tiers: MARKS_ONLY });
    const point = screenOf(chain, 'b');
    const mark = part('plane').querySelector('svg rect[data-node-id="b"]');
    if (mark === null) throw new Error('no mark');
    await fire(mark, mouse('click', point.x, point.y));
    expect(onNodeActivate).toHaveBeenCalledTimes(1);
    expect(onNodeActivate).toHaveBeenCalledWith('b', null);
  });

  it('activates nothing on empty space, and focuses the viewport', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    const viewport = part('viewport');
    await fire(viewport, mouse('click', 2, 2));
    expect(onNodeActivate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(viewport);
  });

  it('does not activate a node a drag started on', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    controls().zoomBy(2);
    await runFramesUntilIdle();
    const b = button('b');
    if (b === null) throw new Error('no b');
    await fire(b, pointer('pointerdown', 300, 200));
    await fire(b, pointer('pointermove', 340, 220));
    expect(part('viewport').getAttribute('data-dragging')).toBe('true');
    await fire(b, pointer('pointerup', 340, 220));
    await fire(b, mouse('click', 340, 220));
    expect(onNodeActivate).not.toHaveBeenCalled();
    expect(part('viewport').hasAttribute('data-dragging')).toBe(false);
  });

  it('on touch, the first tap only focuses: its click activates nothing, and the next tap does', async () => {
    const onNodeActivate = vi.fn();
    await ready({ onNodeActivate });
    const b = button('b');
    if (b === null) throw new Error('no b');
    const touch = { pointerType: 'touch' };
    await fire(b, pointer('pointerdown', 300, 200, touch));
    await fire(b, pointer('pointerup', 300, 200, touch));
    await fire(b, mouse('click', 300, 200));
    expect(document.activeElement).toBe(part('viewport'));
    expect(onNodeActivate).not.toHaveBeenCalled();

    await fire(b, pointer('pointerdown', 300, 200, touch));
    await fire(b, pointer('pointerup', 300, 200, touch));
    await fire(b, mouse('click', 300, 200));
    expect(onNodeActivate).toHaveBeenCalledTimes(1);
    expect(onNodeActivate).toHaveBeenCalledWith('b', b);
  });

  it('calls onNodeZoom on a double click on a node or a mark, and not on empty space', async () => {
    const onNodeZoom = vi.fn();
    await ready({ onNodeZoom, tiers: { summary: 0, rich: 10_000 }, maxOverlayNodes: 1 });
    const mounted = buttons();
    expect(mounted).toHaveLength(1);
    const onButton = mounted[0];
    if (onButton === undefined) throw new Error('no button');
    await fire(onButton, mouse('dblclick', 0, 0));
    const markId = ['a', 'b', 'c'].find((id) => id !== onButton.dataset['nodeId']) ?? 'a';
    const point = screenOf(chain, markId);
    await fire(part('plane'), mouse('dblclick', point.x, point.y));
    await fire(part('viewport'), mouse('dblclick', 1, 1));
    expect(onNodeZoom.mock.calls).toEqual([[onButton.dataset['nodeId']], [markId]]);
  });

  it('keeps one activation per click under StrictMode', async () => {
    const onNodeActivate = vi.fn();
    tree = await mount(<StrictMode>{surface({ onNodeActivate })}</StrictMode>);
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    const a = button('a');
    if (a === null) throw new Error('no a');
    await flush(() => a.click());
    expect(onNodeActivate).toHaveBeenCalledTimes(1);
  });
});
