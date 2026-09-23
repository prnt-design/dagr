import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

export const SOURCE = 'https://github.com/prnt-design/dagr/blob/main/';
export const systems = [
  {
    id: 'graph',
    name: 'Graph model',
    role: 'MODEL',
    color: 'violet',
    summary: 'Identity, attributes, ports.',
    detail:
      'Your application owns the meaning of each node. Graph stores stable IDs, attributes and typed patches. A batch publishes one patch for a group of edits.',
    file: 'packages/graph/src/graph.ts',
    api: 'Graph · Patch',
    docs: '/docs/graph-model',
    facts: [
      'Stable node and edge IDs',
      'Batched mutations with inverses',
      'No rendering dependency',
    ],
  },
  {
    id: 'layout',
    name: 'Layout engine',
    role: 'LAYOUT',
    color: 'green',
    summary: 'Structure becomes geometry.',
    detail:
      'Ranking, crossing reduction, positioning and routing turn a graph into node boxes and edge paths. The incremental engine retains previous state and reports a LayoutDelta alongside the new result.',
    file: 'packages/layout/src/engine.ts',
    api: 'LayoutResult · LayoutDelta',
    docs: '/docs/incremental-layout',
    facts: [
      'Headless, swappable stages',
      'Warm-started layout',
      'Stability varies with the edit and graph',
    ],
  },
  {
    id: 'scene',
    name: 'Scene adapter',
    role: 'REACT',
    color: 'rust',
    summary: 'Geometry meets appearance.',
    detail:
      'The React adapter converts layout coordinates into renderer coordinates and applies your node and edge appearance callbacks. DagrCanvas coordinates the layout, renderer and overlay lifecycles.',
    file: 'packages/react/src/scene.ts',
    api: 'SceneNode · SceneEdge',
    docs: '/docs/react',
    facts: [
      'Layout y-down becomes world y-up',
      'Appearance is supplied by the application',
      'Geometry stays owned by the layout',
    ],
  },
  {
    id: 'motion',
    name: 'Scene motion',
    role: 'ANIMATION',
    color: 'rust',
    summary: 'One coherent transition.',
    detail:
      'Critically damped springs move nodes, edge routes and bounds together. The React adapter checks delta continuity and reseats the scene when intermediate layouts were skipped.',
    file: 'packages/render/src/scene-motion.ts',
    api: 'SceneMotionFrame',
    docs: '/docs/react',
    facts: [
      'Opt-in animation',
      'Retargetable spring motion',
      'Nodes and edges share the transition',
    ],
  },
  {
    id: 'renderer',
    name: 'GPU renderer',
    role: 'RENDER',
    color: 'green',
    summary: 'Instances, shapes, ribbons.',
    detail:
      'The renderer draws instanced signed-distance-field node shapes and edge ribbons through three.js. Backend selection supports WebGPU and a WebGL2 fallback. Hardware performance requires hardware measurements.',
    file: 'packages/render/src/webgpu-renderer.ts',
    api: 'Renderer',
    docs: '/docs/render',
    facts: [
      'Instanced node geometry',
      'Ribbon edge groups',
      'WebGPU with WebGL2 fallback',
    ],
  },
  {
    id: 'html',
    name: 'HTML overlay',
    role: 'CONTENT',
    color: 'violet',
    summary: 'Real content in graph space.',
    detail:
      'HTML content is positioned over the canvas in world coordinates. React Html mounts components through portals; createRichNodes provides pooled, zoom-dependent content for larger scenes.',
    file: 'packages/render/src/html-overlay.ts',
    api: 'Html · createRichNodes',
    docs: '/docs/rich-content',
    facts: [
      'DOM content and accessible controls',
      'Viewport and zoom visibility gates',
      'Use pooled content for large graphs',
    ],
  },
] as const;
export type SystemId = (typeof systems)[number]['id'];
export const connections: {
  source: SystemId;
  target: SystemId;
  label: string;
  detail: string;
}[] = [
  {
    source: 'graph',
    target: 'layout',
    label: 'Patch',
    detail:
      'The React hook subscribes to graph patches and asks the layout engine to relayout.',
  },
  {
    source: 'layout',
    target: 'scene',
    label: 'LayoutResult',
    detail: 'Node boxes and routed edges become scene geometry.',
  },
  {
    source: 'scene',
    target: 'motion',
    label: 'Scene + delta',
    detail:
      'The adapter converts layout deltas into motion targets when animation is enabled.',
  },
  {
    source: 'motion',
    target: 'renderer',
    label: 'Frame',
    detail: 'Animated node and edge geometry is uploaded before drawing.',
  },
  {
    source: 'layout',
    target: 'html',
    label: 'Placement',
    detail:
      'Layout boxes anchor rich content. A caller can also place annotations in world coordinates.',
  },
];

/** A source-derived runtime overview, not a package dependency graph. */
export function architectureLayout() {
  const graph = new Graph();
  for (const node of systems) graph.addNode({ id: node.id });
  for (const [index, edge] of connections.entries())
    graph.addEdge({
      id: `flow-${index}`,
      source: edge.source,
      target: edge.target,
    });
  // Transpose the output for a left-to-right view. Sizes are transposed too.
  return layout({
    graph,
    config: {
      defaultNodeSize: { width: 148, height: 178 },
      nodeSep: 65,
      rankSep: 180,
    },
  });
}
