import type { JSX } from 'react';
import { Graph } from '@dagr/graph';
import { FirstLight } from './FirstLight.js';

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
 * The demo playground, in two halves that do not know about each other yet.
 *
 * The canvas is `@dagr/render`'s first light: one quad, drawn through a real
 * camera you can pan and zoom. The facts underneath are `@dagr/graph` driving
 * its real API, which is what this page proved before there was anything to
 * draw with and still proves now. They are separate on purpose: nothing in M4.1
 * turns a graph into a scene, and pretending otherwise by drawing five quads
 * here would be a layout engine written in the demo. M4.4 is what joins them,
 * and on that day this file loses its second half rather than gaining a third.
 */
export function App(): JSX.Element {
  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">Dagr demo</h1>
        <p className="page__subtitle">M4.1 first light</p>
      </header>

      <FirstLight />

      <section className="facts">
        <h2 className="facts__title">@dagr/graph</h2>
        <p className="facts__lead">
          The graph model, running in the same page. Nothing below is drawn on the canvas above yet:
          turning a graph into a scene is M4.4.
        </p>
        <div className="facts__grid">
          <div>
            <p className="facts__label">size</p>
            <p className="facts__value">
              {graph.nodeCount} nodes, {graph.edgeCount} edges
            </p>
          </div>
          <div>
            <p className="facts__label">successors of {labelOf('layout')}</p>
            <p className="facts__value">{successors.map(labelOf).join(', ')}</p>
          </div>
          <div>
            <p className="facts__label">edges</p>
            <ul className="facts__list">
              {graph.edges().map((edge) => (
                <li key={edge.id}>
                  {labelOf(edge.source)}
                  <span className="facts__arrow">to</span>
                  {labelOf(edge.target)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
