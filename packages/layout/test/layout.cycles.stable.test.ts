import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, resolveConfig } from '../src/config.js';
import { feedbackArcSet } from '../src/cycles.js';
import { longestPathRankStage } from '../src/rank.js';
import { networkSimplexRankStage } from '../src/simplex.js';
import { prepare, runPipeline } from '../src/pipeline.js';
import { acyclicView, build, componentsOf, referenceTopologicalOrder } from './cycles-check.js';
import { mulberry32, randomDigraph } from './random.js';
import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import type { PreparedState, PreviousLayout, RoutedState, Size } from '../src/types.js';

/**
 * The warm start a run leaves behind, built the way the engine builds it.
 *
 * The engine's own `warmStartOf` is private, so a test that runs the pipeline
 * itself has to name the eight fields, which is the point rather than a
 * duplication: `PreviousLayout` is an `Omit` of `RoutedState`, so a stage
 * output added to that record stops this line compiling until it says what a
 * warm start should do with the new field.
 */
function warmStartOf(routed: RoutedState): PreviousLayout {
  const { sizes, ranks, reversedEdges, virtualNodes, virtualChains, layers, positions, routes } =
    routed;
  return { sizes, ranks, reversedEdges, virtualNodes, virtualChains, layers, positions, routes };
}

/**
 * M3.7a: the cycle breaker seeded from the run before it.
 *
 * The reason it exists is the bail trigger M3.7b needs. A relayout is allowed
 * to keep the previous ranks where the patch cannot have changed them, and the
 * signal that says it may not is a CHANGED REVERSED SET, which is only a signal
 * if the reversed set is itself a fact about the graph rather than about the
 * order the breaker happened to visit it in. It is not: the cold breaker sorts
 * every vertex by a least-squares height, a patch anywhere moves every height a
 * little, and an arc sitting near the boundary between uphill and downhill
 * flips with it. Measured at the foot of this file, adding ONE LEAF, which can
 * change no cycle, moves the cold set on 30 of 132 random cyclic digraphs.
 *
 * So the run is seeded: the previously reversed edges that still lie on a cycle
 * are held reversed, and the breaker runs over what that leaves. The two halves
 * fail in different places and are tested in different registers. THE RETENTION
 * RULE is what survives from the previous set, and it is about the INPUT graph:
 * an edge lies on a cycle exactly when its endpoints share a strongly connected
 * component. THE SEEDED RUN is what happens next, and it is scoped to the
 * components of the SEEDED VIEW, which is what makes an already-acyclic seed a
 * fixed point and so makes a structure-preserving edit exact.
 */

/** The edges of a graph whose reversal `feedbackArcSet` returns, as ids. */
function idsOf(set: ReadonlySet<EdgeId>): string[] {
  return [...set].map(String).sort();
}

/** The edges of `graph` that lie on a cycle, by the checker's own components. */
function onACycle(graph: Graph): Set<EdgeId> {
  const componentOf = componentsOf(graph, acyclicView(graph, new Set()));
  const cyclic = new Set<EdgeId>();
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    if (componentOf.get(edge.source) === componentOf.get(edge.target)) cyclic.add(edge.id);
  }
  return cyclic;
}

/** How many arcs the breaker is choosing between: every edge but the self loops. */
function arcCount(graph: Graph): number {
  return graph.edges().filter((edge) => edge.source !== edge.target).length;
}

/**
 * A cyclic graph with one reversal to make and one leaf to hang off it.
 *
 * `a -> b -> c -> a` is the cycle, `d` is a spare node with an edge into it,
 * and the ids are explicit so a failure names an edge rather than a number.
 */
function triangle(): Graph {
  return build(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'b', 'ab'],
      ['b', 'c', 'bc'],
      ['c', 'a', 'ca'],
      ['a', 'd', 'ad'],
    ],
  );
}

describe('the seeded feedback arc set holds what the previous run decided', () => {
  it('returns the previous set unchanged when the graph has not changed', () => {
    const graph = triangle();
    const cold = feedbackArcSet(graph);
    expect(idsOf(feedbackArcSet(graph, cold))).toEqual(idsOf(cold));
  });

  /**
   * The witness for the one line the warm start rests on, and it is here
   * because the property test below found it and a reader would not.
   *
   * Its cold pass reverses `fa`, `cf`, `ab` and `fd`, and the view that leaves
   * is ACYCLIC, so nothing needs breaking and the seeded answer has to be the
   * seed. What makes it a witness is that the least-squares order of that
   * seeded view is NOT a topological order of it: three arcs still run
   * backwards in the order, and one of them, `eb`, has both endpoints in one
   * strongly connected component OF THE INPUT. So a seeded run scoped to the
   * INPUT's components reverses `eb` for a cycle that is not there, and the
   * fixed point is gone. Scoping to the SEEDED VIEW's components is what makes
   * it hold, because an acyclic view has none but singletons.
   *
   * Confirmed by running this suite against an input-scoped build, which fails
   * here and in the property test below it. The case is rare, about four in a
   * thousand random cyclic digraphs, so a 400-graph population missed it
   * entirely and the one below draws 3,000. That is the whole reason this
   * witness is written out: a guard nobody has seen fail is a guard nobody
   * knows the shape of.
   */
  it('holds a seed whose view is acyclic but whose order disagrees with it', () => {
    const graph = build(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      [
        ['d', 'e', 'de'],
        ['f', 'a', 'fa'],
        ['b', 'f', 'bf'],
        ['f', 'c', 'fc'],
        ['a', 'b', 'ab'],
        ['e', 'c', 'ec'],
        ['f', 'd', 'fd'],
        ['b', 'f', 'bf2'],
        ['c', 'f', 'cf'],
        ['d', 'f', 'df'],
        ['e', 'b', 'eb'],
      ],
    );
    const cold = feedbackArcSet(graph);
    expect(idsOf(cold)).toEqual(['ab', 'cf', 'fa', 'fd']);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, cold))).toBeDefined();
    expect(idsOf(feedbackArcSet(graph, cold))).toEqual(idsOf(cold));
  });

  it('is a fixed point on every random cyclic digraph', () => {
    const random = mulberry32(41);
    let cyclic = 0;
    for (let seed = 0; seed < 3000; seed += 1) {
      const graph = randomDigraph(random);
      const cold = feedbackArcSet(graph);
      if (cold.size === 0) continue;
      cyclic += 1;
      expect(idsOf(feedbackArcSet(graph, cold))).toEqual(idsOf(cold));
    }
    // The population has to contain the case, or the assertion above is a loop
    // over nothing. This is the same guard M3.5 and M3.6 put under theirs.
    expect(cyclic).toBeGreaterThan(900);
  });

  it('keeps every reversal when a leaf arrives, where a cold run need not', () => {
    const graph = triangle();
    const previous = feedbackArcSet(graph);
    graph.addNode('leaf');
    graph.addEdge('b', 'leaf', 'bleaf');
    expect(idsOf(feedbackArcSet(graph, previous))).toEqual(idsOf(previous));
  });

  it('keeps every reversal when an edge arrives that closes no cycle', () => {
    const graph = triangle();
    const previous = feedbackArcSet(graph);
    // `a -> d` already exists, so `b -> d` runs alongside it into a sink and
    // cannot put `d` on a cycle.
    graph.addEdge('b', 'd', 'bd');
    expect(idsOf(feedbackArcSet(graph, previous))).toEqual(idsOf(previous));
  });

  it('reverses inside a new cycle and leaves the old reversal alone', () => {
    const graph = triangle();
    const previous = feedbackArcSet(graph);
    graph.addEdge('d', 'a', 'da');
    const warm = feedbackArcSet(graph, previous);

    // The new cycle is `a -> d -> a`, so exactly one of its two edges has to
    // turn round, and the triangle's own reversal is untouched by it.
    for (const held of previous) expect(warm.has(held)).toBe(true);
    const added = [...warm].filter((id) => !previous.has(id));
    expect(added.length).toBe(1);
    expect(['ad', 'da']).toContain(String(added[0]));
  });

  it('drops a held reversal once its edge no longer lies on a cycle', () => {
    const graph = triangle();
    const previous = feedbackArcSet(graph);
    expect(previous.size).toBe(1);
    const held = [...previous][0];
    if (held === undefined) throw new Error('the triangle reverses one edge');

    // Breaking the cycle at an edge the previous run did NOT reverse leaves the
    // held one on no cycle at all, so holding it would draw an edge backwards
    // for a cycle that is gone.
    const other = ['ab', 'bc', 'ca'].find((id) => id !== String(held));
    if (other === undefined) throw new Error('the triangle has three edges');
    graph.removeEdge(other);
    expect(idsOf(feedbackArcSet(graph, previous))).toEqual([]);
  });

  it('ignores an entry whose edge the graph no longer holds', () => {
    const graph = triangle();
    const previous = new Set<EdgeId>([...feedbackArcSet(graph), 'gone' as EdgeId]);
    const warm = feedbackArcSet(graph, previous);
    expect(warm.has('gone' as EdgeId)).toBe(false);
    expect(warm.size).toBe(1);
  });

  it('never holds a self loop, whatever the previous set says', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'a', 'aa'],
        ['a', 'b', 'ab'],
      ],
    );
    expect(idsOf(feedbackArcSet(graph, new Set(['aa' as EdgeId])))).toEqual([]);
  });

  it('never holds an edge between two components, which is the shipped rule', () => {
    // `u -> v` joins two components of one node each, so no cycle needs it
    // turned round and the cold pass leaves it alone. A previous set naming it
    // is a set from another graph, and holding it would reverse an edge the
    // component rule forbids.
    const graph = build(
      ['u', 'v'],
      [['u', 'v', 'uv']],
    );
    expect(idsOf(feedbackArcSet(graph, new Set(['uv' as EdgeId])))).toEqual([]);
  });
});

/**
 * The parallel-edge case, which is the one place the retention rule had a
 * choice to make and the one place a measurement made it.
 *
 * A caller adds a second copy of an edge the previous run reversed. The new
 * copy is an edge no previous set can name, so a rule taken per EDGE leaves it
 * pointing as authored, which puts `a -> b` and `b -> a` into the seeded view
 * and lets the seeded run resolve the pair by turning the HELD copy back round.
 * A rule taken per PAIR holds every copy of a pair the previous set named, so
 * the pair keeps pointing the way it already pointed.
 *
 * Neither is wrong: both leave a legal feedback arc set, which is why the
 * assertion below is a stability count and not a correctness one. Measured over
 * this population, the reversal survives on 1,237 of 1,299 per pair against
 * 1,129 per edge, and the 62 that do not survive are ALL the `m/2` guard: at
 * these sizes two arcs can be more than half the graph, so holding both copies
 * breaks the bound and the answer falls back to a cold one.
 */
describe('a second copy of a reversed edge', () => {
  it('keeps the pair pointing the way the previous run pointed it', () => {
    const random = mulberry32(5);
    let cases = 0;
    let held = 0;
    let guardFired = 0;
    for (let seed = 0; seed < 4000; seed += 1) {
      const graph = randomDigraph(random);
      const cold = feedbackArcSet(graph);
      if (cold.size === 0) continue;
      const target = [...cold][Math.floor(random() * cold.size)];
      if (target === undefined) continue;
      const edge = graph.edges().find((candidate) => candidate.id === target);
      if (edge === undefined) continue;

      graph.addEdge(edge.source, edge.target, '#copy');
      const warm = feedbackArcSet(graph, cold);
      cases += 1;
      if (warm.has(target)) {
        held += 1;
        // The copy goes with it, which is what makes it a rule about pairs.
        expect(warm.has('#copy' as EdgeId)).toBe(true);
        continue;
      }
      if (idsOf(warm).join() === idsOf(feedbackArcSet(graph)).join()) guardFired += 1;
    }
    expect({ cases, held, guardFired }).toEqual({ cases: 1299, held: 1237, guardFired: 62 });
  });
});

describe('the seeded set is still a legal feedback arc set', () => {
  it('leaves an acyclic view on every random digraph, from every seed it is given', () => {
    const random = mulberry32(97);
    let checked = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const graph = randomDigraph(random);
      if (graph.nodes().length === 0) continue;
      const cold = feedbackArcSet(graph);

      // Three seeds per graph: the honest one, a hostile one naming every edge,
      // and one naming every edge the cold pass did not. The rule has to hold
      // for a set from an older graph as much as for the run before it.
      const everyEdge = new Set(graph.edges().map((edge) => edge.id));
      const complement = new Set([...everyEdge].filter((id) => !cold.has(id)));
      for (const seeded of [cold, everyEdge, complement]) {
        const warm = feedbackArcSet(graph, seeded);
        expect(referenceTopologicalOrder(graph, acyclicView(graph, warm))).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('reverses only edges that lie on a cycle, from every seed it is given', () => {
    const random = mulberry32(131);
    for (let seed = 0; seed < 200; seed += 1) {
      const graph = randomDigraph(random);
      if (graph.nodes().length === 0) continue;
      const cyclic = onACycle(graph);
      const everyEdge = new Set(graph.edges().map((edge) => edge.id));
      for (const seeded of [feedbackArcSet(graph), everyEdge]) {
        for (const id of feedbackArcSet(graph, seeded)) expect(cyclic.has(id)).toBe(true);
      }
    }
  });

  it('keeps the m/2 bound by falling back to a cold run when a seed would break it', () => {
    // A directed cycle of ten, seeded with every one of its arcs. Holding them
    // all is legal edge by edge, since every arc of a cycle lies on a cycle,
    // and it turns the graph inside out: the seeded view is the same cycle
    // walked backwards, so breaking it costs one more reversal and the answer
    // would be nine of ten arcs. The bound is what refuses that.
    const ids = Array.from({ length: 10 }, (unused, index) => `n${String(index)}`);
    const graph = build(
      ids,
      ids.map((id, index) => [id, ids[(index + 1) % ids.length] ?? id, `e${String(index)}`]),
    );
    const everyArc = new Set(graph.edges().map((edge) => edge.id));
    const warm = feedbackArcSet(graph, everyArc);
    expect(idsOf(warm)).toEqual(idsOf(feedbackArcSet(graph)));
    expect(warm.size * 2).toBeLessThanOrEqual(arcCount(graph));
  });

  it('keeps the m/2 bound on every random digraph, from every seed it is given', () => {
    const random = mulberry32(179);
    for (let seed = 0; seed < 200; seed += 1) {
      const graph = randomDigraph(random);
      if (graph.nodes().length === 0) continue;
      const everyEdge = new Set(graph.edges().map((edge) => edge.id));
      for (const seeded of [feedbackArcSet(graph), everyEdge]) {
        expect(feedbackArcSet(graph, seeded).size * 2).toBeLessThanOrEqual(arcCount(graph));
      }
    }
  });

  it('answers exactly as the cold pass does when handed no seed', () => {
    const random = mulberry32(223);
    for (let seed = 0; seed < 200; seed += 1) {
      const graph = randomDigraph(random);
      expect(idsOf(feedbackArcSet(graph, undefined))).toEqual(idsOf(feedbackArcSet(graph)));
    }
  });
});

/**
 * The smallest graph on which a leaf moves the cold answer, found by searching
 * the population at the foot of this file and then shrunk.
 *
 * `b` and `c` are a two-cycle and `a` points into it. The two arcs of that
 * cycle are STRUCTURALLY INTERCHANGEABLE, so which one the cold pass reverses
 * is settled by the last bit of an iterative solve, exactly as the determinism
 * section of `cycles.ts` says it is. Hanging a leaf off `a` moves that last bit
 * and the answer swaps from `bc` to `cb`. Nothing about the graph's cycles
 * changed, and both answers are equally good; what is not equally good is
 * redrawing the two-cycle the other way round because a leaf arrived somewhere
 * else.
 *
 * It is the honest smallest witness rather than the strongest one, and the
 * difference is worth stating: a symmetric pair is the easiest thing in the
 * world to swap, so this case alone would be weak evidence. The population
 * figure at the foot of this file is the claim; this is the case you can read.
 */
function twoCycleUnderALeaf(): Graph {
  return build(
    ['a', 'b', 'c'],
    [
      ['c', 'b', 'cb'],
      ['b', 'c', 'bc'],
      ['a', 'b', 'ab'],
    ],
  );
}

describe('the rank stages read the warm start', () => {
  /** A `PreparedState` with sizes filled in and an optional reversed set held. */
  function stateOf(graph: Graph, reversedEdges?: ReadonlySet<EdgeId>): PreparedState {
    const sizes = new Map<NodeId, Size>();
    for (const node of graph.nodes()) sizes.set(node.id, { width: 10, height: 10 });
    if (reversedEdges === undefined) return { graph, config: DEFAULT_LAYOUT_CONFIG, sizes };
    return {
      graph,
      config: DEFAULT_LAYOUT_CONFIG,
      sizes,
      // The other seven fields are empties rather than a second pipeline run,
      // for the reason `layout.warmstart.test.ts` gives beside its own: a stage
      // that started reading one of them would be reading a record no engine
      // produces, and that is a change to catch here.
      previous: {
        sizes: new Map(),
        ranks: new Map(),
        reversedEdges,
        virtualNodes: new Set(),
        virtualChains: new Map(),
        layers: [],
        positions: new Map(),
        routes: new Map(),
      },
    };
  }

  for (const stage of [longestPathRankStage, networkSimplexRankStage]) {
    it(`${stage.name} breaks the cycle where the previous run broke it`, () => {
      const graph = twoCycleUnderALeaf();
      const cold = stage.run(stateOf(graph)).reversedEdges;
      expect(idsOf(cold)).toEqual(['bc']);

      // The other arc of the same two-cycle is an equally legal answer, so a
      // stage handed it has to give it back rather than re-deriving its own.
      const held: ReadonlySet<EdgeId> = new Set(['cb' as EdgeId]);
      expect(idsOf(stage.run(stateOf(graph, held)).reversedEdges)).toEqual(['cb']);
    });
  }

  it('holds the reversal across a relayout, where a cold second run swaps it', () => {
    const graph = twoCycleUnderALeaf();
    const config = resolveConfig(undefined);
    const first = runPipeline(prepare(graph, config, undefined));
    expect(idsOf(first.routed.reversedEdges)).toEqual(['bc']);

    graph.addNode('leaf');
    graph.addEdge('a', 'leaf', 'aleaf');
    const cold = runPipeline(prepare(graph, config, undefined));
    const warm = runPipeline(prepare(graph, config, undefined, warmStartOf(first.routed)));

    // The cold figure is asserted as well as the warm one, so a change that
    // made the cold pass stable here cannot quietly empty this test.
    expect(idsOf(cold.routed.reversedEdges)).toEqual(['cb']);
    expect(idsOf(warm.routed.reversedEdges)).toEqual(['bc']);
  });
});

/**
 * What the warm start is worth, as the numbers that argue for it.
 *
 * The population is `randomDigraph`, which draws endpoints uniformly and so is
 * cyclic almost always, and the edit is ONE ADDED LEAF: a new node with one
 * edge into it from an existing one. A leaf changes no cycle, adds no strongly
 * connected component and cannot make one bigger, so the reversed set has no
 * reason at all to move and every case where it moves is the cold breaker
 * reporting a change in the graph's cycle structure that did not happen.
 *
 * The bench corpora are the other half of the honest answer and they are here
 * for scope rather than for drama: they are layered graphs with 1% and 2% of
 * their edges authored backwards, the least-squares heights on them are held
 * firmly by the 98% that run forwards, and a leaf moves the cold set on neither
 * of them. So the instability is a property of DENSE CYCLIC input and not of
 * every graph, which is the same honest scoping the M3.7a entry asks for around
 * the reversed set in general: on a DAG the set is empty and stays empty.
 */
describe('what the seed is worth', () => {
  it('holds the set on every leaf, where the cold pass moves it on about a quarter', () => {
    const random = mulberry32(7);
    let cases = 0;
    let coldMoved = 0;
    let warmMoved = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const graph = randomDigraph(random);
      const nodes = graph.nodes();
      if (nodes.length < 3) continue;
      const previous = feedbackArcSet(graph);
      if (previous.size === 0) continue;
      const anchor = nodes[Math.floor(random() * nodes.length)];
      if (anchor === undefined) continue;

      graph.addNode('#leaf');
      graph.addEdge(anchor.id, '#leaf', '#leafEdge');
      cases += 1;
      // Compared as sorted lists, since the answer is the set and not the order
      // it iterates in. The leaf's own edge is never in either set, so the two
      // sides of the comparison are over the same edges.
      const held = idsOf(previous).join();
      if (idsOf(feedbackArcSet(graph)).join() !== held) coldMoved += 1;
      if (idsOf(feedbackArcSet(graph, previous)).join() !== held) warmMoved += 1;
    }

    // The numbers this task shipped on, pinned as the ceiling and the floor
    // they are. The warm figure is the guarantee; the cold one is what makes
    // the guarantee worth having, and asserting it as a FLOOR is what stops a
    // future change to the cold breaker quietly emptying this test.
    expect({ cases, warmMoved }).toEqual({ cases: 132, warmMoved: 0 });
    expect(coldMoved).toBe(30);
  });
});
