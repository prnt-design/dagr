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
  produces and M2.8 could then legitimately emit two points, and a rule that has
  to be withdrawn is worse here than one never claimed.
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
  the cap curve two entries up and which applies with more force to a table that
  M2.8 will move again: they live in the transpose section of `barycenterOrder`'s
  docstring, the two bench-corpus rows are pinned in `layout.transpose.test.ts`,
  and `docs/docs/layout.md` carries the reader-facing copy. Three places is the
  standing cost; a fourth would make it four.
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
- [ ] **M2.8** Edge routing: polyline routes through dummy-node coordinates,
  monotone in the rank axis. Route invariant tests.
  From the M2.1 algorithms review: `bounds` had to stop being the hull of the
  node boxes, because a route that goes around an obstacle can leave them. The
  runner contracts containment rather than tightness for exactly that reason.
  M2.4b adopted the durable formulation early (the hull of the node boxes and
  the route points), because a route bending through a zero-width dummy can
  already leave the box hull, so nothing here changes when obstacle detours
  land.
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
milestone's planning review and both placed on the task that owns them: M2.4b's
dummy ids must be a deterministic function of edge and rank, and M2.3's network
simplex must be warm-startable. Neither is retrofittable from inside M3. If
either lands without its requirement, say so here rather than working around it,
because both defeat stability in ways the node-displacement metrics cannot see.
M2.3 landed with its half: `networkSimplexRank({ initialRanks })` takes the
previous run's ranks, and a rank-stability test alongside the sum test proves it
does something, because the same perturbation moves a node a whole rank without
it.

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
