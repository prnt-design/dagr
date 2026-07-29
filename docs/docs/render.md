---
id: render
title: Renderer
sidebar_position: 4
---

# Renderer

`@dagr/render` draws a graph. It takes coordinates, not a `Graph`: whatever
[`@dagr/layout`](./layout.md) works out goes on screen through a three.js
`WebGPURenderer`, with an orthographic camera, springs carrying nodes between one
layout and the next, and, from M4.3, one draw call per shape family. Today it is
one per shape, which is six.

This page describes the package as of M4.2. Rounded rectangles and circles are
on screen, drawn as signed distance fields. What is real is the seam everything
else plugs into: the `Renderer` interface, the camera, the distance fields and
the shading that reads them, and the decisions that had to be made before a
single test in this milestone could be written. They are argued below rather
than left in a commit message, because each is the kind of choice that is cheap
now and expensive in six tasks' time.

## What is on screen

`createRenderer` mounts a three.js `WebGPURenderer` on a canvas and draws six
shapes: a rounded rectangle and a circle on each of three rungs a decade apart, on
near-black. The rectangles are 10, 100 and 1000 world units across, and each
circle's diameter matches its rung's height, so the circles are 4, 40 and 400.
Every one of them gets its fill, its inset outline and its glow out of a single
distance, and antialiases its own edges from the screen-space derivative of that
distance.

The scene is a ladder rather than one shape, and the reason is what makes the
screenshots evidence. A texture atlas baked at one size looks perfect at the
zoom it was baked for, so a scene of same-sized shapes cannot tell the two
approaches apart however many stills are taken of it. Shapes two orders of
magnitude apart in size put both ends of the range in one frame.

![The demo at zoom 1: a 100 unit rounded rectangle in amber with a navy border and
an orange halo, a blue circle beside it, the 10 unit rung as specks to the left and
the 1000 unit rung entering from the
right](../../assets/screenshots/m4.2-sdf-shapes-1x.png)

That is `apps/demo` at zoom 1, one CSS pixel per world unit, where fill, outline
and glow are all legible at once. The readout is live camera state rather than a
caption: it is how a still shows that the camera behind it is real, and the zoom
row is what makes the two references below checkable.

Those two are the crispness pair, and they are the evidence for the claim in this
task's name. At zoom 100 the 10 unit rung fills the view, so what you are looking
at is one corner arc at a hundred pixels per world unit:

![At zoom 100 the smallest rounded rectangle fills the canvas, its corner a smooth
arc, with a two pixel navy border inside the
edge](../../assets/screenshots/m4.2-sdf-shapes-100x.png)

At zoom 0.1 the same scene is a thousand times smaller. The 1000 unit rung is 100
CSS pixels and still visibly a rounded rectangle with a curved corner and its
border; the 100 unit rung is 10 pixels and keeps both; the 10 unit rung is at the
limit discussed below:

![At zoom 0.1 the whole ladder is a small cluster: the 1000 unit rung at 100
pixels, the 100 unit rung at 10, and the smallest rung at the
limit](../../assets/screenshots/m4.2-sdf-shapes-0.1x.png)

All three were captured against a real WebGPU adapter at a device pixel ratio of
1, cropped to the canvas itself, so each frame is exactly the 1102 by 598 pixels
the renderer drew and nothing else. The canvas is that size because its container
caps it, not because of the window: it measures 1102 by 598 in a 1920 wide window
as readily as in a 1200 wide one, and an earlier version of this paragraph claimed
the window size caused it, which is wrong. Reproducing one takes no gesture: run
the demo and open `#zoom=100`. The frame is
mostly background at 0.1, and that is inherent rather than a framing mistake, since
the visible world there is 11020 world units across and the whole ladder fits
inside it with room to spare.

For the record, this is where the package started one task earlier:
[first light](../../assets/screenshots/m4.1-first-light.png) was a single amber
quad, drawn to prove the pipeline lit up at all.

Creation is asynchronous, and that is a property of WebGPU rather than a style
choice. Getting a device means requesting an adapter from the browser, which is
a promise, so there is no synchronous moment at which a WebGPU renderer is
usable. Awaiting it once inside `createRenderer` means the object handed back is
ready to draw, and no caller ever holds a renderer that exists but cannot render.

three's `WebGPURenderer` falls back to WebGL2 by itself when WebGPU is
unavailable, so `createRenderer` resolving is not a promise that WebGPU is in
use. Nothing here forces a backend or reports which one won. M4.9 owns the
fallback, including telling the caller what they got.

## Shapes are signed distance fields

A shape is not geometry here. Every shape is one padded quad, and the fragment
shader asks a single question per pixel: how far is this pixel from the shape's
boundary, signed negative inside. `roundedRectSDF` and `circleSDF` answer it,
and everything visible is read off that one number.

That is what buys the property the whole approach exists for. Fill, outline and
glow are three regions of one distance rather than three pieces of geometry, so
they cannot disagree about where the edge is, and the edge itself is antialiased
analytically per pixel rather than by sampling. A rounded corner is exact at any
magnification because it is an arc in the arithmetic, not a run of triangles
chosen when the mesh was built.

### Two units, on purpose

**An outline is measured in device pixels and is inset. A glow is measured in world
units and is outside.** The asymmetry is deliberate and it is the substantive
design call in this task.

Device pixels rather than CSS pixels, and the difference is worth stating because
it is visible. The antialiasing width is a derivative taken across a framebuffer
pixel, and the framebuffer is the CSS size times the device pixel ratio, so a
2 pixel outline is 2.00 CSS pixels at dpr 1, 1.00 at dpr 2 and 0.67 at dpr 3. The
reference frames below were captured at dpr 1. Making the border display
independent would need the ratio inside the shader, which would put a second
reader of `devicePixelRatio` next to `drawingBufferSize` and break the single
reader rule the camera states, so the unit is documented rather than converted.

An outline is a property of the screen. A two pixel border should be two pixels at
every zoom, which is precisely what a geometry pipeline cannot do without
rebuilding geometry and what a distance field does for free: the same derivative
that gives the antialiasing width converts pixels into world units at the fragment
being shaded. The band's two 50% points are the boundary itself and `widthPixels`
pixels in, so its outer ramp is centred on the boundary exactly like the fill's,
and "inset" here means it is drawn over the fill and never against the background
rather than that it lies wholly inside the boundary. The shape's footprint is
still a contract, and the paragraph after next is what keeps it: a layout gives a
node a box, and a border that made the shape a pixel larger than that box would
mean a hit test built on the geometry missed pixels the user can see.

A band of w pixels reaches full coverage at w pixel centres, so a hairline draws
one opaque pixel and a two pixel border draws two. That is worth stating because
an earlier draft of this code got it wrong in a way no test caught. It inset the
band by half a pixel so that its coverage was exactly zero at the boundary, which
sounds like the stricter contract and is in fact a worse one: the opaque plateau
of an inset band is w minus 2 pixels wide, which is EMPTY at w = 2, so both pixel
centres of a two pixel outline sampled 0.5 and the outline never drew its own
colour anywhere. It took decoding a real frame to see it, where the navy
`0x023047` came out as `#bc8932`, the amber fill half mixed with it.

The inset bought nothing, and that is the part to keep hold of. Coverage here is
the fill's own ramp applied to `max(d, -(d + w))`, and since `max(d, anything)` is
never less than `d`, outline coverage is at most fill coverage at every distance,
width and antialiasing width. The alpha a shape writes is the max of the three
coverages, so an outline can never make a pixel more covered than the fill already
makes it: the shape's footprint is identical with a border and without one.

The `max` rather than the textbook `abs(d + half) - half` is deliberate, and it is
why the numbers elsewhere on this page are exact rather than nearly exact. The
textbook form computes `(d + half) - half`, which does not land back on `d`, so the
outer ramp comes out a few ulps off the fill's instead of identical to it, the
coverage at the outer cutoff reads about 1e-29 rather than 0, and zoom invariance
holds to 1.4e-16 rather than exactly. The `max` returns `d` unrounded on the outer
side, so all three are exact and the footprint comparison needs no tolerance at
all.

A glow is a property of the shape. The quad has to be padded to contain the halo,
and that padding is baked into the geometry when the mesh is built, so a
pixel-space glow would need the quad resized every time the camera moved. That is
a per-frame scene decision, and M4.4 owns it. A halo that stayed six pixels wide
while its shape grew from one pixel to a thousand would also read as a different
effect at each end of the range.

### The antialiasing width is a gradient length, not `fwidth`

The width of the ramp is the larger of the two per-axis gradients of the
interpolated POSITION, `max(length(vec2(dFdx(p.x), dFdy(p.x))),
length(vec2(dFdx(p.y), dFdy(p.y))))`, and deliberately not `fwidth`.

**Of the position, not of the distance**, which is a correction rather than a
detail. Every field here folds: `roundedRectDistance` runs both coordinates
through `abs` and `circleDistance` squares them, so on the fragment quad holding
a shape's centre all four fragments see the same distance, the difference is zero
and the width collapses. The inset outline then vanishes exactly there, which on
a small shape is the whole shape. The position has no `abs` in front of it and
cannot fold. The euclidean-gradient argument that used to justify differentiating
the distance was sound about magnitude and silent about folding.

`fwidth` is defined as `abs(dFdx) + abs(dFdy)`, the L1 norm of
the same gradient, and L1 exceeds L2 by up to a factor of `sqrt(2)`, 41%, exactly
when the two derivatives are equal. Equal derivatives means an edge at 45
degrees, and a rounded corner is a continuum of diagonals: with `fwidth` the ramp
is correct along the flat sides and up to 41% too soft around the corner, which
reads as corners blurrier than the edges they join. That is the artefact a
distance field is supposed to remove. It costs one `sqrt` per fragment, and the
shader already has one.

This works because the fields are TRUE euclidean distances outside the shape
rather than a cheaper approximation. The gradient of such a field has magnitude 1
in world space, so its screen-space gradient magnitude is world units per pixel
and nothing else. It also means nothing reads the camera: the width follows
whatever transform a mesh has picked up, including one M4.4 has not written yet.

### Where the fade stops, measured

A shape drawn smaller than a pixel fades toward the background rather than
aliasing into a flickering speck, because the coverage falls away with the shape.
That is the behaviour analytic antialiasing is for, and it holds down to about a
pixel: at zoom 0.2 the 10-unit rung draws as a 2 by 2 block of `#7e4d1b`, a dim
amber against the `#ffb703` it is at full coverage.

Below that it stops, and the reason is worth knowing because it is not the
shader's. At zoom 0.1 that same rung does not appear at all: its padded quad is
1.4 by 0.8 CSS pixels, and whether a footprint that small covers a sample point
depends on where it lands on the grid. The 10-unit circle beside it survives as one
dim pixel in the same frame. Nothing a distance field does can help there, because
the fragment that would have faded is never shaded. It is a rasterisation limit,
and the honest place for it is here rather than in a claim that shapes fade all the
way down.

Those two smallest shapes are also the only ones whose fill ramp is clipped by their
own quad in the 0.1x frame, and getting that wrong is easy, so the arithmetic is
worth stating. A quad is padded by the glow radius plus one world unit, and the
fill's ramp reaches half a pixel past the boundary, so the ramp survives above zoom
`1 / (2 * (glowWorld + 1))`. Each rung's glow is a quarter of its height, which puts
the three crossovers at 0.25, 0.045 and 0.005: four of the six shapes are therefore
clean at zoom 0.1 and the two 4-unit-tall ones are not. What is clipped there is the
antialiasing of a shape already under a pixel across, which is why it is invisible
in the frame, and a zoom-aware quad is M4.4's to add.

### What this task deliberately did not decide

Whether the package uses one material with a per-instance shape id or one
material per shape family. That decision belongs to M4.3, which owns the
per-instance attribute anyway, with an explicit revisit at M4.10. The deciding
factor is per-fragment branch cost at ten thousand instances against real fill
rate, and none of that can be measured while six shapes are on screen, so making
the call here would be an irreversible choice at the point of minimum
information.

What that means for the code is that the distance functions are composable nodes
with no opinion about material assembly, and the shading node consumes a
DISTANCE rather than a shape, so any field can go through it including one M4.5
writes for an edge ribbon. Today's scene builds one material per shape because
there is no instance attribute to carry a shape id yet. That is scene
construction, not the architectural answer.

`depthWrite` is off on these materials, which is worth stating because three
leaves it on for transparent materials. Left on, a fragment with alpha 0 still
writes depth and a transparent quad occludes whatever is drawn behind it
afterwards. It makes no visible difference today (the quads are provably
disjoint) and it is exactly wrong for M4.5, which layers edges behind nodes and
selection in front on the same plane.

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

### The shader is arithmetic, and arithmetic is testable

A TSL node graph builds under bare Node with no device and does not evaluate:
`Fn(([p]) => ...)` returns a node, while `getNodeType` needs a builder and code
generation needs a real renderer backend. So the shader's arithmetic cannot be
run in a unit test, and the obvious response is to write each formula twice, once
in TSL for the GPU and once in TypeScript for the tests.

This package does not do that. Every formula is written ONCE, generic over
`Arith<T>`, an interface of nine arithmetic primitives: a literal, four
operators, `abs`, `min`, `max` and `sqrt`. `numberArith` implements them with
`Math` and the test suite runs every formula through it; `tslArith` implements
them in TSL and the shader runs the same formulas through that. The suite
therefore executes the exact expression tree the fragment shader evaluates, node
for node.

What that changes is the size of the untested surface: not six formulas, but nine
one-line adapters plus three pieces of TSL named below, and the assumption that
WGSL agrees with `Math` about the nine for finite inputs. Nine is small enough that
reading them is reviewing them, and a test pins that the two backends have the same
nine members, so a primitive added to one and not the other fails a test rather
than a shader compilation on somebody else's machine.

There is a second, less obvious payoff. A shader computes a hypotenuse as
`sqrt(x*x + y*y)`, and WGSL has no `hypot`. Written separately, the scalar copy
would reach for `Math.hypot`, which is a different function: it rescales to avoid
intermediate overflow and is accurate to under an ulp where the naive form is
not. The two spellings then disagree in the last bits, and an exact assertion
either fails for a reason that is not a bug or gets loosened until it stops
catching real ones. One definition removes the question.

`smoothstep` and `clamp` are WGSL intrinsics and are absent from the nine,
deliberately: each is built from the primitives instead, which costs a few ALU
operations per fragment against the intrinsic and keeps the ramp the tests exercise
identical to the ramp the shader evaluates. M4.10 owns measuring whether that trade
is still right at ten thousand instances, where the budget is far more likely to be
bound by overdraw than by arithmetic.

`length` is NOT one of those, and this is where an earlier draft of this page was
wrong. It is used as an intrinsic, in `antialiasWidth` alone. Counting properly,
three pieces of TSL are executed by no Node test: that `length` over a join of the
two derivatives; the colour `mix` in the shading node, which is vec3 and cannot go
through a float interface at all; and the `mul(size, 0.5)` that halves a rounded
rect's extents inside a deferred `Fn` body, which the suite never runs because it
builds the body directly from pre-halved literals. Their compensating control is
the STRUCTURAL assertions on the node graph rather than a numeric test, and the
first of the three is the one that needed it: swapping the gradient length for
`fwidth` left every numeric test green.

### Crisp at every zoom, as a test rather than a claim

"An edge is crisp at every zoom instead of at one" sounds like something only a
screenshot can show. It is not. The antialiasing width is one device pixel measured
in world units, which is `1 / (zoom * dpr)`, so feeding a distance of k pixels
through the coverage functions at any zoom has to give the same answer: the zoom
cancels, and nothing about the shape's size on screen enters the arithmetic. That
is the property a texture atlas baked at one scale does not have.

The ratio cancels with the zoom, so crispness does not depend on it. What the ratio
does change is how many device pixels a fixed CSS length buys, which is why the
outline's apparent thickness varies across displays while its crispness does not.

The suite asserts it across zooms from 0.1 to 1000. Bit-identical results need a
dyadic k AND a dyadic antialiasing width, which means a power-of-two zoom: dyadic k
alone is not enough, because the ramp's numerator is `aaWidth * (k - 0.5)` and
`k - 0.5` is not a power of two for most dyadic k. An earlier draft of this page
claimed dyadic k was sufficient, and algorithms-review refuted it with
counterexamples at zoom 2.5, 5, 20 and 40, which are ordinary zooms rather than
corners.

Everywhere else the deviation is measured rather than described. The worst across
the k and zoom lists the suite runs is 1.6653e-16, at k = 0.123456 and zoom 2.5,
against an asserted bound of 5e-16: `toBeCloseTo(expected, 15)` passes below half a
unit in the last stated digit, not a whole one, so the headroom is 3.0x. Over a two
million pair random sweep the worst is 3.331e-16, inside the bound by 1.5x, which is
what makes 15 digits a real assertion rather than a formality. Every one of those
numbers is thirteen orders of magnitude under the 1/255 an 8-bit framebuffer can
represent, so "identical" is true of every pixel that can be drawn while "bit
identical" is true of the power-of-two case only. The screenshots then cover what
only a device can: that a real fragment shader's derivatives agree with that
arithmetic.

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

- That any shape appears at all, in the right place, at the right size, or in the
  intended colour. The camera suite proves the frustum agrees with
  `worldToScreen` and reaches a real `OrthographicCamera` intact; it cannot
  prove a mesh is drawn, or that its winding faces the camera.
- **That the shader computes anything.** The nine TSL adapters described above are
  most of it and not the whole of it. Three other pieces of TSL are executed by no
  Node test either: `length` as an intrinsic in `antialiasWidth`, the colour `mix`
  in the shading node, which is vec3 and cannot go through a float interface at all,
  and the `mul(size, 0.5)` that halves a rounded rect's extents inside a deferred
  `Fn` body the suite bypasses by building that body from pre-halved literals. The
  tests prove the node graphs are CONSTRUCTIBLE and assert their STRUCTURE, which is
  a different and much weaker claim than computing the right answer.
- That a real fragment shader's derivatives agree with the coverage arithmetic,
  and therefore that the crispness the suite proves about the formulas is the
  crispness on a display.
- That the drawing buffer sizes computed here reach a real canvas, or that CSS
  does not stretch the canvas afterwards.
- That `dispose` frees GPU memory. That every resource in the list is disposed
  exactly once, and that a disposed renderer then refuses to draw, IS tested.
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
the projected z sits at -0.80, inside the near and far planes, so the z = 0 plane
every shape is drawn on being inside the frustum came off the untested list above.

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
says nothing about scene contents, and M4.2 did not change that: the shapes it
draws are hard-coded, nothing about them is exported, and a `setLayout` designed
now would be a guess at M4.4 with nothing to check the guess against. So M4.2
changed what is DRAWN and not what is CALLABLE, which is why this section reads
the same as it did before it. What the interface does fix is the lifecycle, which
is the part that will not change.

The distance fields and the shading node are internal for a reason worth naming:
a TSL node is a three.js type, and no three.js type appears in this package's
public surface (see below). An exported `Node<'float'>` would make two copies of
three in one consumer's tree a type error rather than the runtime hazard it
already is.

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

Most of it. M4.2 is six shapes, drawn correctly, one draw call each.

- Instancing, so ten thousand nodes are one draw call rather than ten thousand
  (M4.3). This is also the task that chooses between one material with a
  per-instance shape id and one material per family, which M4.2 left open on
  purpose.
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
