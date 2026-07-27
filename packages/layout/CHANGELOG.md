# Changelog

All notable changes to `@dagr/layout`. Nothing is published yet, so everything
below is unreleased and the version in `package.json` has never been cut.

This file exists because the milestones through M2 change what `layout` returns
without changing a single type or exported name. A caller upgrading past one of
them sees different coordinates, and no compiler tells them. "Behaviour changed,
types did not" is the category this file has a heading for, so that the v0.1
release notes do not have to be reconstructed by diffing five milestones' worth
of doc prose.

## Unreleased

### Added

- `RankOutput`, `OrderOutput`, `PositionOutput` and `RouteOutput`, exported as
  types. Each is what one stage contributes, and it is what that stage's `run`
  now returns. See the Changed entry below. (M2.4a)

- `RankOutput.virtualChains`, optional, and `RankedState.virtualChains`, which
  the runner derives from it. A `ReadonlyMap<EdgeId, readonly NodeId[]>`: the
  chain of declared ids a rank stage split a long edge into, keyed by the
  caller's own edge id. It was declared here and filled one milestone later, by
  M2.4b's chains (see Changed), exactly as `reversedEdges` and `virtualNodes`
  each were. It exists because M2.4b's router has to rejoin a chain into one
  polyline keyed by the edge it serves, and without the chain recorded the only
  recourse is parsing a dummy id back apart,
  which is ambiguous (an `EdgeId` is a caller-supplied string), couples the
  ranker and the router through a string format, and promotes the id format to
  load-bearing public contract when the M3 requirement only pins the id's value.

  **A chain is listed source to target as the CALLER authored them**, the same
  direction `RoutedEdge.points` runs and for the same reason: a router working
  from the ranked direction naturally walks its chain backwards, and nothing
  downstream notices until an arrowhead lands on the wrong end. So the rank
  check is that a chain's ranks are strictly MONOTONIC, increasing for a normal
  edge and decreasing for one in `reversedEdges`, and lie strictly between the
  two endpoint ranks. "Strictly increasing" reads fine and is wrong for every
  reversed edge.

  This is knowingly the same bet that cost this release its breaking change, and
  it is worth saying so rather than leaving a reader to notice. `virtualNodes`
  was also a slot declared ahead of its milestone, and M2.4a is here partly
  because the shape guessed for it turned out wrong once a real stage needed it.
  The direction rule above is a genuine semantic commitment made before any
  algorithm has had to satisfy it, and a real router meeting a self loop chain
  or a chain sharing a rank may yet revise it. It is taken anyway because the
  alternative is not "decide later": it is a router recovering a chain by
  parsing dummy ids, which fixes the id FORMAT as public contract instead of
  just the id's value, and a format is far harder to revise than a field. A
  wrong field is one more breaking change to a package with no published
  consumers; a wrong format is every third-party ranker and router at once.
  (M2.4a review)

- `InternalLayoutError`, exported, `code: 'INTERNAL'`. The pipeline's own
  invariant failures were bare `Error`s, outside the family the docs promise one
  `instanceof` check covers; every one of them is now this. It is always a bug
  in this package, never in the caller and never in a caller-supplied stage,
  which is why it is not a `StageContractError`: that class names a stage.
  (M2.2 review)

### Changed

- **Every long edge is now split into a dummy chain, so long edges route
  differently and a layout can be wider.** The default rank stage splits an edge
  whose endpoints are more than one rank apart into a chain of virtual nodes,
  one per rank strictly between them, and the default route stage rejoins the
  chain into one polyline. No type and no exported name changed. What a caller
  upgrading past this sees is that an edge spanning `n` ranks comes back with
  `n + 1` points instead of two, that a graph with a long edge in it has more
  nodes to place so the rows those dummies join are wider, and that `bounds` may
  be larger (see the entry below). A graph whose every edge is a one-rank hop is
  laid out exactly as before, because nothing is declared and nothing is split.
  (M2.4b)

  **The one upgrade effect that stops a working program**, and the reason this
  entry is not just cosmetic. A caller who overrode `order` or `position` and
  wrote that stage against `input.graph.nodes()` rather than against the roster
  worked fine before M2.4b, because `defaultStages.rank` never declared a
  virtual node, so the rule and the practice never disagreed where anyone could
  see. From M2.4b, any graph with a long edge in it makes `checkOrdered`
  ("missing from the layers") or `checkPositioned` ("no position was assigned")
  throw a `StageContractError` naming THEIR stage, for a node they have never
  heard of. No type changed, so nothing says a word at compile time, which is
  exactly the category this file exists for. **The roster rule itself has not
  changed**: every stage from the rank boundary on has always been checked over
  the roster (the graph's nodes plus whatever the ranker declared), and what
  changed is that a default run now declares something.

  A dummy is `#dummy:<edgeId>:<index>`, where the index is the dummy's 0-based
  position along its chain counting from the source the CALLER authored, so
  index 0 sits next to `edge.source` for a reversed edge (whose source is at the
  high rank) as much as for a normal one. A pure function of the edge and that
  position, never a counter and never iteration order. That is a requirement of
  M3 rather than a detail: with a counter, adding an unrelated edge renames
  every dummy on a chain, so M3.6's warm start meets nodes it has never seen and
  a long edge jitters between two endpoints that did not move.

  The index rather than the rank, which the ROADMAP suggested "or equivalent",
  because an index is invariant under a uniform rank shift and a rank is not.
  Insert one node upstream and a whole cone moves down a row, renaming every
  dummy in it under the rank scheme while every one of those edges kept its
  shape, and renaming them onto each other: an edge whose dummies were at ranks
  1 and 2 has them at ranks 2 and 3, so the id that named the second bend now
  names the first and a warm start anchors that bend to the wrong previous
  coordinate. The guarantee this buys is narrower than "stable" and is claimed
  narrowly: the id is stable under any edit that does not move the edge's
  endpoints RELATIVE to each other. Endpoints that move relative to each other
  are a real change to the edge's shape, and there the index misanchors by one
  row rather than losing identity outright. (M2.4b review)

  The `#dummy:` prefix is RESERVED, and reserved is not unforgeable: a graph
  that already holds a node with a minted id gets a `StageContractError` naming
  `longest-path-rank`, the colliding id, and the reservation, telling the caller
  to rename their node. The splitter raises it, and the runner's own declaration
  check still covers a third-party ranker that mints ids some other way, so it
  is reported once and the message is about the namespace rather than about a
  built-in stage leaving work undone. A dummy has no size,
  `{ width: 0, height: 0 }`, as dagre's plain long-edge dummy has. A chain is
  listed source to target as the CALLER authored them, so its ranks descend for
  an edge the ranker reversed, and the router needs no reversal bookkeeping to
  walk it.

- **A rank stage that declares an incomplete chain now throws.** New rule at the
  rank boundary: a chain holds exactly one node at every rank the layout
  actually has, strictly between its endpoint ranks. This is the rule M2.4a
  declared the field without, and named as M2.4b's call: a single dummy at rank
  1 on an edge from rank 0 to rank 3 satisfied all five older rules and routed
  across rank 2 with no bend. The error names the first rank that is missing
  rather than reporting a length. It is phrased over the occupied ranks rather
  than as steps of exactly one, because that would assume contiguous integer
  ranks and `insertionOrderStage` explicitly refuses to. **The scope is a chain
  that EXISTS**: declaring one stays optional, a third-party ranker that splits
  nothing is still legal, and a declared id that belongs to no chain is still
  legal. What is no longer legal is a chain with a hole in it. (M2.4b)

  Being phrased over the ranks the layout has, it is a property of the whole
  RANKING rather than of one edge, and the two paragraphs above compose into a
  third: a stage that introduces a rank nothing previously occupied, say by
  declaring one unchained dummy at a rank of its own, has to extend every chain
  spanning that rank, including chains it did not mint. That is correct (a layer
  that exists is a layer a long edge crosses unconstrained) and the error names
  the node occupying the missing rank as well as the rank, because that node is
  routinely not on the chain being blamed. (M2.4b review)

- **`bounds` is the hull of the node boxes AND the route points.** It was the
  hull of the node boxes, and the two agreed while every route ran centre to
  centre, because a centre is inside its own box. A route that bends through a
  dummy need not agree: the order stage puts a virtual node after the graph's
  own within a layer and the position stage lays a row out left to right, so a
  zero-width dummy at the end of a row sits at that row's right extreme,
  `nodeSep` clear of the last box in it. Whether that bend actually leaves the
  hull depends on the rest of the drawing (at `nodeSep: 0` it lands exactly on
  that box's edge, and a wider row elsewhere can swallow it), but one reachable
  case is enough to make the old claim false. The claim was made true rather
  than softened, in the formulation M2.8's obstacle detours need anyway. A
  layout with no chain in it has exactly the bounds it had before, since a
  straight route's endpoints are node centres. (M2.4b)

- **Breaking for every custom stage:** `RankStage`, `OrderStage`,
  `PositionStage` and `RouteStage` now return that stage's own contribution
  rather than the whole next record. A stage still READS the record it is
  handed and can still read everything computed upstream of it; the `...State`
  records are still an extends chain and still what a stage names when it types
  its `run` argument. Two of them did change, and each has its own entry below:
  `RankedState` gains a required `virtualChains`, and `RoutedState` is no
  longer exported. What changed is the return type of all four `run` methods.
  Any stage that ends with `{ ...input, ... }` stops compiling until the spread
  is dropped, because each output type declares every field the runner owns,
  and every field contributed upstream of that stage, as `never`. (M2.4a)

  ```ts
  // Before
  const rank: RankStage = {
    name: 'my-rank',
    run(input) {
      const sizes = new Map(input.sizes);
      sizes.set('dummy#1', { width: 1, height: 40 });
      return { ...input, sizes, ranks, reversedEdges, virtualNodes: new Set(['dummy#1']) };
    },
  };

  // After
  const rank: RankStage = {
    name: 'my-rank',
    run(input) {
      return { ranks, reversedEdges, virtualNodes: new Map([['dummy#1', { width: 1, height: 40 }]]) };
    },
  };
  ```

  The other three are a one-line delete each: `{ ...input, layers }` becomes
  `{ layers }`, and likewise for `positions` and `routes`. A stage that wrapped
  a default and adjusted its answer now spreads the OUTPUT (one field) instead
  of the record: `const { positions } = defaultStages.position.run(input)`.

  **How the breakage reaches you, per stage.** Each output type declares the
  fields it will not accept as `never`, so the compiler names the first one it
  meets rather than reporting a bare excess property. A rank stage that spreads
  `PreparedState` is told `graph`, `config` or `sizes` is not assignable to
  `never`; an order stage that spreads `RankedState` gets those plus `ranks`,
  `reversedEdges`, `virtualNodes` and `virtualChains`; a position stage adds
  `layers` to that list and a route stage adds `positions`. This matters because
  TypeScript does **not** excess-property-check a spread. Without the `never`
  fields the four spreads above all compiled, and so did the realistic
  half-migration (fix the line the compiler flags, leave `sizes` in the spread),
  which would have dropped the returned sizes on the floor and produced a
  silently wrong layout instead of a failed build.

  Three things follow, all of them the point of the change. **No stage hands a
  graph back**, so the check that caught one was deleted, and with it the
  `StageContractError` labelled `graph`. Two mechanisms replace it: the `never`
  fields above, and the runner naming every field it takes out of an output, so
  a value that got past the compiler by way of a cast is still never read.
  Neither alone would do, and neither reaches a stage that mutates the live
  graph it was HANDED, which is why "every roster member has a size" is still a
  runtime rule. **A declared virtual node carries its own size**:
  `RankOutput.virtualNodes` is a `ReadonlyMap<NodeId, Size>` where the old
  `RankedState.virtualNodes` was a `ReadonlySet<NodeId>` next to a roster-wide
  `sizes` map the stage had to copy and extend. Declaring without sizing is
  unrepresentable rather than checked, and a ranker can no longer overwrite the
  size the caller's own node was measured at, so the size VALIDATION narrowed to
  the declaration alone, where prepare has not already run. On the read side
  `RankedState.virtualNodes` is still a set, and the runner derives it and the
  roster-wide `sizes` map; the ids go in sorted, so a dummy's index within its
  layer is a function of its id rather than of the order the ranker declared in.
  **`virtualNodes` is optional**: a ranker with nothing to declare omits it,
  where before it had to hand back an empty set.

  No behaviour a caller can observe changed. The same graph laid out with the
  same config returns an identical `LayoutResult`, which the suite pins against
  a result captured from the previous implementation.

- **`RoutedState` is no longer exported from the package.** It stays in the
  pipeline and nothing about it changed; it is simply the one `...State` record
  a caller has nothing to name. The other four are each the parameter type of a
  `run` somebody writes, and `RoutedState` is what the runner builds after the
  last stage and hands to nobody. Import it and the build breaks; there was
  never anything to do with it. (M2.4a review)

- **Breaking for an exhaustive `switch`:** the exported `DagrLayoutErrorCode`
  union gains `'INTERNAL'`. A caller switching over every member without a
  default case stops compiling until they add it. Free today, because nothing is
  published, which is the point of doing it now. (M2.2 review)
- **A route stage that used to pass may now throw.** The runner checks route
  direction at the route boundary: a polyline's first point has to be at least
  as close to its edge's `source` as to its `target`, and its last point at
  least as close to the `target`. A third-party router that emits its points
  target-first for an edge the ranker reversed is rejected with a
  `StageContractError` naming it, where before M2.2 it silently produced
  arrowheads on the wrong end. The check is proximity rather than endpoint
  equality so that it survives M2.8's border attachment and obstacle detours,
  and it is not strict, so a self loop passes. The default router is unaffected.
  (M2.2 review)

- The default rank stage is now `longest-path-rank`. It breaks cycles with a
  greedy feedback arc set (Eades, Lin and Smyth 1993) and ranks by longest path,
  replacing `single-rank`, which put every node on rank 0. **Every layout of a
  graph with more than one rank of structure now returns different coordinates,
  different bounds, and more than one layer.** No type and no exported name
  changed. (M2.2)

### Notes

- `@dagr/graph` is a peer dependency, not a regular one. Its `#private` fields
  make `Graph` nominally typed, so two copies in a tree are not interchangeable.

## 0.1.0

Not yet released.
