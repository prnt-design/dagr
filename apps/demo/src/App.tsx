import type { JSX } from 'react';
import { Graph } from '@dagr/graph';
import { EDGE_ROLES, cardRows, generateCampaign } from '@dagr/campaign';
import type { CampaignEdge, CampaignNode } from '@dagr/campaign';
import { FirstLight } from './FirstLight.js';

/** What the demo keeps on its nodes and edges: the campaign records themselves. */
type NodeAttrs = { node: CampaignNode };
type EdgeAttrs = { edge: CampaignEdge };

/**
 * The campaign dataset, generated at module load and loaded into a real
 * `@dagr/graph`. Module scope for the same reason the old sample graph was:
 * graph identity has to outlive a render, and a module constant is the honest
 * version of a store for a static demo.
 *
 * Generating rather than importing JSON is the plan's P1 decision: the same
 * seed reproduces the same campaign, and the bundle carries a generator
 * measured in kilobytes instead of a dataset measured in megabytes.
 */
const campaign = generateCampaign();

// Edges carry their campaign record just as nodes do: a graph that dropped
// `kind` on load would be typologically blind, and every consumer downstream
// (layout wants only the routed kinds) would have to re-join against the
// campaign arrays to get it back.
const graph = new Graph<NodeAttrs, EdgeAttrs>();
for (const node of campaign.nodes) graph.addNode({ id: node.id, attrs: { node } });
for (const edge of campaign.edges) {
  graph.addEdge({ id: edge.id, source: edge.source, target: edge.target, attrs: { edge } });
}

/** Node counts by kind, in first-seen order, for the stats grid. */
const kindCounts: readonly [string, number][] = (() => {
  const counts = new Map<string, number>();
  for (const node of campaign.nodes) {
    counts.set(node.data.kind, (counts.get(node.data.kind) ?? 0) + 1);
  }
  return [...counts.entries()];
})();

// Read back through the graph, not the campaign arrays, because the point of
// the stats is that the graph loaded everything: an edge record without its
// `kind` attr would show up here as an undercount, not pass silently.
const edgeRoleCounts = (() => {
  let routed = 0;
  let overlay = 0;
  for (const edge of graph.edges()) {
    const kind = edge.attrs.edge?.kind;
    if (kind !== undefined && EDGE_ROLES[kind] === 'routed') routed += 1;
    else overlay += 1;
  }
  return { routed, overlay };
})();

/**
 * The root's `contains` children through the real adjacency API: arcs and
 * regions. Filtered by kind rather than taking `successors` raw, because the
 * root also sources overlay edges and a stat labeled "under the root" should
 * not silently change meaning the day the generator adds one.
 */
const rootChildren = graph
  .outEdges(campaign.rootId)
  .filter((edge) => edge.attrs.edge?.kind === 'contains')
  .map((edge) => graph.requireNode(edge.target).attrs.node?.name ?? edge.target);

/** One card, rendered as text, so the page shows what P6 will show as HTML. */
const sampleNode =
  campaign.nodes.find((node) => node.data.kind === 'scene') ?? campaign.nodes[0];

/**
 * The demo playground, in two halves that do not know about each other yet.
 *
 * The canvas is `@dagr/render`'s shape ladder with the M4.11/M4.12 overlay on
 * top. The facts underneath are the campaign dataset (`@dagr/campaign`, the
 * plan's P1) loaded into a real `@dagr/graph`: 16 node kinds, a contains
 * forest, quest DAGs and a clue web, none of it drawn yet. P4 is what puts it
 * on the canvas, and on that day this file trades its stats for a scene.
 */
export function App(): JSX.Element {
  return (
    <main className="page">
      <header className="page__header">
        <h1 className="page__title">Dagr demo</h1>
        <p className="page__subtitle">SDF shapes, the HTML overlay, and the campaign dataset</p>
      </header>

      <FirstLight />

      <section className="facts">
        <h2 className="facts__title">@dagr/campaign, loaded into @dagr/graph</h2>
        <p className="facts__lead">
          A deterministic mock D&D campaign (seed {campaign.seed}), generated in this page and
          loaded into the graph model. Nothing below is drawn on the canvas above yet: that is the
          campaign plan&apos;s P4.
        </p>
        <div className="facts__grid">
          <div>
            <p className="facts__label">size</p>
            <p className="facts__value">
              {graph.nodeCount} nodes, {graph.edgeCount} edges
            </p>
            <p className="facts__label">edge roles</p>
            <p className="facts__value">
              {edgeRoleCounts.routed} routed, {edgeRoleCounts.overlay} overlay
            </p>
            <p className="facts__label">under the campaign root</p>
            <p className="facts__value">{rootChildren.join(', ')}</p>
          </div>
          <div>
            <p className="facts__label">nodes by kind</p>
            <ul className="facts__list">
              {kindCounts.map(([kind, count]) => (
                <li key={kind}>
                  {kind}
                  <span className="facts__arrow">x</span>
                  {count}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="facts__label">one card, as data</p>
            {sampleNode === undefined ? null : (
              <>
                <p className="facts__value">{sampleNode.name}</p>
                <ul className="facts__list">
                  {cardRows(sampleNode).map(([key, value]) => (
                    <li key={key}>
                      {key}
                      <span className="facts__arrow">:</span>
                      {value}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
