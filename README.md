# Dagr

**Directed graph layout, WebGPU rendering, and visual DSLs.**

Dagr is a successor to the dagre + d3 pairing: a typed, headless Sugiyama
layout engine designed for *animation* (incremental layout, stable node
identity, delta output) plus a high-fidelity WebGPU renderer (three.js
WebGPURenderer, SDF shapes, spring physics) and a React component on top.

> ⚠️ Early days. Dagr is being built in public, one increment per day, by an
> autonomous engineering loop with human review. Expect rapid change until
> v0.1. The roadmap lives in [ROADMAP.md](./ROADMAP.md).

## Planned packages

| Package | What |
| --- | --- |
| `@dagr/graph` | Typed directed graph model — patches, stable identity, zero deps |
| `@dagr/layout` | Headless Sugiyama layout engine; incremental, animation-first |
| `@dagr/render` | WebGPU renderer — SDF shapes, instancing, spring animation |
| `@dagr/react` | `<DagrCanvas>` component and hooks |
| `@dagr/vdsl` | (v0.2) Visual DSL toolkit — node schemas, ports, drag-to-connect |

## License

[MIT](./LICENSE)
