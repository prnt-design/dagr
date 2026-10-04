/**
 * The default base layer: marks, edges and group outlines as one SVG.
 *
 * It sits inside the transformed plane, in world coordinates, so the camera
 * never touches it: a pan or a zoom is the plane's transform and nothing
 * here. It renders when the visible set or the emphasis changes, which is
 * when the viewport hands it a new prop, and at no other time.
 *
 * It is decoration for sighted users, so it is `aria-hidden`. Every node a
 * user can reach is reachable through the overlay and search, and a mark
 * is clicked through the viewport's delegated listener, which resolves the
 * point against the layout rather than against these elements.
 *
 * **One arrowhead marker per edge color.** An SVG marker cannot take the
 * stroke of the path that uses it without `context-stroke`, which not every
 * browser this package supports draws. So the arrowhead for a red edge is a
 * red marker, and the markers are as many as the colors in view.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import { useId, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ExplorerBase, ExplorerBaseProps } from './base.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';

const DEFAULT_COLOR = 'currentColor';
const DASH = '6 4';

/** `useId` output is not a valid fragment in every React (`:r1:`, `«r1»`), so keep word characters only. */
function fragmentOf(id: string): string {
  return `dagr-explorer-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

function SvgBaseLayer({
  view,
  layout,
  visible,
  emphasis,
}: ExplorerBaseProps<ExplorerNode, ExplorerEdge>): ReactElement {
  const prefix = fragmentOf(useId());
  const nodes = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view.nodes]);
  const edges = useMemo(() => new Map(view.edges.map((edge) => [edge.id, edge])), [view.edges]);

  const markers = new Map<string, string>();
  const markerFor = (color: string): string => {
    let id = markers.get(color);
    if (id === undefined) {
      id = `${prefix}-arrow-${String(markers.size)}`;
      markers.set(color, id);
    }
    return id;
  };

  const paths: ReactElement[] = [];
  for (const id of visible.edges) {
    const edge = edges.get(id);
    const route = layout.routes.get(id);
    const first = route?.[0];
    if (edge === undefined || route === undefined || first === undefined) continue;
    const d = route.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(p.x)} ${String(p.y)}`).join(' ');
    const color = edge.color ?? DEFAULT_COLOR;
    const dimmed = emphasis.dimmed.has(edge.source) || emphasis.dimmed.has(edge.target);
    paths.push(
      <path
        key={id}
        data-edge-id={id}
        data-dimmed={dimmed ? 'true' : undefined}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={edge.dash === true ? DASH : undefined}
        markerEnd={`url(#${markerFor(color)})`}
      />,
    );
  }

  const marks: ReactElement[] = [];
  for (const id of visible.baseNodes) {
    const node = nodes.get(id);
    const box = layout.boxes.get(id);
    if (node === undefined || box === undefined) continue;
    marks.push(
      <rect
        key={id}
        data-node-id={id}
        data-dimmed={emphasis.dimmed.has(id) ? 'true' : undefined}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={4}
        fill={node.color ?? DEFAULT_COLOR}
      />,
    );
  }

  const groups: ReactElement[] = [];
  for (const group of view.groups ?? []) {
    const box = layout.groups.get(group.id);
    if (box === undefined) continue;
    const color = group.color ?? DEFAULT_COLOR;
    groups.push(
      <g key={group.id} data-group-id={group.id}>
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          rx={8}
          fill="none"
          stroke={color}
          strokeDasharray="4 4"
        />
        <text x={box.x + 12} y={box.y + 17} fill={color} fontSize={12}>
          {group.label}
        </text>
      </g>,
    );
  }

  return (
    <svg
      aria-hidden="true"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <defs>
        {[...markers].map(([color, id]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX={10}
            refY={5}
            markerWidth={8}
            markerHeight={8}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" fill={color} />
          </marker>
        ))}
      </defs>
      {groups}
      {paths}
      {marks}
    </svg>
  );
}

export const svgBase: ExplorerBase = Object.freeze({ Layer: SvgBaseLayer, space: 'plane' });
