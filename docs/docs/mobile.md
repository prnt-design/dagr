---
id: mobile
title: Mobile architecture
sidebar_position: 10
---

# Mobile is a shared library capability

:::note[Unreleased]

The shared pinch API is a repository implementation for the next release.
Current 0.1.4 npm packages do not include it; publication remains maintainer-gated.

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
| Renderer core | Camera arithmetic and shared touch-contact geometry | React state, DOM event capture or a device-name detector |
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
outline reader uses the same ExplorerRoot state. Keyboard occlusion, safe
areas and camera-visible areas still need a shared contract: a software
keyboard can shrink the
[visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
without shrinking the layout viewport. A visual viewport resize is not proof
that a keyboard opened, and browser zoom must not be disabled to simplify it.

See the [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md#core-mobile-framework-track)
for the viewport/occlusion and conformance work. Tests of a gesture state machine
or Chromium touch emulation are not real iOS/Android device validation.
