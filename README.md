<p align="center"><img src="./assets/logo.svg" width="160" alt="Dagr logo"></p>

# Dagr

**Directed graph layout, WebGPU rendering, and visual DSLs.**

Dagr is a successor to the dagre + d3 pairing: a typed, headless Sugiyama
layout engine designed for *animation* (incremental layout, stable node
identity, delta output) plus a high-fidelity WebGPU renderer (three.js
WebGPURenderer, SDF shapes, spring physics) and a React component on top.

**[Documentation](https://dagr.prnt.design)**

> ⚠️ Early days. Expect rapid change until v0.1. The roadmap lives in
> [ROADMAP.md](./ROADMAP.md).

## Packages

| Package | What | Status |
| --- | --- | --- |
| `@dagr/graph` | Typed directed graph model: patches, stable identity, zero deps | Identity, shape, adjacency, attributes, ports, patches, traversal, and serialization implemented |
| `@dagr/layout` | Headless Sugiyama layout engine; incremental, animation-first | Pipeline, cycle breaking, and ranking implemented |
| `@dagr/render` | WebGPU renderer: SDF shapes, instancing, spring animation | Planned |
| `@dagr/react` | `<DagrCanvas>` component and hooks | Planned |
| `@dagr/vdsl` | Visual DSL toolkit: node schemas, ports, drag-to-connect | Planned (v0.2) |

Nothing is published to npm yet.

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
pnpm bench:ci        # what CI runs: both of the first two, re-measuring once if the run was unreadable
```

CI runs `pnpm bench:ci` on every pull request, and a regression outside the
tolerance fails the build. A run too noisy to read is not a regression and is
not a pass either, so `bench:check` exits 2 for it against 1 for a regression,
and `bench:ci` re-measures once before giving up. If a local `pnpm bench:check`
exits 2, the machine was too busy to measure, not your change.

The tolerance is not a flat 10% of wall clock, because benchmark numbers vary by
machine and CI runners are noisy. Each benchmark is recorded as a ratio against
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
