---
id: intro
title: Start here
sidebar_position: 1
slug: /
---

# Build a graph people can follow

Dagr is a TypeScript toolkit for directed graphs: a graph model, a headless
layout engine, a GPU renderer, and React bindings. Use the layers together or
bring your own renderer. The visual-language toolkit adds node specifications
and connection validation without deciding what your nodes mean.

Dagr is intended for coding agents as well as human developers to build
visualizations people can read and use. Its typed APIs, package contracts,
examples and [authoring skills](https://github.com/prnt-design/dagr#agent-authored-learning-explorers)
help agents integrate the existing layers and verify their work.

[Explore the architecture](/) to see how the pieces fit, try an actual mutation
in [Follow an edit](/demos/living), or start with the example below.

## Install

```sh
npm install @prnt/dagr react@19 react-dom@19 three
```

The `react@19`, `react-dom@19` and `three` peers are for the renderer and
React parts. A React 18 site installs `@prnt/dagr-explorer` directly.
Import `DagrCanvas` from `@prnt/dagr/react`. Individual `@prnt/dagr-*`
packages are also available when you only need part of the stack.

## Run it locally

To run the examples from source, use Node 20 or newer and pnpm:

```bash
git clone https://github.com/prnt-design/dagr.git
cd dagr
pnpm install
pnpm --filter docs... build
pnpm --filter docs start
```

For the local renderer playground, run `pnpm --filter demo dev`.

## Package entry points

Dagr uses `@prnt/dagr-*` for individual packages, with an optional
`@prnt/dagr` umbrella. The umbrella root exports the graph model. Its subpaths
`@prnt/dagr/graph`, `@prnt/dagr/layout`, `@prnt/dagr/render`,
`@prnt/dagr/render/core`, `@prnt/dagr/react`, `@prnt/dagr/vdsl` and
`@prnt/dagr/explorer` forward to the matching scoped packages. Choose the individual scoped
packages when you only need part of the stack.

## Your first graph

The graph and layout packages have no browser requirement. Layout returns node
boxes and edge routes keyed by the IDs you supplied.

```ts
import { Graph } from '@prnt/dagr-graph';
import { layout } from '@prnt/dagr-layout';

const graph = new Graph();
graph.addNode({ id: 'source' });
graph.addNode({ id: 'preview' });
graph.addEdge({ source: 'source', target: 'preview' });

const result = layout({ graph });
const preview = result.nodes.get('preview');
// preview has x, y, width, and height. x and y are its center.
```

This example runs inside the workspace. Use the [React bindings](./react.md)
to draw a graph with `DagrCanvas`, then add [rich content](./rich-content.md).

## Choose the layer you need

| Package | Use it for |
| --- | --- |
| [`@prnt/dagr-graph`](./graph-model.md) | Nodes, edges, attributes, ports, patches, and serialization |
| [`@prnt/dagr-layout`](./layout.md) | Ranking, ordering, positioning, and routing without a UI |
| [`@prnt/dagr-render`](./render.md) | Instanced shapes, edge ribbons, camera, and spring motion |
| [`@prnt/dagr-react`](./react.md) | A canvas component, reactive layout, and HTML content |
| [`@prnt/dagr-vdsl`](./vdsl.md) | Node specifications, port type tokens, and connection validation |

## Changes and animation

Use a persistent layout engine for incremental changes. It retains previous
pipeline state and returns both the new layout and a delta. With React,
`DagrCanvas animate` connects this to spring motion. Group related edits in
`graph.batch` so they arrive as one patch.

Stable identity does not mean every existing node always stays in place.
Topology changes can move other nodes. The [incremental layout guide](./incremental-layout.md)
explains the guarantees, tradeoffs, and measured stability.

## What is ready, and what is next

The full layout pipeline, incremental deltas, instanced rendering, spring
animation, HTML overlays, React integration, click selection, hover and CPU edge hits, port
validation, and the explorer are implemented. The work now proves the WebGPU
renderer. The same scene drawn through WebGPU and WebGL2 was byte-identical in
a hand-run check (Apple M4, Chrome 155, two-shape probe scene, zoom 1, DPR 1),
and still was with two solid and two dashed straight edge ribbons added
(Chrome 157). A smooth ribbon and a dashed one through two joins, added on
2026-11-21, pass the check, with 49 edge-band pixels on them differing, and
still do with the dashes flowed (2026-11-22). A smooth dashed ribbon added
that day also passes, with 81 edge-band pixels differing in all, and so does
the flow advancing over three frames, with 87 and 77 edge-band pixels
differing on the later two, and a ribbon on the above-nodes layer, with none
of its pixels differing. A group outline and rich-node tiers composed over
the first frame (2026-11-23, the tiers also at zoom 0.5 and 2 and the
outline at 0.5 and 1.5) add no differing pixel, the shapes alone are
byte-identical at zoom 0.5 and 2, as are the solid straight ribbons alone at
zoom 0.5 and 1.5 (2026-11-24). The three dashed ribbons alone, the joined
one included, pass at zoom 0.5 and 1.2 that day, with 7 and 15 edge-band
pixels differing, and the solid smooth ribbon alone passes at the same
zooms with 15 and 27. The smooth dashed one alone passes at the same
zooms on 2026-11-25 with 31 and 25, and the above-nodes ribbon with the
circle is byte-identical at zoom 0.5 and 2 that day, as are the shapes
alone and the solid straight ribbons alone at DPR 2. The three dashed
ones alone pass at DPR 2 on 2026-11-26 with 31 edge-band pixels
differing, the solid smooth one and the smooth dashed one alone that
day with 48 and 50, and the above-nodes one with the circle is
byte-identical. The group outline passes at DPR 2 on 2026-11-27, adding
no difference. The original probe also passed on AMD RDNA 2 in Chrome 156, with
four edge-band pixels differing by one. Other GPUs, and DPR 2 beyond the
shapes alone, the solid straight ribbons alone, the three dashed ones
alone, the solid smooth one alone, the smooth dashed one alone, the
above-nodes one with the circle and the group outline, remain uncovered. A performance profile is published, and GPU node picking ships
behind an opt-in `hitTesting="gpu"` on `DagrCanvas`, with edge hits on the CPU. The large-graph
target, 10,000 nodes animating at 60 fps, is still open: it held with a tenth
of the nodes moving on two devices, and with every node moving along smooth
edges it still misses ticks. Drag-to-connect and subgraph editing stay parked
behind the renderer work.

Dagr is in the 0.x release series. Check the
[roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for current work.
