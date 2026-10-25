import type { ResolvedLayoutConfig } from './config.js';
import type { LayoutNodeState, LayoutState } from './state.js';

/**
 * Assign `rank` to every node.
 *
 * A real implementation breaks cycles first and then ranks (roadmap M2.2
 * and M2.3). Stages mutate `state` in place and return nothing.
 */
export interface RankStage {
  (state: LayoutState, config: ResolvedLayoutConfig): void;
}

/**
 * Assign `order`, the position of a node inside its rank, to every node.
 *
 * A real implementation minimises edge crossings (roadmap M2.5 and M2.6).
 */
export interface OrderStage {
  (state: LayoutState, config: ResolvedLayoutConfig): void;
}

/**
 * Assign `x` and `y` (node centers) to every node, honoring the config
 * spacings, margins and rank direction.
 *
 * A real implementation aligns nodes across ranks (roadmap M2.7).
 */
export interface PositionStage {
  (state: LayoutState, config: ResolvedLayoutConfig): void;
}

/**
 * Fill in `points` for every edge, source end first.
 *
 * A real implementation routes through dummy-node coordinates (roadmap
 * M2.8).
 */
export interface RouteStage {
  (state: LayoutState, config: ResolvedLayoutConfig): void;
}

/** The four pipeline stages, in the order the runner calls them. */
export interface LayoutStages {
  readonly rank: RankStage;
  readonly order: OrderStage;
  readonly position: PositionStage;
  readonly route: RouteStage;
}

/**
 * Pass-through ranking: everything lands on rank 0.
 *
 * Placeholder until roadmap M2.2 lands cycle breaking and longest-path
 * ranking.
 */
export const defaultRankStage: RankStage = (state) => {
  for (const node of state.nodes) {
    node.rank = 0;
  }
};

/**
 * Pass-through ordering: inside each rank, nodes keep their input order.
 *
 * Placeholder until roadmap M2.5 lands barycenter ordering.
 */
export const defaultOrderStage: OrderStage = (state) => {
  const nextOrder = new Map<number, number>();
  for (const node of state.nodes) {
    const rank = node.rank ?? 0;
    const order = nextOrder.get(rank) ?? 0;
    node.order = order;
    nextOrder.set(rank, order + 1);
  }
};

/** Group nodes by rank, each bucket kept in input order. */
function bucketByRank(nodes: readonly LayoutNodeState[]): Map<number, LayoutNodeState[]> {
  const byRank = new Map<number, LayoutNodeState[]>();
  for (const node of nodes) {
    const rank = node.rank ?? 0;
    const bucket = byRank.get(rank);
    if (bucket === undefined) {
      byRank.set(rank, [node]);
    } else {
      bucket.push(node);
    }
  }
  return byRank;
}

/**
 * Pass-through positioning: each rank becomes one line of nodes.
 *
 * Nodes inside a rank are packed in `order`, separated by `nodeSpacing`,
 * and centered in their rank band. Ranks are stacked along the rank axis,
 * separated by `rankSpacing`, running down for `TB`, up for `BT`, right
 * for `LR` and left for `RL`. Content starts at (`marginX`, `marginY`).
 *
 * There is no cross-rank alignment and no crossing reduction here: that is
 * roadmap M2.7.
 */
export const defaultPositionStage: PositionStage = (state, config) => {
  const vertical = config.rankDir === 'TB' || config.rankDir === 'BT';
  const flipped = config.rankDir === 'BT' || config.rankDir === 'RL';

  const byRank = bucketByRank(state.nodes);
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  if (flipped) {
    ranks.reverse();
  }

  let rankCursor = 0;
  for (const rank of ranks) {
    const bucket = byRank.get(rank) ?? [];
    const inRank = [...bucket].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let bandExtent = 0;
    for (const node of inRank) {
      bandExtent = Math.max(bandExtent, vertical ? node.height : node.width);
    }
    const rankCenter = rankCursor + bandExtent / 2;

    let crossCursor = 0;
    for (const node of inRank) {
      const crossSize = vertical ? node.width : node.height;
      const crossCenter = crossCursor + crossSize / 2;
      node.x = config.marginX + (vertical ? crossCenter : rankCenter);
      node.y = config.marginY + (vertical ? rankCenter : crossCenter);
      crossCursor += crossSize + config.nodeSpacing;
    }

    rankCursor += bandExtent + config.rankSpacing;
  }
};

/**
 * Pass-through routing: a straight two point line from the source node
 * center to the target node center.
 *
 * A self loop routes as a degenerate two point line, both points at the
 * node center, so a route always has exactly two points and consumers
 * never have to special case an empty route. Roadmap M2.8 replaces this
 * with polylines through dummy-node coordinates.
 */
export const defaultRouteStage: RouteStage = (state) => {
  for (const edge of state.edges) {
    const source = state.nodesById.get(edge.source);
    const target = state.nodesById.get(edge.target);
    edge.points = [
      { x: source?.x ?? 0, y: source?.y ?? 0 },
      { x: target?.x ?? 0, y: target?.y ?? 0 },
    ];
  }
};

/**
 * The pass-through stage bundle the runner falls back to.
 *
 * Every stage is individually exported too, so a caller can keep three
 * defaults and replace the fourth.
 */
export const defaultStages: LayoutStages = {
  rank: defaultRankStage,
  order: defaultOrderStage,
  position: defaultPositionStage,
  route: defaultRouteStage,
};
