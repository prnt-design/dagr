# Roadmap

Dagr ships one merge-worthy increment per day. Each task below is sized to be
one day's merge: tests, implementation, and docs together. Milestone status is
mirrored in the project brain; this file is the task-level plan and is revised
in place (with a note in the brain) when reality disagrees with it.

Quality bar for every task: TDD (failing test first), green typecheck and
tests, benchmarks within 10% of baseline once they exist, persona review
findings addressed or logged, docs land with the feature.

## M0: Foundation

- [x] **M0.1** pnpm monorepo scaffold: `packages/{graph,layout,render,react}`,
  `apps/demo` (Vite + React 19), `docs` (Docusaurus). TypeScript strict,
  vitest, eslint, root scripts (`typecheck`, `test`, `bench`, `build`,
  `lint`), CI running typecheck + test on every PR and push to `main`.
  This document. First green merge.
- [x] **M0.2** Benchmark harness: vitest bench setup, a `bench` baseline
  capture script, baseline JSON committed, CI bench step comparing against
  baseline with a 10% tolerance. README development guide section.
  Deliberately deferred until early M1 lands real code worth benchmarking.
  That trigger fired with M1.3, which landed patch emission on every mutation,
  the first hot path in the repo a baseline is meant to protect.
  Decided here, because "within 10% of baseline" does not survive being read
  literally against wall-clock milliseconds measured on a shared runner, and a
  gate that cries wolf gets muted, which is worse than no gate because it also
  looks like coverage. Three parts, all in `bench/README.md`. Each benchmark is
  recorded as a RATIO against a fixed control workload run beside it in the same
  worker, so a runner twice as slow runs the control twice as slow too and the
  ratio holds; two workers agreed on the control to within 1%. It compares
  MEDIANS, not means, because one garbage collection drags a mean a long way: a
  0.016ms operation here recorded a 12ms maximum, 4.9% of margin of error on the
  mean, while the median barely moved. And the tolerance WIDENS BY THE MEASURED
  NOISE of both runs, `10% + 5% control drift + baseline rme + current rme`
  capped at 25%, so a noisy runner gates wider on evidence rather than failing at
  random. That would make a noisy enough benchmark unfailable, so past 15% of
  margin of error a measurement is reported as inconclusive rather than passed.
  The 5% is a separate term because it is a different error: `rme` is sampling
  noise inside one measurement, while control drift is systematic, since one
  control cannot normalise arithmetic, allocation and cache behaviour at once.
  Measured on `2.5k outEdges`, nearly pure pointer chasing against an
  allocation-heavy control: five runs on one idle machine, no code change, its
  own margin of error steady near 0.7%, landing between -9.5% and +9.9%. So the
  effective floor is nearer 15% than 10%, said plainly rather than dressed up,
  because the honest reading of the charter's 10% is 10% of a number this
  harness can actually resolve. Shrinking it is earned by a second control for
  low-allocation work, not by asserting a tighter number than the measurement
  supports.
  A run too noisy to read is not a red build and not a pass either: it says
  nothing about the code, so `pnpm bench:ci` measures again. CI runs `pnpm build`
  immediately before the bench step, and a run started while the machine was
  still busy with it put 7 of 10 benchmarks past the readability ceiling where
  the same benchmarks on a settled machine came back all readable and inside
  tolerance. A regression exits 1 and is never retried; only an unreadable run
  exits 2. Two unreadable runs in a row fail, saying plainly that nothing was
  measured.
  Verified against the case that motivated the task rather than asserted: with
  the `diffAttrs` allocation guard reverted, all 329 tests still pass and the
  gate fails at +87.8% against a +25.0% allowance on the one benchmark that
  should move, with no false positives elsewhere.
  The exemption path M4.10 needs is explicit, not accidental. A baseline entry
  carrying `"gate": "off"` must also carry a `reason`, or the gate hard-errors;
  an exempt entry need not appear in a run at all, so a hand-measured number can
  live in the baseline; and `pnpm bench:baseline` carries exempt entries across
  rather than deleting them on the next capture.
  Most of the harness is guards against the gate becoming a silent no-op again,
  which is the disease it was written to cure. It fails on a run that collected
  nothing, a baseline with nothing to gate against, a benchmark that vanished
  from the run, a bench file with no control, a duplicate key, and stale reports.
  Corpora are seeded and shared: `smallCorpus()` at 1k nodes and 4k edges,
  `largeCorpus()` at 10k and 40k, emitting plain descriptions rather than a
  `Graph` so `@dagr/graph` can benchmark itself without the kit and the package
  it measures depending on each other, and so M4.10 can take the same corpus as
  coordinates. M2.9, M3.9 and M4.10 all measure against the 10k one, so they
  compare to each other only if the shape stays put.
  First numbers, on an Apple M4: the rank stage is 13.7ms on 10k nodes and 40k
  edges against a 33ms figure a reviewer measured on a different machine and a
  more cyclic graph, the full pipeline is 33ms on the same corpus, `successors`
  costs 6.1x `outEdges` over the same nodes (the array materialisation the M1.2
  review flagged and M2.5 deferred), and a watched attribute update costs 2.0x
  an unwatched one against the 1.8x M1.3 measured.

## M1: Graph model (`@dagr/graph`)

- [x] **M1.1** Core graph: `Graph` with node/edge add/remove/get, stable
  string IDs, adjacency queries (successors, predecessors, edges between).
  Unit tests for every operation and error case.
- [x] **M1.2** Attributes and ports: typed attribute bags on nodes, edges,
  and the graph; port declarations on nodes; edges may reference ports.
  Tests for attribute round-trips and port validation.
  Decided in M1.1 review, to be implemented here: the entry point becomes an
  object init, `addNode({ id?, attrs? })` and `addEdge({ source, target, id?,
  attrs? })`, with the plain string forms kept as shorthand. Attributes do not
  become another positional argument. Nothing is published yet, so the change
  costs nothing now and is why it was not forced into M1.1.
  Also decided: node and edge records are frozen at construction, so attribute
  updates are copy on write. An updated record is a new object and unchanged
  records keep their identity, which makes `getNode(id) === previousNode` a
  valid "nothing changed here" test for React memoisation in M5.
- [x] **M1.3** Patches: every mutation emits a `Patch`; `apply(graph, patch)`
  reproduces the mutation; inverse patches for undo. Property-based tests
  (fast-check): patch/apply round-trips on random mutation sequences.
  Decided here: `apply` restores content but not insertion order. A replayed
  element is a new insertion and lands at the end of iteration order, which is
  the determinism rule M1.1 already set rather than a shortcut taken in replay,
  so the round-trip properties compare a normalised structural snapshot that
  deliberately excludes order. `remove-port` records the `index` it was removed
  from anyway, because that is part of an honest description of the mutation
  and delta consumers want it even while `apply` appends. The reasoning is in
  the `apply` docstring in `packages/graph/src/patch.ts`. Whether replay should
  become order faithful is not decided here: it belongs to the first milestone
  that needs it, which is M3, and the note is on M3.2 where a patch consumer
  will find it.
  Also decided: no batching or transaction API. One state-changing call emits
  one patch, several mutations cannot be coalesced into one, and no listener
  can see a half-finished edit. Nothing needs the coalesced form yet, and M3
  incremental layout is what will say what shape it wants (how a batch
  interacts with `invert`, whether a batch may span a failed call), so building
  it now would be the speculative surface this project has twice decided
  against. The addition is source compatible whenever it lands, so waiting
  costs nothing.
- [x] **M1.4** Traversal and invariants: topological sort, cycle detection,
  sources/sinks, reachability. Property tests on random DAGs and random
  digraphs with cycles.
  Landed as eight methods on `Graph` (`topologicalOrder`, `isAcyclic`,
  `findCycle`, `sources`, `sinks`, `descendants`, `ancestors`, `canReach`) over
  an internal `traversal.ts`. The algorithms take an `AdjacencyView` rather than
  a `Graph`, which is what makes `ancestors` be `descendants` pointed the other
  way instead of a second implementation that can drift; the view is not
  exported, the same call M2.2 made in keeping only `defaultStages` public.
  The walks read the adjacency indexes directly rather than going through
  `successors`, because M0.2's benchmarks put `successors` at about 6x
  `outEdges` over the same nodes and a traversal would pay that per node.
  Decided here, and it is the one that cost a rewrite. TIES IN
  `topologicalOrder` GO TO THE EARLIEST-ADDED NODE, not to whatever a queue
  happened to hold. A first-in-first-out sweep is deterministic given the whole
  history, but when relaxing one node frees two others they queue in the order
  those two EDGES were added, so adding a redundant parallel edge or rebuilding
  the same graph in a different order permutes the result. The property suite
  caught exactly that against the first implementation, which had shipped a
  docstring promising otherwise; the unit case was too simple to expose it.
  Picking the smallest ready insertion rank costs a heap, about 10ms on the 10k
  corpus, and buys the promise the docs now state: traversal answers do not
  depend on the order the EDGES arrived in. Not a stronger promise than that,
  and an earlier draft of both the docs and this entry overclaimed it as "a
  function of the graph, not of the sequence that built it", which two reviewers
  independently disproved in three lines. Node insertion rank IS the tie-break,
  so node order still decides how independent nodes fall; making traversal
  invariant to that too would mean tie-breaking on something intrinsic to the
  id, which is a much larger decision. A plain-queue sweep did measure faster in
  development, but against an implementation and an acyclic view that are both
  gone, so no tracked number stands behind a ratio and none is quoted. Worth the
  cost regardless for a model whose selling point is stable identity, and 10ms
  on 10k nodes is not the bottleneck in anything that then lays them out at
  about 30ms. A cheaper unordered sweep is an additive second entry point if
  someone asks, not a quiet default.
  Also decided: a cyclic graph has no topological order, so `topologicalOrder`
  throws `CycleError` (the family's tenth member, carrying a witness) rather
  than returning a partial order that invites use, with `isAcyclic` and
  `findCycle` as the tolerant forms, exactly as `hasNode` is the tolerant form
  of a lookup that throws, though unlike `hasNode` those guards are full walks,
  so the docs show catching rather than checking as the cheaper idiom. A self
  loop is a cycle, and its node is neither a source nor a sink; `@dagr/layout`'s
  ranker deliberately differs and drops self loops, because a self loop
  constrains nothing about rank.
  `descendants` and `ancestors` EXCLUDE their own node, even on a cycle, which
  reversed the first implementation after review: the name carries a strong
  prior (networkx's `descendants` always excludes the source) and a name with a
  prior that strong loses to it, silently, and only on the cyclic graphs this
  package permits. `canReach` stays at one or more edges, so `canReach(a, a)`
  answers "is `a` on a cycle". That is the one case where the two disagree and
  it is what makes dropping the seed costless.
  Baseline note: `bench/baseline.json` was recaptured wholesale here, which is
  the harness's only mode, so ratios for benchmarks this task does not touch
  moved a few percent within tolerance (control drift, documented in
  `bench/src/gate.mjs`). Nothing was absorbed: the traversal entries are new and
  the rest are unchanged code. A `--only` flag so adding a benchmark stops
  rebasing the others is worth having and is not built.
- [x] **M1.5** Serialization: `toJSON`/`fromJSON` with identity-preserving
  round-trips, property-tested. Serialization section added to the graph model
  docs page (the page itself shipped with M1.1).
  Landed as `graph.toJSON()`, the static `Graph.fromJSON(json)`, four document
  types, and a `serialize.ts` holding the format and a pure `unknown`-to-
  document validator, with `graph.ts` keeping construction. Same seam as
  `traversal.ts`, and it buys the same thing twice: no import cycle, and "every
  shape error is found before anything is built" becomes a fact about where the
  code sits rather than a discipline.
  Decided here: THE ROUND TRIP PRESERVES ORDER, which is a stronger promise than
  M1.3's `apply` makes and is the reason this task is not just `apply` with a
  file around it. Insertion order is observable three ways in this model
  (iteration order, neighbour order, the `topologicalOrder` tie-break M1.4 paid
  a heap for), so a restore that permuted it would restore the content and hand
  back a different graph. It costs nothing at all: writing in insertion order
  and replaying in that order is the obvious implementation, and the property
  suite deliberately compares order-sensitively with no sorting anywhere, which
  is what M1.3's suite could not do.
  Also decided: generated-id counters are re-derived from content rather than
  serialised, and that leaves one divergence, stated in the docs rather than
  left to be found. Re-deriving lands the counter one past the highest
  SURVIVING id in generated shape that the counter accepts, so a suffix above
  that, spent by an element the original removed, is free again after a round
  trip and the restored graph can generate an id the original had retired. The
  claim was tightened twice, both times by a test rather than by argument. The
  first draft was looser (any removed suffix) and a removed `n1` under a
  surviving `n2` disproved it, because the counter is a maximum. The second
  still overstated it: a survivor at or past `Number.MAX_SAFE_INTEGER` never
  moves the counter, since arithmetic there is not exact, so it is invisible to
  the re-derivation and every smaller suffix comes back free however far under
  it they sit. Carrying the counters in the document would close both and was
  not taken: it puts a private implementation detail into a format other tools
  have to write, to fix a case where no id can collide and the two graphs
  merely disagree about which ids are spent. Callers who care should write
  their own ids, which round trip exactly.
  Also decided: shape errors get `InvalidGraphJSONError` (the family's eleventh
  member, carrying the `path` of the offending field so a hand-edited file is
  debuggable), and content errors REUSE the family. `fromJSON` builds by calling
  the same public constructors any other caller would, so it cannot construct a
  graph the public API could not, and there is no second dialect of "duplicate
  node" for the deserialization path. The line between the two is that shape is
  what one field decides without reading the rest of the document, which is why
  an empty id is a shape error here and not the `InvalidIdError` the same value
  earns from `addNode`: the review found it was the one content error carrying
  nothing to search a hand-edited file for, and moving it buys the `path` the
  others get for free. Attribute values pass through by reference, unvalidated
  and uncloned, because the graph never reads one.
  Fifteen defensive branches were each broken on purpose and confirmed to turn
  the suite red, which is how the `__proto__` and empty-omission branches were
  shown to be covered rather than argued to be.

## M2: Layout core (`@dagr/layout`)

- [x] **M2.1** Pipeline skeleton: `LayoutInput`/`LayoutResult` types, stage
  interfaces (rank, order, position, route), a pipeline runner wiring
  pass-through stages, node size/spacing config. Tests for the plumbing.
  Decide here whether ports get attribute bags. `Port` is the only graph
  element without one, so port geometry (side, offset, label) has nowhere to
  live, and M1.2's review deliberately deferred the decision rather than
  inventing the bag before layout knows what a port needs to carry, which is
  the mistake M1.1's review avoided with adjacency traversal. The change stays
  source compatible whenever it lands, so the decision is cheap: `Port<A
  extends object = Attrs>`, an `attrs?` on `PortInit`, a fourth defaulted
  `Graph` type parameter, and `updatePortAttrs`.
- [x] **M2.2** Cycle breaking + ranking v1: greedy feedback-arc-set cycle
  breaker, longest-path ranking. Invariant tests: every edge points downward
  in rank after reversal bookkeeping.
  Landed as two internal modules, `cycles.ts` (Eades-Lin-Smyth GR over the
  weighted simple condensation, degree buckets, O(V + E)) and `rank.ts`
  (`longest-path-rank`, a Kahn sweep over the acyclic view), with the
  single-rank placeholder deleted rather than left as dead code. Self loops are
  never reversed and never ranked, all parallel copies of a pair go the same
  way, and the graph is still never mutated. The descent the stage produces is
  strictly stronger than the runner's `<=` contract check, which stays weak on
  purpose for self loops and for M2.4b's long edges, so the strict form is
  asserted in the stage's own tests instead.
- [ ] **M2.3** Ranking v2: tight-tree / network-simplex rank tightening.
  Golden comparisons against longest-path on a small corpus; rank sum must
  never regress.
  Two requirements added by the M3 planning review, both cheap here and not
  retrofittable later, because they are about the ranker's internal structure.
  First, the ranker must expose a warm-startable form, accepting a previous
  tight tree or previous ranks as its initial basis. The ranking LP is
  degenerate: many distinct tight trees reach the same total weighted edge
  length, and which optimum the simplex lands on depends on the initial
  feasible tree and the pivot sequence. So without a warm start a one-edge
  patch can move the solver to a different optimum of equal cost, churning
  ranks across a wide region while improving nothing, which makes M2.3 a
  stability regression against the deterministic M2.2 longest-path ranker it
  replaces. Warm starting from the previous tight tree is the textbook
  advantage of simplex here, and it is most of M3.7's performance story too.
  Second, "rank sum must never regress" passes with flying colours while ranks
  churn between equal-cost optima, because churn does not change the sum. Add a
  rank-stability check: re-ranking after a trivial perturbation must not move
  ranks that a tight-tree argument says are forced.
- [x] **M2.4a** Stage return types: the four stage interfaces return only their
  own contribution rather than the whole next record.
  Decided here, and no later, whether the four stage interfaces should return
  only their own contribution rather than the whole next record. Raised by the
  M2.2 API review against `rank.ts`, which ended
  `return { ...input, ranks, reversedEdges, virtualNodes: new Set() }`: the
  spread carried back `graph`, `config` and `sizes` that the stage has no
  opinion about, and `virtualNodes` was a required field a pre-M2.4b ranker has
  nothing to say about. The proposal was a `RankOutput` (and three siblings)
  holding that stage's fields alone, with the runner merging into the `...State`
  record, which leaves the extends-chain and everything a stage can READ exactly
  as it is, and makes `checkGraphKept` dead code because replacing the graph
  stops being representable. It was not done in M2.2 because it is a breaking
  change to all four public stage interfaces and M2.2's increment was the
  algorithm; doing both in one run would have made the diff hard to review and
  neither change would have been judged on its own. The reviewer's timing
  argument is why it was pinned rather than left open: M2.4b is the first
  milestone where a real stage populates `virtualNodes` and `sizes`, and after
  that the migration stops being mechanical.
  Landed exactly as proposed, and split out of M2.4 for the same reason M2.2
  did not carry it: M2.4 was two changes, a breaking interface change and the
  dummy-chain algorithm, and the review's own argument against doing both at
  once applies unchanged to doing both here. Landing the interface FIRST is what
  satisfies the timing argument, so M2.4a is this and M2.4b is the chains.
  `RankOutput`, `OrderOutput`, `PositionOutput` and `RouteOutput` are exported;
  `checkGraphKept` and the `graph` label on `StageContractError` are deleted
  rather than left as a check that cannot fire. One thing changed shape beyond
  the proposal: `RankOutput.virtualNodes` is a `ReadonlyMap<NodeId, Size>` and
  is optional, because declaring a node and sizing it are one act, which makes
  "declared but unsized" unrepresentable rather than checked and stops a ranker
  overwriting the size the caller's own node was measured at. The runner derives
  the roster set and the roster-wide `sizes` map from it, sharing the prepared
  map untouched when nothing was declared. The roster-wide size check narrowed
  to the declaration alone rather than going away: three reviewers found the run
  had over-claimed here, and the review fixes restored the LOOKUP half of it,
  because `PreparedState.graph` is live and a stage that adds a node to it puts
  a member in the roster that prepare never sized. The four `...Output` types
  also gained `never` fields for every field the runner owns, which is what
  makes "a stage does not hand a graph back" a compiler rule rather than a
  claim: TypeScript does not excess-property-check a spread, but it does check a
  declared property through one. Pinned case by case in
  `test/stage-output.types.test.ts`. No observable behaviour changed, pinned by
  a whole-result equality against a layout captured from the previous
  implementation.
- [ ] **M2.4b** Dummy-node chains: split long edges across ranks into virtual
  nodes, rejoin on output. Tests: chain integrity, no multi-rank edges reach
  later stages.
  Dummy ids must be a deterministic function of the edge and the rank
  (`#dummy:<edgeId>:<rank>` or equivalent), never a counter and never iteration
  order, so a chain's identity is stable across runs by construction with no
  bookkeeping. This is a hard requirement of M3 and it is recorded here because
  M2.4b is unbuilt: changing dummy ids after M2.5 through M2.9 commit golden
  files is a corpus-wide migration, and adding it now costs nothing. Without it
  every dummy is a node M3.6's warm start has never seen and M3.8 has no
  previous coordinate to anchor, so a long edge visibly jitters between two
  endpoints that did not move at all, on every patch, forever, while
  node-displacement metrics score it as perfect stability. On a real Sugiyama
  layout dummies typically outnumber real nodes, so this is most of the
  geometry rather than a corner of it. Test what happens when a chain's rank
  span changes: growing from three ranks to four should keep the three stable
  dummies and gain one.
  The deterministic-id rule is necessary and NOT sufficient, and the M2.4a
  review found the missing half. Ids fix a dummy's identity; they do not fix its
  index within its layer, which came out of the ranker's declaration order and
  would therefore shift every later dummy whenever an unrelated edge was added
  upstream of it, moving the bends of long edges whose endpoints did not move.
  The runner now sorts the declared ids by id before putting them in the roster,
  which is what completes the rule, and it is done there rather than in
  `insertionOrderStage` because M2.5 replaces that stage wholesale while every
  future order stage reads the roster.
  Be precise about what that sort buys, so this milestone does not over-claim
  it. It removes the dependency on the ranker's declaration order, and nothing
  more. It does NOT make a layer's indices stable when a dummy is INSERTED into
  that layer: anything joining a row still shifts everything after it under
  `gridPositionStage`. That residue belongs to M2.7's coordinate assignment, not
  here.
  Two things M2.4a's chain checks deliberately do not establish, both worth
  knowing before reading five green rules as more than they are. An orphan
  dummy, declared but in no chain, is legal and stays legal: a long edge split
  is only the first reason to want a node the caller never added. And a chain
  may SKIP a rank it crosses, so a single dummy at rank 1 on an edge from rank 0
  to rank 3 passes every check and routes across rank 2 with no bend. Tightening
  that needs a definition of what an edge "spans", and the obvious one (steps of
  exactly one) assumes contiguous integer ranks, which `insertionOrderStage`
  explicitly refuses to assume. Decide it here, where a real splitter finally
  gives "spans" a meaning.
  Prepared in M2.1 and settled in M2.4a, so this is a ranker change and not an
  interface change: the pipeline works over a roster (the graph's nodes plus
  whatever the rank stage declares in `RankOutput.virtualNodes`), a declared
  dummy is checked exactly as hard as a real node (rank, size, exactly one
  layer, a position), the default order stage already places roster members, and
  the runner already refuses to let a dummy reach `LayoutResult`.
  `RankOutput.virtualChains` is declared too, with its contract checks already
  written: which edge each dummy serves and in what order, source to target as
  the CALLER authored them, so the router rejoins a chain from the record rather
  than by parsing dummy ids back apart. That direction makes the rank check
  strictly MONOTONIC (increasing normally, decreasing for a reversed edge) and
  not strictly increasing. What is left here is the chain splitting itself and
  rejoining the chain into a polyline on output.
- [ ] **M2.5** Ordering v1: barycenter sweeps with median fallback, crossing
  counter as the metric. Tests on known small graphs with hand-counted
  crossings. Also measure adjacency allocation churn in the sweeps (every
  `@dagr/graph` adjacency query returns a fresh array) and add a
  non-allocating traversal form there if it shows up in the profile.
  Record what seeds the starting permutation, because barycenter sweeps are
  sensitive to it and M3.6 warm-starts from exactly this. Today's placeholder
  (`insertionOrderStage`) orders each layer by roster order, graph nodes then
  virtual nodes; state whether the real stage inherits that or chooses
  otherwise, so M3.6 depends on a recorded decision rather than on an inference
  about a stage that no longer exists by then.
- [ ] **M2.6** Ordering v2: transpose refinement pass; crossing-count
  regression corpus committed as golden files.
- [ ] **M2.7** Positioning: Brandes-Koepf horizontal coordinate assignment
  (or median-based v1 with the interface ready for BK). Invariant tests: no
  node overlaps, spacing respected.
- [ ] **M2.8** Edge routing: polyline routes through dummy-node coordinates,
  monotone in the rank axis. Route invariant tests.
  From the M2.1 algorithms review: this is where `bounds` stops being the hull
  of the node boxes, because a route that goes around an obstacle can leave
  them. The runner contracts containment rather than tightness for exactly that
  reason. The durable formulation, worth adopting here, is the hull of the node
  boxes and the route points, which is equivalent today and stays true after
  this lands.
- [ ] **M2.9** Golden corpus vs dagre: port a corpus of real graphs
  (including a prnt.design-shaped pattern-generator graph), assert
  structural parity metrics vs dagre output (rank counts, crossing counts
  within tolerance). First layout benchmarks (1k and 10k node graphs) with
  committed baselines.
- [ ] **M2.10** Worker mode: same layout API sync or in a worker
  (`layoutAsync`), transferable-friendly data. Worker mode section added to the
  layout docs page (the page itself shipped with M2.1).
  From the M2.1 API review: the async entry point is the same
  `createLayout({ stages, config })` engine as M3.2's `relayout` (see the note
  there), as `engine.runAsync(graph)`. Keeping functions out of `LayoutInput` is
  deliberate and this is why: that object crosses a worker boundary and has to
  survive structured cloning, so stages and the `nodeSize` callback stay
  arguments of the call and of the engine, never fields of the input.

## M3: Incremental layout

Patch in, deltas out, untouched nodes keep their positions. This is the
project's differentiator, so it gets the heaviest algorithms review of any
milestone. Every task is tagged with the packages it touches, because M3 spans
`@dagr/graph` and `@dagr/layout` rather than sitting in one package the way M1
and M2 do.

Ordering principle for the whole milestone: correctness first, then the
measurement, then speed. M3.2 ships a `relayout` that is fully correct and no
faster than a cold run, M3.4 ships the metrics that say what stable means, and
only then do M3.5 through M3.9 make stages incremental, each judged against a
baseline that already exists. The alternative (write the incremental stage
first, then work out how to tell whether it is right) is how layout libraries
end up with stability as a claim rather than a test.

M3.1, M3.2 and M3.3 need only what M2.1 already shipped. M3.4 onwards want the
M2 pipeline to be real (M2.7 positions, M2.8 routes), because a stability metric
over pass-through coordinates measures nothing. Two tasks sit behind more of M2
than that: M3.6 needs M2.6's crossing corpus, and M3.9 needs M2.9's 1k and 10k
benchmark baselines.

M3 also depends on two requirements now recorded upstream, both added by this
milestone's planning review and both placed on the unbuilt task that owns them:
M2.4b's dummy ids must be a deterministic function of edge and rank, and M2.3's
network simplex must be warm-startable. Neither is retrofittable from inside M3.
If either lands without its requirement, say so here rather than working around
it, because both defeat stability in ways the node-displacement metrics cannot
see.

- [ ] **M3.1** (`@dagr/layout`) Delta model: `LayoutDelta` computed by diffing
  two `LayoutResult`s: nodes added, removed and moved, edges added, removed and
  rerouted, and the changed bounds. A pure function over two results, so it
  needs no engine and no incremental algorithm, which is why it goes first:
  every later task in this milestone is judged by the delta it emits, and this
  is the thing that emits it. Tests on hand-built results, plus property tests
  (diffing a result against itself is empty; applying `diff(a, b)` to `a`'s
  geometry reproduces `b`'s exactly at epsilon zero, and to within epsilon
  otherwise, which is the only form of that property that survives the
  tolerance decided below).
  Decide here, because this task owns it and nothing later gets to revisit it
  cheaply: the delta's exact shape. Four questions, none of them obvious.
  Absent or flagged: an unchanged node does not appear at all, or appears with
  an unchanged marker. Absent keeps the delta proportional to the change, which
  is the whole point, and is what M4.7's spring consumer wants (nothing to
  animate). Flagged makes a delta self-describing, so a consumer can rebuild a
  scene from one delta without holding the previous result.
  Arrays or keyed records: `{ moved: Array<{ id, from, to }> }` against
  `{ moved: Record<id, { from, to }> }`. Arrays are cheaper to build and carry
  an order; records are O(1) to query, which a renderer holding instance
  indices wants.
  Absolute, relative, or both: springs retarget to an absolute position, so the
  new position is required. The displacement is derivable from `from` and `to`
  and is exactly what M3.4's metric sums, so carrying it as a third field is
  either a convenience or a cache to keep consistent.
  Tolerance: whether a sub-pixel move is worth reporting. The reason is
  consumer-facing (a move too small to see is not worth animating) and not
  numerical: IEEE 754 is deterministic, so a stage given the same inputs and
  the same operation order returns bit-identical output, and a bit-different
  answer is a determinism bug to fix rather than a wobble to threshold away.
  It belongs in `LayoutConfig` rather than as a constant, because it is in
  node-size units and only the caller knows that scale.
  A nonzero epsilon carries a design consequence that belongs in this task
  because this task owns the epsilon: a threshold on a diff is not transitive.
  Fifty patches each moving a node by 0.9 epsilon each report nothing and leave
  a consumer's scene 45 epsilon out of position, with nothing in the system
  able to notice, which is M4.7's desynchronisation failure arriving from the
  delta layer instead of from a dropped delta. So the diff has to compare
  against the last REPORTED geometry rather than the last computed geometry,
  which means the engine retains a reported-geometry snapshot distinct from its
  true pipeline state. Note that on an anchored fast path untouched coordinates
  are copied and therefore bit-identical, so the epsilon only ever does
  anything on the fallback path.
  `LayoutDelta` is public surface from the run it ships in, and both
  `@dagr/render` (M4.7) and `@dagr/react` (M5) consume it, so it is worth
  spending this run's API review on.
- [ ] **M3.2** (`@dagr/layout`) Layout engine and patch-driven relayout:
  `createLayout({ stages, config })` with `engine.run(graph)` and
  `engine.relayout(patch)`, emitting an M3.1 delta. `relayout` here re-runs the
  full pipeline from the retained warm-start state; no stage becomes
  incremental in this task. That is deliberate. A correct and slow `relayout`
  makes the delta contract, the engine lifetime and the retained state testable
  before any incremental algorithm exists, and it gives M3.5 through M3.9 a
  correct baseline to be measured against instead of nothing.
  Ship the influence set as an observable output of `relayout` from this task
  on, where its trivial implementation reports the whole roster. That is what
  breaks the circularity between M3.4 and M3.5: M3.4's contract becomes
  testable immediately (vacuously true against the trivial set), M3.5 becomes a
  narrowing of something already observable rather than a new concept, and
  M3.9's fast paths assert against the same object. It also buys a free
  regression guard, because the influence set should shrink monotonically
  across M3.5, M3.7 and M3.9 and that is assertable.
  Two things to state here rather than discover. Retained state must stay
  proportional to the live graph, not to patch history: `RoutedState` covers
  the whole roster (real nodes plus dummies, which on a 10k graph with long
  edges is the larger half) plus a route per edge, and the reported-geometry
  snapshot M3.1 requires is a second such map. The natural incremental
  implementation leaks in an unremarkable way, by never deleting a removed
  node's entry because nothing on the fast path iterates the map to notice. A
  leak there is invisible to every M3.4 metric and shows up as a browser tab
  growing over an afternoon of editing, so M3.10's churn sequence asserts
  retained map sizes return to baseline after a balanced add and remove cycle.
  Second, say how `relayout` relates to M2.10's `runAsync`. If the layout ran
  in a worker the retained state lives in the worker, so `relayout` is either
  async as well or silently sync-only, and the consumer who adopted `runAsync`
  for a 10k graph is exactly the one who most wants `relayout` and will reach
  for `relayoutAsync`. Note the structured-cloning constraint M2.10 already
  identified applies to the delta travelling back, which is an argument for
  M3.1's array-based shape over anything holding a `Map`.
  Decided in the M2.1 API review, to be implemented here. The reviewer's
  argument: a free `relayout(prev, patch)` can be handed stages or a config that
  disagree with the run that produced `prev`, and the result is a silently wrong
  answer rather than an error, because nothing in a `LayoutResult` records what
  produced it. Separately, `LayoutResult` drops the ranks, layers and
  `reversedEdges` that a warm start needs. The answer to both is one object
  rather than two fixes: `relayout` arrives as part of a
  `createLayout({ stages, config })` engine that binds stages and config once,
  with `engine.run(graph)`, `engine.runAsync(graph)` (M2.10) and
  `engine.relayout(patch)` on it. `layout()` stays as sugar for the one-shot
  case.
  The engine retains the final `RoutedState` internally, and that is where warm
  start state comes from. This is exactly why `LayoutResult` was NOT given a
  `state` carrier field in M2.1: the result stays small, serializable, and free
  of a required field that every consumer would have to route around, and the
  pipeline state stays where the thing that can use it lives. M2.1's fix 2 (the
  route stage returning a `RoutedState`, with the runner assembling the
  `LayoutResult` from it) is what makes retaining it cost nothing: the runner
  already holds that record.
  The engine was deliberately not built in M2.1. Nothing is published, so the
  shape is not locked in, and a binding object with nothing yet to bind (no
  `runAsync`, no `relayout`) is the speculative surface this project has twice
  decided against. What M2.1 does ship is the name: `LayoutStageOverrides` is
  exported and used in the `layout` signature, so the engine's `stages` argument
  already has a public type.
  Order-faithful replay is decided here if anywhere, deferred from M1.3.
  `apply(graph, patch)` restores a patch's content exactly but not insertion
  order: a replayed element is a new insertion and lands at the end of
  iteration order. That is invisible to a warm start driven from the retained
  `RoutedState` above, and it is not invisible to a consumer that rebuilds a
  graph by replaying patches into it, because ordering seeds from node
  insertion order and adjacency, so the same content in a different order is a
  different layout. If this task or M3.5's influence regions turn out to need a
  replayed graph to iterate like the original, this is the point to make replay
  order faithful; `remove-port` already carries the `index` such a change would
  need, and the add ops would need the equivalent. If nothing here needs it,
  leave `apply` as it is and say so, rather than carrying the question further.
  (This decision was pinned to M3.2 by M1.3 and stays on M3.2 through this
  expansion. Untouched-subgraph detection, which the M1.3 note reached for as
  M3.3, is now M3.5.)
- [ ] **M3.3** (`@dagr/graph`, `@dagr/layout`) Patch batching, or the recorded
  decision not to have it. M1.3 declined to build batching and transactions on
  the grounds that M3 incremental layout is what will say what shape it wants:
  how a batch interacts with `invert` (one inverse patch, or a reversed list of
  them), whether a batch may span a failed call (all or nothing, or a partial
  commit), and whether a listener sees the batch, the individual patches, or
  both. M3.2 is that consumer, so this is the first run that can answer from
  evidence instead of taste.
  The strongest argument for batching is not the performance one and does not
  need a number, which is what makes it usable in this task rather than after
  M3.9. Without batching, the engine lays out and emits deltas for intermediate
  states that are not meaningful graphs. Building "add node, add edge, add
  edge" as three patches means relayouting a graph containing a disconnected
  singleton, which gets ranked and positioned somewhere arbitrary, emits a
  delta, then corrects itself twice. By M4.7 those are three spring retargets,
  so a user watches a node fly in from the wrong place and then move twice more
  on every multi-step edit, and a pattern generator emits multi-step edits
  constantly. That reframes what batching is: not a coalescing optimisation but
  the boundary saying which graph states are allowed to be laid out and
  animated through, which may well change the answers to the sub-questions
  inherited from M1.3 (a listener seeing only the batch is the natural fit for
  a layout consumer, one seeing individual patches the natural fit for undo).
  The answer may still be no, and that is a real outcome rather than a failure.
  This project has declined a speculative surface twice already on the same
  reasoning, and if `engine.relayout` composes cleanly over a sequence of
  single patches the honest result is a note in the graph docs saying batching
  was considered and declined and why. Either way the run lands the test that
  settles it: a sequence of single patches through `engine.relayout` against
  the equivalent combined edit, asserting the same final layout. That test is
  the evidence for whichever answer is recorded, it is worth having on its own
  merits, and it means the declining run is a normal merge rather than one
  documentation paragraph against a daily-merge bar. Decide it here and do not
  carry the question past M3.
  Widening `relayout(patch)` to accept a batch is source compatible in either
  direction, which is exactly why M3.2 does not wait for this.
- [ ] **M3.4** (`@dagr/layout`) Stability contract and metrics: write down what
  stable means, and make it measurable, before any stage tries to be stable. A
  stability module computing mean and max node displacement, the fraction of
  nodes that moved, and rank and order churn between two `LayoutResult`s, plus
  the test helpers that assert on them. Unit tests on the metrics themselves
  (a known displacement produces the known mean), because a metric nobody
  tested is a number nobody can argue with.
  Node-centric metrics alone certify the wrong thing. A layout can score
  perfectly on all five while every edge in the drawing re-routes, which is
  exactly what an unstable dummy chain produces: node coordinates bit-identical
  and the polylines between them different on every patch. So the set has to
  include a per-edge route metric (summed or Hausdorff distance between the
  previous and current polyline) and bend-count churn. Same shape of
  computation, and it is what M4.5's ribbons and M4.7's springs are actually
  judged by.
  Decide here: is stability a contract or a metric? A contract is a hard
  assertion, that a node outside a patch's influence set keeps its coordinate
  exactly and violating it fails the build, which is the strongest form of the
  project's headline claim. It is testable from M3.2 onward because the
  influence set is an observable output there, vacuously true against the
  trivial whole-roster set and tightening as M3.5, M3.7 and M3.9 narrow it. A
  metric is a threshold on a corpus, which survives a full-relayout fallback
  but degrades quietly and lets a regression land as long as it stays under the
  bar. The likely answer is both (a contract on the fast paths, a metric on the
  fallback), but it has to be decided rather than drifted into, because M3.5
  through M3.9 are all written against whichever it is, and M3.10's docs
  promise it to users.
  Write the contract in a form that survives insertion, and do not let M3.8 be
  the run that discovers why. Take hard anchoring literally: untouched nodes
  hold their coordinates, M3.6 fixes the intra-layer order, and M2.7 requires a
  minimum separation. Now insert one node into a rank between two anchored
  neighbours exactly `nodeSep` apart. There is no coordinate for it. The system
  is infeasible, and the only exits are moving an anchor (so stability was
  never exact) or violating spacing (so M2.7's invariant test fails). That is
  not an edge case, it is the most common patch a pattern generator emits. The
  achievable claim is the weaker one and is still worth having: a node outside
  the influence set keeps its coordinate exactly, where the influence set is
  defined to include whatever an insertion widens. Anchors are therefore
  relaxable from the start (one-sided, or large but finite weight), and a
  contract asserting the impossible form must not ship in this task's test
  helpers.
- [ ] **M3.5** (`@dagr/layout`) Influence regions: given a patch and the
  retained pipeline state, compute the set of nodes and edges the patch can
  affect, and confine the relayout to it. Property tests: a patch confined to
  one weakly connected component produces an influence set naming nothing in
  another, and every change in the emitted delta falls inside the influence
  set.
  Phrased in terms of influence rather than emptiness because there is no such
  thing as a no-op patch: as of M1.3 a call that changes nothing emits nothing
  at all, so a test written against an empty patch would be testing an input
  the graph never produces.
  Decide here how influence is bounded, and start from the fact that every
  option is approximate. Reachability from the patch's endpoints is NOT the
  exact answer, which is the trap: influence travels three ways in a Sugiyama
  pipeline, down through successors (ranking), up through predecessors
  (barycenter sweeps run both directions), and sideways within a rank (ordering
  and compaction are per-rank, so inserting a node changes its rank-neighbours'
  barycenters and therefore their order, crossings and coordinates, and those
  neighbours need not be reachable from the patch in either direction). Closed
  under all three, the only exactly correct bound is the whole weakly connected
  component for any graph that is not a forest, which would make the
  milestone's headline claim true and useless. So the real decision is which
  quality regression is acceptable, the same decision M3.6 makes about its warm
  start, and the two should share one measurement rather than agree two
  tolerances separately. Of the bounded forms, a rank-span window is
  better motivated than k hops, because every stage in this pipeline is
  organised per rank and a rank-span window cuts along the grain of the
  algorithm where k hops cuts across it unevenly. Predicting this matters
  because the property test above is what fails, in the run that writes it, if
  a reachability-based set is chosen.
  Note the coupling to M3.8: once anchors are relaxable, the influence set is
  partly a consequence of the anchoring feasibility analysis rather than an
  independent graph computation, because a rank an insertion widens is
  influenced whether or not reachability says so.
- [ ] **M3.6** (`@dagr/layout`) Warm-started ordering: seed the order stage
  from the previous layout's per-rank permutation instead of insertion order,
  so a node whose neighbourhood did not change keeps its slot. This is the
  highest-leverage stability lever in a Sugiyama pipeline: crossing reduction
  is where a full run's answers wander most, because barycenter sweeps are
  sensitive to their starting permutation, and M2.5 records what seeds that
  permutation. Tests: an unchanged subgraph keeps its exact order across a
  relayout that adds a node elsewhere, and the M2.6 crossing corpus does not
  regress beyond the tolerance named below.
  Specify the seed precisely, because the natural implementation is the wrong
  one. The seed is keyed by NODE IDENTITY, carrying each node's previous rank
  and its previous index within that rank. It is never keyed by
  `(rank, index)` position: rank indices are not stable across runs,
  `OrderedState.layers` is a positional array so reading the seed straight out
  of `layers[r]` is the obvious and incorrect approach, and `RankedState.ranks`
  explicitly permits gaps and a nonzero base, so even a raw rank number is
  fragile between two runs of the same structure. Key by identity and all of
  that disappears. Define the rule for a node whose rank changed: it is a
  newcomer at its new rank, inserted at a barycenter-derived slot among the
  nodes there that kept theirs. Nodes that kept their rank keep their relative
  order, and the seed constrains relative order only, never absolute index.
  This has to hold from the first line of the task rather than from M3.7,
  because at this point the ranker is still M3.2's cold full rank and a cold
  rank of a changed graph reorders freely: one added edge shifts the rank of a
  whole subtree under longest-path ranking. That is also the answer to whether
  M3.7 should come first. It should not. M3.7 REDUCES rank churn, so building
  the warm start against the noisy cold-rank baseline is the more demanding
  test, and a warm start that survives it survives incremental ranking
  trivially.
  Record the tension rather than hiding it: a warm start is by construction a
  constraint on the crossing-reduction search, so it cannot beat an
  unconstrained sweep and will usually lose to it. The M2.6 corpus is precisely
  what notices. Name the crossing tolerance in this task and say who set it,
  rather than leaving "an agreed tolerance" to be agreed by whoever needs to
  pass it, which is how a milestone quietly redefines its own target. If the
  warm start costs crossings, that number is the price of the feature and
  belongs in M3.10's docs page.
  Prior art worth an hour before starting this, M3.7 and M3.8: North and
  Woodhull's DynaDAG (online hierarchical drawing) and Frishman and Tal's
  online dynamic graph drawing solve this milestone's problem directly,
  including order warm start under rank churn and stable coordinates via a
  pinned and moveable partition. Several of M3's open decisions have published
  answers.
- [ ] **M3.7** (`@dagr/layout`) Incremental ranking: keep the previous ranks
  where the patch cannot have changed them, recompute the affected band, and
  fall back to a full rank when the patch changes the cycle structure (any
  change to the reversed-edge set M2.2 produces) or would shift more than an
  agreed fraction of the graph. Tests: incremental ranks equal a cold rank of
  the same final graph on the cases where they must, and the fallback trigger
  is exercised by a test rather than assumed to fire.
  The reversed-edge trigger only means something if the reversed set is itself
  stable, and today nothing makes it so. M2.2's greedy Eades-Lin-Smyth FAS is
  order-dependent by construction: its sequence depends on degree-bucket
  membership and on iteration order within a bucket, so a patch changing one
  node's degree can move it between buckets, change the whole sequence, and
  produce a DIFFERENT feedback arc set of the same size for a graph whose cycle
  structure did not change. Edges flip, ranks flip under them, and M3.6's warm
  start is meaningless across that region. So this task also makes the cycle
  breaker incremental: re-run it seeded with the previous reversed set, keeping
  a previously reversed edge reversed while it still lies on a cycle and
  reversing newly added edges only as new cycles require. Then a changed
  reversed set genuinely means changed cycle structure and the bail trigger
  measures what it claims to, instead of observing the symptom of a non-stable
  FAS and firing on patches that needed nothing. Scope it honestly: on a DAG
  the reversed set is empty and stays empty, so none of this touches the
  prnt.design pattern-generator case, and it bites cyclic input only. That is a
  reason to plan it rather than to panic, and if the run needs splitting, the
  stable FAS is the half that unblocks the trigger.
  Decide here when to bail. Bail too eagerly and the fast path is rare enough
  that the feature is a lie; bail too reluctantly and a relayout costs more
  than a cold run, because it pays for the analysis and then does the work
  anyway. A threshold like that wants a measurement, not an opinion, so this
  task carries a bench comparing incremental against cold across patch sizes
  and commits the crossover point it actually finds. Name the fraction rather
  than writing "an agreed fraction", for the reason M3.6 gives.
- [ ] **M3.8** (`@dagr/layout`) Stable coordinate assignment: positions that do
  not jump. Two halves. The incremental path holds untouched nodes at their
  previous coordinates and solves only the influenced band against them. The
  full-relayout fallback has to be stable too, because a fallback that throws
  the graph across the screen is worse for a user than having no incremental
  layout at all: a cold run seeded with the previous coordinates as the
  tie-break preference, so the same input keeps the same answer everywhere the
  constraints leave a choice. Invariant tests from M2.7 run against both paths,
  but say which of Brandes-Koepf's guarantees actually survive the incremental
  path, because "no overlaps, spacing respected" is strictly weaker than what
  BK promises and the invariant tests will not notice the difference.
  BK does not decompose into a band solve, which the naive reading of the
  paragraph above assumes it does. BK is: mark type-1 conflicts, run four
  biased vertical-alignment passes forming blocks, compact each block class,
  then align the four candidates to the narrowest and take the per-node average
  of the two medians. Two parts of that break under "hold untouched nodes and
  solve only the band". The alignment step is global, since its offsets come
  from each candidate layout's overall extremes, so computed over a band they
  are band-local and the band and anchored regions land on inconsistent
  offsets, giving a visible seam at the boundary. And blocks span ranks, so a
  block straddling the boundary has both anchored and free members and the
  compaction that gives BK its quality guarantee, inner dummy-to-dummy segments
  drawn perfectly vertically, cannot hold: long-edge chains, which are exactly
  what BK exists to straighten, kink at the boundary. The workable forms are to
  express the band boundary as separation constraints against the anchored
  neighbours and accept that straightness holds only within the band, or to run
  full BK and reconcile afterwards, which sidesteps the decomposition entirely
  and is a stronger argument for the post-pass than the one below.
  Decide here between anchoring and a post-pass, with four options rather than
  two. This is the decision that most directly sets what the differentiator
  feels like in a user's hands.
  Anchoring pins previous coordinates and gives exact stability where it is
  feasible at all (see M3.4: it is not feasible for an insertion between two
  anchored neighbours, so anchors have to be relaxable). What it accumulates
  with BK is not drift, since BK is deterministic and memoryless and has no
  iterative state to drift in, but local inconsistency: a set of pinned
  coordinates no cold BK run would produce, so blocks straddle pinned and free
  nodes, kinks build, and the drawing gets progressively wider than it needs to
  be.
  A post-pass solves fresh and then transforms the result (rigid translation,
  possibly per-rank shifts) to minimise total displacement, keeping layout
  quality and moving more nodes than it strictly has to.
  A soft displacement penalty adds a per-node `w_i * |x_i - x_i^prev|` term so
  stability trades continuously against quality instead of being on or off, and
  a soft anchor can always yield, which dissolves the feasibility problem. This
  is what the dynamic-layout literature does (Frishman and Tal 2008, North and
  Woodhull's DynaDAG). The catch is the real cost and belongs in the decision:
  BK has no objective to add a term to, so taking this means the incremental
  path uses an LP or QP coordinate assignment (Gansner-style priority or
  network-simplex X-coordinates) while the cold path stays BK, which is two
  coordinate stages to keep consistent.
  An explicit `engine.reflow()`, a full cold run emitted as one large delta
  with M4.6's springs animating the escape, is nearly free once M3.2 exists and
  changes how bad anchoring's worst case is: lock-in stops being a permanent
  defect and becomes a user-triggerable cost. Weigh it before picking, because
  it is what makes anchoring survivable.
  Note also what BK's own instability looks like, since it is the real argument
  for the fallback half of this task: it is a discontinuity, not a drift. The
  per-node value is a median across four candidate alignments, and which
  candidates are extremal can flip on a single layer-membership change, so a
  one-node insertion can translate a whole block by a full `nodeSep` in a cold
  run. That is why an unseeded fallback throws the graph across the screen.
  Node removal is decided here too, because it is the same axis and currently
  has no owner. Removing a node leaves a gap in its rank, and the two policies
  have opposite failure modes: closing the gap keeps layout quality and moves
  every node to one side of the removal within that rank, which is the worst
  possible stability outcome for a patch the user thinks of as touching one
  node; leaving the gap is perfectly stable and accumulates holes, so a
  long-running session ends up mostly whitespace with no way back, which is the
  same lock-in reached by another route and the same `reflow()` escape hatch
  resolves it. M3.9's remove-leaf fast path quietly presumes leave-the-gap
  without arguing for it, so argue it here, and let M3.10's prune and churn
  sequences measure the cost.
  This is the run to spend the milestone's heaviest algorithms review on, and
  it is the one task in M3 carrying two deliverables rather than one. If both
  halves cannot land green in one run, land the incremental path and its tests
  and record the fallback as the next run, rather than shipping a stable fast
  path behind an unstable fallback.
- [ ] **M3.9** (`@dagr/layout`) Fast paths: add-leaf, remove-leaf and
  attribute-only patches skip pipeline stages outright. An attribute patch that
  does not change a node's size changes no geometry at all and should emit an
  empty delta without running a stage; one that does change size is a
  position-and-route-only run. A leaf attached to an existing rank needs no
  cycle pass and no re-rank.
  The bench is an absolute per-patch latency against a budget, one target per
  fast path, on M2.9's 10k corpus. Not a ratio, and not 1k. A ratio against
  full relayout gets easier as the cold path gets slower, so it rewards exactly
  the wrong thing and nothing in the measurement notices (M4.10's phrasing gets
  this right for the renderer, and this task should match it). One aggregate
  number hides the work: an attribute patch that changes no size runs zero
  stages and emits an empty delta, which is not 5x but three or four orders of
  magnitude and available on day one, and it would carry a combined figure on
  its own while add-leaf, the path that requires real work, learns nothing. And
  1k is the wrong corpus for an incrementality claim, because a cold Sugiyama
  run on 1k is a few milliseconds, so the ratio looks best precisely where it
  matters least. M4 animates, so the budget is a frame at 60fps and the useful
  commitment is that an add-leaf patch on the 10k corpus completes within one
  frame. That number cannot be met by making something else slower.
  Give the fallback path a stated ceiling too, a small multiple of a cold run,
  measured. Otherwise the milestone can pass by being perfectly stable and
  slower than a cold run on every patch, since M3.4's metrics measure only
  stability and the fallback pays for the incremental analysis and then does
  the full work anyway.
  These come last among the algorithm tasks on purpose. A fast path is only
  safe once M3.5's influence regions say what it is allowed to skip, and only
  demonstrable once M3.4's metrics can show it skipped work rather than
  correctness.
- [ ] **M3.10** (`@dagr/layout`, `docs`) Stability golden corpus: scripted
  mutation sequences (grow, prune, reparent, rewire, sustained churn) run
  through the engine with their stability metrics committed as golden files, so
  a later change that degrades stability arrives as a diff rather than as a
  feeling. Include at least one prnt.design-shaped pattern-generator sequence,
  since that is the first consumer and the reason the milestone exists. Docs
  page on incremental layout, the flagship feature, carrying the numbers this
  corpus produces and an honest statement of what the fallback costs when it
  fires.
  Two specific things the corpus must carry. Report the pair (crossings,
  displacement) for the same mutation sequence under three configurations, cold
  every time, warm-started ordering only, and the full incremental path, so the
  stability-versus-quality trade reads as a curve rather than as two pass/fail
  bars in two different files, one of which gets relaxed when it fails. That
  artefact is nearly free once M3.4's metrics and M2.6's crossing counter both
  exist, and it is what turns the docs page's honest statement into something
  other than prose. And have the sustained-churn sequence assert that retained
  map sizes return to baseline after a balanced add and remove cycle, which is
  the cheap place to catch the M3.2 state leak, and the only place: it is
  invisible to every stability metric here.

## M4: Renderer (`@dagr/render`)

Sequenced so that something is on screen in the first task and every task after
it is visible progress. Most tasks land their own scene in `apps/demo` and a
screenshot, so the milestone can be reviewed by looking at it rather than by
reading a test name; the ones that do are tagged `apps/demo` below, and that
requirement is not repeated on each of them. Screenshots go in
`assets/screenshots/`, capped at 1x device pixel ratio and a stated width, and
that cap is worth respecting: `assets/` holds one SVG today, ten retina PNGs
would be several megabytes added permanently, and AGENTS.md forbids the history
rewrite that would be needed to take them back out.

Two practical notes before this milestone starts. Screenshots need the Chrome
browser extension connected, a human-gated setup step that has been outstanding
for a while as not urgent before M4. M4.1 is where it becomes urgent, so raise
it at the start of the milestone rather than at the end. And `@dagr/render`
currently contains a stub `index.ts` and no dependencies, so M4.1 is also the
run that adds three.js to the repo for the first time.

Parallelism, which matters while two runners work at once: M4.1, M4.2, M4.3 and
M4.6 depend on nothing in M3 and nothing in M2 beyond the types M2.1 already
shipped, so the natural split is one runner working M3 in order while the other
takes the early M4 tasks. M4.4 and M4.5 want real coordinates and routes
(M2.7, M2.8) but still nothing incremental. M4.8 and M4.9 follow M4.3 and M4.2
respectively and need nothing from M2 or M3. M4.10 wants a real 10k-node
layout, so it trails M2.9. M4.7 is the single M4 task that genuinely blocks on
M3, because it consumes `LayoutDelta` from M3.1. So M3 leads M4 in dependency
order at exactly one join, and treating the whole of M4 as blocked on the whole
of M3 would leave the second runner idle for a milestone.

- [ ] **M4.1** (`@dagr/render`, `apps/demo`, `docs`) First light: a three.js
  `WebGPURenderer` mounted in `apps/demo` drawing one shape on screen, an
  orthographic 2D camera with pan and zoom, resize and devicePixelRatio
  handling, and the `Renderer` interface module that everything later in the
  milestone plugs into. Unit tests for the camera and viewport math, which is
  pure and needs no device: screen to world and back is a pixel-exact round
  trip at any zoom and DPR, and the visible world rect matches the canvas
  aspect. Screenshot committed.
  The renderer docs page is created here, the way `docs/docs/graph-model.md`
  shipped with M1.1 and `docs/docs/layout.md` with M2.1, carrying this task's
  testing-strategy decision and three.js dependency call. `@dagr/render` is
  otherwise the only package whose documentation would be deferred wholesale to
  M5.4, which is the shape that produces a rushed page written months after the
  decisions it describes. M4.9's list of WebGL2 differences and M4.10's
  measured numbers both assume a page exists to land on; this is that page.
  Decide here, because not one of this milestone's tests can be written until
  it is settled: how `@dagr/render` is tested at all. Node has no WebGPU. The
  options are a headless browser run (Playwright against a GPU-backed Chrome:
  real, heavy, and a new CI dependency for a repo whose CI is currently
  typecheck plus vitest), a software adapter (portable and slow and not what
  users run), or the split the first draft of this roadmap assumed without
  arguing for it: pure modules (camera math, instance bookkeeping, spring
  integration, ID encode and decode) unit tested in Node with no device at all,
  and anything that needs a device verified by a recorded local screenshot
  checked in as the reference. The split is cheap and covers most of the
  milestone. Say where the line falls and name what is knowingly untested on
  the far side of it, because "we have tests" and "the shader is correct" are
  different claims and this milestone will be tempted to conflate them.
  Also decide here: whether `three` is a `dependency` or a `peerDependency` of
  `@dagr/render`. The M5.4 note explains why `@dagr/graph` became a peer of
  `@dagr/layout` (nominal typing through `#private` fields makes two copies in
  a tree incompatible), and three.js carries the same hazard for anything a
  consumer hands in or reads out: a `Scene`, a `Camera`, a renderer they
  already own. Whether the public surface exposes any three.js type at all is
  itself a choice this task makes, and the dependency answer follows from it
  rather than the other way around.
- [ ] **M4.2** (`@dagr/render`, `apps/demo`) SDF shapes in TSL: rounded-rect
  and circle as signed distance fields authored in TSL, with fill, outline and
  glow all read from the same distance rather than from three separate pieces
  of geometry. Screen-space derivative antialiasing, so an edge is crisp at
  every zoom instead of at one. Demo scene showing the same shape at 0.1x and
  100x, screenshot committed as the crispness reference.
  Author the distance functions as composable TSL nodes with no opinion about
  material assembly: a `roundedRectSDF(p, size, radius)`, a `circleSDF(p, r)`,
  and a shared fill/outline/glow shading node consuming a distance. That is
  deliberately NOT the same thing as deciding whether the package uses one
  material with a per-instance shape id or one material per family. That
  decision belongs to M4.3, which owns the per-instance attribute anyway, with
  an explicit revisit gate at M4.10. Making it here would be a high-cost
  irreversible call at the point of minimum information: the deciding factor is
  per-fragment branch cost at 10k instances and real fill rate, which cannot be
  measured while drawing one shape on screen. Composable nodes make the
  question cost a rewiring of an assembly function rather than a rewrite of
  every shader.
  What this task does own, and has evidence for, is whether one distance field
  can carry fill, outline and glow with derivative-based antialiasing that
  holds at both 0.1x and 100x.
- [ ] **M4.3** (`@dagr/render`) Instanced rendering: one instanced mesh per
  shape family, with the instance buffer allocation, growth and compaction
  bookkeeping split out as a pure module that knows nothing about a GPU.
  Exhaustive unit tests on that module (allocate, free, reuse, grow, compact,
  and the invariant that a live handle always resolves to the right slot),
  which is the entire reason for separating it: it is the part most likely to
  be subtly wrong and the part that needs no device to prove right.
  Removing an instance is swap-with-last plus a handle-to-slot map, and this is
  a resolved call rather than an open one. The indirection's supposed cost does
  not survive inspection: per-frame rendering iterates slots on the GPU and
  never consults the map, per-frame spring integration iterates spring state
  which is keyed by handle anyway, and the map is touched once per CHANGED
  entry when a delta is applied, which is O(size of delta) and the entire
  premise of M3 is that deltas are small. Leaving holes and compacting on a
  threshold is the alternative and wastes buffer space and draw work for no
  gain the map does not already provide.
  State this invariant, because the rest of the package relies on it and
  swap-with-last corrupts slot-keyed data silently, without an error, since the
  slot stays valid and merely belongs to a different node: per-instance spring
  state (M4.6, M4.7) and picking IDs (M4.8) are keyed by handle, never by slot,
  and slot indices are not durable across any removal. Testable in the pure
  module: remove an instance, assert every surviving handle still resolves, and
  assert no test helper can observe a slot index across the removal.
  Decide here instead, carried from M4.2: whether the package uses one material
  with a per-instance shape id or one material per shape family. This task owns
  the per-instance attribute, so it owns the assembly. An uber-material draws
  every family in one call and pays a branch per fragment plus the union of
  every family's uniforms; per-family materials keep each shader small and cost
  a draw call per family, and the family count is small (rounded rect, circle,
  and whatever M6's VDSL asks for), so the draw-call argument is weaker than it
  looks. Record the choice as provisional and revisit it at M4.10, which is the
  first point with the fill rate and instance count to judge it.
- [ ] **M4.4** (`@dagr/render`, `apps/demo`) A real graph on screen: take a
  `LayoutResult` from `@dagr/layout` and draw its nodes, sized and positioned,
  with a node-id to instance-handle mapping that survives nodes being added and
  removed. The first task where the demo shows an actual laid-out graph instead
  of test geometry, which makes its screenshot the milestone's first honest
  progress report. Wants M2.7 positions to be real: before that it would draw a
  correct picture of a degenerate layout, which is not worth a run.
- [ ] **M4.5** (`@dagr/render`, `apps/demo`) Edge ribbons: polyline and bezier
  tessellation from M2.8's route control points, joins that do not pinch at
  sharp angles, and a dash-flow uniform for animated direction. State whether
  width is in world space (scales with zoom, matches the node boxes) or screen
  space (constant pixels, stays legible when zoomed out), because that choice
  is visible in every screenshot afterwards. Demo scene exercising a graph with
  edges spanning many ranks, which is what M2.4b's dummy chains turn into the
  multi-point polylines this task has to tessellate without pinching.
- [ ] **M4.6** (`@dagr/render`) Spring integrator: critically damped springs
  driving scalar and vec2 targets, retargetable mid-flight with no
  discontinuity in position or velocity, and a fixed-timestep accumulator so
  behaviour does not change with frame rate. Pure math, so the tests are
  exhaustive and use a fake clock: settling time, no overshoot when retargeted
  from rest, at most one zero crossing from any initial state, a mid-flight
  retarget preserves velocity, and a long frame (a backgrounded tab) does not
  explode the integrator.
  Those last test bullets are stated carefully because the obvious phrasing is
  wrong. Critical damping guarantees no OSCILLATION, not no overshoot. With
  `x(t) = target + (A + Bt)e^(-wt)`, `A = x0 - target` and `B = v0 + wA`, the
  displacement crosses zero at `t = -A/B`, which is positive whenever the
  initial speed toward the target exceeds `w` times the distance, so a
  mid-flight retarget to a point near or behind the current motion overshoots
  and comes back. "No overshoot" and "retargetable mid-flight" as unqualified
  claims contradict each other, since the retarget test constructs exactly the
  state the overshoot test would forbid. The retarget property itself does hold
  and is worth guarding: position and velocity are the integrator's state and
  the target is a parameter of `x'' = -2w x' - w^2 (x - target)`, so changing
  it cannot discontinue the state. Acceleration does jump, which is a faint
  snap at high `w`. The property fails only for an implementation storing
  `(start, target, elapsed)` and reparameterising time on retarget, which is a
  common shortcut and is the real hazard the test catches.
  Decide here where this lives, and it is a genuinely open call. Inside
  `@dagr/render` it is one fewer package to publish, version and document, and
  it matches the README's planned-packages table exactly. As its own package it
  is useful and testable without a GPU, and `@dagr/react` in M5 will want
  exactly this for interaction animation with nothing to do with graph layout,
  which is the argument likely to decide it. There is a third option that costs
  nothing now: keep it an internal module of `@dagr/render`, export it from
  that package, and split it out only when a second consumer actually exists.
  This project has twice declined to build a surface before a consumer asked
  for it. The way to keep that option open is to give this module no dependency
  on anything else in the package, which is worth doing regardless of the
  answer.
- [ ] **M4.7** (`@dagr/render`) Delta consumer: the renderer takes M3.1's
  `LayoutDelta`s and drives node and edge motion through M4.6's springs,
  interruptible when a new delta arrives mid-flight. Integration test with a
  fake clock: a delta retargets, a second delta mid-flight retargets again
  without a jump, and a node named in a removal disappears only once its spring
  has finished rather than the instant the delta lands. This is the one M4 task
  that genuinely blocks on M3.
  Decide here: does the renderer hold its own scene state and apply deltas to
  it, or is it handed the full `LayoutResult` alongside each delta? Applying
  deltas is the cheap path and the reason the delta type exists at all, and it
  makes the renderer stateful and desynchronisable: one dropped or reordered
  delta and the picture is wrong with nothing in the system able to notice.
  Decide what happens when a delta names a node the renderer has never seen,
  since that is the observable symptom of the failure, and whether there is a
  resync path (accept a full result and rebuild) or the contract is simply that
  deltas are never dropped. Note this interacts with M3.1's absent-or-flagged
  question: a self-describing delta makes resync trivial and every delta
  larger.
- [ ] **M4.8** (`@dagr/render`, `apps/demo`) GPU picking: an ID buffer pass
  rendering per-instance IDs to an offscreen target, with a single-pixel
  readback giving O(1) hover, select and drag hit testing regardless of node
  count. Unit tests for ID encode and decode: round-trip across the full range,
  and the no-hit value cannot collide with a real ID. Demo scene with hover
  highlight.
  Decide here: the encoding, and when the pass runs. Twenty-four bits of ID
  plus an eight-bit type tag lets a hit say what it hit (node, edge, port)
  without a side lookup and caps a scene at 16M elements, which is not a real
  limit here; a full 32 bits of ID needs that side table. Separately, the pass
  can run every frame (simple, and costs a second full draw of the scene) or on
  demand when the pointer moves (nearly free when idle, adds a frame of latency
  and needs care while things are animating, which in this project is most of
  the time). WebGPU's asynchronous readback makes the latency half of that
  sharper than the equivalent WebGL decision would be, so measure it rather
  than porting an instinct. Treat the every-frame-versus-on-demand half as
  provisional until M4.10 measures it, since the ID pass sits inside that
  task's frame budget and the two decisions are the same decision seen from
  two ends.
- [ ] **M4.9** (`@dagr/render`) WebGL2 fallback: the same TSL node graphs
  compiled through three.js's WebGL2 backend, with backend selection at init
  and a documented list of what differs between the two. Parity check between
  backends on M4.2's shape scene, by screenshot comparison where the M4.1
  harness allows it.
  Decide here whether the fallback is automatic (probe for WebGPU, fall back
  silently, which is what a consumer wants and which hides a large performance
  cliff) or explicit (the consumer names a backend and gets an error when it is
  unavailable, which is honest and pushes the decision onto everyone). The
  likely middle is automatic, with the chosen backend readable and an event
  when the fallback fires. Whatever is chosen, record what is known not to work
  on WebGL2 here rather than letting a consumer discover it in a browser.
- [ ] **M4.10** (`@dagr/render`) Performance: 10k nodes at 60fps, this
  project's headline rendering target. Benchmark driving a real 10k-node
  laid-out graph, with frame time broken down by pass (instance update, node
  draw, edge draw, ID buffer), committed as a recorded local baseline naming
  the machine and browser it was measured on, because a CI runner's GPU is not
  something a later run can compare against honestly. Tune instancing, buffer
  update strategy and M4.3's material decision until the number is met. If it
  is not met, say so with the profile attached and move the number, not the
  goalposts: a documented 10k at 45fps with a breakdown is a useful fact, and a
  quietly redefined benchmark is not.
  "10k nodes at 60fps" admits readings that differ by more than an order of
  magnitude, and a later run under pressure picks the kind one, so pin all five
  of these in the task. The corpus: M2.9's 10k graph, so the number compares to
  something, and reported with its edge and dummy counts rather than its node
  count alone, since E is typically 1.5x to 3x V on a Sugiyama layout and a
  graph with long edges carries more dummies than real nodes, which makes
  M4.5's ribbon geometry the likely dominant cost. The state: animating, with
  springs in flight and the instance buffer rewritten every frame, not 10k
  instanced quads sitting still, which is nearly free and proves nothing. The
  view: zoom level and DPR named, because zoomed to fit at 2x DPR is the worst
  case for fragment cost and M4.2's glow reads the distance field for every
  covered fragment. The passes: whether the ID buffer pass is inside the budget
  (the breakdown implies yes, which is what makes M4.8's decision provisional
  on this one). The backend: presumably WebGPU, in which case either record the
  WebGL2 number too or state plainly that the fallback is unbenchmarked,
  because M4.9 notes automatic fallback hides a performance cliff and an
  unmeasured cliff is one a consumer finds first.
  This baseline cannot participate in M0.2's CI bench gate, and that is
  intentional rather than an oversight: the quality bar at the top of this file
  asks for benchmarks within 10% of baseline, and a GPU number measured on one
  machine has nothing comparable to gate against. Say how a regression is
  caught instead. The strongest option, if the pass breakdown supports it, is
  to bench the CPU-side passes (instance update, buffer upload) in CI under the
  M0.2 gate and keep only the draw passes local, which puts most of the number
  back under an automated check. Otherwise commit to re-measuring by hand at
  the end of the milestone and again at M5.4's v0.1 readiness review.

## M5: React + demo = v0.1

- [ ] **M5.1** `@dagr/react`: `<DagrCanvas>` + `useDagr` hook, controlled
  graph prop, mocked-renderer component tests.
- [ ] **M5.2** Interaction hooks: `useSelection`, hover and drag wiring to
  GPU picking. Component tests.
- [ ] **M5.3** Demo app: animated living demo (grow/prune/relayout
  scenarios) in `apps/demo`, deployed-ready build.
- [ ] **M5.4** Docs: Docusaurus getting-started, API reference pages for all
  packages, v0.1 readiness review. Queue npm publish for the human.
  Pre-publish packaging checklist (from the M0.1 oss-docs review): add
  `publishConfig.access: "public"` to each scoped package; fix source maps
  (ship `src` in `files` or drop declaration/source maps from builds) so
  published maps do not point outside the tarball; per-package README and
  LICENSE so npm pages are not empty; pick a versioning/changelog tool
  (changesets is the default candidate).
  Added after the M2.1 oss-docs review: pack every package and check the
  tarballs resolve the way a consumer will, with `publint` and
  `arethetypeswrong` per tarball, or a scratch project that installs them and
  typechecks an `import { layout } from '@dagr/layout'`. Nothing in CI does
  this today: typecheck reads sibling packages through tsconfig `paths`, tests
  read them through a vitest alias, and the build reads them through the pnpm
  workspace symlink, so a wrong `exports.types` or a missing `dist` in `files`
  would pass all four steps. `@dagr/layout` is the first package whose public
  types depend on another package resolving, which is what makes this real.
  `@dagr/graph` is a peer dependency of `@dagr/layout` (see the M2.1 note
  below), so the peer range is now the thing a consumer install can get wrong,
  and still nothing in CI exercises it. Note also that `^0.1.0` on a 0.x package
  means `>=0.1.0 <0.2.0`, so M1.2's breaking change to `addNode` and `addEdge`
  forces a matching `@dagr/layout` release. Lockstep publishing is fine, it just
  has to be a decision rather than a surprise.
  Also from the M2.1 API review, and reversing a call the M2.1 oss-docs review
  made: `@dagr/layout` declares `@dagr/graph` as a `peerDependency` plus a
  `devDependency`, not a `dependency`. The oss-docs review judged a plain
  dependency fine because nothing does `instanceof Graph`, which is true and is
  not the failure mode. `Graph` uses `#private` fields, which makes it
  nominally typed: two copies of `@dagr/graph` in a consumer's tree are not
  interchangeable, and passing one copy's `Graph` where the other's is expected
  fails to compile with "separate declarations of a private property '#nodes'".
  `@dagr/graph` is all over this package's public surface (`LayoutInput.graph`,
  `PreparedState.graph`, `LayoutConfig.nodeSize`) and every consumer constructs
  the `Graph` itself, so the duplicate is reachable, and with a caret dependency
  it is likely rather than theoretical during 0.x, because a caret does not
  cross a 0.x minor. The `devDependency` keeps the workspace link and the
  topological build ordering that `tsconfig.build.json` depends on; verified by
  a cold `pnpm build` with both dists deleted, which still builds graph before
  layout. Confirm at publish time that the peer range is right for the versions
  actually being published.
  Decide the source-map option and TypeScript project references together, they
  are coupled: `composite: true` requires `declaration: true` and effectively
  wants `declarationMap`, so taking the "drop declaration/source maps from
  builds" option above would close the door on project references. References
  are the self-healing fix for the fact that
  `pnpm --filter @dagr/layout build` needs `@dagr/graph` built first (see the
  comment in `packages/layout/tsconfig.build.json`). Not worth the machinery at
  two packages, worth knowing about before the other decision is made.

## M6: VDSL = v0.2 (`@dagr/vdsl`)

Task breakdown is drafted when M5 completes, driven by the prnt.design
pattern-generator use case. Expected shape:

- [ ] **M6.1** Node-type schemas and typed ports.
- [ ] **M6.2** Connection validation against schemas.
- [ ] **M6.3** Drag-to-connect interactions.
- [ ] **M6.4** Pattern-generator example built on the DSL.

## Tracked, not promised

Web-component wrapper, 3D camera experiment, Remotion tutorials, npm publish
(human-gated).
