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

This page describes the package as of M4.2. M4.1 was first light: one hard-coded
quad on a canvas, and the seam everything else plugs into. M4.2 deleted that
quad and gave the renderer something to draw instead, so a fresh renderer starts
empty and paints whatever `setShapes` was last handed. What is real is the
`Renderer` interface, the camera, and two signed distance fields that carry
fill, outline and glow at any zoom. The decisions behind each are argued below
rather than left in a commit message, because each is the kind of choice that is
cheap now and expensive in six tasks' time.

## First light, and what that means

M4.1 had `createRenderer` mount a three.js `WebGPURenderer` on a canvas and draw
a single 100 by 40 quad in amber on near-black. That was the whole scene.

**That quad is gone.** M4.2 removed it, and `createRenderer` now hands back a
renderer with an empty scene: nothing is drawn until [`setShapes`](#shapes) is
called. A renderer that keeps painting something nobody asked for is one whose
caller cannot get a blank canvas and cannot tell their own shapes from its. This
section stays because it is the record of what first light proved, and because
M4.2's own scene reuses both of the arguments in it.

![The demo app: an amber quad drawn through a WebGPURenderer, with a readout of
the camera's zoom, centre, visible world rectangle and canvas
size](../../assets/screenshots/m4.1-first-light.png)

That is `apps/demo` as M4.1 left it, captured at a device pixel ratio of 1 and
560 CSS pixels wide. The readout is live camera state rather than a caption: it
is how a screenshot shows that the camera is real, since a still of a coloured
rectangle would look the same whether the projection worked or not. The demo
still carries that readout over both of M4.2's panes, for the same reason.

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

## Shapes

`Renderer.setShapes(shapes)` is the whole of what this package draws. A shape is
a family, a place, a size and a style, as plain data, with no three.js type
anywhere in it.

```ts
renderer.setShapes([
  {
    kind: 'rounded-rect',
    center: { x: 0, y: 0 },
    size: { width: 700, height: 440 },
    cornerRadius: 24,
    style: {
      fillColor: 0xffb703,
      outlineColor: 0xfff4d6,
      outlineWidth: 2,
      glowColor: 0xff4d00,
      glowRadius: 130,
    },
  },
  {
    kind: 'circle',
    center: { x: -1250, y: 0 },
    // Square, and a circle's radius is half of this. Unequal is a RangeError.
    size: { width: 760, height: 760 },
    style: { fillColor: 0x4cc9f0, outlineColor: 0xeaf9ff, outlineWidth: 26 },
  },
]);
renderer.render();
```

Colours are 24-bit `0xRRGGBB` integers, following `RendererOptions.clearColor`:
a number rather than a CSS string because it is handed straight to three, and
because a string invites `'transparent'`, which is a context-creation flag here
and not a colour. `outlineWidth` and `glowRadius` are in WORLD units, so they
scale with the shape under zoom; a constant-pixel outline needs the camera's
zoom, which a shape record does not have and should not need, so that is a later
decision belonging wherever the zoom already is.

**The whole batch, every call.** Not an add and not a merge: whatever was on
screen is released and the argument is what is drawn from here on. An empty
array is legal and clears the scene. A batch rather than a per-shape handle
because M4.2 has no identity to hang a handle on, and inventing one now would be
the same guess at M4.4 the interface refused to make elsewhere. Cheap to call
every frame is the design target, since that is what an animation does, so the
previous batch's GPU resources are released on each call rather than
accumulated.

**Every shape is validated first, and a rejected batch changes nothing.**
`normalizeShape` runs over the entire batch before a single mesh is released, so
a `RangeError` from shape seventeen leaves the previous batch whole and still on
screen. Validating as it went would leave half of one batch and half of another
in the scene, which is a state no caller can reason about and none can recover
from without knowing where it stopped. After `dispose()`, `setShapes` throws
`RendererDisposedError` like everything else.

### Why `setShapes` is on the interface when `setLayout` is not

M4.1 deliberately refused a `setGraph` and a `setLayout`, on the grounds that
either would have been a guess at the shape of M4.4 with nothing to check the
guess against. That refusal still stands, so `setShapes` needs its own argument
rather than an exemption from that one.

It takes plain data describing literally what M4.2 draws. It names no graph, no
node, no edge and no layout, so it commits this interface to nothing about how a
caller decides which shapes to ask for, which is the whole of what M4.4 is still
free to decide. And it holds three out of the public surface, which is the
constraint the rest of the vocabulary exists to keep: a caller writes
`{ kind: 'circle', ... }` and never imports a `Mesh` or a `Vector2`.

What is behind it is one mesh, one material and one draw call per shape, with
every shape parameter baked into the node graph as a constant rather than fed
through a uniform. That is the naive implementation on purpose: the wrong shape
for ten thousand nodes, and the right one for proving that a single distance
field carries fill, outline and glow. **M4.3 replaces it with instancing behind
this same signature**, so the batch a caller passes is unchanged and what
happens to it is not. Nothing in `shape-material.ts` is built to survive that;
it is built to be deleted by it.

### Two families, and the two rules the circle brings with it

`kind` is `'rounded-rect'` or `'circle'`, and the count of two is load bearing
rather than a starting point. A circle is not a special case of a rounded rect
in this package, and an ellipse is a third family with no closed-form exact
signed distance, so it is deliberately not reachable by passing an unequal size
to a circle.

**A circle's `size` has to be square**, and an unequal pair is a `RangeError`
naming `size`. Both alternatives were worse. Silently taking the min, the max or
the mean draws a shape the caller did not ask for and gives them no way to
notice: the picture is a circle, it is just the wrong circle, and nothing
anywhere reports it. Drawing an ellipse instead makes `circle` a second family
in disguise, and with no exact closed-form distance for one, the outline and the
glow read off that distance would be subtly wrong in a way the fill would not
be. A caller who wants "a circle that fits this box" writes one `Math.min` at
the call site, where they can see which dimension won. `size` is a full extent
in both families so that one field means one thing and the quad sizer has one
code path; a circle's radius is `size.width / 2`.

**`cornerRadius` present at all on a circle is a `RangeError`**, `0` included.
Present rather than nonzero is the line because it is the only one that can be
checked without judgement, and because the bug it exists to catch is a caller
building shapes from a template and flipping `kind` to `'circle'` with the
corner radius still on the record. A rule that let `0` through and rejected
`0.0001` would miss exactly that caller, and would make the error depend on the
value of a field that has no meaning for this kind.

On a rounded rect a **negative** corner radius is a `RangeError`, and a radius
**larger than half the shorter side is clamped** to half the shorter side, which
is where the four corner arcs meet and past which they would have to overlap.
Strict about the sign and forgiving about the magnitude, because a sign error is
written on a line the caller can see while a magnitude is inherited: a radius
bigger than the shape is the ordinary case of a small node under a design that
rounds generously. A zero-sized shape is legal in both families and draws
nothing, which is what a caller animating a node in from nothing wants.

### One distance, three features

Fill, outline and glow all come off the SAME signed distance rather than off
three pieces of geometry. That is M4.2's premise, and it is why `ShapeStyle` is
one record rather than three, and why the shading node takes one distance rather
than three.

The outline is the band where `|distance| <= outlineWidth / 2`, so it STRADDLES
the boundary, half in and half out, and reaches `outlineWidth / 2` past the
edge. The glow starts AT the boundary and falls to nothing at `glowRadius`
beyond it, quadratically: `(1 - distance / glowRadius) ** 2`. The falloff is
quadratic for the far end rather than the near one. It reaches zero with zero
SLOPE as well as zero value, and the eye reads a discontinuity in the gradient
as an edge just as readily as one in the value, so a linear ramp, still falling
when it arrives at the quad's edge, would end every glow in a faint visible
outline exactly where the geometry stops. An exponential falloff is ruled out by
the same requirement from the other side: it never reaches zero, so the quad
would cut it off at some non-zero value and the symptom would be a straight edge
across a soft glow.

The glow is measured from the SHAPE's boundary, not from the outer edge of the
outline. Two consequences worth knowing before either looks like a bug. The quad
takes the LARGER of the two reaches rather than their sum, because both are
level sets of one distance and the painted region is their union; and an outline
wider than twice the glow radius hides the glow entirely, because the whole
falloff lies underneath it. If the shader ever measures the glow from the
outline instead, `shapeQuadSize` becomes a sum and has to change with it.

`fillOpacity` is applied ONCE, to the composited result, despite the name it
inherits from `ShapeStyle`. A shape fading out whose outline stayed solid would
read as a hole rather than as a fading node, and a glow that outlived its shape
would read as a bug. Applying it per layer would also double-count it wherever
two layers overlap in the antialiasing band, and would make a translucent
shape's outline darker than its fill for no reason a reader could find. This is
why `fillOpacity: 0` draws nothing at all rather than an unfilled ring: a ring
is a fill barely above the clear colour with an outline on it.

`outlineColor` and `glowColor` default to `fillColor` rather than to black. With
`outlineWidth` and `glowRadius` at 0 neither is read, so the default matters
only when a caller sets a width or a radius and forgets the colour, and there
the fill colour is the one value that cannot produce an artefact they will
misread: a black ring nobody asked for looks like a shader bug and sends them
into the shader, while a fill-coloured ring looks like the outline they forgot
to colour, which is what happened.

### Antialiasing, which is what the screenshot is of

The coverage ramp is derived from `fwidth(distance)`, the screen-space
derivative of the distance field: how many world units of distance one pixel
step is worth, right here, under whatever projection is live. Because it is
measured per fragment rather than chosen once, the edge is about one pixel soft
at every zoom, and one shader is crisp at 0.1x and at 100x instead of at the
zoom it was tuned for. It is also the one thing the CPU twin cannot have, since
it needs the neighbouring fragment, which is why `edgeCoverage` in `sdf.ts`
takes a filter width as an argument where the shader computes its own.

![Two canvases side by side, both drawing the same four shapes through the same
setShapes call and differing only in their camera. At 0.1x, the whole scene: an
amber rounded rect, a cyan circle, a purple chip with a glow and a dark chip
with a green outline. At 100x, the top-right corner of that same amber rect,
where a broad pale band runs diagonally across the frame with amber fill on one
side of it and orange glow on the
other](../../assets/screenshots/m4.2-sdf-shapes.png)

What to look at is the pale band, because it is the same `outlineWidth: 2` in
both panes. Two world units is **0.2 CSS pixels** at 0.1x on the left and
**200 CSS pixels** at 100x on the right, a factor of a thousand, out of one
shader with no zoom-dependent branch in it. The two readouts are what make that
checkable rather than asserted: 0.100 px/unit and 100.000 px/unit, from the live
cameras. On the left the outline is a tint on the chip's edge rather than a
line, which is the stated limit below; on the right it is a band whose two edges
are each still about a pixel soft, carried on an arc that is still an arc rather
than a run of facets, though at this crop the bow across the pane is only about
twelve pixels. A shader that baked its edge softness into a constant would give
the left pane a staircase and the right pane a 200-pixel gradient, and both
would be visible in this one frame. The circle is there because two distance
fields shipped and a scene with one would only prove one, and the two chips on
the right of the left pane carry a glow with no outline and an outline with no
glow, so a reader can see which pixels come from which term instead of taking
the composite on trust.

The related limit, stated so it is not mistaken for a bug: an outline thinner
than a pixel is under-covered rather than drawn thin and faint and correct,
because the coverage formula is a half-space one and measures each side of the
band independently. That is what the left pane's 0.2-pixel outline is showing.
The fix is a band-aware coverage function, and it is a change to `sdf.ts` first.

**The `WebGPURenderer` no longer carries M4.1's `antialias: true`. It is off.**
M4.1 set it because a graph is edges and box corners and every one of them is a
diagonal that reads as a staircase without MSAA, and it asked M4.2 to revisit
it rather than carry it forward.

The reason it can go is structural rather than a matter of taste. MSAA
antialiases GEOMETRY SILHOUETTES, and after this task the renderer has none: a
shape is painted into a quad strictly larger than itself, so no shape boundary
ever lies on a triangle edge. A fragment shader runs once per pixel and its
result is written to every covered sample, so wherever a quad covers a pixel
completely the resolve reproduces the single-sampled answer exactly, and where
it does not, the shader's alpha there is zero. The edges are antialiased by
`edgeCoverage` from the distance field's own screen-space derivative instead,
which is the whole point of the section above.

The quality side was measured rather than only reasoned: the demo was captured
at both zooms with the flag true and with it false, and the crops are
indistinguishable. **The cost side was not measured.** MSAA buys a 4x-sampled
target plus a resolve every frame, which on a 4K canvas at ratio 2 is a real
bandwidth line against M4.10's 10k-nodes-at-60fps budget, but no number here
says how large it is. Turning the flag off is therefore justified by the
measurement showing nothing is lost, not by a saving anyone has counted.

What would overturn this: geometry whose silhouette is its own edge, a hairline
or a mesh rather than a padded quad. That is the assumption to check first if a
later task puts one on screen, and the flag is still a backend question that
M4.9 owns.

### The quad is bigger than the shape

An SDF shape is drawn on a quad, and **anything the shader paints beyond that
quad is simply not there.** The failure mode is worth being blunt about because
it does not look like a geometry failure: the rasteriser only produces fragments
inside the triangles it was given, so a glow that reaches further than the quad
is not dimmed at the quad's edge, it stops, with a razor-straight cut across a
soft radial falloff. Every instinct says shader bug, and there is nothing wrong
with the shader.

So `shapeQuadSize(size, outlineWidth, glowRadius)` sizes the plane, and the
margin it puts on every side is

```
max(outlineWidth / 2, glowRadius)
  + AA_QUAD_PADDING_FRACTION * max(halfWidth, halfHeight)
```

The first term is the union of the outline's and the glow's reach, discussed
above. The second is room for the antialiasing ramp, and it is ADDED rather than
folded into that `max` because it is not a reach of the same field: it is
centred on whichever level set the shader draws last and spills half a pixel
past it.

That half pixel is the problem `AA_QUAD_PADDING_FRACTION` exists for. The ramp
is about one screen pixel wide and centred on the boundary, so it reaches half a
pixel past the shape, and half a pixel in WORLD units is `0.5 / zoom`. Geometry
is built once and the zoom changes without it being rebuilt, so a quad cannot
reserve that width directly. A proportional pad works anyway, because it is
scale invariant: a pad of `f * halfExtent` world units is `f * halfExtentPx` on
screen at any zoom, so it covers the ramp's outer half exactly when
`f * halfExtentPx >= 0.5`.

**`AA_QUAD_PADDING_FRACTION` is 0.015**, which puts that threshold at
`0.5 / 0.015` = 33.33 CSS pixels of half extent, so about 67 pixels across. A
shape larger than that on screen has its whole ramp inside its quad at any zoom.
The cost is 1.5% of the larger half extent per side: a 100 by 40 node's quad
becomes 101.5 by 41.5, a sliver against any glow and against M4.4's culling
bounds, both of which are built from the same function. The larger half extent
drives both axes rather than each axis padding itself, because the ramp is one
pixel wide on every edge whichever way the edge runs, and a per-axis pad would
under-pad the short axis of a wide flat node, which is exactly the shape whose
long edges show the clipping first.

**Below 33.33 CSS pixels of half extent the outer sliver of the ramp is clipped
at the four edge midpoints, and that is a real limit rather than a solved
problem.** There is no fix available to a function that sizes geometry once for
every zoom, only a bigger constant that would inflate every quad in the scene to
buy a fraction of a pixel on the smallest shapes in it. The constant is exported
so that the material builder, any future geometry code and any demo that has to
stay above the threshold all read the same number; two paddings that disagreed
would size a quad for one ramp and evaluate another, with nothing anywhere
reporting it.

### The math lives twice, and the CPU copy is the authority

Every distance function in this package exists in two places. `sdf.ts` has it as
ordinary numbers, importing nothing from three and knowing nothing about
shaders; `sdf-nodes.ts` has it again in TSL. That is deliberate duplication, not
a refactor nobody got to.

**The CPU copy is the one that is proved, and it is the one to trust.** 47 tests
in `test/sdf.test.ts` cover it, and two carry most of the weight. A square whose
corner radius equals its half extent IS a circle, and `roundedRectDistance`
agrees with `circleDistance` there to a measured worst **8.361e-16 relative**
over 2000 seeded cases spanning four orders of magnitude of radius: nothing
survives that with a sign, a dropped `+ radius` or a `min`/`max` swap in it. And
a brute-force search along the real boundary of the real shape agrees with the
returned distance to a measured worst **9.577e-9**, which is the search's own
sampling error rather than the field's. That second one is what pins the field
as EXACT everywhere rather than merely correct outside the shape, which matters
because the interior is read too: the coverage band has to be centred on the
boundary from both sides, and M4.8's picking needs the sign to be right in the
corners, which is precisely where a user aiming at a node is most likely to
click and miss.

So `sdf.ts` is exported from the package rather than kept internal, and it is
what later tasks should call. `roundedRectDistance`'s sign answers "is this
world point inside this shape", which is M4.8's picking; `shapeQuadSize` answers
"how much room does this shape need", which is M4.4's bounds. Neither wants a
GPU, and a second copy of a distance field is a second chance to get a sign
wrong.

`sdf-nodes.ts` has exactly one job, which is to be a faithful transcription, and
every function in it names the CPU function it transcribes. **If a change there
would make the two disagree, the change belongs in `sdf.ts` first, where a test
can fail over it.** Three places where the two spellings differ are documented
in that file as transcription decisions rather than divergences: the shader
floors its filter width and its glow radius at 1e-8 instead of branching, which
reproduces the CPU's degenerate cases exactly; and it writes the coverage ramp
out longhand instead of as `smoothstep(w / 2, -w / 2, d)`, because those edges
are in descending order and both GLSL and WGSL leave `smoothstep` undefined when
`edge0 >= edge1`, making the concise spelling undefined behaviour that happens
to work on the drivers anyone tries first.

The module is not exported, and neither is `shape-material.ts`. Every signature
in both mentions a three.js `Node`, `Mesh` or material, and a three type in an
exported signature turns two copies of three in one tree from a bundle-size
problem into a type error. `test/index.test.ts` pins the runtime surface as an
exact set for that reason, so adding one is a failing test rather than a
well-meaning edit.

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
Node, with no device at all.** Camera and viewport math is that. So is M4.2's
shape math: the distance fields, the coverage ramp, the glow falloff, the quad
sizer and the whole of shape validation live in `sdf.ts` and `shape.ts`, which
import nothing from three, and between them they carry 102 of this package's
188 tests. Instance bookkeeping (M4.3), spring integration (M4.6), and ID encode and
decode (M4.8) are the same shape and get the same treatment.

That line is why `sdf.ts` and the TSL nodes are separate files that say the same
thing twice: everything about a shape that can be decided on the CPU is decided
where a test can reach it, and what is left in the shader is arithmetic a
screenshot checks. See
[The math lives twice](#the-math-lives-twice-and-the-cpu-copy-is-the-authority).

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

- That any shape appears at all, in the right place, at the right size, or in
  the intended colour. The camera suite proves the frustum agrees with
  `worldToScreen` and reaches a real `OrthographicCamera` intact; it cannot
  prove the mesh is drawn, or that its winding faces the camera.
- That the TSL in `sdf-nodes.ts` computes what `sdf.ts` computes. It is a
  line-for-line transcription of arithmetic that IS proved, on the CPU, and
  nothing in CI executes the transcription. The next section says what was tried
  and what it cost.
- That the compositing in `sdfShading` produces the intended picture. The three
  layered `mix`es, the masking of the glow by `1 - fill` so it exists only
  outside the shape, and the single application of `fillOpacity` at the end are
  the one part of the shader with no CPU twin at all. Colour is what a committed
  reference image is good at, which is the whole reason M4.2's screenshot is of
  a scene with a glow, an outline and a fill in one frame.
- That the antialiasing holds at any particular zoom. "One pixel soft at 0.1x
  and at 100x" is an argument from `fwidth` plus a screenshot, not a
  measurement: nothing counts a pixel.
- That the blending state does what it is set for. `transparent = true` and
  `depthWrite = false` ARE asserted on the built material, along with the quad's
  size, the mesh's position and each call owning its own resources, because all
  of those are decisions made in plain JavaScript on the way to the shader.
  What none of it proves is the picture that comes out: a material with
  `transparent` left false draws every glow's transparent tail as an opaque
  rectangle of fill colour, and there is no error anywhere.
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

### Emitting WGSL headlessly, which does not work

The obvious way to get a shader under test without a device is not to execute
the node graph but to EMIT it: build the WGSL in Node and check the string. That
was tried in M4.2 and it does not work on three 0.185.1. `WGSLNodeBuilder` is
exported from `three/webgpu` and can be constructed against a stub renderer, but
`build()` throws `TypeError: Cannot read properties of undefined (reading
'isContextNode')`, both with and without the third constructor argument.
Reaching a real shader string from there needs enough backend plumbing to amount
to a headless browser under another name, which is the option M4.1 already
priced and rejected. The cost was an afternoon, and it is written down here so
that the next task tempted by it spends nothing.

The nodes are not entirely unexercised, and the difference is worth being
precise about. TSL's `Fn` is LAZY: calling a node factory builds a graph and
does not run the JavaScript body inside it, so a body containing a plain
`TypeError` constructs happily and fails only on a GPU nobody has in CI. A
throwaway script walked the graphs every factory in `sdf-nodes.ts` returns and
forced each `jsFunc` body to run, which caught a real bug: a named-argument body
has to read `rawInputs[0]`, because `FnNode.call` always stores its arguments as
an array. That script is not in the repo, and what it does is a smoke check
rather than a test. It establishes that the bodies execute; it establishes
nothing about the numbers they produce.

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
the projected z sits at -0.80, inside the near and far planes, so the z = 0
plane every shape's quad sits on being inside the frustum came off the untested
list above.

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

// The scene starts empty, so this is the call that puts anything on it. The
// whole batch, every time, validated before anything is touched.
renderer.setShapes([
  {
    kind: 'rounded-rect',
    center: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    cornerRadius: 6,
    style: { fillColor: 0xffb703, outlineColor: 0xfff4d6, outlineWidth: 1.5 },
  },
]);
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

`Renderer` is a camera, a `resize`, a `setShapes`, a `render` and a `dispose`.
The lifecycle is the part M4.1 fixed and the part that will not change. It still
says nothing about a graph or a layout: `setShapes` takes plain shapes rather
than either, for the reasons in [Shapes](#shapes), and a `setLayout` designed
now would still be a guess at M4.4 with nothing to check the guess against.

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

Most of it. M4.1 built the seam, M4.2 put two shape families through it, and
everything below is still ahead.

- Instancing, so ten thousand nodes are one draw call rather than ten thousand.
  This is also where the question M4.2 deliberately left open gets answered: one
  material with a per-instance shape id, or one material per family. The
  deciding factor is per-fragment branch cost at 10k instances and real fill
  rate, which cannot be measured while drawing four shapes, so M4.2's nodes were
  written as composable factories with no opinion about material assembly and
  the call costs a rewiring rather than a rewrite. Whatever M4.3 picks is
  provisional and gets revisited at M4.10 (M4.3).
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
