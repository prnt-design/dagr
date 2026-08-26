---
id: react
title: React bindings
sidebar_position: 6
---

# React bindings

`@dagr/react` is the package that joins the other three. A `Graph` goes in, a
canvas comes out, and the wiring in between (running the layout, converting it
into a scene, building the renderer, keeping the overlay in step, taking it all
back down on unmount) is the component rather than something every host writes
again.

```tsx
import { Graph } from '@dagr/graph';
import { DagrCanvas, Html } from '@dagr/react';

const graph = new Graph();
graph.addNode({ id: 'plan' });
graph.addNode({ id: 'build' });
graph.addEdge({ source: 'plan', target: 'build' });

export function Board() {
  return (
    <DagrCanvas graph={graph} style={{ width: '100%', height: 480 }}>
      <Html node="plan">Plan</Html>
      <Html node="build">Build</Html>
    </DagrCanvas>
  );
}
```

This page describes the package as of M5.1, which is everything it has: the
component, the hook under it, the overlay sugar, and the conversion the
renderer deliberately does not own.

## The graph prop is controlled, and controlled here means watched

A `Graph` is mutable. Passing one as a prop and comparing it by identity, the
way React compares everything, would mean that `graph.addNode(...)` changed
nothing on screen until the caller also replaced the object, which is a rule
nobody remembers on the third edit.

So the hook under the component subscribes to the graph instead.
`Graph.subscribe` takes a listener and returns the function that stops
watching, which is exactly the shape React's `useSyncExternalStore` wants, and
an edit anywhere reaches the canvas:

```tsx
// Both of these redraw.
graph.addNode({ id: 'ship' });
setGraph(rebuildFromScratch());
```

The one window this leaves open is worth knowing about, because it is narrow
and it is real. React subscribes in an effect, after the render that read the
store, and effects run child first. A **child's** mount effect that edits the
graph therefore runs before the canvas has subscribed, and that one edit is not
drawn until the next one arrives. Closing it properly needs an O(1) mutation
counter on `Graph` itself; the two ways of closing it from this side are a
second layout on every mount, or a listener that outlives every component and
makes the graph build a patch on every mutation forever. Both cost more than
the window does. `use-dagr.ts` carries the full argument.

## The layout runs during render, synchronously

`layout()` is synchronous and `useDagr` calls it in a `useMemo`. The result is
referentially stable: a render that changed neither the graph nor the config
hands back the same `LayoutResult`, so effects downstream of it do not run.

There is no worker here, and that is a decision rather than an omission. A
`Worker` has to be constructed by the host, because `new Worker(new URL('./x.ts',
import.meta.url))` is an expression a bundler reads statically and a `new URL`
inside this package would have to resolve, and emit its own chunk, under
everyone's bundler. `@dagr/campaign-stage` takes a `createWorker` factory for
exactly that reason. Inviting one here before M3.9b has built the worker-side
session that would make a per-edit round trip worth taking would be guessing at
a shape M3.9b is going to decide.

## The config is compared by value

`LayoutConfig` is the one prop a caller writes as an object literal in JSX:

```tsx
<DagrCanvas graph={graph} config={{ nodeSep: 80, rankSep: 120 }} />
```

Compared by identity, that would relayout the whole graph on every render of
the surrounding application. So `useDagr` compares the config field by field,
including one level into `defaultNodeSize`, and keeps the old object when they
agree.

`nodeSize` is the exception and it cannot be anything else: it is a function,
and two functions that agree on every node are indistinguishable without
calling them on every node, which is the work the comparison exists to avoid.
Memoise it, the way React asks for every callback prop. The same goes for
`nodeAppearance` and `edgeColor`.

## A layout that fails is reported, not thrown

`useDagr` returns `{ result, error }` and never throws. A graph a user is
editing passes through states the layout refuses, and throwing would unmount
the subtree to the nearest error boundary on the keystroke that made the graph
momentarily invalid. It does not hold the last good result either: a stale
picture presented as the current one is the failure mode that is hardest to
notice.

`<DagrCanvas>` is the one that decides. By default it throws the failure during
render, so a React error boundary catches it; an `onError` prop takes it
instead and suppresses the throw. Both beat the third option, which is to
render an empty box, because an empty box is indistinguishable from an empty
graph.

## The flip, and why it lives here

`@dagr/render` refuses to name a `LayoutResult`. Naming one would make
`@dagr/layout` a dependency of the renderer, and the y-down to y-up conversion
belongs to whoever owns the layout. This package owns both, so the conversion
is here, and it is exported rather than hidden:

```ts
import { toSceneNodes, toSceneEdges, toWorldBounds } from '@dagr/react';

renderer.setNodes(toSceneNodes(result));
renderer.setEdges('my-edges', toSceneEdges(result));
renderer.camera.fitBounds(toWorldBounds(result.bounds));
```

A layout runs y-down, ranks increasing downwards, as dagre does. The renderer's
world is y-up, because its camera is. Nodes, route points and bounds are three
separate expressions and flipping two of the three draws a picture that is half
upside down with every unit test on the flipped halves still green, which is
why the suite runs a real layout through all three and asserts they agree.

Appearance is a callback taking a node id:

```tsx
<DagrCanvas
  graph={graph}
  nodeAppearance={useCallback(
    (id) => (id === selected ? { fillColor: 0x2563eb, glowWorld: 6 } : undefined),
    [selected],
  )}
/>
```

Returning `undefined` takes the defaults, and a partial record is merged per
field, so recolouring one node does not mean restating its shape and both halo
fields. Geometry is not on the record: a node's centre and size are the
layout's answer, and overriding them here would draw a picture that disagrees
with the bounds, the routes and every stability guarantee the layout makes. Set
`config.nodeSize` instead, upstream, where the layout can account for it.

## The camera is fitted once

The first frame that has both a layout and a viewport frames the graph. Nothing
refits after that, and `fit={false}` skips even the first. Refitting on every
edit would be a camera that jumps whenever the graph changes, which is the
instability the whole incremental-layout milestone exists to keep out of the
layout, reintroduced one level up where no stability metric would see it.

## `<Html>` puts React content in world coordinates

`createHtmlOverlay` takes a `create` callback returning an `HTMLElement`, which
is the right shape for a caller building DOM by hand and the wrong one for
React. `<Html>` inverts it: the component owns one host element for its whole
life, `create` hands the overlay that same element every time, and the children
go into it through a portal. The overlay attaches and detaches an element whose
contents React has been maintaining all along.

```tsx
<DagrCanvas graph={graph}>
  <Html node="plan" minScreenWidth={120}>
    <strong>Plan</strong>
  </Html>
  <Html placement={{ kind: 'point', at: { x: 0, y: 40 } }}>Legend</Html>
</DagrCanvas>
```

Exactly one of `node` and `placement` is given, and the type enforces it. The
`node` form sits over the box the layout gave that node and takes the overlay's
two screen-width gates; the `placement` form takes an `OverlayPlacement`
straight through, and carries its own gates inside it if it is a box.

**`<Html>` is for the tens, not the thousands.** The overlay's `create` is lazy
precisely so that a scene with 2,800 nodes builds DOM for the few dozen on
screen. A portal is not lazy: an `<Html>` that is culled still has its subtree
mounted. Ten labels and a card or two is nothing; one per node on a big graph
gives up the cap that makes the overlay work, and the thing to reach for there
is `createRichNodes`, which is pooled and imperative on purpose.

An `<Html>` naming a node the layout does not have registers nothing and
renders nothing, rather than throwing. A node can legitimately vanish while an
edit is in flight.

## Reaching the renderer

Anything inside the canvas can have it:

```tsx
function ZoomOut() {
  const { renderer, requestDraw } = useDagrCanvas();
  return (
    <button
      onClick={() => {
        renderer.camera.setZoom(renderer.camera.zoom * 0.8);
        requestDraw();
      }}
    >
      Zoom out
    </button>
  );
}
```

The handle carries the renderer, the overlay, the layout currently on screen,
and `requestDraw`. Nothing calls `renderer.render()` directly: `requestDraw`
coalesces every reason to draw in one frame into a single callback, and the
overlay's own `sync` runs inside it, because a second animation loop is a
second frame budget and a frame of skew, which reads as the labels swimming
over the graph during a pan.

Children do not render at all until the renderer, the overlay and the layout
all exist, so nothing on the handle is nullable. A caller who wants a spinner
in the meantime renders it outside the canvas.

`useDagrCanvas` outside a `<DagrCanvas>` throws `CanvasContextError`, with code
`OUTSIDE_CANVAS`. A missing provider is the one mistake in a React package that
is otherwise completely silent, because `useContext` of an unprovided context
returns a default value and the failure surfaces several frames away from the
component that was in the wrong place.

## Three props are read once

`clearColor`, `sceneStyle` and `edgeStyle` are taken when the renderer is
built. Edge groups are declared at construction in draw order, and rebuilding a
device context because a colour changed would drop every instance handle in the
scene to honour a prop nobody animates. A caller who does want to animate one
holds the renderer and calls `setEdgeStyle` on it.

## What is not here yet

- **Interaction.** Hover, selection and drag are M5.2, and they want the GPU
  picking pass of M4.8 underneath rather than a hit test invented here against
  a scene array.
- **Animation.** The spring integrator is M4.6 and the delta consumer that
  drives it from a `LayoutDelta` is M4.7. `<DagrCanvas>` re-lays out and
  re-sets; nothing tweens yet.
- **A node ontology.** What a node looks like is a callback and it stays one.
  Deciding that a node of kind X draws as a hexagon belongs to the
  [visual-language toolkit](./visual-languages.md), which is scoped precisely so
  that Dagr ships no ontology of its own.
