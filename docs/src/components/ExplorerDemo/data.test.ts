import { layoutView, validateView, validateViews } from '@prnt/dagr-explorer';
import { describe, expect, it } from 'vitest';
import { architectureViews, KINDS } from './architecture';
import { LARGE_NODE_COUNT, syntheticView } from './synthetic';

describe('the synthetic large graph', () => {
  it('has 2,000 nodes and passes validateView', () => {
    const view = syntheticView();
    expect(view.nodes).toHaveLength(LARGE_NODE_COUNT);
    expect(LARGE_NODE_COUNT).toBe(2_000);
    expect(view.edges.length).toBeGreaterThan(LARGE_NODE_COUNT);
    expect(() => validateView(view)).not.toThrow();
  });

  it('is deterministic for a seed, and differs between seeds', () => {
    expect(syntheticView()).toEqual(syntheticView());
    expect(syntheticView(7)).toEqual(syntheticView(7));
    expect(syntheticView(7).edges).not.toEqual(syntheticView(8).edges);
  });

  it('is layered: every edge runs forward, so the layout reads one way', () => {
    const view = syntheticView();
    const layerOf = new Map(view.nodes.map((node) => [node.id, node.layer]));
    for (const edge of view.edges) {
      expect(layerOf.get(edge.target)!).toBeGreaterThan(layerOf.get(edge.source)!);
    }
  });

  it('leaves no node outside the first layer without a way in', () => {
    const view = syntheticView();
    const targets = new Set(view.edges.map((edge) => edge.target));
    for (const node of view.nodes) {
      if (node.layer > 0) expect(targets.has(node.id)).toBe(true);
    }
  });
});

describe('the architecture graph', () => {
  it('passes validateViews, with two or three views of 10 to 25 nodes', () => {
    expect(() => validateViews(architectureViews)).not.toThrow();
    expect(architectureViews.length).toBeGreaterThanOrEqual(2);
    expect(architectureViews.length).toBeLessThanOrEqual(3);
    for (const view of architectureViews) {
      expect(view.nodes.length).toBeGreaterThanOrEqual(10);
      expect(view.nodes.length).toBeLessThanOrEqual(25);
    }
  });

  it('gives every node a known kind, and every view groups', () => {
    for (const view of architectureViews) {
      for (const node of view.nodes) expect(KINDS).toContain(node.kind);
      expect(view.groups?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('draws no group outline over a node that is not a member', () => {
    // Groups move no node, so an outline can cover a stranger. The demo's
    // groups are chosen so none does, which strict groups checks.
    for (const view of architectureViews) {
      expect(() => layoutView(view, { strictGroups: true })).not.toThrow();
    }
  });

  it('has parallel edges and dashed edges to show', () => {
    const overview = architectureViews[0]!;
    const pairs = overview.edges.map((edge) => [edge.source, edge.target].sort().join(' '));
    expect(new Set(pairs).size).toBeLessThan(pairs.length);
    expect(overview.edges.some((edge) => edge.dash === true)).toBe(true);
  });
});
