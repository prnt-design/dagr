import { readFileSync, writeFileSync } from 'node:fs';
import { Graph } from '@dagr/graph';
import { layeredDag } from '@dagr/bench';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG } from '../src/config.js';
import { barycenterOrder, countCrossings } from '../src/order.js';
import { longestPathRankStage } from '../src/rank.js';
import type { LayeredOptions } from '@dagr/bench';
import type { NodeId } from '@dagr/graph';
import type { RankedState, Size } from '../src/types.js';

/**
 * The crossing-count regression corpus, committed as a golden file.
 *
 * WHAT THIS IS FOR. Every other test of the order stage is about a rule: the
 * seed is a walk, a pinned node keeps its index, a pass never raises the count.
 * A stage can get materially worse at the job while keeping every one of those,
 * because they are all satisfied by drawings that are merely legal. This file
 * is the other half: a fixed set of generated graphs and the exact number of
 * crossings the stage reaches on each of them.
 *
 * WHY EXACT EQUALITY AND NOT A TOLERANCE. The stage is deterministic, so an
 * exact number is the strongest claim available, and a tolerance is a place for
 * a regression to hide. It also cuts the other way on purpose: an improvement
 * has to come here and rewrite the file, which is a line in a diff someone can
 * ask about, rather than sliding under a band nobody set deliberately.
 *
 * BOTH COLUMNS ARE RECORDED, the count with the transpose pass at its default
 * cap and the count with `maxTransposePasses: 0`. Pinning both means the file
 * says what the pass buys on each graph rather than only what the stage
 * totals, and a regression in either one shows up on its own instead of one
 * masking the other.
 *
 * HOW TO REGENERATE IT, and it is one command from the repo root:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.order.golden
 *
 * WHEN REGENERATING IS LEGITIMATE. When you deliberately changed what the
 * stage does and can say what moved and why: a different tie rule, a different
 * cap, a new refinement pass, a change to the seed walk. The new numbers are
 * then the record of that change, and the diff is the evidence for it.
 *
 * WHEN IT IS CHEATING. When a number moved and you do not know why. Rerunning
 * the generator turns the test green and destroys the only record of what the
 * stage used to do, which is exactly the information needed to find out whether
 * the move was a bug. A count that changed without an intended cause is a
 * failure to investigate, not a file to refresh. The same goes for a change
 * that IMPROVED a count: an unexplained improvement in a deterministic
 * algorithm is an unexplained change.
 *
 * THE GRAPHS come from `@dagr/bench`'s `layeredDag`, the same generator the
 * benchmark corpora are drawn from, rather than from a second one written here.
 * `test/random.ts` states the reason at the top of itself and it applies with
 * more force to a committed file: two generators drift, and a golden file
 * against a drifted generator pins numbers for a graph nobody else has.
 *
 * They are mid-sized on purpose, a few hundred to a couple of thousand nodes.
 * The 10k corpus takes tens of milliseconds in the stage but far longer to
 * build, and this file runs in the ordinary test run. The shapes vary in the
 * two things the stage is sensitive to, layer count and long-edge share, and
 * two of them carry structure the counter has a stated rule about: self loops,
 * which span no rank and are invisible, and parallel edges, which lie on top of
 * each other rather than crossing. Neither rule has a corpus behind it
 * otherwise.
 */

/** One graph of the corpus: how to build it, and what the stage reaches on it. */
interface GoldenEntry {
  readonly name: string;
  /** The `layeredDag` call, in full, so the graph can be rebuilt from the file. */
  readonly generator: LayeredOptions;
  /** Self loops added afterwards, on the first n nodes. `layeredDag` makes none. */
  readonly selfLoops: number;
  /** Duplicates of the first n generated edges. `layeredDag` makes none. */
  readonly parallelEdges: number;
  /** What the graph came out as, so generator drift fails here and not later. */
  readonly built: { readonly nodes: number; readonly edges: number; readonly layers: number };
  readonly crossings: {
    /** `maxTransposePasses: 0`: the sweeps alone. */
    readonly sweepsOnly: number;
    /** The transpose pass at its default cap, which is what the stage does. */
    readonly withTranspose: number;
  };
}

interface GoldenFile {
  readonly regenerate: string;
  readonly regenerateWhen: string;
  readonly entries: readonly GoldenEntry[];
}

const goldenPath = new URL('./order-crossings.golden.json', import.meta.url);

/** The corpus, as the arguments that produce it. The numbers are in the file. */
const corpus: readonly Omit<GoldenEntry, 'built' | 'crossings'>[] = [
  {
    name: 'tall-600',
    generator: {
      name: 'tall-600',
      nodeCount: 600,
      edgeCount: 1_800,
      layerCount: 30,
      seed: 0xa1,
      longEdgeShare: 0.25,
      backEdgeShare: 0.02,
    },
    selfLoops: 0,
    parallelEdges: 0,
  },
  {
    name: 'wide-600',
    generator: {
      name: 'wide-600',
      nodeCount: 600,
      edgeCount: 2_400,
      layerCount: 6,
      seed: 0xa2,
      longEdgeShare: 0.05,
      backEdgeShare: 0.02,
    },
    selfLoops: 0,
    parallelEdges: 0,
  },
  {
    name: 'dense-1200',
    generator: {
      name: 'dense-1200',
      nodeCount: 1_200,
      edgeCount: 6_000,
      layerCount: 16,
      seed: 0xa3,
      longEdgeShare: 0.4,
      backEdgeShare: 0.05,
    },
    selfLoops: 0,
    parallelEdges: 0,
  },
  {
    name: 'sparse-2000',
    generator: {
      name: 'sparse-2000',
      nodeCount: 2_000,
      edgeCount: 3_000,
      layerCount: 40,
      seed: 0xa4,
      longEdgeShare: 0.1,
      backEdgeShare: 0,
    },
    selfLoops: 0,
    parallelEdges: 0,
  },
  {
    name: 'self-loops-800',
    generator: {
      name: 'self-loops-800',
      nodeCount: 800,
      edgeCount: 2_400,
      layerCount: 12,
      seed: 0xa5,
      longEdgeShare: 0.2,
      backEdgeShare: 0.02,
    },
    selfLoops: 40,
    parallelEdges: 0,
  },
  {
    name: 'parallel-800',
    generator: {
      name: 'parallel-800',
      nodeCount: 800,
      edgeCount: 2_400,
      layerCount: 12,
      seed: 0xa6,
      longEdgeShare: 0.2,
      backEdgeShare: 0.02,
    },
    selfLoops: 0,
    parallelEdges: 200,
  },
];

/**
 * The graph an entry describes: the generator's, then the structure the
 * generator does not make. `layeredDag` skips an edge whose endpoints are the
 * same node and rejects a duplicate pair, so a self loop and a parallel edge
 * have to be added here, deterministically and recorded in the file.
 */
function buildGraph(entry: Omit<GoldenEntry, 'built' | 'crossings'>): Graph {
  const spec = layeredDag(entry.generator);
  const graph = new Graph();
  for (const id of spec.nodes) graph.addNode(id);
  for (const [source, target] of spec.edges) graph.addEdge(source, target);
  for (let index = 0; index < entry.selfLoops; index += 1) {
    const id = spec.nodes[index];
    if (id !== undefined) graph.addEdge(id, id);
  }
  for (let index = 0; index < entry.parallelEdges; index += 1) {
    const edge = spec.edges[index];
    if (edge !== undefined) graph.addEdge(edge[0], edge[1]);
  }
  return graph;
}

/** The graph ranked by the default stage, which is what the numbers assume. */
function rankedState(graph: Graph): RankedState {
  const sizes = new Map<NodeId, Size>();
  for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
  const out = longestPathRankStage.run({ graph, config: DEFAULT_LAYOUT_CONFIG, sizes });
  return {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks: out.ranks,
    reversedEdges: out.reversedEdges,
    virtualNodes: new Set(),
    virtualChains: new Map(),
  };
}

/** Everything the file records about one entry, measured. */
function measure(entry: Omit<GoldenEntry, 'built' | 'crossings'>): GoldenEntry {
  const graph = buildGraph(entry);
  const state = rankedState(graph);
  const scoreAt = (maxTransposePasses?: number): number =>
    countCrossings({
      graph,
      layers: barycenterOrder(
        maxTransposePasses === undefined ? undefined : { maxTransposePasses },
      ).run(state).layers,
    });
  return {
    ...entry,
    built: {
      nodes: graph.nodes().length,
      edges: graph.edges().length,
      layers: new Set(state.ranks.values()).size,
    },
    crossings: { sweepsOnly: scoreAt(0), withTranspose: scoreAt() },
  };
}

const updating = process.env['UPDATE_GOLDEN'] === '1';

describe('barycenterOrder, the golden crossing-count corpus', () => {
  const measured = corpus.map(measure);

  if (updating) {
    it('rewrites the golden file, because UPDATE_GOLDEN was set', () => {
      const file: GoldenFile = {
        regenerate: 'UPDATE_GOLDEN=1 pnpm --filter @dagr/layout test layout.order.golden',
        regenerateWhen:
          'Only for a deliberate change to what the stage does, and only when you ' +
          'can say what moved and why. A count that changed without an intended ' +
          'cause is something to investigate, not a file to refresh.',
        entries: measured,
      };
      writeFileSync(goldenPath, `${JSON.stringify(file, undefined, 2)}\n`);
      expect(measured.length).toBe(corpus.length);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenFile;

  /**
   * One assertion over the whole file rather than one per entry, so that a
   * change which moved every graph reads as one diff of the corpus rather than
   * as six separate failures with the shared cause left to be inferred.
   */
  it('reaches exactly the crossing counts recorded in the golden file', () => {
    expect(measured).toEqual(golden.entries);
  });

  /**
   * The transpose pass earns its place on every graph of the corpus, which is
   * a claim about the corpus as much as about the pass: a set of graphs the
   * pass could not move would pin the two columns to one number and quietly
   * stop testing half of what this file is for.
   */
  it('has a corpus the transpose pass improves everywhere', () => {
    for (const entry of golden.entries) {
      expect(entry.crossings.withTranspose).toBeLessThan(entry.crossings.sweepsOnly);
    }
  });

  /**
   * The two structures the counter has a stated rule about are actually in the
   * corpus, checked against the built graph rather than against the intent. A
   * self loop spans no rank and a parallel edge lies on top of its twin, so
   * neither adds a crossing, and both are here so that a change which started
   * counting one would move a number in this file.
   */
  it('holds a graph with self loops and a graph with parallel edges', () => {
    const loops = corpus.find((entry) => entry.selfLoops > 0);
    const parallel = corpus.find((entry) => entry.parallelEdges > 0);
    if (loops === undefined || parallel === undefined) throw new Error('corpus lost a shape');
    const looped = buildGraph(loops).edges().filter((edge) => edge.source === edge.target);
    expect(looped.length).toBe(loops.selfLoops);
    const edges = buildGraph(parallel).edges();
    const pairs = new Set(edges.map((edge) => `${edge.source} ${edge.target}`));
    expect(edges.length - pairs.size).toBe(parallel.parallelEdges);
  });
});
