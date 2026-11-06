// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerState } from '../src/context.js';
import { ExplorerDetails } from '../src/explorer-details.js';
import { ExplorerOutline } from '../src/explorer-outline.js';
import type { ExplorerOutlineProps } from '../src/explorer-outline.js';
import { ExplorerSearch } from '../src/explorer-search.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerEdge, ExplorerView } from '../src/types.js';
import { useExplorer } from '../src/use-explorer.js';
import { fire, flush, installDom, mount, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { detail, empty, overview } from './fixtures.js';
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

/** The outline beside the map, the way a host shows both. */
function explorer(
  props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {},
  outline: ExplorerOutlineProps<Item> = {},
): ReactNode {
  const all = { label: 'Map', views: [overview, detail], ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return (
    <ExplorerRoot<Item, ExplorerEdge> {...all}>
      <ExplorerSearch />
      <ExplorerOutline<Item> className="list" style={{ margin: 4 }} {...outline} />
      <ExplorerViewport>
        <ExplorerDetails />
      </ExplorerViewport>
      <Probe />
    </ExplorerRoot>
  );
}

async function ready(
  props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {},
  outline: ExplorerOutlineProps<Item> = {},
): Promise<void> {
  tree = await mount(explorer(props, outline));
  await resizeTo(800, 480);
  await runFramesUntilIdle();
}

function find(name: string): HTMLElement | null {
  const element = tree?.container.querySelector(`[data-dagr-explorer="${name}"]`);
  return element instanceof HTMLElement ? element : null;
}

function items(): HTMLButtonElement[] {
  return [...(find('outline')?.querySelectorAll<HTMLButtonElement>('li > button') ?? [])];
}

function item(id: string): HTMLButtonElement {
  const found = items().find((button) => button.dataset['nodeId'] === id);
  if (found === undefined) throw new Error(`no item ${id}`);
  return found;
}

function ids(): (string | undefined)[] {
  return items().map((button) => button.dataset['nodeId']);
}

function tabStops(): (string | undefined)[] {
  return items()
    .filter((button) => button.tabIndex === 0)
    .map((button) => button.dataset['nodeId']);
}

async function key(target: Element, name: string, init: KeyboardEventInit = {}): Promise<boolean> {
  return fire(target, new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

async function type(value: string): Promise<void> {
  const field = find('search')?.querySelector('input');
  if (field === null || field === undefined) throw new Error('no input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await flush(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ExplorerOutline', () => {
  it("lists the active view's nodes in data order, named, with the class and the style", async () => {
    await ready();
    const list = find('outline');
    expect(list?.tagName).toBe('UL');
    expect(list?.getAttribute('aria-label')).toBe('Nodes');
    expect(list?.className).toBe('list');
    expect(list?.style.margin).toBe('4px');
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(items().map((button) => button.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('inspects a chosen node in the shared state the map and the drawer read', async () => {
    await ready();
    await flush(() => item('c').click());
    expect(state().selectedId).toBe('c');
    expect(state().detailsOpen).toBe(true);
    expect(find('details-label')?.textContent).toBe('Gamma');
    expect(item('c').getAttribute('aria-current')).toBe('true');
    expect(item('c').dataset['selected']).toBe('true');
    expect(items().filter((button) => button.getAttribute('aria-current') !== null)).toHaveLength(1);
  });

  it('follows a selection made elsewhere, and makes it the tab stop', async () => {
    await ready();
    expect(tabStops()).toEqual(['a']);
    await type('delta');
    const result = find('search-results')?.querySelector('button');
    await flush(() => result?.click());
    expect(item('d').getAttribute('aria-current')).toBe('true');
    expect(tabStops()).toEqual(['d']);
    await flush(() => state().select('b'));
    expect(tabStops()).toEqual(['b']);
    expect(state().detailsOpen).toBe(true);
  });

  it('returns focus to its item when the drawer closes', async () => {
    await ready();
    item('b').focus();
    await flush(() => item('b').click());
    const close = find('details-close');
    close?.focus();
    await flush(() => close?.click());
    expect(state().detailsOpen).toBe(false);
    expect(document.activeElement).toBe(item('b'));
  });

  it('closes the drawer on Escape and keeps focus on the item', async () => {
    await ready();
    item('a').focus();
    await flush(() => item('a').click());
    await key(item('a'), 'Escape');
    expect(state().detailsOpen).toBe(false);
    expect(document.activeElement).toBe(item('a'));
  });

  it('marks what the query and trace dim, keeping every item in place', async () => {
    await ready();
    await type('ta');
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(items().map((button) => button.dataset['dimmed'])).toEqual(['true', undefined, 'true', undefined]);
    await type('');
    await flush(() => {
      state().select('a');
      state().setTrace(true);
    });
    expect(items().map((button) => button.dataset['dimmed'])).toEqual([undefined, undefined, 'true', 'true']);
  });

  it('moves focus with the arrow keys, Home and End, and remembers the last focused item', async () => {
    await ready();
    item('a').focus();
    expect(await key(item('a'), 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(item('b'));
    await key(item('b'), 'End');
    expect(document.activeElement).toBe(item('d'));
    await key(item('d'), 'ArrowDown');
    expect(document.activeElement).toBe(item('d'));
    await key(item('d'), 'Home');
    expect(document.activeElement).toBe(item('a'));
    await key(item('a'), 'ArrowUp');
    expect(document.activeElement).toBe(item('a'));
    await key(item('a'), 'ArrowDown');
    expect(tabStops()).toEqual(['b']);
    expect(await key(item('b'), 'ArrowRight')).toBe(true);
    expect(await key(item('b'), 'ArrowDown', { shiftKey: true })).toBe(true);
  });

  it('falls back to the last focused item when the selection clears', async () => {
    await ready();
    await flush(() => state().select('b'));
    item('b').focus();
    await key(item('b'), 'ArrowDown');
    expect(tabStops()).toEqual(['b']);
    find('search')?.querySelector('input')?.focus();
    await flush(() => state().select(null));
    expect(tabStops()).toEqual(['c']);
  });

  it('pans a map beside it to bring the chosen node into view', async () => {
    await ready();
    await flush(() => state().zoomBy(4));
    await runFramesUntilIdle();
    const before = state().camera.get();
    await flush(() => item('d').click());
    await runFramesUntilIdle();
    const after = state().camera.get();
    expect(after?.scale).toBe(before?.scale);
    expect(after).not.toEqual(before);
  });

  it('does not pan for a controlled selection the owner rejects', async () => {
    await ready({ selectedId: null, onSelectedChange: vi.fn() });
    await flush(() => state().zoomBy(4));
    await runFramesUntilIdle();
    const before = state().camera.get();
    await flush(() => item('d').click());
    await runFramesUntilIdle();
    expect(state().camera.get()).toEqual(before);
  });

  it('under a controlled selection, reports a choice and shows only the owner\'s value', async () => {
    const onSelectedChange = vi.fn();
    await ready({ selectedId: null, onSelectedChange });
    await flush(() => item('c').click());
    expect(onSelectedChange).toHaveBeenCalledWith('c');
    expect(items().some((button) => button.getAttribute('aria-current') !== null)).toBe(false);
    await tree?.rerender(explorer({ selectedId: 'c', onSelectedChange }));
    expect(item('c').getAttribute('aria-current')).toBe('true');
    expect(state().detailsOpen).toBe(true);
  });

  it('lists each node once in a cycle with a self loop', async () => {
    const loop: ExplorerView<Item> = {
      id: 'loop',
      label: 'Loop',
      nodes: [
        { id: 'p', label: 'Pi', kind: 'service' },
        { id: 'q', label: 'Rho', kind: 'store' },
      ],
      edges: [
        { id: 'pq', source: 'p', target: 'q' },
        { id: 'qp', source: 'q', target: 'p' },
        { id: 'pp', source: 'p', target: 'p' },
      ],
    };
    await ready({ views: [loop] });
    expect(ids()).toEqual(['p', 'q']);
    await flush(() => item('p').click());
    expect(find('connections')?.querySelectorAll('button')).toHaveLength(3);
  });

  it('drops a node that leaves the data, and the selection with it', async () => {
    await ready();
    await flush(() => item('d').click());
    const shrunk: ExplorerView<Item> = {
      ...overview,
      nodes: overview.nodes.filter((node) => node.id !== 'd'),
      edges: overview.edges.filter((edge) => edge.target !== 'd'),
    };
    await tree?.rerender(explorer({ views: [shrunk, detail] }));
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(state().selectedId).toBeNull();
    expect(state().detailsOpen).toBe(false);
    expect(tabStops()).toEqual(['a']);
  });

  it('lists the new view after a switch', async () => {
    await ready();
    await flush(() => state().selectView('detail'));
    expect(ids()).toEqual(['x', 'y']);
  });

  it('says so in place of a list for an empty view, and for no views', async () => {
    await ready({ views: [empty] });
    expect(find('outline')?.tagName).toBe('P');
    expect(find('outline')?.dataset['empty']).toBe('true');
    expect(find('outline')?.textContent).toBe('This view has no nodes.');
    await tree?.rerender(explorer({ views: [] }));
    expect(find('outline')?.textContent).toBe('Nothing to show.');
  });

  it('takes its name from labels', async () => {
    await ready({ labels: { outline: 'Concepts' } });
    expect(find('outline')?.getAttribute('aria-label')).toBe('Concepts');
  });

  it('names each item as the map names its node, with its groups', async () => {
    await ready();
    expect(items().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Alpha, in Platform team',
      'Beta, in Platform team',
      'Gamma',
      'Delta',
    ]);
    const map = tree?.container.querySelector('[data-dagr-explorer="node"][data-node-id="a"]');
    expect(map?.getAttribute('aria-label')).toBe(item('a').getAttribute('aria-label'));
  });

  it('names groups through labels.inGroup', async () => {
    await ready({ labels: { inGroup: (group) => `part of ${group}` } });
    expect(item('b').getAttribute('aria-label')).toBe('Beta, part of Platform team');
  });

  it('names each item with nodeAriaLabel, given its groups', async () => {
    await ready(
      {},
      { nodeAriaLabel: (node, { groups }) => [`${node.kind} ${node.label}`, ...groups.map((group) => group.label)].join(', ') },
    );
    expect(items().map((button) => button.getAttribute('aria-label'))).toEqual([
      'service Alpha, Platform team',
      'store Beta, Platform team',
      'queue Gamma',
      'store Delta',
    ]);
  });
});
