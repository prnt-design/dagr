import { describe, expect, it } from 'vitest';

import { largeCorpus, layeredDag, smallCorpus } from '../src/corpus.js';

/**
 * The corpora are inputs to committed baselines, and later to committed golden
 * files (ROADMAP M2.9) and to a frame budget (M4.10). A generator that changed
 * shape would invalidate all three at once and look like a code regression, so
 * the properties those artefacts rely on are pinned here.
 */

describe('the layered corpus generator', () => {
  it('is deterministic for a seed', () => {
    const options = {
      name: 'x',
      nodeCount: 500,
      edgeCount: 1_500,
      layerCount: 12,
      seed: 7,
    };
    expect(layeredDag(options)).toEqual(layeredDag(options));
  });

  it('produces a different graph for a different seed', () => {
    const base = { name: 'x', nodeCount: 500, edgeCount: 1_500, layerCount: 12 };
    expect(layeredDag({ ...base, seed: 1 })).not.toEqual(layeredDag({ ...base, seed: 2 }));
  });

  it('emits no duplicate edges', () => {
    const spec = layeredDag({ name: 'x', nodeCount: 500, edgeCount: 1_500, layerCount: 12, seed: 3 });
    const keys = new Set(spec.edges.map(([source, target]) => `${source} ${target}`));
    expect(keys.size).toBe(spec.edges.length);
  });

  it('emits no self loops', () => {
    const spec = layeredDag({ name: 'x', nodeCount: 500, edgeCount: 1_500, layerCount: 12, seed: 4 });
    expect(spec.edges.filter(([source, target]) => source === target)).toEqual([]);
  });

  it('only references nodes it declared', () => {
    const spec = layeredDag({ name: 'x', nodeCount: 500, edgeCount: 1_500, layerCount: 12, seed: 5 });
    const declared = new Set(spec.nodes);
    for (const [source, target] of spec.edges) {
      expect(declared.has(source)).toBe(true);
      expect(declared.has(target)).toBe(true);
    }
  });

  it('gives ids whose sort order matches insertion order', () => {
    // Fixed-width ids, so anything that sorts and anything that iterates agree.
    const spec = layeredDag({ name: 'x', nodeCount: 500, edgeCount: 100, layerCount: 12, seed: 6 });
    expect([...spec.nodes].sort()).toEqual([...spec.nodes]);
  });

  it('includes edges that span more than one layer', () => {
    // These are the edges that become dummy chains in M2.4b, which is most of
    // the geometry on a real layout. A corpus of only short edges would
    // benchmark the cheap half of the pipeline.
    const spec = layeredDag({
      name: 'x',
      nodeCount: 500,
      edgeCount: 1_500,
      layerCount: 12,
      seed: 8,
      longEdgeShare: 0.25,
    });
    const index = new Map(spec.nodes.map((id, position) => [id, position]));
    const spans = spec.edges.filter(([source, target]) => {
      const from = index.get(source) ?? 0;
      const to = index.get(target) ?? 0;
      return Math.abs(to - from) > spec.nodes.length / 12;
    });
    expect(spans.length).toBeGreaterThan(0);
  });

  it('includes backward edges so cycle breaking has work to do', () => {
    // Feedback arc set was 28ms of a 33ms rank stage on a reviewer's machine,
    // before the M0.2 baseline existed. A pure DAG corpus would leave that path
    // measured at zero.
    const spec = layeredDag({
      name: 'x',
      nodeCount: 500,
      edgeCount: 1_500,
      layerCount: 12,
      seed: 9,
      backEdgeShare: 0.05,
    });
    const index = new Map(spec.nodes.map((id, position) => [id, position]));
    const backward = spec.edges.filter(
      ([source, target]) => (index.get(target) ?? 0) < (index.get(source) ?? 0),
    );
    expect(backward.length).toBeGreaterThan(0);
  });
});

describe('the committed corpus sizes', () => {
  it('pins the 1k corpus', () => {
    const spec = smallCorpus();
    expect(spec.nodes).toHaveLength(1_000);
    expect(spec.edges.length).toBeGreaterThan(3_000);
  });

  it('pins the 10k corpus that M2.9, M3.9 and M4.10 all measure against', () => {
    const spec = largeCorpus();
    expect(spec.nodes).toHaveLength(10_000);
    expect(spec.edges.length).toBeGreaterThan(30_000);
  });

  it('returns the same object on repeat calls, so a bench file pays to build once', () => {
    expect(largeCorpus()).toBe(largeCorpus());
  });
});
