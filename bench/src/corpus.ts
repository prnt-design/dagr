/**
 * The shared benchmark corpora.
 *
 * These emit plain descriptions, arrays of ids and endpoint pairs, and not a
 * `Graph`. That is deliberate on two counts. `@dagr/graph` is a zero-dependency
 * package and it benchmarks itself, so a corpus that imported it would make the
 * bench kit and the package it measures depend on each other. And `@dagr/render`
 * (ROADMAP M4.10) wants the same 10k corpus as a pile of coordinates with no
 * graph model anywhere near it. A description each consumer builds from serves
 * all three.
 *
 * The shapes are pinned here rather than in each bench file because they
 * propagate: M2.9 commits golden files against a corpus, M3.9 states its
 * fast-path targets as absolute latencies on the 10k one, and M4.10 measures a
 * frame budget on it laid out. Those three only compare to each other if they
 * are looking at the same graph.
 */

export interface GraphSpec {
  readonly name: string;
  readonly nodes: readonly string[];
  readonly edges: readonly (readonly [string, string])[];
}

/**
 * mulberry32, the seeded PRNG the graph invariant suite and the layout random
 * suite both already use. The same algorithm on purpose: a corpus that drifted
 * from the test corpora would leave a benchmark and a golden file disagreeing
 * about what "the 10k graph" means.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LayeredOptions {
  readonly name: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly layerCount: number;
  readonly seed: number;
  /** Share of edges allowed to span more than one layer. */
  readonly longEdgeShare?: number;
  /** Share of edges pointing backwards, creating cycles. */
  readonly backEdgeShare?: number;
}

/**
 * A layered directed graph, shaped like something a Sugiyama pipeline would
 * actually be handed.
 *
 * Three properties are on purpose. Node ids are fixed width (`n00042`), so
 * lexicographic order matches insertion order and anything that sorts agrees
 * with anything that iterates. A share of the edges spans more than one layer,
 * because those are the edges that become dummy chains, and on a real layout
 * dummies typically outnumber real nodes, so a corpus of only short edges would
 * benchmark the cheap half of the work. And a small share point backwards, so
 * cycle breaking has something to find: on this repo's ranker feedback arc set
 * was 28ms of a 33ms rank stage, and a pure DAG corpus would leave that path
 * measured at zero and unwatched.
 */
export function layeredDag(options: LayeredOptions): GraphSpec {
  const { name, nodeCount, edgeCount, layerCount, seed } = options;
  const longEdgeShare = options.longEdgeShare ?? 0.25;
  const backEdgeShare = options.backEdgeShare ?? 0.02;
  const random = mulberry32(seed);

  const width = String(nodeCount - 1).length;
  const nodes: string[] = [];
  const layers: string[][] = Array.from({ length: layerCount }, () => []);

  for (let index = 0; index < nodeCount; index += 1) {
    const id = `n${String(index).padStart(width, '0')}`;
    nodes.push(id);
    // Weighted towards the earlier layers so the graph tapers the way a
    // generated pattern graph does, rather than sitting in a uniform slab.
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

  return { name, nodes, edges };
}

const cache = new Map<string, GraphSpec>();

function memoise(key: string, build: () => GraphSpec): GraphSpec {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const built = build();
  cache.set(key, built);
  return built;
}

/**
 * The 1k corpus: the size at which a cold Sugiyama run is a few milliseconds.
 * Useful for watching a constant factor, and for nothing that claims to be
 * about scale.
 */
export function smallCorpus(): GraphSpec {
  return memoise('small', () =>
    layeredDag({
      name: 'small-1k',
      nodeCount: 1_000,
      edgeCount: 4_000,
      layerCount: 24,
      seed: 0x5eed,
    }),
  );
}

/**
 * The 10k corpus, and the one that matters. M2.9 commits golden files against
 * this size, M3.9 states its fast-path targets as absolute latencies on it, and
 * M4.10 measures a frame budget on it laid out. The 40k edges are the figure
 * the existing 33ms rank-stage measurement was taken at, so a baseline captured
 * here is comparable to the number already written down.
 */
export function largeCorpus(): GraphSpec {
  return memoise('large', () =>
    layeredDag({
      name: 'large-10k',
      nodeCount: 10_000,
      edgeCount: 40_000,
      layerCount: 60,
      seed: 0x5eed,
    }),
  );
}
