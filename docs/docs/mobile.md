---
id: mobile
title: Mobile architecture
sidebar_position: 10
---

# Mobile is a shared library capability

:::note[Unreleased]

The shared pinch and visible-frame APIs are repository implementations for the
next release. Current 0.1.4 npm packages do not include them; publication
remains maintainer-gated.

:::

A graph has the same identity, selection and relationships on a phone and a
large screen. Mobile support belongs in Dagr's input, camera and presentation
contracts, with adapters for the surface being drawn. It does not require a
phone-only renderer or another copy of the graph.

The first shared primitive is `createPinchGesture`, exported by
`@prnt/dagr-render/core`, the full renderer entry and `@prnt/dagr/render/core`.
Both `DagrCanvas` and Explorer use it for their two-contact geometry and
lifecycle. It is DOM-free and three.js-free, so it also works in an imperative
host or a server-side test. This is a core foundation, not a claim that every
mobile reading flow or real device has been validated.

## Where each responsibility lives

| Layer | Owns | Does not own |
| --- | --- | --- |
| Graph and layout | Stable IDs, relationships, coordinates and layout deltas | A phone-specific copy of the dataset |
| Renderer core | Camera arithmetic, shared touch-contact geometry and the visible frame | React state, DOM event capture or a device-name detector |
| Surface adapter | CSS coordinates, event capture/cancellation, scroll ownership and camera updates | Duplicated pinch arithmetic or graph semantics |
| Explorer or host UI | Readable controls/details, focus, search and reading modes | A separate mobile selection/search store |
| Rendering backend | GPU or SVG drawing and its measured resource budget | Choosing a graph's meaning or changing input semantics |

The native Explorer base remains experimental. A backend may change for
measured rendering capacity or capabilities; a narrow container alone is not
a backend-selection rule. Shared contact handling reduces behavioral drift,
but does not replace visual/backend parity checks.

## Shared pinch contract

Feed accepted touch contacts into one gesture object per surface. Positions
and deltas are in viewport CSS pixels, before camera conversion. Do not multiply
them by devicePixelRatio. On each change, pan first, then zoom at the new
midpoint:

```ts
import { Camera2D, createPinchGesture } from '@prnt/dagr-render/core';

const camera = new Camera2D({
  viewport: { width: 320, height: 480, devicePixelRatio: 1 },
});
const gesture = createPinchGesture();
gesture.down(1, { x: 100, y: 100 });
gesture.down(2, { x: 200, y: 100 });
const change = gesture.move(2, { x: 300, y: 100 });
// change: { pan: { x: 50, y: 0 }, anchor: { x: 200, y: 100 }, factor: 2 }
if (change !== null) {
  camera.panByScreen(change.pan.x, change.pan.y);
  camera.zoomAtScreen(change.anchor, change.factor);
}
gesture.up(2); // Also on pointercancel, and on lostpointercapture targeting the surface itself.
gesture.reset(); // On surface teardown or an explicitly abandoned sequence.
```

Here `camera` is a host-owned `Camera2D`; it is not created by the gesture.
Explorer applies the same deltas through its y-down camera adapter.

The first two contacts stay the active pair. A third contact and duplicate
`down` are ignored; an ignored contact is not automatically promoted when a
slot opens. A new `down` can fill that slot. Unknown moves return `null`.
Releasing a contact ends two-finger motion; the remaining finger alone cannot
produce another pinch delta. Coincident fingers pan without zoom, then
establish a fresh distance baseline as they separate. Non-finite input is
ignored. Input points and returned pointer-ID snapshots do not expose mutable
internal state.

The object does not attach events, capture pointers, call preventDefault,
change focus, suppress a synthesized click, or distinguish mouse from touch.
Adapters own these decisions. Forward cancellation as well as release, suppress
post-pinch clicks and avoid resuming an old single-finger drag. Dropped events
or a disappearing surface require an explicit reset. Both built-in adapters
reset stale contacts when a fresh primary touch sequence begins.

## Visible frame contract

A surface's visible frame is the part of it left to frame content in: what a
fit, a focus or a reveal should aim at. Three different things take area away,
and each has its own function in `@prnt/dagr-render/core`. All work in the
same CSS-pixel coordinates as `getBoundingClientRect`:

- `coverInset(surface, cover)` is an overlay drawn over the surface, such as a
  details drawer. It takes one side, and only when it touches that side and
  spans at least half of it. An overlay in the middle takes nothing.
- `clipInset(surface, visible)` is the part of the surface outside a box: a
  scrolling ancestor's client box (inside its border and scrollbar), or the
  visual viewport's, which can shrink while the layout viewport does not, for
  example when a software keyboard opens or the page is zoomed. It clips every
  side that falls outside.
- `visualViewportInset(surface, layout, visualViewport)` is what the visual
  viewport hides of the surface beyond what the layout viewport (`layout`, the
  root element's client size) already hides: `clipInset` against the visual
  viewport, less `clipInset` against the layout viewport. A surface the page
  has scrolled partly away keeps that part of its frame. While the page is
  pinch-zoomed (a visual viewport `scale` 0.01 or more from 1) it takes
  nothing off, so magnifying the page does not shrink the graph.
- `visibleFrame(size, ...insets)` combines them, taking the largest inset on
  each side, and returns `{ x, y, width, height }` from the surface's top left.

Given a `surface` element and a `drawer` element over it:

```ts
import { coverInset, visibleFrame, visualViewportInset } from '@prnt/dagr-render/core';

const box = surface.getBoundingClientRect();
const root = document.documentElement;
const vv = window.visualViewport;
const frame = visibleFrame(
  { width: box.width, height: box.height },
  coverInset(box, drawer.getBoundingClientRect()),
  vv ? visualViewportInset(box, { width: root.clientWidth, height: root.clientHeight }, vv) : {},
);
```

An axis the insets would squeeze below max(160 or 120 CSS pixels, a quarter of
the axis) keeps its whole extent, so a full-width drawer or a nearly hidden
surface does not shrink the graph to nothing. The functions do not observe
anything: when to measure, and whether a resize should move the camera, are
adapter decisions. A smaller visual viewport is not proof that a keyboard
opened, and nothing here should be used to disable browser zoom.

Explorer frames around its registered obstructions with `coverInset` and
`visibleFrame`, and observes the visual viewport's `resize` and `scroll`
events, taking off its `visualViewportInset`. A visual viewport that shrinks
does not refit the camera: it keeps its scale, unless the smaller frame lowers
the most the camera may zoom, and reveals the selected node if the change
covered it. A camera fitted while the visual viewport was short fills the
frame again when it grows back, because the least the camera may zoom is the
fit.

`DagrCanvas` takes a measured inset as its `inset` prop and frames its fit,
`fit()`, `focusNode` and camera limits in `visibleFrame(size, inset)` through
`Camera2D.setInset`. It observes the visual viewport the same way, framing in
the larger of its `inset` and its `visualViewportInset` on each side. Either
changing keeps a camera at rest and only re-clamps it to the new limits; a
`fit()` or `focusNode` flight under way works its target out again in the new
frame and lands when it would have. Explorer keeps its own policy above: a
camera at or flying to the fit refits, except on a change of the visual
viewport alone, and the selection is revealed if the change covered it.
Neither adapter observes the page's own scroll.

The visual-viewport coordinates are covered by jsdom tests and by
`bench/browser/visible-frame-check.mjs` in headless Chromium, which scrolls the
page past both surfaces, pinch-zooms it and pans the zoomed view, shortens the
layout viewport and emulates 200% zoom, and finds both cameras and the
selection where the policies above put them. Chromium's DevTools protocol could
not shrink the visual viewport at scale 1, the software-keyboard case, so that
remains covered by jsdom only, and nothing here is verified on a real iOS or
Android device. Current engines
report `getBoundingClientRect` relative to the layout viewport, which is what
`visualViewportInset`'s use of `offsetLeft` and `offsetTop` relies on.

## Page scrolling remains an explicit policy

`DagrCanvas navigation` keeps its existing modes:

- `touchNavigation="drag"` gives the surface one-finger pan and pinch, using
  `touch-action: none`.
- `touchNavigation="two-finger"` leaves single-finger page panning enabled.
  A browser can cancel the pointer stream when it takes that scroll; a later
  second finger does not reliably turn it into an application pinch.

Explorer keeps its focus-gated policy: the first touch on an unfocused graph
focuses it without activating a node. An unfocused graph allows page scroll.
These policies intentionally differ; sharing geometry does not silently change
who owns a browser gesture. Browser `touch-action` is determined when the
sequence begins, so switching it inside pointerdown cannot reclaim a scroll
already owned by the browser. See the
[Pointer Events specification](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property).

## Rendering and responsive reading

Keep host containers explicitly sized. `DagrCanvas` measures its container and
updates its drawing buffer separately from CSS-coordinate input. Its existing
`maxPixelRatio` option can bound drawing-buffer density; choose a budget from
measurements rather than assuming a phone is always slower or has fewer pixels.
Explorer's rich node content remains DOM, backed by the same data and commands
as search and details.

Adaptive controls and details shipped separately in M5.7b: Explorer docks
details below the map in containers narrower than 720 CSS pixels. This input
foundation does not add responsive panels or a new backend. The planned
outline reader uses the same ExplorerRoot state. The visible frame contract
above is the shared geometry for keyboard occlusion and camera-visible areas;
a software keyboard can shrink the
[visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
without shrinking the layout viewport. Explorer and `DagrCanvas` observe it;
safe areas are still to come.

See the [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md#core-mobile-framework-track)
for the viewport/occlusion and conformance work. Tests of a gesture state machine
or Chromium touch emulation are not real iOS/Android device validation.
