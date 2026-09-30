import type { Camera2D } from './camera.js';
import type { SceneNode } from './scene-nodes.js';
import type { WorldBounds } from './types.js';
import { requireColor, requireFinite, requireNonNegative } from './validate.js';

/** A visual annotation. Membership does not change layout or enforce security. */
export interface NodeGroup {
  readonly id: string;
  readonly nodeIds: readonly string[];
  readonly label?: string;
  /** Space around member boxes in world units. Default 24. */
  readonly padding?: number;
  /** Boundary and label color as 0xRRGGBB. Default 0x8b78dc. */
  readonly color?: number;
}

export type NodeGroupMember = Pick<SceneNode, 'id' | 'center' | 'size'>;

function validateGroup(group: NodeGroup): void {
  requireNonNegative(group.padding ?? 24, `group(${group.id}).padding`);
  requireColor(group.color ?? 0x8b78dc, `group(${group.id}).color`);
}

function boundsOf(
  nodes: ReadonlyMap<string, NodeGroupMember>,
  group: NodeGroup,
): WorldBounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of group.nodeIds) {
    const node = nodes.get(id);
    if (!node) continue;
    minX = Math.min(minX, node.center.x - node.size.width / 2);
    maxX = Math.max(maxX, node.center.x + node.size.width / 2);
    minY = Math.min(minY, node.center.y - node.size.height / 2);
    maxY = Math.max(maxY, node.center.y + node.size.height / 2);
  }
  if (minX === Infinity) return null;
  const padding = group.padding ?? 24;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding + (group.label ? 24 : 0),
  };
}

function indexNodes(
  nodes: Iterable<NodeGroupMember>,
  members?: ReadonlySet<string>,
): Map<string, NodeGroupMember> {
  const result = new Map<string, NodeGroupMember>();
  for (const node of nodes) {
    if (members && !members.has(node.id)) continue;
    if (result.has(node.id)) throw new RangeError(`duplicate node id: ${node.id}`);
    requireFinite(node.center.x, `node(${node.id}).center.x`);
    requireFinite(node.center.y, `node(${node.id}).center.y`);
    requireNonNegative(node.size.width, `node(${node.id}).size.width`);
    requireNonNegative(node.size.height, `node(${node.id}).size.height`);
    result.set(node.id, { id: node.id, center: { ...node.center }, size: { ...node.size } });
  }
  return result;
}

/** Padded y-up bounds, including a 24-world-unit title band. Missing members are ignored; empty groups return null. */
export function nodeGroupBounds(
  nodes: Iterable<NodeGroupMember>,
  group: NodeGroup,
): WorldBounds | null {
  validateGroup(group);
  return boundsOf(indexNodes(nodes), group);
}

export interface NodeGroupLayer {
  /** Replaces annotations atomically. IDs must be unique. Call setNodes after changing membership. */
  setGroups(groups: readonly NodeGroup[]): void;
  /** Supply positions after setGroups and on each drawn frame. Only member geometry is retained and validated. */
  setNodes(nodes: Iterable<NodeGroupMember>): void;
  /** Synchronize after camera or node changes, from the host's existing draw loop. */
  sync(): void;
  dispose(): void;
}

/**
 * A transparent SVG annotation layer for tens of groups. Mount after the canvas
 * and before rich-node overlays. The parent must share the camera viewport's
 * padding box and establish a containing block, like createHtmlOverlay.
 * No fill or pointer interception: routes and node controls remain visible.
 */
export function createNodeGroupLayer(options: {
  parent: HTMLElement;
  camera: Camera2D;
}): NodeGroupLayer {
  const { parent, camera } = options;
  const document = parent.ownerDocument;
  if (!parent.isConnected || document.defaultView?.getComputedStyle(parent).position === 'static') {
    throw new RangeError('node group parent must be connected and positioned');
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'dagr-node-groups');
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'none',
    userSelect: 'none',
  });
  parent.appendChild(svg);
  let nodes = new Map<string, NodeGroupMember>();
  let members = new Set<string>();
  let entries: {
    group: NodeGroup;
    element: SVGGElement;
    rect: SVGRectElement;
    text: SVGTextElement;
  }[] = [];
  let disposed = false;
  const live = () => {
    if (disposed) throw new Error('node group layer is disposed');
  };
  return {
    setGroups(groups) {
      live();
      const ids = new Set<string>();
      for (const group of groups) {
        validateGroup(group);
        if (ids.has(group.id)) throw new RangeError(`duplicate group id: ${group.id}`);
        ids.add(group.id);
      }
      members = new Set(groups.flatMap((group) => [...group.nodeIds]));
      nodes.clear();
      entries = groups.map((input) => {
        const group = { ...input, nodeIds: [...input.nodeIds] };
        const element = document.createElementNS(ns, 'g');
        element.setAttribute('data-group-id', group.id);
        const color = `#${(group.color ?? 0x8b78dc).toString(16).padStart(6, '0')}`;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '6 5');
        const text = document.createElementNS(ns, 'text');
        text.textContent = group.label ?? '';
        text.setAttribute('fill', color);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'ui-monospace, monospace');
        element.append(rect, text);
        element.setAttribute('display', 'none');
        return { group, element, rect, text };
      });
      svg.replaceChildren(...entries.map((entry) => entry.element));
    },
    setNodes(value) {
      live();
      nodes = indexNodes(value, members);
    },
    sync() {
      live();
      for (const { group, element, rect, text } of entries) {
        const bounds = boundsOf(nodes, group);
        if (!bounds) {
          element.setAttribute('display', 'none');
          continue;
        }
        const top = camera.worldToScreen({ x: bounds.minX, y: bounds.maxY });
        const bottom = camera.worldToScreen({ x: bounds.maxX, y: bounds.minY });
        const width = bottom.x - top.x,
          height = bottom.y - top.y;
        const visible =
          bottom.x >= 0 &&
          bottom.y >= 0 &&
          top.x <= camera.viewport.width &&
          top.y <= camera.viewport.height;
        element.setAttribute('display', visible ? '' : 'none');
        rect.setAttribute('x', String(top.x));
        rect.setAttribute('y', String(top.y));
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', String(Math.min(10, 10 * camera.zoom)));
        text.setAttribute('x', String(top.x + 12));
        text.setAttribute('y', String(top.y + 18));
        // Hide titles when their reserved band is too small; never draw over nodes.
        text.setAttribute(
          'display',
          (24 + (group.padding ?? 24)) * camera.zoom >= 22 &&
            width >= (group.label?.length ?? 0) * 8 + 24
            ? ''
            : 'none',
        );
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      svg.remove();
      entries = [];
      nodes.clear();
      members.clear();
    },
  };
}
