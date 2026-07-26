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
 * Placeholder playground. Its only job today is to prove that the demo app
 * links to `@dagr/graph` across the workspace and can drive the real API:
 * build a graph, count it, and ask it an adjacency question.
 */
export function App(): JSX.Element {
  const graph = buildSampleGraph();
  const successors = graph.successors('layout');

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
