# @prnt/dagr-react

[Dagr](https://dagr.prnt.design) as one React component: a graph goes in, a
picture comes out.

```sh
pnpm add @prnt/dagr-react @prnt/dagr-graph @prnt/dagr-render three react react-dom
```

`@prnt/dagr-graph`, `@prnt/dagr-render`, `react` and `react-dom` are peer dependencies.
`@prnt/dagr-layout` is a real dependency and comes with the install.

```tsx
import { Graph } from '@prnt/dagr-graph';
import { DagrCanvas, Html } from '@prnt/dagr-react';

const graph = new Graph();
graph.addNode({ id: 'plan' });
graph.addNode({ id: 'build' });
graph.addEdge({ source: 'plan', target: 'build' });

export function Board() {
  return (
    <DagrCanvas graph={graph} style={{ width: '100%', height: 480 }}>
      <Html node="plan">Plan</Html>
      <Html node="build">Build</Html>
    </DagrCanvas>
  );
}
```

`DagrCanvas` is the component. `useDagr` is the layout on its own, `Html` puts
React content in world coordinates, and `useDagrCanvas` reaches the renderer.
`retarget`, `toMotionDelta`, and `toMotionRoster` support callers driving scene
motion themselves. `useGraphInteraction` adds controlled selection and
click-versus-pan gestures around hit geometry the caller supplies.

**Add `animate` and an edit glides to its new layout instead of cutting to it:**

```tsx
<DagrCanvas graph={graph} animate />
```

That is the whole of it. `useDagr` holds a layout engine across renders, so an
edit is a `LayoutDelta` rather than a cold run, and the component drives
`@prnt/dagr-render`'s springs and loop off that delta through its own coalesced
frame. The camera is fitted once and then it is yours: a following camera is
`fitBounds` on the sprung box handed to `onFrame`, which is your line of code
rather than the component's.

## Shared selection and gestures

`useGraphInteraction` works with DOM, SVG, canvas, and future GPU picking
because the package does not guess where your nodes are. Your synchronous hit
provider receives a surface-relative CSS point, the same point converted
through your camera, the displayed DPR you supply, and an opaque
displayed-scene revision. It returns a stable node, port, or empty result
stamped with the revision it queried.

```tsx
useGraphInteraction({
  surfaceRef,
  displayedRevision: frame,
  devicePixelRatio: renderedDpr,
  screenToWorld: (point) => camera.screenToWorld(point),
  hitTarget: (query) => hitIndex.query(query),
  selection,
  onSelectionChange: setSelection,
  onPanStart: () => camera.stop(),
  onPanBy: (delta) => camera.panByScreen(delta),
});
```

Coordinates stay in CSS pixels until your provider chooses otherwise. Do not
multiply the point by DPR before `screenToWorld`; use `devicePixelRatio` only
when reading a device-pixel buffer. Change `displayedRevision` whenever target
geometry, draw order, membership, or its paired DPR changes on screen,
including animation frames. Hits and misses both carry a stamp. The hook
rejects a provider result with an older stamp and rejects a click when the
revision changed between press and release.

Selection is controlled. A click selects on release only when press and release
hit the same stable identity. Five CSS pixels turns the sequence into a pan and
suppresses its pointer-generated click. Pointer cancellation never selects.

Native controls are excluded. A focusable graph target opts in with
`data-dagr-interaction-target`; a nested input still wins and remains native.
The hook does not handle keyboard events, so keep graph targets focusable and
handle their keyboard `click` (`event.detail === 0`) in your component. Set
`touch-action: none` on the surface for touch panning and `user-select: none`
for drag presentation.

This API has no built-in hit geometry. Exact `DagrCanvas` node shapes are
M5.2b; port geometry and connection gestures are M6.3. Edges are not hit
targets in this slice.

## Navigation, node events and level of detail

```tsx
const api = useRef<DagrCanvasApi>(null);

<DagrCanvas
  graph={graph}
  navigation                      // wheel/pinch zoom, drag pan, keyboard; inside camera limits
  label="Relationship graph"
  apiRef={api}                    // api.current.focusNode(id), .fit()
  onNodeClick={(id) => open(id)}  // exact CPU hit test on the drawn silhouettes
  onNodeHover={(id) => hover(id)}
  onBackgroundClick={close}
  nodeTiers={tiers}               // dot -> label -> card, gated by on-screen width
  nodeData={(id) => items.get(id)!}
/>
```

`nodeTiers` are the renderer's `RichNodeTier`s: below the first gate a node is
only its instanced GPU shape, and only nodes in view mount DOM, pooled across a
pan. Elements are tagged `data-dagr-node-id`; Enter or Space on a focused one
calls `onNodeClick`. Hits cover node silhouettes only (no edges or ports), and
`navigation` is off by default. When neither WebGPU nor WebGL 2 exists, probe
with `detectBackendSupport()` from `@prnt/dagr-render` and render a fallback;
`onError` covers a device that dies late. Full details: the
[React guide](https://dagr.prnt.design/docs/react#navigation-node-events-and-camera-control).

## Read this first: the `graph` prop is watched, not compared

A `Graph` is mutable, so comparing it by identity the way React compares
everything would mean `graph.addNode(...)` changed nothing on screen until you
also replaced the object. Instead the hook subscribes to the graph through
`useSyncExternalStore`, and **both of these redraw**:

```tsx
graph.addNode({ id: 'ship' });
setGraph(rebuildFromScratch());
```

There is one narrow window this leaves open and it is real. React subscribes in
an effect, after the render that read the store, and effects run child first.
A **child's** mount effect that edits the graph runs before the canvas has
subscribed, so that one edit is not picked up until the next one arrives, which
reports both. Edit in a parent effect, or in an event handler, and it is picked
up straight away.

One more thing worth knowing before your first multi-step edit: **wrap it in
`graph.batch`**. Each mutating call is a patch and a relayout of its own, so
adding a node and then wiring it up is three of each, computing two layouts that
are never drawn: React commits once, holding the last. The component notices and
reseats rather than animating from a delta it cannot trust, so the drawing is
right either way, and a batch is one patch, one layout and one glide.

## Reporting layout changes

`onLayout(result, delta, from, continues)` reports each committed layout.
Use `continues && delta !== null` before counting moved/added/removed nodes.
`continues` is false for cold runs, after layout failures, and when React skips
an intermediate layout. It works with animation enabled or disabled and does
not mean rendering has finished. Handlers taking fewer arguments still work.

## Documentation

The component, the hook, the animation, the overlay and the two conversions are
on the [React bindings](https://dagr.prnt.design/docs/react) page.

MIT © prnt.design

## Node groups

Pass `groups={[{ id: 'processing', label: 'Processing', nodeIds: ['parse', 'validate'] }]}`
to `DagrCanvas` to draw a boundary that follows those nodes. This is visual
membership, not a layout constraint. See the [grouping guide](https://dagr.prnt.design/docs/node-groups).

## Default navigation limits

`DagrCanvas` constrains its camera by default. The minimum zoom fits the complete
graph, including group labels and padding. The maximum fits a single node with
5% margin (or `fitPadding`); for mixed node sizes the smallest fitting node sets
the ceiling. Panning stays within the padded content bounds and keeps part of an actual node
visible, including in sparse graphs. An axis smaller
than the viewport stays centered. Limits follow resizing, layout changes, and
animated bounds without resetting a valid close-up.

`fit={false}` only skips the initial fit. Use `cameraLimits={false}` to opt out
of content constraints when implementing a custom camera policy. Low-level
`Camera2D` instances remain unrestricted until `setContentBounds` is called.

### Edge paths

Set `edgePath={{ style: 'smooth' }}` or
`edgePath={{ style: 'orthogonal', direction: 'vertical' }}` on `DagrCanvas`.
The default `polyline` preserves routed segments. Options update live, including
during animation. These visual styles preserve route anchors but do not avoid
obstacles; see the [React guide](https://dagr.prnt.design/docs/react#edge-path-styles).
