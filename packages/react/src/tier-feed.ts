import type { RichNodes, SceneNode } from '@prnt/dagr-render';

/**
 * Feeds a scene's nodes to rich-node tiers, touching only what changed.
 *
 * An animated frame used to rebuild a record, a bounds box and a `nodeData`
 * call for every node, thousands of times a second at 10,000 nodes, to move the
 * handful that were actually in motion. Two entry points split that:
 *
 * - {@link TierFeed.full} replaces the node set (additions, removals, every
 *   box) and is for a new layout and for the frame an animation settles on,
 *   the one frame on which departed nodes must go.
 * - {@link TierFeed.step} registers or moves only the nodes whose box differs
 *   from the last one fed, and never removes. It allocates nothing for a node
 *   that stood still.
 *
 * `nodeData` is called once per node id and kept, until {@link TierFeed.invalidate}
 * says the function itself changed, so a per-frame step never calls it for a
 * node it has seen.
 */
export interface TierFeed {
  full(nodes: readonly SceneNode[]): void;
  step(nodes: readonly SceneNode[]): void;
  /** Forget cached data, because `nodeData` is a different function now. */
  invalidate(): void;
}

interface Fed {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  data: unknown;
}

/** Creates a feed over `rich`. `dataOf` is read at call time, so it may change. */
export function createTierFeed(
  rich: RichNodes<unknown>,
  dataOf: () => ((nodeId: string) => unknown) | undefined,
): TierFeed {
  const fed = new Map<string, Fed>();

  const dataFor = (id: string, previous: Fed | undefined): unknown => {
    if (previous !== undefined) return previous.data;
    const produce = dataOf();
    return produce === undefined ? id : produce(id);
  };

  return {
    full(nodes) {
      const next = new Map<string, Fed>();
      const records = nodes.map((node) => {
        const box = {
          minX: node.center.x - node.size.width / 2,
          maxX: node.center.x + node.size.width / 2,
          minY: node.center.y - node.size.height / 2,
          maxY: node.center.y + node.size.height / 2,
        };
        const data = dataFor(node.id, fed.get(node.id));
        next.set(node.id, { ...box, data });
        return { id: node.id, bounds: box, data };
      });
      rich.setNodes(records);
      fed.clear();
      for (const [id, entry] of next) fed.set(id, entry);
    },
    step(nodes) {
      for (const node of nodes) {
        const minX = node.center.x - node.size.width / 2;
        const maxX = node.center.x + node.size.width / 2;
        const minY = node.center.y - node.size.height / 2;
        const maxY = node.center.y + node.size.height / 2;
        const previous = fed.get(node.id);
        if (
          previous !== undefined &&
          previous.minX === minX &&
          previous.maxX === maxX &&
          previous.minY === minY &&
          previous.maxY === maxY
        ) {
          continue;
        }
        const data = dataFor(node.id, previous);
        fed.set(node.id, { minX, minY, maxX, maxY, data });
        rich.setNode({ id: node.id, bounds: { minX, minY, maxX, maxY }, data });
      }
    },
    invalidate() {
      fed.clear();
    },
  };
}
