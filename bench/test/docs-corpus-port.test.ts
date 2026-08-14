import { describe, expect, it } from 'vitest';

import { BENCH_1K, layeredDag as demoLayeredDag } from '../../docs/src/components/LiveLayout/corpus.js';
import { smallCorpus } from '../src/corpus.js';

/**
 * The landing page's live demo generates its graph in the visitor's browser
 * from a port of `layeredDag`, because the bench kit is private, is never
 * built, and has no `dist` a bundler could resolve. A port is cheap and it
 * drifts, and this one drifting would be quiet: the demo would still draw a
 * thousand-node graph and still report a plausible millisecond figure, next to
 * a page that says it is the corpus the baseline gates on and the cost table
 * has a column for.
 *
 * So the two generators are run against each other here, in the workspace that
 * owns the original. Reach the other way, from the docs site into the bench
 * kit, and there is no test runner to reach with.
 */

describe('the live demo’s copy of the corpus generator', () => {
  it('builds the same 1k graph the bench kit does', () => {
    const bench = smallCorpus();
    const demo = demoLayeredDag(BENCH_1K);
    expect(demo.nodes).toEqual([...bench.nodes]);
    expect(demo.edges).toEqual(bench.edges.map(([source, target]) => [source, target]));
  });

  it('keeps the preset pointed at the bench corpus, not merely at its size', () => {
    // The seed and the layer count are the two that change the graph without
    // changing any count a reader would notice.
    expect(BENCH_1K).toMatchObject({
      nodeCount: 1_000,
      edgeCount: 4_000,
      layerCount: 24,
      seed: 0x5eed,
    });
  });
});
