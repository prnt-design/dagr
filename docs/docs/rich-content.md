---
id: rich-content
title: Rich nodes and edges
sidebar_position: 3
---

# Put meaning in the graph

A node can hold a preview, a configuration summary, a small chart, or a status.
An edge can name the data it carries. Dagr draws the geometry; your application
supplies the vocabulary and the content.

Open **Rich content** in [Inside the graph](/) for a working example: three
GPU-drawn nodes, React content, a deterministic pattern preview, and an edge
annotation. The preview is illustrative application logic, not a graph execution
engine.

## React content on a node

Place `Html` inside `DagrCanvas`. The node ID anchors the content to the layout
box. Give the layout enough space for that content, and size the content to fill
its host.

```tsx
import { DagrCanvas, Html } from '@dagr/react';

<DagrCanvas
  graph={graph}
  config={{ defaultNodeSize: { width: 300, height: 160 } }}
>
  <Html node="source">
    <article style={{ padding: 16 }}>
      <h3>Source</h3>
      <p>Seed: 7</p>
    </article>
  </Html>
</DagrCanvas>
```

`graph` must contain the `source` node. The content remains React-owned; updating
its props does not require rebuilding the graph. `minScreenWidth` and
`maxScreenWidth` on the node form can hide content at unsuitable zoom levels.

## Information on an edge

There is no built-in edge-label component. Use `Html` with an explicit
world-space placement and derive its position from the edge route available
through `useDagrCanvas().result`. Layout coordinates grow downward; renderer
world coordinates grow upward, so negate the layout y coordinate.

```tsx
<Html placement={{ kind: 'point', at: { x: 120, y: -240 } }}>
  <span>pattern → preview</span>
</Html>
```

The numbers here are illustrative. In the showcase, a label is placed midway
between the endpoints of a straight edge. For a bent route, choose a point on
a route segment instead of averaging the endpoints. Label collision avoidance
is application-owned.

## Motion and interaction

`Html` node placement reads the layout result. It does not automatically follow
the intermediate spring position of an animated node. A rich animated scene must
synchronize overlay placements to motion frames; do not assume adding `animate`
will make a portal follow the moving shape. The showcase deliberately uses a
stationary rich-content graph and demonstrates animated edits separately.

Overlay content is inert by default. Set `interactive` when the content needs
pointer input and provide normal HTML keyboard and focus behavior. Interactive
overlay areas intercept gestures, so consider where the user will pan or zoom.

## A few rich nodes, or thousands

React `Html` uses portals whose children stay mounted even while the overlay
is culled. It is convenient for a small graph, but creating thousands of rich
React subtrees defeats the purpose of viewport culling.

For larger scenes, use `createRichNodes` from `@dagr/render`. It manages
zoom-dependent tiers and pools DOM elements. Start with a shape at a distance,
show a label when it is readable, and reveal detailed content only when needed.
The [renderer reference](./render.md) covers the underlying overlay and pooling
APIs.

## Toward a visual language

An architecture map might carry request types on edges. A pattern pipeline might
carry palettes or geometry. A build graph might carry artifacts. These meanings
belong to your application.

Use [node specifications and typed ports](./vdsl.md) to describe legal
connections. Drag-to-connect and a complete editor interaction layer are still
planned; a rich node is a building block, not a finished editor.
