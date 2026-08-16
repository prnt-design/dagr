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

- `engine.relayout(patch)` and `engine.relayoutAsync(patch)`, which lay the last
  graph an engine ran out again after you have edited it and answer with a
  `LayoutDelta`, the geometry that delta adds up to, and an `InfluenceSet`.
  `engine.dispose()` releases what the engine retains and ends it.
  `createLayout` takes an `epsilon`. No coordinate moved: a relayout re-runs the
  whole pipeline and lands the same geometry a cold run of the same graph does,
  which is what makes the delta contract testable before any incremental
  algorithm exists. (M3.2)

  **`relayout` does not apply the patch.** Your graph is already the graph you
  changed, which is what `Graph.subscribe` hands a listener, so the patch is a
  description rather than an instruction and the whole adoption is
  `graph.subscribe((patch) => engine.relayout(patch))`. A patch that disagrees
  with the graph the engine is holding is refused rather than quietly relaid.

  **`DagrLayoutErrorCode` gained a sixth member, `'ENGINE_STATE'`, and that is a
  breaking change to anything switching exhaustively over it.** Same terms as
  the fifth: widening the union is a thing to do before v0.1, and nothing is
  published. It is the code of the new `EngineStateError`, raised when an engine
  is asked for something it cannot answer in the state it is in, which is a
  `relayout` before any run, any call after `dispose`, or a patch describing a
  graph the engine is not holding.

  **`PreparedState` gained an optional `previous`,** the warm-start channel,
  typed `Omit<RoutedState, 'graph' | 'config' | 'previous'>`, and the four
  `...Output` types each gained a `previous?: never` refusing it. A stage that
  spreads the record it was handed already failed to compile, so no correct
  stage changes; a stage that spread its way past the compiler now has one more
  field the runner does not read. Nothing in the package reads `previous` yet:
  M3.6 is the first stage that will. It subtracts its own `previous` because the
  runner carries the field forward, so an engine retaining the routed record
  whole would chain one pipeline state onto the last on every relayout and grow
  with edit count rather than with the graph.

- `diffLayout`, `applyDelta`, `isEmptyDelta` and the `LayoutDelta` type, which
  together are the delta model. `diffLayout` is a pure function over two
  `LayoutResult`s: no engine, no graph, nothing retained between calls, which is
  why it lands before any incremental algorithm rather than after one. It
  reports nodes added, removed and moved, edges added, removed and rerouted, and
  the bounds when they changed, and nothing at all for anything unchanged.
  `applyDelta(a, diffLayout(a, b))` reproduces `b`. No coordinate moved and no
  existing type changed shape. (M3.1)

  **`DagrLayoutErrorCode` gained a fifth member, `'DELTA_MISMATCH'`, and that is
  a breaking change to anything switching exhaustively over it.** Made on that
  type's own recorded terms, which say widening the union is a thing to do
  before v0.1 rather than after, and nothing is published. It is the code of the
  new `DeltaMismatchError`, thrown by `applyDelta` when a delta is applied to a
  result it was not computed against. The fix for a caller is one `case`, and
  the docs page's error example now shows the five.

  `PositionedNode` now extends a new `NodeGeometry`, which is the same four
  numbers without an id. Structurally identical, so nothing a caller wrote about
  a result needs changing; it exists because a delta reports a move as the box
  before and the box after, and an id repeated inside both halves of an entry
  that already carries one is a second copy to disagree with.

  The move tolerance is named on `diffLayout`'s options rather than on
  `LayoutConfig`, which is a departure from what the M3.1 roadmap entry
  proposed and is argued in that entry and in `LayoutDiffOptions`'s docstring.
  Nothing about a run changed, so a caller who never diffs sees no new field
  anywhere.

- `createLayout`, `serveLayout`, the `LayoutPort` type and the
  `WorkerTransportError` class, which together are worker mode. `createLayout`
  binds stages and config once and offers `run` and `runAsync`; `serveLayout` is
  what a worker module calls to answer; `LayoutPort` is the four structural
  members between them, so a browser `Worker`, a worker's own `self` and a
  `MessagePort` from either runtime all satisfy it and this package still
  imports no DOM and no Node type. `layout()` is unchanged and returns exactly
  what it did: worker mode adds a door, it does not move a coordinate. (M2.10)

  **`DagrLayoutErrorCode` gained a fourth member, `'WORKER'`, and that is a
  breaking change to anything switching exhaustively over it.** It is made now
  on that type's own recorded terms, which say widening the union is a thing to
  do before v0.1 rather than after, and nothing is published. A caller with a
  `switch` that the compiler had checked as complete will find it incomplete;
  the fix is one `case`, and the docs page's error example now shows the four.

  `wire.ts`, the message format the two halves speak, is deliberately NOT
  exported. Both speakers ship from this package and are upgraded together, so
  publishing it would freeze an agreement nobody outside can hold either end of.
  A caller who needs to write the boundary down annotates it with `LayoutPort`.

- Nothing in the public API. M2.9 added no exported name, changed no type and
  moved no coordinate: what a `layout()` call returns for a given graph is
  bit-identical across it. It is recorded here anyway because this file's
  heading is "behaviour changed, types did not" and the honest entry for this
  milestone is that NEITHER did, which is worth a reader's time to know when
  they are deciding whether to upgrade past it. What it added is evidence:
  a committed comparison against `@dagrejs/dagre` 3.1.1 on nine hand-authored
  graphs, and a published stage-by-stage cost table in milliseconds on a named
  machine. Both are in `packages/layout/test/`, both are described on the docs
  page, and the second is the number `docs/docs/layout.md` had been promising
  since M2.3 and pointing at this milestone for. (M2.9)

  **The parity numbers are not a promise about future output.** The cross-engine
  bounds in `test/layout.dagre-parity.test.ts` are one-sided ceilings on what
  this package draws relative to dagre, they are gates on this repo rather than
  guarantees to a caller, and a later milestone that draws a better picture will
  move every one of them. Read the docs page's table as what the current
  pipeline does, dated, and not as a compatibility statement.

  `@dagrejs/dagre` is a `devDependency` of this package at an exact version and
  is not a runtime dependency of anything. A published `@dagr/layout` still
  depends on `@dagr/graph` and nothing else.

- `polylineRouteStage`, exported, `name: 'polyline-route'`, and it is
  `defaultStages.route`. The route phase's first real algorithm and the third of
  the four stages to go from a placeholder to one, after `rank` in M2.2 and
  `order` in M2.6b. It is exported on arrival for the same reason
  `barycenterOrderStage` was: a placeholder's name is a name to delete tomorrow
  and a real stage's is how a caller wraps or composes it. No factory beside it,
  because it has nothing to configure yet. (M2.8)

  **Read what it added against what M2.4b already shipped, not against the
  milestone's title.** "Polyline routes through dummy-node coordinates" was
  M2.4b's work: the router this replaces already walked `virtualChains` and
  emitted a point per dummy. What M2.8 added is the two ENDS.

- `edgeSep` is still not honoured by any stage, and that is recorded here as an
  Added entry's small print because `LayoutConfig.edgeSep` promised M2.8 would.
  It governs the cases where two routes coincide EXACTLY: a self loop, which
  gets two identical points at its node's centre whatever the graph looks like,
  and two parallel edges that span ONE rank, which have identical endpoints and
  no bend to tell them apart. Parallel edges spanning more than one rank are
  already separated, incidentally: each gets its own dummy chain and the order
  stage places those dummies apart, so the two routes differ at every point.
  All three cases are pinned in `test/layout.route.test.ts` as they stand so the
  milestone that fans them out has a before. (M2.8)

- `virtualChains` on `Layering`, the argument type of `countCrossings`, optional
  and defaulting to none. Pass the rank stage's chains and a long edge is
  counted as the segments it is drawn as; omit them and it is counted as
  nothing, because its endpoints are more than one layer apart. Additive, so
  every existing call keeps compiling and keeps meaning what it meant, but on a
  drawing with chains in it the two answers are not close: 13,131 segments
  counted against 214,222 on the 10k benchmark corpus. (M2.4b)

  It is optional rather than required because a `Layering` is a drawing someone
  wants a number for, and a drawing with no chains in it is a legitimate thing
  to hand over. It is not defaulted to "look them up", because `Layering` holds
  a `Graph` and a graph does not know what a rank stage decided.

- `brandes-koepf-position`, the first real position stage, INTERNAL TO THE
  PACKAGE AND NOT EXPORTED. `brandesKoepfPosition(options)`,
  `brandesKoepfPositionStage` and the `BrandesKoepfOptions` type are all in
  `src/position.ts` and none of them is reachable from `@dagr/layout`, so no
  caller can name this stage and nothing a caller already writes changes. It is
  Brandes and Koepf's horizontal coordinate assignment (GD 2001), which marks
  the conflicts where an ordinary edge crosses a dummy chain, aligns each node
  with the median of its neighbours in the adjacent layer four ways, compacts
  each alignment, and gives each node the median of its four candidates.
  `defaultStages.position` is unchanged and is still `grid-position`. (M2.7)

  **It is unexported for the reason it is not the default, and unlike
  `network-simplex-rank` that reason is not a benchmark, it is the drawing.** A
  stage earns a public name by being an algorithm a caller chooses between, and
  by the numbers below there is no run today that should choose this one over
  `grid-position`. `insertion-order` is in the package on the same terms.
  Brandes-Koepf aligns a node with its neighbours in the ADJACENT layer, so an
  edge spanning more than one rank is invisible to it, which when this entry
  was written was most of them: 1,324 of the 1k benchmark corpus's 4,000 edges
  spanned exactly one rank and 10,528 of the 10k's 40,000. Measured against
  `grid-position` on those corpora
  it is 2.7x and 4.4x worse on total horizontal edge length (3,793,350 to
  10,191,450 and 292,526,025 to 1,297,826,325, measured horizontally because
  that is the only part either stage decides) and 53% and 60% wider (17,950 to
  27,550 and 165,100 to 264,175). Even restricted to the edges it can see it
  wins only one of the two, 12% worse on the 1k (1,112,700 to 1,246,200) and
  7.4% better on the 10k (44,056,125 to 40,790,550). Running it bought a worse
  drawing. Dummy chains were expected to change that, because they make every
  edge span exactly one rank, and both the export and the default were left as
  decisions for the milestone that would have the measurement to make them
  with.

  **THE PREREQUISITE HAS BEEN MET AND IT MADE THIS STAGE WORSE against
  `grid-position`, not better, which is the sentence above being refuted rather
  than confirmed.** The chains are read here now and every segment of the
  drawing is visible. Re-measured over a layering that consumes them, summing
  the horizontal component over every SEGMENT (not the quantity the table above
  measures, so compare the ratios and not the levels): 15.91x `grid-position`'s
  segment length on the 10k and 13.81x its width, against 9.41x and 4.53x over
  the same corpus ordered without the chains, a baseline that still PLACES the
  dummies and so is neither the table's population nor the table's drawing: the
  table's 60% wider is not comparable with that 4.53x. On the 1k, 8.03x and
  8.61x against 3.63x and 2.76x. Both stages improved in absolute terms and grid
  improved far more.

  The cause is the compaction, and it is not the length of the blocks, which was
  the obvious guess and is refuted. Capping block length in `solve` and measuring
  on the 1k with the chains consumed: no alignment at all is 1.00x, blocks of two
  are already 5.18x, and uncapped is 7.36x with the longest block only 59. Blocks
  of two cost 70% of the blowup and further length buys almost nothing. A single
  alignment matches the median of four, so that is not it either. What is left is
  that the compaction only ever takes maxima and never pulls a block back LEFT,
  so any alignment at all propagates the widest row's packing pressure into every
  row it touches. The fix is a contraction pass, which is the class shift's real
  job. So the stage stays unexported for a stronger reason than it had, and what
  blocks it is that contraction rather than the ranker.
  The two edge shares quoted above are pre-M2.2c on top of everything else; over
  the view that ships they were 1,513 of 4,000 and 13,131 of 40,000, and they are
  now 18,746 and 214,222 segments, all of them adjacent.
  `defaultStages.position` is unchanged either way.

  `variant` is the only option and takes `'balanced'`, the default and the
  median of all four alignments, or one of `'down-left'`, `'down-right'`,
  `'up-left'` and `'up-right'`, which run a single pass. It is `variant` rather
  than `align` because `'balanced'` is not an alignment, it is the median of
  four completed layouts. A bad value is an `InvalidConfigError` naming the
  field, thrown at the call that builds the stage rather than at the run, which
  is the rule `maxSweeps` and `maxIterations` already keep. Four passes cost
  6.3x to 7x one in solve time and about 1.6x once the shared index build is
  counted, and they buy 21% of total horizontal edge length on the 1k and 45% on
  the 10k, and a far narrower drawing.

  **The compaction is not the paper's, because the paper's is unsound as
  published.** `place_block` records `shift[sink[u]] = min(shift[sink[u]],
  x[v] - x[root[u]] - delta)` and applies it once, so a class shifted against a
  class that is itself shifted later ends up short by the parent's shift. The
  minimal counterexample is ten nodes, `layers [3, 2, 3, 2]` with
  `edges [[1, 4], [2, 3], [2, 4], [3, 6], [4, 6], [7, 9]]` in the up direction
  with the left bias, where two boxes land on one coordinate; on the 1k corpus
  that compaction leaves 33 pairs of boxes overlapping. Composing the shifts
  transitively through a recorded parent fixes the counterexample and is still
  not sound. What ships compacts each alignment by longest path over the block
  order, which cannot overlap, and it costs 30% of adjacent-layer edge length on
  the 10k against the broken form (40,790,550 against 28,559,325). Recovering
  that needs the paper's erratum, a proper class graph with the shifts resolved
  by longest path over it, which is a task of its own and is named as the next
  step in the stage's docstring.

  The guarantee the stage carries is spacing rather than only no-overlap: two
  boxes side by side in a layer are at least `nodeSep` apart edge to edge, in
  the layer's own left-to-right order. It holds by construction in each pass and
  survives the median of four by an order-statistics argument. Vertical
  coordinates are `grid-position`'s, unchanged, so switching stages moves nodes
  sideways and never up or down; the drawing is not centred on `x = 0`, which
  `grid-position` does per row and this stage cannot do at all.

- `maxTransposePasses` on `BarycenterOrderOptions`, defaulting to 8, where zero
  means no transpose at all. (**The default is 16 as of M2.6c**; the rest of
  this entry is what M2.6 shipped and is left as the record of it.) It bounds
  PASSES only, and it rejects a
  non-integer, a negative and `Number.POSITIVE_INFINITY` with
  `InvalidConfigError` naming the field, checked when the stage is built rather
  than when it runs. That is `maxSweeps`'s rule, for `maxSweeps`'s reason: a
  heuristic with no optimality condition has nothing for "as many as it takes"
  to mean. (M2.6)

  **THE PASS IS ON BY DEFAULT, so `barycenterOrder()` and
  `barycenterOrderStage` return different layers than they did before this
  entry, with no type change to warn a caller.** This is the category the file
  exists for. After the sweeps settle, the stage takes the best layering they
  found and repeatedly swaps adjacent pairs within a layer while that lowers the
  crossing count, which reaches 3,005 crossings on the 1k benchmark corpus where
  the sweeps alone reach 3,605, and 30,318 against 35,114 on the 10k, costing
  about 0.41ms and 4.93ms. `defaultStages.order` is still `insertion-order` and
  is untouched, so a caller who never named an order stage sees nothing change.

  **The last sentence above was superseded by M2.6b**, which pointed
  `defaultStages.order` at `barycenter-order`, so a caller who names no order
  stage now gets this pass and everything in front of it. It is left here
  because it is what was true when the pass landed. The two crossing counts in
  this paragraph WERE superseded, twice: M2.4b's consumption of the chains made
  the counter see sixteen times as much of the drawing, and M2.6c then moved
  both budgets. The stage reaches 185,028 and 8,586,890 today. See the M2.6c
  entry under Changed.

  The sharpest case, because it is the one that reads as a contradiction:
  `barycenterOrder({ maxSweeps: 0 })` used to mean "the seed permutation,
  untouched" and no longer does, because a sweep budget of zero does not
  disable a pass that runs after the sweeps. Ask for the seed alone with
  `barycenterOrder({ maxSweeps: 0, maxTransposePasses: 0 })`.

  What the cap is measured against is worth carrying, because it will expire.
  (It did. M2.6c re-derived it and found no knee at all on the curve over the
  drawing the stage sees now, and a fixed point at 675 passes rather than 60.
  The cap is 16 and `maxSweeps` is 4, so the coincidence below is also over.)
  Eight is the knee of the curve: it captures 81.9% of what an unbounded run to
  the fixed point would save, for 16.1% of the extra time. It matches
  `maxSweeps`'s default of 8 by coincidence and the two are deliberately
  separate constants. And it is measured on graphs where about a quarter of
  edges span exactly one rank and so are visible to the counter at all. When
  M2.4b splits every long edge into a chain, that share goes to essentially all
  of them, and both the cap and the tie rule have to be re-derived rather than
  carried across: the saving a capped pass keeps falls from 10.7% to 1.4% on a
  dummy-expanded 10k, at the cap of 4 those two were compared at rather than at
  this default of 8, which was never measured there.

- `barycenterOrderStage` and `barycenterOrder(options)`, exported, plus the
  `BarycenterOrderOptions` type, and `countCrossings(layering)` with the
  `Layering` type it takes, which is a graph and the layers its nodes are drawn
  in. The first real order stage: crossing reduction by barycenter sweeps, with
  the crossing counter it optimises exported beside it. `defaultStages.order` is
  unchanged and is still `insertion-order`. (M2.5)

  **The last sentence above was superseded by M2.6b**, which made this stage
  the default. It is left here because a stage existing and a stage being the
  default were separate decisions, and this entry is the record of the first
  one. See the M2.6b entry under Changed.

  **The seed permutation is a connected depth-first walk over adjacent-layer
  edges**, not the roster order the placeholder uses. It is recorded here as
  well as in the docs because M3.6 warm starts from exactly it and the stage
  that used to define the answer will not exist by then. The roster is walked in
  its own order, each unvisited node starts a walk that may only step along an
  edge whose endpoints sit in adjacent layers, in either direction, neighbours
  come in `outEdges` order and then `inEdges` order, and a node no such edge
  reaches is appended when the outer loop arrives at it.

  Measured against the alternatives, crossings after 8 sweeps: roster order
  3,943 on the 1k corpus and 54,744 on the 10k, this walk 3,605 and 35,114, a
  walk over ALL edges 3,459 and 38,152. The all-edges walk was the expected
  winner, on the theory that the seed is the only place a long edge can
  influence a stage that cannot otherwise see one, and it loses the corpus that
  counts. The adjacent-layer rule would also coincide with it once every long
  edge is split, so it is the behaviour this stage will have anyway. (The edges
  are split and the chains are read here now, so the two rules do coincide, which
  is the argument coming true. The three counts above are pre-M2.2c AND
  pre-consumption and were never refreshed: over the drawing this stage sees
  today it reaches 8,586,890 crossings on the 10k at its own defaults, which is
  `test/layout.order.test.ts`'s pin, counted over 214,222 segments rather than
  the 10,528 edges these three were counted over.)

  **What a crossing is counted between**, which is the honest limit of this
  release. Only two segments joining the same pair of ADJACENT layers can cross,
  so an edge spanning more than one rank is invisible to the counter and to the
  sweeps alike, and so is a self loop. Under the default ranker that is 1,324 of
  the 1k corpus's 4,000 edges (33.1%) and 10,528 of the 10k's 40,000 (26.3%);
  the longest edge spans 78 and 201 ranks. M2.4b's chains make every edge that
  spans more than one rank span exactly one, which takes that share to 100% on
  any graph without self loops, both benchmark corpora included, without a line
  changing here.

  `maxSweeps` defaults to 8: the 10k corpus goes 94,991 at the seed, 50,735 at
  2, 40,217 at 4, 35,114 at 8 and 32,503 at 16, costing about 5.5ms, 9.5ms,
  13.5ms, 21ms and 38ms. Sixteen sweeps buy another 7% of what is left for
  something under double the time. (**The default is 4 as of M2.6c.** These
  five counts are this file's copy of that curve, kept because the curve over
  the drawing the stage sees today is a different shape: flat from three sweeps
  rather than still falling at sixteen.) It takes a non-negative INTEGER and rejects
  everything else, including `Number.POSITIVE_INFINITY`, with an
  `InvalidConfigError` thrown at the call that names the budget; there is no
  optimality condition here for an unbounded run to converge to.
  `InvalidConfigError` is the member of this package's error family that means
  "the caller handed in nonsense", so it is the one a bad budget gets; the rule
  that an out-of-range value is a `RangeError` naming the field is scoped to
  `@dagr/render` and does not reach here. The stage scores the layering after
  every sweep and returns the BEST one seen rather than the last, because the
  sweeps are not monotone, so a larger budget is a weakly better answer rather
  than a different one.

  `initialOrder` is a previous run's layers to start from, a hint and never a
  permutation taken on trust, on the same terms as `initialRanks` on the simplex
  ranker: unusable entries are dropped one at a time and nothing it can say
  produces an invalid layering. An id keys by its index WITHIN ITS OWN HINT
  LAYER, so the hint constrains relative order and never absolute index, and an
  id it does not name keeps the index the seed walk gave it rather than being
  swept to one end. As with `initialRanks`, nothing exported today produces one
  for you to pass, because a `LayoutResult` holds coordinates and not layers; it
  is here so that M3's engine does not need the stage rebuilt around it.

  **It is not the default, and the reason is a benchmark rather than the
  algorithm.** It costs about 21ms on the 10k corpus against a committed
  `pipeline > 10k` baseline of 30.15ms and a gate tolerance of 10%, so switching
  the default today fails the bench gate; the baseline refresh that would absorb
  it is owed already and recaptures every entry at once, so it wants a quiet
  machine. M2.6's transpose pass improves this same stage, so the default flips
  once, after both, with one rebaseline instead of two. That is also the
  precedent M2.3 set: a real stage is exported by name whether or not it is the
  default.

  **The paragraph above was superseded by M2.6b**, which is the flip it
  describes waiting for: the transpose pass landed with M2.6, the baseline was
  recaptured wholesale in the same change as the flip, and the default is now
  `barycenter-order`. It is left here because it is the reasoning that made the
  stage ship without the default, and because the last sentence of it, the
  export rule, is still exactly true. See the M2.6b entry under Changed.

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

  **The figures in the paragraph above were superseded by M2.2b**, all of them
  and not only the dummy counts, because M2.2b changed the acyclic view both
  rank stages rank. They are left here because they are what this stage was
  measured at when it landed. As of M2.2b a caller got 22,726 down to 15,713
  on the 1k, a 31% cut rather than 57%, in about 28ms rather than about 20ms,
  and 1,359,680 down to 268,589 on the 10k. See the M2.2b entry under Changed
  for why the percentage fell while nothing about this stage got worse.

  **And superseded again by M2.2c**, for the same reason in the same direction.
  What a caller gets today: 14,746 down to 10,660 on the 1k, a 28% cut, and
  174,222 down to 105,975 on the 10k inside the default budget. See the M2.2c
  entry under Changed.

  **None of that saving is collectable, and M2.4b did not change that.** The
  paragraph that stood here said the counts were a cost nobody was paying
  because no stage minted a dummy. Half of that expired: `longest-path-rank`
  splits long edges as of M2.4b and pays the 174,222. The other half did not.
  M2.4b put the splitter in `longest-path-rank` only, so `network-simplex-rank`
  still declares nothing and `virtualNodes` still comes back empty from it, and
  switching today still buys a rank stage that costs several times more (about
  28ms against a few milliseconds on the 1k corpus, seconds against tens of
  milliseconds on the 10k one) and saves no dummy nodes, because it mints none
  to save. It also means a run that selects it gets multi-rank edges reaching
  the later stages, which is the thing M2.4b exists to prevent. Sharing the
  splitter between the two rankers is what makes the 105,975 real, and it is
  named in M2.4b's ROADMAP entry as the gap that milestone left open.

  **M2.4c SHARED THE SPLITTER, so the paragraph above has expired in full.**
  This stage declares chains like the other one, the 10,660 and the 105,975 are
  what its `virtualNodes` holds rather than what a splitter over its ranking
  would hold, and no run gets a multi-rank edge past the ranker any more. What
  survives of that paragraph is the cost: switching still buys a rank stage that
  costs several times more, and still risks a taller drawing. See the M2.4c
  entry under Changed.

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

  **`insertion-order` left that list at M2.6b** and is now reachable through
  nothing, because `defaultStages.order` points at `barycenter-order` and the
  older stage was neither exported nor deleted. This one is called out where
  the other superseded paragraphs are merely marked, since it is the claim a
  reader is most likely to act on and fail. See the M2.6b entry under Changed
  for why it survives at all.

  **`straight-route` left that list at M2.8** and left it the other way, by
  being deleted rather than kept, since nothing measured against it. The list
  above is now one item long: `grid-position`. The rule this paragraph states
  has now been asked all three of the questions it was written against and
  changed for none of them: `barycenter-order` was exported a milestone before
  it took the default, `brandes-koepf-position` is real and still has no public
  name because no run should choose it, and `polyline-route` was exported on
  arrival because it took the default at once. M2.7 is the one this paragraph
  guessed wrong about, having assumed it would replace `grid-position`.

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

- **Every route now starts and finishes on a node box's BORDER rather than at
  its centre, so every default run comes back with different edge coordinates
  and no type changed to warn anyone.** This is the whole of what M2.8 moved.
  Two nodes stacked at the defaults, 100 by 40 boxes with a `rankSep` of 50,
  used to route as `[{0, 20}, {0, 110}]`, the two centres, and now route as
  `[{0, 40}, {0, 90}]`, the 50 units of clear air between them. An arrowhead
  drawn at the last point used to land underneath the target. (M2.8)

  **Nothing between the ends moved, exactly.** Every interior point is still the
  coordinate of a dummy on the edge's chain, byte for byte what `straight-route`
  produced, and every route still has the same number of points as before.
  `test/layout.route.test.ts` keeps the old router as `centreToCentreRouteStage`
  and pins the two against each other over nine graphs, the two benchmark
  corpora, the six golden graphs and `dense-1200` again at varied box widths,
  rather than asserting a remembered figure: 14,746 interior points on the 1k
  and 174,222 on the 10k, none of them differing.

  **Node coordinates and `bounds` did not move either**, which they could not:
  an attachment slides along a segment the router already had and lands on a
  border inside a box the hull already contained. The full-result capture in
  `test/layout.result.test.ts` is the witness, and only its `edges` needed
  recapturing.

  **What it is worth**, across those nine graphs, is between 0.6% and 5.9% off
  the total length of the drawing's polylines, and every unit of it was ink
  drawn underneath a node box. The saving is at most half a box diagonal per
  end, 53.85 at the default box, so a drawing of long thin rows saves a smaller
  share of a much larger number: the 10k corpus saves 3,965,122 of 632,523,805
  and `tall-600` saves 162,181 of 2,740,824.

  **Routes are monotone in the rank axis**, in the weak form stated on
  `polylineRouteStage`: reading a route source to target, `y` never moves
  against the direction the route runs as a whole. That is not a new property of
  the drawing, since `y` is the position stage's answer and the points were
  already monotone before M2.8; what is new is that it is stated and checked,
  over both corpora, all six golden graphs and both position stages. The runner
  does not check it, deliberately, because a caller may supply a position stage
  that stacks ranks any way it likes.

  **An attachment is held back by two caps** and they bound different distances:
  half of the segment it walks along, which keeps the two ends of a bendless
  route from crossing each other, and half the way to the edge's other ENDPOINT,
  which on a chained edge is a different distance and is what keeps the runner's
  route-direction check satisfiable. Neither binds at the default box size, and
  both bind where a box is large against the gap it has to cross, which an
  ordinary graph with one wide node in it reaches. Without the second,
  `layout()` throws a `StageContractError` on four nodes at the default config
  with one box 2000 wide. That is a caller-visible throw on legal input, so it
  is here rather than only in the ROADMAP.

  **A self loop and two parallel edges spanning one rank are unchanged**, and
  that is the `edgeSep` entry above rather than an oversight.

- **`straight-route` is gone.** It was never exported, so no caller can have
  named it, and nothing measured against it: the precedent is M2.2 deleting
  `singleRankStage` rather than M2.6b keeping `insertion-order`. Its behaviour
  is preserved where it was still worth having, as
  `centreToCentreRouteStage` in `test/layout.route.test.ts`, which is what makes
  the before-and-after above a measurement rather than a memory. (M2.8)

- **`network-simplex-rank` now splits long edges into dummy chains, so a caller
  who selects it gets a different drawing, with no type change to warn them.**
  The splitter M2.4b put inside `longest-path-rank` moved to `src/chains.ts` and
  both rank stages call it. What a caller selecting `networkSimplexRankStage` or
  `networkSimplexRank(options)` sees: `virtualNodes` and `virtualChains` come
  back filled where they were omitted, an edge spanning `n` ranks routes as
  `n + 1` points instead of two, the rows those dummies join are wider,
  `bounds` may be larger, and a graph holding a node id in the reserved
  `#dummy:` namespace now throws a `StageContractError` naming
  `network-simplex-rank` where it used to lay out. That last one is a throw on
  input this ranker used to accept, and it is the same throw
  `longest-path-rank` has raised since M2.4b: the namespace is reserved, not
  unforgeable, and the fix is to rename the node. A run that never overrides
  `rank` is untouched, since `defaultStages.rank` is `longest-path-rank` and
  always has been. (M2.4c)

  **This is a hole closed rather than a feature added.** A chainless ranking is
  legal by design, so no contract check fired: selecting the other ranker
  quietly bought multi-rank edges reaching the order stage, the position stage
  and the router, which is the one thing M2.4b exists to prevent. The test that
  pinned the gap named itself as the one to delete when this landed, and it is
  deleted.

  **What it mints**, naming the ranker and the budget beside every figure per
  M2.2b: 10,660 dummies on the 1k benchmark corpus and 105,975 on the 10k, both
  inside the default 20,000-pivot budget, against `longest-path-rank`'s 14,746
  and 174,222 on the same two. Cuts of 28% and 39%, which this file has quoted
  since M2.3 as what a splitter over this ranking WOULD mint. They are now what
  the roster holds. Both pairs are pinned in `test/layout.chains.test.ts`.

  **Nothing the default pipeline produces moved**, and that is checked rather
  than assumed: no golden file, no pinned crossing count and no committed
  benchmark entry changed, because `longest-path-rank` calls the same splitter
  it always had and its output is byte-identical. The one difference inside the
  shared code is that it now walks the OCCUPIED ranks between an edge's
  endpoints rather than the integers, which is how the runner's completeness
  rule is phrased. Neither shipping ranker leaves a gap in its ranks, so the two
  walks agree on every graph in the suite; the difference is pinned directly
  against the splitter, over a ranking with a gap in it.

- **Both order-stage budgets changed, so `barycenterOrder()` and
  `barycenterOrderStage` return different layers than they did, with no type
  change to warn a caller.** `maxSweeps` goes from 8 to 4 and
  `maxTransposePasses` from 8 to 16. This is the category this file exists for,
  and it is the re-derivation M2.6 and M2.6b both recorded as owed once M2.4b
  made every edge visible to the counter. (M2.6c)

  **What it buys, on both axes at once.** On the 10k benchmark corpus the stage
  reaches 8,586,890 crossings where the pair it replaces reached 8,748,361, and
  on the 1k 185,028 against 194,289: 1.85% and 4.77% fewer. All six graphs of
  the golden regression corpus are lower too. And it is FASTER: min of 8
  interleaved runs gives 8.1% on the 10k and 21.1% on the 1k, against 6.1% and
  20.4% predicted from the sweep and pass costs. Three earlier runs on a busier
  machine read 4.0%, 7.1% and 7.7% on the 10k, so take 4% to 8% as the honest
  range there.

  **Why the two stopped being equal**, which the old pair being 8 and 8 was
  always careful to call a coincidence. The sweep curve floors after ONE sweep
  on the 10k and three on the 1k, so sweeps 5 through 8 were buying nothing at
  all; the transpose curve has no knee anywhere, its marginal rate falling by a
  fifth per doubling early and a third by the end, smoothly and for hundreds of
  passes. A sweep costs 5 to 6 passes of the pass's time. So the budget moves
  from the sweeps to the pass, and the cap stops at 16 because that is the last
  value that leaves the whole stage faster than before on both corpora rather
  than only on one.

  **The knee the old cap was chosen at is gone, and so is the fixed point it
  was measured against.** The pass now runs 675 times on the 10k and 187 on the
  1k before it finds no improving swap, where the figures on record were 60 and
  19, so a cap of 200 stops the 10k two thirds of the way. What the old table
  got right is the prediction it carried: it forecast the saving collapsing to
  "1.4% at a cap of 4" once every edge became visible, and a cap of 4 measures
  1.38%.

  **The tie rule was owed one too, and M2.6d paid it without changing
  anything.** It had been chosen on the same pre-chain drawing as the cap and
  M2.6c did not re-run it. Re-run at these budgets over the segment population,
  taking zero-delta swaps still wins on both corpora and all six golden graphs,
  so no count in this entry moves and there is no migration to describe. The
  figures are in `barycenterOrder`'s docstring and the 1k and 10k columns are
  pinned in `test/layout.transpose.test.ts`. (M2.6d)

  **To keep the layers you had**, name both budgets:
  `barycenterOrder({ maxSweeps: 8, maxTransposePasses: 8 })` reproduces exactly
  what `barycenterOrderStage` returned before this entry. Nothing about the
  stage other than the two numbers changed, so that is the whole of the
  migration, and it is worth saying because no type change warns a caller who
  never named a budget.

- **`order-crossings.golden.json` is now scored over the drawing's segments**,
  not over the graph's own adjacent-layer edges. From the moment M2.4b's chains
  were consumed the harness ordered each entry over the segments and then
  counted only the edges, which is not a population the stage optimises and
  moves the wrong way when the stage improves. Fixing that alone multiplies
  every count by between 3.5x and 76x, the spread being each graph's long-edge
  share, and the budgets above then move the shipping column down on all six.
  Both causes are attributed separately in the file's own header. (M2.6c)

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

  **The order stage and the position stage read the chains**, which is what
  makes them worth their cost: an edge with a chain is ordered, counted and
  positioned as the segments it is DRAWN as, one per gap it crosses, rather than
  being dropped whole by an adjacent-layer test. Measured on the 10k benchmark
  corpus, both layerings scored over all 214,222 segments: reading the chains
  gives 8,748,361 crossings against 33,932,556 for ignoring them, a 74% cut, and
  72% on the 1k. The default position stage's total horizontal segment length
  falls 66% on the 10k and 63% on the 1k.

  **Every crossing count this package quotes rose by roughly an order of
  magnitude at the same moment, and none of that is a regression.** The counter
  went from seeing 13,131 of the 10k's 40,000 edges to seeing all 214,222
  segments, so the population grew sixteenfold while the layering over it got
  better. `order-crossings.golden.json` moved between 1.65x and 3.01x per entry
  for exactly this reason, and the only like-for-like comparison in the suite is
  the one in the paragraph above, which scores both layerings on the same
  population. Do not read a count taken before this against a count taken
  after.

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
  ranks and no order stage in this package does. **The scope is a chain
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
  dummy need not agree: an order stage is free to leave a virtual node at the
  end of a layer and `grid-position` lays a row out left to right, so a
  zero-width dummy at the end of a row sits at that row's right extreme,
  `nodeSep` clear of the last box in it. Whether that bend actually leaves the
  hull depends on the rest of the drawing (at `nodeSep: 0` it lands exactly on
  that box's edge, and a wider row elsewhere can swallow it), but one reachable
  case is enough to make the old claim false. The claim was made true rather
  than softened, in the formulation obstacle detours will need anyway. A
  layout with no chain in it has exactly the bounds it had before, since a
  straight route's endpoints are node centres. (M2.4b)

  **This paragraph attributed the detours to M2.8 and M2.8 brought none.** It
  brought border attachment, which does not exercise the formulation either
  way: an attachment lands ON a box the hull already contains, so only a bend
  can grow the bounds. The last sentence above is now history rather than
  present tense, since a route's endpoints stopped being node centres in M2.8,
  and the bounds of a chainless layout are unchanged by that for the same
  reason. (M2.8)

- **Cycle breaking is now a least-squares vertex order rather than the greedy
  heuristic of Eades, Lin and Smyth, so every graph with a cycle in it ranks
  differently, lays out differently and draws differently, with no type change
  to warn a caller.** `feedbackArcSet` gives every node the height minimising
  the sum over edges of `(height(target) - height(source) - 1)^2`, solves it as
  a Laplacian system by preconditioned conjugate gradient, and reverses the
  edges that run downhill in the result. The component rule M2.2b added is
  unchanged. (M2.2c)

  What it buys, on the two benchmark corpora, as reversed edges / ranks / dummy
  nodes the M2.4b splitter will mint: the 10k corpus goes from
  4,620 / 203 / 1,359,680 to 857 / 160 / 174,222, and the 1k from
  74 / 81 / 22,726 to 40 / 64 / 14,746. Better on all three numbers on both
  corpora, and an 87% cut in the quantity that decides how much of a drawing is
  stand-in nodes. Under `network-simplex-rank` at its default budget the 10k
  figure is 105,975 against the old view's 268,589, so the win does not depend
  on which ranker you select.

  What it costs is time in the rank stage: the call is about 2.3 times the
  greedy one on the 10k corpus. That is deliberate, and the thing it is bought
  against is a cost nobody was paying when this entry was written, because M2.4b
  was unbuilt and no stage minted a dummy. M2.4b has since landed and the entry
  above it is the bill: 174,222 dummies on the 10k rather than the 1,359,680
  this change removed.

  **An acyclic graph is unaffected.** The feedback set is empty either way, so
  the view, the ranks and the drawing are exactly what they were. Everything
  above is about graphs that have a cycle in them.

- **`defaultStages.order` is now `barycenter-order`, so a caller who never
  named an order stage gets different layers, different coordinates and a
  different drawing, with no type change to warn them.** That is the category
  this file exists for, and this is the largest instance of it so far: within a
  layer the horizontal order is now one that has had its crossings reduced,
  where before it was the order the nodes happened to be added to the graph in.
  (M2.6b)

  What the change costs and what it buys, one sentence each. The full default
  pipeline is about 1.8x slower on the 10k benchmark corpus and about 1.6x
  slower on the 1k. The layering it returns has 92.9% fewer adjacent-layer
  crossings on the 10k and 76.7% fewer on the 1k. The four measurements those
  ratios come from are stated once, in the last section of `barycenterOrder`'s
  docstring in `src/order.ts`, and deliberately not copied here: a benchmark
  recapture moves the timings and M2.4b moves all four. M2.4b has since landed
  and its chains are now read by this stage, so all four are owed a
  re-derivation against a pipeline that orders 184,222 nodes and 214,222
  segments on the 10k rather than 10,000 and 13,131. That re-derivation has not
  been done. `order-crossings.golden.json` HAS been recaptured over the drawing
  with the chains in it, which is a different thing: it pins what the stage
  reaches, not what this trade cost and bought.

  Nothing about the stage itself changed and no export moved.
  `barycenterOrderStage` has been exported by name since M2.5 and is the very
  object `defaultStages.order` now holds, so `layout({ graph })` and
  `layout({ graph }, { order: barycenterOrderStage })` do the same thing, and
  the entries under Added that describe the stage still describe it exactly.
  What there is no longer a way to ask for is the old behaviour:
  `insertion-order` is still in the package and still unexported, kept as the
  roster-order reference the ordering tests measure against rather than as a
  stage anyone can select. A run that wants to spend less than the default does
  can turn the transpose pass off with
  `barycenterOrder({ maxTransposePasses: 0 })`, or the sweeps down with
  `maxSweeps`, which is the same lever it always was.

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

- **Cycle breaking now leaves the strongly connected components alone.** An edge
  running backwards in the greedy vertex order is reversed only when its two
  endpoints lie in the same strongly connected component. A backward edge
  between two components lies on no cycle, so no cycle needs it turned round,
  and turning it round only stretched the view. **Layouts of a graph with a
  backward edge whose endpoints lie in different components return different
  coordinates and a smaller `reversedEdges`; a graph whose cycles all sit
  within one component is unaffected.** No type and no exported name changed.
  (M2.2b)

  What it costs and what it buys, measured on both benchmark corpora. The
  drawing gets TALLER and its edges get SHORTER overall: on the 10k corpus the
  acyclic view goes from 154 ranks to 203, a rise of 32%, while the total
  distance its edges travel falls from 1,414,263 rank crossings to 1,359,680, a
  cut of 3.9%; on the 1k corpus it goes from 62 ranks to 81, a rise of 31%,
  while the total falls from 40,430 to 22,726, a cut of 44%. Read the two
  percentages together rather than the 44% alone: this is a trade, and it is a
  much better one on the smaller graph.
  That total is what decides how many stand-in nodes a long edge is split into,
  which is the number a caller feels. Reversals fall too, 6,327 to 4,620 and
  422 to 74. The pass also got faster, 8.5ms median against 11.0ms on the 10k,
  because computing the components replaced the per-vertex arc maps rather than
  running in front of them.

  It moves `network-simplex-rank`'s headline figures, and NOT because that
  stage changed: its input is better, so it has less left to win. Read the two
  entries together, and note that every figure in this paragraph was itself
  superseded by M2.2c, whose entry above has the current ones; "the new view"
  below means M2.2b's view, which is no longer the one that ships. Over that
  view the 1k corpus is 22,726 dummies down to
  15,713 at the default budget, a 31% cut where the entry above says 57%, and
  the 10k corpus is 1,359,680 down to 268,589, an 80% cut where the entry above
  says 70%. At 200,000 pivots the 10k reaches 226,676, which is 0.8% above what
  the old view reached at the same budget: the old view had more of its gain
  still ahead of it, and quoting a simplex figure without its pivot budget
  hides exactly that.

### Notes

- M3.3 changed no code here. `relayout` already took a patch of any length, so
  `graph.batch` from `@dagr/graph` needed nothing widened: a batch arrives as one
  patch and relays out once. What landed in this package is the measurement that
  decided it, in `test/layout.relayout.test.ts`: a node added and then wired up
  is reported at two positions unbatched, the first of which it does not keep,
  and at one batched. `graph.batch` is the recommended shape for a multi-step
  edit and the docs page says so.

- `@dagr/graph` is a peer dependency, not a regular one. Its `#private` fields
  make `Graph` nominally typed, so two copies in a tree are not interchangeable.

## 0.1.0

Not yet released.
