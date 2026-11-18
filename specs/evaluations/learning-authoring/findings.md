# Findings, 2026-11-18

## Decision

Keep the canonical skill and reference unchanged. This run demonstrates that
six content variants can use the published 0.2.0 API, but cannot attribute any
improvement to guidance. The baseline was contaminated by prior skill exposure;
identical outputs were retained rather than constructing an artificially weak
control. A fresh-context authoring study and human learner study remain useful
follow-ups, not verified outcomes of this run.

## Agent rubric

Scores apply equally to baseline and guided. They are author self-evaluation.

| Brief | Grounding | Edges/direction | Rich summaries | Details/examples | Search | Accessibility |
| --- | --- | --- | --- | --- | --- | --- |
| Codebase | 2 | 2 | 2 | 1 | 2 | 1 |
| Prerequisites | 2 | 1 | 2 | 1 | 2 | 1 |
| Process | 1 | 2 | 2 | 1 | 2 | 1 |

Evidence: codebase package descriptions and Explorer dependency manifest support
ownership and dependency statements, without claiming renderer backend use or
runtime order. The prerequisite graph explains data references, but lacks a
clear conceptual learning sequence. Process includes conditional install and
red-CI loops, but omits main advancing while a PR is open. All nodes have rich
summaries and searchable explanations. Details repeat summaries and use study
questions instead of worked examples. Source paths are visible in details;
these are public repository references, not invented external citations.

## Executed checks

An external npm consumer installed @prnt/dagr-explorer 0.2.0, React 19.2.0,
TypeScript 5.9.3 and Vite 7.1.12. Strict tsc (skipLibCheck false, vite/client)
and Vite production build passed. All six initial datasets compile through the
same typed host. No repair to content was required. IDs and endpoints were
inspected against each dataset.

Playwright 1.58.2 headless Chromium ran twelve flows: all six variants at
1280x800 and 390x844 with touch emulation, device scale 2, reduced motion.
Each exercised search, pointer inspect, follow connection, close, empty search,
keyboard inspect, Escape and Outline. browser-results.json records zero page
errors, No matches for the empty query and no document horizontal overflow
in every flow. Browser contexts, browser and server were closed in finally.
Screenshots were shared through Dispatch. The screenshot named search captures
the details after following, not the initial search results.

The first queued browser invocation was cancelled before lock acquisition;
source inspection corrected a combobox selector to searchbox before execution.
This was a harness correction, not an observed product failure. No other
compile or browser failures occurred.

## Limits

These are agent task completions, not learner success. No real-device,
screen-reader or human comprehension study was performed. Keyboard focus return,
contrast ratios, rich-tier content clipping and page scroll behavior were not
asserted, so accessibility receives partial credit. Reduced-motion emulation
was enabled, but animation behavior was not measured. The host uses the default
map/outline control, not custom responsive state. No distribution study, npm
bundling, library runtime change or publication was performed.
