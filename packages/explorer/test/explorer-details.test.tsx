// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerState } from '../src/context.js';
import { ExplorerDetails } from '../src/explorer-details.js';
import type { ExplorerDetailsProps } from '../src/explorer-details.js';
import { ExplorerSearch } from '../src/explorer-search.js';
import { ExplorerToolbar } from '../src/explorer-toolbar.js';
import { ExplorerTraceToggle } from '../src/explorer-trace-toggle.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerEdge, ExplorerView } from '../src/types.js';
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

type RootProps = Partial<ExplorerRootProps<Item, ExplorerEdge>>;

function explorer(props: RootProps = {}, details: ExplorerDetailsProps<Item, ExplorerEdge> = {}): ReactNode {
  const all = { label: 'Map', views: [overview, detail], ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return (
    <ExplorerRoot<Item, ExplorerEdge> {...all}>
      <ExplorerSearch />
      <ExplorerViewport />
      <ExplorerDetails<Item, ExplorerEdge> {...details} />
      <button type="button" data-testid="host">
        host
      </button>
      <Probe />
    </ExplorerRoot>
  );
}

async function ready(props: RootProps = {}, details: ExplorerDetailsProps<Item, ExplorerEdge> = {}): Promise<void> {
  tree = await mount(explorer(props, details));
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

function node(id: string): HTMLButtonElement {
  const element = tree?.container.querySelector<HTMLButtonElement>(`button[data-dagr-explorer="node"][data-node-id="${id}"]`);
  if (element === null || element === undefined) throw new Error(`no node ${id}`);
  return element;
}

function connections(): HTMLButtonElement[] {
  return [...(find('connections')?.querySelectorAll('button') ?? [])];
}

/** What a screen reader hears from an element: its text, less anything `aria-hidden`. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What a sighted reader sees: its text, less the visually hidden direction. */
function shown(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[data-dagr-explorer="connection-direction"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function searchInput(): HTMLInputElement {
  const element = part('search').querySelector('input');
  if (element === null) throw new Error('no input');
  return element;
}

async function escape(target: Element): Promise<void> {
  await fire(target, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

/** Focuses a node's button and clicks it, as a pointer or Enter would. */
async function openFrom(id: string): Promise<HTMLButtonElement> {
  const button = node(id);
  button.focus();
  await flush(() => button.click());
  return button;
}

describe('ExplorerDetails: what it shows', () => {
  it('renders nothing while the drawer is closed', async () => {
    await ready();
    expect(find('details')).toBeNull();
    await flush(() => state().select('b'));
    expect(find('details')).toBeNull();
  });

  it('opens as an overlay with a title, a close button and a focusable scroll body', async () => {
    await ready({}, { className: 'drawer', style: { width: 300 } });
    await flush(() => state().inspect('b'));
    const drawer = part('details');
    expect(drawer.tagName).toBe('ASIDE');
    expect(drawer.className).toBe('drawer');
    expect(drawer.style.position).toBe('absolute');
    expect(drawer.style.width).toBe('300px');
    const title = document.getElementById(drawer.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Details');
    const close = part('details-close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.title).toBe('Close');
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(close.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    const body = part('details-body');
    expect(body.tabIndex).toBe(0);
    expect(body.style.overflow).toBe('auto');
    // A scroll stop is named, from the drawer title.
    expect(body.getAttribute('role')).toBe('region');
    expect(document.getElementById(body.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Details');
    // Opening it never resizes the graph.
    expect(part('viewport').style.height).toBe('var(--dagr-explorer-height, 480px)');
  });

  it('falls back to the same background with no stylesheet as the stylesheet does', async () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8');
    const block = /:where\(\[data-dagr-explorer='details'\]\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const background = /background: ([^;]+);/.exec(block)?.[1];
    expect(background).toBe('var(--dagr-explorer-bg, #ffffff)');
    await ready();
    await flush(() => state().inspect('b'));
    expect(part('details').getAttribute('style')).toContain(`background: ${String(background)}`);
  });

  it('shows the label and the connections in edge order, each the other node with its direction', async () => {
    await ready();
    await flush(() => state().inspect('b'));
    expect(part('details-label').textContent).toBe('Beta');
    expect(connections().map((b) => [b.dataset['nodeId'], shown(b), spoken(b)])).toEqual([
      ['a', '← Alpha', 'from Alpha'],
      ['c', '→ Gamma', 'to Gamma'],
    ]);
  });

  it('names the direction through labels.connectionTo and labels.connectionFrom', async () => {
    await ready({ labels: { connectionTo: (label) => `${label}, downstream`, connectionFrom: (label) => `${label}, upstream` } });
    await flush(() => state().inspect('b'));
    expect(connections().map(spoken)).toEqual(['Alpha, upstream', 'Gamma, downstream']);
  });

  it('draws each connection with renderConnection, given the edge and the other node, with the direction before it', async () => {
    const renderConnection = vi.fn((edge: ExplorerEdge, other: Item) => `${edge.id}:${other.kind}`);
    await ready({}, { renderConnection });
    await flush(() => state().inspect('b'));
    expect(connections().map(shown)).toEqual(['← ab:service', '→ bc:queue']);
    expect(connections().map(spoken)).toEqual(['from Alpha ab:service', 'to Gamma bc:queue']);
  });

  it('follows a connection: inspects the other node and pans it into view at the same zoom', async () => {
    await ready();
    await flush(() => state().inspect('a'));
    await flush(() => state().focusNode('a'));
    await runFramesUntilIdle();
    const before = state().camera.get();
    const b = state().layout?.boxes.get('b');
    if (before === null || b === undefined) throw new Error('no camera');
    expect(before.x + b.x * before.scale).toBeGreaterThan(800);
    const beta = connections()[0];
    if (beta === undefined) throw new Error('no connection');
    await flush(() => beta.click());
    await runFramesUntilIdle();
    expect(state().selectedId).toBe('b');
    expect(state().detailsOpen).toBe(true);
    const after = state().camera.get();
    if (after === null) throw new Error('no camera');
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.x + b.x * after.scale).toBeGreaterThanOrEqual(0);
    expect(after.x + (b.x + b.width) * after.scale).toBeLessThanOrEqual(800);
  });

  it('hands its slot the node, the connections and inspect, and puts the result in the body', async () => {
    const slot = vi.fn(({ node: shown, connections: list }: { node: Item; connections: readonly { edge: ExplorerEdge; node: Item }[] }) => (
      <p data-testid="slot">
        {shown.kind}:{list.map((c) => `${c.edge.id}>${c.node.id}`).join(',')}
      </p>
    ));
    await ready({}, { children: slot });
    await flush(() => state().inspect('c'));
    expect(part('details-body').querySelector('[data-testid="slot"]')?.textContent).toBe('queue:bc>b,cd>d');
    expect(find('details-label')).toBeNull();
    const context = slot.mock.calls.at(-1)?.[0] as unknown as { inspect: (id: string) => void; follow: (id: string) => void };
    await flush(() => context.inspect('d'));
    expect(state().selectedId).toBe('d');
    await flush(() => state().focusNode('d'));
    await runFramesUntilIdle();
    const before = state().camera.get();
    await flush(() => context.follow('a'));
    await runFramesUntilIdle();
    expect(state().selectedId).toBe('a');
    const after = state().camera.get();
    expect(after?.scale).toBe(before?.scale);
    expect(after?.x).not.toBe(before?.x);
  });

  it('keeps a self loop in the connections, with the node itself as the other end', async () => {
    const looped: ExplorerView<Item> = { ...overview, edges: [...overview.edges, { id: 'aa', source: 'a', target: 'a' }] };
    await ready({ views: [looped] });
    await flush(() => state().inspect('a'));
    expect(connections().map((b) => b.dataset['nodeId'])).toEqual(['b', 'a']);
    expect(connections().map(shown)).toEqual(['→ Beta', '↻ Alpha']);
    expect(connections().map(spoken)).toEqual(['to Beta', 'to Alpha']);
    for (const arrow of part('connections').querySelectorAll('[data-dagr-explorer="connection-arrow"]')) {
      expect(arrow.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('scrolls the body to the top when the inspected node changes', async () => {
    await ready();
    await flush(() => state().inspect('b'));
    const body = part('details-body');
    body.scrollTop = 120;
    const gamma = connections()[1];
    if (gamma === undefined) throw new Error('no connection');
    await flush(() => gamma.click());
    expect(state().selectedId).toBe('c');
    expect(part('details-body')).toBe(body);
    expect(body.scrollTop).toBe(0);
  });

  it('announces the inspected node through a live region, and nothing when closed', async () => {
    await ready();
    const live = part('announcer');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
    await flush(() => state().inspect('c'));
    expect(live.textContent).toBe('Gamma');
    await flush(() => state().closeDetails());
    expect(live.textContent).toBe('');
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming the part', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(
      <Boundary onError={onError}>
        <ExplorerDetails />
      </Boundary>,
    );
    expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/^ExplorerDetails /);
    restore();
  });
});

describe('ExplorerDetails: focus and Escape', () => {
  it('closes on Escape in the drawer and returns focus to the opener', async () => {
    await ready();
    const opener = await openFrom('b');
    const close = part('details-close');
    close.focus();
    await escape(close);
    expect(find('details')).toBeNull();
    expect(state().selectedId).toBe('b');
    expect(document.activeElement).toBe(opener);
  });

  it('closes on the close button and returns focus to the opener', async () => {
    await ready();
    const opener = await openFrom('a');
    const close = part('details-close');
    close.focus();
    await flush(() => close.click());
    expect(find('details')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the original opener across connection buttons', async () => {
    await ready();
    const opener = await openFrom('a');
    const beta = connections()[0];
    if (beta === undefined) throw new Error('no connection');
    beta.focus();
    await flush(() => beta.click());
    expect(state().selectedId).toBe('b');
    const gamma = connections()[1];
    if (gamma === undefined) throw new Error('no connection');
    gamma.focus();
    await flush(() => gamma.click());
    expect(state().selectedId).toBe('c');
    const body = part('details-body');
    body.focus();
    await escape(body);
    expect(document.activeElement).toBe(opener);
  });

  it('sends focus to the search field when the opener is gone', async () => {
    await ready();
    await flush(() => state().inspect('b', null));
    part('details-body').focus();
    await escape(part('details-body'));
    expect(document.activeElement).toBe(searchInput());
  });

  it('returns focus to a search result that opened it', async () => {
    await ready();
    await flush(() => state().setQuery('gam'));
    const result = part('search-results').querySelector('button');
    if (result === null) throw new Error('no result');
    result.focus();
    await flush(() => result.click());
    part('details-close').focus();
    await escape(part('details-close'));
    expect(document.activeElement).toBe(result);
  });

  it('inside the graph, closes the drawer on the first Escape keeping focus, and leaves the graph on the second', async () => {
    // Found by the browser check (M5.6f-2): one Escape that both closed the
    // drawer and blurred the node left focus on the page body.
    await ready();
    const opener = await openFrom('b');
    expect(document.activeElement).toBe(opener);
    await escape(opener);
    expect(find('details')).toBeNull();
    expect(state().selectedId).toBe('b');
    expect(document.activeElement).toBe(opener);
    await escape(opener);
    expect(part('viewport').contains(document.activeElement)).toBe(false);

    // The same from the surface itself.
    await flush(() => state().inspect('c'));
    part('viewport').focus();
    await escape(part('viewport'));
    expect(find('details')).toBeNull();
    expect(document.activeElement).toBe(part('viewport'));
    await escape(part('viewport'));
    expect(document.activeElement).toBe(document.body);
  });

  it('inside the graph, leaves an Escape that content in a node handled alone', async () => {
    await ready();
    await flush(() => state().inspect('b'));
    const button = node('b');
    const own = document.createElement('span');
    own.tabIndex = -1;
    own.addEventListener('keydown', (event) => event.preventDefault());
    button.append(own);
    own.focus();
    await escape(own);
    expect(state().detailsOpen).toBe(true);
    own.remove();
  });

  it('does not take focus from the host when closed through the api', async () => {
    await ready();
    await openFrom('b');
    const host = tree?.container.querySelector<HTMLButtonElement>('[data-testid="host"]');
    host?.focus();
    await flush(() => state().closeDetails());
    expect(document.activeElement).toBe(host);
  });

  it('closes, and sends focus on, when the selected node leaves the data', async () => {
    await ready();
    await openFrom('d');
    part('details-body').focus();
    const without = { ...overview, nodes: overview.nodes.slice(0, 3), edges: overview.edges.slice(0, 2) };
    await tree?.rerender(explorer({ views: [without, detail] }));
    expect(find('details')).toBeNull();
    expect(state().selectedId).toBeNull();
    // The opener was d's own button, which left with it.
    expect(document.activeElement).toBe(searchInput());
  });

  it('under a controlled selection, closes and sends focus on when the node leaves, calling back once', async () => {
    const onSelectedChange = vi.fn();
    await ready({ selectedId: 'b', onSelectedChange });
    await flush(() => state().inspect('b'));
    const opener = await openFrom('a');
    // Controlled: the click asked for 'a', and the owner has not moved.
    expect(state().selectedId).toBe('b');
    expect(onSelectedChange.mock.calls).toEqual([['a']]);
    await tree?.rerender(explorer({ selectedId: 'a', onSelectedChange }));
    expect(state().detailsOpen).toBe(true);
    part('details-body').focus();
    const withoutA = { ...overview, nodes: overview.nodes.slice(1), edges: overview.edges.slice(1), groups: [] };
    await tree?.rerender(explorer({ selectedId: 'a', views: [withoutA], onSelectedChange }));
    expect(find('details')).toBeNull();
    expect(onSelectedChange.mock.calls).toEqual([['a'], [null]]);
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement).toBe(searchInput());
  });

  it('sends focus to the root, not the page, when the opener is gone and there is no search field', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]}>
        <ExplorerViewport />
        <ExplorerDetails />
        <Probe />
      </ExplorerRoot>,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const root = part('root');
    expect(root.tabIndex).toBe(-1);
    await flush(() => state().inspect('b', null));
    part('details-body').focus();
    await escape(part('details-body'));
    expect(find('details')).toBeNull();
    expect(document.activeElement).toBe(root);
  });

  it('closes on Escape from a search result, keeping focus there', async () => {
    await ready();
    await flush(() => state().setQuery('gam'));
    const result = part('search-results').querySelector('button');
    if (result === null) throw new Error('no result');
    result.focus();
    await flush(() => result.click());
    expect(state().detailsOpen).toBe(true);
    await escape(result);
    expect(find('details')).toBeNull();
    expect(state().selectedId).toBe('c');
    expect(document.activeElement).toBe(result);
  });

  it('closes on Escape from a toolbar button and from the trace toggle', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]}>
        <ExplorerTraceToggle />
        <ExplorerViewport />
        <ExplorerDetails />
        <ExplorerToolbar />
        <Probe />
      </ExplorerRoot>,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    await flush(() => state().inspect('b'));
    const fit = part('toolbar').querySelector<HTMLButtonElement>('[data-action="fit"]');
    if (fit === null) throw new Error('no fit');
    fit.focus();
    await escape(fit);
    expect(find('details')).toBeNull();
    expect(document.activeElement).toBe(fit);

    await flush(() => state().inspect('c'));
    part('trace').focus();
    await escape(part('trace'));
    expect(find('details')).toBeNull();
    expect(document.activeElement).toBe(part('trace'));
  });

  it('leaves an Escape a host control handled alone', async () => {
    tree = await mount(
      <ExplorerRoot<Item, ExplorerEdge> label="Map" views={[overview]}>
        <ExplorerViewport />
        <ExplorerDetails />
        <input data-testid="own" onKeyDown={(event) => event.preventDefault()} />
        <Probe />
      </ExplorerRoot>,
    );
    await flush(() => state().inspect('b'));
    const own = tree.container.querySelector<HTMLInputElement>('[data-testid="own"]');
    if (own === null) throw new Error('no input');
    own.focus();
    await escape(own);
    expect(state().detailsOpen).toBe(true);
  });

  it('resets on a view switch with the drawer open and a query typed', async () => {
    await ready({ selectOnViewChange: (view) => view.nodes[0]?.id ?? null });
    await flush(() => {
      state().setQuery('a');
      state().setTrace(true);
    });
    await openFrom('b');
    await flush(() => state().selectView('detail'));
    expect(find('details')).toBeNull();
    expect(state().query).toBe('');
    expect(state().trace).toBe(false);
    expect(state().selectedId).toBe('x');
    expect(searchInput().value).toBe('');
  });
});
