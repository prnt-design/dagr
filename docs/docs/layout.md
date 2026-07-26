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

This page describes the pipeline as of M2.2. The types, the runner, and the
stage boundaries are real: they are what every later milestone is built against,
and the roster below exists so the one boundary that was going to have to move
(M2.4's dummy nodes) does not. One of the four algorithms is real: the rank
stage breaks cycles and ranks by longest path, so the layers are the ones the
graph asks for. The other three are placeholders that produce a well formed but
naive result. Expect the contract to gain rules as real stages land, rather than
to lose them. See [What is not here yet](#what-is-not-here-yet) before you reach
for this in anger.

## The shape of a run

A run is six steps. The first and the last belong to the runner, the four
between them are swappable stages:

```
prepare (the runner)   ->  PreparedState
rank stage             ->  RankedState
order stage            ->  OrderedState
position stage         ->  PositionedState
route stage            ->  RoutedState
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

Each record extends the one before it and adds that stage's own output, so
`RoutedState` still carries the graph, the config, the sizes, the ranks, the
layers, and the positions. A stage can read everything computed upstream of it,
and nothing has to be threaded around out of band.

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
it means a stage that needs a node the caller never added cannot add one. It
declares it instead:

```ts
const rank: RankStage = {
  name: 'my-rank',
  run(input) {
    // A dummy needs a size, and a small width so nodeSep spacing still works.
    const sizes = new Map(input.sizes);
    sizes.set('long-edge#1', { width: 1, height: 40 });

    // ... and a rank, alongside one for every node the graph holds.
    const ranks = new Map(input.graph.nodes().map((node) => [node.id, 0]));
    ranks.set('long-edge#1', 1);

    return {
      ...input,
      sizes,
      ranks,
      reversedEdges: new Set(),
      virtualNodes: new Set(['long-edge#1']),
    };
  },
};
```

This is the same argument `reversedEdges` carries, applied to nodes rather than
edges. A declared id is a full citizen from that point on: it needs a rank and a
size, it has to appear in exactly one layer, and it has to get a position. The
runner checks all of that over the roster, so it is checked exactly as hard as a
node the caller added.

It stops at the route stage. A `LayoutResult` mentions the caller's own ids, no
more and no less, because the runner builds both of its maps by walking the
caller's own graph. A declared node has no way in, so no caller ever has to
filter out a node it did not add.

**A stage never replaces the graph.** Every record a stage returns has to carry
back the very object the runner handed in, compared by identity, and the runner
throws a `StageContractError` naming the stage if it does not. Two reasons.
Every contract check compares a stage's output against the runner's graph rather
than against the graph in the record being checked, so a stage that swapped the
graph would otherwise be shrinking the roster its own check runs over, and the
failure would land on whichever later stage still compared against the real
thing. And replacing it is never necessary: the one reason to want to, needing a
node the caller never added, is what the roster is for.

`virtualNodes` is empty today. It exists now because M2.4, which splits a long
edge into a chain of one dummy node per rank it spans, is the reason the roster
is shaped this way: a contract phrased as "every node the graph holds" would
have had to be weakened to let M2.4 land, and one phrased as "every node in the
roster" does not. The default order stage already walks the roster, so M2.4 adds
to the ranker and the router (splitting a long edge into a chain, rejoining the
chain into a polyline on output) without touching the contract between them.

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
backwards in the finished order is in the set. On a simple digraph without self
loops the result is proved to satisfy `|F| <= m/2 - n/6`, which is what makes it
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
acyclic. The weighting also picks the cheaper cut: three edges one way against
one the other reverses the one.

### Ranking

Over that view, a node with nothing pointing at it gets rank 0, and every other
node sits one rank below the lowest node that points at it. Two properties fall
out, and both are relied on:

- **Minimum height.** The last rank is the number of edges on the longest path
  in the acyclic view, which is a lower bound for any ranking that sends every
  edge down at least one rank. No layering of this graph has fewer layers.
- **Contiguity.** The ranks used are exactly `0..max`, with no gaps, because a
  node at rank `r` only got there from a predecessor at rank `r - 1`. The order
  stage turns ranks into layers and the runner rejects an empty layer, so a gap
  would surface there.

Every edge that is neither reversed nor a self loop runs **strictly** down:
`rank(source) < rank(target)`. A reversed edge runs strictly up. The runner's
own check is the weaker `<=`, because a self loop puts both ends on one rank and
because M2.4's long edges will legitimately span several, but this stage means
the strict form and its tests assert it.

What longest path does not give is minimum total edge length. `a -> d` alongside
`a -> b -> c -> d` leaves `a -> d` spanning three ranks, and a node with slack is
pinned as far down as it can go rather than as far up. That is a quality problem
rather than a correctness one, and it is what M2.3's rank tightening is for.

### What `reversedEdges` means for you

Nothing, and that is deliberate. A `RoutedEdge` runs from its `source` to its
`target` as **you** authored them, whatever the ranker did to break a cycle, so
an arrowhead drawn at the last point lands on the target on every edge. See
[The result](#the-result). `reversedEdges` is bookkeeping between the ranker and
the router, it does not appear in a `LayoutResult` at all, and a consumer that
found itself consulting it would be working around a bug rather than using an
API.

### Determinism and cost

Both steps are O(V + E) in time and space. Cycle breaking gets there by keeping
vertices in degree buckets rather than rescanning what is left each round, and
ranking is a Kahn-style sweep that visits each node and edge once; a 10k-node,
40k-edge graph ranks in tens of milliseconds. Both are fully deterministic:
vertices are numbered in `graph.nodes()` order, edges are walked in
`graph.edges()` order, and ties fall to whichever node the graph saw first.
Determinism here is load bearing rather than tidy, for the reason in
[Determinism](#determinism): a ranker that resolved a tie differently on a
re-run would move nodes the user never touched.

## Why the stages are swappable

Every stage is an object with a `name` and a `run`:

```ts
interface RankStage {
  readonly name: string;
  run(input: PreparedState): RankedState;
}
```

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
    return output;
  },
};

layout({ graph }, { position: timed });
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

Every check compares against the graph and the roster the **runner** holds, not
against the record the stage returned. That is what makes "at its own boundary"
mean anything: a check that read the graph out of the record under test would be
asking a stage to mark its own homework.

After **every** stage:

- the record's `graph` is the same object the runner handed in. See
  [The roster](#the-roster).

After the **rank** stage:

- no id in `virtualNodes` is one the graph already holds. A collision is not a
  second node, it is the caller's node wearing a stage's clothes: `sizes` is
  roster-wide from here, so the declaration would overwrite the size the
  caller's node was measured at and nothing downstream would notice. Once M2.4
  mints dummy ids from edge ids, a graph whose node ids look like that pattern
  lands here;
- every member of the roster has a rank, and it is a finite number;
- every member of the roster has a size, and it is a finite pair of lengths
  that are zero or greater. Checked here and not only at prepare, because
  `sizes` is roster-wide from this point on: a rank stage that sizes a dummy
  can also overwrite the size the caller's own node was measured at, and the
  config that validated the original is two steps upstream;
- every id in `reversedEdges` is an edge the graph holds;
- every edge is a ranking: `rank(source) <= rank(target)` for an edge that was
  not reversed, `rank(target) <= rank(source)` for one that was. Less-or-equal
  rather than strictly-less, because a self loop puts both endpoints on one
  rank, and after M2.4 a long edge legitimately spans several. The default
  ranker is strictly stricter than this and its own tests say so, see
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
  doing real work from M2.8, when it becomes computed geometry.

### Obligations the runner cannot check

One rule for route stages is not on the list above, because nothing enforces it.
It is still a rule, and a third-party router has to follow it:

**A polyline runs from its edge's `source` to its `target`, as the caller
authored them, even when the ranker reversed the edge to break a cycle.** A
router working from the reversed direction will naturally emit its points
target-first, and a renderer that draws an arrowhead at the last point (M4 and
M5 both will) then puts arrowheads on the wrong end for exactly the edges that
were part of a cycle. `reversedEdges` is the router's bookkeeping and never the
consumer's.

The runner could check the weak form of this today, comparing the first and last
points against the endpoint positions, because routes still run centre to
centre. It deliberately does not. M2.8 attaches routes at box borders and routes
them around obstacles, so that check would have to be relaxed one milestone
later, and a contract that loses rules is worse than one that never claimed
them. What the runner does instead is take the identity of the edge out of the
router's hands entirely: a route stage returns polylines, and `id`, `source` and
`target` on the finished `RoutedEdge` are copied from the graph. A confused
router can draw a backwards line. It cannot mislabel one.

Node completeness and `bounds` are not on this list, and stopped being checks
when the runner took over assembling the result. There is no route stage output
that could get either wrong. `bounds` is still finite, still encloses every node
box, and is still the zero rectangle when there are no nodes, and the runner
asserts all three over its own output before returning; the containment
comparison carries a tolerance scaled to the magnitude of the coordinates, for
the floating point reason in [Overlap, exactly](#overlap-exactly). A failure
there would be a bug in this package rather than in a stage, so it throws a
plain `Error` and not a `StageContractError`.

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
  console.log(edge.id, edge.points); // [{ x, y }, { x, y }]
}

result.bounds; // { x, y, width, height } around every node box
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

`bounds` is the smallest rectangle containing every node box. Edge routes are
not counted, because today they run centre to centre and cannot leave it; once
M2.8 routes around obstacles the bounds will grow to cover them. An empty graph
gets a zero rectangle at the origin.

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
| `StageContractError` | `STAGE_CONTRACT` | A stage broke one of the rules in [The stage contract](#the-stage-contract). Carries the offending stage's `name`, the `id` it dropped, and a `detail`. A few checks are about the record as a whole rather than one id, and use a plain label instead: `graph`, or `layer 3`. |

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
    }
  }
}
```

## What is not here yet

One of the four default stages is a layout algorithm. The other three are
placeholders:

| Stage | `name` | What it does today | What replaces it |
| --- | --- | --- | --- |
| rank | `longest-path-rank` | Breaks cycles with a greedy feedback arc set, then ranks by longest path. Real, and described in [Ranking](#ranking-and-what-it-does-with-a-cycle). | Rank tightening on top of it, not a replacement (M2.3), and dummy chains for long edges (M2.4). |
| order | `insertion-order` | Groups the roster by rank, orders each layer by graph insertion order. | Barycenter sweeps with a crossing counter (M2.5), then transpose refinement (M2.6). |
| position | `grid-position` | Lays each layer out as a row, left to right, centred on `x = 0`, stacking rows downward from `y = 0`. | Brandes-Koepf horizontal coordinate assignment (M2.7). |
| route | `straight-route` | A straight two-point line between the endpoint centres. | Polylines through dummy-node coordinates, monotone in the rank axis (M2.8). |

So a default run of a real graph gives you the right number of rows with the
right nodes in them, and then evenly spaces each row in insertion order and
joins the lot with straight lines. The layers are worth reading; the horizontal
order and the edges are not yet. What it is, is a run that always completes,
never overlaps two boxes (see [Overlap, exactly](#overlap-exactly)), and
satisfies every guarantee this page makes about the result, which is what the
later milestones are built against.

`RankedState.virtualNodes` is still empty: it is the bookkeeping slot dummy-node
chains fill in M2.4, and it exists now because the alternative, mutating the
caller's graph to add a node, is the one thing this pipeline promises not to do.
`RankedState.reversedEdges` was the same kind of slot until M2.2 filled it, and
it filled without a contract change, which is the argument for having declared
both early.

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
