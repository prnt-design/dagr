// @vitest-environment jsdom
import { createRef } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerApi } from '../src/context.js';
import { DagrExplorer } from '../src/dagr-explorer.js';
import { flush, hydrate, installDom, resizeTo, runFramesUntilIdle, uninstallDom } from './dom.js';
import type { Mounted } from './dom.js';
import { detail, overview, quietErrors } from './fixtures.js';

let tree: Mounted | null = null;

beforeEach(() => {
  installDom();
});
afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.replaceChildren();
  uninstallDom();
});

/**
 * The server's HTML, from a server's copy of the package: its modules loaded
 * afresh and rendered with `window` and `document` taken away, so a module
 * that decides on the DOM at load decides as it would on a server, and a
 * part that read either in render would throw. React is not reloaded: it is
 * the one instance the client hydrates with. The globals are put back by
 * descriptor, so the stand-ins `installDom` stubbed are untouched.
 */
async function serverHtml(build: (explorer: typeof DagrExplorer) => ReactElement): Promise<string> {
  const saved = (['window', 'document'] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name] of saved) Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
  try {
    vi.resetModules();
    const server = await import('../src/dagr-explorer.js');
    // The premise: a copy of its own, not the one the client renders.
    expect(server.DagrExplorer).not.toBe(DagrExplorer);
    return renderToString(build(server.DagrExplorer));
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor !== undefined) Object.defineProperty(globalThis, name, descriptor);
    }
  }
}

describe('hydration', () => {
  it('hydrates the server HTML with no warning, then fits and becomes interactive', async () => {
    const apiRef = createRef<ExplorerApi>();
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    const html = await serverHtml((Explorer) => <Explorer label="Map" views={[overview, detail]} />);
    const element = <DagrExplorer label="Map" views={[overview, detail]} apiRef={apiRef} />;

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const serverViewport = container.querySelector('[data-dagr-explorer="viewport"]');
    const recovered: unknown[] = [];
    tree = await hydrate(container, element, (error) => recovered.push(error));

    expect(recovered).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    // Hydrated, not replaced: the server's elements are the ones on the page.
    expect(container.querySelector('[data-dagr-explorer="viewport"]')).toBe(serverViewport);

    const plane = container.querySelector<HTMLElement>('[data-dagr-explorer="plane"]');
    expect(plane?.style.visibility).toBe('hidden');
    await resizeTo(800, 480);
    await runFramesUntilIdle();
    expect(plane?.style.visibility).toBe('visible');
    expect(plane?.style.transform).toMatch(/^translate\(/);

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[data-dagr-explorer="node"]')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const first = buttons[0];
    if (first === undefined) throw new Error('no node button');
    await flush(() => first.click());
    expect(container.querySelector('[data-dagr-explorer="details"]')).not.toBeNull();
    expect(apiRef.current).not.toBeNull();

    expect(recovered).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('would hear a mismatch: the control for the test above', async () => {
    const html = await serverHtml((Explorer) => <Explorer label="Map" views={[overview]} />);
    // React 18 also rethrows the mismatch in development, which jsdom would report.
    const restore = quietErrors();
    const errors = vi.mocked(console.error);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const recovered: unknown[] = [];
    // Other data, so the stats in the hint differ from the server's.
    tree = await hydrate(container, <DagrExplorer label="Map" views={[detail]} />, (error) => recovered.push(error));
    const heard = recovered.length + errors.mock.calls.length;
    restore();
    expect(heard).toBeGreaterThan(0);
  });
});
