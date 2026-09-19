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

[Explore the architecture](/) to see how the pieces fit, try an actual mutation
in [Follow an edit](/demos/living), or start with the example below.

## Run it locally

Dagr is pre-release and **not published to npm**. Start from the repository
with Node 20 or newer and pnpm:

```bash
git clone https://github.com/prnt-design/dagr.git
cd dagr
pnpm install
pnpm --filter docs... build
pnpm --filter docs start
```

For the local renderer playground, run `pnpm --filter demo dev`.

## Your first graph

The graph and layout packages have no browser requirement. Layout returns node
boxes and edge routes keyed by the IDs you supplied.

```ts
import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

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
| [`@dagr/graph`](./graph-model.md) | Nodes, edges, attributes, ports, patches, and serialization |
| [`@dagr/layout`](./layout.md) | Ranking, ordering, positioning, and routing without a UI |
| [`@dagr/render`](./render.md) | Instanced shapes, edge ribbons, camera, and spring motion |
| [`@dagr/react`](./react.md) | A canvas component, reactive layout, and HTML content |
| [`@dagr/vdsl`](./vdsl.md) | Node specifications, port type tokens, and connection validation |

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
animation, HTML overlays, React integration, and port validation are implemented.
GPU picking, editor selection/drag hooks, drag-to-connect, and subgraph editing
remain planned. The homepage's architecture inspector is application UI, not
an assertion that those editor APIs are complete.

APIs may change before the first release. Check the
[roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for current work.
