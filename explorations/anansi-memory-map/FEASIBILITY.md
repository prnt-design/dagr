# Anansi memory and connection map: Dagr feasibility

Date: 2026-10-03. Author: Dispatch agent agt_3d5db671befa.

## Recommendation

Use Dagr as an optional map engine behind a framework-neutral feature boundary. Start with the existing Kotlin Compose Android client hosting one local web map, and reuse that map in the existing React web application. Tauri is a plausible Mac shell if desktop packaging is wanted. Do not choose React Native or Flutter solely to display this graph.

This recommendation is an engineering judgment based on reuse and the inspected code, not measured device performance. Android hardware validation is the next decision gate. Keep a first-class connection list and detail inspector outside the renderer so a failed graphics backend never blocks access or correction.

The practical first map is a selected memory and its one-hop neighborhood, expandable on demand. Dagr is a layered directed graph engine, not a force-directed semantic galaxy. It fits evidence, derivation, and directional relationships well. An all-memory constellation would require a different layout strategy and substantially more navigation design. Visual grouping is available, but compound layout is not. Arbitrarily orienting a symmetric relationship for layout must not imply causality to the user.

## Evidence and scope

Inspected Dagr commit `5c5af6c0c707e959874e71ac166809dfcd3170e5` and Anansi checkout commit `5a4cf6ba0774e13233a459838bf2260e97be4d63`. Anansi was read only. Its checked-out apps are `web`, `server`, and `android`; no Tauri app was found in this checkout. Tauri below is a candidate, not an existing implementation confirmed here. No private memories, database, live account data, credentials, or runtime services were accessed.

This exploration adds an isolated headless synthetic prototype, fixture, and results under `explorations/anansi-memory-map/`. It does not build a visual UI or execute a browser flow, so there are no UI screenshots. It does not establish GPU, gesture, screen-reader, or Android performance. No dependency manifest, application implementation, publication, deployment, PR, or merge is part of this exploration.

Local evidence:

| Layer | What exists | Reuse and limits |
|---|---|---|
| `packages/graph` | Stable IDs, directed multigraph, attributes, adjacency, observable patches, batching, serialization, apply/invert | Pure JS model, zero runtime dependencies. Domain meaning, authorization and persistence remain Anansi responsibilities. Node removal also removes incident edges. |
| `packages/layout` | Headless Sugiyama geometry, `createLayout`, incremental deltas, `runAsync`/`serveLayout` structural worker transport | Reusable JS in browser, server or RN runtime after compatibility checks. Coordinates are y-down. Worker availability and scheduling belong to each host. |
| `packages/render` | Three.js WebGPURenderer, instanced shapes, edges, camera, DOM overlays, spring scene motion | Browser renderer. Backend initialization supports WebGPU or WebGL2; neither is guaranteed on a particular WebView. Renderer coordinates are y-up. |
| `packages/react` | `DagrCanvas`, `Html`, `useDagr`, controlled interaction hook | React DOM bindings, not native React Native components. React and React DOM peers require 19; Anansi currently declares 18.3.1. |
| Motion utilities | Node, edge, bounds and scene motion, an idle-stopping loop | Useful mathematical logic, but importing the render package into RN is not a verified native integration. Extract a supported headless entry point or port these utilities if needed. |

Primary files: package manifests and READMEs for those four packages; `layout/src/engine.ts`, `types.ts`, `delta.ts`; `render/src/webgpu-renderer.ts`, `backend.ts`, `html-overlay.ts`, `camera.ts`; `react/src/interaction.ts`, `use-graph-interaction.ts`, `DagrCanvas.tsx`. Anansi evidence: `apps/web/package.json`, `apps/android/app/build.gradle.kts`, and the existing shared types/contracts. A production memory-graph API was not established by this scoped inspection. The proposed contract below must be mapped explicitly rather than assumed to exist.

## Platform choices and adaptation cost

Estimates are planning ranges for one experienced engineer, assuming an agreed graph projection and basic host integration. They cover a useful pilot, not production readiness, a whole app migration, or feature parity. Device failures, data migrations and offline synchronization can materially increase them. Shared map work is counted once, not once per host.

| Path | Dagr reuse | Pilot cost | Assessment |
|---|---|---|---|
| Existing React web | Graph, layout, render directly; React bindings only after approved React 19 migration | Shared map 1-2 weeks | Lowest integration cost. Prefer imperative mount/update/dispose adapter around lower-level renderer with React 18 initially. Do not bypass peer requirements with forced installs. |
| React web in Tauri on Mac | Same web module plus shell lifecycle and bridge | Add 3-7 days after web map | Strong desktop candidate. WKWebView needs its own GPU/fallback, keyboard, resize and resume tests. There is no inspected existing Tauri shell here. |
| Existing Kotlin Compose Android + WebView | Same bundled map; Compose owns navigation, detail/actions and list | Add 1-2 weeks after web map | Recommended Android pilot. Includes bridge, touch arbitration, lifecycle and device profiling. Retains current Android investment. |
| React Native/Expo + WebView or DOM component | Browser map retained inside a WebView | Add 1-2 weeks in an established RN shell; new shell extra | Feasible if RN wins for broader app needs. The map does not become native by embedding it. Mac can keep web/Tauri separately. |
| React Native native renderer | Graph/layout JS likely reusable; renderer, overlays, picking, camera gestures and accessibility replaced | 4-8+ weeks for constrained map | A real renderer adaptation, not a component rename. Use a native drawing surface and local animation loop; avoid per-frame bridge messages. Validate Hermes/package compatibility. |
| Flutter + WebView | Same web bundle; typed messages to Dart | Add 1-2 weeks in an established Flutter shell; migration extra | Feasible but offers little map-specific advantage over current Compose hosting. Android and macOS plugin support does not prove graphics performance. |
| Flutter native renderer | Contracts and geometry concepts; TS graph/layout require JS runtime, server geometry or Dart port | 6-10+ weeks | Highest duplication risk. CustomPainter/semantics/gestures and animation are substantial work; layout port needs parity fixtures. |
| Kotlin Compose native renderer | Current Android shell and Kotlin domain client; consume serialized layout or implement Kotlin layout | 4-8+ weeks | Good later if WebView fails device acceptance. Does not reuse browser renderer and does not provide Mac delivery automatically. |

Expo documents DOM components running web content with asynchronous serialized props/actions. Use it as a coarse feature boundary, not a frame transport. [Expo DOM components](https://docs.expo.dev/guides/dom-components/) and [Expo WebView](https://docs.expo.dev/versions/latest/sdk/webview/).

Tauri uses system Android WebView and macOS WKWebView, so engine capability depends on installed platform/runtime. [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/).

Compose can host Android Views through `AndroidView`. Flutter's official WebView package supports Android, iOS and macOS. These establish hosting options, not performance guarantees. [Android View interoperability](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/views-in-compose), [Flutter WebView](https://pub.dev/packages/webview_flutter). React Native uses native view components, which explains why Dagr's DOM overlay cannot transfer unchanged. [React Native components](https://reactnative.dev/docs/intro-react-native-components).

## Proposed modular boundary

1. **Domain projection:** authorized memory records and evidence become a bounded `GraphSnapshot`. Own stable semantic IDs, permissions, relation types, provenance, confidence, revision and deletion tombstones here. The graph is a projection, never the source of truth.
2. **Layout service:** graph snapshot/patch in, node rectangles and routed edges out. Preserve graph identity and batch edits. Keep layout coordinate conventions explicit. Run larger layouts off the UI thread. Reject outdated async results by snapshot revision.
3. **Map surface:** `mount`, `setSnapshot`, `applyPatch`, `setSelection`, `focus`, `setReducedMotion`, `dispose`. Report `ready`, `selectNode`, `selectRelation`, `requestExpansion`, and failures. The implementation may be Dagr/DOM today and native tomorrow.
4. **Host controls:** search, list, inspector, source opening, correction and delete authorization. These stay usable independently of the canvas.

Use a versioned JSON envelope: `schemaVersion`, `requestId`, `snapshotRevision`, `type`, `payload`. Snapshots carry arrays, not Graph instances, Maps or callbacks. Apply patches only to the expected base revision; request a full snapshot on mismatch. Pass accepted mutations back as domain updates. Keep camera and spring frames inside the rendering runtime. Do not serialize geometry on every pan or animation frame.

For Android, package trusted local web assets and expose only explicit message types. Validate identifiers, payload size, message origin and revision; reject navigation to arbitrary content within the privileged view. Keep account tokens in the host. Preserve camera/selection across pause/resume, stop animation while hidden, and dispose GPU resources on teardown. This boundary needs implementation tests, not just a TypeScript interface.

## Touch, motion and accessibility

Dagr's shared interaction controller supports primary-pointer selection and click-versus-pan with a five-CSS-pixel threshold, cancellation and stale displayed-scene rejection. It does not supply hit geometry. Its current hook excludes edges as hit targets and leaves keyboard handling to the application. The inspected controller tracks one press and ignores additional non-primary pointers, so it is not a complete two-finger pinch controller.

Implement one-finger pan, two-finger anchored pinch, explicit zoom controls and reset/focus. Cancel pending selection when pinch begins. Arbitrate map gestures against vertical detail scrolling and Android back navigation. Do not require long press or edge tapping for essential actions. Provide at least 48 dp Android touch targets, with enlarged hit areas independent of graph scale.

For excellent motion, keep stable IDs and positions, batch related edits, animate only changed geometry, and preserve the camera while neighborhoods expand. Do not auto-fit after every patch. Dagr has the relevant spring and delta primitives, but a product motion policy is still needed: restrained settling, no continuous idle movement, and immediate final-state updates when reduced motion is requested. Honor both browser media preference and a host preference; the inspected packages did not establish an automatic reduced-motion implementation.

Use a connection list with equivalent search/filter/selection/actions. Announce selected node, relation direction, provenance and confidence in text; color alone must not distinguish inferred and confirmed edges. Keep focus stable during relayout. Give zoom/reset accessible names and keyboard controls. Provide an incoming/outgoing relation list, with edge actions there even when the graph's edge picking is unavailable. Validate TalkBack on Android and VoiceOver on Mac; a DOM overlay is not proof of accessibility.

## Provenance, confidence, correction and deletion

Each relation should carry a stable relation ID, endpoints, predicate, directed/symmetric meaning, evidence IDs with source locators, creator or inference run, creation/update timestamps, status, revision and optional confidence. Confidence is an estimate with a defined producer/calibration, not a visual claim of truth. Unknown confidence should remain unknown, not zero. Label suggestions explicitly and distinguish user-confirmed facts.

Selecting a relation should answer: what is claimed, where did it come from, why is it connected, and how can I correct it? Offer separate operations for correcting the predicate/endpoints, rejecting an inferred suggestion, unlinking one relation, and deleting a source memory. Correct by relation ID plus expected revision, not by endpoint pair: parallel relations can express different claims. Source provenance should survive corrections in an audit trail.

Unlink must preserve both endpoint memories and other parallel edges. Source deletion needs explicit domain cascade rules for derived edges, caches and offline replicas. Dagr `removeNode` removes incident graph edges immediately, but that is not a persistence or privacy deletion policy. Use server-authorized accepted state, tombstones and revision checks to prevent stale responses from resurrecting removed information. Rejection should suppress the same inference from immediately recreating an unwanted link. The prototype verifies only in-memory correction and unlink semantics, not these persistence rules.

## Performance targets and measured evidence

Proposed initial Android working set: 50-150 visible nodes, no more than roughly 300 visible relations, and 20-40 rich labels/cards at once. Expand neighborhoods or group results before drawing everything. These are initial product budgets to test, not Dagr limits. Start with capped DPR around 1.5-2 on dense screens and increase only when measurements permit.

Targets: p95 frame work within 16.7 ms on the chosen 60 Hz Android device; continuous input feedback within 50 ms; useful cold map within 1 second after snapshot arrival; no UI-thread layout task above 50 ms; no sustained background animation. Establish memory limits by measuring the WebView and GPU footprint in the actual host, not JS heap alone. Aim initially for less than 100 MB incremental map footprint and revise from device measurements. An M4 with 16 GB is ample for this bounded experiment but does not predict phone behavior or concurrent Anansi workload.

The included probe ran on Apple M4, 16 GiB RAM, Node v25.6.1. Each size used two discarded warmups and ten measured cold-engine layouts of a balanced synthetic tree:

| Nodes / edges | Median | Maximum |
|---|---:|---:|
| 50 / 49 | 0.40 ms | 0.62 ms |
| 150 / 149 | 0.66 ms | 0.87 ms |
| 500 / 499 | 1.40 ms | 2.25 ms |

These are CPU layout smoke measurements, not a benchmark gate, mobile estimate or rendering FPS claim. They exclude graph construction, serialization, worker transport, bridge, GPU, DOM, text measurement and gestures. Sparse trees are favorable inputs. Dense cross-links, hubs, cycles, long edges, multiedges and large labels need representative measurements before increasing budgets.

The four-node semantic fixture includes a cycle, self-loop, parallel relations and evidence metadata. Assertions passed for correction preserving evidence, stale correction rejection, unlink preserving the other relation and nodes, node deletion removing incident edges, and exact reconstruction of three incremental layout results from deltas.

## Next bounded decision gate

Build one reusable web surface and host it in the existing Android Compose app behind an experimental route. Exercise selection, provenance inspection, expansion, correction, unlink, reload and back navigation with synthetic data. Test one modest Android device and the intended primary phone, plus actual Mac WKWebView if using Tauri. Record backend selected after renderer initialization, runtime versions, frame timings, memory, thermal behavior and lifecycle recovery. Include WebGL2 and graphics-unavailable fallback to the list.

Accept the WebView path if gestures, focus, accessibility and frame budgets hold. If they fail after a focused optimization pass, retain graph/domain/layout contracts and replace only the Android surface. Choose RN or Flutter later based on the whole application's needs. A native renderer rewrite should be supported by failed device evidence, not assumed necessary for smooth motion.

## Reproduction

From the Dagr repository root:

```sh
pnpm --filter @prnt/dagr-graph build
pnpm --filter @prnt/dagr-layout build
node explorations/anansi-memory-map/probe.mjs
```

The script writes `synthetic-fixture.json` and `probe-results.json` beside itself. It imports local built Dagr packages and makes no network calls. The source fixtures are synthetic and safe to inspect. Targeted builds passed, graph tests passed (526 tests, 21 files), and layout tests passed (629 tests, 35 files). Validation details are in `VALIDATION.md`. The full repository merge gate was not requested or run for this unmerged exploration.
