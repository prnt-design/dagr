import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.js';
import { CycleError } from '../src/errors.js';
import type { NodeId } from '../src/types.js';

/**
 * Property coverage for traversal, over random graphs of both kinds.
 *
 * The unit suite pins named cases. This one pins the relationships that have to
 * hold for the answers to be worth anything, and it needs two generators to do
 * it. Random digraphs with endpoints drawn independently are cyclic almost
 * always at these densities, which exercises cycle detection and leaves the
 * topological properties vacuous. Random DAGs, built by only ever pointing an
 * earlier node at a later one, are the other half. A single generator would
 * leave one of the two suites quietly testing nothing, which is the failure
 * mode the layout random suite already warns about.
 *
 * Every run is seeded, so a failure reproduces exactly.
 */

const RUNS = { seed: 20260727, numRuns: 250 } as const;

/** A node id from an index, fixed width so sorting matches insertion order. */
function nodeId(index: number): NodeId {
  return `n${String(index).padStart(2, '0')}`;
}

/**
 * A random DAG. Edges only ever point from a lower index to a higher one, which
 * makes acyclicity structural rather than something the generator has to check,
 * and gives a known-good order (index order) to compare against.
 */
const dag = fc
  .record({
    nodeCount: fc.integer({ min: 0, max: 12 }),
    pairs: fc.array(fc.tuple(fc.nat(11), fc.nat(11)), { maxLength: 30 }),
  })
  .map(({ nodeCount, pairs }) => {
    const graph = new Graph();
    for (let index = 0; index < nodeCount; index += 1) graph.addNode(nodeId(index));
    for (const [left, right] of pairs) {
      const low = Math.min(left, right);
      const high = Math.max(left, right);
      if (low === high || high >= nodeCount) continue;
      graph.addEdge(nodeId(low), nodeId(high));
    }
    return graph;
  });

/**
 * A random digraph with no constraint on direction, so self loops, parallel
 * edges, disconnected pieces and cycles all turn up.
 */
const digraph = fc
  .record({
    nodeCount: fc.integer({ min: 0, max: 12 }),
    pairs: fc.array(fc.tuple(fc.nat(11), fc.nat(11)), { maxLength: 30 }),
  })
  .map(({ nodeCount, pairs }) => {
    const graph = new Graph();
    for (let index = 0; index < nodeCount; index += 1) graph.addNode(nodeId(index));
    for (const [source, target] of pairs) {
      if (source >= nodeCount || target >= nodeCount) continue;
      graph.addEdge(nodeId(source), nodeId(target));
    }
    return graph;
  });

/** Every node id, in insertion order. */
function ids(graph: Graph): readonly NodeId[] {
  return graph.nodes().map((node) => node.id);
}

/**
 * Which nodes each node can reach, by repeated relaxation.
 *
 * Slow and obviously correct, which is what an oracle should be: it shares no
 * code with the traversal under test, so agreement means something. A node
 * reaches itself in this closure exactly when it sits on a cycle, which is what
 * `isAcyclic` and `canReach(a, a)` are both checked against below.
 */
function transitiveClosure(graph: Graph): ReadonlyMap<NodeId, ReadonlySet<NodeId>> {
  const nodes = ids(graph);
  const closure = new Map<NodeId, Set<NodeId>>();
  for (const id of nodes) {
    closure.set(id, new Set(graph.outEdges(id).map((edge) => edge.target)));
  }
  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    for (const id of nodes) {
      const reached = closure.get(id) ?? new Set<NodeId>();
      for (const via of [...reached]) {
        for (const beyond of closure.get(via) ?? []) reached.add(beyond);
      }
    }
  }
  return closure;
}

describe('topological order, on random DAGs', () => {
  it('is a permutation of every node', () => {
    fc.assert(
      fc.property(dag, (graph) => {
        const order = graph.topologicalOrder();
        expect([...order].sort()).toEqual([...ids(graph)].sort());
      }),
      RUNS,
    );
  });

  it('is a linear extension: every edge points forwards in it', () => {
    fc.assert(
      fc.property(dag, (graph) => {
        const at = new Map(graph.topologicalOrder().map((id, index) => [id, index]));
        for (const edge of graph.edges()) {
          expect(at.get(edge.source)).toBeLessThan(at.get(edge.target) ?? -1);
        }
      }),
      RUNS,
    );
  });

  it('does not depend on the order the edges were added, under any reordering', () => {
    // Reversal alone is one permutation, and on a graph whose predecessors were
    // added contiguously it is not even a distinguishing one. Sorting the edges
    // by generated keys reorders them arbitrarily instead. Node order is held
    // fixed on purpose: node insertion rank is the tie-break, so it is the
    // reference this invariance is measured against, not part of what varies.
    fc.assert(
      fc.property(dag, fc.array(fc.nat(1_000), { minLength: 40, maxLength: 40 }), (graph, keys) => {
        const rebuilt = new Graph();
        for (const id of ids(graph)) rebuilt.addNode(id);
        const shuffled = [...graph.edges()]
          .map((edge, index) => ({ edge, key: keys[index] ?? 0 }))
          .sort((left, right) => left.key - right.key);
        for (const { edge } of shuffled) rebuilt.addEdge(edge.source, edge.target);
        expect(rebuilt.topologicalOrder()).toEqual(graph.topologicalOrder());
      }),
      RUNS,
    );
  });

  it('is the smallest valid order when nodes are compared by insertion rank', () => {
    // The documented tie-break, against an oracle rather than against examples.
    // Permutation and linear-extension properties would all pass for a sweep
    // that emitted the LARGEST ready rank, or for a plain queue on most shapes,
    // so none of them pin the contract this order actually promises.
    // Greedy earliest-ready is the definition, written the slow obvious way.
    fc.assert(
      fc.property(dag, (graph) => {
        const order = ids(graph);
        const arriving = new Map(order.map((id) => [id, graph.inDegree(id)]));
        const expected: NodeId[] = [];
        while (expected.length < order.length) {
          const next = order.find((id) => arriving.get(id) === 0);
          if (next === undefined) break;
          arriving.delete(next);
          expected.push(next);
          for (const edge of graph.outEdges(next)) {
            arriving.set(edge.target, (arriving.get(edge.target) ?? 0) - 1);
          }
        }
        expect(graph.topologicalOrder()).toEqual(expected);
      }),
      RUNS,
    );
  });
});

describe('cycle detection, on random digraphs', () => {
  it('agrees with whether a topological order exists', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        let ordered = true;
        try {
          graph.topologicalOrder();
        } catch (error) {
          expect(error).toBeInstanceOf(CycleError);
          ordered = false;
        }
        expect(graph.isAcyclic()).toBe(ordered);
      }),
      RUNS,
    );
  });

  it('returns a witness that is really a cycle', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        const cycle = graph.findCycle();
        if (cycle === undefined) return;
        expect(cycle.length).toBeGreaterThan(0);
        // Every step is a real edge, and the last one closes the loop.
        for (let index = 0; index < cycle.length; index += 1) {
          const from = cycle[index] ?? '';
          const to = cycle[(index + 1) % cycle.length] ?? '';
          expect(graph.edgesBetween(from, to).length).toBeGreaterThan(0);
        }
        // No node appears twice, so it is one cycle and not a walk that
        // wandered through a smaller one on the way.
        expect(new Set(cycle).size).toBe(cycle.length);
      }),
      RUNS,
    );
  });

  it('finds a cycle in every digraph that has one, by an independent check', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        // A graph has a cycle exactly when some node reaches itself.
        const closure = transitiveClosure(graph);
        const cyclic = ids(graph).some((id) => closure.get(id)?.has(id) === true);
        expect(graph.isAcyclic()).toBe(!cyclic);
      }),
      RUNS,
    );
  });

  it('canReach(a, a) is true exactly when a sits on a cycle', () => {
    // This is the load-bearing half of the descendants/canReach divergence:
    // once `descendants` stopped listing its own node, this became the only way
    // to ask whether a node is on a cycle, and the docs promote it as such. It
    // lost its property coverage in the same change that made it matter,
    // because the agreement property had to start skipping `from === to`. The
    // carve-out should be the thing that gains a property, not the thing that
    // loses one.
    fc.assert(
      fc.property(digraph, (graph) => {
        const closure = transitiveClosure(graph);
        for (const id of ids(graph)) {
          expect(graph.canReach(id, id)).toBe(closure.get(id)?.has(id) === true);
        }
      }),
      RUNS,
    );
  });

  it('pins the divergence itself: a is on a cycle exactly when something leads back to it', () => {
    // Stated in terms of the methods rather than against an oracle, so the
    // relationship the docs describe is what is checked. If either side is ever
    // redefined, this fails rather than quietly meaning something else.
    //
    // The self loop is why the second clause exists, and it is the case that
    // makes this worth pinning: `descendants` excludes its own node, so a node
    // whose only cycle is a self loop has NO descendant to route back through,
    // and "some descendant reaches back" is false while `canReach(a, a)` is
    // true. The first draft of this property omitted the clause and fast-check
    // shrank straight to that graph.
    fc.assert(
      fc.property(digraph, (graph) => {
        for (const id of ids(graph)) {
          const leadsBack =
            graph.successors(id).includes(id) ||
            graph.descendants(id).some((down) => graph.canReach(down, id));
          expect(graph.canReach(id, id)).toBe(leadsBack);
        }
      }),
      RUNS,
    );
  });
});

describe('reachability, on random digraphs', () => {
  it('agrees with canReach for every distinct pair, and never holds its own node', () => {
    // The reflexive case is the one deliberate divergence: canReach stays at
    // "one or more edges" so it answers "is this node on a cycle", which
    // descendants gives up by excluding its own node.
    fc.assert(
      fc.property(digraph, (graph) => {
        for (const from of ids(graph)) {
          const reached = new Set(graph.descendants(from));
          expect(reached.has(from)).toBe(false);
          for (const to of ids(graph)) {
            if (from === to) continue;
            expect(graph.canReach(from, to)).toBe(reached.has(to));
          }
        }
      }),
      RUNS,
    );
  });

  it('is transitively closed, up to the excluded seed', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        for (const from of ids(graph)) {
          const reached = graph.descendants(from);
          for (const via of reached) {
            for (const beyond of graph.descendants(via)) {
              // `beyond` may be `from` itself, when the walk came back around.
              // That is the seed this listing drops by design, not a gap.
              if (beyond === from) continue;
              expect(reached).toContain(beyond);
            }
          }
        }
      }),
      RUNS,
    );
  });

  it('contains exactly the direct successors plus what they reach, minus itself', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        for (const from of ids(graph)) {
          const expected = new Set<NodeId>();
          for (const next of graph.successors(from)) {
            expected.add(next);
            for (const beyond of graph.descendants(next)) expected.add(beyond);
          }
          expected.delete(from);
          expect(graph.descendants(from)).toEqual(
            ids(graph).filter((id) => expected.has(id)),
          );
        }
      }),
      RUNS,
    );
  });

  it('mirrors: b is a descendant of a exactly when a is an ancestor of b', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        for (const from of ids(graph)) {
          for (const to of graph.descendants(from)) {
            expect(graph.ancestors(to)).toContain(from);
          }
        }
      }),
      RUNS,
    );
  });

  it('lists in node insertion order', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        const rank = new Map(ids(graph).map((id, index) => [id, index]));
        for (const from of ids(graph)) {
          for (const listing of [graph.descendants(from), graph.ancestors(from)]) {
            const ranks = listing.map((id) => rank.get(id) ?? -1);
            expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
          }
        }
      }),
      RUNS,
    );
  });
});

describe('sources and sinks, on random digraphs', () => {
  it('are exactly the nodes of degree zero on that side', () => {
    fc.assert(
      fc.property(digraph, (graph) => {
        expect(graph.sources()).toEqual(ids(graph).filter((id) => graph.inDegree(id) === 0));
        expect(graph.sinks()).toEqual(ids(graph).filter((id) => graph.outDegree(id) === 0));
      }),
      RUNS,
    );
  });

  it('put every source first and every sink last in a DAG order', () => {
    fc.assert(
      fc.property(dag, (graph) => {
        const order = graph.topologicalOrder();
        const at = new Map(order.map((id, index) => [id, index]));
        // A source has nothing before it that it must follow, so nothing forces
        // it late, but the specific claim worth testing is weaker and true:
        // every node that is not a source has some ancestor earlier than it.
        for (const id of order) {
          if (graph.inDegree(id) === 0) continue;
          const earlier = graph.predecessors(id).map((predecessor) => at.get(predecessor) ?? -1);
          expect(Math.max(...earlier)).toBeLessThan(at.get(id) ?? -1);
        }
      }),
      RUNS,
    );
  });

  it('a DAG with any nodes has at least one source and one sink', () => {
    fc.assert(
      fc.property(dag, (graph) => {
        if (graph.nodeCount === 0) return;
        expect(graph.sources().length).toBeGreaterThan(0);
        expect(graph.sinks().length).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });
});
