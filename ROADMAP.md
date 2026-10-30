# Roadmap

Dagr ships one merge-worthy increment per day: tests, implementation, and docs
in one PR. Implementation uses TDD and ships its docs with the feature. Every
PR requires the full local gate and concluded green CI in AGENTS.md, including
the machine-matched benchmark gate.

This file owns milestone scope, priority and evidence summaries. Dispatch's
Dagr project board owns execution tasks, acceptance criteria, assignments,
blockers and PR links. Link a task to its milestone rather than maintaining a
second implementation queue. Update this file in the implementation PR and
keep the board current during the run; mark a task done only after verified
merge. Before merge, check main and the board and record the actual successor.
Every execution task names its milestone ID (for example M4.10 or R1); a
new slice keeps that milestone ID and gets its own Dispatch task ID. The
implementation PR links its Dispatch task and evidence. After verified merge,
attach the merged PR to that task, mark it done, and link the existing or newly
created successor task in the completed task and handoff. Refresh this file
only when scope, priority, outcome or the active milestone task changes. An
unfinished slice does not become a new competing checklist here. Report tasks
keep their separate scheduler and dependencies.
The working record and historical decisions live in
[specs/roadmap-notes.md](specs/roadmap-notes.md) under the same milestone IDs.

## Direction update (2026-10-26 UTC)

The maintainer asked to develop Explorer as a visual learning tool, with
consistent agent-authored rich graphs and mobile support as a library
capability. This adds the [learning and mobile track](#explorer-learning-and-mobile-track)
alongside the renderer evidence goals, rather than waiting for the all-moving
10k target before repairing phone reading. M5.7b is the next Explorer increment;
M5.7c follows it. The renderer queue below retains its internal order and the
report track keeps its separate scheduling. New learning work does not imply
that compound layout, audio or an additional rendering backend is required.

## Status (2026-10-30 UTC)

On 2026-10-17 the maintainer chose dagr's lead identity: the GPU renderer for
big directed graphs that animate as they change. The renderer queue below proves
the WebGPU renderer first within that track. A [daily report track](#daily-report-track) of this
repository's own activity runs in parallel, never ahead of the queue.

The published npm packages use `@prnt/dagr-*`, with the
`@prnt/dagr` umbrella. All seven packages are published at **0.1.4**
(2026-10-07). `@prnt/dagr-explorer` (M5.6, new in 0.1.3) is also exposed by
the umbrella as `@prnt/dagr/explorer`; 0.1.4 makes its camera frame the part
of the graph the open drawer leaves uncovered. `three` is an optional peer, so
an explorer site does not install it. Earlier releases added generic node-group
boundaries, content-derived camera limits, and routed, smooth, and orthogonal
edge styles. The generic System Atlas demonstrates rich VDSL nodes, search, and
focus.

Shared click-versus-pan and controlled selection now ship from the React package
through a caller-supplied, displayed-revision hit provider, and `DagrCanvas`
now supplies exact CPU node hits (M5.2b, released in 0.1.3) with opt-in navigation,
camera flights and zoom-tiered node rendering. Edge and port hits are not
shipped. Edge styles still change geometry without obstacle avoidance. Visual
groups are annotations, not compound layout or enforced boundaries. GPU
picking is `Renderer.pickNode` (unreleased), which `DagrCanvas` uses only
behind an opt-in `hitTesting="gpu"`, priced on one device (AMD RDNA 2,
Chrome 156, WebGPU) and off by default. Do not mark
M5.2 or M7 complete based on the shared contract or demos.

M5.4a gates the tarballs with `publint`, `arethetypeswrong`, and a scratch
install outside the workspace. M5.4b now includes the `onLayout` continuity
signal and external consumer checks for all seven public packages. Publication
uses `pnpm` so workspace dependency ranges resolve to released versions.

Over the six-session corpus (M3.10a), the incremental path moves 4.1x to
38.4x less of the drawing per patch than a cold run, with order churn at
exactly zero, for 3.1% to 13.8% in crossings. Brandes-Koepf positioning is
implemented and tested but unexported; `gridPositionStage` remains the
default, with the reason in `packages/layout/src/index.ts`.

M5.3b closed the gap this list opened with for three sessions: the flagship
stability claim is now illustrated on the site that makes it. `/demos/living`
edits a 32-node pipeline in front of a visitor, one `graph.batch` per edit, and
counts off the `LayoutDelta` what moved and what did not, beside a drawing in
which the unmoved nodes visibly do not move. It is an illustration of M3.10a's
corpus rather than a second measurement of it.

Publication is no longer the reason to defer M3.8b and M3.9b. M4.10a supplies
current profiling evidence before choosing the next layout fast path.

## Next jobs, in priority order

Choose the first ready, unfinished slice below, not the first unchecked box in
milestone order. Check main and open PRs before claiming work. Correctness or
install regressions in a released API preempt this queue. A missing WebGPU
adapter blocks claims about that backend, not backend-independent interaction.

Stage 1 proves the renderer; stage 2 makes it usable as a product. The
maintainer-directed M5.7 track has its own ordered tasks below. Correctness and
install regressions preempt both tracks; the next Explorer slice is M5.7b and
can ship independently of the renderer performance target. Jobs select the
first eligible Dispatch task in the chosen track, checking claims and open
PRs rather than treating every unchecked milestone as ready.

| Order | Task | Concrete outcome and exit check |
| --- | --- | --- |
| 1 | **WebGPU adapter in the loop** (stage 1, done 2026-10-17: Apple M4, Chrome 155, `renderer.backend` is `webgpu`; see `bench/browser/README.md`; since 2026-10-26 the frame profile also fails on a software fallback adapter, through which `renderer.backend` also reads `webgpu`, and which is the only adapter inside a WSL2 machine; also since 2026-10-26 that machine reaches its GPU through the Windows side's Chrome, `bench/browser/windows-chrome.mjs` and `DAGR_CDP`: AMD RDNA 2, Chrome 156, `renderer.backend` `webgpu`, not a fallback adapter) | Probe at execution time and record what `renderer.backend` reports, on which machine and browser, headed or headless, and with which flags. A WebGL2 fallback is never recorded as a WebGPU result. If no adapter comes up, record what was tried and make the next attempt reproducible. |
| 2 | **M4.9b: backend parity** (stage 1, done 2026-10-17: byte-identical on the probe scene, Apple M4, Chrome 155; see the M4.9b entry; since 2026-10-26 the parity check also fails on a software fallback adapter, which it previously passed, and passes on a second GPU, AMD RDNA 2 in Chrome 156, where 4 edge-band pixels differ by 1) | The same TSL drawn through WebGPU and WebGL2 on one machine, compared by screenshot, with the tolerance derived from the antialiasing ramp. A committed parity check that both backends pass; the M4.9b entry decides whether it becomes a gate. |
| 3 | **M4.10a: consumer performance profile** (stage 1, done 2026-10-19: frame-time distribution by size 2026-10-17, by edge style, rich-node tiers and node hit testing 2026-10-18, memory per pass 2026-10-19, on WebGPU: smooth edges re-tessellated every frame miss 60 Hz at 10,000 nodes, rich-node tiers and CPU node hits do not; the multisampled render targets are most of the GPU memory and moving edges reallocates the group every frame; see `bench/browser/README.md`) | Named backend, machine and graph sizes, rich-node tiers, edge styles, hit testing and animated updates. Frame-time distribution and memory per pass, published. Do not infer WebGPU performance from a WebGL fallback. |
| 4 | **[M4.10: 10k nodes at 60fps, animating](#m410-current-outcome)** (stage 1, in progress) | Partial-motion success is measured; all-moving smooth rendering still misses ticks. Current renderer task: `tsk_ad4b7ce0d93b`, completing the results matrix after its 10k WebGPU slice in [#191](https://github.com/prnt-design/dagr/pull/191). See the milestone summary for outcomes, limits and evidence. |
| 5 | **M4.8b: GPU picking, then edge hits** (stage 2, in progress: the node pick pass 2026-10-28, `Renderer.pickNode` (`tsk_b6f2f936ae92`): one device pixel drawn into a one-pixel target and read back, ids checked against the stamp they were drawn at; `backend-probe.mjs --pick` on AMD RDNA 2, Chrome 156, not a fallback adapter, found no disagreement in 9,532 picks per run on WebGPU and WebGL2 at DPR 1 and 2, and a flipped-row control fails; the provider adapter over it 2026-10-28, `createPickedNodeHitProvider`: M5.2a's synchronous contract answered only from a pick settled for the same world point and displayed revision, stale otherwise, unit-tested without a device; `DagrCanvas` using it 2026-10-28, `hitTesting="gpu"`: mouse hover and clicks answered from settled picks primed by hover, touch and pen kept on the CPU index, one provider per renderer so a rebuild after a lost context answers from none of the lost one's picks, the default still `'cpu'`, unit-tested without a device; hover and click at 10,000 nodes on a hardware adapter 2026-10-28, `bench/browser/gpu-hover.mjs`: on AMD RDNA 2, Chrome 156, `webgpu`, not a fallback adapter, every one of 250 samples per run answered correctly at DPR 1 and 2, about 4 ms from pointer move to `onNodeHover` at rest, and a control that must fail does; the pass priced 2026-10-28, `frame-profile.mjs --pick`: on AMD RDNA 2, Chrome 156, `webgpu`, not a fallback adapter, one pick in flight on every frame at 10,000 nodes with springs in flight cost 0.1 to 0.2 ms of CPU per pick, missed ticks did not separate from runs without picks (smooth, every node moving: 4.0% to 5.3% against 2.7% to 5.0% at DPR 1), answers came 0 to 2 frames later as the frame got busier, and the pass holds about 0.2 MB of GPU buffers at 10,000 nodes with nothing kept per pick; the pass stays on pointer moves and the default stays `'cpu'` for the GPU path's ignored clicks during a glide, not its cost; the hover highlight in the demo 2026-10-28, `@dagr/living-stage`: the node under the mouse lightens, answered from GPU picks, checked on AMD RDNA 2, Chrome 156, `webgpu`, not a fallback adapter; edge hits started 2026-10-29 (`tsk_a633c7bf733d`): `createEdgeHitIndex` over drawn centrelines, nearest within a tolerance, nodes first, unit-tested; next is an edge target in the provider contract and on `DagrCanvas`) | Hover and selection at 10k nodes through the M5.2a provider contract; edges become hit targets. The pass runs on pointer moves (priced 2026-10-28). |
| 6 | **M3.9b: fast paths** (stage 2) | Edits on a 10k graph relayout within the frame budget, judged against M3.10a's tables. |
| 7 | **Cold-layout crossings parity with dagre** (stage 2) | Close the gap on the M2.9 corpus: 147 crossings between node centres against dagre's 109 with the default `grid-position`, 96 with `brandes-koepf-position` (docs/docs/layout.md). |
| 8 | **Native explorer base on `DagrCanvas`** (stage 2) | The explorer renders through `DagrCanvas` behind its experimental base seam and keeps its search, drawer and keyboard access. |
| 9 | **WebGL2 fallback parity** (stage 2) | The fallback looks and behaves the same as WebGPU, as item 2 measures. |

**Parked:** VDSL drag-to-connect (M6.3a, M6.3b), compound layout and
drill-down (M7, M6.4, M6.5), audio beyond R6's narration experiment, and
explorer reading features beyond the explicitly scheduled
[M5.7 learning/mobile track](#explorer-learning-and-mobile-track) and
[daily report track](#daily-report-track). M2.11a edge legibility
moves behind the stage 1 and 2 items. The explorer keeps getting correctness
fixes.

**Deferred:** new showcase rewrites, 3D productization, new wrapper packages,
additional edge decorations, and broad layout algorithm work without a measured
consumer problem.

**Job guardrails:** each run delivers one bounded increment with tests, docs,
required diff/tree reviews, and the full local/CI gates in AGENTS.md. Do not
repeat initial publication or the already shipped `onLayout` continuity change.
Record the actual successor task after merging. Scheduled publication still
requires explicit maintainer authorization. Confidential private demo data and
branches never enter public docs, source, npm artifacts, or job fixtures.

## M0: Foundation

- [x] **M0.1** pnpm monorepo scaffold: `packages/{graph,layout,render,react}`,
  `apps/demo` (Vite + React 19), `docs` (Docusaurus), strict TypeScript,
  vitest, eslint, CI.
- [x] **M0.2** Benchmark harness: every benchmark a ratio against a control
  workload, medians not means, tolerance widened by measured noise. Runs
  locally before a PR, not on CI; see [bench/README.md](bench/README.md).

## M1: Graph model (`@prnt/dagr-graph`)

- [x] **M1.1** Core graph: node/edge add/remove/get, stable string IDs,
  adjacency queries.
- [x] **M1.2** Attributes and ports: typed attribute bags on nodes, edges, and
  the graph; port declarations; edges may reference ports.
- [x] **M1.3** Patches: every mutation emits a `Patch`, `apply` reproduces it,
  inverse patches for undo. Property-tested.
- [x] **M1.4** Traversal and invariants: topological sort, cycle detection,
  sources and sinks, reachability.
- [x] **M1.5** Serialization: `toJSON`/`fromJSON`, identity-preserving
  round-trips.

## M2: Layout core (`@prnt/dagr-layout`)

- [x] **M2.1** Pipeline skeleton: stage interfaces (rank, order, position,
  route), runner, size and spacing config.
- [x] **M2.2** Cycle breaking + ranking v1: greedy feedback arc set,
  longest-path ranking.
- [x] **M2.2b** Cycle breaking v2: the arc set chosen for the acyclic view it
  leaves, minimum total span under longest-path ranks.
- [x] **M2.2c** Cycle breaking v3: a least-squares vertex order in place of
  the greedy one.
- [x] **M2.3** Ranking v2: network-simplex rank tightening.
- [x] **M2.4a** Stage return types: each stage returns its own contribution,
  not the whole next record.
- [x] **M2.4b** Dummy-node chains: long edges split across ranks, rejoined on
  output.
- [x] **M2.4c** The chain splitter shared with `networkSimplexRankStage`.
- [x] **M2.5** Ordering v1: barycenter sweeps with median fallback, crossing
  counter as the metric.
- [x] **M2.6** Ordering v2: transpose refinement; crossing corpus committed as
  golden files.
- [x] **M2.6b** Order default flipped to `barycenter-order`; bench
  rebaselined.
- [x] **M2.6c** Order budgets re-derived over the drawing the stage sees now.
- [x] **M2.6d** Order tie rule re-derived against the current drawing.
- [x] **M2.7** Positioning: Brandes-Koepf horizontal coordinates, no overlaps,
  spacing respected. Implemented and tested; `gridPositionStage` stays the
  default until the measurement says otherwise.
- [x] **M2.8** Edge routing: polylines through dummy coordinates, monotone in
  the rank axis.
- [x] **M2.9** Golden corpus vs dagre; first 1k and 10k layout benchmarks.
- [x] **M2.10** Worker mode: `layoutAsync`, same API, transferable-friendly.

- [ ] **M2.11a** Edge legibility: generic regression corpus and a
  bounded route-planning fix, assessed separately from `shapeEdgePath` styles.
  Parked behind the renderer stages; see the next-jobs queue.

## M3: Incremental layout

- [x] **M3.1** Delta model: `LayoutDelta` as a pure diff of two
  `LayoutResult`s.
- [x] **M3.2** Engine: `createLayout` with `run(graph)` and `relayout(patch)`,
  emitting deltas from retained state.
- [x] **M3.3** Patch batching: `Graph.batch`, several calls emitted as one
  patch.
- [x] **M3.4** Stability contract and metrics: displacement, moved fraction,
  rank and order churn, measurable before any stage tries to be stable.
- [x] **M3.5** Influence regions: the set a patch can affect, and the relayout
  confined to it.
- [x] **M3.6** Warm-started ordering: the previous per-rank permutation seeds
  the order stage, so an unchanged neighborhood keeps its slot.
- [x] **M3.7a** Stable feedback arc set: the cycle breaker seeded with the
  previous reversed set.
- [x] **M3.7b** Incremental ranking: previous ranks kept where the patch
  cannot have changed them, full re-rank as the fallback.
- [x] **M3.8a** The full relayout that keeps its place: a cold Brandes-Koepf
  run read at the previous translation, so the fallback stops throwing the
  drawing across the screen.
- [ ] **M3.8b** The anchored incremental path: hold untouched nodes, solve
  only the influenced band against them. Brandes-Koepf does not decompose
  into a band solve (its alignment offsets are global, and blocks span the
  boundary), so the choices are separation constraints at the band boundary,
  or full BK reconciled after, for which M3.8a's shipped post-pass is the
  measured baseline. Decide the node-removal gap policy here: closing the gap
  destroys stability, leaving it accumulates whitespace, and
  `engine.reflow()` is the escape hatch either way. The milestone's heaviest
  algorithms review goes here.
- [x] **M3.9a** The patch that runs no stage: an inert patch returns the held
  drawing, an empty delta, and empty sets. 1,697x on the 10k corpus.
- [ ] **M3.9b** Fast paths that do work: add-leaf, remove-leaf, and
  size-changing attribute patches skip stages rather than all of them. The
  bench is an absolute per-patch budget on the 10k corpus (one frame at
  60fps), not a ratio, and the fallback needs a stated ceiling: a small
  multiple of a cold run, measured. Also owns the worker session (the worker
  retains pipeline state, the patch crosses the wire) and M3.5's remaining
  cost: the influence edge pass is 33ms on 10k, two frames on its own.
- [x] **M3.10a** The session corpus: six scripted mutation sessions with
  stability metrics committed as golden files, and the docs page publishing
  the numbers.
- [ ] **M3.10b** The rest of the corpus: the softening decision (the held-pair
  cost compounds to 13.8% over a session against 1.59% over one patch, so run
  the same session under both order rules), the fallback cost once M3.9b can
  decline to fire, the gap-policy measurements, and pricing the swap that
  would make M3.8a's position stage the default.

## M4: Renderer (`@prnt/dagr-render`)

- [x] **M4.1** First light: a three.js `WebGPURenderer` in `apps/demo`,
  orthographic 2D camera, pan and zoom, resize and devicePixelRatio.
- [x] **M4.2** SDF shapes in TSL: rounded rect and circle; fill, outline, and
  glow from one distance; derivative antialiasing.
- [x] **M4.3** Instanced rendering: one mesh per shape family, buffer
  bookkeeping as a pure, exhaustively tested module.
- [x] **M4.4** A real graph on screen: a `LayoutResult` drawn, node-to-instance
  mapping that survives adds and removes.
- [x] **M4.5** Edge ribbons: polyline and bezier tessellation, joins that do
  not pinch, dash-flow uniform.
- [x] **M4.6** Spring integrator: exact critically damped integration,
  retargetable mid-flight with no discontinuity and no fixed-timestep
  accumulator.
- [x] **M4.7a** Delta consumer, node half: one spring per node, retargeted by
  deltas, interruptible; `MotionFrame.settled`.
- [x] **M4.7b** Delta consumer, edge half: route vertices aligned by the union
  of both routes' arc-length parameters, one spring per aligned point,
  interruptible and compacted to the exact target route at rest.
- [x] **M4.7c** Delta consumer, the rest: bounds motion as a centre and two
  half-extents, `createSceneMotion` applying a delta across all three halves or
  not at all, and `createMotionLoop`, woken rather than started, stopping on
  the frame that says settled, with the scheduler as an option so a caller's
  coalesced frame is the loop's frame. Sizes do not spring. The demo that
  proves it moved to M5.3b, beside the React wiring it stands on, which
  shipped as M5.3a.
- [x] **M4.8a** Pick IDs: the encoding, the pixel arithmetic, and the stamp
  registry that refuses a stale answer.
- [ ] **M4.8b** GPU picking, the pass: per-instance IDs to an offscreen
  target, single-pixel readback, hover highlight in the demo. Decide when the
  pass runs (every frame, or on pointer move), provisional until M4.10 prices
  it. The pass owes three properties: cleared to zero, blending off, no color
  management. Confirm the y flip and the vertex-buffer count M4.8a assumed.
  Since 2026-10-28 (`tsk_b6f2f936ae92`) the pass is `Renderer.pickNode`:
  each family's pick material reads five vertex buffers and writes the pick id
  over the shape's boundary, opaque and unblended, into a render target, where
  three applies no colour conversion. It draws only the device pixel under the
  pointer, into a one-pixel target, because three 0.185's readback counts rows
  from the top on WebGPU and from the bottom on WebGL2, so the bottom origin
  M4.8a assumed holds on WebGL2 only, and a one-pixel target has one row.
  Checked on a device by `bench/browser/backend-probe.mjs --pick` (see
  `bench/browser/README.md`, "Node picking (M4.8b)"). Since 2026-10-28
  (`tsk_b6f2f936ae92`) `createPickedNodeHitProvider` in `@prnt/dagr-react`
  answers M5.2a's synchronous provider contract from those asynchronous picks:
  only from a pick settled for the same world point and displayed revision,
  stale otherwise, one pick in flight (unit tests only, no device run).
  `DagrCanvas` uses it behind `hitTesting="gpu"` for a mouse, priming picks
  from hover; touch and pen keep the CPU index (unit tests only). Since
  2026-10-28 `bench/browser/gpu-hover.mjs` drives that canvas with real mouse
  events over 10,000 laid-out nodes at the fit zoom: on AMD RDNA 2 in Chrome
  156, on `webgpu` and not a fallback adapter, every hover and click of 250
  samples per run named the node the CPU index puts there, at DPR 1 and 2
  (see `bench/browser/README.md`, "Hover and click at 10,000 nodes"). Since
  2026-10-28 `frame-profile.mjs --pick` prices the pass on that device: one
  pick in flight on every frame at 10,000 nodes with springs in flight costs
  0.1 to 0.2 ms of CPU per pick, its effect on missed ticks did not separate
  from runs without it, and it holds about 0.2 MB of GPU buffers, with each
  pick's 4-byte readback buffer destroyed once read (see
  `bench/browser/README.md`, "What a pick costs a frame"). So the pass runs
  on pointer moves, as `DagrCanvas` runs it, and the default stays `'cpu'`:
  a click while nodes glide and a press not hovered first are ignored on the
  GPU path, and touch and pen use the CPU index anyway. WebGL2's pick cost is
  not measured. Since 2026-10-28 the living graph demo (`@dagr/living-stage`,
  in `apps/demo` and the docs site's `/demos/living`) answers its mouse hover
  from GPU picks and lightens the hovered node's fill halfway to white, keeping
  the halo on what the last edit touched. On AMD RDNA 2 in Chrome 156,
  headless, with the canvas on `webgpu` and the adapter not a fallback, an
  uncommitted script moved Playwright's mouse onto a node and off it again
  five times over the built `apps/demo`, and the node's pixels turned to the
  lighter fill and back every time, at DPR 1 and 2. Edge hits started
  2026-10-29 (`tsk_a633c7bf733d`) with the policy and a CPU backend:
  `createEdgeHitIndex` tests the centrelines handed to `setEdges`, identified
  by their `SceneEdge` id, within a caller's tolerance (half the drawn width
  plus pointer slack, over the zoom), the nearer centreline winning and an
  exact tie going to the later edge. Nodes take precedence because they are
  drawn over edges, and the index answers for the routes it was built from, so
  a host rebuilds it with each displayed revision. Unit tests only, including
  agreement with a linear scan; the provider contract's `GraphHitTarget` has
  no edge kind yet and `DagrCanvas` does not report edge hits. Still open: an
  edge target in the provider contract and on `DagrCanvas` (node first, then
  edge), its cost at 10,000 nodes, and a consumer demo.
- [x] **M4.9a** Backend selection and reporting: a `backend` preference,
  `renderer.backend` reports what came up, the differences documented, a
  browser probe harness counting pixels.
- [x] **M4.9b** Backend parity: the same TSL drawn through both backends on
  one machine, compared pixel by pixel with the tolerance derived from the
  antialiasing ramp and a control that must fail. Byte-identical on an Apple M4
  in Chrome 155. Passes on AMD RDNA 2 in Chrome 156 (2026-10-26) with 4 of
  1,760 edge-band pixels differing by 1. A hand-run check, not a CI gate.
- [x] **M4.10a** Profile the consumer path before optimizing: named backend,
  machine, graph sizes, rich-node tiers, edge styles, hit testing, update cost,
  frame-time distribution and memory. This is evidence, not a 60fps claim.
  First slice: `bench/browser/frame-profile.mjs`, shapes and straight edges
  from 1,000 to 10,000 nodes, still and animating, on WebGPU on an Apple M4 in
  Chrome 155. At load 4 to 5 every row holds one 60 Hz tick at the 95th
  percentile (under heavier load the animated 10,000 row's update tail grew),
  and the CPU cost per frame is `setNodes` and `setEdges` (about 5 ms at
  10,000) rather than `render`'s 0.4 ms; that slice did not measure GPU time. Edge
  styles (2026-10-18, `--edges`): dashed edges cost the same as straight ones,
  and smooth edges hold one tick still but not animating at 10,000 nodes,
  where re-tessellating 13,169 curves takes 26 ms a frame against 4 ms for
  the same points as polylines. Rich-node tiers (2026-10-18, `--nodes=rich`):
  a label and a card tier hold one tick at the 95th percentile at every size,
  still and animating, and add 1.2 to 1.5 ms to an animated frame at 10,000
  nodes, a cost that follows the node count rather than the 0 to 90 elements on
  screen. Node hit testing (2026-10-18, `--hit`): a query is under the
  browser clock's 0.1 ms, and rebuilding `DagrCanvas`'s CPU index over the
  nodes as drawn, which a click on an animated frame pays, is 1.5 ms at 10,000
  nodes; every row holds one tick. Edges, ports and GPU picking are not
  measured. Memory per pass (2026-10-19, `--memory`, counting GPU buffers and
  textures through `GPUDevice`, and the V8 heap plus typed-array stores
  after a forced collection): the empty renderer holds 55.3 MB of
  canvas-sized render targets at 1280 by 720 and DPR 1 (221.2 MB at DPR 2), 44.2 MB of them the 4x multisampled colour
  and depth, against 3.0 MB of node and straight-edge buffers at 10,000 nodes
  (12.3 MB of edges when smooth). Moving nodes allocates nothing; moving edges
  recreates the group's buffers every frame, 2.2 MB a frame straight and 12.5
  smooth, freed as it goes. The node and edge passes keep a CPU copy of what
  they upload, and rich-node tiers retain 1.0 KB of heap a node with no tier
  open. GPU time per pass is left to M4.10.

<a id="m410-current-outcome"></a>

- [ ] **M4.10** Performance: 10k nodes at 60fps, animating with springs in
  flight. Name zoom, DPR, backend, adapter, browser and machine; break frame
  time down by pass, including instance updates, draws and picking when enabled.
  **The all-moving 10k smooth-edge 60 Hz goal remains unmet.**

  Current outcome (evidence through 2026-10-30):

  - On Apple M4, Chrome 155 headed, WebGPU, DPR 1, `fit`, 10k smooth nodes
    with a tenth moving held the 16.7 ms tick in three paired runs on
    2026-10-25: `setNodes` 1.5 ms, `setEdges` 3.0 to 3.1 ms. See
    [the measured partial-motion row](bench/browser/README.md#with-shape-instances-checked-before-their-field-names-are-built-2026-10-25).
  - On AMD RDNA 2, Chrome 156 headed through WSL2, WebGPU, DPR 1, `fit`,
    cleaning given points in one pass reduced all-moving smooth `setEdges`
    to 6.7 to 7.0 ms (paired main: 7.2 to 7.6). Missed ticks did not separate:
    1.4% to 3.4% against 0.8% to 3.7%. The control tick changed from
    17.6 to 17.7 ms to 16.7 ms during the pairs; these results do not establish sustained 60 Hz. See
    [the latest retained tessellation change](bench/browser/README.md#with-a-routes-given-points-cleaned-in-one-pass-2026-10-27).
  - Allocation and GC remain measured costs, not a solved bottleneck. The
    2026-10-27 headless AMD capture counted 361 scavenges (757 ms pauses) and
    43 mark-compacts (260 ms) over 660 moving frames. The 2026-10-28 headed
    NVIDIA RTX 4090 profile attributes 53% to 59% of sampled allocation not
    reclaimed by scavenges to edge motion's `advance`. Sampling adds overhead
    and leaves 4 to 5 MiB per frame unreconciled with the trace. These adapters,
    modes and profiling runs cannot be compared as a frame-time trend. See
    [GC traffic](bench/browser/README.md#scavenges-mark-compacts-and-survivor-traffic-2026-10-27)
    and [site attribution](bench/browser/README.md#survivors-by-allocation-site-2026-10-28).

  - The retaining-path and allocation-space investigations (#186 and #189)
    found current-frame references and V8 pretenuring phases, without a bounded
    byte-identical runtime remedy. Forced full-GC snapshots and instrumented
    collector runs are diagnostic evidence, not ordinary frame performance.
  - The 2026-10-30 results matrix (#191) measured 10k nodes on NVIDIA RTX 4090,
    Chrome 156 headed, WebGPU, `fit`, DPR 1 and 2, three runs each. Every row
    holds the 16.7 ms tick except smooth edges with every node moving, which
    miss 3.9% to 5.1% of ticks at DPR 1 and 7.4% to 9.3% at DPR 2. GPU median
    and p95 stay below 3 ms (maximum 5.7), with timestamps still rounded to
    1,024 ns. These results do not establish the all-moving 60 Hz goal.

  Active task: `tsk_ad4b7ce0d93b`, complete the matrix with smaller sizes,
  another zoom, rich nodes, WebGL2, a second machine and unrounded GPU
  timestamps. The 10k slice is merged; the whole matrix is not done.
  The [browser measurement record](bench/browser/README.md#springs-in-flight-on-webgpu-m410)
  preserves the optimization sequence, rejected experiments and reproduction
  details; [working notes](specs/roadmap-notes.md#m4-renderer-dagrrender)
  preserve historical decisions. CPU baseline inclusion remains the maintainer's
  call; GPU frame time cannot join the machine-matched Node gate. Publish the
  measured limit when the target is missed, without marking the goal complete.
- [x] **M4.11** HTML overlay: DOM elements positioned in world coordinates,
  culled and capped.
- [x] **M4.12** Rich nodes: HTML visuals with three-tier semantic zoom as
  library policy.

## M5: React + demo = v0.1

- [x] **M5.0** Landing page and the muslin re-port.
- [x] **M5.1** `@prnt/dagr-react`: `<DagrCanvas>`, `useDagr`, `<Html>`.
- [ ] **M5.2** Reusable selection, hover and gesture interaction. Split into
  the independently shippable slices below; GPU picking is one future adapter.
- [x] **M5.2a** Shared React gesture and controlled selection contract with a
  caller-supplied hit provider, demonstrated by the generic atlas. Define stable
  node/port identity, coordinate and scene-revision semantics, and stale-target
  rejection first. Record a bounded CPU interaction baseline before M5.2b. Click selects;
  drag pans. DOM controls and keyboard activation keep their native behavior.
- [x] **M5.2b** Native `DagrCanvas` node hit adapter using current displayed
  geometry, with shape, draw-order and stale-target tests. CPU implementation
  may ship independently of M4.8b; its limits and cost must be explicit.
  Shipped with `onNodeClick`, `onNodeHover`, `onBackgroundClick`, opt-in
  `navigation`, `apiRef` camera flights (`focusNode`, `fit`), `nodeTiers`
  level of detail, and `detectBackendSupport`. Edges and ports are not hit
  targets (M6.3a owns ports); see roadmap-notes.
- [x] **M5.3a** The animation a consumer gets for free: `useDagr` over
  `createLayout`, so an edit is a `relayout(patch)` with a `LayoutDelta` rather
  than a cold run, and `<DagrCanvas animate>` driving M4.7c's
  `createSceneMotion` and `createMotionLoop` off that delta, with the
  component's own coalesced frame as the loop's scheduler. Animation is a prop
  and the sprung box is handed to `onFrame`, so a following camera stays the
  caller's line of code. The engine runs in the graph listener, which is neither
  render nor an effect.
- [x] **M5.3b** The demo that proves it: an animated living demo (grow, prune,
  relayout), shipped as `@dagr/living-stage` and mounted by both `apps/demo` and
  the docs site's `/demos/living`, which is the deployed one. Three verbs, one
  `graph.batch` each, and a readout that counts what the delta moved and what it
  left alone. The camera decision holds: the graph is built so no edit can
  enlarge the drawing, which makes one fit correct forever, and the refit button
  is pressed by a person. Two shapes of the relayout verb were written and
  measured out: a rank change moved up to 30 of 32 nodes and made the drawing a
  rank taller in every variant of it, and a same-rank rebind moved none, in all
  200 places it could be applied.
- [x] **M5.4a** The tarball a consumer installs: `workspace:^` fixed (the
  publish command is `pnpm publish`), `src` shipped so source maps resolve,
  per-package README and LICENSE, `publint` + `arethetypeswrong` + a scratch
  install as a standing gate in `packaging/`. Lockstep versioning across the public packages (seven since 0.1.3),
  no changesets.
- [x] **M5.4b** Docs: Docusaurus getting-started, API reference pages for all
  packages, v0.1 readiness review, and all six packages published to npm
  (seven from 0.1.3, with the explorer).
  Registry checksums, dependency ranges, and a fresh external consumer were
  verified after publication.
  The `onLayout` continuity change is implemented: a fourth
  `continues` argument tells consumers whether the delta is relative to the
  last successful committed layout, with or without animation. Tests cover
  cold runs, skipped intermediate layouts, graph changes, and failed layouts.
  The living demo consumes this signal instead of keeping its own comparison.
- [x] **M5.5** Containment reserved in the graph model: `parent`,
  `update-node-parent`, the invariants, `PatchOp` documented as an open
  union. Layout ignores `parent` until M7.
- [x] **M5.6** `@prnt/dagr-explorer`: `DagrExplorer`, a generic interactive
  graph explorer (views, search, connection tracing, groups, details drawer)
  composed from named parts, with node content virtualized by on-screen size
  over a swappable base layer. Spec:
  `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`. Built in a
  maintainer-directed session, outside the queue above: M5.6c onward join that
  queue only if the maintainer places them there.
- [x] **M5.6a** `@prnt/dagr-render/core`: a three-free entry for `Camera2D`,
  `fitZoom` and `shapeEdgePath`, so a server never evaluates `three` to draw
  SVG.
- [x] **M5.6b** Package scaffold and pure core: types, validation, layout,
  search. Private until M5.6f. Self loops are kept and not drawn.
- [x] **M5.6c** Camera, viewport, SVG base, visible set, overlay tiers, pins.
  The pure core (camera arithmetic, the visible set, the point-to-node lookup)
  landed first as M5.6c-1. The React viewport that uses it landed as M5.6c-2,
  internal until M5.6d.
- [x] **M5.6d** Root state, remaining parts, `labels`, `DagrExplorer`,
  `styles.css`. Landed with `useExplorerApi` and a capped search list. The
  package is still private.
- [x] **M5.6e** Roving focus, spatial navigation, reveal, server rendering.
  One tab stop with arrow navigation to any node, mounted or not; every part
  renders on a server and hydrates cleanly. The package is still private.
- [x] **M5.6f** Docs, demos, bench, browser validation, measured SVG ceiling.
  The docs page, live demos and Node benches landed as M5.6f-1. M5.6f-2
  checked the demos in Chromium and WebKit at desktop and phone widths
  (`bench/browser/explorer-check.mjs`), which found and fixed two defects
  (`Escape` dropping focus to the page, and WebKit not scrolling past an
  unfocused graph), measured the SVG base smooth to about 4,000 nodes on an
  Apple M4, added `@prnt/dagr/explorer` and `@prnt/dagr/render/core` to the
  umbrella, and removed the package's `private` flag. Published in 0.1.3 on
  2026-10-05, with the maintainer's approval.

## Explorer learning and mobile track

**M5.7**, maintainer-directed 2026-10-26: Explorer teaches relationships through
rich summaries, explanations, examples and evidence, with essential reading
flows usable on a phone. This is an extension of M5.6, not a claim that the
existing phone-width browser checks establish a good mobile learning experience.
The implementation owner remains `@prnt/dagr-explorer`; demos exercise public
parts. Do not put the only fix in a demo stylesheet.

| Slice | Dispatch task | Outcome and exit check |
| --- | --- | --- |
| **M5.7a** Authoring skill and direction (this increment) | `tsk_47bf1df19adb` | A portable [learning Explorer skill](skills/dagr-learning-explorer/SKILL.md), a typechecked example and sourced distribution/architecture findings. Runtime changes remain planned. |
| **M5.7b** Mobile reading baseline and repair (next) | `tsk_eb73b47f05e3` | Reproduce search, inspect, follow and close, page scroll, pan/pinch/cancel, rotation and software-keyboard flows. Repair adaptive controls/details in the library over the current renderer. Record before/after screenshots at 320, 390 and 768 CSS-pixel container widths in Chromium touch emulation and WebKit; distinguish real-device checks. Primary touch targets aim for 44 CSS pixels. Essential actions need no hover or double tap. Preserve keyboard, focus return, SSR and reduced motion. |
| **M5.7c** Shared-state outline reader | `tsk_17e1212b51f0` | An exported outline/list companion to the map, selectable at any width, using the same content, IDs, query, selection, trace and details. Resize and mode changes retain reading position/selection with explicit focus rules. One scenario suite exercises both presentations, controlled state, removal, cycles and SSR. Depends on M5.7b. |
| **M5.7d** Authoring evaluation and distribution | `tsk_1b6fb4253f02` | Compare skill-guided and baseline authoring on codebase, prerequisite and process briefs; verify correctness, relationship explanation and source/detail access. Validate local and pinned-Git skill discovery. Evaluate version-matched npm bundling separately, preserving the publication gate. Depends on M5.7a. |

Architecture direction: retain one `ExplorerRoot` state/command layer and one
learning-content model. Adapt the shell (toolbar, search, side panel versus
compact details) to available container space and pointer capability. A semantic
outline is a second presentation of the same graph, not a second renderer or
independent application. Shared selectors, content components and behavioral
contract tests prevent map/outline drift; do not copy search or adjacency logic.
The public API may need narrow additions where the shared outline exposes gaps.

Keep SVG/DOM for the first mobile slice. The native base remains its existing
[stage 2 task](#next-jobs-in-priority-order), `tsk_d2b0f45e432b`, for measured
rendering capacity, not user-agent detection. If SVG and native bases coexist,
they share layout, camera snapshots, visible sets and interaction semantics;
run the same behavioral tests for each, with visual parity tested separately.
A phone does not automatically mean a different GPU backend.

Prioritize readable details and relationships over stuffing every explanation
inside a node. Guided sequences and deep links can build on the report host;
new tour/audio APIs still require evidence from R4/R5. Learning success means
finding a concept, explaining a relationship and reaching its supporting detail,
not merely drawing more nodes. Research and unresolved alternatives are in the
[M5.7 working record](specs/roadmap-notes.md#m57-learning-explorers-and-mobile-2026-10-26-utc).

## M6: VDSL core in v0.1, interactions planned for v0.2 (`@prnt/dagr-vdsl`)

A toolkit for building a node-graph language, not a node-graph language. It
defines no ontology: no built-in node kinds, no config schema of Dagr's
invention; a consumer brings its own spec through an adapter. What Dagr
competes on is not this milestone's interactions, which incumbents already
solve well, but a graph that stays legible when it changes, which is M3. M6
demonstrates the claim; it is not the claim.

- [x] **M6.1** Node spec adapter: `defineRegistry` keyed on the consumer's
  kind union, threaded through as `NodeSpec<K>`.
- [x] **M6.2** Port typing and connection validation: a type token per port,
  a consumer-supplied compatibility predicate. Cycle rejection is a policy
  the adapter declares, not a default.
- [ ] **M6.3** Drag-to-connect on M5.2's interaction contract: add explicit port
  hit targets, an in-flight edge, and drop targets filtered by M6.2's predicate.
  Include keyboard connection and cancellation. GPU picking is not mandatory.
- [ ] **M6.3a** Port hit adapter through M5.2a's provider contract, including
  geometry, coordinate space, draw order, animation and stale-port semantics.
- [ ] **M6.3b** Accessible connection gesture on M6.3a, using M6.2 validation
  and committing exactly one graph mutation per successful connection.
- [ ] **M6.4** Subgraph nodes, drill-down form: containment via M5.5's
  `parent`, navigation into a container. The real work: one engine per
  container kept alive across navigation (re-entering must not be a cold
  run), and per-view patches derived from the root patch (outside ops
  dropped, boundary edges given a stand-in endpoint, a reparent as two
  patches to two engines). Boundary nodes are ordinary sources and sinks.
- [ ] **M6.5** Collapse and expand: a selection into a subgraph node and back,
  boundary edges rebound to its ports. Stability holds only for nodes whose
  rank survives the collapse; re-verify cyclic input against M3.7a's held
  reversed set, which the original notes predate.
- [ ] **M6.6** Two reference DSLs, deliberately unalike: one acyclic and
  value-shaped, one with feedback and a real-time evaluator. The second is
  the one that finds the wrong assumptions.

## M7: Compound layout (`@prnt/dagr-layout`)

Inline nesting: parents and children drawn together as nested boxes, rather
than M6.4's drill-down. What it touches, verified against the code: crossing
reduction (Forster's layered compound work), a per-edge minlen and weight
channel on the ranking view rather than a new ranker, positioning, and
`wire.ts`, which currently drops `parent`. The success criterion: reproduce
the campaign drawing without the hand-rolled tile packer, except the six grid
tiles, which are not a compound-layout problem. Not scoped into tasks until
M6.4 has shipped and drill-down has been used.

## Campaign demo track

Maintainer-requested (2026-08-14); the decision record is
[plans/2026-08-14-campaign-demo.md](plans/2026-08-14-campaign-demo.md). P3 to
P5 are M4.3 to M4.5 and live in M4.

- [x] **P1** `@dagr/campaign`: the dataset, 16 node kinds, 23 edge kinds,
  3,010 nodes and 7,100 edges at the default seed, structure tested as graph
  invariants across seeds.
- [x] **P2** Content-derived zoom limits, keyboard zoom.
- [x] **P6** Campaign cards through `createRichNodes` with per-kind sizes.
- [x] **P7** Deep links, hover highlight, committed screenshots, a schema
  docs page.
- [x] **P8** The demo on a public URL.

## Demo into the docs site

From [plans/2026-08-15-demo-into-docs.md](plans/2026-08-15-demo-into-docs.md).

- [x] **D1** `@dagr/campaign-stage` extracted, mounted at `/demos/campaign`,
  the separate demo service retired.
- [x] **D2** The campaign's own spacing; edges colored by where they come
  from.
- [x] **D3** Edge highlight on hover, via a per-edge channel.
- [x] **D4** The fixture out of the product docs and into its own package.
- [x] **D5** A drawn mark per kind, on the title tag and on the card.
- [x] **D6** The zoom as something a reader can read and press.

## Daily report track

Maintainer-requested (2026-10-17), in parallel with the renderer queue above
and never ahead of it. A daily report of this repository's own activity
(merged PRs, packages touched, milestones, reviews), published as an explorer
graph and read by the maintainer first. It lives in a folder of this
repository, runs on the shipped `@prnt/dagr-explorer`, and changes a package
only where the report hits a gap that R4's log records. The generated reports
are data, not source: they are written append-only outside `main`, never as a
PR a day. R tasks are taken by maintainer-directed sessions or a job dedicated
to this track, not by the renderer queue's daily increment, so "the first
ready slice" above never means an R task. The decision record is in
`specs/roadmap-notes.md` under "Daily report track".

- [ ] **R1** Report format v0 and its validator: views, nodes with rich
  content, sources, confidence, status against the previous report, and a
  tour. Node ids derive from stable names (PR number, package name, milestone
  id), so a thing that persists keeps its place from one day to the next.
- [ ] **R2** Generator: one JSON report a day from the repository's history
  and PR records, written to the agreed append-only location, which R2
  decides and records.
- [ ] **R3** Host app on `DagrExplorer`: a tour bar, deep links and a source
  list built on `ExplorerApi`, with a zero-click text outline. No package
  changes.
- [ ] **R4** Two to three weeks of daily use by the maintainer, with a short
  log of what was skipped, what confused, and what was missing. The log
  decides R5.
- [ ] **R5** Promote only what the log asks for into `@prnt/dagr-explorer`:
  highlight sets, fit to a set, deep-link helpers, then an `ExplorerTour`
  part, then cross-day stability through the incremental engine.
- [ ] **R6** Narration experiment: one TTS clip per tour step with a
  transcript, played by a plain `<audio>` element. Kept only if used. Ambient
  sound is out of scope.

## Tracked, not promised

Web-component wrapper, private 3D camera exploration, Remotion tutorials, and
release automation. Initial npm publication is complete; future publication
remains human-gated. Private experiments are not public release fixtures.
