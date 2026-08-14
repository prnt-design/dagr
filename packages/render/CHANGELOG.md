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

- `createHtmlOverlay`: a layer of DOM elements positioned in world coordinates
  over the canvas and kept registered with a `Camera2D`, with culling against
  the visible world, a half-open screen-width gate per entry, and a hard element
  cap. This is the package's answer to having no text renderer, and the first
  thing it exports that no GPU draws. New surface: `createHtmlOverlay`,
  `CENTRE_ANCHOR`, the types `HtmlOverlay`, `HtmlOverlayOptions`,
  `OverlayEntry`, `OverlayEntryInit`, `OverlayPlacement` and `ElementAnchor`.
  (M4.11)

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
