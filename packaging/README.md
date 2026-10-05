# @dagr/packaging

The packaging gate. It packs every published package and reads the tarball a
consumer would install, rather than reading the manifest that produced it.

Private, never published, and part of `pnpm test` like any other workspace
member.

## Read this first: nothing else in the gate resolves a package

This member exists because of one fact about the other four steps:

| Step | How it finds `@prnt/dagr-graph` |
| --- | --- |
| `pnpm typecheck` | tsconfig `paths` |
| `pnpm test` | a vitest alias |
| `pnpm build` | the pnpm workspace symlink |
| `pnpm lint` | it does not |

Not one of them reads `exports`, `files`, or the published manifest. So a
missing `dist` in `files`, an `exports.types` pointing at nothing, or a
dependency range that resolves to nothing all pass the entire gate and fail on
the first `npm install` after a publish. Every check here reads only what
`npm install` would put on disk.

## What it checks

`src/checks.ts` holds the predicates, pure and over a structural description of
a packed package, so `test/checks.test.ts` can show each one **failing** on a
package built to be wrong. `test/pack.test.ts` runs the same predicates over the
seven real tarballs. A guard whose only evidence is a green run against a tree
already known to be correct has never demonstrated that it can go red.

One of the seven, `@prnt/dagr-explorer`, was `"private": true` until M5.6f-2
and was packed regardless from its first slice, because a broken `exports`
map is cheaper to find on the day it is written than on the day the flag
comes off. The flag is off now, and it publishes with the other six.

- **No `workspace:` range a consumer install reads.** This is a check on the
  packer as much as on the manifest, and it is why the publish command is
  `pnpm publish`. `devDependencies` are deliberately exempt: npm installs none
  of them for a package it is installing as a dependency, so a workspace range
  there reaches nobody. `@dagr/bench` is in that position today.
- **Every path the manifest names is in the tarball**, walking the whole
  `exports` condition tree rather than its first branch, plus `main`, `module`
  and `types`.
- **Every source map resolves inside the tarball.** Stated as a property of the
  tarball rather than as "ship `src`", so it stays correct if the maps are ever
  dropped instead: a package with no maps passes because it has none to check.
- **A README, a LICENSE and a CHANGELOG are present**, and every LICENSE is
  byte-identical to the one the repo licences under.
- **`publishConfig.access` is `public`**, without which a scoped package does
  not publish public.
- **`@prnt/dagr-render/core` loads where `three` cannot be resolved.** The built
  `dist/core.js` is executed from the extracted tarball, which has no
  `node_modules` above it. The control is `dist/index.js` failing there on
  `three`: without it, a `three` that happened to be resolvable would make the
  check pass for nothing.
- **`@prnt/dagr-render/core` type-checks with no three types installed.** A
  consumer installs the renderer tarball with its peers left out and compiles
  against the core entry with `skipLibCheck` off. The control is the same
  consumer importing the full entry and failing on `three/webgpu`.
- **A packed consumer compiles against the public surfaces**, under `NodeNext`
  resolution and without workspace aliases, which is what catches an `exports`
  key that a bundler-style resolver would have forgiven.
- **`@prnt/dagr-explorer` runs from installed tarballs with `three` absent.** A
  consumer installs the graph, layout, renderer and explorer tarballs with
  peers left out, then lays out a view and searches it from the built entry.
  The control comes first: the smoke fails if `three` can be resolved from
  where the renderer is installed. It runs without the test runner's
  `NODE_PATH`, which points at this repo's own `node_modules`.
- **The umbrella's `@prnt/dagr/explorer` and `@prnt/dagr/render/core` are
  the scoped packages, with `three` absent.** A consumer installs all seven
  tarballs with no `three`, then checks that each subpath exports the same
  names as its scoped package and that every one is the same object, not a
  second copy. The control is `@prnt/dagr/render` failing there on `three`.

## Packing is not conditional, and the build is not either

`beforeAll` runs `tsc` for the seven packages every time, then packs. CI runs
`pnpm test` **before** `pnpm build`, so on a fresh checkout there is no `dist`
to pack at all; and a `dist` that does exist may be stale, which would pass this
gate on a tarball that is not the one the next publish would produce. It costs
about fifteen seconds.

## The three checks that need the network

`pnpm test` runs no registry and no download, so three things live outside it:

```sh
pnpm --filter @dagr/packaging verify:tools
```

That runs `publint` over every tarball, `arethetypeswrong` over every tarball,
and a scratch project **outside the workspace** that installs all seven tarballs
with `npm`, typechecks their public graph, layout, VDSL, renderer, explorer and
React surfaces, including scoped and umbrella subpaths, and runs a headless
runtime smoke. Run it whenever the packaging changes and before a publish.

The scratch project is the strongest of the three and it is worth knowing what
it proves. It compiles `layout({ graph })` with the `graph` built from the
installed `@prnt/dagr-graph` and `@prnt/dagr`, checks JSX props for `<DagrCanvas>` and `<Html>`, and
checks renderer types without creating a GPU device. `Graph` carries `#private`
fields, so if the peer range had resolved to a second copy that line would fail
with `separate declarations of a private property '#nodes'`. It compiling is
the evidence that the peer resolved to one copy. The runtime smoke then
exercises headless graph, layout, VDSL, camera and renderer arithmetic, plus
loading the React entrypoints, without requiring a browser or GPU. The smoke
also asserts that the umbrella root and subpaths preserve runtime identity with
their scoped package counterparts.

`arethetypeswrong` runs under `--profile esm-only` rather than the default
`strict`. All seven packages are `"type": "module"` with no CommonJS build, so
`strict` reports `CJSResolvesToESM` on every one of them, which is an accurate
description of an ESM-only package rather than a defect. If a CommonJS build is
ever added, that profile is the line that has to change.

## The publish itself

Queued for the maintainer, per `AGENTS.md`. The command is `pnpm publish`.
`AGENTS.md` currently names `npm publish`, which is the one that does not work,
and correcting it is the maintainer's edit rather than an agent's.
