# Next release candidate

Prepared from `35ed88e14eb7c35514cdc4f2500ab9c2d494fe54` (origin/main,
2026-11-08 UTC). This is a release handoff, not authorization to publish.
The preparation PR adds packaging evidence and release notes, not a version bump.

## Version and exact scope

Recommend **0.2.0** for the seven existing public packages:
`@prnt/dagr-graph`, `@prnt/dagr-layout`, `@prnt/dagr-render`,
`@prnt/dagr-explorer`, `@prnt/dagr-react`, `@prnt/dagr-vdsl`, and `@prnt/dagr`.
All source manifests still say **0.1.4**. Release them together so sibling
ranges cannot silently select older implementations. Keep chart private in this
candidate. It is assessed below as a first-public-release follow-up.

A patch release would obscure source compatibility changes: `GraphHitTarget`
gains an edge variant, `Renderer` gains required `pickNode`, and Explorer's
label interface gains required outline/presentation labels. Under pre-1.0
versioning, 0.2.0 signals that consumers must review those contracts.

Registry metadata fetched on 2026-11-08 reports 0.1.4 as latest for all seven;
chart returns 404. Registry entries contain no `gitHead`. Every `src` file
shipped in those seven registry tarballs matches release commit
`7396ed493754ff863ac1d24fe41a0b90edefb467` (116 files, zero mismatches).
This supports that baseline, without claiming an unavailable registry git SHA.
Registry timestamps and integrity values are preserved in the shared provenance
artifact. Graph, layout and VDSL source have no changes since that baseline.

## Package inventory and migration

| Package | Delta since registry 0.1.4 | Consumer action |
| --- | --- | --- |
| graph | No source changes | Lockstep version only |
| layout | No source changes | Lockstep version only |
| vdsl | No source changes | Lockstep version only |
| render | GPU `Renderer.pickNode`; pinch gesture; visible-frame helpers and camera inset; empty-edge and moving-edge fixes; internal allocation/performance work | Add `pickNode` to custom Renderer implementations/mocks; use core for Three-free input/camera work; camera framing with an inset intentionally changes |
| react | CPU edge hits, edge click/hover handlers, `createEdgeHitIndex`; opt-in GPU node picks and `createPickedNodeHitProvider`; shared touch lifecycle; inset and visual-viewport framing and retargeted camera flights | Handle `kind: 'edge'` before reading node/port fields or asserting exhaustive unions; GPU picks remain opt-in and mouse-only; update interaction expectations where handlers are enabled |
| explorer | Shared touch lifecycle and capture-transfer fix; compact details and larger controls; visual-viewport framing; outline part and map/outline mode with retained state, camera, scroll and focus | Full `ExplorerLabels` values/mocks add `outline`, `presentation`, `mapMode`, `outlineMode`; partial overrides inherit defaults; account for the additional controls and changed narrow-screen layout |
| umbrella | Existing forwarding modules expose the updated scoped APIs | React 19 remains required; React 18 applications use scoped Explorer; no chart entry exists |

Renderer additions include `createPinchGesture`, `PinchGesture`, `PinchDelta`,
`visibleFrame`, `clipInset`, `coverInset`, `visualViewportInset`, `FrameInset`,
`ScreenRect`, `VisibleFrame`, `VisualViewportBox`, and
`Camera2D.setInset`/`frame`/`centerFor`. Both core and full entries expose the
pure additions. React adds `EdgeHitIndex`, `PickedNodeHitOptions` and
`PickedNodeHitProvider`; Explorer adds `ExplorerOutline`, `ExplorerOutlineProps`
and `DagrExplorerMode`, plus `mode`, `defaultMode` and `onModeChange` props.
Package Unreleased changelogs retain the behavioral details.

Published 0.1.4 has the Explorer capture-transfer bug fixed by #196. A manifest
label of 0.1.4 in a local tarball does not mean its implementation is published.
Install the entire locally packed sibling set when evaluating this candidate.
Keep React/React DOM aligned. Full renderer, React canvas and chart consumers
install the documented Three peer and matching `@types/three` for strict types.
ESM-only support is unchanged. No CommonJS build is proposed.

## First public chart assessment

Chart is **not release-ready as a public umbrella surface**. Its current
manifest has `private: true`, lacks `publishConfig.access`, and the umbrella
has neither a chart dependency nor a chart export. These are protected release
configuration decisions for Nii, not changes applied by preparation.

| Finding | Current assessment | Next actor / exit condition |
| --- | --- | --- |
| Packed artifacts omitted from gate | Closed by this preparation: private chart is packed with resolved entries/maps/docs/license/CSS; external install, strict NodeNext types, pure layout and SVG SSR are checked | Keep the new checks on the final release tree |
| GPU combo connectors hidden by bars | Open release blocker for advertised GPU combinations; #222 already owns the fix | Resume #222, rebase and pass its applicable local benchmark gate and concluded CI, then rerun the paired chart fixture; do not duplicate its fix |
| Dense groups, category collisions, tooltip clipping, invented smooth extrema | #228 merged: bounded bar geometry, measured labels/tooltips, linear segments; tests included | Preserve its tests; prior screenshots are not new post-merge visual evidence |
| SVG/layout root still reaches GPU imports | Known dependency/bundle limit, not a missing-peer defect: Three is required even for SVG/layout imports | Separate implementation task for isolated entry points if lightweight or Three-free SVG/layout is promised; do not advertise that contract now |
| Keyboard mark inspection, missing values, time/log x, stacking, legend, per-axis formatting/domain controls | Unsupported, documented product limits | Follow-up implementation; do not promise Recharts feature or accessibility parity |
| Chart umbrella and public configuration | Absent, intentionally unchanged | Nii decides the Three dependency policy and authorizes configuration; add forwarding source and identity/type checks before calling chart an umbrella release |

The 2026-11-05 npm quality audit at `83e6666` measured roughly 270 KB gzip
for SVG DagrChart with its static GPU dependency graph. That is prior evidence,
not a fresh bundle-size measurement. Source still statically imports the scene
and full renderer. SVG does not acquire a GPU context, but the prop does not
create a dependency-isolated entry. Chart remains React 19 only. Adding it as an umbrella dependency today would
make Three install transitively through its required peer, changing the
existing Three-free umbrella/core/Explorer install contract. Resolve that
policy explicitly before adding umbrella exposure.

The paired visual audit at the same source SHA identified the four issues
subsequently addressed in #228 and the compositing issue owned by #222.
Use those existing audits as the baseline rather than duplicating them. The
new external fixture proves artifact resolution and server rendering, not
hydration, browser layout, touch, hardware WebGPU or device conformance.
No new browser flow or screenshot is claimed by this preparation.

## Validation and remaining release actions

`pnpm --filter @dagr/packaging verify:tools` checks publint and ESM-only
arethetypeswrong over eight tarballs, the seven public API consumers, React
18/19 Explorer SSR/hydration/cleanup without Three, and the chart fixture.
The ordinary packaging suite separately checks actual tarball contents,
licenses, source maps, rewritten workspace ranges and public configuration for
all seven public packages. Chart's private/public configuration is kept distinct.

The preparation PR records the exact tested head, full local gate, diff/tree
reviews and concluded CI. Rerun all checks after any source or release metadata
change. Benchmark selection must run through `pnpm bench:gate`, including a
printed skip where appropriate. Previous unrelated benchmark failures are not
permission to skip it or weaken a baseline.

Before publishing, Nii must approve/apply the proposed seven-package 0.2.0
version patch, inspect final changelogs, build and pack that exact tree, rerun
the full gate and external verifier, then publish in dependency order using
pnpm. Publication, tags and GitHub releases remain separate human actions.
Real iOS/Android, software keyboard, safe-area and hardware GPU claims remain
bounded by the existing M5.8b/c and renderer evidence tasks. Open documentation
PRs #231 and #234 are separate work and are not release implementation blockers.
