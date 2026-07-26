import type { JSX } from 'react';
import { Graph } from '@dagr/graph';

/** What the demo keeps on its nodes. */
type NodeAttrs = { label: string };

/** A small pipeline-shaped graph, built with the real `@dagr/graph` API. */
function buildSampleGraph(): Graph<NodeAttrs> {
  const graph = new Graph<NodeAttrs>();
  const stages: [id: string, label: string][] = [
    ['ingest', 'Ingest'],
    ['parse', 'Parse'],
    ['layout', 'Layout'],
    ['render', 'Render'],
    ['export', 'Export'],
  ];
  for (const [id, label] of stages) graph.addNode({ id, attrs: { label } });
  graph.addEdge('ingest', 'parse');
  graph.addEdge('parse', 'layout');
  graph.addEdge('layout', 'render');
  graph.addEdge('layout', 'export');
  graph.addEdge('render', 'export');
  return graph;
}

/**
 * Built once at module load, not per render. Graph identity has to outlive a
 * render: rebuilding in the component body would hand every render a fresh
 * graph with fresh records, which is exactly what defeats the stable identity
 * the whole library is built on. Real apps will hold the graph in a store or a
 * ref; a module constant is the honest version of that for a static demo.
 */
const graph = buildSampleGraph();
const successors = graph.successors('layout');

/** A node's label, falling back to its id. Every attribute read is optional. */
function labelOf(id: string): string {
  return graph.requireNode(id).attrs.label ?? id;
}

/**
 * Placeholder playground. Its only job today is to prove that the demo app
 * links to `@dagr/graph` across the workspace and can drive the real API:
 * build a graph with typed attributes, count it, ask it an adjacency question,
 * and read a label back out.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>Dagr demo</h1>
      <p>
        Graph size: {graph.nodeCount} nodes, {graph.edgeCount} edges
      </p>
      <p>
        Successors of <code>{labelOf('layout')}</code>:{' '}
        <code>{successors.map(labelOf).join(', ')}</code>
      </p>
      <ul>
        {graph.edges().map((edge) => (
          <li key={edge.id}>
            <code>
              {labelOf(edge.source)} to {labelOf(edge.target)}
            </code>
          </li>
        ))}
      </ul>
    </main>
  );
}
