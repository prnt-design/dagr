# HTML overlay and rich nodes: a library feature, not a demo hack

**Date:** 2026-08-14
**Status:** approved direction, delegated to a dedicated session (Opus)
**Asked for by:** Nii, 2026-08-14, reacting to the campaign demo plan's card
section: the overlay should be part of the library, "similar to the
react-konva html util", and nodes should be able to carry rich content.

## What

A camera-synced HTML layer as a first-class Dagr feature. Two halves:

1. **The overlay**: a framework-free layer that positions DOM elements in
   world coordinates over the canvas, scaling and culling them with the
   camera. The analogue is `Html` from `react-konva-utils`, which portals a
   div and syncs its CSS transform to the Konva stage transform; Dagr's
   version answers to `Camera2D` instead.
2. **Rich nodes**: graph nodes whose visual is arbitrary HTML sized to the
   node's layout box, with the three-tier semantic zoom from the campaign
   plan (instanced shape when small on screen, title label at mid zoom, full
   card up close) as configurable library policy rather than demo code.

This fills the renderer's text gap without a glyph pipeline: the GPU draws
thousands of shapes, the DOM draws the tens of readable things, and the
camera keeps them registered.

## Why it is library code

The campaign demo plan (P6 in `plans/2026-08-14-campaign-demo.md`) placed the
overlay in `apps/demo` because nothing else existed. That was the wrong final
home: every real consumer of a graph renderer wants labels, tooltips, or
cards, and each would rebuild the same transform sync, the same culling, and
the same LOD gating, each with the same subtle bugs (transform origin, DPR,
pointer-events fights with pan). One implementation with tests is the
library's job. The demo becomes the first consumer instead of the owner.

## Sketch, for the session to refine or overturn with reasons

Core in `@dagr/render` (no React dependency):

- `createHtmlOverlay({ container, camera })` owning one absolutely
  positioned div over the canvas. One CSS transform on that container per
  frame from the camera's world-to-screen matrix; per-element styles touched
  only when the element's own geometry changes.
- Entries carry a world position or a world rect, an anchor, a mode
  (`world`: scales with zoom, for node cards; `screen`: constant CSS pixels,
  for tooltips and badges, counter-scaled against the container), and a
  visibility gate in screen-space size (the LOD tiers).
- Culling against `visibleWorldBounds()` plus a hard element cap, because a
  degenerate zoom can qualify thousands of labels and the DOM must not be
  the thing that falls over.
- `pointer-events: none` on the container, opt-in per element, so cards are
  clickable at card tier and the canvas keeps pan and wheel everywhere else.

React sugar in `@dagr/react`: an `<Html>` component portaling children into
an overlay entry, and a rich-node binding from node id to content. `@dagr/react`
is empty today and M5.1 owns `<DagrCanvas>`; whether this session bootstraps
the package with just `<Html>` or keeps everything framework-free until M5.1
is the session's first open decision, argued in its spec.

The arithmetic (world-to-CSS transform, anchoring, culling, tier selection,
cap eviction) is pure and unit-tested; DOM wiring is thin and verified in the
demo, matching how `camera-input.ts` split from `FirstLight.tsx`.

## Explicitly in scope for the session

- A design spec in `specs/` first, then implementation in merge-worthy
  increments per `AGENTS.md`, each with tests and a ROADMAP entry.
- Rich-node measurement: layout wants node sizes, and `resolveConfig`'s
  `nodeSize` callback already anticipates a caller that measures DOM. Decide
  whether rich nodes feed measured sizes into layout (offscreen render,
  measure, lay out) or declare fixed sizes, and say why.
- A written recommendation, spike only, on in-canvas text (MSDF atlas) for
  the label tier at M4.10 scale: at what visible-node count the DOM label
  tier stops being honest, and what the atlas task would cost. Not an
  implementation.

## Not in scope

- The campaign dataset, camera limits, or keyboard work: those are the
  campaign demo plan's P1 and P2 and stay there. This session's work makes
  that plan's P6 mostly consumption.
- MSDF text rendering itself.
- `<DagrCanvas>` (M5.1), beyond whatever minimal package scaffolding the
  `<Html>` decision requires.

## Coordination

The campaign demo plan is not yet on `main` (branch
`agt_9ac0d2019def/more-interesting-demo`); the session receives its context
in the launch prompt and via Dispatch media, and works off `main` in its own
worktree. Overlap risk is one file region: if both tracks touch
`FirstLight.tsx`, the overlay session integrates against whatever is on
`main` at PR time and the campaign track rebases.
