# Independent codebase pair: initial evaluation

2026-11-18. Author sessions: baseline agt_32615f171976, matching guided session
coordinated by parent. Both Claude opus, medium effort according to coordinator.
Evaluator knows arm labels and has seen pilot defects: unblinded agent scoring,
not independent human learner evidence. No feedback sent to authors. Both
initial file manifests verified unchanged before evaluation. No repairs made.

## Frozen rubric scores

| Initial arm | Grounding | Edges | Rich summaries | Details/examples | Search | Accessibility |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | 2 | 1 | 1 | 1 | 2 | 1 |
| Guided | 1 | 1 | 1 | 2 | 2 | 1 |

These are evaluator judgments with evidence below, not efficacy or learner
success measurements. No total is calculated.

Baseline grounding: package descriptions, dependency fields, versions and
export targets agree with supplied manifests on inspection. Source filenames
appear in details. Tour/quiz provide extra teaching support outside details.
Most graph edge labels are version ranges rather than relation meanings;
direction is explained and connection buttons recover dependency semantics.
The generic details sentence also treats exports like dependency declarations
("Declares ... in exports"), a weaker explanation for entry-point relations.
Details largely present summary plus raw manifest facts. There are no worked
illustrative examples. Search covers label, summary and fact values.

Guided grounding concerns (codebase-data.ts):
- graph.whyItMatters calls graph the one Dagr package here needing no other
  Dagr package. The render manifest also declares no Dagr dependency or peer.
- render.explanation calls render the only package with two exported entry
  points, while explorer also exports root and styles.css. If JavaScript
  entries alone were meant, the text does not qualify that distinction.
- The flow view describes scripts "in the order a change travels". Manifests
  declare individual scripts and export/file fields, not an ordered workflow
  or proof of publication. Several edges are correctly marked inferred, but
  src-to-checks and publication statements are not consistently qualified.
- build.explanation/whyItMatters asserts consumer usability only after this
  build step. The unavailable tsconfig and manifest entry paths support an
  inference, not that exclusive claim. build-writes-dist is explicitly marked
  inferred, which helps but does not settle the node's stronger wording.

Guided details do improve the structure: explanation, why it matters,
uncertainty, source field paths and illustrative examples on applicable stage
nodes. Incoming/outgoing connections retain source-to-target sentences.
Search includes explanations and domain terms. Rich summaries are present
in both arms; complete clipping/readability coverage across all nodes and
views was not performed, so neither receives complete rich-summary credit.

## Identical consumer checks

Both initial arms copied into separate consumer-initial directories. Shared
published dependencies: Explorer 0.2.0, React 19.2.0, TypeScript 5.9.3,
Vite 7.1.12. Strict compilation, skipLibCheck false, vite/client CSS types.
Both tsc and production Vite build exit 0. Logs/exit files preserved per arm.
No content or API repair was necessary.

Four headless Chromium flows passed: each arm at 1280x800 and 390x844 touch
emulation, scale 2, reduced motion enabled. Search graph, pointer inspect,
follow to Explorer, close, empty search, keyboard inspect, Escape and outline.
No page errors or document horizontal overflow. Close returned focus to the
Graph search-result button in all four runs. Screenshots capture follow and
outline. Browser/context/server closed under shared compute lifetime wrapper.

Accessibility remains partial: keyboard connection-follow, contrast ratios,
all-view clipping, narrow details scrolling and reduced-motion behavior were
not fully asserted. No real-device, screen-reader or human learner test.
View switching and baseline tour/quiz interactions remain unexercised; do not
infer their success from the default-view flows.

## Interpretation and next work

The guided output has fuller teaching details but adds unsupported claims;
compile/UI success does not verify those claims. One pair with an unblinded
evaluator does not establish incremental skill effect. Wait for the remaining
four initial outputs before deciding evidence-led canonical improvements.
Preserve these originals; any later repairs require separate copies/diffs.
