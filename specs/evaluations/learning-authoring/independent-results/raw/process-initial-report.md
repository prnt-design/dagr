# Independent process pair: initial evaluation

2026-11-18. Fresh Claude opus/medium sessions per coordinator launch export.
Evaluator knows arm labels. All original hashes verified; no repairs made.
Protocol difference: guided author ran a static Python quote/endpoint check
before saving initial (28 quotes), unlike baseline's reported no checks.
Do not call these identical author checking conditions or zero-execution runs.

| Initial arm | Grounding | Edges | Rich summaries | Details/examples | Search | Accessibility |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | 2 | 1 | 1 | 2 | 2 | 1 |
| Guided | 2 | 1 | 1 | 2 | 2 | 1 |

Grounding: both provide source quotations, locators, commands and explanations.
Evaluator whitespace-normalized quote comparison found all 34 baseline and
28 guided quote entries in supplied source. Quote fidelity does not verify
all paraphrases or process edges. Both richly explain required checks, PR
reviews, CI outcomes and blocking. Commands serve as concrete source examples.

Edges: baseline intentionally makes the workflow acyclic, documenting the
red-CI return in text but omitting a red-fix-to-CI edge. Guided preserves that
loop and the reinstall-to-gate loop, a useful content difference. Both include
a main-advances node leading directly to CI again, bypassing a drawn path
through frozen install and local gate after that rebase brings changes. Source
step 2 applies to rebases bringing changes, so a reader following only these
edges can skip required work. Baseline has several unlabeled edges; guided
labels every edge and explicitly states source-label-target direction.
Baseline guardrails view has no edges; guided connects rules to governed steps.

Rich summaries exist and node sizes are declared. Complete clipping coverage
across all nodes/views remains unverified, so scores stay partial. Search
includes explanations/commands in both; guided adds terms and why-it-matters.

## Executed initial checks

Separate untouched consumer copies, identical published Explorer 0.2.0,
React 19.2.0, TypeScript 5.9.3, Vite 7.1.12. Both strict tsc (skipLibCheck
false, vite/client) and production builds exit 0; logs retained. No repairs.
Unique node/edge IDs and valid endpoints in all views. Baseline view counts
14/7/6/7 nodes; guided 11/7/5/8. These are graph counts, not learning metrics.

Four headless Chromium flows, desktop 1280x800 and phone 390x844 with touch
emulation, scale 2, reduced-motion enabled. Search gate, inspect, follow,
close, empty search, keyboard inspect, Escape and outline succeeded. No page
errors or horizontal document overflow. Close returned focus to the local-gate
search result. Follow reached Rebase in baseline and Reinstall in guided.
Browser/context/server closed under shared compute protection. Screenshots
and process-browser-results.json preserve these paths.

No real device, screen-reader, human comprehension, full contrast, all-view
clipping, keyboard connection-follow or reduced-motion behavior verification.
Accessibility scores remain partial. The two arms differ in details heading
levels (baseline h2, guided h3); harness uses the first details h2/h3 for both.
This selector accommodation is evaluator code, not a content/API repair.

## Interpretation

Guided better represents the red-CI retry loop, but both miss an update-path
requirement. All quotes match and all consumers compile, yet graph semantics
still need path tracing. This supports a narrow grounding/path-check addition
to guidance; it does not establish causal skill effectiveness or learner success.
