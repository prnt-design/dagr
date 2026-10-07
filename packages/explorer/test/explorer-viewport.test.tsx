// @vitest-environment jsdom
import { StrictMode, createRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerBase } from '../src/base.js';
import { createCameraLimits, fitCamera } from '../src/camera.js';
import type { CameraFrame, ExplorerCamera } from '../src/camera.js';
import type { ExplorerApi, ExplorerState } from '../src/context.js';
import { ExplorerDetails } from '../src/explorer-details.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import type { ExplorerViewportProps } from '../src/explorer-viewport.js';
import { layoutView } from '../src/layout.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerEdge } from '../src/types.js';
import { useExplorer } from '../src/use-explorer.js';
import { fire, flush, installDom, mount, mouse, resizeTo, runFrame, runFramesUntilIdle, uninstallDom, watchCount } from './dom.js';
import type { Mounted } from './dom.js';
import { Boundary, detail, empty, overview, quietErrors } from './fixtures.js';
import type { Item } from './fixtures.js';

const SIZE = { width: 800, height: 480 };

let tree: Mounted | null = null;
let seen: ExplorerState<Item, ExplorerEdge> | null = null;
const apiRef = createRef<ExplorerApi>();

beforeEach(() => {
  installDom();
  seen = null;
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

function Probe(): null {
  seen = useExplorer<Item, ExplorerEdge>();
  return null;
}

function state(): ExplorerState<Item, ExplorerEdge> {
  if (seen === null) throw new Error('the probe never rendered');
  return seen;
}

function api(): ExplorerApi {
  if (apiRef.current === null) throw new Error('no api');
  return apiRef.current;
}

type RootProps = Partial<ExplorerRootProps<Item, ExplorerEdge>>;
type ViewportProps = ExplorerViewportProps<Item>;

function explorer(props: RootProps = {}, viewport: ViewportProps = {}, extra: ReactNode = null): ReactNode {
  const all = { label: 'Map', views: [overview, detail], apiRef, ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return (
    <ExplorerRoot<Item, ExplorerEdge> {...all}>
      <ExplorerViewport<Item, ExplorerEdge> {...viewport} />
      {extra}
      <Probe />
    </ExplorerRoot>
  );
}

async function ready(props: RootProps = {}, viewport: ViewportProps = {}): Promise<void> {
  tree = await mount(explorer(props, viewport));
  await resizeTo(SIZE.width, SIZE.height);
  await runFramesUntilIdle();
}

function part(name: string): HTMLElement {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${name}`);
  return element;
}

function button(id: string): HTMLButtonElement | null {
  return tree?.container.querySelector<HTMLButtonElement>(`button[data-dagr-explorer="node"][data-node-id="${id}"]`) ?? null;
}

function cameraNow(): ExplorerCamera {
  const camera = state().camera.get();
  if (camera === null) throw new Error('no camera');
  return camera;
}

/** Ids carrying `data-dimmed`, on node buttons and on base marks alike. */
function dimmedIds(): string[] {
  const elements = tree?.container.querySelectorAll('[data-node-id][data-dimmed="true"]') ?? [];
  return [...new Set([...elements].map((element) => element.getAttribute('data-node-id') ?? ''))].sort();
}

describe('ExplorerViewport: inside a root', () => {
  it('renders the active view, named by the root label and described by the stats and the hint', async () => {
    await ready();
    const viewport = part('viewport');
    expect(viewport.getAttribute('aria-label')).toBe('Map');
    const describedBy = viewport.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy ?? '');
    expect(description?.getAttribute('data-dagr-explorer')).toBe('hint');
    expect(description?.textContent).toContain('4 nodes, 3 edges.');
    expect(description?.textContent).toContain('Search reaches every node');
    expect(description?.textContent).toContain('arrow keys');
    expect(button('a')).not.toBeNull();
  });

  it('builds the description from labels.stats and labels.hint', async () => {
    await ready({ labels: { stats: ({ nodes, edges }) => `${String(nodes)}/${String(edges)}`, hint: 'Find any node.' } });
    const description = document.getElementById(part('viewport').getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('4/3 Find any node.');
  });

  it('inspects a node on click, with the button as the opener, and flies to it on double click', async () => {
    await ready();
    const b = button('b');
    if (b === null) throw new Error('no b');
    await flush(() => b.click());
    expect(state().selectedId).toBe('b');
    expect(state().detailsOpen).toBe(true);
    expect(button('b')?.dataset['selected']).toBe('true');

    const before = cameraNow();
    await fire(b, mouse('dblclick', 0, 0));
    await runFramesUntilIdle();
    expect(cameraNow()).not.toEqual(before);
  });

  it('dims by query, by trace, and by both, on buttons and marks', async () => {
    await ready({}, { tiers: { summary: 0, rich: 10_000 }, maxOverlayNodes: 2 });
    await flush(() => api().setQuery('gamma'));
    expect(dimmedIds()).toEqual(['a', 'b', 'd']);
    await flush(() => {
      api().setQuery('');
      api().select('a');
      api().setTrace(true);
    });
    expect(dimmedIds()).toEqual(['c', 'd']);
    await flush(() => api().setQuery('beta'));
    expect(dimmedIds()).toEqual(['a', 'c', 'd']);
    await flush(() => {
      api().setQuery('');
      api().setTrace(false);
    });
    expect(dimmedIds()).toEqual([]);
  });

  it('forwards renderNode, nodeAriaLabel, tiers, maxOverlayNodes, base, className and style', async () => {
    const renderNode = vi.fn((node: Item, context: { tier: string }) => `${node.kind}/${context.tier}`);
    const nodeAriaLabel = vi.fn((node: Item) => `node ${node.kind}`);
    await ready({}, { renderNode, nodeAriaLabel, tiers: { summary: 0, rich: 10_000 }, maxOverlayNodes: 1, className: 'graph', style: { border: '1px solid' } });
    // The cap of one, and the tab target, pinned outside it.
    const mounted = tree?.container.querySelectorAll('button[data-dagr-explorer="node"]') ?? [];
    expect(mounted).toHaveLength(2);
    expect(mounted[0]?.textContent).toMatch(/^(service|store|queue)\/summary$/);
    expect(mounted[0]?.getAttribute('aria-label')).toMatch(/^node /);
    expect(part('viewport').className).toBe('graph');
    expect(part('viewport').style.border).toBe('1px solid');

    await tree?.unmount();
    const native: ExplorerBase = { space: 'viewport', Layer: () => <canvas data-testid="native" /> };
    await ready({}, { base: native });
    expect(tree?.container.querySelector('[data-testid="native"]')?.parentElement).toBe(part('viewport'));
  });

  it('names a grouped node through labels.inGroup', async () => {
    await ready();
    expect(button('a')?.getAttribute('aria-label')).toBe('Alpha, in Platform team');
    expect(button('c')?.getAttribute('aria-label')).toBe('Gamma');
    await tree?.unmount();
    await ready({ labels: { inGroup: (group) => `within ${group}` } });
    expect(button('a')?.getAttribute('aria-label')).toBe('Alpha, within Platform team');
  });

  it('lets the caller style set the height, on the graph and on the empty state', async () => {
    await ready({}, { style: { height: 600 } });
    expect(part('viewport').style.height).toBe('600px');
    await tree?.unmount();
    await ready({}, {});
    expect(part('viewport').style.height).toBe('var(--dagr-explorer-height, 480px)');
    await tree?.unmount();
    await ready({ views: [empty] }, { style: { height: 600 } });
    expect(part('viewport').style.height).toBe('600px');
  });

  it('keeps the position and overflow the graph needs against a caller override', async () => {
    await ready({}, { style: { height: 600, position: 'static', overflow: 'visible' } });
    expect(part('viewport').style.height).toBe('600px');
    expect(part('viewport').style.position).toBe('relative');
    expect(part('viewport').style.overflow).toBe('hidden');
  });

  it('turns off text selection on the graph, so a press that becomes a pan selects nothing, and leaves the drawer selectable', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]}>
        <ExplorerViewport style={{ userSelect: 'text' }}>
          <ExplorerDetails />
        </ExplorerViewport>
        <Probe />
      </ExplorerRoot>,
    );
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    await flush(() => state().inspect('b'));
    const viewport = part('viewport');
    expect(viewport.style.getPropertyValue('user-select')).toBe('none');
    expect(viewport.style.getPropertyValue('-webkit-user-select')).toBe('none');
    const drawer = part('details');
    expect(viewport.contains(drawer)).toBe(false);
    const root = part('root');
    for (let at: HTMLElement | null = drawer; at !== null && at !== root.parentElement; at = at.parentElement) {
      expect(at.style.getPropertyValue('user-select')).toBe('');
    }
    for (const inner of drawer.querySelectorAll<HTMLElement>('*')) {
      expect(inner.style.getPropertyValue('user-select')).toBe('');
    }
  });

  it('renders its children in a positioned stage with the graph, and the hint after the stage', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]}>
        <ExplorerViewport>
          <aside data-testid="overlay" />
        </ExplorerViewport>
      </ExplorerRoot>,
    );
    const stage = part('stage');
    expect(stage.style.position).toBe('relative');
    expect([...stage.children].map((child) => child.getAttribute('data-dagr-explorer') ?? child.getAttribute('data-testid'))).toEqual([
      'viewport',
      'overlay',
    ]);
    expect(stage.nextElementSibling).toBe(part('hint'));
  });

  it('does not render the graph again for a keystroke that changes neither the dimming nor the selection', async () => {
    const renderNode = vi.fn((node: Item) => node.label);
    await ready({}, { renderNode });
    await flush(() => api().setQuery('alp'));
    expect(dimmedIds()).toEqual(['b', 'c', 'd']);
    renderNode.mockClear();
    await flush(() => api().setQuery('alph'));
    await flush(() => api().setQuery('alpha'));
    expect(state().query).toBe('alpha');
    expect(renderNode).not.toHaveBeenCalled();
    // A keystroke that changes the matches does.
    await flush(() => api().setQuery('a'));
    expect(renderNode).toHaveBeenCalled();
  });

  it('shows labels.emptyView for a view with no nodes, and labels.noViews for no views', async () => {
    await ready({ views: [empty] });
    expect(part('viewport').textContent).toBe('This view has no nodes.');
    expect(part('viewport').getAttribute('aria-label')).toBe('Map');
    await tree?.unmount();
    await ready({ views: [] });
    expect(part('viewport').textContent).toBe('Nothing to show.');
  });
});

describe('ExplorerViewport: the camera through the root', () => {
  it('runs fit, zoomBy, focusNode and reveal from apiRef once it has mounted', async () => {
    await ready();
    const fitted = cameraNow();
    await flush(() => api().zoomBy(2));
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeCloseTo(fitted.scale * 2);
    await flush(() => api().fit());
    await runFramesUntilIdle();
    expect(cameraNow()).toEqual(fitted);

    await flush(() => api().focusNode('d'));
    await runFramesUntilIdle();
    const onD = cameraNow();
    expect(onD.scale).toBeGreaterThan(fitted.scale);
    await flush(() => api().reveal('a'));
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBe(onD.scale);
    expect(cameraNow().x).not.toBe(onD.x);
  });

  it('gives the viewport keyboard focus from focusViewport, keeping a focus already inside it', async () => {
    await ready();
    const viewport = part('viewport');
    expect(document.activeElement).toBe(document.body);
    await flush(() => api().focusViewport());
    expect(document.activeElement).toBe(viewport);
    const b = button('b');
    if (b === null) throw new Error('no b');
    b.focus();
    await flush(() => api().focusViewport());
    expect(document.activeElement).toBe(b);
  });

  it('does nothing from focusViewport before a viewport exists', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]} apiRef={apiRef}>
        <button type="button" data-testid="host">
          host
        </button>
      </ExplorerRoot>,
    );
    const host = tree.container.querySelector<HTMLButtonElement>('[data-testid="host"]');
    host?.focus();
    await flush(() => api().focusViewport());
    expect(document.activeElement).toBe(host);
  });

  it('tells camera subscribers of every frame, and reads the camera through get', async () => {
    await ready();
    const heard: ExplorerCamera[] = [];
    const off = state().camera.subscribe((camera) => heard.push(camera));
    await flush(() => api().zoomBy(0.8));
    const ran = await runFramesUntilIdle();
    expect(heard).toHaveLength(ran);
    expect(heard.at(-1)).toEqual(cameraNow());
    off();
  });

  it('resets the camera to the fit on a view switch', async () => {
    await ready();
    await flush(() => api().zoomBy(3));
    await runFramesUntilIdle();
    await flush(() => api().selectView('detail'));
    // A new view is a new surface, which has no size until it is measured.
    await resizeTo(SIZE.width, SIZE.height);
    await runFramesUntilIdle();
    const layout = layoutView(detail);
    const limits = createCameraLimits(layout, SIZE);
    if (limits === null) throw new Error('no limits');
    expect(cameraNow()).toEqual(limits.constrain(fitCamera(layout, SIZE, limits)));
  });
});

describe('ExplorerViewport: the frame the drawer leaves', () => {
  const placed = layoutView(overview);
  const narrow = { x: 0, y: 0, width: 440, height: SIZE.height };

  /** Puts the drawer at `left` to `right` on screen, full height. jsdom lays nothing out. */
  function drawerAt(left: number, right: number): void {
    const own = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-dagr-explorer') !== 'details') return own.call(this);
      return { left, right, top: 0, bottom: SIZE.height, width: right - left, height: SIZE.height, x: left, y: 0 } as DOMRect;
    });
  }

  function fitIn(frame: CameraFrame, padding?: number): ExplorerCamera {
    const limits = createCameraLimits(placed, frame, padding);
    if (limits === null) throw new Error('no limits');
    return limits.constrain(fitCamera(placed, frame, limits));
  }

  function expectCamera(expected: ExplorerCamera): void {
    const now = cameraNow();
    expect(now.x).toBeCloseTo(expected.x, 4);
    expect(now.y).toBeCloseTo(expected.y, 4);
    expect(now.scale).toBeCloseTo(expected.scale, 6);
  }

  const withDrawer: ViewportProps = { children: <ExplorerDetails /> };

  it('refits to the part the drawer leaves when it opens at fit, and to the whole viewport when it closes', async () => {
    drawerAt(440, 800);
    await ready({ views: [overview] }, withDrawer);
    expectCamera(fitIn(SIZE));
    expect(watchCount()).toBe(1);
    await flush(() => api().inspect('a'));
    await runFramesUntilIdle();
    expectCamera(fitIn(narrow));
    // The drawer is observed with the viewport, so its own resize moves the frame.
    expect(watchCount()).toBe(2);
    await flush(() => api().closeDetails());
    await runFramesUntilIdle();
    expectCamera(fitIn(SIZE));
    expect(watchCount()).toBe(1);
  });

  it('eases to the new fit when the drawer closes, with no jump in the first frame', async () => {
    drawerAt(440, 800);
    await ready({ views: [overview] }, withDrawer);
    await flush(() => api().inspect('a'));
    await runFramesUntilIdle();
    const open = fitIn(narrow);
    const closed = fitIn(SIZE);
    await flush(() => api().closeDetails());
    expectCamera(open);
    await runFrame();
    const first = cameraNow();
    expect(first.scale).toBeGreaterThan(open.scale);
    expect(first.scale).toBeLessThan(closed.scale);
    await runFramesUntilIdle();
    expectCamera(closed);
  });

  it('eases to the new fit when the drawer opens, with no jump in the first frame', async () => {
    drawerAt(440, 800);
    await ready({ views: [overview] }, withDrawer);
    const closed = fitIn(SIZE);
    const open = fitIn(narrow);
    await flush(() => api().inspect('a'));
    expectCamera(closed);
    await runFrame();
    const first = cameraNow();
    expect(first.x).toBeLessThan(closed.x);
    expect(first.x).toBeGreaterThan(open.x);
    expect(first.scale).toBeLessThan(closed.scale);
    expect(first.scale).toBeGreaterThan(open.scale);
  });

  it('takes no inset from a drawer as wide as the viewport', async () => {
    drawerAt(0, 800);
    await ready({ views: [overview] }, withDrawer);
    await flush(() => api().inspect('a'));
    await runFramesUntilIdle();
    expectCamera(fitIn(SIZE));
  });

  it('reveals the node the drawer opens over, at the zoom it had', async () => {
    drawerAt(440, 800);
    await ready({ views: [overview] }, withDrawer);
    await flush(() => api().zoomBy(2));
    await runFramesUntilIdle();
    const before = cameraNow();
    const c = placed.boxes.get('c');
    if (c === undefined) throw new Error('no c');
    expect(before.x + (c.x + c.width) * before.scale).toBeGreaterThan(440);
    await flush(() => api().inspect('c'));
    await runFramesUntilIdle();
    const after = cameraNow();
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.x + (c.x + c.width) * after.scale).toBeLessThanOrEqual(440);
    expect(after.x + c.x * after.scale).toBeGreaterThanOrEqual(0);
  });

  it('insets the frame by the inset prop, with no drawer', async () => {
    await ready({ views: [overview] }, { inset: { right: 360 } });
    expectCamera(fitIn(narrow));
    await tree?.rerender(explorer({ views: [overview] }, { inset: { right: 360 } }));
    await runFramesUntilIdle();
    expectCamera(fitIn(narrow));
    await tree?.rerender(explorer({ views: [overview] }, {}));
    await runFramesUntilIdle();
    expectCamera(fitIn(SIZE));
  });

  it('fits and limits the camera with the contentPadding', async () => {
    await ready({ views: [overview] }, { contentPadding: 0.3 });
    expectCamera(fitIn(SIZE, 0.3));
    await tree?.rerender(explorer({ views: [overview] }, { contentPadding: Number.NaN }));
    await runFramesUntilIdle();
    expectCamera(fitIn(SIZE));
  });
});

describe('ExplorerViewport: one per root', () => {
  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(
      <Boundary onError={onError}>
        <ExplorerViewport />
      </Boundary>,
    );
    expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/^ExplorerViewport /);
    restore();
  });

  it('throws SECOND_VIEWPORT for a second viewport in one root', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(<Boundary onError={onError}>{explorer({}, {}, <ExplorerViewport />)}</Boundary>);
    expect(tree.container.textContent).toBe('SECOND_VIEWPORT');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/second ExplorerViewport/);
    restore();
  });

  it('does not throw for one viewport under StrictMode, or for one remounted', async () => {
    const errors = vi.spyOn(console, 'error');
    tree = await mount(<StrictMode>{explorer()}</StrictMode>);
    await resizeTo(SIZE.width, SIZE.height);
    expect(part('viewport')).toBeTruthy();
    function Toggle({ on }: { on: boolean }): ReactNode {
      return (
        <ExplorerRoot label="Map" views={[overview]}>
          {on ? <ExplorerViewport key="one" /> : <ExplorerViewport key="two" />}
        </ExplorerRoot>
      );
    }
    await tree.rerender(<Toggle on />);
    await tree.rerender(<Toggle on={false} />);
    expect(part('viewport')).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
  });

  it('allows one viewport in each of two roots on one page, with no id shared', async () => {
    tree = await mount(
      <>
        <ExplorerRoot label="Left" views={[overview]}>
          <ExplorerViewport />
        </ExplorerRoot>
        <ExplorerRoot label="Right" views={[overview]}>
          <ExplorerViewport />
        </ExplorerRoot>
      </>,
    );
    const viewports = tree.container.querySelectorAll('[data-dagr-explorer="viewport"]');
    expect(viewports).toHaveLength(2);
    // The SVG base names an arrowhead marker by its color, on purpose and
    // across roots: see svg-base.tsx. Every other id is the parts' own.
    const ids = [...tree.container.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id) => !id.startsWith('dagr-explorer-arrow-'));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
