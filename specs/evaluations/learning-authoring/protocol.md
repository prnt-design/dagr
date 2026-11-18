# Learning authoring evaluation protocol

Recorded before outputs, 2026-11-18. Base: ccb66cad9dfc3baf650d65338e2bb2ae6c38aae2.

This is a bounded same-agent, same-context comparison, not an independent or
randomized experiment. The author has already read the skill, so baseline
outputs can be contaminated. Scores are agent self-evaluation, never human
learner evidence. No causal claim about skill effectiveness is warranted.

## Material and briefs

Use only public repository material at the base above: package manifests,
README.md, AGENTS.md and the Explorer reference example. No private sources.
Both conditions receive identical source excerpts and public 0.2.0 types.

1. Codebase map: explain graph identity, layout, rendering and React Explorer
   ownership using the public package descriptions. Do not infer runtime call
   order from package ownership.
2. Prerequisite lesson: teach how typed nodes, edges and the Explorer compose.
   Distinguish conceptual prerequisites from imports and runtime data flow.
3. Process walkthrough: teach the documented local gate, rebase, PR and CI
   path. Include the rebase-install-rerun branch and red-CI repair loop.

Baseline instruction: Build a small Dagr learning Explorer for this brief from
these sources. Guided instruction adds the canonical learning skill and its
reference. Preserve all six initial outputs before repairing compile or UI
failures; retain repair diffs and error logs. Do not intentionally weaken the
baseline. Use a shared neutral host for all outputs.

## Rubric and checks

For each condition and brief, score each dimension 0 (absent/incorrect),
1 (partial), or 2 (complete and source-supported): factual grounding with
traceable references; edge semantics and explicit direction; rich summaries;
details with explanations and marked illustrative examples; useful search;
accessible reading and connection navigation. Record concrete evidence per
score, rather than treating totals as learning outcomes.

Compile all six outputs against published @prnt/dagr-explorer 0.2.0 in an
external consumer, strict TypeScript with vite/client CSS types. Check IDs and
endpoints. In headless Chromium, exercise search, inspect, follow and close
with pointer and keyboard at desktop and phone-sized touch emulation; capture
screenshots, console errors, overflow and focus return. Check outline reading
and reduced motion. Distinguish static inspection from executed behavior.
Close browser and server when finished. Shared compute window covers their
entire lifetime. Emulation is not real device validation. Screen reader,
human comprehension and learner success remain unverified unless performed.

Only observed failures justify narrow canonical skill/example edits. A
no-change decision is valid. Distribution discovery was verified in PR192
and is outside this evaluation. No runtime, vendor copies, bundling, version,
publish configuration or protected-file changes. Full local five-command gate
and current-main CI precede parent diff/tree review clearance and merge.
