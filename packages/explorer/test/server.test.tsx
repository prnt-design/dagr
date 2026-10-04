// @vitest-environment node
import { renderToString, version } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DagrExplorer } from '../src/dagr-explorer.js';
import { ExplorerDataError } from '../src/errors.js';
import { ExplorerDetails } from '../src/explorer-details.js';
import { ExplorerSearch } from '../src/explorer-search.js';
import { ExplorerToolbar } from '../src/explorer-toolbar.js';
import { ExplorerTraceToggle } from '../src/explorer-trace-toggle.js';
import { ExplorerViewport } from '../src/explorer-viewport.js';
import { ExplorerViews } from '../src/explorer-views.js';
import { layoutView } from '../src/layout.js';
import { ExplorerRoot } from '../src/root.js';
import type { ExplorerEdge, ExplorerView } from '../src/types.js';
import { detail, overview } from './fixtures.js';
import type { Item } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** How many times `pattern` occurs in `html`. */
function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(new RegExp(pattern.source, 'g'))].length;
}

/** The opening tag of the element with `data-dagr-explorer="name"`, or `null`. */
function tagOf(html: string, name: string): string | null {
  return new RegExp(`<[a-z]+[^>]*data-dagr-explorer="${name}"[^>]*>`).exec(html)?.[0] ?? null;
}

/** Renders on the server, failing on anything React reports to the console. */
function serve(element: Parameters<typeof renderToString>[0]): string {
  const errors = vi.spyOn(console, 'error');
  const warnings = vi.spyOn(console, 'warn');
  const html = renderToString(element);
  expect(errors).not.toHaveBeenCalled();
  expect(warnings).not.toHaveBeenCalled();
  return html;
}

/** What every server render of the overview must contain. */
function expectShell(html: string, label: string): void {
  expect(tagOf(html, 'root')).not.toBeNull();
  const search = new RegExp(`data-dagr-explorer="search"[^]*?<input`).exec(html);
  expect(search).not.toBeNull();

  const viewport = tagOf(html, 'viewport');
  expect(viewport).toContain('role="region"');
  expect(viewport).toContain(`aria-label="${label}"`);
  expect(viewport).toContain('tabindex="-1"');
  const plane = tagOf(html, 'plane');
  expect(plane).toMatch(/visibility:\s*hidden/);

  const layout = layoutView(overview);
  const routed = [...layout.routes.values()].filter((points) => points.length > 0).length;
  expect(count(html, /<rect[^>]*data-node-id="/)).toBe(overview.nodes.length);
  expect(count(html, /<path[^>]*data-edge-id="/)).toBe(routed);
  // No camera on a server, so no node has a button and nothing in the graph is tabbable.
  expect(html).not.toContain('data-dagr-explorer="node"');
}

describe('server rendering', () => {
  it('runs with no DOM, on the React major under test', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(version.split('.')[0]).toBe(process.env['DAGR_REACT_MAJOR']);
  });

  it('renders DagrExplorer: the shell, and the base with every mark and every routed edge', () => {
    const html = serve(<DagrExplorer label="Map" views={[overview, detail]} />);
    expectShell(html, 'Map');
    for (const name of ['views', 'trace', 'toolbar', 'hint']) expect(tagOf(html, name)).not.toBeNull();
  });

  it('renders a hand-composed root with each part', () => {
    const html = serve(
      <ExplorerRoot<Item, ExplorerEdge> label="Composed" views={[overview, detail]} defaultSelectedId="b">
        <ExplorerViews />
        <ExplorerSearch />
        <ExplorerTraceToggle />
        <ExplorerViewport>
          <ExplorerDetails />
        </ExplorerViewport>
        <ExplorerToolbar />
      </ExplorerRoot>,
    );
    expectShell(html, 'Composed');
    for (const name of ['views', 'trace', 'toolbar', 'hint']) expect(tagOf(html, name)).not.toBeNull();
    // The selection is state, so it renders where a part shows it.
    expect(html).toContain('Zoom to Beta');
  });

  it('renders the shorthand', () => {
    const html = serve(<DagrExplorer label="Short" nodes={overview.nodes} edges={overview.edges} groups={overview.groups} />);
    expectShell(html, 'Short');
  });

  it('throws ExplorerDataError for malformed data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: ExplorerView<Item> = {
      ...overview,
      edges: [...overview.edges, { id: 'zz', source: 'a', target: 'nowhere' }],
    };
    let caught: unknown = null;
    try {
      renderToString(<DagrExplorer label="Map" views={[broken]} />);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExplorerDataError);
    expect((caught as ExplorerDataError).code).toBe('MISSING_EDGE_ENDPOINT');
  });
});
