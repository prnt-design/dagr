# HTML overlay and rich nodes

Date: 2026-08-14
Status: proposed, implementation in progress on
`agt_8829415e7e5c/html-overlay-rich-nodes`
Asked for by: Nii, 2026-08-14, on reading the campaign demo plan
(`plans/2026-08-14-campaign-demo.md`). The direction is
`plans/2026-08-14-html-overlay.md`; this spec is the design that plan asked
for, and it overturns two of its sketch's details with reasons.

## Problem

`@dagr/render` draws signed distance fields and has no text. No text task
appears anywhere in M4 or M5, and a glyph pipeline (atlas, shaping, wrapping,
kerning) is weeks of work rather than one increment. Meanwhile every consumer
of a graph renderer wants labels, tooltips or cards, and the campaign demo
needs three of them at once: a shape when a node is small on screen, a title
when it is mid-sized, a full card when it fills a chunk of the viewport.

The DOM already renders text, and the browser is already good at it. What it
cannot do by itself is stay registered with a camera that pans and zooms sixty
times a second. That registration is the whole feature: a layer whose transform
comes from `Camera2D`, entries placed in world coordinates, culled against the
visible bounds, and gated by how big they are on screen.

Written once in the library, it is one transform composition, one overlap test
and one cap. Written per consumer, it is the same four bugs each time: the
transform origin defaults to the element's centre so everything drifts by half
its own size, the device pixel ratio gets mixed into CSS pixel arithmetic so
labels land wrong on exactly the machines the developer does not own,
`pointer-events` on the layer eats the pan gesture, and nothing bounds the
element count so a zoom-out qualifies eight thousand labels and the tab stops
responding.

## Decisions

### 1. The overlay is a module of `@dagr/render`, exported from it

Not a new package, and not `apps/demo`. M4.6 named this option for the spring
integrator and named it to keep a choice OPEN rather than to settle one: keep
it an internal module with no dependency on the rest of the package, export it,
and split it out when a second consumer exists. That task is still unchecked
and its call is still open. This task takes the option first, on the same
argument M4.6 wrote down and on this project having twice declined to build a
surface before somebody asked for it.

The cost of that choice is real and worth naming: `@dagr/render` has `three` as
a peer dependency, and `index.ts` re-exports `createRenderer`, whose module
imports `three/webgpu` at module scope. A consumer who wants only the overlay,
drawing their nodes with canvas 2D or SVG, still has to install `three` to
satisfy the peer. The package declares `sideEffects: false`, so a bundler that
honours it can drop the renderer module from a build that never calls
`createRenderer`; that is a statement about what bundlers do, not a measurement
taken here.

The escape hatch, and the trigger for taking it: a subpath export
(`@dagr/render/overlay`) whose module graph contains no three.js, added the
first time a consumer asks for the overlay without a WebGPU renderer. It costs
one `exports` entry and one line in M5.4's packaging checklist.

**The subpath alone does not remove the cost above, and pairing the two is the
whole of the hatch.** `three` is a hard peer in `packages/render/package.json`
with no `peerDependenciesMeta`, so a subpath keeps three out of the module
graph and the INSTALL still demands it: npm errors and pnpm warns, for a
package the consumer's code never reaches. Taking the hatch means adding
`peerDependenciesMeta.three.optional` at the same time, which then makes it the
package's job to fail usefully when `createRenderer` is called without three
installed rather than with a bare module-resolution error. That is a real cost
and it is the reason the hatch waits for somebody to ask.

### 2. `@dagr/react` gets no component yet. The maintainer's call to reverse

The direction plan left this open: bootstrap `@dagr/react` now with an `<Html>`
component, or keep the feature framework-free until M5.1. The recommendation is
to keep it framework-free, and the argument is about what `<Html>` needs rather
than about how much work it is.

The package is not literally empty: `packages/react/src/index.ts` exports a
`PKG_NAME` constant, which is the workspace's first-commit scaffolding and the
same thing `@dagr/render`'s `index.ts` records deleting when it gained a real
export. It goes the same way here, in the increment that gives the package its
first component, which is M5.1 unless this decision is reversed.

`<Html>` has to find the overlay it portals into. Either it takes the overlay
as a prop, which no React user would accept for a component used once per node,
or it reads a context that `<DagrCanvas>` provides. `<DagrCanvas>` is M5.1 and
does not exist. Shipping `<Html>` first means inventing that context now, in a
package with no component to provide it, and then living with the shape when
M5.1 arrives with the requirements that should have decided it. It is also the
first public surface of a package that will be published, which is a decision
with a longer tail than this session's.

Nothing is blocked by deferring. The demo consumes the framework-free API from
one effect, which is where its renderer lifecycle already lives, and M5.1 gets
a tested overlay to wrap rather than a wrapper to justify.

If the maintainer would rather have `<Html>` now, the work is small (a portal
into an entry's element plus the context) and this decision is the only thing
in the way.

### 3. Two elements, one transformed

The overlay creates two nested divs inside the parent the caller names, and
owns both:

| Element | Styles | Why |
| --- | --- | --- |
| clip | `position: absolute; inset: 0; overflow: hidden; pointer-events: none` | Holds the layer to the canvas box. A card whose box is half off screen has to be cut off at the canvas edge, and the layer cannot do its own clipping because clipping applies in the layer's own scaled space, so its clip rectangle would grow with the zoom |
| layer | `position: absolute; transform-origin: 0 0` | Carries the camera transform. One write per frame moves every entry |
| each entry's element | `position: absolute; left: 0; top: 0; transform-origin: 0 0` | The overlay sets these on every element it is handed, and they are not the caller's to keep. "`left` and `top` stay at zero" in decision 4 means nothing under static positioning: a static element sits in normal flow, so entries would stack vertically and each translate would offset from wherever the flow put it rather than from the layer origin |

The parent has to establish a containing block, because `position: absolute`
resolves against the nearest positioned ancestor and a `static` parent sends
the whole overlay to wherever the page's last positioned ancestor happens to
be, at full size, over the rest of the document. The overlay reads the parent's
computed `position` once at creation and throws `OverlayParentError` naming the
fix rather than setting `position: relative` on an element it does not own.

### 4. One transform per frame, and entry transforms that survive a pan

The layer's transform is `translate(Xpx, Ypx) scale(z)`, with
`transform-origin: 0 0` so that the scale multiplies coordinates rather than
distances from the element's own centre. `X, Y` is the screen position of the
layer's origin (see decision 5), and `z` is the camera zoom, which
`Camera2D` defines as CSS pixels per world unit.

Entries are positioned inside the layer with their own `transform:
translate(u px, v px)`, where `u, v` is the entry's world position expressed
relative to the layer origin, y negated because world y is up and screen y is
down. `left` and `top` are `0` and stay there: `transform` is a compositor
property and `left` is a layout property, so a per-frame `left` write on 200
elements is 200 layout invalidations and a per-frame `transform` write is not.

The consequence that makes this cheap: an entry's transform depends on the
entry and the layer origin, and NOT on the camera. Panning and zooming change
one string on one element. Entry transforms are written when an entry becomes
visible, when its placement changes, and when the origin is rebased, which is
at most once per viewport-worth of pan.

What a caller has to know, because it is the one surprising thing about a
scaled layer: **inside the layer, one CSS pixel is one world unit.** At zoom 1
they coincide, which is the same identity `Camera2D` already states, so the
rule to teach is "author your card as it should look at zoom 1". A 14px font is
14 world units of text. A 1px border is one world unit and gets thicker as you
zoom in, which is usually wrong for a hairline and is why a point entry (which
counter-scales, see decision 6) is what a badge or a tooltip uses.

Two properties follow from scaling the layer rather than re-laying out each
entry, and both are wanted. Text does not reflow while zooming, because layout
happens in the layer's local units and the scale is applied after it, so a card
does not rewrap mid-gesture. And text stays sharp, because the browser
rasterises the glyphs after the transform. The exception is `will-change:
transform` on the layer, which promotes it to a compositor layer that is
rasterised once and then scaled as a bitmap, so the text goes soft under a
zoom. The overlay therefore does not set `will-change`, and a consumer who adds
it to "make it faster" will see exactly that.

### 5. The layer origin is rebased, because a deep zoom runs out of float32

Compositor transforms are computed in single precision. At zoom 100 with a
campaign 100,000 world units wide, an entry's absolute screen offset reaches
1e7 CSS pixels, and float32 has about 1.7e7 of integer resolution, so
neighbouring positions stop being distinguishable and cards visibly jitter
against the shapes they label.

So the layer's coordinate space is world coordinates measured from an ORIGIN
that follows the camera. The origin is rebased to the centre of the visible
bounds whenever it falls outside them, which is at most once per viewport-worth
of pan and never twice in a row from one gesture, since a fresh origin sits at
the centre with half a viewport of slack on every side. Entry offsets are then
bounded by the visible world region, and the layer's own translate is bounded
by the viewport, so nothing in the composed matrix exceeds a few thousand.

The cost is a rewrite of every visible entry's transform on a rebase. That is
bounded by the element cap (decision 7), and it happens on the same frames
where a pan is already crossing entries in and out of view.

### 6. Placement is a discriminated union, so an entry cannot be written wrongly

```ts
/**
 * Where on an element its world position lands, as a fraction of the element's
 * OWN box. Its own type rather than a `Vec2`, and its fields are not `x` and
 * `y`, for the reason `WorldBounds` is not a `Rect`: this is a y-DOWN unit
 * fraction, `Vec2` is a y-up world point, and two structurally identical
 * records with different conventions flow into each other with nothing red
 * anywhere.
 */
interface ElementAnchor {
  /** 0 at the element's left edge, 1 at its right. Default 0.5. */
  readonly across: number;
  /** 0 at the element's TOP edge, 1 at its bottom. Default 0.5. */
  readonly down: number;
}

type OverlayPlacement =
  | {
      readonly kind: 'point';
      /** Where it sits, in world units. */
      readonly at: Vec2;
      /** Which part of the element lands on `at`. Default the centre. */
      readonly anchor?: ElementAnchor;
    }
  | {
      readonly kind: 'box';
      /** The node's layout box, in world units. */
      readonly bounds: WorldBounds;
      /** CSS pixels, inclusive. Default 0. */
      readonly minScreenWidth?: number;
      /** CSS pixels, exclusive. Default `Infinity`. */
      readonly maxScreenWidth?: number;
    };
```

This follows `ShapeDescriptor`'s shape for the same reason it was chosen there,
`readonly` included: a single record with every field would carry combinations
that have no meaning, and each of those has to be validated at runtime instead
of being unwritable. `readonly` matters more here than it does there, because
the overlay CACHES what it computed from a placement and rewrites an entry's
transform only on the events in decision 4; a caller mutating a placement in
place would move the box for the culling test and not for the transform, and
the entry would draw in the old position until something unrelated moved the
camera far enough to rebase.

- A box is sized to its bounds and therefore scales with the zoom by
  definition. There is no screen mode for a box, because a world rectangle that
  does not scale is not a rectangle in either space.
- A point has no extent, so "how big is it on screen" has no answer that is not
  invented, which is why the size gate lives on the box member alone. A point
  entry is culled by position and nothing else.
- **A point is therefore always screen-scaled**, counter-scaled by `1/z` about
  its anchor so a tooltip or a badge stays the size it was authored at. There is
  no world-scaled point, and dropping it is the second thing this union buys.
  A world-scaled point grows with the zoom while nothing can gate it, since the
  gate needs an extent and the only extent it has is the authored size of its
  own DOM, which `sync()` may not read (decision 11). A 200 pixel card as a
  world-scaled point is 20,000 CSS pixels of ungated DOM at zoom 100. Content
  that should grow with the graph has an extent, and an extent is a box, which
  is also what makes it cullable and gateable honestly.

A point entry's transform depends on the zoom, so point entries are rewritten
when the zoom changes. Box entries are not, and panning costs one write either
way.

### 6b. The rest of the surface

Decision 6 types the placement and the rest of the core is this, in full, so
that no field in the decisions above has to be inferred from prose:

```ts
interface HtmlOverlayOptions {
  /**
   * The element the layer is mounted into, which has to establish a
   * containing block (see decision 3). The overlay does not style it.
   */
  readonly parent: HTMLElement;
  readonly camera: Camera2D;
  /** The cap from decision 7. Default 200. A `RangeError` below 1. */
  readonly maxElements?: number;
}

interface OverlayEntryInit {
  readonly placement: OverlayPlacement;
  /** Called the first time the entry becomes visible. */
  readonly create: () => HTMLElement;
  /**
   * Called when it stops being visible, after the element is detached.
   * Defaults to dropping the element for the collector; a pool implements it.
   */
  readonly release?: (element: HTMLElement) => void;
  /** `pointer-events: auto` on the element. Default false. See decision 12. */
  readonly interactive?: boolean;
}

/** What `add` returns: the caller's handle on one entry. */
interface OverlayEntry {
  /** Replaces the placement, and rewrites the transform on the next sync. */
  place(placement: OverlayPlacement): void;
  /** Unregisters it, detaching and releasing the element if it has one. */
  remove(): void;
}

interface HtmlOverlay {
  add(init: OverlayEntryInit): OverlayEntry;
  /** From the caller's draw path. See decision 11. */
  sync(): void;
  /** How many elements are attached after the last sync. */
  readonly activeCount: number;
  dispose(): void;
}

function createHtmlOverlay(options: HtmlOverlayOptions): HtmlOverlay;
```

`place` is the named method decision 4 means by "when its placement changes",
and it exists rather than a mutable field for the caching reason above.
`activeCount` is on the surface because the cap is invisible otherwise: a
consumer that has silently hit it sees a picture missing labels and has nothing
to read. The demo puts it in its readout, which is also what makes the cap
visible in a screenshot.

### 7. Culling, the gate, and a cap that is not negotiable

Three filters run per sync, in this order, all on numbers the camera already
has:

1. **Cull.** A box entry is a candidate when its bounds overlap
   `camera.visibleWorldBounds()`, which is four comparisons. A point entry is a
   candidate when its point is inside them. A point entry's element can extend
   past its point by any amount, so an entry near the edge can be culled while
   part of it would still have been on screen; the fix a caller has is a box.
2. **Gate.** A box entry passes when `minScreenWidth <= width * zoom <
   maxScreenWidth`. Half-open on purpose: two tiers sharing a threshold then
   never both show and never both hide, at any zoom, without either of them
   knowing the other exists.
3. **Cap.** If more entries survive than `maxElements` (default 200), they are
   ranked by the distance from the viewport centre to the entry's screen
   position and the nearest are kept. Ties break by registration order, so the
   picture does not depend on iteration order.

The cap is the part that is not a tuning knob. A degenerate zoom qualifies
every label in a graph at once, and the DOM must not be the thing that falls
over: a hundred thousand elements is a locked-up tab, where a hundred thousand
instanced quads is a frame. Ranking by distance from the centre means what
survives is what the user is looking at. The visible cost of a cap is that
entries pop at the boundary rank as the camera moves, which is inherent: a
hysteresis band would trade the pop for a picture that depends on how you got
there.

The scan itself is O(n) over registered entries per sync, with no allocation
per surviving entry beyond the ranking array. At the campaign demo's 2,800
nodes that is a few thousand comparisons per frame, which is not worth a
spatial index; at 100,000 it would be, and the index is a change to one
function.

### 8. Tiers are gates, not a third concept

The campaign plan's three tiers (nothing below ~24 CSS px, a title label to
~160 px, a full card above it) need no tier machinery in the core. A node
registers one entry per tier, all with the same bounds and adjacent gates:

| Tier | Placement | Gate | What draws it |
| --- | --- | --- | --- |
| shape | none | none | the GPU, via the instanced mesh |
| label | box | `[24, 160)` | one entry, a title element |
| card | box | `[160, Infinity)` | one entry, the full card |

Disjoint half-open gates mean at most one of a node's entries is ever active,
so the cap counts nodes rather than tiers, and a node moving between tiers is
one entry being released and another created. The rich-node layer (decision 9)
is then bookkeeping over the core rather than a second implementation of it.

### 9. Rich nodes: `create` and `update`, so elements can be pooled

An entry does not hold an element. It holds a `create()` called the first time
it becomes visible and a `release(element)` called when it stops being visible,
which the core defaults to dropping the element for the collector. Building a
card for every one of 2,800 nodes at registration time would be 2,800 DOM
subtrees for the tens that are ever on screen.

The rich-node layer sits on that:

```ts
interface RichNode<T> {
  readonly id: string;
  /** The layout box, in world units. */
  readonly bounds: WorldBounds;
  readonly data: T;
}

interface RichNodeTier<T> {
  readonly name: string;
  /** The gate, in CSS pixels: inclusive floor, exclusive ceiling. */
  readonly minScreenWidth?: number;
  readonly maxScreenWidth?: number;
  /** A blank element of this tier's shape, or one from the tier's pool. */
  create(): HTMLElement;
  update(element: HTMLElement, node: RichNode<T>): void;
  readonly interactive?: boolean;
}

interface RichNodes<T> {
  setNodes(nodes: Iterable<RichNode<T>>): void;
  dispose(): void;
}

function createRichNodes<T>(options: {
  readonly overlay: HtmlOverlay;
  readonly tiers: readonly RichNodeTier<T>[];
}): RichNodes<T>;
```

`create()` returns a blank element of the tier's shape and `update(el, node)`
fills it in. The split is what makes pooling possible: a card scrolling out of
view goes back to its tier's pool, and the next node to reach card tier gets it
with new content rather than a new subtree.

`setNodes` diffs by id: a node that is new registers its entries, a node that
is gone removes them, and a node whose `bounds` changed is re-placed, so a
relayout moves boxes without rebuilding anything. **A node whose `data` is not
the same reference as last time has `update(element, node)` called on it if it
currently has an element**, which is the answer to the question the
create/update split otherwise leaves open, and it is reference equality rather
than a deep comparison because a deep comparison of arbitrary card data is
neither cheap nor decidable. A caller mutating `data` in place gets no
re-render, on the same terms as every other one-way data flow in this project.

### 10. Measurement: rich nodes declare their size, and may measure it

`@dagr/layout` takes sizes through `LayoutConfig.nodeSize`, called exactly once
per node during prepare, on the main thread even in M2.10's worker mode,
because the callback stays on the caller's side of the port. So a DOM
measurement can feed layout. The question is whether it should.

**Both, and the default is to declare.** The library ships an opt-in helper and
the campaign demo does not use it.

Declared sizes are right when the content is templated: a card whose shape is
fixed per node kind has a size known by construction, 2,800 offscreen mounts at
startup buy nothing, and the layout runs in a worker with no DOM anywhere near
it. Measurement is right when the content is authored per node and its size is
a fact about the text: a label whose width is the name's width cannot be
guessed without the font.

The helper, `measureHtmlSizes`, batches, and the batching is the whole reason
it exists rather than being an example in the docs:

1. Mount every element into one offscreen container (`position: absolute;
   visibility: hidden; left: -10000px`, not `display: none`, which has no box
   and measures zero).
2. Read every `getBoundingClientRect` afterwards.

Interleaving a mount and a read per node forces a layout flush per node, which
is the classic quadratic that turns 2,800 measurements into seconds. Writing
all, then reading all, is one flush.

```ts
interface MeasureItem {
  readonly id: string;
  readonly create: () => HTMLElement;
  /**
   * The width the element will have where it is finally drawn, in world units,
   * which are CSS pixels inside the layer. Given, the element wraps here the
   * way it will wrap there and the measured height is the height it will have.
   * Omitted, it is measured unconstrained, which is right for a single line and
   * wrong for anything that wraps.
   */
  readonly maxWidth?: number;
}

function measureHtmlSizes(
  items: Iterable<MeasureItem>,
  options: {
    /**
     * The subtree whose styles apply. Required, and not defaulted to
     * `document.body`, because inherited font, line height and custom
     * properties decide the answer: a card measured under the page's styles
     * and drawn under the overlay's is measured wrong, silently, and the
     * symptom is a layout whose boxes do not fit their content.
     */
    readonly parent: HTMLElement;
    /** Put on the offscreen container, so the caller's CSS can reach it. */
    readonly className?: string;
  },
): Map<string, Size>;
```

The helper owns the offscreen container: it creates one inside `parent`, mounts
into it, reads, and removes it before returning. There is nothing for a caller
to own, since the container does not outlive the synchronous call, and leaving
one attached is how a measurement harness turns into a memory leak nobody sees.
It names no `@dagr/graph` type, so `@dagr/render` does not grow a dependency on
the graph model; the caller adapts the map into `nodeSize`, which is one arrow
function.

Two things about the measurement that are the caller's to get right, stated
here rather than left to be discovered. `visibility: hidden` keeps a box where
`display: none` has none and measures zero, which is why the container uses it.
And a web font that has not finished loading measures in the fallback face, so
a caller using one awaits `document.fonts.ready` before measuring; the helper
stays synchronous rather than awaiting it internally, because a synchronous
function is what `nodeSize` can be built from.

### 11. `sync()` is called from the draw path, and reads no layout

The overlay has no animation loop. `sync()` is called from the same callback
that calls `renderer.render()`, which in `apps/demo` is the coalesced
`requestDraw` from M4.2. A second `requestAnimationFrame` would be a second
frame budget and, worse, a frame of skew: the labels would trail the shapes
during a pan, which reads as the text swimming over the graph.

`sync()` writes styles and reads nothing from the DOM. No
`getBoundingClientRect`, no `offsetWidth`, no `getComputedStyle`. That is what
keeps it off the forced-reflow path, and it is a property to preserve rather
than an accident: one layout read inside the loop would make every frame pay
for the styles it wrote a line earlier.

`dispose()` removes both divs and is idempotent. `sync()` after dispose is a
no-op rather than a throw, because a frame is often already scheduled when a
component unmounts and throwing inside a `requestAnimationFrame` callback
reports to nobody. `add()` after dispose throws, because that is a caller bug
with a stack that points at the caller.

**The no-op is a knowing divergence from this package's precedent, which is
worth recording rather than leaving to look like an oversight.** Every method
on the renderer throws `RendererDisposedError(method)` after dispose, and the
argument for that is sound: a lifecycle failure is the one a caller writes a
`catch` for. It does not carry to `sync()`, because `sync()` is called from
inside a `requestAnimationFrame` callback where a throw goes to the global
error handler and the caller's `try` is three frames away. The two rules agree
on `add()`, which is called from caller code, and differ on the one method the
platform calls.

### 11b. `errors.ts` grows the base it said it owed

`packages/render/src/errors.ts` has one class and a paragraph explaining that a
base class over a family of one would be a family only in the sense that a
single point is a line, and that **a second member is when this file grows a
base**. This feature brings two, so the base arrives here as the mechanical
change that file described:

| Class | `code` | Thrown when |
| --- | --- | --- |
| `RendererDisposedError` | `RENDERER_DISPOSED` | a renderer method is called after dispose. Unchanged in name and message |
| `OverlayParentError` | `OVERLAY_PARENT` | `createHtmlOverlay` is given a parent that computes to `position: static` |
| `OverlayDisposedError` | `OVERLAY_DISPOSED` | `add()` is called after dispose |

Two classes rather than one `HtmlOverlayError` with two messages, because they
are different failures with different fixes: one is a stylesheet the caller
edits once, the other is a lifecycle race the caller catches. The abstract base
`DagrRenderError` carries an abstract `code`, matching `DagrGraphError` and
`DagrLayoutError`, so a caller can switch on a value instead of a class, and
adding it under `RendererDisposedError` is additive: the class name, the
message and `instanceof Error` are all unchanged.

### 12. `pointer-events` is off by default and opt-in per entry

The clip div is `pointer-events: none`, so the canvas keeps every gesture
everywhere. An entry with `interactive: true` gets `pointer-events: auto` on
its element and becomes clickable.

The cost, stated plainly because it surprises people: an interactive element
swallows the wheel and the drag over its own area, so panning with the cursor
over a card does nothing. The overlay does not forward events to the canvas,
because forwarding synthesises input the browser did not send and gets the
coordinate space wrong in exactly the cases (transforms, capture) this feature
is made of. The pattern that works is to make the card body inert and the
controls inside it interactive, which is what the demo does.

Accessibility, since it is the reason a DOM overlay is better than a glyph
atlas and also a limit: overlay text is real text, so it is selectable and
reachable by a screen reader. Culling removes it from the accessibility tree
along with everything else, so the overlay is not a description of the graph,
only of what is on screen.

## What is tested, and what is not

`@dagr/render`'s testing line is "pure modules in Node, a committed screenshot
for anything that needs a device". The overlay moves that line, and the move is
the point: an overlay needs a DOM, and a DOM is available in Node where a GPU
adapter is not.

- **`overlay-math.ts` is pure and returns strings.** The transform composition,
  the anchor percentages, the counter-scale, the overlap test, the gate
  comparison, the cap ranking and the rebase predicate are all functions of
  numbers, and the CSS strings the DOM half assigns are computed here. The M4.2
  lesson applied: put the formula in the half a test can execute, so the test
  runs the arithmetic the browser runs rather than a copy of it.
- **`html-overlay.ts` is wiring, tested against jsdom.** Element counts on
  cull, the cap evicting the farthest, `create` called once per
  becoming-visible, `release` called on cull, dispose being idempotent, the
  unpositioned-parent throw. These are observable without a layout engine,
  which is what makes them testable at all: nothing in the overlay depends on
  the DOM computing a box.

  **This adds the workspace's first DOM test dependency, so the choice is made
  here rather than arriving unremarked in a PR.** No package has jsdom or
  happy-dom today (the lockfile's hits are vitest's optional peer
  declarations), `@dagr/render` has no vitest config, and its tests run in bare
  Node. Increment 2 adds `jsdom` as a devDependency of `@dagr/render` and a
  vitest config selecting it for the overlay's DOM test alone, through the
  per-file `@vitest-environment` docblock, so the package's other suites keep
  running in Node with no environment cost.

  jsdom over happy-dom because the four behaviours these tests stand on were
  checked in jsdom 30 rather than assumed: `style.transform` round-trips the
  string verbatim (it is not a property cssstyle implements, so a normalising
  CSSOM could have dropped it), `setProperty('pointer-events', ...)` survives,
  `getComputedStyle(el).position` resolves an inline `position` and reports
  `static` for an element with none, which is exactly the branch
  `OverlayParentError` guards, and `remove()` detaches. happy-dom would very
  likely do the same and is faster; it is not worth a second dependency to
  find out, and jsdom is the implementation a later component test in
  `@dagr/react` will want anyway.
- **Knowingly untested, and listed on `docs/docs/render.md` with the rest of
  the package's untested surface:** that a browser composes the layer transform
  and the entry transform the way the algebra says, that text stays sharp under
  a scaled ancestor, and that the float32 jitter argument in decision 5 is
  quantitatively right. The first two are verified by the committed screenshot;
  the third is verified by the absence of jitter at the zoom the demo reaches,
  which is evidence and not a measurement.

## Increments

Each is one merge-worthy PR per AGENTS.md, with tests, docs and a ROADMAP
entry.

| # | Lands | Roadmap |
| --- | --- | --- |
| 1 | This spec, and the ROADMAP entries for the two tasks below | M4.11, M4.12 added |
| 2 | `createHtmlOverlay`, `overlay-math.ts`, the errors base, the jsdom tests, labels on the demo's ladder, a committed screenshot, `docs/docs/render.md` section | M4.11 |
| 3 | `createRichNodes`, `measureHtmlSizes`, three-tier cards on the demo, a committed screenshot per tier | M4.12 |
| 4 | The in-canvas text recommendation below, with its measurement | M4.12 |

Both M4.11 and M4.12 are tagged `apps/demo`, and the M4 header says a task so
tagged lands a scene and a screenshot without repeating the requirement per
task, so increment 2 owes one of its own rather than borrowing increment 3's.
Increment 2's is the label tier over M4.2's ladder at one zoom; increment 3's
is the three tiers at three zooms. The capture path is the headless chromium
already in `~/.cache/ms-playwright` that the docs site's verification uses, at
device pixel ratio 1 and a stated width, per the M4 header's cap on what
`assets/` is allowed to grow by. If that browser turns out to have no GPU
adapter on this box, the frame is a failure panel rather than a scene, and the
honest move is to say so in the PR and leave the screenshot to a run with a
browser rather than to commit a picture of an error message.

The two roadmap tasks sit after M4.10 in numbering and outside M4's
task-per-scene sequence. They block nothing in M4 and are blocked by nothing:
the overlay needs a camera (M4.1) and a parent element, and the rich-node layer
needs a box per node, which a caller supplies from wherever it has one. The
campaign demo's P6 is the first consumer that has real boxes to give it.

## In-canvas text: the recommendation, and what it is worth

Deliverable from the direction plan, spike only. At what visible-node count
does the DOM label tier stop being honest, and what would an MSDF atlas task
cost?

The measurement, taken on the demo page rather than reasoned about: raise the
element cap, drive a pan at a fixed zoom, and record the frame time against the
number of active label elements. Procedure and numbers land with increment 4;
this section states the shape of the answer and will carry the numbers.

The argument that does not need numbers: the tiers have different futures. The
CARD tier is HTML by nature. Its content is arbitrary markup with links,
images, wrapped prose and per-kind structure, and reimplementing that over a
glyph atlas is reimplementing a browser. It should stay DOM permanently, and at
card zoom only tens of nodes fit on screen, so it never approaches a count
where the DOM is the bottleneck. The LABEL tier is a single line of text per
node, and it is exactly what an atlas does well. If M4.10's 10k-node target is
ever asked to show names, the DOM label tier is the wrong answer at that count
and an atlas is the right one.

So the recommendation, ahead of the numbers: keep the DOM for both tiers now,
and schedule an atlas task only when a scene wants names on more nodes than the
measurement supports. The overlay's design does not change either way, because
the label tier is one entry per node with a gate, and an atlas takes the tier
over by taking the gate over.

## Not in scope

- MSDF text rendering itself.
- `<DagrCanvas>` and `@dagr/react`, per decision 2.
- The campaign dataset, camera limits and keyboard zoom, which are the campaign
  demo plan's P1 and P2 and are being built on another branch.
- Edge labels. They are a placement question (where on a route does a label
  sit, and how does it stay off the crossings) rather than an overlay question,
  and the overlay serves them unchanged once somebody answers it.

## Open questions for the maintainer

1. Decision 2: `@dagr/react` gets no component and `<Html>` waits for M5.1's
   context. Reverse it and `<Html>` lands in this session instead.
2. The default element cap is 200, from the campaign plan. It is the number
   that bounds the worst case rather than one anybody has measured a frame
   against; increment 4's measurement is what would move it.
