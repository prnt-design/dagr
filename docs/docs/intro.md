---
id: intro
title: Dagr
sidebar_position: 1
slug: /
---

# Dagr

Dagr is a directed-graph toolkit for the web: a typed, headless Sugiyama layout
engine, a WebGPU renderer built on the three.js `WebGPURenderer`, and the
building blocks for visual DSLs (node graphs you can edit, not just look at).

It is a successor to the dagre and d3 pairing that most node-graph UIs still
reach for. The difference is that layout here is designed for animation from
the start: nodes keep a stable identity across relayouts, mutations arrive as
patches, and the layout engine emits deltas rather than a fresh set of
coordinates. A renderer can spring every node from where it was to where it
now belongs, so a graph that changes reads as a graph that moved.

## Packages

| Package | What it does |
| --- | --- |
| `@dagr/graph` | Typed directed graph model: stable identity, zero dependencies |
| `@dagr/layout` | Headless Sugiyama layout pipeline, incremental and animation first |
| `@dagr/render` | WebGPU renderer: SDF shapes, instancing, spring animation |
| `@dagr/react` | The `DagrCanvas` component and hooks |

## Status

Early. The packages are scaffolded and the roadmap is public, but there is no
released API yet. Expect rapid change until v0.1.
