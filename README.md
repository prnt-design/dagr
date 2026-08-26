<p align="center"><img src="./assets/logo.svg" width="160" alt="Dagr logo"></p>

# Dagr

**Directed graph layout, WebGPU rendering, and visual DSLs.**

Dagr is a successor to the dagre + d3 pairing: a typed, headless Sugiyama
layout engine designed for *animation* (incremental layout, stable node
identity, delta output) plus a high-fidelity WebGPU renderer (three.js
WebGPURenderer, SDF shapes, spring physics) and a React component on top.

**[Documentation](https://dagr.prnt.design)** ·
**[Live demo](https://dagr.prnt.design/demos/campaign)**

The demo draws a mock D&D campaign: 3,010 nodes and 7,100 edges, laid out a
tile at a time in a worker, instanced on the GPU, with names and readable cards
appearing as you zoom in. The dataset behind it is a generated fixture, not a
published package, and documents itself in
[packages/campaign](./packages/campaign/README.md).

> ⚠️ Early days. Expect rapid change until v0.1. The roadmap lives in
> [ROADMAP.md](./ROADMAP.md).

## Packages

| Package | What | Status |
| --- | --- | --- |
| `@dagr/graph` | Typed directed graph model: patches, stable identity, zero deps | Identity, shape, adjacency, attributes, ports, patches, traversal, and serialization implemented |
| `@dagr/layout` | Headless Sugiyama layout engine; incremental, animation-first | The full pipeline, cycle breaking, ranking, crossing reduction, coordinates and routes implemented, plus the incremental engine: patches in, deltas out, warm-started stages and a committed [stability corpus](https://dagr.prnt.design/docs/incremental-layout); fast paths that make a small edit cheap in time are next |
| `@dagr/render` | WebGPU renderer: SDF shapes, instancing, spring animation | Camera, SDF shapes, an HTML overlay, instancing, edge ribbons, a real graph on screen, critically damped springs and the node half of the delta consumer implemented; edge motion, the animation loop and GPU picking are next |
| `@dagr/react` | `<DagrCanvas>` component and hooks | The canvas, the `useDagr` hook, `<Html>` over the overlay, and the layout-to-scene conversion implemented; interaction and animation are next |
| `@dagr/vdsl` | Visual DSL toolkit: node spec adapter, typed ports, drag-to-connect | The node spec adapter, its registry, port type tokens and connection validation implemented; drag-to-connect is next |

Nothing is published to npm yet, so the only way to run any of this today is to
clone the repo. Closing that is the next task on the
[roadmap](./ROADMAP.md#where-this-stands-and-what-to-do-next).

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
