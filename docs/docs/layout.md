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

This page describes the pipeline as of M2.4c, plus M2.3's second ranker and the
order stage M2.5 built and M2.6b made the default. Those numbers are not in
landing order on purpose: M2.4a landed before M2.3's entry was written up here,
and the milestones do not run in landing order.

The types, the runner, and the stage boundaries are real: they are what every
later milestone is built against, and the roster below is why the one boundary
that was going to have to move (dummy nodes) did not have to. Three of
the four default algorithms are real. The rank stage breaks cycles, ranks by
longest path and splits every long edge into a chain of dummy nodes, so the
layers are the ones the graph asks for and no edge crosses a layer without a
node in it, and M2.3 added a second ranker a caller can select instead. The
order stage reduces edge crossings by barycenter sweeps and a transpose pass,
which M2.6b made what you get when you name no order stage, at a price and for a
saving that are
[stated below](#what-the-default-order-stage-costs-and-buys). The route stage
gives every edge a polyline through its dummies, attached at the endpoint boxes'
borders and monotone in the rank axis, which M2.8 made the default. The
remaining default, `grid-position`, is a placeholder that produces a well formed
but naive result.

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
- **route** gives every edge a polyline, from the source box's border through
  the edge's dummies to the target box's border. See
  [Routing](#routing-and-where-a-route-attaches).

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
other way. It gives every node a real-valued **height**, the one that minimises
the sum over edges of `(height(target) - height(source) - 1)^2`, which is the
least-squares way of saying "put every target one step below its source". An
edge running downhill in those heights is in the set if, and only if, its two
endpoints lie in the same strongly connected component of your graph.

Solving that is a linear system, `L h = b`, where `L` is your graph's Laplacian
and `b(u)` is `indeg(u) - outdeg(u)`, and the stage solves it with a
preconditioned conjugate gradient: about 24 iterations on the 1k benchmark
corpus and 46 on the 10k. Every edge pulls on both of its endpoints and the
answer is the balance of all of them at once, so a few edges pointing against
the grain cannot move a height far. That is what lets it recover the layering of
a graph that has one, rather than deciding each node's place from that node's
own degrees.

**A backward edge between two components is left alone.** If the two endpoints
are in different components then no cycle passes through that edge, so no cycle
needs it turned round, and turning it round only stretches the view the ranker
then has to rank. The stage reads the components off the same arc structure it
already builds for the solve rather than building a second one, so it does not
pay for them twice.

The rule is safe by construction rather than by testing. A cycle in the result
would have to be one of two things. If every edge on it stayed inside one
component, then every edge on it runs forwards in the vertex order, so the order
would have to increase all the way round a loop. Otherwise the cycle uses an
edge between two components, kept exactly as you authored it, and such an edge
always moves from an earlier component to a later one in the component
ordering, so the cycle could never get back to where it started. Note that this
works only for the whole class at once: leaving SOME cross-component edges
unreversed while reversing others is not safe, because a reversed edge creates
paths your graph did not have.

**What the bound actually says.** At most half the edges are ever reversed, and
the stage establishes that by construction. An edge runs backwards in exactly
one of a vertex order and its reverse, so the two backward sets partition the
edges between them and the smaller is at most half; the stage counts and takes
the smaller side. Without that step the heights alone would promise nothing, and
the case is not hypothetical: a cycle whose nodes were added in the order that
walks it backwards has every height tied, falls back to insertion order, and
would reverse all but one of its edges. The component rule only takes edges out
of the set the bound applies to, so it survives untouched.

It is a bound on HOW MANY edges get reversed, and nothing more. Fewer reversed
edges is not the same thing as a better drawing, which is the next paragraph.

**What it does not promise, and what that costs your drawing.** The set it finds
leaves a DAG, and that is the whole promise. It is not the smallest such set,
and, more to the point, it is not the set that leaves the SHALLOWEST drawing. On
the 10k benchmark corpus, a graph authored with 60 layers, the view this stage
hands the ranker is 160 ranks deep. Reversing only the edges that were authored
pointing backwards would have left it 60 deep, so well over half the layers in
that drawing are there because of how the cycles were broken and not because of
anything in the graph. Every extra layer is more ranks for a long edge to cross,
so it shows up as taller drawings and longer, more bent edges.

The number a caller actually feels is the total distance edges travel, because
that is what decides how many stand-in nodes a long edge is broken into. On the
10k corpus it is 174,222 rank crossings and on the 1k it is 14,746, against
32,050 and 2,665 for reversing exactly the authored back edges. That is about
five and a half times a ground truth no cycle breaker could compute, the
generator's own record of which edges it inserted backwards, and the whole of
the remaining gap is depth.
Three things follow for a caller, and the first is that choosing the other
rank stage does not undo the depth.
[`network-simplex-rank`](#minimum-total-edge-length-and-what-it-costs) shortens
edges WITHIN that view, and does a lot of good doing so, but both stages rank a
view whose depth cycle breaking has already fixed.
The count in `reversedEdges` is not a quality signal, and a smaller one is not
a better drawing: the cycle breaker's own recorded not-taken variant reverses
about 30% MORE edges on the 10k corpus, 1,117 against the 857 that ship, and
leaves a view about a quarter smaller in total span, 128,141 against 174,222.
And none of it applies to an acyclic graph, where the set is empty and
`longest-path-rank` draws it exactly as deep
as the graph is long, so it is worth knowing whether your graph actually has
cycles before reading a tall drawing as a cycle-breaking problem.
[`network-simplex-rank`](#minimum-total-edge-length-and-what-it-costs) can still
spend a layer on an acyclic graph, for the unrelated reason described there: it
buys edge length with height, and that trade has nothing to do with the feedback
arc set.

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

**Parallel edges all go the same way.** The decision is taken by comparing two
heights, and every copy of a pair has the same two endpoints, so every copy gets
the same answer. Two copies of `a -> b` are therefore never split, one reversed
and one not, which would put a two-cycle straight back into the view that is
supposed to be acyclic.

Copies do count in the solve, once each, and that is what lets it prefer the
cheaper cut: three edges one way against one the other pull three times as hard,
so the one is what ends up running downhill. Prefer, not guarantee. The
multiplicity is a weight in a least-squares objective, not a constraint, and in
a larger graph the cheaper direction of a pair can still end up the one running
backwards.

### Ranking

Over that view, a node with nothing pointing at it gets rank 0, and every other
node sits one rank below the lowest node that points at it. Two properties fall
out, and both are relied on:

- **Minimum height, for that view.** The last rank is the number of edges on
  the longest path in the acyclic view, which is a lower bound for any ranking
  of that view that sends every edge down at least one rank. No layering of the
  view has fewer layers. The scope matters as soon as the input has a cycle:
  the view depends on which edges cycle breaking chose, and the heuristic is
  bounded on how many it reverses, not on the longest path it leaves behind. So
  "minimum height" means minimum for that view and not minimum for your graph,
  and on the 10k benchmark corpus the gap between the two is 160 ranks against
  60. A different feedback arc set can leave a shallower drawing, nothing here
  optimises for that, and neither stage in this package recovers it, because
  both break cycles with the same heuristic.
- **Contiguity.** The ranks used are exactly `0..max`, with no gaps, because a
  node at rank `r` only got there from a predecessor at rank `r - 1`. It is a
  property of this stage rather than something the runner enforces: the order
  stage turns the distinct ranks it finds into layers, so a rank nothing sits at
  is not an empty layer, it is not a layer at all.

Every edge that is neither reversed nor a self loop runs **strictly** down:
`rank(source) < rank(target)`. A reversed edge runs strictly up.
[The runner's own check](#the-stage-contract) is the weaker `<=`, because a self
loop puts both ends on one rank and because M2.4b's long edges will legitimately
span several, but this stage means the strict form and its tests assert it.

What longest path does not give is minimum total edge length. It pins each node
as high as its predecessors allow and never looks at what the node points at, so
`e -> d` alongside `a -> b -> c -> d` leaves `e` at rank 0 with its one edge
spanning three ranks when rank 2 was free. `a -> d` alongside that same chain is
not that case, though it looks like it: `d` sits three ranks below `a` in every
feasible ranking, so a shortcut edge spanning three ranks is a shape longest
path cannot avoid rather than a total it gets wrong. Either way it is a quality
problem and not a correctness one, and the next section is the stage that fixes
it. Since M2.4b it is also a cost in dummy nodes, because each rank an edge
spans beyond the first is one more node to place.

### Minimum total edge length, and what it costs

`network-simplex-rank` is the second real rank stage, landed in M2.3 and
exported by name. It breaks cycles exactly as the default does, over the same
acyclic view, and then minimises the **total edge length**: the sum, over the
edges of that view, of how many ranks each edge crosses. Gansner, Koutsofios,
North and Vo (1993), section 2.

That sum, minus the edge count, is exactly how many dummy nodes the splitter
over this ranking mints, which is why it is the quantity worth optimising. On
the 1k benchmark corpus it takes the default ranker's 14,746 dummies down to
10,660, a 28% cut, and that is as far as it goes: ten times the budget returns
the same 10,660. On the 10k corpus it reaches 105,975 from 174,222 inside its
default budget, a 39% cut, and 99,698 given ten times it.

That 28% read 31% in the previous release and 57% in the one before, and this
stage did not get worse either time. Its INPUT got better: the cycle breaker
leaves the components alone and now solves for a layering rather than picking
greedily, which together took the 1k view both stages rank from 40,430 dummies
down to 14,746 and the 10k view from 1,414,263 to 174,222, so there is less left
here to win. See [Cycle breaking](#cycle-breaking).

Quote a budget beside any figure here. The gap between the default budget and
ten times it used to be 16% on the 10k corpus and is now 6% (105,975 against
99,698), because a view with an eighth of the span has an eighth of the length
to pivot out of it. The older, deeper view was 37% worse at the default
budget (423,426 against 268,589) and 0.8% BETTER at 200,000 pivots (224,789
against 226,676), because the older view had more of its gain still ahead of it
and the default budget was measuring how fast each converges rather than how far
each gets. That pair compares the pre-M2.2b view against the M2.2b one, and
neither is the view that ships today, but the lesson carries across breakers.
The newer view of any such pair is the cheaper of the two to solve at both
budgets.
This is why a simplex figure quoted without its pivot budget says nothing.

**That saving became collectable in M2.4c and was not before it.** M2.4b put
the splitter in `longest-path-rank` and nowhere else, so until M2.4c this stage
omitted `virtualNodes`, minted no dummy, and the counts above were a cost nobody
was paying: what a caller who switched actually got was a drawing whose long
edges reached the order stage, the position stage and the router unsplit, which
is the one thing [dummy chains](#dummy-chains) exist to prevent. The splitter now
lives in one place and both rank stages call it, so the counts above are what
this stage puts in the roster.

What has not changed is the rest of the trade. Switching still buys a rank stage
that costs far more (tens of milliseconds against the seconds the budget caps it
at on the 10k corpus) and a drawing that is never shorter and may be taller. The
dummies saved are what you are buying with that.

**It cannot make the drawing shorter, and it can make it taller.** Minimum total
edge length and minimum height are different objectives, and this stage
optimises the first. Every feasible ranking sends each edge down at least one
rank, so the last rank is at least the longest path in the acyclic view, and
longest path already hits that bound exactly: nothing can beat it. Nothing here
defends it either. Six nodes are enough to lose a rank of height for a unit of
length:

```
v8 -> v4 -> v5     longest path: three layers, total edge length 6
v6 -> v5           simplex:      four layers,  total edge length 5
v6 -> v9 -> v0
```

Pulling `v6` down one rank tightens `v6 -> v5`, and drags `v9` and `v0` into a
fourth layer to do it. Both corpora happen to come out the same height either
way (64 ranks and 160 ranks), so this is a real risk rather than a certainty.
If a short drawing is what matters, name `longestPathRankStage`: minimum height
is its guarantee, and it is the algorithm you want for that whether or not it
also happens to be the default.

Both real rank stages are exported by name, so a call site says which objective
it wants rather than inheriting whichever one is currently the default:

```ts
import { layout, longestPathRankStage, networkSimplexRankStage } from '@dagr/layout';

// Fewest layers. Also what a run with no `rank` override gets today.
const short = layout({ graph }, { rank: longestPathRankStage });

// Least total edge length, at the risk of more layers.
const tight = layout({ graph }, { rank: networkSimplexRankStage });
```

`networkSimplexRank(options)` builds one with options, and there are two.

**`maxIterations`** bounds the pivots and defaults to 20,000. It is a safety
valve rather than a quality knob: it is about nine times what the 1k corpus
needs to converge, which is about 2,200 pivots (2,000 is still 0.3% off at
10,688, the optimum of 10,660 is first reached at exactly 2,182, and 20,000 and
200,000 both return that same 10,660), and it is what bounds the 10k corpus,
which does not converge inside any budget worth spending, to a few seconds.
Give it more if a run is worth it: the 10k corpus is still improving at 200,000
pivots, where about 49 seconds buys 99,698 against the default budget's
105,975. Whatever stops it, the ranking that comes back is feasible, and never
worse than the ranking the stage started from.

A budget is a pivot count, so it has to be an integer that is zero or greater,
or `Number.POSITIVE_INFINITY`, which means no budget at all: run until no tree
edge has a negative cut value. Anything else, `2.5` and `0.5` included, is an
`InvalidConfigError` thrown by `networkSimplexRank` rather than by the run, so a
bad budget fails at the call that named it.

**`initialRanks`** is a previous ranking to start from. It matters because this
LP is degenerate: many different rankings reach the same total edge length, and
which one a cold run lands on depends on where it started. Without a warm start
a one-edge patch can move the solver to a different optimum of equal cost,
churning ranks across a region that did not change and improving nothing, which
is exactly what M3 re-running layout on every patch would suffer.

```ts
import { layout, networkSimplexRank } from '@dagr/layout';

// `previousRanks` is a ReadonlyMap<NodeId, number> from an earlier run.
const again = layout(
  { graph },
  { rank: networkSimplexRank({ initialRanks: previousRanks }) },
);
```

**There is no way to get `previousRanks` out of `layout()` today.** A
`LayoutResult` carries `nodes`, `edges` and `bounds`, which are coordinates and
not ranks, and no exported function will hand you a ranking another way. So this
option is not one a caller can close the loop on in this release. It is the
shape M3's engine will hand you, and it exists now so that the ranker did not
have to be rebuilt around a warm start after the fact. Passing a ranking you
built yourself works exactly as described below; there is just nothing in this
package that produces one for you.

A supplied ranking is a **hint**, never trusted. It is used as a floor for the
longest-path sweep, which pushes any node the hint put too high back down below
its predecessors, so what the solver actually starts from is feasible whatever
the hint said. Three kinds of entry are dropped outright: an id the graph does
not hold, a value that is not an integer, and a value further from zero than the
graph has nodes, which is wider than any ranking of it needs and would cost the
solver a pivot per unit of nonsense.

So a stale hint cannot make the result infeasible, and cannot make it
non-optimal **as long as the budget holds**. What it can do is change what a run
cut short returns: the hint is the floor the longest-path sweep starts from, so
a hinted run begins at a different feasible ranking from a cold one, and the
"never worse than the ranking it started from" guard compares against *that*
ranking rather than against the cold one. A run that hits its budget can
therefore come back with more total edge length than a cold run stopped at the
same point. With enough budget to converge, all a hint does is choose between
optima, which is the whole point of passing one.

**Dropping is silent, and "every entry was dropped" looks exactly like "the
hint was honoured" from outside.** That is the right behaviour for the case the
option exists for, a stale hint from a previous M3 patch: a thrown error would
turn the normal case into a failure, and a report channel would be a second
return value for something the caller can compute. But it means a warm start
that has quietly stopped working shows up only as the rank churn the option
exists to remove. The check is one line, worth running when a warm start stops
helping:

```ts
const kept = [...previousRanks.keys()].filter((id) => graph.hasNode(id)).length;
```

A `kept` of zero is a hint that did nothing at all. A `kept` far below
`previousRanks.size` is a hint that has drifted from the graph it is being
applied to, which is the state a long-running M3 session drifts into one patch
at a time.

Ranks still come out contiguous from zero per connected component, as the
default stage's do, and both halves of that hold whatever stopped the run.

Gap-freeness comes from the tight tree. This page said until M2.4c that it was a
consequence of optimality (a ranking with an empty rank between two occupied
ones is never optimal, because sliding everything below the gap up by one
shortens every edge that crossed it and breaks none) and therefore that an
exhausted budget could leave a gap. That was wrong. The solver keeps a **tight
spanning tree** of each component, growing it to span whatever the budget is,
since the budget bounds the pivots and not the growth, and every edge of that
tree spans exactly one rank. Any two nodes of a component are therefore joined
by a walk of single-rank steps, which leaves no rank between them empty.

Starting at zero is a construction. Each component is re-based on its own lowest
rank at the very end of the run, after the keep-the-better-ranking restore, and
that runs whatever the budget did.

If you write a rank stage of your own, note that the runner does not require
either property: a ranking with gaps is legal, the order stage sorts the
distinct ranks it finds, and the chain-completeness rule is phrased over the
ranks the layout actually has rather than over the integers between two
endpoints. See [The stage contract](#the-stage-contract).

### Dummy chains

An edge whose endpoints are more than one rank apart is split into a **chain**
of virtual nodes, one per rank strictly between them. `a -> d` alongside
`a -> b -> c -> d` becomes `a -> ? -> ? -> d` through two dummies on ranks 1 and
2, and the router rejoins the three segments into one polyline for `a -> d`.

**Both rank stages do this**, through one shared splitter, as of M2.4c. It was
`longest-path-rank`'s alone when M2.4b built it, which meant that selecting
`network-simplex-rank` bought exactly the drawing this section describes as the
thing to avoid. Nothing here is a property of which ranker you chose.

Nothing downstream of the ranker then meets an edge crossing a layer it has no
node in, which is what lets the crossing counter and the positioner have an
opinion about where a long edge passes through each row. Both read
`virtualChains`, and what they build their adjacency from is the drawing's
**segments** rather than its edges: an edge with a chain contributes one segment
per gap it crosses, an edge without one contributes itself. On the 10k benchmark
corpus that is 214,222 segments where the graph has 40,000 edges, of which only
13,131 joined adjacent layers and were visible at all.

**What that is worth, measured, because it is the whole reason a chain is worth
its cost.** Two layerings of the 10k corpus, both scored over all 214,222
segments: the one the order stage produces reading the chains has 8,586,890
crossings, the one it produces ignoring them has 33,939,378. A 75% cut, and 73%
on the 1k. (Both sides are the order stage at its defaults, so M2.6c's
re-derivation of those moved both; M2.4b measured the pair at 8,748,361 and
33,932,556, a 74% cut and 72%.) The same change takes the default position
stage's total horizontal segment length down 66% on the 10k and 63% on the 1k.
Ignoring the chains never made those crossings go away, it made them invisible:
the long edges were drawn and crossed each other either way, and a stage that
could not see them arranged the layers for the third of the drawing it could.

There is a period in this package's history where that was the state of things.
The ranker split every long edge one milestone and nothing read the chains until
the next, so a dummy was an isolated node in every index downstream: it joined a
layer, took a `nodeSep` gap and a coordinate, and constrained nothing. Any
figure you meet that was measured then is measured over a third of the drawing.

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
throws a `StageContractError` naming the rank stage that called it
(`longest-path-rank` or `network-simplex-rank`: both call the same splitter as
of M2.4c), the colliding id, and the reservation, and telling you to rename your
node. The runner's own
declaration check would catch the same collision one step later and still does
for a third-party ranker that mints ids some other way, so the collision is
reported once rather than twice. There is no claim that a collision is
impossible: what is claimed is that it is a named, actionable error rather than
one of your nodes quietly wearing a dummy's size.

**A dummy has no size**, `{ width: 0, height: 0 }`, matching dagre's plain
long-edge dummy. It is a place a route passes through rather than a thing that
is drawn, and the `nodeSep` on either side of it is what keeps the route clear
of the boxes it runs between. `edgeSep` is deliberately not involved: that is
the gap between two routes running alongside each other, which is the router's
business and not a node's width. M2.8 brought the router and left `edgeSep`
unhonoured; see [What routing does not do yet](#what-routing-does-not-do-yet).

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
of the node boxes and the route points, and a zero-width dummy that lands at the
end of a row sits at that row's right extreme, `nodeSep` clear of the last box
in it. Where in the row a dummy lands is the order stage's decision, so this is
a reachable case rather than the usual one. See [The result](#the-result).

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
the direction for you as of M2.2, in a form that survived M2.8's border
attachment unchanged. See [Route direction](#route-direction).

### Determinism and cost

Both steps of the default stage are O(V + E) in time and space. Cycle breaking
gets there by keeping vertices in degree buckets rather than rescanning what is
left each round, and ranking is a Kahn-style sweep that visits each node and
edge once. A timing figure IS quoted for the default stage, as of M2.9, and it
is a different artefact from the one the gate uses. The repo commits benchmark
medians for the rank stage at 1k and 10k nodes and gates changes against them
locally, and those are RATIOS against a control workload: machine-matched,
comparable only to themselves, the right thing to gate a regression on and the
wrong thing to publish as what the stage will cost you. M2.9 added the other
one, wall clock on a named machine, in
[What a run costs](#what-a-run-costs). The rank stage is 5.2ms on the 1k corpus
and 103ms on the 10k there. Read those as one machine's, and the complexity
above as the claim that travels.

The exception is
[Minimum total edge length](#minimum-total-edge-length-and-what-it-costs), which
quotes several, because a pivot count is not a complexity a reader can size a
budget against. Read those as one machine's measurements of two generated
corpora, taken to justify a default budget and a warning about height. They are
not baselines and they are not machine independent, and neither is
[What a run costs](#what-a-run-costs), which M2.9 added: nothing regresses
against either. The numbers anything is allowed to regress against are the
ratios in `bench/baseline.json`, and they are not quoted on this page because a
ratio against a control workload is not a figure a reader can use.
Both steps are fully deterministic: vertices are numbered in `graph.nodes()`
order, edges are walked in `graph.edges()` order, and a tie is broken by bucket
arrival order, which is itself fixed by the graph's order.
Determinism here is load bearing rather than tidy, for the reason in
[Determinism](#determinism): a ranker that resolved a tie differently on a
re-run would move nodes the user never touched.

`network-simplex-rank` is deterministic in the same way and for the same reason,
and its cost is the one thing about it that is not O(V + E). That cost has two
halves and `maxIterations` bounds only one of them: the pivots are a count and
the budget stops them, while building the first spanning tree is O(E log E) and
runs in full whatever the budget says, so `maxIterations: 0` is not free.
Components are visited in node insertion
order and rooted at their first node, the search for a tree edge to remove walks
a component's nodes in insertion order, and among entering edges of equal slack
the one added to the graph first wins. What is **not** claimed for either stage
is invariance to the order the graph was built in. Cycle breaking is
order-sensitive before ranking starts, and among two optima of equal cost the
simplex returns whichever its tie-breaks reach first, so the same graph
assembled in another order may rank differently. On a graph with a unique
optimum it does not, and that is the claim the tests pin.

## Ordering, and what a crossing is counted between

The default order stage is `barycenter-order`, which M2.6b put there in place of
`insertion-order`, the stage that grouped the roster by rank and left each layer
in graph insertion order. So a run that names no order stage gets crossing
reduction, and naming one is how you turn its budgets:

```ts
import { barycenterOrder, barycenterOrderStage, layout } from '@dagr/layout';

layout({ graph });
layout({ graph }, { order: barycenterOrderStage });
layout({ graph }, { order: barycenterOrder({ maxSweeps: 16 }) });
layout({ graph }, { order: barycenterOrder({ maxTransposePasses: 0 }) });
```

The first two lines do the same thing. It runs barycenter sweeps and then a
transpose refinement pass, and the two budgets above are what you turn:
`maxSweeps` bounds the sweeps, and `maxTransposePasses` bounds the pass, with
zero meaning "do not run it". What that default costs and what it buys is
[below](#what-the-default-order-stage-costs-and-buys). `insertion-order` is not
a stage you can select: it stayed in the package unexported, as the roster-order
reference the ordering evidence is measured against.

### What a crossing is counted between

`countCrossings({ graph, layers })` is the metric, and it is exported because a
number only the stage can compute is a number nobody can hold the stage to.
What it takes is a `Layering`, a graph plus the layers its nodes are drawn in,
named for what it is rather than for this one consumer because the transpose
pass refines one and M3.4's quality report will score one. An `OrderedState`
satisfies it structurally, so a stage author holding one passes it straight in.

Layers are what an order stage returns, so scoring a run means wrapping one: a
`LayoutResult` holds coordinates and not layers, and nothing exported today
turns the first back into the second.

```ts
import { barycenterOrderStage, countCrossings, layout } from '@dagr/layout';
import type { OrderStage } from '@dagr/layout';

const scored: OrderStage = {
  name: 'scored-order',
  run(input) {
    const { graph } = input;
    const output = barycenterOrderStage.run(input);
    console.log('crossings', countCrossings({ graph, layers: output.layers }));
    return output;
  },
};

layout({ graph }, { order: scored });
```

**A crossing is only defined between two segments joining the same pair of
adjacent layers**, and a SEGMENT is a piece of the drawing rather than an edge:
an edge the ranker split into a chain contributes one segment per gap it
crosses, an edge with no chain contributes itself. So the counter and the sweeps
see **every segment of the drawing**, 18,746 on the 1k benchmark corpus and
214,222 on the 10k, and the share they cannot see is zero on any graph without a
self loop. A self loop is the one exception a chain cannot reach: it spans no
rank, so there is nothing to split, and it stays invisible.

That was not always so, and it is worth knowing which era a figure comes from,
because there are three and they differ by more than an order of magnitude.
Before the chains were consumed this stage read the graph's edges, so it saw
only the ones whose endpoints happened to land in adjacent layers: **1,513 of
the 1k's 4,000 (37.8%) and 13,131 of the 10k's 40,000 (32.8%)**, the longest
edge spanning 61 layers and 153. Before M2.2c that pair read 1,324 (33.1%) and
10,528 (26.3%), with the longest edge at 78 layers and 201, because a deeper
acyclic view puts less of the graph between adjacent layers. Both older pairs
are still quoted in places this page points at, including `order.ts`'s seed
table and the M2.5 and M2.6 changelog entries. Its sweep and cap tables were
re-derived over the current population in M2.6c, and the figures they replaced
are kept beside them marked as what they are. **Any crossing count
quoted beside either of them is counted over a smaller population and does not
compare with a count taken today.**

Two segments that share an endpoint touch rather than cross, and two parallel
edges lie on top of each other. Direction is not consulted: an edge the ranker
reversed still joins the same two layers. The counter is Barth, Junger and
Mutzel's accumulator tree, O(E log V) rather than the O(E^2) of comparing every
pair, and the test suite checks it against a brute-force pair loop on random
layerings as well as against hand counts on small graphs.

### The seed permutation, which M3.6 warm starts from

Barycenter sweeps are sensitive to where they start, so the starting
permutation is a decision and it is recorded here rather than left to be
inferred from a stage that will not exist by M3.6.

**The seed is a connected depth-first walk over adjacent-layer edges.** The
roster is iterated in its own order (the graph's nodes in insertion order, then
any virtual ids in id order), and each node it reaches that has not been seen
starts a walk that may only step along an edge whose two endpoints sit in
adjacent layers, in either direction. Every node is appended to its own layer
the first time it is visited, neighbours are taken in `outEdges` order and then
`inEdges` order, and a node no such edge reaches is appended when the outer loop
arrives at it. It is not the roster order `insertion-order` lays out.

Measured on the benchmark corpora, adjacent-layer crossings after 8 sweeps,
lower is better. **Every count in this table and the two below it was taken over
the pre-M2.2c acyclic view AND before the chains were consumed**, when the
counter saw 10,528 of the 10k's 40,000 edges rather than today's 214,222
segments. They are kept because they are the measurement that chose the seed,
which is a comparison between three columns at one moment and is unaffected by
the level moving under all three. Do not read any of them as a level: the
shipping figure is pinned in `test/layout.order.test.ts`, and this stage reaches
**8,586,890** crossings on the 10k at its own defaults, over a population
twenty times larger than the one these were counted on. (Twenty against these,
sixteen against the 13,131 the counter saw after M2.2c and before the chains
were consumed. Which of the two you want depends on which era you are comparing
with, and this page quotes both.)

| seed | 1k crossings | 10k crossings |
| --- | --- | --- |
| roster order (`insertion-order`'s) | 3,943 | 54,744 |
| walk over adjacent-layer edges | 3,605 | 35,114 |
| walk over all edges | 3,459 | 38,152 |

and before any sweep runs: the adjacent-layer walk 7,933 and 94,991, the
all-edges walk 9,722 and 191,023. Roster order's pair is the before column of
the trade below, quoted there rather than twice.

The adjacent-layer walk is chosen over the all-edges walk for two reasons. It
wins the 10k by 8.0% and loses the 1k by 4.2%, and the 10k is the corpus every
later milestone commits against. And the two rules coincide once the long edges
are split, which M2.4b has since done, so choosing this one was choosing the
behaviour the stage has anyway rather than one that changes character under it.

The hypothesis that lost is worth recording. The all-edges walk was expected to
win, on the theory that the seed is the only place a long edge can influence
this stage at all, since neither the sweeps nor the counter can see one. It
loses: a start built from edges the sweeps cannot see is worth less than one
built from the edges they can.

### The sweep budget

A downward sweep fixes layer `i` and reorders layer `i + 1` from the neighbours
above it; an upward sweep is the mirror image. They alternate, starting
downward. A node is placed by the barycenter of its neighbours' positions in the
fixed layer, ties broken by their median, and a node both keys tie on keeps its
position relative to the other; a node with no neighbour in the fixed layer
keeps its index and the rest sort into the indices left over.

The layering is scored after every sweep and **the best one seen is what comes
back**, not the last one, because the sweeps are not monotone. That is what
makes a larger `maxSweeps` a weakly better answer rather than a different one.

Crossings by budget on the same two corpora, from the seed above, over every
segment of the drawing and with the transpose pass off:

| sweeps | 1k crossings | 10k crossings |
| --- | --- | --- |
| 0 (the seed) | 456,261 | 19,753,239 |
| 1 | 215,975 | 8,972,421 |
| 2 | 215,975 | 8,972,421 |
| 3 | 210,163 | 8,972,421 |
| 4 (the default) | 210,163 | 8,972,421 |
| 8 | 210,163 | 8,972,421 |
| 16 | 210,163 | 8,972,421 |

**The 10k is at its floor after one sweep and the 1k after three**, and not
merely at an equal-scoring layering: the best seen is found early and never
beaten, so the layers that come back at 4 are the layers that come back at 16.
Sweeps 5 through 8 buy nothing on either corpus, which is what the budget of 8
that shipped until M2.6c was spending.

`maxSweeps` defaults to **4**. Four rather than three because both floors are
inside it and the sweeps alternate down and up, so an even budget is whole
rounds; not two, because the 1k is 2.8% above its floor there; and not one,
because the golden regression corpus is a different shape from the bench pair
and `wide-600` loses 9.7% at one sweep, 246,749 against the 224,924 it reaches
at four, and 8.4% at two. That corpus is also why the cut is
paired with a larger transpose cap rather than simply taken: five of its six
graphs are still improving at 8 sweeps, by 1.35% to 3.48%. Those sweeps are not
worthless everywhere. They are worth less than the same milliseconds spent in
the transpose pass, which is the trade the next section measures.

`maxSweeps` bounds the sweeps and
nothing else, the way `maxIterations` bounds pivots only. Zero is legal and
means "seed only". Unlike `maxIterations` it does not take
`Number.POSITIVE_INFINITY`: these sweeps have no optimality condition to
converge to, so "as many as it takes" has nothing to mean. A non-integer or
negative budget is an `InvalidConfigError` naming the field, thrown at the call
that builds the stage rather than at the run.

**The table this replaces**, kept here rather than pointed at, because this
page is the only copy of it outside `order.ts`. It was taken before M2.4b's
chains were consumed, when the counter saw a quarter of the edges:

| sweeps | 1k crossings | 10k crossings | 10k cost |
| --- | --- | --- | --- |
| 0 (the seed) | 7,933 | 94,991 | 5.5ms |
| 2 | 4,619 | 50,735 | 9.5ms |
| 4 | 3,880 | 40,217 | 13.5ms |
| 8 (the default then) | 3,605 | 35,114 | 21ms |
| 16 | 3,467 | 32,503 | 38ms |

The shape is the difference worth seeing: that curve was still falling at 16
and the one above is flat from three sweeps.

Every timing on this page is one machine's, taken to justify a default rather
than to tell you what the stage will cost you, exactly as the figures under
[Minimum total edge length](#minimum-total-edge-length-and-what-it-costs) are.
The committed benchmark medians are the only numbers anything regresses
against.

Two consecutive down-and-up rounds that lower the best seen by nothing end the
run. It takes two rather than one because the rule is a heuristic and not a
fixed point: what carries into the next round is the last layering, not the best
one, so a round that improved nothing is not proof that the next one will not.
Stopping on the first such round is what the two-round rule was measured
against: it cost quality on 32 of 200 random layered graphs at a budget of 8,
worst 1,055 crossings against 893, and took the 1k at a budget of 16 to
3,532 where running all 16 reaches 3,467. The rule that ships recovers all of
that, so every number in the table above is what running the budget out gives,
on both corpora and at both budgets.

`initialOrder` is a previous run's layers, handed back so a re-layout does not
churn an ordering somebody has already read. It is a hint and never a
permutation taken on trust, exactly as `initialRanks` is on the simplex ranker.
Each id takes its index **within its own hint layer**, and each layer of the
seed is reordered by reading the nodes the hint names out of the indices they
hold, sorting those by that index, and writing them back into the same indices.
So a node the hint does not name keeps the index the walk gave it, which is the
same rule the sweeps follow for a node the fixed layer says nothing about, and
two ids the hint listed in different layers tie when they meet in one layer
here, with the tie falling through to the walk. An id the roster does not hold
is ignored, an id the hint puts in the wrong layer only ever contributes its
position among the ids of its own hint layer that landed in the same real layer,
and a hint that mentions nothing leaves the seed exactly as the walk computed
it. Nothing it can say produces an invalid layering.

Keying within the hint layer is also what M3.6 needs of a warm start: the key is
node identity and never `(rank, index)` position, so a node whose rank changed
arrives at its new layer as a newcomer rather than carrying a stale slot to the
front or the back of it.

The stage is deterministic in the same way the rankers are: same graph, same
layers, always. Every tie in the walk is edge insertion order, and every tie in
a sort key leaves the nodes in the order they already sat in, because the nodes
to sort are collected in index order and JavaScript's sort is stable.

### The transpose pass

When the sweeps stop, one transpose refinement pass runs over the layering they
settled on. It walks every layer left to right and swaps each adjacent pair
when the swap costs nothing or saves something, repeating until a walk finds no
strictly improving swap or `maxTransposePasses` is spent. At the budgets that
ship it removes **4.30%** of the crossings the sweeps leave on the 10k corpus,
8,972,421 down to 8,586,890, and **11.96%** on the 1k.

**Both the cap and the sweep budget were re-derived in M2.6c and both moved**,
the sweeps from 8 to 4 and the cap from 8 to 16. Before that they were 8 and 8,
a coincidence this page said was a coincidence, and at 8 the pass removed 2.5%
on the 10k where it had removed 13.7% over the drawing it was tuned against.
That collapse was predicted here, from a hand-expanded corpus, at "1.4% at a cap
of 4", and a cap of 4 measures 1.38%, so the prediction was right to two
figures. What the re-derivation then found is that the collapse had taken the
knee with it, and the section on the cap below is the new argument.

**It runs once, at the end, on the best layering the sweeps saw**, not inside
them. The alternatives were measured at a sweep budget of 8 on the 10k: once at
the end reaches 32,677 crossings, after every full round 32,798, and after
every sweep 32,854, so the cheapest placement is also the best one, and it is
cheapest by a wide margin (30.1ms against 48.6ms and 125.5ms in the prototype
the three were compared in). Those three are from before ties were allowed and
from before the chains were counted, which is why none of them is anywhere near
the 8,586,890 this stage now reaches; what they compare is the placements
against each other, and the placement they chose is unchanged.

**The swap delta is exact.** For an adjacent pair, the only crossings that can
change are the ones in the gap above and the gap below involving edges incident
to the two nodes, because every other segment keeps both its endpoints where
they were. Taking one neighbour of each in the fixed layer, that pair of
segments crosses now exactly when the first is to the right of the second and
crosses after the swap exactly when it is to the left, so the side contributes
the count of one minus the count of the other, and the two sides sum. A swap
decision is therefore O(deg v * deg w) rather than the O(E log V) of rescoring
the drawing, and the test suite holds the claim to being exact by running the
pass against a transpose that decides every swap by a full rescore.

**A swap worth exactly zero is taken.** That contradicts the obvious prior, and
it is measured rather than reasoned. A plateau of equal-scoring permutations is
something to walk across to reach a better one, not a wall. What keeps that from
churning the drawing for nothing is the stage's existing rule: the transposed
layering is scored and taken only if it is strictly better, so a reordering that
bought nothing does not reach the output.

The rule was re-derived in M2.6d, over the drawing the stage orders now and at
the budgets it ships, both rules starting from the layering the sweeps settle
on:

| corpus | sweeps only | strict, cap 16 | ties, cap 16 | ties lower by |
| --- | --- | --- | --- | --- |
| 1k | 210,163 | 207,110 | 185,028 | 10.66% |
| 10k | 8,972,421 | 8,921,937 | 8,586,890 | 3.76% |
| tall-600 | 31,572 | 30,309 | 25,210 | 16.82% |
| wide-600 | 224,924 | 222,653 | 207,140 | 6.97% |
| dense-1200 | 931,903 | 927,135 | 878,459 | 5.25% |
| sparse-2000 | 47,393 | 44,592 | 39,969 | 10.37% |
| self-loops-800 | 127,837 | 125,408 | 112,709 | 10.13% |
| parallel-800 | 144,451 | 141,083 | 126,710 | 10.19% |

The first two are the benchmark corpora and the other six are the golden
regression corpus. Every row is asserted in the test suite rather than only
written down here, which matters because a milestone that changes the LAYERING
moves all eight of them at once.

This paragraph used to say the next milestone to change the drawing would move
them, and M2.8 changed the drawing and moved none. A crossing count is counted
over the layers the order stage produces; routing is downstream of positions,
which are downstream of order. A milestone that only changes the route stage
cannot reach these rows, and neither can one that only changes the position
stage.

**The margin is not the finding.** The strict rule captures about an eighth of
what the pass is worth, 12.1% of it on the 1k and 13.1% on the 10k, so a pass
that may not cross a plateau is not a weaker version of this one, it is a
different and much smaller thing.

The comparison has to say whether it is at equal cap or at equal time, because
the two rules terminate differently: a zero-delta swap leaves one available, so
the strict rule runs out of improving swaps far sooner. Both readings agree
here. Neither rule terminates before 16 passes on either corpus, so equal cap is
equal pass count, and a strict pass is if anything the cheaper of the two. Run to
its own fixed point instead, the strict rule stops after 35 passes on the 1k and
207 on the 10k, at 207,068 and 8,914,087, which is still above what the tie rule
reaches in 16 and costs 1.35x and about 4.7x the whole stage. Those passes are a
long grind for very little: strict is within 0.2% of its own fixed point after
four passes on both corpora. There is no budget at which refusing ties is the
better answer.

Until M2.6d this page said the rule "wins all six configurations it was tested
in, by between 2.7% and 13.5%, and on the 10k run to a fixed point it reaches
29,260 crossings against 32,677 for the strict rule". That is kept here as the
record of a conclusion reached on a drawing that no longer exists. Those six
configurations were sweep budgets and caps the stage no longer uses, measured
before M2.2c when the crossing counter saw 10,528 of the 10k's 40,000 edges
against today's 214,222 segments, so no figure in that sentence compares with
one in the table above.

**The loop ends on a pass with no strictly improving swap**, and that is a
constraint rather than a detail. A zero-delta swap leaves a zero-delta swap
available, so a loop that continued whenever anything moved would swap one pair
back and forth forever. Two nodes sharing a single neighbour are enough to
produce it, which is to say every fan-in and every fan-out is enough. It takes
both the tie rule and the wrong gate to hang, so the test suite pins both
halves on a three-node witness: the shipping gate stops after one pass, and an
any-swap gate runs a clean period-2 cycle for as long as it is allowed to.

`maxTransposePasses` defaults to **16**, and defaulted to 8 until M2.6c.
Measured at the shipping sweep budget of 4 on the 10k, against 8,972,421
crossings with the pass off:

| cap | 10k crossings | saving | extra time | per pass | per ms |
| --- | --- | --- | --- | --- | --- |
| 4 | 8,848,414 | 1.38% | +81.43ms | 31,002 | 2,230 |
| 8 | 8,748,361 | 2.50% | +131.09ms | 25,013 | 1,800 |
| 12 | 8,663,589 | 3.44% | +197.71ms | 21,193 | 1,525 |
| 16 (the default) | 8,586,890 | 4.30% | +235.72ms | 19,175 | 1,379 |
| 24 | 8,453,276 | 5.79% | +345.24ms | 16,702 | 1,202 |
| 32 | 8,344,656 | 7.00% | +454.17ms | 13,578 | 977 |
| 48 | 8,175,278 | 8.88% | +685.73ms | 10,586 | 762 |
| fixed point (675 passes) | 7,637,257 | 14.88% | +9.4sec (modelled) | 858 | 62 |

Two of those columns cannot be measured the same way. Extra time is the whole
stage at that cap minus the whole stage with the pass off, min of 8 interleaved
runs. `per pass` is marginal and exact, the crossings a row buys over the row
above it divided by the passes in the step, and needs no timing at all. `per ms`
is `per pass` divided by 13.9ms, the measured cost of one pass, rather than by
the step's own extra time: the steps are 38ms to 232ms apart and their timings
do not resolve their own differences. Turning the pass on also costs a one-off
26ms on the 10k to build its index, which is why the cap-4 row costs more than
four passes, and the fixed point's time is the only modelled figure here, 26ms
plus 675 passes.

**There is no knee on this curve.** The rate falls by a fifth per doubling
early and a third by the end (19.3% from 4 to 8, 23.3% from 8 to 16, 29.2% from
16 to 32, 36.6% from 24 to 48), smoothly and with no step, and it keeps going:
the fixed
point is 675 passes away and the last 627 of them still average 858 crossings
each. The table this replaces had the rate falling by more than half
immediately past 8, threefold past 4, and by at least half at every step
after. That knee was real, and it was a property of a drawing in which a long
edge was invisible to the counter.

**So 16 is bought against the sweeps rather than against this curve**, which is
why the two budgets stopped being equal. A sweep costs 5 to 6 passes of this
pass's time on both corpora, 5.38ms against 1.11ms on the 1k and 78ms against
13.9ms on the 10k. The sweep table above shows sweeps 5 through 8
buying nothing on either bench corpus and 1.35% to 3.48% on the golden corpus;
the same milliseconds here buy 4.30% and 11.96%. So four sweeps come off and the
cap goes up, and the pair that ships beats the 8 and 8 it replaces on both axes
everywhere it was measured: 1.85% and 4.77% fewer crossings on the 10k and the
1k, all six golden graphs lower, and the stage faster on both. How much faster
is the figure to distrust first, being a difference of two timings: min of 8
interleaved runs gives 670.38ms against 729.60ms on the 10k and 48.89ms against
61.95ms on the 1k, so 8.1% and 21.1%, with the component costs predicting 6.1%
and 20.4% and three earlier runs on a busier machine reading 4.0%, 7.1% and 7.7%
on the 10k. Take 4% to 8% as the honest 10k range and 21% as the 1k.

**Sixteen and not more** because it is the last cap in the table that leaves the
whole stage faster than the pair it replaces on both corpora. A cap of 24 makes
the 10k slower than it was, for a further 1.5%. Break-even is a cap of about 19
on the 10k, where cutting the budget from 8 to 4 saves a measured 151.46ms
against 13.9ms a pass, and about 28 on the 1k. That 151.46ms is about two sweeps
at 78ms and not four, because the two-round stop already clips a budget of 8 to
six on this corpus; reading it as four would put break-even at 30. Sixteen is
inside both, so the pair is an improvement on either axis read alone rather
than a trade that has to be argued. This is a budget rather than a knee and it
is stated as one.

The 1k agrees without deciding anything: 185,028 against 210,163 for +19.27ms,
its own fixed point 162,662 after 187 passes. Sixteen captures 28.9% of the
fixed point's saving on the 10k and 52.9% on the 1k, for 2.5% and 9.2% of its
time. Those timings are one machine's, like every other timing on this page.

A larger cap is a weakly better answer and never a different one, for the same
reason a larger `maxSweeps` is: the deltas are exact and only non-increasing
swaps are taken, so a pass cannot raise the count. `maxTransposePasses` takes
the same rule as `maxSweeps`, including rejecting `Number.POSITIVE_INFINITY`,
and a non-integer or negative value is an `InvalidConfigError` naming the
field, thrown at the call that builds the stage.

**The cap table this replaces**, kept whole and marked rather than summarised,
because the argument above is partly an argument about its SHAPE and the
marginal column is the only evidence for that. It was measured at a sweep budget
of 8 on a graph where the counter saw about a quarter of the edges, against
35,114 crossings and 16.32ms with the pass off:

| cap | 10k crossings | saving | extra time | crossings per ms |
| --- | --- | --- | --- | --- |
| 4 | 31,369 | 10.7% | +2.65ms | 1,413 |
| 6 | 30,677 | 12.6% | +4.15ms | 461 |
| 8 (the default then) | 30,318 | 13.7% | +4.93ms | 460 |
| 12 | 29,892 | 14.9% | +6.92ms | 214 |
| 16 | 29,658 | 15.5% | +9.29ms | 99 |
| 32 | 29,358 | 16.4% | +16.91ms | 39 |
| fixed point (60 passes) | 29,260 | 16.7% | +30.61ms | 7 |

with the 1k reaching 3,005 against 3,605 for +0.41ms and its own fixed point at
2,959 after 19 passes. Eight captured 81.9% of the full saving for 16.1% of the
extra time, and the rate held at or above 460 up to 8, fell to 214 immediately
past it, then by at least half at every further step. That is the knee. Compare
the last column with the one above it, which falls by a fifth per doubling
early and a third by the end, and never stops.

What this table got right is the prediction it carried: it forecast, from a
hand-expanded corpus, that the saving would collapse to "1.4% at a cap of 4"
once every edge became visible. A cap of 4 measures 1.38%.

**Two things on that old table did not survive the re-derivation**, and both had
been written here as settled. The knee, above. And the fixed point: 60 passes on
the 10k and 19 on the 1k became 675 and 187, so a cap of 200, once described as
far beyond what either corpus needs, stops the 10k two thirds of the way.

**The tie rule was owed one too, and M2.6d paid it.** It had been chosen on the
same pre-chain drawing as the cap, and M2.6c re-ran neither the configurations
nor the population. The strict-versus-ties comparison is now re-run at 4 and 16,
on both corpora and all six golden graphs, and the rule is unchanged: the table
is under "a swap worth exactly zero is taken" above. Nothing in this section
moved as a result, because keeping a rule changes no count.

The crossing counts the stage reaches on a fixed set of generated graphs, with
the pass on and off, are committed as a golden file at
`packages/layout/test/order-crossings.golden.json` and asserted exactly. The
test file beside it says how to regenerate it and when doing so is legitimate.

### What the default order stage costs and buys

M2.6b pointed the order default at this stage, so the trade below is what a run
that names no order stage now makes. All four figures behind it were re-derived
in M2.6c, over the drawing the pipeline actually lays out now that M2.4b's
chains are in it.

Ordering is the expensive half of it: on
the 10k benchmark corpus the full default pipeline is roughly 2.5x slower than
it is with roster order, and the drawing that comes back has 75.1% fewer
crossings. On the 1k it is roughly 3.0x slower for 73.7% fewer. Those ratios are
not comparable with the 1.8x and 92.9% this paragraph used to give: both halves
of both numbers moved when the chains were consumed, the pipeline placing
184,222 nodes on the 10k rather than 10,000 and the counter seeing 214,222
segments rather than 13,131. The fall from 92.9% to 75.1% is the population
growing, not the stage getting worse; scored like for like, the layering that
reads the chains has 74.7% fewer crossings than one that ignores them.
Both slowdowns are against a pipeline whose position stage is still a
placeholder, so the multiple moves again when that default changes, M2.7 having
added a real position stage without taking the default; it is not a claim about
crossing reduction in general. M2.8 replaced the route placeholder without
moving either multiple far enough to see: what a border attachment costs is
arithmetic per edge, both columns pay it, and both pipeline benchmarks came back
inside their own drift.

The four figures behind those two sentences, two timings and two crossing
counts, are stated once and in one place: the last section of
`barycenterOrder`'s docstring in `packages/layout/src/order.ts`. They are quoted
nowhere else as live advice, because every one of them expires, the timings on
the next benchmark recapture. This sentence used to add "and all four on M2.8's
routing landing", which was wrong twice over and is corrected there rather than
only here: a crossing count is of the layering the order stage produces, and
routing is downstream of positions which are downstream of order, so no route
change can reach it. The
package changelog is
the exception, and deliberately: a dated entry records what a past change
measured, so it keeps its own copies and is marked superseded in place rather
than swept.

None of that changes how a stage is exported, which is the precedent M2.3 set
with `network-simplex-rank` and this stage kept: it was exported by name for two
milestones before it took the default, and its name did not change when it did.
`insertion-order` went the other way, staying in the package unexported once it
stopped being the default, because the ordering tests still measure against the
roster order it produces.

## Routing, and where a route attaches

`polyline-route` gives every edge one polyline: out of the source box's border,
through the centre of each dummy on the edge's [chain](#dummy-chains), and into
the target box's border. An edge with no chain comes back as those two
attachments and nothing else.

**What M2.8 changed was the two ends, and nothing between them.** The polyline
through dummy coordinates is M2.4b's, not M2.8's: the router it replaced already
walked the chains and emitted a point per dummy. What a route used to do was
start and finish at the endpoint CENTRES, inside the boxes, where an arrowhead
drawn at the last point is drawn underneath the target. Two nodes stacked at the
defaults, 100 by 40 boxes with a `rankSep` of 50, used to come back as
`[{0, 20}, {0, 110}]`, the two centres, and now come back as `[{0, 40},
{0, 90}]`, the 50 units of clear air between them. Every interior point is
unchanged, exactly, because a dummy's coordinate is the order and position
stages' decision and never the router's.

Across the two benchmark corpora, the six golden graphs and one of those six
again at box widths from 10 to 2010, that takes between 0.6% and 5.9% off the
total length of the drawing's polylines, and every unit of it was ink drawn
underneath a node box. The spread is the interesting half: the saving is at most
half a box diagonal per end, 53.85 at the default box, so a drawing of long thin
rows saves a smaller share of a much larger number.

**Where the attachment lands.** Walking from the centre toward the next point on
the route, the box's half width is reached at one fraction of the way and its
half height at another, and the border is whichever comes first, so a steep
route leaves through the bottom edge and a flat one through a side. A node with
no size attaches at its own centre, having no border to leave from.

**An attachment is held back by two caps, and they bound different distances.**
It may not travel more than half of the segment it is walking along: both ends
of a route with no bend in it slide along the same segment, one from each end,
so a box wider than the gap to its neighbour could otherwise push its
attachment past the other one and hand back a polyline that runs backwards. And
it may not travel more than half the way to the edge's other ENDPOINT, which on
a chained edge is a different distance, because the next point it walks toward
is a dummy while [the runner's direction check](#route-direction) compares the
result against the far node.

At the default box size neither binds. They bind where a box is large against
the gap it has to cross, which `rankSep: 0` reaches and so does an ordinary
graph with one wide node in it.

### Monotone in the rank axis

**Reading a route's points from source to target, `y` never moves against the
direction the route runs as a whole.** Writing `d` for the sign of the last
point's `y` minus the first's, every consecutive pair steps by `d` or by zero.

The rule is weak, so a pair of points at one `y` is a flat step and not a
backtrack, which is what lets a self loop satisfy it rather than be excused from
it. And it is stated over the direction you authored the edge in, which is the
direction [`points` runs](#route-direction). That costs nothing precisely
because the rule names no sign of its own: an edge the ranker reversed comes
back as a route that climbs the page, and it is monotone climbing.

The router does not create this property. `y` is the position stage's answer:
layers run in strictly increasing rank order, both position stages in the
package give a layer one shared `y`, and a chain holds one node at every rank
between its endpoints, so the points are monotone before the router sees them.
What the router promises is that it introduces no reversal its input did not
have, which is what the two caps above buy. The runner does not check it,
for the reason [the stage contract](#the-stage-contract) gives.

### What routing does not do yet

**`edgeSep` is carried and not honoured.** It is the gap between two routes
running alongside each other, and the cases it governs are the ones where two
routes coincide exactly rather than merely run close. A self loop gets two
identical points at its node's centre, having no direction to attach along and
so no border to land on. Two parallel edges get identical polylines when neither
has a chain, which is to say when they span one rank: same endpoints, no bend,
nothing but their ids to tell them apart. Over a longer span they come apart on
their own, because the ranker mints each its own dummy and the order stage
places those dummies at their own spots in the layer, so a long parallel pair is
separated already by `nodeSep` and by a stage that was not trying to. All three
cases are pinned in the test suite as they stand, so the milestone that fans
them out has a before to measure against. Fanning them out needs a rule this
package has not chosen, and for a loop it needs a height, and a loop that bulges
vertically is the one shape here that would need an exception carved into the
monotone rule above.

**Obstacle detours and splines are not here either.** A route goes where its
dummies are and takes no notice of a box in the way, and every segment is
straight. `bounds` already carries the formulation detours need, the hull of the
node boxes and the route points, so that is one thing that milestone will not
also have to change.

**A collinear chain is not collapsed.** A router may legitimately emit two
points for a chain whose dummies all fell on one line, which is what a good
positioner produces; this one keeps every bend it was given.

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
That is also how this project ships: M2.2 replaced the ranker, M2.5 and M2.6b
replaced the orderer, and M2.7 added a positioner beside the placeholder rather
than over it, each against a runner and a test suite that already work. The
override object has a name of its own, `LayoutStageOverrides`, for when you
build one separately from the call.

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

**Every stage you choose between is exported by name; no placeholder is.** That
is the whole rule, and it is why `longestPathRankStage`,
`networkSimplexRankStage`, `barycenterOrderStage` and `polylineRouteStage` are
all importable while the one placeholder left in `stages.ts` is reachable only
through `defaultStages`. A placeholder's name is a name to delete tomorrow. An
algorithm's name is how a caller says which objective it wants: the two rankers
answer different questions, and "the default one" does not identify either,
because which one is default can change and neither is chosen for being it. See
[Minimum total edge length](#minimum-total-edge-length-and-what-it-costs) for
which is which. `order` gained its name that way in M2.5 and its default in
M2.6b, without the name changing in between, and `route` followed the same way
in M2.8, where `polylineRouteStage` replaced the unexported `straight-route` and
was exported on arrival. Two stages in the package have no public name for a
reason that is not placeholder-ness: `insertion-order`, kept because the
ordering tests measure against it, and `brandes-koepf-position`, which M2.7
implemented and left
unexported because there is no run today that should choose it, for
[the reason below](#what-is-not-here-yet).

Going through `defaultStages.position` is still the right way to WRAP a default,
though, and that is what the example above does. It keeps the wrapper working
when the position default changes, which importing a stage by name would not:
M2.2 already changed what `defaultStages.rank` points at and M2.6b changed
`defaultStages.order`, and no wrapper written this way noticed either.

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
  changes size and nothing downstream notices. The default ranker mints dummy
  ids from edge ids as of M2.4b, so a graph whose node ids look like that
  pattern lands here, though that stage gets there first with a message about
  its reserved `#dummy:` namespace, which leaves this one catching a
  third-party ranker;
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
  belongs to no chain. Being phrased over the ranks the layout has, it is a
  property of the whole ranking rather than of one edge, which is what the
  paragraph on completeness in [The roster](#the-roster) is about;
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
  stage minted them. It stopped being a check on copied numbers in M2.8: an
  attachment divides by the distance to the next point, so a position stage
  handing back an infinity arrives here as a `NaN`;
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
produces, and a polyline router may then legitimately collapse it back to two
points. M2.8's router does not collapse anything, and the allowance stands for
the one that might. That is the same argument
[route direction](#route-direction) makes about proximity against equality. A
rule that would have to be withdrawn a milestone later is worse than one never
claimed.

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
is the wrong one: M2.8 attached routes at box borders, and obstacle detours will
move them again, so an equality check would have had to be relaxed a milestone
later, and a contract that loses rules is worse than one that never claimed
them. The first half of that has happened and proximity survived it untouched,
because a route that leaves its source's border and arrives at its target's is
still nearer its own node at each end. The comparison is not strict, so a self
loop passes: both of its ends are the same node and every distance in the
comparison is equal.

**What is still not checked is the shape between the endpoints.** A route may
wander anywhere it likes on the way, and the runner has no opinion about it. Nor
does it check that a polyline is monotone in the rank axis, which the default
router does produce and which no rule here demands. That is deliberate: the
property belongs to the position stage and the router jointly, since `y` is the
position stage's answer, and a caller may supply a position stage that stacks
ranks any way it likes.

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
| `edgeSep` | `10` | Minimum gap between two edge routes running alongside each other. Carried through the pipeline and not yet honoured by any stage; see [What routing does not do yet](#what-routing-does-not-do-yet). |
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
rather than the common case. It is also what obstacle detours will need, so
nothing here changes again when they arrive. M2.8's border attachment did not
exercise it either way: an attachment lands ON a box the hull already contains,
so only a bend can ever grow the bounds. A layout with no chain in it has
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
| `InvalidConfigError` | `INVALID_CONFIG` | A number a caller supplied is not one the pipeline can use. Two kinds reach it. A separation or a size that is not finite and zero or greater, which reads `Invalid layout config:` and carries `field` as a path such as `nodeSize("n1").width`. And an option a stage factory validates, which reads `Invalid layout option:` and names the option, `maxIterations` being the only one today. Both carry the offending `value`. |
| `StageContractError` | `STAGE_CONTRACT` | A stage broke one of the rules in [The stage contract](#the-stage-contract). Carries the offending stage's `name`, the `id` it dropped, and a `detail`. One check is about the layers rather than one id, and uses a plain label instead: `layer 3`. The `graph` label is gone as of M2.4a, along with the check that raised it. |
| `InternalLayoutError` | `INTERNAL` | The pipeline caught itself breaking one of its own invariants. Carries a `detail`. Always a bug in `@dagr/layout`, never in your graph, your config, or a stage you supplied, which is why it is not a `StageContractError`: that class names a stage, and naming one here would blame whoever was plugged in. Nothing to fix on your side. Please report it. |

The three sort by whose bug it is, which is the only question a caller catching
one has to answer: fix the input, fix the stage, or file the bug.

```ts
import { DagrLayoutError, layout } from '@dagr/layout';

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

## What a run costs

Wall-clock milliseconds for one `layout()` call at the defaults, on the two
committed benchmark corpora, measured on an Apple M1 Pro under Node 23.11 at a
one-minute load average of 3.2. Each figure is the median of eleven runs after
three warmups, and the load is quoted because an absolute timing taken on a busy
machine is not worth much and a reader has no other way to tell.

| Phase | 1k nodes, 4k edges | 10k nodes, 40k edges |
| --- | --- | --- |
| `longest-path-rank` | 5.2ms | 103ms |
| `barycenter-order` | 50.9ms | 685ms |
| `grid-position` | 2.6ms | 35.5ms |
| `polyline-route` | 1.9ms | 47.4ms |
| stage contract checks | 15.8ms | 291ms |
| **whole call** | **76.4ms** | **1,162ms** |

**These are a measurement and not a baseline.** Nothing gates on them, `pnpm
bench:ci` never reads them, and a number moving here fails no build. The gate
lives in `bench/baseline.json` and holds ratios against a control workload,
which is what lets it survive a busy machine and what makes it useless as a cost
figure. The two artefacts answer different questions and neither can be derived
from the other.

Read the shape rather than the milliseconds. The order stage is 67% of the 1k
run and 59% of the 10k, which is where an optimisation is worth having and where
one is not. The whole call is 15.2x the 1k for 10x the nodes, while the drawing
it produces is 11.2x the size in route points, so the cost tracks the drawing
rather than the graph. And the contract checks are 21% of the 1k and 25% of the
10k: that is the price of the guarantees on this page, it is paid on every run,
and it is stated rather than folded into the stage rows because a reader sizing
a budget is paying it too.

Two caveats that are not hedges. The position phase is still a placeholder, so
its row is a floor and not a cost, and the milestone that replaces it moves that
row and no other. And the 10k corpus has 40,000 edges that become 174,222 dummy
nodes on the way through, so the stages are sized by the drawing rather than by
the graph. See [Dummy chains](#dummy-chains).

Regenerate them on your own machine with:

```
MEASURE_COST=1 pnpm --filter @dagr/layout test layout.cost
```

The corpora are committed generators rather than committed results, which is
what makes that possible. The numbers land in
`packages/layout/test/layout-cost.json` with your machine and your load average
recorded beside them.

## What it draws against dagre

Dagr is a dagre successor, so what it draws is compared against what dagre
draws, on nine hand-authored graphs shaped after real ones, at box sizes that
are not all the same. The corpus, the metrics and the committed numbers are in
`packages/layout/test/`, against an exactly pinned `@dagrejs/dagre` 3.1.1.

**Neither engine is the reference.** dagre is not a specification and this
package is not trying to reproduce it: different cycle breaker, different
default ranker, different position stage, different routing style. So the point
of the comparison is not agreement. It is to separate the differences that are
choices from the differences that are this package being worse at something a
well-known implementation does well, which means every metric gets a verdict
before it gets a number.

| Measure | This package | dagre | Read it as |
| --- | --- | --- | --- |
| Crossings between node centres | 147 | 109 | **dagre wins, by 35%** |
| Crossings between drawn polylines | 51 | 98 | Routing style, not quality |
| Layers | 64 | 68 | Equal on eight of nine graphs |
| Total polyline length | 157,177 | 156,783 | Level |
| Total drawing width | 21,778 | 23,683 | 8% narrower |
| Overlapping node boxes | 0 | 0 | |
| Non-finite coordinates | 0 | 1 | A dagre defect, below |

**The first two rows disagree, and the first one is the one to believe.**
Counting crossings between the drawn polylines says this package has half
dagre's, and reading that as better layout would be wrong. dagre halves its rank
separation and doubles every edge's minimum length to leave room for an edge
label, so every edge picks up a bend in every rank gap: 1,015 segments and 774
bends across this corpus against 525 and 284 here. More elbows sweep more ink
and cross more things, and none of that is about where the nodes went.

The first row throws the routes away entirely and counts crossings between the
straight lines joining the endpoint node centres, which is a function of the
node positions and the topology alone. There this package is 147 against dagre's
109, **thirty-five percent worse**, and that is the number to read. It is the
one measure in the table dagre wins and it is the most important one, because
keeping two edges from crossing between two nodes is what a layout engine is
for.

**The cause is the position placeholder and the same corpus proves it.** Run the
identical pipeline with `brandes-koepf-position` in place of `grid-position` and
the count falls from 147 to 96, which is 0.88x dagre rather than 1.35x. The
order stage is not what is losing here; the phase that has never had a real
algorithm is. See [What is not here yet](#what-is-not-here-yet).

Where this package wins outright is depth. On the cyclic graph in the corpus it
produces 6 layers against dagre's 10, which is the least-squares feedback arc
set described in [Ranking](#ranking-and-what-it-does-with-a-cycle) against
dagre's greedy one. A shallower acyclic view is the thing that ranker was chosen
for.

One graph is a known gap rather than a comparison: `scattered-suite`, five
disconnected components, where this package draws 2.49x dagre's polyline length.
`grid-position` centres every row on `x = 0`, so the components are laid one on
top of another and every edge crosses the drawing to reach its own. It is the
same placeholder as the paragraph above, it is exempted from that one bound with
its reason recorded, and `brandes-koepf-position` draws the same graph at 1.02x.

The one place dagre does not produce a drawing at all is a box of zero width. A
route leaving one travelling straight up or down makes dagre 3.1.1 compute
`width * dy / dx` with both terms zero and emit a coordinate that is not a
number. That is legal input here and this package draws it, attaching at the
box's own centre. It is recorded in the committed file rather than routed
around: the point is dropped from the measurements and counted, so that a `NaN`
cannot poison a sum silently, and the graph it belongs to stays inside every
cross-engine bound except the one edge-length exemption described above.

## What is not here yet

Three of the four default stages are layout algorithms. The fourth is a
placeholder. One further real algorithm is selected per run rather than being
anyone's default, `network-simplex-rank`, and one more exists inside the package
without being selectable at all, `brandes-koepf-position`, for the reason below.

| Stage | `name` | What it does today | What comes next |
| --- | --- | --- | --- |
| rank | `longest-path-rank` | Breaks cycles with a least-squares feedback arc set, ranks by longest path, then splits every long edge into a [dummy chain](#dummy-chains). Real, and described in [Ranking](#ranking-and-what-it-does-with-a-cycle). `network-simplex-rank` is a second real ranker a caller can select instead, for [minimum total edge length](#minimum-total-edge-length-and-what-it-costs) rather than minimum height, and since M2.4c it splits through the same shared splitter. | Nothing outstanding. |
| order | `barycenter-order` | Groups the roster by rank and reduces edge crossings within each layer, by barycenter sweeps and then a transpose pass, over every segment of the drawing including the pieces of a split long edge. Real, and described in [Ordering](#ordering-and-what-a-crossing-is-counted-between). It took the default from `insertion-order` in M2.6b, for [this trade](#what-the-default-order-stage-costs-and-buys). Its two budgets were re-derived in M2.6c and are now 4 sweeps and a cap of 16, and its transpose tie rule was re-derived in M2.6d and kept. | Nothing outstanding. |
| position | `grid-position` | Lays each layer out as a row, left to right, centred on `x = 0`, stacking rows downward from `y = 0`. `brandes-koepf-position` is a real algorithm that is implemented but not exported, for the reason below this table. | A compaction that is not the longest-path substitute, which is what now blocks Brandes-Koepf, and then a decision about the default. M2.9 added the first evidence on graphs that are not generated, and it points the other way from the bench corpora. |
| route | `polyline-route` | A polyline out of the source box's border, through the centre of each of the edge's dummies, and into the target box's border, which is two points for an edge with no chain. Monotone in the rank axis. Real, and described in [Routing](#routing-and-where-a-route-attaches). It took the default from `straight-route` in M2.8, which also deleted that placeholder. | `edgeSep`, which would fan out parallel edges and give a self loop a shape, then obstacle detours and splines. |

So a default run of a real graph gives you the right number of rows with the
right nodes in them and a horizontal order within each row that has had its
crossings reduced, and then evenly spaces each row and joins the lot with
polylines that bend once per rank a long edge crosses and stop at the boxes'
borders rather than running under them. The layers, the order within them, the
number of bends and where each route attaches are worth reading; where along a
row a node or a bend sits is not yet. What it is, is a run that always
completes, never overlaps two boxes
(see [Overlap, exactly](#overlap-exactly)), and satisfies every
guarantee this page makes about the result, which is what the later milestones
are built against.

The position phase already has its real algorithm, and it is deliberately not
exported. M2.7 implemented and tested `brandes-koepf-position`, Brandes and
Koepf's "Fast and Simple Horizontal Coordinate Assignment" (GD 2001), and left
it inside the package with no public name, because the measurement said no
caller should be choosing it yet. It aligns each node with the median of its
neighbours in the adjacent layer, which means an edge spanning more than one
rank is invisible to it, exactly as it is invisible to
[the crossing counter](#what-a-crossing-is-counted-between), and when those
figures were taken that was two thirds to three quarters of the benchmark
corpora's edges. Against
`grid-position` it came out **2.7x worse on the 1k corpus and 4.4x worse on the
10k on total horizontal edge length, and 53% and 60% wider**, and it lost the
1k even restricted to the edges it can see.

**The prerequisite has since been met and it did not help. It hurt.** Those
figures were taken when a long edge was invisible to this stage, and the
prediction attached to them was that dummy chains would fix that. The chains are
now read here, every segment is visible, and the comparison got worse:
re-measured over a layering that consumes them, summing the horizontal component
over every segment of the drawing, Brandes-Koepf is **15.91x** `grid-position`'s
segment length on the 10k and **13.81x** its width, against 9.41x and 4.53x over
the same corpus ordered without the chains. That second pair is a third
baseline, not the table's: it still places the dummies and differs only in
whether the order stage saw them, so its widths do not compare with the table's
60%. On the 1k, 8.03x and 8.61x against
3.63x and 2.76x. Both stages improved in absolute terms; grid improved far more.

The cause is the compaction, and it is not what it looks like. The obvious
reading is that a dummy chain is the long alignment block this algorithm exists
to straighten, so the chains made the blocks long and a long block under a
longest-path compaction pushes everything after it. That is refuted by
measurement: capping block length on the 1k corpus, no alignment at all is
1.00x, blocks of two are already 5.18x, and uncapped is 7.36x with the longest
block only 59. Blocks of two cost 70% of the blowup and further length buys
almost nothing, and a single alignment lands where the median of four does. What
is left is that the compaction only ever takes maxima and never pulls a block
back left, so **any** alignment propagates the widest row's packing pressure
into every row it touches. The fix is a contraction pass, which is the class
shift's real job in the paper. So the stage stays unexported on a stronger
reason than it had, and what blocks it is that contraction rather than the
ranker.

**M2.9 measured the same pair on graphs that are not generated, and got a
different answer. Both results stand.** Every figure above is over the two
benchmark corpora, which are seeded layered random graphs at one uniform box
size. On [dagre's nine hand-authored graphs](#what-it-draws-against-dagre) at
varied box sizes:

- **Crossings, and this is the robust half.** Brandes-Koepf takes crossings
  between node centres from 147 to 96, a 35% fall, winning five graphs, losing
  one and drawing three. At 96 against dagre's 109 it is a placement this
  package does not currently ship, where `grid-position` is 1.35x dagre. That
  result is spread across the corpus rather than resting on any one graph.
- **Edge length, and this half is not robust.** The corpus total is 0.99x
  `grid-position` rather than 2.7x or 4.4x, but that total is two graphs
  cancelling: `module-imports` at +11,880 against `etl-fanout` at -8,592 on a
  corpus delta of -1,190, so dropping either reads 1.05x or 0.90x. The median
  per-graph ratio is 0.98 and the range is 0.41 to 1.55. What survives is "not
  2.7x, and level on this corpus", not a figure to three significant places.
- **Width, unchanged.** It is still wider on eight of the nine and by up to
  1.64x, which is the compaction above doing exactly what the compaction above
  does.

So the trade the generated corpora reported is not the trade these graphs
report, and the crossing result in particular runs the other way. Why remains
open. The obvious extension, that a layered random graph carries more long-edge
chain per node for the packing pressure to propagate through, is a hypothesis
this corpus does not confirm: `service-mesh` has 1.07 bends per node and the
worst edge-length ratio at 1.55x, while `module-imports` has 8.40 and comes in
at 1.37x. None of this is enough on its own to move the default, and it is
enough that the default should not be settled on generated graphs alone.

The full table, what the stage costs, what four alignments buy over one, and why
its compaction is not the paper's are all in
`brandesKoepfPosition`'s docstring in `packages/layout/src/position.ts`, and
carry the same expiry.

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

Also still to come: running the same API in a worker (M2.10). Incremental
relayout, the flagship feature, is all of M3, and arrives as a
`createLayout({ stages, config })` engine rather than as another free function:
warm-starting a relayout from a previous run only makes sense if the stages and
the config are the same ones that produced it, which is a thing to bind once
rather than to pass again and hope. `layout()` stays as the one-shot sugar, and
`LayoutResult` stays small and serializable because the engine keeps the
pipeline state, not the result. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in.
