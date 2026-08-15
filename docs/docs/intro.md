---
id: intro
title: Dagr
sidebar_position: 1
slug: /
---

<img src="/img/logo.svg" className="hero-mark" width="64" height="64" alt="" />

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

The [live demo](/demos/campaign) draws a mock D&D campaign:
3,010 nodes and 7,100 edges, laid out a tile at a time in a worker, instanced
on the GPU, with names and then readable cards appearing as you zoom in. The
[campaign dataset](./campaign.md) page describes what it is drawing.

## Packages

| Package | What it does |
| --- | --- |
| [`@dagr/graph`](./graph-model.md) | Typed directed graph model: stable identity, zero dependencies |
| [`@dagr/layout`](./layout.md) | Headless Sugiyama layout pipeline, incremental and animation first |
| [`@dagr/render`](./render.md) | WebGPU renderer: SDF shapes, instancing, spring animation |
| `@dagr/react` | The `DagrCanvas` component and hooks |
| [`@dagr/campaign`](./campaign.md) | The demo's dataset: a campaign schema and a seeded generator. Private, not published |

## Status

Early, and moving fast, but past the point of being only scaffolding.
`@dagr/graph` is the furthest along: identity, shape, adjacency, attributes,
ports, patches, traversal, and serialization are implemented, tested, and
documented on the [graph model](./graph-model.md) page. `@dagr/layout` has its
pipeline skeleton, the types and stage boundaries every later milestone is
built against, with real ranking and crossing reduction behind two of the four
defaults and placeholders behind the other two; the [layout](./layout.md) page
says which half is which. `@dagr/render` is past first light: an orthographic
camera, the renderer seam, and rounded rectangles and circles drawn as signed
distance fields through a three.js
`WebGPURenderer`, described on the [renderer](./render.md) page. `@dagr/react`
is still a scaffold.

Nothing is published to npm and there is no released API. Names and signatures
change when a milestone learns something, without deprecation cycles, because
there is nobody downstream to break yet. Expect that until the first published
release. The [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md)
is the order things arrive in.
