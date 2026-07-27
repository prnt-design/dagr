---
id: layout
title: Layout pipeline
sidebar_position: 3
---

# Layout pipeline

`@dagr/layout` turns a graph into coordinates. It takes a `Graph` from
[`@dagr/graph`](./graph-model.md), never mutates it, and returns a
`LayoutResult`: where every node sits, how every edge runs, and the box around
the lot.

This page describes the pipeline as of M2.4b. The types, the runner, and the
stage boundaries are real: they are what every later milestone is built against,
and the roster below is why the one boundary that was going to have to move
(dummy nodes) did not have to. One of the four algorithms is real: the rank
stage breaks cycles and ranks by longest path, so the layers are the ones the
graph asks for. The other three are placeholders that produce a well formed but
naive result.

Expect the contract to gain rules as real stages land. A rule leaves the list
only when the mistake it caught stops being one a stage can make, never because
a guarantee was dropped. M2.4a did that twice: a stage has no field to hand a
different graph back in, so the rule that it must hand back the runner's own is
now the compiler's, and the size rule narrowed to the sizes a stage actually
mints, because the runner builds the roster-wide map from prepare's answers and
the stage's declarations. It is not a one-way street either. The rule that every
roster member has a size came straight back, because the mistake it catches
turned out to still be reachable: a stage can reach into the live graph it was
handed. See [What is not here yet](#what-is-not-here-yet) before you reach for
this in anger.

## The shape of a run

A run is six steps. The first and the last belong to the runner, the four
between them are swappable stages:

```
prepare (the runner)   ->  PreparedState
rank stage             ->  RankOutput      merged into  RankedState
order stage            ->  OrderOutput     merged into  OrderedState
position stage         ->  PositionOutput  merged into  PositionedState
route stage            ->  RouteOutput     merged into  RoutedState
assemble (the runner)  ->  LayoutResult
```

Prepare resolves the config once and sizes every node once, so no stage
re-applies a default and no `nodeSize` callback is asked about the same node
twice. Then:

- **rank** decides which layer each node belongs to, and records any edge it had
  to treat as running the other way.
- **order** turns those ranks into ordered layers, choosing the left-to-right
  order within each one. This is where edge crossings are won or lost.
- **position** turns ordered layers into coordinates.
- **route** gives every edge a polyline.

Assemble is the runner's again: it builds the result's node map from
`positions` and `sizes`, its edge map from `routes`, and computes `bounds`.
None of that is routing, and a router that had to do it would be reimplementing
a bounds hull and a node loop it has no opinion about, once per router. Doing it
in the runner also makes three properties true by construction rather than by
check: the result holds exactly the caller's own ids, both of its maps iterate
in graph insertion order, and `bounds` is computed the same way on every run.

**A stage reads a record and writes an output.** The five `...State` records
are the read side: each extends the one before it, so `RoutedState` still
carries the graph, the config, the sizes, the ranks, the layers, and the
positions, and a stage can read everything computed upstream of it without
anything being threaded around out of band. The four `...Output` types are the
write side, and each holds that stage's own contribution and nothing else. The
runner merges an output into the next record.

| Stage | Reads | Writes | Runner adds |
| --- | --- | --- | --- |
| rank | `PreparedState` | `RankOutput`: `ranks`, `reversedEdges`, optional `virtualNodes` and `virtualChains` | `graph`, `config`, and a roster-wide `sizes` |
| order | `RankedState` | `OrderOutput`: `layers` | everything upstream, unchanged |
| position | `OrderedState` | `PositionOutput`: `positions` | everything upstream, unchanged |
| route | `PositionedState` | `RouteOutput`: `routes` | everything upstream, unchanged |

`RoutedState` is the one record in that chain a caller never names. It is what
the runner builds after the last stage and hands to nobody, so it is not
exported from the package; the other four are, because each is the parameter
type of a `run` somebody writes. The four `...Output` types are exported too.

**Returning less is a stronger contract than returning more.** Until M2.4a a
stage returned the whole next record, which meant every stage handed back a
`graph`, a `config` and a `sizes` map it had no opinion about, usually by
spreading the record it was given. Three things follow from taking those away.
A stage does not hand back a graph, so no check has to ask whether it was the
right one. A stage cannot restate a field it did not compute, so no two records
can disagree about what `nodeSep` meant on this run. And nobody has to write
`...input` any more, which is the line that quietly carries a stale value the
day a new field appears upstream of it. The read side did not change at all: the
`...State` records are still an extends chain, and still what a stage names when
it types the argument its `run` is handed.

**The five records are named `...State`, not `...Layout`.** They are the
accumulating state that flows between stages, and only a stage author ever names
one. `LayoutInput`, `LayoutConfig`, and `LayoutResult` are the caller-facing
surface. Two vocabularies for two audiences: what a caller passes and gets back,
versus what one stage hands the next.

## The roster

Everything downstream of the rank stage works over a **roster**: the source
graph's own nodes, plus anything the rank stage declared in
`RankedState.virtualNodes`.

The source graph is never mutated. That is the pipeline's one hard promise, and
it means a stage that needs a node the caller never added must not add one. It
declares it instead, in `RankOutput.virtualNodes`, as an id and the size it
wants for it:

```ts
const rank: RankStage = {
  name: 'my-rank',
  run(input) {
    // A rank for every node the graph holds, plus one for the dummy.
    const ranks = new Map(input.graph.nodes().map((node) => [node.id, 0]));
    ranks.set('long-edge#1', 1);

    return {
      ranks,
      reversedEdges: new Set(),
      // A dummy gets a small width so nodeSep spacing still works around it.
      virtualNodes: new Map([['long-edge#1', { width: 1, height: 40 }]]),
    };
  },
};
```

**Declaring an id and sizing it are one act, so they are one field.** A stage
does not copy `input.sizes` and add to it; the runner builds the roster-wide
`sizes` map from what prepare measured plus what the stage declared. That makes
"declared but unsized" unrepresentable rather than merely rejected, and it means
a ranker cannot reach into the map and resize a node the caller measured itself.
On the read side `RankedState.virtualNodes` is a `ReadonlySet<NodeId>`, because
a later stage wants the roster and already has the sizes: a map there would be a
second copy of every size, free to disagree with the first.

**"Must not", not "cannot".** `PreparedState.graph` is the live `Graph` the
caller still holds, so a stage that calls `addNode` on it really does add a
node, and no type can stop it. What happens then is that the roster (recomputed
from the graph at every check) gains a member prepare never sized, and the rank
boundary rejects it with a `StageContractError` naming the stage that did it.
That is the whole reason the "every roster member has a size" rule is still on
the list: without it the caller gets an `InternalLayoutError` blaming this
package for a stage's mistake.

`virtualNodes` is optional. A ranker with nothing to declare omits it, and the
runner puts an empty set in the record. There is no difference between omitting
it and declaring nothing.

**A dummy also says which edge it serves.** `RankOutput.virtualChains` maps a
caller's edge id to the chain of declared ids the stage split it into, in order,
and the runner passes it through to `RankedState.virtualChains` (an empty map
when it is omitted, the same treatment `virtualNodes` gets). It exists because a
dummy is not just a sized id: the router rejoins a chain into one polyline keyed
by the edge it belongs to, and without the chain recorded the only recourse is
parsing a dummy id back apart. That is ambiguous, because an `EdgeId` is a
caller-supplied string that may contain whatever separator the id format picks;
it couples the ranker and the router through a string format; and it promotes
the id format to load-bearing public contract when the requirement M3 actually
has only pins the id's VALUE.

**A chain is listed source to target as the caller authored them.** That is the
direction [`RoutedEdge.points`](#route-direction) runs and it is stated for the
same reason: a router working from the ranked direction naturally walks its
chain backwards, and nothing downstream notices until an arrowhead lands on the
wrong end. So the ranks along a chain are strictly **monotonic** rather than
strictly increasing. They increase for a normal edge and decrease for one in
`reversedEdges`, and either way they lie strictly between the two endpoint
ranks. Writing that rule as "strictly increasing" reads fine and is wrong for
every reversed edge.

**A chain that exists has to be complete.** It holds exactly one node at every
rank the layout actually has, strictly between its endpoint ranks. The occupied
ranks are exactly the layers the order stage builds, so a chain that skips one
routes across a row at an `x` that nothing in that row constrains, which is the
one thing dummies are there to prevent. The rule is phrased over the occupied
ranks rather than as steps of exactly one because that would assume contiguous
integer ranks, which `insertionOrderStage` explicitly refuses to assume: over
ranks 0, 10 and 20 it would demand nine dummies, eight of which have no layer to
sit in. **The scope is a chain that exists.** Having one at all is optional, a
ranker that splits nothing is legal, and a declared id that belongs to no chain
is legal too. What is not legal is a chain with a hole in it.

**Completeness is a property of the whole ranking, not of one chain.** Those two
sentences compose, and the composition is worth stating outright because it is
what a stage author trips over. The rule is phrased over the ranks the layout
has rather than over an edge's own endpoints, so a stage that introduces a rank
nothing previously occupied, say by declaring one unchained dummy at a rank of
its own, has to extend every chain that spans that rank, including chains it did
not mint. Real nodes at ranks 0, 10 and 20 with a complete chain at rank 10,
plus one loose declared dummy at rank 5, and the chain is now incomplete. That is
correct rather than incidental: if a layer exists at rank 5, a long edge really
does cross it at an `x` nothing in it constrains. The error names the node
occupying the missing rank as well as the rank, because the node that made the
rank exist is routinely not on the chain being blamed for skipping it.

This is the same argument `reversedEdges` carries, applied to nodes rather than
edges. A declared id is a full citizen from that point on: it has a rank, it has
a size, it has to appear in exactly one layer, and it has to get a position. The
runner checks all of that over the roster, so it is checked exactly as hard as a
node the caller added.

It stops at the route stage. A `LayoutResult` mentions the caller's own ids, no
more and no less, because the runner builds both of its maps by walking the
caller's own graph. A declared node has no way in, so no caller ever has to
filter out a node it did not add.

**No stage hands a graph back.** Until M2.4a that was a rule with a check behind
it: a record had to carry back the very object the runner handed in, and a
`StageContractError` labelled `graph` said so when it did not. Two mechanisms
hold it now, belt and braces, and the check was deleted rather than kept as
something that cannot fire. The `graph` label went with it.

The first is the types. Each of the four `...Output` types declares every field
the runner owns, and every field contributed upstream of that stage, as `never`:

```ts
interface RankOutput {
  readonly ranks: ReadonlyMap<NodeId, number>;
  readonly reversedEdges: ReadonlySet<EdgeId>;
  readonly virtualNodes?: ReadonlyMap<NodeId, Size>;
  readonly virtualChains?: ReadonlyMap<EdgeId, readonly NodeId[]>;
  readonly graph?: never;
  readonly config?: never;
  readonly sizes?: never;
}
```

Those lines are doing real work rather than documenting an intention.
TypeScript does not excess-property-check a **spread**, so without them
`return { ...input, ranks, reversedEdges }` was a perfectly legal `RankOutput`.
A *declared* property is checked through a spread, so with them it does not
compile. That is what makes the migration mechanical instead of silent: the
realistic half-migration, fixing the line the compiler flags and leaving `sizes`
in the spread, would otherwise have compiled, dropped the returned sizes on the
floor, and produced a wrong layout with no error at all.

The second is the runner. It names every field it takes out of an output, one at
a time, and spreads only its own previous record. So a stage that cast its way
past the compiler and returned an extra `graph` would still not have one read.

Neither mechanism alone would do. The types stop the mistake at the keyboard and
a cast gets past them; the runner stops any value getting through but only after
the stage ran. The reason to want both is that every contract check compares a
stage's output against the runner's graph, so a stage working from a graph of
its own would be shrinking the roster its own check runs over, and the failure
would land on whichever later stage still compared against the real thing.
Replacing the graph was never necessary anyway: the one reason to want to,
needing a node the caller never added, is what the roster is for.

What no type reaches is the graph a stage was **handed**, which is live and
mutable. That case is still a runtime rule, and it is the one described above
under [The roster](#the-roster).

`virtualNodes` and `virtualChains` are both filled as of M2.4b, which splits a
long edge into a chain of one dummy node per rank it spans. See
[Dummy chains](#dummy-chains). That milestone is the reason the roster is shaped
this way: a contract phrased as "every node the graph holds" would have had to
be weakened for the chains to land, and one phrased as "every node in the
roster" did not. The default order stage already walked the roster, so M2.4b
changed the ranker and the router (splitting a long edge into a chain, rejoining
the chain into a polyline on output) and no contract between them.

**The roster's virtual segment is ordered by id, not by declaration order.** The
runner sorts the ids the rank stage declared before putting them in the roster,
so a dummy's index within its layer is a function of its identity. Without that
it would be a function of where its edge sat in the ranker's iteration:
deterministic run to run, but not incrementally stable, so adding an unrelated
edge would shift every later dummy in its layer and move the bends of long edges
whose endpoints did not move at all. M2.4b's deterministic-id rule is necessary
for stability and not sufficient; this is what completes it.

## Ranking, and what it does with a cycle

The default rank stage is `longest-path-rank`. It runs in two steps: decide
which edges have to be treated as running the other way, then rank what is left.

### Cycle breaking

Sugiyama layout wants a DAG, and real graphs have cycles. The stage computes a
**feedback arc set**, a set of edges that would leave a DAG if they ran the
other way, using the greedy heuristic of Eades, Lin and Smyth (1993). It builds
a vertex order by repeatedly moving a sink to the front of a tail sequence, a
source to the back of a head sequence, and, when it has neither, the vertex
maximising `outdeg - indeg` to the back of the head sequence. Every edge running
backwards in the finished order is in the set.

**What the bound actually says.** The paper proves `|F| <= m/2 - n/6` for a
digraph with **no two-cycles**, which is a stronger hypothesis than being simple
and self loop free, and Dagr's inputs routinely have two-cycles. Two nodes
pointing at each other are `n = 2`, `m = 2`, `|F| = 1` against a bound of
`0.667`. The `n/6` term is earned per vertex removed with arcs still attached,
so isolated vertices inflate `n` for free and a sparse graph can miss the bound
with no two-cycle in it either: a 3-cycle plus two lone nodes is `|F| = 1`
against `0.667`. The term only starts to say anything once `m >= n/3`. What is
claimed here, and what the tests assert, is the `m/2` half alone, which survives
every input above and the weighting below. Half a bound is still what makes this
worth more than the back edges of a depth-first search: DFS reverses whatever
its traversal order happens to meet, with no bound at all.

**The graph is not mutated.** Nothing is flipped, nothing is added, nothing is
removed. The set of edge ids lands in `RankedState.reversedEdges` and the rest
of the pipeline reads the graph through it. That is not a stylistic choice: the
pipeline's one hard promise is that a `Graph` handed to `layout` comes back
identical, because M3 re-runs layout on every patch against a graph the caller
still holds and still edits, and because two runs of the same input have to
produce the same answer. A ranker that flipped an edge in place would make the
second run a run of a different graph.

**Self loops are never reversed.** A self loop is a cycle whichever way it
points, so reversing it buys nothing, and the pipeline already tolerates it: the
runner compares endpoint ranks with `<=` precisely so both ends of a loop can
share a rank.

**Parallel edges all go the same way.** The heuristic runs over the weighted
simple condensation, where every edge from one ordered pair collapses into one
arc whose weight is how many there were, and the decision is taken per pair.
Two copies of `a -> b` are therefore never split, one reversed and one not,
which would put a two-cycle straight back into the view that is supposed to be
acyclic. The weighting is also what lets the heuristic prefer the cheaper cut:
three edges one way against one the other reverses the one. Prefer, not
guarantee. The weights feed the `outdeg - indeg` key the heuristic picks on,
they do not make it minimise reversed weight, and in a larger graph the cheaper
direction of a pair can still end up the one running backwards.

### Ranking

Over that view, a node with nothing pointing at it gets rank 0, and every other
node sits one rank below the lowest node that points at it. Two properties fall
out, and both are relied on:

- **Minimum height, for that view.** The last rank is the number of edges on
  the longest path in the acyclic view, which is a lower bound for any ranking
  of that view that sends every edge down at least one rank. No layering of the
  view has fewer layers. The scope matters as soon as the input has a cycle:
  the view depends on which edges cycle breaking chose, and the heuristic is
  bounded on how many it reverses, not on the longest path it leaves behind. A
  different feedback arc set can leave a shallower drawing, and nothing here
  optimises for that.
- **Contiguity.** The ranks used are exactly `0..max`, with no gaps, because a
  node at rank `r` only got there from a predecessor at rank `r - 1`. The order
  stage turns ranks into layers and the runner rejects an empty layer, so a gap
  would surface there.

Every edge that is neither reversed nor a self loop runs **strictly** down:
`rank(source) < rank(target)`. A reversed edge runs strictly up.
[The runner's own check](#the-stage-contract) is the weaker `<=`, because a self
loop puts both ends on one rank and because M2.4b's long edges will legitimately
span several, but this stage means the strict form and its tests assert it.

What longest path does not give is minimum total edge length. `a -> d` alongside
`a -> b -> c -> d` leaves `a -> d` spanning three ranks, and a node with slack is
pinned as far down as it can go rather than as far up. That is a quality problem
rather than a correctness one, and it is what M2.3's rank tightening is for.
Since M2.4b it is also a cost in dummy nodes, because each of those extra ranks
is one more node to place.

### Dummy chains

An edge whose endpoints are more than one rank apart is split into a **chain**
of virtual nodes, one per rank strictly between them. `a -> d` alongside
`a -> b -> c -> d` becomes `a -> ? -> ? -> d` through two dummies on ranks 1 and
2, and the router rejoins the three segments into one polyline for `a -> d`.
Nothing downstream of the ranker meets an edge that crosses a layer it has no
node in, which is what lets M2.5's crossing counter and M2.7's positioner have
an opinion about where a long edge passes through each row.

**A dummy is `#dummy:<edgeId>:<index>`**, where `index` is its 0-based position
along the chain counting from the source **you** authored. So index 0 is the
dummy next to `edge.source` for a normal edge and for a reversed one alike, a
reversed edge's source being the end at the high rank. The id is a pure function
of the edge and that position, never a counter and never iteration order. That
is a requirement of M3 rather than a tidiness: with a counter, adding an
unrelated edge would rename every dummy on a chain, so M3.6's warm start would
meet nodes it had never seen and M3.8 would have no previous coordinate to
anchor, and a long edge would visibly jitter between two endpoints that did not
move at all. On a real Sugiyama drawing dummies outnumber real nodes, so that is
most of the geometry rather than a corner of it. Nothing parses the id back
apart: which dummies belong to which edge, and in what order, is
`RankedState.virtualChains`.

**The index, rather than the rank, and what that does and does not buy.** An
index is invariant under a uniform rank shift, which is the common edit: insert
one node upstream and a whole cone moves down a row, which under a rank-suffixed
id renames every dummy in it while every one of those edges kept the shape it
had. Worse than a clean rename, it renames them onto each other. Nodes `a`,
`p1`, `p2`, `z` with an edge `a -> z` give that edge dummies at ranks 1 and 2;
add a node `up` and an edge `up -> a`, touching neither end of `a -> z` and
leaving its span three ranks, and they are at ranks 2 and 3. One of the two ids
survives, and it survives wrong: the id that named the second bend now names the
first, so a warm start anchoring by id anchors that bend to the wrong previous
coordinate rather than simply missing it.

So the guarantee is narrower than "the id is stable", and it is stated narrowly
on purpose. **The id is stable under any edit that does not move the edge's
endpoints relative to each other**, and a uniform rank shift is such an edit.
What an index loses on is endpoints that move relative to each other, which is a
genuine change to the shape of the edge rather than an unrelated edit, and there
it misanchors by one row instead of losing identity outright. Neither scheme is
stable under everything and nothing here claims one is.

**The `#dummy:` prefix is reserved, which is not the same as unforgeable.** If
your graph holds a node whose id is one the splitter would mint, the splitter
throws a `StageContractError` naming `longest-path-rank`, the colliding id, and
the reservation, and telling you to rename your node. The runner's own
declaration check would catch the same collision one step later and still does
for a third-party ranker that mints ids some other way, so the collision is
reported once rather than twice. There is no claim that a collision is
impossible: what is claimed is that it is a named, actionable error rather than
one of your nodes quietly wearing a dummy's size.

**A dummy has no size**, `{ width: 0, height: 0 }`, matching dagre's plain
long-edge dummy. It is a place a route passes through rather than a thing that
is drawn, and the `nodeSep` on either side of it is what keeps the route clear
of the boxes it runs between. `edgeSep` is deliberately not involved: that is
the gap between two routes running alongside each other, which is M2.8's
business, and not a node's width.

**A chain runs source to target as you authored it**, so its ranks are strictly
monotonic rather than strictly increasing: they descend for an edge the ranker
reversed. It has to be complete, holding one node at every rank the layout has
between its endpoints. Both rules, and the reasons for them, are in
[The roster](#the-roster), and the runner checks both.

A self loop gets no chain, having both ends on one rank, and neither does an
edge between neighbouring ranks. A graph with no long edge in it therefore
declares nothing at all, and is laid out exactly as it was before M2.4b: same
coordinates, same routes, same `bounds`. The run is not quite free of the
milestone, though. The runner now walks every route point when it computes
`bounds` and again when it asserts them, which it did not do before, so a
chainless run pays a linear pass over the polylines it already built. What it
does not pay is anything per dummy, because there are none.

Two things a caller sees. Long edges come back as polylines: two points for a
short edge, and one more for every rank a long edge crosses, where before M2.4b
every route was two points. And `bounds` can be larger, because it is the hull
of the node boxes and the route points, and a zero-width dummy at the end of a
row sits at that row's right extreme, `nodeSep` clear of the last box in it. See
[The result](#the-result).

### What `reversedEdges` means if you are reading a result

Nothing, and that is deliberate. A `RoutedEdge` runs from its `source` to its
`target` as **you** authored them, whatever the ranker did to break a cycle, so
an arrowhead drawn at the last point lands on the target on every edge. See
[The result](#the-result). `reversedEdges` is bookkeeping between the ranker and
the router, it does not appear in a `LayoutResult` at all, and a consumer that
found itself consulting it would be working around a bug rather than using an
API.

Writing a stage rather than reading a result puts you on the other side of that
line, and there `reversedEdges` is yours to honour: it is the only thing that
tells a router an edge was ranked the other way up, and emitting that route
target-first is exactly how the guarantee above gets broken. The runner checks
the direction for you as of M2.2, in a form that survives M2.8's border
attachment. See [Route direction](#route-direction).

### Determinism and cost

Both steps are O(V + E) in time and space. Cycle breaking gets there by keeping
vertices in degree buckets rather than rescanning what is left each round, and
ranking is a Kahn-style sweep that visits each node and edge once. No timing
figure is quoted here because none is measured yet: M2.9 commits benchmark
baselines at 1k and 10k nodes, and until it does the complexity is the claim.
Both steps are fully deterministic: vertices are numbered in `graph.nodes()`
order, edges are walked in `graph.edges()` order, and a tie is broken by bucket
arrival order, which is itself fixed by the graph's order.
Determinism here is load bearing rather than tidy, for the reason in
[Determinism](#determinism): a ranker that resolved a tie differently on a
re-run would move nodes the user never touched.

## Why the stages are swappable

Every stage is an object with a `name` and a `run`:

```ts
interface RankStage {
  readonly name: string;
  run(input: PreparedState): RankOutput;
}

interface RankOutput {
  readonly ranks: ReadonlyMap<NodeId, number>;
  readonly reversedEdges: ReadonlySet<EdgeId>;
  readonly virtualNodes?: ReadonlyMap<NodeId, Size>; // declared nodes, with their sizes
  readonly virtualChains?: ReadonlyMap<EdgeId, readonly NodeId[]>; // which edge each serves
  // Plus `graph`, `config` and `sizes` declared `never`, so a stage that
  // spreads the record it was handed does not compile. See The roster.
}
```

The other three are the same shape with one field each: an `OrderStage` returns
an `OrderOutput` of `layers`, a `PositionStage` a `PositionOutput` of
`positions`, a `RouteStage` a `RouteOutput` of `routes`, each with its own
`never` block covering everything upstream of it. All eight types are exported.

Sugiyama layout is four hard problems in a trench coat, and each of them has a
range of answers that trade quality against time. Ranking can be longest-path or
network simplex. Ordering can be one barycenter sweep or twenty plus a transpose
pass. Positioning can be median-based or Brandes-Koepf. Making each phase a
value rather than a function call inside a monolith means the choice is a
property of the call site:

```ts
layout({ graph }, { position: myPositionStage });
```

The other three phases fall back to `defaultStages`, and the whole thing still
typechecks, because a `PositionStage` is a `PositionStage` whoever wrote it.
That is also how this project ships: M2.2 replaced the ranker, M2.5 replaces the
orderer, M2.7 replaces the positioner, each against a runner and a test suite
that already work. The override object has a name of its own,
`LayoutStageOverrides`, for when you build one separately from the call.

`defaultStages` is also how you wrap a default rather than replace it:

```ts
import { defaultStages, layout } from '@dagr/layout';
import type { PositionStage } from '@dagr/layout';

const timed: PositionStage = {
  name: 'timed-position',
  run(input) {
    const started = performance.now();
    const output = defaultStages.position.run(input);
    console.log('position took', performance.now() - started);
    return output; // a PositionOutput: { positions }
  },
};

layout({ graph }, { position: timed });
```

A wrapper that wants to adjust the default's answer spreads the OUTPUT, which is
one field, rather than the record it was handed:

```ts
const nudged: PositionStage = {
  name: 'nudged-position',
  run(input) {
    const { positions } = defaultStages.position.run(input);
    const moved = new Map<NodeId, Point>();
    for (const [id, point] of positions) moved.set(id, { x: point.x + 20, y: point.y });
    return { positions: moved };
  },
};
```

The four default stages are reachable only through `defaultStages`, and are not
exported individually. Three of them are still placeholders scheduled for
replacement, so a name exported today is a name to delete tomorrow. Going
through `defaultStages.position` also keeps this wrapper working when M2.7
changes what that property points at, which importing the stage by name would
not: M2.2 already changed what `defaultStages.rank` points at, and no wrapper
written this way noticed.

## The stage contract

The other half of that bargain is the stage contract. The runner checks each
stage's output before the next stage sees it, at that stage's own boundary, so a
half-finished ranker is reported as a ranker problem rather than surfacing three
stages later as an edge that routes to nowhere. A stage that leaves work undone
throws a `StageContractError` naming that stage and the id it dropped.

Every check compares against the graph and the roster the **runner** holds. That
is what makes "at its own boundary" mean anything, and since M2.4a it is also
the only graph there is: a stage returns its own fields and the runner builds
the record, so no stage has a graph of its own to be marked against.

There is no longer a rule that applies after every stage. The one that used to,
"the record's `graph` is the same object the runner handed in", is enforced by
the types and by the runner now, and is described in
[The roster](#the-roster).

After the **rank** stage:

- no id declared in `virtualNodes` is one the graph already holds. A collision
  is not a second node, it is the caller's node wearing a stage's clothes: the
  declaration's size wins in the roster-wide map, so the caller's node quietly
  changes size and nothing downstream notices. Once M2.4b mints dummy ids from
  edge ids, a graph whose node ids look like that pattern lands here, though the
  default ranker gets there first with a message about its reserved `#dummy:`
  namespace, so this one is what catches a third-party ranker;
- every declared size is a finite pair of lengths that are zero or greater.
  This is the one size in a run that the config never saw: prepare measures and
  validates every node the graph holds, and a declared node's size is minted by
  the stage afterwards;
- every member of the roster has a rank, and it is a finite number;
- every member of the roster has a size. This is a lookup rather than a
  validation, and the only way to fail it is to reach into the live graph and
  add a node instead of declaring one, which puts a member in the roster that
  prepare never measured. Narrowing the stage return types stopped a stage
  handing a graph back, not a stage mutating the one it was handed, so this
  rule is what keeps that mistake a named stage error rather than an
  `InternalLayoutError` blaming this package;
- every id in `reversedEdges` is an edge the graph holds;
- every key of `virtualChains` is an edge the graph holds, and no chain is
  empty. An edge with no dummies has no entry at all rather than an empty one;
- every id in a chain was declared in `virtualNodes`, and no id appears in two
  chains or twice in one. A dummy belongs to exactly one edge: shared, it would
  be pulled toward two routes at once, and each of them would bend through a
  coordinate chosen for the other;
- a chain's ranks are strictly monotonic from its edge's source to its target,
  increasing for a normal edge and decreasing for a reversed one, and lie
  strictly between the two endpoint ranks. See
  [The roster](#the-roster) for why the direction is the caller's and not the
  ranker's;
- a chain holds one node at every rank the layout actually has, strictly
  between its endpoint ranks, so it has no hole in it. The error names the first
  rank that is missing, and the node occupying it, rather than saying the chain
  is too short. This applies to a chain that EXISTS: declaring one is optional,
  a ranker that splits no long edge is legal, and so is a declared id that
  belongs to no chain. Being phrased over the ranks the layout has, it is a property of
  the whole ranking rather than of one edge, which is what the paragraph on
  completeness in [The roster](#the-roster) is about;
- every edge is a ranking: `rank(source) <= rank(target)` for an edge that was
  not reversed, `rank(target) <= rank(source)` for one that was. Less-or-equal
  rather than strictly-less, because a self loop puts both endpoints on one
  rank, and after M2.4b a long edge legitimately spans several. The default
  ranker is strictly stronger than this and its own tests say so, see
  [Ranking](#ranking); the contract stays weak because a third-party ranker with
  a self loop to place has nowhere else to put it.

After the **order** stage:

- every member of the roster appears in exactly one layer, and nothing else
  appears in any layer;
- every node in a layer has that layer's rank, so layers really are ranks;
- each layer's rank is strictly greater than the previous layer's, so layer
  order and rank order agree about which way is down;
- no layer is empty. An empty layer has no rank to compare against its
  neighbours, and the position stage would still give it a row of vertical
  space.

After the **position** stage:

- every member of the roster has a position, and both coordinates are finite.

After the **route** stage:

- `routes` holds exactly the graph's edges, no more and no less;
- every polyline has at least two points. Fewer is not a shorter route, it is a
  route a renderer cannot draw;
- every point is finite. `NaN` and `Infinity` are rejected here for the same
  reason the config rejects them: they do not fail, they propagate through every
  later sum and surface as a scene that will not draw, with nothing to say which
  stage minted them. Cheap today, when a polyline is two copied endpoints, and
  doing real work from M2.8, when it becomes computed geometry;
- every polyline runs the right way round: its first point is at least as close
  to its edge's `source` as to its `target`, and its last point at least as
  close to the `target` as to the `source`. See
  [Route direction](#route-direction) for why the form is proximity and not
  equality.

**The chain contract binds the ranker, not the router.** Nothing on that list
checks that a router actually used `virtualChains`, and that asymmetry is
deliberate rather than an oversight. A third-party router that ignores the field
and emits the old two-point line for a long edge passes every check above, and
silently discards every dummy the ranker minted. The obvious rule, that an edge
with a chain of `n` dummies has a route of at least `n + 2` points, was
considered and rejected: straightening long-edge chains is a primary goal of
Brandes-Koepf (M2.7), so a collinear chain is exactly what a good positioner
produces, and a polyline router (M2.8) may then legitimately collapse it back to
two points. That is the same argument [route direction](#route-direction) makes
about proximity against equality. A rule that would have to be withdrawn a
milestone later is worse than one never claimed.

### Route direction

**A polyline runs from its edge's `source` to its `target`, as the caller
authored them, even when the ranker reversed the edge to break a cycle.** A
router working from the reversed direction will naturally emit its points
target-first, and a renderer that draws an arrowhead at the last point (M4 and
M5 both will) then puts arrowheads on the wrong end for exactly the edges that
were part of a cycle. `reversedEdges` is the router's bookkeeping and never the
consumer's.

This was an unchecked rule until M2.2, and for a good reason: `reversedEdges`
was always empty, so no router could get it wrong. Now one can, and the failure
is silent two packages downstream, so the runner checks it.

**What it checks is proximity, not equality.** Comparing the endpoints of the
polyline against the two node positions for equality is the obvious form, and it
is the wrong one: M2.8 attaches routes at box borders and detours them around
obstacles, so an equality check would have to be relaxed one milestone later,
and a contract that loses rules is worse than one that never claimed them.
Proximity survives border attachment and detours alike, because a route that
leaves its source's border and arrives at its target's is still nearer its own
node at each end. The comparison is not strict, so a self loop passes: both of
its ends are the same node and every distance in the comparison is equal.

**What is still not checked is the shape between the endpoints.** A route may
wander anywhere it likes on the way, and the runner has no opinion about it. Nor
does it check that a polyline is monotone in the rank axis, which is what M2.8
will produce and which no rule here demands.

The runner also takes the identity of the edge out of the router's hands
entirely: a route stage returns polylines, and `id`, `source` and `target` on
the finished `RoutedEdge` are copied from the graph. A confused router cannot
mislabel an edge, and as of M2.2 it cannot quietly draw a backwards one either.

Node completeness and `bounds` are not on this list, and stopped being checks
when the runner took over assembling the result. There is no route stage output
that could get either wrong. `bounds` is still finite, still encloses every node
box and every route point, and is still the zero rectangle when there are no
nodes, and the runner asserts all three over its own output before returning;
the containment comparison carries a tolerance scaled to the magnitude of the
coordinates, for the floating point reason in
[Overlap, exactly](#overlap-exactly). A failure
there would be a bug in this package rather than in a stage, so it throws an
`InternalLayoutError` and not a `StageContractError`, which names a stage.

## Usage

```ts
import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

const graph = new Graph();
graph.addNode('ingest');
graph.addNode('parse');
graph.addNode('render');
graph.addEdge('ingest', 'parse', 'a');
graph.addEdge('parse', 'render', 'b');

const result = layout({
  graph,
  config: {
    nodeSep: 20,
    rankSep: 60,
    nodeSize: (node) => ({ width: node.id.length * 12, height: 32 }),
  },
});

for (const node of result.nodes.values()) {
  console.log(node.id, node.x, node.y, node.width, node.height);
}

for (const edge of result.edges.values()) {
  // Two points for a short edge, one more for every rank a long edge crosses.
  console.log(edge.id, edge.points);
}

result.bounds; // { x, y, width, height } around every box and every route point
```

## Config

Every field is optional. What the caller leaves out comes from
`DEFAULT_LAYOUT_CONFIG`, which is exported so you can read the numbers rather
than repeat them.

| Field | Default | Meaning |
| --- | --- | --- |
| `nodeSep` | `50` | Minimum gap between two node boxes side by side in a layer. |
| `rankSep` | `50` | Minimum gap between two adjacent layers, box edge to box edge. |
| `edgeSep` | `10` | Minimum gap between two edge routes running alongside each other. Carried now, honoured once real routing lands in M2.8. |
| `defaultNodeSize` | `{ width: 100, height: 40 }` | Size for any node `nodeSize` does not size. |
| `nodeSize` | none | `(node) => Size \| undefined`. Called once per node during prepare. |

Sizes arrive through a callback rather than off the node record on purpose. A
node's drawn size belongs to whoever is drawing it, not to the graph. Nodes do
carry attribute bags since M1.2, so a caller who keeps sizes there can read them
straight off the node the callback is handed:

```ts
layout({ graph, config: { nodeSize: (node) => node.attrs.size as Size | undefined } });
```

That is the caller's convention, though, not this package's. Layout never
reaches into a node for anything but its id, so no attribute key is reserved and
no graph has to be shaped a particular way to be laid out. Return `undefined`
for a node to fall back to `defaultNodeSize`, which keeps "size these few nodes
specially" a one-line callback.

The resolved config, `ResolvedLayoutConfig`, is what every stage reads. It has
`nodeSep`, `rankSep`, `edgeSep`, and `defaultNodeSize`, all filled in. The
`nodeSize` callback deliberately does not survive resolution: it is consumed
once during prepare and the answers live in `PreparedState.sizes`. A stage that
could still call it might size the same node twice and get two different
answers.

Every separation and every size has to be a finite number that is zero or
greater. Zero is allowed, a zero separation is a strange layout but a well
defined one. `NaN` and `Infinity` are not, because they do not fail: they
propagate through every later coordinate and surface as a scene that will not
draw, with no trace of which input caused it. A bad one throws
`InvalidConfigError` before any stage runs.

## The result

```ts
interface LayoutResult {
  readonly nodes: ReadonlyMap<NodeId, PositionedNode>;
  readonly edges: ReadonlyMap<EdgeId, RoutedEdge>;
  readonly bounds: Rect;
}

interface PositionedNode {
  readonly id: NodeId;
  readonly x: number; // centre
  readonly y: number; // centre
  readonly width: number;
  readonly height: number;
}

interface RoutedEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly points: readonly Point[]; // both endpoints, source to target
}
```

**`points` includes both endpoints and always runs from `source` to `target`**,
as the caller authored them, even when the ranker reversed the edge to break a
cycle. Draw an arrowhead at the last point and it lands on the target, on every
edge, cycle or not. `reversedEdges` is bookkeeping between the ranker and the
router, and nothing downstream of the route stage should ever have to consult it
to know which way an edge runs.

`NodeId` and `EdgeId` are `@dagr/graph`'s own types, imported from there rather
than re-exported here. Layout keys everything by the ids the graph already
minted, so there is only ever one kind of node id in play. `Point`, `Rect`, and
`Size` are this package's, and are exported.

**Coordinates are centres, not corners.** A node's `x` and `y` are the middle of
its box, and a `Point` anywhere in this package means the same thing. Centres
are what animation interpolates and what edges attach to, and they stay
meaningful when a node resizes; a corner does not. To get a top-left corner,
subtract half the size. `Rect`, by contrast, is a corner and a size, because
that is what a viewport wants.

Y grows downward, matching screen coordinates.

Maps rather than arrays, keyed by the graph's own ids. M3.1 diffs two
`LayoutResult`s by id to produce a `LayoutDelta`, which wants a map lookup per
node rather than an index scan, and Map iteration is still deterministic
insertion order, so nothing is given up: both maps iterate in graph insertion
order.

Maps are keyed by the caller's own ids, no more and no less. Whatever a stage
needed internally, including anything it declared in `virtualNodes`, stops at
the route stage, because the runner builds both maps by walking the caller's own
graph rather than by trusting what a stage handed it.

`bounds` is the smallest rectangle containing every node box **and every route
point**. An empty graph gets a zero rectangle at the origin.

Until M2.4b the two formulations agreed, and the cheaper one was what this page
promised: a route ran centre to centre, and a centre is inside its own box. A
route that bends through a dummy need not agree, because a zero-width dummy at
the end of a row sits at that row's right extreme, `nodeSep` clear of the last
box in it, so the claim was made true rather than softened.

"Need not" is doing real work there. Whether a bend actually leaves the hull
depends on the rest of the drawing: at `nodeSep: 0`, which the config accepts,
the dummy lands exactly on the last box's right edge, and a row that is wider
somewhere else in the graph can contain the bend anyway. One reachable case is
enough to make the old claim false, and the formulation now covers the case
rather than the common case. It is also what M2.8's obstacle detours need, so
nothing here changes again when they arrive. A layout with no chain in it has
exactly the bounds it had before.

## Overlap, exactly

No two node boxes overlap, **up to floating point rounding at the magnitude of
the coordinates involved**. That hedge is worth spelling out, because it is not
a hedge about the placement.

The placement is exact in real arithmetic, for every case: zero separations,
zero sizes, a single node, wildly mixed sizes in one row. What is not exact is
the round trip through the centre. A position is a centre, computed as
`left + width / 2`, and a consumer recovers the right edge as `x + width / 2`,
and `(l + w / 2) + w / 2` is not always exactly `l + w`. Three boxes of width
0.3, 0.2, 0.2 with `nodeSep: 0` come out like this:

```
box 2: x = 0.05000000000000002, right edge = 0.15000000000000002
box 3: x = 0.25,                left edge  = 0.15
gap = -2.7755575615628914e-17
```

That is one bit of a double, not an overlap. An overlap predicate written with a
strict inequality would call it one, so compare box edges with a tolerance
scaled to their magnitude, not with `<`. The runner's own `bounds` containment
assertion does exactly that, and needs to: `bounds.x` is the minimum left edge
and `bounds.width` is the span, so `x + width` is not always exactly the maximum
right edge it was derived from. Widths 0.1, 0.2, 0.2 at the default `nodeSep`
leave the rightmost box 7.1e-15 past `x + width`.

The same arithmetic absorbs a separation far below the coordinate scale: a
`nodeSep` of `1e-9` between boxes `1e9` wide gives boxes that touch, because the
gap is smaller than one ulp of where it would land. That is a real property of
doubles at that spread rather than a bug, and boxes that touch still do not
overlap.

Centres are the committed representation for the reasons above, so the guarantee
is stated with a tolerance rather than the representation changed to make it
exact.

## Determinism

Given the same graph and the same config, `layout` returns the same result,
every time, in any process. There is no randomness and no iteration over a
hashed key set. The result maps iterate in graph insertion order, which
`@dagr/graph` guarantees. This is not a nicety: incremental layout in M3 is
built on being able to say "this node did not move", which requires that a
re-run of an unchanged input is bit for bit an old run.

## Errors

Same shape as the `@dagr/graph` error family, so one `instanceof` check covers
the whole thing and every member carries a `code`.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `DagrLayoutError` | abstract | Base class, abstract, never thrown directly. |
| `InvalidConfigError` | `INVALID_CONFIG` | A separation or a size is not a finite number that is zero or greater. Carries `field` (a path such as `nodeSize("n1").width`) and the offending `value`. |
| `StageContractError` | `STAGE_CONTRACT` | A stage broke one of the rules in [The stage contract](#the-stage-contract). Carries the offending stage's `name`, the `id` it dropped, and a `detail`. One check is about the layers rather than one id, and uses a plain label instead: `layer 3`. The `graph` label is gone as of M2.4a, along with the check that raised it. |
| `InternalLayoutError` | `INTERNAL` | The pipeline caught itself breaking one of its own invariants. Carries a `detail`. Always a bug in `@dagr/layout`, never in your graph, your config, or a stage you supplied, which is why it is not a `StageContractError`: that class names a stage, and naming one here would blame whoever was plugged in. Nothing to fix on your side. Please report it. |

The three sort by whose bug it is, which is the only question a caller catching
one has to answer: fix the input, fix the stage, or file the bug.

```ts
import { DagrLayoutError } from '@dagr/layout';

try {
  layout({ graph }, { rank: myRankStage });
} catch (error) {
  if (error instanceof DagrLayoutError) {
    switch (error.code) {
      case 'INVALID_CONFIG':
        break;
      case 'STAGE_CONTRACT':
        break;
      case 'INTERNAL':
        break;
    }
  }
}
```

## What is not here yet

One of the four default stages is a layout algorithm. The other three are
placeholders:

| Stage | `name` | What it does today | What comes next |
| --- | --- | --- | --- |
| rank | `longest-path-rank` | Breaks cycles with a greedy feedback arc set, ranks by longest path, and splits every long edge into a dummy chain. Real, and described in [Ranking](#ranking-and-what-it-does-with-a-cycle). | Rank tightening (M2.3). |
| order | `insertion-order` | Groups the roster by rank, orders each layer by graph insertion order. | Barycenter sweeps with a crossing counter (M2.5), then transpose refinement (M2.6). |
| position | `grid-position` | Lays each layer out as a row, left to right, centred on `x = 0`, stacking rows downward from `y = 0`. | Brandes-Koepf horizontal coordinate assignment (M2.7). |
| route | `straight-route` | Straight segments from the source centre through each of the edge's dummies to the target centre, which is two points for an edge with no chain. | Border attachment, obstacle detours and splines, monotone in the rank axis (M2.8). |

So a default run of a real graph gives you the right number of rows with the
right nodes in them, and then evenly spaces each row in insertion order and
joins the lot with polylines that bend once per rank a long edge crosses. The
layers and the number of bends are worth reading; where along a row a node or a
bend sits is not yet. What it is, is a run that always completes, never overlaps
two boxes (see [Overlap, exactly](#overlap-exactly)), and satisfies every
guarantee this page makes about the result, which is what the later milestones
are built against.

`RankedState.virtualNodes` and `RankedState.virtualChains` were the last two of
those bookkeeping slots to be filled, and M2.4b filled them. They exist because
the alternative, mutating the caller's graph to add a node, is the one thing
this pipeline promises not to do. `RankedState.reversedEdges` was the same kind
of slot until M2.2 filled it, and it filled without a contract change, which is
the argument for having declared all three early. `virtualNodes` did not manage
that: M2.4a changed how a stage declares one, from a set of ids plus a
copied-and-extended `sizes` map to a map of ids to sizes. That is the whole cost
of the slot having been declared before anything filled it, it was paid before
any real stage populated the field, and it is why the interface change landed on
its own and ahead of the chains. `virtualChains` was declared on the same
argument and with its checks already written, so M2.4b filled it and added one
rule (completeness) rather than designing it.

Also still to come: a golden corpus compared against dagre with layout
benchmarks (M2.9), and running the same API in a worker (M2.10). Incremental
relayout, the flagship feature, is all of M3, and arrives as a
`createLayout({ stages, config })` engine rather than as another free function:
warm-starting a relayout from a previous run only makes sense if the stages and
the config are the same ones that produced it, which is a thing to bind once
rather than to pass again and hope. `layout()` stays as the one-shot sugar, and
`LayoutResult` stays small and serializable because the engine keeps the
pipeline state, not the result. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in.
