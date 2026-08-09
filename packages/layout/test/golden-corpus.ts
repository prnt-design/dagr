import { Graph } from '@dagr/graph';
import { layeredDag } from '@dagr/bench';
import type { LayeredOptions } from '@dagr/bench';

/**
 * The six graphs the order stage regresses against, as the arguments that
 * produce them.
 *
 * Shared by `layout.order.golden.test.ts`, which records what the stage reaches
 * on each of them, and `layout.transpose.test.ts`, which records what the tie
 * rule is worth on each of them. Both want THE SAME SIX GRAPHS: two files that
 * each declared their own would drift, and a comparison across a drifted corpus
 * compares numbers for graphs nobody else has, which is the reason `random.ts`
 * gives at the top of itself for existing at all.
 *
 * They come from `@dagr/bench`'s `layeredDag`, the same generator the benchmark
 * corpora are drawn from, rather than from a second one written here, for the
 * same reason. They are mid-sized on purpose, a few hundred to a couple of
 * thousand nodes: the 10k corpus takes tens of milliseconds in the stage but
 * far longer to build, and both files that use these run in the ordinary test
 * run. The shapes vary in the two things the stage is sensitive to, layer count
 * and long-edge share, and two of them carry structure the crossing counter has
 * a stated rule about: self loops, which span no rank and are invisible, and
 * parallel edges, which lie on top of each other rather than crossing.
 */
export interface CorpusEntry {
  readonly name: string;
  /** The `layeredDag` call, in full, so the graph can be rebuilt from the file. */
  readonly generator: LayeredOptions;
  /** Self loops added afterwards, on the first n nodes. `layeredDag` makes none. */
  readonly selfLoops: number;
  /** Duplicates of the first n generated edges. `layeredDag` makes none. */
  readonly parallelEdges: number;
}

export const goldenCorpus: readonly CorpusEntry[] = [
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
 * have to be added here, deterministically and recorded in the golden file.
 */
export function buildCorpusGraph(entry: CorpusEntry): Graph {
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
