import type { EdgeId, Graph, NodeId } from '@dagr/graph';
import { InternalLayoutError, StageContractError } from './errors.js';
import type { Size } from './types.js';

/**
 * The dummy-node splitter, in one place, because BOTH rank stages need it.
 *
 * One rule in one module, the same argument `acyclic.ts` makes about two
 * rankers sharing one view and `segments.ts` makes about three stages sharing
 * one definition of a segment. M2.4b put the splitter inside
 * `longestPathRankStage` and nowhere else, so a caller who selected
 * `networkSimplexRankStage` got a ranking with long edges in it and nothing to
 * split them: multi-rank edges reached the order stage, the position stage and
 * the router, which is the one thing M2.4b's own headline rule forbids. This
 * module is that gap closed.
 *
 * ## What a chain is for
 *
 * An edge whose endpoints are more than one rank apart is split into a chain of
 * virtual nodes, one per rank strictly between them, declared in `virtualNodes`
 * with the chain recorded in `virtualChains`. That is what stops a long edge
 * crossing a layer at a coordinate nothing constrains: the order and position
 * stages read the chains through `segments.ts` and treat an edge that has one as
 * the segments it is drawn as, so every row a long edge passes through holds a
 * node of it that those stages have an opinion about.
 *
 * Measured on the 10k bench corpus under the default ranker, a layering that
 * reads the chains has 8,586,890 crossings against 33,939,378 for one that
 * ignores them, both scored over all 214,222 segments. Both sides are the order
 * stage at its defaults, so M2.6c's re-derivation of those moved both; M2.4b
 * measured the same pair at 8,748,361 and 33,932,556.
 *
 * The chains were declared one milestone and consumed the next, and the gap
 * between the two is worth knowing about because it is invisible from here:
 * while nothing read `virtualChains`, a dummy was an isolated node in every
 * index downstream. It joined a layer, took a `nodeSep` gap and a coordinate,
 * and constrained nothing.
 *
 * ## What each ranker mints
 *
 * The two rankers optimise different things and the split is where that shows
 * up as a count. On the 1k bench corpus `longestPathRankStage` mints 14,746
 * dummies and `networkSimplexRankStage` 10,660; on the 10k, 174,222 against
 * 105,975. Name the ranker AND the budget beside any simplex figure, per M2.2b:
 * the second number in each pair is the default 20,000-pivot budget, which is
 * the optimum on the 1k and is not on the 10k, where ten times the budget
 * reaches 99,698. Both pairs are pinned in `test/layout.chains.test.ts` rather
 * than left here, because a figure that lives only in prose goes stale.
 *
 * Total edge length minus the edge count is exactly what a splitter over a
 * ranking mints, which is why the simplex stage's docstring calls that sum the
 * quantity worth optimising: since this module is shared, the saving it names is
 * one a caller can now collect rather than one this package could only describe.
 */

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
 * Being a function of the edge, the ids do not depend on WHICH RANKER called
 * for them either. The two stages rank the same edge differently and therefore
 * give it a chain of a different length, but the dummies the two chains share
 * are the same ids, counted from the same end. That is not a requirement
 * anything states and it is worth having anyway: M3 hints one run from another,
 * and a caller who changes ranker between two runs gets a chain that grew or
 * shrank rather than a roster of nodes nothing has ever seen.
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
 * graph before declaring each id and throws a `StageContractError` naming the
 * calling stage, the id, and the reservation. The runner's own declaration check
 * would catch the same collision one step later, and still does for a
 * third-party ranker that mints its ids some other way, so this is not a
 * duplicate report: this check throws first, and only one error ever surfaces.
 * What it buys is a message that says the namespace is reserved and points at
 * the caller's own node, rather than one that reads as a built-in stage leaving
 * work undone.
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

/** An entry of this module's own sorted rank array. Absence is a bug here. */
function rankAt(ranks: readonly number[], place: number): number {
  const rank = ranks[place];
  if (rank === undefined) throw new InternalLayoutError(`no rank at place ${String(place)}`);
  return rank;
}

/** What {@link splitLongEdges} contributes to a `RankOutput`, when it splits anything. */
export interface SplitEdges {
  readonly virtualNodes: ReadonlyMap<NodeId, Size>;
  readonly virtualChains: ReadonlyMap<EdgeId, readonly NodeId[]>;
}

/**
 * Splits every edge of `graph` that spans more than one OCCUPIED rank into a
 * chain of dummies, one per occupied rank strictly between its endpoints.
 *
 * `ranks` is read for the endpoints and WRITTEN for each dummy minted, because
 * a declared node the stage did not rank fails the runner's check at that
 * stage's own boundary. It is the caller's map, mutated in place: every rank
 * this adds is a rank the map already held for some real node, so the walk
 * below reads nothing it has written.
 *
 * It walks the graph's own edges rather than the acyclic view's, because a
 * chain is recorded against the edge id the CALLER authored and in the
 * direction they authored it. The view is numbers pointing the way the ranking
 * needs them to point, with self loops dropped and the feedback set already
 * turned around, so it has neither of those two things. A self loop has both
 * ends on one rank and an edge between neighbouring ranks has nothing between
 * them to cross, so neither gets a chain.
 *
 * `stage` is the name the collision error is raised against, and it is a
 * parameter for exactly one reason: two stages call this and a
 * `StageContractError` naming the wrong one sends the reader to the wrong
 * docstring.
 *
 * Returns `undefined` when nothing was split, which is what a graph with no long
 * edge has always got from a rank stage and what its tests pin: both fields are
 * omitted rather than handed back empty, the runner supplies the empty
 * collections, and it leaves `PreparedState.sizes` exactly as it found it
 * because nothing was added to size.
 *
 * ## Occupied ranks, not the integers between
 *
 * "One per rank" means one per OCCUPIED rank, which is what the runner's
 * completeness check asks for and how that check is phrased: over the ranks the
 * LAYOUT ACTUALLY HAS, because the occupied ranks are exactly the layers the
 * order stage will build. Over ranks 0, 10 and 20 the integer rule would demand
 * nine dummies, eight of which have no layer to sit in.
 *
 * Stepping by one integer at a time would give the same answer for both stages
 * that call this today, and it is not what is written, for two reasons. The
 * first is that this is now SHARED machinery: a splitter that satisfies the rule
 * it is checked against by construction cannot disagree with the check, where
 * one that relies on a property of its callers is one caller away from doing so.
 * The second is that the property was mis-stated where it was written down.
 * `networkSimplexRank`'s docstring said an exhausted budget could leave a gap,
 * reasoning that gap-freeness follows from optimality; it follows from something
 * stronger and unconditional, which is that the solver keeps a TIGHT SPANNING
 * TREE of each component. Growth runs to a spanning tree whatever the budget
 * (only the pivots are bounded), every tree edge has slack zero, and a pivot
 * shifts one whole side of a cut so the entering edge becomes tight and the rest
 * stay so. A ±1 walk therefore joins any two nodes of a component, the
 * component's ranks are contiguous, and `tighten` normalises each component's
 * floor to zero. That argument covers everything except the restore, which
 * reinstates a floored longest-path sweep and is covered by a witness instead;
 * `simplex.ts` is where both halves are stated and where the limits of the
 * second are.
 *
 * So neither shipping ranker has a gap, both walks agree, and nothing
 * downstream moved when the splitter became shared. Gap-freeness is pinned over
 * a random population at four budget-and-hint combinations and over the restore
 * witness in `test/layout.simplex.test.ts`, and over both bench corpora in
 * `test/layout.chains.test.ts`. The difference between the two walks is pinned
 * directly against this function in `test/layout.chains.test.ts`, over a gapped
 * ranking neither ranker produces. Switching this walk to the integers fails
 * that one test and nothing else, which is what says the two agree everywhere
 * the suite looks.
 *
 * @throws {StageContractError} when the graph already holds an id this would
 * mint, naming `stage`. The `#dummy:` namespace is reserved and the caller's own
 * node is the thing to rename.
 */
export function splitLongEdges(
  stage: string,
  graph: Graph,
  ranks: Map<NodeId, number>,
): SplitEdges | undefined {
  // The occupied ranks in order, and each one's place in that order, so that
  // the ranks a chain has to cover are a walk between two indices rather than a
  // scan of every rank in the layout per edge. Built from the ranks as they
  // stand, which is the ranking of the graph's own nodes: a dummy only ever
  // lands on a rank a real node already occupies, so nothing this loop adds can
  // change the answer for an edge it has not reached yet.
  const ordered = [...new Set(ranks.values())].sort((left, right) => left - right);
  const placeOfRank = new Map<number, number>();
  for (const [place, rank] of ordered.entries()) placeOfRank.set(rank, place);

  const virtualNodes = new Map<NodeId, Size>();
  const virtualChains = new Map<EdgeId, readonly NodeId[]>();
  for (const edge of graph.edges()) {
    const sourceRank = ranks.get(edge.source);
    const targetRank = ranks.get(edge.target);
    // Unreachable: an edge's endpoints are nodes of the graph, and the caller
    // ranked every one of them.
    if (sourceRank === undefined || targetRank === undefined) continue;
    const from = placeOfRank.get(sourceRank);
    const to = placeOfRank.get(targetRank);
    // Unreachable: every rank the map held went into the order above.
    if (from === undefined || to === undefined) continue;
    if (Math.abs(to - from) < 2) continue;
    // The walk runs source to target AS THE CALLER AUTHORED THEM, matching
    // `RoutedEdge.points`, so the ranks along it descend for an edge in the
    // feedback set. Not "increasing": that reads fine and is wrong for every
    // reversed edge, and a router walking such a chain the other way would land
    // its arrowhead on the wrong end.
    const step = to < from ? -1 : 1;
    const chain: NodeId[] = [];
    for (let place = from + step; place !== to; place += step) {
      // The index is the position along the chain from the AUTHORED source,
      // which is what `chain.length` is before the push, for a reversed edge as
      // much as for a normal one. See {@link dummyId} for why it is the index
      // and not the rank.
      const id = dummyId(edge.id, chain.length);
      // The `#dummy:` namespace is reserved, and a caller may still hold an id
      // in it. Checked here rather than left to the runner's declaration check
      // so the message says the namespace is reserved and points at the node to
      // rename; this one throws first, so only one error ever surfaces, and the
      // runner's still covers a third-party ranker that collides.
      if (graph.hasNode(id)) {
        throw new StageContractError(
          stage,
          id,
          'the "#dummy:" id namespace is reserved by this stage and the graph already holds ' +
            'this id; rename the node, or supply a rank stage that mints ids differently',
        );
      }
      chain.push(id);
      virtualNodes.set(id, DUMMY_SIZE);
      // `ranks` covers the ROSTER, not the graph: a declared node the stage did
      // not rank fails the runner's own check at that stage's boundary.
      ranks.set(id, rankAt(ordered, place));
    }
    virtualChains.set(edge.id, chain);
  }

  if (virtualNodes.size === 0) return undefined;
  return { virtualNodes, virtualChains };
}
