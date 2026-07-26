import type { JSX } from 'react';
import { Graph } from '@dagr/graph';

/** A small pipeline-shaped graph, built with the real `@dagr/graph` API. */
function buildSampleGraph(): Graph {
  const graph = new Graph();
  for (const id of ['ingest', 'parse', 'layout', 'render', 'export']) graph.addNode(id);
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

/**
 * Placeholder playground. Its only job today is to prove that the demo app
 * links to `@dagr/graph` across the workspace and can drive the real API:
 * build a graph, count it, and ask it an adjacency question.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>Dagr demo</h1>
      <p>
        Graph size: {graph.nodeCount} nodes, {graph.edgeCount} edges
      </p>
      <p>
        Successors of <code>layout</code>: <code>{successors.join(', ')}</code>
      </p>
      <ul>
        {graph.edges().map((edge) => (
          <li key={edge.id}>
            <code>
              {edge.source} to {edge.target}
            </code>
          </li>
        ))}
      </ul>
    </main>
  );
}
