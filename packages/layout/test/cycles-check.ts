import { Graph } from '@dagr/graph';
import type { EdgeId, NodeId } from '@dagr/graph';

/**
 * What a cycle-breaking suite checks a feedback arc set WITH, shared by the
 * suites that check one.
 *
 * A helper module rather than a copy per file, for the reason `random.ts` gives
 * at the top of itself: two copies drift, and a checker that quietly stopped
 * checking stays green while testing nothing. `layout.cycles.test.ts` owns the
 * cold breaker and `layout.cycles.stable.test.ts` the warm-started one, and
 * both answer the same question about the same kind of answer.
 */

/** A graph from a script of `addNode`/`addEdge` calls, for the readable cases. */
export function build(
  nodes: readonly string[],
  edges: readonly (readonly [string, string, string])[],
): Graph {
  const graph = new Graph();
  for (const id of nodes) graph.addNode(id);
  for (const [source, target, id] of edges) graph.addEdge(source, target, id);
  return graph;
}

/** One arc of the digraph a reversal decision leaves behind. */
export type Arc = readonly [NodeId, NodeId];

/**
 * The digraph the ranker will actually rank: every edge, pointing the way the
 * feedback set says, with self loops dropped because they constrain nothing and
 * are never reversed.
 */
export function acyclicView(graph: Graph, reversed: ReadonlySet<EdgeId>): Arc[] {
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
 * into a no-op, which is the failure this module exists to rule out.
 *
 * Iterative rather than recursive, so a long random chain cannot blow the stack
 * and be mistaken for a result.
 */
export function referenceTopologicalOrder(
  graph: Graph,
  arcs: readonly Arc[],
): NodeId[] | undefined {
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

/**
 * The strongly connected components of a graph, as a component number per node.
 *
 * KOSARAJU, and deliberately not Tarjan, for the reason
 * `layout.cycles.quality.test.ts` gives beside its own copy: `cycles.ts`
 * computes this partition with Tarjan, and a checker sharing an implementation
 * with the thing it checks carries the same bug. Two passes, one over the
 * forward arcs for a finishing order and one over the reversed arcs taking the
 * latest unassigned finisher as each root.
 *
 * Iterative, so a deep graph cannot blow the stack and read as a result. It
 * takes the ARCS rather than the graph, so a caller can ask the question of a
 * view as well as of the graph the view came from, which is what the warm start
 * needs: whether an edge still lies on a cycle is a question about the graph,
 * and what the seeded run is allowed to reverse is a question about the view.
 */
export function componentsOf(graph: Graph, arcs: readonly Arc[]): Map<NodeId, number> {
  const successors = new Map<NodeId, NodeId[]>();
  const predecessors = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes()) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }
  for (const [from, to] of arcs) {
    successors.get(from)?.push(to);
    predecessors.get(to)?.push(from);
  }

  const seen = new Set<NodeId>();
  const finished: NodeId[] = [];
  for (const root of graph.nodes()) {
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    const stack: { readonly id: NodeId; next: number }[] = [{ id: root.id, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const outgoing = successors.get(frame.id) ?? [];
      if (frame.next >= outgoing.length) {
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const successor = outgoing[frame.next];
      frame.next += 1;
      if (successor === undefined || seen.has(successor)) continue;
      seen.add(successor);
      stack.push({ id: successor, next: 0 });
    }
  }

  const componentOf = new Map<NodeId, number>();
  let component = 0;
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const root = finished[index];
    if (root === undefined || componentOf.has(root)) continue;
    const stack: NodeId[] = [root];
    componentOf.set(root, component);
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) break;
      for (const other of predecessors.get(id) ?? []) {
        if (componentOf.has(other)) continue;
        componentOf.set(other, component);
        stack.push(other);
      }
    }
    component += 1;
  }
  return componentOf;
}
