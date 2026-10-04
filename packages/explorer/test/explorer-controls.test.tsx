// @vitest-environment jsdom
import { Profiler } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerCamera } from '../src/camera.js';
import type { ExplorerState } from '../src/context.js';
import { ExplorerToolbar } from '../src/explorer-toolbar.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import { ExplorerViews } from '../src/explorer-views.js';
import type { ExplorerViewsProps } from '../src/explorer-views.js';
import { ExplorerSearch } from '../src/explorer-search.js';
import { ExplorerTraceToggle } from '../src/explorer-trace-toggle.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerEdge } from '../src/types.js';
import { useExplorer } from '../src/use-explorer.js';
import { flush, installDom, mount, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { Boundary, detail, empty, overview, quietErrors } from './fixtures.js';
import type { Item } from './fixtures.js';

let tree: Mounted | null = null;
let seen: ExplorerState<Item, ExplorerEdge> | null = null;
let renders = 0;

beforeEach(() => {
  installDom();
  seen = null;
  renders = 0;
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

function Probe(): null {
  seen = useExplorer<Item, ExplorerEdge>();
  renders += 1;
  return null;
}

function state(): ExplorerState<Item, ExplorerEdge> {
  if (seen === null) throw new Error('the probe never rendered');
  return seen;
}

type RootProps = Partial<ExplorerRootProps<Item, ExplorerEdge>>;

function explorer(
  props: RootProps = {},
  views: ExplorerViewsProps<Item, ExplorerEdge> = {},
  viewport = true,
): ReactNode {
  const all = { label: 'Map', views: [overview, detail], ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return (
    <ExplorerRoot<Item, ExplorerEdge> {...all}>
      <ExplorerViews<Item, ExplorerEdge> {...views} />
      <ExplorerToolbar className="tools" style={{ gap: 2 }} />
      {viewport ? <ExplorerViewport /> : null}
      <Probe />
    </ExplorerRoot>
  );
}

async function ready(props: RootProps = {}, views: ExplorerViewsProps<Item, ExplorerEdge> = {}): Promise<void> {
  tree = await mount(explorer(props, views));
  await resizeTo(800, 480);
  await runFramesUntilIdle();
}

function find(name: string): HTMLElement | null {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  return element instanceof HTMLElement ? element : null;
}

function part(name: string): HTMLElement {
  const element = find(name);
  if (element === null) throw new Error(`no ${name}`);
  return element;
}

function action(name: string): HTMLButtonElement {
  const element = part('toolbar').querySelector<HTMLButtonElement>(`button[data-action="${name}"]`);
  if (element === null) throw new Error(`no ${name}`);
  return element;
}

function cameraNow(): ExplorerCamera {
  const camera = state().camera.get();
  if (camera === null) throw new Error('no camera');
  return camera;
}

async function outside(element: ReactNode, name: string): Promise<void> {
  const restore = quietErrors();
  const onError = vi.fn();
  tree = await mount(<Boundary onError={onError}>{element}</Boundary>);
  expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
  expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(new RegExp(`^${name} `));
  restore();
}

describe('ExplorerViews', () => {
  it('renders a labeled group of view buttons, the active one pressed, and switches on click', async () => {
    const onViewChange = vi.fn();
    await ready({ onViewChange });
    const group = part('views');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Views');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Overview', 'true'],
      ['Detail', 'false'],
    ]);
    await flush(() => buttons[1]?.click());
    expect(state().activeView?.id).toBe('detail');
    expect(onViewChange.mock.calls).toEqual([['detail']]);
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders nothing for one view, or none, slot or not', async () => {
    const slot = vi.fn(() => <p>custom</p>);
    await ready({ views: [overview] }, { children: slot });
    expect(find('views')).toBeNull();
    expect(slot).not.toHaveBeenCalled();
    await tree?.unmount();
    await ready({ views: [] });
    expect(find('views')).toBeNull();
  });

  it('lets a slot replace the default, given the views, the active view and selectView', async () => {
    const slot = vi.fn(
      ({ views, activeView, selectView }: { views: readonly { id: string }[]; activeView: { id: string }; selectView: (id: string) => void }) => (
        <select aria-label="pick" value={activeView.id} onChange={(event) => selectView(event.currentTarget.value)}>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.id}
            </option>
          ))}
        </select>
      ),
    );
    await ready({ views: [overview, detail, empty] }, { children: slot });
    expect(part('views').querySelector('button')).toBeNull();
    expect(part('views').querySelectorAll('option')).toHaveLength(3);
    const last = slot.mock.calls.at(-1)?.[0] as unknown as { activeView: unknown; selectView: (id: string) => void };
    expect(last.activeView).toBe(overview);
    await flush(() => last.selectView('empty'));
    expect(state().activeView?.id).toBe('empty');
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    await outside(<ExplorerViews />, 'ExplorerViews');
  });
});

describe('ExplorerToolbar', () => {
  it('renders zoom out, the readout, zoom in, fit and zoom to selected, in that order', async () => {
    await ready();
    const toolbar = part('toolbar');
    expect(toolbar.getAttribute('role')).toBe('group');
    expect(toolbar.getAttribute('aria-label')).toBe('Zoom');
    expect(toolbar.className).toBe('tools');
    expect(toolbar.style.gap).toBe('2px');
    expect([...toolbar.children].map((child) => child.getAttribute('data-action') ?? child.getAttribute('data-dagr-explorer'))).toEqual([
      'zoom-out',
      'zoom-level',
      'zoom-in',
      'fit',
      'zoom-to-selected',
    ]);
    expect(action('zoom-out').textContent).toBe('Zoom out');
    expect(action('zoom-in').textContent).toBe('Zoom in');
    expect(action('fit').textContent).toBe('Fit');
    for (const button of toolbar.querySelectorAll('button')) expect(button.getAttribute('type')).toBe('button');
  });

  it('zooms in and out about the center, and fits', async () => {
    await ready();
    const fitted = cameraNow();
    await flush(() => action('zoom-in').click());
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeCloseTo(fitted.scale * 1.25);
    await flush(() => action('zoom-in').click());
    await flush(() => action('zoom-out').click());
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeCloseTo(fitted.scale * 1.25 * 1.25 * 0.8);
    await flush(() => action('fit').click());
    await runFramesUntilIdle();
    expect(cameraNow()).toEqual(fitted);
  });

  it('disables zoom to selected without a selection, and flies to the selected node with one', async () => {
    await ready();
    const button = action('zoom-to-selected');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Zoom to selection');
    await flush(() => state().select('c'));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Zoom to Gamma');
    const before = cameraNow();
    await flush(() => button.click());
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeGreaterThan(before.scale);
  });

  it('shows the zoom as a percent, updated from the camera without rendering the root', async () => {
    await ready();
    const readout = part('zoom-level');
    expect(readout.textContent).toBe(`${String(Math.round(cameraNow().scale * 100))}%`);
    const before = renders;
    await flush(() => state().zoomBy(2));
    await runFramesUntilIdle();
    expect(readout.textContent).toBe(`${String(Math.round(cameraNow().scale * 100))}%`);
    expect(renders).toBe(before);
  });

  it('shows no readout before a viewport, and the first frame once one mounts', async () => {
    tree = await mount(explorer({}, {}, false));
    expect(part('zoom-level').textContent).toBe('');
    await tree.rerender(explorer({}, {}, true));
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    expect(part('zoom-level').textContent).toBe(`${String(Math.round(cameraNow().scale * 100))}%`);
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    await outside(<ExplorerToolbar />, 'ExplorerToolbar');
  });
});

describe('ExplorerRoot: labels by value', () => {
  it('keeps an inline labels object that has not changed, so no part re-renders and the readout keeps its subscription', async () => {
    const views = [overview, detail];
    const onRender = vi.fn();
    // Built once, so a part renders again only if the root's context changes.
    const parts = (
      <Profiler id="parts" onRender={onRender}>
        <ExplorerViews />
        <ExplorerSearch />
        <ExplorerTraceToggle />
        <ExplorerViewport />
        <ExplorerToolbar />
        <Probe />
      </Profiler>
    );
    const at = (labels: { readonly search: string }): ReactNode => (
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={views} labels={labels}>
        {parts}
      </ExplorerRoot>
    );
    tree = await mount(at({ search: 'Find' }));
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const labels = state().labels;
    expect(labels.search).toBe('Find');
    const subscribe = vi.spyOn(state().camera, 'subscribe');
    onRender.mockClear();
    const before = renders;

    await tree.rerender(at({ search: 'Find' }));
    expect(onRender).not.toHaveBeenCalled();
    expect(renders).toBe(before);
    expect(subscribe).not.toHaveBeenCalled();
    expect(state().labels).toBe(labels);

    // A real change still arrives.
    await tree.rerender(at({ search: 'Seek' }));
    expect(state().labels.search).toBe('Seek');
    expect(part('search').querySelector('label')?.textContent).toBe('Seek');
  });
});
