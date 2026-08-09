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
 * BOTH COLUMNS ARE RECORDED, the count with the transpose pass running and the
 * count with `maxTransposePasses: 0`. Pinning both means the file says what the
 * pass buys on each graph rather than only what the stage totals, and a
 * regression in either one shows up on its own instead of one masking the
 * other.
 *
 * AND SO IS THE CONFIGURATION EACH COLUMN WAS MEASURED UNDER, resolved: the
 * budgets actually in force rather than an option left out and standing for
 * whatever a default happens to be. A file that recorded only the counts would
 * move six of its numbers, or all twelve, the day a default changed, and say
 * nothing about what changed, which leaves a reader of that diff unable to tell
 * a quality regression from a deliberate change of default. Both budgets are
 * therefore named at the call that produces each column, and the same values
 * are what the file records, which is what stops the numbers and the
 * configuration beside them from drifting apart. Naming them is also what would
 * let a changed default pass unnoticed here, so a test below holds the recorded
 * budgets to being the stage's own defaults.
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
 * WHAT LAST MOVED IT.
 *
 * Most recently, M2.6c, and TWO causes moved every number in the same commit,
 * so both are attributed separately below rather than left as one diff with a
 * shared story. Doing that is not optional here: one of them multiplies the
 * counts and the other moves them by a few percent, and the small one is the
 * one the commit was about.
 *
 * CAUSE ONE, THE POPULATION, AND IT IS A FIX RATHER THAN A CHANGE OF MIND. The
 * `countCrossings` call in `measure` left `virtualChains` out while
 * `rankedState` passed them in, so from the moment M2.4b's chains were consumed
 * this file ordered every entry over the drawing's segments and then counted
 * only the graph's own adjacent-layer edges. That is not a population the stage
 * optimises, and it moves the WRONG WAY when the stage improves, which is
 * exactly what it did here. Fixing it alone, at the budgets that shipped
 * before, multiplies the counts by between 3.5x and 76x: `sparse-2000` least at
 * 13,594 to 47,393 with 10% long edges, `dense-1200` most at 12,147 to 909,301
 * with 40% of them. The spread IS the point. It is the share of each graph that
 * was being ordered and not counted.
 *
 * CAUSE TWO, THE DEFAULTS, which is what the commit was for: `maxSweeps` 8 to 4
 * and `maxTransposePasses` 8 to 16. Against the population fix alone, the
 * `sweepsOnly` column rises on five of six entries, between 1.35% and 3.48%,
 * and that is the sweep cut showing through with nothing to pay for it: this
 * corpus is still improving at 8 sweeps where both bench corpora have floored
 * by 3. The `withTranspose` column, which is the one that ships, falls on all
 * six, between 0.12% and 4.29%, because the cap of 16 buys back more than the
 * four sweeps cost. Those two columns disagreeing is the trade the
 * re-derivation is, on the only corpus in the package that could show it.
 *
 * Before that, the order stage began reading the rank stage's dummy chains, so
 * an edge that spans several layers began being ORDERED as the segments it is
 * drawn as. Every count here rose, between 1.65x and 3.01x, and none of that
 * was a quality regression either: the layering changed to suit a population
 * this file was not yet counting. The like-for-like comparison is in
 * `layout.order.test.ts`, both layerings scored over the full segment
 * population, and there the layering that reads the chains has 8,748,361
 * crossings on the 10k bench corpus against 33,932,556 for the one that ignores
 * them. This file cannot show that, because it records one layering per entry
 * rather than two.
 *
 * Before that, M2.2c replaced the cycle
 * breaker, which changes the RANKING every entry here is ordered against, and
 * five of the six `layers` counts fell: 66 to 62, 28 to 22, 77 to 45, 38 to
 * 32 and 40 to 27, while `sparse-2000` alone kept its 40 layers and both of
 * its counts. Four of the five moved entries then count MORE crossings and one
 * counts fewer. That is not a quality regression in the order stage and reading
 * it as one is the trap this paragraph exists to close: crossings are counted
 * only between adjacent layers, a shallower ranking puts a larger share of each
 * graph between adjacent layers, and so a larger share of each graph became
 * countable at the same moment. The entries whose depth fell furthest are
 * exactly the ones whose counts rose furthest, `dense-1200` at 77 layers to 45
 * and 1,433 crossings to 3,841 being both. `layout.order.test.ts` pins the
 * adjacency share on the bench corpora and it rose by a quarter on the 10k.
 * The comparison across this diff is therefore not like for like, and the
 * numbers after it are a fresh baseline rather than a worse one.
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

/** The budgets one column was measured under, both of them resolved numbers. */
interface StageConfig {
  readonly maxSweeps: number;
  readonly maxTransposePasses: number;
}

/** One such configuration per column, under the column's own name. */
interface StageConfigs {
  readonly sweepsOnly: StageConfig;
  readonly withTranspose: StageConfig;
}

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
  /**
   * What the stage was configured as for each column, resolved. Per entry
   * rather than once for the whole file so that an entry measured at a budget
   * of its own could say so: a graph added later because it needs more sweeps
   * than the rest would otherwise be recorded under a header that lies about
   * it.
   */
  readonly config: StageConfigs;
  readonly crossings: {
    /** `maxTransposePasses: 0`: the sweeps alone. */
    readonly sweepsOnly: number;
    /** The transpose pass running, which is what the stage does by default. */
    readonly withTranspose: number;
  };
}

interface GoldenFile {
  readonly regenerate: string;
  readonly regenerateWhen: string;
  readonly entries: readonly GoldenEntry[];
}

const goldenPath = new URL('./order-crossings.golden.json', import.meta.url);

/** An entry as the corpus states it: everything measuring it does not supply. */
type CorpusEntry = Omit<GoldenEntry, 'built' | 'config' | 'crossings'>;

/**
 * The configuration each column is measured under, both budgets named in full
 * so that neither column depends on a default to be reproducible.
 *
 * 4 and 16 are the stage's own defaults, written out here rather than imported
 * because `order.ts` keeps those constants to itself, and held to that by the
 * last test in this file. The `withTranspose` column is meant to be what the
 * stage does out of the box, so a default that moved away from these numbers
 * would leave the file recording a run nobody gets.
 *
 * They were 8 and 8 until M2.6c re-derived them, and this corpus is part of
 * why they moved apart rather than a bystander to it: five of these six graphs
 * are still improving at 8 sweeps where both bench corpora have floored by 3,
 * so cutting the sweep budget on the bench corpora alone would have cost 1.3%
 * to 3.4% here. The cap of 16 more than pays that back on all six.
 */
const stageConfig: StageConfigs = {
  sweepsOnly: { maxSweeps: 4, maxTransposePasses: 0 },
  withTranspose: { maxSweeps: 4, maxTransposePasses: 16 },
};

/** The corpus, as the arguments that produce it. The numbers are in the file. */
const corpus: readonly CorpusEntry[] = [
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
function buildGraph(entry: CorpusEntry): Graph {
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

/**
 * The graph ranked by the default stage, chains and all, which is what a
 * default run hands the order stage.
 *
 * It passed `virtualNodes` and `virtualChains` as empty until the M2.4b review.
 * Passing them through was briefly a no-op, because neither the order index nor
 * `countCrossings` read `virtualChains` at that point and a dummy was an
 * isolated node contributing nothing to count. Both read them now, through
 * `segments.ts`, so an edge with a chain arrives at the stage as one segment
 * per gap it crosses. What this state hands over and what `measure` counted
 * then came apart for one milestone, the stage reading the chains and the
 * counter not: see the header's WHAT LAST MOVED IT, cause one.
 *
 * `ranks` is filtered to the roster this state declares. The stage ranks the
 * dummies too, and handing back ranks for ids no roster holds would make
 * `built.layers` measurable over ids nothing places.
 */
function rankedState(graph: Graph): RankedState {
  const sizes = new Map<NodeId, Size>();
  for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
  const out = longestPathRankStage.run({ graph, config: DEFAULT_LAYOUT_CONFIG, sizes });
  const virtualNodes = new Set<NodeId>(out.virtualNodes?.keys() ?? []);
  const ranks = new Map<NodeId, number>();
  for (const [id, rank] of out.ranks) {
    if (graph.hasNode(id) || virtualNodes.has(id)) ranks.set(id, rank);
  }
  for (const [id, size] of out.virtualNodes ?? []) sizes.set(id, size);
  return {
    graph,
    config: DEFAULT_LAYOUT_CONFIG,
    sizes,
    ranks,
    reversedEdges: out.reversedEdges,
    virtualNodes,
    virtualChains: out.virtualChains ?? new Map(),
  };
}

/**
 * Everything the file records about one entry, measured.
 *
 * The configuration the entry records is the very object each count was
 * produced from rather than a description of it written out alongside, so a
 * count and the budgets recorded beside it cannot come apart: changing what a
 * column is measured under is changing what the file says it was measured
 * under, in one place.
 */
function measure(entry: CorpusEntry): GoldenEntry {
  const graph = buildGraph(entry);
  const state = rankedState(graph);
  // Scored over the SEGMENTS of the drawing, which is the population the stage
  // optimises. Until M2.6c this call left `virtualChains` out while the state
  // above passed them in, so every entry was ordered with the chains and
  // counted without them: the file recorded crossings among the graph's own
  // adjacent-layer edges in a layering arranged for a population sixteen times
  // larger. That is not a metric the stage has an opinion about, and it moves
  // the wrong way when the stage improves. See the header for what each of the
  // two causes contributed to the diff that fixed it.
  const scoreAt = (config: StageConfig): number =>
    countCrossings({
      graph,
      layers: barycenterOrder(config).run(state).layers,
      virtualChains: state.virtualChains,
    });
  return {
    ...entry,
    built: {
      nodes: graph.nodes().length,
      edges: graph.edges().length,
      layers: new Set(state.ranks.values()).size,
    },
    config: stageConfig,
    crossings: {
      sweepsOnly: scoreAt(stageConfig.sweepsOnly),
      withTranspose: scoreAt(stageConfig.withTranspose),
    },
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

  /**
   * The budgets the file records are the stage's own defaults, which is what
   * makes `withTranspose` the shipping column rather than one configuration
   * among many. Naming both budgets at the call is what keeps a count and the
   * configuration recorded beside it together, and it is also what would let a
   * changed default slip past this file, so the two are compared directly: the
   * stage built with nothing said against the stage built with what the file
   * says. That covers the other column too, which differs only in a budget it
   * sets to zero, a value no default can be.
   *
   * On the corpus rather than on a small graph, because the budget has to bite
   * for the comparison to assert anything. These graphs are still improving at
   * eight sweeps, the way the 1k bench corpus reaches 3,605 crossings at eight
   * and 3,467 at sixteen, whereas a graph small enough to settle early agrees
   * with every budget and would pass on any default at all.
   *
   * Layers rather than counts, for the same reason `layout.transpose.test.ts`
   * pins layers: two budgets can reach the same number by different routes, and
   * the claim here is that the stage did the same run.
   */
  it('records the budgets the stage runs at when it is given no options', () => {
    for (const entry of corpus) {
      const state = rankedState(buildGraph(entry));
      expect(barycenterOrder().run(state).layers).toEqual(
        barycenterOrder(stageConfig.withTranspose).run(state).layers,
      );
    }
  });
});
