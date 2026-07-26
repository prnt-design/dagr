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
  Deliberately deferred until early M1 lands real code worth benchmarking;
  scheduled after M1.3 (patches) at the latest.

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
- [ ] **M1.3** Patches: every mutation emits a `Patch`; `apply(graph, patch)`
  reproduces the mutation; inverse patches for undo. Property-based tests
  (fast-check): patch/apply round-trips on random mutation sequences.
- [ ] **M1.4** Traversal and invariants: topological sort, cycle detection,
  sources/sinks, reachability. Property tests on random DAGs and random
  digraphs with cycles.
- [ ] **M1.5** Serialization: `toJSON`/`fromJSON` with identity-preserving
  round-trips, property-tested. Docusaurus API page for `@dagr/graph`.

## M2: Layout core (`@dagr/layout`)

- [ ] **M2.1** Pipeline skeleton: `LayoutInput`/`LayoutResult` types, stage
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
- [ ] **M2.2** Cycle breaking + ranking v1: greedy feedback-arc-set cycle
  breaker, longest-path ranking. Invariant tests: every edge points downward
  in rank after reversal bookkeeping.
- [ ] **M2.3** Ranking v2: tight-tree / network-simplex rank tightening.
  Golden comparisons against longest-path on a small corpus; rank sum must
  never regress.
- [ ] **M2.4** Dummy-node chains: split long edges across ranks into virtual
  nodes, rejoin on output. Tests: chain integrity, no multi-rank edges reach
  later stages.
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
- [ ] **M2.9** Golden corpus vs dagre: port a corpus of real graphs
  (including a prnt.design-shaped pattern-generator graph), assert
  structural parity metrics vs dagre output (rank counts, crossing counts
  within tolerance). First layout benchmarks (1k and 10k node graphs) with
  committed baselines.
- [ ] **M2.10** Worker mode: same layout API sync or in a worker
  (`layoutAsync`), transferable-friendly data. Docs page for `@dagr/layout`.

## M3: Incremental layout

- [ ] **M3.1** Delta model: `LayoutDelta` (nodes moved/added/removed, edges
  rerouted) computed by diffing two `LayoutResult`s. Tests on hand-built
  cases.
- [ ] **M3.2** Patch-driven relayout: `relayout(prev, patch)` re-runs the
  pipeline warm-started from previous ordering; emits deltas. Stability
  metric (mean node displacement) asserted on a corpus.
- [ ] **M3.3** Stable positions: untouched-subgraph detection; nodes outside
  the patch's influence keep their exact positions. Property tests: a
  no-op patch yields an empty delta.
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
