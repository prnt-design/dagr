import type { HtmlOverlay, OverlayEntry } from './html-overlay.js';
import type { OverlayPlacement } from './overlay-math.js';
import type { WorldBounds } from './types.js';

/**
 * Rich nodes: a node's visual as arbitrary HTML sized to its layout box, with
 * semantic zoom.
 *
 * **Tiers are gates, not a third concept, and that is the whole design.** A
 * node registers ONE OVERLAY ENTRY PER TIER, all with the same bounds and
 * adjacent half-open gates, so at most one of them is ever visible and the
 * bottom tier is the ABSENCE of an entry, which is the GPU drawing the shape.
 * The campaign demo's three tiers (instanced shape below about 24 CSS pixels, a
 * title label to about 160, a full card above) fall out of `html-overlay.ts`
 * with no level-of-detail machinery anywhere in it.
 *
 * What is left for this file is bookkeeping, and it is worth being clear that
 * it is only bookkeeping: a pool per tier, a diff by id, and the rule for when
 * an element that is already on screen has to be told its data changed.
 */

/** One node: where it is, and whatever the caller's tiers render. */
export interface RichNode<T> {
  readonly id: string;

  /** The node's box in world units, which every tier shares. */
  readonly bounds: WorldBounds;

  /** Whatever `update` needs. Compared by REFERENCE: see {@link RichNodes.setNodes}. */
  readonly data: T;
}

/**
 * One tier: a gate, and how to build and fill an element for it.
 *
 * **`create` and `update` are separate so that elements can be pooled.** A card
 * scrolling out of view goes back to its tier's pool and the next node to reach
 * card tier gets that element with new content, rather than a fresh DOM subtree
 * per pop-in. If they were one function, every element leaving the view would
 * throw away a subtree and every element entering would build one, which at a
 * pan across a dense graph is the whole cost of the feature.
 *
 * `create` is therefore expected to build a BLANK element of this tier's shape,
 * and `update` to put one node's content into it. An `update` that only adds is
 * a bug that shows up as a card with the previous node's fields still in it.
 */
export interface RichNodeTier<T> {
  /** For a caller's own debugging. Not read by this module. */
  readonly name: string;

  /** The smallest screen width, in CSS pixels, at which this tier shows. */
  readonly minScreenWidth?: number;

  /** Where it stops showing, exclusive, so adjacent tiers cannot overlap. */
  readonly maxScreenWidth?: number;

  /** A blank element of this tier's shape. */
  create(): HTMLElement;

  /** Puts one node's content into an element from {@link create}. */
  update(element: HTMLElement, node: RichNode<T>): void;

  /** Whether this tier's elements take pointer events. Default false. */
  readonly interactive?: boolean;
}

/** What {@link createRichNodes} returns. */
export interface RichNodes<T> {
  /**
   * Replaces the node set, diffing by id.
   *
   * A node that is new registers its entries; one that is gone has its entries
   * removed and its element returned to the pool; one whose `bounds` changed is
   * re-placed, so a relayout moves boxes without rebuilding anything.
   *
   * **A node whose `data` is not the SAME REFERENCE as last time has `update`
   * called on it, if it currently has an element on screen.** Reference
   * equality rather than a deep comparison, because a deep comparison of
   * arbitrary card data is neither cheap nor decidable, and this runs over
   * every node. A caller who mutates `data` in place gets no re-render, on the
   * same terms as every other one-way data flow in this project.
   */
  setNodes(nodes: Iterable<RichNode<T>>): void;

  /** How many nodes are registered. Not how many are on screen. */
  readonly nodeCount: number;

  /** Removes every entry. The overlay itself is the caller's to dispose. */
  dispose(): void;
}

/** What this module tracks for one node's one tier. */
interface TierState {
  readonly entry: OverlayEntry;

  /**
   * The element the overlay is currently showing for this tier, or `null`.
   *
   * Tracked here rather than asked of the overlay, because this module is the
   * one that makes the elements: `create` and `release` are its own callbacks,
   * so it knows without the overlay having to expose an element that the
   * caller would then be able to reposition behind its back.
   */
  element: HTMLElement | null;
}

/** What this module tracks for one node. */
interface NodeState<T> {
  node: RichNode<T>;
  readonly tiers: TierState[];
}

/** The box placement for one node in one tier, gates included. */
function placementFor<T>(bounds: WorldBounds, tier: RichNodeTier<T>): OverlayPlacement {
  return {
    kind: 'box',
    bounds,
    ...(tier.minScreenWidth === undefined ? {} : { minScreenWidth: tier.minScreenWidth }),
    ...(tier.maxScreenWidth === undefined ? {} : { maxScreenWidth: tier.maxScreenWidth }),
  };
}

/** Whether two boxes are the same box. */
function sameBounds(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/**
 * Binds a set of nodes to an overlay, one entry per node per tier.
 *
 * ```ts
 * const nodes = createRichNodes({
 *   overlay,
 *   tiers: [
 *     { name: 'label', minScreenWidth: 24, maxScreenWidth: 160, create, update },
 *     { name: 'card', minScreenWidth: 160, create, update },
 *   ],
 * });
 * nodes.setNodes(graphNodes);
 * ```
 *
 * The pooling works because of an ordering guarantee in `html-overlay.ts` that
 * is worth naming here, since this module depends on it: one `sync()` DETACHES
 * everything that left the view before it CREATES anything that entered it. So
 * an element released this frame is already back in its pool when a new entry
 * asks for one, and a pan across a dense graph reuses elements instead of
 * allocating a subtree per node it crosses.
 *
 * @throws {RangeError} when `tiers` is empty, since a node with no tier has no
 * visual at any zoom and the more likely cause is a list that was filtered to
 * nothing rather than a caller who meant it.
 */
export function createRichNodes<T>(options: {
  readonly overlay: HtmlOverlay;
  readonly tiers: readonly RichNodeTier<T>[];
}): RichNodes<T> {
  const { overlay, tiers } = options;
  if (tiers.length === 0) {
    throw new RangeError('tiers has to name at least one tier, got an empty list');
  }

  /** One pool per tier, by tier index. Elements a tier built and got back. */
  const pools: HTMLElement[][] = tiers.map(() => []);
  const nodes = new Map<string, NodeState<T>>();

  const register = (node: RichNode<T>): NodeState<T> => {
    const state: NodeState<T> = { node, tiers: [] };
    for (const [index, tier] of tiers.entries()) {
      const pool = pools[index];
      const tierState: TierState = {
        element: null,
        entry: overlay.add({
          placement: placementFor(node.bounds, tier),
          create: () => {
            // The pool is the reason `create` and `update` are separate. A
            // recycled element is filled with THIS node's content before the
            // overlay attaches it, so a card never flashes the previous node's
            // fields for a frame.
            const element = pool?.pop() ?? tier.create();
            tier.update(element, state.node);
            tierState.element = element;
            return element;
          },
          release: (element) => {
            tierState.element = null;
            pool?.push(element);
          },
          ...(tier.interactive === undefined ? {} : { interactive: tier.interactive }),
        }),
      };
      state.tiers.push(tierState);
    }
    return state;
  };

  let disposed = false;

  return {
    setNodes(incoming: Iterable<RichNode<T>>): void {
      if (disposed) return;

      const seen = new Set<string>();
      for (const node of incoming) {
        seen.add(node.id);
        const existing = nodes.get(node.id);
        if (existing === undefined) {
          nodes.set(node.id, register(node));
          continue;
        }

        const boundsChanged = !sameBounds(existing.node.bounds, node.bounds);
        const dataChanged = existing.node.data !== node.data;
        existing.node = node;

        for (const [index, tierState] of existing.tiers.entries()) {
          const tier = tiers[index];
          if (tier === undefined) continue;
          if (boundsChanged) tierState.entry.place(placementFor(node.bounds, tier));
          // Only what is on screen is re-rendered. An element that is not
          // attached will be filled by `create` from the node's current data
          // whenever it next appears, so updating it here would be work nobody
          // can see, once per node per tier, on every call.
          if (dataChanged && tierState.element !== null) {
            tier.update(tierState.element, node);
          }
        }
      }

      for (const [id, state] of nodes) {
        if (seen.has(id)) continue;
        for (const tierState of state.tiers) tierState.entry.remove();
        nodes.delete(id);
      }
    },

    get nodeCount(): number {
      return nodes.size;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const state of nodes.values()) {
        for (const tierState of state.tiers) tierState.entry.remove();
      }
      nodes.clear();
      for (const pool of pools) pool.length = 0;
    },
  };
}
