import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { acyclicView, longestPathRanks, viewNeighbours, warmLongestPathRanks } from '../src/acyclic.js';
import { measureNodes, resolveConfig } from '../src/config.js';
import { feedbackArcSet } from '../src/cycles.js';
import { InternalLayoutError, InvalidConfigError } from '../src/errors.js';
import { longestPathRank, longestPathRankStage } from '../src/rank.js';
import { networkSimplexRank } from '../src/simplex.js';
import type { AcyclicView } from '../src/acyclic.js';
import type { PreparedState, PreviousLayout, RankOutput } from '../src/types.js';
import { mulberry32, randomDigraph, randomLayered } from './random.js';

/**
 * M3.7b: the ranks a relayout keeps, and the ones it recomputes.
 *
 * The claim this file exists to hold is one sentence and it is stronger than
 * the entry asked for: A WARM RANKING IS THE COLD RANKING, ALWAYS. Longest path
 * has one answer per view, so an incremental ranker that returns anything else
 * is wrong, and there is no class of case where the two are merely allowed to
 * differ. The seed is therefore VERIFIED rather than trusted, which is what
 * lets the suite hand it seeds from other graphs, seeds naming every node at
 * one rank, and seeds full of values a ranking could never produce, and assert
 * the same answer from all of them.
 *
 * What is allowed to differ is the WORK, and that is what the report on the
 * side is for: `dirty` is how many nodes the seed got wrong, `swept` is how
 * many the confined sweep recomputed, and `cold` says the seed was abandoned.
 * The bail trigger the entry asks for is exercised here rather than assumed to
 * fire, in both of its forms: a dirty set too big to be worth confining, and a
 * region that grows past the limit while it is being walked.
 */

/** A graph from a script of `addNode`/`addEdge` calls, ids given explicitly. */
function build(
  nodes: readonly string[],
  edges: readonly (readonly [string, string])[],
): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target] of edges) graph.addEdge(source, target);
  return graph;
}

/** The view a rank stage ranks over, built the way both rank stages build it. */
function viewOf(graph: Graph, previous?: ReadonlySet<EdgeId>): {
  view: AcyclicView;
  reversedEdges: ReadonlySet<EdgeId>;
} {
  const reversedEdges = feedbackArcSet(graph, previous);
  return { view: acyclicView(graph, reversedEdges), reversedEdges };
}

/** The cold longest-path ranking of a graph, by node id. */
function coldRanks(graph: Graph): Map<NodeId, number> {
  const { view } = viewOf(graph);
  const ranked = longestPathRanks(view);
  const ranks = new Map<NodeId, number>();
  for (const [number, node] of view.nodes.entries()) ranks.set(node.id, ranked[number] ?? -1);
  return ranks;
}

/** The warm ranking of a graph from a seed, by node id, and what it cost. */
function warmRanks(
  graph: Graph,
  seed: ReadonlyMap<NodeId, number>,
  maxWarmShare = 1,
): { ranks: Map<NodeId, number>; cold: boolean; dirty: number; swept: number } {
  const { view, reversedEdges } = viewOf(graph);
  const warm = warmLongestPathRanks({ view, graph, reversedEdges, seed, maxWarmShare });
  const ranks = new Map<NodeId, number>();
  for (const [number, node] of view.nodes.entries()) ranks.set(node.id, warm.ranks[number] ?? -1);
  return { ranks, cold: warm.cold, dirty: warm.dirty, swept: warm.swept };
}

/** What the runner hands the rank stage, built the way the runner builds it. */
function prepare(graph: Graph, previous?: PreviousLayout): PreparedState {
  const config = resolveConfig(undefined);
  const sizes = measureNodes(graph, config, undefined);
  return previous === undefined ? { graph, config, sizes } : { graph, config, sizes, previous };
}

/**
 * A `PreviousLayout` carrying only the two fields a rank stage reads.
 *
 * The other fields are what the order, position and route stages left behind,
 * and a rank stage that reached for one of them would be reading a later
 * stage's answer to decide an earlier stage's. Cast rather than filled in for
 * exactly that reason: what is absent here is what this stage must not touch.
 */
function previousOf(ranks: ReadonlyMap<NodeId, number>, reversedEdges: ReadonlySet<EdgeId>) {
  return { ranks, reversedEdges } as unknown as PreviousLayout;
}

/** Ranks as a plain object, which reads better in a failure than a Map does. */
function plain(ranks: ReadonlyMap<NodeId, number>): Record<string, number> {
  return Object.fromEntries(ranks);
}

/** Every id the stage ranked that the caller can see, with its rank. */
function callerRanks(output: RankOutput, graph: Graph): Map<NodeId, number> {
  const ranks = new Map<NodeId, number>();
  for (const node of graph.nodes()) {
    const rank = output.ranks.get(node.id);
    if (rank !== undefined) ranks.set(node.id, rank);
  }
  return ranks;
}

describe('warm longest-path ranking', () => {
  it('returns the seed itself when every node already agrees with its predecessors', () => {
    const graph = build(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'd'],
    ]);
    const cold = coldRanks(graph);

    const warm = warmRanks(graph, cold);

    expect(plain(warm.ranks)).toEqual(plain(cold));
    expect(warm).toMatchObject({ cold: false, dirty: 0, swept: 0 });
  });

  it('sweeps only the region an added leaf reaches', () => {
    const graph = build(['a', 'b', 'c', 'd', 'e'], [
      ['a', 'b'],
      ['b', 'c'],
      ['d', 'e'],
    ]);
    const seed = coldRanks(graph);
    graph.addNode('f');
    graph.addEdge('c', 'f');

    const warm = warmRanks(graph, seed);

    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
    // `f` alone: nothing above it moved, and `d` and `e` are a component the
    // patch never came near.
    expect(warm).toMatchObject({ cold: false, dirty: 1, swept: 1 });
  });

  it('carries a rank increase down the descendants it pushes and no further', () => {
    // `x -> b` forces `b` from rank 0 to rank 3, and `c` and `d` follow it.
    const graph = build(['w', 'x', 'y', 'z', 'b', 'c', 'd', 'p', 'q'], [
      ['w', 'x'],
      ['x', 'y'],
      ['y', 'z'],
      ['b', 'c'],
      ['c', 'd'],
      ['p', 'q'],
    ]);
    const seed = coldRanks(graph);
    graph.addEdge('z', 'b');

    const warm = warmRanks(graph, seed);

    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
    expect(warm.ranks.get('b')).toBe(4);
    expect(warm).toMatchObject({ cold: false, dirty: 1, swept: 3 });
  });

  it('lets a node rise when the predecessor that was holding it down goes', () => {
    const graph = build(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);
    const seed = coldRanks(graph);
    const [edge] = graph.edgesBetween('a', 'b');
    expect(edge).toBeDefined();
    graph.removeEdge(edge?.id ?? 'missing');

    const warm = warmRanks(graph, seed);

    expect(plain(warm.ranks)).toEqual({ a: 0, b: 0, c: 1, d: 2 });
    expect(warm.cold).toBe(false);
  });

  it('holds a node at its rank when another predecessor still reaches it', () => {
    const graph = build(['a', 'b', 'c'], [
      ['a', 'c'],
      ['b', 'c'],
    ]);
    const seed = coldRanks(graph);
    const [edge] = graph.edgesBetween('a', 'c');
    graph.removeEdge(edge?.id ?? 'missing');

    const warm = warmRanks(graph, seed);

    expect(plain(warm.ranks)).toEqual({ a: 0, b: 0, c: 1 });
    // Nothing moved at all, so the detection pass found no dirty node and
    // there was no sweep to confine.
    expect(warm).toMatchObject({ dirty: 0, swept: 0 });
  });
});

describe('the seed is verified rather than trusted', () => {
  const graph = build(['a', 'b', 'c'], [
    ['a', 'b'],
    ['b', 'c'],
  ]);

  it.each([
    ['every node at one rank', new Map([['a', 7], ['b', 7], ['c', 7]])],
    ['ids from another graph', new Map([['q', 1], ['r', 2]])],
    ['values a ranking cannot produce', new Map([['a', -4], ['b', 1.5], ['c', Number.NaN]])],
    ['one node named twice as high as the roster', new Map([['b', 99]])],
    ['nothing at all', new Map<NodeId, number>()],
  ])('answers the cold ranking from a seed of %s', (_label, seed) => {
    expect(plain(warmRanks(graph, seed).ranks)).toEqual({ a: 0, b: 1, c: 2 });
  });
});

describe('the bail trigger', () => {
  /** A chain of `length` nodes, which is the widest region a patch can force. */
  function chain(length: number): Graph {
    const graph = new Graph();
    for (let index = 0; index < length; index += 1) graph.addNode(`n${String(index)}`);
    for (let index = 1; index < length; index += 1) {
      graph.addEdge(`n${String(index - 1)}`, `n${String(index)}`);
    }
    return graph;
  }

  it('fires on a dirty set wider than the share allows, before any region is walked', () => {
    const graph = chain(10);
    // Every node flattened onto rank 0: only the head of the chain is where a
    // ranking would put it, so nine of ten disagree with their predecessor.
    const seed = new Map<NodeId, number>();
    for (const node of graph.nodes()) seed.set(node.id, 0);

    const warm = warmRanks(graph, seed, 0.5);

    expect(warm.cold).toBe(true);
    expect(warm.dirty).toBe(9);
    // The answer is still the cold one: bailing is a decision about work.
    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
  });

  it('fires on a region that grows past the share while it is being walked', () => {
    const graph = chain(20);
    const seed = coldRanks(graph);
    // One dirty node at the top, whose region is the whole chain under it.
    graph.addNode('above');
    graph.addEdge('above', 'n0');

    const warm = warmRanks(graph, seed, 0.25);

    expect(warm.cold).toBe(true);
    expect(warm.dirty).toBe(1);
    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
  });

  it('does not fire on the same region when the share allows it', () => {
    const graph = chain(20);
    const seed = coldRanks(graph);
    graph.addNode('above');
    graph.addEdge('above', 'n0');

    const warm = warmRanks(graph, seed, 1);

    expect(warm.cold).toBe(false);
    expect(warm.swept).toBe(20);
    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
  });

  it('takes a share of zero as an instruction to sweep cold whenever anything moved', () => {
    const graph = chain(4);
    const seed = coldRanks(graph);
    graph.addNode('extra');
    graph.addEdge('n3', 'extra');

    const warm = warmRanks(graph, seed, 0);

    expect(warm.cold).toBe(true);
    expect(plain(warm.ranks)).toEqual(plain(coldRanks(graph)));
  });

  it('still answers from the seed at a share of zero when nothing moved', () => {
    const graph = chain(4);

    const warm = warmRanks(graph, coldRanks(graph), 0);

    expect(warm).toMatchObject({ cold: false, dirty: 0, swept: 0 });
  });
});

describe('a cycle the view still holds', () => {
  it('is reported by the confined sweep the way the cold one reports it', () => {
    const graph = build(['a', 'b', 'c'], [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]);
    // A view built with nothing reversed is a cyclic "acyclic view", which is
    // the bug the cold sweep exists to catch and this one has to catch too.
    const view = acyclicView(graph, new Set());
    const reversedEdges = new Set<EdgeId>();

    expect(() =>
      warmLongestPathRanks({ view, graph, reversedEdges, seed: new Map(), maxWarmShare: 1 }),
    ).toThrow(InternalLayoutError);
  });

  it('cannot hide behind a clean detection pass, whatever the seed says', () => {
    const graph = build(['a', 'b', 'c'], [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ]);
    const view = acyclicView(graph, new Set());
    const random = mulberry32(11);

    // A ranking in which every node sits one below its deepest predecessor is
    // impossible on a cycle, so no seed can make the detection pass find
    // nothing. Two hundred arbitrary ones, and every one of them throws.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const seed = new Map<NodeId, number>();
      for (const node of graph.nodes()) seed.set(node.id, Math.floor(random() * 4));
      expect(() =>
        warmLongestPathRanks({
          view,
          graph,
          reversedEdges: new Set<EdgeId>(),
          seed,
          maxWarmShare: 1,
        }),
      ).toThrow(InternalLayoutError);
    }
  });
});

describe('the warm ranking is the cold ranking', () => {
  /**
   * The property, over a population that includes cycles, parallel edges and
   * self loops, and over the four patch kinds an engine sees.
   *
   * `randomDigraph` is the dense cyclic population M3.7a measured its own rule
   * over, which is the population where the reversed set is most likely to move
   * under a patch. That is the case this property is sharpest on: a moved
   * reversed set rebuilds the view under the seed, and a warm ranking that
   * merely started from the seed rather than checking it would drift here
   * first.
   */
  it('on 3,000 random digraphs given one edit each', () => {
    const random = mulberry32(0x3b7);
    let confined = 0;
    let bailed = 0;
    let exact = 0;

    for (let index = 0; index < 3_000; index += 1) {
      const graph = randomDigraph(random);
      if (graph.nodeCount === 0) continue;
      const { reversedEdges } = viewOf(graph);
      const seed = coldRanks(graph);

      const ids = graph.nodes().map((node) => node.id);
      const pick = (): NodeId => ids[Math.floor(random() * ids.length)] ?? ids[0] ?? 'n0';
      const choice = Math.floor(random() * 4);
      if (choice === 0) {
        graph.addNode(`fresh${String(index)}`);
        graph.addEdge(pick(), `fresh${String(index)}`);
      } else if (choice === 1) {
        graph.addEdge(pick(), pick());
      } else if (choice === 2) {
        const edges = graph.edges();
        const edge = edges[Math.floor(random() * edges.length)];
        if (edge !== undefined) graph.removeEdge(edge.id);
      } else {
        graph.removeNode(pick());
      }
      if (graph.nodeCount === 0) continue;

      // The seed is the previous run's ranks and the previous run's reversed
      // set, which is what the engine hands the stage: M3.7a's seed and this
      // task's arrive together or the view under the ranks is not the view the
      // ranks were measured on.
      const nextReversed = feedbackArcSet(graph, reversedEdges);
      const view = acyclicView(graph, nextReversed);
      const warm = warmLongestPathRanks({
        view,
        graph,
        reversedEdges: nextReversed,
        seed,
        maxWarmShare: 0.5,
      });
      const cold = longestPathRanks(view);

      expect([...warm.ranks]).toEqual([...cold]);
      if (warm.cold) bailed += 1;
      else if (warm.dirty === 0) exact += 1;
      else confined += 1;
    }

    // Every branch is reached, so the property is not quietly measuring one of
    // them three thousand times.
    expect(exact).toBeGreaterThan(0);
    expect(confined).toBeGreaterThan(0);
    expect(bailed).toBeGreaterThan(0);
  });

  it('on layered graphs, which is the shape a drawing actually has', () => {
    const random = mulberry32(0x91c);
    for (let index = 0; index < 200; index += 1) {
      const { graph } = randomLayered(random, 60, 6, 90);
      if (graph.nodeCount === 0) continue;
      const seed = coldRanks(graph);

      const ids = graph.nodes().map((node) => node.id);
      const source = ids[Math.floor(random() * ids.length)];
      const target = ids[Math.floor(random() * ids.length)];
      if (source === undefined || target === undefined) continue;
      graph.addEdge(source, target);

      const { view, reversedEdges } = viewOf(graph);
      const warm = warmLongestPathRanks({
        view,
        graph,
        reversedEdges,
        seed,
        maxWarmShare: 0.5,
      });
      expect([...warm.ranks]).toEqual([...longestPathRanks(view)]);
    }
  });
});

/** Appends to a list held in a map, creating the list on first use. */
function push(lists: Map<number, number[]>, key: number, value: number): void {
  const held = lists.get(key);
  if (held === undefined) lists.set(key, [value]);
  else held.push(value);
}

describe('the view walked per node and the view held as arrays', () => {
  /**
   * The one drift hazard this task adds, pinned directly.
   *
   * `acyclicView` reads the reversal rule once over `graph.edges()` and writes
   * two arrays; the confined sweep reads the same rule per node off
   * `graph.outEdges` and `graph.inEdges`, because a region-proportional walk
   * cannot afford the arrays' O(V + E) index. Two readings of one rule is
   * exactly the shape `acyclic.ts` exists to prevent between the two rankers,
   * so the two are asserted to agree edge for edge, duplicates included: a
   * walker that deduplicated parallel edges would leave the confined sweep's
   * in-degree short and the sweep would stall on a node it had already cleared.
   */
  it('list the same edges, parallel copies and reversals included', () => {
    const random = mulberry32(0x5ad);
    for (let index = 0; index < 300; index += 1) {
      const graph = randomDigraph(random);
      if (graph.nodeCount === 0) continue;
      const { view, reversedEdges } = viewOf(graph);

      const fromArrays = new Map<number, number[]>();
      const intoArrays = new Map<number, number[]>();
      for (let edge = 0; edge < view.from.length; edge += 1) {
        const source = view.from[edge] ?? -1;
        const target = view.to[edge] ?? -1;
        push(fromArrays, source, target);
        push(intoArrays, target, source);
      }

      for (let node = 0; node < view.nodes.length; node += 1) {
        const walked = [...viewNeighbours(graph, reversedEdges, view, node, 'out')].sort();
        const held = [...(fromArrays.get(node) ?? [])].sort();
        expect(walked).toEqual(held);

        const walkedIn = [...viewNeighbours(graph, reversedEdges, view, node, 'in')].sort();
        const heldIn = [...(intoArrays.get(node) ?? [])].sort();
        expect(walkedIn).toEqual(heldIn);
      }
    }
  });
});

describe('longestPathRank', () => {
  it('ranks a warm run exactly as a cold one ranks the same graph', () => {
    const graph = build(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['b', 'c'],
    ]);
    const first = longestPathRankStage.run(prepare(graph));
    graph.addNode('e');
    graph.addEdge('c', 'e');

    const warm = longestPathRankStage.run(
      prepare(graph, previousOf(first.ranks, first.reversedEdges)),
    );
    const cold = longestPathRankStage.run(prepare(graph));

    expect(plain(callerRanks(warm, graph))).toEqual(plain(callerRanks(cold, graph)));
  });

  it('splits the same dummy chains on a warm run as on a cold one', () => {
    const graph = build(['a', 'b', 'c', 'd'], [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['a', 'd'],
    ]);
    const first = longestPathRankStage.run(prepare(graph));
    graph.addNode('e');

    const warm = longestPathRankStage.run(
      prepare(graph, previousOf(first.ranks, first.reversedEdges)),
    );
    const cold = longestPathRankStage.run(prepare(graph));

    expect([...(warm.virtualNodes ?? [])].sort()).toEqual([...(cold.virtualNodes ?? [])].sort());
    expect(plain(warm.ranks)).toEqual(plain(cold.ranks));
  });

  it('is a fixed point on a relayout of an unchanged graph', () => {
    const graph = build(['a', 'b', 'c'], [
      ['a', 'b'],
      ['b', 'c'],
    ]);
    const first = longestPathRankStage.run(prepare(graph));
    const second = longestPathRankStage.run(
      prepare(graph, previousOf(first.ranks, first.reversedEdges)),
    );

    expect(plain(second.ranks)).toEqual(plain(first.ranks));
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a maxWarmShare of %s',
    (share) => {
      expect(() => longestPathRank({ maxWarmShare: share })).toThrow(InvalidConfigError);
    },
  );

  it('names the option it refused', () => {
    expect(() => longestPathRank({ maxWarmShare: 2 })).toThrow(/maxWarmShare/u);
    expect(() => longestPathRank({ maxWarmShare: 2 })).toThrow(/option/u);
  });

  it('accepts the two ends of the range', () => {
    expect(() => longestPathRank({ maxWarmShare: 0 })).not.toThrow();
    expect(() => longestPathRank({ maxWarmShare: 1 })).not.toThrow();
  });
});

describe('networkSimplexRank, warm started per run', () => {
  /**
   * The graph `layout.simplex.test.ts` warm starts over: two optima of equal
   * cost, with `b` free to sit at rank 1 or rank 2 and nothing but a tie-break
   * deciding which. The same graph on purpose, because what this file is about
   * is the ROUTE the hint arrives by and not the solver's response to one.
   */
  const twoOptima = () =>
    build(['a', 'b', 'c', 'd', 'e'], [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'd'],
      ['d', 'e'],
      ['e', 'c'],
    ]);

  /** The ranking that puts `b` at rank 2, which a cold run does not choose. */
  const otherOptimum: ReadonlyMap<NodeId, number> = new Map([
    ['a', 0],
    ['b', 2],
    ['c', 3],
    ['d', 1],
    ['e', 2],
  ]);

  it('reads the channel at all, which is what M3.7b added', () => {
    const graph = twoOptima();
    expect(networkSimplexRank().run(prepare(graph)).ranks.get('b')).toBe(1);

    const warm = networkSimplexRank().run(
      prepare(graph, previousOf(otherOptimum, new Set())),
    );

    expect(warm.ranks.get('b')).toBe(2);
  });

  it('prefers the run before it to the hint it was constructed with', () => {
    const graph = twoOptima();
    const cold = networkSimplexRank().run(prepare(graph)).ranks;
    // The option says one optimum and the channel says the other. The channel
    // is the run the caller is looking at, so it wins.
    const stage = networkSimplexRank({ initialRanks: cold });

    const warm = stage.run(prepare(graph, previousOf(otherOptimum, new Set())));

    expect(warm.ranks.get('b')).toBe(2);
  });

  it('falls back to the hint when there is no run before it', () => {
    const stage = networkSimplexRank({ initialRanks: otherOptimum });

    expect(stage.run(prepare(twoOptima())).ranks.get('b')).toBe(2);
  });

  it('reads the channel as a floor rather than as an answer, so a low seed is pushed down', () => {
    // The channel puts `b` above its own predecessor, which no feasible
    // ranking allows. A floor is a preference and the sweep is what makes a
    // preference safe to express, so `b` lands below `a` regardless.
    const graph = build(['a', 'b'], [['a', 'b']]);

    const warm = networkSimplexRank().run(
      prepare(graph, previousOf(new Map([['a', 3], ['b', 0]]), new Set())),
    );

    const a = warm.ranks.get('a') ?? -1;
    const b = warm.ranks.get('b') ?? -1;
    expect(b).toBeGreaterThan(a);
  });
});
