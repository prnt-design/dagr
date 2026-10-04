import { useExplorerContext } from './context.js';
import type { ExplorerState } from './context.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';

/**
 * The explorer's state and methods, for a part of the host's own. It is what
 * the built-in parts read and call, so a custom part can do what they do.
 *
 * `N` and `E` are a claim about the root's data that nothing checks: a
 * context erases type parameters. They default to the base types, so an
 * unannotated call sees only the fields the explorer guarantees.
 *
 * @throws {ExplorerContextError} `OUTSIDE_EXPLORER` outside an `ExplorerRoot`.
 */
export function useExplorer<
  N extends ExplorerNode = ExplorerNode,
  E extends ExplorerEdge = ExplorerEdge,
>(): ExplorerState<N, E> {
  return useExplorerContext('useExplorer()').state as unknown as ExplorerState<N, E>;
}
