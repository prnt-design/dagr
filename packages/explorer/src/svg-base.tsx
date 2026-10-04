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
 * **A marker's id is its color, escaped.** Ids live in the document, not
 * in a React root, and two roots (two explorers, or two copies of React)
 * can count `useId` the same way. Named by color, a marker one root reaches
 * in another root's tree is the same arrowhead.
 *
 * **Strokes keep their width at any zoom** (`vector-effect`), so an edge
 * never thins to nothing zoomed out or thickens to a bar zoomed in.
 * Arrowheads are not strokes: the marker is in user space, so they scale
 * with the camera like the marks they point at.
 *
 * Internal to the package. Nothing here is exported from the entry.
 */

import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ExplorerBase, ExplorerBaseProps } from './base.js';
import type { ExplorerEdge, ExplorerNode } from './types.js';

const DEFAULT_COLOR = 'currentColor';
const DASH = '6 4';

/**
 * The marker id for a color: letters and digits as they are, and every other
 * character, `-` included, as `-<hex code point>-`. Escaped rather than
 * stripped, so two colors never share an id (`rgb(1, 23, 4)` and
 * `rgb(12, 3, 4)` strip to the same characters), and the result is a valid
 * `url(#...)` fragment for any CSS color.
 */
function markerIdOf(color: string): string {
  const escaped = color.replace(/[^A-Za-z0-9]/gu, (char) => `-${(char.codePointAt(0) ?? 0).toString(16)}-`);
  return `dagr-explorer-arrow-${escaped}`;
}

function SvgBaseLayer({
  view,
  layout,
  visible,
  emphasis,
}: ExplorerBaseProps<ExplorerNode, ExplorerEdge>): ReactElement {
  const nodes = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view.nodes]);
  const edges = useMemo(() => new Map(view.edges.map((edge) => [edge.id, edge])), [view.edges]);

  const markers = new Map<string, string>();
  const markerFor = (color: string): string => {
    let id = markers.get(color);
    if (id === undefined) {
      id = markerIdOf(color);
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
        vectorEffect="non-scaling-stroke"
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
          vectorEffect="non-scaling-stroke"
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
