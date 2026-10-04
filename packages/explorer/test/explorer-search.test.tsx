// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerCamera } from '../src/camera.js';
import type { ExplorerState } from '../src/context.js';
import { ExplorerSearch } from '../src/explorer-search.js';
import { ExplorerTraceToggle } from '../src/explorer-trace-toggle.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerEdge } from '../src/types.js';
import { useExplorer } from '../src/use-explorer.js';
import { fire, flush, installDom, mount, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { Boundary, detail, overview, quietErrors } from './fixtures.js';
import type { Item } from './fixtures.js';

let tree: Mounted | null = null;
let seen: ExplorerState<Item, ExplorerEdge> | null = null;

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

function explorer(props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {}): ReactNode {
  const all = { label: 'Map', views: [overview, detail], ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return (
    <ExplorerRoot<Item, ExplorerEdge> {...all}>
      <ExplorerSearch className="find" style={{ margin: 4 }} />
      <ExplorerTraceToggle />
      <ExplorerViewport />
      <Probe />
    </ExplorerRoot>
  );
}

async function ready(props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {}): Promise<void> {
  tree = await mount(explorer(props));
  await resizeTo(800, 480);
  await runFramesUntilIdle();
}

function part(name: string): HTMLElement {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${name}`);
  return element;
}

function input(): HTMLInputElement {
  const element = part('search').querySelector('input');
  if (element === null) throw new Error('no input');
  return element;
}

/** Types into a React-controlled input the way a browser does. */
async function type(value: string): Promise<void> {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await flush(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(target: Element, name: string): Promise<boolean> {
  return fire(target, new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

function results(): HTMLButtonElement[] {
  return [...part('search').querySelectorAll<HTMLButtonElement>('[data-dagr-explorer="search-results"] button')];
}

function count(): string {
  return part('search-count').textContent ?? '';
}

function cameraNow(): ExplorerCamera {
  const camera = state().camera.get();
  if (camera === null) throw new Error('no camera');
  return camera;
}

describe('ExplorerSearch', () => {
  it('renders a labeled field with the placeholder, the class and the style', async () => {
    await ready();
    const field = input();
    const label = part('search').querySelector('label');
    expect(label?.textContent).toBe('Search nodes');
    expect(label?.htmlFor).toBe(field.id);
    expect(field.placeholder).toBe('Name or id');
    expect(part('search').getAttribute('role')).toBe('search');
    expect(part('search').className).toBe('find');
    expect(part('search').style.margin).toBe('4px');
    expect(count()).toBe('');
    expect(part('search-count').getAttribute('aria-live')).toBe('polite');
    expect(results()).toEqual([]);
  });

  it('matches every token, case ignored, and counts the matches live', async () => {
    await ready();
    await type('ALP');
    expect(state().query).toBe('ALP');
    expect(results().map((b) => b.textContent)).toEqual(['Alpha']);
    expect(count()).toBe('1 match');
    await type('a  ');
    expect(results().map((b) => b.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(count()).toBe('4 matches');
    await type('a ta');
    expect(results().map((b) => b.textContent)).toEqual(['Beta', 'Delta']);
    await type('zzz');
    expect(count()).toBe('No matches');
    expect(results()).toEqual([]);
    await type('   ');
    expect(count()).toBe('');
  });

  it('searches through searchText', async () => {
    await ready({ searchText: (node) => node.kind });
    await type('store');
    expect(results().map((b) => b.dataset['nodeId'])).toEqual(['b', 'd']);
  });

  it('inspects the first match on Enter and flies the camera to it, with the field as the opener', async () => {
    await ready();
    const before = cameraNow();
    await type('ta');
    input().focus();
    expect(await key(input(), 'Enter')).toBe(false);
    expect(state().selectedId).toBe('b');
    expect(state().detailsOpen).toBe(true);
    await runFramesUntilIdle();
    expect(cameraNow().scale).toBeGreaterThan(before.scale);
    // The list stays mounted while the node is inspected.
    expect(results().map((b) => b.dataset['nodeId'])).toEqual(['b', 'd']);
  });

  it('does nothing on Enter with no match', async () => {
    await ready();
    await type('zzz');
    await key(input(), 'Enter');
    expect(state().selectedId).toBeNull();
  });

  it('chooses a result as Enter would, and keeps the list and its scroll', async () => {
    await ready();
    await type('ta');
    const list = part('search-results');
    list.scrollTop = 40;
    const delta = results()[1];
    if (delta === undefined) throw new Error('no result');
    const before = cameraNow();
    await flush(() => delta.click());
    expect(state().selectedId).toBe('d');
    expect(state().detailsOpen).toBe(true);
    await runFramesUntilIdle();
    expect(cameraNow()).not.toEqual(before);
    expect(part('search-results')).toBe(list);
    expect(list.scrollTop).toBe(40);
    expect(results()[1]?.dataset['selected']).toBe('true');
  });

  it('clears the query on Escape', async () => {
    await ready();
    await type('alp');
    expect(await key(input(), 'Escape')).toBe(false);
    expect(state().query).toBe('');
    expect(input().value).toBe('');
  });

  it('with the drawer open, closes it on the first Escape and clears the query on the second', async () => {
    await ready();
    await type('alp');
    input().focus();
    await key(input(), 'Enter');
    expect(state().detailsOpen).toBe(true);
    await key(input(), 'Escape');
    expect(state().detailsOpen).toBe(false);
    expect(state().query).toBe('alp');
    expect(document.activeElement).toBe(input());
    await key(input(), 'Escape');
    expect(state().query).toBe('');
    expect(document.activeElement).toBe(input());
  });

  it('follows a query set through the api, and is cleared by a view switch', async () => {
    await ready();
    await flush(() => state().setQuery('gam'));
    expect(input().value).toBe('gam');
    await flush(() => state().selectView('detail'));
    expect(input().value).toBe('');
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(
      <Boundary onError={onError}>
        <ExplorerSearch />
      </Boundary>,
    );
    expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/^ExplorerSearch /);
    restore();
  });
});

describe('ExplorerTraceToggle', () => {
  it('turns trace on and off, labeled for what a press does', async () => {
    await ready();
    const toggle = part('trace');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.textContent).toBe('Trace connections');
    expect(toggle.hasAttribute('data-active')).toBe(false);
    await flush(() => toggle.click());
    expect(state().trace).toBe(true);
    expect(toggle.textContent).toBe('Stop tracing');
    expect(toggle.dataset['active']).toBe('true');
    await flush(() => toggle.click());
    expect(state().trace).toBe(false);
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(
      <Boundary onError={onError}>
        <ExplorerTraceToggle />
      </Boundary>,
    );
    expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/^ExplorerTraceToggle /);
    restore();
  });
});
