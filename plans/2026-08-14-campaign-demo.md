# The campaign demo: a mock D&D campaign as the dataset

**Date:** 2026-08-14
**Status:** proposed, awaiting maintainer direction
**Branch:** `agt_9ac0d2019def/more-interesting-demo`
**Asked for by:** Nii, 2026-08-14, in session. The research behind the schema
and the scale numbers is shared as Dispatch media
(`campaign-schema-research.md`); its load-bearing numbers are restated here so
this plan stands alone.

## What

Replace the demo's test geometry with a real dataset: a deterministic mock
D&D campaign of roughly 2,900 nodes and 7,000 edges (arcs, chapters, scenes,
locations down to keyed rooms, NPCs, factions, quests with branch-and-merge
outcomes, clues, items, weather and condition modifiers), laid out by
`@dagr/layout`, drawn by `@dagr/render`, explorable by pan and zoom from the
whole campaign down to a single readable card.

Two interaction changes ride along, and they are independent of the dataset:

1. When the canvas has focus, keys that would scroll the page zoom instead.
2. Zoom limits come from the content, not constants: zooming out stops where
   the whole graph is in frame with padding, zooming in stops near a single
   node filling the view.

## Why

The current scene is M4.2's crispness ladder: six shapes that exist to prove a
shader claim. It proves the renderer and says nothing about why anyone would
want a graph engine. A campaign is a genuinely graph-shaped domain with
thousands of nodes, a real hierarchy, real cross-links, and content worth
reading when you get close, which is exactly the pan-and-zoom-through-a-large
-structure workload Dagr exists for. It also serves a concrete consumer: a
standardized campaign schema for an AI-assisted D&D system is a real project a
friend of the maintainer is building, so the schema is not decoration.

Nothing on the roadmap gives the demo a dataset. M4.4 says "a real graph on
screen" and means real coordinates, not real meaning; M5.3 says "animated
living demo" and is unspecified. This plan is the specification both of those
were missing.

## What published campaigns look like

The numbers that calibrate the mock, from the research report (sources linked
there):

| Module | Structure | Scale |
| --- | --- | --- |
| Curse of Strahd | 15 location-chapters, each a sandbox | Castle Ravenloft alone has 88 keyed areas; 80 to 100 named NPCs |
| Waterdeep: Dragon Heist | 4 plot chapters + 4 villain lairs, 8 factions | ~51 stat blocks in the appendix |
| Lost Mine of Phandelver | 4 parts, hub town + radiating sites | ~12 named NPCs in Phandalin, 5 site maps of 8 to 20 areas |

Rule of thumb: one 256-page hardcover is 10 to 15 chapters, 150 to 250 keyed
locations, 50 to 100 named NPCs, 100 to 200 encounters, 5 to 10 factions. So
2,000 to 5,000 nodes is a two-to-four-hardcover mega-campaign: large enough to
justify the project, still honest about what campaigns contain.

Six structural patterns recur across published modules and DM design theory
(the Alexandrian's node-based design, pointcrawls, Dungeon World fronts), and
the generator reproduces each deliberately: the linear chain, the
branch-and-merge quest DAG, the clue web with three-clue redundancy, the
hub-and-spoke sandbox, the jaquaysed dungeon full of loops and secret doors,
and the faction front with countdown clocks. A viewer panning across the graph
should be able to see these shapes, because they are the point of drawing it.

## The schema

Node kinds (15): `campaign`, `arc`, `chapter`, `scene`, `encounter`,
`location` (subtype region, settlement, building, room), `npc`, `faction`,
`quest`, `quest_step`, `clue`, `item`, `front`, `clock_tick`, `statblock`,
`condition_modifier` (weather, time of day, terrain state).

Edge kinds, grouped by role, because the groups get different treatment in
layout and rendering:

| Group | Kinds | In layout? |
| --- | --- | --- |
| Hierarchy | `contains` (a strict forest) | yes, ranks the drawing |
| Narrative flow | `next`, `branch_on` (carries `{outcome, check}`), `merges_into` | yes |
| Traversal | `leads_to` (typed: road, door, secret, one-way), `entry_point` | yes, cycles broken |
| Dependency | `requires`, `unlocks`, `rewards` | yes |
| Investigation | `contains_clue`, `points_to` | no, overlay |
| Social | `member_of`, `leads`, `ally_of`, `hostile_to`, `knows` | no, overlay |
| Reference | `uses_statblock`, `located_at`, `gives_quest` | no, overlay |
| Pressure | `advances_clock`, `triggers`, `interrupted_by` | no, overlay |

Every node carries `{id, kind, name, one_line, description, tags, gm_secret}`,
and each kind adds its card fields: a scene has a trigger, monster refs with
counts, DC checks whose outcomes are its `branch_on` edges, and active
modifiers; an NPC has a faction, an attitude, a secret, and the quests it
gives; a front has its doom and a clock at n of m segments. The card is the
schema made visible, which is what makes zooming in worth doing.

## The generator

A seeded, deterministic generator, not a committed JSON blob. 2,800 nodes of
card text serialize to several megabytes; the generator is a few kilobytes of
code and some syllable tables, runs in milliseconds at startup, and the same
seed reproduces the same campaign byte for byte, which keeps screenshots and
future benchmarks reproducible. One scale knob (rooms per dungeon, NPCs per
settlement) moves the total across 2,000 to 5,000 without distorting ratios.

Target composition at the default seed, following the hardcover proportions:

| Layer | Nodes | Shape |
| --- | --- | --- |
| Spine | ~380 | 1 campaign, 4 arcs, 16 chapters, ~120 scenes, ~240 encounters |
| Geography | ~880 | 6 regions, 24 settlements, 96 buildings, ~750 rooms; one 88-room finale dungeon |
| People | ~565 | ~550 NPCs, 12 factions with attitude matrix |
| Quests and clues | ~400 | 60 quests, ~220 steps in branch-and-merge DAGs, 40 revelations x 3 clues |
| Pressure | ~75 | 12 fronts with 4 to 6 clock ticks each |
| Items and state | ~475 | 300 items, 130 shared statblocks (Zipf-reused), 45 condition modifiers |

The structural claims are tested as graph invariants, not eyeballed:
`contains` is a forest, every mandatory revelation has clue in-degree of at
least 3 (the Three Clue Rule as an assertion), 70% of quest branches merge
within two steps, room graphs carry the loop and secret-door quotas, and the
per-kind counts sit inside the bands above. This doubles as the first corpus
of *meaningfully shaped* data the engine has; the bench corpora are random.

Where it lives: a new private package, `packages/campaign` (`@dagr/campaign`,
private, unpublished). Not in `apps/demo`, because the docs site already ships
the engine for its live landing-page demo and will want this dataset next, and
a package is how two apps share code in this workspace without one importing
across the other's `src`.

## The camera

**Content-derived limits.** `Camera2D` takes `minZoom` and `maxZoom` at
construction and they are immutable; the demo hard-codes 0.1 and 100, chosen
for the ladder's screenshot obligations. Both facts stop being right when the
content decides. New camera API:

- `fitBounds(bounds, padding)`: center on the bounds and set the zoom that
  fits them, padded. Pure arithmetic on state the camera already has.
- `setZoomLimits(min, max)`: rebind the limits, clamping the current zoom
  into the new range. Needed because the fit zoom depends on the viewport, so
  a window resize recomputes the limits; construction-time limits cannot do
  that.

The demo then derives, and re-derives on every viewport change:

- zoom-out limit: the `fitBounds` zoom of the whole layout at 5% padding.
  Zooming out never shows less than the entire campaign comfortably framed.
- zoom-in limit: the zoom at which the median node spans about half the
  viewport's short side. That is "almost an individual node level": one card
  readable and centered, its neighbors still peeking in at the edges.

`#zoom=` keeps working, clamped into the derived range as it is today.

**Keyboard zoom on focus.** The canvas becomes focusable (`tabIndex=0`, a
visible focus ring). While focused: `ArrowUp` and `=` zoom in one step,
`ArrowDown` and `-` zoom out, `PageUp` and `PageDown` take three steps,
`ArrowLeft` and `ArrowRight` pan, `0` fits the whole graph, `Escape` blurs.
One step is one wheel detent's factor (about 16%), so holding a key repeats
into a smooth glide and the wheel and the keyboard agree on speed. Key events
`preventDefault` only while the canvas is focused, so page scrolling is
untouched otherwise. All of this is arithmetic plus a key map, so it lives in
`camera-input.ts` where the wheel arithmetic already is, and is tested the
same way.

## Layout: tiles, not one ribbon

One Sugiyama pass over the whole campaign produces a ribbon, and this is the
plan's biggest technical risk, so it is settled here. Ranking 2,800 nodes by
hierarchy depth puts ~750 rooms and ~550 NPCs into a couple of ranks: at
default spacing that is a drawing on the order of 100,000 world units wide and
under 2,000 tall. Zoomed to fit, a 50:1 ribbon is a horizontal line on a 16:9
viewport, and the "whole campaign in frame" zoom limit would frame nothing
legible.

So the demo composes layouts instead of running one: each chapter's narrative
subgraph and each region's location subgraph is laid out separately by
`@dagr/layout` (in the worker M2.10 shipped, one `layout` call per tile), and
the resulting blocks are shelf-packed into a roughly 16:9 canvas with the
spine and cross-tile edges drawn between blocks. This is more honest than it
is a workaround: chapters and regions are how DMs actually chunk a campaign,
the tiling showcases the engine running dozens of real layouts, and the
packer is ~50 lines of pure, testable arithmetic. Cross-tile edges are drawn
as straight or lightly curved overlay lines rather than routed through the
Sugiyama pipeline, which only ever sees one tile at a time.

Edge kinds marked "overlay" in the schema table stay out of layout entirely:
clue, social, reference and pressure edges are dense and cyclic, and feeding
them to crossing reduction buys nothing a viewer can read. They render only
above a zoom threshold, or for the hovered or selected node, which is also
what keeps the far view from being a hairball.

## Rendering: the path through M4

The renderer today draws six meshes, one per shape. The campaign needs the
three M4 tasks that were already on the roadmap, now with a concrete consumer
and in this order:

1. **M4.3 instancing**, unchanged in scope: 2,800 nodes cannot be 2,800
   meshes. The campaign adds a per-instance color, which M4.3's per-instance
   attribute work covers. Nodes get a color per kind and a size per kind
   (encounters small, chapters large), which is what makes the far view
   readable as structure instead of confetti.
2. **M4.4 graph on screen**, fed by the campaign instead of test geometry.
   The task's own text wanted "an actual laid-out graph instead of test
   geometry"; this is that, with the id-to-handle mapping it already
   specifies.
3. **M4.5 edge ribbons** for the routed (in-layout) edges; overlay edges are
   simple lines gated by zoom, per the layout section.

M4.8 picking is wanted for hover highlighting but is not on the critical
path: the card overlay below gives click and hover on near-zoom nodes for
free, because cards are DOM.

## Cards without a text renderer

`@dagr/render` has no text and no text task anywhere in M4 or M5, and a
proper in-canvas glyph pipeline (MSDF atlas, shaping, wrapping) is weeks, not
an increment. The demo does not wait for it: labels and cards are a DOM
overlay, positioned by the camera transform.

Update, same day: Nii wanted the overlay as a library feature with rich-node
support, and a dedicated session shipped it to `main` the same day as M4.11
and M4.12 (PRs #24 to #26; see `plans/2026-08-14-html-overlay.md` and the
spec in `specs/`). P6 is now consumption: `createRichNodes({ overlay, tiers })`
plus `setNodes(nodes)` IS the three-tier semantic zoom. Facts P6 inherits:

- Tiers are the overlay's screen-width gates, half-open and required to be
  disjoint (`createRichNodes` throws a `RangeError` naming both tiers
  otherwise). The bottom tier is the absence of an entry: the GPU shape.
- Card sizes are declared per kind, not measured. `measureHtmlSizes` exists
  for content whose size is a fact about its text; 2,800 offscreen mounts at
  startup buy nothing for templated cards.
- Readable-at-any-zoom content counter-scales with
  `var(--dagr-overlay-inv-zoom)`. A layout length (margin, padding offsets)
  on a counter-scaled element is still in world units, because margin
  applies before the element's own transform: compose insets into the
  transform after the scale, or a card sits 800 CSS px off at zoom 100.
- `overlay.sync()` rides the existing `requestDraw` path, never its own
  animation loop.
- The default element cap of 200 is measured, not guessed: repainting text
  under a moving transform costs about 0.2 ms per element per frame on the
  dev box (still camera holds ~744 at 60fps), and a 100x18 label tiles a
  1200x800 viewport ~530 times. `bench/browser` holds the harness,
  deliberately outside `bench:ci`.

- The overlay container gets one CSS transform per frame (the camera's
  world-to-screen matrix), so panning moves every card without touching
  per-card styles.
- Culling: only nodes inside `visibleWorldBounds()` get DOM at all, and what
  they get depends on screen size. Under ~24 CSS px wide, nothing (the
  instanced shape alone). From ~24 px up to the card gate, a title label;
  above it, the full card: name, kind badge, one-liner, and the kind-specific
  fields from the schema. The card gate follows the overlay demo's rule that
  a card should not be wider than the node it describes (240 px there; tune
  per campaign node sizes rather than copying either number). At card size
  only tens of nodes fit in a viewport, so the
  DOM stays small; a hard cap of 200 overlay elements guards the degenerate
  zoom where thousands of labels would qualify.

The thresholds are the semantic zoom Nii described: shapes at campaign
altitude, names at chapter altitude, readable cards at room altitude. When an
in-canvas text task eventually lands, it takes over the label tier; the card
tier is HTML content and arguably should stay DOM forever.

## Phasing

One merge-worthy increment each, in dependency order. P1 and P2 are
independent of each other and of everything after them.

| Phase | Lands | Depends on |
| --- | --- | --- |
| P1 | `@dagr/campaign`: schema types, seeded generator, invariant tests; demo shows dataset stats | nothing |
| P2 | `fitBounds`, `setZoomLimits`, keyboard zoom on focus, derived limits on the current ladder scene | nothing |
| P3 | M4.3 instancing with per-kind color and size | nothing |
| P4 | M4.4: campaign tiles laid out in the worker, drawn instanced, fit on load | P1, P2, P3 |
| P5 | M4.5 edge ribbons; overlay edges behind their zoom gate | P4 |
| P6 | Labels and cards: consume `createRichNodes` (M4.11/M4.12, on `main`) with campaign card content and per-kind declared sizes | P4 |
| P7 | Polish: `#node=` deep links, hover highlight (M4.8 or DOM), committed screenshots, a docs page on the schema | P5, P6 |

## Deliberately not in this plan

- No in-canvas text rendering. The overlay is the decision, revisited only
  when a real text task is scheduled.
- No campaign *simulation*: clocks do not tick, quests do not change state.
  The dataset is a static snapshot of a campaign, which is what a schema demo
  needs. Springs and incremental layout (M3, M4.6, M4.7) will want a dataset
  that changes; this one can grow that later precisely because it is
  generated.
- No force-directed or map-styled layout for the geography. Rooms draw as
  layered tiles like everything else. A pointcrawl drawn as an actual map is
  appealing and is a different renderer feature.
- No claim that this schema is the friend's schema. It is a defensible
  synthesis of how published campaigns and existing tools structure the
  domain, offered as a starting point; if his real schema arrives, the
  generator retargets.

## Follow-up, requested 2026-08-15

More examples that show the animation and game-like feel the project was
motivated by (the README's animation-first framing: incremental layout,
stable identity, springs). The campaign demo is a static snapshot on purpose;
the follow-up is the moving counterpart: nodes springing to new positions on
relayout, grow-and-prune, a quest state rippling through the graph, a front's
clock ticking. Not planned here: it wants M4.6 (springs), M3 (deltas) and
M4.7 (delta consumer) under it, and the campaign dataset gives it something
worth animating. Scope it when those exist; the demo candidates worth
remembering are "a session being played" (scenes completing, clocks
advancing) and "a campaign being authored" (subtrees appearing and settling).

## Open questions for the maintainer

1. Sequencing against M3. The project brain names M3.1 as the next daily
   increment and M3 as the differentiator milestone. This plan is entirely
   M4-track plus new demo work. Should the daily job run these phases first,
   interleave, or leave M3 untouched and let this branch carry the demo work?
2. The keyboard map above is a proposal; if muscle memory says otherwise
   (for example vim keys, or zoom on left-right), say so before P2 bakes it
   into tests.
3. Is the friend's schema available to compare against before P1 freezes the
   node and edge kinds, or should P1 proceed on the synthesis?
