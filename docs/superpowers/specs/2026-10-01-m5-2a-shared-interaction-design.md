# M5.2a shared interaction design

**Date:** 2026-10-01
**Status:** Approved by the daily-job mandate
**Repo:** `prnt-design/dagr`

## What

`@prnt/dagr-react` will export one reusable controlled-selection and
click-versus-pan hook. A caller supplies the hit provider and camera conversion,
so the hook works with DOM, SVG, canvas, and future GPU picking without naming
any renderer.

The slice includes:

- a framework-independent pointer state machine;
- a React hook that attaches the state machine to a surface ref;
- migration of the generic System Atlas;
- a packed external-consumer type check;
- package and site documentation;
- a CPU baseline at 100, 1,000, and 10,000 synthetic node boxes.

M5.2b remains separate. It will supply exact `DagrCanvas` node hits from the
geometry on screen.

## Public contract

The public target identity is a discriminated union:

```ts
type GraphHitTarget =
  | { readonly kind: 'node'; readonly nodeId: string }
  | {
      readonly kind: 'port';
      readonly nodeId: string;
      readonly portId: string;
    };
```

Node IDs and the `(nodeId, portId)` pair are stable graph identities. Array
positions, renderer instance slots, and pick colors are not identities.

The hit provider is synchronous:

```ts
interface GraphHitQuery<Revision> {
  readonly css: { readonly x: number; readonly y: number };
  readonly world: { readonly x: number; readonly y: number };
  readonly devicePixelRatio: number;
  readonly displayedRevision: Revision;
}

interface GraphHit<Revision> {
  readonly target: GraphHitTarget | null;
  readonly displayedRevision: Revision;
}

type GraphHitProvider<Revision> =
  (query: GraphHitQuery<Revision>) => GraphHit<Revision>;
```

`css` is measured from the interaction surface's top-left border box in CSS
pixels. `world` is the caller's conversion of that point against the camera
that currently displays the scene. Positive screen `y` points down. World-axis
direction is the caller's camera convention. The caller supplies
`devicePixelRatio` from the displayed scene because CSS coordinates must not be
multiplied before camera conversion. A provider that reads a device-pixel
buffer performs that multiply at its own boundary.

`displayedRevision` is opaque to the hook and compared with `Object.is`. The
caller must change it whenever displayed hit geometry, draw order, target
membership, or the paired DPR changes, including every animated geometry
frame. A graph model revision that runs ahead of animation is not a displayed
revision.

The provider stamps every hit or miss with the revision of the geometry it
queried. The hook rejects the result unless that stamp matches the query. It
also rejects a click when the displayed revision changed between press and
release. This is the stale-result boundary M5.2b, M6.3a, and M4.8b share.

The React hook takes:

- a `surfaceRef`;
- the current `displayedRevision`;
- the DPR used for that displayed revision;
- `screenToWorld(css)`;
- `hitTarget(query)`;
- controlled `selection` and `onSelectionChange`;
- `onPanBy(cssDelta)`;
- optional pan start and end callbacks;
- an optional threshold, defaulting to 5 CSS pixels.

The hook stores no selected target. Clicking the selected target may still call
the controlled callback with the same identity, so activation remains
observable to the application.

## Pointer sequence

Primary pointer down records the pointer ID, CSS position, displayed revision,
and fresh hit. It does not select.

Movement below the threshold does nothing. Crossing the threshold permanently
turns that sequence into a pan, focuses the surface without scrolling, captures
the pointer, reports the full CSS delta since press, and marks the surface as
dragging. Later movement reports incremental CSS deltas.

Primary pointer release selects only when all of these hold:

1. the sequence never crossed the threshold;
2. the displayed revision still matches the press;
3. a fresh release hit is not stale;
4. press and release identify the same target.

A valid press and release on empty space clears selection. A target on only one
side changes nothing, because dragging into a node is not a click on that node.
Pointer cancellation and lost capture never select. A drag release ends pan and
suppresses the browser's pointer-generated `click` and `dblclick`.

The hook owns no camera. `onPanBy` receives CSS pixels with positive `x` right
and positive `y` down. The atlas keeps its current camera target and applies
those deltas there. `DagrCanvas` can later call `Camera2D.panByScreen`.

## Native behavior

Pointer starts on `button`, `a`, form controls, editable content, or an element
with button semantics are ignored by default. An interactive graph target opts
in with `data-dagr-interaction-target`. The closest interactive element wins,
so a form control inside a rich node stays native even when an ancestor is a
graph target.

The hook does not handle keyboard events. Graph targets remain real focusable
controls and their keyboard-generated `click` keeps the caller's handler.
Consumers using one handler for both paths process only `click` events with
`detail === 0`; pointer selection already happened on pointer release.

The surface must set `touch-action: none` for touch panning and should set
`user-select: none` for drag presentation. These are CSS policy, not inline
styles the hook may overwrite. Pointer capture begins only after the threshold,
so a tap keeps its original target and native activation path.

## Graph edits

An edit that changes displayed hit geometry changes `displayedRevision`, so an
in-flight click is rejected. A pan continues because its meaning is screen
movement, not target identity.

Controlled selection may name a node removed by a later edit. The hook cannot
decide whether the application should clear it, preserve it for undo, or map it
to another view, so removal reconciliation stays with the controlled owner.

## Benchmark

The benchmark uses a deterministic caller provider over reverse draw-order
rectangles and misses every target, which forces all candidates to be checked.
The three entries contain 100, 1,000, and 10,000 boxes. Each measured pointer
query performs one CSS-to-world conversion, one synchronous provider call, one
revision comparison, and `N` rectangle checks.

The report records the machine from the existing benchmark harness and labels
the provider as synthetic CPU rectangle scanning. It is not a browser frame
rate, a `DagrCanvas` adapter measurement, or WebGPU evidence. M5.2b repeats the
same sizes with its native shape-aware adapter and explains any regression.

## Tests

Pure state-machine tests cover:

- selection only on release over the same stable target;
- empty-space clearing and mismatched-target rejection;
- threshold crossing, incremental pan, and click suppression;
- revision changes and stale provider stamps;
- pointer cancellation, lost capture, and non-primary pointers;
- node and port identity equality.

React integration tests cover listener cleanup, control exclusion, opted-in
graph buttons, focus, touch pointer capture, and keyboard clicks remaining
native. The migrated atlas test proves click selection and pan without
selection. The packed-consumer test imports the public hook and types a node and
port provider from the built tarball.

## Deferred

No node silhouette, draw-order policy, animation geometry source, edge hit, or
port geometry ships here. Those belong to M5.2b and M6.3a. No hover state,
connection gesture, GPU pass, or asynchronous provider is added. The synchronous
contract is the bounded CPU path this milestone can measure and reject as stale
at the event boundary.
