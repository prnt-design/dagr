# @dagr/react

## Unreleased

### Added

- **M5.1: the package.** `<DagrCanvas>`, `useDagr`, `<Html>` and
  `useDagrCanvas`, plus the `LayoutResult` to scene conversion the renderer
  deliberately does not own. The package had been a scaffold since the
  workspace's first commit, empty by decision until there was a component to
  provide the context `<Html>` needs.
- `scene.ts`: `toSceneNodes`, `toSceneEdges`, `toWorldBounds`,
  `nodeWorldBounds`, `NodeAppearance` and the two callback types, with
  `DEFAULT_NODE_APPEARANCE` and `DEFAULT_EDGE_COLOR`. Pure, DOM-free, and the
  only place in the workspace that flips y-down layout coordinates into the
  renderer's y-up world.
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
