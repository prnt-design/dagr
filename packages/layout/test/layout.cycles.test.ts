import { Graph } from '@dagr/graph';
import type { EdgeId } from '@dagr/graph';
import { describe, expect, it } from 'vitest';
import { feedbackArcSet } from '../src/cycles.js';
import { acyclicView, build, referenceTopologicalOrder } from './cycles-check.js';
import { mulberry32, randomDigraph } from './random.js';


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

  // Parallel edges must not fool the breaker into cutting a DAG. Every copy
  // pulls its two endpoints separately, so a doubled arc holds its endpoints a
  // rank apart twice as firmly as a single one, and a chain of doubled and
  // single arcs still comes out strictly increasing in height. The doubled
  // edges at both ends are what make that visible: they are the shape that
  // would fall over if the solve collapsed parallel arcs to one, or counted
  // them in the degrees but not in the right-hand side.
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

  // The case above is about a graph with no cycle in it. This one has a real
  // cycle, `b -> c` doubled against a single `c -> b`, and the cheap cut is the
  // single arc. The two copies pulling `c` below `b` outvote the one pulling it
  // above, so `c` settles a third of a rank BELOW `b` rather than tying with
  // it, and `c -> b` is the arc that then runs backwards. Collapse the copies
  // and the two sides cancel exactly, `b` and `c` tie, and the answer falls
  // through to the tie break instead of being decided by the graph. It happens
  // to come out the same way here, which is why the case at
  // `weighs parallel copies` exists as well: that one moves.
  //
  // The symptom of getting this wrong is a worse answer rather than a wrong
  // one, which is exactly why it needs its own case: nothing about acyclicity
  // catches it.
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

  // And this one holds the tie break, which is the other thing that decides an
  // answer here. Unlike the two cases above, the mutant does not cut more
  // edges, it cuts a different one, so nothing about size or acyclicity catches
  // it and only the exact set does. That is still worth pinning: which edge
  // gets reversed is what the router draws going the other way, and stability
  // across runs is a stated guarantee of this module rather than an
  // implementation detail.
  //
  // The mechanism: `a -> c` and `c -> a` pull against each other with equal
  // weight, so they cancel and `a` and `c` settle at the SAME height, whatever
  // the two arcs into `b` do (those only fix `b` one rank below both). A tie is
  // then broken by vertex number, `a` was added before `c`, so the order is
  // (a, c, b) and `c -> a` is the arc running backwards. Break the tie the
  // other way and the run reverses `a -> c` instead.
  //
  // Both answers cut the two-cycle with one arc, so both are legal and neither
  // is obviously better by eye. They are not equal downstream: reversing
  // `c -> a` puts `a` and the two `a -> b` arcs at ranks 0 and 1 and the view
  // is 2 ranks deep, where reversing `a -> c` stacks c, a, b and makes it 3.
  it('breaks a tie by node order, so the cycle is cut on the same side each run', () => {
    const graph = build(
      ['a', 'b', 'c'],
      [
        ['a', 'b', 'ab1'],
        ['a', 'b', 'ab2'],
        ['a', 'c', 'ac'],
        ['c', 'a', 'ca'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['ca']);
  });

  // The flip, which is what holds the `m/2` bound up now that the greedy pick
  // that used to prove it is gone.
  //
  // A directed cycle whose vertices were added in the order that walks it
  // BACKWARDS is the degenerate case for a least-squares order: every vertex
  // has one arc in and one out, so the right-hand side is zero everywhere,
  // every height ties at zero, and the tie break hands back insertion order.
  // Read straight, that order has `v0` first and the cycle running
  // v0 <- v1 <- ... <- v5 <- v0, so five of its six arcs run backwards and
  // reversing them all would be both absurd and over the bound.
  //
  // Flipping the order when more than half its arcs run backwards costs one
  // comparison and takes the other side, which here is one arc. Delete the flip
  // and this returns five ids instead of one.
  it('flips an order that has more arcs running backwards than forwards', () => {
    const graph = build(
      ['v0', 'v1', 'v2', 'v3', 'v4', 'v5'],
      [
        ['v1', 'v0', 'e10'],
        ['v2', 'v1', 'e21'],
        ['v3', 'v2', 'e32'],
        ['v4', 'v3', 'e43'],
        ['v5', 'v4', 'e54'],
        ['v0', 'v5', 'e05'],
      ],
    );
    expect([...feedbackArcSet(graph)]).toEqual(['e05']);
  });

  // A self loop is skipped when the arcs are numbered, and not only because it
  // is never reversed. It contributes a term the solve cannot reduce, since
  // `s(v) - s(v) - 1` is minus one whatever the height is, while adding two to
  // its vertex's degree and so damping every real arc attached to that vertex.
  // Count the loops and `a` and `c` are held back against the arcs that should
  // be spreading them out, which is how a graph whose only cycles are the loops
  // themselves ends up with a real edge reversed.
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

  // Every copy pulls separately, so three arcs one way against one the other
  // settle `b` above `a` by half a rank and the one arc is what runs backwards.
  // `b` is added first on purpose: collapse the copies and the two directions
  // cancel exactly, the heights tie, the tie goes to `b` on node order, and all
  // three copies of `a -> b` get reversed instead. So this case moves under the
  // mutation that `weighs the in-degree drop` survives, which is why both are
  // here.
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

  // The heights are read as real numbers and not as ranks, which is what this
  // case says.
  //
  // The solve puts `early` and `late` at -0.7 and `sink`, `x` and `y` within a
  // rounding error of 0.3. The two-cycle between `x` and `y` cancels, so
  // nothing in the graph separates them by a whole rank and they are ordered on
  // a margin far below one. Round the heights to integers before ordering,
  // which is the tempting simplification since a rank is an integer, and all
  // three of `sink`, `x` and `y` collapse onto the same value, the tie goes to
  // `x` on node order, and the cycle is cut on `y -> x` instead. Both answers
  // break the cycle with one edge and both are legal; only one of them is the
  // same answer twice, which is what M3 relayout rests on.
  it('orders on the solved heights rather than on rounded ranks', () => {
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
  // Each two-cycle cancels, so its two ends sit level with each other, and the
  // chain `g -> s -> c1 -> f1` spreads those levels a rank apart: the heights
  // come out near -1.7 for `g` and `h`, -0.7 for `s`, 0.3 for `c1` and `c2` and
  // 1.3 for `f1` and `f2`. Exactly one arc of each two-cycle runs backwards in
  // the order that produces, whichever way round the pair falls, and all three
  // pairs sit inside one component, so one arc of each is reversed. Which one
  // is arbitrary and is settled by the last bits of the solve rather than by
  // the node order, which the determinism section of `cycles.ts` spells out;
  // this is the witness it quotes.
  //
  // What the rule DECLINES is not visible in this set, because `s -> c1` runs
  // forwards here. That is the honest reading of this witness and it is why the
  // `sc1` assertion below is stated separately: the set is right whether or not
  // the component rule is applied, and what the second assertion pins is that
  // the rule does not reach an arc it should not. The arc the rule actually
  // saves is in the four-node witness that follows.
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

        // The bound, which this module now establishes by construction rather
        // than inheriting from the greedy heuristic's paper. An arc runs
        // backwards in exactly one of an order and its reverse, so the two
        // backward sets partition the arcs and the smaller of them is at most
        // half; the pass counts and takes the smaller side. The component rule
        // only takes arcs OUT of that set, so the set asserted on here is a
        // subset of one already under `m/2` and the bound holds a fortiori.
        //
        // This population is where the bound earns its keep. These graphs are
        // small, dense and drawn with endpoints chosen uniformly, so they have
        // no layering for a least-squares order to find, which is the shape
        // that order is worst on. The flip is what stops that turning into an
        // absurd answer.
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
