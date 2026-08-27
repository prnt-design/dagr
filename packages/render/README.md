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

A node keeps its instance handle across `setNodes` calls, so per-instance state
survives an update: the springs below, and the picking ids.

## Springs, and the loop you still write

`createNodeMotion` is the delta consumer. It holds one spring per node, keyed
by **your** node id and never by a renderer handle, because where a node is on
its way to is a fact about the node rather than about the slot it draws from:

```ts
import { createNodeMotion } from '@dagr/render';

const motion = createNodeMotion();
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

It owns no clock. There is no `requestAnimationFrame` in this package yet, and
edge motion is not here either: both are M4.7b on the
[roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md). A caller
today writes the loop.

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
