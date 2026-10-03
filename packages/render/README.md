# @prnt/dagr-render

The renderer behind [Dagr](https://dagr.prnt.design): a three.js
`WebGPURenderer` scene drawing nodes as signed distance fields, instanced, with
a DOM overlay for the content that has to be readable and springs for the
content that has to move.

```sh
pnpm add @prnt/dagr-render three
```

`three` is a `peerDependency` (`>=0.180.0 <1.0.0`), so you install it yourself
and there is exactly one copy of it.

```ts
import { createRenderer } from '@prnt/dagr-render';

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
`@prnt/dagr-layout` a dependency of this package, and the **y-down to y-up
conversion belongs to whoever owns the layout**, not to the thing drawing it.
`@prnt/dagr-react` is where the two are joined; if you are wiring them yourself,
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
import { createNodeMotion } from '@prnt/dagr-render';

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

`apply` takes a `NodeMotionDelta`, which is `@prnt/dagr-layout`'s delta **in this
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
import { createMotionLoop, createSceneMotion } from '@prnt/dagr-render';

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

To choose a non-GPU fallback UI before mounting, `await detectBackendSupport()`
returns `{ webgpu, webgl2, preferred }`. It requests an actual adapter (so a
device exposing `navigator.gpu` with none reports `webgpu: false`), tries one
throwaway WebGL 2 context, and never throws. `preferred === null` means neither
backend can start. It says a backend can start, not how fast the scene runs.

## Wheel and key arithmetic

`wheelZoomFactor`, `canvasPoint` and `keyCommand` are the pure functions between
a DOM event and `Camera2D.zoomAtScreen` / `panByScreen`, the same ones
`<DagrCanvas navigation>` uses. See the
[renderer page](https://dagr.prnt.design/docs/render#wheel-and-key-arithmetic).

## The overlay

`createRichNodes` places DOM over the canvas in world coordinates, in tiers
gated by zoom, so names appear before cards do. Elements are **pooled**, which
means a tier must clear its own per-node state on every bind.

## The three-free entry

`@prnt/dagr-render/core` exports `Camera2D`, `fitZoom` and `shapeEdgePath`, with
their types, from modules that never import `three`.

```ts
import { Camera2D, shapeEdgePath } from '@prnt/dagr-render/core';
```

Use it when you want the camera or the edge-path arithmetic and no renderer: an
SVG or DOM drawing, or a server render. The full entry imports `three/webgpu`
at module scope, so a server that externalizes its dependencies loads three.js
to import it, and the core entry is how you avoid that.

They are the same objects the full entry exports. A camera built from one entry
is an `instanceof` the other's `Camera2D`. `three` is still a peer dependency
of the package, so it is installed either way. The core entry is about what
gets evaluated, not what gets installed.

## Documentation

The scene model, the shapes, the instancing, the overlay tiers and the
measurements are on the [renderer](https://dagr.prnt.design/docs/render) page.

MIT © prnt.design

## Node groups

`createNodeGroupLayer({ parent, camera })` draws transparent labeled boundaries
around explicit node sets. `nodeGroupBounds(nodes, group)` computes their world
bounds for camera focus. See the [grouping guide](https://dagr.prnt.design/docs/node-groups)
for synchronization, accessibility, and layout limitations.

## Content navigation limits

Call `camera.setContentBounds(bounds, nodeSize, padding, nodes)` with y-up world bounds
and a representative node size to constrain every camera mutation, including
wheel anchors, direct setters, fitting, and resize. The default node size is
160 by 80 and padding is 0.05. The zoom range runs from full content to a single
node. Smaller axes stay centered; other axes pan inside the padded bounds.
Optional `nodes` supplies node bounds and keeps part of a node visible even in
sparse regions. These bounds also expand the content bounds when needed.
At a boundary, keeping content visible takes precedence over cursor anchoring.
`setContentBounds(null)` clears these constraints and restores the explicit
numeric zoom range. Explicit numeric limits can further restrict content zoom;
when their ranges do not overlap, the larger minimum wins.

`DagrCanvas` supplies these bounds and real node sizes automatically.

### Edge paths

`shapeEdgePath(points, { style: 'smooth' })` returns sampled points for curved
edges. Use `style: 'orthogonal'` for axis-aligned doglegs, or the default
`polyline` for routed segments. `direction` defaults to `horizontal` and also
accepts `vertical`; smoothing `tolerance` defaults to 0.5 world units.
Endpoints and route anchors are preserved. This shapes presentation, without
obstacle avoidance. Pass the result to SVG paths or renderer edges using
`curve: 'polyline'` so they are not smoothed twice.
