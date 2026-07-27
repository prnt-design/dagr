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

- `networkSimplexRankStage` and `networkSimplexRank(options)`, exported, plus
  the `NetworkSimplexOptions` type. A second real rank stage: it is not a
  placeholder waiting for an algorithm, it is a different algorithm with a
  different objective, so a caller has to be able to say which one it wants.
  `defaultStages.rank` is unchanged and is still `longest-path-rank`. (M2.3)

  It minimises the TOTAL EDGE LENGTH, the sum over the acyclic view's edges of
  how many ranks each crosses, which minus the edge count is exactly how many
  dummy nodes M2.4b will mint. On the 1k benchmark corpus that is 40,430
  dummies down to 17,285, a 57% cut, in about 20ms; on the 10k corpus
  1,414,263 down to 423,426 inside the default budget.

  **None of that saving is collectable in this release.** M2.4b is unbuilt, no
  stage mints a dummy node today, and `virtualNodes` comes back empty from both
  rankers, so the counts above are a cost nobody is paying yet. Switching today
  buys a rank stage that costs several times more (about 20ms against a few
  milliseconds on the 1k corpus, seconds against tens of milliseconds on the
  10k one) and saves no dummy nodes, because there are none. What it buys is a
  ranking M2.4b will be able to exploit.

  **It cannot make a drawing shorter and it can make one taller**, because
  minimum total edge length and minimum height are different objectives and
  `longest-path-rank` already achieves the second exactly. Six nodes are enough
  to trade a rank of height for a unit of length. Anyone picking a ranker on
  the dummy-node number should read the height paragraph in
  `docs/docs/layout.md` before switching.

  Two options, both of which exist for M3 rather than for today.
  `maxIterations` bounds the pivots at 20,000 by default, and whatever stops a
  run the ranking it returns is feasible and never worse than the one it
  started from. It takes a non-negative INTEGER, or
  `Number.POSITIVE_INFINITY`, which means no budget at all: run to convergence.
  A pivot count has no fractional form, so `2.5` and `0.5` are an
  `InvalidConfigError`, thrown at the call that names the budget rather than at
  the run.

  `initialRanks` is a previous ranking to warm start from, which the ranking LP
  being degenerate is what makes necessary: without it a one-edge patch can
  move the solver to a different optimum of equal cost and churn ranks across a
  region that did not change. A supplied ranking is a hint and is repaired into
  feasibility before use, so it cannot make a result infeasible, and it can
  only choose between optima AS LONG AS THE BUDGET HOLDS: a run cut short by
  its budget can come back with more total edge length than a cold run cut
  short at the same point. Note also that nothing exported today produces a
  ranking for you to pass, because a `LayoutResult` holds coordinates and not
  ranks; the option is here so that M3's engine, which will have one, does not
  need the ranker rebuilt around it.

- `longestPathRankStage`, exported. The default ranker, now nameable. Nothing
  about the stage changed and a run with no `rank` override still gets it; what
  changed is that a call site wanting MINIMUM HEIGHT can say which algorithm it
  means instead of relying on which one happens to be the default. That makes
  the export rule "every real stage is exported by name, no placeholder is",
  which is the version that survives M2.5, M2.7 and M2.8 replacing the other
  three. The placeholders (`insertion-order`, `grid-position`,
  `straight-route`) are still reachable only through `defaultStages`, because a
  placeholder's name is a name to delete tomorrow. (M2.3)

- `RankOutput`, `OrderOutput`, `PositionOutput` and `RouteOutput`, exported as
  types. Each is what one stage contributes, and it is what that stage's `run`
  now returns. See the Changed entry below. (M2.4a)

- `RankOutput.virtualChains`, optional, and `RankedState.virtualChains`, which
  the runner derives from it. A `ReadonlyMap<EdgeId, readonly NodeId[]>`: the
  chain of declared ids a rank stage split a long edge into, keyed by the
  caller's own edge id. Nothing produces one yet; M2.4b's chains do, and this is
  a slot declared ahead of the milestone that fills it, exactly as
  `reversedEdges` and `virtualNodes` each were. It exists because M2.4b's router
  has to rejoin a chain into one polyline keyed by the edge it serves, and
  without the chain recorded the only recourse is parsing a dummy id back apart,
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
