// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerBase } from '../src/base.js';
import { createCameraLimits } from '../src/camera.js';
import type { ExplorerApi } from '../src/context.js';
import { DagrExplorer } from '../src/dagr-explorer.js';
import type { DagrExplorerProps } from '../src/dagr-explorer.js';
import { DEFAULT_EXPLORER_LABELS } from '../src/labels.js';
import type { ExplorerLabels } from '../src/labels.js';
import { layoutView } from '../src/layout.js';
import type { ExplorerEdge, ExplorerNode } from '../src/types.js';
import { flush, installDom, mount, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { detail, empty, overview } from './fixtures.js';
import type { Item } from './fixtures.js';

let tree: Mounted | null = null;
const apiRef = createRef<ExplorerApi>();

beforeEach(() => {
  installDom();
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

function api(): ExplorerApi {
  if (apiRef.current === null) throw new Error('no api');
  return apiRef.current;
}

function find(name: string, within: ParentNode | undefined = tree?.container): HTMLElement | null {
  const element = within?.querySelector(`[data-dagr-explorer="${name}"]`);
  return element instanceof HTMLElement ? element : null;
}

function part(name: string): HTMLElement {
  const element = find(name);
  if (element === null) throw new Error(`no ${name}`);
  return element;
}

function mode(name: 'map' | 'outline'): HTMLButtonElement {
  const button = part('mode').querySelector(`[data-mode="${name}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no ${name} button`);
  return button;
}

const PARTS = ['views', 'mode', 'search', 'trace', 'viewport', 'details', 'toolbar'];

describe('DagrExplorer', () => {
  it('composes every part, in order: views, mode, search, trace, viewport, details, toolbar', async () => {
    tree = await mount(<DagrExplorer label="Map" views={[overview, detail]} apiRef={apiRef} className="host" />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    await flush(() => api().inspect('b'));
    const root = part('root');
    expect(root.className).toBe('host');
    const order = [...root.querySelectorAll('[data-dagr-explorer]')]
      .map((element) => element.getAttribute('data-dagr-explorer') ?? '')
      .filter((name) => PARTS.includes(name));
    expect(order).toEqual(PARTS);
    // The drawer overlays the graph, not the whole explorer.
    expect(part('details').parentElement).toBe(part('viewport').parentElement);
    expect(part('details').parentElement?.style.position).toBe('relative');
  });

  it('keeps the hint outside the stage the drawer covers', async () => {
    tree = await mount(<DagrExplorer label="Map" views={[overview]} apiRef={apiRef} />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    await flush(() => api().inspect('b'));
    const stage = part('details').parentElement;
    expect(stage?.style.position).toBe('relative');
    expect(stage?.contains(part('viewport'))).toBe(true);
    expect(stage?.contains(part('hint'))).toBe(false);
    expect(part('viewport').getAttribute('aria-describedby')).toBe(part('hint').id);
  });

  it('forwards renderNode, renderDetails, renderConnection and renderViews', async () => {
    const renderNode = vi.fn((node: Item) => `node:${node.kind}`);
    const renderDetails = vi.fn(({ node }: { node: Item }) => <p data-testid="details">details:{node.kind}</p>);
    const renderViews = vi.fn(({ views }: { views: readonly { id: string }[] }) => <p data-testid="views">{views.length}</p>);
    tree = await mount(
      <DagrExplorer
        label="Map"
        views={[overview, detail]}
        apiRef={apiRef}
        renderNode={renderNode}
        renderDetails={renderDetails}
        renderViews={renderViews}
      />,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    expect(part('viewport').querySelector('[data-node-id="a"]')?.textContent).toBe('node:service');
    expect(part('views').textContent).toBe('2');
    await flush(() => api().inspect('c'));
    expect(part('details').querySelector('[data-testid="details"]')?.textContent).toBe('details:queue');
    await tree.unmount();

    const renderConnection = vi.fn((edge: ExplorerEdge, other: Item) => `${edge.id}>${other.kind}`);
    tree = await mount(<DagrExplorer label="Map" views={[overview]} apiRef={apiRef} renderConnection={renderConnection} />);
    await flush(() => api().inspect('c'));
    expect([...(find('connections')?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'bc>store',
      'cd>store',
    ]);
  });

  it('forwards tiers, maxOverlayNodes, base and nodeAriaLabel', async () => {
    const layers: unknown[] = [];
    const base: ExplorerBase = {
      space: 'viewport',
      Layer: (props) => {
        layers.push(props);
        return null;
      },
    };
    tree = await mount(
      <DagrExplorer
        label="Map"
        views={[overview]}
        tiers={{ summary: 0, rich: 10_000 }}
        maxOverlayNodes={2}
        base={base}
        nodeAriaLabel={(node) => `kind ${node.kind}`}
      />,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    // The cap of two, and the tab target, pinned outside it.
    const nodes = part('viewport').querySelectorAll('button[data-dagr-explorer="node"]');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]?.getAttribute('aria-label')).toMatch(/^kind /);
    expect(nodes[0]?.getAttribute('data-tier')).toBe('summary');
    expect(layers.length).toBeGreaterThan(0);
  });

  it('forwards nodeAriaLabel to the outline', async () => {
    tree = await mount(
      <DagrExplorer label="Map" views={[overview]} defaultMode="outline" nodeAriaLabel={(node) => `kind ${node.kind}`} />,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const names = [...part('outline').querySelectorAll('li > button')].map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['kind service', 'kind store', 'kind queue', 'kind store']);
  });

  it('forwards inset and contentPadding', async () => {
    tree = await mount(<DagrExplorer label="Map" views={[overview]} inset={{ right: 360 }} contentPadding={0.3} />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const limits = createCameraLimits(layoutView(overview), { x: 0, y: 0, width: 440, height: 480 }, 0.3);
    const scale = /scale\(([^)]+)\)/.exec(part('plane').style.transform)?.[1];
    expect(Number(scale)).toBeCloseTo(limits?.minScale ?? Number.NaN, 6);
  });

  it('takes the shorthand, and the root props', async () => {
    const onSelectedChange = vi.fn();
    tree = await mount(
      <DagrExplorer
        label="Shorthand"
        nodes={overview.nodes}
        edges={overview.edges}
        apiRef={apiRef}
        onSelectedChange={onSelectedChange}
        style={{ color: 'red' }}
      />,
    );
    expect(find('views')).toBeNull();
    expect(part('root').style.color).toBe('red');
    await flush(() => api().select('a'));
    expect(onSelectedChange.mock.calls).toEqual([['a']]);
  });

  it('types its slots from views: each receives the caller node type', () => {
    const typed = (
      <DagrExplorer
        label="Typed"
        views={[overview]}
        renderNode={(node) => node.kind}
        renderDetails={({ node, connections }) => `${node.kind}${String(connections[0]?.node.kind)}`}
        renderConnection={(edge, other) => `${edge.id}${other.kind}`}
        renderViews={({ activeView }) => activeView.nodes[0]?.kind}
        nodeAriaLabel={(node) => node.kind}
        selectOnViewChange={(view) => view.nodes[0]?.kind ?? null}
        searchText={(node) => node.kind}
      />
    );
    const literal = (
      <DagrExplorer
        label="Literal"
        views={[{ id: 'v', label: 'V', nodes: [{ id: 'n', label: 'N', weight: 3 }], edges: [] }]}
        renderNode={(node) => node.weight.toFixed(0)}
      />
    );
    const shorthand = (
      <DagrExplorer label="Short" nodes={[{ id: 'n', label: 'N', weight: 3 }]} edges={[]} renderNode={(node) => node.weight} />
    );
    const wrong = (
      // @ts-expect-error: `missing` is not a field of the caller's node type.
      <DagrExplorer label="Wrong" views={[overview]} renderNode={(node) => node.missing} />
    );
    const both = (
      // @ts-expect-error: `views` and the shorthand are exclusive.
      <DagrExplorer label="Both" views={[overview]} nodes={overview.nodes} edges={overview.edges} />
    );
    const children = (
      // @ts-expect-error: DagrExplorer is preassembled and takes no children.
      <DagrExplorer label="Kids" views={[overview]}>text</DagrExplorer>
    );
    // An unannotated view types slots with the base node only.
    const base = (
      <DagrExplorer
        label="Base"
        views={[{ id: 'v', label: 'V', nodes: [] as ExplorerNode[], edges: [] }]}
        // @ts-expect-error: the base node has no `kind`.
        renderNode={(node) => node.kind}
      />
    );
    expect([typed, literal, shorthand, wrong, both, children, base]).toHaveLength(7);
  });

  it('keeps two on one page independent, with no id shared', async () => {
    const left = createRef<ExplorerApi>();
    tree = await mount(
      <>
        <DagrExplorer label="Left" views={[overview]} apiRef={left} />
        <DagrExplorer label="Right" views={[overview]} />
      </>,
    );
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    await flush(() => {
      left.current?.inspect('a');
      left.current?.setQuery('alp');
    });
    const roots = [...(tree.container.querySelectorAll('[data-dagr-explorer="root"]') ?? [])];
    expect(roots).toHaveLength(2);
    expect(find('details', roots[0])).not.toBeNull();
    expect(find('details', roots[1])).toBeNull();
    expect(find('search', roots[1])?.querySelector('input')?.value).toBe('');
    // The SVG base names an arrowhead by color, on purpose and across roots:
    // see svg-base.tsx. Every other id is the parts' own.
    const ids = [...tree.container.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id) => !id.startsWith('dagr-explorer-arrow-'));
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders nothing that names a host framework, and no class of its own', async () => {
    tree = await mount(<DagrExplorer label="Map" views={[overview, detail]} apiRef={apiRef} />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    await flush(() => {
      api().setQuery('a');
      api().setTrace(true);
      api().inspect('b');
    });
    const html = tree.container.innerHTML;
    expect(html).not.toMatch(/docusaurus|ifm-|theme-|navbar|tailwind|chakra|mui|bootstrap|data-theme/i);
    expect(tree.container.querySelector('[class]')).toBeNull();
  });
});

describe('DagrExplorer: labels', () => {
  /** Every label a sentinel, so any default text left on screen is a hardcoded string. */
  const sentinels: ExplorerLabels = {
    search: '«search»',
    searchPlaceholder: '«searchPlaceholder»',
    searchResults: '«searchResults»',
    matches: (count) => `«matches ${String(count)}»`,
    moreMatches: (count) => `«moreMatches ${String(count)}»`,
    stats: ({ nodes, edges }) => `«stats ${String(nodes)} ${String(edges)}»`,
    hint: '«hint»',
    views: '«views»',
    outline: '«outline»',
    presentation: '«presentation»',
    mapMode: '«mapMode»',
    outlineMode: '«outlineMode»',
    inGroup: (label) => `«inGroup ${label}»`,
    traceOn: '«traceOn»',
    traceOff: '«traceOff»',
    zoomControls: '«zoomControls»',
    zoomIn: '«zoomIn»',
    zoomOut: '«zoomOut»',
    zoomLevel: (percent) => `«zoomLevel ${String(percent)}»`,
    fit: '«fit»',
    zoomTo: (label) => `«zoomTo ${label}»`,
    zoomToSelected: '«zoomToSelected»',
    emptyView: '«emptyView»',
    noViews: '«noViews»',
    drawerTitle: '«drawerTitle»',
    close: '«close»',
    connections: '«connections»',
    connectionTo: (label) => `«connectionTo ${label}»`,
    connectionFrom: (label) => `«connectionFrom ${label}»`,
  };

  /** Every default string, and every default formatter's output for the values these tests reach. */
  const defaults: string[] = [
    ...Object.values(DEFAULT_EXPLORER_LABELS).filter((value): value is string => typeof value === 'string'),
    ...[0, 1, 2, 3, 4].map((count) => DEFAULT_EXPLORER_LABELS.matches(count)),
    DEFAULT_EXPLORER_LABELS.stats({ nodes: 4, edges: 3 }),
    ...['Alpha', 'Beta', 'Gamma', 'Delta'].map((label) => DEFAULT_EXPLORER_LABELS.zoomTo(label)),
    ...['Alpha', 'Beta', 'Gamma', 'Delta'].flatMap((label) => [
      DEFAULT_EXPLORER_LABELS.connectionTo(label),
      DEFAULT_EXPLORER_LABELS.connectionFrom(label),
    ]),
    // `overview` has a group, so its members' accessible names reach this.
    DEFAULT_EXPLORER_LABELS.inGroup('Platform team'),
    // Hardcoded before `inGroup` existed: any copy left from it is a leak.
    'in Platform team',
  ];

  /** Every text node and every attribute a person can hear or read. */
  function copy(root: ParentNode): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      if (text !== '') out.push(text);
    }
    for (const element of root.querySelectorAll('*')) {
      for (const name of ['aria-label', 'placeholder', 'title', 'alt', 'aria-roledescription', 'aria-valuetext']) {
        const value = element.getAttribute(name);
        if (value !== null && value !== '') out.push(value);
      }
    }
    return out;
  }

  /** Copy with a default in it, once the sentinels (which may contain one, as «noViews» does) are taken out. */
  function leftovers(root: ParentNode): string[] {
    return copy(root)
      .map((text) => text.replace(/«[^»]*»/g, ''))
      .filter((text) => defaults.some((value) => text.includes(value)) || /\d+%/.test(text));
  }

  it('replaces every default string in every state the parts reach', async () => {
    // Not "Map", which is a default label now.
    tree = await mount(<DagrExplorer label="Atlas" views={[overview, detail]} apiRef={apiRef} labels={sentinels} />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const states: string[][] = [copy(tree.container)];
    expect(leftovers(tree.container)).toEqual([]);

    await flush(() => api().setQuery('a'));
    states.push(copy(tree.container));
    expect(leftovers(tree.container)).toEqual([]);
    await flush(() => {
      api().setTrace(true);
      api().inspect('b');
    });
    states.push(copy(tree.container));
    expect(leftovers(tree.container)).toEqual([]);
    await flush(() => mode('outline').click());
    states.push(copy(tree.container));
    expect(leftovers(tree.container)).toEqual([]);

    // The premise: the sentinels did reach the screen, each one somewhere.
    const all = states.flat().join('\n');
    for (const name of [
      'search', 'searchPlaceholder', 'searchResults', 'matches 4', 'stats 4 3', 'hint', 'views',
      'traceOn', 'traceOff', 'zoomControls', 'zoomIn', 'zoomOut', 'zoomLevel', 'fit', 'zoomTo Beta',
      'zoomToSelected', 'drawerTitle', 'close', 'connections', 'connectionTo Gamma', 'connectionFrom Alpha',
      'inGroup Platform team', 'outline', 'presentation', 'mapMode', 'outlineMode',
    ]) {
      expect([name, all.includes(`«${name}`)]).toEqual([name, true]);
    }
  });

  it('replaces the empty view and no views text too', async () => {
    tree = await mount(<DagrExplorer label="Atlas" views={[empty]} labels={sentinels} />);
    expect(part('viewport').textContent).toBe('«emptyView»');
    expect(leftovers(tree.container)).toEqual([]);
    await tree.rerender(<DagrExplorer label="Atlas" views={[]} labels={sentinels} />);
    expect(part('viewport').textContent).toBe('«noViews»');
    expect(leftovers(tree.container)).toEqual([]);
  });

  it('has no key that no part renders', () => {
    expect(Object.keys(DEFAULT_EXPLORER_LABELS)).not.toContain('showDetails');
    expect(Object.keys(DEFAULT_EXPLORER_LABELS)).not.toContain('hideDetails');
    // @ts-expect-error: `showDetails` is not a label: no part shows a details toggle.
    const unknown: Partial<ExplorerLabels> = { showDetails: 'Show' };
    expect(unknown).toBeDefined();
  });

  it('replaces a subset, keeping the rest, including a key set to undefined', async () => {
    const partial = { fit: 'Encuadrar', close: undefined } as unknown as Partial<ExplorerLabels>;
    tree = await mount(<DagrExplorer label="Map" views={[overview]} apiRef={apiRef} labels={partial} />);
    expect(part('toolbar').querySelector('[data-action="fit"]')?.getAttribute('aria-label')).toBe('Encuadrar');
    await flush(() => api().inspect('a'));
    expect(part('details-close').getAttribute('aria-label')).toBe('Close');
  });
});

describe('DagrExplorer: map or outline', () => {
  function outlineItem(id: string): HTMLButtonElement {
    const button = part('outline').querySelector(`button[data-node-id="${id}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`no item ${id}`);
    return button;
  }

  function graphNode(id: string): HTMLElement {
    const node = part('viewport').querySelector(`[data-dagr-explorer="node"][data-node-id="${id}"]`);
    if (!(node instanceof HTMLElement)) throw new Error(`no node ${id}`);
    return node;
  }

  /** Inside an ancestor hidden from sight, the tab order and the accessibility tree. */
  function isHidden(element: HTMLElement): boolean {
    return element.closest('[hidden]') !== null;
  }

  /** The browser's answer, which jsdom lacks: no box under a hidden ancestor. */
  function installCheckVisibility(): void {
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value(this: HTMLElement) {
        return this.closest('[hidden]') === null;
      },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility');
  });

  async function ready(props: Partial<DagrExplorerProps<Item, ExplorerEdge>> = {}): Promise<void> {
    const all = { label: 'Map', views: [overview, detail], apiRef, ...props } as DagrExplorerProps<Item, ExplorerEdge>;
    tree = await mount(<DagrExplorer<Item, ExplorerEdge> {...all} />);
    await resizeTo(800, 480);
    await runFramesUntilIdle();
  }

  it('starts on the map, with the choice as two pressed buttons and no outline mounted', async () => {
    await ready();
    expect(part('mode').getAttribute('role')).toBe('group');
    expect(part('mode').getAttribute('aria-label')).toBe('Presentation');
    expect([mode('map').textContent, mode('outline').textContent]).toEqual(['Map', 'Outline']);
    expect([mode('map').getAttribute('aria-pressed'), mode('outline').getAttribute('aria-pressed')]).toEqual([
      'true',
      'false',
    ]);
    expect(find('outline')).toBeNull();
    expect(isHidden(part('viewport'))).toBe(false);
  });

  it('carries the selection, the query, trace and the drawer across a switch and back', async () => {
    await ready();
    await flush(() => {
      api().setQuery('a');
      api().setTrace(true);
      api().inspect('b');
    });
    await flush(() => mode('outline').click());
    expect(mode('outline').getAttribute('aria-pressed')).toBe('true');
    expect(isHidden(part('viewport'))).toBe(true);
    expect(isHidden(part('hint'))).toBe(true);
    expect(isHidden(part('toolbar'))).toBe(true);
    expect(outlineItem('b').getAttribute('aria-current')).toBe('true');
    expect(outlineItem('d').dataset['dimmed']).toBe('true');
    expect(part('search').querySelector('input')?.value).toBe('a');
    expect(part('details-label').textContent).toBe('Beta');
    expect(part('details').parentElement?.contains(part('outline'))).toBe(true);
    expect(part('details').parentElement?.style.position).toBe('relative');

    await flush(() => mode('map').click());
    expect(isHidden(part('outline'))).toBe(true);
    expect(graphNode('b').dataset['selected']).toBe('true');
    expect(part('details').parentElement).toBe(part('viewport').parentElement);
    expect(isHidden(part('toolbar'))).toBe(false);
  });

  it('leaves exactly one presentation in the tab order', async () => {
    await ready();
    await flush(() => mode('outline').click());
    await flush(() => mode('map').click());
    const tabbable = [...part('root').querySelectorAll<HTMLElement>('[tabindex="0"]')].filter(
      (element) => !isHidden(element),
    );
    expect(tabbable.every((element) => part('viewport').contains(element))).toBe(true);
    expect(part('outline').querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('keeps the map camera while the outline shows, through a resize and a turn', async () => {
    await ready();
    await flush(() => api().zoomBy(2));
    await runFramesUntilIdle();
    await flush(() => api().reveal('d'));
    await runFramesUntilIdle();
    const zoom = part('zoom-level').textContent;
    const plane = part('plane').style.transform;
    expect(zoom).not.toBe('');
    // Hidden, the map measures zero.
    await flush(() => mode('outline').click());
    await resizeTo(0, 0);
    await resizeTo(800, 480);
    await flush(() => mode('map').click());
    await runFramesUntilIdle();
    expect(part('plane').style.transform).toBe(plane);
    expect(part('zoom-level').textContent).toBe(zoom);
    // And the phone turns while it is.
    await flush(() => mode('outline').click());
    await resizeTo(0, 0);
    await resizeTo(480, 800);
    await flush(() => mode('map').click());
    await runFramesUntilIdle();
    expect(part('zoom-level').textContent).toBe(zoom);
  });

  it('moves focus in the presentation that left to the same node in the other', async () => {
    let shown: 'map' | 'outline' = 'map';
    const render = () => (
      <DagrExplorer label="Map" views={[overview, detail]} apiRef={apiRef} mode={shown} defaultSelectedId="c" />
    );
    tree = await mount(render());
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    graphNode('c').focus();
    shown = 'outline';
    await tree.rerender(render());
    expect(document.activeElement).toBe(outlineItem('c'));
    shown = 'map';
    await tree.rerender(render());
    expect(document.activeElement).toBe(graphNode('c'));
  });

  it('moves focus on a node that is not selected to the same node', async () => {
    let shown: 'map' | 'outline' = 'map';
    const render = () => <DagrExplorer label="Map" views={[overview, detail]} apiRef={apiRef} mode={shown} />;
    tree = await mount(render());
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    graphNode('d').focus();
    shown = 'outline';
    await tree.rerender(render());
    expect(document.activeElement).toBe(outlineItem('d'));
    outlineItem('b').focus();
    shown = 'map';
    await tree.rerender(render());
    expect(document.activeElement).toBe(graphNode('b'));
  });

  it('moves focus on the toolbar to the outline when the host switches', async () => {
    let shown: 'map' | 'outline' = 'map';
    const render = () => <DagrExplorer label="Map" views={[overview]} apiRef={apiRef} mode={shown} />;
    tree = await mount(render());
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    const fit = part('toolbar').querySelector<HTMLElement>('[data-action="fit"]');
    fit?.focus();
    shown = 'outline';
    await tree.rerender(render());
    expect(document.activeElement).toBe(outlineItem('a'));
  });

  it('leaves the outline room to scroll clear of an open drawer', async () => {
    await ready({ defaultMode: 'outline' });
    const scroller = part('outline').parentElement;
    expect(scroller?.style.overflowY).toBe('auto');
    expect(scroller?.style.scrollPaddingBottom).toBe('');
    await flush(() => outlineItem('d').click());
    expect(scroller?.style.scrollPaddingBottom).toBe('50%');
    expect((scroller?.lastElementChild as HTMLElement | null)?.style.height).toBe('50%');
  });

  it('puts the outline back where it was scrolled after the map', async () => {
    await ready({ defaultMode: 'outline' });
    const scroller = part('outline').parentElement;
    if (scroller === null) throw new Error('no scroller');
    scroller.scrollTop = 120;
    scroller.dispatchEvent(new Event('scroll'));
    await flush(() => mode('map').click());
    // What a browser does to a box that display: none removes; jsdom keeps the value.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    await flush(() => mode('outline').click());
    expect(scroller.scrollTop).toBe(120);
  });

  it('under control, reports a choice and shows only the owner\'s mode', async () => {
    const onModeChange = vi.fn();
    await ready({ mode: 'map', onModeChange });
    await flush(() => mode('outline').click());
    expect(onModeChange).toHaveBeenCalledWith('outline');
    expect(mode('map').getAttribute('aria-pressed')).toBe('true');
    expect(find('outline')).toBeNull();
    await flush(() => mode('map').click());
    expect(onModeChange).toHaveBeenCalledTimes(1);
  });

  it('starts on the outline with defaultMode, the map mounted behind it', async () => {
    await ready({ defaultMode: 'outline' });
    expect(mode('outline').getAttribute('aria-pressed')).toBe('true');
    expect(isHidden(part('outline'))).toBe(false);
    expect(isHidden(part('viewport'))).toBe(true);
    expect(isHidden(part('toolbar'))).toBe(true);
  });

  it('returns focus to the outline item when a drawer opened on the map closes there', async () => {
    installCheckVisibility();
    await ready();
    graphNode('b').focus();
    await flush(() => api().inspect('b'));
    await flush(() => mode('outline').click());
    const close = part('details-close');
    close.focus();
    await flush(() => close.click());
    expect(document.activeElement).toBe(outlineItem('b'));
  });

  it('keeps the outline through data removal and a switch to an empty view', async () => {
    await ready({ defaultMode: 'outline', defaultSelectedId: 'b' });
    const rest = {
      ...overview,
      nodes: overview.nodes.filter((node) => node.id !== 'b'),
      edges: overview.edges.filter((edge) => edge.source !== 'b' && edge.target !== 'b'),
      groups: [],
    };
    await tree?.rerender(<DagrExplorer label="Map" views={[rest, detail]} apiRef={apiRef} defaultMode="outline" />);
    expect(part('outline').querySelector('[data-node-id="b"]')).toBeNull();
    await tree?.rerender(<DagrExplorer label="Map" views={[empty]} apiRef={apiRef} defaultMode="outline" />);
    expect(part('outline').dataset['empty']).toBe('true');
    expect(mode('outline').getAttribute('aria-pressed')).toBe('true');
  });
});
