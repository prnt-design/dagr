# Next release candidate

Prepared from `1206f46ebe35674d7a91cf1c1571e3834b9335bb` (origin/main,
2026-11-16 UTC). This is a release handoff, not authorization to publish.
The preparation PR adds packaging evidence and release notes, not a version bump.

## Version and exact scope

Recommend **0.2.0** for the seven existing public packages:
`@prnt/dagr-graph`, `@prnt/dagr-layout`, `@prnt/dagr-render`,
`@prnt/dagr-explorer`, `@prnt/dagr-react`, `@prnt/dagr-vdsl`, and `@prnt/dagr`.
Recommend **0.2.0** for the first public `@prnt/dagr-chart` too, for a total
of eight packages. This is a proposed release matrix, not eight publishable
packages today: chart remains private until the maintainer applies its release
configuration and closes the GPU combo blocker below. All eight source
manifests still say **0.1.4**. Release the siblings together so ranges cannot
silently select older implementations. Chart is a scoped-package delivery;
no `@prnt/dagr/chart` entry is proposed in this candidate. This preserves the
umbrella's optional Three contract. A later umbrella chart entry requires a
separate dependency-policy decision and packed identity/type checks.

A patch release would obscure source compatibility changes: `GraphHitTarget`
gains an edge variant, `Renderer` gains required `pickNode`, and Explorer's
label interface gains required outline/presentation labels. Under pre-1.0
versioning, 0.2.0 signals that consumers must review those contracts.

Registry metadata fetched on 2026-11-16 reports 0.1.4 as latest for all seven;
chart returns 404. Registry entries contain no `gitHead`. The November 8
provenance comparison found that every `src` file
shipped in those seven registry tarballs matches release commit
`7396ed493754ff863ac1d24fe41a0b90edefb467` (116 files, zero mismatches).
This supports that baseline, without claiming an unavailable registry git SHA.
Registry timestamps and integrity values are preserved in the shared provenance
artifact. Graph and VDSL source have no changes since that baseline. Layout
now includes
the size-changing attribute fast path from #240. The November 16 refresh records
live registry versions and integrity; it does not claim a new
byte-by-byte registry source comparison.

## Package inventory and migration

| Package | Delta since registry 0.1.4 | Consumer action |
| --- | --- | --- |
| graph | No source changes | Lockstep version only |
| layout | Size-changing attribute fast path with eligible built-in stages and default longest-path ranking, using held ranks/layers and running position/route only (#240) | `RelayoutResult.ran` can report only position/route; custom stages, simplex and missing retained state retain the full pipeline |
| vdsl | No source changes | Lockstep version only |
| render | GPU `Renderer.pickNode`; pinch gesture; visible-frame helpers and camera inset; empty-edge and moving-edge fixes; internal allocation/performance work | Add `pickNode` to custom Renderer implementations/mocks; use core for Three-free input/camera work; camera framing with an inset intentionally changes |
| react | CPU edge hits, edge click/hover handlers, `createEdgeHitIndex`; opt-in GPU node picks and `createPickedNodeHitProvider`; shared touch lifecycle; inset and visual-viewport framing and retargeted camera flights | Handle `kind: 'edge'` before reading node/port fields or asserting exhaustive unions; GPU picks remain opt-in and mouse-only; update interaction expectations where handlers are enabled |
| explorer | Shared touch lifecycle and capture-transfer fix; compact details and larger controls; visual-viewport framing; outline part and map/outline mode with retained state, camera, scroll and focus | Full `ExplorerLabels` values/mocks add `outline`, `presentation`, `mapMode`, `outlineMode`; partial overrides inherit defaults; account for the additional controls and changed narrow-screen layout |
| umbrella | Existing forwarding modules expose the updated scoped APIs | React 19 remains required; React 18 applications use scoped Explorer; no chart entry exists |
| chart (first public, conditional) | Category bars, lines, dual y-axes, SVG/GPU selection, animated updates, CSS/theme bindings, table and pointer/touch tooltips | React 19, Three and strict consumer Three types; import scoped CSS and set height; GPU combinations blocked by #222 |

For custom renderers, `pickNode(pointer: Vec2): Promise<string | null>` takes
CSS pixels relative to the canvas top-left. Empty-scene test mocks can return
`Promise.resolve(null)`; production implementations must honor silhouettes,
topmost ordering and stale asynchronous results. `createRenderer` consumers
receive the implementation automatically. For `GraphHitTarget`, narrow all
three variants (`nodeId`, `portId`, `edgeId`) before reading a variant's field;
default Canvas edge handling remains opt-in through the edge handlers.

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

Chart is **conditionally included as a first public scoped package**. It is
not ready to publish until the GPU combination blocker is resolved. It is not
a public umbrella surface. Its current
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
| Chart public configuration | `private: true`, no public access setting | Nii applies the separate proposed metadata patch after blockers close |
| Chart umbrella | Absent, intentionally excluded | No blocker for scoped chart publication; separate decision needed before changing umbrella dependency policy |

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

Before publishing, Nii must follow the ordered human-only steps below.
Publication, tags and GitHub releases remain separate human actions.
Real iOS/Android, software keyboard, safe-area and hardware GPU claims remain
bounded by the existing M5.8b/c and renderer evidence tasks. Documentation PR
#231 is merged; open positioning PR #234 is separate work and is not a release
implementation blocker.

## Skill distribution and authoring scope

Explorer authoring improvements combine runtime reading features (rich node and
details slots, search, connection following, map/outline mode, compact details)
with repository guidance. The portable `dagr-learning-explorer` skill and its
reference explain semantic IDs, grounded content, dimensions, noninteractive
node content and accessible details. `dagr-chart` separately explains category
data, axis meaning, styling, height and table accessibility. Neither skill is a
runtime package or bundled in these eight npm tarballs. Installing either skill
does not install Dagr. Chart guidance does not mean chart is already published.

From a checkout of the approved commit, use the documented CLI independently
of npm installation (replace `claude-code` with the supported target agent):

```sh
npx skills@1.7.4 add . --skill dagr-learning-explorer -a claude-code -y
npx skills@1.7.4 add . --skill dagr-chart -a claude-code -y
npx skills@1.7.4 list
```

For remote installation use a commit-pinned repository URL as shown in the root
README, substituting the skill directory. Preserve the CLI lockfile/hash.
The Explorer reference targets published 0.1.4; inspect installed types before
using later outline props. Chart consumers must use local tarballs until its
first release exists. The portable skills remain in the repository and can
ship independently of the npm release. No skill installer was run by this
release preparation.

## Ordered human-only release steps

1. Close #222 with reviewed implementation, the full local gate and concluded
   green CI, then rebase this candidate onto the resulting `origin/main`.
   Resolve the reproduced benchmark blocker described below before release
   approval. Use one replacement human metadata PR for the eight-package patch
   after this preparation, superseding the seven-package PR #236. Do not merge
   or apply #236 as-is and then apply this patch: its finalized notes and
   seven-package handoff would compete with this complete candidate. Preserve
   its review/evidence links in the replacement PR, and close it as superseded
   only when the replacement is reviewable.
2. Review the separate proposed patch artifact. It sets **all eight** versions
   to **0.2.0**, removes chart's private flag and sets its publish access public.
   It does not add umbrella chart exposure. Only Nii may apply these existing
   manifest version/publish configuration changes. Review changelogs and convert
   applicable Unreleased headings to 0.2.0 in the human metadata PR. Preserve
   unrelated existing release history. Do not publish a subset as a substitute
   for the requested complete candidate.
3. Run `pnpm install --frozen-lockfile` after rebasing, then run `pnpm install --lockfile-only` after applying the approved metadata
   changes and `pnpm install --frozen-lockfile` against that updated lockfile. Commit the manifest,
   lockfile and final release notes through a PR, never directly to main.
4. On that exact final tree run `pnpm typecheck`, `pnpm test`, `pnpm lint`,
   `pnpm build`, `pnpm bench:gate`, and
   `pnpm --filter @dagr/packaging verify:tools`. Use shared compute windows for
   ordinary checks and an exclusive window for the benchmark, without nesting.
   A printed benchmark skip is a pass; a failure is a blocker. Review the diff
   and the complete merged tree, record findings/resolutions in the PR, and
   wait for concluded green CI. Rebase, frozen-install and retest if main moves.
5. Pack the approved tree with `pnpm pack --pack-destination <absolute-dir>`
   in each package directory. Inspect all eight packed manifests: versions
   0.2.0, sibling runtime ranges rewritten to ^0.2.0, chart public and not
   private, entries/types/maps/CSS/docs/license present, no skills claimed.
   Preserve tarballs and SHA-512 checksums. Existing consumer tests exercise
   source-version tarballs; they must be rerun after metadata changes.
6. Authenticate as the intended npm maintainer. Recheck live registry versions
   and access before any write. Human publish order is graph, layout, render,
   explorer, react, vdsl, chart, dagr. From each corresponding package directory
   use `pnpm publish --access public --tag next` on the exact approved commit.
   This stages all packages without moving `latest`. Verify each registry
   tarball/integrity, install all eight exact 0.2.0 versions outside the repo,
   and rerun the consumer fixtures before promotion. Do not use `npm publish`
   or `npm pack`, which leave workspace ranges unresolved.
7. Once the entire set passes registry-installed checks, promote each with
   `npm dist-tag add <package>@0.2.0 latest`, then verify every latest tag.
   Version/config approval does not delegate publication to the agent. Release
   tags and a GitHub release are separate human actions after npm verification.

If staging fails partway, stop and record exactly which immutable versions
exist. A published version cannot safely be replaced by editing this tree and
republishing it. Choose a new coordinated version for corrected artifacts.
A dist-tag can be moved back to 0.1.4 for the seven existing packages, but this
does not remove installed 0.2.0 versions or roll back consumers. Chart has no
previous public version; remove its new tag or deprecate the failed release as
appropriate. Do not automate unpublish, delete tags or imply atomic multi-package
rollback. Hold promotion until all eight staged packages are verified.


## November 16 preparation evidence and benchmark diagnostic

The preparation at `152c13b29e76b5d5764ff4294d121a9500a07376` passed
`pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` and the selected
`pnpm bench:gate`, which explicitly skipped the ten changed packaging/docs
paths. The external verifier passed 28 checks including eight publint/attw
artifacts, chart dual-axis mixed-series layout and SVG SSR, strict Explorer
authoring types and React 18/19 map/outline switching with lifecycle cleanup.
CI concluded success for that head. Build emitted CSS minifier warnings, not
a failing exit. Preserved source-version tarballs retain 0.1.4; final release
metadata still requires a fresh build, pack, gate and installed-consumer run.

PR #236's exact historical failure was
`@prnt/dagr-react > bench/interaction.bench.ts > CPU rectangle pointer query > 10k nodes`:
+32.0% versus +17.7% allowed, a passing middle run, then +30.5% versus +17.5%.
The preparation's selected-gate skip does not test that entry. To assess it on
the current candidate, one separate `pnpm bench:ci` invocation ran under the
exclusive compute wrapper on November 16. It exited 1 after **two of two
measurements failed the same entry**, +31.4% versus +17.6% allowed and +33.2%
versus +17.5% allowed. The historical timing failure therefore reproduces. No baseline,
benchmark policy or runtime changes were made, and no manual retry followed.
React runtime/benchmark implementation and the baseline match PR #236; its
React index header differs only in documentation. This is not evidence that
the release preparation caused the timing failure. PR #254 merge eligibility
rests on the mandated scoped `bench:gate` (including its accepted printed skip),
the other required local checks, reviews and concluded green CI. This separate
diagnostic does not add a merge gate for unchanged runtime. The future metadata
or runtime release tree must pass its applicable benchmark gate and all other
required checks; PR #222 still blocks chart release. The existing diagnostic
issue is tracked by `tsk_1048e2545110`. The full log is retained with the
preparation artifacts.

This diagnostic measures Node CPU pointer-query work on the recorded Ryzen
9 9900X Linux x64 host, not browser rendering or GPU frame time. The baseline
records Node 22.22.1 and 24 logical CPUs. Prior Apple M4 browser/GPU evidence
applies only to its documented backend, workload and measurement conditions.
Neither result predicts performance on an ordinary user's device. The new
custom PC's GPU has not been identified by this preparation; no GPU capability
or cross-device speed claim follows from its CPU or general hardware power.
