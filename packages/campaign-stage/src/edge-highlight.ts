import type { Campaign } from '@dagr/campaign';

/**
 * What a hover does to the edges: which ones brighten, which dim, and which
 * nodes get a label they would not otherwise have.
 *
 * **The decidable half of D3**, split out of `FirstLight.tsx` for the reason
 * `camera-input.ts` was: everything here is a map from a campaign and a node id
 * to a set of ids, so `test/edge-highlight.test.ts` decides it without a canvas,
 * a GPU or a pointer. What is left in the component is the wiring, which is a
 * `setEdgeIntensity` call per group and a `setNodes` on an overlay layer.
 *
 * ## Why an index at all, and why it is built once
 *
 * A hover asks "which edges touch this node" on every change of hovered node,
 * which during a slow drag across a dense tile is several times a second. The
 * campaign has 7,100 edges, so answering by scanning them is 7,100 comparisons
 * per answer, and the answer never changes: the campaign is generated once at
 * module load and nothing mutates it. So the whole question is precomputed in
 * one pass and the hover is two map lookups.
 *
 * That is the same trade `hover.ts` deliberately did NOT make for hit testing,
 * and the difference is worth stating: a hit test is over BOXES that a relayout
 * moves, so an index there is a structure to keep in step with the scene for no
 * measurable gain at 3,010 nodes. This index is over the graph's TOPOLOGY, which
 * a relayout does not touch at all.
 */

/** Which edges touch each node, and which nodes are at their far ends. */
export interface EdgeNeighbourhoods {
  /**
   * The ids of every edge touching a node, in campaign order.
   *
   * What a highlight is: the set `setEdgeIntensity` brightens. Both directions,
   * because "where does this edge come from and go" is a question about the
   * lines at a node and not about which way the dataset happened to author
   * them.
   */
  readonly edgesByNode: ReadonlyMap<string, readonly string[]>;

  /**
   * The nodes at the far ends of those edges, deduped, in campaign order.
   *
   * What gets a label even when its tier would not show one. Deduped because
   * two nodes joined by three relations are one place to put one name, and a
   * pooled overlay element per duplicate would be two thirds waste.
   *
   * A self edge contributes NOTHING here. Its far end is the hovered node
   * itself, which already has whatever label its own tier gives it, and adding
   * it would put a second element on the same box.
   */
  readonly neighboursByNode: ReadonlyMap<string, readonly string[]>;
}

/**
 * Both maps, in one pass over the campaign's edges.
 *
 * One pass rather than two, and one function rather than two, because the two
 * answers are the same walk: an edge that puts its id in one node's edge list
 * puts the other node in that node's neighbour list at the same moment. Built
 * separately they would be two walks over 7,100 edges and two chances for a
 * self edge to be handled one way in one and another way in the other.
 *
 * Edges naming nodes the campaign does not hold are indexed anyway, because
 * this is an index of the DATASET and the drawing is what decides what is
 * drawable: `campaignEdges` already drops an edge whose ends are not both in
 * the scene, and a highlight naming an edge that was never given to a group is
 * a no-op there. Filtering here would mean this module needed a scene.
 */
export function edgeNeighbourhoods(campaign: Campaign): EdgeNeighbourhoods {
  const edgesByNode = new Map<string, string[]>();
  const neighboursByNode = new Map<string, string[]>();
  const seenNeighbour = new Map<string, Set<string>>();

  const addEdge = (nodeId: string, edgeId: string): void => {
    const edges = edgesByNode.get(nodeId);
    if (edges === undefined) edgesByNode.set(nodeId, [edgeId]);
    else edges.push(edgeId);
  };

  const addNeighbour = (nodeId: string, otherId: string): void => {
    if (otherId === nodeId) return;
    let seen = seenNeighbour.get(nodeId);
    if (seen === undefined) {
      seen = new Set();
      seenNeighbour.set(nodeId, seen);
    }
    if (seen.has(otherId)) return;
    seen.add(otherId);
    const neighbours = neighboursByNode.get(nodeId);
    if (neighbours === undefined) neighboursByNode.set(nodeId, [otherId]);
    else neighbours.push(otherId);
  };

  for (const edge of campaign.edges) {
    addEdge(edge.source, edge.id);
    addNeighbour(edge.source, edge.target);
    // A self edge is ONE edge at its node rather than two. Listing it twice
    // would be harmless for the intensity, which is a set membership test, and
    // wrong for anything that counts what a hover lit.
    if (edge.target === edge.source) continue;
    addEdge(edge.target, edge.id);
    addNeighbour(edge.target, edge.source);
  }

  return { edgesByNode, neighboursByNode };
}

/**
 * What an edge outside the highlight draws at: a fifth of the group's width and
 * a fifth of its alpha.
 *
 * **The product is what it is chosen for, not the factor.** `setEdgeIntensity`
 * multiplies the width AND the alpha, so the ink an edge carries falls with the
 * SQUARE of this: 0.2 is a twenty-fifth of the coverage, which is what makes a
 * hovered node's own lines readable through a tile that has thousands of others
 * crossing it. A gentler 0.5 is a quarter of the ink and, measured against the
 * campaign's densest region tile, still leaves the highlight inside a haze.
 *
 * Not zero, and that is the other half of the choice. The dimmed edges are the
 * context the highlighted ones are read against: with them gone the drawing
 * reads as a graph with eleven edges in it, and a reader loses the thing that
 * makes the highlight mean anything.
 */
export const DIMMED_INTENSITY = 0.2;

/** What a highlighted edge draws at: the group's own width and alpha. */
export const HIGHLIGHTED_INTENSITY = 1;

/**
 * The intensity function for one hover, ready for `Renderer.setEdgeIntensity`.
 *
 * `null` is the resting state and returns full intensity for everything, which
 * is the drawing with no hover in it. That is deliberately the SAME call rather
 * than a separate "clear": a caller that has to remember to undo a highlight
 * forgets, and the symptom is a scene stuck dim after the pointer leaves.
 */
export function edgeIntensity(
  highlighted: ReadonlySet<string> | null,
): (edgeId: string) => number {
  if (highlighted === null) return () => HIGHLIGHTED_INTENSITY;
  return (edgeId) => (highlighted.has(edgeId) ? HIGHLIGHTED_INTENSITY : DIMMED_INTENSITY);
}
