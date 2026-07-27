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
| `@dagr/graph` | Typed directed graph model: patches, stable identity, zero deps | Identity, adjacency, attributes, ports, and patches implemented |
| `@dagr/layout` | Headless Sugiyama layout engine; incremental, animation-first | Pipeline, cycle breaking, and ranking implemented |
| `@dagr/render` | WebGPU renderer: SDF shapes, instancing, spring animation | Planned |
| `@dagr/react` | `<DagrCanvas>` component and hooks | Planned |
| `@dagr/vdsl` | Visual DSL toolkit: node schemas, ports, drag-to-connect | Planned (v0.2) |

Nothing is published to npm yet.

## Contributing

Issues are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a
pull request, and [AGENTS.md](./AGENTS.md) if you are working on this repo
with an AI agent.

## License

[MIT](./LICENSE)
