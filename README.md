<p align="center"><img src="./assets/logo.svg" width="160" alt="Dagr logo"></p>

# Dagr

**Directed graph layout, WebGPU rendering, and visual DSLs.**

Dagr combines a typed, headless Sugiyama
layout engine designed for *animation* (incremental layout, stable node
identity, delta output), a WebGPU renderer (three.js
WebGPURenderer, SDF shapes, spring physics) and a React component on top.

**[Explore Dagr](https://dagr.prnt.design)** ·
**[Documentation](https://dagr.prnt.design/docs/)** ·
**[Follow an edit](https://dagr.prnt.design/demos/living)**

Explore an event-driven commerce architecture with rich nodes, typed ports,
search, connection tracing, and zoom-to-node navigation. Zoom out for topology
and in for routes, schemas, and configuration. The example uses the VDSL
registry to validate every connection before Dagr lays it out.

Dagr provides the structure; your application defines the meaning. Use it for
codebase maps, application architectures, build pipelines, or the building
blocks of a domain-specific visual language. Stable IDs and incremental deltas
make changes traceable, while layout stability depends on the graph and edit.
See the [measured behavior](https://dagr.prnt.design/docs/incremental-layout).

> ⚠️ Dagr is in the 0.x series, so expect change. The current focus is proving
> the WebGPU renderer: backend parity was checked by hand on one machine
> (byte-identical to WebGL2 on the two-shape probe scene), and a published
> performance profile and a measured large-graph target come next. The queue
> lives in [ROADMAP.md](./ROADMAP.md).

## Packages

| Package | What | Status |
| --- | --- | --- |
| `@prnt/dagr` | Convenience umbrella with graph exports at the root and a subpath per package | Forwards the six scoped packages, and the renderer's three-free core |
| `@prnt/dagr-graph` | Typed directed graph model: patches, stable identity, zero deps | Identity, shape, adjacency, attributes, ports, patches, traversal, and serialization implemented |
| `@prnt/dagr-layout` | Headless Sugiyama layout engine; incremental, animation-first | The full pipeline, cycle breaking, ranking, crossing reduction, coordinates and routes implemented, plus the incremental engine: patches in, deltas out, warm-started stages and a committed [stability corpus](https://dagr.prnt.design/docs/incremental-layout); an inert-patch fast path skips stages when an edit changes no layout inputs; broader fast paths are planned |
| `@prnt/dagr-render` | WebGPU renderer: SDF shapes, instancing, spring animation | Camera, SDF shapes, an HTML overlay, instancing, edge ribbons, a real graph on screen, critically damped springs, node, edge and bounds motion driven as one scene, and the loop that drives it implemented; GPU picking follows the renderer proof |
| `@prnt/dagr-react` | `<DagrCanvas>` component and hooks | The canvas, the `useDagr` hook over the incremental engine, `<Html>` over the overlay, the layout-to-scene conversion, and `animate`, which glides an edit to its new layout off the delta, implemented; click selection, hover and camera flights shipped in 0.1.3; GPU picking follows the renderer proof |
| `@prnt/dagr-vdsl` | Visual DSL toolkit: node spec adapter, typed ports, drag-to-connect | The node spec adapter, its registry, port type tokens and connection validation implemented; drag-to-connect is parked behind the renderer work |
| `@prnt/dagr-explorer` | React graph explorer: views, search, connection tracing, groups and a details drawer over a pannable DOM and SVG surface, on React 18 and 19 | Complete and browser-validated in Chromium and WebKit; the SVG base is smooth to about 4,000 nodes, and a native base is planned. Install it with `npm install @prnt/dagr-explorer` |

`@prnt/dagr` offers `@prnt/dagr/graph`, `@prnt/dagr/layout`,
`@prnt/dagr/render`, `@prnt/dagr/render/core`, `@prnt/dagr/react`,
`@prnt/dagr/vdsl` and `@prnt/dagr/explorer`; the scoped
packages remain available as individual layers. The umbrella forwards the
same implementations, and its root exports the graph model.

The `packaging` workspace checks packed manifests,
source maps, public types, and installation outside the repository. Release
validation also runs `publint` and `arethetypeswrong`. Publication uses
`pnpm` to replace workspace dependency ranges with registry versions.

## Agent-authored learning Explorers

The repository includes an [Agent Skills authoring skill](skills/dagr-learning-explorer/SKILL.md)
for explanatory graphs: rich node summaries, meaningful edges, detailed
examples and accessible connection navigation. Its [typed example](skills/dagr-learning-explorer/references/learning-explorer.tsx)
uses the public Explorer API. The skill is guidance, not a new runtime feature.

Agents can read the skill directly from a checkout, or install it with the
[skills CLI](https://github.com/vercel-labs/skills) (tested with 1.7.4, which
needs Node 22.20 or newer). Replace `<commit>` with the full SHA of a commit
you have reviewed. `-a` names the agent so the CLI neither prompts nor guesses;
without `-g` it installs into the current project.

```bash
npx skills@1.7.4 add prnt-design/dagr --list
npx skills@1.7.4 add https://github.com/prnt-design/dagr/tree/<commit>/skills/dagr-learning-explorer -a claude-code -y
npx skills@1.7.4 list
npx skills@1.7.4 remove dagr-learning-explorer -y
```

`skills-lock.json` records the commit and a content hash. A local clone works
as the source too:
`npx skills@1.7.4 add ./dagr --skill dagr-learning-explorer -a claude-code -y`.
The example imports `@prnt/dagr-explorer/styles.css`, so a TypeScript project
with `noUncheckedSideEffectImports` (on by default in TypeScript 7.0.2) needs
its bundler's CSS module types, such as `vite/client`. `npm install` does not
install the skill, and current npm tarballs do not bundle it. The
[learning/mobile roadmap](ROADMAP.md#explorer-learning-and-mobile-track)
tracks version-matched npm bundling and adaptive library support.

## Development

Requires Node 20 or newer and pnpm.

```bash
pnpm install
pnpm typecheck     # tsc in strict mode across every package
pnpm test          # vitest
pnpm lint          # eslint
pnpm build         # tsc, each package to its own dist
```

### Benchmarks

```bash
pnpm bench           # run every package's benchmarks
pnpm bench:check     # compare that run to bench/baseline.json
pnpm bench:baseline  # record that run as the new baseline
pnpm bench:ci        # measure up to three times, and pass when two runs agree
```

The agent runs `pnpm bench:ci` locally before opening a pull request, and does
not merge on a regression outside the tolerance. CI does not run it: the
committed baseline is machine-matched, and CI's runner is a different machine,
so the gate lives here instead (see [bench/README.md](./bench/README.md)). A
run too noisy to read is not a regression and is not a pass either, so
`bench:check` exits 2 for it against 1 for a regression, and such a run counts
towards neither of the two `bench:ci` needs. If a local `pnpm bench:check` exits
2, the machine was too busy to measure, not your change. Nor is it your change
when it stops on `the baseline was captured on a different machine`: the gate
compares the machine the baseline names against the one that ran, and refuses a
comparison across two, which is a recapture rather than a regression.

`bench:ci` measures more than once because one measurement stopped being
evidence on a shared machine: two runs have to agree before the gate says
anything, and a failure reports whether the same entry failed every run (a
regression fails the same one) or a different entry each time (noise does).

The tolerance is not a flat 10% of wall clock, because benchmark numbers vary by
machine and busy machines are noisy. Each benchmark is recorded as a ratio against
a control workload run beside it, compared on the median rather than the mean,
and allowed a tolerance that widens with the measured noise of both runs.

[bench/README.md](./bench/README.md) has the full reasoning, the guards that
keep the gate from quietly degrading into a no-op, how to add a benchmark, and
how to record a deliberate exemption for a number that cannot be gated (a GPU
frame time is the first).

## Contributing

Issues are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a
pull request, and [AGENTS.md](./AGENTS.md) if you are working on this repo
with an AI agent.

## License

[MIT](./LICENSE)
