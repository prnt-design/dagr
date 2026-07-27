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
  canvas and draws one quad through a `Camera2D`. Asynchronous because
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
  left to be discovered: that the quad appears at all, in the right place and
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
  of the test, and the first draft did reimplement it. `OrthographicCamera`
  takes `(left, right, top, bottom, near, far)`, which is not the field order of
  `OrthoFrustum`; the renderer avoids that by assigning the fields by name, and
  a hand-rolled projection cannot catch a mistake there. Writing that mutant
  confirmed the new test does. The same camera also answers whether the quad's
  plane sits inside the near and far planes, for one line: the projected z is
  -0.80, so that came off the untested list rather than staying on it.

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

- `antialias: true` is right for M4.1 and is flagged in the source to be
  revisited in M4.2 rather than carried forward because it is already there.
  A graph at M4.1 is box corners and diagonals, every one of which reads as a
  staircase without MSAA. M4.2's SDF shapes antialias their own edges
  analytically, per pixel, and gain nothing from it, while MSAA keeps costing a
  4x-sampled target plus a resolve every frame: on a 4K canvas at ratio 2 that
  is a real bandwidth line against M4.10's 10k-nodes-at-60fps budget. Measure
  both ways when the SDF path lands.

## 0.1.0

Not yet released.
