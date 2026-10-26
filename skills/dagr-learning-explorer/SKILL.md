---
name: dagr-learning-explorer
description: Build or improve a Dagr Explorer that teaches a system, concept, or process through rich nodes, meaningful relationships, and readable details. Use for agent-authored learning graphs, codebase maps, and explanatory walkthroughs, not unrelated graph-layout or GPU optimization work.
license: MIT
---

# Build a graph a reader can learn from

Start from the learner's question and the supplied source material. Decide what
relationship the graph should explain before choosing nodes. A useful graph
lets someone explain a relationship or follow a process, not just name boxes.

## Ground the content

- Give each concept a stable semantic ID. Label edges with their actual
  meaning and direction, such as "requires", "emits", or "stores in". State
  the direction convention; do not silently reverse prerequisites or flow.
- For explanatory nodes, include a concise summary, a fuller explanation, an
  example where useful, and source references when evidence exists. Mark
  invented examples and uncertainty. Do not invent citations or turn a
  layout position into a factual claim.
- Keep related data on one typed node/edge model. Use views for a learner's
  questions (overview, one process, prerequisites), retaining IDs for the same
  concepts across views. Cycles are allowed; do not imply the input is a DAG.
- Prefer a small, legible first view and progressive detail over a dense
  inventory. A label-only graph is appropriate when requested, but rich
  explanatory content is the default for a learning Explorer.

## Use the shipped Explorer API

Check the consumer's installed version and types before coding. The example in
[references/learning-explorer.tsx](references/learning-explorer.tsx) uses the
public API present in Dagr 0.1.4. Adapt it to the requested content and host;
do not assume unreleased roadmap features exist.

- Extend `ExplorerNode` and `ExplorerEdge` with domain fields. Pass `nodes`
  and `edges`, or `views`, to `DagrExplorer`, with a meaningful `label`.
- Provide `renderNode`: summary tier shows a readable label; rich tier adds
  a short explanation or key fact. The mark tier is drawn by the base layer.
  Declare node dimensions through `size` or `layout.nodeSize`; layout does
  not measure DOM content. Check overflow at the declared size.
- Node content sits inside Explorer's node button. Keep `renderNode`
  noninteractive: put source links, examples, actions and connection buttons
  in `renderDetails`. Do not nest links or buttons inside node buttons.
- Details should answer "what is it?", "why does it matter?", and "what is
  connected, and how?" Use `connections` and `follow` from the details slot
  instead of maintaining another adjacency list or selection store. If you
  replace the default connections, retain incoming/outgoing meaning.
- Add useful domain terms to `searchText`. Keep explanations and relationships
  available outside hover. Essential learning content must be reachable by
  search and details without precise graph panning.
- Import `@prnt/dagr-explorer/styles.css` unless the host intentionally owns
  all styling. Scope host styles and theme through the exported CSS variables.
  Explorer currently uses SVG/DOM by default, not WebGPU. Its `base` seam is
  experimental; do not select a different backend just because a screen is small.

## Check the reading experience

Exercise search, inspect, follow a connection and close details with pointer,
keyboard and a phone-sized touch viewport. Verify focus return, readable
content, contrast, page scrolling around the graph and reduced-motion behavior.
Capture the flows you actually exercised; separate device emulation from a
real-device check. Do not claim mobile support from a narrow screenshot alone.

On narrow hosts, compose public parts under one `ExplorerRoot` if needed;
`useExplorer` and `useExplorerApi` share state and commands. Do not create a
second graph dataset, search implementation or selection store for a mobile
version. A first-class outline reader and adaptive library details are planned,
not current public components. Avoid presenting proposed names as imports.

Before delivery, typecheck the integration against the installed package,
verify edge endpoints/IDs and any cited sources, and ask whether a reader can
find a concept, explain one relationship, and reach its supporting detail.
Keep graph and node counts a performance observation, not a learning metric.
