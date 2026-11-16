import type {
  ExplorerEdge,
  ExplorerGroup,
  ExplorerNode,
  ExplorerView,
} from '@prnt/dagr-explorer';

export interface FrameworkNode extends ExplorerNode {
  readonly kind: 'package' | 'feature';
  readonly packageId: string;
  readonly group: string;
  readonly summary: string;
  readonly explanation: string;
  readonly example: string;
  readonly terms: string;
  readonly docs: string;
  readonly source: string;
  readonly status: string;
}
export interface FrameworkEdge extends ExplorerEdge {
  readonly relation: 'dependency' | 'peer' | 'provides' | 'uses';
}
const source = (path: string) =>
  `https://github.com/prnt-design/dagr/blob/main/${path}`;
export const categories = [
  { label: 'Foundations', members: ['graph', 'layout'], color: '#498c78' },
  { label: 'Rendering', members: ['render'], color: '#ac7733' },
  {
    label: 'Application surfaces',
    members: ['react', 'explorer', 'chart'],
    color: '#687dc2',
  },
  { label: 'Composition', members: ['vdsl', 'dagr'], color: '#a46a9c' },
] as const;
const packageNode = (
  id: string,
  label: string,
  summary: string,
  explanation: string,
  example: string,
  terms: string,
  docs: string,
): FrameworkNode => {
  const category = categories.find((group) =>
    (group.members as readonly string[]).includes(id),
  )!;
  return {
    id: `package:${id}`,
    label,
    kind: 'package',
    packageId: `package:${id}`,
    group: category.label,
    color: category.color,
    summary,
    explanation,
    example,
    terms,
    docs,
    source: source(`packages/${id}/README.md`),
    status:
      id === 'chart'
        ? 'Private workspace package, not published'
        : 'Published baseline: 0.1.4; details describe current source',
  };
};
export const packages: readonly FrameworkNode[] = [
  packageNode(
    'graph',
    'Graph',
    'Stable identity and observable patches.',
    'The headless directed graph model owns IDs, adjacency, attributes, ports, traversal, serialization and reversible patches. It has zero runtime dependencies. Keep one installed copy: Graph has nominal private fields. The parent field models acyclic containment; layout currently ignores it.',
    "graph.batch(() => graph.addNode('plan'))",
    'Graph PatchOp apply invert subscribe parent ports',
    '/docs/graph-model',
  ),
  packageNode(
    'layout',
    'Layout',
    'Geometry that follows graph edits.',
    'The headless Sugiyama pipeline returns node boxes and edge routes. createLayout retains stage state for patch-driven relayout and reports influence and absolute deltas. Stability trades against crossings; use the documented corpus for measurements. Graph is a required peer, not a bundled second copy.',
    'const engine = createLayout(); engine.run(graph); engine.relayout(patch)',
    'layout createLayout relayout delta incremental stability crossing worker serveLayout',
    '/docs/incremental-layout',
  ),
  packageNode(
    'render',
    'Render',
    'GPU drawing and spring motion.',
    'The full entry uses three.js WebGPURenderer, WebGPU with WebGL2 fallback, instanced marks, rich DOM overlays and scene springs. It accepts scene geometry, not Graph or LayoutResult, so there is no graph/layout package dependency. The /core entry provides camera, touch and edge-path mechanics without three.js. three is an optional manifest peer but required to import the full entry.',
    "import { Camera2D } from '@prnt/dagr-render/core'",
    'createRenderer createSceneMotion Camera2D createPinchGesture shapeEdgePath core full WebGPU WebGL2 three',
    '/docs/render',
  ),
  packageNode(
    'react',
    'React',
    'Graph, layout and GPU canvas together.',
    'DagrCanvas joins the graph model, incremental layout and renderer. Html places React content in world space; useDagr exposes layout and useGraphInteraction shares picking behavior. Current source includes GPU node picking and CPU edge hits. React and React DOM 19 are required, along with graph and render peers.',
    '<DagrCanvas graph={graph}><Html node="plan">Plan</Html></DagrCanvas>',
    'DagrCanvas Html useDagr useDagrCanvas useGraphInteraction picking edge hit navigation',
    '/docs/react',
  ),
  packageNode(
    'explorer',
    'Explorer',
    'Search, outline and connected details.',
    'DagrExplorer supplies views, shared search and selection, connection following, camera controls and adaptive details. This homepage uses it directly. The default drawing is SVG plus DOM, using renderer /core, never the GPU renderer or three.js. Current source includes the outline reader and shared touch navigation. Direct installs support React 18 and 19.',
    '<DagrExplorer label="My system" views={views} />',
    'DagrExplorer ExplorerOutline ExplorerDetails ExplorerSearch follow trace groups SVG DOM',
    '/docs/explorer',
  ),
  packageNode(
    'chart',
    'Chart',
    'Animated bars and lines, private today.',
    'DagrChart uses D3 scales and arrays for categorical bars, lines and dual axes, with a data table and tooltip. GPU drawing uses render; explicit SVG rendering is also available. This package is private and is not forwarded by the umbrella. Packed candidate checks do not mean it is published.',
    '<DagrChart label="Orders" categories={categories} series={series} />',
    'DagrChart layoutChart bar line dual axes D3 SVG tooltip table',
    source('packages/chart/README.md'),
  ),
  packageNode(
    'vdsl',
    'VDSL',
    'Typed node kinds and connection rules.',
    'defineRegistry adapts your node kinds, ports and configuration checks. The application supplies semantics and compatibility rules such as sameType. Graph is a types-only required peer; VDSL has no runtime dependencies. Validation does not provide an editor or automatic nested layout.',
    'registry.checkConnection(graph, proposal)',
    'defineRegistry sameType checkConfig checkConnection nodeInit typed ports validation',
    '/docs/vdsl',
  ),
  packageNode(
    'dagr',
    'Umbrella',
    'Convenient forwarding entry points.',
    'The @prnt/dagr root forwards Graph. Subpaths forward layout, render, render/core, react, vdsl and explorer. These six packages are manifest dependencies; forwarding is not a new rendering layer. Chart is excluded. The umbrella requires React 19; three is optional for core-only use and needed for full rendering.',
    "import { layout } from '@prnt/dagr/layout'",
    '@prnt/dagr umbrella exports forwarding subpath render/core',
    '/docs/',
  ),
];
const dependency = (
  from: string,
  to: string,
  relation: 'dependency' | 'peer',
  label: string = relation,
): FrameworkEdge => ({
  id: `${relation}:${from}:${to}`,
  source: `package:${from}`,
  target: `package:${to}`,
  relation,
  label,
  dash: relation === 'peer',
  color: relation === 'peer' ? '#a46a9c' : '#718491',
});
export const dependencies: readonly FrameworkEdge[] = [
  dependency('layout', 'graph', 'peer', 'required peer'),
  dependency('react', 'layout', 'dependency'),
  dependency('react', 'graph', 'peer', 'required peer'),
  dependency('react', 'render', 'peer', 'required peer'),
  dependency('explorer', 'graph', 'dependency'),
  dependency('explorer', 'layout', 'dependency'),
  dependency('explorer', 'render', 'dependency', 'dependency (core only)'),
  dependency('chart', 'render', 'dependency'),
  dependency('vdsl', 'graph', 'peer', 'types-only peer'),
  ...['graph', 'layout', 'render', 'react', 'vdsl', 'explorer'].map((id) =>
    dependency('dagr', id, 'dependency', 'dependency + forwards'),
  ),
];
const feature = (
  id: string,
  label: string,
  owner: string,
  summary: string,
  explanation: string,
  terms: string,
): FrameworkNode => {
  const pkg = packages.find((node) => node.id === `package:${owner}`)!;
  return {
    ...pkg,
    id: `feature:${id}`,
    label,
    kind: 'feature',
    summary,
    explanation,
    terms,
    example: pkg.example,
  };
};
export const features: readonly FrameworkNode[] = [
  feature(
    'identity',
    'Identity and patches',
    'graph',
    'Edits retain IDs and emit observable operations.',
    'Stable IDs connect model changes to layout and motion. batch emits one ordered patch; apply and invert support undo. PatchOp is an open union, so consumers need a default case.',
    'Graph batch subscribe PatchOp apply invert undo',
  ),
  feature(
    'stability',
    'Incremental layout',
    'layout',
    'Relayout only the affected stages and region.',
    'createLayout consumes patches and exposes stage execution, influence and absolute deltas. Absent means unchanged; removals precede additions. Stability and crossings are measured separately.',
    'createLayout relayout influence delta stability',
  ),
  feature(
    'motion',
    'GPU drawing and motion',
    'render',
    'Instanced shapes and springs retain visual identity.',
    'createRenderer draws scene data; createSceneMotion animates node positions, edge routes and bounds. Full drawing needs three.js. Core camera and path utilities can serve SVG/DOM hosts independently.',
    'createRenderer createSceneMotion createNodeMotion WebGPU WebGL2 springs',
  ),
  feature(
    'interaction',
    'Interaction and picking',
    'react',
    'Shared gestures, node picks and edge hits.',
    'DagrCanvas and useGraphInteraction join pointer and keyboard input with GPU node picking and CPU edge hit targets in current source. Renderer core supplies camera and pinch mechanics, also used by Explorer.',
    'useGraphInteraction GPU picking edge hit createPinchGesture navigation',
  ),
  feature(
    'reading',
    'Search, outline and details',
    'explorer',
    'Find a concept and follow its relationships.',
    'Map and outline share one root, query, selection and details drawer. Details connections preserve incoming/outgoing meaning. Groups annotate member bounds; they do not place nested nodes.',
    'ExplorerOutline ExplorerSearch ExplorerDetails DagrExplorer follow trace',
  ),
  feature(
    'validation',
    'VDSL validation',
    'vdsl',
    'Check node configuration and proposed connections.',
    'The registry checks declared kinds, ports, directions, capacity and application rules before a connection is added. sameType is an explicit policy, not a universal language type system.',
    'defineRegistry checkConnection checkConfig sameType validation',
  ),
  feature(
    'charts',
    'Bar and line charts',
    'chart',
    'Categorical series, dual axes and a data table.',
    'The private current-source chart maps categories and series to bars and lines using D3. GPU and explicit SVG modes share chart geometry. This is not a published chart API commitment.',
    'DagrChart layoutChart D3 bar line axes table SVG',
  ),
];
const relationship = (
  from: string,
  to: string,
  relation: 'provides' | 'uses',
): FrameworkEdge => ({
  id: `${relation}:${from}:${to}`,
  source: from,
  target: to,
  label: relation,
  relation,
  color: '#718491',
});
export const featureEdges: readonly FrameworkEdge[] = [
  ...features.map((node) => relationship(node.packageId, node.id, 'provides')),
  relationship('package:react', 'feature:stability', 'uses'),
  relationship('package:react', 'feature:motion', 'uses'),
  relationship('package:chart', 'feature:motion', 'uses'),
];
// Separate member annotations keep cross-rank category hulls from enclosing unrelated packages.
const packageGroups: readonly ExplorerGroup[] = packages.map((node) => ({
  id: `group:${node.id}`,
  label: node.group,
  nodeIds: [node.id],
  color: node.color,
}));
export const frameworkViews: readonly ExplorerView<
  FrameworkNode,
  FrameworkEdge
>[] = [
  {
    id: 'packages',
    label: 'Packages',
    nodes: packages,
    edges: dependencies,
    groups: packageGroups,
    description:
      'Arrows: dependent → dependency. Solid: dependency; dashed: required peer (VDSL is types-only). Umbrella edges also forward exports. External peers are explained in details.',
    layout: { nodeSize: { width: 216, height: 128 }, nodeSep: 56, rankSep: 80 },
  },
  {
    id: 'features',
    label: 'Features',
    nodes: [...features, ...packages],
    edges: featureEdges,
    groups: packageGroups,
    description:
      'Arrows: package → feature it provides or uses. These are capability relationships, not manifest dependencies. Search API names, inspect a node, then follow a connection.',
    layout: {
      direction: 'down',
      nodeSize: (node) =>
        node.kind === 'feature'
          ? { width: 340, height: 180 }
          : { width: 216, height: 128 },
      nodeSep: 56,
      rankSep: 100,
    },
  },
];
export const searchText = (node: FrameworkNode): string =>
  `${node.id} ${node.label} ${node.group} ${node.summary} ${node.explanation} ${node.terms}`;
