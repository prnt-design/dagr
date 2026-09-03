# Changelog

All notable changes to `@dagr/render`. Nothing is published yet, so everything
below is unreleased and the version in `package.json` has never been cut.

This file exists for the same reason `@dagr/layout`'s does, one milestone
earlier in its life. Rendering is where a decision changes what a user sees
without changing a type or an exported name: a sign convention, a rounding rule,
which unit a number is in. A caller upgrading past one of those sees a drawing
in a different place, and no compiler tells them. "Behaviour changed, types did
not" is the category this file has a heading for.

## Unreleased

### Added

- `createEdgeMotion` and `alignRoutes`, the edge half of the delta consumer: one
  spring per point of a route, retargeted by a `LayoutDelta`'s edge lists,
  stepped by the same clock and settling to the same feel as the node half. Nine
  new names on the surface: the two functions, and the types `EdgeMotion`,
  `EdgeMotionDelta`, `EdgeMotionFrame`, `EdgeMotionOptions`, `EdgeMotionTarget`,
  `MotionEdge` and `AlignedRoutes`. (M4.7b)

  **NOTHING EXISTING BEHAVES DIFFERENTLY.** `createNodeMotion` is untouched,
  `setEdges` is untouched, and there is still no render loop in this package.
  `MotionDesyncError` gained a fourth constructor argument saying which roster
  it is about, defaulted so that every message the node half produces is the
  message it produced before.

  **AN EDGE NEEDED A CORRESPONDENCE BEFORE IT NEEDED A SPRING.** A route that
  gains a rank to cross gains a bend, so two routes for one edge can have
  different vertex counts and there is nothing to retarget. `alignRoutes` takes
  the UNION of the two routes' own arc-length parameters, which keeps every
  vertex of each route exactly and puts every added point on a segment the route
  already had. `@dagr/layout`'s `maxRouteDistance` measures a route by Hausdorff
  distance and says a point added on the line a route already ran along measures
  zero, so this correspondence is free in the metric that judges it.

  **A MOVING EDGE DRAWS THE UNION-SIZED POINTS, THEN COMPACTS ON SETTLEMENT.**
  An edge that kept the union after settling would gain a point per reroute and
  end a session drawing a three-point line out of hundreds. Compacting is exact,
  because every point the union added was on a segment of the target route.

  **`MotionEdge.points` DOES NOT KEEP A STABLE COUNT ACROSS FRAMES.** A caller
  that binds per segment should key on the edge and not on the vertex.
  `setEdges` rebuilds a group's geometry whole, so nothing in this package does.

  **A REMOVAL AND AN ADDITION UNDER ONE ID REPLACES THE OLD EDGE.** That is how
  `EdgeDelta` reports changed endpoints: the old edge left and a new one
  arrived. The replacement is seeded immediately at rest on its new directed
  route. A genuinely rerouted shared edge still animates.

- `createNodeMotion`, the node half of the delta consumer: one spring per node,
  retargeted by a `LayoutDelta`'s node lists, stepped by a clock the caller
  owns. Ten new names on the surface: the factory, `MotionDesyncError` with
  code `MOTION_DESYNC`, the two defaults `DEFAULT_MOTION_HALF_LIFE` and
  `DEFAULT_MOTION_REST`, and the types `NodeMotion`, `NodeMotionDelta`,
  `NodeMotionOptions`, `MotionTarget`, `MotionNode` and `MotionFrame`. (M4.7a)

  **NOTHING EXISTING BEHAVES DIFFERENTLY.** M4.6's `stepSpring2D` is unchanged
  and this calls it; `setNodes` is unchanged and this produces what a caller
  builds its argument from. There is still no render loop in this package.

  **IT TAKES CENTRES, NOT A `LayoutDelta`.** `MotionTarget` is an id and a
  world-space centre, y up, which is the conversion `setNodes` already asks a
  caller for. `@dagr/layout` is not a dependency of this package and the y flip
  belongs to whoever owns the layout, which `camera.ts` has said since M4.1.

  **A DELTA THAT DOES NOT DESCRIBE THE SCENE THROWS.** A move naming an unknown
  node, an add naming a known one, a removal of something absent: each is a
  `MotionDesyncError` rather than a silent adoption, and applying a delta is all
  or nothing so a refusal leaves the scene untouched. `resync(targets)` takes
  the roster whole and is the way back, and is also how a scene is seeded.

  **ARRIVAL IS EXACT, WHICH IS A BEHAVIOUR AND NOT A TYPE.** A spring within
  `restEpsilon` of its target, at a speed below `restEpsilon` times `w`, is
  snapped onto the target with its velocity zeroed. The discontinuity is bounded
  by the tolerance and taken at the moment of least motion, and what it buys is
  that a settled scene advanced again returns the same frame to every bit, so a
  caller's loop can stop. Stopping at the tolerance instead would leave a
  residual that is permanent, and the visible form of that is a rank of nodes a
  layout aligned that stop a hundredth of a unit apart.

  **A REMOVED NODE LEAVES WHEN ITS SPRING FINISHES.** Until then it is in the
  frame with `departing: true`. One removed while already at rest is gone on the
  next frame. One re-added while still departing keeps where it is and where it
  was going, because a re-add of something still on screen is a departure
  cancelled and not a node arriving.

  **EDGES ARE M4.7b, AND THE BOUNDS CHANGE AND THE LOOP ARE M4.7c.** A node
  moves as a point; an edge is a polyline whose vertex count changes between two
  routes, so there is nothing to retarget until something decides what
  corresponds to what.

- `backend` on `RendererOptions` and `backend` on `Renderer`: which of three's
  two backends to draw through, and which one you got. `'auto'` (the default)
  takes WebGPU where the machine has it and WebGL2 where it does not; naming
  `'webgpu'` or `'webgl2'` turns the preference into a requirement and rejects
  with a new `BackendUnavailableError`, code `BACKEND_UNAVAILABLE`. The three
  new names on the surface are that error and the two string-union types
  `RendererBackend` and `BackendPreference`. (M4.9a)

  **NOTHING BEHAVES DIFFERENTLY BY DEFAULT.** three's `WebGPURenderer` has always
  fallen back to WebGL2 by itself, so `createRenderer({ canvas })` builds exactly
  what it built before and resolves in exactly the cases it resolved before. What
  is new is that a caller can find out. A fallback nobody can see is a
  performance cliff a consumer discovers first, and until now `createRenderer`
  resolving was the only signal and it said nothing about which backend resolved
  it.

  **AUTOMATIC BY DEFAULT, EXPLICIT ON REQUEST.** Refusing by default would make
  this package unavailable on every browser that has not shipped WebGPU, for a
  reason the person looking at the blank canvas cannot act on. Refusing when
  asked is a different thing: a caller who wrote `backend: 'webgpu'` is saying
  their scene is only worth drawing on the fast path, and the useful answer to
  that is an error rather than a slower frame.

  **DO NOT PROBE `navigator.gpu`, AND THAT IS MEASURED.** On the headless
  Chromium this repository's browser probe runs on, `'gpu' in navigator` is
  `true` and `navigator.gpu.requestAdapter()` then returns `null`. A capability
  check before construction would have reported WebGPU on a machine that cannot
  give one, which is the exact wrong answer for the one caller who cared enough
  to ask. The backend is therefore read AFTER `init()`, off what three actually
  built.

  **NO FALLBACK EVENT, DELIBERATELY.** three falls back inside the `init()` that
  `createRenderer` awaits, so there is no moment at which a caller holds a
  renderer and does not already have `renderer.backend`. A callback would be a
  second way to learn one fact, delivered before the caller has anything to do
  with it.

  **`'unknown'` IS A THIRD VALUE AND NOT A THIRD BACKEND.** The backend is named
  by reading three's `isWebGPUBackend` and `isWebGLBackend` markers, which three
  declares on its two concrete backends and not on the `Backend` type that
  `renderer.backend` has. A release that renames either one leaves a renderer
  that draws perfectly and cannot be named, so `'auto'` reports `'unknown'` and
  hands it back rather than trading a working renderer for a naming problem. A
  caller who NAMED a backend asked for a guarantee that can no longer be made,
  and is refused. Same fact, two answers, one rule.

- `PickIdSpaceExhaustedError`, and `PICK_IDS_EXHAUSTED` on
  `DagrRenderErrorCode`. The only two names M4.8a puts on the surface: the id
  encoding, the readback pixel arithmetic and the id registry under them are
  internal, because a caller has nothing to encode until M4.8b ships a pass
  that writes the bytes and a `pick()` that reads them back. (M4.8a)

  **WHY HALF A TASK.** M4.8 is an offscreen pass that draws every instance in a
  colour naming it and reads back one pixel. The pass, the target and the
  readback need a device; what a pixel says, which pixel a pointer is asking
  about, and which node an id still means do not. The half that needs no device
  is exhaustively testable and the half that needs one cannot be verified at
  all on a box whose headless Chromium has no WebGPU, so shipping them together
  would put both behind the same green tick. Splitting a task in two is what
  M2.4 and M2.6 did when one run could not carry both halves; the seam here is a
  device rather than a scope.

  **THE ID IS NOT THE SLOT AND NOT THE HANDLE.** A slot costs nothing to write,
  since the shader already knows its own instance index, and it is wrong:
  `InstanceBuffer` removes by swapping the last live instance into the freed
  slot, and a readback answers a question about a frame already drawn, so by
  the time the pixel is decoded the slot may name somebody else. A handle is
  durable and unbounded, so it passes three bytes in a long session and
  truncating one collides. The pick id is a third name, durable like a handle
  and bounded like a slot, keyed by the caller's own node or edge id rather than
  by a handle because that is the name a pick has to come back as, and because
  handle spaces are per family: the first rounded rect and the first circle are
  both handle 1.

  **THREE BYTES AND A TAG, FOR A DIFFERENT REASON THAN THE ROADMAP GAVE.** The
  entry justified the tag byte as letting a hit say what it hit without a side
  lookup. That reason does not survive contact with the registry, which IS a
  side lookup, exists for the recycling, and is on the path of every pick. The
  tag is worth having because it PARTITIONS the id space, so nodes and edges
  keep separate allocators instead of sharing one counter across two meshes
  that know nothing about each other, and because it survives a stale answer:
  a pick that cannot be resolved can still say the pointer was over an edge.
  Tag 0 is nothing and no instance is given id 0, so a target cleared to all
  zeros reads as a miss with no reserved value for a caller to remember.

  **THE ID IS DECOMPOSED ON THE CPU, AND THE MARGIN IS MEASURED.** Handing the
  shader one number and splitting it there costs no bytes per instance and
  loses nodes. Every vertex of an instance's quad carries the same value, so
  the interpolated value differs from it by about a float32 ulp, and at 2^24
  that ulp is exactly 1: one bit of drift is the next id. Three byte-valued
  channels drift by 6e-8 against an RGBA8 write that rounds to the nearest
  1/255, a margin of about 3e4. `test/picking.test.ts` asserts the surviving
  encoding over every byte value there is and shows the rejected one losing at
  the top of its range, which is the repo's rule about a guard that passes by
  construction.

  **A REFUSED PICK IS A DESIGNED ANSWER.** Between the pass and the pixel a
  scene can release a node's id and give it to another, and the decoded id then
  resolves to a real node that was not under the pointer. Every assignment
  bumps a stamp, each id remembers the stamp it was assigned at, and a pass
  records the stamp it drew with; an id that changed hands since resolves to
  nothing. The comparison is PER ID rather than against one revision for the
  whole registry, because a scene that adds a node every frame bumps the stamp
  every frame and a registry-wide revision would refuse every pick in flight in
  exactly the scenes picking is for. The free list is FIFO on top of that,
  which changes nothing about correctness and makes a refusal rarer.

  **ONE ASSUMPTION IS CARRIED RATHER THAN CHECKED**, and it is named where it
  is made: screen y grows downward and three's readback measures y from the
  bottom of the target, so `pickReadbackPixel` flips the row. No test in Node
  can confirm that. A flip got backwards is a pick that is perfect in the
  middle of the canvas and names the wrong node everywhere else, which is why
  M4.8b owes the confirmation rather than inheriting the claim.

  **THE CHANNEL BUDGET DID NOT MOVE.** M4.3 reserved the instanced node
  pipeline's one free vertex buffer slot for M4.6's spring velocity or M4.8's
  picking id. The picking id does not want it: the pick bytes reach the GPU as
  an attribute the PICK material reads and the node material does not, and
  `instance-attributes.ts` counts what a shader reads rather than what a
  geometry carries, so this is D3's situation rather than a seventh channel, a
  different pipeline with its own eight. Half the contest for that slot is off
  and nothing here says anything about M4.6's half. M4.8b is what actually adds
  the attribute, and it should confirm the count there rather than trust this
  paragraph.

- `requireIntegerInRange(value, min, max, field)` in the internal `validate.ts`,
  beside `requireIntegerAtLeast`. Every bound a pick id has is two-sided for a
  structural reason: a value past the end of a bit field is not a large number
  but a different number once the bits above the field are dropped, so
  `0x1000001` as an id would encode as 1, which belongs to somebody else.
  (M4.8a)

- Critically damped springs: `stepSpring`, `stepSpring2D`, `omegaForHalfLife`,
  the constants `HALF_LIFE_OMEGA` and `SETTLE_OMEGA_1_PERCENT`, and the types
  `SpringState` and `Spring2DState`. Nothing in the renderer calls them; they
  are the motion arithmetic M4.7 will drive from layout deltas, exported
  because the caller owns the clock. (M4.6)

  **THE STEP IS EXACT, AND THERE IS NO FIXED-TIMESTEP ACCUMULATOR.** The
  ROADMAP's M4.6 entry asked for one, and the reason it usually exists is the
  reason there is none: an accumulator bounds an approximate integrator's
  error so behaviour does not change with the frame rate, and a closed-form
  step has no such error to bound. Ten steps of a millisecond and one step of
  ten agree to machine precision. Shipping one anyway would cost the property
  it protects, since a fixed substep leaves a remainder that is either dropped
  (a lag that differs per frame rate) or carried (a stagger at constant
  velocity).

  **A LONG FRAME IS SAFE WITHOUT A CLAMP.** A backgrounded tab's delta lands
  the spring on its target with zero velocity, which is what a returning tab
  should show. Past a `w * dt` of about 745 the decay underflows in a double
  and the target is returned directly, rather than multiplying a possibly
  infinite displacement by zero. A zero delta is an identity by construction
  too: `target + (position - target)` is not `position` in a double, so a
  paused clock would otherwise walk a resting spring off its own value.

  **NO OVERSHOOT MEANS NO OSCILLATION AND NOT NO OVERSHOOT.** A spring
  released from rest never passes its target; one retargeted while moving can
  pass it once and come back, and once is the bound. Both are asserted over a
  grid rather than argued.

  It lives inside this package and is exported, which is the third option the
  M4.6 entry named and the second time this package has taken it after the
  HTML overlay. It imports the `Vec2` type and the shared validators and
  nothing else, so a later split is a file that travels rather than code that
  is rewritten.

- `setEdgeIntensity(groupId, intensityOf)` on `Renderer`: one number per edge in
  `[0, 1]`, which the ribbon shader multiplies BOTH the width and the alpha by.
  A type-level addition to the `Renderer` interface and no new exported name.
  (D3)

  **WHY A CHANNEL RATHER THAN A GROUP.** `setEdgeStyle` is per group, which is
  the right grain for what a FRAME decides (the width a zoom implies, the fade
  a far view owes) and the wrong one for what a POINTER decides. Highlighting
  the edges incident to a hovered node through groups would mean a group per
  highlight state and a re-tessellation to move an edge between them; through
  `setEdges` it would rebuild every buffer to change one float. The tessellator
  already returns a vertex range per route, so a highlight is a slice write into
  one attribute.

  **WIDTH AND ALPHA, NOT EITHER ALONE.** Alpha alone leaves a dimmed edge as wide
  as a highlighted one, so a hairball stays a hairball at lower contrast; width
  alone leaves it as bright, and a thin bright line still catches an eye.
  Together they are the idiom `ribbonWidthAt` already uses for the far view: an
  edge that matters less carries less ink, in both of the ways a ribbon can.

  **THE CHANNEL BUDGET, which M4.3 asked to be told about.** The one free vertex
  buffer slot recorded there is the INSTANCED NODE pipeline's (seven of eight,
  reserved for M4.6's spring velocity or M4.8's picking id) and this does not
  touch it: a ribbon is a different mesh with a different material and its own
  eight, going from five to six. Nothing in M4 is closer to the limit than it
  was.

  Only changed values are uploaded, as one merged update range immediately
  before the next draw, because `addUpdateRange` pushes a record per call and
  neither backend merges them. A `setEdges` resets every edge to 1: the ids and
  their vertex counts both moved, so a carried-over highlight would land on
  whatever edge now occupies those vertices.

- Edge ribbons: `setEdges` and `setEdgeStyle` on `Renderer`, with the groups
  declared through `RendererOptions.edgeGroups`. New surface: `advanceDashFlow`
  and `ribbonWidthAt`, and the types `SceneEdge`, `SceneEdgeGroup`,
  `EdgeFrameStyle`, `RibbonStyle`, `RibbonDashStyle`, `RibbonWidth` and
  `RibbonWidthInput`. (M4.5)

  **A RIBBON'S WIDTH IS IN SCREEN SPACE**, a fixed number of DEVICE pixels from
  its centreline at every zoom, and that is the decision to know before drawing
  anything: a caller who expected a world width gets a line that does not
  thicken as they zoom in. The reasoning is in `ribbon.ts` and the ROADMAP's
  M4.5 entry, and the short version is that a graph spanning decades of zoom
  has no world width that is legible at both ends, while `@dagr/layout` gives
  an edge a polyline and no width at all. Three things fall out: one
  tessellation is valid at every camera, the antialiasing width is exactly one
  pixel by construction so the ribbon shader holds no derivative, and dashes
  flow at one apparent speed at every zoom.

  **Groups are the layering, and there is no other.** Blend order within a mesh
  is slot order (see M4.3), so a scene that wants ribbons under nodes, or a
  highlighted path over dimmed ones, declares groups and relies on the order it
  declared them in. One group is one mesh and one material.

  **Geometry and style are separate calls.** `setEdges` rebuilds buffers,
  `setEdgeStyle` writes uniforms and touches none. The screen-space width makes
  the second a per-frame concern, and `ribbonWidthAt` is the arithmetic a frame
  wants: a clamp between a floor and a ceiling, plus the alpha that conserves
  ink below the floor, since a ribbon drawn wider than the scene says should be
  fainter in the same proportion.

  What a frame passes is only what a caller decides: a width, an alpha and a
  dash phase. The pixels per world unit is NOT among them, because the camera
  implies it and `render()` writes it, so nothing re-derives what the renderer
  already holds. Both of the frame style's numbers throw rather than degrade:
  `halfWidthPixels` carries the same 0.5 floor a declared style does, since
  below it a ribbon does not get thinner but fainter and then invisible, and
  `alpha` is rejected outside `[0, 1]`, since a shader clamps it and reports
  nothing. An alpha of exactly 0 is legal and skips the group's draw.

  **A solid ribbon is the ABSENCE of a dash, not a duty cycle of 1.** A
  zero-width gap is still a boundary to a distance field, so a duty of 1 draws a
  half-alpha seam once per period along a line that is supposed to be solid.
  Omitting the dash removes the arithmetic from the compiled shader instead, so
  a solid group carries no `fract`. `RibbonStyle.dash.duty` is rejected at 0 and at 1
  for the two halves of that reason.

- `Renderer.setNodes`: the seam a caller feeds a graph through. New surface:
  `setNodes` on `Renderer`, `sceneStyle` and `nodes` on `RendererOptions`, and
  the types `SceneNode`, `NodeShape` and `SceneStyle`. (M4.4)

  **`setNodes` is ALL OR NOTHING.** Every node is converted and validated before
  anything is touched, so a bad node in the middle of a list leaves the scene
  exactly as it was. The first version validated as it wrote and left a scene
  holding neither the node that had left nor the one that failed to arrive,
  which a caller catching the `RangeError`, the delta path this exists for,
  would have drawn as a silently short picture.

  `sceneStyle` is named for the scene because that is its scope: three uniforms
  every node shares, with the per-node half on each `SceneNode`. `nodes` sizes
  the instance buffers PER SHAPE FAMILY, so a mixed scene reserves what it
  needs rather than twice it, and an empty list is a scene with no nodes rather
  than a `RangeError`.

  **A node keeps its instance handle across calls**, which is the property M4.6's
  springs and M4.8's picking ids depend on rather than a convenience: the diff is
  by `id`, so a node present in two consecutive calls is updated in place. The
  one exception is a node that changes SHAPE, because the two shape families are
  two meshes and an instance cannot move between them.

  **It takes NODES and not a `LayoutResult`.** Naming one would make
  `@dagr/layout` a dependency of this package, and the y-down to y-up conversion
  belongs to whoever owns the layout, which `camera.ts` has said since M4.1.
  `WorldBounds` being extents rather than a corner and a size is what makes that
  seam a compile error rather than a convention.

  **REMOVED: the crispness ladder.** `createRenderer` draws an empty scene now
  and everything on screen arrives through `setNodes`, so `shape-scene.ts` and
  its suite are gone. With them went `ShapeStyle`, `requireShapeStyle` and
  `shapeQuadSize`, which had no callers left, and `quadPadding` moved onto the
  `Arith` interface: the padded quad is computed per instance in the vertex stage
  now, so the alternative was a second copy of that sum in TSL. None of the four
  was ever exported; the ladder's frames stay in `assets/screenshots/` and in the
  M4.2 commit.

- Instanced rendering: one mesh per shape family, with position, size, corner
  radius, glow reach and two colours read per instance. (M4.3)

  **The drawing path changed and the picture did not.** The crispness ladder is
  the same six shapes in the same places and the same colours, drawn in two
  calls rather than six. The committed references are therefore the regression
  test for the whole per-instance path: a factor of two anywhere in the quad
  scaling puts every shape at half or twice its size.

  The type delta, stated once because this file's preamble makes "behaviour
  changed, types did not" a claim readers rely on: TWO exported classes are new,
  `UnknownInstanceHandleError` and `SceneDisposedError`, and
  `DagrRenderErrorCode` gains `UNKNOWN_INSTANCE_HANDLE` and `SCENE_DISPOSED`.
  Widening that union is source-breaking for a consumer switching over it
  exhaustively with a `never` fallback, so it is a minor rather than a patch
  on the day a version is cut. Nothing else on the surface moved: the
  instancing API itself is internal until M4.4 names the seam a caller feeds a
  graph through.

  **The material decision M4.2 deferred is made, provisionally: ONE MATERIAL PER
  SHAPE FAMILY**, not one uber-material with a per-instance shape id. The
  uber-material's cost is per fragment and the per-family cost is per draw call,
  the family count is small and known, and the union of uniforms an uber-material
  pays for grows at the same rate as the calls it saves. The revisit gate is
  M4.10, and reversing it rewires one assembly function and touches no formula.

  **Removal is swap-with-last, so per-instance state is keyed by HANDLE and never
  by SLOT.** A slot index is not durable across any removal and the failure is
  silent, because the slot stays a valid index and merely belongs to a different
  instance. Handles are never reused, so a handle held past its instance's
  removal raises rather than addressing whatever took its place. M4.6's springs
  and M4.8's picking IDs inherit this.

  A colour reaching a shader as a UNIFORM is converted from sRGB by three's
  `Color`; as a vertex ATTRIBUTE it is converted by nothing, so the conversion
  now happens on the way into the buffer, spelled the way three spells it.
  Skipping it does not throw: every colour comes out lighter and flatter.

- `createRichNodes`: a node's visual as arbitrary HTML sized to its layout box,
  with semantic zoom. New surface: `createRichNodes`, `measureHtmlSizes`, and
  the types `RichNode`, `RichNodeTier`, `RichNodes`, `MeasureItem` and
  `MeasureOptions`. (M4.12)

  **Tiers are gates, and there is no tier machinery.** A node registers ONE
  OVERLAY ENTRY PER TIER, all with the same bounds and adjacent half-open gates,
  so at most one is ever visible and the bottom tier is the ABSENCE of an entry,
  which is the GPU drawing the shape. The three-tier semantic zoom the campaign
  demo asked for is three lines of configuration over M4.11 rather than a
  level-of-detail system.

  **`create` and `update` are separate so elements can be pooled**, which relies
  on the overlay detaching everything that left the view before it creates
  anything that entered it. The cost is that `update` has to replace what it
  wrote last time, since the element it is handed may have belonged to a
  different node a frame ago. `setNodes` diffs by id, and a node whose `data` is
  a NEW REFERENCE is re-rendered when it has an element on screen: reference
  equality rather than a deep comparison, because a deep comparison of arbitrary
  card data is neither cheap nor decidable.

  **`measureHtmlSizes` mounts everything, then reads everything**, in one layout
  flush. Interleaving a mount and a read per node forces a flush per node, which
  is the quadratic that turns a startup into seconds. Its `parent` is required
  rather than defaulted, because inherited font and custom properties decide the
  answer and a card measured under the page's styles and drawn under the
  overlay's is measured wrong silently. It reads `offsetWidth` and
  `offsetHeight` rather than a bounding rect, because a rect is measured after
  every transform in the ancestor chain and this package teaches content to
  counter-scale; the cost is that the sizes are integers.

  **Overlapping tier gates are rejected**, with a `RangeError` naming both
  tiers. "At most one tier of a node is visible" is what the cap counting nodes
  rather than entries depends on, and until it was checked it was a caller
  obligation dressed as a property.

  `setNode` is the single-node path beside `setNodes`. Changing one node through
  the bulk setter means allocating a record per node and walking every tier to
  move one, which at 2,800 nodes is the wrong shape for a hover or a selection.

- `createHtmlOverlay`: a layer of DOM elements positioned in world coordinates
  over the canvas and kept registered with a `Camera2D`, with culling against
  the visible world, a half-open screen-width gate per entry, and a hard element
  cap. This is the package's answer to having no text renderer, and the first
  thing it exports that no GPU draws. New surface: `createHtmlOverlay`,
  `CENTRE_ANCHOR`, `OVERLAY_ZOOM_PROPERTY`, `OVERLAY_INV_ZOOM_PROPERTY`, and the
  types `HtmlOverlay`, `HtmlOverlayOptions`, `OverlayEntry`, `OverlayEntryInit`,
  `OverlayPlacement` and `ElementAnchor`. (M4.11)

  **The unit inside the layer is the thing to know before writing content.** The
  layer carries the camera's scale, so one CSS pixel inside it is one world unit
  and a card is authored as it should look at zoom 1. A 1px border is one world
  unit and thickens as you zoom in. Content that should stay a constant size
  counter-scales with `--dagr-overlay-inv-zoom`, which the layer publishes
  (unitless, alongside `--dagr-overlay-zoom`) whenever the zoom changes.

  **`sync()` belongs on the caller's draw path.** The overlay has no animation
  loop of its own, deliberately: a second `requestAnimationFrame` is a second
  frame budget and a frame of skew, which reads as the labels swimming over the
  graph during a pan. It reads no layout, which is what keeps it off the forced
  reflow path, and that is a property worth preserving in anything added to it.

  **The element cap is 200 by default and is not a tuning knob.** A degenerate
  zoom qualifies every label in a graph at once; a hundred thousand DOM elements
  is a locked-up tab where a hundred thousand instanced quads is a frame. What
  survives is what is nearest the camera centre, with ties broken by
  registration order, so the picture does not depend on iteration order. The
  visible cost is that entries pop at the boundary rank as the camera moves.

- `OverlayParentError` and `OverlayDisposedError`, and with them the abstract
  base `DagrRenderError` carrying a `code` (`DagrRenderErrorCode`), which this
  package's `errors.ts` said it would grow on its second error class. (M4.11)

- Signed distance fields for rounded rectangles and circles, authored in TSL,
  with fill, an inset outline and a glow all read from the SAME distance and
  antialiased from that distance's own screen-space derivative. `createRenderer`
  now draws six of them, a rounded rect and a circle on each of three rungs a
  decade apart, in place of M4.1's single quad. The RECTS are 10, 100 and 1000
  world units across and each circle's diameter matches its rung's height, so the
  circles are 4, 40 and 400: quoting "10, 100 and 1000" for the shapes is false of
  half of them. **Nothing new is exported.** A TSL node is a three.js type
  and this package's surface has none; the scene is a hard-coded demonstration
  that M4.4 replaces with a real layout. So M4.2 changed what is DRAWN and not
  what is CALLABLE. (M4.2)

  **Two units, and the asymmetry is the decision.** An outline is measured in CSS
  PIXELS and is inset; a glow is measured in WORLD units and sits outside. An
  outline is a property of the screen, and a two pixel border staying two pixels
  at every zoom is the thing a geometry pipeline cannot do without rebuilding
  geometry: the same derivative that gives the antialiasing width converts pixels
  into world units at the fragment being shaded. A glow is a property of the
  shape, and its quad has to be padded to contain it at build time, so a
  pixel-space glow would need the quad resized whenever the camera moved, which
  is M4.4's problem and not a shader's.

  **Where the outline band lands, which is this file's category exactly: a rule a
  caller can see that no type describes.** The band's outer ramp is centred on the
  boundary, like the fill's, so its two 50% points are the boundary itself and
  `widthPixels` pixels in, and a band of w pixels paints w fully covered pixel
  centres, a hairline included. Outline coverage can never exceed fill coverage at
  any distance, so adding a border does not grow a shape's footprint by a pixel.
  "Inset" here means drawn over the fill and never against the background; it does
  NOT mean the band lies wholly inside the boundary, which is a different and
  wrong rule that this run shipped first and then fixed.

  **The antialiasing width is the `max` of the two per-axis `length`s of the
  interpolated POSITION's gradient, and deliberately not `fwidth`.** Of the
  position and not of the distance: every field in `sdf.ts` folds through `abs`
  or a square, so a distance gradient collapses to zero on the fragment quad
  holding a shape's centre, taking the inset outline with it. `fwidth` is the L1
  sum of two derivatives, and L1
  exceeds L2 by up to 41% exactly when the derivatives are equal, which is an
  edge at 45 degrees. A rounded corner is nothing but diagonals, so `fwidth`
  gives a ramp that is right along the flat sides and up to 41% too soft around
  the corner: corners blurrier than the edges they join, which is the artefact a
  distance field exists to remove. It costs one `sqrt` per fragment and the
  shader already has one. This one is worth reading as a warning rather than a
  preference: swapping the gradient length for either `fwidth` or its L1
  expansion left the whole suite GREEN, because both are correct to within a
  factor on every value a numeric test can check. The suite now asserts the node
  graph's structure (`length` over a join of `dFdx` and `dFdy`) for that reason.

- `depthWrite` is off on the shape materials. three leaves it on when
  `transparent` is set, and left on, a fragment with alpha 0 still writes depth
  and a transparent quad occludes whatever is drawn behind it afterwards. It
  makes no visible difference today, since the ladder's padded quads are provably
  disjoint, and it is exactly wrong for M4.5, which layers edges behind nodes and
  selection in front on the same plane. Turning it off now leaves M4.5 a draw
  order decision rather than a flag in a file it is not editing. (M4.2)

- `Camera2D`, the orthographic 2D camera every Dagr view is drawn through. It
  holds a world centre, a zoom, and the canvas viewport, and it converts between
  world space and screen space in both directions (`screenToWorld`,
  `worldToScreen`), reports what the canvas currently shows
  (`visibleWorldBounds`), hands an orthographic projection its extents
  (`orthoFrustum`), sizes the drawing buffer (`drawingBufferSize`), and
  implements the two gestures a graph canvas needs (`panByScreen`,
  `zoomAtScreen`). (M4.1)

  Three conventions are fixed here and are the ones every later M4 task
  inherits. **World y is up, screen y is down**, with the screen origin at the
  canvas top-left, which is where a `PointerEvent`'s `offsetX` and `offsetY`
  already are. Note that `@dagr/layout` computes in y-down coordinates; the flip
  between the two is M4.4's business, not the camera's. **Zoom is CSS pixels per
  world unit**, so zoom 2 draws a one-unit box two CSS pixels wide. **The device
  pixel ratio is read in exactly one method, `drawingBufferSize`**, and the
  suite asserts bit-exact equality of every other result across ratios 1, 2 and
  3.5. That one is worth the assertion rather than a comment: every input event
  and every CSS length a caller has is in CSS pixels, so a camera that mixed the
  two units would be wrong only on the machines the developer is not using.

  `zoomAtScreen` clamps the new zoom into `[minZoom, maxZoom]` **before**
  deriving the corrected centre from it. The other order passes every test that
  does not sit on a boundary and then drifts the anchor a little further with
  every further notch of a wheel already at its limit, which is exactly when a
  user keeps scrolling. Both boundaries are tested with a factor that overshoots
  by six orders of magnitude.

  A resize preserves the centre and the zoom, so the visible world **grows**
  when the canvas grows. The alternative (preserve the visible rectangle,
  rescale to fit) is what an image viewer does, and it would mean a user who
  zoomed in to read a label and then widened the window got the same graph at a
  new size rather than more graph at the same size.

- `createRenderer(options)`, which builds a three.js `WebGPURenderer` on a
  canvas and draws a scene through a `Camera2D`. Asynchronous because
  `WebGPURenderer.init()` requests a GPU adapter and there is no synchronous
  moment at which such a renderer is usable; awaiting it once here means the
  object handed back is ready to draw. (M4.1)

  **The canvas wins when it has an opinion.** A canvas that has been laid out
  has its CSS box copied onto the camera's viewport, whether the caller brought
  a camera or let the factory build one. One rule replaces two paths: the canvas
  used to be measured only on the branch that built the camera, so a caller
  following this package's own advice (bring a camera, so input can be wired
  before the async factory resolves) kept the HTML default 300 by 150 viewport
  and got that buffer stretched across an 800 by 600 canvas. A canvas that is
  not in a document measures zero, and zero is not an opinion, so a viewport set
  deliberately on the camera survives that case.

  `clearColor` is rejected with a `RangeError` unless it is an integer in
  `[0, 0xffffff]`. three validates none of it: measured against 0.185.1, `NaN`
  and `Infinity` both give #000000, `-1` and `0x1ffffff` both saturate to
  #ffffff, and `1.7` floors to #000001. A black frame is exactly the "broken
  renderer" look the amber-on-near-black default was chosen to rule out, so an
  arithmetic slip upstream produced the one frame the colour scheme exists to
  make impossible.

  `options.signal` takes an `AbortSignal`, and **a caller never has to dispose a
  renderer it did not receive**: an abort before the device is requested costs
  nothing, an abort during `init()` disposes the renderer that was built, and
  either way the promise rejects with the signal's own reason. Without it every
  consumer mounting a renderer in an effect hand-rolls the same three lines, and
  the one that forgets leaks a GPU device per abandoned mount, with no symptom
  until several have accumulated.

- The `Renderer` interface, the seam every later M4 task plugs into: a camera, a
  `resize`, a `render` and a `dispose`. It deliberately says nothing about scene
  contents. M4.1 draws a hard-coded quad, and a `setLayout` designed now would
  be a guess at M4.4 with nothing to check the guess against. What it does fix
  is the lifecycle, which is the part that will not change. (M4.1)

  **`render()` adopts the whole camera, not two thirds of it.** The frustum and
  the drawing buffer size are both pulled from the camera every frame, so
  mutating `renderer.camera` is enough for any of the three things a caller can
  change: pan, zoom, and the canvas size. `resize(viewport)` is now sugar for
  `camera.setViewport` plus that same sync, and it is a convenience rather than
  a correctness requirement. The split it replaces was a real defect: a
  `ResizeObserver` that called `camera.setViewport` and then `render`, which is
  what `Renderer.camera` and `Camera2D.setViewport` between them documented, got
  a correct frustum drawn into a buffer still sized for the old canvas. The
  browser then stretched it, so the frame was blurry and at the wrong aspect
  ratio, `worldToScreen` disagreed with what was on screen, and nothing threw.
  The buffer resize is guarded against a size that has not changed, because
  `setSize` writes `canvas.width` and reallocates.

- `RendererDisposedError`, thrown by `resize` and `render` on a disposed
  renderer, where a bare `Error` used to be. It carries the rule this package
  now follows: **an out-of-range value is a `RangeError` naming the field, and
  anything else this package throws gets a named class.** That is applicable
  without judgement, which is the property a rule like this needs. The split is
  not about how many failure kinds there are, it is about what a caller can do:
  a bad number is on a line the caller can see and the field name is the best
  possible report of it, while use after dispose arrives from a lifecycle race
  in somebody else's framework and is the more likely of the two to be caught
  deliberately. Matching a string is not a way to catch anything. (M4.1)

- `Vec2`, `Size`, `WorldBounds`, `ViewportSize`, `OrthoFrustum` and
  `RendererOptions`, exported as types. (M4.1)

  `WorldBounds` is `{minX, minY, maxX, maxY}` rather than the `{x, y, width,
  height}` rectangle first drafted here, and `Camera2D.visibleWorldRect()` is
  `visibleWorldBounds()` to match. The draft was structurally identical to
  `@dagr/layout`'s `Rect` with the opposite corner convention (that one is
  y-down and top-left, this one was y-up and bottom-left), which the compiler
  cannot see: a layout rectangle assigned into a world slot compiled clean, and
  the symptom was a scene mirrored about the horizontal axis with nothing red
  anywhere. A docstring on each saying which corner it meant was the first
  attempt and was not enough, and a phantom brand does not close it either,
  since an optional marker leaves the two mutually assignable and a required one
  has to be constructed by hand at every call site. Extents are not structurally
  assignable from either shape, so the mistake is a type error instead of a
  naming convention, "which corner is x, y" stops being a question rather than
  being answered, and a culling test gets the shape it wants.

### Changed

- Three fixes to what M4.3 and M4.4 shipped, found by a review of the merged
  tree rather than of a diff. `SceneNodes.setNodes` resolves each node's shape
  family in its validation pass, so a shape neither family draws cannot throw
  with the removals already applied. `buildSceneRenderer` frees the scene it
  built when a node is rejected, rather than only the device, because three's
  geometries and materials hold GPU buffers a collector cannot release; a
  rebase onto M4.5 then showed that the edges are a second owner in front of
  the same fallible line, so both are freed. And
  `InstancedShapesDisposedError` is `SceneDisposedError`, covering `SceneNodes`
  as well as a mesh, because it was throwing a bare `Error` where this package
  has a rule and a class. A rename inside one unreleased set of changes rather
  than a break. (M4.4)

- `OverlayDisposedError`'s message is now `cannot call X() after dispose()`,
  where it named an overlay. `createRichNodes` throws the same class from
  `setNodes` and `setNode`, and a rich-node binding is not an overlay. One class
  rather than two, because the failure, the cause and the fix are identical and
  the method name says which object it was. (M4.12)

- `RendererDisposedError` now extends `DagrRenderError` and carries
  `code: 'RENDERER_DISPOSED'`. Additive: its name, its message and
  `instanceof Error` are unchanged. It is here because a prototype chain is
  exactly the kind of thing this file exists to record. The type gained a public
  `readonly code` and the runtime object gained one link in its prototype chain;
  nothing a caller catches today behaves differently. (M4.11)

- The three value checks that lived in `camera.ts` (`requireFinite`,
  `requirePositive`, `requireFinitePoint`) are in `validate.ts` now, with the
  paragraph on why a bad number is a `RangeError` and why nothing falls back to
  a default. Internal, so no caller sees it; recorded because the overlay is the
  second module that needs them and a copy of a validator drifts. (M4.11)

- `PKG_NAME` is no longer exported. It was scaffolding from the workspace's
  first commit and nothing imported it. (M4.1)

- `packages/render/tsconfig.json` sets `lib: ["ES2022", "DOM"]`, widening the
  root base, which has no DOM. The base stays as it is so that `@dagr/graph` and
  `@dagr/layout` keep failing to compile if a DOM global ever becomes reachable
  from either. (M4.1)

- **The tarball a consumer installs (M5.4a).** `files` now ships `src`,
  `README.md` and `LICENSE` beside `dist` and `CHANGELOG.md`, and
  `publishConfig.access` is `"public"`. The package has a README for the first
  time, which is what an npm page renders.

  `src` is shipped because the build emits `declarationMap` and `sourceMap`
  against a `files` list that had no `src` in it, so every map this package
  published pointed at a file the tarball did not carry: 128 of them across the
  five published packages, verified by packing rather than by reading the
  manifests. The alternative was to stop emitting the maps, which would have
  closed the door on TypeScript project references, because `composite`
  requires `declaration` and effectively wants `declarationMap`. Shipping the
  source costs about 40% of the tarball and buys go-to-definition landing on
  the real TypeScript rather than on a `.d.ts`.

  THE PUBLISH COMMAND IS `pnpm publish`, NOT `npm publish`. `npm pack` leaves
  pnpm's `workspace:` protocol in the published manifest, where it resolves to
  nothing; `pnpm pack` rewrites it to the sibling's real version, checked on the
  same package in the same tree. The `packaging` workspace member is the gate
  that keeps this true: it packs every published package on every `pnpm test`
  and reads the tarball back.

### Notes

- **`three` is a peer dependency, and also a dev dependency.** The same shape
  `@dagr/layout` uses for `@dagr/graph`, for a related reason: an application
  that renders a Dagr graph almost certainly has its own three.js scene, and two
  copies of three in one bundle is both a large amount of duplicated code and a
  source of instanceof checks that fail across the copies. Peer means the
  application picks the version; dev means this package can still build and
  typecheck on its own. `@types/three` stays a plain dev dependency, because a
  consumer needs the types for a `three` they installed themselves, not for
  ours.

  The range is `>=0.180.0 <1.0.0`, and both ends are chosen rather than
  derived. The floor is a handful of minors below the 0.185.1 the lockfile
  pins. It is a judgement that the names this package imports from
  `three/webgpu` (`WebGPURenderer`, `MeshBasicNodeMaterial`, `PlaneGeometry`,
  `OrthographicCamera`, `Scene`, `Mesh` and `Color`, seven of them) are stable
  across those minors, and it is not a compatibility claim. 0.180.0 was
  unpacked and read and exports all seven; 0.181 through 0.184 have not been
  built against here. Admitting them buys a consumer on 0.182 a silent install
  where a caret would have warned them, which is the trade, made deliberately.

  The ceiling is a real 1.0 rather than a caret, and that is the part worth
  arguing. three's pre-1.0 versioning treats the MINOR as its breaking-change
  slot, so `^0.185.1` resolves only 0.185.x and would put a peer warning in
  front of every consumer tracking three's monthly releases, which is precisely
  the churn a peer dependency exists to avoid. The bet is that this package's
  small import list survives three's minors; a milestone that finds otherwise
  raises the floor rather than lowering the ceiling, because the ceiling is
  where a consumer's own three lives.

- **The testing split is deliberate: what needs a GPU is untested, and what
  does not, is tested.** Drawing needs an adapter, Node has none, and a headless
  browser runner is CI infrastructure M4.1 does not have. So the arithmetic was
  pushed into `camera.ts`, where a seeded property suite covers it, and the
  renderer was kept close to declarative wiring.

  Calling the whole renderer "wiring" was an overstatement, and it is corrected
  here rather than carried: the lifecycle is decisions, not wiring. When the
  drawing buffer is reallocated, whether `dispose` is idempotent, and whether a
  disposed renderer refuses to draw are choices about when to call four methods
  on three collaborators, and every one is checkable by counting those calls.
  `WebGPUSceneRenderer` is therefore exported from its own module (not from
  `index.ts`, since `createRenderer` remains the only supported way to get one)
  and declares its collaborators as structural interfaces, so the suite builds
  it over counting stubs with no device anywhere. The interfaces are not a
  weakening: `createRenderer` passes the real `WebGPURenderer`,
  `OrthographicCamera`, `PlaneGeometry` and `MeshBasicNodeMaterial` into those
  same parameters, so the package's own typecheck is what proves the real
  objects satisfy what the stubs satisfy.

  What that leaves unverified is listed in the file's own docstring rather than
  left to be discovered: that any shape appears at all, in the right place and
  colour; that the buffer sizes computed here reach a real canvas; that
  `dispose` frees GPU memory rather than merely being called once; and that
  `init()` succeeds or that three's automatic WebGL2 fallback engages, and so
  that anything in `createRenderer` past `init()` runs at all. That last one has
  a named casualty, measured rather than assumed by deleting the line and
  watching the suite stay green: the abort check AFTER `init()`, the branch that
  hands a device back when a caller aborts mid-request, cannot be reached
  without a device to hand back. The abort check before `init()` is tested. A
  browser screenshot test closes all of these, and M4.9 owns it along with the
  fallback story.

  One seam is checked in the meantime, because it is the one a screenshot could
  not check cheaply anyway: the suite builds a real three `OrthographicCamera`
  from `orthoFrustum()`, wired exactly as the renderer wires one, projects a
  world point through `Vector3.project`, and asserts the result matches the NDC
  implied by `worldToScreen`. Worst measured disagreement is 6.7e-16 against an
  asserted bound of 1e-9. That agreement is what makes a click handler built on
  `screenToWorld` land on the shape a frame built on the frustum drew.

  Running three's own camera rather than reimplementing its algebra is the point
  of the test, and the first draft did reimplement it. `OrthographicCamera` takes
  `(left, right, top, bottom, near, far)`, which is not the field order of
  `OrthoFrustum`; the renderer avoids that by assigning the fields by name, and a
  hand-rolled projection cannot catch a mistake there. Writing that mutant
  confirmed the new test does. The same camera also answers whether the z = 0 plane
  every shape is drawn on sits inside the near and far planes, for one line: the
  projected z is -0.80, so that came off the untested list rather than staying on
  it.

- Numerical claims in this package state a measured bound rather than calling
  anything exact. The screen round trip is within 7.4e-10 CSS pixels over the
  suite's range (zoom 1e-3 to 1e3, centres out to 1e4 world units), and
  `zoomAtScreen` holds its anchor to within 4.4e-8 CSS pixels. Asserted bounds
  sit one to two orders of magnitude above the worst case measured, so each one
  is a bound the suite actually approaches rather than a comfortable round
  number nothing has come near.

- Validation throws a plain `RangeError` naming the field. That is half of the
  package rule recorded under `RendererDisposedError` above, and it applies to
  every number a caller can hand in, `clearColor` included. Nothing falls back
  to a default: a `NaN` zoom has no neutral substitute, and picking one would
  turn a caller's arithmetic bug into a view silently in the wrong place, an
  animation loop away from the line that caused it.

  The one thing this package does treat as a measurement rather than an input is
  a canvas's CSS box, and it no longer falls back when that measurement fails.
  A canvas outside a document reports zero, and the answer to zero is to leave
  the camera's viewport alone rather than to substitute the HTML default for it,
  because a viewport the caller set deliberately is better information than a
  number nobody chose.

- **The shader is written once and tested as arithmetic.** A TSL node graph builds
  under bare Node and does not evaluate: `getNodeType` needs a builder and code
  generation needs a real renderer backend. The usual response is two copies of
  every formula, one in TSL and one in TypeScript for the tests, and this package
  does not do that. Each formula is written once over `Arith<T>`, an interface of
  nine primitives (a literal, four operators, `abs`, `min`, `max`, `sqrt`);
  `numberArith` implements them with `Math` and the suite runs every formula
  through it, `tslArith` implements them in TSL and the shader runs the same
  formulas through that. The suite therefore executes the expression tree the
  fragment shader evaluates, node for node, and the untested arithmetic surface is
  nine one-line adapters plus three pieces of TSL named below, rather than six
  formulas. A test pins that the two backends have the same nine members, so a
  primitive added to one and not the other fails a test instead of a shader
  compilation on somebody else's machine.

  `smoothstep` and `clamp` are WGSL intrinsics and are absent from the nine on
  purpose, built from the primitives instead. That costs a few ALU operations per
  fragment and keeps the ramp the tests exercise identical to the ramp the shader
  evaluates.

  `length` is NOT one of those, and three pieces of TSL are executed by no Node
  test: `length` as an intrinsic in exactly one place, `antialiasWidth`; the colour
  `mix` in `shapeShading`, which is vec3 and cannot go through a float interface at
  all; and the `mul(size, 0.5)` halving a rounded rect's extents inside a deferred
  `Fn` body the suite never runs, because it builds that body directly from
  pre-halved literals. Their compensating control is the structural assertions on
  the node graph in `test/sdf-nodes.test.ts`. An earlier draft of this entry said
  the untested surface was "exactly nine" and copied that into five other files;
  api-design-review caught it, and it is worth recording because a counted claim
  that survives copying unchecked is the failure this documentation style exists to
  prevent. The count in this sentence was itself wrong at first, which is the joke
  writing itself: it said four, before `sdf.ts`'s own `Arith` docstring turned up as
  a sixth location.

  There is a second payoff to writing each formula once: a shader computes a
  hypotenuse as `sqrt(x*x + y*y)` and WGSL has no `hypot`, so a separately written
  scalar copy would reach for `Math.hypot`, which rescales to avoid overflow and
  is accurate to under an ulp where the naive form is not. Two spellings would
  then disagree in the last bits and an exact assertion would have to be loosened
  until it stopped catching real defects.

  **"Crisp at every zoom" is a test, not only a screenshot.** The antialiasing
  width is one device pixel in world units, which is `1 / (zoom * dpr)`, so feeding a
  distance of k pixels through the coverage functions at any zoom must give the
  same answer: the zoom cancels and the shape's size on screen never enters the
  arithmetic, which is the property a texture atlas baked at one scale does not
  have. Asserted from zoom 0.1 to 1000. Bit-identical needs dyadic k AND a dyadic
  `aaWidth`, which means a power-of-two zoom: dyadic k alone is not sufficient,
  because the ramp's numerator is `aaWidth * (k - 0.5)` and `k - 0.5` is not a
  power of two for most dyadic k. algorithms-review found that by producing
  counterexamples at zoom 2.5, 5, 20 and 40, which are ordinary zooms, so the
  headline test would have gone red on an unrelated change to its own zoom list.
  Everywhere else the worst deviation across the lists the suite runs is 1.6653e-16,
  at k = 0.123456 and zoom 2.5, against an asserted bound of 5e-16, since
  `toBeCloseTo(expected, 15)` passes below half a unit in the last stated digit
  rather than a whole one. Both numbers an earlier draft quoted here were wrong in
  the flattering direction: it said 1.2e-16 against 1e-15, implying 8x of headroom
  where there is 3.0x. A two million pair random sweep reaches 3.331e-16, inside the
  bound by 1.5x, which is what makes 15 digits an assertion about this function
  rather than a formality.

- **A shape fades down to about a pixel and then stops being rasterised**, and the
  second half of that is measured rather than assumed. At zoom 0.2 the 10-unit
  rung draws as a 2 by 2 block of #7e4d1b, a dim amber against the #ffb703 it is
  at full coverage: that is the fade analytic antialiasing is for. At zoom 0.1 the
  same rung does not appear at all, because its padded quad is 1.4 by 0.8 CSS
  pixels and whether a footprint that small covers a sample point depends on where
  it lands on the grid; the 10-unit circle beside it survives as one dim pixel in
  the same frame. No distance field can fix that, because the fragment that would
  have faded is never shaded.

- `antialias: true` stays on, and M4.10 settles it rather than M4.2. The M4.1 note
  asked M4.2 to revisit the flag and this is the revisit, so what M4.2 settled is
  that it is not turning MSAA off and why it cannot decide the question with the
  harness it has. The argument for turning it off is unchanged and still sound in
  itself: SDF shapes antialias their own edges analytically, per pixel, and gain
  nothing from MSAA, while MSAA costs a 4x-sampled target plus a resolve every
  frame, which is a real bandwidth line against M4.10's 10k-nodes-at-60fps budget.
  What stops this run from acting on it is that the one place MSAA could still
  matter is the sub-pixel case above, where coverage is decided by the sample grid
  rather than by the shader, and separating "MSAA is keeping this speck visible"
  from "the quad happened to miss the sample points" needs a controlled comparison
  this task has no harness for. So the visual half is unresolved and the cost half
  is M4.10's, which is where the flag should be settled with numbers on both sides.

## 0.1.0

Not yet released.
