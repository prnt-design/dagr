/**
 * Mounting a React tree in jsdom, with no testing library behind it.
 *
 * A NON-TEST helper, in the same spirit as `packages/layout/test/fakes.ts`: it
 * carries no assertions and every file that mounts a component imports it.
 *
 * `react-dom/client` plus React's own `act` is the whole harness, which is
 * about forty lines and is why no library was added for it. `act` is the part
 * that matters: it flushes the effects and the state updates a mount or a
 * re-render queued, so a test can assert on what the effects did rather than on
 * what the render returned. Without it every effect in this package (the
 * renderer's creation, the overlay's registration, the subscription to the
 * graph) would run after the assertion that wanted it.
 *
 * **Every entry point is async, including the ones with nothing to await.**
 * `DagrCanvas` builds its renderer from a promise, so its mount is only settled
 * inside an ASYNC `act`, and a harness with a sync `mount` and an async
 * `mountAsync` would make "which one does this test need" a question every test
 * has to answer correctly and silently gets wrong: a sync `act` leaves the
 * promise unsettled and the assertion reads a component that has not finished
 * mounting. One shape, awaited everywhere, has no such trap.
 *
 * `IS_REACT_ACT_ENVIRONMENT` is React's own switch for this and it warns
 * loudly when `act` is used without it, so it is set here once rather than
 * per file.
 */

import type { ReactNode } from 'react';
import { Component, act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A mounted tree, and the two things a test does to one. */
export interface Mounted {
  /** The element the tree was rendered into, attached to the document. */
  readonly container: HTMLElement;
  /** Renders `node` into the same root, which is what a prop change is. */
  rerender(node: ReactNode): Promise<void>;
  /** Unmounts and detaches, so the cleanup functions run. Idempotent. */
  unmount(): Promise<void>;
}

/** What a test may want to know about beyond the tree itself. */
export interface MountOptions {
  /**
   * Called instead of React's own handling for an error thrown out of a render.
   *
   * React 19 takes this as a root option, which is what makes "this component
   * throws" a testable claim rather than an unhandled rejection landing in a
   * task nobody is awaiting. Without it, the default handler rethrows outside
   * the `act` that caused it and the assertion runs against a tree that is
   * half torn down.
   */
  readonly onError?: (error: unknown) => void;
}

/** Mounts `node` into a fresh container attached to the document body. */
export async function mount(node: ReactNode, options: MountOptions = {}): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const onError = options.onError;
  const root =
    onError === undefined
      ? createRoot(container)
      : createRoot(container, { onUncaughtError: onError, onCaughtError: onError });
  await act(async () => {
    root.render(node);
  });

  let live = true;
  return {
    container,
    async rerender(next: ReactNode): Promise<void> {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount(): Promise<void> {
      if (!live) return;
      live = false;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Runs `body` inside `act`, for a mutation whose effects a test wants flushed. */
export async function flush(body: () => void = () => undefined): Promise<void> {
  await act(async () => {
    body();
  });
}

/** What a component threw, and the tree that survived it. */
export interface Caught {
  readonly tree: Mounted;
  /** Every error a boundary caught, in the order they were thrown. */
  readonly errors: unknown[];
}

interface BoundaryProps {
  readonly onError: (error: unknown) => void;
  readonly children?: ReactNode;
}

/**
 * The only class component in this package, and it has to be one.
 *
 * There is still no hook that catches a render error: `componentDidCatch` and
 * `getDerivedStateFromError` are the whole API and both are class methods. A
 * root's `onUncaughtError` is not a substitute, which this file learned by
 * trying it first: React reports through it AND rethrows out of the `act` that
 * caused the render, so the assertion never runs.
 */
class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Mounts `node` under an error boundary, collecting whatever it throws. */
export async function mountCatching(node: ReactNode): Promise<Caught> {
  const errors: unknown[] = [];
  const record = (error: unknown): void => {
    errors.push(error);
  };
  // The root handler as well as the boundary: the boundary is what keeps the
  // error out of `act`, and the root option is what keeps React's own report
  // of it out of the test output.
  const tree = await mount(<Boundary onError={record}>{node}</Boundary>, { onError: record });
  return { tree, errors };
}
