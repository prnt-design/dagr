import type { EdgeId, NodeId } from '@dagr/graph';
import { acyclicView, longestPathRanks } from './acyclic.js';
import { feedbackArcSet } from './cycles.js';
import { InternalLayoutError, StageContractError } from './errors.js';
import type { RankStage, Size } from './types.js';

/**
 * The default rank stage: least-squares feedback-arc-set cycle breaking, then
 * longest-path ranking over the acyclic view that leaves behind.
 */

/**
 * An entry of one of this module's own arrays, which is always present because
 * every index is a node number `acyclicView` minted. Absence is a bug here
 * rather than in the caller, so it fails loudly instead of reading as
 * `undefined` through arithmetic that would quietly produce `NaN`.
 */
function at(values: { readonly [index: number]: number | undefined }, index: number): number {
  const value = values[index];
  if (value === undefined) throw new InternalLayoutError(`no entry at index ${String(index)}`);
  return value;
}

/**
 * The id of the dummy at `index` along `edge`'s chain: `#dummy:<edge>:<index>`.
 *
 * `index` is the dummy's 0-based position along the chain COUNTING FROM THE
 * AUTHORED SOURCE, so index 0 is the dummy next to `edge.source` for a normal
 * edge and for a reversed one alike, a reversed edge's source being the end at
 * the HIGH rank. A pure function of the edge and that position, never a counter
 * and never iteration order. That is a hard requirement of M3 rather than a
 * tidiness: a counter would rename every dummy on a chain whenever an unrelated
 * edge was added upstream of it, so M3.6's warm start would meet a node it had
 * never seen and M3.8 would have no previous coordinate to anchor, and a long
 * edge would visibly jitter between two endpoints that did not move at all. On
 * a real Sugiyama drawing dummies outnumber real nodes, so that is most of the
 * geometry rather than a corner of it.
 *
 * ## Index rather than rank
 *
 * The ROADMAP's literal suggestion was `#dummy:<edgeId>:<rank>` "or
 * equivalent". This is the equivalent, and it serves the stated requirement
 * (never a counter, never iteration order, stable by construction) better than
 * the rank does, because an index is INVARIANT UNDER A UNIFORM RANK SHIFT.
 * Shifting the ranks is the common edit: insert one node upstream and a whole
 * cone moves down a row, which under the rank scheme renames every dummy in it
 * while every one of those edges kept the shape it had. Worse than a clean
 * rename, it renames them ONTO EACH OTHER. Nodes `a`, `p1`, `p2`, `z` with an
 * edge `a -> z` give that edge dummies at ranks 1 and 2; add a node `up` and an
 * edge `up -> a`, touching neither end of `a -> z` and leaving its span three
 * ranks, and the dummies are at ranks 2 and 3. Under the rank scheme one of the
 * two ids survives, and the surviving `:2` was the chain's SECOND bend before
 * and is its FIRST bend after, so a warm start anchoring by id anchors that
 * bend to the wrong previous coordinate rather than simply missing it.
 *
 * ## What is and is not guaranteed
 *
 * The guarantee is narrower than "the id is stable", and is stated narrowly on
 * purpose. The id is stable under any edit that does not move the edge's
 * endpoints RELATIVE TO EACH OTHER, and a uniform rank shift is exactly such an
 * edit, so it no longer breaks the id. What the index loses on is endpoints
 * that move relative to each other, which is a genuine change to the shape of
 * the edge rather than an unrelated edit, and there it misanchors by one row
 * instead of losing identity outright. Neither scheme is stable under
 * everything, and nothing here claims one is.
 *
 * The `#dummy:` prefix is RESERVED, and reserved is not the same as impossible.
 * A caller may hold a node whose id looks like this, so the splitter asks the
 * graph before declaring each id and throws a `StageContractError` naming this
 * stage, the id, and the reservation. The runner's own declaration check would
 * catch the same collision one step later, and still does for a third-party
 * ranker that mints its ids some other way, so this is not a duplicate report:
 * the stage's check throws first, and only one error ever surfaces. What it buys
 * is a message that says the namespace is reserved and points at the caller's
 * own node, rather than one that reads as a built-in stage leaving work undone.
 *
 * Nothing parses the id back apart. Which dummies belong to which edge, and in
 * what order, is recorded in `RankOutput.virtualChains`, because an `EdgeId` is
 * a caller-supplied string that may hold any separator this format could pick.
 * The id's job is to be the SAME id next run, and no more than that.
 */
function dummyId(edge: EdgeId, index: number): NodeId {
  return `#dummy:${edge}:${String(index)}`;
}

/**
 * What a plain long-edge dummy measures: nothing, matching dagre's own.
 *
 * A dummy is a place a route passes through rather than a thing that is drawn,
 * so it takes no room of its own and the `nodeSep` on either side of it is what
 * keeps a route clear of the boxes it runs between. `edgeSep` is deliberately
 * not used here: it is the gap between two routes running alongside each other,
 * which is a router's business in M2.8, and not a width.
 *
 * One object, shared by every dummy on every chain, and frozen because it is:
 * a `Size` is read-only to everything downstream, and a stage that cast its way
 * past that would otherwise resize every dummy in the run at once.
 */
const DUMMY_SIZE: Size = Object.freeze({ width: 0, height: 0 });

/**
 * Ranks every node by the longest path that reaches it, over the graph with the
 * feedback arc set treated as running the other way.
 *
 * ## What the ranks mean
 *
 * A node with nothing pointing at it in the acyclic view gets rank 0, and every
 * other node sits one below the lowest of the nodes that point at it. Two
 * properties fall out and both are relied on downstream. The ranks are
 * CONTIGUOUS from zero, because a node at rank `r` only got there from a
 * predecessor at rank `r - 1`, so no rank between 0 and the maximum is empty
 * and the order stage cannot produce a layer of nothing. And the drawing is of
 * MINIMUM HEIGHT: the last rank is the number of edges on the longest path in
 * the acyclic view, which is a lower bound for any ranking that sends every
 * edge down at least one rank.
 *
 * What longest path does not give is a minimum total edge length. It pins each
 * node as high as its predecessors allow and never looks at what the node
 * points at, so `e -> d` alongside `a -> b -> c -> d` leaves `e` at rank 0 with
 * its one edge spanning three ranks when rank 2 was free. `a -> d` alongside
 * that same chain is NOT that case, though it looks like it: `d` sits three
 * ranks below `a` in every feasible ranking, so a shortcut edge spanning three
 * ranks is a shape longest path cannot avoid rather than a total it gets wrong.
 * Either way it is a quality problem and not a correctness one, and M2.4b's
 * dummy chains make it a cost in dummy nodes. `networkSimplexRankStage` is the
 * stage that minimises that sum, and it buys the saving with height rather than
 * for free: see its docstring, which is where the two objectives are compared.
 *
 * ## How
 *
 * The view and the sweep both come from `acyclic.ts`, which is where the
 * self-loop rule, the reversal rule and the O(V + E) Kahn sweep live, because
 * the simplex ranker starts from exactly the same view and the same ranking.
 * This stage is the two of them and a map back to the caller's ids.
 *
 * ## Dummy chains
 *
 * An edge whose endpoints are more than one rank apart is then split into a
 * chain of virtual nodes, one per rank strictly between them, declared in
 * `virtualNodes` with the chain recorded in `virtualChains`.
 *
 * That is what stops a long edge crossing a layer at a coordinate nothing
 * constrains: the order and position stages read the chains through
 * `segments.ts` and treat an edge that has one as the segments it is drawn as,
 * so every row a long edge passes through holds a node of it that those stages
 * have an opinion about. Measured on the 10k bench corpus, a layering that
 * reads the chains has 8,748,361 crossings against 33,932,556 for one that
 * ignores them, both scored over all 214,222 segments.
 *
 * The chains were declared one milestone and consumed the next, and the gap
 * between the two is worth knowing about because it is invisible from here:
 * while nothing read `virtualChains`, a dummy was an isolated node in every
 * index downstream. It joined a layer, took a `nodeSep` gap and a coordinate,
 * and constrained nothing.
 *
 * A dummy is `#dummy:<edgeId>:<index>`, takes no room, and belongs to exactly
 * one edge. See {@link dummyId} for why the id is a function of the edge and the
 * dummy's position along the chain rather than of its rank (M3 stability, and
 * what that does and does not guarantee), and for what happens when a caller's
 * own graph holds an id that looks like one: this stage rejects it, naming
 * itself and the reserved namespace. The `#dummy:` prefix is reserved, not
 * unforgeable.
 *
 * A self loop gets no chain, having both ends on one rank, and neither does an
 * edge between neighbouring ranks. When nothing at all was split, both fields
 * are omitted rather than handed back empty: the runner supplies the empty
 * collections, and leaves `PreparedState.sizes` exactly as it found it because
 * nothing was added to size.
 *
 * Frozen, for the reason `defaultStages` is: it is one object shared by every
 * run in the process, and a stage's `name` is quoted in every
 * `StageContractError` the runner raises against it, so an assignment to it
 * anywhere would be an assignment to it everywhere.
 *
 * @throws {StageContractError} when the graph already holds an id the splitter
 * would mint, naming this stage. The `#dummy:` namespace is reserved and the
 * caller's own node is the thing to rename.
 * @throws {InternalLayoutError} when the sweep cannot reach every node, which
 * means the acyclic view still had a cycle. That is a bug in this stage rather
 * than in the caller, so it is an internal error rather than a
 * `StageContractError`, which names a stage the caller supplied.
 */
export const longestPathRankStage: RankStage = Object.freeze<RankStage>({
  name: 'longest-path-rank',
  run(input) {
    const { graph } = input;
    const reversedEdges = feedbackArcSet(graph);
    const view = acyclicView(graph, reversedEdges);
    const rankOf = longestPathRanks(view);

    const ranks = new Map<NodeId, number>();
    for (const [number, node] of view.nodes.entries()) ranks.set(node.id, at(rankOf, number));

    // Split every edge that spans more than one rank into a chain of dummies,
    // one per rank strictly between its endpoints.
    //
    // "One per rank" means one per OCCUPIED rank, which is what the runner's
    // completeness check asks for, and stepping by one integer at a time is
    // only the same thing HERE: the ranks this stage produces are contiguous
    // from zero (see the argument above), so every integer between two of them
    // is a rank something sits at. A stage whose ranks had gaps would have to
    // walk the occupied ranks rather than the integers, and the check does
    // exactly that, which is why it does not assume what this loop may.
    //
    // It walks the graph's own edges rather than `view.from` and `view.to`,
    // because a chain is recorded against the edge id the CALLER authored and
    // in the direction they authored it. The view is numbers pointing the way
    // the ranking needs them to point, with self loops dropped and the feedback
    // set already turned around, so it has neither of those two things.
    const virtualNodes = new Map<NodeId, Size>();
    const virtualChains = new Map<EdgeId, readonly NodeId[]>();
    for (const edge of graph.edges()) {
      const from = ranks.get(edge.source);
      const to = ranks.get(edge.target);
      // Unreachable: an edge's endpoints are nodes of the graph, and the sweep
      // above ranked every one of them.
      if (from === undefined || to === undefined) continue;
      // A self loop has both ends on one rank, and an edge between neighbouring
      // ranks has nothing between them to cross.
      if (Math.abs(to - from) < 2) continue;
      // The walk runs source to target AS THE CALLER AUTHORED THEM, matching
      // `RoutedEdge.points`, so the ranks along it descend for an edge in the
      // feedback set. Not "increasing": that reads fine and is wrong for every
      // reversed edge, and a router walking such a chain the other way would
      // land its arrowhead on the wrong end.
      const step = to < from ? -1 : 1;
      const chain: NodeId[] = [];
      for (let rank = from + step; rank !== to; rank += step) {
        // The index is the position along the chain from the AUTHORED source,
        // which is what `chain.length` is before the push, for a reversed edge
        // as much as for a normal one. See {@link dummyId} for why it is the
        // index and not the rank.
        const id = dummyId(edge.id, chain.length);
        // The `#dummy:` namespace is reserved, and a caller may still hold an id
        // in it. Checked here rather than left to the runner's declaration check
        // so the message says the namespace is reserved and points at the node
        // to rename; this one throws first, so only one error ever surfaces, and
        // the runner's still covers a third-party ranker that collides.
        if (graph.hasNode(id)) {
          throw new StageContractError(
            'longest-path-rank',
            id,
            'the "#dummy:" id namespace is reserved by this stage and the graph already holds ' +
              'this id; rename the node, or supply a rank stage that mints ids differently',
          );
        }
        chain.push(id);
        virtualNodes.set(id, DUMMY_SIZE);
        // `ranks` covers the ROSTER, not the graph: a declared node the stage
        // did not rank fails the runner's own check at this stage's boundary.
        ranks.set(id, rank);
      }
      virtualChains.set(edge.id, chain);
    }

    // Omitted rather than handed back empty, which is what a graph with no long
    // edge has always got from this stage and what its tests pin. The runner
    // supplies the empty collections, and it leaves `PreparedState.sizes`
    // exactly as it found it because nothing was added to size.
    if (virtualNodes.size === 0) return { ranks, reversedEdges };
    return { ranks, reversedEdges, virtualNodes, virtualChains };
  },
});
