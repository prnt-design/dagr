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
- [ ] **M0.2** Benchmark harness: vitest bench setup, a `bench` baseline
  capture script, baseline JSON committed, CI bench step comparing against
  baseline with a 10% tolerance. README development guide section.
  Deliberately deferred until early M1 lands real code worth benchmarking.
  That trigger has now fired: M1.3 landed patch emission on every mutation,
  which is the first hot path in the repo that a baseline is meant to protect,
  and `pnpm bench` is still `pnpm -r --if-present bench` with no package
  defining one, so it is a silent no-op that would pass forever if CI ran it
  as it stands. This is the next task off the board, before M1.4 adds more
  graph surface to measure.

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
- [ ] **M1.4** Traversal and invariants: topological sort, cycle detection,
  sources/sinks, reachability. Property tests on random DAGs and random
  digraphs with cycles.
- [ ] **M1.5** Serialization: `toJSON`/`fromJSON` with identity-preserving
  round-trips, property-tested. Serialization section added to the graph model
  docs page (the page itself shipped with M1.1).

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
  purpose for self loops and for M2.4's long edges, so the strict form is
  asserted in the stage's own tests instead.
- [ ] **M2.3** Ranking v2: tight-tree / network-simplex rank tightening.
  Golden comparisons against longest-path on a small corpus; rank sum must
  never regress.
- [ ] **M2.4** Dummy-node chains: split long edges across ranks into virtual
  nodes, rejoin on output. Tests: chain integrity, no multi-rank edges reach
  later stages.
  Prepared in M2.1, so this is a ranker change and not an interface change: the
  pipeline works over a roster (the graph's nodes plus whatever the rank stage
  declares in `RankedState.virtualNodes`), a declared dummy is checked exactly
  as hard as a real node (rank, size, exactly one layer, a position), the
  default order stage already places roster members, and the runner already
  refuses to let a dummy reach `LayoutResult`. What is left here is the chain
  splitting itself and rejoining the chain into a polyline on output.
  Decide here, and no later, whether the four stage interfaces should return
  only their own contribution rather than the whole next record. Raised by the
  M2.2 API review against `rank.ts`, which ends
  `return { ...input, ranks, reversedEdges, virtualNodes: new Set() }`: the
  spread carries back `graph`, `config` and `sizes` that the stage has no
  opinion about, and `virtualNodes` is a required field a pre-M2.4 ranker has
  nothing to say about. The proposal is a `RankOutput` (and three siblings)
  holding that stage's fields alone, with the runner merging into the `...State`
  record, which leaves the extends-chain and everything a stage can READ exactly
  as it is, and makes `checkGraphKept` dead code because replacing the graph
  stops being representable. It was not done in M2.2 because it is a breaking
  change to all four public stage interfaces and M2.2's increment was the
  algorithm; doing both in one run would have made the diff hard to review and
  neither change would have been judged on its own. The reviewer's timing
  argument is why it is pinned here rather than left open: M2.4 is the first
  milestone where a real stage populates `virtualNodes` and `sizes`, and after
  that the migration stops being mechanical.
- [ ] **M2.5** Ordering v1: barycenter sweeps with median fallback, crossing
  counter as the metric. Tests on known small graphs with hand-counted
  crossings. Also measure adjacency allocation churn in the sweeps (every
  `@dagr/graph` adjacency query returns a fresh array) and add a
  non-allocating traversal form there if it shows up in the profile.
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
over pass-through coordinates measures nothing.

- [ ] **M3.1** (`@dagr/layout`) Delta model: `LayoutDelta` computed by diffing
  two `LayoutResult`s: nodes added, removed and moved, edges added, removed and
  rerouted, and the changed bounds. A pure function over two results, so it
  needs no engine and no incremental algorithm, which is why it goes first:
  every later task in this milestone is judged by the delta it emits, and this
  is the thing that emits it. Tests on hand-built results, plus property tests
  (diffing a result against itself is empty; applying `diff(a, b)` to `a`'s
  geometry reproduces `b`'s).
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
  Tolerance: coordinates are floats, and a stage that recomputes the same
  answer can return a bit-different one, so "moved" needs an epsilon or the
  delta will name nodes that did not move in any sense a user would recognise.
  It belongs in `LayoutConfig` rather than as a constant, because it is in
  node-size units and only the caller knows that scale.
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
  The answer may be no, and that is a real outcome rather than a failure. If
  `engine.relayout` composes cleanly over a sequence of single patches, and
  M3.9's fast paths keep the per-patch overhead small enough that ten patches
  are not ten pipeline runs, the honest result is a note in the graph docs
  saying batching was considered and declined and why. This project has
  declined a speculative surface twice already on the same reasoning. Whichever
  way it goes, decide it here and do not carry the question past M3.
  Widening `relayout(patch)` to accept a batch is source compatible in either
  direction, which is exactly why M3.2 does not wait for this.
- [ ] **M3.4** (`@dagr/layout`) Stability contract and metrics: write down what
  stable means, and make it measurable, before any stage tries to be stable. A
  stability module computing mean and max node displacement, the fraction of
  nodes that moved, and rank and order churn between two `LayoutResult`s, plus
  the test helpers that assert on them. Unit tests on the metrics themselves
  (a known displacement produces the known mean), because a metric nobody
  tested is a number nobody can argue with.
  Decide here: is stability a contract or a metric? A contract is a hard
  assertion, that a node outside a patch's influence has bit-identical
  coordinates and violating it fails the build, which is the strongest form of
  the project's headline claim and is only reachable if the incremental path
  never re-solves an untouched region. A metric is a threshold on a corpus,
  which survives a full-relayout fallback but degrades quietly and lets a
  regression land as long as it stays under the bar. The likely answer is both
  (a contract on the fast paths, a metric on the fallback), but it has to be
  decided rather than drifted into, because M3.5 through M3.9 are all written
  against whichever it is, and the docs in M3.10 promise it to users.
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
  Decide here how influence is bounded. Full transitive reachability from the
  patch's endpoints is correct and degenerates to the whole graph on anything
  densely connected, which would make the milestone's headline claim true and
  useless. A bounded window (k hops, or the rank span the patch can shift plus
  a margin) stays proportional to the edit and can miss a crossing a full run
  would have avoided, so the picture stays stable and gets slightly worse. That
  is a quality-versus-stability trade this project has not made anywhere yet,
  and it cannot be judged without M3.4's numbers, which is why it comes after
  them rather than before.
- [ ] **M3.6** (`@dagr/layout`) Warm-started ordering: seed the order stage
  from the previous layout's per-rank permutation instead of insertion order,
  so a node whose neighbourhood did not change keeps its slot. This is the
  highest-leverage stability lever in a Sugiyama pipeline: crossing reduction
  is where a full run's answers wander most, because barycenter sweeps are
  sensitive to their starting permutation and M2.5 seeds that permutation from
  the roster. Tests: an unchanged subgraph keeps its exact order across a
  relayout that adds a node elsewhere, and the M2.6 crossing corpus does not
  regress beyond an agreed tolerance.
  Record the tension rather than hiding it: a warm start trades layout quality
  for stability by construction, and the M2.6 corpus is precisely the thing
  that will notice. If the warm start costs crossings, that number is the price
  of the feature and belongs in the M3.10 docs page, not in a commit message
  nobody reads.
- [ ] **M3.7** (`@dagr/layout`) Incremental ranking: keep the previous ranks
  where the patch cannot have changed them, recompute the affected band, and
  fall back to a full rank when the patch changes the cycle structure (any
  change to the reversed-edge set M2.2 produces) or would shift more than an
  agreed fraction of the graph. Tests: incremental ranks equal a cold rank of
  the same final graph on the cases where they must, and the fallback trigger
  is exercised by a test rather than assumed to fire.
  Decide here when to bail. Bail too eagerly and the fast path is rare enough
  that the feature is a lie; bail too reluctantly and a relayout costs more
  than a cold run, because it pays for the analysis and then does the work
  anyway. A threshold like that wants a measurement, not an opinion, so this
  task carries a bench comparing incremental against cold across patch sizes
  and commits the crossover point it actually finds.
- [ ] **M3.8** (`@dagr/layout`) Stable coordinate assignment: positions that do
  not jump. Two halves. The incremental path holds untouched nodes at their
  previous coordinates and solves only the influenced band against them. The
  full-relayout fallback has to be stable too, because a fallback that throws
  the graph across the screen is worse for a user than having no incremental
  layout at all: a cold run seeded with the previous coordinates as the
  tie-break preference, so the same input keeps the same answer everywhere the
  constraints leave a choice. Invariant tests from M2.7 still hold on both
  paths: no overlaps, spacing respected.
  Decide here between anchoring and a post-pass, and this is the decision that
  most directly sets what the differentiator feels like in a user's hands.
  Anchoring pins previous coordinates as hard constraints and gives exact
  stability, and it accumulates: fifty patches later the layout can be locked
  into a shape a cold run would never produce, with no path back to a good one.
  A post-pass solves fresh and then transforms the result (a rigid translation,
  possibly per-rank shifts) to minimise total displacement, which keeps layout
  quality and moves more nodes than it strictly has to. A hybrid (anchor within
  the influence region, post-pass across it) is available and is not free
  either. This is the run to spend the milestone's heaviest algorithms review
  on.
- [ ] **M3.9** (`@dagr/layout`) Fast paths: add-leaf, remove-leaf and
  attribute-only patches skip pipeline stages outright. An attribute patch that
  does not change a node's size changes no geometry at all and should emit an
  empty delta without running a stage; one that does change size is a
  position-and-route-only run. A leaf attached to an existing rank needs no
  cycle pass and no re-rank. Bench: fast path at least 5x full relayout on the
  1k corpus, baseline committed.
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

## M4: Renderer (`@dagr/render`)

Sequenced so that something is on screen in the first task and every task after
it is visible progress. Each task lands its own scene in `apps/demo` and a
screenshot committed under `assets/`, so the milestone can be reviewed by
looking at it rather than by reading a test name. That is a standing
requirement for M4 and is not repeated on every task below.

Two practical notes before this milestone starts. Screenshots need the Chrome
extension connected, which has been queued for the human since M1.3 as "not
urgent before M4": M4.1 is where it becomes urgent, so raise it again at the
start of the milestone rather than at the end. And `@dagr/render` currently
contains a stub `index.ts` and no dependencies, so M4.1 is also the run that
adds three.js to the repo for the first time.

Parallelism, which matters while two runners work at once: M4.1, M4.2, M4.3 and
M4.6 depend on nothing in M3 and nothing in M2 beyond the types M2.1 already
shipped, so the natural split is one runner working M3 in order while the other
takes the early M4 tasks. M4.4 and M4.5 want real coordinates and routes
(M2.7, M2.8) but still nothing incremental. M4.7 is the single M4 task that
genuinely blocks on M3, because it consumes `LayoutDelta` from M3.1. So M3
leads M4 in dependency order only at that one join, and treating the whole of
M4 as blocked on the whole of M3 would leave the second runner idle for a
milestone.

- [ ] **M4.1** (`@dagr/render`, `apps/demo`) First light: a three.js
  `WebGPURenderer` mounted in `apps/demo` drawing one shape on screen, an
  orthographic 2D camera with pan and zoom, resize and devicePixelRatio
  handling, and the `Renderer` interface module that everything later in the
  milestone plugs into. Unit tests for the camera and viewport math, which is
  pure and needs no device: screen to world and back is a pixel-exact round
  trip at any zoom and DPR, and the visible world rect matches the canvas
  aspect. Screenshot committed.
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
  Decide here, and M4.3 has to live with it: one material with a shape id per
  instance, or one material per shape family. An uber-material draws every
  family in a single call and pays a branch per fragment plus the union of
  every family's uniforms. Per-family materials keep each shader small and
  honest and cost a draw call per family. The family count is small (rounded
  rect, circle, and whatever M6's VDSL asks for), so the draw-call argument is
  weaker than it first looks, while the per-fragment branch cost is real at
  10k instances and M4.10 is the task that will find out how real. Choose with
  M4.10's target in mind and record the reasoning, because reversing this later
  is a rewrite of every shader in the package.
- [ ] **M4.3** (`@dagr/render`) Instanced rendering: one instanced mesh per
  shape family, with the instance buffer allocation, growth and compaction
  bookkeeping split out as a pure module that knows nothing about a GPU.
  Exhaustive unit tests on that module (allocate, free, reuse, grow, compact,
  and the invariant that a live handle always resolves to the right slot),
  which is the entire reason for separating it: it is the part most likely to
  be subtly wrong and the part that needs no device to prove right.
  Decide here what removing an instance does. Swap-with-last is O(1) and moves
  another instance's slot index, which is fine right up until M4.8 wants a
  stable per-instance ID and M4.6's springs want per-instance state that
  follows the node rather than the slot. Leaving a hole and compacting on a
  threshold keeps slots stable and wastes buffer space and draw work between
  compactions. The resolution is probably an indirection, a stable handle onto
  a moving slot, which is not free either and adds a lookup to the hot path.
  M4.7 and M4.8 both build on whatever is chosen, so state the invariant the
  rest of the package is allowed to rely on.
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
  long multi-rank edges, which is what M2.4's dummy chains produce.
- [ ] **M4.6** (`@dagr/render`, or a standalone module) Spring integrator:
  critically damped springs driving scalar and vec2 targets, retargetable
  mid-flight with no discontinuity in position or velocity, and a fixed-timestep
  accumulator so behaviour does not change with frame rate. Pure math, so the
  tests are exhaustive and use a fake clock: settling time, no overshoot at
  critical damping, a mid-flight retarget preserves velocity, and a long frame
  (a backgrounded tab) does not explode the integrator.
  Decide here where this lives, and it is a genuinely open call. Inside
  `@dagr/render` it is one fewer package to publish, version and document, and
  it matches the charter's package list exactly. As its own package it is
  useful and testable without a GPU, and `@dagr/react` in M5 will want exactly
  this for interaction animation that has nothing to do with graph layout,
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
  than porting an instinct.
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
- [ ] **M4.10** (`@dagr/render`) Performance: 10k nodes at 60fps, the charter's
  number. Benchmark driving a real 10k-node laid-out graph, with frame time
  broken down by pass (instance update, node draw, edge draw, ID buffer),
  committed as a recorded local baseline naming the machine and browser it was
  measured on, because a CI runner's GPU is not something a later run can
  compare against honestly. Tune instancing, buffer update strategy and M4.2's
  material decision until the number is met. If it is not met, say so with the
  profile attached and move the number, not the goalposts: a documented 10k at
  45fps with a breakdown is a useful fact, and a quietly redefined benchmark is
  not.

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
