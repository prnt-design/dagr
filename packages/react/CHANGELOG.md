# @dagr/react

## Unreleased

### Added

- **M5.3a: an edit animates.** `<DagrCanvas animate>` glides a node to its new
  layout instead of cutting to it, and the same prop carries the feel:
  `animate={{ halfLifeSeconds, restEpsilon }}` is `@dagr/render`'s two numbers,
  compared by value the way `config` is. A prop rather than a hook because the
  component already owns the four things a hook would have to hand back out
  (the coalesced frame, the renderer, the scene conversions, and the delta),
  and `createMotionLoop`'s scheduler option is what keeps that from foreclosing
  the other shape: the loop is given the component's own `requestDraw`, so
  there is one frame budget rather than two and a burst of edits in one task is
  one frame.
- `onFrame` on `<DagrCanvas>`, called with the sprung scene and the renderer
  about to draw it, after `setNodes` and `setEdges` and before `render`. This
  is where a following camera lives: the component still fits once and never
  refits, and `fitBounds` on `frame.bounds` is the caller's line of code.
- `animation.ts`: `toMotionDelta`, `toMotionRoster` and `retarget`, exported on
  `scene.ts`'s precedent, for a caller driving `@dagr/render`'s scene motion
  themselves. `retarget` is where one decision is written down: a delta is a
  difference from a drawing, a cold run is not, and the second reseats.
- `DagrLayoutState.delta`, the `LayoutDelta` of the edit that produced this
  layout, or `null` for a run that was cold. `null` is a statement rather than a
  missing value: there is no previous drawing to be a difference from.
- `DagrLayoutState.from`, the drawing that delta is a difference FROM. **Apply a
  delta only when this is the result you are already drawing.** React renders
  the latest snapshot of an external store rather than every one, so two mutating
  calls in one task are two layouts and one commit, and a consumer whose effect
  runs per commit is handed a delta measured against a drawing it never drew.
  The motion cannot catch that for you: it refuses a delta naming an id whose
  presence it disagrees about, and a delta naming only ids it holds applies
  cleanly and leaves the drawing wrong in silence. This field makes the check an
  identity comparison. `<DagrCanvas animate>` does it for you.
- `onLayout` takes the delta and its `from` as second and third arguments,
  because the numbers a consumer wants to show about incremental layout (how
  many nodes moved, how many did not) live in the delta and nowhere else, and
  calling `useDagr` again to reach them would lay the graph out twice. It is
  called once per COMMIT, so `from` is not optional care there either: a
  consumer counting an edit's moves off a delta that skipped one would count the
  last hop and show the wrong number.
- **M5.1: the package.** `<DagrCanvas>`, `useDagr`, `<Html>` and
  `useDagrCanvas`, plus the `LayoutResult` to scene conversion the renderer
  deliberately does not own. The package had been a scaffold since the
  workspace's first commit, empty by decision until there was a component to
  provide the context `<Html>` needs.
- `scene.ts`: `toSceneNodes`, `toSceneEdges`, `toWorldBounds`,
  `nodeWorldBounds`, `NodeAppearance` and the two callback types, with
  `DEFAULT_NODE_APPEARANCE` and `DEFAULT_EDGE_COLOR`. Pure, DOM-free, and the
  first place in the workspace to flip y-down layout coordinates into the
  renderer's y-up world. M5.3a's `animation.ts` is the second, for deltas.
- `CanvasContextError`, code `OUTSIDE_CANVAS`. No abstract base yet, on
  `@dagr/render`'s precedent: a base over a family of one is a family only in
  the sense that a single point is a line.
- `DEFAULT_EDGE_GROUP_ID`, exported so a caller adding a group of their own
  does not collide with the component's.

### Removed

- `PKG_NAME`, as it went from `@dagr/render` for the same reason: scaffolding
  from the workspace's first commit, imported by nothing, and an exported
  constant nobody uses is one more thing a consumer can depend on by accident.

### Dependencies

- `@dagr/graph` and `@dagr/render` are PEER dependencies (plus devDependencies,
  for the workspace link and the topological build order), on the argument
  `@dagr/layout` already makes about `@dagr/graph`: both put a class with
  `#private` fields on this package's surface (`Graph`, and `Camera2D` through
  `Renderer.camera`), which makes them nominally typed, so two copies in a
  consumer's tree are not interchangeable.
- `@dagr/layout` is a plain dependency. Everything it puts on this surface
  (`LayoutResult`, `LayoutConfig`) is a structural interface, so a duplicate
  copy is harmless, and a consumer who only wants a canvas should not have to
  install the layout engine to get one.
- `react` and `react-dom` are peers. `react-dom` is not optional: `<Html>` is a
  portal.

### Changed

- A relayout that fails is REPORTED unless it is an `EngineStateError`, which is
  recovered from with a cold run. Recovering from all of them would make a
  failure reachable only under a warm start invisible: every edit would come
  back cold, undelta'd and unanimated, with nothing saying why. The cost is that
  such a failure now reaches an error boundary rather than degrading quietly to
  a correct but unanimated drawing, which is the same treatment the identical
  failure from a cold run already gets.
- **`useDagr` holds a `createLayout` engine across renders.** An edit is
  `relayout(patch)` rather than a cold `layout()`, which is where the delta
  comes from and what makes the drawing stable under an edit rather than merely
  correct. The engine runs in the graph listener, which is neither render nor an
  effect: `relayout` does not apply its patch, so the patch has to be consumed
  exactly once and in order, and draining a queue during render is a side effect
  concurrent rendering is entitled to discard and run again. There is no queue.
  The engine is disposed when the hook stops watching, and a resubscribe
  rebuilds it and lays the graph out cold, which is the designed recovery for an
  engine and a graph that have fallen out of step.
- Every optional prop on `DagrCanvasProps`, and `UseDagrOptions.config`, is
  declared `?: T | undefined` rather than `?: T`. Under
  `exactOptionalPropertyTypes`, which this repo sets and a careful consumer sets
  too, `?: T` refuses a key that is present holding `undefined`, so
  `animate={reducedMotion ? undefined : feel}` did not compile. `@dagr/render`
  and `@dagr/layout` widened their option types for the same reason.
- The first run for a graph is still synchronous and still during render, and
  the whole state object is still referentially stable across a render that
  changed nothing. It is NOT guaranteed to be observed once per layout, which is
  why `from` exists: React renders the latest snapshot of an external store
  rather than every one, so two mutating calls in one task are two layouts and
  one commit, and a consumer applying deltas has to notice.
- **The tarball a consumer installs (M5.4a).** `files` now ships `src`,
  `README.md` and `LICENSE` beside `dist` and `CHANGELOG.md`, and
  `publishConfig.access` is `"public"`. The package has a README for the first
  time, which is what an npm page renders.

  `src` is shipped because the build emits `declarationMap` and `sourceMap`
  against a `files` list that had no `src` in it, so every map this package
  published pointed at a file the tarball did not carry: 128 of them across the
  five published packages, verified by packing rather than by reading the
  manifests. The alternative was to stop emitting the maps, which would have
  closed the door on TypeScript project references, because `composite`
  requires `declaration` and effectively wants `declarationMap`. Shipping the
  source costs about 40% of the tarball and buys go-to-definition landing on
  the real TypeScript rather than on a `.d.ts`.

  THE PUBLISH COMMAND IS `pnpm publish`, NOT `npm publish`. `npm pack` leaves
  pnpm's `workspace:` protocol in the published manifest, where it resolves to
  nothing; `pnpm pack` rewrites it to the sibling's real version, checked on the
  same package in the same tree. The `packaging` workspace member is the gate
  that keeps this true: it packs every published package on every `pnpm test`
  and reads the tarball back.
