# Independent prerequisite pair: initial evaluation

2026-11-18. Fresh authors used Claude opus, medium effort per coordinator.
Both initial hash manifests verified unchanged. No repairs or author feedback.
Evaluator knows arm labels and has read the skill/pilot: unblinded agent
self-evaluation, not human learner evidence.

## Frozen rubric scores

| Initial arm | Grounding | Edges | Rich summaries | Details/examples | Search | Accessibility |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | 2 | 1 | 1 | 2 | 1 | 1 |
| Guided | 2 | 1 | 1 | 2 | 2 | 1 |

Grounding: inspected concept claims largely restate supplied README/types with
source paths. Baseline teaches via points, code and self-check questions;
guided adds explicit explanation/why sections, code-example provenance and
keywords. Guided renderNode advice also draws on the supplied skill, with
example note acknowledging that reference. API/doc descriptions are evidence
of documented behavior, not fresh validation of each described feature.

Edges: both state prerequisite-to-dependent direction. Baseline has unlabeled
edges and nav groups "Learn first"/"Builds on this"; guided labels edges
"needed for" and includes reasons in connection buttons. Both include
Group-to-View despite groups being optional. These would be clearer as a
suggested learning sequence or optional branch rather than strict prerequisite
requirements. Baseline also presents layout as a prerequisite to errors,
although validation can run without layout. These are pedagogical choices,
not API requirements established by the sources.

Rich summaries: present in both, but full-node/all-view clipping coverage is
not complete. Baseline has a 23-node initial path with default sizes; guided
starts with 9 nodes and splits other questions into views. This is a graph
observation, not a learning-outcome metric.

Search: baseline indexes label/stage/summary, excluding explanation points
and code. Guided includes id, kind, summary, explanation and keywords. A
static evaluation of their exact searchText expressions for the domain query
MISSING_EDGE_ENDPOINT returns no baseline node and guided explorer-edge in
the initial view. The concept exists with that error text in baseline details,
so this is a content-discovery gap, not missing content. The ordinary Install
query is browser-verified in both arms. It yields different first matches:
baseline Install and requirements, guided React 18 or 19 host because its
explanation mentions installation. The harness takes first match consistently.

## Initial compile, build and behavior

Separate consumer-initial copies, published Explorer 0.2.0, React 19.2.0,
TypeScript 5.9.3, Vite 7.1.12. Both strict tsc and Vite production builds exit
0, with logs and exit files retained. No initial compile/build error or repair.

prerequisites-structure-results.json records unique node/edge IDs and valid
endpoints in every view: baseline 23/10/13 nodes, guided 9/9/9/4/20 nodes.

Four headless Chromium flows: both arms, 1280x800 desktop and 390x844 touch
emulation, scale 2 and reduced-motion enabled. Search Install, inspect, follow,
close, empty search, keyboard inspect, Escape and Outline all completed.
No page errors or document horizontal overflow. Focus after close returned to
the original search result in all cases. Followed baseline to The required
label, guided to Install and stylesheet. Screenshots and JSON record these
actual paths. Browser/context/server closed under shared compute protection.

## Limits and interpretation

No human learner, screen-reader or real-device study. Contrast, all-view
clipping, keyboard connection-follow, progress/answer controls, view switching,
next-concept navigation and reduced-motion behavior were not fully asserted.
Baseline progress is in-memory state; its correctness was not claimed.
Accessibility credit remains partial. Full-page screenshots show content after
follow, not every part of the scrollable detail body.

Guided has more searchable explanatory content and a smaller initial view;
baseline already has substantial lesson details and checks. Neither output
establishes learner success or a causal effect from the skill. Keep originals
unchanged, wait for process pair before overall improvement decision, and use
separate repair copies/diffs if later corrections are requested.
