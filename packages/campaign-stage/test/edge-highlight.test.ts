import { generateCampaign } from '@dagr/campaign';
import type { Campaign } from '@dagr/campaign';
import { describe, expect, it } from 'vitest';
import {
  DIMMED_INTENSITY,
  HIGHLIGHTED_INTENSITY,
  edgeIntensity,
  edgeNeighbourhoods,
} from '../src/edge-highlight.js';

/**
 * What a hover asks of the graph, decided without a canvas.
 *
 * Against a small hand-built campaign for the shape claims (both directions, a
 * self edge, duplicate neighbours) and against the REAL dataset for the ones
 * that are properties of the campaign rather than of this module: every edge
 * indexed at both its ends, and no node claiming an edge that does not touch
 * it.
 */

/** A campaign of four nodes and the edges between them, as the index sees one. */
function fixture(edges: readonly { id: string; source: string; target: string }[]): Campaign {
  return {
    seed: 0,
    nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, data: { kind: 'quest' } })),
    edges: edges.map((edge) => ({ ...edge, kind: 'contains' })),
  } as unknown as Campaign;
}

describe('edgeNeighbourhoods', () => {
  it('indexes an edge at BOTH of its ends', () => {
    // "Where does this edge come from and go" is a question about the lines at
    // a node, not about which way the dataset authored them.
    const { edgesByNode } = edgeNeighbourhoods(fixture([{ id: 'e1', source: 'a', target: 'b' }]));
    expect(edgesByNode.get('a')).toEqual(['e1']);
    expect(edgesByNode.get('b')).toEqual(['e1']);
  });

  it('names the far end of each edge, and never the node itself', () => {
    const { neighboursByNode } = edgeNeighbourhoods(
      fixture([
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'c', target: 'a' },
      ]),
    );
    expect(neighboursByNode.get('a')).toEqual(['b', 'c']);
    expect(neighboursByNode.get('b')).toEqual(['a']);
  });

  it('dedupes a pair joined by more than one edge, but keeps both edges', () => {
    // Two relations between two nodes are two lines to brighten and ONE place
    // to put a name. A duplicate here would be a second overlay element on the
    // same box, which is a pooled element wasted and a label drawn twice.
    const { edgesByNode, neighboursByNode } = edgeNeighbourhoods(
      fixture([
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
        { id: 'e3', source: 'a', target: 'b' },
      ]),
    );
    expect(edgesByNode.get('a')).toEqual(['e1', 'e2', 'e3']);
    expect(neighboursByNode.get('a')).toEqual(['b']);
  });

  it('counts a self edge once and gives it no far end', () => {
    // Its far end is the hovered node, which already has whatever label its own
    // tier gives it.
    const { edgesByNode, neighboursByNode } = edgeNeighbourhoods(
      fixture([{ id: 'loop', source: 'a', target: 'a' }]),
    );
    expect(edgesByNode.get('a')).toEqual(['loop']);
    expect(neighboursByNode.get('a')).toBeUndefined();
  });

  it('has nothing for a node no edge touches', () => {
    const { edgesByNode } = edgeNeighbourhoods(fixture([{ id: 'e1', source: 'a', target: 'b' }]));
    expect(edgesByNode.get('d')).toBeUndefined();
  });

  it('indexes every edge of the real campaign at exactly its own two ends', () => {
    // The property that would break a highlight silently: an edge missing from
    // one end lights up from one node and not the other, which reads as a
    // dataset asymmetry rather than as an index bug.
    const campaign = generateCampaign();
    const { edgesByNode } = edgeNeighbourhoods(campaign);
    const counted = new Map<string, number>();
    for (const [, edges] of edgesByNode) {
      for (const id of edges) counted.set(id, (counted.get(id) ?? 0) + 1);
    }
    expect(counted.size).toBe(campaign.edges.length);
    for (const edge of campaign.edges) {
      expect(counted.get(edge.id)).toBe(edge.source === edge.target ? 1 : 2);
      expect(edgesByNode.get(edge.source)).toContain(edge.id);
      expect(edgesByNode.get(edge.target)).toContain(edge.id);
    }
  });

  it('never claims an edge for a node it does not touch', () => {
    const campaign = generateCampaign();
    const { edgesByNode } = edgeNeighbourhoods(campaign);
    const byId = new Map(campaign.edges.map((edge) => [edge.id, edge]));
    for (const [nodeId, edges] of edgesByNode) {
      for (const id of edges) {
        const edge = byId.get(id);
        if (edge === undefined) throw new Error(`unreachable: ${id} is not an edge`);
        expect(edge.source === nodeId || edge.target === nodeId).toBe(true);
      }
    }
  });
});

describe('edgeIntensity', () => {
  it('draws everything at full intensity when nothing is hovered', () => {
    // The resting state is the SAME call rather than a separate clear: a caller
    // that has to remember to undo a highlight forgets, and the symptom is a
    // scene stuck dim after the pointer leaves.
    const of = edgeIntensity(null);
    expect(of('e1')).toBe(HIGHLIGHTED_INTENSITY);
    expect(of('anything')).toBe(HIGHLIGHTED_INTENSITY);
  });

  it('brightens the set and dims the rest', () => {
    const of = edgeIntensity(new Set(['e1', 'e2']));
    expect(of('e1')).toBe(HIGHLIGHTED_INTENSITY);
    expect(of('e2')).toBe(HIGHLIGHTED_INTENSITY);
    expect(of('e3')).toBe(DIMMED_INTENSITY);
  });

  it('keeps both ends of its range inside what the renderer accepts', () => {
    // `setEdgeIntensity` rejects anything outside [0, 1], and it rejects it per
    // EDGE, so a constant out of range here would throw on the first hover
    // rather than at a boundary somebody tested.
    expect(DIMMED_INTENSITY).toBeGreaterThan(0);
    expect(DIMMED_INTENSITY).toBeLessThan(HIGHLIGHTED_INTENSITY);
    expect(HIGHLIGHTED_INTENSITY).toBe(1);
  });

  it('leaves the dimmed edges visible rather than removing them', () => {
    // The context the highlight is read against. At zero the drawing reads as a
    // graph with eleven edges in it and the highlight stops meaning anything.
    expect(DIMMED_INTENSITY).toBeGreaterThanOrEqual(0.1);
  });
});
