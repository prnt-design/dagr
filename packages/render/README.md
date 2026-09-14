# @dagr/render

The renderer behind [Dagr](https://dagr.prnt.design): a three.js
`WebGPURenderer` scene drawing nodes as signed distance fields, instanced, with
a DOM overlay for the content that has to be readable and springs for the
content that has to move.

```sh
pnpm add @dagr/render three
```

`three` is a `peerDependency` (`>=0.180.0 <1.0.0`), so you install it yourself
and there is exactly one copy of it.

```ts
import { createRenderer } from '@dagr/render';

const renderer = await createRenderer({ canvas });
renderer.setNodes([
  {
    id: 'chapter-3',
    shape: 'roundedRect',
    center: { x: 0, y: 0 },
    size: { width: 200, height: 80 },
    cornerRadius: 16,
    fillColor: 0xfb8500,
    glowColor: 0xffb703,
    glowWorld: 20,
  },
]);
renderer.render();
```

## Read this first: `setNodes` does not take a `LayoutResult`

It takes scene nodes with their own centres, sizes, shapes and colours, and
that is deliberate rather than an omission. Naming a `LayoutResult` would make
`@dagr/layout` a dependency of this package, and the **y-down to y-up
conversion belongs to whoever owns the layout**, not to the thing drawing it.
`@dagr/react` is where the two are joined; if you are wiring them yourself,
that conversion is your one line.

A node keeps its instance handle across `setNodes` calls, which keeps its
instance-buffer identity stable while dense slots move. Springs and picking
ids use the caller's node id instead, so they also survive a shape change that
has to replace the handle.

## Springs, the scene, and the loop

`createNodeMotion` is the delta consumer. It holds one spring per node, keyed
by **your** node id and never by a renderer handle, because where a node is on
its way to is a fact about the node rather than about the slot it draws from:

```ts
import { createNodeMotion } from '@dagr/render';

const motion = createNodeMotion();
motion.resync([
  { id: 'plan', center: { x: 0, y: 0 } },
  { id: 'draft', center: { x: 0, y: 80 } },
]);
motion.apply({
  added: [{ id: 'ship', center: { x: 0, y: 120 } }],
  moved: [{ id: 'plan', center: { x: 0, y: 40 } }],
  removed: ['draft'],
});
const frame = motion.advance(dtSeconds);
frame.settled; // true when nothing is moving any more
for (const node of frame.nodes) {
  node.center; // where the spring has got to. Read it, do not mutate it
  node.departing; // removed, and still on its way out
}
```

`apply` takes a `NodeMotionDelta`, which is `@dagr/layout`'s delta **in this
package's coordinates**: centres in world units, y up. The conversion is yours,
for the same reason `setNodes` takes no `LayoutResult`. It follows the same
three rules the layout delta does, so absent means unchanged and a node you do
not name does not move.

`createEdgeMotion` is the same thing for routes, and it takes the delta's edge
lists. An edge is a polyline whose vertex count changes between two routes, so
it resamples both onto the union of their own arc-length parameters first:
every vertex of each route survives exactly, and the settled drawing is the
layout's answer to the bit. `alignRoutes` is that correspondence on its own if
you would rather animate edges your own way. A shared edge whose route changes
animates, while a removed and added edge under one id is seeded at rest on the
new directed route because it is a replacement, not a reroute.

`createSceneMotion` drives both, plus the drawing's box, from one delta and
one clock, and `createMotionLoop` is the clock:

```ts
import { createMotionLoop, createSceneMotion } from '@dagr/render';

const motion = createSceneMotion();
motion.resync({ nodes, edges, bounds }); // once, from the first layout

const loop = createMotionLoop({
  frame(dtSeconds) {
    const frame = motion.advance(dtSeconds);
    renderer.setNodes(frame.nodes.map(dress));
    renderer.setEdges('flow', frame.edges.map(draw));
    renderer.render();
    return frame.settled; // the loop stops asking for frames when this is true
  },
});

// on every relayout:
motion.apply({ nodes: nodeDelta, edges: edgeDelta, bounds: newBox });
loop.wake();
```

A scene delta is applied across nodes, edges and the box **or not at all**. A
loop is woken rather than started: a wake while it is running is the frame it
was going to run anyway, and the first frame after every wake steps by zero so
an idle hour is not a jump. Already have a coalesced `requestAnimationFrame` of
your own? Pass it as `scheduler` and there is one loop, not two. The box is
sprung as a centre and two half-extents so it never turns inside out on the
way; the camera does not read it unless you call `fitBounds` on it yourself.

Two things worth knowing about the springs. A settled spring **snaps exactly
onto its target** rather than stopping within a tolerance, because a permanent
residual does not read as one node slightly misplaced, it reads as a rank of
aligned nodes ending a hundredth of a unit apart. And applying a delta is all
or nothing: a half-applied delta would hand you a desync signal after already
moving the thing you would resync from, so a bad delta raises
`MotionDesyncError` (`MOTION_DESYNC`) having changed nothing.

## Backends

WebGPU where the browser has an adapter, WebGL2 otherwise, and
`renderer.backend` says which one actually drew. Do **not** probe
`'gpu' in navigator` and branch on it: that is true on machines where
`requestAdapter()` then returns `null`, so a capability probe before `init()`
is a lie. Let `createRenderer` resolve and read the answer back.

## The overlay

`createRichNodes` places DOM over the canvas in world coordinates, in tiers
gated by zoom, so names appear before cards do. Elements are **pooled**, which
means a tier must clear its own per-node state on every bind.

## Documentation

The scene model, the shapes, the instancing, the overlay tiers and the
measurements are on the [renderer](https://dagr.prnt.design/docs/render) page.

MIT © prnt.design
