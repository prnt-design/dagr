/**
 * Data and small components the part tests share.
 *
 * A NON-TEST helper: it carries no assertions. The views are small enough to
 * reason about by hand, and every label is a word no default label contains,
 * so a test that scans the DOM for copy cannot mistake data for a label.
 */

import { Component } from 'react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { ExplorerNode, ExplorerView } from '../src/types.js';

export interface Item extends ExplorerNode {
  readonly kind: string;
}

/** a -> b -> c -> d, with a and b in one group. */
export const overview: ExplorerView<Item> = {
  id: 'overview',
  label: 'Overview',
  nodes: [
    { id: 'a', label: 'Alpha', kind: 'service' },
    { id: 'b', label: 'Beta', kind: 'store' },
    { id: 'c', label: 'Gamma', kind: 'queue' },
    { id: 'd', label: 'Delta', kind: 'store' },
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'cd', source: 'c', target: 'd' },
  ],
  groups: [{ id: 'trust', label: 'Trust boundary', nodeIds: ['a', 'b'] }],
};

/** x -> y. Shares no node id with `overview`. */
export const detail: ExplorerView<Item> = {
  id: 'detail',
  label: 'Detail',
  nodes: [
    { id: 'x', label: 'Xenon', kind: 'service' },
    { id: 'y', label: 'Yttrium', kind: 'store' },
  ],
  edges: [{ id: 'xy', source: 'x', target: 'y' }],
};

/** No nodes at all. */
export const empty: ExplorerView<Item> = { id: 'empty', label: 'Empty', nodes: [], edges: [] };

/** Catches what its children throw and shows the error's `code`. */
export class Boundary extends Component<
  { readonly children: ReactNode; readonly onError?: (error: unknown) => void },
  { readonly error: unknown }
> {
  override state: { readonly error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const code = (error as { code?: unknown }).code;
    return <p data-testid="caught">{typeof code === 'string' ? code : 'unknown'}</p>;
  }
}

/**
 * Silences the error an error boundary catches, for a test that expects one.
 * React reports it to `console.error`, and React 18 in development also
 * rethrows it inside a synthetic event, which jsdom reports as an uncaught
 * error unless the window's `error` event is cancelled. Returns the undo.
 */
export function quietErrors(): () => void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cancel = (event: Event): void => event.preventDefault();
  window.addEventListener('error', cancel);
  return () => {
    window.removeEventListener('error', cancel);
    spy.mockRestore();
  };
}
