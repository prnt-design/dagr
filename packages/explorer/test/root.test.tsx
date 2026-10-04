// @vitest-environment jsdom
import { StrictMode, createRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerContextError } from '../src/errors.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerRootProps } from '../src/root.js';
import type { ExplorerApi, ExplorerState } from '../src/context.js';
import { useExplorer, useExplorerApi } from '../src/use-explorer.js';
import type { ExplorerEdge, ExplorerView } from '../src/types.js';
import { flush, installDom, mount, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { Boundary, detail, empty, overview, quietErrors } from './fixtures.js';
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

/** Records what `useExplorer` returns, on every render. */
function Probe(): null {
  seen = useExplorer<Item, ExplorerEdge>();
  return null;
}

function state(): ExplorerState<Item, ExplorerEdge> {
  if (seen === null) throw new Error('the probe never rendered');
  return seen;
}

function root(props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {}, children: ReactNode = <Probe />): ReactNode {
  const all = { label: 'Map', views: [overview, detail], ...props } as ExplorerRootProps<Item, ExplorerEdge>;
  return <ExplorerRoot<Item, ExplorerEdge> {...all}>{children}</ExplorerRoot>;
}

async function render(props: Partial<ExplorerRootProps<Item, ExplorerEdge>> = {}): Promise<void> {
  tree = await mount(root(props));
}

async function call(body: (api: ExplorerApi) => void): Promise<void> {
  await flush(() => body(state()));
}

describe('ExplorerRoot: shape', () => {
  it('renders one element carrying the hook, the class and the style, around its children', async () => {
    tree = await mount(
      root({ className: 'host', style: { color: 'red' } }, <span data-testid="child" />),
    );
    const element = tree.container.querySelector('[data-dagr-explorer="root"]');
    expect(element).toBeInstanceOf(HTMLElement);
    expect(element?.className).toBe('host');
    expect((element as HTMLElement).style.color).toBe('red');
    expect((element as HTMLElement).style.position).toBe('relative');
    expect(element?.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('hands useExplorer the views, the active view and its layout', async () => {
    await render();
    expect(state().label).toBe('Map');
    expect(state().views.map((v) => v.id)).toEqual(['overview', 'detail']);
    expect(state().activeView).toBe(overview);
    expect([...(state().layout?.boxes.keys() ?? [])]).toEqual(['a', 'b', 'c', 'd']);
    expect(state().selectedId).toBeNull();
    expect(state().selectedNode).toBeNull();
    expect(state().query).toBe('');
    expect(state().trace).toBe(false);
    expect(state().detailsOpen).toBe(false);
    expect(state().dimmed.size).toBe(0);
  });

  it('treats nodes and edges as one view with id "default" and the root label', async () => {
    tree = await mount(
      <ExplorerRoot<Item> label="Shorthand" nodes={overview.nodes} edges={overview.edges} groups={overview.groups}>
        <Probe />
      </ExplorerRoot>,
    );
    expect(state().views).toHaveLength(1);
    expect(state().activeView?.id).toBe('default');
    expect(state().activeView?.label).toBe('Shorthand');
    expect(state().activeView?.groups).toBe(overview.groups);
    expect(state().layout?.groups.has('trust')).toBe(true);
  });

  it('rejects both data shapes at once, as a type error', () => {
    const both = (
      // @ts-expect-error: `views` and the shorthand are exclusive.
      <ExplorerRoot label="Both" views={[overview]} nodes={overview.nodes} edges={overview.edges} />
    );
    expect(both).toBeDefined();
  });

  it('computes the layout key once per view, not on every render', async () => {
    const nodeSize = vi.fn(() => ({ width: 200, height: 100 }));
    const sized: ExplorerView<Item> = { ...overview, layout: { nodeSize } };
    await render({ views: [sized, detail] });
    expect(nodeSize).toHaveBeenCalled();
    nodeSize.mockClear();
    await call((api) => api.setQuery('a'));
    await call((api) => api.setQuery('al'));
    await call((api) => api.select('b'));
    expect(state().query).toBe('al');
    expect(nodeSize).not.toHaveBeenCalled();
  });

  it('keeps the layout for data re-created with the same shape, and relays it out for strictGroups', async () => {
    await render();
    const first = state().layout;
    await tree?.rerender(root({ views: [{ ...overview, nodes: overview.nodes.map((n) => ({ ...n, label: `${n.label}!` })) }, detail] }));
    expect(state().layout).toBe(first);
    expect(state().activeView?.nodes[0]?.label).toBe('Alpha!');
    await tree?.rerender(root({ strictGroups: true }));
    expect(state().layout).not.toBe(first);
  });
});

describe('ExplorerRoot: view', () => {
  it('starts on the first view, or on defaultViewId', async () => {
    await render();
    expect(state().activeView?.id).toBe('overview');
    await tree?.unmount();
    await render({ defaultViewId: 'detail' });
    expect(state().activeView?.id).toBe('detail');
  });

  it('switches an uncontrolled view, calling onViewChange, and ignores an unknown or current id', async () => {
    const onViewChange = vi.fn();
    await render({ onViewChange });
    await call((api) => api.selectView('detail'));
    expect(state().activeView?.id).toBe('detail');
    expect(onViewChange.mock.calls).toEqual([['detail']]);
    await call((api) => api.selectView('nowhere'));
    await call((api) => api.selectView('detail'));
    expect(state().activeView?.id).toBe('detail');
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('under a controlled viewId, calls back and changes nothing until the prop does', async () => {
    const onViewChange = vi.fn();
    await render({ viewId: 'overview', onViewChange });
    await call((api) => api.selectView('detail'));
    expect(onViewChange.mock.calls).toEqual([['detail']]);
    expect(state().activeView?.id).toBe('overview');
    await tree?.rerender(root({ viewId: 'detail', onViewChange }));
    expect(state().activeView?.id).toBe('detail');
  });

  it('renders an unknown controlled viewId as the first view, with no corrective callback', async () => {
    const onViewChange = vi.fn();
    const onSelectedChange = vi.fn();
    await render({ viewId: 'nowhere', onViewChange, onSelectedChange });
    expect(state().activeView?.id).toBe('overview');
    expect(onViewChange).not.toHaveBeenCalled();
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it('resets query, trace and the drawer on a switch, and clears the selection', async () => {
    const onSelectedChange = vi.fn();
    await render({ onSelectedChange });
    await call((api) => {
      api.inspect('b');
      api.setQuery('alp');
      api.setTrace(true);
    });
    expect(state().detailsOpen).toBe(true);
    await call((api) => api.selectView('detail'));
    expect(state().query).toBe('');
    expect(state().trace).toBe(false);
    expect(state().detailsOpen).toBe(false);
    expect(state().selectedId).toBeNull();
    expect(onSelectedChange.mock.calls).toEqual([['b'], [null]]);
  });

  it('selects what selectOnViewChange returns for the new view, and does not call it at mount', async () => {
    const selectOnViewChange = vi.fn((view: ExplorerView<Item>) => view.nodes[1]?.id ?? null);
    await render({ selectOnViewChange, defaultSelectedId: 'a' });
    expect(selectOnViewChange).not.toHaveBeenCalled();
    expect(state().selectedId).toBe('a');
    await call((api) => api.selectView('detail'));
    expect(selectOnViewChange).toHaveBeenCalledTimes(1);
    expect(selectOnViewChange.mock.calls[0]?.[0]).toBe(detail);
    expect(state().selectedId).toBe('y');
  });

  it('under a controlled selectedId, reselects on a switch by callback only', async () => {
    const onSelectedChange = vi.fn();
    await render({ selectedId: 'a', onSelectedChange, selectOnViewChange: () => 'x' });
    await call((api) => api.selectView('detail'));
    expect(onSelectedChange.mock.calls).toEqual([['x']]);
    // The owner still says 'a', which the new view lacks: no selection, and no second call.
    expect(state().selectedId).toBeNull();
    await tree?.rerender(root({ selectedId: 'x', onSelectedChange, selectOnViewChange: () => 'x' }));
    expect(state().selectedId).toBe('x');
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first view when the active one is removed, and forgets it', async () => {
    const onViewChange = vi.fn();
    const selectOnViewChange = vi.fn(() => 'b');
    await render({ defaultViewId: 'detail', onViewChange, selectOnViewChange });
    await call((api) => api.setQuery('xen'));
    await tree?.rerender(root({ views: [overview], onViewChange, selectOnViewChange }));
    expect(state().activeView?.id).toBe('overview');
    expect(state().query).toBe('');
    expect(state().selectedId).toBe('b');
    expect(onViewChange.mock.calls).toEqual([['overview']]);
    // It returns, and is not reselected.
    await tree?.rerender(root({ views: [overview, detail], onViewChange, selectOnViewChange }));
    expect(state().activeView?.id).toBe('overview');
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('under a controlled viewId, reports the removal of the active view once and renders the first', async () => {
    const onViewChange = vi.fn();
    await render({ viewId: 'detail', onViewChange });
    await tree?.rerender(root({ viewId: 'detail', views: [overview], onViewChange }));
    expect(state().activeView?.id).toBe('overview');
    expect(onViewChange.mock.calls).toEqual([['overview']]);
    await tree?.rerender(root({ viewId: 'detail', views: [overview, empty], onViewChange }));
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('treats data that arrives after mount as data, not as a view switch', async () => {
    const onSelectedChange = vi.fn();
    const onViewChange = vi.fn();
    const selectOnViewChange = vi.fn(() => 'c');
    // A deep link: the owner's selection is there before the data is.
    await render({ views: [], selectedId: 'b', onSelectedChange, onViewChange, selectOnViewChange });
    expect(state().selectedId).toBeNull();
    await call((api) => api.setQuery('alp'));
    await tree?.rerender(root({ selectedId: 'b', onSelectedChange, onViewChange, selectOnViewChange }));
    expect(state().activeView?.id).toBe('overview');
    expect(state().selectedId).toBe('b');
    expect(state().query).toBe('alp');
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
    expect(selectOnViewChange).not.toHaveBeenCalled();
  });

  it('keeps an uncontrolled defaultSelectedId through data that starts empty', async () => {
    const onSelectedChange = vi.fn();
    await render({ views: [], defaultSelectedId: 'b', onSelectedChange });
    await tree?.rerender(root({ onSelectedChange }));
    expect(state().selectedId).toBe('b');
    expect(onSelectedChange).not.toHaveBeenCalled();
    // A switch after that is a switch.
    await call((api) => api.selectView('detail'));
    expect(state().selectedId).toBeNull();
  });

  it('renders no views as no active view and no layout, without throwing', async () => {
    await render({ views: [] });
    expect(state().activeView).toBeNull();
    expect(state().layout).toBeNull();
  });
});

describe('ExplorerRoot: selection', () => {
  it('selects uncontrolled, calling onSelectedChange, and ignores an id the view lacks', async () => {
    const onSelectedChange = vi.fn();
    await render({ onSelectedChange });
    await call((api) => api.select('b'));
    expect(state().selectedId).toBe('b');
    expect(state().selectedNode?.kind).toBe('store');
    await call((api) => api.select('nowhere'));
    expect(state().selectedId).toBe('b');
    await call((api) => api.select(null));
    expect(state().selectedId).toBeNull();
    expect(onSelectedChange.mock.calls).toEqual([['b'], [null]]);
  });

  it('reads defaultSelectedId once, at mount', async () => {
    await render({ defaultSelectedId: 'a' });
    expect(state().selectedId).toBe('a');
    await tree?.rerender(root({ defaultSelectedId: 'c' }));
    expect(state().selectedId).toBe('a');
  });

  it('under a controlled selectedId, calls back and changes nothing until the prop does', async () => {
    const onSelectedChange = vi.fn();
    await render({ selectedId: null, onSelectedChange });
    await call((api) => api.select('b'));
    expect(onSelectedChange.mock.calls).toEqual([['b']]);
    expect(state().selectedId).toBeNull();
    await call((api) => api.inspect('c'));
    expect(onSelectedChange.mock.calls).toEqual([['b'], ['c']]);
    expect(state().detailsOpen).toBe(false);
    await tree?.rerender(root({ selectedId: 'c', onSelectedChange }));
    expect(state().selectedId).toBe('c');
    expect(state().detailsOpen).toBe(true);
  });

  it('renders an unknown controlled selectedId as no selection with the drawer closed, and never calls back', async () => {
    const onSelectedChange = vi.fn();
    await render({ selectedId: 'a', onSelectedChange });
    await call((api) => api.inspect('a'));
    expect(state().detailsOpen).toBe(true);
    await tree?.rerender(root({ selectedId: 'nowhere', onSelectedChange }));
    expect(state().selectedId).toBeNull();
    expect(state().detailsOpen).toBe(false);
    await tree?.rerender(root({ selectedId: 'nowhere', onSelectedChange }));
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it('clears an uncontrolled selection whose node leaves the data, and closes the drawer', async () => {
    const onSelectedChange = vi.fn();
    await render({ onSelectedChange });
    await call((api) => api.inspect('d'));
    const without = { ...overview, nodes: overview.nodes.slice(0, 3), edges: overview.edges.slice(0, 2) };
    await tree?.rerender(root({ views: [without, detail], onSelectedChange }));
    expect(state().selectedId).toBeNull();
    expect(state().detailsOpen).toBe(false);
    expect(onSelectedChange.mock.calls).toEqual([['d'], [null]]);
    // The node comes back, and is not reselected.
    await tree?.rerender(root({ onSelectedChange }));
    expect(state().selectedId).toBeNull();
  });

  it('under a controlled selectedId, reports a node leaving the data once, with no loop', async () => {
    const onSelectedChange = vi.fn();
    await render({ selectedId: 'd', onSelectedChange });
    await call((api) => api.inspect('d'));
    const without = { ...overview, nodes: overview.nodes.slice(0, 3), edges: overview.edges.slice(0, 2) };
    await tree?.rerender(root({ selectedId: 'd', views: [without], onSelectedChange }));
    expect(state().selectedId).toBeNull();
    expect(state().detailsOpen).toBe(false);
    expect(onSelectedChange.mock.calls).toEqual([[null]]);
    await tree?.rerender(root({ selectedId: 'd', views: [without], onSelectedChange }));
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
  });

  it('opens the drawer on inspect, closes it on closeDetails, and keeps the selection', async () => {
    await render();
    await call((api) => api.inspect('c'));
    expect(state().selectedId).toBe('c');
    expect(state().detailsOpen).toBe(true);
    await call((api) => api.closeDetails());
    expect(state().detailsOpen).toBe(false);
    expect(state().selectedId).toBe('c');
    await call((api) => api.inspect('nowhere'));
    expect(state().detailsOpen).toBe(false);
  });

  it('ends two selects in one tick on the last one asked for', async () => {
    const onSelectedChange = vi.fn();
    await render({ onSelectedChange });
    await call((api) => {
      api.select('a');
      api.select(null);
    });
    expect(state().selectedId).toBeNull();
    expect(onSelectedChange.mock.calls).toEqual([['a'], [null]]);
  });

  it('ends two inspects in one tick on the last one asked for, with the first opener kept', async () => {
    const onSelectedChange = vi.fn();
    await render({ defaultSelectedId: 'b', onSelectedChange });
    const trigger = document.createElement('button');
    document.body.append(trigger);
    await call((api) => {
      api.inspect('a', trigger);
      api.inspect('b');
    });
    expect(state().selectedId).toBe('b');
    expect(state().detailsOpen).toBe(true);
    expect(onSelectedChange.mock.calls).toEqual([['a'], ['b']]);
    // The second call found the drawer open, so it kept the first opener.
    await call((api) => api.closeDetails());
    expect(document.activeElement).toBe(trigger);
  });

  it('under a controlled selection, calls back for each of two selects in one tick', async () => {
    const onSelectedChange = vi.fn();
    await render({ selectedId: null, onSelectedChange });
    await call((api) => {
      api.select('a');
      api.select(null);
    });
    expect(onSelectedChange.mock.calls).toEqual([['a'], [null]]);
    // The owner did not move, so asking for 'a' again is asked again.
    await call((api) => api.select('a'));
    expect(onSelectedChange.mock.calls).toEqual([['a'], [null], ['a']]);
  });

  it('ends two view switches in one tick on the last one asked for', async () => {
    const onViewChange = vi.fn();
    await render({ onViewChange });
    await call((api) => {
      api.selectView('detail');
      api.selectView('overview');
    });
    expect(state().activeView?.id).toBe('overview');
    expect(onViewChange.mock.calls).toEqual([['detail'], ['overview']]);
  });

  it('closes the drawer when the selection is cleared, and does not reopen it on the next select', async () => {
    await render();
    await call((api) => api.inspect('c'));
    await call((api) => api.select(null));
    expect(state().detailsOpen).toBe(false);
    await call((api) => api.select('a'));
    expect(state().detailsOpen).toBe(false);
  });
});

describe('ExplorerRoot: query and trace', () => {
  it('matches and dims by query, through searchText', async () => {
    await render({ searchText: (node) => node.kind });
    await call((api) => api.setQuery('STORE'));
    expect(state().matches.map((n) => n.id)).toEqual(['b', 'd']);
    expect([...state().dimmed].sort()).toEqual(['a', 'c']);
    await call((api) => api.setQuery('   '));
    expect(state().matches).toEqual([]);
    expect(state().dimmed.size).toBe(0);
  });

  it('dims by trace only with a selection, and unions it with the query', async () => {
    await render();
    await call((api) => api.setTrace(true));
    expect(state().trace).toBe(true);
    expect(state().dimmed.size).toBe(0);
    await call((api) => api.select('b'));
    expect([...state().dimmed]).toEqual(['d']);
    await call((api) => api.setQuery('alpha'));
    expect([...state().dimmed].sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('ExplorerRoot: apiRef', () => {
  it('hands out the same methods useExplorer does, stable across renders', async () => {
    const apiRef = createRef<ExplorerApi>();
    await render({ apiRef });
    const api = apiRef.current;
    if (api === null) throw new Error('no api');
    await flush(() => {
      api.select('a');
      api.setQuery('gam');
      api.setTrace(true);
    });
    expect(state().selectedId).toBe('a');
    expect(state().query).toBe('gam');
    expect(state().trace).toBe(true);
    await flush(() => api.inspect('b'));
    expect(state().detailsOpen).toBe(true);
    await flush(() => api.closeDetails());
    expect(state().detailsOpen).toBe(false);
    await flush(() => api.selectView('detail'));
    expect(state().activeView?.id).toBe('detail');
    expect(apiRef.current).toBe(api);
    for (const name of ['select', 'inspect', 'closeDetails', 'selectView', 'setQuery', 'setTrace'] as const) {
      expect(state()[name]).toBe(api[name]);
    }
  });

  it('makes the camera methods no-ops before a viewport mounts', async () => {
    const apiRef = createRef<ExplorerApi>();
    await render({ apiRef });
    const api = apiRef.current;
    if (api === null) throw new Error('no api');
    expect(() => {
      api.fit();
      api.zoomBy(2);
      api.focusNode('a');
      api.reveal('a');
      api.focusNode('nowhere');
    }).not.toThrow();
    expect(state().camera.get()).toBeNull();
  });

  it('clears a callback apiRef on unmount', async () => {
    const calls: (ExplorerApi | null)[] = [];
    tree = await mount(root({ apiRef: (api: ExplorerApi | null) => void calls.push(api) }));
    await tree.unmount();
    expect(calls.at(0)).not.toBeNull();
    expect(calls.at(-1)).toBeNull();
  });
});

describe('useExplorerApi', () => {
  it('hands out the same stable methods and never re-renders a caller that only calls them', async () => {
    const apiRef = createRef<ExplorerApi>();
    let renders = 0;
    let api: ExplorerApi | null = null;
    function Caller(): null {
      api = useExplorerApi();
      renders += 1;
      return null;
    }
    tree = await mount(
      root(
        { apiRef },
        <>
          <Caller />
          <Probe />
        </>,
      ),
    );
    expect(renders).toBe(1);
    expect(api).toBe(apiRef.current);
    await call((state) => state.setQuery('alp'));
    await call((state) => state.select('b'));
    await call((state) => state.setTrace(true));
    await call((state) => state.inspect('c'));
    expect(state().query).toBe('alp');
    expect(state().selectedId).toBe('c');
    expect(renders).toBe(1);
  });

  it('throws OUTSIDE_EXPLORER outside a root, naming it', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    function Caller(): null {
      useExplorerApi();
      return null;
    }
    tree = await mount(
      <Boundary onError={onError}>
        <Caller />
      </Boundary>,
    );
    expect(tree.container.textContent).toBe('OUTSIDE_EXPLORER');
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/^useExplorerApi\(\) /);
    restore();
  });
});

describe('ExplorerRoot: errors', () => {
  it('throws a data error in render, so an error boundary catches it, from any view', async () => {
    const restore = quietErrors();
    const broken: ExplorerView<Item> = { ...detail, nodes: [...detail.nodes, { id: 'x', label: 'Again', kind: 'x' }] };
    const onError = vi.fn();
    tree = await mount(<Boundary onError={onError}>{root({ views: [overview, broken] })}</Boundary>);
    expect(tree.container.querySelector('[data-testid="caught"]')?.textContent).toBe('DUPLICATE_NODE_ID');
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'DUPLICATE_NODE_ID', id: 'x', viewId: 'detail' });
    restore();
  });

  it('throws a strictGroups layout error the same way', async () => {
    const restore = quietErrors();
    const wide: ExplorerView<Item> = { ...overview, groups: [{ id: 'ends', label: 'Ends', nodeIds: ['a', 'd'] }] };
    tree = await mount(<Boundary>{root({ views: [wide], strictGroups: true })}</Boundary>);
    expect(tree.container.querySelector('[data-testid="caught"]')?.textContent).toBe('GROUP_ENCLOSES_NON_MEMBER');
    restore();
  });

  it('throws OUTSIDE_EXPLORER from useExplorer outside a root, naming it', async () => {
    const restore = quietErrors();
    const onError = vi.fn();
    tree = await mount(
      <Boundary onError={onError}>
        <Probe />
      </Boundary>,
    );
    expect(tree.container.querySelector('[data-testid="caught"]')?.textContent).toBe('OUTSIDE_EXPLORER');
    const error = onError.mock.calls[0]?.[0] as unknown;
    expect(error).toBeInstanceOf(ExplorerContextError);
    expect((error as Error).message).toMatch(/useExplorer\(\)/);
    expect((error as Error).message).toMatch(/inside an ExplorerRoot$/);
    // DagrExplorer takes no children, so naming it would send a reader nowhere.
    expect((error as Error).message).not.toMatch(/DagrExplorer/);
    restore();
  });

  it('gives ExplorerContextError a name, a code and a working instanceof', () => {
    const error = new ExplorerContextError('SECOND_VIEWPORT', 'two');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExplorerContextError);
    expect(error.name).toBe('ExplorerContextError');
    expect(error.code).toBe('SECOND_VIEWPORT');
  });
});

describe('ExplorerRoot: isolation', () => {
  it('keeps two roots on one page independent', async () => {
    let left: ExplorerState<Item, ExplorerEdge> | null = null;
    let right: ExplorerState<Item, ExplorerEdge> | null = null;
    function Left(): null {
      left = useExplorer<Item, ExplorerEdge>();
      return null;
    }
    function Right(): null {
      right = useExplorer<Item, ExplorerEdge>();
      return null;
    }
    tree = await mount(
      <>
        {root({}, <Left />)}
        {root({}, <Right />)}
      </>,
    );
    await flush(() => {
      (left as ExplorerState<Item, ExplorerEdge> | null)?.inspect('a');
      (left as ExplorerState<Item, ExplorerEdge> | null)?.setQuery('alp');
    });
    expect((left as ExplorerState<Item, ExplorerEdge> | null)?.selectedId).toBe('a');
    expect((right as ExplorerState<Item, ExplorerEdge> | null)?.selectedId).toBeNull();
    expect((right as ExplorerState<Item, ExplorerEdge> | null)?.query).toBe('');
  });

  it('settles under StrictMode with the same state', async () => {
    const onSelectedChange = vi.fn();
    tree = await mount(<StrictMode>{root({ defaultSelectedId: 'b', onSelectedChange })}</StrictMode>);
    expect(state().selectedId).toBe('b');
    expect(onSelectedChange).not.toHaveBeenCalled();
  });
});
