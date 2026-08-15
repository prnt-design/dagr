---
id: render
title: Renderer
sidebar_position: 4
---

# Renderer

`@dagr/render` draws a graph. It takes coordinates, not a `Graph`: whatever
[`@dagr/layout`](./layout.md) works out goes on screen through a three.js
`WebGPURenderer`, with an orthographic camera, springs carrying nodes between one
layout and the next, and one draw call per shape family.

This page describes the package as of M4.4, the task that gave it a way to be
told what to draw. Rounded rectangles and circles are on screen, drawn as signed distance
fields, and there is an HTML overlay for the text a signed distance field cannot
draw. What is real is the seam everything else plugs into: the `Renderer`
interface, the camera, the distance fields and the shading that reads them, and
the decisions that had to be made before a single test in this milestone could
be written. They are argued below rather than left in a commit message, because
each is the kind of choice that is cheap now and expensive in six tasks' time.

## What is on screen

Whatever a caller passes to `setNodes`, and nothing else. `createRenderer` mounts
a three.js `WebGPURenderer` on a canvas, draws an empty scene on near-black, and
waits.

```ts
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

That was not always true, and what it replaced is worth a sentence. M4.1 drew one
hard-coded quad and M4.2 a hard-coded ladder of six SDF shapes a decade apart in
size; both were demonstrations, and the ladder's job was to prove that a signed
distance field is crisp at every zoom rather than at one. It did, the frames
below are the evidence, and M4.4 retired it: a package that ships a picture
cannot be handed one.

![Three thousand campaign nodes at the fitted zoom: blue geography tiles, an
amber narrative spine, violet grids of NPCs, green quest DAGs and red pressure
clocks, packed into a 16:9
canvas](../../assets/screenshots/m4.4-campaign-fit.png)

That is the [campaign demo](/demos/campaign), which you can open and drive: 3,010
nodes of a mock D&D campaign, cut into 101 tiles, laid out by
[`@dagr/layout`](./layout.md) in a worker one tile at a time, packed, and drawn
in two instanced calls. The colour families are strata (spine, geography,
people, quests, pressure, reference), which is what makes the far view readable
as structure rather than as confetti. The readout is live camera state rather
than a caption.

![The same campaign at two CSS pixels per world unit: keyed rooms as rounded
rectangles with names above them, each with a crisp inset outline and a
halo](../../assets/screenshots/m4.4-campaign-rooms.png)

The same scene zoomed in, where the nodes are wide enough to carry names. The
names are DOM, positioned by the camera through the overlay described below; the
shapes are the GPU's.

Those two are what M4.4 has evidence for. The crispness pair from M4.2 is what
the shader has evidence for, and it stays committed:

![At zoom 100 the smallest rounded rectangle fills the canvas, its corner a
smooth arc, with a two pixel navy border inside the
edge](../../assets/screenshots/m4.2-sdf-shapes-100x.png)

At zoom 100 one 10 unit rounded rectangle fills the view, so what you are looking
at is a single corner arc at a hundred pixels per world unit. The
[0.1x frame](../../assets/screenshots/m4.2-sdf-shapes-0.1x.png) is the other end
of that range, and neither is reachable in the live demo any more, for the plain
reason that the scene they show is gone: M4.4 retired the ladder. Reproduce both
from the M4.2 commit; what the 0.1x frame documented is recorded in that task's
ROADMAP entry. The campaign's own floor is 0.053 and its ceiling 19.9 on the
reference canvas, which is a narrower range than the ladder's because a campaign
node spans 12:1 in size where the ladder spanned 250:1.

For the record, this is where the package started:
[first light](../../assets/screenshots/m4.1-first-light.png) was a single amber
quad, drawn to prove the pipeline lit up at all.

Every frame here was captured at a device pixel ratio of 1, cropped to the canvas
itself. The campaign pair came through a software WebGL2 rasteriser rather than a
real WebGPU adapter, which is what the machine that runs the agents has; that is
worth knowing for what a screenshot proves and does not.

Creation is asynchronous, and that is a property of WebGPU rather than a style
choice. Getting a device means requesting an adapter from the browser, which is
a promise, so there is no synchronous moment at which a WebGPU renderer is
usable. Awaiting it once inside `createRenderer` means the object handed back is
ready to draw, and no caller ever holds a renderer that exists but cannot render.

three's `WebGPURenderer` falls back to WebGL2 by itself when WebGPU is
unavailable, so `createRenderer` resolving is not a promise that WebGPU is in
use. Nothing here forces a backend or reports which one won. M4.9 owns the
fallback, including telling the caller what they got.

### A node keeps its handle

`setNodes` diffs by `id`. A node present in two consecutive calls is updated in
place, keeping the instance handle it had; one that left is freed, and one that
arrived is allocated. That is not an optimisation, it is the property M4.6's
springs and M4.8's picking ids are keyed on: a node that kept its id but got a
new handle every relayout would lose its velocity and jump.

The one case where the handle cannot survive is a node that changes SHAPE,
because the two shape families are two meshes and an instance cannot move
between them. It is a removal and an addition, and per-instance state keyed to
that node has to be rebuilt.

What `setNodes` deliberately does NOT take is a `LayoutResult`. Naming one would
make `@dagr/layout` a dependency of this package, and the y-down to y-up
conversion belongs to whoever owns the layout. See the conventions section below,
which has said so since M4.1.

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

A glow is a property of the shape. The quad has to be padded to contain the
halo, and that padding sizes the quad in the vertex stage, from the instance's
own glow reach, so a pixel-space glow would need the quad resized every time the
camera moved. That is a per-frame scene decision and nobody owns it yet, for the
reason the padding section above gives. A halo that
stayed six pixels wide while its shape grew from one pixel to a thousand would
also read as a different effect at each end of the range.

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
whatever transform a mesh has picked up, including the per-instance one M4.3
writes in the vertex stage.

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
in the frame, and a zoom-aware quad is nobody's yet: M4.4 scales the quad per
instance in the vertex stage but its padding still has no zoom term, and the
case it would fix is now handled where it costs nothing (the glow's ramp is
capped at the quad, so the halo ends where the quad does rather than being cut
by it).

### One material per family, provisionally

M4.2 left this open on purpose and named the deciding factor: per-fragment branch
cost at ten thousand instances against real fill rate, which cannot be measured
while six shapes are on screen. M4.3 owns the per-instance attribute, so it owns
the assembly, and the call is one material per shape family rather than one
uber-material with a per-instance shape id.

The uber-material's cost is per FRAGMENT and the per-family cost is per DRAW
CALL. A shape id branch is evaluated for every pixel every instance covers, and a
graph at readable zoom is mostly fill; the draw call it saves is one call. The
family count is small and known (a rounded rect, a circle, and whatever M6's VDSL
asks for), so the union of uniforms an uber-material pays for grows at the same
rate as the calls it saves.

This is PROVISIONAL and the revisit gate is M4.10, which is the first point with
the fill rate and the instance count to judge it. What makes it cheap to reverse
is M4.2's own decision: the distance functions are composable nodes with no
opinion about material assembly, and the shading node consumes a DISTANCE rather
than a shape, so reversing this rewires one assembly function and touches no
formula.

`depthWrite` is off on these materials, which is worth stating because three
leaves it on for transparent materials. Left on, a fragment with alpha 0 still
writes depth and a transparent quad occludes whatever is drawn behind it
afterwards. It makes no visible difference today (the quads are provably
disjoint) and it is exactly wrong for M4.5, which layers edges behind nodes and
selection in front on the same plane.

## Instancing, and the one invariant it imposes

One mesh per shape family, each drawing every shape of that family in a single
call. A unit quad is scaled in the vertex stage by the instance's own padded quad
size, so one geometry serves shapes four world units across and shapes a thousand
across, and a campaign of three thousand nodes is two draw calls.

What is per instance is what a graph varies: the centre, the size, the corner
radius, the glow's reach in world units, and two colours. What stays a uniform is
what a design decides once for the whole drawing: the outline colour, the outline
width in device pixels, and the glow's alpha. The glow's REACH is on the instance
side and its ALPHA is not, which looks inconsistent until the quad is considered:
reach sizes the padded quad, so a shared reach would either clip a large shape's
halo or waste fill rate on a small one.

A colour reaching a shader as a uniform is converted from sRGB by three's
`Color`. A colour reaching it as a vertex attribute is converted by nothing, so
the conversion happens on the way into the buffer instead. Skipping it does not
throw and does not look broken: every colour comes out lighter and flatter.

**Removing an instance is swap-with-last, so per-instance state is keyed by
HANDLE and never by SLOT.** Freeing a slot moves the last live instance into it,
which keeps live slots contiguous and keeps one draw call covering them with no
holes and no per-slot liveness test. The cost is that a slot index is not durable
across any removal, and the failure is silent: the slot stays a perfectly valid
index, it merely belongs to a different instance now. Spring state (M4.6, M4.7)
and picking IDs (M4.8) are keyed by handle for that reason, and a handle is never
reused, so a handle held past its instance's removal raises
`UnknownInstanceHandleError` rather than addressing whatever took its place.

None of this is exported. `setNodes` is the seam a caller feeds a graph through,
and an instance HANDLE API on top of it would be a guess at what M4.8's picking
pass wants, made before there is a picking pass. The error classes are exported,
because an error arrives in a caller's `catch` whether or not the module that
throws it did.

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
the two spaces belongs to whatever feeds a layout result into a scene, which is
the caller, and settling the type early is what turned that into a compiler
error at the seam rather than a review comment. The campaign demo does the flip
in one function at the end of its build, so there is exactly one line where the
sign changes.

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
| `fitBounds(bounds, padding?)` | frame a region: centre on it at the padded fit zoom |
| `setCenter`, `setZoom`, `setViewport` | move it, scale it, tell it the canvas resized |
| `setZoomLimits(min, max)` | rebind the zoom range, clamping the current zoom into it |

The zoom range is set at construction and can be rebound later with
`setZoomLimits`, which is what content-derived limits need: the fit zoom
depends on the viewport, so a window resize has to be able to move the range.
The pure fit arithmetic is also exported as `fitZoom(bounds, viewport,
padding)`, so a caller deriving limits and a `fitBounds` call cannot disagree
about what "fits" means.

Two of the methods above have a decision inside them worth knowing about.

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
this package throws gets a named class.** Today that means five, under an
abstract `DagrRenderError` that carries a `code` for a caller who would rather
switch on a value than on a class: `RendererDisposedError` for use after a
renderer's dispose, `OverlayParentError` and `OverlayDisposedError` from the
overlay, and from the instanced path `UnknownInstanceHandleError` for a handle
held past the removal of the instance it named, plus `SceneDisposedError` for
anything holding a scene's GPU resources used after its dispose. The last two
are the whole of what instancing puts on the surface, and they are there because
an error reaches a caller's `catch` whether or not the module that throws it was
exported. The split is not about counting failure kinds, it is about what a
caller can do: a bad number is on a line the caller can see and the field name
is the best possible report of it, while use after dispose arrives
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
- That a browser composes the overlay's two transforms the way the algebra says.
  The layer's `translate() scale()` and an entry's own transform are asserted as
  strings by a suite that never renders them, so a wrong composition order or a
  wrong `transform-origin` would be a green suite and a label half its own size
  away from its shape. The screenshot is what checks it.
- That the reason the overlay rebases its layer origin is quantitatively right.
  Compositor transforms being single precision, and 1e7 CSS pixels being where
  that starts to show, is a reading of how browsers work rather than something
  measured here. What is tested is that the rebase happens when the rule says.
- That text under a scaled ancestor stays sharp, which is the argument for the
  overlay carrying no `will-change`.

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

`Renderer` is a camera, a `setNodes`, a `setEdges`, a `setEdgeStyle`, a
`setEdgeIntensity`, a `resize`, a `render` and a `dispose`. Everything except
the four setters was fixed at M4.1 and has not changed since; the lifecycle was
always the part that would not.

`setNodes` was deliberately absent until M4.4. M4.1 drew a hard-coded quad and
M4.2 a hard-coded ladder, and a `setLayout` designed at either point would have
been a guess with nothing to check the guess against. What it turned out to want
was neither a graph nor a layout result: an ARRAY of nodes, each carrying its own
centre, size, shape and colours, because a renderer has no use for adjacency and
because a caller's colours are a decision about their data rather than about this
package.

```ts
renderer.setNodes(
  [...layout.nodes.values()].map((node) => ({
    id: node.id,
    shape: 'roundedRect' as const,
    // Layout is y-down and the camera is y-up. The flip belongs here, to the
    // caller who owns the layout, and it is worth doing in exactly one place.
    center: { x: node.x, y: -node.y },
    size: { width: node.width, height: node.height },
    cornerRadius: 8,
    fillColor: 0x219ebc,
    glowColor: 0x8ecae6,
    glowWorld: node.height / 4,
  })),
);
renderer.render();
```

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
screen refreshes. The campaign demo schedules one frame per `requestAnimationFrame`
and drops the rest, which keeps "every frame is one a user asked for" true while
capping it at one per refresh.

`dispose` is idempotent, because a component that unmounts twice is an ordinary
thing rather than a bug worth crashing for. Every other method throws
`RendererDisposedError` after disposal, because rendering into a released device
gets whatever the driver feels like.

## Text, without a glyph pipeline

This package draws signed distance fields and has no text renderer. No task
anywhere in M4 or M5 adds one, and an honest one (an atlas, shaping, wrapping,
kerning, bidirectional runs) is weeks rather than an increment. Meanwhile a
graph nobody can read the labels of is a picture of a graph.

So `createHtmlOverlay` puts DOM elements in world coordinates over the canvas
and keeps them registered with the camera. The GPU draws thousands of shapes,
the DOM draws the tens of readable things, and the camera lines them up. The
analogue is react-konva-utils' `Html`, which portals a div and syncs its
transform to a Konva stage; this one answers to a `Camera2D` and carries no
framework at all.

```ts
import { Camera2D, createHtmlOverlay } from '@dagr/render';

// The parent has to establish a containing block, or the overlay throws
// OverlayParentError naming the fix. It is the element the canvas fills.
const overlay = createHtmlOverlay({ parent: stage, camera });

overlay.add({
  // A box scales with the zoom and is gated by how wide it is on screen. The
  // gate is half-open, so a label ending at 160 and a card starting at 160 are
  // never both shown and never both hidden.
  placement: { kind: 'box', bounds, minScreenWidth: 24, maxScreenWidth: 160 },
  // Called when it becomes visible, not when it is registered. A scene has far
  // more entries than elements.
  create: () => buildLabel(node),
});

// From the same callback that renders a frame, never from a rAF of its own.
overlay.sync();

// On unmount. Idempotent, releases every element, and takes the overlay's own
// two divs with it, which nothing else can remove.
overlay.dispose();
```

![The demo at zoom 4: the 4 unit circle carries nothing, the 10 unit rect
carries a one line tag, and the 100 unit rect carries a full card of
fields](../../assets/screenshots/m4.12-rich-nodes-three-tiers.png)

That is all three tiers in one frame, at zoom 4, and the readout says two
overlay elements of six. The 4 unit circle is 16 CSS pixels wide, under the 24
pixel gate, so the GPU has it to itself and it says nothing. The 10 unit rect is
40 pixels and carries a tag. The 100 unit rect is 400 pixels and carries a card.
Nothing in the demo decides that: each shape registered one entry per tier, and
the gates picked.

![The same demo at zoom 100: the smallest rect fills the canvas and its card,
the same size it was, sits inside its top-left
corner](../../assets/screenshots/m4.12-rich-nodes-card.png)

Zoom in to 100 and the 10 unit rect's box has grown from 40 CSS pixels to 1000,
its tag has been replaced by its card, and the card is the same number of pixels
it would be at any other zoom. That is the counter-scale, and it is also why the
card sits INSIDE the box's top-left corner rather than above it: by the time a
box is a thousand pixels wide its top edge is off screen, and anything anchored
above it is off screen too.

Both are 1102 by 598 CSS pixels of canvas at device pixel ratio 1, captured
through the WebGL2 fallback rather than WebGPU, which is what a headless
Chromium on a machine with no GPU has. That bears on the shapes and not on the
overlay, which never touches a GPU: what these frames are evidence for is the
transform composition and the counter-scale, and those are the browser's
compositor either way. Whether the two backends draw the same shapes is M4.9's
question, and it is on the untested list above.

### What one sync does, and what it costs

An entry's transform is written in world units measured from a LAYER ORIGIN,
and the layer carries the camera's transform. So a pan rewrites one string on
one element, no matter how many entries are on screen, and an entry is only
rewritten when it appears, when `place()` replaces its placement, or when the
origin is rebased.

The origin is rebased to the centre of the visible region whenever it falls
outside it. Compositor transforms are single precision: at zoom 100 over a
100,000 unit graph, an absolute offset reaches 1e7 CSS pixels against float32's
roughly 1.7e7 of integer resolution, and cards start to jitter against the
shapes they label. Rebasing bounds the layer's own translation by the viewport
and an entry's coordinates by the larger of the viewport and that entry's own
extent, so a scene of ordinary nodes stays well inside the precision. One entry
the size of the whole graph is the case it does not rescue, since a box is
placed by its top-left corner and a box wider than the view stays on screen
while that corner is arbitrarily far away. Rebasing cannot thrash, because a
fresh origin sits at the centre with half a viewport of slack on every side.

`sync()` reads no layout. No `getBoundingClientRect`, no `offsetWidth`, no
`getComputedStyle` inside the loop (there is one call, at creation, to check the
parent). One layout read in there would make every frame pay for the styles it
wrote a line earlier.

### Inside the layer, one CSS pixel is one world unit

The layer is scaled by the zoom, so an entry's content is authored as it should
look at zoom 1, which is the same identity the camera already states. A 14px
font is 14 world units of text. A 1px border is one world unit and gets thicker
as you zoom in.

Two things follow, and both are wanted. Text does not reflow while zooming,
because layout happens in the layer's local units and the scale is applied
after it. And text stays sharp, because the browser rasterises glyphs after the
transform. The exception is `will-change: transform` on the layer, which
promotes it to a compositor layer that is rasterised once and then scaled as a
bitmap, so the text goes soft under a zoom. The overlay does not set it.

For content that should stay a constant size while its ENTRY is gated by the
node's size on screen, the layer publishes two custom properties, both unitless
and both rewritten whenever the zoom changes: `--dagr-overlay-zoom` and
`--dagr-overlay-inv-zoom`, exported as `OVERLAY_ZOOM_PROPERTY` and
`OVERLAY_INV_ZOOM_PROPERTY` so a stylesheet is not the only place their names
exist. A label inside a box entry counter-scales with
`transform: scale(var(--dagr-overlay-inv-zoom))` and nothing in JavaScript
touches it per frame. That is how the demo's labels stay the same size from
zoom 0.1 to zoom 100 while their boxes grow by a factor of a thousand.

### The cap, and pointer events

An overlay keeps at most `maxElements` elements attached, 200 by default, and
the ones it keeps are the nearest to the camera centre with ties broken by
registration order. This is not a tuning knob: a degenerate zoom qualifies every
label in a graph at once, and a hundred thousand DOM elements is a locked-up
tab, where a hundred thousand instanced quads is a frame. What it costs is
visible: entries pop at the boundary rank as the camera moves.

The layer is `pointer-events: none`, so the canvas keeps every gesture. An entry
with `interactive: true` takes events again, and then swallows the wheel and the
drag over its own area, because the overlay does not forward events to the
canvas: forwarding synthesises input the browser did not send and gets the
coordinate space wrong in exactly the cases (transforms, pointer capture) this
feature is made of. The pattern that works is an inert card with interactive
controls inside it.

### What is untested here

Two claims in this section are not executed by any test, and they belong on the
list further up this page rather than being left implied. That a browser
composes the layer's transform and an entry's the way the algebra says is
verified by the committed screenshot and by nothing else. And the float32
argument for rebasing is a reading of how compositors work plus the absence of
jitter at the zoom the demo reaches, which is evidence rather than a
measurement.

Everything else is tested: the transform composition, the anchor percentages,
the CSS number formatting (CSS has no exponential notation, and a fixed decimal
count would round a small zoom's scale to zero), the gate, the culling, the
rebase rule and the cap ranking are pure functions with a suite; the element
lifetime, eviction, `create` and `release`, the tier bookkeeping and the
lifecycle run against jsdom.

One more thing jsdom cannot do, since it bears on the section after next: it has
no layout engine, so `offsetWidth` and `offsetHeight` there are always zero.
`measureHtmlSizes` is therefore tested for its plumbing (everything mounted
before anything is read, the container styled and then removed, ids mapped to
the elements they came from) with the sizes themselves stubbed. That a real
browser returns the size the content will have where it is drawn is not
established anywhere in this repo.

### Rich nodes, and why there is no tier machinery

`createRichNodes` binds a set of nodes to an overlay, and the whole of semantic
zoom is that **a node registers one entry per tier, all with the same bounds and
adjacent gates**. Disjoint half-open gates mean at most one of them is ever
visible, so the bottom tier is the ABSENCE of an entry, which is the GPU drawing
the shape. There is no level-of-detail machinery anywhere in the overlay, and
the three tiers the demo shows are three lines of configuration.

```ts
import { createRichNodes } from '@dagr/render';

const nodes = createRichNodes({
  overlay,
  tiers: [
    { name: 'label', minScreenWidth: 24, maxScreenWidth: 160, create, update },
    { name: 'card', minScreenWidth: 160, create, update },
  ],
});

// Diffs by id: new nodes register, gone nodes release, moved boxes are
// re-placed, and a node whose `data` is a NEW REFERENCE is re-rendered if it
// currently has an element on screen.
nodes.setNodes(laidOutNodes);
```

`create` returns a blank element and `update` fills it in, and the split is what
lets a tier pool its elements: a card leaving the view goes back to its pool and
the next node to reach card tier gets that element with new content rather than
a fresh subtree. It relies on an ordering the overlay guarantees, that one
`sync()` detaches everything that left the view before it creates anything that
entered it. Two things follow for a tier's own code. `update` has to REPLACE
what it wrote last time, since the element it is handed may have belonged to a
different node a frame ago. And `update` runs on every pop-in during a pan
rather than only when data changes, so a tier that wants its own children back
should stash them in a `WeakMap` keyed by the root in `create`, instead of
re-querying the DOM each time.

`setNode` is beside `setNodes` for the single-node case: a hover, a selection,
one field going live. Moving one node through the bulk setter means allocating a
record per node and walking every tier to change one, which is the wrong shape
at a few thousand nodes. `setNodes` stays the bulk path and the only one that
can remove.

Tier gates have to be disjoint, and `createRichNodes` rejects overlapping ones
rather than trusting it. Two elements on one node would make the overlay's cap
count entries rather than nodes, and a card would draw under its own title. A
caller who genuinely wants two elements on one node at one zoom registers a
second binding, which keeps both intentions visible in the code.

The cost of putting tiers in the entries is that entries scale with tiers times
nodes, so a 2,800 node scene over three tiers scans 8,400 candidates a frame
rather than 2,800. That scan is a few comparisons each and allocates nothing.
What does not triple is what reaches the cap or the DOM, because the gates are
disjoint.

Content in a tier faces the same choice the demo's labels do: it is laid out in
world units, so a card that should stay readable counter-scales through
`--dagr-overlay-inv-zoom`. One thing to know before writing that CSS, because it
is invisible until it is wrong: a LAYOUT length on the counter-scaled element
(`margin`, `left`, `top`) is still in world units, so a `0.5rem` margin is 8
world units and throws the card 800 CSS pixels away at zoom 100. An inset
composed into the transform after the scale is 8 CSS pixels at every zoom.

### Sizes for layout: declare, or measure in one flush

`@dagr/layout` takes sizes through `LayoutConfig.nodeSize`, called once per node
during prepare and on the caller's thread even when the run itself is in a
worker. So a DOM measurement can feed a layout, and the recommendation is to
declare where you can and measure only where you cannot. Declaring is right when
content is templated per node kind, where the size is known by construction and
2,800 offscreen mounts at startup buy nothing. Measuring is right when the size
is a fact about the text, which no constant stands in for.

`measureHtmlSizes` is the second case, and it batches:

```ts
const sizes = measureHtmlSizes(
  nodes.map((node) => ({ id: node.id, create: () => buildCard(node), maxWidth: 220 })),
  { parent: stage },
);
layout({ graph, config: { nodeSize: (node) => sizes.get(node.id) } });
```

It mounts everything, then reads everything. Interleaving a mount and a read per
node forces a layout flush per node, which is the classic quadratic that turns a
startup into seconds. Three details it makes the caller's business: `parent` is
required, because inherited font and custom properties decide the answer and a
card measured under the wrong styles is measured wrong silently; `maxWidth` is
how wrapping content says what width it will finally have, since an
unconstrained paragraph measures as one very long line; and a web font that has
not loaded measures in the fallback face, so await `document.fonts.ready` first.

It reads `offsetWidth` and `offsetHeight` rather than a bounding rect, and the
difference matters here more than it usually would. A rect is measured after
every transform in the ancestor chain, and the section above teaches content to
carry `transform: scale(var(--dagr-overlay-inv-zoom))`, so a rect would return a
card's counter-scaled size and a card measured inside a layer would come back
multiplied by the zoom. Neither is the box a layout should reserve. The cost is
that the sizes are integers, which against a default `nodeSep` of 50 world units
is not a number anybody can see.

## In-canvas text: when the DOM stops being the answer

The overlay exists because this package has no glyph pipeline, and the question
it leaves open is when it should get one. That was measured rather than argued,
with `bench/browser/label-throughput.html`, which drives the real overlay in a
real browser. The full table and the procedure are in `bench/browser/README.md`;
the numbers below are from the dispatch box, headless Chromium with NO GPU and
software rasterisation, at 1200 by 800 CSS pixels and device pixel ratio 1.

| Elements attached | `sync` median | Frame, panning | Frame, still | Frame, panning, promoted |
| --- | --- | --- | --- | --- |
| 120 | 0.2 ms | 33.3 ms | | |
| 357 | 0.2 ms | 83.3 ms | | 16.7 ms |
| 744 | 0.6 ms | | 16.7 ms | |
| 1073 | 0.5 ms | 216.7 ms | | 83.3 ms |

Every frame figure is a multiple of 16.7 ms because the browser paints on a
vsync tick, so a row is a frame count rather than a time: 83.3 ms is five ticks.
Run to run, a row moves by one tick.

**The overlay's own work is not what runs out.** `sync()` costs 0.2 to 0.6 ms at
up to a thousand elements, which is under 4% of a 16.7 ms frame. Neither is
holding the elements: 744 of them with a still camera hold sixty frames a
second. What costs is repainting text under a MOVING transform, about 0.2 ms per
element per frame on this box, and that is the number the label tier is bounded
by. Promoting the layer with `will-change: transform` removes most of it, taking
357 elements from 83.3 ms to 16.7, at the price this page names two sections up:
a promoted layer is rasterised once and then scaled, so the text softens under a
zoom. The overlay does not set it, and a consumer who pans far more than they
zoom now knows what setting it themselves buys.

The other bound is legibility, and it is arithmetic rather than measurement. A
label around 100 by 18 CSS pixels tiles a 1200 by 800 viewport 530 times with no
gaps at all, so a scene a person can read shows one or two hundred. That is the
same order as where the frame budget goes, which is why the default element cap
of 200 is not an awkward number.

### The recommendation

**Keep the DOM for both tiers, and schedule an atlas when a scene wants names on
thousands of nodes while the camera is moving.** That is a real case rather than
a hypothetical: it is M4.10's target, ten thousand animating nodes, and if that
scene is ever asked to show names the measurement above says the DOM cannot,
promoted or not. It is also a different visual product from the label tier as it
stands, closer to a wall of text as texture than to a hundred readable tags.

The card tier should stay DOM permanently. Its content is arbitrary markup with
links, wrapped prose, images and per-kind structure, and reimplementing that over
a glyph atlas is reimplementing a browser. At card zoom only tens of nodes fit on
screen, so it never approaches a count where any of this bites.

Nothing in the overlay's design changes either way, which is the useful part: the
label tier is one entry per node with a gate, so an atlas takes the tier over by
taking its gate over, and the tier above and the tier below stay exactly as they
are.

## Edges are ribbons, and their width is in screen space

`setEdges(groupId, edges)` takes an edge as an id, a centreline in world units
and a colour, and tessellates it into a ribbon: a polyline as a layout routed
it, or a centripetal Catmull-Rom curve through the same points when the group
asks for one. `RoutedEdge.points` from `@dagr/layout` is exactly the input,
after the caller's own y flip.

**A ribbon is a fixed number of DEVICE pixels wide at every zoom**, and that is
the thing to know before drawing one, because a caller expecting a world width
gets a line that does not thicken as they zoom in. A graph spans decades of
zoom and no world width is legible at both ends of one; `@dagr/layout` gives an
edge a polyline and no width at all, so any world width would be invented by
the renderer rather than laid out. An outline is measured the same way and for
the same reason.

Three things follow. One tessellation is valid at every camera, so panning and
zooming never rebuild a buffer. The antialiasing width is exactly one pixel by
construction, so the ribbon shader holds no derivative at all. And a dash
pattern is in pixels too, so it looks the same and flows at one apparent speed
at every zoom.

**Groups are the layering.** Blend order within one mesh is slot order, which
is not durable across a removal, so a scene that wants ribbons under nodes, or
a highlighted path over dimmed ones, declares its groups through
`RendererOptions.edgeGroups` and relies on the order it declared them in. One
group is one mesh and one material.

**`setEdgeStyle` is the per-frame call and touches no buffer.** It carries the
width, an alpha, and how far the dash has flowed. `ribbonWidthAt` is the
arithmetic behind the first two: a clamp between a floor and a ceiling, plus
the alpha that conserves ink below the floor, since a ribbon drawn wider than
the scene says should be fainter in the same proportion. `advanceDashFlow`
moves the pattern and wraps it into one period.

A solid ribbon is the ABSENCE of a dash rather than a duty cycle of 1: a
zero-width gap is still a boundary to a distance field, so a duty of 1 draws a
half-alpha seam once per period along a line that is supposed to be solid.

**`setEdgeIntensity` is the per-edge call**, and it is what a highlight is made
of. It takes a function from an edge's id to a number in `[0, 1]`, and the
shader multiplies both the ribbon's width and its alpha by it: an edge at 1
draws exactly as the group says, and an edge at 0.25 is a quarter as wide and a
quarter as opaque. Hovering a node and fading everything not incident to it is
one call, and only the values that changed are uploaded, as one merged range
before the next draw.

The split against `setEdgeStyle` is the split between what a FRAME decides and
what a POINTER decides. A style is how a whole group is drawn at this zoom;
an intensity is which of its members matter right now. Doing it through groups
instead would mean a group per highlight state and a re-tessellation to move an
edge between them, and doing it through `setEdges` would rebuild every buffer
to change one float.

Intensity is capped at 1 rather than open above it. A group's width is already
a caller's number and raising it there says the same thing to every edge at
once, so a channel that could exceed 1 would give a scene two ways to say how
wide a ribbon is and no rule for which wins.

## What is not here yet

Most of it. M4.4 is a graph on screen, drawn correctly, one draw call per shape
family, and nothing that moves.

- Critically damped springs, and with them a real animation loop (M4.6).
- Consuming `LayoutDelta` from `@dagr/layout`'s incremental path, which is the
  point of the whole exercise: untouched nodes stay still and touched ones
  animate (M4.7). This is the single M4 task that genuinely waits on M3.
- GPU picking through an ID buffer pass (M4.8).
- An explicit WebGL2 fallback story, with the backend differences written down
  (M4.9).
- Ten thousand nodes at sixty frames a second, measured rather than hoped for
  (M4.10).
