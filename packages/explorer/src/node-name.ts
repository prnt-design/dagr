import type { ExplorerGroup, ExplorerNode } from './types.js';

/** Each node id's groups, in group order, each group once per node. */
export function groupsByNode(groups: readonly ExplorerGroup[] | undefined): Map<string, ExplorerGroup[]> {
  const map = new Map<string, ExplorerGroup[]>();
  for (const group of groups ?? []) {
    for (const id of new Set(group.nodeIds)) {
      const list = map.get(id);
      if (list === undefined) map.set(id, [group]);
      else list.push(group);
    }
  }
  return map;
}

/** A node's default accessible name: its label, then `inGroup(group)` for each group. */
export function defaultNodeName(
  node: ExplorerNode,
  groups: readonly ExplorerGroup[],
  inGroup: (groupLabel: string) => string,
): string {
  return [node.label, ...groups.map((group) => inGroup(group.label))].join(', ');
}
