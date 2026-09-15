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

This page describes the package as of M5.3a: the component, the hook under it,
the animation an edit gets for free, the overlay sugar, and the conversions the
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

It is one edit of latency rather than a disagreement that persists.
`relayout` re-runs the pipeline over the graph the engine holds and measures the
delta against the geometry it last reported, so the next edit reports both and
the drawing catches up. Any resubscribe (a new graph, a new config, React's
`StrictMode` remount) closes it outright, because a resubscribe rebuilds the
engine and lays the graph out cold.

## An edit is a relayout, not a cold run

`useDagr` holds a `createLayout` engine for as long as it is watching one graph
with one config, and calls `relayout(patch)` with the patch the graph delivers.
So it returns four things rather than two:

```tsx
const { result, error, delta, from } = useDagr(graph);
```

`delta` is a `LayoutDelta`: what appeared, what went away, what moved, and what
the box around the lot became. It is what `<DagrCanvas animate>` animates from,
and what a caller driving `@dagr/render` themselves wants. `from` is the drawing
that delta is a difference FROM, and it has a section of its own below.

**`delta` is `null` on a cold run, and that is a statement rather than a missing
value.** A delta is a difference from a drawing; the first run of a graph has no
drawing to differ from, and neither does the run after a config change or the
recovery from an engine that fell out of step with its graph. `null` is how those
runs say "reseat, do not retarget", and `retarget` (exported) is where that
decision is written down.

**The engine runs in the graph listener**, which is neither render nor an effect.
`relayout` does not apply its patch: the graph is already mutated, the patch
describes an edit already made, and a patch the graph disagrees with is refused.
A hook that kept those patches in a queue and drained it during render would be
doing a side effect in render, and concurrent rendering is entitled to discard
that render and run it again, which would consume a patch twice or not at all.
So there is no queue: `Graph.subscribe` hands over one patch per mutating call,
straight after it commits, and the relayout happens right there. Render only
reads the result.

One consequence worth stating: the relayout happens inside your own
`graph.addNode(...)` call. A layout that fails is reported through `error`
rather than thrown, because `addNode` is not a function anyone expects to raise
a layout error. And **wrap a multi-step edit in `graph.batch`**: it is one patch
and one relayout rather than three, which is the same advice `relayout` gives
for its own reasons. Unbatched, the intermediate layouts are computed and never
drawn, because React commits once, and the section below is about what the
component then has to do to stay correct.

The engine is disposed when the component stops watching, which is what
`LayoutEngine.dispose` is for: the graph, the previous run's pipeline state and
the reported-geometry snapshot are retained for the life of an engine, and on a
large graph they are larger than the result you can see.

## A delta is only safe to apply to the drawing it was measured from

**The state changes once per layout. An effect keyed on it runs once per
commit.** Those are different counts, because React renders the latest snapshot
of an external store rather than every one, so two mutating calls in one task
are two layouts and one commit holding the second. The delta you are handed is
then a difference from a drawing you never drew, and applying it to the drawing
you did draw leaves the two disagreeing from then on.

That is what `from` is for, and the check is one line:

```tsx
// `drawn` is the result the motion is currently holding. `rosterOf` builds the
// whole scene from a result, which is what a reseat needs and a retarget does
// not: it has to be the CURRENT layout, not one hoisted earlier.
useEffect(() => {
  if (state.result === null) return;
  const continues = drawn.current !== null && drawn.current === state.from;
  retarget(motion, continues ? state.delta : null, rosterOf(state.result));
  drawn.current = state.result;
}, [state]);
```

**Do not leave that check to the motion.** `SceneMotion.apply` refuses a delta
naming an id whose presence it disagrees about, which catches some of these, and
a delta naming only ids it already holds applies cleanly and leaves the drawing
wrong in silence. Creating a node and then labelling it, in one handler, is
enough to produce one. `<DagrCanvas animate>` does this check for you, and
`onLayout` hands you `from` for the same reason.

The other half of the answer is `graph.batch`: one patch, one layout, one delta,
nothing to miss.

## The layout still runs during render, synchronously

The first run for a graph is a `useMemo`, exactly as it was: synchronous, and
during render. The result is referentially stable, and so is the whole state
object: a render that changed neither the graph nor the config hands back the
same one, so an effect keyed on it does not run.

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

`useDagr` returns `error` rather than throwing. A graph a user is
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

**One class of failure is recovered from instead, and only one.**
`EngineStateError` means the engine and the graph have fallen out of step, which
a cold run fixes, so the hook rebuilds and runs cold and reports the result with
no delta. Everything else a relayout raises is reported, exactly as the same
failure from a cold run already is. The alternative, recovering from all of
them, would make a failure reachable only under a warm start invisible: every
edit would come back cold, undelta'd and unanimated, with nothing saying why.
The cost of that choice, stated rather than buried: such a failure now reaches
your error boundary rather than quietly degrading to a correct but unanimated
drawing.

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

The delta half is the same flip in three more expressions, and it is the worse
three: a target flipped the wrong way does not draw a node upside down, it
springs the node to the mirror of where it belongs and leaves it there. So
`toMotionDelta` is asserted against what `toSceneNodes` and `toWorldBounds` put
in the same place for the same run, rather than against numbers written by hand.

```ts
import { retarget, toMotionDelta, toMotionRoster } from '@dagr/react';
```

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

## `animate` is one word, and it is the flagship

```tsx
<DagrCanvas graph={graph} animate />
```

With it, an edit glides to its new layout instead of cutting to it: nodes spring
to their new centres, edges follow their new routes, and the drawing's box moves
with them. Without it, nothing tweens, which is what the component did before
M5.3a and is still the default.

It is a prop rather than a hook because this component already owns all four
things a hook would have to hand back out: the coalesced frame, the renderer,
the scene conversions, and the delta. What keeps the prop from foreclosing the
other shape is that `createMotionLoop` takes its scheduler as an option. A
caller who owns their own frame leaves `animate` off, takes the renderer off
`useDagrCanvas`, takes the delta and its `from` off `onLayout`, and drives
`createSceneMotion` from their own loop, which is
[the worked example](./render.md#the-loop-the-box-and-the-scene-as-one-thing)
on the render page. `toMotionDelta`, `toMotionRoster` and `retarget` are
exported for exactly that caller, so the flip and the continuity check are not
theirs to rewrite. The component hands the loop its own `requestDraw`, so there
is one frame budget here rather than two, and a burst of edits in one task is
one frame.

The feel is the same prop:

```tsx
<DagrCanvas graph={graph} animate={{ halfLifeSeconds: 0.3 }} />
```

`halfLifeSeconds` is how long a spring takes to close half the remaining gap
(default 0.12) and `restEpsilon` is how close, in world units, counts as arrived
(default 0.05). Both are `@dagr/render`'s, one number each for the whole scene,
because one delta is one change and three arrival times would read as three. The
object is compared by value, like `config`.

Four things worth knowing:

- **The first layout does not animate.** A scene built from a result has no
  history to come from, so it is seeded at rest and drawn where the layout put
  it. Only an edit glides.
- **Sizes do not spring.** A node that changed size takes its new box on the
  frame the edit lands, and only its centre glides. A label that grew measures
  wider because the text that made it wider changed instantly, and a box lagging
  its own contents would clip them.
- **A removed node leaves on the frame its spring settles**, which for a node
  that was standing still is the next one: it is gone rather than faded. A node
  removed mid-glide finishes its move first, so it does not jump on the way out,
  unless that removal arrived in a burst that had to reseat, in which case it is
  gone at once: a reseat describes a whole state, and a node not in it has no
  departure to finish. Nothing fades, because a fade is an appearance and this
  component has no opinion about appearance.
- **The loop stops itself.** It asks for no frame after the one on which every
  spring has arrived, so an idle canvas is an idle canvas.

The [living graph demo](/demos/living) is this prop, `onLayout`, and a few
hundred lines of page. Its source is `packages/living-stage`, and the README there is
worth reading before writing your own: it is mostly a list of the things that
turned out to matter, including the two shapes of edit that looked right and
either moved the whole drawing or moved none of it.

## The camera is fitted once, and the sprung box is yours

The first frame that has both a layout and a viewport frames the graph. Nothing
refits after that, and `fit={false}` skips even the first. Refitting on every
edit would be a camera that jumps whenever the graph changes, which is the
instability the whole incremental-layout milestone exists to keep out of the
layout, reintroduced one level up where no stability metric would see it. An
animated demo that refits every frame would look impressive and would hide the
thing it exists to show, because a drawing that stays put while the camera moves
is indistinguishable from a drawing that moves.

A caller who does want a following camera has the box on every frame, sprung
along with everything else, and writes the one line themselves:

```tsx
<DagrCanvas
  graph={graph}
  animate
  onFrame={(frame, renderer) => {
    if (following && frame.bounds !== null) renderer.camera.fitBounds(frame.bounds);
  }}
/>
```

`onFrame` runs after the renderer has been told what to draw and before it
draws, so a camera moved there moves on that frame rather than the next. The
renderer comes with the frame so that line needs no ref: reaching it through
`useDagrCanvas` would be a child component written to call `fitBounds` once. It
is not called when `animate` is off, because then there are no frames between
layouts to hand over.

The [living graph demo](/demos/living) takes the third option this decision
leaves open, which is worth naming because it is the one an animated demo
usually wants: it does not follow the box at all, and instead its graph is built
so that no edit can make the drawing bigger, which makes one fit correct
forever. A **refit** button is there for a visitor who has panned away, and a
person pressing it is the whole difference between that and an automatic refit.

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
- **A node ontology.** What a node looks like is a callback and it stays one.
  Deciding that a node of kind X draws as a hexagon belongs to the
  [visual-language toolkit](./visual-languages.md), which is scoped precisely so
  that Dagr ships no ontology of its own.
