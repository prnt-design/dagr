/**
 * The graphs the live demo lays out, generated in the visitor's browser.
 *
 * This is a port of `layeredDag` and `mulberry32` from `bench/src/corpus.ts`,
 * not an import of them. The bench kit is private and is never built, so there
 * is no `dist` for the site's bundler to resolve, and reaching into its
 * TypeScript source would give the demo a compile path the packages it
 * advertises do not use. The generator is forty lines and seeded, so a port is
 * cheap; what a port is not is self-maintaining. The 1k preset below has to
 * stay exactly the graph the committed baseline gates on, so
 * `bench/test/docs-corpus-port.test.ts` runs both generators and fails when
 * they disagree.
 *
 * Generated rather than committed as data for the same reason: 4,000 edge
 * pairs are about 90KB of JSON that a seeded generator reproduces in a couple
 * of milliseconds, and a committed copy is one more artefact that can drift
 * from the corpus it claims to be.
 */

export interface CorpusPreset {
  readonly id: string;
  readonly label: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly layerCount: number;
  readonly seed: number;
}

export interface CorpusSpec {
  readonly nodes: readonly string[];
  readonly edges: readonly (readonly [string, string])[];
}

/** mulberry32, the PRNG the bench corpora and both random test suites use. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A layered directed graph, shaped like something a Sugiyama pipeline would be
 * handed: fixed-width ids so sort order matches insertion order, a quarter of
 * the edges spanning more than one layer so dummy chains carry their usual
 * share of the work, and two percent pointing backwards so cycle breaking has
 * something to find.
 */
export function layeredDag(preset: CorpusPreset): CorpusSpec {
  const { nodeCount, edgeCount, layerCount, seed } = preset;
  const longEdgeShare = 0.25;
  const backEdgeShare = 0.02;
  const random = mulberry32(seed);

  const width = String(nodeCount - 1).length;
  const nodes: string[] = [];
  const layers: string[][] = Array.from({ length: layerCount }, () => []);

  for (let index = 0; index < nodeCount; index += 1) {
    const id = `n${String(index).padStart(width, '0')}`;
    nodes.push(id);
    const skew = random() ** 1.4;
    const layer = Math.min(layerCount - 1, Math.floor(skew * layerCount));
    layers[layer]?.push(id);
  }

  const edges: [string, string][] = [];
  const seen = new Set<string>();

  let attempts = 0;
  const attemptCeiling = edgeCount * 20;
  while (edges.length < edgeCount && attempts < attemptCeiling) {
    attempts += 1;
    const sourceLayer = Math.floor(random() * (layerCount - 1));
    const reach = Math.min(5, layerCount - sourceLayer - 1);
    const span = random() < longEdgeShare ? 1 + Math.floor(random() * reach) : 1;
    const targetLayer = Math.min(layerCount - 1, sourceLayer + Math.max(1, span));

    const from = layers[sourceLayer];
    const to = layers[targetLayer];
    if (from === undefined || to === undefined || from.length === 0 || to.length === 0) continue;

    let source = from[Math.floor(random() * from.length)];
    let target = to[Math.floor(random() * to.length)];
    if (source === undefined || target === undefined || source === target) continue;

    if (random() < backEdgeShare) [source, target] = [target, source];

    const key = `${source} ${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([source, target]);
  }

  return { nodes, edges };
}

/**
 * The 1k corpus: `smallCorpus()` from the bench kit, node for node and edge for
 * edge. It is the size the committed baseline gates on and the left column of
 * the layout docs' cost table, which is the whole reason the demo defaults to
 * it: a visitor comparing their number to a published one should be comparing
 * the same graph.
 */
export const BENCH_1K: CorpusPreset = {
  id: 'small-1k',
  label: '1k',
  nodeCount: 1_000,
  edgeCount: 4_000,
  layerCount: 24,
  seed: 0x5eed,
};

/**
 * What the size control offers, all at the bench corpora's four edges per node.
 *
 * Layer counts follow the two committed corpora rather than a round number:
 * 1,000 nodes sit in 24 layers and 10,000 in 60, so layers grow far slower than
 * nodes, and 12 and 36 are that curve at these sizes. Getting this wrong would
 * change the shape of the graph and not only its size, and a wider graph is a
 * different benchmark rather than a bigger one.
 *
 * The 10k corpus is deliberately absent. It is the one the docs' cost table is
 * really about, and at roughly a second a run and 50,000 line segments to draw
 * it would measure the browser's SVG renderer more than the layout engine.
 */
export const CORPUS_PRESETS: readonly CorpusPreset[] = [
  { id: 'tiny-250', label: '250', nodeCount: 250, edgeCount: 1_000, layerCount: 12, seed: 0x5eed },
  { ...BENCH_1K, label: '1,000' },
  {
    id: 'big-2500',
    label: '2,500',
    nodeCount: 2_500,
    edgeCount: 10_000,
    layerCount: 36,
    seed: 0x5eed,
  },
];
