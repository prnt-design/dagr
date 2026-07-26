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

- [ ] **M3.1** Delta model: `LayoutDelta` (nodes moved/added/removed, edges
  rerouted) computed by diffing two `LayoutResult`s. Tests on hand-built
  cases.
- [ ] **M3.2** Patch-driven relayout: `relayout(prev, patch)` re-runs the
  pipeline warm-started from previous ordering; emits deltas. Stability
  metric (mean node displacement) asserted on a corpus.
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
  different layout. If this task or M3.3's untouched-subgraph detection turns
  out to need a replayed graph to iterate like the original, this is the point
  to make replay order faithful; `remove-port` already carries the `index` such
  a change would need, and the add ops would need the equivalent. If nothing
  here needs it, leave `apply` as it is and say so, rather than carrying the
  question further.
- [ ] **M3.3** Stable positions: untouched-subgraph detection; nodes outside
  the patch's influence keep their exact positions. Property tests: a patch
  confined to one subgraph yields a delta that names no node outside it.
  Phrased in terms of influence rather than emptiness because there is no such
  thing as a no-op patch: as of M1.3 a call that changes nothing emits nothing
  at all, so a test written against an empty patch would be testing an input
  the graph never produces.
- [ ] **M3.4** Fast paths: add-leaf, remove-leaf, and attribute-only patches
  skip full pipeline stages. Bench: fast path at least 5x full relayout on
  the 1k corpus, baseline committed.
- [ ] **M3.5** Animation scenarios: corpus of scripted mutation sequences
  (grow, prune, reparent) with stability metrics as golden files. Docs page
  on incremental layout, the flagship feature.

## M4: Renderer (`@dagr/render`)

- [ ] **M4.1** Renderer interface + scene bootstrap: `Renderer` interface
  module, three.js WebGPURenderer setup, orthographic 2D camera, resize and
  devicePixelRatio handling. Unit tests for camera/viewport math.
- [ ] **M4.2** Spring integrator: critically damped spring library driving
  scalar/vec2 targets, interruptible retargeting mid-flight. Exhaustive
  unit tests (pure math).
- [ ] **M4.3** Instanced nodes: one instanced mesh per shape family,
  instance buffer allocation/compaction bookkeeping. Unit tests on the
  bookkeeping module.
- [ ] **M4.4** SDF shapes in TSL: rounded-rect and circle with outline and
  glow from the same distance field. Screenshot test where headless WebGPU
  allows, else a recorded local run checked in as the reference.
- [ ] **M4.5** Edge ribbons: bezier tessellation from layout control points,
  dash-flow uniform animation. Demo scene exercising it.
- [ ] **M4.6** Delta consumer: renderer consumes `LayoutDelta`s, springs
  drive node/edge motion, interruptible on new deltas. Integration test
  with a fake clock.
- [ ] **M4.7** GPU picking: ID buffer pass, O(1) hover/select/drag hit
  testing as instance attributes. Unit tests for ID encode/decode.
- [ ] **M4.8** Performance: 10k nodes at 60fps target; benchmark harness in
  CI where headless GPU allows, else recorded local baseline. Tune
  instancing until within bar.

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
