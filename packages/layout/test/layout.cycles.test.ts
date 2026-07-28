import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { feedbackArcSet } from '../src/cycles.js';
import { mulberry32, randomDigraph } from './random.js';

/** A graph from a script of `addNode`/`addEdge` calls, for the readable cases. */
function build(nodes: readonly string[], edges: readonly (readonly [string, string, string])[]) {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/** One arc of the digraph a reversal decision leaves behind. */
type Arc = readonly [NodeId, NodeId];

/**
 * The digraph the ranker will actually rank: every edge, pointing the way the
 * feedback set says, with self loops dropped because they constrain nothing and
 * are never reversed.
 */
function acyclicView(graph: Graph, reversed: ReadonlySet<EdgeId>): Arc[] {
  const arcs: Arc[] = [];
  for (const edge of graph.edges()) {
    if (edge.source === edge.target) continue;
    arcs.push(reversed.has(edge.id) ? [edge.target, edge.source] : [edge.source, edge.target]);
  }
  return arcs;
}

/**
 * A topological order of a digraph, or `undefined` if it has a cycle.
 *
 * Written from scratch here, and deliberately by a different method than the
 * production code: this is a three-colour depth-first search that reports a
 * cycle when it meets a grey vertex, where `longestPathRankStage` uses a
 * Kahn-style sweep over in-degrees. A checker that shared an implementation
 * with the thing it checks would carry the same bug and turn this assertion
 * into a no-op, which is the failure this file exists to rule out.
 *
 * Iterative rather than recursive, so a long random chain cannot blow the stack
 * and be mistaken for a result.
 */
function referenceTopologicalOrder(graph: Graph, arcs: readonly Arc[]): NodeId[] | undefined {
  const successors = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes()) successors.set(node.id, []);
  for (const [from, to] of arcs) successors.get(from)?.push(to);

  const state = new Map<NodeId, 'open' | 'done'>();
  const finished: NodeId[] = [];
  for (const root of graph.nodes()) {
    if (state.has(root.id)) continue;
    state.set(root.id, 'open');
    const stack: { readonly id: NodeId; next: number }[] = [{ id: root.id, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const outgoing = successors.get(frame.id) ?? [];
      if (frame.next >= outgoing.length) {
        state.set(frame.id, 'done');
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const successor = outgoing[frame.next];
      frame.next += 1;
      if (successor === undefined) continue;
      const seen = state.get(successor);
      // An arc back to a vertex still on the stack closes a cycle.
      if (seen === 'open') return undefined;
      if (seen === undefined) {
        state.set(successor, 'open');
        stack.push({ id: successor, next: 0 });
      }
    }
  }
  return finished.reverse();
}

describe('feedbackArcSet', () => {
  it('reverses nothing when the graph is already acyclic', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['a', 'c', 'ac'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual([]);
  });

  // Parallel edges must not fool the breaker into cutting a DAG. The degree
  // bookkeeping is weighted: removing a vertex drops each neighbour's degree by
  // the number of arcs between them, not by one. Dropping by one leaves `b`
  // holding an in-degree of 1 after `a` goes, so `b` is never recognised as a
  // source, the run falls through to the delta bucket, and the order that comes
  // out puts `c` before `b`, which reverses `b -> c` in a graph with no cycle in
  // it at all. The doubled edges at both ends are what make that visible.
  it('is not fooled into cutting an acyclic graph by parallel edges', () => {
    const graph = build(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['b', 'c', 'bc'],
        ['c', 'd', 'cd1'],
        ['c', 'd', 'cd2'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual([]);
  });

  // The case above pins the two weighted decrements as a pair: unweighting both
  // fails it. Unweighting only the in-degree line survives it, so this one holds
  // that line alone. There is a real cycle here (`b -> c` doubled against
  // `c -> b`), and the cheap cut is the single `c -> b`. Dropping `b`'s
  // in-degree by one rather than by three when `a` goes leaves `b` looking like
  // it still has an unsatisfied predecessor, which changes which of the two
  // gets picked first, and the run cuts both copies of `b -> c` instead. So the
  // symptom here is a worse answer rather than a wrong one, which is exactly
  // why it needs its own case: nothing about acyclicity catches it.
  it('weighs the in-degree drop, so a cycle is cut on its cheap side', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['a', 'b', 'ab3'],
        ['b', 'c', 'bc1'],
        ['b', 'c', 'bc2'],
        ['c', 'b', 'cb'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['cb']);
  });

  // And this one holds the out-degree line, the other half of the pair. Unlike
  // the two cases above, the mutant here does not cut more edges, it cuts a
  // different one, so nothing about size or acyclicity catches it and only the
  // exact set does. That is still worth pinning: which edge gets reversed is
  // what the router draws going the other way, and stability across runs is a
  // stated guarantee of this module rather than an implementation detail.
  //
  // The mechanism: `b` is a sink, so it goes first, and taking it drops `a`'s
  // out-degree by the two arcs into it. That is what lets `a` fall to the same
  // delta as `c`, where the FIFO bucket puts `c` first (it was seeded there and
  // `a` only just arrived), and the order c, a, b reverses `a -> c`. Dropping
  // `a` by one instead leaves it a delta above `c`, so `a` is picked first and
  // the run reverses `c -> a`.
  it('weighs the out-degree drop, so the cycle is cut on the same side each run', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['a', 'c', 'ac'],
        ['c', 'a', 'ca'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ac']);
  });

  // A self loop is skipped when the condensation is built, and not only because
  // it is never reversed. A loop adds one to BOTH of its vertex's degrees, so it
  // leaves `outdeg - indeg` alone and still pushes the vertex out of the sink
  // and source bins into a delta bucket. Counting the loops here would stop `c`
  // being a source, get it picked late, and put `c` behind `b` in the order,
  // which reverses `c -> b` in a graph whose only cycles are the loops
  // themselves.
  it('is not fooled into cutting an acyclic graph by self loops', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'a', 'aa'],
        ['b', 'a', 'ba1'],
        ['b', 'a', 'ba2'],
        ['c', 'b', 'cb'],
        ['c', 'c', 'cc'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual([]);
  });

  it('breaks a two-node cycle with exactly one edge', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'b', 'ab'],
        ['b', 'a', 'ba'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ba']);
  });

  it('breaks a three-node cycle with exactly one edge', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'a', 'ca'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ca']);
  });

  // A self loop is a cycle whichever way it points, so reversing it buys
  // nothing, and the pipeline already tolerates it: the runner compares
  // endpoint ranks with `<=` so both ends may share a rank.
  it('never reverses a self loop, even when it is the whole graph', () => {
    const graph = build(['a'], [['a', 'a', 'aa']]);
    expect([...feedbackArcSet(graph)]).toEqual([]);
  });

  it('never reverses a self loop sitting inside a cycle it cannot fix', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'a', 'aa'],
        ['a', 'b', 'ab'],
        ['b', 'a', 'ba'],
        ['b', 'b', 'bb'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ba']);
  });

  // Every copy between the same pair has to go the same way. Reversing one copy
  // of `a -> b` and leaving another would put a two-cycle straight back into the
  // view that is supposed to be acyclic.
  it('reverses every copy of a parallel pair that runs the wrong way, and no other', () => {
    const graph = build(
      ['a', 'b'],
      [
        ['a', 'b', 'ab1'],
        ['b', 'a', 'ba1'],
        ['a', 'b', 'ab2'],
        ['b', 'a', 'ba2'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ba1', 'ba2']);
  });

  // The condensation is weighted, so the greedy pick sees three arcs one way
  // against one the other and reverses the one rather than the three. `b` is
  // added first on purpose: an unweighted condensation makes this a tie, the
  // tie goes to `b`, and all three copies of `a -> b` get reversed instead.
  it('weighs parallel copies, so the cheaper direction is the one reversed', () => {
    const graph = build(
      ['b', 'a'],
      [
        ['b', 'a', 'ba'],
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['a', 'b', 'ab3'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ba']);
  });

  // The tie-break the module documents, for the one case where a vertex's
  // degrees change and its bucket does not. Taking the sink drops `early`'s
  // out-degree from 2 to 1, which leaves it a source, so it keeps its place at
  // the head of the source queue ahead of `late`. Move it to the back instead
  // and `late` is taken first, the two delta-bucket vertices arrive in the
  // other order, and the cycle between `x` and `y` is cut on its other arc.
  // Both answers break the cycle with one edge; only one of them is the same
  // answer twice, which is what M3 relayout rests on.
  it('keeps a vertex in place when its degrees change but its bucket does not', () => {
    const graph = build(
      ['early', 'sink', 'x', 'y', 'late'],
      [
        ['early', 'sink', 'early-sink'],
        ['x', 'y', 'xy'],
        ['y', 'x', 'yx'],
        ['early', 'y', 'early-y'],
        ['late', 'x', 'late-x'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['xy']);
  });

  // The component rule, on a witness small enough to check by eye.
  //
  // Four strongly connected components: {g, h}, {c1, c2} and {f1, f2} are each
  // a two-cycle, and {s} is alone, because `c1` reaches only `c2`, `f1` and
  // `f2` and so nothing leads back into `s`.
  //
  // The order this pass builds is (c1, h, f1, f2, g, c2, s). `c1` starts in the
  // top delta bucket at `outdeg - indeg` of 1 and is ahead of `g` there on node
  // order, so it goes first; taking it leaves `s` and `c2` with no out-arcs, so
  // both go to the tail sequence; the rest unzips. Four arcs run backwards in
  // that order: `g -> h`, `s -> c1`, `c2 -> c1` and `f2 -> f1`.
  //
  // Three of them have both endpoints inside one component and are reversed.
  // `s -> c1` does not, and it is left alone: it lies on no cycle, so no cycle
  // needs it turned round, and turning it round only stretches the view.
  it('leaves a backward arc alone when its endpoints are in different components', () => {
    const graph = build(
      ['s', 'c1', 'c2', 'f1', 'f2', 'g', 'h'],
      [
        ['g', 'h', 'gh'],
        ['h', 'g', 'hg'],
        ['g', 's', 'gs'],
        ['s', 'c1', 'sc1'],
        ['c1', 'c2', 'c1c2'],
        ['c2', 'c1', 'c2c1'],
        ['c1', 'f1', 'c1f1'],
        ['c1', 'f2', 'c1f2'],
        ['f1', 'f2', 'f1f2'],
        ['f2', 'f1', 'f2f1'],
      ],
    );

    const reversed = feedbackArcSet(graph);
    expect([...reversed]).toEqual(['gh', 'c2c1', 'f2f1']);
    expect(reversed.has('sc1'), 'sc1 crosses a component boundary').toBe(false);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, reversed))).toHaveLength(7);
  });

  // The witness M2.2b records, which is why the rule is stated over the WHOLE
  // class of cross-component arcs rather than over one of them at a time.
  //
  // Components {a, b}, {u} and {v}, so `u -> v` and `u -> b` are the
  // cross-component arcs and `a -> b` and `b -> a` are the intra-component
  // ones. Under the order (v, a, b, u), which is not the order this pass
  // builds but is an order some greedy pass could build, the backward set is
  // {u -> v, b -> a, u -> b}. Take `u -> v` out of it on its own and the view
  // holds `u -> v, v -> a, a -> b, b -> u`, which is a cycle: the still
  // reversed `u -> b` supplies the arc back. Take the whole cross-component
  // class out and the view holds `u -> v, v -> a, a -> b, a -> b, u -> b`,
  // which is acyclic, and that is what the proof in `cycles.ts` gives in
  // general. Dropping SOME is what has no theorem behind it.
  //
  // The last two assertions are what this pass actually answers here. Its own
  // order is (u, v, b, a), whose only backward arc is the intra-component
  // `a -> b`, so the graph is a regression test for the rule leaving legal
  // answers alone as much as for the rule itself.
  it('keeps the whole cross-component class out, which one at a time would not', () => {
    const graph = build(
      ['u', 'v', 'a', 'b'],
      [
        ['u', 'v', 'uv'],
        ['v', 'a', 'va'],
        ['a', 'b', 'ab'],
        ['b', 'a', 'ba'],
        ['u', 'b', 'ub'],
      ],
    );

    const wholeBackwardSet = new Set<EdgeId>(['uv', 'ba', 'ub']);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, wholeBackwardSet))).toBeDefined();
    const withoutOne = new Set<EdgeId>(['ba', 'ub']);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, withoutOne))).toBeUndefined();
    const withoutTheClass = new Set<EdgeId>(['ba']);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, withoutTheClass))).toBeDefined();

    const reversed = feedbackArcSet(graph);
    expect([...reversed]).toEqual(['ab']);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, reversed))).toHaveLength(4);
  });

  it('leaves a digraph an independent topological sort can order', () => {
    // Two cycles sharing a vertex, a mutual pair hanging off one of them, and a
    // self loop, so a set that broke only the first cycle would still fail.
    const graph = build(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b', 'ab'],
        ['b', 'c', 'bc'],
        ['c', 'a', 'ca'],
        ['c', 'd', 'cd'],
        ['d', 'e', 'de'],
        ['e', 'c', 'ec'],
        ['d', 'd', 'dd'],
        ['e', 'd', 'ed'],
      ],
    );
    // The reference sort has to actually detect a cycle, or asserting that it
    // succeeds afterwards would prove nothing at all.
    expect(referenceTopologicalOrder(graph, acyclicView(graph, new Set()))).toBeUndefined();

    const reversed = feedbackArcSet(graph);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, reversed))).toHaveLength(5);
  });
});

describe('feedbackArcSet on random digraphs', () => {
  // Fixed seeds rather than a clock or `Math.random`, so a failure is a failure
  // anyone can reproduce from the name of the test that reported it.
  for (const seed of [1, 2, 7, 42, 1337, 20260726]) {
    it(`holds every guarantee for seed ${String(seed)}`, () => {
      const random = mulberry32(seed);
      // Counted and asserted on below. Every check in this loop is vacuously
      // true on a graph with no cycle and no self loop, so a generator that
      // drifted into drawing only sparse DAGs would leave the suite green and
      // testing nothing.
      let broken = 0;
      let looped = 0;
      for (let round = 0; round < 40; round += 1) {
        const graph = randomDigraph(random);
        const reversed = feedbackArcSet(graph);
        const where = `seed ${String(seed)} round ${String(round)}`;
        if (reversed.size > 0) broken += 1;
        if (graph.edges().some((edge) => edge.source === edge.target)) looped += 1;

        for (const id of reversed) {
          expect(graph.hasEdge(id), `${where}: ${id} is an edge of the graph`).toBe(true);
          const edge = graph.getEdge(id);
          expect(edge?.source === edge?.target, `${where}: ${id} is a self loop`).toBe(false);
        }

        expect(
          referenceTopologicalOrder(graph, acyclicView(graph, reversed)),
          `${where}: the reversed digraph sorts`,
        ).toBeDefined();

        // Implied by the paper's `|F| <= m/2 - n/6`, and the half of it that
        // survives the weighted condensation: the greedy pick always has
        // `indeg <= outdeg`, so it never makes more arcs backward than forward,
        // and sinks and sources make none backward at all. The component rule
        // only takes arcs OUT of that backward set, so the set asserted on here
        // is a subset of the one the bound is proved for and the bound holds a
        // fortiori.
        const breakable = graph.edges().filter((edge) => edge.source !== edge.target).length;
        expect(reversed.size, `${where}: |F| against m/2`).toBeLessThanOrEqual(breakable / 2);
      }
      expect(broken, `seed ${String(seed)}: rounds that needed an edge reversed`).toBeGreaterThan(0);
      expect(looped, `seed ${String(seed)}: rounds with a self loop`).toBeGreaterThan(0);
    });
  }
});

/**
 * A graph from a script that mixes explicit and generated ids, parallel edges,
 * a self loop, a removal, and several cycles, so its iteration order is not
 * simply alphabetical. Reproducibility here rests on graph iteration order, so
 * the graph it is demonstrated on should be one whose order is not the obvious
 * one.
 */
function scripted(): Graph {
  const graph = new Graph();
  graph.addNode('zeta');
  graph.addNode('alpha');
  graph.addNode();
  graph.addNode('mid');
  graph.addEdge('zeta', 'alpha');
  graph.addEdge('alpha', 'zeta', 'back');
  graph.addEdge('alpha', 'n1');
  graph.addEdge('n1', 'zeta');
  graph.addEdge('mid', 'mid');
  graph.removeNode('alpha');
  graph.addNode('alpha');
  graph.addEdge('mid', 'alpha');
  graph.addEdge('alpha', 'mid');
  graph.addEdge('alpha', 'mid');
  return graph;
}

describe('feedbackArcSet determinism', () => {
  it('gives the same graph the same set twice', () => {
    const graph = scripted();
    expect([...feedbackArcSet(graph)]).toEqual([...feedbackArcSet(graph)]);
  });

  it('gives two graphs from the same script the same set', () => {
    expect([...feedbackArcSet(scripted())]).toEqual([...feedbackArcSet(scripted())]);
  });

  it('breaks every cycle in that script', () => {
    const graph = scripted();
    const reversed = feedbackArcSet(graph);
    expect(reversed.size).toBeGreaterThan(0);
    expect(referenceTopologicalOrder(graph, acyclicView(graph, reversed))).toBeDefined();
  });
});
