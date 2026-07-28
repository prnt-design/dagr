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

This page describes the package as of M4.2. Two shapes are on screen, a rounded
rectangle and a circle, and neither one is geometry: each is a signed distance
field evaluated per fragment, with its fill, its outline and its glow all read
from that single distance. Around them is the seam everything else plugs into:
the `Renderer` interface, the camera, and a handful of decisions that had to be
made before a single test in this milestone could be written. They are argued
below rather than left in commit messages, because they are the kind of choice
that is cheap now and expensive in six tasks' time.

## First light, and what that means

`createRenderer` mounts a three.js `WebGPURenderer` on a canvas and draws a
hard-coded scene in amber on near-black. In M4.1 that scene was a single 100 by
40 quad, which is the frame below. M4.2 replaced it with the two
[distance-field shapes](#shapes-are-distance-fields) described further down, and
the scene stays hard-coded until M4.4 feeds a real layout in.

![The demo app: an amber quad drawn through a WebGPURenderer, with a readout of
the camera's zoom, centre, visible world rectangle and canvas
size](../../assets/screenshots/m4.1-first-light.png)

That is `apps/demo` as M4.1 left it, captured at a device pixel ratio of 1 and
560 CSS pixels wide. The readout is live camera state rather than a caption: it
is how a screenshot shows that the camera is real, since a still of a coloured
rectangle would look the same whether the projection worked or not.

The size is not arbitrary: it is `@dagr/layout`'s own `defaultNodeSize`, so the
box on screen is the box a default node occupies, and M4.2's rounded rectangle
keeps it. When M4.4 feeds a real layout in, what changes is the positions
rather than the scale. The colours are not arbitrary either. Amber on near-black
is nobody's default, so a frame that comes out grey, white or black is a frame
that did not come from this package, which turns the most common first-light
failure (a blank canvas) from a mystery into one glance.

Creation is asynchronous, and that is a property of WebGPU rather than a style
choice. Getting a device means requesting an adapter from the browser, which is
a promise, so there is no synchronous moment at which a WebGPU renderer is
usable. Awaiting it once inside `createRenderer` means the object handed back is
ready to draw, and no caller ever holds a renderer that exists but cannot render.

three's `WebGPURenderer` falls back to WebGL2 by itself when WebGPU is
unavailable, so `createRenderer` resolving is not a promise that WebGPU is in
use. M4.1 neither forces a backend nor reports which one won. M4.9 owns the
fallback, including telling the caller what they got.

## Shapes are distance fields

A shape here is not a mesh of its own outline. It is a plane, and everything
drawn on it comes from one number: the signed distance from the fragment to the
shape's boundary, negative inside, zero on the boundary, positive outside, and
equal in magnitude to the Euclidean distance to the nearest boundary point. The
units are the units of the coordinates that placed the shape, which is to say
world units.

M4.2 ships two of those fields, an axis-aligned rounded rectangle and a circle,
and one shading function that turns a distance into a premultiplied colour. The
plane each is drawn on is padded beyond the shape, because a glow reaches
outside the boundary and geometry that stopped at the boundary would clip its
own glow.

`size` is the FULL width and height, centred on the origin and halved inside the
function. That is the vocabulary `@dagr/layout` hands out a node box in, and
making every call site pre-halve it is one of the few arithmetic mistakes that
looks completely correct in review. The suite pins it: a 100 by 40 box has its
right edge at `x = 50`, its top edge at `y = 20`, and reads -20 at the centre.

### What one distance buys

Fill, outline and glow are three reads of the same number rather than three
pieces of geometry stacked on each other. The fill is the pixel coverage of the
distance; the outline is the difference of two coverages, one at the boundary
and one an outline width further in; the glow is a ramp in the same distance.

Three things follow, and they are the reason the task is worth a day.

The layers cannot disagree about where the edge is, because there is only one
edge and all three are derived from it. A fill mesh and a separate stroke mesh
have to be kept in step by whoever builds them, and the first symptom of their
drifting apart is a fraction of a pixel of background showing between them.

The shading knows nothing about shapes. Nothing in it names a rectangle, a
radius or a size: it takes a number and returns a colour. So every shape M4 adds
later inherits the same edge quality, and a fix to one edge is a fix to all of
them. That is asserted rather than assumed: the suite shades a circle and a
square whose corner radius is its half side, which are the same set, and the two
come out equal channel by channel to twelve decimal places at every sample.

And a fragment outside every layer contributes exactly zero, not nearly zero, so
padding the plane out for the glow costs only the fragments the glow actually
reaches.

### Written once, run over two arithmetics

The shapes are authored in TSL, which means the real implementation is a graph
of three.js nodes compiled to WGSL, and nothing in Node can execute one. The
usual answer is to write the maths twice, once in TSL for the GPU and once in
TypeScript for the suite, and then the suite tests the copy. A copy that drifts
still passes.

So the maths is written ONCE, generically over a nine-operation scalar algebra
(`literal`, `add`, `sub`, `mul`, `div`, `min`, `max`, `abs`, `sqrt`), and that
algebra is implemented twice: over plain numbers, which is what the unit suite
runs, and over TSL nodes, which is what the shader compiles. Every line the GPU
runs is a line the suite ran, over a different arithmetic, and there is no
second copy to drift.

What it costs, stated so nobody is surprised: the operations are the
intersection of what TSL offers and what a number can do, so there are no
vectors, no swizzles, no `select` and no control flow. A distance field written
this way spells `length(q)` as `sqrt(qx * qx + qy * qy)`, which is the same WGSL
either way. Nine is the smallest set that spells both shapes and all three
shading layers, and it is small on purpose, because every operation added has to
be implemented for both backends and has to mean exactly the same thing in each.

Neither backend promises anything for a `NaN` input: WGSL's `min` and `max` are
unspecified for `NaN` and JavaScript's propagate it. Every value a caller can
hand in is validated before it reaches here.

The two arithmetics are equivalent on ordinary values and not on the edges. WGSL
is free to compute in 32-bit float where the number implementation computes in
64-bit, so a test asserting an exact bit pattern would be asserting something
about doubles the GPU never promised. Every numerical test in this material
asserts a tolerance, and quotes the worst case it measured.

### `fwidth` is a parameter, never a call inside the maths

The shading takes a filter width, the width of one pixel in the distance's own
units. On the GPU that is `fwidth(distance)`, and the call happens at the
fragment assembly site, outside the generic maths.

A screen-space derivative exists only inside a fragment shader. There is no
value a Node test could pass for one and no way for a test to evaluate one, so
keeping it out is exactly what makes the rest testable. It is also the better
factoring on its own merits: the caller is the one that knows what a pixel is
worth, and a caller who wants a deliberately softer or a supersampled edge gets
it by passing a different width rather than by forking the function.

### Coverage is a box filter, not a `smoothstep`

Coverage is `clamp(0.5 - distance / filterWidth, 0, 1)`, and the linearity is
the point rather than a simplification. For a straight edge crossing a pixel,
the covered fraction is the area of a half plane clipped to a square, and that
area is linear in the signed distance from the pixel centre to the edge. So for
the case that dominates a graph view this is not an approximation to the answer,
it is the answer.

`smoothstep` is what most shader code reaches for here, and the criticism worth
making is not that it is too dark. It is symmetric: it gives 0.15625 where the
truth is 0.25 and 0.84375 where the truth is 0.75, too dark on the outer half of
every edge and too light on the inner half. Both halves agree at the boundary,
where each gives exactly one half, which is why getting the boundary right
proves nothing on its own. The artefact is a stroke that reads as slightly soft
and slightly heavy everywhere at once, and it is hardest to spot precisely
because it is everywhere.

The width is floored at 1e-12 before the division. Two divisions have a
caller-supplied width in the denominator and both have a natural way of being
handed a zero: `fwidth` of a distance is exactly zero wherever the rasteriser's
2 by 2 quad straddles no change at all, and a glow width of zero is the obvious
way to spell "no glow". `0 / 0` is `NaN`, and a `NaN` alpha is a transparent or
a black fragment with nothing thrown anywhere along the way, which is the worst
failure available here: silent, and one frame removed from its cause. The floor
is 1e-12 from both ends. It is below any filter width a real frame can produce,
since reaching it would need a zoom of 1e12, by which point 32-bit world
coordinates have long since given out. And it is large enough that
`distance / epsilon` stays finite in 32-bit float for any distance below 3.4e26
world units, so the floor cannot turn one silent failure into another by
overflowing to infinity on the GPU while looking fine in a 64-bit test. Below
the floor, coverage degenerates to a hard step with an exact one half at the
boundary, which is the answer the absence of a filter asks for rather than a
guess at a width nobody supplied.

### The outline is inset, and a hairline fades rather than aliasing

The outline band runs from the boundary INWARD, so its outer edge is the shape's
own edge:
`outlineAlpha = outlineOpacity * (coverage(d) - coverage(d + outlineWidth))`.

An outline centred on the boundary would grow the shape by half the outline on
every side, so a 100 by 40 node box with a 2 unit outline would occupy 101 by 41
and disagree with the layout that placed it. That disagreement is invisible on
one node and shows up as boxes touching where the layout left a gap, and as hit
testing that misses along every edge.

The band's alpha is never negative, and no clamp is needed to make that true.
Coverage is non-increasing in its distance argument and the outline width is
floored at zero, so `coverage(d + width)` is never above `coverage(d)`. That is
worth being sure of rather than clamping anyway: a negative alpha does not
merely hide the outline, it composites as `dst * (1 - srcAlpha)` with a negative
`srcAlpha`, which AMPLIFIES the layer beneath instead of covering it and blows
out the very edge it was meant to draw.

Once the outline is thinner than a pixel, the peak alpha the band reaches is
`outlineWidth / filterWidth`: at any distance where both coverage terms sit in
the linear part of the ramp, their difference is that ratio identically. The
suite measures the peak over a swept range of distances at a filter width of 1,
for outline widths of 0.5, 0.1, 0.01, 0.001 and 1e-6, and finds the ratio to
twelve decimal places in each. That is the right answer rather than a lucky one,
because the ratio IS the fraction of the pixel the band covers. A band that
stayed opaque as it thinned is what makes hairline strokes crawl and sparkle
when a view is zoomed out, and it is the single most common antialiasing
artefact in a graph renderer. Above a pixel wide the band saturates instead of
continuing to brighten, because coverage is itself clamped.

### The glow

The glow is at full strength at and inside the boundary, zero at the glow width
and beyond, and a squared ramp in between. Squared rather than linear because
`t^2` has zero slope where it reaches zero, so the outer edge of the glow simply
stops being there, where a linear ramp leaves a discontinuity in its derivative
that the eye picks up as a faint ring at the glow's outer radius. The inner end
keeps its slope break, which is fine: it sits underneath the fill and the
outline and is never seen. Two multiplies, nothing transcendental, and it is
spellable in the nine operations, which an exponential is not.

It gets no antialiasing of its own and needs none, being already a smooth ramp
many pixels wide. That is asserted rather than argued: its value does not depend
on the filter width at all, at any distance, over widths from 1e-6 to 1e6.

It is outside-only in effect rather than by construction. It is at full strength
inside the shape too, and it is composited UNDER the fill, so an opaque fill
hides it entirely and only the part reaching outside is ever seen. Masking it to
positive distances instead would leave a seam at the boundary, where the masked
glow would meet the fill's own antialiased edge and show a one pixel line of
background through it.

Composite order is glow, then fill over it, then outline over that. The outline
goes last because it is inset, so it lies entirely inside the region the fill
covers and would otherwise be invisible under an opaque fill. The glow goes
first because it is the only layer that reaches outside the shape.

### The result is premultiplied, and the material must say so

The shading returns premultiplied RGBA: each channel has already been multiplied
by the alpha, so `r <= a`, `g <= a` and `b <= a` for any colour in the unit
cube.

Compositing decides it. Straight-alpha "over" is
`out = (src * srcA + dst * dstA * (1 - srcA)) / outA`, which needs a divide per
layer, is undefined wherever the output alpha is zero, which is most of the
plane, and spells colour and alpha with two different expressions so a bug in
one does not show up in the other. Premultiplied "over" is
`out = src + dst * (1 - srcA)`, the same expression on all four channels, no
divide and no special case. With three layers stacked that is three divides and
three undefined regions avoided, and the `r <= a` invariant survives the stack
because both terms are bounded on colour exactly as they are bounded on alpha.
Measured over 20000 random styles, the worst overshoot of any channel past its
own alpha is 0, exactly.

**The caller must blend it as `(One, OneMinusSrcAlpha)`**, which is what a
premultiplied "over" is by the time it reaches the fixed-function blender.
Getting that wrong is not an error: the ordinary straight-alpha equation
`(SrcAlpha, OneMinusSrcAlpha)` multiplies by the alpha a second time, and the
result is a shape that looks right in the middle and has a dark halo around
every antialiased edge and around the whole glow. That reads as "the
antialiasing is a bit off" rather than as "the blend mode is wrong", and people
spend a day on it.

The obvious way to ask three for that is a trap, and it is worth knowing before
M4.3 assembles a material of its own. `NodeMaterial`'s `premultipliedAlpha` flag
does two things, not one: it selects that blend equation, and it also inserts a
`premultiplyAlpha` into the shader's output. A colour that is already
premultiplied, as everything from `shadeDistance` is, would be premultiplied
twice, which is the same dark halo arrived at from the other direction. So the
shape material sets `premultipliedAlpha` to false and writes the four blend
factors out directly. That is not a workaround for a three bug: the flag is
built for a material whose shader produces straight alpha, which is every
material three ships and is not this one.

### Widths are world units, and only the widths are clamped

Every width in a style, the outline's and the glow's alike, is in the same units
as the distance, which is to say world units. That is what makes an outline
scale with its shape rather than with the screen, and it is the choice a graph
view wants: a border specified in pixels would grow relative to its own node
every time you zoomed out.

Colours and opacities are not clamped, and the widths are. The line is drawn
there rather than everywhere for a reason. A negative width inverts the SIGN of
an alpha, and one bad width therefore corrupts the two layers around it. A
colour above one, by contrast, is a perfectly ordinary high dynamic range colour
that a later bloom pass may want, and clamping it would silently destroy an
input rather than protect anything. The premultiplication invariant is stated,
and tested, conditionally on the colours and opacities being in `[0, 1]`.

### The radius clamp is a correctness fix

The corner radius is forced into `[0, min(halfWidth, halfHeight)]` inside the
arithmetic. This package's rule is that an out-of-range value is a `RangeError`
naming the field, and [the camera](#the-api) follows it everywhere. A distance
field cannot: it runs once per fragment inside a shader, where there is no stack
to unwind, no exception mechanism at all, and no caller to catch anything. The
TSL backend would not compile a `throw`. So range correction has to be
arithmetic, one `min` or `max` that the GPU runs as a single instruction.

That is the reason it is a clamp. It is not the reason it is there. Without it
the formula returns a number that is not the distance to its own zero set, and
the error is in the dangerous direction, too small. Two configurations were
measured against a reference that never reads the field's value and only asks
where the sign changes along rays out of the point:

- a 10 by 2 box with radius 3, at (6, 0), reports 1.4721 where the true distance
  to the boundary it draws is 1.7639, a 16.5 per cent underestimate;
- a 2 by 2 box with radius 2, at (2, 0), reports 1.1623 against 1.2679, 8.3 per
  cent.

Push the radius further and the shape does not merely distort, it VANISHES: a 4
by 4 box with radius 10 is positive everywhere, so there is no zero set left for
the number to be a distance to. The mechanism is that with the radius past half
the short side the inner rectangle has a negative half extent, so the folded
corner offset is positive on that axis at every point and the formula
degenerates into the distance to a circle centred outside the shape. Folding
into the first quadrant then reflects that circle across the axes and leaves a
genuine corner in the boundary, which the circle formula keeps measuring
straight past.

The part worth carrying past this milestone is about testing rather than about
shapes. **The broken field is still eikonal.** Its gradient magnitude is 1 to
within 7.5e-11 on the grid it was measured over, which is indistinguishable from
the correct field, because folding preserves gradient magnitude. A suite that
checked only `|grad d| = 1` would have shipped it, and `|grad d| = 1` is exactly
the property that makes derivative antialiasing correct, so it is the property a
reviewer asks for first. That is why the suite also carries a ray-marched
distance-to-zero-set reference, and applies it to the clamped field too: the
clamped field agrees with the distance to its own boundary to 4.4e-16, 2.2e-16
and 1.0e-6 relative on three shapes whose nearest boundary point is on an arc or
a flat edge, and to 1.3e-3 on a sharp square corner, where the reference rather
than the implementation is the imprecise party. Quadrupling the ray count only
halves that last number, which is the signature of a first-order error.

What the caller gets from an over-large radius is the nearest shape that exists,
a stadium or a circle, which is also what every CSS engine does with an
over-large `border-radius`. Two smaller decisions go the same way and for the
same reason, and both were checked rather than assumed. A negative radius clamps
to zero, because left alone it makes the inner rectangle larger than the outer
one and then adds the magnitude back at the end, which is exact along the flat
edges and wrong at the corners: a 4 by 4 box with radius -1 reports 2.4142 at
(4, 4) where the distance to its own boundary is 2.8284. It is not a sharper
than sharp corner, it is a corner the field lies about. And each half extent is
floored at zero, so a negative width degenerates the box to a segment or a point
rather than to an inside-out rectangle whose field reports the origin as OUTSIDE
a box the caller believes they are standing in the middle of.

The circle field is `sqrt(x^2 + y^2) - r` and there is nothing in it to get
wrong, which is exactly why it is there: it is the independent second opinion
the rounded rectangle is checked against. A square whose corner radius is its
half side IS the disc inscribed in it, so the two have to agree everywhere, and
they share no algebra by which they could agree for the wrong reason. Over 20000
random cases they agree bit for bit in 19509 of them and differ by at most
4.343e-16 of the radius in the rest, against an asserted bound of 1e-14. The
residue is real and worth knowing before somebody tries to tighten the test: the
rectangle computes `(|x| - halfWidth) + r` where the circle computes `|x|`, and
with `halfWidth = r` that subtraction cancels digits the addition cannot
restore.

### Crisp at every zoom, as two testable halves

"Crisp at every zoom" is the kind of claim that goes into a README and is never
checked. Here it factors into two properties, both asserted:

- the distance fields are homogeneous of degree one,
  `d(k p, k size, k r) = k d(p, size, r)`;
- coverage is invariant when its two arguments scale together,
  `coverage(k d, k w) = coverage(d, w)`.

Together they are the whole antialiasing argument. Zooming in by `k` multiplies
every distance by `k`, and the filter width is a screen-space derivative so it
scales by `k` as well. The ratio is unchanged, so the fraction of the pixel the
edge covers is unchanged, so the edge is the same edge at every zoom. If either
half failed, edges would soften or harden as a view zoomed.

The numbers, over 20000 seeded random cases each with `k` spanning 1e-3 to 1e3,
which is the range the camera suite draws its zooms from. The rounded rectangle
holds homogeneity to within 7.074e-16 of the scaled shape size, about three
ulps, against an asserted bound of 1e-14. The circle holds it to 1.078e-15 of
the scaled radius against the same bound. Coverage holds its invariance to
2.220e-16, one ulp, from the division rounding differently on the scaled
operands, against an asserted bound of 1e-15. Bounds sit one to two orders of
magnitude above the worst case measured, following the same rule the rest of
this package uses.

The eikonal property has its own test, since it is what licenses treating a
distance divided by a filter width as a number of pixels: the gradient magnitude
of the rounded rectangle is within 1.305e-6 of 1 over the 3871 sampled points
that survive a skip rule, against an asserted bound of 1e-5. The skip rule
excludes a band around the medial axis, the interior set where a point has more
than one nearest boundary point and the field genuinely has a crease, and the
suite asserts that at least 3000 points survived it, so a skip rule that grew
until it skipped everything cannot pass vacuously.

### MSAA is off

`antialias` on the `WebGPURenderer` goes from `true` to `false` here. M4.1
turned it on for a good reason (a scene of box corners and diagonals reads as a
staircase without it) and flagged it to be revisited at exactly this point
rather than carried forward because it was already there.

SDF shapes antialias analytically, per fragment, from the distance field, so
MSAA has nothing to improve on them, and the plane's own geometric edges are
fully transparent under this shading, so there is no geometry left for it to
smooth. MSAA costs a 4x-sampled colour target plus a resolve every frame, which
on a 4K canvas at ratio 2 is a real bandwidth line against M4.10's budget.

Be honest about the evidence on each half. The visual half is verified, by
comparing the scene rendered both ways. The cost half is an argument rather than
a measurement: nothing in this repo has GPU timing, and M4.10 is the first task
with the fill rate and the instance count to put a number on it.

### The scene, and why the 100x preset moves the camera

The demo draws a 100 by 40 rounded rectangle with a corner radius of 10 and a
circle of radius 24, both in M4.1's amber on the same near-black, each on a
plane padded beyond its shape so the glow is not clipped by its own geometry.
There are zoom presets at 0.1x, 1x, 3x and 100x. The first and the last are the
range the crispness claim is demonstrated over on screen, and 3x is where the
demo opens, so it is the one that frames both shapes again after a visit to
either end. The arithmetic behind the claim is asserted over a wider range, 1e-3
to 1e3.

The 100x preset also recentres on a corner of the rounded rectangle, and that is
not a flourish. At zoom 100 a 100 by 40 shape covers 10000 by 4000 CSS pixels,
so a preset that only changed the zoom would fill the canvas with flat amber.
That frame looks exactly like a broken renderer, which is the one thing the
colour scheme was chosen to make impossible, and it would show none of the edge
the preset exists to show.

### What is measured and what is argued

Everything in this material that is a number was measured over doubles in Node,
running the same source the shader compiles: the homogeneity and coverage
invariance above, the eikonal property, agreement with two independently derived
references and with a ray-marched distance to the zero set, the hairline outline
ratio, the premultiplication invariant, the composite order, and the behaviour
of every clamp including the degenerate sizes and the `NaN` cases.

Three claims are not measured, and are named here rather than left to be
inferred.

That the TSL instantiation computes what the number instantiation computes is a
structural argument, not a test. It is the argument writing the maths once buys:
there is one source, and the only thing that could differ is the nine-operation
algebra underneath it. What no test in Node establishes is that a TSL node graph
compiles at all, or that its WGSL rounds the way a double does. It cannot: Node
has no device, and the package does not acquire one to run a test. See
[How this package is tested](#how-this-package-is-tested).

That the shapes appear on screen at all, in the right place, at the right size
and in the intended colour, rests on a screenshot and on nothing else, exactly
as it did at M4.1.

That MSAA costs more than it buys here is an argument, as said above. Only the
visual half of that decision is verified.

## The camera

`Camera2D` is an orthographic 2D camera: a world centre, a zoom, and the size of
the canvas it looks through. Through M4.1 it was the only part of this package a
unit test could reach, and it carried the whole of the package's verified
contract on its own; M4.2's distance fields and shading now sit beside it on the
tested side of the line. See
[How this package is tested](#how-this-package-is-tested) for where that line
falls and why.

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

M4.2 pushed that line further than the split originally assumed it could go. A
fragment shader looks like the far side of it, and the distance fields and the
shading are on this side, because they are written once over a nine-operation
algebra that is implemented for plain numbers as well as for TSL nodes. The
suite is not testing a reference copy of the shader, it is testing the shader's
own source over a different arithmetic. See
[written once, run over two arithmetics](#written-once-run-over-two-arithmetics)
for what that costs and what it does not prove.

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

- That anything appears at all, in the right place, at the right size, or in the
  intended colour. The camera suite proves the frustum agrees with
  `worldToScreen` and reaches a real `OrthographicCamera` intact; it cannot
  prove a mesh is drawn, or that its winding faces the camera.
- That a TSL node graph compiles, or that the WGSL it compiles to rounds the way
  a double does. The shape and shading maths is tested over numbers, and the
  claim that the GPU runs the same maths is structural (one source, two
  implementations of nine operations) rather than measured. What a wrong nine-op
  implementation would break, no test here would catch.
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
the projected z sits at -0.80, inside the near and far planes, so M4.1's quad
being on a plane inside the frustum came off the untested list above.

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
says nothing about scene contents. The scene is still hard-coded, M4.1's quad
replaced by M4.2's two shapes, and a `setLayout` designed now would be a guess
at M4.4 with nothing to check the guess against. What the interface does fix is
the lifecycle, which is the part that will not change.

Nothing in M4.2 widened that surface either. The distance fields and the shading
are three.js node objects, and no three.js type appears in anything this package
exports, for the reasons under
[three.js is a peer dependency](#threejs-is-a-peer-dependency). M4.3 owns
material assembly and is the first real caller, so exporting a shader-node API
now would be a public surface decision at the point of minimum information.

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

Most of it. M4.1 is the seam the rest plugs into and M4.2 is two shapes drawn
through it.

- Instancing, so ten thousand nodes are one draw call rather than ten thousand
  (M4.3). That task also makes the material call M4.2 deliberately left open:
  one material with a per-instance shape id, or one material per shape family.
  The deciding factor is per-fragment branch cost at 10k instances and real fill
  rate, which cannot be measured while drawing two shapes, and M4.3 owns the
  per-instance attribute anyway. Composable nodes are what make the question
  cost a rewiring of an assembly function rather than a rewrite of every shader.
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
