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
  capture script, baseline JSON committed, a CI bench step comparing against
  baseline with a 10% tolerance. README development guide section. (The bench
  step later moved off CI entirely: the committed baseline is machine-matched
  and CI runs a different architecture, so the gate now runs locally before a
  pull request opens. See `bench/README.md`.)
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
  nothing about the code, so `pnpm bench:ci` measures again. At the time this
  ran on CI, that runner ran `pnpm build` immediately before the bench step,
  and a run started while the machine was still busy with it put 7 of 10
  benchmarks past the readability ceiling where the same benchmarks on a
  settled machine came back all readable and inside tolerance. (The gate later
  moved off CI entirely; see M0.2 above and `bench/README.md`.) A regression
  exits 1 and is never retried; only an unreadable run exits 2. Two unreadable
  runs in a row fail, saying plainly that nothing was measured.
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
  **TWO OF THREE, AND A SECOND RECAPTURE (2026-08-16), because the gate had
  started measuring the box rather than the code.** The maintainer called both
  halves after four sessions escalated the same symptom, and the evidence is
  that branches which changed nothing the gate can see failed it: unmodified
  `main` failed one run and passed the next a minute later; a markdown-only
  branch passed at a 1-minute load of 4.56, failed at 5.07 and passed again at a
  HIGHER 6.18; a branch with a zero-byte diff against `packages/graph`,
  `packages/layout` and `bench` reported `descendants, 10k` at +94.9% and
  `rank > 1k` at +59.9% on a run whose PIPELINE entry, which runs ranking, came
  in at -5.5%. The cause is the machine rather than the file: PR #21's baseline
  was captured when one agent ran on this box at a time, and it now carries
  several sessions at once, some in an unrelated checkout that cannot read the
  gate lock. Sessions coped by re-running until green, which is the habit that
  hides a real regression.
  `pnpm bench:ci` now measures up to three times and passes when two runs pass,
  fails when two fail, and calls three runs that never agreed UNDECIDED, which
  is not a pass: the property claimed is a repeatable pass. An unreadable run is
  still neither, and counts towards neither two, so the old "retry once on exit
  2" is the same rule with a budget. A harness error fails on the first attempt,
  because a stale report is stale on the next run too. NO TOLERANCE CONSTANT
  WAS LOOSENED, deliberately: a wider tolerance hides the drift and the
  regression together, so a fresh baseline plus repetition is what replaces a
  looser number. Said precisely, because the loose version of that sentence is
  not true: the formula ADDS THE BASELINE'S OWN rme, so the recapture widened
  the effective allowance on seven of the fourteen gated entries and put four at
  the 25% cap where two were, `descendants, 10k` and `pipeline > 1k` joining
  `build > 1k` and `rank > 10k`. Those four are named in `bench/README.md`
  rather than left to be found. The command does not change, so AGENTS.md does
  not either.
  **ON A FAILURE IT REPORTS WHETHER THE SAME ENTRY FAILED EVERY RUN**, which is
  the cheapest real-versus-noise test available and costs nothing beyond runs
  already taken: a regression is in the code, so it fails the same entry every
  time, while noise picks a different one.
  Proved rather than asserted, and the failures are reported with the passes.
  Four runs of the gate against the shipped file, on a branch whose diff is zero
  bytes against `packages/graph` and `packages/layout`. Three PASSED: one at 2
  of 3 with `rank > 1k` failing a single run at +47.3%, and two at 2 of 2 with
  nothing failing. Under the old one-shot gate that first one had a one-in-three
  chance of blocking a merge over code that changed nothing measurable. The
  fourth FAILED, and it is the honest limit of the design rather than a
  footnote: it started at a 1-minute load of 2.37 and ran into a neighbour burst
  that took the box to 6.37, and `sources, 10k` failed both runs, at +25.3% then
  +40.4%. A BURST OUTLASTS A GATE. Two of three narrows the window noise can
  fail a merge through and does not close it, so the same-entry report is
  evidence rather than proof, which is why it says to read a repeat as real
  UNTIL THE CODE SAYS OTHERWISE.
  Then the historical example this harness was verified against in the first
  place, the `diffAttrs` allocation guard reverted in a scratch commit that was
  never pushed. On a quiet box the gate FAILED in two runs, both on `2k
  updateNodeAttrs, unwatched`, at +89.3% and +100.7% against about +22%
  allowed, with no other entry failing. Run at a load of 8.17 the same branch
  failed the same entry at +92.4% and +90.4% with three other entries failing
  alongside it, which is the two readings of the same fact: the regression is
  visible either way, and a loud box adds names to the list.
  The recapture itself is in `bench/README.md`, and three things in it are worth
  reading. FIVE MEASURED RUNS RATHER THAN THREE, because the first three
  disagreed by 32.5% on `build > 1k` and three runs cannot say which is the odd
  one out; the two extra runs cost 70 seconds each and moved the choice. PICK
  THE RUN TO COMMIT BY CLOSENESS OVER THE GATED ENTRIES ONLY, since the exempt
  `2.5k successors` swings further than anything else in the file and pulled the
  first pick further than the fourteen entries that gate did. AND THE OLD FILE
  WAS NOT FAR WRONG: eleven of the fourteen gated entries moved under 6%, so the
  flakiness was never mostly a stale baseline. It is the between-run spread on
  this machine, 30.6% on `build > 1k` and 40.7% on `isAcyclic, acyclic` across
  five idle runs with no code changing, which a recapture re-centres and cannot
  narrow. That is the standing argument for the second control workload
  `bench/README.md` keeps naming, and `rank > 1k` is where to start.
  **THE GATE NOW CHECKS THE MACHINE IT IS COMPARING AGAINST (2026-08-18),
  because the box changed CPU under it and nobody could see that from the
  numbers.** `bench/baseline.json` names an AMD EPYC-Rome VM, captured
  2026-08-16. `os.cpus()[0].model` on the dispatch box reads
  `Intel Xeon Processor (Skylake, IBRS, no TSX)` two days later, with the same
  platform, the same arch, the same eight cores and the same `node v22.23.2`.
  The harness had recorded that field on both sides since it was written and
  never once compared them, and `machineInfo`'s own docstring said the machine
  is "never gated against, because the gate reads control-normalised ratios and
  nothing else". A ratio corrects for a UNIFORMLY slower machine. It does not
  correct for a machine that is slower at some things, and this one is: on
  unmodified `main`, benched deliberately rather than in passing, the gate
  failed 2 of 2 at a 1-minute load of 0.54 under a 5-minute 0.40, the quietest
  start on record here. SAY WHICH RUN, BECAUSE THE TWO SAY DIFFERENT THINGS.
  Run 1 failed exactly six entries, `2.5k outEdges`, `descendants, 10k`, both
  `pipeline` entries and both `rank` entries, at +27.1% to +44.3%, while every
  allocation-heavy entry passed: `2k updateNodeAttrs` at +0.0%, +1.7% and -6.2%,
  and both `isAcyclic` entries inside 0.3%. THAT RUN IS THE DIAGNOSIS, because
  it separates the two families cleanly: memory-latency-bound work moves and
  allocation-heavy work does not, which is the control drift `bench/README.md`
  already named, arriving as a step change rather than as noise. Run 2 was the
  louder of the two and failed eleven, adding the three `updateNodeAttrs`
  entries, `build > 1k` at +61.9% and `topologicalOrder`, and taking
  `descendants, 10k` to +69.8%. A loud box adds names to the list, which is the
  same reading M0.2's `diffAttrs` verification recorded. The six that failed
  BOTH runs are the six from run 1. The morning run of the same day had already
  failed `main` 2 of 2 at 0.58, so this is twice.
  `platform`, `arch`, `cpu`, `cores` and `node` are the identity, because each
  changes the shape of the work rather than only its speed. `ci` and
  `loadAverageAtCapture` are not, because they describe who ran it and how busy
  the box was, and gating on them would block a merge over a neighbour's build.
  A CPU model compares with its whitespace collapsed, since `os.cpus()` pads
  some models and a merge blocked by two spaces teaches the next reader to
  distrust the check. A report with no machine at all is a NOTE and not an
  error: the field is optional in schema 1, so its absence is not evidence of a
  mismatch.
  IT IS A HARNESS ERROR RATHER THAN A REGRESSION, and that placement is the
  point rather than a detail. A different machine reproduces on the next run by
  construction, so `bench:ci` stops after ONE measurement instead of three, the
  way it already stops on a stale report. It matters more here than anywhere
  else in the harness, because a mismatched baseline moves whole families of
  entries at once and therefore fails the SAME entries every run, which is
  exactly what this gate calls its strongest evidence for a real regression.
  The table still prints: rejecting the comparison is not a reason to hide the
  numbers a human needs to decide on a recapture. THERE IS NO OVERRIDE FLAG, by
  decision. It would be the silent no-op this harness exists to prevent, and it
  would be reached for on exactly the runs whose numbers mean least.
  WHAT IT DOES NOT DO IS MAKE A GATE GREEN. The recapture is the maintainer's
  call, it is queued rather than taken, and until it happens no branch passes
  `bench:ci` on this box. It is also NOT the second control workload: the
  30.6% between-run spread on `build > 1k` was measured across five idle runs
  on ONE machine, which a machine check cannot see and a recapture cannot
  narrow.

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
  costs nothing. (It landed at M3.3 as `graph.batch`, source compatible as
  predicted, and the consumer that said what shape it wanted was M3.2's engine.
  Transactions stayed declined, for a reason this entry already contains: replay
  does not restore insertion order, so a rollback cannot be honest.)
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
- [x] **M2.2b** Cycle breaking v2: a feedback arc set chosen for the
  acyclic view it leaves rather than for how many edges it reverses. The
  objective is minimum TOTAL SPAN of that view, the sum over its edges of
  `max(0, rank(target) - rank(source) - 1)` under longest-path ranks, subject
  to a reversal count low enough that the drawing still reads. Tests: total
  span and view depth on both bench corpora, asserted with ceilings, beside the
  existing acyclicity and `m/2` assertions rather than in place of them.
  SUPERSEDED BY M2.2c for what currently ships: the component rule below still
  ships exactly as stated, the greedy order it scoped does not, and the current
  numbers are in the M2.2c entry. What follows is this task's own record.
  WHAT SHIPPED, in three lines, because the rest of this entry is a record and
  a run scanning it for instructions should not have to read the record to find
  them. (a) `feedbackArcSet` reverses a backward arc ONLY when its two
  endpoints share a strongly connected component; a backward arc between two
  components lies on no cycle and is left pointing as authored. That is the bar
  row below, made the default: 74 / 81 ranks / 22,726 dummies on the 1k and
  4,620 / 203 / 1,359,680 on the 10k. (b) It is a PROOF and not a measurement.
  A cycle in the result would either lie inside one component, where every arc
  runs forward in the greedy order, or use a kept cross-component arc, which
  strictly advances the component DAG's topological order. Neither can close.
  (c) The time budget was not spent, it was recovered: the per-vertex arc
  `Map`s became CSR typed arrays and Tarjan walks the same collapsed rows the
  greedy walks, so the call is FASTER than the unscoped version, 8.5ms median
  against 11.0ms on the 10k. Everything after this paragraph is the measurement
  run that chose this and a list of what has already been tried.
  THE NEXT CANDIDATE'S BAR IS THE SHIPPING PASS, WHICH IS NOW THE BAR ROW
  BELOW RATHER THAN A CANDIDATE BESIDE IT: beat 1,359,680 dummies at 4,620
  reversals or fewer under longest path, or 226,676 under simplex run to
  convergence, without going past 203 ranks. The target is unchanged and is
  still the ground truth's 32,050 at 796, a factor of forty.
  THAT BAR WAS MET AND MOVED: M2.2c's least-squares order beat it on all three
  axes, so what ships is no longer this entry's pass and the current bar lives
  in the M2.2c entry below (174,222 at 857, within 160 ranks). Everything after
  this line is the record of the run that set the old bar, in its own tense.
  ONE WORD OF TERMINOLOGY BEFORE THE RECORD, because the record was written
  before the implementation and its vocabulary froze there. Everywhere below,
  "the shipping breaker" and "the shipping ELS" mean the UNSCOPED greedy order,
  which reverses every backward arc and is what shipped up to this task. It is
  the table's `unscoped greedy ELS` row (6,327 / 154 / 1,414,263 on the 10k).
  What ships now is the `minus cross-component (SHIPPING)` row. The record is
  left in its own tense rather than rewritten, because it is evidence for a
  decision that has since been taken and editing evidence to agree with the
  decision it produced is how a record stops being one.
  What is recorded below is a measurement run rather than an implementation,
  and its first result is that the objective this task was originally written
  with is WRONG. The prescription this repo carried until today, written into
  the tail of M2.3 and into M2.4b, was "build a better feedback arc set, target
  reversals near 800 and view depth near 60". Four families of replacement were
  measured, six configurations in all, every run deterministic and every run on
  the maintainer's machine. The reversal count turns out to be ANTI-correlated
  with view depth across every candidate measured, on both corpora, and on the
  10k corpus, the one every later milestone commits against, cutting the count
  made the thing M2.4b actually pays for WORSE rather than better. This is the
  second M2 task to be sized against a prescription that measurement then
  refuted (M2.3 built network simplex on one), so the numbers are recorded in
  full rather than summarised: all four families are dead ends and nobody
  should spend a run rediscovering them.
  Definitions first, because the whole finding turns on measuring the right
  quantity. The view is `acyclicView(graph, reversed)`, its depth is
  `max(longestPathRanks(view)) + 1`, and its total span is the sum over its
  edges of `max(0, rank(target) - rank(source) - 1)`. That last number is
  exactly how many dummy nodes M2.4b's splitter mints, one per rank an edge
  crosses beyond the first. The cross-check that it is the right quantity, and
  not a plausible-looking proxy of the kind this entry exists to warn about, is
  that it reproduces the 1,414,263 dummies M2.3 recorded on the 10k corpus to
  the digit, and the 40,430 on the 1k, both of which were counted by a
  different route.
  `smallCorpus()`, 1,000 nodes, 4,000 edges, 24 authored layers:

  | candidate                          | reversals | depth | dummies      |
  | ---------------------------------- | --------- | ----- | ------------ |
  | unscoped greedy ELS                | 422       | 62    | 40,430       |
  | authored back edges (ground truth) | 71        | 24    | 2,665        |
  | DFS back edges, insertion roots    | 42        | 115   | 30,954       |
  | DFS back edges, sources first      | 62        | 117   | not measured |
  | ELS per component                  | 23        | 84    | 20,676       |
  | minus cross-component (SHIPPING)   | 74        | 81    | 22,726       |
  | median relaxation, whole graph     | 582       | 60    | 24,482       |
  | median relaxation, per component   | 47        | 74    | 17,155       |
  | condensation longest-path levels   | 109       | 78    | 19,727       |

  `largeCorpus()`, 10,000 nodes, 40,000 edges, 60 authored layers:

  | candidate                          | reversals | depth | dummies      |
  | ---------------------------------- | --------- | ----- | ------------ |
  | unscoped greedy ELS                | 6,327     | 154   | 1,414,263    |
  | authored back edges (ground truth) | 796       | 60    | 32,050       |
  | DFS back edges, insertion roots    | 1,651     | 601   | 1,601,415    |
  | DFS back edges, sources first      | 1,500     | 801   | not measured |
  | ELS per component                  | 2,454     | 320   | 1,522,128    |
  | minus cross-component (SHIPPING)   | 4,620     | 203   | 1,359,680    |
  | median relaxation, whole graph     | 15,457    | 61    | 230,083      |
  | median relaxation, per component   | 7,680     | 133   | 364,118      |
  | condensation longest-path levels   | 10,255    | 134   | 962,662      |

  The two relaxation rows are iterative and are reported at their best point:
  on the 1k the whole-graph form is its best round and the per-component form
  had converged, and on the 10k they are 12 rounds and 6 rounds respectively.
  The sources-first DFS row has no dummy count because a view 801 ranks deep on
  a corpus authored with 60 layers is disqualifying on depth alone and counting
  its span would only have said so more expensively; the insertion-roots DFS
  row is measured because it turned out to be the sharpest row in the table.
  The ground-truth row is not an algorithm: it reverses exactly the edges the
  corpus generator authored as back edges, which is knowledge no cycle breaker
  has, and it is in the table as the bound to argue against.
  The minus-cross-component row is the cheapest thing in the table to state:
  run the shipping breaker, then delete from its answer every edge whose
  endpoints lie in different strongly connected components, changing nothing
  else. It is the only row that is strictly better than the shipping breaker on
  BOTH reversals and span on BOTH corpora, and it was found by algorithms-review
  during this run rather than by the measurement pass, in the gap left by the
  conflation two paragraphs down. It is also 32% deeper on the 10k and 31%
  deeper on the 1k, so it sits on the same depth-against-reversals curve as
  everything else here rather than escaping it, and it needs a components pass
  it cannot currently afford. Read the ranker paragraph below before pricing
  it.
  Conclusion one, and be careful about its scope twice over, because the
  tempting wide version of it is false in two different ways. Across the
  ALGORITHMS measured, on BOTH corpora, reversal count and view DEPTH pull
  against each other: every candidate that cut the reversal count made the view
  deeper, on the 1k as much as on the 10k, and the three rows that got
  shallower (whole-graph median relaxation at 61, per-component median
  relaxation at 133 and condensation levels at 134, all on the 10k) each bought
  it by reversing MORE edges than the shipping breaker. The ground-truth row is
  the exception and is not an algorithm, which is conclusion three's whole
  point: the tension is a property of the heuristics tried here and not a law
  about feedback arc sets. The second limit on scope is the corpus. What holds
  on the 10k and NOT on the 1k is that span goes the same way as depth. On the
  10k, insertion-roots DFS reverses 1,651 edges against the shipping 6,327, a
  cut of nearly four times, and pays 1,601,415 dummies against 1,414,263, which
  is 13% MORE of exactly what M2.4b mints. Per-component ELS says it in one
  line: 61% fewer reversals, 2.1 times the depth, 8% more span. On the 1k the
  same insertion-roots DFS reverses 42 against 422 and comes out at 30,954
  dummies against 40,430, 24% FEWER, while still being 86% deeper (115 ranks
  against 62). So on the 1k a candidate can make the view much deeper and cut
  span anyway, and a run that measured only the 1k would have concluded that
  DFS is an improvement and shipped it. The 10k is the corpus that decides
  this, and saying which corpus a claim holds on is not pedantry here. M2.4b,
  M2.9, M3.9 and M4.10 all commit against the 10k, and M3.9 has already written
  down why (a cold run on 1k is a few milliseconds, so it is dominated by
  constant factors and flatters exactly the wrong thing). The 1k has 4,000
  edges against 40,000 and 242 intra-component edges against 20,229, so its
  cycle structure is nearly trivial and a deeper view has almost nothing to
  span across. State the corpus with the claim. This project has been bitten by
  the unqualified version before, in M1.4's `topologicalOrder` tie-break claim,
  which two reviewers then disproved.
  Conclusion two: what M2.4b pays for is total span, span follows depth on the
  10k, and neither follows the reversal count anywhere. So the objective for a
  better cycle breaker is minimum total span of the acyclic view, subject to
  keeping the reversal count low enough that the drawing still reads. The
  reversal count stays in the record as a CONSTRAINT, not as the thing being
  minimised, and the `m/2` bound `cycles.ts` proves is a bound on the
  constraint rather than on the objective. The only ALGORITHM that reached the
  prescribed depth of about 60 on the 10k reached it by reversing 15,457 of
  40,000 edges, and a drawing with 38% of its edges drawn backwards is not a
  drawing anyone wants, which is what the constraint is there to rule out.
  Conclusion three: the two are not inherently opposed, and the ground-truth
  row is the proof. Reversing exactly the 796 authored back edges gives 796
  reversals AND depth 60 AND 32,050 dummies, all three at once, on the corpus
  where the shipping breaker gives 6,327 and 154 and 1,414,263. A solution
  exists and it is a factor of forty on the quantity that matters. Greedy does
  not find it and neither does any of the four families measured here, which is
  what makes this a real task rather than a tuning pass.
  Conclusion four, the shape of the problem. An edge between two distinct
  strongly connected components lies on no cycle, so no correct cycle breaker
  ever has to reverse one, and the greedy order has nothing that stops it: the
  sequence it builds is global, and every edge running backwards in that
  sequence is reversed whether or not any cycle required it. That class was
  counted rather than assumed, because the first draft of this paragraph
  asserted it was large and had no measurement behind it: of the shipping
  breaker's 6,327 reversals on the 10k, 1,707 cross a component boundary, and
  on the 1k it is 348 of 422. Say what that does and does not license, because
  the first draft said "provably unnecessary" and the proof does not reach that
  far. What the component theorem gives is that NO CYCLE REQUIRES those
  reversals, so a construction avoiding them exists. It does NOT give that they
  can be dropped from this particular set, because reversing a set is not
  deleting it: a set can hit every cycle by deletion and still leave one when
  reversed, since the reversed arcs create paths the original graph did not
  have. algorithms-review built the witness, on four nodes: `u->v, v->a, a->b,
  b->a, u->b`, whose components are {a,b}, {u} and {v}, so `u->v` is
  cross-component and on no cycle. Under the order (v, a, b, u) the backward
  set is {u->v, b->a, u->b} and reversing it is acyclic; drop `u->v` from the
  set and the view holds `u->v, v->a, a->b, b->u`, which is a cycle. On both
  bench corpora the drop happens to be legal, and that is a measurement rather
  than a theorem: dropping all 1,707 and all 348 leaves views `longestPathRanks`
  accepts.
  DROPPING AND SCOPING ARE DIFFERENT OPERATIONS AND AN EARLIER DRAFT OF THIS
  ENTRY CONFLATED THEM, which is worth stating because the conflation hid a
  candidate. Dropping keeps the order the greedy pass built and merely removes
  edges from the set it produced: 6,327 minus 1,707 is exactly 4,620, and that
  is the "minus cross-component (SHIPPING)" row above. Scoping REBUILDS the
  order inside each component and lands somewhere else entirely, at 2,454. The
  two rows are 4,620 / 203 ranks / 1,359,680 dummies and 2,454 / 320 /
  1,522,128, so they are not variants of one idea, they are two ideas.
  Scoping the same heuristic to components removes the cross-component class
  outright, and the whole trade is one line on the 10k: 61% fewer reversals,
  2.1 times the depth, 8% more span. The middle number is the part worth
  internalising: a reversal SHORTENS the path it sat on as well as pointing an
  edge the wrong way, so taking away reversals nobody needed lengthens the
  longest path. Cutting reversals and cutting span are in tension through
  exactly that mechanism, and any candidate that treats the two as the same
  goal will trade one away without noticing. The component structure that makes
  this concrete: the 1k corpus has 871 components, largest 56, 860 of them
  singletons, and only 242 of its 4,000 edges intra-component; the 10k has
  5,129 components, largest 3,493 and next 543, 5,115 singletons, and 20,229 of
  40,000 edges intra-component. Roughly half of the 10k's edges can be ruled
  out of any reversal decision on structure alone, and the shipping breaker
  rules none of them out.
  WHICH RANKER THE SPAN COLUMN ASSUMES, because every figure above is under
  `longestPathRanks` and the answer changes if you forget that. M2.3 shipped a
  second ranker, and a caller can select it. algorithms-review re-measured the
  same views through the network simplex tightener at its default 20,000-pivot
  budget, warm started from the same longest-path ranks, and an independent
  verifier reproduced all fifteen of those figures to the digit. On the 10k, as
  longest path then simplex at 20k pivots: shipping ELS 1,414,263 then 423,426;
  per-component ELS 1,522,128 then 311,179; minus-cross-component 1,359,680
  then 268,589; DFS 1,601,415 then 1,214,286; ground truth 32,050 then 19,196.
  On the 1k the simplex column is 17,285, 15,484, 15,713, 23,802 and 1,924 in
  the same row order. Depth came out IDENTICAL under both rankers in all ten
  rows and stayed identical at 200,000 pivots, which is worth recording as an
  observation about these two corpora and not as a property: `simplex.ts` is
  right that minimum total edge length and minimum height are different
  objectives, it simply does not bite here.
  DO NOT READ THE 20,000-PIVOT COLUMN AS A RANKING OF THE VIEWS, and this is
  the correction that matters. That budget does not converge the 10k, and the
  rows are not equally far from converged, so the column ranks how fast each
  view converges rather than how cheap it is. At 200,000 pivots: shipping ELS
  224,789 (the figure already in `simplex.ts`'s docstring, which is the
  cross-check that the seam is honest), minus-cross-component 226,676,
  per-component ELS 309,732. THE ORDER REVERSES: the row that looked 26% better
  than shipping at 20k is 38% worse at 200k, because it was essentially
  converged at 20k and had nowhere left to go while shipping had most of its
  gain still ahead. Cost runs the same way, shipping being the most expensive
  row to solve at every budget tried (97.4s at 200k against 1.3s). So a run
  quoting a simplex figure must quote its pivot budget beside it, and a
  candidate that wins only at a truncated budget has not won.
  ONE PAIRING GENUINELY INVERTS BETWEEN THE RANKERS and it is worth naming:
  per-component ELS is worse than shipping under longest path (1,522,128
  against 1,414,263) and better under simplex at 20k (311,179 against 423,426).
  That is real, and it is why this entry no longer calls that candidate a dead
  end. It does not survive convergence, so it is a lead rather than a result.
  ALSO NOTE WHAT A CALLER CAN ACTUALLY REACH TODAY: nothing here, directly.
  Neither ranker takes a feedback set, both call `feedbackArcSet` themselves,
  and the only route to these numbers is to pre-reverse the edges in your own
  graph and hand the flipped graph to the stage, which forfeits the
  `reversedEdges` bookkeeping the router needs to draw those edges the right way
  round. That is fine for measurement and is not a feature. It also means the
  win IS reachable by the one change this task contemplates, since replacing
  `feedbackArcSet` moves both rankers at once.
  What a future run has to beat, stated so it cannot be met by accident, and
  restated after algorithms-review refuted the first version of it. THE OLD BAR
  SAID: nothing measured beats the shipping breaker's 1,414,263 dummies without
  reversing more edges than it does, so land under 400,000 at 6,327 reversals
  or fewer. That was wrong, and the counterexample was sitting in the gap
  between dropping and scoping: minus-cross-component reverses 4,620 and spans
  1,359,680 under longest path, fewer reversals AND less span, legal on both
  corpora. THAT ROW IS NOW THE SHIPPING PASS, so the bar and what ships are the
  same object again: beat 1,359,680 dummies at 4,620 reversals or fewer under
  longest path, or beat 226,676 under simplex run to convergence, and do it
  without going deeper than the 203 ranks it costs. The target remains the
  ground truth's 32,050 at 796, or 19,196 under simplex, which is a factor of
  forty either way. Note the simplex figure that moved: the old bar quoted
  224,789, which is the UNSCOPED order at 200,000 pivots and is 0.8% BETTER
  than what ships. That is not a regression hiding in the change, it is the
  convergence-speed caveat two paragraphs down doing exactly what it warns
  about: at the default 20,000 pivots the shipping view is 268,589 against the
  unscoped 423,426, a 37% cut, and it is also faster to solve at both budgets
  (1.80s against 3.82s, and 51.1s against 60.5s). The unscoped order simply had
  more of its gain still ahead of it. Quote the budget with the figure, and
  beat 226,676 rather than 224,789 because 226,676 is what a caller can
  actually get today.
  Beware the 1k corpus while doing it, per conclusion one: on the 1k EVERY
  candidate in the table cuts span, insertion-roots DFS included, so measured
  there alone all four families look like wins. On the 10k two of them (DFS and
  per-component ELS) make span worse instead, and the other three only cut it
  by reversing more edges than the shipping breaker does. Per-component median
  relaxation is the sweetest trap, reaching 17,155 dummies at 47 reversals on
  the 1k, which is below the 17,285 M2.3's network simplex reaches on the same
  corpus with a whole extra stage and 20ms of pivots. That is worth knowing for
  what it says about which lever is bigger, and worth distrusting on the
  strength of the same candidate's 364,118 at 7,680 on the 10k.
  What it may not spend, and what it turned out to cost, which are different
  numbers and the gap between them is the useful part of this paragraph. The
  rank stage's committed bench baseline on the 10k is 13.18ms median, and the
  unscoped ELS was 10.4ms of it warm (35.2ms cold), so a replacement had
  roughly 2ms of headroom before the gate's tolerance was gone. A Tarjan pass
  measured on its own costs 4.1ms on that corpus, twice the whole budget, and
  this entry concluded from that pair of figures that a component-scoped
  candidate could not be added in front of the existing breaker. That much was
  right. WHAT THE PAIR OF FIGURES DID NOT SAY, and what the shipping pass
  demonstrates, is that a component-scoped candidate need not be ADDED at all.
  Note what `cycles.ts` used to build: its "condensation" is the weighted
  simple condensation, the collapse of parallel arcs into one weighted arc, and
  has nothing to do with strongly connected components, so there was no
  component structure sitting there to be read out. The pass now builds both
  out of ONE set of CSR rows. The per-vertex arc `Map`s became typed arrays,
  Tarjan walks the collapsed out-rows the greedy already walks, and the whole
  call came out at 8.5ms median against the unscoped 11.0ms, warm, median of
  25, both measured in one process on one machine. So the components were not
  bought out of the 2ms of headroom, they were paid for by deleting a hash
  lookup per arc and an allocation per vertex, and the headroom grew rather
  than shrank. THE GENERAL LESSON, which is worth more than the specific one: a
  cost measured for a pass STANDING ALONE prices adding it, not fusing it, and
  this entry spent a run treating the first number as though it bounded the
  second.
  THE SPEEDUP IS NOT UNDER THE GATE, AND THAT WAS A DELIBERATE CHOICE RATHER
  THAN AN OVERSIGHT, so do not read the paragraph above as a banked gain. Both
  reviewers of the shipping run raised it: `bench:ci` passes and reports the
  rank entries as FASTER than baseline (-14.6% on the 10k and -25% to -39.6% on
  the 1k, depending on whose machine), with a note asking for a refresh so the
  gain is protected. `bench/baseline.json` was left alone, so a later change can
  give the whole gain back and the gate will still say ok, because regressing
  to the old cost is inside the old tolerance. The reason is that
  `pnpm bench:baseline` can only recapture WHOLESALE: it rebases every entry
  including `@dagr/graph`'s, which this change does not touch, and the box runs
  two agents at once by design. A reviewer's own gate run on a machine matching
  the baseline read four `@dagr/graph` entries between +19.6% and +82.8% from
  load alone. Capturing wholesale under that load writes the load into every
  entry and makes the gate permanently lenient for packages this change never
  went near, which is a worse failure than one stale-but-lenient rank entry. THE
  REFRESH IS OWED AND NEEDS A QUIET MACHINE, which is the same scheduling
  problem already queued for the maintainer as the bench gate's two-runner
  collision, and it should be a run of its own rather than a rider on a feature.
  Finally, read M2.4b's bench-gate paragraph before assuming this task unblocks
  it. Even a perfect cycle breaker may not put M2.4b inside the gate, for a
  reason that has nothing to do with cycle breaking, and that decision is the
  maintainer's rather than this task's.
- [x] **M2.2c** Cycle breaking v3: a least-squares vertex order in place of the
  greedy one, which is what finally moved the number M2.2b identified and could
  not shift.
  WHAT SHIPPED, in three lines, because the rest of this entry is the record.
  (a) `feedbackArcSet` gives every vertex the height minimising the sum over
  arcs of `(s(target) - s(source) - 1)^2`, solves that as `L s = b` by
  Jacobi-preconditioned conjugate gradient, orders the vertices by height, and
  reverses the backward arcs of that order. (b) M2.2b's component rule is
  UNCHANGED and its proof carries over untouched, because that proof was already
  stated over an arbitrary linear order and never mentioned how the order was
  built. (c) The `m/2` bound is no longer inherited from Eades, Lin and Smyth
  and is now established by construction: an arc runs backwards in exactly one
  of an order and its reverse, so the smaller of the two backward sets is at
  most half, and the pass counts and takes the smaller side.
  THE RESULT, as reversals / depth / dummies under longest path, against
  M2.2b's bar row in the same units. On the 10k: 857 / 160 / 174,222 against
  4,620 / 203 / 1,359,680. On the 1k: 40 / 64 / 14,746 against 74 / 81 /
  22,726. BETTER ON ALL THREE AXES ON BOTH CORPORA, which is stronger than the
  bar asked for: the bar allowed depth to stay where it was and only required
  span to fall. Under network simplex at the default 20,000-pivot budget the
  10k is 105,975 against the old view's 268,589, and at 200,000 pivots 99,698
  against 226,676, so the win survives convergence and does not depend on which
  ranker or which budget it is quoted at. That last sentence is the one M2.2b's
  record demanded of any candidate and is why these four numbers are here.
  WHAT IT DID NOT DO. It did not close the gap to the ground truth, it narrowed
  it from a factor of forty-two to a factor of five, and the whole of what is
  left is DEPTH. The 10k view is 160 ranks on a corpus authored with 60 layers,
  and a view that occupied 60 would mint about the ground truth's 32,050. So
  the next candidate's bar is 174,222 dummies at 857 reversals or fewer without
  going past 160 ranks, and the lever is depth rather than the reversal count,
  which is now within 8% of the ground truth's 796 and is not where the
  remaining span is.
  WHY IT WORKS, and it is worth stating because it is not the shape of anything
  in M2.2b's table. Every candidate there was a LOCAL rule: greedy ELS decides a
  vertex's place from that vertex's own degrees, DFS from the order its
  traversal happens to hit, and both then never revisit the decision. A layered
  graph's structure is not in any one vertex's degrees, it is in the agreement
  between all of them, so a local rule cannot see it. Least squares is global:
  every arc pulls both endpoints, the answer is the balance of all of them at
  once, and the 2% of the 10k corpus authored as back edges are outvoted by the
  98% that are not rather than being taken at face value one vertex at a time.
  The relaxation family in M2.2b's table was reaching for this and stopped
  short: median relaxation on the whole graph got to depth 61 and had to reverse
  15,457 arcs to do it, which the constraint rules out. The difference is that
  the least-squares order is solved rather than iterated to a chosen round, so
  it lands on the objective's actual minimiser instead of somewhere on the way
  to it.
  WHAT WAS MEASURED BESIDE IT AND NOT TAKEN, recorded so nobody spends a run
  rediscovering them. Both are in `cycles.ts` in full.
  DROPPING THE COMPONENT RULE, which is the same least-squares order with every
  backward arc reversed: 1,117 / 124 / 128,141 on the 10k and 110 / 39 / 8,388
  on the 1k. That is 26% LESS span than what ships, at 30% more reversals, and
  it is the only thing measured in this task that beats the shipping choice on
  the stated objective. IT IS A ONE-LINE CHANGE AND IT IS THE MAINTAINER'S CALL,
  not a tuning pass: it means accepting that some edges are drawn backwards when
  no cycle required it, in exchange for a quarter of the dummy nodes. It was not
  taken here because the component rule is a shipped property with a proof and a
  test that calls a violation of it a bug rather than a trade, and replacing the
  core heuristic is already one decision for one task.
  A HINGE OBJECTIVE, charging `max(0, s(u) + 1 - s(v))^2` so a long forward arc
  costs nothing and only a backward or too-short arc is penalised, relaxed from
  the least-squares answer. At 1,024 rounds it reaches 664 / 117 / 101,146
  unscoped, the best row anything in this task produced. IT IS NOT TAKEN, and
  the reason is the lesson M2.2b already wrote down about pivot budgets: that
  row is its best point and not its converged one. At 4,096 rounds it is
  594 / 140 / 127,695 and at 16,384 it is 485 / 184 / 186,856, degrading
  monotonically towards the greedy pass as it converges, and 1,024 is a number
  tuned to this corpus. A candidate that wins only at a truncated iteration
  budget has not won. What would make it a result is a stopping rule that is
  about the graph rather than about the count, and that is a real lead for a
  later run.
  THE COST, which is the one axis that got worse. The call is about 2.3 times
  the greedy one on the 10k corpus, 25.0ms against 10.8ms measured in one
  process on one machine, so the ratio is the claim and the absolute is not.
  That is deliberate and it is not close: it
  removes 1.19 million dummy nodes from every stage downstream, and M2.4b
  measured what those cost when they existed, 5.2 seconds and 735MB on a
  pipeline that runs in about 30ms without them.
  THE BENCH GATE FAILS ON THIS CHANGE AND IT HAS NOT BEEN RUN ON A MATCHING
  MACHINE, which is the one thing outstanding. On the implementing agent's box,
  an x64 Node under Rosetta on an M1 Pro against a baseline captured on an arm64
  M4, `bench:check` reports rank +59.8% on the 10k against +19.5% allowed and
  +49.6% on the 1k, and pipeline +47.3% and +65.3%. Those are the right sign and
  are not a valid gate result: the same run also failed two `@dagr/graph`
  entries, +24.6% and +24.1%, on a package this change does not touch, which is
  the machine mismatch `bench/README.md` warns about showing up exactly as it
  says it will. WHAT IS OWED is a `bench:ci` run on the maintainer's machine and
  then a decision, and the decision is a rebaseline rather than a fix: the rank
  stage really is slower, deliberately, and the entry it is bought against is a
  pipeline cost that only exists once M2.4b lands. Note that the refresh already
  owed from M2.2b's run is the same refresh, so the two should be taken
  together.
  THAT DEBT WAS PAID on 2026-08-06, on the maintainer's instruction, and the
  paragraph above is left as written because it is the record that predicted
  what the run then showed. `bench:ci` on a settled arm64 machine (Apple M1
  Pro, node v23.11.0, the maintainer's current box rather than the M4 the old
  baseline named) failed exactly as forecast: five untouched `@dagr/graph`
  entries between +24.2% and +78.8%, the mismatch signature, plus rank +33.7%
  on the 1k and +23.6% on the 10k, the deliberate cost, with pipeline inside
  2% both corpora. The decision taken was the rebaseline this entry called
  for: `bench:baseline` recorded all 15 benchmarks on this machine, and the
  rerun gate passed with every entry ok and none noisy, rank -3.8% and -1.7%
  against the fresh baseline. The refresh M2.2b owed is folded into the same
  capture.
  WHAT MOVED IN THE SUITE, because a heuristic swap moves every pinned number
  downstream of the ranking and a reader of that diff needs to know which
  direction each one went. The two corpus pins in `layout.cycles.quality.test.ts`
  and the six ceilings beside them (tightened, since nothing was traded away
  this time). The depth and workload pins in `layout.position.test.ts`, 81 rows
  to 64 and 203 to 160. Four pins in `layout.order.test.ts` and the whole
  `order-crossings.golden.json` corpus. THE CROSSING COUNTS ROSE AND THAT IS NOT
  A REGRESSION IN THE ORDER STAGE: crossings are counted only between adjacent
  layers, a shallower ranking puts a quarter more of the 10k corpus between
  adjacent layers (10,528 edges to 13,131), and so a quarter more of the graph
  became countable at the same moment. The entries whose depth fell furthest are
  exactly the ones whose counts rose furthest. The comparison across that diff
  is not like for like.
  ONE TEST WAS REBUILT RATHER THAN REPINNED, and it is worth copying elsewhere.
  `layout.simplex.test.ts`'s tight-tree regressor was a CYCLIC graph whose
  acyclic view came out of whatever `cycles.ts` returned, so this task moved all
  three of its numbers and it stopped witnessing the tight-tree regression it
  was built for. It is now written as the view itself, already a DAG, so
  `feedbackArcSet` returns nothing on it and no later change to cycle breaking
  can move it. A witness about stage B should not be hostage to stage A.
  WHAT THE TIE BREAK ACTUALLY DECIDES, recorded because the loose reading is
  wrong. It settles EXACT equality of two doubles and nothing else. Two
  structurally interchangeable vertices have equal heights in exact arithmetic
  and do not generally come out of the solve as equal doubles, so the last bit
  of an iterative solve is what orders them. That is reproducible, which is the
  property M3 needs, and it is arbitrary, and it costs nothing in quality
  because the two orders of an interchangeable pair are equally good by
  construction. What it does mean is that a pinned set moving on a graph with
  symmetric parts is a weaker signal than one moving on a graph without.
- [x] **M2.3** Ranking v2: tight-tree / network-simplex rank tightening.
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
  Landed as `networkSimplexRankStage`, and it does NOT replace the M2.2 ranker
  the way this entry assumed: `defaultStages.rank` is still `longest-path-rank`
  and the new stage is selected per run. The reason is the one thing the entry
  did not price. Minimum total edge length and minimum height are different
  objectives, and longest path already achieves the second exactly, so this
  stage can only spend height to buy length. Six nodes are enough to lose a
  rank of height for a unit of length, and a default that quietly made some
  drawings taller is not a default. What it buys is large and measured, and
  BOTH ENDS OF THE COMPARISON MOVED when M2.2b changed the view both stages
  rank: the 1k bench corpus now goes from 22,726 dummy nodes to 15,713, a 31%
  cut, in about 28ms, and the 10k corpus from 1,359,680 to 268,589 inside the
  default pivot budget, an 80% cut. Over the unscoped view those same lines
  read 40,430 to 17,285 (57%) and 1,414,263 to 423,426 (70%). The stage did not
  get worse, its INPUT got better, so there is less left for it to win, and a
  percentage quoted without its baseline says nothing here.
  Which of the two a run wants is the caller's call and now has a name.
  Cut values come from one postorder accumulation of `indegree - outdegree`
  rather than the textbook's leaf elimination, and a pivot costs the subtree it
  moves and the edges incident to it rather than the whole graph, which is what
  makes the 10k corpus a matter of seconds rather than the prototype's minutes.
  It still does not converge there: 200,000 pivots takes 41 seconds and is
  still improving, so the default budget of 20,000 is a valve rather than a
  promise. The remaining O(V) per pivot is the scan for a tree edge with a
  negative cut value, and a candidate structure for that is the next thing to
  try if M2.9 says the 10k number matters.
  Both M3 requirements landed as asked. The warm start is a stage factory
  taking `initialRanks`, treated as a HINT and repaired into feasibility before
  use rather than trusted, so a stale or hostile one can only choose between
  optima. The stability check is beside the sum check, and it fails without the
  warm start: the perturbed graph re-ranks a node a whole rank away for no
  reason at all when the previous ranks are not passed in.
  One thing found by measurement rather than reasoning, recorded because it
  would be easy to reintroduce: a budget too small to pivot can return a
  ranking WORSE than longest path. It is the tight tree rather than any pivot
  that does it, and an eight-node graph in the suite reaches it, so each
  component keeps the better of the ranking it started with and the one it
  ended with.
  THIS TASK DID NOT UNBLOCK M2.4b, and the 57% above is exactly the number that
  makes it look as though it did. M2.2c IS WHAT DID, by the route the last
  sentence of this block names: a better cycle breaker rather than a better
  ranker. The paragraph below is left in its own tense because it is the
  diagnosis that pointed at the fix, and it was right. Measured on the 10k
  corpus, and stated as it
  read before M2.2b shipped so that the argument stays legible: the greedy
  feedback arc set reversed 6,327 of 40,000 edges, and the acyclic view it
  handed the ranker was 154 ranks deep. The corpus is generated with 60 layers
  and a `backEdgeShare` of 0.02, so roughly 800 edges point backwards by
  construction, reversing those 800 alone leaves a DAG, and that DAG is at most
  60 ranks deep because every other edge runs from a lower layer to a higher
  one. M2.2b has since measured that construction rather than reasoning about
  it: reversing exactly the authored back edges is 796 reversals, a view 60
  ranks deep, and 32,050 dummies. So every ranker in this repo is handed a view
  several times deeper than the graph it came from, before any ranking happens,
  and M2.2b made that WORSE on this axis while making span better: the shipping
  view is now 203 ranks against the same authored 60, because declining the
  reversals no cycle needed lengthens the longest path. Every extra rank is one
  more rank for an edge to span and every rank an edge spans is a dummy node
  M2.4b has to mint, which is why the simplex still returns 268,589 of them at
  the default budget, after a cut of 80% on that corpus (it was 423,426 after a
  cut of 70% when this paragraph was written, over the unscoped view). RANKING
  CANNOT REPAIR THIS: it optimises over the view, and the view is the cycle
  breaker's output. Say ranking rather than ranker, which is how this sentence
  read until M2.2b corrected it: a rank STAGE calls `feedbackArcSet` itself and
  builds its own view (`rank.ts` and `simplex.ts` each do), so a stage is
  exactly where a better breaker would land, and both stages in this package
  are stuck here only because both call the same one.
  What sets M2.4b's dummy count is the feedback arc set rather than the choice
  between longest path and network simplex, and the next real cut in that
  number comes from a better cycle breaker and not from a better ranking. Do
  not go looking for a defect in `cycles.ts`. It is a correct Eades-Lin-Smyth
  implementation and 6,327 is greedy suboptimality, so the work is a better
  heuristic, not a bug hunt in there.
  AMENDED BY M2.2b, and the amendment matters because this paragraph was read
  as a prescription for two runs. The 6,327 against 800 comparison above is
  evidence that the VIEW is wrong; it is not a target for the reversal count.
  Reversal count and view depth turn out to be anti-correlated across every
  candidate M2.2b measured, on both corpora, and on the 10k every candidate
  that REBUILT THE ORDER and cut the reversal count below 6,327 left a deeper
  view AND more dummies than the shipping breaker: per-component
  Eades-Lin-Smyth at 2,454 reversals, 320 ranks and 1,522,128 dummies, and DFS
  back edges at 1,651 reversals, 601 ranks and 1,601,415 dummies.
  THE SECOND HALF OF THE SENTENCE ABOVE, "a pass that un-reverses edges the
  finished order no longer needs", STANDS, and a first draft of this amendment
  deleted it on the grounds that scoping reversals to components is the same
  idea measured worse. That was wrong and algorithms-review caught it: scoping
  REBUILDS the order, an un-reverse pass KEEPS it, and they land in different
  places. Keeping the order and deleting only the cross-component reversals is
  4,620 reversals, 203 ranks and 1,359,680 dummies, which is fewer reversals
  AND less span than the unscoped order on both corpora, and it is what M2.2b
  shipped. It is not free, it costs 32% more depth, but the components pass it
  needs turned out to cost nothing at all once it replaced the arc `Map`s
  rather than running in front of them. It exists because a suggestion was
  tested rather than deleted. The objective, and what M2.2b now carries, is
  minimum total span of the acyclic view with the reversal count as a
  constraint rather than as the target.
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
- [x] **M2.4b** Dummy-node chains: split long edges across ranks into virtual
  nodes, rejoin on output. Tests: chain integrity, no multi-rank edges reach
  later stages.
  LANDED, and the box stayed open until the last thing in this entry was
  settled: the bench-gate decision, which was the maintainer's and is recorded
  at the end. Four persona reviews raised 22 findings across the run and every
  one was fixed and verified by the reviewer who raised it.
  REBASED ONTO M2.2c AND RE-MEASURED, which is what the paragraph this replaces
  asked for, and this is the first line of the entry because most of the rest of
  it was written while the task was blocked. Not a line of the splitter changed
  to get the new number. `m2.4b-dummy-chains` was cherry-picked onto M2.2c, the
  conflicts were resolved toward main's structure, and the same splitter now
  mints 174,222 dummies on the 10k corpus and 14,746 on the 1k, under
  `longestPathRankStage` and therefore under the default pipeline. That is 87.7%
  below the 1,414,263 the branch was measured at and it is EXACTLY the total span
  M2.2c's entry records for the same view, which is the check worth stating: what
  the splitter mints is the total span of the acyclic view, one dummy per rank
  per edge, so the two numbers agreeing is the arithmetic closing rather than a
  coincidence. Depth 160 and 857 reversals on the 10k, 64 and 40 on the 1k, all
  M2.2c's.
  WHAT THE REBASE COST, because "rebase and re-measure" reads cheaper than it
  was. The branch forked at `3ed15a0` and four milestones rewrote the pipeline
  under it (M2.3 ranking, M2.5/M2.6 ordering, M2.6b's default flip, M2.7
  positioning) on top of M2.2c itself. Three source files conflicted. The
  splitter moved onto `acyclic.ts`'s shared view rather than keeping the branch's
  own inlined Kahn sweep, which is where M2.3 put that code so two rankers could
  share it, and it walks `graph.edges()` for the split because a chain is
  recorded against the caller's edge id in the caller's direction and the view
  has neither. Three tests moved and none of them was repinned to a number that
  suited: `layout.simplex.test.ts`'s tight-tree cost ratio was denominated in
  `longestPathRankStage.run`, which used to stop exactly where the tight tree
  starts and now goes on to split, so on its witness (a chain with a source
  hanging off every link) the denominator became quadratic and the run exceeded
  the 16.7M entry ceiling on a `Map`. It is now denominated in
  `feedbackArcSet` plus `acyclicView` plus `longestPathRanks`, which is the unit
  its own docstring always described. The 10k corpus cases in
  `layout.position.test.ts` and `layout.determinism.test.ts` gained explicit
  120-second budgets, because the inherited five seconds was sized for a pipeline
  laying out 10,000 nodes and the roster is now 184,222.
  NOTHING DOWNSTREAM READ A CHAIN, WHICH IS THE BIGGEST THING THIS RUN FOUND,
  AND IT WAS THE ALGORITHMS REVIEW THAT FOUND IT. The splitter was correct, the
  contract checks were correct, and the chains were INERT. `order.ts` and
  `position.ts` both built their adjacency from `graph.edges()`, neither had ever
  read `virtualChains`, and no graph edge touches a dummy, so a dummy was an
  isolated node in both indexes: it joined a layer, took a `nodeSep` gap and a
  coordinate, and constrained nothing. Measured on the 10k corpus at that point:
  adjacent-layer segments 13,131 with the chains and without, the order stage
  reaching 88,301 crossings either way, the golden crossing corpus identical
  either way, and Brandes-Koepf's type 1 pass running on every default run and
  marking nothing. 201,091 chain segments read by nobody. So the milestone as
  rebased paid the full cost and bought the polyline shape and the M3 id
  stability, and not the crossing reduction or the straighter long edges it was
  priced on.
  THE MAINTAINER'S CALL WAS TO WIRE THEM IN AND RE-MEASURE, so that is what
  shipped and the paragraph above is the record of what it fixed. `segments.ts`
  is one rule in one place, the same argument `acyclic.ts` makes about two
  rankers sharing one view: an edge with a chain is DRAWN as the chain, so it
  contributes one segment per gap it crosses, and an edge without one is drawn
  as itself. `order.ts`'s index, `countCrossings` and `position.ts`'s index all
  build from it. `Layering` gained an optional `virtualChains`, which is the one
  public API change and is additive.
  WHAT IT BOUGHT, and this is the only like-for-like comparison in the change,
  both layerings scored over the SAME population, every segment of the drawing.
  On the 10k: 8,748,361 crossings reading the chains against 33,932,556 ignoring
  them, a 74% cut. On the 1k: 194,289 against 685,551, 72%. The default position
  stage's total horizontal segment length falls 66% on the 10k and 63% on the
  1k. Ignoring the chains never made those crossings go away, it made them
  invisible: the long edges were drawn and crossed each other either way, and a
  stage that could not see them arranged the layers for the third of the drawing
  it could.
  EVERY CROSSING COUNT IN THE PACKAGE ROSE BY ROUGHLY AN ORDER OF MAGNITUDE AND
  NONE OF IT IS A REGRESSION, which is the same trap M2.2c's entry documents and
  is worse here. The counter went from 13,131 of the 10k's 40,000 edges to all
  214,222 segments, so the population grew sixteenfold at the moment the layering
  over it got better. `order-crossings.golden.json` moved between 1.65x and 3.01x
  per entry, the pinned tables in `layout.order.test.ts` moved wholesale, and the
  whole-result capture in `layout.result.test.ts` moved because the dummy on its
  one long edge stopped being parked at the end of its row. The like-for-like
  numbers are the paragraph above and they are pinned as a test rather than left
  in prose.
  TWO PREDICTIONS THIS PACKAGE HAD WRITTEN DOWN WERE SETTLED, one confirmed and
  one refuted, and both were settled by measurement rather than by argument.
  CONFIRMED: `order.ts` predicted that the transpose pass's saving would collapse
  once every edge was visible, from a hand-expanded corpus, at "1.4% at a cap of
  4" against the shipping 10.7%. A cap of 4 now measures 1.38%. At the shipping
  cap of 8 the pass captures 17.5% of the fixed point's saving on the 10k and
  33.4% on the 1k, where it captured 84.3% and 81.9%. THE CAP AND THE SWEEP
  BUDGET ARE THEREFORE OWED A RE-DERIVATION and this run did not do it: they are
  shipped defaults, the 10k now reaches its sweep floor at four sweeps where it
  used to still be improving at sixteen, and that is a tuning task with its own
  before and after rather than a line in this one. M2.6c TOOK IT: the budgets
  are 4 and 16, and the sweep floor is tighter than this paragraph guessed, at
  ONE sweep on the 10k and three on the 1k.
  REFUTED: every entry that said dummy chains were the prerequisite for
  `brandes-koepf-position` taking the default. The prerequisite is met, every
  segment is visible to it, and the comparison got WORSE. Summing the horizontal
  component over every segment, it is 15.91x `gridPositionStage`'s length on the
  10k and 13.81x its width, against 9.41x and 4.53x over the same corpus ordered
  without the chains; on the 1k 8.03x and 8.61x against 3.63x and 2.76x. That
  second pair is a THIRD baseline rather than the one M2.7's table recorded: it
  still places the dummies and differs only in whether the order stage saw them,
  so neither its lengths nor its widths compare with M2.7's. Both stages improved
  absolutely and grid improved far more.
  THE CAUSE WAS THEN MEASURED RATHER THAN LEFT AS A SUSPECT, by the review, and
  the obvious hypothesis is refuted. That hypothesis was that a chain is the long
  alignment block Brandes-Koepf exists to straighten, so the chains made the
  blocks long and a long block under a longest-path compaction pushes everything
  after it. Capping block length in `solve` and measuring on the 1k with the
  chains consumed: no alignment at all 1.00x, blocks of two already 5.18x,
  uncapped 7.36x with the longest block only 59. Blocks of two cost 70% of the
  blowup and further length buys almost nothing, and a single alignment matches
  the median of four. What is left is that the compaction only ever takes maxima
  and never pulls a block back LEFT, so any alignment at all propagates the
  widest row's packing pressure into every row it touches. The fix is a
  CONTRACTION pass, which is the class shift's real job in the paper. So the
  position default is blocked on that rather than on this milestone, and it is a
  better-understood blocker than the one it replaced.
  THE SPLITTER IS IN ONLY ONE OF THE TWO RANK STAGES, which is the gap this
  milestone leaves open rather than closes.
  `networkSimplexRankStage` declares no chains at all, so a caller who selects
  it gets multi-rank edges reaching the later stages, which is the one thing
  this entry's own headline test forbids.
  The default is unaffected: `defaultStages.rank` is `longestPathRankStage` and
  always has been. What the simplex ranker WOULD mint if the splitter were shared
  is measured rather than guessed, and named with its budget per M2.2b: 105,975
  on the 10k inside the default 20,000-pivot budget and 99,698 at ten times it,
  10,660 on the 1k at both budgets, so that ranker converges on the 1k and does
  not on the 10k. Sharing the splitter is a small change and it was deliberately
  not made here, because this run's instruction was to re-measure the branch
  before changing anything in it, and because a second ranker minting 105,975
  dummies is a second bench conversation and not a footnote to this one.
  M2.4c CLOSED THIS GAP and it was not a bench conversation after all: no
  benchmark selects the simplex ranker, so no workload grew and no entry moved.
  The splitter is in `chains.ts`, both stages call it, and the test that pinned
  the gap is deleted as it said it would be. See M2.4c's entry.
  Dummy ids must be a deterministic function of the edge and the rank
  (`#dummy:<edgeId>:<rank>` or equivalent), never a counter and never iteration
  order, so a chain's identity is stable across runs by construction with no
  bookkeeping. This is a hard requirement of M3 and it was recorded here while
  M2.4b was unbuilt, because changing dummy ids after M2.5 through M2.9 commit
  golden files is a corpus-wide migration and adding it up front cost nothing.
  It is met, by `#dummy:<edgeId>:<index>` rather than by the rank form this
  paragraph suggested, for the reason further down this entry. Without it
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
  which is what completes the rule, and it is done there rather than in an order
  stage because order stages come and go, M2.6b has since moved the default to
  `barycenter-order`, while the roster is what every order stage reads.
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
  exactly one) assumes contiguous integer ranks, which no order stage in this
  package assumes: both take the layers to be the distinct ranks sorted. Decide
  it here, where a real splitter finally gives "spans" a meaning.
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
  SUPERSEDED BY THE MEASUREMENT AT THE TOP OF THIS ENTRY, and left as written
  because it is the paragraph that predicted where the number would land and
  what it would have to be named with. Read the last paragraph of M2.3 and all
  of M2.2b before pricing this one. How
  many dummies this milestone mints is set by the cycle breaker and not by the
  ranker: on the 10k corpus the view the feedback arc set hands the ranker is
  203 ranks deep against a corpus generated with 60 layers, and every rank of
  that excess is ranks for edges to span. M2.3's cut is real and does not touch
  any of that, so the dummies still left on that corpus are a cycle-breaking
  problem arriving at this milestone's door. Name the ranker and the budget
  with that figure, per M2.2b: the splitter on `m2.4b-dummy-chains` runs inside
  `longestPathRankStage`, so what this milestone mints as it stands is the
  longest-path 1,359,680. NOTE THAT THE BRANCH WAS MEASURED AGAINST 1,414,263,
  the unscoped figure, before M2.2b shipped the component rule, so a rebase
  moves this milestone's own numbers by 4% before it changes a line of its
  code. The simplex figures are quoted to say that even the better ranker
  leaves this much, and over the shipping view they are 268,589 inside the
  default 20,000-pivot budget or 226,676 at ten times it, so a bare 268,589
  prices this milestone off a truncated solver.
  (Those five figures are all the pre-M2.2c view's. The rebase moved every one
  of them: 174,222 rather than 1,359,680 under longest path, 105,975 and 99,698
  rather than 268,589 and 226,676 under the simplex at the two budgets, and 160
  ranks rather than 203. The instruction to name the ranker and the budget
  beside the number is the part that did not move, and it is why this entry
  quotes four figures where one would read better.)
  What that lever actually is was got wrong here, and the correction is M2.2b's.
  This entry used to end "if the count is what hurts once this lands, the lever
  is a better feedback arc set", with the 6,327 reversals against roughly 800
  read as the gap to close. The count is not the lever. M2.2b measured four
  families of replacement and found reversal count anti-correlated with view
  depth on both corpora: the candidates that cut reversals hardest produced the
  deepest views, and on the 10k both of them also minted MORE dummies than the
  shipping breaker (DFS 1,601,415, per-component ELS 1,522,128, against
  1,414,263). What this milestone pays for is total span of the acyclic view,
  which follows depth on the 10k. So the lever is a cycle breaker that minimises
  span with the reversal count as a constraint, and M2.2b holds the tables, the
  four dead ends, the reason the 1k corpus disagrees, and the time budget.
  A WARNING ABOUT THE BENCH GATE, for whoever takes this milestone next, and it
  is separate from every cycle-breaking question above. Even a perfect cycle
  breaker may not put M2.4b inside the gate. The pipeline benchmark's committed
  baseline was captured when the pipeline minted NO dummies at all, on 10,000
  nodes. At the ground truth's 32,050 dummies the same pipeline is doing work on
  42,050 nodes, so the comparison is not measuring a regression, it is measuring
  a feature that legitimately does four times the work. No cycle breaker closes
  that gap, and no amount of care with the splitter closes it either. What the
  benchmark should compare, a new entry that measures the splitter honestly
  against its own baseline, or a rebaseline of the existing entry with the
  reason recorded, is a DECISION for the maintainer and the run that lands this.
  It is not something to settle by quietly rebasing a baseline mid-run, and this
  entry deliberately does not prescribe which of the two is right, because
  neither has been measured. Note the sizes involved before assuming the choice
  is academic: at the shipping pass's 1,359,680 dummies the pipeline would be
  working on 1.37 million nodes, so M2.2b was necessary here even though it is
  not sufficient for the gate, and it has landed without being sufficient.
  THE ORIGINAL BLOCK, kept because the rebase is only legible against it. The
  branch was green on typecheck, tests and lint, it survived three persona
  reviews, and it could not merge: on the 10k corpus the splitter minted
  1,414,263 dummies for 10,000 real nodes, the pipeline went from about 30ms to
  5.2 seconds and 735MB, and `pnpm bench:check` reported +16513% against +23%
  allowed while every `@dagr/graph` entry stayed in tolerance, so the machine was
  quiet and the diff was what moved. The cause was NOT the splitter. An A/B on
  the same corpus with `backEdgeShare: 0` gave a feedback arc set of 0, a maximum
  rank of 59 (exactly the authored layer count) and 32,107 dummies, the roughly
  4x roster the task expected. With the corpus's 2% back edges the greedy
  feedback arc set reversed 6,327 of 40,000 edges where about 800 would do, and
  every unnecessary reversal of a FORWARD edge turned it into a backward edge in
  the acyclic view, destroying the layer structure that bounded the depth.
  Longest path then found 153-deep zigzags through a 60-layer graph and a mean
  chain of 47 dummies instead of 3.
  THE BRANCH BLAMED THE WRONG MILESTONE, and that is the part worth carrying
  forward rather than the numbers. It concluded "M2.3 is a hard prerequisite of
  M2.4b", because network simplex minimises total edge length and total edge
  length is what becomes dummy nodes. M2.3 shipped and moved this number by
  nothing: the ranker was never the problem, the view it was handed was, and
  M2.2c is what fixed it by minting a shallower acyclic view for the same ranker
  to rank. M2.3's own entry says the same thing in its own words. A milestone
  that measures a cost and then names the next milestone in the list as its cause
  will be wrong about as often as it is right.
  It answered the question this entry posed. **An edge spans every
  rank the layout ACTUALLY HAS strictly between its endpoint ranks**, and a
  chain holds exactly one node at each of them. Phrased over the occupied ranks
  rather than as steps of exactly one, which was the obvious alternative and is
  rejected here for the reason this entry already gave: no order stage in this
  package assumes contiguous integer ranks, both taking the layers to be the
  distinct ranks sorted, and over ranks 0, 10, 20 the step rule would demand
  nine dummies, eight of them with no layer to sit in. The
  rule is enforced in the runner at the rank boundary, and it names the first
  missing rank in ROUTE order (so a reversed chain reports the hole its polyline
  meets first) together with the node occupying that rank, which is routinely
  not on the chain being blamed.
  Its scope is the half that is easiest to lose, so it is written twice: the
  rule binds a chain that EXISTS. Declaring a chain at all stays optional, and
  the "an orphan dummy stays legal" allowance above survives unchanged. What is
  no longer legal is a chain with a hole in it. Because the rule is phrased over
  the ranks the layout has rather than over one edge's endpoints, completeness
  is a property of the whole ranking: a stage that puts a node on a rank nothing
  previously occupied has to extend every chain spanning it, including chains it
  did not mint. That is correct (a layer that exists is a layer a long edge
  crosses unconstrained) and it is documented rather than softened.
  It also binds the RANKER and not the router. A third-party router that ignores
  `virtualChains` and emits a two-point line for a long edge is not detected. A
  points-count rule ("a chain of n dummies needs a route of at least n + 2
  points") was considered and rejected: straightening a dummy chain is a primary
  goal of M2.7's Brandes-Koepf, so a collinear chain is what a GOOD positioner
  produces and a polyline router could then legitimately emit two points, and a
  rule that has to be withdrawn is worse here than one never claimed. M2.8
  brought the polyline router and it collapses nothing, so the allowance is
  still an allowance rather than a thing being relied on. It stands for whatever
  router wants it.
  **The deterministic-id requirement is met, but not by the id this entry
  suggested.** Ids are `#dummy:<edgeId>:<index>`, where the index is the dummy's
  0-based position along its chain counting from the source the CALLER authored,
  which is the "or equivalent" this entry allowed for. The review disproved the
  rank form against this entry's own stated failure mode: insert one unrelated
  node upstream and every rank shifts, so an edge whose dummies sat at ranks 1
  and 2 has them at 2 and 3, and the surviving id names the SECOND bend before
  and the FIRST after, which misanchors a warm start rather than merely missing
  it. An index is invariant under that shift. The guarantee is claimed narrowly
  and is narrower than "stable": the id survives any edit that does not move the
  edge's endpoints RELATIVE to each other, and when they do move relatively the
  index misanchors by one row rather than losing identity.
  The test this entry asked for, growing a chain from three ranks to four,
  is `keeps the dummies a chain already had when the chain grows by a rank` in
  `packages/layout/test/layout.chains.test.ts`. On its own it does NOT establish
  the id rule, and the review is why that is written down: it lengthens the path
  BELOW the shared dummies so their ranks never move, and both candidate id
  schemes pass it identically. `keeps a chain's ids when an unrelated node
  upstream shifts every rank` is the test that pins it, and M3.6 should read
  that one.
  Two consequences beyond the chains themselves. `bounds` is now the hull of
  the node boxes AND the route points, because a route bending through a
  zero-width dummy at a row's right extreme need not stay inside the box hull;
  see M2.8, which no longer has to make that change. And the residue this entry
  names at the end of the sorted-roster paragraph is untouched and still M2.7's:
  a layer's indices are still not stable when a dummy is INSERTED into that
  layer.
  THE GATE FAILED, AS THE PARAGRAPH ABOVE FORECAST, AND THE DECISION IS NOT
  TAKEN HERE. Measured twice, before and after the chains were consumed, on the
  maintainer's machine and the baseline's (Apple M1 Pro, arm64, node v23.11.0,
  the machine `bench/baseline.json` names, so these are valid gate results and
  not the mismatch signature M2.2c hit). Both runs came back with every
  `@dagr/graph` entry inside tolerance and the final one with nothing `noisy` at
  all, the two workers agreeing on the control to 1.4%, which is the harness
  saying the machine was quiet enough to read.
  AS REBASED, chains declared and unread: pipeline 10k +588.9% against +24.2%
  allowed, pipeline 1k +369.0%, rank 10k +410.9%, rank 1k +279.6%. The 10k
  pipeline went from 91.27ms to 674.03ms.
  WITH THE CHAINS CONSUMED, which is what ships: pipeline 10k +1365.0% against
  +20.1% allowed, pipeline 1k +1131.7%, rank 10k +382.2%, rank 1k +244.5%. So
  consuming them roughly doubled the pipeline cost again, 6.89x the baseline to
  14.65x on the 10k and 4.69x to 12.32x on the 1k, and left the rank stage where
  it was, which is right because the splitter did not change.
  ATTRIBUTED RATHER THAN ACCEPTED, per `bench/README.md`, and this one was not
  predicted in advance: the magnitude rule was written for the rebase and the
  consumption was a second change on the maintainer's instruction, so the honest
  statement is that the number was explained after the fact and not before it.
  Timed by stage in one process on the 10k: rank 115ms, order 856ms with the
  chains against 136ms without, position 47ms. The order stage is therefore the
  whole of the new cost, +720ms of it, and what it is buying is 16.3x the
  segments (13,131 to 214,222) for 6.3x the time, which is sublinear in the work
  and is what a barycenter sweep over a CSR index should do. Nothing is hiding
  in it.
  THE TWO HONEST ANSWERS WERE PUT TO THE MAINTAINER AND (b) WAS CHOSEN. They
  were: (a) A NEW ENTRY, renaming the pipeline entries to say they measure a
  pipeline with chains in it, retiring the old keys with a reason and capturing
  the new ones, so the discontinuity lives in `bench/baseline.json` where the
  next reader of that file will see it. (b) A REBASELINE OF THE EXISTING FOUR
  KEYS with the reason in the commit message, which is cheaper and leaves the
  baseline file saying nothing about the entry having changed meaning. The
  instruction was "rebaseline the four keys with the reason in the message", so
  what this entry and that commit message say is the whole of the record, which
  is the cost of (b) and was accepted knowingly.
  WHAT THE FOUR KEYS MOVED TO, on the machine `bench/baseline.json` names:
  pipeline 10k 91.27ms to 1174.05ms, pipeline 1k 7.30ms to 84.73ms, rank 10k
  22.86ms to 112.49ms, rank 1k 1.57ms to 4.72ms. As control-normalised ratios,
  which is what the gate actually reads, 12.72x, 11.48x, 4.87x and 2.98x.
  ONLY THOSE FOUR MOVED, AND THAT TOOK DOING. `pnpm bench:baseline` rewrites
  every entry the run produced, all fifteen, so running it as documented also
  re-recorded the eleven `@dagr/graph` entries this branch never touches. It was
  run that way first and the rerun then FAILED `2.5k successors` at +32.6%,
  which is a package with no change in it drifting between two runs, and
  committing that capture would have absorbed the drift into that package's
  baseline under cover of a layout milestone. So the eleven were restored from
  the previous capture and only the four layout entries were taken from the new
  run. `capturedAt` is the new run's, which is right for the file and wrong for
  eleven of its entries, and that is said here because the file has no
  per-entry timestamp to say it with.
  THE CAPTURE RUN WAS GATED ON BEING READABLE, rather than taken on the first
  run that finished. A baseline is committed permanently, so noise in it is
  worse than a noisy gate run, which at least re-measures. The machine had
  fifteen agent sessions resident and would not settle for the first two
  attempts: one run came back with four entries `noisy` and three untouched
  `@dagr/graph` entries FAILING between +49.7% and +56.4%, which is the noise
  signature and not a result. The capture was scripted to refuse any run with a
  `noisy` entry or a non-layout failure, and it took the third attempt at a
  1-minute load of 3.07.
  WHAT DID CHANGE IS THE ARGUMENT FOR CALLING IT A REBASELINE AT ALL, and it
  changed in the direction that supports one. As rebased this milestone was a
  cost with no matching benefit: the chains were inert and the pipeline did
  6.89x the work for the polyline shape alone. With them consumed it does 14.65x
  the work and returns a drawing with 74% fewer crossings and 66% less
  horizontal edge length, which is the first time in this milestone's history
  that the extra work has bought the thing it was priced on. A gate entry whose
  baseline was captured on a pipeline that placed 10,000 nodes and ordered
  13,131 segments is not measuring a regression against a pipeline that places
  184,222 and orders 214,222. Note that today's other rebaseline, M2.2c's, was
  authorised for a MACHINE MISMATCH and is still not a precedent for this one.
- [x] **M2.4c** Share the splitter with `networkSimplexRankStage`. Touches
  `packages/layout` and `docs`. The gap M2.4b left open and named in its own
  entry: the splitter was inside `longestPathRankStage` and nowhere else, so a
  caller who selected the other ranker got multi-rank edges reaching the order
  stage, the position stage and the router, which is the one thing M2.4b's
  headline rule forbids. A chainless ranking is legal by design, so no contract
  check fired and the drawing was quietly the one chains exist to prevent.
  WHAT SHIPPED: `src/chains.ts`, holding `splitLongEdges`, the `#dummy:` id
  scheme and the dummy size, called by both rank stages. The stage name is a
  parameter, because a `StageContractError` naming the wrong stage sends the
  reader to the wrong docstring. `defaultStages.rank` is unchanged and the
  default pipeline's output is byte-identical: no golden file, no pinned count
  and no benchmark entry moved. What moved is what a caller selecting
  `networkSimplexRankStage` gets, which is the point of the change, and the
  CHANGELOG carries it as a behaviour change under Changed.
  THE SAVING THIS PACKAGE HAS QUOTED SINCE M2.3 IS NOW COLLECTABLE. The simplex
  ranker mints 10,660 dummies on the 1k corpus and 105,975 on the 10k, both at
  the default 20,000-pivot budget, against longest path's 14,746 and 174,222.
  Those are M2.4b's own predicted figures and they reproduced exactly, which is
  worth one line rather than a section: total edge length minus the edge count
  IS what a splitter mints, so the two agreeing is the arithmetic closing. All
  four counts are now pinned in `test/layout.chains.test.ts`, where they were
  prose in two docstrings and a docs page before.
  IT WAS NOT A BENCH CONVERSATION, which is the thing this entry's own
  prediction got wrong and the reason it is stated here. M2.4b's entry priced
  this task as one, on the grounds that a second ranker minting 105,975 dummies
  rebases something. Nothing in `bench/` selects the simplex ranker: the rank
  entry names `longestPathRankStage` and the pipeline entry runs the default
  stages, so no workload grew. Predicted every entry flat and read against the
  untouched `@dagr/graph` entries in the same worker, per `bench/README.md`.
  THE SPLITTER WALKS THE OCCUPIED RANKS RATHER THAN THE INTEGERS between an
  edge's endpoints, which is the one behaviour change inside the shared code and
  is invisible today. It is how the runner's completeness rule is phrased,
  because the occupied ranks are exactly the layers the order stage builds, and
  a splitter that satisfies the rule it is checked against by construction
  cannot disagree with the check. Both walks give the same answer for both
  rankers, and that is verified by mutation rather than asserted: switching the
  shared splitter to the integer walk fails exactly one test, the one written
  for it. That test drives `splitLongEdges` directly over a ranking with a gap
  in it, because no shipping ranker produces one.
  A CLAIM IN `simplex.ts` WAS WRONG AND IS CORRECTED. It said an exhausted
  budget could leave a gap in the ranks, reasoning that gap-freeness follows
  from optimality. It follows from something stronger that does not mention the
  budget: `tighten` keeps a TIGHT SPANNING TREE per component, growth runs to a
  spanning tree whatever the budget since only the pivots are bounded, every
  tree edge has slack zero, and a pivot shifts one whole side of a cut so the
  entering edge becomes tight while the others keep their slack. A walk of ±1
  steps joins any two nodes of a component, so its ranks are contiguous, and
  each component's floor is subtracted last. The one path that argument does not
  cover is the restore, which hands back the longest-path sweep run over a hint
  as a FLOOR, and a floor can in principle spread a component out.
  THE RESTORE PATH NEEDED A WITNESS RATHER THAN A BIG NUMBER, which the
  algorithms review is what caught. The first draft offered 152,850 hinted runs
  with no gapped ranking as evidence for it, and instrumenting the branch with a
  counter showed how little of that reached it: 60 restores in 21,462 runs, and
  zero in the 1,480 runs of the contiguity test that claimed to cover it. The
  eight-node regressor already in `layout.simplex.test.ts` fires it
  deterministically at a budget of zero, so that is the coverage now, cold and
  floored, and the run count is quoted as restores rather than runs. A gapped
  restore is hard to reach because the two conditions pull against each other, a
  floor big enough to spread a component makes the ranking it saves long and the
  tight tree then beats it, and that is an observation rather than a proof. So
  the property is proved on one path and witnessed on the other, and the
  splitter depends on neither.
- [x] **M2.5** Ordering v1: barycenter sweeps with median fallback, crossing
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
  WHAT SHIPPED, in five lines, because the rest of this entry is a record.
  (a) `barycenterOrder(options)`, `barycenterOrderStage` and `countCrossings`
  are exported from `packages/layout/src/order.ts`; `defaultStages.order` DID
  NOT CHANGE in this milestone and was still `insertion-order` when it landed,
  for the reason in (e). (b) THE SEED IS NOT ROSTER ORDER. It is a connected
  depth-first walk over adjacent-layer edges only, in both directions, roster
  order for the outer loop and `outEdges` then `inEdges` for the neighbours.
  That is the M3.6 answer, and `test/layout.order.test.ts` fails if it moves.
  (c) The metric counts a crossing only between two segments joining the same
  pair of ADJACENT layers, which today is 1,324 of the 1k corpus's 4,000 edges
  (33.1%) and 10,528 of the 10k's 40,000 (26.3%); M2.4b takes both to 100% on
  any graph without self loops, which both corpora are, because a self loop
  spans no rank for a chain to split. (d) `maxSweeps` defaults to 8, since
  re-derived to 4 in M2.6c, and the stage returns the best layering it saw
  rather than the last, because the sweeps are not monotone.
  (e) It did not take the default in M2.5, on two reasons that have both since
  expired: that M2.6 would improve the same stage so one flip could serve both,
  and that the bench baseline could not absorb its cost until it was recaptured.
  M2.6 shipped the improvement and M2.6b did the flip and the recapture, so this
  item is spent; what the default now costs and buys is M2.6b's entry.
  Everything below is the measurement that chose each of those.
  The seed was chosen by measurement, crossings after 8 sweeps: roster order
  3,943 on the 1k and 54,744 on the 10k, the adjacent-layer walk 3,605 and
  35,114, a walk over ALL edges 3,459 and 38,152. The all-edges walk was the
  expected winner, on the theory that the seed is the only place a long edge can
  influence a stage that cannot otherwise see one, and it loses the 10k by 8.0%
  while winning the 1k by 4.2%. The 10k decides it, per M2.2b. The two rules
  also COINCIDE once M2.4b splits every long edge, so this is the behaviour the
  stage will have anyway rather than one that changes character under it.
  The sweep curve, on that seed: the 1k is 7,933 at the seed and 4,619, 3,880,
  3,605, 3,467 at 2, 4, 8, 16 sweeps; the 10k is 94,991 and 50,735, 40,217,
  35,114, 32,503, costing about 5.5ms, 9.5ms, 13.5ms, 21ms and 38ms. Eight is
  the default because 8 sweeps reach 8.3% of the roster seed's crossings on the
  10k and 16 reach 7.6%.
  Two smaller decisions, both measured and both close, recorded so nobody
  re-derives either as a principle. A node with no neighbour in the fixed layer
  is PINNED at its index rather than rescaled into the fixed layer's index
  space: a near wash on the seeds this stage does not use (1k 3,459 against
  3,557, 10k 54,744 against 54,502 the other way) and not a wash on the one it
  does (35,114 against 40,276 on the 10k). It is not a corner case either, 120
  of the 1k's nodes and 1,101 of the 10k's have no neighbour in the layer above.
  THOSE LAST TWO ARE PRE-M2.2c and are 118 and 814 against the ranking that
  ships; the docstring carries the current pair and M2.6d corrected it there.
  And the sort key is barycenter first with the median as the tiebreak, which
  splits the four seed-and-corpus combinations two and two and is chosen on the
  10k from the walk that ships (35,114 against 35,396).
  The allocation-churn item resolved by construction rather than by profiling:
  the stage asks the graph nothing after it builds its index. One pass over
  `graph.edges()` produces flat typed-array adjacency, and every sweep reads
  node numbers, so there is no per-sweep adjacency query to churn and no
  non-allocating traversal form was needed in `@dagr/graph`.
  One thing measured that the plan did not predict, recorded because the first
  version of it was a quality cost hiding inside a time saving. The early stop
  is a HEURISTIC and not a fixed point: what carries into the next round is the
  last layering, not the best one, so a round that improved nothing is not proof
  that the next one will not. Stopping on the FIRST full down-and-up round that
  improved nothing therefore cost quality, and the shipped rule waits for TWO
  consecutive ones. Measured, one round against running the budget out: 32 of
  200 random layered graphs were worse at the DEFAULT budget of 8, worst 1,055
  crossings against 893, and the 1k at a budget of 16 stopped after sweep 14 at
  3,532 where all 16 reach 3,467. Two rounds recovers every crossing of that on
  all three, leaves both budget-8 corpus pins where they are, and costs about
  21.6ms on the 10k against 21.9ms for the one-round stop.
- [x] **M2.6** Ordering v2: transpose refinement pass; crossing-count
  regression corpus committed as golden files.
  WHAT SHIPPED. One transpose pass runs after the sweeps, on the best layering
  they saw, swapping an adjacent pair whenever the swap costs nothing or saves
  something. On the 10k corpus it takes 35,114 crossings to 30,318 (13.7%) for
  about 5ms, and the 1k 3,605 to 3,005 (16.6%). The golden corpus is
  `packages/layout/test/order-crossings.golden.json`, six seeded mid-sized
  graphs from `@dagr/bench`'s own `layeredDag` with the exact count recorded
  twice per graph, with the pass at its default cap and with it off, so a
  regression in either shows up rather than one masking the other.
  Five decisions, all measured, all argued in `barycenterOrder`'s docstring.
  (a) PLACEMENT: once at the end beats after every round and after every sweep
  on quality as well as on time, and by enough that it is not close; the
  figures are in the docstring, where they can carry the note that the ones for
  the two rejected placements were taken before the tie rule and so are not
  comparable to the 30,318 above. The trap it sets is that `position` tracks
  the last working layering and not the best one, so the pass repositions from
  `best` first; a build without that decides arbitrarily rather than badly,
  which is why the test pins layers and not a count. (b) The swap delta is
  EXACT, so a decision is O(deg v * deg w) instead of a rescore, and the suite
  holds it to that against a transpose that decides every swap by a full
  `countCrossings`. (c) TIES ARE TAKEN: a zero-delta swap wins every
  configuration it was tested in. (d) TERMINATION is gated on strictly
  improving swaps ONLY, because a zero-delta swap leaves one available and any
  other gate cycles forever; the witness is three nodes and two edges, two of
  them sharing one neighbour, and both halves of the rule are pinned on it.
  (e) A pair is SKIPPED when either node has no neighbour in either adjacent
  layer, which the tie rule makes necessary: such a node has a delta of zero on
  both sides, so without it every pair containing one is swapped
  unconditionally and the node drifts a slot per pass.
  `maxTransposePasses` defaults to 8, chosen at the knee of a measured cap
  curve, and that it matches `maxSweeps`'s 8 is a COINCIDENCE recorded as one.
  The curve itself lives in `barycenterOrder`'s docstring and is deliberately
  not copied here: it, the tie-rule margins and the caveat below all expire on
  the same event, and three copies means a three-place sweep when it happens.
  THE CAVEAT, and it is not small, stated here because it changes what a LATER
  TASK must do rather than merely describing this one. The saving COLLAPSES
  once every edge is visible, so both the cap and the tie rule are measured
  against a graph M2.4b replaces and BOTH MUST BE RE-DERIVED WHEN IT LANDS
  rather than carried across. The figures behind that are in the docstring.
  `defaultStages.order` did NOT change here. That is M2.6b below.
  THE CAP HAS SINCE BEEN RE-DERIVED AND IS 16, in M2.6c, along with `maxSweeps`
  at 4, so the coincidence is over and the two constants now differ. The knee
  the cap was chosen at does not exist over the drawing the stage sees today.
  THE TIE RULE HAS SINCE BEEN RE-DERIVED TOO, in M2.6d, and it is UNCHANGED, so
  all five of this entry's rules are now measured against the drawing the stage
  orders. Taking ties reaches 8,586,890 on the 10k against 8,921,937 for the
  strict rule and 185,028 against 207,110 on the 1k, and wins all six golden
  graphs. See M2.6d's entry.
- [x] **M2.6b** Order default flip and bench rebaseline. Touches
  `packages/layout` and `bench`. `defaultStages.order` moves from
  `insertion-order` to `barycenter-order`, and the `pipeline` benchmark entries
  are rebaselined for it. Split out of M2.6 because the two halves want
  different machines: the transpose pass and its golden corpus are ordinary
  work, and `pnpm bench:baseline` recaptures wholesale and wants a quiet one.
  WHAT SHIPPED. `defaultStages.order` is `barycenterOrderStage`, so a run that
  names no order stage gets barycenter sweeps and a transpose pass where it used
  to get roster order. The full default pipeline is 1.80x slower on the 10k
  corpus and returns a drawing with 92.9% fewer adjacent-layer crossings; on the
  1k it is 1.60x slower for 76.7% fewer. The four measurements those ratios come
  from live in the last section of `barycenterOrder`'s docstring and nowhere
  else, because a bench recapture moves the timings and M2.4b moves all four;
  the two crossing counts are pinned against both stages in
  `test/layout.order.test.ts`, so a stage that gave the saving back fails there
  rather than in a paragraph. The `pipeline` baselines are recaptured for the
  new default, which is the half of this milestone that wanted the quiet
  machine.
  `insertionOrderStage` WAS KEPT, and that is the decision here that is not the
  flip itself. M2.2 deleted the placeholder it replaced, `singleRankStage`;
  this one stays, module-local and still unexported, because three tests execute
  it and one of them is the roster-order column of the seed-comparison table
  that says what barycenter ordering beats. Deleting the stage means deleting
  that evidence or re-deriving it from an arrangement nothing in the package
  produces any more. The reason is written on the stage rather than only here.
  THE M2.4b CAVEAT IS NOW BIGGER THAN IT WAS, which is the part of this entry
  that constrains a later task. M2.6 already recorded that the transpose pass's
  cap and its tie rule are measured on a graph where the counter sees about a
  quarter of the edges, and that both must be re-derived when M2.4b makes every
  edge visible. What changes here is the blast radius: those constants no longer
  govern an opt-in stage, they govern the DEFAULT PIPELINE, so M2.4b changes
  what every caller who names no stage gets. Re-deriving them is a condition of
  that milestone and not a tidy-up after it, and all four of this entry's own
  figures expire on the same event.
  M2.4b HAS SINCE LANDED, ITS CHAINS ARE NOW READ BY THIS STAGE, AND THE
  RE-DERIVATION IS STILL OWED. The cap, the tie rule and all four figures are
  still measured over a chainless layering. What the consumption did settle is
  that the caveat was right: at the shipping cap of 8 the pass now captures 17.5%
  of the fixed point's saving on the 10k against 84.3% before, and a cap of 4
  measures 1.38% against the predicted 1.4%. `order-crossings.golden.json` was
  recaptured over the drawing with the chains in it, which is a different thing
  from re-deriving these: it pins what the stage reaches, not what the cap costs
  and buys.
  M2.6c HAS SINCE PAID MOST OF THAT DEBT: both budgets and all four figures are
  re-derived. What it did not take is the tie rule.
  M2.6d TOOK THE TIE RULE TOO and it is unchanged, so nothing in this entry is
  still owed.
- [x] **M2.6c** Order budget re-derivation. Touches `packages/layout` and
  `docs`. Both budgets of `barycenter-order` re-derived over the drawing the
  stage sees now that M2.4b's chains are read, which is the debt M2.6 and M2.6b
  both recorded as owed and M2.4b deliberately did not take.
  WHAT SHIPPED. `maxSweeps` 8 to 4 and `maxTransposePasses` 8 to 16, so the two
  constants no longer share a value and the coincidence M2.6 was careful to call
  a coincidence is over. The pair beats the one it replaces on BOTH axes
  everywhere it was measured: 8,586,890 crossings on the 10k against 8,748,361
  and 185,028 on the 1k against 194,289, all six golden graphs lower, and the
  stage faster on both corpora.
  NEITHER BUDGET HAS A KNEE ANY MORE, which is the finding the task was for and
  is why the answer is a pair rather than two independent numbers. The sweep
  curve FLOORS: the 10k is at its floor after ONE sweep and the 1k after three,
  and not merely at an equal-scoring layering, the best seen is found early and
  never beaten, so the layers at 4 are the layers at 16. Sweeps 5 through 8 were
  buying nothing. The transpose curve has no knee anywhere: its marginal rate
  falls by a fifth per doubling early and a third by the end, smoothly and for
  hundreds of passes,
  where the curve the cap of 8 was chosen on fell by more than half immediately
  past 8 and threefold past 4.
  So neither budget could be read off its own curve, and what decides them is
  the exchange rate between them: a sweep costs 5 to 6 passes of the pass's
  time on both corpora, 5.38ms against 1.11ms on the 1k and 78ms against 13.9ms
  on the 10k, and those passes buy 4.30% and 11.96% where the
  sweeps buy zero. The cap stops at 16 rather than 24 because 16 is the last
  value that leaves the whole stage faster than before on BOTH corpora.
  THE GOLDEN CORPUS IS WHY THIS IS A REALLOCATION AND NOT A CUT, and it is the
  thing the bench corpora could not have told anyone. Five of its six graphs are
  still improving at 8 sweeps, by 1.35% to 3.48%, where both bench corpora have
  floored by three. Dropping the sweeps alone would have been free on the two
  graphs the package measures itself on and 1.3% to 3.4% worse on the six it
  regresses against. Raising the cap pays that back on all six.
  TWO THINGS THE OLD MEASUREMENT HAD WRITTEN DOWN AS SETTLED WERE WRONG. The
  fixed point is 675 passes on the 10k and 187 on the 1k, not 60 and 19, so the
  cap of 200 that `layout.order.test.ts` asked for as "far beyond the pass count
  either corpus needs" stopped the 10k two thirds of the way and its 7,689,100
  was never a fixed point. And the knee, above. What the old measurement got
  right is the prediction it carried: it forecast the saving collapsing to "1.4%
  at a cap of 4" from a hand-expanded corpus, and a cap of 4 measures 1.38%.
  A SECOND BUG WAS FOUND AND FIXED IN THE GOLDEN HARNESS, and it is not a
  tuning change. `order-crossings.golden.json` ordered every entry over the
  drawing's segments and then counted only the graph's own adjacent-layer edges,
  from the moment M2.4b's chains were consumed, so the file recorded a
  population the stage does not optimise and one that moves the WRONG WAY when
  the stage improves: at the new budgets it read `dense-1200` as 20.5% worse
  while the metric the stage optimises had it slightly better. The two causes
  are attributed separately in the file's header rather than left as one diff,
  because the population fix multiplies the counts by between 3.5x and 76x and
  the budget change moves them by a few percent, and the small one is the one
  the milestone was about.
  THE BENCH GATE PASSED AND NO RECAPTURE WAS ASKED FOR, since the gate fails on
  regressions and every layout entry improved. The prediction was written into
  the commit message before the gate ran, per `bench/README.md`: `rank`
  untouched, `pipeline` down 2% to 4% on the 10k and 12% to 16% on the 1k. The
  readable run measured `pipeline` at -4.7% and -16.7% and `rank` at -7.9% and
  -4.4%, so the pipeline came in just past the good end of both predictions.
  TWO READABLE RUNS DISAGREED AND THE UNTOUCHED ENTRY IS WHY THAT IS KNOWABLE.
  An earlier run, with no `noisy` entry and no failure anywhere, put `pipeline`
  10k at +9.6% and `rank` 10k at +18.3%. Nothing in this branch touches the rank
  stage, so a 26-point swing on that entry between two runs is machine state and
  not code, and it is the reason the capture was scripted to take a run only
  when nothing outside `packages/layout` fails: the run before the readable one
  was discarded for `2.5k outEdges` at +20.1% in `@dagr/graph`, which is the
  benchmark `bench/README.md` already documents as drifting about ten points
  with its code untouched. Worth recording that THE GATE'S OWN NOISE DETECTOR
  CAUGHT NEITHER: both runs had every entry inside its margin of error, because
  what moved was between-run drift rather than within-run variance, and `rme`
  cannot see that. An untouched benchmark in the same worker can, which is a
  cheap check to keep.
  FOUR `@dagr/graph` ENTRIES NOW READ 25% TO 35% FASTER THAN THE BASELINE and
  the gate says so in a note asking for a refresh. That is a package this branch
  does not touch and a recapture is the maintainer's call, so it is left alone
  and flagged here rather than folded into this milestone.
  THE TIE RULE IS STILL OWED A RE-DERIVATION and this run did not take it. It
  was chosen on the same pre-chain drawing as the cap, winning all six
  configurations it was tried in, and those six were sweep budgets and caps this
  stage no longer uses over a population sixteen times smaller. It is
  load-bearing, since the unanchored-node exclusion exists only because of it.
  Re-running the strict-versus-ties comparison at 4 and 16 is a smaller task
  than this one was, which is exactly why it is not folded into it.
  M2.6d TOOK IT and the rule is unchanged. See the entry below.
- [x] **M2.6d** Order tie-rule re-derivation. Touches `packages/layout` and
  `docs`. The last decision in the order stage still measured against a drawing
  it no longer sees: the transpose pass takes a swap when the delta is negative
  OR EXACTLY ZERO, and that was chosen before M2.2c, in six configurations of
  sweep budget and cap the stage no longer uses, over a population twenty times
  smaller than the one it orders today.
  WHAT SHIPPED: NOTHING, AND THAT IS THE RESULT. The rule is kept. No constant
  moved, no default moved, no count in the golden file or in either pinned table
  moved, and there is no migration for a caller. What changed is the evidence:
  the strict-versus-ties comparison is re-run at the budgets that ship, 4 sweeps
  and a cap of 16, over the drawing's 214,222 segments, on both bench corpora
  and all six golden graphs, and taking ties wins all eight.
  THE FIGURES ARE DELIBERATELY NOT COPIED HERE, which is the rule M2.6 set for
  the cap curve two entries up: they live in the transpose section of
  `barycenterOrder`'s docstring, the two bench-corpus rows are pinned in
  `layout.transpose.test.ts`, and `docs/docs/layout.md` carries the
  reader-facing copy. Three places is the standing cost; a fourth would make it
  four. This entry gave a second reason, that M2.8 would move the table again,
  and that reason was wrong: M2.8 landed and moved no row of it. See M2.8's own
  entry for why it could not have. The rule stands on the first reason alone.
  WHAT A LATER READER NEEDS FROM THIS ENTRY RATHER THAN FROM THE DOCSTRING is
  the four things below.
  THE MARGIN WAS NEVER THE POINT. The strict rule captures about an eighth of
  what the pass is worth, so the finding is that a pass which may not cross a
  plateau is a different and much smaller thing rather than a weaker setting of
  the same one. A later tuning argument here has to beat that, not the margin.
  EQUAL CAP OR EQUAL TIME HAD TO BE SETTLED, because the strict rule TERMINATES
  differently and a comparison that did not say which it was making would be
  answerable either way. Neither rule terminates before 16 passes on either
  corpus, so equal cap IS equal pass count and the time question needed no
  stopwatch. Any later re-derivation of this rule inherits that question the
  moment it changes a budget.
  THE EXCLUSION IS THE TIE RULE'S DEPENDENT, NOW ASSERTED RATHER THAN ARGUED. A
  strict build with the unanchored-node exclusion and one without return
  byte-identical layers on both corpora and all six golden graphs. So the tie
  rule, the exclusion and M3.6's warm-start stability are one argument and
  re-deriving the first is re-deriving all three.
  FOUR FIGURES BEHIND THE PINNING RULES WERE STALE BY AN ERA, all four pre-M2.2c,
  and correcting them turned up a second thing worth having: THE COUNT DEPENDS ON
  WHICH POPULATION IT IS TAKEN OVER, and the docstring had never said which.
  Over the graph's own edges, which is what `layout.order.test.ts` pins, 118 and
  814 nodes have no neighbour in the layer above and 48 and 438 have none in
  either, correcting 120, 1,101, 49 and 572. Over the SEGMENTS `reorder` actually
  reads, the first pair is unchanged and the second is 24 and 162, which is the
  transpose pass's exclusion counted in the sweeps' own terms. The second figure
  moves for the reason M2.4b exists: a node whose only edges span several ranks
  has no adjacent-layer neighbour in the graph and a dummy one rank away in the
  drawing. The FIRST not moving is a measurement and not a theorem, and the
  docstring says so: splitting a long edge can only add an upward neighbour, so
  equal counts mean equal sets, which rules out any node in either corpus whose
  in-edges are all long. Nothing makes that impossible. All four figures are now
  pinned, so a corpus that grew such a node would say so.
  A THIRD SOLVER NOW LIVES IN `layout.transpose.test.ts`, the same pass with
  `delta >= 0`, one line apart from the shipping one, so the strict column moves
  when the drawing moves. Nothing in the package ships a strict build, so
  without it the evidence for this rule would be prose again the next time the
  drawing changes, which is exactly how it went stale the first time. It
  reproduces the shipping pass exactly BECAUSE THE TRAVERSAL IS THE SAME ONE,
  and not because strict descent has a single answer: the "swap v past w"
  relation can be cyclic, and on 200 random layered graphs run left to right
  against right to left, 198 end in different layers and 191 at a different
  count. The tempting stronger claim is false and the docstring says so.
  NO BENCH RECAPTURE AND NO PREDICTION TO CHECK, because no shipping code path
  changed. The gate was run as the process requires and is reported in the PR.
- [x] **M2.7** Positioning: Brandes-Koepf horizontal coordinate assignment
  (or median-based v1 with the interface ready for BK). Invariant tests: no
  node overlaps, spacing respected.
  WHAT SHIPPED. `brandesKoepfPosition(options)`, `brandesKoepfPositionStage` and
  `BrandesKoepfOptions`, all three INTERNAL to `packages/layout`: none of them is
  exported from `@dagr/layout`, and `defaultStages.position` is UNCHANGED, still
  `grid-position`. The name waits on the same event the default does. The export
  rule is about an algorithm a caller CHOOSES BETWEEN, the measurement below says
  nobody should choose this one over the grid yet, and adding an export later is
  additive where removing one breaks callers; `insertion-order` is the same
  shape. The one option is `variant`, which selects one of the four alignments
  instead of the median of all four, and which exists because the invariant is a
  property of each pass rather than only of the median and a test has to be able
  to run one.
  The invariant tests asked for are there and the stronger of the two is the one
  they assert: two boxes side by side in a layer are at least `nodeSep` apart
  edge to edge, in the layer's own order, which every overlap within a layer
  breaks and which also catches a pair that respects the boxes but not the
  separation. Both bench corpora, a few hundred random layerings at every
  alignment, and the ten-node counterexample below.
  WHAT THE MEASUREMENT REFUTED, and this is the part that survives the tick.
  **Brandes-Koepf is worse than the placeholder on today's graphs**, so the
  default did not move. It aligns a node with the median of its neighbours in
  the ADJACENT layer, and a quarter to a third of the corpora's edges join one,
  the same blind spot the crossing counter has: the drawing comes out 2.7x and
  4.4x worse on total HORIZONTAL edge length and 53% and 60% wider than
  `grid-position`, and it loses one of the two corpora even restricted to the
  edges it can see. That is structural rather than a tuning problem, and M2.4b is
  the fix, because dummy chains are what make every edge span exactly one rank.
  M2.4b HAS SINCE LANDED, ITS CHAINS ARE CONSUMED, AND THE MEASUREMENT WAS
  REDONE: THE PRESCRIPTION IS REFUTED. Over a layering that reads the chains,
  Brandes-Koepf is 15.91x `grid-position`'s horizontal segment length on the 10k
  and 13.81x its width, against 9.41x and 4.53x over the same corpus ordered
  without them, a baseline that still PLACES the dummies. Both improved
  absolutely and grid improved far more. So the prerequisite was met and the
  drawing got worse, and what blocks this stage is now the compaction rather
  than the ranker. See M2.4b's entry.
  The prescription "M2.7 replaces the positioner" was written before that was
  measured; what shipped is the algorithm implemented, tested and unselectable,
  so that M2.4b changes its INPUT rather than a line of it, and the decision it
  then faces is whether the measurement has turned round. The figures live in
  `brandesKoepfPosition`'s docstring in `packages/layout/src/position.ts` and
  nowhere else as live advice, because they all expire on that milestone.
  **THE PAPER'S CLASS SHIFT IS UNSOUND AS PUBLISHED**, which is the second thing
  measurement refuted and the one that constrains a later task. `place_block`
  records one `min` per class and applies it once, so a class shifted against a
  class that is itself shifted later comes out short by the parent's shift. Ten
  nodes are enough: `layers [3, 2, 3, 2]`, `edges [[1, 4], [2, 3], [2, 4],
  [3, 6], [4, 6], [7, 9]]`, up direction and left bias, where two boxes land on
  the same coordinate; on the 1k corpus it leaves 33 pairs of boxes overlapping.
  Composing the shifts transitively fixes the counterexample and is still not
  sound. What ships compacts by longest path over the block order, which cannot
  overlap and costs 3% of width on the 1k while being narrower on the 10k. IT
  COSTS 30% OF ADJACENT-LAYER EDGE LENGTH (40,790,550 against the class form's
  28,559,325 on the 10k), and that 30% is not claimable because the layout it
  comes from overlaps.
  THE NAMED NEXT STEP is the paper's erratum: resolve the shifts by longest path
  over a proper graph of classes. It is a task in its own right and it was not
  attempted here.
- [x] **M2.8** Edge routing: polyline routes through dummy-node coordinates,
  monotone in the rank axis. Route invariant tests. Touches `packages/layout`
  and `docs`.
  From the M2.1 algorithms review: `bounds` had to stop being the hull of the
  node boxes, because a route that goes around an obstacle can leave them. The
  runner contracts containment rather than tightness for exactly that reason.
  M2.4b adopted the durable formulation early (the hull of the node boxes and
  the route points), because a route bending through a zero-width dummy can
  already leave the box hull, so nothing here changes when obstacle detours
  land. It did not change for border attachment either, which the paragraph
  below is about: an attachment lands ON a box the hull already contains.
  **THIS MILESTONE'S TITLE CLAIMS MORE THAN IT DELIVERED, and the honest
  accounting is the first thing a later reader needs.** "Polyline routes through
  dummy-node coordinates" SHIPPED IN M2.4b. `straightRouteStage` already walked
  `virtualChains` and emitted a point per dummy, so the polyline and its bends
  were two milestones old when this one started. What M2.8 added is the two
  ENDS, plus the invariant the title's second clause names and the tests its
  third does. A caller's routes before: from the source node's CENTRE, through
  each dummy's centre, to the target node's centre, so a renderer drawing an
  arrowhead at the last point drew it underneath the target. After: from the
  source box's BORDER, through the same dummy centres unchanged, to the target
  box's border. Two nodes stacked at the defaults went from `[{0, 20},
  {0, 110}]` to `[{0, 40}, {0, 90}]`.
  WHAT SHIPPED: `src/route.ts`, holding `polylineRouteStage`, exported by name
  and installed as `defaultStages.route`. `straight-route` is deleted rather
  than kept beside it, which is M2.2's precedent with `singleRankStage` rather
  than M2.6b's with `insertion-order`: nothing measured against it. It is
  preserved where it was still worth having, as `centreToCentreRouteStage` in
  `test/layout.route.test.ts`, which is what turns the before-and-after above
  into a measurement instead of a memory. `route` is the third of the four
  stages to go from placeholder to algorithm, after `rank` in M2.2 and `order`
  in M2.6b, and the position stage is now the only one left.
  THE INVARIANT HAS A CHOICE IN IT AND THE CHOICE IS THE INTERESTING PART.
  "Monotone in the rank axis" can be phrased four ways and three of them need a
  special case for an edge the ranker reversed, whose route CLIMBS the page
  because `RoutedEdge.points` runs source to target as the caller authored them.
  What ships names no sign of its own: with `d` the sign of the last point's `y`
  minus the first's, every consecutive pair steps by `d` or by zero. A reversed
  edge is monotone climbing, a normal one is monotone descending, and neither is
  a case in the checker. It is WEAK rather than strict for the same kind of
  reason: a flat pair is a step and not a backtrack, which is what lets a self
  loop, whose two ends are the same node at the same `y`, satisfy the rule
  rather than be excused from it.
  THE ROUTER DOES NOT CREATE THE PROPERTY AND THE ENTRY SHOULD NOT CLAIM IT
  DOES. `y` is the position stage's answer: layers run in strictly increasing
  rank order, both position stages here give a layer one shared `y`, and a chain
  holds one node at every rank between its endpoints, so the points are monotone
  before the router sees them. What the router promises is that it introduces no
  reversal its input did not have, and that is not free. It costs TWO CAPS on
  how far an attachment may travel, and the second of them is the finding of
  this milestone's algorithms review rather than something the first draft got
  right.
  CAP ONE IS HALF OF THIS SEGMENT. Both ends of a bendless route are attached
  along the SAME one, from opposite ends, so an attachment allowed to travel the
  whole way could pass the other and hand back a polyline running backwards. Two
  points that each moved at most half way meet at worst in the middle. Two
  witnesses, both watched failing with a `StageContractError` when the cap is
  removed: `rankSep: 0` with a target of no height, reachable through the
  shipping stages alone, and a third-party position stage that overlaps two
  boxes outright.
  CAP TWO IS HALF THE WAY TO THE EDGE'S OTHER ENDPOINT, and the first draft of
  this milestone went to review without it and was WRONG. The two are the same distance only on a
  bendless route. On a chained edge an attachment walks toward the nearest
  DUMMY, so cap one bounds the distance to that, while the runner's
  endpoint-proximity rule compares the result against the far NODE. Nothing in
  the eight-graph tables could see it, because every corpus graph is laid out at
  one uniform 100 by 40 box and at that size neither cap ever binds. The review
  found it by varying the box widths: four nodes at the default config with one
  box 2000 wide make `layout()` throw a `StageContractError` on legal input, and
  664 of 3,000 random 4 to 11 node DAGs with widths from 10 to 2010 threw, where
  the centre-to-centre router threw none. Travelling at most half the way to the
  other endpoint makes the rule true by the triangle inequality. Both the
  four-node regressor and the seeded sweep are tests, the corpus tables gained a
  ninth row at varied widths whose 282 bound attachments are the only ones in
  the file, and removing the term fails six tests.
  THE LESSON IS THE ONE ABOUT UNIFORM FIXTURES rather than the one about
  geometry. Four tables over eight graphs agreed, the property they agreed about
  was real, and all eight were drawn at a single box size that put the whole
  drawing outside the regime where the code could fail. A corpus that varies
  what the code branches on is worth more than a corpus that is large.
  NO CONTRACT CHECK WAS ADDED, which `docs/docs/layout.md` had already forecast
  and which this entry confirms rather than revisits. Monotonicity belongs to
  the position stage and the router jointly, a caller may supply a position
  stage that stacks ranks any way it likes, and a rule a correct third-party
  stage fails is worse than one never claimed. That is the same argument the
  endpoint-proximity rule makes, and proximity itself survived border attachment
  untouched, which is what it was written in M2.2 to do.
  THE FIGURES ARE PINNED OVER NINE GRAPHS RATHER THAN ONE: the two bench
  corpora, the six of `test/golden-corpus.ts`, which is the corpus the order and
  transpose tests already share so that no two files pin numbers for graphs
  nobody else has, and `dense-1200` a second time under box widths from 10 to
  2010, which is the row the review's finding added. Two of the six carry
  structure the bench corpora do not have at all and this stage has a rule
  about: self loops and parallel edges. What is pinned: every route monotone on
  all nine under both routers and both position stages; every interior point
  identical between the two routers, 14,746 of them on the 1k and 174,222 on the
  10k, none differing; where every end landed, which is the box border for all
  but the 80 belonging to `self-loops-800`'s 40 loops and the 282 on the varied
  row where a cap binds first; and total polyline length before and after, which
  is what the change is worth.
  WHAT IT IS WORTH IS BETWEEN 0.6% AND 5.9% of the drawing's total polyline
  length, and the spread is more use than the size. The saving is bounded by
  half a box diagonal per END, 53.85 at the default 100 by 40, so a drawing of
  long thin rows saves a smaller share of a much larger number: the 10k saves
  3,965,122 of 632,523,805 and `tall-600` saves 162,181 of 2,740,824. Every unit
  of it was ink drawn underneath a node box.
  A CLAIM THIS PACKAGE HAD IN THREE PLACES WAS WRONG AND IS RETIRED. `order.ts`,
  M2.6d's entry above and the docs page all said M2.8 would move the eight rows
  of the strict-versus-ties transpose table. It moved none of them and could not
  have: every row is a crossing count over the LAYERS the order stage produces,
  routing is downstream of positions and positions are downstream of order, and
  no route stage is an input to any of it. The claim was inherited from M2.4b,
  where consuming the chains really did take the counted population from 13,131
  segments to 214,222, and was carried forward one milestone too many. The half
  of it that was true is the pipeline TIMINGS, which are of the full pipeline and
  do include the router; those are annotated rather than re-derived, because
  what a border attachment costs is bounded and small, both columns pay it, and
  a fresh pair taken under a different load would move for a reason that is not
  this milestone.
  IT WAS NOT A BENCH CONVERSATION EITHER, and the prediction is recorded here
  because `bench/README.md` requires one. The route stage IS on the pipeline
  benchmark's path, unlike M2.4c's change, so both pipeline entries were this
  run's to predict and the two rank entries are the controls: they run the rank
  stage alone, so they cannot move for a reason inside this diff. Predicted both
  pipeline entries flat, on the grounds that the added work is a fixed handful
  of arithmetic per edge plus one square root per attachment, so 40,000 edges
  and 80,000 roots on the 10k against a pipeline that takes hundreds of
  milliseconds: well under 1%. No workload grew, which is the distinction
  `bench/README.md` had blurred and now states: the point count per route is
  unchanged and no benchmark selects a different stage, so this is a change to
  what a benchmark COSTS rather than to what it processes.
  MEASURED, on the first attempt at a 1-minute load of 3.45, nothing `noisy`,
  the gate green: pipeline 10k +5.7% of +24.1% allowed and pipeline 1k -4.0% of
  +21.5%. READ AGAINST THE UNTOUCHED ENTRIES IN THE SAME WORKER RATHER THAN
  AGAINST ZERO, which is the only way those two numbers mean anything. The rank
  entries are in the same file and this diff does not touch the rank stage, and
  they came back at +6.4% and +1.3%. So the pipeline 10k moved LESS than an
  entry that cannot have moved for a reason inside this change, and the four
  layout entries span 10.4 points between them on code where only one stage
  changed. The `@dagr/graph` block in the same run spanned 55 points, -42.3% to
  +12.6%. The prediction of flat holds: both pipeline entries are inside the
  drift of things nobody touched.
  FOUR `@dagr/graph` ENTRIES READ FASTER THAN BASELINE AGAIN and the gate
  printed its refresh note for each, at -28.8%, -29.5%, -34.4% and -42.3%. That
  is a package these milestones do not touch, a recapture rewrites all fifteen
  entries, and per `bench/README.md` it is the maintainer's call rather than the
  agent's. Recorded here, not acted on. It has now been noted across M2.4c and
  this one.
  WHAT IS STILL NOT HERE, each with its reason rather than as a list. `edgeSep`
  is carried and unhonoured, and `LayoutConfig.edgeSep` used to promise this
  milestone would honour it, so that promise is corrected in place rather than
  quietly dropped. It governs the two cases where routes coincide exactly rather
  than merely run close, parallel edges and self loops, and both are pinned as
  they stand so the milestone that fans them out has a before. It needs a
  fan-out rule and, for a loop, a height, and a loop that bulges vertically is
  the one shape in this package that would need an exception carved into the
  monotone rule above. Obstacle detours and splines are not here: a route goes
  where its dummies are and takes no notice of a box in the way. And a collinear
  chain is not collapsed to two points, which M2.4b's entry allowed for and
  which stays allowed for the router that wants it.
- [x] **M2.9** Golden corpus vs dagre: port a corpus of real graphs
  (including a pattern-generator-shaped graph), assert structural parity
  metrics vs dagre output (rank counts, crossing counts within tolerance).
  First layout benchmarks (1k and 10k node graphs) with committed baselines.
  Touches `packages/layout`, `bench` and `docs`.
  **THIS ENTRY WAS FOUR LINES AND THE SHORTEST IN M2, and both of its clauses
  turned out to mean something other than what they say.** Every other M2 entry
  was written up after the run; this one was never touched between being drafted
  and being taken. The first thing the run had to do was decide what it was.
  THE BENCHMARK CLAUSE READ AS ALREADY DONE and the docs disagreed with this
  file about it. `packages/layout/bench/layout.bench.ts` has shipped since M0.2
  with rank and pipeline entries at 1k and 10k, and all four are in
  `bench/baseline.json` with committed medians, so "first layout benchmarks with
  committed baselines" was satisfied two milestones before M2 started.
  `docs/docs/layout.md` read the clause as a different deliverable and had said
  so since M2.3: the gate's numbers are RATIOS against a control workload,
  machine matched and comparable only to themselves, "the right thing to gate a
  regression on and the wrong thing to publish as what the stage will cost you",
  and "M2.9 is where a figure a reader can use comes from, on a committed
  corpus". Nobody had built that. The maintainer took the docs reading, so this
  run built the second artefact rather than declaring the first one finished,
  and the clause above is rewritten so it stops reading as done.
  WHAT THE COST TABLE IS, and it is deliberately not a baseline.
  `test/layout.cost.test.ts` times each default stage on both bench corpora,
  eleven runs after three warmups, and writes `test/layout-cost.json` with the
  machine, the Node version and the one-minute load average beside the numbers.
  Nothing gates on it, `pnpm bench:ci` never reads it, and no run fails when a
  number moved. On an Apple M1 Pro: the rank stage 5.2ms on the 1k and 103ms on
  the 10k, order 50.9ms and 685ms, position 2.6ms and 35.5ms, route 1.9ms and
  47.4ms, the whole call 76.4ms and 1,162ms. THE ORDER STAGE IS MOST OF THE RUN,
  67% of the 1k and 59% of the 10k, which is the part of this worth acting on.
  And the stage contract checks are 15.8ms and 291ms, 21% and 25% of the call,
  which is stated as its own row rather than folded into the stages: it is the
  price of the guarantees `pipeline.ts` makes, it is paid on every run, and a
  reader sizing a budget is paying it. The ordinary test run does not measure. It
  asserts that the committed file still names the stages `defaultStages`
  actually holds and still describes corpora of the sizes the generators still
  produce, which is a real failure mode (three of the four stages have been
  swapped already, and the swap that does not refresh the file leaves a
  millisecond figure attributed to an algorithm that is gone) and the only kind
  of assertion available: a timing on a shared machine is either a flake or a
  no-op, which is `bench/README.md`'s argument about the gate.
  DAGRE IS NOW A DEPENDENCY, EXACTLY PINNED, AND THE FIXTURE IS COMMITTED TOO.
  It was a dependency of nothing in this repo before. `@dagrejs/dagre` 3.1.1 is
  a `devDependency` of `packages/layout` at an exact version: the maintained
  fork rather than the original `dagre` 0.8.5, which pulls `lodash` and
  `graphlib` and is unmaintained, where this one pulls `@dagrejs/graphlib` and
  nothing else. THE PAIR IS THE POINT rather than either half. A fixture alone
  cannot be regenerated by a reader and cannot say whether a moved number is
  this package's or dagre's; a dependency alone keeps no record of what dagre
  used to answer. Together, `dagre.version` is asserted against the version the
  golden file records, so a bump is a line in a diff and a moved number has a
  cause.
  THE CORPUS IS NEW AND IS NOT THE BENCH CORPORA, which contradicted a sentence
  already in `bench/README.md` and that sentence is corrected rather than
  worked around. Nine hand-authored graphs shaped after real ones, in
  `test/dagre-parity-corpus.ts`, including the pattern-generator graph
  this entry asks for by name. Two reasons and the first is not negotiable: the
  only crossing count that means anything across two engines is a geometric one
  over the emitted polylines, that is quadratic in segments, and it does not run
  at the 214,222 segments the 10k produces. The second is that every bench
  corpus graph is a seeded layered random graph at one uniform 100 by 40 box,
  which is the distribution this package's own stages were tuned against. So
  M2.9 commits two artefacts against two corpora: the cost table on the bench
  corpora, which is what M3.9 and M4.10 inherit, and the parity golden on its
  own. `bench/README.md`, `bench/src/corpus.ts` and `bench/test/corpus.test.ts`
  all said the other thing and all now say which is which.
  AND IT IS NOT `test/golden-corpus.ts`, which is six generated graphs for the
  ORDER stage's crossing regression and is called the golden corpus by three
  test files already. It is untouched and unextended. The new files are named
  `dagre-parity-*` throughout and the reason the two exist separately is written
  at the top of the new one: that corpus asks whether the order stage got worse
  against its own past self, where an exact count is the strongest claim
  available, and this one asks how a whole drawing compares to another engine's
  drawing, where neither side is the reference.
  **SAYING WHAT PARITY MEANS WAS MORE OF THE WORK THAN MEASURING IT.** The
  clause "structural parity metrics within tolerance" has the same choice in it
  that "monotone in the rank axis" had in M2.8. What ships: every metric is
  derived from PUBLIC OUTPUT ALONE on both sides, by one implementation, from
  node centres, node boxes and emitted polylines. dagre keeps `rank` and `order`
  on its node labels after `layout` and reading them would have made the layer
  metric a one-liner; it is deliberately not read, because then one column would
  answer a question about dagre's ranker and the other a question about
  geometry. Each metric carries a verdict written beside it: `nodeOverlaps` and
  `nonFinitePoints` are not parity metrics at all and are asserted at zero;
  `layers`, `chordCrossings`, `edgeLength` and the extents are one-sided
  ceilings against dagre; `crossings`, `segments`, `bends` and the attachment
  counts are recorded and not gated. EVERY CEILING IS ONE-SIDED. Nothing fails
  because this package drew a better picture, because a ceiling that fired both
  ways would assert that a successor must keep drawing what dagre draws.
  **THE CONTROL EARNED ITS PLACE TWICE: ONCE FOR CATCHING A WRONG NUMBER AND
  ONCE FOR BEING WRONG ITSELF.** Counting crossings between the DRAWN polylines
  gives 51 here against dagre's 98, and reading that as better layout would be
  wrong. dagre halves its rank separation and doubles every edge's min length
  to leave room for an edge label, so every edge picks up a bend in every rank
  gap: 1,015 segments and 774 bends across this corpus against 525 and 284 here,
  and more elbows sweep more ink and cross more things. So `chordCrossings`
  throws the route away and counts the straight lines between the endpoint node
  CENTRES instead. THE FIRST VERSION OF IT USED THE ROUTE'S OWN ENDS, reported
  124 against 123, and this entry said "level". The M2.9 algorithms review
  measured what that definition was worth: an emitted end IS routing output,
  this package aims one at the first dummy and caps it while dagre aims one at
  its label dummy half a rank away, and the difference was 38 crossings. Neutral
  about bends and not about attachment is most of the way to neutral and is not
  the same thing.
  CORRECTED TO NODE CENTRES IT IS 147 AGAINST 109, THIRTY-FIVE PERCENT WORSE,
  and that is the most important number in the milestone. It is the one measure
  dagre wins, and keeping two edges from crossing between two nodes is what a
  layout engine is for. So the finding is not a tie but a loss, and it was one
  review away from being published as a 1.9x win.
  AND THE SAME CORPUS SAYS WHOSE FAULT IT IS. Swap `gridPositionStage` for
  `brandesKoepfPositionStage`, change nothing else, and the count falls from 147
  to 96, which is 0.88x dagre rather than 1.35x. The order stage is not what
  loses this comparison. The phase that has never had a real algorithm is.
  **THE UNIFORM-FIXTURE LESSON WAS APPLIED AND THE FIRST APPLICATION OF IT WAS
  STILL WRONG.** M2.8's entry above says a corpus that varies what the code
  branches on is worth more than one that is large, so this corpus varies box
  size by construction, from a 24 by 24 handle to a 1,200 by 280 preview against
  a `nodeSep` of 50. Eight graphs, every one of them at varied sizes, and the
  router's first attachment cap binds eight times across them. Then the second
  cap was deleted from `route.ts` and the whole suite was rerun, and NOTHING
  CHANGED. Not one number, not one end. The corpus had reached the regime where
  a cap binds without reaching the branch M2.8's review found a real bug in, and
  every varied box size in it was evidence for a branch it never took. That is
  the same failure as M2.8's, one level down, found only because the mutant was
  run. `canvas-composite` is the ninth graph and exists because of that run: it
  moves three route ends under the default stages, and under
  `brandesKoepfPositionStage` deleting the cap makes `layout()` throw a
  `StageContractError` on edge `e17`, which is M2.8's bug reproduced on a
  hand-authored graph rather than on a seeded sweep of three thousand. Both are
  asserted by name rather than counted, and the reference router with one cap is
  written out in the test file, which is `centreToCentreRouteStage`'s precedent
  from M2.8 and `referenceTranspose`'s from M2.6.
  A DEFECT IN DAGRE ON LEGAL INPUT, recorded rather than routed around. A route
  leaving a box of ZERO WIDTH travelling straight up or down makes dagre 3.1.1
  compute `width * dy / dx` with both terms zero and emit a coordinate that is
  not a number. Reproduced on two nodes and one edge, where 0 by 0 fails and so
  does 0 by 40 while 100 by 0 is fine, which is what says the zero width is the
  cause rather than the zero area. This package draws the same input, attaching
  at the box's own centre. It is confined to one corpus graph so the other eight
  rows compare two complete drawings, and the point is dropped and COUNTED
  rather than allowed to poison a sum into a `NaN` the golden file would record
  as `null`. THAT GRAPH IS NOT EXCLUDED FROM ANYTHING. The first draft excluded
  it from every cross-engine ceiling and the paragraph below is what the
  algorithms review made of that; it is inside every bound now, with one named
  edge-length exemption. What is still asserted here is which graphs dagre
  cannot draw completely, as a list, so a dagre release that broke a second one
  fails and says which rather than quietly widening a set that switches gates
  off.
  WHAT THE TABLE SAYS. `chordCrossings` 147 against 109, the row above. Layers
  64 against 68, equal on eight of nine and 6 against 10 on the cyclic graph,
  where M2.2c's least-squares feedback arc set keeps the acyclic view shorter
  than dagre's greedy one. Total polyline length 157,177 against 156,783, level.
  Total width 21,778 against 23,683, 8% narrower, and never more than 1.02x on
  any single graph. No overlapping boxes on either side.
  ONE ROW IS A KNOWN GAP RATHER THAN A COMPARISON AND IT IS EXEMPTED BY NAME.
  `scattered-suite` is 2.49x dagre's polyline length against a per-graph ceiling
  of 2x. The first draft EXCLUDED that row from every cross-engine bound on
  the grounds that dagre emits a non-finite point on it, and the algorithms
  review measured what the incompleteness was actually worth: dagre's missing
  point is one segment of length 73, repairing it moves the ratio from 2.49x to
  2.41x, so incompleteness explains 0.08 of a 1.49 breach and the exclusion was
  keeping the suite green over a gap that is real. The row is now inside every
  other bound with one exemption carrying its reason, which is
  `bench/README.md`'s rule for an exemption applied to a gate that is not the
  bench gate. The cause is the same placeholder as the crossing gap:
  `gridPositionStage` centres every row on `x = 0`, so five disconnected
  components are laid one on top of another and every edge crosses the page to
  reach its own. Brandes-Koepf draws it at 1.02x. A test asserts the exemption
  is still NEEDED, so it fails the day the gap closes rather than outliving it.
  **AND IT ANSWERS A QUESTION M2.7 LEFT OPEN, THE OTHER WAY FROM THE BENCH
  CORPORA.** A second column runs the same pipeline with
  `brandesKoepfPositionStage`, which is implemented, tested, unexported and not
  the default because M2.7 measured it at 2.7x and 4.4x `gridPositionStage`'s
  total edge length on the two GENERATED corpora. The crossing result is the
  robust half and is above: 147 to 96, a 35% fall, five graphs won, one lost,
  three drawn. The edge-length result is NOT robust and is quoted as a median
  and a spread because of it, which the algorithms review is the reason for: the
  0.99x corpus total is `module-imports` at +11,880 cancelling `etl-fanout` at
  -8,592 on a corpus delta of -1,190, so dropping either graph reads 1.05x or
  0.90x. The median per-graph ratio is 0.98 and the range is 0.41 to 1.55, so
  what survives is "not 2.7x, and level on this corpus". It still pays in width,
  wider on eight of the nine and by up to 1.64x, which is the compaction
  `position.ts` already blames doing exactly what that docstring says it does.
  THE MECHANISM IS A HYPOTHESIS AND ITS COUNTEREXAMPLE IS IN THE CORPUS. The
  natural story is that a layered random graph carries more long-edge chain per
  node for the packing pressure to propagate through; these nine graphs do not
  order that way, since `service-mesh` has 1.07 bends per node and the worst
  ratio at 1.55x while `module-imports` has 8.40 and comes in at 1.37x. So the
  width mechanism is `position.ts`'s and established, and the
  generated-versus-authored explanation on top of it is a guess and is labelled
  one. BOTH RESULTS STAND and both are on the docs page; this is not enough to
  move the default and it is enough that the default should not be settled on
  generated graphs alone. The column carries NO cross-engine ceilings, because
  holding a stage no caller gets to a parity gate would turn a comparison into a
  promise, and it is pinned exactly in the golden file like everything else.
- [x] **M2.10** Worker mode: same layout API sync or in a worker
  (`layoutAsync`), transferable-friendly data. Worker mode section added to the
  layout docs page (the page itself shipped with M2.1).
  From the M2.1 API review: the async entry point is the same
  `createLayout({ stages, config })` engine as M3.2's `relayout` (see the note
  there), as `engine.runAsync(graph)`. Keeping functions out of `LayoutInput` is
  deliberate and this is why: that object crosses a worker boundary and has to
  survive structured cloning, so stages and the `nodeSize` callback stay
  arguments of the call and of the engine, never fields of the input.
  Shipped as `createLayout` with `run` and `runAsync`, `serveLayout` for the far
  side, and `LayoutPort` for the thing between them. **THE ENGINE ARRIVES HERE
  AND NOT IN M3.2, WHICH IS THE SAME ARGUMENT M2.1 MADE FOR NOT BUILDING IT.**
  M2.1 refused a binding object with nothing to bind. `runAsync` is the first
  thing that has to be bound rather than passed: a port and a stage set that
  changed between two runs would describe two different workers, and there is
  nowhere to pass them that makes that a caller error rather than a silent one.
  So the object is built now, binding two of the three things it will bind, and
  M3.2 adds `relayout` to it rather than introducing it. `layout()` stays as
  one-shot sugar over the same runner.
  **PREPARE SPLIT OFF FROM THE RUNNER, AND THAT SPLIT IS THE WHOLE PROTOCOL.**
  `runPrepared(prepared, stages)` is now the pipeline and `prepare` is its own
  function, because the two halves have to run in different places: resolving
  the config and sizing every node are the only parts of a run that call
  anything the caller wrote, so they run on the CALLING side, where a `nodeSize`
  callback that measures text can reach the DOM. Everything from there down is
  numbers and ids, which is exactly what can cross. Three callers share the
  runner and none of them can disagree about what a stage sees. It also decides
  where a bad config is reported: `InvalidConfigError` has no path across the
  boundary at all, because the config is resolved before anything is posted.
  **WHAT CROSSES IS THE LAYOUT'S VIEW OF THE GRAPH, NOT `Graph.toJSON`.** The
  document was right there and is deliberately not used. It carries attribute
  bags and ports, layout reads neither, and sending them would copy every bag on
  a graph the far side has no use for. The failure it avoids is worse than the
  copy: `@dagr/graph` never reads an attribute, so a React element, a DOM node
  or a callback in a bag is legal there and is NOT structured-cloneable, and the
  document form would have turned a legal graph into a run that fails for a
  reason nothing about layout explains. A test lays out a graph whose every
  attribute is a function.
  Transferable-friendly came out as: every part of a message whose size grows
  with the graph is a typed array, and the encoder hands back the transfer list
  beside the message so that what moves rather than being copied is a property
  of the encoding rather than of whoever wrote the call. One buffer out (sizes),
  three back (node boxes, point counts, route points). What stays cloned is the
  ids, which are strings and cannot be transferred, and `bounds`, which is four
  numbers and would cost more in buffer overhead than the copy it saves. **THE
  ANSWER CARRIES NO IDS AT ALL**: the request fixed an order, the calling side
  still holds the graph it sent, and the reply is matched by request id, so a
  finished layout on the wire is three buffers and a rectangle. The cost of that
  is a coupling between request and response ordering, which is checked rather
  than trusted: a count that disagrees with the graph is refused, because the
  symptom otherwise is a layout with every id present, every number finite, and
  everything in the wrong place.
  **THE ERROR UNION GAINED A FOURTH MEMBER, `WORKER`.** `DagrLayoutErrorCode`
  says widening it is a breaking change to do before v0.1 rather than after, and
  this is before: nothing is published. It earns the place on the family's own
  organising principle, which is whose bug it is. Until there was a boundary,
  every failure was the caller's config, a stage's contract, or this package's
  invariant; two ends built from different versions, and a foreign error that
  cannot arrive with its class, are neither, and both are wiring.
  `StageContractError` and `InternalLayoutError` DO arrive as themselves,
  because both carry nothing but strings, so a stage that left work undone reads
  the same whether it ran here or there, down to which id it dropped. An answer
  this package does not RECOGNISE is deliberately not a third case, and the docs
  review caught the first draft claiming it was at three separate sites: both
  ends ignore what they cannot identify, because serving layout on a port does
  not claim it, so an unrecognised reply leaves the run PENDING rather than
  raising. Saying otherwise would have sent a caller hunting for an error that
  never arrives, and the honest text names the hang and points at a worker that
  never called `serveLayout`.
  `LayoutPort` is four structural members rather than a class, so a browser
  `Worker`, a dedicated worker's own `self`, and a `MessagePort` from either
  runtime all satisfy it with no cast (checked against the DOM and WebWorker
  libs, not assumed). Node's `worker_threads.Worker` does not: it is an
  `EventEmitter`. That is a documented one-liner (hand it a `MessagePort`) and
  not a shim, because a package that has no DOM dependency and no Node
  dependency should not take one to name a parameter type. The transfer list is
  a required mutable `ArrayBuffer[]` for a reason that looks like an oversight
  and is not: a `readonly` list or a widened element type stops a real
  `MessagePort` satisfying the interface at all.
  **TESTED OVER A REAL `MessageChannel` RATHER THAN A SPAWNED THREAD.** Both
  ends sit in one process and every message still goes through the same
  serialiser a real `Worker` would, so the claims that matter (no function in
  the message, buffers transferred and detached rather than copied, an error a
  caller can catch) are all under test without a worker bundle to point a thread
  at. A mutation check drove one test's design: an engine that ignored its
  worker entirely still passed the parity assertion on a four-node diamond,
  because the two rankers agree on a graph that small, so the test that proves
  the run happened over there uses a corpus graph and asserts BOTH that the
  answer matches the worker's stages and that it differs from the default's.
  **REVIEW FOUND TWO WAYS TO GET A SILENTLY WRONG LAYOUT, AND BOTH WERE THE SAME
  MISTAKE: TRUSTING SOMETHING THAT CAN CHANGE BETWEEN THE ASK AND THE ANSWER.**
  The API review and the general code review reproduced both independently, over
  a real channel, which is why they are recorded here rather than merely fixed.
  First, `nextRequest` counted from 1 inside each engine, and this protocol
  INVITES two engines onto one port. Both would send id 1, both listeners would
  match the first answer, and the loser would decode the winner's numbers under
  its own ids: with equal node and edge counts no length check fires, so the
  result is a layout with everything in the wrong place and no error at all. The
  counter now lives at module scope, which is the only scope two engines share.
  Second, and worse because the caller does nothing unusual to provoke it, the
  pending entry held the caller's `Graph` and decoded the id-less answer by
  walking it when the answer landed. `Graph` is mutable and this package is
  animation first, so editing one mid-run is an ORDINARY sequence, and a node
  swapped for another while a run was in flight produced coordinates on the
  wrong ids. Both fixes are the same shape: the answer is decoded against a
  `RunSnapshot` of the ids as they were AT THE SEND, which `encodeRun` already
  builds, so an answer means what it meant when it was asked for. Each has a
  test, and each test was mutation checked against the old code.
  A third, smaller: `isLayoutMessage` checks a tag and not a shape, so an answer
  wearing the right tag with the wrong contents reached the decoder and came
  back as a bare `TypeError`. Decode failures are now wrapped, so what a caller
  catches is this family's member. Members that already are one pass through.
  Two small things and one absence. The engine attaches its listener only while
  runs are in flight, so an engine sharing a port it does not own leaves nothing
  behind on it; nothing can arrive for it while nothing is pending. Both ends
  tag their messages and ignore what they do not recognise, so serving layout on
  a port does not claim the port. And there is no timeout: how long is too long
  belongs to the caller and to the graph, and a terminated worker is an event on
  the caller's own object rather than something this package can see. The review
  corrected one belief here too: posting to a CLOSED port or a terminated worker
  is a silent no-op in both runtimes rather than a throw, so the `catch` around
  `postMessage` is the port object objecting and not those cases, and that run
  stays pending like any other slow one. The comment said otherwise and now
  does not.
  `LayoutEngineOptions` spells every field `?: T | undefined`, which is
  redundant by default and is not under `exactOptionalPropertyTypes`, a flag
  this repo sets. Without it `createLayout({ worker })` where `worker` is
  `LayoutPort | undefined` does not compile, and that is the ordinary shape: a
  port in a ref, or absent while rendering on a server.
  NOT DONE HERE, deliberately. No benchmark: the crossing's cost is a message
  size and a clone, both linear in the graph, and measuring it would mean a
  bench entry whose baseline is a machine-matched number for something no
  existing entry regresses against. No `engine.dispose()`: the listener is
  already transient, and engine lifetime is M3.2's, where retained state gives
  it something to release. No `relayoutAsync`, which is M3.2's to add and whose
  argument is already recorded there.

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
THE PRINCIPLE PAID FOR ITSELF AT M3.6 AND IT IS WORTH RECORDING WHERE IT IS
STATED. The obvious implementation of that task, wiring the previous layers into
the seed, is two lines and it made the drawing LESS STABLE than ignoring the
previous run altogether. Nothing about the code says so; the only thing that
said so was M3.4's contract and M3.5's corpus, both of which existed before the
change did and both of which failed the moment it landed. A milestone that had
built the incremental stage first would have shipped that version.

M3.1, M3.2 and M3.3 need only what M2.1 already shipped. M3.4 onwards want the
M2 pipeline to be real (M2.7 positions, M2.8 routes), because a stability metric
over pass-through coordinates measures nothing. Two tasks sit behind more of M2
than that: M3.6 needs M2.6's crossing corpus, and M3.9 needs M2.9's 1k and 10k
benchmark baselines.

M3 also depends on two requirements now recorded upstream, both added by this
milestone's planning review and both placed on the task that owns them: M2.4b's
dummy ids must be a deterministic function of edge and rank, and M2.3's network
simplex must be warm-startable. Neither is retrofittable from inside M3. If
either lands without its requirement, say so here rather than working around it,
because both defeat stability in ways the node-displacement metrics cannot see.
M2.3 landed with its half: `networkSimplexRank({ initialRanks })` takes the
previous run's ranks, and a rank-stability test alongside the sum test proves it
does something, because the same perturbation moves a node a whole rank without
it.

- [x] **M3.1** (`@dagr/layout`) Delta model: `LayoutDelta` computed by diffing
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
  SHIPPED 2026-08-15 as `src/delta.ts`: `diffLayout`, `applyDelta`,
  `isEmptyDelta`, the `LayoutDelta` type and the four types it is spelled with,
  plus a `DeltaMismatchError` and a `NodeGeometry`. The four questions above,
  answered, and a fifth the entry did not ask.
  ABSENT, not flagged. A node that did not move is not in the delta at all,
  which is what makes it proportional to the change rather than to the graph.
  The rebuild path a flagged delta would have bought is `applyDelta` plus the
  result the caller already has, and a caller who has not kept one can be handed
  the next result whole, so the self-describing variant would have made every
  delta the size of the graph to buy something that is already available two
  other ways.
  ARRAYS, not records keyed by id, which is also what the brain's note from
  M2.10 asked for. They are cheaper to build, they carry an order (below), and
  they cross a worker boundary as arrays rather than as objects whose keys are
  caller-supplied strings, which is where `__proto__` stops being a curiosity. A
  consumer wanting O(1) lookup builds one map in one pass over a list that is
  already proportional to the change.
  ABSOLUTE ONLY. `from` and `to`, no third displacement field. Springs need the
  absolute target and M3.4's metric derives the displacement in the pass it sums
  it in, so the third field would be a cache of two numbers sitting next to it.
  THE TOLERANCE IS NAMED ON THE DIFF, NOT ON `LayoutConfig`, and that is a
  DEPARTURE from what the paragraph above proposed. Its premise survives (the
  number is in node-size units, so only the caller can pick it) and its
  conclusion does not: every field of `LayoutConfig` answers "how should this
  graph be laid out", is resolved once per RUN into `ResolvedLayoutConfig`, and
  is threaded to stages, and no stage can read a tolerance that is about two
  results. Putting it there would have carried a number nothing reads across the
  M2.10 worker wire and into every one-shot `layout()` call, which has nothing
  to compare itself against. It is `diffLayout(previous, next, { epsilon })`,
  default 0, validated by the same rule the config's measurements get and
  raising the same `InvalidConfigError` with `subject: 'option'`. M3.2's engine
  is the first thing to hold a config and two results at once and is where a
  caller names it once.
  A RESIZE IS A MOVE, which is the fifth question and the one the entry did not
  ask. `from` and `to` are whole boxes rather than centres, so a node whose label
  grew and whose centre did not shift is in `moved`. Left out, a consumer
  applying deltas draws the old size forever, which is the same
  desynchronisation a dropped move is, arriving through a field nobody had
  thought of as motion. One list rather than a `moved` and a `resized`, on the
  same argument the single epsilon rests on: the question per node is whether
  this box is materially different from the one last drawn, and splitting the
  answer makes every consumer join it back up.
  AN EDGE WHOSE ENDPOINTS CHANGED IS A REMOVAL AND AN ADDITION under the one id,
  not a reroute. Nothing in `@dagr/graph` rebinds an edge's ends, but an edge id
  is the caller's own string and two results need not come from the same graph:
  a patch that removed `e1` from `a` to `b` and added `e1` from `a` to `c`
  produces exactly this, and a reroute would leave a consumer holding the old
  endpoints under the new polyline. Nodes have no matching case, a node being an
  id and nothing else.
  ORDER IS PART OF THE CONTRACT rather than merely deterministic, because only
  the second lets a consumer commit a golden file: `added` and `moved` in the
  NEXT result's iteration order, `removed` in the PREVIOUS one's, both of which
  are graph insertion order.
  `applyDelta` IS EXPORTED, and it is the reason the absent-means-unchanged
  choice is safe rather than merely cheap: what a delta MEANS is that round trip,
  so the meaning ships as code a consumer can check itself against rather than
  only as a paragraph. M4.7 applies deltas to a scene rather than to a result and
  cannot call it, but it can be tested against it. The one thing it does not
  reproduce is ITERATION ORDER: the maps hold what survived in the previous
  result's order with the additions appended, because the next result's order is
  in neither of its two inputs. Nothing in the contract rests on that order and
  a caller who needs the graph's has the graph.
  A DELTA APPLIED TO THE WRONG RESULT THROWS, which widened
  `DagrLayoutErrorCode` with a fifth member, `'DELTA_MISMATCH'`, on that type's
  own recorded terms (widen before v0.1, not after) and exactly as M2.10 widened
  it with `'WORKER'`. A delta carries no evidence of which two results it came
  from, so the pairing is a mistake no type can refuse, and the alternative to
  throwing is a scene that is wrong, stays wrong, and drifts further wrong with
  every later delta. It names the first entry that did not fit rather than
  counting them. It checks PRESENCE and deliberately not `from`, which
  legitimately disagrees with what the result holds whenever the delta was taken
  against reported geometry at a nonzero epsilon.
  THE NON-TRANSITIVITY IS A TEST rather than a paragraph: `layout.delta.test.ts`
  runs fifty steps of 0.9 epsilon through both loops side by side, and the one
  that diffs against the last COMPUTED result ends more than 40 epsilon out
  while the one that diffs against the last REPORTED result stays within one,
  which is the measurement behind the retained-snapshot requirement M3.2
  inherits.
  `PositionedNode` now extends `NodeGeometry`, the same four numbers without an
  id. Structurally identical, so no caller's code changes, and it exists so that
  a move's two halves do not each carry an id the entry already has.
- [x] **M3.2** (`@dagr/layout`) Layout engine and patch-driven relayout:
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
  SHIPPED 2026-08-15. `engine.relayout(patch)` and `engine.relayoutAsync(patch)`
  returning a `RelayoutResult` of `{ result, delta, influence }`,
  `engine.dispose()`, an `epsilon` on `LayoutEngineOptions`, an `InfluenceSet`
  type, a `previous` warm-start channel on `PreparedState`, and a sixth error
  code. The pipeline runs whole on every relayout and the tests hold it to
  landing the same geometry a cold run of the same graph does, which is the
  correct-and-slow baseline this entry asked for.
  RELAYOUT DOES NOT APPLY THE PATCH, which is the decision the entry did not
  name and everything else here rests on. `Graph.subscribe` hands a listener one
  frozen patch per mutating call AFTER that call is committed, so the graph the
  engine holds is already the graph the caller changed, and
  `graph.subscribe((patch) => engine.relayout(patch))` is the whole adoption.
  Applying it here would have meant this package mutating an object it does not
  own, from the one method holding a long-lived reference to it, and would have
  made a caller who reads their own graph between edits route every mutation
  through layout. The cost is that the engine trusts a patch to describe the
  graph it is holding, and the mistake that invites is calling `relayout` with a
  patch you have NOT applied, which without a check is an empty delta and a
  drawing that never changes. So the patch is checked against the graph: one
  pass over its ops, last op wins so a caller may concatenate a frame's worth,
  presence only for the four ops that have a presence question, and the first
  disagreement raises. M3.5 inherits the trust: a lying patch is harmless while
  the influence set is the whole roster and narrows it wrongly once it is not.
  THE INFLUENCE SET IS SETS, NOT ARRAYS, which is the opposite of M3.1's choice
  and rests on the opposite argument. A delta is a list of things that happened
  and every consumer iterates it; an influence set is a PREDICATE, and every
  consumer this roadmap names asks it either "is this id in you" (M3.4's
  contract, M3.5's property test) or "how big are you" (the monotone shrink
  across M3.5, M3.7 and M3.9). The structured-cloning argument that pushed the
  delta to arrays does not reach it either, because nothing sends one across the
  wire: see the async decision below. It names ONLY IDS THE CALLER CAN SEE, so
  no dummy chain node, because half its membership questions would otherwise be
  unaskable; M3.5's internal region may be wider than what it reports and that is
  allowed. And IT SPANS BOTH SIDES OF THE PATCH, which is the non-obvious half: a
  removal is a change and a removed node's id exists only in the previous
  result, so a set built from the current graph alone cannot contain every change
  in the delta beside it, and M3.5's property test would fail on its first
  removal.
  THE ENGINE REPORTS ONE GEOMETRY. `relayout` returns the previous REPORTED
  geometry with this delta applied rather than the run it just did, so a consumer
  that reads `result` and a consumer that accumulates deltas are never holding
  different drawings. Under the default epsilon of 0 there is no difference at
  all and the pipeline's own result is handed straight back, because nothing was
  withheld and rebuilding an equal map in `applyDelta`'s iteration order would be
  work spent making the common case worse. Under a nonzero one the difference is
  exactly the sub-epsilon moves the caller asked not to be told about, and
  retaining THAT rather than the raw run is the reported-geometry snapshot M3.1
  required: the same fifty steps of 0.9 epsilon are in this task's suite at the
  engine level, ending within one epsilon of the true position rather than 45
  out.
  relayoutAsync COMPUTES THE DELTA ON THE CALLING THREAD, so the M2.10 wire
  protocol is untouched by this task: what crosses is a run and what comes back
  is a result, exactly as for `runAsync`. The reported-geometry snapshot is this
  side's bookkeeping and not the pipeline's, and the graph and the `nodeSize`
  callback are already on this side. What that leaves is that THE WARM-START
  STATE LIVES WHERE THE PIPELINE RAN: an engine holds none after a worker run, so
  a relayout served over there is cold in a way one served here is not. In this
  task that is a distinction with no consequence, because no stage reads the
  state and the tests assert both paths produce the same deltas, and saying so
  now is cheaper than discovering it in M3.6. M3.6 is the task that has to decide
  whether the state crosses or the worker retains it and the patch crosses
  instead, and it should decide it before it warm starts anything.
  THE ENGINE DIFFS AGAINST WHAT IT LAST REPORTED AT THE MOMENT IT REPORTS, not
  against what was current when the relayout started, which is the one finding of
  this run's review of the merged tree. `relayoutAsync` has an await between the
  patch check and the diff, and M2.10's protocol lets runs overlap, so another
  one may settle inside it. Capturing the previous geometry before the run hands
  the caller a delta that does not apply to what they are holding: a relayout
  overtaken by a sync one produced a delta adding a node the caller's result
  already had, which `applyDelta` refuses with a `DeltaMismatchError`. Reading it
  at report time keeps the one promise the design rests on. The ANSWER is still
  odd under overlap, because the worker laid out the graph as it was when the run
  was sent; what it is not is inconsistent. `layout.relayout.test.ts` arranges
  the overlap with a gated port rather than racing for it, and the test fails
  against the capture-before version.
  THE WARM-START CHANNEL IS A FIELD ON `PreparedState`, `previous`, typed as
  `RoutedState` minus its `graph` and its `config`. On the record every stage
  reads rather than an argument to one of them, because ranking, ordering and
  positioning each have a previous answer to start from and a channel per stage
  would be three contracts to keep in step. The two subtracted fields would both
  have been traps: `previous.graph` would be TODAY's graph wearing yesterday's
  label, since the caller mutates the object the engine holds, and the config is
  bound for the engine's lifetime and already on the record this hangs off. It is
  an `Omit` rather than a restated field list so it cannot drift from the record
  it is a view of. Nothing reads it yet, which is the entry's own instruction:
  the four `...Output` types each gained a `previous?: never` and
  `stage-output.types.test.ts` is what caught that they had to.
  RETAINED STATE IS THREE THINGS, held separately because they are retained for
  three different reasons and are not always all present: the graph, the previous
  run's pipeline state (absent after a worker run), and the reported-geometry
  snapshot (not the same object as the last computed result once epsilon is
  nonzero). All three are proportional to the live graph and never to patch
  history, and THAT IS BY CARE RATHER THAN FOR FREE, which this task got wrong
  the first time and is the second finding of the review of the merged tree.
  `previous` is a field on the record every stage reads, so the runner carries it
  forward and the `RoutedState` the engine retains holds the `previous` its own
  run was given; feeding that back in as the next warm start puts one full
  pipeline state on the front of the last on every relayout, each with its own
  `sizes`, `ranks`, `layers`, `positions` and `routes`. Measured at depth 20
  after 20 relayouts before the fix. That is growth in PATCH HISTORY, the exact
  thing this entry says must not happen, arriving through the field this task
  itself added rather than through the "never deletes a removed node's entry"
  mechanism the entry predicted, and it is INVISIBLE TO ANY ASSERTION THAT LOOKS
  ONLY AT THE NEWEST LINK, which is why the guard test for removed nodes passed
  throughout. `PreviousLayout` subtracts its own `previous`, and the engine
  builds the retained record field by field with that type as its return type, so
  a field added to `RoutedState` stops the builder compiling rather than being
  silently dropped. THE LESSON FOR M3.5 ONWARDS: an `Omit` narrows a view and
  strips nothing, so a retention test has to walk the object rather than trust
  the type. This task's suite now pins both forms (a removed node is in neither
  the retained ranks nor the retained sizes, and the retained chain is one link
  deep after twenty edits), and M3.10's churn sequence should assert depth as
  well as size.
  `dispose` REJECTS RUNS IN FLIGHT rather than leaving them pending, which M2.10's
  "there is no timeout" argument does not cover: dispose detaches the port
  listener, so an answer arriving afterwards reaches nobody, and a promise that
  can never settle is worse than one that settles badly. Idempotent, and every
  entry point after it raises, the asynchronous two as a rejection.
  ORDER-FAITHFUL REPLAY IS NOT NEEDED AND THE QUESTION STOPS HERE, which is the
  M1.3 deferral this entry inherited. Nothing in M3.2 replays a patch into a
  graph: the engine reads the caller's own graph, which was mutated by the
  caller's own calls and therefore already iterates in the order those calls
  produced, and the warm start is driven from the retained `RoutedState`. M3.5
  reads the patch's ids rather than a rebuilt graph, so it does not need it
  either. `apply` stays as it is; a consumer who rebuilds a graph by replaying
  patches and wants the original's iteration order is the one who would need the
  change, and no such consumer exists in this repo. `remove-port` still carries
  the `index` that change would need if one ever does.
  M3.3's EVIDENCE IS ALREADY LANDED: `layout.relayout.test.ts` runs a sequence of
  single patches through `relayout` against the equivalent combined edit and
  asserts the same final layout. That is the test the M3.3 entry says settles it,
  and it passes, so M3.3 opens with the composition question answered and only
  the intermediate-states argument left to weigh.
  ONE THING WORTH KNOWING FOR M3.4: a `relayout` whose patch changed nothing
  about the drawing (an attribute update, say) emits an empty delta, and
  `isEmptyDelta` says so. There is no separate no-op path and there should not
  be, because as of M1.3 a call that changes nothing emits no patch at all.
- [x] **M3.3** (`@dagr/graph`, `@dagr/layout`) Patch batching, or the recorded
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
  BATCHING LANDED, as `graph.batch(body)`, and the argument that carried it is
  the intermediate-states one this entry makes rather than any performance
  claim. The composition half was already settled by M3.2, whose sequence test
  passes, so the honest question left was whether the states in between are worth
  a surface. They are, and the run measured it rather than asserting it:
  `test/layout.relayout.test.ts` adds `e` to the diamond and then wires it up,
  and unbatched the engine reports a place for `e` in two of the three deltas,
  the first of which it does not keep (a disconnected singleton still gets a rank
  and a position). Batched, one delta, one place, the place it keeps. Two rather
  than three because the third edge moves nothing about it, which is the kind of
  number this entry's argument was missing.
  THE THREE QUESTIONS M1.3 LEFT, answered by what shipped. A BATCH IS A `Patch`
  AND NOT A TYPE OF ITS OWN, so `invert` reverses and inverts it into the undo of
  the whole edit, `apply` replays it, and a listener signature stays what it was.
  That answers the invert question ("one inverse patch") and the listener
  question ("the batch, and only the batch") in one decision instead of two, and
  it is why the layout side needed no code: `relayout` already read a patch of
  any length, so a batch arrives as one patch and relays out once. A FAILED CALL
  COMMITS WHAT RAN BEFORE IT, and the ops that committed are emitted on the way
  out. All-or-nothing was rejected on M1.3's own ground: rollback would mean
  replaying an inverse, and replay restores content but not insertion order, so
  the "restored" graph would be a different graph. Dropping the ops instead was
  rejected because a mirror that never hears about a committed mutation is
  silently wrong from that point on, and silence is the failure mode this package
  has spent M1.3 and M3.2 designing against.
  BATCH IS DEPTH, NOT A FLAG: a nested batch joins the one around it, so two
  helpers that each batch compose. THE EMISSION IS AT THE CLOSE AND OVER THE
  LISTENER SET AS IT IS THEN, which has three consequences worth knowing rather
  than worth hiding: a listener that subscribes inside a batch reads everything
  COLLECTED by then, one that unsubscribes inside a batch reads none of it, and
  the first listener to watch reads only from where it started watching, because
  an unwatched graph builds no ops and paying for a journal it will probably
  never emit is the cost this package has refused since M1.3. The middle one is
  the surprise and the third is the one a tree review caught in this run's own
  first draft of the docs, which claimed the whole batch without qualification.
  All three say the same thing, which is to leave a batch you did not open alone.
  A BATCH IS CONTIGUOUS FROM ITS FIRST COLLECTED OP, which is the review round's
  one code fix: `#observed` counts a batch that has already collected as watched,
  so a body that unsubscribes its last listener, mutates, and subscribes a new
  one still emits one unbroken run. Without it that listener is handed the ops
  from either side of the gap and none from inside it, which is not a transition
  that ever happened, and replaying it onto a mirror asks for an edge to a node
  that never arrived. The cost is a batch nobody ends up reading collecting ops
  that are then dropped at the close, which is bounded by the batch.
  AND `apply` NOW REPLAYS INSIDE A BATCH, which is the review's other real
  finding and fixes a seam that predates this task: `apply` is an ordinary
  caller, so op by op it re-fanned one patch into one patch PER OP on the target.
  A cascade left one graph as a single patch and arrived at the next as two, and
  a mirror was the one place the intermediate states came back after the source
  had removed them, which is precisely the failure this task is about, on the
  path the docs recommend for mirroring. One line, and the seam closes for both. The depth comes down before the emission, so a listener
  mutating while it reads a batch emits its own patch rather than joining the one
  it is holding.
  WHAT WAS NOT BUILT: transactions, a batch-versus-patch listener choice, and any
  coalescing of ops inside a batch. The ops are concatenated in the order the
  calls made them and nothing cancels, so `add` then `remove` of the same node
  crosses as both, which is what `relayout`'s last-op-wins check is already
  written for. Coalescing is a real optimisation and it belongs to whoever
  measures a patch big enough to want it.
  ONE THING FOR M3.4 AND M4.7: a batch is the boundary saying which graph states
  are allowed to be laid out, so a stability metric measured over an unbatched
  multi-step edit is measuring states nobody meant to draw. Batch the edit in the
  corpus before the number means anything.
- [x] **M3.4** (`@dagr/layout`) Stability contract and metrics: write down what
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
  SHIPPED 2026-08-16 as `src/stability.ts`: `stabilityViolations` and
  `measureStability`, the five types they are spelled with, and the two assertion
  wrappers in `test/stability.ts`. 29 tests in `test/layout.stability.test.ts`
  written before the implementation and failing against it. No coordinate moved
  and no algorithm changed, which is the point of the ordering principle at the
  top of this milestone: the measurement lands before the stages that are judged
  by it.
  BOTH, AND THE SPLIT IS THE ANSWER RATHER THAN A HEDGE. The entry predicted
  "likely both" and the reason it is both is that each covers the other's blind
  spot exactly. A CONTRACT SAYS NOTHING ABOUT A FULL RELAYOUT: a run that
  recomputes everything is entitled to move everything, so the assertion passes
  without measuring one coordinate, which is the state of this package today. A
  METRIC LETS A REGRESSION LAND as long as it stays under the bar, which is how a
  number goes up four percent a milestone and no run is the one that broke it.
  Neither is a weaker version of the other, so neither waits for the other.
  THE CONTRACT IS EXACT AND TAKES NO TOLERANCE, which is a decision and not an
  omission. `diffLayout` has an epsilon because a move too small to see is not
  worth animating, and none of that reasoning reaches here: a path entitled to
  keep a coordinate KEEPS it, which is to say copies it, so the result is
  bit-identical and any difference at all is a coordinate that was recomputed
  when it should have been kept. A tolerance would let a fast path quietly
  recompute the whole drawing and still pass, which is the one thing the
  assertion exists to catch. The suite pins it with a one-ulp move.
  THE IMPOSSIBLE FORM IS NOT AVAILABLE, per this entry's instruction, and the
  demonstration ships as a test rather than as a paragraph: a batched one-node
  insertion into the diamond moves nodes the patch never names, so a contract
  written against the patch's own ids fails today, against the pipeline as it
  stands, before M3.8 exists to discover it. What ships instead is scoped to the
  INFLUENCE SET, which is vacuously satisfied by M3.2's whole-roster
  implementation, and the suite therefore also runs the checker against a
  DELIBERATELY NARROWED set and asserts it reports violations. Without that
  second test the first one proves nothing.
  IT CHECKS THE EDGES TOO, on this entry's own argument: node coordinates can be
  bit-identical while every polyline re-routes. A contract over nodes alone
  certifies a drawing nobody looked at.
  WHAT IS RETURNED RATHER THAN THROWN, and it is what decides where the code
  lives. `stabilityViolations` returns its findings, so it is usable by a test
  asserting the list is empty, by a corpus runner printing it, and by a consumer
  logging it; a throwing assertion is usable only inside a test runner, and this
  package ships no testing entry point to put one behind. So the function is
  public surface and the two `expect` wrappers (`expectStable`,
  `expectStabilityWithin`) are in `test/`, shared the way `fakes.ts` and
  `random.ts` are. `StabilityBounds` is all optional upper bounds, because a
  stability metric only ever regresses upward and a task should be able to pin
  the one number it is about without inheriting seven it is not.
  EVERY NUMBER IS TAKEN OVER THE SHARED ROSTER, meaning the ids both results
  hold, INCLUDING THE ONES THAT DID NOT MOVE. An average taken over only the
  nodes that MOVED rises as a layout gets more stable, because the small moves
  drop out of the set and the large ones are what is left to average, and a
  number that gets worse when the thing it measures gets better is not a
  regression gate. This is #48's lesson arriving in a second place: a number is
  scoped by the set it was measured over. Additions and removals are counts
  beside the means rather than inside them, since a node that did not exist
  before has no displacement.
  DISPLACEMENT IS CENTRE TO CENTRE, so a node whose label grew and whose centre
  did not shift counts in `moved`, because a consumer has to redraw it, and
  contributes zero to the mean, because nothing travelled. One number answering
  two questions badly was the alternative.
  RANK CHURN IS ABSOLUTE AND ORDER CHURN IS RELATIVE, which is the only place
  the two churn metrics differ in kind and is worth the asymmetry. A drawing has
  an anchored top, since `gridPositionStage` stacks rows from `y = 0`, so a rank
  index is a fact about where a node is drawn; the consequence, recorded because
  a reader will hit it, is that a patch inserting a row ABOVE the drawing
  renumbers every rank under it and reports total rank churn, which is true
  rather than a bug. A rank has no anchored left, and an index among siblings
  means nothing on its own (index 3 of 4 and index 4 of 5 are the same slot), so
  the absolute form there would call a whole rank churned when one node is
  inserted at its head, which is the most common patch there is and a case where
  nothing changed places with anything. Order churn is therefore counted over
  pairs that were ADJACENT in the previous rank and that share a rank in the
  next one: a pair whose members ended in different rows has no order left to
  have kept, and counting it would report one rank change twice.
  RANKS ARE DERIVED FROM THE RESULT RATHER THAN PLUMBED THROUGH, which is what
  keeps every metric a pure function of two `LayoutResult`s, as this entry asks,
  and lets a consumer measure two `layout()` calls with no engine at all. The
  derivation is exact rather than a guess: `gridPositionStage` gives every node
  of a row the same centre line, so nodes sharing a `y` share a rank and sorting
  the distinct values gives the indices. THE COST, stated so a later task does
  not trip on it: a position stage that stopped giving a row one centre line
  would silently change what these two numbers mean, which is a thing for such a
  stage to declare rather than a thing this module can check. M3.6 is the first
  task with a reason to care.
  THE ROUTE METRIC IS HAUSDORFF AND NOT A PER-VERTEX SUM, and the reason is the
  case that matters most rather than a preference. A route that gained a bend has
  more vertices than it had, and a per-vertex comparison cannot be spelled
  between two lists of different lengths, let alone answer with a distance;
  gaining a bend is the observable half of a long edge crossing one more rank, so
  a metric that gives up exactly there measures nothing about the drawings that
  change most. It is computed from the VERTICES of each route against the
  SEGMENTS of the other, which lower-bounds the true Hausdorff distance between
  two curves and is EXACT for the only question it decides: two polylines with
  the same vertices are the same polyline, so zero means the same line was drawn.
  BEND-COUNT CHURN SHIPS BESIDE IT AND IS NOT REDUNDANT: a point added on the
  line the route already ran along draws the same picture and measures zero
  distance, while still being a different polyline to anything binding per
  segment. The suite holds that case as the argument for shipping both.
  THE METRIC IS BUILT ON `diffLayout` RATHER THAN BESIDE IT. The delta already
  answers what moved, what arrived, what left, and which ids are the same edge,
  at the same epsilon and under the same rules, so a second implementation here
  would be a second set of answers to keep agreeing with the first, and it means
  the numbers a task asserts on are the numbers its consumers see. The delta is
  RECOMPUTED rather than accepted as an argument, even though the engine holds
  one: a delta passed in is a cache of two results that can disagree with them,
  which is the field M3.1 refused on `MovedNode` for the same reason.
  WHAT IS DELIBERATELY NOT HERE: a committed corpus with committed thresholds.
  A threshold is only worth committing once there is something for it to catch,
  and today every path is the fallback, so a number captured now would be a
  ceiling on the one algorithm this milestone exists to replace. M3.5 is the
  first task with a non-trivial influence set and is where the corpus and its
  bounds belong; `expectStabilityWithin` is the helper waiting for it, and this
  task's suite exercises it against the current fallback so that the helper is
  not itself first run by the task that depends on it.
  M3.3's HAND-OFF WAS TAKEN: every edit in this task's corpus is wrapped in
  `graph.batch`, because a batch is the boundary saying which graph states were
  meant to be drawn, and a stability number measured over the states in between
  a multi-step edit is a number about drawings nobody asked for.
  CROSSINGS ARE NOT IN THE REPORT, AND TWO PLACES PREDICTED THEY WOULD BE
  (`order.ts`'s module docstring and its `Layering` docstring, and the docs
  page's crossing section). Both are corrected rather than left standing, which
  is this run's tree-review finding. The mechanical reason is that
  `measureStability` is a function of two `LayoutResult`s and a result holds
  coordinates rather than layers, so there is nothing to count crossings over.
  The real reason is that they are a DIFFERENT AXIS: a layout can be perfectly
  stable and badly drawn, or beautifully drawn and unstable, and folding a
  quality number into a stability report makes one bar answer two questions.
  M2.6's corpus is where a run that draws worse is caught, and it stays there.
  THE FALLBACK'S OWN NUMBERS, MEASURED ON THE DIAMOND PLUS ONE NODE, batched,
  and pinned as ceilings in the suite so M3.5 has something to beat: 4 shared
  nodes, 2 moved (50%), mean displacement 37.5 and max 75, RANK CHURN 0 AND
  ORDER CHURN 0, against 4 shared edges of which ALL FOUR REROUTED (100%) at a
  mean route distance of 58.3 and no bend change. That is this entry's own
  argument arriving as a measurement rather than as a prediction: a report over
  the nodes alone would have called this relayout perfectly stable, and every
  line in the drawing moved.
- [x] **M3.5** (`@dagr/layout`) Influence regions: given a patch and the
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
  SHIPPED 2026-08-17 as `influenceRegion` in `src/influence.ts`, a fourth field
  `region` on `RelayoutResult`, and 25 tests in `test/layout.influence.test.ts`.
  No stage changed and no coordinate moved, which is the same shape M3.4 shipped
  in and the same reason: what this task decides is a bound, and a bound is worth
  having before the stages that are confined to it rather than after.
  A RANK-SPAN WINDOW, AS THIS ENTRY PREDICTED, and the third direction is what
  settles it rather than the argument from the grain of the algorithm. Influence
  travels sideways within a rank, so a node in a completely separate component
  that happens to share a rank with an insertion MOVES: the row it is drawn in
  got wider and every row is centred. That is measured in the suite rather than
  asserted, on a graph of two components with a node of each on ranks 0, 1 and 2.
  The consequence is that THE FIRST PROPERTY TEST THIS ENTRY ASKED FOR IS FALSE
  AND SHIPS AS ITS OWN DEMONSTRATION: "a patch confined to one weakly connected
  component produces an influence set naming nothing in another" cannot hold
  while ranks are shared between components, and what ships in its place is the
  true form, which is that the region names nothing in another component OUTSIDE
  THE BAND. The entry predicted a reachability-based set would fail this test.
  What it did not predict is that a component-based one fails it too, and for the
  same reason.
  TWO SETS RATHER THAN A NARROWING, WHICH IS THE DECISION THIS RUN MADE THAT THE
  ENTRY DID NOT ASK FOR. M3.2 and M3.4 both recorded that M3.5 would narrow
  `RelayoutResult.influence`, and it does not. `influence` is a statement about
  the RUN: what it was entitled to move. This task changed no stage, so a
  relayout still re-runs the whole pipeline, and a cold crossing sweep is
  entitled to reorder a rank the patch never came near: narrowing that field
  would have been a promise the pipeline does not keep, and it would have made
  M3.4's contract vacuous by construction rather than by triviality, since a set
  reported as a superset of the delta can never be violated by it. So `region` is
  a second field of the same type carrying the other statement, a bound on the
  PATCH, and the two converge when the stages are confined to it. Until they do,
  `stabilityViolations(previous, result, region)` IS the distance between them,
  which is how this task hands M3.6 to M3.9 a number rather than an intention.
  WHAT WIDENS A REGION TO THE WHOLE DRAWING, each of them a case where a band
  would not be a bound. An added edge that does not already run DOWNHILL, since
  the target is pushed down and longest-path ranking takes its descendants with
  it; an edge whose target already sits below its source adds a constraint the
  ranking already satisfies and moves nothing, which is the ordinary shortcut
  edge and stays narrow. A removal that frees its target to RISE, since a
  longest-path rank is the deepest predecessor plus one, unless another
  predecessor one rank above still pins it. And a row that changes HEIGHT, which
  is the vertical half and the reason the resolved sizes are an input: rows stack
  from y = 0 and a row is as tall as its tallest node, so a taller node arriving
  moves every row underneath however unconnected. A row keeps its height when one
  of two equally tall nodes leaves, which is why the row record counts its
  tallest rather than flagging it.
  ON A CYCLIC GRAPH ANY EDGE OP WIDENS IT TO EVERYTHING, which is M3.7's own
  observation arriving early: M2.2's greedy feedback arc set is order dependent,
  so one changed degree can move a node between buckets and reverse a DIFFERENT
  set of edges for a graph whose cycle structure did not change, and no band
  bounds that. On a DAG the reversed set is empty and stays empty, so the bound
  is sharp exactly on the pattern-generator case. M3.7's stable FAS is what
  narrows this, and it now has a second consumer waiting on it.
  THE WINDOW IS 1, THE ARGUMENT IS THE SWEEP, AND THE MEASUREMENT SAYS NO WINDOW
  BUYS SOUNDNESS. A window of 0 takes only the touched ranks; the crossing sweep
  re-barycenters the rank above and the rank below whatever changed, which is
  where a reordering starts, so one rank of margin is the motivated default.
  Measured over the committed corpus at 0, 1 and 2, the escaping cases go 43, 34
  and 16 of 120 for a region of 47%, 66% and 82% of the roster. THERE IS NO KNEE
  IN THAT TRADE, and the absence is the finding: escapes fall roughly as the
  region grows towards the whole drawing, because what escapes is a cold sweep
  reordering a distant rank rather than a spread the band is one rank short of
  catching. A window is a margin, not a fix, and the fix is M3.6.
  WHAT THE COLD FALLBACK DOES OUTSIDE THE BOUND, pinned as ceilings in the suite
  the way M3.4 pinned the fallback's stability numbers. Over 30 random six-rank
  40-node graphs, one batched patch each: an attribute resize left its region 0
  times of 30 (0 violations, region 48% of the roster), adding a leaf 8 times
  (154, 57%), removing a node 11 times (137, 86%), removing an edge 15 times
  (119, 74%). THE RESIZE IS THE ONE KIND THAT IS ALREADY INSIDE ITS BOUND, and it
  is the one that changes no rank and no barycenter, which is M3.9's attribute
  fast path arriving as a measurement. Everything else in that table is the cold
  crossing sweep: removing one edge from a 40-node drawing reorders the top rank
  and moves a node 650 units sideways. M3.6 is what brings that down, and this is
  the number it will be judged on.
  THE CORPUS ASSERTS THAT IT MOVED SOMETHING, because four ceilings that a corpus
  editing nothing would satisfy perfectly are four assertions about nothing. Same
  reason M3.4 ran its checker against a deliberately narrowed set, and that
  negative test is here too.
  THE FIRST VERSION WALKED THE ROSTER AND THE ROSTER IS WHERE THE DUMMIES ARE,
  which is this run's other review finding and the one that changed code rather
  than prose. Collecting the band out of `previous.ranks` is a pass over every
  ranked id, and a 4k-node graph whose edges span a few ranks each carries 233k
  dummies: 87ms of a 90ms region, spent walking a quarter of a million entries to
  collect a band of a dozen, which is a bound costing more than the thing it
  exists to make cheap. `previous.layers` is already the members of each rank, so
  the band is a slice of it and the roster is never walked. 87ms to 5.9ms at 4k,
  6.8ms to 2.2ms at 1k. WHAT IS LEFT IS THE EDGE PASS, which is proportional to
  the drawing rather than to the patch, and it is M3.9's to look at: a fast path
  measured against a frame budget cannot afford one, and the band's own work
  already avoids it.
  THE TWO AXES REST ON DIFFERENT STAGES, WHICH IS THIS RUN'S OWN REVIEW FINDING
  AND IS M3.8's TO INHERIT. The vertical rule holds for any position stage in
  this package, because `rowCentres` is shared and `position.ts` says so:
  swapping the position stage moves nodes sideways and never up or down. The
  horizontal rule is `gridPositionStage`'s alone, because that stage lays each
  row out independently and centres it on x = 0, so a rank whose membership
  changed moves and no other rank does. BRANDES-KOEPF WOULD BREAK IT: it aligns
  blocks that span ranks and compacts them together, so one node arriving in one
  row can pull a block through several, which is further than any band reaches.
  Nothing a caller can select does that today, since that stage is implemented
  and deliberately unexported, and the docstring says a stage which did would
  have to declare it. Same shape as M3.4's rank-derivation dependency, and M3.8
  is where it lands.
- [x] **M3.6** (`@dagr/layout`) Warm-started ordering: seed the order stage
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
  A HINT IS A CONSTRAINT AND NOT A SEED, WHICH IS THIS TASK'S WHOLE FINDING AND
  IS THE OPPOSITE OF WHAT THIS ENTRY ASSUMED. The word "seed" above is left
  standing because the entry was written before the measurement, and the
  measurement is that seeding alone MADE THE DRAWING LESS STABLE THAN IGNORING
  THE PREVIOUS RUN ALTOGETHER. `applyHint` had been applying the previous order
  to the walk's permutation since M2.5 and letting four sweeps and sixteen
  transpose passes run from there, so wiring `PreparedState.previous` into it
  was a two-line change; it took escapes from M3.5's region from 8 to 15 on an
  added leaf and FROM 0 TO 11 ON A RESIZE, the one kind that changes no rank and
  no barycenter and was already exact. The sweeps are exactly what wanders, so
  handing them a different starting point changes where they wander to and
  nothing else, and a run seeded from the previous OUTPUT is a full budget away
  from a layering the previous run had already swept. So the previous order is
  carried THROUGH the run: each sweep re-imposes it on the layer it has just
  reordered, and the transpose pass will not swap a pair it holds.
  THE COHORT IS WHAT MAKES THE KEY AN IDENTITY, and it is this entry's own rule
  arriving in the form the code needed. A cohort is the ids one previous layer
  held, and each cohort is permuted ONLY INTO THE SLOTS ITS OWN MEMBERS ALREADY
  HOLD, which is how a constraint on relative order is imposed without touching
  absolute index. Two ids the previous drawing put in different layers are left
  to the walk, because it never put them side by side and expressed no order of
  theirs to keep; comparing their two indices anyway is the `(rank, index)`
  coupling above, one step removed. A NODE WHOSE RANK CHANGED FALLS OUT OF THAT
  RATHER THAN NEEDING A CASE: its cohort at the new rank is whatever moved with
  it, usually nothing, and a cohort of one has one slot and never moves, so the
  sweeps place it at a barycenter-derived slot among the nodes that kept theirs.
  `applyHint` had CLAIMED the cohort rule since M2.5 and did not implement it:
  its docstring said two ids from different hint layers "TIE", and they tied
  only when their two indices happened to coincide. Second time this repo's
  characteristic defect has been a comment describing a rule the code does not
  keep.
  THE NUMBERS. Over `test/layout.influence.test.ts`'s thirty random layered
  graphs and its four patch kinds, escapes go from 0, 8, 11 and 15 to ZERO, with
  zero violations in each, and those ceilings are lowered in place. The order of
  the caller's own nodes after one added leaf is the order the previous run drew
  on 30 OF 30 GRAPHS, against 17 of 30 cold, which is the test this entry asked
  for and it is asserted with the cold figure as a ceiling so that the evidence
  cannot go vacuous. Note what is NOT claimed: the untouched nodes keep their
  ORDER and not their COORDINATES, because a row that gained a node got wider
  and every row is centred on x = 0. That is M3.8's, and it is why the corpus
  test asserts order and the coordinate half is measured against the region.
  THE CROSSING TOLERANCE IS 2% PER GRAPH OVER THE M2.6 CORPUS AND M3.6 SET IT,
  from this measurement rather than from a preference. Warm against cold after
  one added leaf: 1.0012 tall-600, 0.9969 wide-600, 1.0053 dense-1200, 0.9960
  sparse-2000, 0.9981 self-loops-800, 1.0159 parallel-800. THREE OF THE SIX ARE
  CHEAPER WARM THAN COLD and the one entry that pays for the constraint pays
  1.59%, so 2% is a ceiling with room rather than a target to spend. On the
  thirty random graphs the warm run is 3.1% cheaper in aggregate, worst single
  graph 1.0545. A SOFTER RULE WAS MEASURED AND REJECTED: letting the transpose
  pass break a held pair on a STRICTLY improving swap, on the argument that the
  pass's tie-taking is most of what churns and a genuine crossing fix should get
  through. It buys half a percentage point on the worst entry (1.0108 against
  1.0159) and gives back the whole of the stability, escapes going from zero to
  3, 2, 3 and 3 and the untouched-order figure from 30 of 30 to 25 of 30. A
  structure-preserving edit that moves the drawing is the thing this task exists
  to stop.
  WHAT IS LEFT UNMEASURED IS THE SESSION, AND IT IS M3.10's. A hint naming every
  node in a layer FREEZES that layer, so an added edge whose crossing could be
  removed by swapping two retained nodes leaves it there and nothing gives it
  back. One patch costs at most 1.59% on this corpus. A hundred patches is a
  different question and only a churn sequence can ask it.
  THREE CASES IN `test/layout.order.test.ts` USED A COMPLETE HINT TO FORCE A
  SEED and could not survive the change, which is worth recording because it is
  a real loss of expressiveness rather than test churn. The walk CANNOT produce
  a seed with an unanchored node between two anchored ones the sweep wants to
  swap, searched exhaustively over every roster order and parent set at that
  size, because the walk visits a layer left to right and pulls neighbours up in
  that order, so the layer it builds is already in barycenter order. Two of the
  three now hint the FIXED layer only, which leaves the swept layer free; the
  third asserts the freezing directly. The corpus table loses its
  roster-order-swept-eight-times column (210,611 and 9,150,607), removed rather
  than re-measured because the configuration no longer exists, and gains an
  assertion that a complete hint returns its own layering at corpus scale.
  THE WORKER QUESTION, WHICH THIS TASK OWED A DECISION AND NOT AN
  IMPLEMENTATION: THE WORKER RETAINS THE STATE AND THE PATCH CROSSES. Sending
  the state loses on every reading. It is proportional to the DRAWING, and a
  4k-node graph carries 233k dummies, so a one-attribute edit would post a whole
  pipeline state across the boundary to ask for a run of the same size; it puts
  the same state on both sides, which is two copies to disagree; and the patch
  is already the unit this API is built on and already structured-cloneable.
  What it costs is a SESSION on the worker side, an engine id and a run that
  says "the graph you have, with this patch applied", plus a failure mode for a
  worker that has lost it. That is M2.10's wire protocol reopened and it belongs
  with M3.9, where the async path is what a frame budget is measured on. Until
  it lands `relayoutAsync` over a worker is the unstable path and says so in its
  own docstring, on the docs page and here.
  WHAT M3.7 INHERITS. The constraint is keyed by node identity and reads
  `previous.layers` only, so incremental ranking changes nothing about it: a
  node whose rank the new ranker keeps is in the same cohort it was in, and one
  whose rank moves is a newcomer either way. What M3.7 changes is HOW OFTEN a
  node is a newcomer, which is the entry's own argument for building the warm
  start against the noisy cold rank first, and it should expect the four zeros
  above to stay zero rather than to improve. IT ALSO INHERITS A NEW REASON TO
  CARE ABOUT THE REVERSED-EDGE SET: a flipped edge changes which layer a chain's
  dummies sit in, every dummy is a node this constraint has never seen, and a
  cohort that lost half its members to renamed dummies constrains half as much.
  M3.8 inherits the coordinate half the corpus test above deliberately does not
  assert.
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
  pattern-generator case, and it bites cyclic input only. That is a reason to
  plan it rather than to panic, and if the run needs splitting, the
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
  THIS TASK ALSO OWNS THE WORKER SESSION, HANDED TO IT BY M3.6, and it is here
  rather than in its own entry because a frame budget on the 10k corpus is
  exactly the case that wants a worker. M3.6 decided the direction: THE WORKER
  RETAINS THE PIPELINE STATE AND THE PATCH CROSSES, because the state is
  proportional to the drawing (233k dummies on a 4k-node graph) and the patch is
  proportional to the edit. What is unbuilt is the protocol. Today `encodeRun`
  posts the whole graph per run and the worker holds nothing between runs, so
  this needs a session on that side: an engine id, a run that means "the graph
  you have, with this patch applied", and an answer for a worker that has lost
  it. Until it lands, `relayoutAsync` over a worker is cold, which since M3.6
  means it is the UNSTABLE path and not merely the uncached one, and all three
  of its docstring, the docs page and M3.6's entry say so. Note the interaction
  with the fast paths above: an attribute patch that changes no geometry should
  not cross a boundary at all, so the cheapest half of this is deciding what
  never leaves the calling thread.
  M3.5's REMAINING COST IS ALSO M3.9's: the region's edge pass is proportional
  to the drawing rather than to the patch, 2.2ms on 1k nodes and 5.9ms on 4k,
  and a frame is the budget that makes that worth looking at.
- [ ] **M3.10** (`@dagr/layout`, `docs`) Stability golden corpus: scripted
  mutation sequences (grow, prune, reparent, rewire, sustained churn) run
  through the engine with their stability metrics committed as golden files, so
  a later change that degrades stability arrives as a diff rather than as a
  feeling. Include at least one pattern-generator-shaped sequence, since that
  is the shape M6.6's first reference DSL takes. Docs page on incremental
  layout, the flagship feature, carrying the numbers this corpus produces and
  an honest statement of what the fallback costs when it fires.
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
  THE ONE QUESTION M3.6 COULD NOT ANSWER AND HANDED HERE: WHAT THE WARM START
  COSTS OVER A SESSION. Its constraint is absolute, so a hint naming every node
  in a layer FREEZES that layer, and an added edge whose crossing could be
  removed by swapping two retained nodes leaves that crossing there with nothing
  to give it back. Measured over ONE patch it costs at most 1.59% on the M2.6
  corpus, and three of the six entries came out cheaper warm than cold. Over a
  hundred patches it is a different question and only a sequence can ask it, so
  the three-configuration curve above is not an artefact this task happens to
  produce: it is the measurement that says whether M3.6's rule should soften.
  M3.6 already measured the softer rule it would soften TO, letting the
  transpose pass break a held pair on a strictly improving swap, and rejected it
  on one-patch evidence (half a point of crossings for escapes going from zero
  to 3, 2, 3 and 3). A session that showed quality bleeding away is the evidence
  that reopens it. The comparison to make is then the SAME sequence under both
  rules, and not warm against cold, which M3.6 already answered.

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

Two practical notes before this milestone starts, both settled by M4.1 and left
here as the record. Screenshots need the Chrome browser extension connected,
which was a human-gated setup step outstanding for a while as not urgent before
M4; it is connected and verified, so nothing in this milestone is waiting on it.
And `@dagr/render` contained a stub `index.ts` and no dependencies, so M4.1 was
also the run that added three.js to the repo for the first time.

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

- [x] **M4.1** (`@dagr/render`, `apps/demo`, `docs`) First light: a three.js
  `WebGPURenderer` mounted in `apps/demo` drawing one shape on screen, an
  orthographic 2D camera with pan and zoom, resize and devicePixelRatio
  handling, and the `Renderer` interface module that everything later in the
  milestone plugs into. Unit tests for the camera and viewport math, which is
  pure and needs no device: screen to world and back round trips to a measured
  bound at any zoom and DPR, and the visible world rect matches the canvas
  aspect. Screenshot committed. (This line asked for a PIXEL-EXACT round trip
  and was amended when M4.1 shipped, because floating point does not offer one
  and no test here establishes it. See the DECIDED paragraph below.)
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
  DECIDED, and the two paragraphs above are the argument rather than an open
  question. Testing: the split, pure modules in Node and a committed screenshot
  for anything needing a device, with one addition worth carrying forward. The
  seam between the camera's own math and the frustum it hands three is checked
  by composing the orthographic projection by hand from `orthoFrustum()` and
  asserting its NDC matches the NDC `worldToScreen` implies, because that seam
  is the one a screenshot cannot check cheaply and a camera can be perfect in
  isolation and still put every click in the wrong place. What is knowingly
  untested is listed on `docs/docs/render.md` rather than left implied.
  Dependency: `three` is a `peerDependency` plus a `devDependency`, range
  `>=0.180.0 <1.0.0`, because three's pre-1.0 minor is its breaking slot so a
  caret would warn every consumer tracking its monthly releases. The floor is a
  judgement rather than a compatibility claim: 0.180.0 was read and exports all
  seven imported names, 0.181 to 0.184 were not built against. The peer is for a
  RELATED reason to `@dagr/graph`'s, not the same one: graph's is nominal typing
  through `#private` fields, three's is runtime `instanceof` across copies. No
  three.js type appears in the public surface, but the peer is still a PRESENT
  necessity rather than a forward commitment, because `webgpu-renderer.ts`
  imports `three/webgpu` at module scope. What the empty surface changes is the
  failure mode: two copies compile cleanly and misbehave at runtime, where
  `@dagr/graph`'s `#private` fields make the same mistake a type error.
  Two more decisions this task made that later M4 tasks inherit. THERE IS NO
  `Rect` IN `@dagr/render`: `visibleWorldBounds()` returns `WorldBounds`
  (`minX/minY/maxX/maxY`), because a `{x, y, width, height}` rectangle was
  structurally identical to `@dagr/layout`'s with the OPPOSITE corner
  convention, so a layout rectangle assigned into a world slot compiled clean
  and the symptom was a scene mirrored about the horizontal axis. Two reviewers
  found that independently. A phantom brand does not close it, tested: an
  optional key stays assignable and only a required one raises TS2741, so
  extents were taken instead. M4.4 still owns the conversion; it now gets a
  compile error at the seam. And the ERROR RULE, which is meant to be applied
  without re-running the argument: an out-of-range value is a `RangeError`
  naming the field, anything else this package throws gets a named class
  (today just `RendererDisposedError`). Numerical claims quote a measured
  bound: nothing in this package is described as pixel-exact, because no test
  establishes it.
- [x] **M4.2** (`@dagr/render`, `apps/demo`) SDF shapes in TSL: rounded-rect
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
  holds at both 0.1x and 100x. It does, and the evidence is the 0.1x and 100x
  references committed under `assets/screenshots/` (three frames in all, the third
  at zoom 1 where the readout, the fill, the outline and the glow are legible
  together) plus a test that asserts the invariance directly.
  DECIDED, and these are the paragraphs M4.3 onwards inherits rather than
  re-argues. THE FORMULAS ARE WRITTEN ONCE, over an `Arith<T>` interface of NINE
  primitives, with a `numberArith` backend the tests run and a `tslArith` backend
  the shader runs. A TSL graph builds under bare Node and does not evaluate, so
  the alternative was two copies of every formula and a suite checking the copy
  that never reaches a GPU. This way the suite executes the expression tree the
  fragment shader evaluates. KEEP THE INTERFACE AT NINE: `smoothstep` and `clamp`
  are WGSL intrinsics deliberately NOT in it and are built from the primitives
  instead, because each would move a formula out of the tested half of the file,
  and M4.10 owns measuring whether that trade still holds at 10k instances. BUT DO
  NOT READ THE UNTESTED SURFACE AS "THE NINE ADAPTERS" AND NOTHING ELSE, which an
  earlier draft of this block said and which api-design-review caught: THREE pieces
  of TSL are executed by no Node test. `length` IS used as an intrinsic, in
  `antialiasWidth` alone; `shapeShading`'s colour `mix` is vec3 and cannot go
  through a float interface; and the `mul(size, 0.5)` inside `roundedRectSDF`'s
  deferred `Fn` body never runs, because the suite builds that body directly from
  pre-halved literals. The compensating control is the STRUCTURAL assertions in
  `test/sdf-nodes.test.ts` rather than a numeric test.
  TWO UNITS, AND THE ASYMMETRY IS THE POINT. An outline is in DEVICE PIXELS and is
  inset; a glow is in WORLD units and sits outside. An outline is a property of
  the screen and the derivative that gives the antialiasing width also converts
  pixels to world units; a glow is a property of the shape and its padding is
  baked into the quad, so a pixel-space glow would need the quad resized per
  frame, which is M4.4's.
  THE ANTIALIASING WIDTH IS THE `max` OF THE TWO PER-AXIS `length`s OF THE
  INTERPOLATED POSITION'S GRADIENT, AND NOT `fwidth`. OF THE POSITION AND NOT THE
  DISTANCE: every field folds through `abs` or a square, so a distance gradient
  collapses on the quad holding a shape's centre and the inset outline vanishes
  there, which on a small shape is the whole shape.
  because `fwidth` is the L1 sum and exceeds L2 by up to 41% exactly where the
  derivatives are equal, which is a 45 degree edge, and a rounded corner is
  nothing else. READ THIS ONE AS A WARNING: swapping in either `fwidth` or its L1
  expansion left the whole suite GREEN, since both are correct to within a factor
  on every value a numeric test can check, so the suite now asserts the node
  graph's STRUCTURE. A numeric test cannot catch a wrong-by-a-factor derivative.
  THE OUTLINE'S OUTER RAMP IS CENTRED ON THE BOUNDARY, exactly like the fill's,
  and an earlier draft inset it by half an antialiasing width so that its coverage
  was exactly zero at the boundary. That draft was WRONG and a real GPU frame is
  what caught it: a 2 pixel band then samples 0.5 at BOTH of its pixel centres and
  can never draw its own colour, measured as #bc8932 where #023047 was asked for.
  The footprint argument behind the inset does not hold either, because the FILL's
  own ramp already reaches half a pixel past the boundary, so an outline reaching
  the same distance adds nothing to the shape's alpha support. Centred, a band of w
  pixels draws w fully covered pixel centres.
  A SHAPE FADES DOWN TO ABOUT A PIXEL AND THEN STOPS BEING RASTERISED. At zoom 0.2
  the 10-unit rung is a 2 by 2 block of #7e4d1b against #ffb703 at full coverage,
  which is the fade. At 0.1 it does not appear at all: its padded quad is 1.4 by
  0.8 CSS pixels and whether that covers a sample point depends on where it lands
  on the grid, while the circle beside it survives as one dim pixel. No distance
  field fixes that, because the fragment that would have faded is never shaded.
  `antialias: true` THEREFORE STAYS ON and M4.10 settles it. The argument for
  turning it off is unchanged and still sound (analytic edges gain nothing from
  MSAA, which costs a 4x target plus a resolve), but the one place MSAA can still
  matter is exactly the sub-pixel case above, and separating "MSAA is keeping this
  speck visible" from "the quad missed the samples" needs a controlled comparison
  this task has no harness for.
  THE SCENE IS A CRISPNESS LADDER of a rounded rect and a circle on each of three
  rungs a decade apart, the RECTS 10, 100 and 1000 world units across and each
  circle's diameter matching its rung's HEIGHT, so the circles are 4, 40 and 400.
  Quote the rect widths rather than "the shapes are 10, 100 and 1000 across", which
  is false of half of them. The smallest rect sits on the origin so `#zoom=100`
  frames it with the default camera, and the padded quads are PAIRWISE DISJOINT,
  which is the tested form of "nothing overlaps" and is strictly stronger, so the
  frame does not depend on draw order.
  `apps/demo` grew a `#zoom=` URL hash for exactly one reason: the committed
  references are then reproducible by opening a link rather than by landing on
  100x with a trackpad.
- [x] **M4.3** (`@dagr/render`) Instanced rendering: one instanced mesh per
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
  DECIDED, PROVISIONALLY, AND THE GATE IS M4.10: ONE MATERIAL PER SHAPE FAMILY.
  The uber-material's cost is per FRAGMENT and the per-family cost is per DRAW
  CALL, and a graph at readable zoom is mostly fill, so a shape id branch is
  evaluated for every pixel every instance covers to save one call. The family
  count is small and known, so the union of uniforms an uber-material pays for
  grows at the same rate as the calls it saves. What makes the reversal cheap is
  M4.2's own decision: the distance functions are composable nodes with no
  opinion about material assembly, so reversing this rewires
  `createInstancedMaterial` and touches no formula. The measurement to take at
  M4.10 is draw-call overhead against per-fragment branch cost at 10k instances.
  THE SPLIT IS THREE MODULES AND TWO OF THEM ARE PURE. `instance-buffer.ts` is
  handles, slots and capacity; `instance-attributes.ts` is what a slot contains,
  as floats, including the arrays; `instanced-scene.ts` is the only one that
  imports three. A `Float32Array` is not a GPU resource, which is the line that
  put the attribute assembly on the tested side: the two pure modules carry 52
  tests deciding the packing, the slot moves and the reallocation, and the
  untested residue is a node graph.
  WHAT IS PER INSTANCE AND WHAT IS A UNIFORM, because the split is the design.
  Per instance: centre, size, corner radius, glow REACH, fill colour, glow
  colour, which is 12 floats and 48 bytes (the campaign's 3,010 nodes are 144
  KB). Uniform: outline colour, outline width in device pixels, glow ALPHA. The
  glow's reach is per instance and its alpha is not, which reads as inconsistent
  until the quad is considered: reach sizes the padded quad, so a shared reach
  clips a large shape's halo or wastes fill rate on a small one, and the ladder
  proves it with reaches of 1, 10 and 100 world units in ONE family.
  THE BUDGET FOR A SEVENTH CHANNEL IS ONE, AND THE LIMIT IS `maxVertexBuffers`.
  This entry first said nine slots were free, which counted
  `maxVertexAttributes` (16). three allocates one vertex buffer slot per
  non-interleaved attribute THE SHADER READS: `RenderObject.getAttributes` walks
  the attributes the node graph references, so the six channels plus the quad's
  own `position` bind SEVEN of WebGPU's default EIGHT, and the quad's `normal`
  and `uv` cost nothing because this graph never references them. Stating the
  rule as "per attribute on the geometry" gives nine of eight and describes a
  scene that cannot build, which is the version a review sent back.
  WHY THEY ARE UNREAD IS NOT THAT THE MATERIAL IS UNLIT, which is a second thing
  a review corrected: `MeshBasicNodeMaterial` sets `lights = true` and DOES
  override `setupNormal`. The guard is in `NodeMaterial.setupLighting`, which
  builds a lighting context only when `materialLightings.length > 0 ||
  lightsNode.getScope().hasLights`, and this scene has no lights and no light or
  environment map, so `setupOutgoingLight` returns `diffuseColor.rgb` and
  nothing asks for a normal. M4.6's spring velocity or M4.8's picking id is the
  seventh channel and fits; an eighth needs interleaving or a raised
  `requiredLimits`. Two ordinary SCENE changes take the last slot before a
  channel does, and neither is renderer work: a material that comes to read
  `uv`, and a light or an environment map, either of which satisfies that guard
  and pulls in the `normal` the quad already carries.
  EIGHT IS A WEBGPU NUMBER and M4.9 owns the divergence: three's WebGL2 path
  binds each attribute into a VAO with `vertexAttribPointer`, so it has no
  buffer-slot limit and its ceiling is `MAX_VERTEX_ATTRIBS`, at least 16. A
  channel past the eighth fails pipeline creation on one backend and draws fine
  on the other.
  D3 (2026-08-15) DID NOT TAKE THE SEVENTH SLOT, recorded here because it added
  the first per-vertex channel since this entry and the obvious reading is that
  it did. The limit is PER PIPELINE, and D3's per-edge highlight is an attribute
  on the RIBBON mesh: a different geometry, a different material, its own eight,
  five of them used before and six after. This budget is untouched. The rule the
  two cases share, and the one worth carrying forward, is that a slot belongs to
  the SHADER that reads the attribute, not to the package or the scene.
  M4.6 (2026-08-19) SETTLED THE COMPETITION BY WITHDRAWING FROM IT. The two
  candidates recorded above were a spring velocity and a picking id; the springs
  shipped as CPU arithmetic, so a stepped position arrives as an ordinary centre
  through the write this entry already counts, and a velocity no shader reads
  has no reason to be uploaded at all. The slot is M4.8's unless a scene change
  takes it first. GENERALISE IT: a channel is only a channel if a SHADER wants
  the number, and "this task will need per-instance state" is not the same claim
  as "this task will need per-instance state on the device."
  A COLOUR REACHING A SHADER AS AN ATTRIBUTE IS CONVERTED BY NOTHING. As a
  uniform it goes through three's `Color`, which does sRGB to linear on the way;
  an attribute is whatever floats are in the buffer. So `linearFromHex` does it
  on the way in, spelled the way `ColorManagement.js` spells it, and the test
  asserts agreement against a real `Color` rather than against a second copy of
  the formula. Skipping it does not throw and does not look broken: every colour
  comes out lighter and flatter, which a reviewer attributes to their monitor.
  THE LADDER NOW DRAWS THROUGH THIS PATH, which is deliberate and is the whole of
  the visual evidence. Six shapes in two calls, same places, same colours, so
  M4.2's committed references are a regression test for the per-instance path and
  a factor of two anywhere in the quad scaling is visible at a glance. Verified
  at 1x and 100x through the headless WebGL2 (swiftshader) path this box has,
  which is what the M4.12 captures came through; the 100x frame is the one that
  exercises the varying, since the antialiasing width is the gradient of an
  INTERPOLATED position and a gradient taken in unit-quad space would make every
  outline a fraction of its shape instead of two device pixels.
  GROWTH REBUILDS THE GEOMETRY RATHER THAN SWAPPING ATTRIBUTES. three keys a GPU
  buffer to the attribute object that owns it, so replacing an attribute leaves
  the old buffer alive with nothing referencing it, where `geometry.dispose()`
  destroys every buffer it holds. That is also why the renderer's dispose list
  holds the `InstancedShapes` OBJECT and not its geometry: a geometry captured at
  construction is the stale one by the time anything disposes it. Capacity
  doubles on growth and halves at a quarter full, and the gap is hysteresis: a
  shrink at a half would make one add-remove pair at the boundary reallocate
  twice per pair, forever.
  `frustumCulled` IS OFF AND THAT IS NOT AN OPTIMISATION BEING DECLINED. The
  geometry is a unit quad at the origin, so its bounding sphere describes a shape
  1.4 world units across at (0, 0) and three would cull the entire mesh, every
  instance of it, the moment the origin left the frustum. Culling worth having is
  per instance and belongs to M4.10, where there is a frame time to measure it
  against.
  Nothing is exported but the two ERRORS. `UnknownInstanceHandleError` and
  `SceneDisposedError` (named `InstancedShapesDisposedError` until M4.4 gave a
  second object the same failure) reach `index.ts` because an error arrives in
  somebody else's `catch` whether or not the module that throws it was exported,
  and one that arrives as a bare `Error` gets there with no `code` and failing
  `instanceof DagrRenderError`; the instance API stays internal because M4.4 owns
  the seam a caller feeds a graph through, and naming a handle API before there
  is anything to name with it is a guess something comes to depend on.
  A pre-PR review (four personas plus a general pass) found TWO live bugs, each
  reproduced by more than one reviewer, and both are the shape this entry warns
  about rather than typos. `add` ALLOCATED BEFORE IT VALIDATED, so a rejected
  instance left a live handle over a slot nothing had written: `count` and
  `instanceCount` came apart, the phantom slot drew whatever floats were in it,
  and the next successful add resurrected a REMOVED shape at its old position. A
  caller that catches the `RangeError`, which is exactly what M4.4 applying a
  delta does, saw no error at all. And `compact` LEFT THE CAPACITY OFF THE
  DOUBLING CHAIN, so a later halving produced a fractional capacity that passed
  every comparison and that `new Float32Array(n * components)` truncated PER
  CHANNEL, leaving a 1-component channel a slot shorter than a 2-component one
  with the writes that fell off it discarded in silence. Both are fixed with the
  tests that were missing: nothing had freed or allocated AFTER a compaction, and
  no test paired the bookkeeping with the data under churn. There is now a
  400-step model check over `InstancedShapes` asserting every live handle's own
  floats after every step, which is the test that would have caught both.
  Four smaller findings taken in the same pass: the styles record is PARTIAL, so
  a caller drawing only boxes no longer fabricates a circle style nothing reads;
  `InstancedShapes<F>` is generic over its family, so a circle handed to a rect
  mesh is a compile error and the runtime check is left for the data-driven
  caller M4.4 brings; the instance writes reach the GPU as ONE MERGED UPDATE
  RANGE per channel per frame rather than a whole-buffer upload, which is the
  item that was most in M4.10's way; and `remove`'s docstring now states that BLEND ORDER WITHIN A FAMILY IS SLOT
  ORDER, so removing an unrelated node can flip which of two overlapping nodes
  reads as in front. M4.5 gets its layering from separate meshes in a chosen
  order, never from slot order within one.
  THE RANGE FIX TOOK TWO ROUNDS AND THE FIRST ONE WAS WORSE THAN NO RANGES, which
  is worth recording because it is not obvious from three's API. `addUpdateRange`
  pushes a fresh record per call and NEITHER BACKEND MERGES THEM, and each range
  is a `writeBuffer`, so a range per write turned a 10k-node spring pass into 60k
  range objects and 60k device writes per frame in place of the six whole-buffer
  uploads it was meant to replace. Two reviewers measured it independently (2,000
  ranges after 1,000 adds and 1,000 sets). What works is two integers: the span of
  slots written since the last frame, flushed to one range per channel from
  `mesh.onBeforeRender`, which three calls at the top of `renderObject` before it
  touches the geometry. A span rather than a set, so scattered writes degrade to
  the whole-buffer upload and never to something worse.
- [x] **M4.4** (`@dagr/render`, `apps/demo`) A real graph on screen: take a
  `LayoutResult` from `@dagr/layout` and draw its nodes, sized and positioned,
  with a node-id to instance-handle mapping that survives nodes being added and
  removed. The first task where the demo shows an actual laid-out graph instead
  of test geometry, which makes its screenshot the milestone's first honest
  progress report. Wants M2.7 positions to be real: before that it would draw a
  correct picture of a degenerate layout, which is not worth a run.
  THE SEAM TAKES NODES AND NOT A `LayoutResult`, which is the one place this
  entry's own wording was not followed, and the reason is a package boundary:
  naming a `LayoutResult` in `@dagr/render` would make `@dagr/layout` a
  dependency of it, and the two have been independent since M0. `setNodes` takes
  an array of `SceneNode` (id, shape, centre, size, corner radius, fill, glow,
  glow reach), the caller converts, and the conversion is where the y flip
  happens, which `camera.ts` has said belongs to M4.4 since M4.1.
  THE Y FLIP HAPPENS ONCE, in `campaign-scene.ts`'s `toWorld`, at the very end.
  Layout is y-DOWN and `Camera2D` is y-UP; a tile's own layout, the shelf packing
  and the grids all stay in y-down space so there is exactly ONE line where the
  sign changes. Flipping per tile would be four sign changes and three chances to
  get one wrong, and a missed one is a tile whose contents are upside down inside
  a picture that is otherwise right, which reads as a layout bug rather than a
  sign bug. `WorldBounds` being extents rather than `{x, y, width, height}` (M4.1)
  is what makes the seam itself a compile error rather than a convention.
  A NODE KEEPS ITS INSTANCE HANDLE ACROSS `setNodes` CALLS, which is the mapping
  this entry asks for and is the property M4.6 and M4.8 actually need. The diff
  is by id: a node in both lists is updated in place, one that left is freed, one
  that arrived is allocated, and removals run before additions so a wholesale
  swap does not grow the buffers to twice what it needs. The ONE case where the
  handle cannot survive is a node that changes SHAPE, because the two families
  are two meshes; that is stated rather than hidden. `SceneNodes.placementOf`
  returns the pair (shape, handle) rather than a bare handle, because each family
  runs its own counter and the first rounded rect and the first circle are both
  handle 1: a test caught a `handleOf` claiming a shape change had reallocated
  nothing. It is NOT on the `Renderer` interface, because M4.8 is the task that
  knows what a picking pass needs.
  `setNodes` IS ALL OR NOTHING, which the review made it: every node is converted
  and validated before anything is touched. Validating as it wrote left a scene
  holding neither the node that had left nor the one that failed to arrive, and a
  caller catching the `RangeError` (the delta path this method exists for) draws
  that as a silently short picture. `nodes` on the options sizes the buffers PER
  SHAPE FAMILY for the same class of reason: one count applied to both reserved
  twice what a mixed scene needs, and an empty list asked for a capacity of zero,
  which `InstanceBuffer` rejects by naming an option the caller never wrote.
  THE ROUTES RIDE THE SAME FLIP AS THE NODES, which the ribbons session asked for
  before this merged and which is worth more than the fifteen lines it cost.
  `CampaignScene.edgeRoutes` keeps one polyline per routed edge whose ends share
  a tile, in world space, translated by the same tile corner and flipped in the
  same `toWorld` as the node boxes. A route flipped differently from its
  endpoints still starts and ends near the right nodes and only bulges the wrong
  way in between, so it reads as a ROUTING bug and would be looked for in
  `@dagr/layout`; `test/campaign-scene.test.ts` asserts every point of every
  route lies inside its tile, which is the assertion that catches it.
  THE CRISPNESS LADDER IS GONE, with `shape-scene.ts` and its suite. The renderer
  ships no scene of its own now: `createRenderer` draws an empty one and
  everything on screen arrives through `setNodes`. That also orphaned `ShapeStyle`,
  `requireShapeStyle` and `shapeQuadSize`, which are deleted, and it moved
  `quadPadding` onto the `Arith` interface: the padded quad is computed per
  instance in the VERTEX stage now, so the choice was a second copy of that sum in
  TSL or one formula both backends run, and M4.2's whole argument for the nine
  primitives applies unchanged.
  THE DEMO TILES, AND THE PLAN'S ARGUMENT SURVIVED CONTACT. One Sugiyama pass over
  3,010 nodes ranks 1,023 rooms into a couple of layers and draws a ribbon; the demo
  runs 95 layout calls instead, one per chapter, region, quest and front, plus a
  spine, and shelf-packs the blocks. Measured at the default seed: 101 tiles, 95
  of them laid out and 6 of them GRIDS. The grids are the honest half of the
  scheme rather than an escape from it: NPCs, factions, items, stat blocks, clues
  and weather sit outside the contains forest and no routed edge has both ends
  inside any one of those groups, so a layer assignment would put all 375 NPCs in
  rank 0 and the "layout" of a bestiary would be one row 550 nodes wide.
  THE SHELF WIDTH IS SEARCHED, NOT COMPUTED, and the first version computed it.
  `sqrt(totalArea * aspect)` is the width a packing of exactly the tile areas
  would need, and a shelf packing is not that: each shelf is as tall as its
  tallest member. On a hundred tiles of mixed height it produced 0.92 against a
  1.78 target, which is a nearly square drawing in a 16:9 frame and a third of the
  viewport wasted at the fitted zoom. A bisection on the width fixes it, because
  the packed aspect is monotonic in the width.
  ONE TABLE SIZES AND COLOURS A KIND, in `apps/demo/src/campaign-style.ts`, and it
  has three readers rather than two: layout is told the same size the renderer
  draws (a node laid out at one size and drawn at another overlaps its neighbours
  in a picture whose layout says it does not), and the overlay places a card
  against the same box. Colour is by STRATUM (amber spine, blue geography, violet
  people, green quests, red pressure, grey reference) so the far view reads as
  structure, and `nodeColor(node)` derives the CSS string the card tier needs from
  the same numbers the GPU takes: a CSS declaration whose value the parser rejects
  is DROPPED SILENTLY, so a second table would drift invisibly. It takes the NODE
  and not its kind, which is its second signature: the first was
  `(kind, subtype?)`, and the optional argument decides the answer for the most
  numerous kind in the campaign, so a caller passing the kind alone badged all
  1,023 rooms in the region's colour while the GPU drew them in their own.
  `#zoom=` SURVIVED, and nearly did not. The load-time `fitBounds` would have
  overridden it on every load while the readout went on advertising it, so the
  fit is skipped when the hash spoke. `initialZoomFromHash` returns its fallback
  as given, which makes a non-finite fallback a usable "absent" signal; comparing
  against `INITIAL_ZOOM` instead would read `#zoom=1` as silence.
  The committed frames are `assets/screenshots/m4.4-campaign-fit.png` (the whole
  campaign at the derived floor, 0.053 px/unit) and `m4.4-campaign-rooms.png`
  (keyed rooms with their names at 2 px/unit). Both through the headless WebGL2
  (swiftshader) path this box has, at dpr 1.
  A pre-PR review (four personas plus a general pass) found a FRESH-CLONE
  BREAKER and two real defects, and the fresh-clone one is the reason a green
  local gate was not evidence: `@dagr/layout` was the demo's first new dependency
  since M0 and was missing from both of apps/demo's resolution maps, so it
  resolved through the package `exports` to a `dist/` that a clean checkout does
  not have. It passed here only because `dist` was lying around from an earlier
  build, and CI typechecks BEFORE it builds. Verified by moving both `dist`
  directories aside and rerunning. THE RULE: a new workspace dependency in
  `apps/demo` is two edits, `vite.config.ts` and `tsconfig.json`, and neither is
  optional.
  Also from the review: a worker that dies is a run that is never answered, and
  the engine has no timeout by design, so `App.tsx` carries an `error` listener
  (without it the page sits on "laying out the campaign" forever with nothing
  thrown for its `catch`); `SMALLEST_NODE_SIZE` reduces PER AXIS rather than by
  area, since the smallest by area is a 32 by 32 clock tick while a room is 56 by
  28 and `fitZoom` takes a minimum over both axes, so the zoom ceiling was 14%
  too low for the two most numerous kinds; and the GLOW RAMP IS CAPPED AT THE
  QUAD, which is the one visual bug the committed frame showed: `glowCoverage`
  floors its ramp at one device pixel in world units, so below a zoom of
  `1 / (dpr * (glow + 1))` the ramp ended past the quad and the halo was cut by a
  straight line. At the fit frame a room still read alpha 0.276 where its quad
  ended, so about fifteen hundred of the smallest nodes wore hard-edged
  rectangles of halo and the circles wore square ones. One `min` fixes it.
  The palette was measured rather than eyeballed, which caught three CROSS-family
  pairs sitting as close in Oklab as the deliberate steps within a family (a
  scene against a clock tick at 0.075, a stat block against a settlement at
  0.070), so the pressure reds moved off the orange axis and the reference greys
  went neutral. That separation is the whole of what the stratum colouring
  claims to do at the far zoom.
- [x] **M4.5** (`@dagr/render`, `apps/demo`) Edge ribbons: polyline and bezier
  tessellation from M2.8's route control points, joins that do not pinch at
  sharp angles, and a dash-flow uniform for animated direction. State whether
  width is in world space (scales with zoom, matches the node boxes) or screen
  space (constant pixels, stays legible when zoomed out), because that choice
  is visible in every screenshot afterwards. Demo scene exercising a graph with
  edges spanning many ranks, which is what M2.4b's dummy chains turn into the
  multi-point polylines this task has to tessellate without pinching.
  DONE, in two PRs, because the demo half waited on M4.4: the tessellation
  core is PR #31 (`ribbon.ts`, `ribbon-nodes.ts`) and the scene is PR #35
  (`scene-edges.ts`, `campaign-edges.ts`, the `setEdges` seam). The committed
  frame is `assets/screenshots/m4.5-ribbons.png`, a near view at 770x599 and
  dpr 1 where the dash and the joins are visible; the fitted view is Dispatch
  media rather than a committed asset, because `assets/` has a budget and a
  picture of 7,100
  antialiased lines does not compress. The decisions the entry asked for, made:
  **WIDTH IS IN SCREEN SPACE.** A ribbon is a fixed number of DEVICE pixels
  from its centreline at every zoom. The demo's derived range runs 0.45 to 134
  CSS pixels per world unit on the LADDER scene and the reference canvas (P2
  measures both ends; the campaign restates them with its own bounds once M4.4
  draws it), a factor of 300, and no world width survives both ends: one
  visible at the floor is a slab across the card it connects at the ceiling,
  one right at the ceiling is a third of a pixel at the floor, which
  is the sub-pixel fade M4.2 measured. `@dagr/layout` gives a node a `Size` and
  an edge only a polyline, so a world width would be invented by the renderer
  rather than laid out; an outline is in device pixels here for the same
  reason. Three things fall out and are the reason it is worth taking rather
  than merely defensible: every join test is an ANGLE test, so one tessellation
  is correct at every zoom and the camera never invalidates a buffer; the
  antialiasing width is exactly 1, since the unit IS the device pixel, so the
  ribbon shader has no derivative in it at all and `antialiasWidth`'s whole
  subject does not arise; and dashes are in pixels too, so a pattern flows at
  one apparent speed at every zoom. The cost, stated: a 3 pixel edge meeting a
  viewport-sized card at deep zoom reads as a wire rather than as a road. World
  space is one uniform's value away (multiply the half width by the pixels per
  world unit), so the geometry does not close the door.
  **JOINS: MITER WITH A LIMIT OF 2, A FAN PAST IT, AND THE FAN DOES NOT SHARE
  ITS INNER VERTEX.** The miter length is `1 / cos(turn / 2)` and is computed
  as `2 / |a + b|` over the two unit normals, so the branch that decides it
  never evaluates the unbounded quantity. Past the limit each segment keeps its
  OWN rib, which is what keeps every boundary vertex exactly one half width
  from its own centreline (no narrowing anywhere, which is what a pinch is),
  the outer wedge is filled from the centreline point, and the inner side
  overlaps rather than gapping. A shared inner vertex is the alternative and at
  a hairpin it sits far up the bisector inside the ribbon's own doubled-back
  body, which is the fold this entry names. Overlap is invisible on a ribbon of
  one colour. A 180 degree reversal is the same path with a zero bisector and
  no wedge. The limit of 2 rather than SVG's 4: at 2 the last mitred turn is
  120 degrees and the spike is never longer than the ribbon is wide, which
  matters at 3 pixels and does not at 20.
  The one bound a screen-space width cannot check on the CPU, stated the way
  the tests measure it rather than the way it was first written, since the
  first version understated it twice over: a mitred corner moves each vertex
  along the segments it joins by `expand * tan(turn / 2)`, where `expand` is
  the half width the VERTEX STAGE uses, the visible one plus the antialiasing
  padding. A quad inverts into a bow tie once the segment is shorter on screen
  than `expand * |tan(in / 2) + tan(out / 2)|`, with the turns SIGNED and the
  sum taken before the absolute value. The algorithms review corrected that:
  an earlier version claimed turns in opposite directions never invert, and
  the test pinning it used 90 against 90, which is the one pair where the
  cancellation is exact. Unequal opposite turns do invert, 119 against 30 back
  at 3.57 pixels for an `expand` of 2.5, and the tests now pin four same-way
  angles and three unequal opposite pairs to within 0.005 world units. Worst
  case at the default limit is `3.46 * (halfWidth + 1)` pixels, 8.7 for a 3
  pixel ribbon. M2.4b's dummy chains clear it, but on segment length rather
  than on cancellation: a rank apart is 22 pixels at the ladder's fitted
  zoom. The named fix if a
  screenshot ever shows a hole: one per-vertex float carrying the corner's cap
  in world units and a `min` in the vertex stage, which trades the hole for a
  ribbon that narrows through a tight corner.
  ONE boundary is knowingly not antialiased, recorded in `ribbonCoverage`: the
  butt cap at a route's ends, since the padding is across the ribbon and there
  is no along-axis term. M2.8 attaches both ends of a routed edge to a node's
  border, so the cap is drawn against the box it arrives at; fixing it needs
  the route's length at every vertex, which is another attribute and wants a
  screenshot to justify it. The bevel's compressed ramp WAS the second such
  deferral and is now fixed by the fan above rather than deferred.
  **THE FLATTENING TOLERANCE IS ABSOLUTE, ITS DEFAULT IS RELATIVE.** The
  option is world units of chord error, which is the quantity that turns into
  pixels of faceting at a given zoom. No absolute default works for two scenes
  at once: the ladder is 2,205 world units across and the campaign is 96,455
  with a median gap near 2,000, and both reviews measured what a flat 0.05
  costs there (2.2M vertices, 76 MB, near a second of single-threaded work at
  24.8 points per span). The default is therefore a fraction of each route's
  own mean segment length, which is scale free because a span's sagitta scales
  with its length: 0.01 gives 6 points per span at every scale.
  Measured on this box, 7,100 routes of 2 to 9 points: 77k vertices, 2.5 MB,
  88 ms as polylines. The `number[]` accumulators hold their doubles live
  alongside the typed arrays they are copied into, which a counting pass would
  remove; not taken here because the count depends on which joins mitre and
  which fan, so a counting pass would repeat the join decisions and could
  disagree with the walk in a way that writes past an end.
  Two obligations land on the demo half rather than here. `requireRibbonStyle`
  has no caller until the stage 2 material builder validates a style and lifts
  each field into a uniform, which is the shape that consumer needs: a generic
  bridge returning numbers would go through `Arith.literal` and bake the period
  and the flow into the compiled shader as constants, so `advanceDashFlow`
  could never move the pattern without a rebuild. And the graphics review
  measured the overview at the zoom floor and the scene half re-measured it:
  the campaign's edges are 21.1M world units of centreline (3.99M routed, 0.98M
  cross-tile, 16.15M overlay), and at the fitted 0.05 device pixels per world
  unit a 3 pixel ribbon would paint 529% of the viewport, 176% at one pixel.
  The 110.9M quoted during the stage 1 review does not reproduce; the argument
  is unchanged and the figure is corrected. The width is already a uniform, so
  the fix is per frame and free: clamp it against the world-space width and
  fade the alpha below the floor.
  **ONE INDEXED MESH, NOT INSTANCES.** M4.3 instances nodes because a node is
  one shape drawn many times. Every ribbon has its own point count, so the only
  thing an instance could be is a segment, and a per-segment instance computes
  its joins in the vertex shader, which puts the arithmetic this task is
  actually about where no test in this repository can execute it. The
  tessellator returns attribute arrays plus a range per route, so one draw
  covers the scene and a caller can still colour or highlight one edge.
  **DASHES ARE A DUTY CYCLE IN `(0, 1)`, AND SOLID IS THE ABSENCE OF A DASH.**
  The dash distance is measured from the MIDDLE of the period, so both ends of
  every dash get the same ramp; measured from the start, the distance across
  the wrap belongs to the wrong dash and every leading edge is a hard step. A
  duty of 1 is rejected rather than treated as solid, because a zero-width gap
  is still a boundary to a distance field and reads as a half-alpha seam once
  per period. Omitting the dash removes the arithmetic from the expression tree
  when the material is built, so a solid ribbon's shader has no `fract` in it.
  The flow uniform wraps into one period, which keeps a float32 varying from
  quantising after an hour of an idle tab, and it advances towards the TARGET
  because `RoutedEdge.points` runs source to target: the animation is the
  direction cue, which is why nothing here draws an arrowhead.
  **BEZIER IS CENTRIPETAL CATMULL-ROM THROUGH the control points**, converted
  span by span to a cubic and flattened by adaptive subdivision. Through and
  not near: a dummy's coordinate is the crossing the order stage chose, so a
  curve using the points as a cage would undo the layout it came from. Uniform
  parameterisation cusps on unevenly spaced points, which is every route that
  leaves a wide box and then steps through evenly spaced dummies. The
  flattening tolerance is a statement about zoom, since the geometry is baked:
  faceting stays under half a device pixel while
  `tolerance * pixelsPerWorldUnit <= 0.5`.
  **THE SCENE HALF, PR #35.** Three groups, drawn in the order they are
  declared, which is the only layering M4.3 leaves available: routed ribbons
  under cross-tile lines under the overlay kinds. `setEdges(groupId, edges)`
  rebuilds a group's buffers and `setEdgeStyle(groupId, style)` writes uniforms
  and touches none, and that split is what the screen-space width makes
  necessary: the width a frame draws at is a camera fact, so a seam that made
  it a property of the geometry would re-tessellate every route to change a
  uniform. Only the ROUTED group is dashed, because only it has a direction a
  layout computed; the other two are lines this demo draws between two boxes,
  so their direction is a fact about the data rather than about the drawing.
  Routed edges take their polylines from `CampaignScene.edgeRoutes` and never
  re-derive one: those points are the crossings the order stage chose, and a
  straight line between the same two boxes looks entirely reasonable while
  throwing the layout away. A routed edge whose ends fell in different tiles
  was never routed at all, so it is a bowed line like the overlay kinds.
  The lines are BOWED rather than straight, by a fraction of the chord so the
  shape survives every distance, because two nodes joined by more than one
  overlay kind would otherwise draw the same segment twice with the second
  invisible under the first, and a reader counting relationships would count
  one.
  The far view's debt is paid: `ribbonWidthAt` draws a ribbon at the half-pixel
  floor and fades its alpha by the same ratio, so `halfWidthPixels * alpha` is
  exactly the honest sub-pixel width and the ink on screen is what the scene's
  own world width asks for. At the campaign's fitted zoom, which the demo
  prints as 0.05 and derives as 0.05 to 19.2 CSS pixels per world unit at
  1003x597 (both ends move with the viewport), that is an alpha of about 0.15
  at dpr 1, the difference between structure and a mat. The overlay kinds ramp
  in over 1.5 to 4 CSS pixels per world unit rather than switching at a
  threshold, and that band is keyed on the CSS zoom where every width here is
  in device pixels: how crisply a line is drawn is a fact about the display,
  while whether a KIND of edge is worth showing is a fact about apparent
  scale, and a device-pixel band would show the social graph on a retina
  laptop and hide it on an external monitor. It is a RAMP rather than a
  threshold because a hard switch makes a thousand lines appear between two
  frames of a pinch and reads as a glitch rather than as detail arriving.
  THE DASH ADVANCES BY THE TIME BETWEEN DRAWN FRAMES, capped at a thirtieth of
  a second, which is what lets a flowing dash exist in a demo that renders on
  demand. Counting frames would tie the flow speed to how much the user moves
  the camera. Reading the absolute clock, which this did first, is worse: wall
  time accrues while the scene is idle and discharges into the first frame of
  the next gesture, so at 18 px/s over a 14 px period any pause over 0.8
  seconds teleports every dashed ribbon by up to a full period. An uncapped
  delta between drawn frames has the same defect, because after an idle that
  delta IS the idle. The cap never binds at 60fps and moves the pattern 0.6 px
  on the frame after a pause, so it drifts during a pan, holds where it was at
  rest, and animates on its own the moment M4.6 brings a loop.
  The tenth primitive is recorded here because `sdf.ts` counts nine: the dash
  needs a `fract` and periodicity cannot be built from the nine. `DashArith`
  extends `Arith` beside its only consumer, so the shape formulas keep their
  count and `tslArith` gains no line no shape uses.
- [x] **M4.6** (`@dagr/render`) Spring integrator: critically damped springs
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
  **THE ACCUMULATOR IS NOT HERE, AND THE REASON ONE IS USUALLY NEEDED IS THE
  REASON IT IS NOT.** This entry asked for a fixed-timestep accumulator so
  behaviour would not change with frame rate. An accumulator exists to bound an
  approximate integrator's error, and there is no approximate integrator: the
  ODE this entry writes out has a closed form, so `stepSpring` evaluates
  `target + (A + Bh)e^(-wh)` rather than walking towards it. Ten steps of a
  millisecond and one step of ten agree to machine precision, which is the
  frame-rate property the accumulator was going to buy, asserted directly in
  `test/spring.test.ts`. Shipping one anyway would have cost that property: a
  fixed substep leaves a remainder every frame, and a remainder is either
  dropped, which lags the drawing behind the clock by a different amount at each
  frame rate, or carried, which advances one frame a substep further than its
  neighbour and reads as a stagger at constant velocity. GENERALISE IT: a
  mechanism that exists to bound an error is not neutral when the error is
  absent, because it has costs of its own that nothing is paying for.
  **THE LONG-FRAME OPINION `ribbon.ts` ASKED FOR IS THAT NO CLAMP IS NEEDED.**
  Exactly stepped, a backgrounded tab's delta lands the spring on its target
  with zero velocity, which is the correct picture for a tab coming back: the
  settled drawing rather than a minute of catch-up. The one real hazard is
  arithmetic rather than physical, and it is guarded: past a `w * dt` of about
  745 the decay underflows to zero in a double while `A + Bh` can be an
  infinity, and zero times infinity is `NaN`, so the target is returned
  directly. A zero delta is guarded for the same class of reason and a different
  cause: `target + (position - target)` is not `position` in a double, so a
  paused clock or two callbacks in one millisecond would walk a resting spring
  off its own value one rounding at a time.
  **THE SUITE IS CHECKED AGAINST THE EQUATION AND NOT ONLY AGAINST ITSELF.** A
  closed form tested by its own properties is a suite that agrees with its own
  algebra: a transcription error in the exponential would leave every property
  in this entry's list true, because they are all properties OF the
  transcription. `test/spring.test.ts` carries a hand-written semi-implicit
  Euler integrator derived from `x'' = -2w x' - w^2 (x - target)` directly, and
  asserts that the two agree at a small substep and that shrinking the substep a
  thousandfold tightens the agreement by at least a hundredfold, which is the
  first-order convergence Euler has and a wrong closed form would not be the
  limit of. The same reference then
  earns its keep twice more: it is the demonstration that a fixed step DOES vary
  with frame rate, and the demonstration that it diverges on the long frame the
  closed form absorbs.
  **THE OVERSHOOT PAIR IS TESTED AS THIS ENTRY WROTE IT, WHICH IS TO SAY THE
  ENTRY WAS RIGHT.** Released from rest the displacement never changes sign, at
  any distance and any `w`, over a grid. From an arbitrary state it changes sign
  exactly when `-A/B` is positive, which is the entry's own condition, and never
  more than once. The retarget test that catches the `(start, target, elapsed)`
  shortcut is the one worth keeping in mind: retarget a moving spring TO WHERE
  IT ALREADY IS. The ODE carries the velocity through and overshoots; the
  shortcut restarts from rest and stops dead.
  **IT LIVES IN `@dagr/render`, EXPORTED: the third option, taken for the second
  time.** `html-overlay.ts` was the first, and `index.ts` had already recorded
  that it was taken "on the option M4.6 named", so the precedent was set before
  the decision was due. The entry's condition for keeping the split cheap is met
  with two qualifications, both deliberate: `spring.ts` imports the `Vec2` TYPE
  and three of the shared checks in `validate.ts`, and nothing else. Neither is
  three.js and neither is a scene. A fresh copy of the checks was the
  alternative and `validate.ts`'s own docstring already refused a third copy of
  them once, on the grounds that the copy that drifts is always the one whose
  error message no test asserts. So the split cost is a file that would travel
  unchanged rather than code that would have to be rewritten, which is the thing
  the no-dependency instruction was protecting.
  **WHAT IS DELIBERATELY NOT HERE.** No animation loop, because a spring step is
  a pure function of a delta and the clock belongs to whoever owns the frame;
  `render.md` already said M4.6 was the task that should start one and now says
  M4.7 is. No settled predicate, because the consumer that needs "this spring
  has finished" is M4.7's removal case and it does not exist yet, and a
  tolerance pair invented before its caller is a guess. No damping ratio, since
  a ratio a caller can set to 1.0001 is a ratio a caller can set to 1.0001 by
  accident, and an under-damped spring needs a second closed form rather than a
  second argument.
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
  This baseline cannot participate in M0.2's bench gate, and that is
  intentional rather than an oversight: the quality bar at the top of this file
  asks for benchmarks within 10% of baseline, and a GPU frame time measured by
  hand in a browser has no automated way to be re-measured, even on the
  baseline machine. Say how a regression is caught instead. The strongest
  option, if the pass breakdown supports it, is to bench the CPU-side passes
  (instance update, buffer upload) under the M0.2 gate and keep only the draw
  passes local, which puts most of the number back under an automated check.
  Otherwise commit to re-measuring by hand at the end of the milestone and
  again at M5.4's v0.1 readiness review.
  THE FREE VERTEX BUFFER SLOT IS STILL FREE, recorded here because D3 was the
  first task since M4.3 to add a per-vertex channel and the obvious reading is
  that it spent it. It did not: `maxVertexBuffers` is a PIPELINE limit, the
  reserved slot is the instanced NODE pipeline's seventh of eight, and D3's
  highlight is an attribute on the RIBBON mesh, which is a different material
  and a different pipeline. That one went from five of eight to six. So M4.6's
  spring velocity and M4.8's picking id are still competing for one slot with
  each other and with the two ordinary scene changes M4.3's record names (a
  material that comes to read `uv`, and a light or environment map that pulls in
  the `normal` the quad already carries). What D3 does add to this task's
  measurement is a second per-fragment multiply on every ribbon and a per-vertex
  one on every ribbon vertex, which at the campaign's 7,100 routes is the cost
  worth a line in the pass breakdown rather than a guess here.

The last two tasks were added on 2026-08-14, after the milestone was planned,
on the maintainer's reading of the campaign demo plan. They are numbered after
M4.10 and sequenced outside it: they block nothing in M4 and nothing in M4
blocks them, since the overlay needs a camera (M4.1) and a parent element and
the rich-node layer needs a box per node, which a caller supplies from wherever
it has one. They are also the milestone's answer to a gap the roadmap never
had a task for. `@dagr/render` has no text and no glyph pipeline is scheduled,
so a graph it draws cannot say what any of its nodes are. The design is
`specs/2026-08-14-html-overlay-design.md`, and both entries below record what
it settled rather than restating the argument.

- [x] **M4.11** (`@dagr/render`, `apps/demo`) The HTML overlay: a layer of DOM
  elements positioned in world coordinates over the canvas, transformed by
  `Camera2D`, culled against `visibleWorldBounds()` and capped. The analogue is
  react-konva-utils' `Html`, which portals a div and syncs its CSS transform to
  the Konva stage transform; this one answers to a `Camera2D` and carries no
  React. Demo consumer: labels on M4.2's crispness ladder, which is the scene
  the demo has until M4.4 gives it a laid-out graph, with the label tier's own
  screenshot committed rather than deferred to M4.12's three-tier one, because
  the `apps/demo` tag on this line is what the M4 header means by a task that
  lands a scene. (Those two frames were REPLACED by M4.12's a day later, when
  the demo they showed stopped existing. Nothing about this task's claims went
  with them: they showed the label tier and the counter-scale, and M4.12's show
  the same two things with a third tier in the frame.)
  DECIDED IN THE SPEC, and these are the ones later tasks inherit rather than
  re-argue. IT LIVES IN `@dagr/render` and is exported from it. M4.6 NAMED that
  option for the spring integrator to keep a choice open rather than to settle
  one, and its call is still open; this task takes the option first, on the
  argument M4.6 wrote down: an internal module with no dependency on the rest of
  the package, split into its own package when a second consumer exists. The
  cost is that the overlay's consumer installs `three` to satisfy this package's
  peer even if it never calls `createRenderer`. The escape hatch, if somebody
  asks, is a `@dagr/render/overlay` subpath whose module graph has no three.js
  in it PLUS `peerDependenciesMeta.three.optional`, because the subpath alone
  keeps three out of the bundle and leaves the install demanding it.
  TWO NESTED DIVS, ONE OF THEM TRANSFORMED. The outer clips (`overflow:
  hidden`) and the inner carries `translate(X, Y) scale(z)` with
  `transform-origin: 0 0`. The layer cannot clip itself, because clipping
  applies in its own scaled space, so its clip rectangle would grow with the
  zoom. Every entry element is `position: absolute; left: 0; top: 0` and the
  overlay sets that itself, since a static element sits in normal flow and its
  translate would then offset from wherever the flow put it. The parent has to
  be positioned, and the overlay throws `OverlayParentError` naming the fix
  rather than setting `position: relative` on an element it does not own.
  `errors.ts` GROWS THE BASE IT SAID IT OWED: that file records that a second
  member is when it grows one, and this task brings two (`OverlayParentError`,
  and `OverlayDisposedError` for `add()` after dispose), so `DagrRenderError`
  arrives with an abstract `code` like the sibling packages have, and
  `RendererDisposedError` keeps its name and message under it.
  ENTRY TRANSFORMS DO NOT DEPEND ON THE CAMERA. An entry is placed with its own
  `transform: translate(u px, v px)` in coordinates measured from the layer
  origin, so a pan is ONE style write on ONE element and entry transforms are
  rewritten only when an entry appears, when its placement changes, or on a
  rebase. `left` and `top` stay at zero: `transform` is a compositor property
  and `left` is a layout property, so per-frame `left` writes on 200 elements
  would be 200 layout invalidations.
  THE LAYER ORIGIN IS REBASED to the centre of the visible bounds whenever it
  falls outside them. Compositor transforms are single precision, and at zoom
  100 over a 100,000 unit graph an absolute offset reaches 1e7 CSS pixels
  against float32's ~1.7e7 of integer resolution, which is cards jittering
  against the shapes they label. Rebasing bounds every number in the composed
  matrix by roughly the viewport, and costs a rewrite of the visible entries at
  most once per viewport-worth of pan.
  PLACEMENT IS A DISCRIMINATED UNION, on `ShapeDescriptor`'s argument and
  `readonly` throughout, since the overlay caches what it computed from one: a
  point (with an anchor) or a box (with the screen width gate). A box scales
  with the zoom by definition, so it has no screen mode; a point has no extent,
  so the size gate is unwritable on it AND a point is always screen-scaled,
  because a world-scaled point would grow with the zoom with nothing able to
  gate it (the gate needs an extent, and the only extent it has is the authored
  size of its own DOM, which `sync()` may not read). Content that should grow
  with the graph has an extent, and an extent is a box. The anchor is its own
  type with `across` and `down` rather than a `Vec2`, on the `WorldBounds`
  argument: it is a y-DOWN unit fraction and `Vec2` is a y-up world point.
  THE GATE IS HALF-OPEN, `min <= width * zoom < max`, so two tiers sharing a
  threshold never both show and never both hide without either knowing the
  other exists. THE CAP (default 200 elements) is not a tuning knob: a
  degenerate zoom qualifies every label at once, and a hundred thousand
  elements is a locked-up tab where a hundred thousand instanced quads is a
  frame. Survivors are ranked by distance from the viewport centre, ties by
  registration order, so the picture does not depend on iteration order.
  `sync()` IS CALLED FROM THE DRAW PATH, never from its own
  `requestAnimationFrame`: a second loop is a second frame budget and a frame
  of skew, which reads as the labels swimming over the graph during a pan. It
  writes styles and reads no layout, which is what keeps it off the forced
  reflow path and is a property to preserve rather than an accident. It is also
  a NO-OP after dispose, which is a knowing divergence from
  `RendererDisposedError` being thrown from every renderer method: `sync()` is
  the one method the platform calls, from inside a frame callback where a throw
  reaches the global error handler and not the caller's `catch`. `add()` after
  dispose does throw, on the original argument.
  TESTING MOVES THE M4.1 LINE, and the move is the point. That line is "pure
  modules in Node, a screenshot for anything needing a device"; a DOM is
  available in Node where a GPU adapter is not. So the arithmetic AND the CSS
  strings it produces are computed in a pure module and tested there (the M4.2
  lesson: run the expression the browser runs, not a copy of it), and the
  wiring is tested against jsdom for element counts, eviction, `create` and
  `release`, and dispose. THIS IS THE WORKSPACE'S FIRST DOM TEST DEPENDENCY: no
  package had jsdom or happy-dom, and `@dagr/render` had no vitest config and
  ran in bare Node, so this task adds `jsdom` as a devDependency and selects it
  for the one DOM test file through the per-file `@vitest-environment` docblock,
  leaving the package's other suites in Node. jsdom over happy-dom because the
  four behaviours the tests stand on were checked in jsdom 30 rather than
  assumed (`style.transform` round-trips verbatim, `pointer-events` survives
  `setProperty`, `getComputedStyle().position` resolves an inline value and
  reports `static` without one, `remove()` detaches), and because `@dagr/react`
  will want the same implementation at M5.1. IT DID: M5.1 selects jsdom the same
  way, per file through the docblock, for all three of its DOM suites. What stays untested is that a
  browser composes the two transforms the way the algebra says and that the
  float32 argument above is quantitatively right; both are listed with the rest
  of the package's untested surface on `docs/docs/render.md`.
  SHIPPED, and three things the task learned that were not in the plan. THE
  LAYER PUBLISHES `--dagr-overlay-zoom` AND `--dagr-overlay-inv-zoom`, unitless,
  whenever the zoom changes. The three-tier zoom runs straight into a label
  wanting to be GATED by its node's size on screen (which needs a box) and
  DRAWN at a constant size (which is what a point does), and the union has no
  member for a box that does not scale, because such a thing is not a world
  rectangle. A custom
  property splits the two cleanly: the entry stays a box and a descendant writes
  `transform: scale(var(--dagr-overlay-inv-zoom))`, so the browser does the
  arithmetic and no JavaScript touches a font size per frame. The demo's two
  committed frames are that claim: the same tag at the same pixel size while its
  box grows from 40 CSS pixels to 1000.
  CSS HAS NO EXPONENTIAL NOTATION, and a declaration containing `1e-7` is
  DROPPED by the parser rather than clamped, so an element keeps its old
  transform and one label silently stops following the camera. `String()`
  switches to exponent form below 1e-6 and at or above 1e21, and a fixed decimal
  count is not the fix either: four decimals turns a zoom of 1e-5 into
  `scale(0)`, a singular matrix that collapses the layer, including the
  screen-scaled entries that were the only readable thing left. So numbers are
  formatted to seven significant digits with the fraction count chosen per
  value, and the large end goes through `BigInt`, which is exact because every
  double at or above 1e21 is an integer. Both ends are tested.
  THE SCREENSHOTS WERE CAPTURED THROUGH THE WEBGL2 FALLBACK. Headless Chromium
  on this box has no `navigator.gpu` at all and swiftshader gives it WebGL2, so
  three's automatic fallback is what drew the committed frames. That is a fact
  about the capture and about M4.9's eventual parity check, not about the
  overlay, which never touches a GPU.
- [x] **M4.12** (`@dagr/render`, `apps/demo`) Rich nodes: a node's visual as
  arbitrary HTML sized to its layout box, with the campaign plan's three-tier
  semantic zoom (instanced shape below ~24 CSS px, title label to ~160 px, full
  card above) as library policy rather than demo code. Demo consumer: cards on
  the ladder, one per shape, and the committed screenshot is the three tiers at
  three zooms.
  TIERS ARE GATES AND NOT A THIRD CONCEPT. A node registers one entry per tier,
  same bounds, adjacent half-open gates, so at most one is ever active and the
  bottom tier is the absence of an entry, which is the GPU drawing the shape.
  The layer over that is bookkeeping: `create()` returns a blank element and
  `update(element, node)` fills it in, which is the split that lets a tier pool
  its elements instead of building a subtree per pop-in, and `setNodes` diffs
  by id so a relayout moves boxes without rebuilding anything. A node whose
  `data` is not the same REFERENCE as last time gets `update` called on it if it
  has an element, which is reference equality rather than a deep comparison
  because a deep comparison of arbitrary card data is neither cheap nor
  decidable, and it makes mutating `data` in place a no-op the same way every
  other one-way data flow in this project does.
  MEASUREMENT: BOTH, AND THE DEFAULT IS TO DECLARE. `LayoutConfig.nodeSize` is
  called once per node during prepare and stays on the main thread even in
  M2.10's worker mode, so a DOM measurement CAN feed layout. It should when the
  content is authored per node and its size is a fact about the text; it should
  not when the content is templated per kind, where the size is known by
  construction and 2,800 offscreen mounts at startup buy nothing. The opt-in
  helper batches (mount all, then read all) because interleaving a mount and a
  read per node forces a layout flush per node, and it names no `@dagr/graph`
  type, so this package does not grow a dependency on the graph model. Three
  details it carries rather than leaves to be discovered: its `parent` is
  REQUIRED, because inherited font and custom properties decide the answer and a
  card measured under the page's styles and drawn under the overlay's is
  measured wrong silently; a wrapping card needs the width it will finally have,
  passed per item; and a web font that has not loaded measures in the fallback
  face, so a caller using one awaits `document.fonts.ready` first, the helper
  staying synchronous because `nodeSize` is.
  ALSO HERE, from the direction plan: a written recommendation on in-canvas
  text (an MSDF atlas) for the label tier at M4.10 scale, spike only, with the
  element count where the DOM label tier stops being honest measured rather than
  reasoned about. MEASURED, in `bench/browser/`, which is a browser harness and
  deliberately NOT part of `bench:ci` for the reason M4.10 already gives about
  GPU frame times. Not on the demo page, which has six shapes and cannot make a
  thousand labels: the harness runs the library's own modules with the demo's
  label markup. THE OVERLAY'S OWN WORK IS NOT WHAT RUNS OUT (`sync` is 0.2 to
  0.6 ms at a thousand elements) AND NEITHER IS HOLDING THE ELEMENTS (744 of
  them with a still camera hold 60 fps). What costs is repainting text under a
  MOVING transform, about 0.2 ms per element per frame on this box, and
  promoting the layer removes most of it: 357 elements go from 83.3 ms to 16.7,
  at the price of text that softens under a zoom, which is why the overlay
  refuses to set `will-change` for a caller and now says what setting it buys.
  The other bound is legibility and it is arithmetic: a 100 by 18 CSS pixel
  label tiles a 1200 by 800 viewport 530 times with no gaps, so a readable scene
  shows one or two hundred, which is the same order as where the frame budget
  goes and is what makes the default cap of 200 a number rather than a guess. The card tier is HTML by nature and should
  stay DOM; the label tier is one line per node, which is what an atlas does
  well, and an atlas takes the tier over by taking its gate over.
  SHIPPED, and three things worth carrying forward. WHAT THE TIERS COST is
  entries scaling with tiers times nodes: the overlay's per-frame cull tests
  every entry, so a 2,800 node campaign over three tiers scans 8,400 candidates
  a frame rather than 2,800, each a few comparisons with no allocation. What
  does NOT triple is what reaches the cap or the DOM, because the gates are
  disjoint, and `createRichNodes` rejects overlapping gates rather than trusting
  a caller with the invariant the cap depends on. The alternative, one entry per
  node with tier selection inside the overlay, saves that scan and buys a
  level-of-detail concept every consumer pays for; if the scan ever matters the
  fix is a spatial index in `sync`, which helps both shapes equally.
  THE POOL DEPENDS ON AN
  ORDERING M4.11 ONLY IMPLIES: one sync detaches everything that left the view
  BEFORE it creates anything that entered, so an element released this frame is
  already back in its pool when the next entry asks for one. Reverse those two
  passes in `html-overlay.ts` and pooling silently stops working, with nothing
  failing except an allocation count nobody is watching. It is asserted in
  `test/rich-nodes.test.ts` by panning one node out and another in on the same
  sync and checking that `create` ran once.
  A LAYOUT LENGTH ON A COUNTER-SCALED ELEMENT IS STILL IN WORLD UNITS, which
  cost this task a frame to find: the demo's card used `margin: 0.5rem` for its
  inset and landed 800 CSS pixels away at zoom 100, because margin is applied
  before the element's own transform. An inset composed INTO the transform after
  the counter-scale is 8 CSS pixels at every zoom. Padding and borders inside
  the scaled element are fine, since they are inside something already scaled
  back. The demo's stylesheet carries that as a comment, and it is the first
  thing to check when overlay content is in the wrong place by a factor of the
  zoom.
  The three tiers are one committed frame: at zoom 4 the 4 unit circle is 16 CSS
  pixels and carries nothing, the 10 unit rect is 40 and carries a tag, and the
  100 unit rect is 400 and carries a card. The M4.11 label-only frames were
  replaced rather than added to, since the demo they showed no longer exists and
  the M4 header caps what `assets/` may grow by.

## M5: React + demo = v0.1

- [x] **M5.0** Landing page and the muslin re-port. Touches `docs` only.
  Done out of milestone order on the maintainer's instruction (2026-08-14):
  the layout engine is worth showing before M5's components exist, and the
  docs site previously served the intro doc at the site root with no pitch,
  no visual, and no "why Dagr" anywhere.
  WHAT SHIPPED. A landing page at `/`, with the docs moved from `/` to
  `/docs` and `@docusaurus/plugin-client-redirects` covering the three doc
  URLs that existed before the move (the intro's old home is the root itself,
  which the landing page now owns, so it is not redirected). The hero image
  is output from the engine it advertises: `docs/scripts/generate-hero-graph.mjs`
  builds a 20 node DAG, runs `layout`, and commits coordinates and routes to
  `heroGraphData.json`, which the page draws inline so every color resolves
  from the theme tokens. Committed rather than generated during the docs
  build, because the Render deploy builds only the `docs` workspace and must
  not depend on the packages building first.
  A second figure carries the scale claim. It shipped as a committed SVG of
  the 1k bench corpus with a quoted median beside the machine that produced
  it, and was replaced two days later by a live demo; see the revision below.
  REVISED 2026-08-14, on the maintainer's reading of the merged page. Two
  changes, both about the same thing: a claim a visitor cannot check is worth
  less than a smaller one they can.
  The static figure is gone. `docs/src/components/LiveLayout/` generates the
  same corpus in the visitor's browser, lays it out with `@dagr/layout` in a
  web worker, draws the result, and reports the time it took on their machine,
  with controls for corpus size (250, 1,000, 2,500 nodes at the bench corpora's
  four edges per node) and spacing, and drag-to-pan and zoom over the drawing.
  The first run of a page is a warm-up and is not reported, which is the rule
  `bench/README.md` already states for a capture. Deleted with it:
  `generate-perf-graph.mjs`, `perfStats.json`, and `static/img/bench-1k-*.svg`.
  The hero figure and `generate-hero-graph.mjs` stay exactly as above, and are
  now also the no-JS story: with scripting off the demo hides its controls and
  says what it would have done, and the hero remains committed engine output on
  the same page.
  THE DEPLOY PROBLEM THIS CREATED, and the choice made. Render built only the
  `docs` workspace, so `@dagr/layout` had no `dist` at deploy time; that
  constraint is what made both figures committed output in the first place.
  `render.yaml` now runs `pnpm --filter docs... build`, which builds
  `@dagr/graph` and `@dagr/layout` first, and its `buildFilter` gained both
  package paths because the site ships their code now. The alternative,
  compiling the packages' TypeScript source into the docs bundle, was rejected:
  it would give the site a second build path for code that publishes from
  `dist`, and a demo built differently from what a consumer installs is a demo
  of something else.
  TWO THINGS THE DEMO NEEDED FROM THE BUNDLER, both invisible until the worker
  threw. Docusaurus sets `optimization.runtimeChunk: true`, which lifts each
  entrypoint's runtime into a separate file; a worker loads exactly one script,
  so its runtime has to ride in its own bundle. And Docusaurus's
  ChunkAssetPlugin adds a `__webpack_require__.gca` runtime module to every
  runtime chunk without declaring that it needs `__webpack_require__`, which
  every chunk the site loads happens to need anyway and a worker entrypoint
  does not. Both are handled by the `dagr-worker-runtime` plugin in
  `docusaurus.config.ts`. The symptom either way was a demo that said it was
  laying out, forever, because a worker that dies never answers and an
  unanswered run never settles, by design.
  The demo's corpus generator is a port of the bench kit's, since the bench kit
  is private and never built. `bench/test/docs-corpus-port.test.ts` runs both
  and fails when they disagree, so the 1k preset stays the graph the committed
  baseline gates on rather than merely a graph of the same size.
  The benchmark copy was rewritten at the same time. The merged page described
  the gate as comparing medians as ratios against a control workload; the
  maintainer, who wrote the harness, could not follow it. It now says that
  every change is benchmarked before it merges on one machine, against a
  baseline recorded on that same machine, and that a change which measurably
  slows the work down does not merge. Both halves of that sentence were
  rewritten once more after the oss-docs review: "against the numbers the
  change before it recorded" described a per-change baseline, which is the
  thing `bench/README.md` forbids, and "makes layout slower" ignored a
  tolerance the same file calls an effective floor nearer 15% than 10%. The
  detail stays in `bench/README.md`, where a
  reader who wants ratios and tolerances will look.
  ALSO DECIDED HERE: `docs/src/css/custom.css` was re-ported to muslin as it
  now stands, because the landing page was about to be the first consumer of
  a token set that had drifted three moves behind the design system it claims
  to mirror. The contrast ramp goes achromatic (the old green-tinted
  `--contrast-70pct` measured near 3:1 on white, which is what the file's
  `--dagr-text-muted` workaround compensated for; neutral, the same step
  clears AA with room), the primary family derives from one seed with a
  relative-color-syntax tier clamping lightness and chroma, radii go to zero
  with shape carried by the 45 degree corner cut, and the selvedge replaces
  the accent left-border on blockquotes. The port stays a port, not a
  dependency: `@muslin/ui` is a private workspace package whose stylesheet
  needs Tailwind to compile, and the docs site has no reason to grow either.
  The daybreak code palette in `docusaurus.config.ts` is untouched: code is
  the one place the docs are allowed to be colorful, and that decision
  predates this task.
  KNOWN AND ACCEPTED: the docs build's CSS minimizer warns on the
  relative-color-syntax `calc()` channels (`postcss-calc` cannot lex `l - 0.05`).
  Verified against the built output rather than assumed: the expressions
  survive minification verbatim, so the warnings are noise, not damage.
- [x] **M5.1** `@dagr/react`: `<DagrCanvas>` + `useDagr` hook, controlled
  graph prop, mocked-renderer component tests.
  ALSO LANDS `<Html>`, the React sugar over M4.11's overlay, and the reason it
  waits for this task rather than shipping with M4.11 is that it has to FIND
  the overlay. Either it takes one as a prop, which nobody would accept for a
  component used once per node, or it reads a context, and the context is
  `<DagrCanvas>`'s to provide. Shipping `<Html>` first would mean inventing
  that context in a package with no component to provide it, and then living
  with the shape when this task arrives with the requirements that should have
  decided it. The maintainer was asked on 2026-08-14 whether to reverse that
  and bootstrap the package early; until they do, `@dagr/react` stays empty.
  THE MAINTAINER NEVER ANSWERED AND THE QUESTION EXPIRED WITH THIS TASK: the
  package is no longer empty, so there is nothing left to bootstrap early. The
  ordering argument above held up exactly as written, and `canvas-context.ts`
  is the context it predicted, carrying the one field the prediction did not:
  the LAYOUT, without which `<Html node="a">` cannot know where node `a` is.
  A context of `{ renderer, overlay }` would have been smaller and would have
  forced every consumer to run the layout a second time to place a label, which
  is two answers that can disagree while an edit is in flight.
  CONTROLLED MEANS WATCHED, WHICH IS THE ONE DECISION EVERYTHING ELSE HANGS
  OFF. `Graph` is mutable, so a graph prop compared by identity would mean
  `graph.addNode(...)` changed nothing on screen until the caller also replaced
  the object. `Graph.subscribe` is already `useSyncExternalStore`'s subscribe
  to the character (a listener in, an unsubscribe out), so the hook watches the
  graph and an edit reaches the canvas whichever way it arrives. THE SNAPSHOT
  IS A COUNTER THIS PACKAGE KEEPS, because `Graph` exposes no O(1) mutation
  counter, and that leaves ONE window: React subscribes in an effect, effects
  run child first, so a CHILD's mount effect that edits the graph runs before
  the subscription exists and that edit is not drawn until the next one. Both
  ways of closing it from this side were measured against and rejected, and the
  reasons are opposite in kind. Bumping the counter inside `subscribe` makes
  the post-subscribe re-check ALWAYS differ, so every mount lays out twice.
  Subscribing during the first render, through a registry keyed on the graph,
  can never unsubscribe (the listener has to outlive the component to be there
  before the next one renders), so a graph that has ever been rendered builds a
  `Patch` on every mutation forever, which is precisely the cost `@dagr/graph`
  documents itself as not paying for a graph nobody subscribed to. QUEUED FOR
  `@dagr/graph`: an O(1) monotonic revision on the graph itself is a true
  snapshot and closes the window with no bookkeeping here at all.
  THE CONFIG IS COMPARED BY VALUE AND `nodeSize` CANNOT BE. `LayoutConfig` is
  the one prop a caller writes as an object literal in their JSX, so identity
  comparison would relayout the whole graph on every render of the surrounding
  application. The comparison names its five fields one at a time, because
  `defaultNodeSize` is an object literal too and a shallow compare gets it
  wrong. Naming fields means a field added upstream is silently not compared,
  so the file carries a type-level assertion that fails to compile the day
  `LayoutConfig` grows one. `nodeSize` is compared by identity because two
  functions that agree on every node are indistinguishable without calling them
  on every node, which is the work the comparison exists to avoid.
  A LAYOUT THAT FAILS IS REPORTED BY THE HOOK AND THROWN BY THE COMPONENT, and
  the split is deliberate. A graph a user is editing passes through states the
  layout refuses, so a hook that threw would unmount the subtree to the nearest
  boundary on the keystroke that made the graph momentarily invalid. It does
  not hold the last good result either: a stale picture presented as the
  current one is the failure mode hardest to notice. `<DagrCanvas>` throws it
  during render so a boundary catches it, unless an `onError` takes it, because
  the remaining option is an empty box and an empty box is indistinguishable
  from an empty graph.
  THE CAMERA IS FITTED ONCE. The first frame with both a layout and a viewport
  frames the graph and nothing refits after. Refitting per edit would be a
  camera that jumps whenever the graph changes, which is the instability all of
  M3 exists to keep out of the layout, reintroduced one level up where no
  stability metric would ever see it.
  `<Html>` INVERTS THE OVERLAY'S LIFECYCLE RATHER THAN WRAPPING IT. The
  component owns one host element for its whole life, `create` hands the
  overlay that same element every time, `release` does nothing, and the
  children reach it through a portal, so the overlay attaches and detaches an
  element whose contents React has been maintaining all along. THE COST IS THE
  CAP: the overlay's `create` is lazy so that 2,800 nodes build DOM for the few
  dozen on screen, and a portal is not lazy, so a culled `<Html>` still has its
  subtree mounted. THIS COMPONENT IS FOR THE TENS AND `createRichNodes` IS FOR
  THE THOUSANDS, which is now written on both. An entry is registered once and
  MOVED afterwards, never re-registered, because a re-register detaches and
  reattaches the element on every edit.
  THE SCENE CONVERSION IS EXPORTED, NOT HIDDEN. `@dagr/render` refuses to name
  a `LayoutResult` on the argument that the y flip belongs to whoever owns the
  layout, and this is the first package that owns both, so `scene.ts` is the
  flip and it is public: a caller driving the renderer directly wants the same
  three functions rather than writing it a fourth time. THE FLIP IS THREE
  SEPARATE EXPRESSIONS (nodes, route points, bounds) AND FLIPPING TWO OF THREE
  IS GREEN ON EVERY UNIT TEST OF THE TWO, so the suite runs a real layout
  through all three and asserts they agree.
  DEPENDENCY SHAPE, ON `@dagr/layout`'s OWN ARGUMENT: `@dagr/graph` and
  `@dagr/render` are PEER dependencies plus devDependencies, because both put a
  class with `#private` fields on this package's surface (`Graph`, and
  `Camera2D` through `Renderer.camera`) and a nominal type has to be the same
  copy. `@dagr/layout` is a plain dependency: everything it puts on the surface
  is a structural interface, and a consumer who wants a canvas should not have
  to install the layout engine to get one. M5.4's pack-and-check list is where
  that gets verified against a real tarball.
  THE TEST HARNESS IS FORTY LINES OF `react-dom/client` AND `act`, WITH NO
  TESTING LIBRARY, and three non-test helpers beside it: `mount.tsx`,
  `frames.ts` (a hand-driven `requestAnimationFrame`, so "has it drawn yet" is
  an event the test causes rather than a race against jsdom's timer) and
  `resize.ts` (jsdom has no `ResizeObserver` and lays every element out at zero
  by zero, so both halves of "the canvas got bigger" are supplied). The one
  class component in the package is the error boundary in `mount.tsx`: a root's
  `onUncaughtError` is not a substitute, because React reports through it AND
  rethrows out of the `act` that caused the render.
  WHAT THE MOCK CANNOT SEE IS ASSERTED DIRECTLY. A faked renderer cannot refuse
  a static overlay parent or a zero viewport, so the two places this package
  has to hold up its end of those contracts are pinned by their own tests: the
  container carries `position: relative`, and a container measuring zero by
  zero is never passed to `resize`.
- [ ] **M5.2** Interaction hooks: `useSelection`, hover and drag wiring to
  GPU picking. Component tests.
- [ ] **M5.3** Demo app: animated living demo (grow/prune/relayout
  scenarios) in `apps/demo`, deployed-ready build.
  THIS IS THE TASK THAT DEMONSTRATES THE HEADLINE CLAIM, and nothing shipped
  does. The campaign demo is read-only: `apps/demo/src/App.tsx` never mutates a
  graph, so it proves scale, rendering and semantic zoom, and proves nothing at
  all about layout staying stable under an edit — which is what M6's preamble
  says the project competes on. A visitor currently cannot see the flagship
  feature. Weight this accordingly against M5.1 and M5.2.
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
- [x] **M5.5** Reserve containment in the graph model: `readonly parent?: NodeId`
  on `Node` and on `NodeJSON`, an `update-node-parent` patch op, the invariants
  (a node has at most one parent, containment is acyclic, an edge may cross a
  boundary), and traversal coverage. `@dagr/layout` IGNORES `parent` in this
  task — the point is the model, not the layout.
  LANDS BEFORE M5.4 QUEUES THE PUBLISH. The api-design review of 2026-08-18
  corrected the reason, and the corrected reason is the one that matters. The
  field on `Node` is NOT the urgent part: it is optional and readonly, `Node` is
  only ever produced by `Graph` and never structurally implemented by a
  consumer, so adding it later is additive for readers. Two other surfaces
  genuinely cannot move after v0.1:
  - `PatchOp` is a discriminated union (`packages/graph/src/patch.ts`). A new
    member breaks every exhaustive `switch` a consumer wrote with a `never`
    arm. Do the cheaper general fix at the same time: DOCUMENT `PatchOp` AS AN
    OPEN UNION, with a default arm required of consumers. That removes the
    pressure for every future op rather than for this one. Note what it does
    NOT do: an open union is a convention, not enforcement, and a consumer's
    `never` exhaustiveness check still breaks. The doc has to tell consumers to
    write `default:` rather than assert exhaustiveness, and that is the whole
    mechanism. It works here only because `update-node-parent` lands before
    v0.1, so no consumer has written the check yet.
  - `GraphJSON.version` is the literal `1`
    (`packages/graph/src/serialize.ts`). `parseGraphJSON` ignores unknown keys
    by design, so a document carrying `parent` read by a build without
    containment loses it silently rather than refusing — exactly the misread
    `version` exists to prevent. Because this lands before v0.1 publishes, no
    such reader will ever exist and `version` correctly STAYS `1`. Say so here
    so nobody bumps it later out of caution.
  ONE GRAPH, NOT NESTED GRAPHS. Containment is a reference on a node, not a
  child `Graph` instance. This is settled here rather than in M6.4 because the
  two models are not interchangeable: every `PatchOp` is scoped to a single
  graph and `batch` is per-`Graph`, so with nested instances a child's edits
  never reach a root subscriber and M6.5's boundary rebinding would span two
  patch streams with no atomicity. The flat model keeps one patch stream, keeps
  the graph → layout → deltas → render direction one-way, and is what makes
  M6.5's claim to be a consumer of M3.3 and M3.6 true rather than aspirational.
  DECISIONS THE TASK MUST NAME, or an implementer picks one silently:
  - `apply` replays `add-node` through `graph.addNode`, so a parent must be
    replayed before its children. Containment adds a node ordering constraint
    that patches do not have today.
  - `removeNode` is cascade-free by expansion for incident edges: it emits a
    `remove-edge` op per incident edge. Containment takes the SAME answer —
    emit a `remove-node` op per child — because it is the one consistent with
    the rest of the model and it lets `invert` restore in order. "Refuse" was
    the other candidate and is rejected: it would make `removeNode` partial in
    a way nothing else in the API is.
    THESE TWO BULLETS ARE ONE DECISION, not two constraints to satisfy
    separately. Emitting the children DEPTH-FIRST POST-ORDER (children before
    their parent) makes `invert` produce `add-node` for the parent before
    `add-node` for each child, which IS the replay ordering the bullet above
    requires. Get the removal order right and the replay order falls out; get
    it wrong and the two fight.
  - `update-node-parent` gets an explicit case in `influenceRegion`
    (`packages/layout/src/influence.ts`) and in `checkPatchApplied`
    (`packages/layout/src/engine.ts`). Both have a `default: break`, so a new
    op is silently swallowed with no compile error and the influence region for
    a reparent becomes whatever the other ops in the patch happened to widen.
    A documented no-op case is fine; an implicit one is a wrong narrow bound
    the moment M7 reads `parent`.
  This is not a bet that nesting is wanted — M6.4 and M7 decide that. It is the
  cheap half of an option whose expensive half is a coordinated release.
  SHIPPED. `Node.parent`, `NodeInit.parent`, `graph.setNodeParent(id, parent)`,
  `graph.children(id)`, the `update-node-parent` op, `ContainmentCycleError`,
  and `NodeJSON.parent`, with 35 tests in
  `packages/graph/test/graph.containment.test.ts` written before the
  implementation. `@dagr/layout` gained the two explicit cases below and no
  reading of `parent` at all.
  THE THREE RULES ARE ONE FIELD AND ONE WALK. At most one parent is the field
  being a field. Acyclicity is a walk UP from the proposed parent, which is
  O(depth) rather than O(subtree) because a node has one parent and many
  children, and it terminates because the relation it is checking is a forest.
  An edge crossing a boundary needed no code, which is the point: containment
  and adjacency are separate relations and nothing derives one from the other.
  A `#children` index is carried beside the record for the one direction the
  record cannot answer, since `removeNode` has to know what a node contains and
  a pass over the roster per removal is not a cost this model pays anywhere
  else. `children` sorts it by insertion rank, the rule `successors` follows,
  so a listing never depends on the order the containment was declared in.
  THE CHILDREN INDEX IS LAZY, AND THAT IS A MEASUREMENT RATHER THAN A TASTE.
  Every other per-node index here is present for every node, because every node
  uses one; a graph that never nests anything would have paid an empty `Set` per
  `addNode` for a relation it never asked for, worth about 4% on the 1k-node,
  4k-edge build in an interleaved A/B against the version before this task. The
  entry is created on a node's first child and dropped again when its last child
  leaves, so a graph that used containment and stopped costs what one that never
  used it costs, and an absent entry means "contains nothing" rather than "not a
  node", which moves the presence question onto the node map.
  `setNodeParent` RATHER THAN `updateNodeParent`, against the op's own name.
  Every `update` on this class merges a patch into a bag and leaves what the
  patch does not name alone; this replaces one field, and `undefined` is a value
  rather than a request to leave it alone. The op keeps `update-node-parent`
  because an op names the kind of change and every changed-field op in the
  format is spelled that way. The mismatch is deliberate and documented on both
  sides.
  THE TWO ORDERING BULLETS ARE ONE DECISION AND THE ENTRY WAS RIGHT ABOUT IT.
  `removeNode` emits its subtree depth-first post-order, and reversing that is
  already the order `apply` needs, so `invert` sorts nothing and `apply` sorts
  nothing. What the entry did NOT anticipate is that the SAME constraint reaches
  serialization and cannot be paid the same way: a document's `nodes` array is
  in insertion order, and a node reparented long after it was added is written
  BEFORE the parent it names. So `fromJSON` reads `nodes` in two passes, adding
  every node and then setting every parent. One pass would refuse a document
  this package itself wrote, and sorting the nodes into containment order would
  restore a graph whose iteration order is not the one that was written, which
  the format promises. GENERALISE IT: an ordering constraint on a REPLAY is
  payable by emitting in the right order; the same constraint on a DOCUMENT is
  not, because the document's order is already promised to something else.
  THE FORWARD REFERENCE IS NOT A CORNER CASE, MEASURED RATHER THAN ASSUMED. Both
  property suites gained a reparent command, and over the serialization suite's
  200 random documents 58 nodes were written with a parent and 26 of those named
  a parent the document had not written yet. A one-pass reader would have
  refused one document in eight of the ones that use containment at all. The
  patch suite's four properties (replay, invert, unwind to empty, invert twice)
  hold over 160 reparents and 25 removals that took a contained node with them,
  which is the ordering rule above checked by something other than the case that
  was written for it.
  A TWELFTH ERROR, WHICH IS A THIRD SURFACE OF THE KIND THIS TASK EXISTS TO MOVE
  EARLY. The entry named `PatchOp` and `GraphJSON.version`; `DagrGraphErrorCode`
  is the same shape of commitment, since adding a code breaks an exhaustive
  switch exactly as adding an op does, and it grew here rather than being
  avoided by reusing `CycleError`. Reuse was rejected on the reading side: the
  two relations are different, a caller catching one has no way to ask which it
  got, and `CycleError`'s "consecutive entries are joined by an edge" would have
  become false of half its instances.
  `update-node-parent` SPELLS BOTH KEYS PRESENT, which is the opposite of how
  the record and the add and remove ops spell the same field, and the asymmetry
  is between a state and a transition. A record says what a node IS and an
  absent key is the cleanest way to say it has no parent. The op says what
  MOVED, and both ends of a move have to be nameable, or "was a root" and "did
  not say" are spelled the same and every consumer tests `'before' in op` before
  believing the value.
  `PatchOp` IS DOCUMENTED AS AN OPEN UNION, in its own docstring and on the docs
  page, and the note says what the convention does NOT do: a `default:` arm
  keeps a consumer compiling and running across a version that adds an op, and a
  `never` arm still breaks the day one lands. It works here only because this is
  pre-v0.1, so the convention lands before the first consumer who could be
  broken by it. The package's own `invert` and `apply` stay exhaustive on
  purpose, so a new op cannot be added without teaching both.
  `GraphJSON.version` STAYS 1 AND THE FORMAT'S OWN RULE SAYS WHY IT COULD NOT
  HAVE, which is the contradiction worth writing down rather than leaving for a
  reader to find: the version field's section already said an additive field a
  version 1 reader would silently drop is a version bump. It is, when such a
  reader exists. Containment landed before the first published release, so one
  never will, and the rule is about readers that exist rather than about the
  shape of the change. The next additive field does not get the same answer.
  THE TWO `@dagr/layout` CASES ARE NOT THE SAME KIND OF CASE. `influenceRegion`
  takes the documented no-op the entry allowed, and empty is EXACT rather than
  optimistic: no stage reads `parent`, so the drawing after a reparent is the
  drawing before it, coordinate for coordinate. `checkPatchApplied` takes more
  than a no-op, because that function exists to catch a caller who hands over a
  patch expecting the engine to apply it, and a patch of nothing but reparents
  was the one edit that could pass through it in silence. It now reads the claim
  the op does make, under the same last-op-wins rule as the presence checks, so
  a node the patch ends by removing is checked as removed and not as reparented.
  WHAT M6.4 AND M7 INHERIT. The model, settled, plus a `children` listing whose
  order is a promise. M7 is where `influenceRegion`'s empty case stops being
  exact: on the day a parent is drawn around its children, a reparent moves the
  drawing, and that case becomes a wrong narrow bound rather than a documented
  no-op. It is written out rather than folded into the `default` arm for exactly
  that reason, so the task that changes it finds a case rather than a silence.

## M6: VDSL = v0.2 (`@dagr/vdsl`)

Task breakdown is finalised when M5 completes. The scope below replaces the
original four-line sketch after a 2026-08-18 review of what the toolkit is
actually for; the reasoning is recorded here because it changes what M6 is
allowed to define.

WHAT `@dagr/vdsl` IS. A toolkit for building a node-graph language, not a
node-graph language. The distinction is the whole design: general-purpose
visual *languages* have a long failure record (Prograph, the 80s and 90s VPL
wave), while toolkits that let someone else build a domain-specific one have a
good one — React Flow, Rete, Baklava, NodeGraphQt, imgui-node-editor, and most
instructively LiteGraph.js, whose modest node-editor library is the substrate
ComfyUI was built on. The toolkit never needed to guess the domain. It needed
to be good enough that someone else's domain could land on it.

WHAT IT MUST NOT DEFINE: an ontology. No built-in node kinds, no opinion about
what a "source" or a "transform" is, no config schema format of Dagr's
invention. A consumer brings its own node spec and Dagr validates against it
through an adapter interface. The moment `@dagr/vdsl` decides what a node kind
is, every adopter with a different answer is fighting the library, and the
library has no way to know which of them is right. This reverses the original
M6.1 wording ("node-type schemas"), which read as Dagr owning the schema.

WHAT DAGR COMPETES ON, and it is not this milestone. Drag-to-connect, handles,
minimaps and rich DOM nodes are solved, and solved well, by incumbents. What is
not solved anywhere is a graph that stays legible when it changes: dagre and
ELK are batch engines, neither preserves prior positions across an edit, and
the common answer is to re-run layout and accept a reshuffle. M3.4 to M3.7
is Dagr's answer to that, and it is the claim the project should lead with.
M6 is the demonstration of the claim, not the claim.

TWO CONSUMERS, NOT ONE. M6.6 exists because a toolkit validated against a
single consumer is a library with extra indirection: the one consumer's
assumptions become the API and nobody notices until the second arrives. Two
consumers with genuinely different shapes is the cheapest available test of
whether the generalisation holds.

- [x] **M6.1** Node spec adapter: the interface a consumer implements to
  describe its own node kinds (ports, arity, config shape), and the registry
  that resolves a node to a spec. Dagr defines the interface and nothing
  behind it.
  NOT an `attrs -> spec` predicate. `attrs` is `Readonly<Partial<A>>`, so
  `attrs.kind` is `string | undefined` and the consumer's kind union is erased
  at the boundary — every hover and drag callback downstream lands on `any` or
  a cast, which defeats the point of a typed toolkit. Ship
  `defineRegistry({ ... })` keyed on `K extends string`, inferred once from the
  object literal and threaded through as `NodeSpec<K>`.
  Packaging: `@dagr/vdsl` declares `@dagr/graph`, `@dagr/react` and `react` as
  peerDependencies plus devDependencies, for the same `#private` nominal-typing
  reason M5.4 records for `@dagr/layout`. Two copies of `@dagr/graph` in a
  consumer's tree are not interchangeable.
  SHIPPED as `packages/vdsl`, a new package: `src/types.ts` (`PortSpec`,
  `NodeSpec`, `NodeSpecInit`, `ConfigCheck`, `RegistryOptions`, `KindNodeInit`,
  `NodeRegistry`), `src/registry.ts` (`DEFAULT_KIND_KEY`, `defineRegistry` and
  the `Registry` class behind it), `src/errors.ts` (`DagrVdslError` and three
  members), 50 tests across four files, a `CHANGELOG.md`, and
  `docs/docs/vdsl.md` at sidebar position 7. Two prose edits outside the
  package, both of them a document that said this package does not exist: the
  Status section of `docs/docs/visual-languages.md`, and the `@dagr/vdsl` row
  of README.md's package table, which read "Planned (v0.2)". The README row is
  the tree pass's find, and it is the same amend-your-own-row rule PR #57 and
  PR #59 are each following on their own package's row.
  TAKEN THREE MILESTONES OUT OF ORDER, AND THE REASON IS THE PILE RATHER THAN
  THE TASK. Eight pull requests were open on one blocker when this run started,
  main had not moved since 2026-08-18, and every unchecked task in milestone
  order reads a file some open branch is rewriting: M3.7 IS #53, M3.8 stacks on
  it, M4.7 drives M4.6's springs and those are on #57, M5.3 needs both #59 and
  #57. This is the one unchecked task whose dependencies are entirely merged on
  main and whose files NO open PR touches, so it merges in any order with the
  eight and imposes a conflict on none of them. That is a property of the
  pile's shape and not an argument that M6 is ready, and the milestone preamble
  still says the breakdown is finalised when M5 completes.
  THE PACKAGING NOTE ABOVE IS RIGHT AND ITS REASON IS NOT TRUE YET. The
  `#private` nominal-typing argument is about `Graph`, and M6.1 does not put
  `Graph` on its surface: it takes `Node<A>` and returns `NodeInit<A>`, both
  interfaces, both structurally typed, both interchangeable between two copies
  of `@dagr/graph`. The argument becomes load-bearing at M6.2, whose own entry
  names `graph.canReach` and therefore puts a `Graph` in a parameter position.
  The peer is declared NOW anyway, because the alternative is changing a
  dependency's kind between two 0.x tasks for a reason nobody reading the diff
  would recognise. Every import in this package is `import type`, so with
  `verbatimModuleSyntax` the built JavaScript imports `@dagr/graph` not at all.
  `@dagr/react` AND `react` ARE NOT DECLARED, AND THAT IS THE SAME RULE POINTED
  THE OTHER WAY. Nothing here imports either, and M6.3 is the first task that
  will. A peer dependency declared ahead of an import makes every consumer of a
  headless registry install React to silence a warning about a dependency the
  package does not use. M6.3 adds them, and the note above is where it will
  look.
  ARITY IS A CAP AND NOT A WORD. `PortSpec.maxEdges`, absent meaning unbounded.
  The usual `'single' | 'multiple'` is the two useful values of a number, so a
  number loses nothing, and a union declared here is a union every consumer's
  exhaustive `switch` breaks on when a third case arrives, which is the hazard
  M5.5's entry plans to document `PatchOp` as an open union to escape. Absent
  rather than `Infinity` because `Infinity` does not survive `JSON.stringify`
  and a spec a consumer cannot serialise is a spec they cannot ship a fixture
  of. ENFORCEMENT IS M6.2's: a spec says what the rule is, and a proposed
  connection is where the rule is met. What this task does is refuse a value
  M6.2 could not act on, so the number M6.2 reads is a positive integer or
  nothing.
  VALIDATION IS AT DEFINE TIME. An empty kind, an empty port id, a port id
  declared twice in one kind, and a `maxEdges` that is not a positive integer
  all throw out of `defineRegistry`. A registry is built once from a literal,
  usually at module scope, so a bad spec is a bug in the consumer's source
  rather than in their data, and the run that finds it should be the one that
  loads the module. The same port id in two DIFFERENT kinds is allowed and
  tested: port ids are unique within a node and not across a graph, and two
  kinds that could not share a port vocabulary would be a rule the graph model
  does not have.
  THE CAST IS ONE, AND IT IS INSIDE. The entry's own argument is that reading
  `attrs.kind` erases the kind union, and reading it is still what has to
  happen: the registry does it once, in `attrsOf`, widening
  `Readonly<Partial<A>>` to an unknown-valued bag, which is the safe direction
  because every value out of it is `unknown`. `nodeInit` holds the writing
  mirror of it, putting one key into an `AttrsPatch<A>` under a runtime-chosen
  name. TWO CASTS IN THE PACKAGE, one in each direction, and the reading one is
  a helper rather than a cast per reader so a third reader cannot arrive
  without the argument attached. The tree pass found the first draft had three:
  the extra was `checkConfig` widening the bag a second time to hand it to the
  consumer's own validator, and the entry claimed two while the code held
  three.
  `has` LOOKS IN A MAP RATHER THAN AT THE OBJECT. `'toString' in specs` is true
  for every object literal a consumer writes, and a membership test that
  answers yes for an inherited property name is a narrowing that lies: it hands
  back `'toString'` typed as one of the consumer's kinds. Tested with
  `'__proto__'` and `'toString'` directly, because the correct implementation
  makes the case unreachable by construction and a guard nobody can trip is a
  guard nobody can check.
  TWO ERRORS FOR THREE FAILURES, ON PURPOSE. An absent kind attribute and one
  holding a non-string both raise `NodeKindMissingError`, because the caller's
  remedy is the same sentence in both cases and the difference is a detail of
  what was there, which the error carries as `value` and names in its message.
  `UnknownNodeKindError` is the genuinely different one: the node said
  something legible and this registry does not hold it, so the error carries
  the kinds that were declared, which is the list the message is for.
  `nodeInit` IS THE SEAM, AND IT IS WHAT MAKES THE SPEC ACTIONABLE RATHER THAN
  DECORATIVE. A spec that cannot produce a node is a spec nobody can use, and
  the round trip (`graph.addNode(registry.nodeInit(k))` then
  `registry.resolve(node)`) is asserted. Two things it refuses: the kind
  attribute is written LAST so a caller's own `attrs` cannot mislabel the node
  they are building, and ports are not takeable from the caller, because the
  spec is what says which ports a kind has and a node that quietly gained one
  would resolve to a spec that does not describe it. `A` is the caller's own
  attribute type, inferred from the graph the init is handed to, so a typed
  consumer's keys are checked; a consumer whose type does not declare the kind
  key still gets it written, because `Graph` stores what it is given.
  NO PER-KIND PAYLOAD ON A `NodeSpec`. No label, no colour, no category, no
  `meta` slot. It is a real want and the shape it should take is decided by
  what M6.3's callbacks actually need to read, and a `meta` typed per kind is a
  second type parameter fighting the inference this entry asks for. Until a
  consumer asks, `registry.kinds` is typed and exhaustive, so a
  `Record<Kind, YourPayload>` of the consumer's own is checked for completeness
  by the compiler at no cost to this package. This is `@dagr/graph` keeping
  `traversal.ts` unexported and `@dagr/layout` publishing only `defaultStages`,
  a third time.
  WHAT M6.2 INHERITS. The port type token goes on `PortSpec` beside `maxEdges`,
  and the compatibility predicate goes on `NodeSpecInit` beside `checkConfig`,
  both additive. Connection validation reads `maxEdges` and gets a positive
  integer or nothing. `Graph` arrives on the surface with `canReach`, at which
  point the packaging note's stated reason starts being true. One thing M6.2
  should not inherit by accident: `checkConfig` returns strings rather than a
  structured issue type, and a connection validator returning something richer
  would be two shapes for one job, so decide it there rather than drifting into
  it.
  `defineRegistry({})` IS ALLOWED AND INFERS `K` AS `never`, so every method
  taking a kind is uncallable and `has` answers false for everything. Left
  legal rather than refused, because it is what a consumer building kinds up
  behind a flag writes first and the type system already says the whole story.
- [ ] **M6.2** Port typing and connection validation: a type token per port,
  a compatibility predicate the consumer supplies, and validation of a
  proposed connection against it.
  CYCLE REJECTION IS A POLICY THE ADAPTER DECLARES, NOT A DEFAULT. `Graph`
  permits cycles by design and M6.6 mandates a DSL with feedback, so a toolkit
  that rejects cycles out of the box is wrong for half its own reference
  consumers. When the adapter does declare it, the proposed-edge question is
  `source === target || graph.canReach(target, source)` — already public on
  `Graph` and O(V + E) over the reached subgraph. Name it in the task, because
  the obvious wrong implementation is add-then-`findCycle`-then-remove, which
  emits two patches and pollutes undo. One boundary: `canReach` throws
  `NodeNotFoundError` when either endpoint is absent, so it answers for a
  proposed edge between two EXISTING nodes and not for one aimed at a node the
  drag has not created yet. That second case needs its own answer.
  `findCycle` and `isAcyclic` answer over the whole graph AFTER insertion and
  are the wrong tool here.
- [ ] **M6.3** Drag-to-connect interactions on top of M5.2's hooks and M4.8's
  GPU picking: port hit-testing, an in-flight edge, drop targets filtered by
  M6.2's predicate.
- [ ] **M6.4** Subgraph nodes, drill-down form: a node that CONTAINS other
  nodes (M5.5's `parent`, one graph, not a nested `Graph` instance), and
  navigation that replaces the canvas with the container's children.
  NO LAYOUT ALGORITHM CHANGE — and that is a narrower claim than the one this
  entry made before the 2026-08-18 algorithms review, which was wrong about
  the engine. The stages need nothing. The ENGINE does: `createLayout` retains
  exactly one graph and one warm start (`held` / `warm`), and `run(graph)`
  always passes `previous: undefined`, so a run is always cold, on purpose.
  A consumer that navigates in and back out by calling `run()` on each view
  therefore gets a COLD RUN every time it re-enters — precisely the reshuffle
  the incremental-layout docs sell against — and calling `relayout(patch)` for
  the other view fails `checkPatchApplied` with `EngineStateError`. The real
  requirement is ONE ENGINE PER CONTAINER, KEPT ALIVE ACROSS NAVIGATION, each
  holding the derived view of its own children. Write that into the task; it
  is the difference between drill-down feeling instant and feeling like a page
  load.
  AND THE ENGINE LIFETIME IS THE EASY HALF. `graph.subscribe` emits ops over
  the WHOLE graph while each container engine holds a different derived `Graph`
  instance, so feeding a root patch straight to a container engine fails
  `checkPatchApplied` on the first op naming a node that view does not hold.
  Each view's patch has to be DERIVED from the root patch, and that translation
  is the task's real work. Three cases an implementer meets on day one:
  ops outside the view are dropped; a boundary edge with one endpoint outside
  is NOT droppable and needs whatever stands in for the outside endpoint in the
  derived view; and `update-node-parent` is a removal from one view and an
  addition to another, which is two patches to two engines.
  BOUNDARY NODES ARE ORDINARY SOURCES AND SINKS in the child view. An earlier
  draft said "the parent's ports become its boundary", which has no support in
  the pipeline: there is no rank pinning and no fixed-order constraint, and
  `networkSimplexRank({ initialRanks })` is a hint rather than a constraint.
  Longest-path ranking pins each node as high as its predecessors allow and
  never looks at what the node points at, so boundary INPUTS land on rank 0
  for free while boundary OUTPUTS float up under their producer instead of
  bottom-aligning. Bottom-aligning outputs is not available today and is not in
  this task.
  Every serious node tool has exactly this (Houdini subnets, Nuke Groups,
  Blender node groups, Max subpatchers, Simulink subsystems, LabVIEW subVIs,
  Substance subgraphs, Unreal collapsed graphs), which is the strongest
  available evidence that encapsulation is table stakes rather than a
  nice-to-have. It is also the answer to the one thing a flat DAG cannot
  express: naming and reuse. A subgraph node is a function. Depends on M5.5.
- [ ] **M6.5** Collapse and expand: turning a selection into a subgraph node
  and back, with the boundary edges rebound to the new node's ports. The layout
  consequence is a large structural patch, which is what M3.3 batched and M3.6
  made order-stable, so this is a consumer of that work rather than new engine
  work. Verified in the 2026-08-18 algorithms review: collapse does NOT fall
  back to a cold run — `cohortsOf` skips hint ids the roster no longer holds
  and stays engaged while any survivor is named, so the removed N cost nothing.
  WITH TWO LIMITS the task has to carry, because the guarantee is narrower than
  "collapse is stable". The order constraint is per hint LAYER, and a node
  whose rank changed is a newcomer at its new rank with a cohort of one, placed
  freely by the sweeps. Collapsing a mid-graph selection shortens paths and
  shifts downstream ranks, so stability holds only for nodes whose rank
  survives the collapse. And M3.7 has not landed, so a collapse on cyclic input
  can still reshuffle through the FAS.
- [ ] **M6.6** Two reference DSLs built on the toolkit, deliberately unalike:
  one acyclic and value-shaped, one with feedback and a real-time evaluator.
  The second is the one that finds the wrong assumptions, because a toolkit
  written against acyclic dataflow alone will have baked that in.

## M7: Compound layout (`@dagr/layout`)

Inline nesting: parents and children drawn together as nested boxes, rather
than M6.4's drill-down. Separated from M6 because it is a different and much
harder problem, and it interacts with every M3 stability guarantee. Sugiyama
and Misue's compound digraph paper (1991) is the origin; dagre's cluster
support is its buggiest corner precisely because it was retrofitted, which is
the case for doing this as its own milestone with its own tests rather than as
an M6 sub-task.

What it actually touches, corrected against the code by the 2026-08-18
algorithms review rather than asserted:

- CROSSING REDUCTION, yes. `barycenterOrder` is literally a barycentre-then-
  median sweep, and that is the pass Forster's work on layered compound graphs
  exists to replace.
- RANKING, but NOT by replacing the ranker. Network simplex IS amenable to
  containment constraints; this implementation just hardcodes both knobs —
  minlen is the `- 1` in `slackOf`, and every weight is ±1 in `netInflow`,
  with `AcyclicView` carrying only `from` and `to` per edge. Containment
  edges need per-edge minlen and weight, so what M7 needs is A PER-EDGE
  ATTRIBUTE CHANNEL ON THE VIEW, not a new ranking algorithm. That is a
  smaller and better-shaped change than "replace ranking", and the roadmap
  should not overstate it.
- POSITIONING, yes.
- THE WIRE PROTOCOL, which the earlier draft missed entirely. `decodeRun`
  rebuilds nodes as bare ids, so `parent` would never reach a worker. M7
  reopens `wire.ts`.

THE CAMPAIGN DEMO IS ALREADY THIS MILESTONE, DONE BY HAND, and it is the best
evidence M7 has. `packages/campaign` carries a `contains` forest rooted at
`rootId` with a `depth` per node, which is M5.5's containment expressed as
edges; `packages/campaign-stage/src/tiles.ts` cuts the campaign into about a
hundred tiles because one Sugiyama pass over 3,010 nodes ranks 1,023 rooms into
a couple of layers and draws a 50:1 ribbon; `campaign-scene.ts` runs a separate
layout per tile and shelf-packs the blocks with a bisection-searched width. Per
container layout plus a packing pass over the results IS compound layout. The
demo built it by hand because the engine could not.

That makes the success criterion concrete, and it should replace "inline
nesting" as the way this milestone is judged: M7 reproduces the campaign
drawing without the hand-rolled packer. Two honest limits on that. The demo
today runs all 95 tile layouts through ONE engine (`campaign-scene.ts`), so
every tile is a cold run and no tile can relayout incrementally — the problem
M6.4 names above, already visible in shipped code. And the 6 GRID tiles are not
a compound-layout problem at all: NPCs, factions, items, stat blocks, clues and
weather have no routed edge with both ends inside a group, so a layer
assignment puts every component in rank 0 and a grid is what the data actually
wants. M7 must not claim those.

Not scoped in task detail until M6.4 has shipped and the drill-down form has
been used enough to say whether inline nesting is wanted as well.

## Campaign demo track

Maintainer-requested (2026-08-14), planned in
`plans/2026-08-14-campaign-demo.md`, which carries the decision record the
entries below only summarize. Runs beside the milestone numbering because it
is a demo direction, not an engine milestone; where a phase IS an M4 task
(P3 to P5), the M4 entry stays the record and the phase just names its
consumer. Sequencing against M3 is the plan's open question 1.

- [x] **P1** (`packages/campaign`, `apps/demo`) The dataset: `@dagr/campaign`,
  a private zero-dependency package holding the schema types (16 node kinds,
  23 edge kinds with a routed/overlay split the layout consumes) and a seeded
  generator. Measured at the default seed: 3,010 nodes, 7,100 edges, spanning
  2,581 to 3,752 nodes across `scale` 0.5 to 2. The structural claims are
  tested as graph invariants across three seeds, not eyeballed: the contains
  forest steps depth by exactly one, every revelation has three clues from
  three distinct holders of at least two kinds, every dungeon's loop surplus
  is at least a quarter of its rooms with the 88-room finale present, secret
  and one-way door shares sit at module-like proportions, the settlement
  layer holds average degree 2.5 to 4, over 55% of failure branches merge
  back within two steps, and the bestiary reuse is Zipf-shaped. Determinism
  is deep-equality over the whole structure, same seed same campaign.
  Names and tables are original, so the dataset ships with no licensing
  question. The demo generates the campaign at module load and loads it into
  a real `@dagr/graph` (the sample pipeline graph retires); drawing it is P4.
  Edge count honesty: the research proposal estimated 8,000 to 11,000 edges;
  the built social layer is thinner and the suite gates the ratio (2 to 4
  edges per node) rather than the estimate.
  A pre-PR review (8 finder angles, execution-verified) found 10 confirmed
  data-coherence and quota-integrity bugs, all fixed with regression tests:
  the demo hardcoding the root id across the package boundary (Campaign now
  exposes rootId), quest objectives contradicting their own titles, the
  jaquays quota counting doubled doors as loops, the top half of the bestiary
  collapsing into same-named clones, every clock tick claiming to be first,
  NPCs able to end up with zero acquaintances despite the documented floor,
  zero-room dungeons at tiny scales (rooms now floor at 8), a reward bias
  that was stated but not built, edges loaded into the demo graph without
  their kind, and duplicate React keys latent in the location card rows.
- [x] **P2** (`@dagr/render`, `apps/demo`) Content-derived zoom limits and
  keyboard zoom while the canvas has focus.
  `Camera2D` gains `setZoomLimits` and `fitBounds`, and the constructor's
  "range is fixed at construction" rule is repealed with its own argument
  addressed: the drift hazard was limits changing between the read and the
  write of one anchored zoom, and `setZoomLimits` is called from resize
  handling, which no wheel event interleaves with on a single thread, while
  `zoomAtScreen` still clamps first and derives the centre from the clamped
  zoom. `fitBounds` takes padding as the viewport fraction left empty per
  side, capped at 0.45, and rejects zero-area bounds rather than fitting a
  point at infinite zoom.
  The demo derives its range in `zoomLimits`: the floor is the whole scene
  fitted at 5% padding, the ceiling is the SMALLEST node framed at the same
  padding (134.6 on the reference canvas). Smallest rather than median,
  because a scene like the ladder spans decades of node size and a
  median-derived ceiling strands the small nodes below readable size; framed
  rather than filling the short side, so the ceiling can never be an
  edge-free flat fill, which is the invariant the fixed range's screenshot
  test guarded. Both ends are the same exported `fitZoom` the camera's
  `fitBounds` adopts, so the "0" key, the floor, and the ceiling share one
  formula and one validation. Both ends are viewport statements, so the range
  rebinds on every resize and the readout hint prints the live values.
  The keyboard, with focus as the mode switch: the canvas is focusable, and
  while focused ArrowUp/Down (and +/-) zoom one wheel detent per press so key
  and wheel share one speed, PageUp/Down take three detents, Left/Right pan,
  Shift+Up/Down pan vertically, 0 and Home fit the scene, Escape blurs, and
  a visible focus ring marks the mode because an invisible mode is a mode
  nobody knows they are in. `preventDefault` fires only for claimed keys, so
  Tab and unclaimed keys keep their page meaning; unfocused, every key does.
  RETIRED: the fixed 0.1 to 100 range and `initialZoomFromHash`'s clamp. The
  100x crispness reference stays reachable (the derived ceiling is 149.5 on
  the reference canvas); the 0.1x reference is deliberately below the new
  floor, because a floor at the fitted scene is exactly the "too far out"
  state the maintainer asked the range to prevent. That frame remains
  reproducible from the M4.2 commit, and the sub-pixel fade it documented is
  recorded in the M4.2 entry above; no future scene needs to re-demonstrate
  it. The hash parser now returns out-of-range values as parsed, and the
  camera clamps them when the derived limits land at the first viewport
  measurement, which happens SYNCHRONOUSLY in the effect before any listener
  attaches: rAF callbacks run before ResizeObserver observations in a
  rendering update, so waiting for the observer would leave a window in
  which a queued gesture could draw at, and anchor a centre against, an
  unclamped zoom.
  A pre-PR review (8 finder angles) confirmed one live bug and shaped the
  rest of this entry: the key handler originally hijacked Ctrl/Meta/Alt
  chords (accessibility page zoom, history navigation), and now bails on any
  of them; the readout hint had lost its `#zoom=` example; `docs/render.md`
  still claimed the 0.1x frame was reproducible and its API table lacked the
  new methods; `zoomLimits` yielded an Infinity for zero-extent content
  instead of a named RangeError; the ceiling could flat-fill on the wide
  small rect; and three duplications (fit formula, wheel-detent literal,
  range validation) each now have a single authority.
- [x] **P6** (`apps/demo`) Campaign cards through `createRichNodes` with
  per-kind declared sizes. P3 to P5 are M4.3 to M4.5 and live in M4.
  What P4 left it: `campaign-style.ts` holds the per-kind sizes and colours with
  `nodeColor(node)` giving the CSS string a badge needs, and
  `CampaignScene.overlayNodes` is the `{id, bounds, color, node}` list a tier maps
  over, carrying the campaign record itself so `cardRows` needs no second lookup. P4 ships ONE tier, a name above the node from 24 CSS pixels of
  screen width, so P6 owns the card gate and every threshold above it: the
  overlay rejects overlapping gates, so a placeholder card would have been a
  number to work around rather than choose.
  What shipped: `campaign-tiers.ts`, a title tier (24 to 415 CSS pixels of
  screen width) and a card tier above it, built on `cardRows` so all sixteen
  kinds share one formatter. P4's single tier is REPLACED, not extended, and
  its `stage__label*` and `stage__card*` rules retire with it; the tier's rules
  live beside the tier in `campaign-cards.css`. `CampaignOverlayNode.color`
  goes too: P6's tiers take the palette as a parameter and call `nodeColor`
  themselves, which left that field with no reader and 3,010 eager palette
  calls per scene build.
  **The card gate is 460, and it is derived from BOTH dimensions.** Read as
  width alone, the rule the ladder's 240 came from ("a card should not be wider
  than the node it describes") is not enough: a card sits inside its node's
  top-left corner, so a card TALLER than its node hangs over whatever is below
  it, and at card zoom that is a neighbour the reader is also reading. So the
  gate is `max(cardWidth, cardHeight * nodeAspect)` over every kind AND over
  location's four subtypes, which are four node sizes under one kind. Quest
  drives it at eight lines. Reachability is what makes that
  affordable: the ceiling frames the smallest node, so the smallest node is
  about 637 CSS pixels wide there, still clear of 460. Three tests hold it: the gate covers every
  variant, it is the SMALLEST value that does (so it cannot drift upward and
  delay every card silently), and the ceiling, derived through the demo's own
  `zoomLimits` rather than a copied number, can still reach it.
  **The size table is MEASURED, and the first two versions of it were wrong.**
  Sizes are declared rather than measured at runtime, which is the overlay
  design's rule for templated content. But what is declared is a LINE budget,
  not a row count, and the numbers come from a browser. Version one counted
  `cardRows` entries and assumed one rendered line each; a quest's objective is
  76 characters, several lines in the value column. Version two computed lines
  from character counts, which is wrong in kind rather than degree, because word
  wrap breaks at word boundaries: it put `front` at six lines where the browser
  draws seven, and the sampling check meant to catch that chose five other
  cards. `bench/browser/card-heights.mjs` now renders EVERY card of three seeds,
  8,946 of them, and reports the tallest per kind; the table is its output and
  the harness is committed so the numbers can be disagreed with. Version three
  was wrong too, in the harness rather than the table: it measured
  `scrollHeight`, the PADDING box, which drops the card's two pixels of border
  and is lenient in exactly the direction that lets a card overflow. Measuring
  the border box then exposed the real defect, that the row grid carried a 2px
  vertical gap a line-based height model has no term for, so every multi-row
  card sat two pixels over its declared box. The gap is gone, and all sixteen
  kinds now measure EQUAL to what they declare, with no slack anywhere.
  Version four was wrong in the harness again, and this one is worth carrying
  to any future browser measurement: a headless browser on a bare box has
  almost no fonts, and resolves `ui-monospace`, `monospace` and even `serif`
  to a 6.000px advance at 12px, about a sixth narrower than any monospace a
  reader actually has. Budgets taken there wrap later than reality: five kinds
  that
  measured as fitting clipped in a real face, `quest_step` by two whole lines.
  The harness now pins its probe to Liberation Mono, which is installed and
  sits at the 0.6em the common faces cluster at, and ASSERTS the advance it
  measured rather than trusting the font stack to resolve. That moved the gate
  from 415 to 460. The card also
  has a fixed height and clips its overflow, so a stale budget truncates a line
  rather than occluding the node underneath.
  One width for every kind, 320. Two widths were the first design, on the theory
  that narrower cards let the gate open sooner. They do not: the gate is driven
  by height against node aspect, and a narrower card wraps into more lines, so
  narrowing raises the gate.
  The palette is a PARAMETER, `nodeColor(node)`, not an import: the instanced
  shapes and the cards agree because they call one function rather than holding
  two copies, and the tier module stays testable without the demo's style
  module. It takes the node because `location` is one kind and four blues; a
  `(kind)` signature badged every room in its region's colour, which P4's review
  and this session's found independently. The NAME carries the colour on both
  tiers, because the name is the one element a reader sees on both sides of the
  gate and it should not change appearance as they cross it.
  A test asserts every kind's and every location subtype's colour survives a
  `style.color` round trip, because the CSS parser DROPS a value it rejects and
  leaves the element its inherited colour with nothing failing anywhere. Every
  length the size table also states is written in the stylesheet as pixels, not
  rem, so a reader whose browser default is not 16px cannot silently get cards
  larger than the box the gate was derived from.
  jsdom moves into `apps/demo`'s devDependencies: it was only in
  `@dagr/render`'s, and pnpm is strict, so the demo could not resolve it.
  DEFERRED, recorded rather than fixed: a node wider than the viewport (the
  campaign node is about 7,000 CSS pixels across at the ceiling) has its card
  anchored to a corner that is off screen, so panning into its middle shows a
  blank fill where the reader zoomed in to read. The title tier has had the same
  shape since M4.12. The fix is to clamp the placement against the viewport,
  which belongs in the overlay's placement code in `@dagr/render` rather than in
  a demo tier, and it wants its own task.
- [x] **P7** (`apps/demo`, `docs`) Deep links, hover highlight, committed
  screenshots, a docs page on the schema.
  MERGED as PR #37 on 2026-08-15, which is when everything below was written.
  The box itself was left unticked by that run and is ticked here, by the next
  increment, because an entry with a full decision record above an empty box is
  a task the run after it picks up again.
  The docs page landed early, on 2026-08-15, as its own increment
  (`docs/docs/campaign.md`): it depends on P1 alone, and the rest of P7 depends
  on P5 and P6, so holding it back would have parked a finished page behind two
  unrelated merges. IT WAS MOVED OUT OF THE DOCS SITE ON 2026-08-16 by D4
  below, into `packages/campaign/README.md`, on the maintainer's reading that a
  fixture explained beside Graph model and Renderer reads as part of the
  library. The content survives the move and the paragraphs described here are
  the ones it kept; what changed is where a reader finds them. It documents the
  16 node kinds and 23 edge kinds with the
  routed/overlay split and the argument for it, where the schema came from,
  the generator's determinism and its measured scale (3,010 nodes and 7,100
  edges at the default seed, 1.1 MB of JSON against 60 KB of source), and the
  invariants the suite enforces. Every count in it is measured off the default
  seed rather than copied from the plan's projections, which is how the page
  says 16 node kinds where the plan's own schema section still says 15 above a
  list of 16, and why its per-group edge counts are the built ones rather than
  the research proposal's estimate the P1 entry above already disowns.
  `#node=` is an ENTRY POINT, not a live binding, which is the same decision
  `#zoom=` records and is worth restating because the temptation differs: a
  `#zoom=` that tracked the camera would fight the wheel, while a `#node=` that
  tracked it has no honest moment to update, since no single node is where a
  viewport is. So it is read once at load and never written back. The two keys
  compose rather than compete: `#node=` decides WHERE through the node's own
  box, `#zoom=` still decides HOW CLOSE when present, so
  `#node=dungeon-21&zoom=8` centres the finale at 8x. An id the scene does not
  hold falls back to the whole campaign, because a mangled link should show the
  scene rather than an empty patch of world. The parser returns the id verbatim
  rather than validating it: it has no campaign to check against, and the
  caller resolves it in one lookup, which keeps "does this node exist" where
  the nodes are. An empty `#node=` is no id rather than the empty-string id.
  HOVER WITHOUT PICKING. M4.8 will put an id per pixel on the GPU, which is
  what arbitrary shapes need; a campaign node is an axis-aligned box whose
  extents the demo already holds, because the overlay is positioned from the
  same boxes, so `hover.ts` answers the same question with arithmetic and no
  readback, no extra target, and nothing to keep in step with the camera. It
  answers for the BOX rather than the drawn shape, which is right for a hover
  that says which node you are near and wrong for a click target, so it is not
  quietly reused as one when picking lands. The smallest containing box wins,
  so the answer cannot depend on scene order. A linear scan over 3,010 boxes on
  pointer moves is microseconds; an index would be a structure to keep in step
  for no measurable gain.
  The highlight is a CLASS on the overlay element, found by a `data-node-id`
  the tiers write, which costs one lookup per CHANGE of hovered node rather
  than a React render per pointer move. Elements are POOLED, so a tier clears
  the class on every bind (or a recycled element carries the highlight to
  another node) and the demo re-applies it after each sync while something is
  hovered. That re-apply sits inside the ONE `draw` callback beside
  `overlay.sync()`, never on a listener of its own, which is M4.11's rule and
  the thing the 0.2 ms per element per frame panning cost is there to protect.
  `pointerleave` clears it, or a node stays lit while the reader is reading the
  page below, which reads as a selection. A pan clears it too: the move handler
  returns early while panning, so a held highlight would light a node the
  pointer left hundreds of pixels ago and would cost a lookup per frame to keep
  doing it.
  The README and the docs intro now link the live demo. The URL in this entry
  was `https://dagr-demo.onrender.com/`, which P8 below deployed; D1 retired
  that service and the links point at `https://dagr.prnt.design/demos/campaign`
  instead, which is the same stage under the docs site's own nav.
  WHAT THAT URL SHOWED WHEN THIS ENTRY WAS WRITTEN, 2026-08-15, because it
  keeps changing under the link and a reader later deserves a dated snapshot
  rather than a promise: the campaign's 3,010 nodes drawn instanced, one mesh
  per shape family, over about 101 tiles laid out a tile at a time in the
  worker; the whole scene fitted on load with a zoom range derived from it;
  names from about 24 CSS pixels of node width and full cards from 460; the
  `#zoom=` entry point; and, as of P5's second stage, routed edges as dashed
  ribbons along the layout's polylines, cross-tile and overlay edges bowed
  between tiles, three groups drawn in declaration order. NOT the `#node=`
  entry point and NOT hover: both are new in this entry's own commit, so the
  deployed site does not have them until this merges and Render rebuilds.
  SCREENSHOTS, five of them, in `assets/screenshots/` beside `p7-captions.txt`,
  taken by `apps/demo/scripts/capture.mjs` so somebody who did not take them can
  take them again. Each frame is a URL hash, which is what makes it checkable:
  the fitted campaign, names at `#zoom=1.4`, a quest and an NPC card at
  `#node=quest-1` and `#node=npc-3`, and the 88-room finale at
  `#node=dungeon-21&zoom=2`. Every frame asserts the tier it is about, a floor
  AND a ceiling, because the first version of the script captured a picture of
  the loading state and passed: it waited on body text containing "nodes,",
  which the copy BELOW the canvas says whatever the canvas is doing. It now
  waits on the readout, which only renders once a camera has been published.
  The captions say what a reader needs to not misread them later: captured on
  the swiftshader WebGL2 fallback, because this box has no WebGPU at all, with
  Liberation Mono PINNED at 7.201 px per character, because the capture box has
  none of the faces the demo's font stack names and falls back to a 6.000 px
  advance, about a sixth narrower than any reader sees. Pinning is a departure
  from what this box would serve and it is the honest one: the missing fonts are
  a fact about the machine, not about the demo.
  A WRONG OBSERVATION, corrected here rather than quietly dropped, because the
  mistake is more useful than the fix. This entry first recorded that at device
  pixel ratio 2 the fitted campaign drew NOTHING on the capture box, and
  wondered aloud whether the renderer's device-pixel path was at fault. It was
  not. The capture was racing the renderer: the shutter waited on the readout,
  and `publish` runs from the same `draw` as `render`, so the first draw
  publishes live camera numbers while `renderer` is still null and nothing has
  been drawn. A larger drawing buffer takes a software rasteriser longer, so
  dpr 2 lost that race more often, which looked exactly like a dpr-dependent
  bug. Behind the gate the demo now publishes (`data-renderer-drawn`, set after
  `createRenderer` resolves and a frame has gone through it), dpr 1, 2 and 3 all
  draw the fitted campaign. Two reviewers caught the blank frame independently
  and both named the race; the committed frame had shipped blank under a caption
  describing 3,010 nodes and ribbons.
  NOT TAKEN, and worth the sentence: P5's `campaignEdges` takes a colour
  FUNCTION whose identity keys the effect, so swapping it reaches the GPU, which
  makes highlighting the hovered node's own edges a small change. It is a small
  change with a per-hover cost: every hover would re-upload a colour for all
  7,100 edges, and hover changes as fast as a pointer moves. Worth doing behind
  a per-edge attribute write for the few edges that change, which is a different
  piece of work from this one.
  FOLLOW-UP, not done here: a node wider than the viewport has its card
  anchored to a corner that is off screen, so panning into its middle shows a
  blank fill exactly where a reader has zoomed in to read. It bites on CARDS
  specifically rather than being inherited from the title tier, because the
  card only opens at a width where the large kinds exceed the viewport (the
  campaign node is about 7,000 CSS pixels across at the ceiling). The fix is to
  clamp the placement against the viewport, which needs the camera per frame
  and therefore belongs in `@dagr/render`'s overlay placement rather than in a
  demo tier that deliberately never reads it. It wants its own task.
- [x] **P8** (`render.yaml`) The demo on a public URL: a second static site,
  `dagr-demo`, building `apps/demo` from the repo root and publishing
  `apps/demo/dist`.
  Numbered after P7 because it is not a phase of the plan: the plan never asked
  for a deploy, and the maintainer did, on the day P4 put something worth
  looking at on a canvas. It gates on `checksPass` like the docs site, so a
  build that typechecks, tests and lints clean is the only thing that reaches a
  URL.
  ON RENDER'S OWN DOMAIN, with no `domains` block. A subdomain of prnt.design is
  a promise about permanence that a playground should not be making; the docs
  site is the published one and this is the working artifact.
  PREVIEWS OFF BY OMISSION, which is the one place it differs from the docs
  site, and the mechanism is worth stating because the obvious spelling is
  wrong: the PER-SERVICE `previews.generation` takes only `manual` or
  `automatic`, and `off` is a value the BLUEPRINT-ROOT field takes. Omitting the
  block is how a service disables previews, and writing `off` would be a value
  the field does not have, which fails validation for the WHOLE file and would
  take `dagr-docs` down with it. Off rather than on because every increment here
  is a pull request and this is the heavy bundle (three.js, about 1.1 MB).
  VERIFIED RATHER THAN ASSUMED, which the M4.4 review made the habit: every
  `dist` in the workspace was deleted, Render's exact `buildCommand` was run from
  the repo root, and `apps/demo/dist` was served by a plain static file server
  and loaded. 3,010 nodes, 101 tiles, 95 layout runs, the worker chunk resolving.
  The `buildFilter` lists every package the demo imports, because it imports
  their SOURCES through the alias in `vite.config.ts`: a change to
  `@dagr/render` with no change to the demo does change what a visitor runs.
  WHAT A BLUEPRINT SYNC OVERWRITES IS THE RISK IN THIS CHANGE, and it is not the
  new service. Render auto-syncs a blueprint on a push, and its docs say changes
  made in the dashboard "are overwritten the next time you sync your Blueprint",
  with `buildFilter` specifically REPLACING its previous value. So merging can
  reconfigure the live `dagr-docs` service unattended, and anything set on it in
  the dashboard rather than in this file is reverted. An earlier draft of this
  entry asserted a one-time confirmation gate instead, which is not in the docs:
  a review caught it. Creating a new service does prompt, but that prompt is not
  what protects the existing one. The check before merging is therefore the
  maintainer's: does `dagr-docs` carry any configuration this file does not
  (an extra domain, a redirect or rewrite, a manually added env var)? It was
  created from this blueprint, so the expected answer is no.
  The `headers` glob is `/assets/*` and NOT the docs site's `/assets/**/*`,
  because Vite's output is one level deep where Docusaurus nests. Render's `*`
  does not cross a slash and `/**/*` wants at least two, so the docs pattern
  would have matched NOTHING here and the 1.1 MB bundle would have lost its
  immutable caching with nothing failing to say so. Two reviewers found it
  independently.
  RETIRED ON 2026-08-15 BY D1, one day after it shipped, and the box stays
  ticked because the task was done rather than undone: the service existed, it
  served the demo, and it was removed when the demo got a better home. Why it
  was the wrong end state was visible while it was being built and was traded
  for speed, which this entry should have said and did not: a visitor to the
  docs site never found the demo, following the link lost the site's chrome and
  its nav, and two static services on one blueprint is twice the deploy surface
  for one artifact. What made the move cheap is that the docs site already
  compiled `@dagr/layout` into a visitor's browser for the landing page's
  benchmark, so adding the renderer was a dependency step and not an
  architecture change. Every link to `dagr-demo.onrender.com` is retargeted at
  `/demos/campaign` in the same commit, and `apps/demo` stays as the playground
  with no deploy of its own.
  REMOVING THE BLOCK FROM `render.yaml` IS HALF OF IT, and the D1 diff review
  caught the other half being asserted wrongly in three places at once (this
  file, the blueprint's own comment, and D1's plan). A blueprint sync NEVER
  deletes an existing resource, including one whose definition has gone from
  the file, and a resource removed from the blueprint but left in the dashboard
  is RECREATED by the next sync. The order is therefore: merge the file, then
  delete `dagr-demo` in the Render dashboard, which is the maintainer's hand
  and not an agent's. Until that happens the service keeps the config it last
  synced, so it keeps building `apps/demo` on a push matching the `buildFilter`
  it still holds and keeps serving a demo nothing links to. The mistake is
  worth keeping: it came from reading the sync's OVERWRITE behaviour (which is
  real, and is why the dashboard is not where configuration lives) as a DELETE
  behaviour, and the two are opposite.

## Demo into the docs site

Maintainer-requested on 2026-08-15, in one sentence: no separate `dagr-demo`
site, the demo belongs on the docs site, on the landing page or on a demos
tab. Planned in `plans/2026-08-15-demo-into-docs.md`, which carries the
argument for the tab and the record these entries summarize. D2 and D3 are the
second half of the same message, about spacing and about reading the edges,
and are independent of D1 and of each other. D4 onwards come from a second
message on 2026-08-16, after the maintainer saw the result: the demo is good,
the explainer that shipped beside it in the product docs is not wanted, and
the demo itself should show richer nodes and its zoom.

- [x] **D1** (`packages/campaign-stage`, `docs`, `apps/demo`, `render.yaml`)
  The campaign stage extracted to a shared package, mounted at
  `/demos/campaign` under a Demos tab, and the `dagr-demo` service retired.
  MERGED as PR #40 on 2026-08-15. The service's own deletion is a maintainer
  step in the Render dashboard, for the reason under P8 above.
  A DEMOS TAB RATHER THAN THE LANDING PAGE, which was the maintainer's own
  either/or resolved with a reason: the canvas wants the full viewport and its
  own keyboard focus, and the landing page has a hero, a live benchmark figure
  and a pitch that would all be pushed under a canvas that ate the fold. A
  route of its own also leaves the animated demos in the follow-up a home as
  sibling pages under one tab, which is a better shape than a landing page that
  grows a carousel. The landing page links it twice, from a `Live demo` action
  next to `Get started` and from the status line, which is also where the
  four-PR-old claim that "rendering has first light" was corrected.
  A NEW PRIVATE PACKAGE, `@dagr/campaign-stage`, rather than a `/react` entry
  on `@dagr/campaign`. The dataset package is deliberately zero-dependency (its
  own entry above says so and a test holds it), and a subpath export does not
  change what installing the package pulls in: React, the renderer and three
  would all become its problem. The stage is a different thing from the data it
  draws, so it is a different package, and it is private because it exists to
  stop two pages drifting rather than because anybody should install it.
  THE WORKER ENTRY DID NOT MOVE WITH THE STAGE, which is the one deviation from
  the plan's sketch. `new Worker(new URL('./layout-worker.ts', import.meta.url))`
  is an expression the bundler resolves from the module that writes it, and the
  two hosts are Vite and webpack: a `new URL` inside `node_modules` would have
  to resolve, and emit a self-contained chunk, under both. So `CampaignStage`
  takes a `createWorker: () => Worker` prop and each host owns its entry, which
  also puts the docs site's entry where the `dagr-worker-runtime` plugin
  already covers one. The prop is read through a ref and its identity is never
  compared, or an inline arrow would tear down a hundred layout runs on any
  re-render.
  THE STYLESHEET IS A NAMED ENTRY, `@dagr/campaign-stage/stage.css`, imported
  by the host rather than by the component that owns the class names. A package
  that builds through `tsc` copies no CSS into `dist`, so an import inside the
  module would resolve under Vite and point at a missing file under webpack.
  Its colour tokens moved from the demo page's `:root` onto `.stage` in the
  same pass: the stage grew up on a page that owned the whole document, and a
  docs site's `:root` means other things by the same names.
  VERIFIED BY LOADING THE BUILT SITE, not by the readout, which was P7's
  lesson: every `dist` deleted, `pnpm build` from the root, `docs/build` served
  by a plain file server, and `/demos/campaign` loaded in headless chromium on
  the swiftshader fallback. It gates on `data-renderer-drawn` plus a floor on
  the canvas-only PNG, because the DOM tiers are satisfied by a blank canvas.
  3,010 nodes, 101 tiles, 95 layout runs, the worker chunk resolving under
  Docusaurus, `#node=quest-1` attaching its card, and the landing page's own
  benchmark still answering, which is the other worker entry.
  THE DEMO KEEPS ITS TESTS, which moved with the code they cover, so
  `apps/demo` has no test directory left and no test script. What is left there
  is the page around the stage: the header, the facts panel and the worker.
  WHAT THE REVIEWS CAUGHT, beyond the blueprint claim in P8 above. The facts
  panel read "laying out" forever when the layout failed, which is the same
  contradiction that moving the failure onto the stage was meant to end, with
  the halves swapped; it now says the wait is over and leaves the reason to the
  stage. The failure message inherited the readout's `pointer-events: none` and
  `user-select: none`, so the one sentence anybody would paste into a bug
  report could not be selected; it is the single child that undoes both, and
  there is no drag under it to protect because the scene never arrived. The
  demos route sized itself with a fixed `height`, which is true from above and
  false from below: on a short viewport the caption plus the stage's floor
  overflowed into the footer, so it is a `min-height`. The capture script's
  font probe fell back to `body`, where the stage's mono token does not
  resolve, so a missing stage would have thrown an error blaming a missing
  font. And `three` is in `docs/package.json` as `@dagr/render`'s peer while
  webpack still resolves the renderer's own copy, which is worth stating
  because the honest reason (the consumer declares what it ships) is not the
  reason it works; `docs/README.md` carries it, with the rule that the range
  tracks `packages/render`'s.
  A MEASUREMENT TAKEN THROUGH ANOTHER SESSION'S SERVER: a probe of `apps/demo`
  reported the campaign laid out at exactly twice the size, on a branch that
  had touched no layout code. Port 8734 is the port `apps/demo/README.md`
  names, and the sibling session doing D2's spacing had a server on it. On a
  shared box a fixed port is somebody else's process, which is now in the
  gate-lock protocol text with the one command that settles it.
- [x] **D2** (`packages/campaign-stage`) The campaign's own spacing, and edges
  coloured by where they come from. From `plans/2026-08-15-demo-into-docs.md`, which is the
  maintainer's second direction of 2026-08-15: more spacing between nodes, edges
  colour coded to see where they are coming from, and an edge highlight (D3).
  SPACING IS MEASURED, NOT PICKED, and `CAMPAIGN_SPACING` in `tiles.ts` carries
  the table: the whole scene was built at four candidates and each was read at
  both ends of the zoom range on the demo's own 1102 by 598 stage. 120 and 160
  against the package defaults of 50 and 50. What the fitted view actually buys
  is the gap AGAINST THE NODE, from 0.89 of a room's width to 2.1, because the
  zoom floor is derived from the scene extent (P2) and a scene that grows is
  drawn smaller, so the gap in PIXELS only moves from 2.57 to 3.09 and is within
  3% of its plateau by 100. What keeps improving past that is the edge ink at the
  far view, halved from 25.4% of the viewport to 12.6%, because centreline grows
  linearly with the separations while the floor falls with them and coverage goes
  as its square. THE COST IS NODE SIZE AT THE FITTED VIEW: a room goes from 2.88
  CSS pixels wide to 1.44, and the zoom range widens from 374x to 748x. Both are
  the price of a scene twice as wide, and both are why the tiles are tiles: a
  reader reaches detail by framing one, not by zooming from orbit. Ranks are
  separated a third more than nodes because the rank gap is the one with the
  routed edges in it. Every other gap is DERIVED from the node separation (the
  tile gutter at four times it, a grid tile's cells at exactly it), so raising
  one carries the rest and no ratio can drift.
  EDGES ARE INKED FROM THEIR SOURCE NODE, not by role: `colorOf(edge)` is the
  source's own fill mixed a quarter of the way to the ground, so a ribbon out of
  a quest is quest green and a reader traces provenance by hue across a tile
  whose labels are not showing yet. The mix is calibrated against the ink it
  replaces rather than chosen: the old routed ink sat at 0.76 to 0.86 per channel
  of the sky blue it came from once the ground is subtracted. THE ROLE SPLIT MOVES
  TO THE DASH, which is the part that would be a regression if it were dropped:
  colour used to carry routed against overlay across all three groups, so the
  cross-tile group is now dashed too, with the routed group's own pattern and
  speed. A reader who learned "dashed is hierarchy" inside a tile is owed the
  same reading across a tile boundary, and two dash shapes would read as three
  kinds of edge where there are two.
  THE SEAM HELD: `campaignEdges` already took a colour function and the `[edges]`
  effect was already keyed on the prop, both put there by P5 and P7 for exactly
  this, so nothing in `@dagr/render` changed except two measured figures in
  `ribbon.ts`'s own record that this made stale (the campaign's centreline and
  its fitted zoom). The conclusion in that record did not move, and the reason
  is structural: coverage at a fixed pixel width is centreline times the floor,
  and the spacing doubles the first while halving the second, so on one stage
  42.0M at 0.0257 covers 164% of the viewport at one pixel where 21.1M at 0.0514
  covered 165%. A first draft of this paragraph compared those two against the
  record's own 529% and 176%, which were measured on M4.5's 1003 by 597 canvas
  and are not the same comparison; the review that caught it re-derived the
  product and landed 6% off, which is what a measured record is for.
  P7's FIVE FRAMES ARE NOW A RECORD RATHER THAN A REPRODUCIBLE SET, which is
  worth saying because the capture script's own header claims every frame is
  regenerable. Their `expect` gates are written against the pre-D2 drawing, and
  the one at `#zoom=1.4` wants twelve titles where the new spacing puts fewer
  nodes on a screen, so re-running that set now stops at its own gate. That is
  the convention `assets/screenshots/` already had (`m4.2` is a shape ladder the
  demo no longer contains at all): a prefix is one task's drawing, and a task
  that wants today's frames adds a set, which is what D2 did.
  THE PAIR WAS RETAKEN AFTER D1 LANDED, and the reason is the whole point of a
  before and after: the first pair took its before half from the pre-move demo,
  where the fitted frame came out byte identical to `p7-campaign-fit.png`, and
  D1's move changed the rendering enough that it no longer does. A pair with two
  changes in it argues for neither, so both halves are now captured on one tree
  lineage: `origin/main` at the move for the before, the same tree with D2 on top
  for the after.
  BEFORE AND AFTER ARE COMMITTED, `assets/screenshots/d2-before-*.png` against
  `d2-after-*.png`, taken through the same shutter as P7's: the same viewport,
  the same font pin, the same `data-renderer-drawn` gate, and both anchored on
  `#node=` rather than a zoom, because the scene grows and two frames of two
  different places are not a comparison. `capture.mjs` grew a frame SET and a
  variant label for it, and P7's five frames keep their names and their paths.
  The script is one file with two purposes now: its FRAME LIST is P7's and the
  `d2` set is D2's, so somebody running it with no argument hits P7's gates
  first. The header says which is which.

- [x] **D3** (`@dagr/render`, `@dagr/campaign-stage`) The edge highlight: hover a
  node and see where its edges come from and go. The last of the maintainer's
  2026-08-15 direction, and the half of it that needed a renderer change.
  THE MECHANISM IS A PER-EDGE CHANNEL, because `setEdgeStyle` is per GROUP and a
  highlight is not a style: a style is how a whole group is drawn at this zoom,
  which a frame decides, and this is which members of it matter right now, which
  a pointer decides. Through groups it would be a group per highlight state and a
  re-tessellation to move an edge between them; through `setEdges` it would
  rebuild every buffer to change one float. `setEdgeIntensity(groupId,
  intensityOf)` takes one number per edge in `[0, 1]`, the tessellator's per-route
  `RibbonRange` makes writing it a slice, and only changed values are uploaded, as
  ONE merged update range flushed from `onBeforeRender` (M4.3's finding that
  `addUpdateRange` does not coalesce applies here unchanged).
  IT MULTIPLIES BOTH THE WIDTH AND THE ALPHA, which is the decision inside the
  decision. Alpha alone leaves a dimmed edge as wide as a highlighted one, so a
  hairball stays a hairball at lower contrast; width alone leaves it as bright,
  and a thin bright line still catches an eye. Together they are the idiom
  `ribbonWidthAt` already uses for the far view, and the ink falls with the SQUARE
  of the number: the demo's 0.2 is a twenty-fifth of the coverage. Above 1 is
  refused rather than allowed as emphasis, because a group's width is already a
  caller's number through `setEdgeStyle` and two ways to say how wide a ribbon is
  have no rule for which wins.
  THE CHANNEL BUDGET, which M4.3 asked to be told about and which the obvious
  reading gets wrong: this does NOT spend the one free vertex-buffer slot.
  `maxVertexBuffers` is a PIPELINE limit; the reserved slot is the instanced NODE
  pipeline's seventh of eight, spoken for by M4.6's spring velocity or M4.8's
  picking id; and a ribbon group is a different mesh with a different material and
  its own eight, which went from five to six. The rule worth carrying forward is
  that a slot belongs to the SHADER that reads the attribute, not to the package
  or the scene. Recorded on M4.3 and M4.10 as well as here, in
  `instance-attributes.ts`, in the CHANGELOG and as a `dagr` brain decision event.
  WHAT THE DEMO DOES WITH IT: `edge-highlight.ts` indexes the campaign's edges by
  the nodes they touch, in one pass, and a hover looks up a set. An index here
  where `hover.ts` deliberately scans, because a hit test is over boxes a relayout
  moves and this is over topology a relayout does not touch. The far end of each
  lit edge gets a title from a SECOND `createRichNodes` layer over the same
  overlay, whose tier has no minimum gate and a maximum equal to the title tier's
  minimum, so the two can never both draw and a far end that is already wide
  enough to have its own name does not get a second one. That gate is the
  overlay's own, per frame, which is what keeps it right while a reader zooms with
  the pointer held still.
  THE HIGHLIGHT HAS A LEGIBILITY FLOOR and it is the title tier's gate again: at
  the fitted campaign the pointer crosses hundreds of nodes, none of them a pixel
  wide, and dimming 7,100 edges there would fire on a node the reader cannot see.
  `hover.ts` still answers at every zoom, which is the split that file already
  describes: it owns the geometry and a consumer owns what to do with the answer.
  HOVERING AN EDGE DIRECTLY IS STILL M4.8's, and this changes nothing about that:
  every id here comes from a node hit test, so an edge is reachable through the
  nodes it joins and not by pointing at the line.
  EVIDENCE: `assets/screenshots/d3-quiet.png` against `d3-hover.png`, the same
  camera with the pointer off the canvas and then on the chapter in the middle of
  it, 9 edges lit and 9 far ends named. The capture script learned to hover, and
  it hovers the CANVAS CENTRE, which `#node=` has already made the node's own
  centre: no coordinates to go stale when a layout moves.
  P7's FIVE FRAMES WERE RETAKEN HERE at D2's spacing, which D2 had left as a
  record it could not regenerate. Unlike `m4.2`'s ladder the scene still exists,
  so a committed frame of it that no current build reproduces is the black-canvas
  lesson in slow motion. The counts moved (the finale from eight titles to three)
  and one hash moved with them: `#zoom=1.4` alone framed the scene's CENTRE, which
  at twice the extent is the gap between two tiles, so that frame is anchored on a
  node like every other one. `docs/docs/render.md` now embeds the retaken frames
  and the hover frame, and its quoted zoom floor moved from 0.053 to 0.026.

- [x] **D4** (`docs`, `packages/campaign`) The fixture out of the product docs
  and into its own package. The maintainer's 2026-08-16 message opens with it:
  the demo is awesome and a 361-line "Campaign dataset" page was not meant to
  ship beside Graph model, Layout pipeline and Renderer in the docs sidebar.
  WHAT A SIDEBAR ENTRY CLAIMS is the whole of the argument. `@dagr/campaign` is
  a private zero-dependency fixture that nobody installs, and a page for it in
  the product docs says the opposite: that reading it is part of learning the
  library, and that its 16 node kinds are surface a consumer has to know. The
  three pages beside it document packages a reader will import. So the page
  goes and the knowledge does not: `docs/docs/campaign.md` is deleted and
  `packages/campaign/README.md` absorbs it, which puts the schema, the
  routed/overlay argument, the provenance, the generator's determinism and the
  invariant table next to the code they describe. The README already linked OUT
  to the docs page, so the link is inverted rather than dropped.
  A FIXTURE DOCUMENTING ITSELF is the general rule this records, and it is
  cheap to state: docs pages are for what a reader imports, package READMEs are
  for what a contributor opens. The counts were re-derived by three reviewers at
  P7 and are not worth losing, but they are facts about a generator, and a
  generator's README is where a person goes for them.
  THE FIVE PLACES THAT NAMED THE PAGE: the demo page's lede now names what it
  draws in one sentence and links the package README on GitHub rather than a
  docs page; `docs/docs/intro.md` loses the `@dagr/campaign` row from the
  package table, because a private fixture is not a package the table's reader
  can install, and its live-demo paragraph carries the same one-line pointer;
  the root `README.md` points at `packages/campaign`; and the P7 entry above
  records the move rather than being rewritten to hide it.
  VERIFIED BY THE BUILD: Docusaurus fails on a broken internal link, so a stale
  `./campaign.md` or `/docs/campaign` anywhere in the site is a red build rather
  than a 404 a visitor finds.
  A MOVED PARAGRAPH CARRIES ITS OLD CONTEXT, which is what both reviews of this
  change spent their findings on and is the lesson worth keeping. Every number
  in the page survived the move (four independent derivations against the
  generator now agree on the whole table), and what did not survive is the
  prose around them: the loading example claimed the demo puts the campaign
  record on both ends of every edge, when the stage builds
  `Graph<{ node: CampaignNode }>` and adds no edge attrs at all; the same
  example loops over `campaign.edges` unconditionally, when the stage feeds
  layout one graph per TILE holding only the routed edges whose endpoints are
  both in it, which contradicts this file's own routed and overlay split 130
  lines down; the opening line's "zero dependencies, `@dagr/graph` included"
  read as "ships with" three lines above a block that imports it; and "the demo
  is its only consumer" was written before D1 made `@dagr/campaign-stage` the
  consumer that two hosts mount. None of those was wrong on the page it came
  from in the way it was wrong here.
  THE SIXTH LINK IS THE ONE THE BUILD CANNOT SEE, and a review caught it:
  `/docs/campaign` was live for a day and the published package README pointed
  at it, so a bookmark or an external link to it survives this change and the
  broken-link check cannot know, because it validates links the site still
  contains. `plugin-client-redirects` already carries three entries for earlier
  moves and now carries a fourth, to `/demos/campaign`: the demo is the nearest
  live thing to the deleted page and it is where the pointer to the README is.

- [x] **D5** (`packages/campaign-stage`, `bench/browser`, `docs`) A drawn mark
  per kind, on the title tag and on the card. The second half of the
  maintainer's 2026-08-16 message: "we could add the html overlays and a zoom
  level and show even richer nodes with icons or images maybe." The overlays
  were already there (M4.11 and M4.12 shipped, P6 and D3 consume them), so what
  this adds is what a reader sees in them; the zoom level is D6 below.
  INLINE SVG PATHS AUTHORED HERE, not an icon font and not fetched images. A
  font is a network request the docs site does not otherwise make and a glyph
  table nobody in this repo can read; an image set is twenty files to keep in
  step with a palette that is computed. A path is text: it diffs, it takes
  `currentColor`, it costs no request, and the element a tier builds is one
  `svg` with one `path` whose `d` is rewritten on every bind, which is exactly
  the shape a POOLED element needs. ONE PATH PER MARK, so `create` and `update`
  cannot disagree about how many children an icon has; subpaths inside one `d`
  cost nothing.
  TWENTY MARKS FOR SIXTEEN KINDS, because `location` is one kind and four
  things. `nodeGlyph` takes the NODE and reads the subtype, which is the same
  signature `nodeColor` has and for the same reason recorded there: a lookup on
  the kind alone drew the region's ridge line on all 1,023 rooms while the
  palette drew them in the room's own blue.
  "OR IMAGES MAYBE" IS ANSWERED BY THE SAME MARK AT 44 PIXELS, behind the card's
  rows at 0.09 opacity, and the answer is recorded rather than assumed: a
  picture per node is a raster pipeline for 3,010 generated nodes nobody has
  drawn, in a bundle that already carries a megabyte of three.js, and a picture
  per KIND is sixteen files saying what sixteen paths already say. A dataset
  that SHIPS images can have a real image tier; this one generates its nodes
  from a seed. The watermark is out of flow, so it costs the declared card box
  nothing.
  THE MEASUREMENT DISCIPLINE HELD AND CAUGHT THE ONE REAL DEFECT. The badge's
  mark was first written as an `inline-flex` badge, and `bench/browser/card-heights.mjs`
  reported ALL SIXTEEN KINDS OVER THEIR DECLARED BOX BY EXACTLY 3 PIXELS. A
  uniform miss is not text wrapping: the head aligns its two items on their
  BASELINES, and an inline-flex box takes its baseline from its first flex item,
  which with the mark first is an `svg` and has none, so the badge's baseline
  fell to its bottom edge and the head grew to align it. Left inline, the
  badge's baseline is its text's. Re-measured over 8,946 cards of three seeds
  after the fix: every kind fits at exactly its declared height, so `CARD_SIZES`
  is unchanged and `CARD_MIN_SCREEN_WIDTH` is still 460. The marks cost the card
  gate nothing, which is a measured result and not a design intention.
  THE PROBE IS A HAND COPY AND HAD TO GROW: the harness renders its own markup,
  so the badge mark and the watermark are in it now. The path does not matter to
  a height and one stands in for all twenty; what has to be reproduced is the
  SPACE, and the badge mark is the half that takes 16 pixels out of the head.
  NO MARK ON THE FAR-END LABELS, which is where this stops. Those are
  annotations a hover puts on nodes too small to have earned a name, drawn at a
  zoom where the screen is mostly edges; sixteen more shapes there would label
  nodes the reader did not ask about. The dashed rule already says what they
  are.
  AN SVG ELEMENT'S `className` IS AN `SVGAnimatedString`, so assigning a string
  to it does nothing at all: no class, no rule matches, nothing fails. Same
  silent-drop family as a `style.color` the CSS parser rejects, and the tests
  hold both the namespace and the class attribute for it.
  A RULE PAID FOR BY AN ELEMENT IS NOT A RULE FOR THE TIER WITHOUT THE ELEMENT,
  which is the review finding worth carrying: the title tag went from 22ch to
  24ch to buy room for its mark, and `.campaign-title--far` inherits from
  `.campaign-title`, so the far-end annotations that D5 deliberately gives NO
  mark got the widening anyway and ellipsized two characters later than they
  were tuned for, at the densest zoom this demo draws. Measured at an identical
  186.83px on both before the fix. The far tier states 22ch of its own now. The
  general shape: a selector that carries a justification has to be checked
  against every selector that inherits it.
  THE TREE REVIEW FOUND NO DEFECT AND FIVE STALE NUMBERS, four of them older
  than this task and one of them made visible BY it: `campaign-style.ts` records
  the location-subtype trap as "badged all 750 rooms" one file away from the new
  glyph test recording the same trap as 1,023, which is the count the generator
  actually produces. `tiles.ts` carried ~750 rooms and ~550 NPCs in the argument
  for tiling at all, where the real figures are 1,023 and 375, and repeated 550
  in the grid-tile argument and again in its worked example of the column
  formula. The worked example is now MEASURED off the three real grid tiles (375
  NPCs land in 26 columns at aspect 1.77 against the 1.78 asked for, 300 items in
  22 at 1.92) rather than asserted from a count nothing produces.
  `packages/render/src/rich-nodes.ts` described the demo's card gate as "about
  160", which is the number `CARD_MIN_SCREEN_WIDTH`'s derivation exists to
  replace, and described three tiers where D3 added a fourth on a second layer.
  And `FirstLight.tsx` claimed its hover lookup costs "one lookup per CHANGE of
  hovered node", where `applyHovered` runs a `querySelector` on EVERY drawn
  frame, deliberately, because pooled elements make caching one wrong; the
  comment 30 lines below it already said so, so the file stated both.
  THE FOUR DIFF-REVIEW FINDINGS WERE COMMENTS DESCRIBING DECLARATIONS THAT WERE
  NOT THERE, in a codebase where the comment is the spec. Three claimed a `display`
  or a `flex` this stylesheet never writes: the badge is a flex ITEM, so its
  used display is `block` whatever a `span` starts as, and it contributes its
  own line box's baseline, which is the text's; the marks are `inline` by SVG's
  own initial value, and what actually holds their size is the width and height
  a REPLACED element needs (drop those and a mark falls back to 300 by 150). The
  fourth was in the harness: its `position: relative` override was justified as
  containing the watermark, which the stylesheet's own `absolute` already does,
  when what it really does is take 8,946 cards out of absolute positioning so
  each lays out at its own height. Every one of them would have sent the next
  editor somewhere wrong while the code kept working.
  EVIDENCE: the committed frames are retaken, and the retake IS the comparison,
  because the frames they replace are the before. `p7-campaign-fit.png` came out
  byte identical, correctly: there is no overlay at all at the fitted zoom. The
  tier counts and both caption files are unchanged, so the drawing is the same
  drawing with marks in it. `docs/docs/render.md` takes the card tier's own
  argument further with them: a mark is one attribute the tier rewrites per
  node, and the same picture through a glyph atlas would be a second rasteriser.

- [x] **D6** (`packages/campaign-stage`) The zoom as something a reader can read
  and press. The last clause of the maintainer's 2026-08-16 message, "we could
  add the html overlays and a zoom level".
  THE READOUT ALREADY HAD THE NUMBER, and it still does: the px/unit figure is
  on screen twice now, deliberately. The readout is the CAMERA'S STATE, and it
  exists so a screenshot's caption can be checked against the frame it claims to
  be; the control is the same number where a reader can act on it, next to the
  word that says what acting would buy. `zoom 6.199 px/unit` has been on screen
  since M4.1 and it says nothing a reader can act on. It does not answer "would one more notch put
  names on this", which is the only question a zoom raises in a demo whose whole
  subject is semantic zoom. So the control pairs the number with the TIER, and
  the tier is the word that changes as you scroll: `shapes`, `names`, `cards`.
  A TIER IS PER NODE AND A ZOOM IS ONE NUMBER, so anything reporting a tier has
  to say which node it means. The campaign's node widths span 11:1, from a
  clock tick at 32 to the campaign node at 360, against tier gates that span
  19:1 from 24 to 460, so at almost every zoom some kinds have cards and some
  have nothing, and naming the largest or the smallest would describe one node
  in three thousand.
  `medianNodeWidth` over the scene's own boxes is true of half of them by
  construction and lands on 56 world units, a room and an item, which are the
  two most numerous kinds. DERIVED FROM THE SCENE rather than declared, for the
  reason every other derived number here is, and MEMOISED on the scene because
  `publish` calls `setReadout` from every drawn frame and a median is a sort of
  3,010 numbers.
  THE BUTTONS PRESS KEYS. `keyCommand` now returns three exported constants,
  `ZOOM_IN`, `ZOOM_OUT` and `FIT`, and the buttons hand those same objects to
  the same `applyCommand` the keydown handler runs. One path to the camera, one
  anchor rule (a zoom with no cursor is anchored at the viewport centre, which a
  button needs exactly as a key does), and nothing to keep in step when
  `KEY_ZOOM_FACTOR` is retuned. THE TEST ASSERTS IDENTITY, `toBe` and not
  `toEqual`: two literals holding the same factor pass a shape comparison on the
  day they are written and go on passing after one is retuned.
  THEY DO NOT TAKE FOCUS, and that is the load-bearing line rather than a
  nicety. Focus is this stage's keyboard mode switch: the canvas has to be
  focused for arrows to zoom rather than scroll the page. A button that took
  focus on click would be a zoom control that breaks zooming by keyboard, which
  is the feature it is a control for. `onMouseDown` prevents the default, so the
  pointer never moves focus; Tab still reaches the buttons for anyone driving
  without one. Verified in a browser: click the canvas, click `+`, and
  `document.activeElement` is still the canvas, with the next ArrowUp moving the
  zoom by the same factor the button did.
  GREYED AT THE LIMITS, which are the camera's own derived ones, with a relative
  tolerance because the camera CLAMPS: a zoom held against the ceiling IS the
  ceiling to within floating point, and a strict comparison would leave a button
  that can do nothing looking as though it could. The tolerance is a thousandth,
  far under one keyboard step of about 16%, and a test holds that relationship
  rather than the number. `aria-disabled` AND NOT `disabled`: the real attribute
  arriving under a keyboard user's finger is a focus loss, since Tab to `+` and
  Enter to the ceiling makes the element being stood on disabled, which every
  browser answers by moving focus to the body and restarting the next Tab at the
  top of the document. The greying is a rule on the attribute and the click is
  ignored by the handler.
  THE PANEL REFUSES THE POINTER AND ITS THREE BUTTONS TAKE IT BACK, which is the
  readout's `pointer-events: none` with a hole cut in it. A panel that took
  pointer events would eat the wheel over the corner a reader puts the cursor in
  when they want to zoom, and the gesture would scroll the host docs page away
  from the demo instead. THE WHEEL LISTENER MOVED TO THE STAGE for the half that
  does not fix: a button is the canvas's SIBLING, not its descendant, so a wheel
  over one reaches no canvas listener at all whatever the panel's
  `pointer-events` says. Bound to the container it is one listener's problem,
  and the anchor still comes off the canvas rect.
  WHAT IS TESTED IS THE ARITHMETIC: the tier against both gates and the
  half-open rule, the median against a synthetic list and against the real
  campaign (asserting the median IS some kind's width rather than a number
  between two), the limit states, and that the range reaches every tier. The DOM
  half is three buttons handing a command to a function, and a test that
  asserted a button called a mock would pass just as happily if the camera never
  moved. Verified in a browser instead, which is the same split `FirstLight`
  already documents.

## Tracked, not promised

Web-component wrapper, 3D camera experiment, Remotion tutorials, npm publish
(human-gated).
