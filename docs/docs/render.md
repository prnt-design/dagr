---
id: render
title: Renderer
sidebar_position: 4
---

# Renderer

`@dagr/render` draws a graph. It takes coordinates, not a `Graph`: whatever
[`@dagr/layout`](./layout.md) works out goes on screen through a three.js
`WebGPURenderer`, with an orthographic camera, one draw call per shape family,
and springs carrying nodes between one layout and the next.

This page describes the package as of M4.1, which is first light. One quad is on
screen. What is real is the seam everything else plugs into: the `Renderer`
interface, the camera, and two decisions that had to be made before a single
test in this milestone could be written. Both are argued below rather than left
in a commit message, because both are the kind of choice that is cheap now and
expensive in six tasks' time.

## First light, and what that means

`createRenderer` mounts a three.js `WebGPURenderer` on a canvas and draws a
single 100 by 40 quad in amber on near-black. That is the whole scene.

![The demo app: an amber quad drawn through a WebGPURenderer, with a readout of
the camera's zoom, centre, visible world rectangle and canvas
size](../../assets/screenshots/m4.1-first-light.png)

That is `apps/demo`, captured at a device pixel ratio of 1 and 560 CSS pixels
wide. The readout is live camera state rather than a caption: it is how a
screenshot shows that the camera is real, since a still of a coloured rectangle
would look the same whether the projection worked or not.

The size is not arbitrary: it is `@dagr/layout`'s own `defaultNodeSize`, so the
box on screen is the box a default node occupies, and when M4.4 feeds a real
layout in, what changes is the positions rather than the scale. The colours are
not arbitrary either. Amber on near-black is nobody's default, so a frame that
comes out grey, white or black is a frame that did not come from this package,
which turns the most common first-light failure (a blank canvas) from a mystery
into one glance.

Creation is asynchronous, and that is a property of WebGPU rather than a style
choice. Getting a device means requesting an adapter from the browser, which is
a promise, so there is no synchronous moment at which a WebGPU renderer is
usable. Awaiting it once inside `createRenderer` means the object handed back is
ready to draw, and no caller ever holds a renderer that exists but cannot render.

three's `WebGPURenderer` falls back to WebGL2 by itself when WebGPU is
unavailable, so `createRenderer` resolving is not a promise that WebGPU is in
use. M4.1 neither forces a backend nor reports which one won. M4.9 owns the
fallback, including telling the caller what they got.

## The camera

`Camera2D` is an orthographic 2D camera: a world centre, a zoom, and the size of
the canvas it looks through. It is also the only part of this package a unit
test can reach, so it carries the whole of the package's verified contract. See
[How this package is tested](#how-this-package-is-tested) for why that is a
design decision rather than an accident.

### Conventions

Three conventions are fixed here, and every later M4 task inherits them.

**World y is up, screen y is down.** World space is the space a layout is
computed in and the space a caller thinks in. Screen space is CSS pixels with
the origin at the canvas top-left corner, which is where a `PointerEvent`'s
`offsetX` and `offsetY` already are. Note that `offsetX` is relative to the
event's TARGET, so a drag that leaves the canvas, which is exactly the pan
gesture this milestone ships, wants `clientX` minus the bounding rect instead.
The flip itself lives in four methods and nowhere else: `screenToWorld`,
`worldToScreen`, `panByScreen` and `zoomAtScreen`. The last two spell their sign
out independently rather than deriving it from the first two, so a future task
revisiting the convention has four places to look, not two.

Be aware that `@dagr/layout` computes in y-down coordinates. This package first
drafted a `Rect` of `{x, y, width, height}` meaning the bottom-left corner,
which was structurally identical to layout's `Rect` meaning the top-left one.
The compiler cannot see the difference: a layout rectangle assigned into a world
slot compiled clean, and the symptom was a scene mirrored about the horizontal
axis with nothing red anywhere. A docstring on each saying which corner it meant
was the first attempt and was not enough.

So there is no `Rect` here. `Camera2D.visibleWorldBounds()` returns
`WorldBounds`, which is `{minX, minY, maxX, maxY}`. Extents are not structurally
assignable from either rectangle, so the mistake is a type error rather than a
naming convention, and "which corner is `x, y`" stops being a question instead
of being answered. It is also the shape a culling test wants. Converting between
the two spaces still belongs to whatever feeds a layout result into a scene,
which is M4.4; the point of settling the type now is that M4.4 gets a compiler
error at the seam rather than a review comment, and that M4.2 and M4.3, both
written by someone who has just been reading `@dagr/layout`, cannot walk into it
in the meantime.

**Zoom is CSS pixels per world unit.** At zoom 2 a one-unit box draws two CSS
pixels wide, and zooming in raises the number. The alternative reading (world
units per pixel, so zooming in lowers it) is defensible and is what a map
library sometimes means by scale; this is the one Dagr uses.

**The device pixel ratio is read in exactly one method, `drawingBufferSize`.**
Every other method is pure CSS pixels and world units, and changing only the
ratio cannot move a single result by a single bit. That is asserted rather than
intended: the suite checks exact equality across ratios 1, 2 and 3.5, which
holds because the ratio never enters the arithmetic at all. The reason to insist
is that every input event and every CSS length a caller has is in CSS pixels, so
a camera that mixed the two units would be wrong only on the machines the
developer is not using.

### The API

| Method | What it answers |
| --- | --- |
| `screenToWorld(p)` | where a click landed |
| `worldToScreen(p)` | where a world point draws |
| `visibleWorldBounds()` | what the canvas currently shows, as `minX/minY/maxX/maxY` |
| `orthoFrustum()` | the extents an orthographic projection needs, centre-relative |
| `drawingBufferSize()` | how big the drawing buffer should be, in device pixels |
| `panByScreen(dx, dy)` | drag: the world follows the pointer |
| `zoomAtScreen(anchor, factor)` | wheel or pinch: zoom towards the cursor |
| `setCenter`, `setZoom`, `setViewport` | move it, scale it, tell it the canvas resized |

Two of those have a decision inside them worth knowing about.

`zoomAtScreen` keeps the world point under `anchor` exactly where it is on
screen, which is what makes a wheel feel like zooming towards the cursor rather
than towards the middle. The new zoom is clamped into `[minZoom, maxZoom]`
**first**, and only then is the corrected centre derived from it. The other
order passes every test that does not sit on a clamp boundary, and then drifts
the anchor a little further with every further notch of a wheel that is already
at its limit, which is exactly when a user keeps scrolling.

`drawingBufferSize` rounds to the nearest whole device pixel and floors at 1.
Nearest rather than floor, because flooring accumulates a bias that shows up as
a hairline of unpainted canvas along two edges. The floor at 1 exists because a
zero-sized texture is not a legal GPU resource, and 1 is the nearest size that
exists rather than a guess at what the caller meant.

Every value the camera holds has been through a check, which is why the state is
getters and named setters rather than public fields. A public `zoom` field costs
nothing to assign `NaN` to, and a `NaN` zoom does not throw: it propagates
silently into every coordinate, and the first sign of it is an empty canvas.
Nothing falls back to a default, following the same rule the rest of the repo
uses: a fallback is only acceptable where there is a neutral answer, and there
is none for a zoom of `NaN`.

The rule for which error you get is meant to be applicable without judgement,
so that the next task in this milestone does not have to re-run the argument:
**an out-of-range value is a `RangeError` naming the field, and anything else
this package throws gets a named class.** Today that means one class,
`RendererDisposedError`. The split is not about counting failure kinds, it is
about what a caller can do: a bad number is on a line the caller can see and the
field name is the best possible report of it, while use after dispose arrives
from a lifecycle race in somebody else's framework and is the one a caller
actually writes a `catch` for. Matching a message string is not a way to catch
anything. `clearColor` is validated on the same terms, because three validates
none of it: `NaN` and `Infinity` both give black, which is exactly the "broken
renderer" frame the amber-on-near-black default exists to rule out.

### Resize

A resize preserves the centre and the zoom, so **the visible world grows when
the canvas grows**.

The alternative is defensible, which is why this is stated rather than assumed.
A camera that preserved the visible rectangle would rescale the drawing to fit,
which is what an image viewer does. A graph canvas is not an image viewer. A
user who has zoomed in to read a label and then widens the window expects to see
more graph at the same size, not the same graph at a new size, and a resize that
quietly changed the zoom would invalidate every on-screen distance they had
built an intuition for.

## How this package is tested

Node has no WebGPU. That is not a detail to work around later, it is the
constraint that decides how every test in this milestone gets written, so M4.1
settles it before writing any.

Three options were on the table. A headless browser run (Playwright against a
GPU-backed Chrome) is real and heavy, and it is a new CI dependency for a repo
whose CI is currently typecheck plus vitest. A software adapter is portable,
slow, and not what any user runs, so a pass proves something about a
reference implementation rather than about the code path anyone executes. The
third is a split, and it is what this package does.

### Where the line falls

**Anything that is arithmetic or bookkeeping is a pure module, unit tested in
Node, with no device at all.** Camera and viewport math is that, and it is
tested here. Instance bookkeeping (M4.3), spring integration (M4.6), and ID
encode and decode (M4.8) are the same shape and get the same treatment.

**Anything that needs a real adapter is verified by a screenshot, committed in
the run that changes it, and by nothing else.** Screenshots live in
`assets/screenshots/`, capped at 1x device pixel ratio and a stated width.

The split is worth more than its cost because of how the code was arranged to
fit it. The arithmetic was pushed into `camera.ts`, where a seeded property
suite covers it, and `webgpu-renderer.ts` was kept as declarative as it could
be. An earlier draft of this page said the result was that the file with no
coverage is also the file with no decisions in it. That was wrong, and it is
worth recording why rather than quietly deleting: the LIFECYCLE is not wiring.
When the drawing buffer is reallocated, whether `dispose` is idempotent, and
whether a disposed renderer refuses to draw are decisions made in plain
JavaScript about when to call four methods on three collaborators, they need no
adapter, and calling them wiring was how they ended up with no tests. They have
tests now, built over stubs that count those calls, with no device anywhere.

### What is knowingly untested

"We have tests" and "the shader is correct" are different claims, and this
milestone will be tempted to conflate them. So, plainly, what nothing in CI
checks:

- That the quad appears at all, in the right place, at the right size, or in the
  intended colour. The camera suite proves the frustum agrees with
  `worldToScreen` and reaches a real `OrthographicCamera` intact; it cannot
  prove the mesh is drawn, or that its winding faces the camera.
- That the drawing buffer sizes computed here reach a real canvas, or that CSS
  does not stretch the canvas afterwards.
- That `dispose` frees GPU memory. That it is called exactly once, and that a
  disposed renderer then refuses to draw, IS tested.
- That `init()` succeeds, or that three's automatic WebGL2 fallback engages, and
  therefore that anything in `createRenderer` past `init()` runs at all. That
  one has a named casualty: the abort check after `init()` cannot be reached
  without a device to hand back, and deleting it leaves the suite green, which
  was measured rather than assumed. The abort check before `init()` is tested.
- That the two backends agree with each other. That one is M4.9's, by screenshot
  comparison.

### The one seam that is checked

A camera whose `screenToWorld` is perfect in isolation can still be wrong in the
only way that matters, by disagreeing with the frustum it hands to three. A
click would then land somewhere other than the shape it looked like it hit, and
no test in the file would notice.

So `orthoFrustum()` returns plain data, and the suite builds a real three
`OrthographicCamera` from it, wired exactly as the renderer wires one, projects
a world point through `Vector3.project`, and asserts the result matches the NDC
implied by `worldToScreen`. Worst measured disagreement is 6.7e-16, against an
asserted bound of 1e-9.

Running three's own camera rather than reimplementing its algebra is the whole
value of the test. `OrthographicCamera`'s constructor takes
`(left, right, top, bottom, near, far)`, which is not the field order of
`OrthoFrustum`, and the renderer only avoids that by assigning the fields by
name; a hand-rolled projection cannot catch a mistake there, and this one does,
verified by making it. The same camera answers a second question for one line:
the projected z sits at -0.80, inside the near and far planes, so the quad's
plane being inside the frustum came off the untested list above.

Numerical claims in this package quote a measured bound rather than calling
anything exact. The screen round trip holds to within 7.4e-10 CSS pixels over
the suite's range (zoom 1e-3 to 1e3, centres out to 1e4 world units), and
`zoomAtScreen` holds its anchor to within 4.4e-8. Asserted bounds sit one to two
orders of magnitude above the worst case measured, so each is a bound the suite
actually approaches. Nothing here is described as pixel-exact, because no test
here establishes that.

## three.js is a peer dependency

`three` is a `peerDependency` of `@dagr/render`, and also a `devDependency`.
That is the same shape `@dagr/layout` uses for `@dagr/graph`, and for a related
reason rather than the same one: `@dagr/graph` is a peer because nominal typing
through `#private` fields makes two copies incompatible at the type level, and
three.js has no such fields. Its hazard is at runtime instead.

An application that renders a Dagr graph quite likely has its own three.js scene
already. Two copies of three in one bundle is a large amount of duplicated code
and, worse, a source of `instanceof` checks that fail across the copies: hand a
`Material` built by copy A to a `Scene` from copy B and the failure is a
rendering artefact rather than a type error. three.js flags the situation
itself, guarding on `window.__THREE__` at module scope and warning "Multiple
instances of Three.js being imported". Peer means the application picks the
version and owns the single copy. Dev means this package still builds and
typechecks on its own. `@types/three` stays a plain dev dependency, because a
consumer needs the types for the `three` they installed, not for ours.

The range is `>=0.180.0 <1.0.0`, and both ends are chosen rather than derived.
The floor sits a handful of minors below the 0.185.1 the lockfile pins. It is a
judgement that the small list of names this package imports from `three/webgpu`
is stable across them, and not a compatibility claim: 0.180.0 was unpacked and
read, and it exports every one of them, but 0.181 through 0.184 have not been
built against here. By this page's own argument each of three's minors is a
release that could break something, so admitting five of them buys a consumer on
0.182 a silent install where a caret would have given them a warning. That is
the trade, made deliberately. The ceiling is a real 1.0 rather than a caret,
which is the part worth arguing. three's pre-1.0 versioning treats the minor as
its breaking-change slot, so `^0.185.1` resolves only 0.185.x and would put a
peer warning in front of every consumer tracking three's monthly releases, which
is exactly the churn a peer dependency exists to avoid.

**No three.js type appears anywhere in this package's public surface.** That is
a separate decision, and the dependency answer follows from it rather than the
other way around. It does not make the peer optional, though: `webgpu-renderer.ts`
imports `three/webgpu` at module scope and `index.ts` re-exports it, so this
package cannot be imported at all without three being present. The peer is a
present necessity, not a forward commitment. What the empty surface changes is
the FAILURE MODE of getting it wrong: with no three type in a signature, two
copies compile cleanly and misbehave at runtime, where `@dagr/graph`'s
`#private` fields would have made the same mistake a type error at the first
signature that saw one. That is the weaker of the two guarantees, and it is the
reason the peer declaration is doing real work here rather than documenting
something the compiler already enforces.

## Usage

```ts
import { Camera2D, createRenderer } from '@dagr/render';

const canvas = document.querySelector('canvas')!;

// No viewport needed: a canvas that has been laid out is the authority on its
// own size, and createRenderer copies it onto the camera. Bring a camera when
// input has to be wired before the async factory resolves.
const camera = new Camera2D({ zoom: 2, minZoom: 0.05, maxZoom: 50 });

// The signal is how a caller abandons a mount without leaking a device. Abort
// before the adapter is requested and it costs nothing; abort during init() and
// the renderer that was built is disposed for you. Either way the promise
// rejects with the signal's own reason, so you never dispose something you were
// not handed.
const controller = new AbortController();
const renderer = await createRenderer({ canvas, camera, signal: controller.signal });
renderer.render();

// A drag, in CSS pixels, then redraw. The camera is a plain mutable object with
// no change notification, so the caller decides when a frame happens.
camera.panByScreen(event.movementX, event.movementY);
renderer.render();

// A wheel, anchored on the cursor so the point under it stays put.
const rect = canvas.getBoundingClientRect();
camera.zoomAtScreen(
  { x: event.clientX - rect.left, y: event.clientY - rect.top },
  Math.exp(-event.deltaY * 0.001),
);
renderer.render();
```

`Renderer` is a camera, a `resize`, a `render` and a `dispose`. It deliberately
says nothing about scene contents. M4.1 draws a hard-coded quad, and a
`setLayout` designed now would be a guess at M4.4 with nothing to check the
guess against. What the interface does fix is the lifecycle, which is the part
that will not change.

`render()` adopts the WHOLE camera every frame, the drawing buffer size as well
as the frustum, so mutating `renderer.camera` is enough for all three things a
caller can change: pan, zoom, and the canvas size. `resize(viewport)` is sugar
for `camera.setViewport` plus that same sync, a convenience rather than a
correctness requirement. That is worth stating because the first draft pulled
only the frustum per frame and pushed the buffer size from `resize`, and a
`ResizeObserver` that called `camera.setViewport` and then `render`, which is
what the camera's own API table recommends, got a correct frustum drawn into a
buffer still sized for the old canvas. The browser stretched it, and nothing
threw.

There is no render loop. Frames happen when the caller asks for one. A
`requestAnimationFrame` loop would wake the GPU sixty times a second to redraw
an unchanged frame; M4.6's springs are what make a continuous loop necessary,
and that is the task that should add one. Do coalesce, though: an input handler
that calls `render()` synchronously runs at the event rate rather than the
display rate, and a trackpad fling dispatches wheel events faster than the
screen refreshes. `apps/demo` schedules one frame per `requestAnimationFrame`
and drops the rest, which keeps "every frame is one a user asked for" true while
capping it at one per refresh.

`dispose` is idempotent, because a component that unmounts twice is an ordinary
thing rather than a bug worth crashing for. Every other method throws
`RendererDisposedError` after disposal, because rendering into a released device
gets whatever the driver feels like.

## What is not here yet

Almost all of it. M4.1 is one quad and the seam the rest plugs into.

- SDF shapes: rounded rectangles and circles authored in TSL, with fill, outline
  and glow read from one distance field, and derivative-based antialiasing so an
  edge is crisp at every zoom (M4.2).
- Instancing, so ten thousand nodes are one draw call rather than ten thousand
  (M4.3).
- A real layout on screen, which is also where the y-up and y-down mismatch
  above gets resolved once, in one place (M4.4).
- Edge ribbons for polylines and beziers (M4.5).
- Critically damped springs, and with them a real animation loop (M4.6).
- Consuming `LayoutDelta` from `@dagr/layout`'s incremental path, which is the
  point of the whole exercise: untouched nodes stay still and touched ones
  animate (M4.7). This is the single M4 task that genuinely waits on M3.
- GPU picking through an ID buffer pass (M4.8).
- An explicit WebGL2 fallback story, with the backend differences written down
  (M4.9).
- Ten thousand nodes at sixty frames a second, measured rather than hoped for
  (M4.10).
