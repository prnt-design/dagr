# DagrExplorer design

**Date:** 2026-10-03
**Status:** Approved by the maintainer on 2026-10-03, and amended the same day during planning and review. Every change since approval is listed under Amendments at the end.
**Repo:** `prnt-design/dagr`
**Roadmap:** M5.6, slices a to f

## What

A new public package, `@prnt/dagr-explorer`, exporting `DagrExplorer`: an
interactive graph explorer with view switching, search, connection tracing,
labeled groups, a details drawer, and a pan and zoom camera. It is generic. A
node needs an `id` and a `label`, and everything else about a node is the
caller's own typed data and the caller's own JSX.

It ships two ways from one implementation:

- `DagrExplorer`, a preassembled component with a default layout;
- named parts (`ExplorerRoot`, `ExplorerViewport`, `ExplorerSearch` and the
  rest) plus `useExplorer()`, for a host that owns the layout.

Node content is virtualized. A node that is offscreen, or too small on screen
to read, has no DOM element. A swappable base layer draws it as a cheap mark.
This spec ships an SVG base layer. A later spec adds a native base layer over
`DagrCanvas`, under the same overlay, so rich nodes are the same JSX on both.

## Why

The same shell exists three times and has drifted:

- `docs/src/components/GraphViewport`, the camera and viewport the docs demos share;
- `docs/src/components/SystemAtlas`, the docs site's own architecture view;
- `@mytraai/architecture-map`, a private package in `MytraAI/mytra-os-uis`
  built on `@prnt/dagr-layout` and a copy of the docs camera as of #92.

The third is the proof that consumers want this as a component and not as a
recipe. Its camera has already missed the changes dagr made after #92. A
component dagr maintains removes the copies, and lets the Mytra package shrink
to a wrapper that supplies its node schema, copy, and theme.

None of the three virtualizes. Each mounts every node and every edge at all
times, which holds for a docs diagram and fails for a memory or knowledge map
with thousands of nodes. The maintainer's requirement is both scales, DOM
first, with DOM overlays carrying rich content at high zoom on the native
renderer too.

## Provenance

This is a clean reimplementation. The maintainer chose it on 2026-10-03.

- The camera descends from dagr's own `docs/src/components/GraphViewport/useGraphCamera.ts`.
- The shell is written new against this spec.
- `@mytraai/architecture-map` is a behavioral reference only. The behaviors
  this spec keeps are the ones its README documents. Its source was read once
  during design to understand those behaviors. No Mytra source is copied or
  adapted, and implementers work from this spec and dagr's own files without
  opening the Mytra repository.

## Package and entry points

`packages/explorer`, published as `@prnt/dagr-explorer`.

| Entry | Contents | Peers |
| --- | --- | --- |
| `@prnt/dagr-explorer` | headless core, parts, overlay, SVG base | `react`, `react-dom` `>=18.2.0 <20.0.0` |
| `@prnt/dagr-explorer/styles.css` | optional default theme | none |
| `@prnt/dagr-explorer/native` | native base over `DagrCanvas` | deferred, see Deferred |

Dependencies: `@prnt/dagr-graph`, `@prnt/dagr-layout`, `@prnt/dagr-render`.

It does not depend on `@prnt/dagr-react`. That package requires React 19, and
a dependency on it would fail installs on the React 18 sites the Mytra package
supports today.

`sideEffects` is `["*.css"]`. The JavaScript entry imports no CSS.

Its initial version is the workspace's version on the day M5.6b lands, so it
joins the lockstep the other packages keep.

### `@prnt/dagr-render/core`

`@prnt/dagr-render`'s index imports `three/webgpu` at module load through
`createRenderer`. A bundler drops it, because the package is side-effect free.
A server that externalizes dependencies does not, and would evaluate three in
Node to draw SVG.

So `@prnt/dagr-render` gains one additive subpath, `./core`, re-exporting what
the explorer needs and nothing that reaches `three`:

- `Camera2D`, `fitZoom`
- `shapeEdgePath`, `EdgePathOptions`
- the types those signatures name (`Camera2DInit`, `OrthoFrustum`, `Size`, `Vec2`, `ViewportSize`, `WorldBounds`)

No public name moves, and the index keeps exporting all of them. A test
loads the built `core` entry with `three` unresolvable and fails if anything
in its import graph asks for it.

The entry's declarations must not reach three's types either. `Vec2`,
`Size`, `WorldBounds`, `ViewportSize` and `OrthoFrustum` move from `types.ts`,
which names the scene types, into a leaf module with no imports, and
`types.ts` re-exports them. A second test type-checks a consumer of the built
entry with `skipLibCheck` off and no `@types/three` installed.

This adds one key to `exports` in an existing manifest. `AGENTS.md` reserves
publish configuration in existing manifests for the maintainer, so approving
this spec is the approval for that one addition, and the M5.6a pull request
calls it out.

`three` stays a required peer of `@prnt/dagr-render`, so it is still installed
beside the explorer and never bundled. Making it optional changes install
behavior for existing consumers, and that decision is the maintainer's.

## Data model

```ts
interface ExplorerNode {
  readonly id: string;
  readonly label: string;
  readonly size?: Size;
  /** Any CSS color. Used by the base layer's mark and published to node content. */
  readonly color?: string;
}

interface ExplorerEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly color?: string;
  readonly dash?: boolean;
}

interface ExplorerGroup {
  readonly id: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly color?: string;
}

interface ExplorerLayoutOptions<N extends ExplorerNode> {
  readonly direction?: 'right' | 'down';              // default 'right'
  readonly nodeSize?: Size | ((node: N) => Size);     // default 240 by 120
  readonly nodeSep?: number;                          // default 40
  readonly rankSep?: number;                          // default 120
  readonly edgeStyle?: 'smooth' | 'orthogonal';       // default 'smooth'
}

interface ExplorerView<N extends ExplorerNode, E extends ExplorerEdge> {
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode | undefined;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
  readonly groups?: readonly ExplorerGroup[];
  readonly layout?: ExplorerLayoutOptions<N>;
}
```

`N` and `E` carry the caller's own fields, and every slot receives them typed.

**Sizes are declared, never measured.** A virtualized node has no element to
measure. A node's size is `node.size`, else the view's `nodeSize`, else the
default. Content lays out inside its box.

**Direction is the explorer's.** `@prnt/dagr-layout` lays out top-down and has
no direction option. `'right'` transposes sizes going in and coordinates
coming out, once, in the layout module.

**Groups are annotations.** A group outline is computed from its members'
boxes after layout, with padding, and does not move any node. This matches
`@prnt/dagr-render`'s `NodeGroup`, hence `nodeIds`. Compound layout is M7.

**Parallel edges the router draws on one line bow apart.** Edges between the
same unordered pair of nodes share a line only when they span one rank. Those
are offset symmetrically about that line, so each is visible, and both ends
stay on their nodes. A pair that spans more ranks is left as the engine routed
it: each edge already runs through its own dummy nodes, a `nodeSep` apart, and
moving those would undo an ordering the engine chose.

**Self loops are kept and not drawn.** An edge whose source is its target
stays in the data and in the drawer's connections. It is left out of layout
and has an empty route, because the router gives it a zero-length line.
Drawing a loop is deferred.

**Layout is keyed on shape.** The key is node ids and resolved sizes, edge ids
and endpoints, group ids and membership, and the layout options. Data
re-created on every render with the same shape keeps its layout and its
camera. A label or color change never relayouts.

**A layout is three maps and a size.** `layoutView` returns `boxes` (a box
per node), `routes` (a route per edge) and `groups` (a rectangle per group),
each a map keyed by id in the order the view lists them, plus the plane's
`width` and `height`.

**World space** is y-down CSS pixels at zoom 1, with the content's top-left
padded off the origin.

**The layout's spacing constants and its shape key are internal.** The padding
off the origin, the group padding and label band, and the gap between parallel
edges are fixed values today. Exporting them would make a change to any one a
silent behavior break, and would stand in the way of turning them into options.
The default node size and the default `nodeSep` and `rankSep` are public,
because a caller overriding one wants to name the other.

## Composition

### Parts

| Export | Role |
| --- | --- |
| `DagrExplorer` | preassembled layout, composed only from the parts below |
| `ExplorerRoot` | provider: data, validation, layout, state |
| `ExplorerViews` | view switcher. Renders nothing for a single view |
| `ExplorerSearch` | input, match count, result list |
| `ExplorerViewport` | graph surface: base layer, overlay, camera, gestures |
| `ExplorerDetails` | drawer: close button, scroll region, focus restoration |
| `ExplorerToolbar` | zoom out, zoom readout, zoom in, fit, zoom to selected |
| `ExplorerTraceToggle` | trace on and off |
| `useExplorer<N, E>()` | everything the built-in parts read and call |

Named exports, not properties of `DagrExplorer`. They tree-shake, and they
survive a server-component boundary.

`DagrExplorer` uses no private access. Anything it does, a host can do with
the parts.

One `ExplorerViewport` per `ExplorerRoot`. A second throws `ExplorerContextError`.
The viewport registers with its root in an effect, with cleanup, and the
second registration is what throws. Counting viewports during render would
misfire under StrictMode's double render, and when Suspense or Activity keeps
an old tree alive beside a new one.

**The type parameters on a part are a claim, not a check.** `DagrExplorer`
infers `N` and `E` from `views` and types its slots from them. The parts talk
through a context, and a context erases type parameters, so
`<ExplorerViewport<MyNode> renderNode={...} />` asserts the node type and
nothing verifies it against the root's `views`. A mismatch compiles and fails
at runtime. Every part and `useExplorer<N, E>()` default to
`N = ExplorerNode` and `E = ExplorerEdge`, so an unannotated part sees only
the fields the explorer itself guarantees. A `createExplorer<N, E>()` that
returns parts already bound to the types can close this later without a
break. It is deferred until a host asks for it.

### `ExplorerRoot` props

- `label: string`, required: the accessible name the parts derive theirs from.
- Data, exactly one of two shapes. Each shape types the other's props as
  `never`, so passing both is a compile error and not a silent precedence rule:
  - `views: readonly ExplorerView<N, E>[]`
  - `nodes`, `edges`, optional `groups` and `layout`: the single-graph
    shorthand. It is one view whose `id` is `'default'` and whose `label` is
    the root's `label`. That view is what `onViewChange` and
    `selectOnViewChange` see.
- `viewId`, `defaultViewId`, `onViewChange`: controllable.
- `selectedId`, `defaultSelectedId`, `onSelectedChange`: controllable.
  `defaultSelectedId` is a node id or `null`, read once at mount, as every
  React `default*` prop is.
- `selectOnViewChange?: (view: ExplorerView<N, E>) => string | null`: which
  node to select when a view becomes active by a switch. Without it, a view
  switch clears the selection.
- `searchText?: (node: N) => string`, default `id` and `label`.
- `strictGroups?: boolean`, default `false`.
- `labels?: Partial<ExplorerLabels>`.
- `apiRef?: Ref<ExplorerApi>`, named as `DagrCanvas` names its own.
- `className`, `style`, `children`.

### State

`viewId` and `selectedId` are controllable because they are what a host syncs
to a URL. Query, trace, drawer open, and camera are internal, and reachable
through `useExplorer()` and `apiRef`.

Selection defaults to none. `selectedId` is the current node. The drawer being
open is separate state. `inspect(id)` selects and opens the drawer.

A background click focuses the graph and does not change selection. Clearing
on a background click would close the drawer every time a reader clicked the
diagram to enable wheel zoom.

Changing view resets query, trace, drawer, and camera, and sets selection to
what `selectOnViewChange` returns for the new view, or to none. A removed view
is forgotten, so it is not reselected if it returns.

If the selected node leaves the data, selection clears, the drawer closes, and
focus is restored as described under Drawer.

**A controlled value is the owner's, and the explorer never renders past it.**
Three changes start inside the explorer: a view switch reselecting, the
selected node leaving the data, and the active view being removed. Under a
controlled `selectedId` or `viewId`, each of them calls `onSelectedChange` or
`onViewChange` with the new value and changes nothing on screen until the prop
changes. The same holds for a click, a search pick, and every `ExplorerApi`
call.

A controlled value the data does not contain renders as its fallback: an
unknown `selectedId` renders as no selection with the drawer closed, and an
unknown `viewId` renders the first view. The explorer does not call back to
correct it. The owner holds the value, and a callback fired from render to
fix the owner's own prop is how update loops start.

```ts
interface ExplorerApi {
  fit(): void;
  zoomBy(factor: number): void;
  focusNode(id: string): void;   // camera flight to fit the node
  reveal(id: string): void;      // minimum pan at the current zoom
  select(id: string | null): void;
  inspect(id: string): void;
  closeDetails(): void;
  selectView(id: string): void;
  setQuery(query: string): void;
  setTrace(on: boolean): void;
}
```

`useExplorer()` returns the current state and these same methods, so a custom
part and a host holding `apiRef` can do exactly the same things.

Camera calls before the viewport mounts are no-ops.

### Slots

- `ExplorerViewport`: `renderNode(node, { tier, selected, dimmed })`. The
  content sits inside the explorer's own node button and must not be interactive.
- `ExplorerDetails`: children as `({ node, connections, inspect }) => ReactNode`,
  and `renderConnection(edge, otherNode)` for the default connection list.
- `ExplorerViews`: children as `({ views, activeView, selectView }) => ReactNode`.
- `DagrExplorer` forwards these as `renderNode`, `renderDetails`,
  `renderConnection`, and `renderViews`.

Defaults exist for all of them and use only `label`.

### Labels

`ExplorerLabels` is one object of strings and formatters with neutral English
defaults: search field label and placeholder, `matches(count)`,
`stats({ nodes, edges })`, show and hide details, trace on and off, zoom
controls, fit, `zoomTo(label)`, empty view, no views, drawer title, close, and
the interaction hint. No part hardcodes copy.

### Styling

Styles the explorer needs to function are inline: the viewport clips and
positions, the plane transforms, nodes are absolutely positioned. It works
with no stylesheet.

The viewport's height is `var(--dagr-explorer-height, 480px)`. It never
changes with the camera or the drawer.

Every part carries a stable hook, `data-dagr-explorer="search"` and so on, and
state hooks such as `data-tier`, `data-selected`, `data-dimmed`, and
`data-dragging`.

`styles.css` is the optional default look, written against those hooks and
these variables: `--dagr-explorer-accent`, `--dagr-explorer-fg`,
`--dagr-explorer-fg-muted`, `--dagr-explorer-border`, `--dagr-explorer-bg`,
`--dagr-explorer-bg-subtle`, `--dagr-explorer-focus`, `--dagr-explorer-font-mono`.
It names no host framework. Mapping Docusaurus tokens onto them is a wrapper's job.

Vector content is never forced onto a composited layer. A cached raster of
text enlarged by the camera goes blurry at high zoom.

## Tiers and virtualization

```
ExplorerViewport
  base layer     swappable   every node as a mark, edges, group outlines
  overlay layer  shared      renderNode output for nodes worth reading, capped
```

### Tiers

A node's tier comes from its width on screen in CSS pixels, with half-open
gates, the rule `@prnt/dagr-render`'s rich nodes use. It is per node, so a
large node becomes readable before a small one.

| Tier | Gate | DOM |
| --- | --- | --- |
| `mark` | width below `summary` | none. The base layer draws the node |
| `summary` | `summary` to below `rich` | overlay element, `tier: 'summary'` |
| `rich` | `rich` and above | overlay element, `tier: 'rich'` |

`tiers?: { summary: number; rich: number }` on `ExplorerViewport`, default
`{ summary: 56, rich: 200 }`. If browser validation in M5.6f shows those
defaults misfire on the demo graphs, they change in that pull request and the
change is recorded there.

The plane publishes `--dagr-explorer-inv-zoom`, the reciprocal of the zoom, so
summary content can counter-scale to a constant size. It is written only when
the zoom changes.

### The visible set

On every camera frame a pure function computes:

- **Overlay nodes:** nodes whose box intersects the viewport expanded by 25%
  of its width and height on each side, and whose tier is `summary` or `rich`.
- **Cap:** at most `maxOverlayNodes`, default 200, nearest the viewport center
  first, ties broken by id. Nodes past the cap stay marks.
- **Pins:** the selected node and the keyboard tab target are always overlay
  nodes, exempt from the cap, and render at least as `summary`.
- **Base nodes and edges:** nodes that intersect the expanded viewport and are
  not overlay nodes, and edges whose route bounds intersect it.

The function allocates nothing on a frame where the result is unchanged.

**React renders only when membership or a tier changes.** The camera writes
one transform on the plane per frame. A node element is positioned in world
coordinates when it mounts and is not written again. A pan inside the overscan
margin is one style write and no React work.

**The scan is linear on purpose.** Testing 10,000 boxes costs tens of
microseconds. `@prnt/dagr-render`'s overlay scans the same way and names a
spatial index as the fix if a measurement asks for one. The M5.6f bench is
that measurement.

Pointer handling uses delegated listeners on the viewport. A click on a mark
resolves through a point-to-node lookup against the layout, last-drawn node
first. No tier attaches per-node listeners. There is no hover state of the
explorer's own: `:hover` on a mounted element is the host's CSS.

Trace dims every node and edge not adjacent to the selected node. A non-empty
query dims every node that does not match. Both set `data-dimmed` on mounted
elements and base marks. Nothing remounts. With no selection, trace dims nothing.

### The base-layer seam

```ts
interface ExplorerBaseProps {
  readonly layout: ExplorerLayout;      // boxes, routes, group rects, bounds
  readonly visible: ExplorerVisibleSet; // base nodes and edges in view
  readonly emphasis: ExplorerEmphasis;  // selected, dimmed
  readonly camera: ExplorerCameraSource; // current value and a frame subscription
}
interface ExplorerBase {
  readonly Layer: ComponentType<ExplorerBaseProps>;
  /** Whether Layer renders inside the transformed plane or handles the camera itself. */
  readonly space: 'plane' | 'viewport';
}
```

`ExplorerViewport` takes `base?: ExplorerBase`, default the SVG base.

The SVG base has `space: 'plane'`. It renders one `<rect>` per base node, one
`<path>` per visible edge with an arrowhead marker and optional dash, and each
group's outline and label. It sits inside the transformed plane, so camera
frames cost it nothing, and it re-renders only when the visible set or
emphasis changes.

**Culling does not help at fit zoom,** where everything is in view. There the
SVG base costs one element per node and per edge, static while panning. That
has a ceiling. M5.6f measures it on a named machine and the guide states the
number. Above it the answer is the native base.

**A seam with one implementation is a guess.** `ExplorerBase` is shaped on
`docs/src/components/GraphViewport/RendererAdapter.tsx`, which already drives
a native camera from a DOM camera. Its types are exported and documented as
experimental until the native base lands and confirms or corrects them.

## Camera and pointer

The camera is a port of dagr's docs `useGraphCamera`. `Camera2D` supplies zoom
and pan limits from the content bounds and node boxes. One
`requestAnimationFrame` loop eases toward the latest input and stops when
settled. Under `prefers-reduced-motion` changes apply immediately. A resize refits.

Pointer behavior is the documented behavior of the three existing copies:

- Wheel zooms only while focus is inside the graph, anchored at the pointer.
- `Ctrl` and `Command` wheel stay the browser's zoom. `Shift` wheel pans
  horizontally. Unfocused wheel input scrolls the page.
- On touch, the first tap focuses the graph, and swipes scroll the page until
  then. The viewport sets `touch-action: none` only while it holds focus, so
  an unfocused graph never traps a page scroll.
- A drag pans after 5 CSS pixels and suppresses the click that would follow.
  Pointer capture starts at the threshold, so a tap keeps its target.
- A click on a node or a mark inspects it. A double click flies the camera to it.

Gesture handling lives in the explorer's camera hook. `@prnt/dagr-react`'s
`useGraphInteraction` is the natural owner and cannot be one here, because its
package requires React 19. See Deferred.

## Keyboard and accessibility

Every existing copy mounts each node as a button, so Tab visits all of them.
Virtualization ends that: a mark has no element to focus. This is the one
deliberate behavior change in the spec.

**The graph is one tab stop.** Nodes use a roving `tabIndex`. The tab target is
the selected node, else the last focused node, else the node nearest the
viewport center. It is pinned, so it is always mounted. The viewport surface
itself is focusable by click and is not in the tab order.

**While a node is focused:**

- Arrow keys move focus to the nearest node in that direction. Candidates are
  nodes whose center lies in the arrow's half-plane from the focused node's
  center. The score is distance along the arrow's axis plus twice the distance
  across it, lowest wins, ties broken by id. No candidate is a no-op. The
  search covers every node in the view, mounted or not. The target is pinned,
  mounted, focused, then revealed.
- `Shift` with an arrow pans.
- `Enter` and `Space` inspect.

**While the surface is focused,** arrows pan.

**In both cases** `+` and `=` zoom in, `-` zooms out, `0` fits, and `Escape`
releases graph focus. Keys typed in an input are ignored.

**Keyboard focus reveals by panning at the current zoom.** `reveal` moves the
camera the minimum distance that brings the node's box 12 CSS pixels inside
the viewport, or centers it if it is larger than the viewport. Zooming on each
arrow press would be disorienting. Zoom to a node stays on search pick, double
click, and the toolbar.

Following an edge needs no key of its own. The drawer's connection buttons
inspect the adjacent node.

**Screen readers.** Unmounted nodes are not in the accessibility tree, and
there is no hidden list of every node, because 5,000 hidden buttons would undo
the virtualization. Search is the complete path: it reaches every node
whatever is mounted, and the graph's accessible description says so and gives
the node and edge counts.

A node's accessible name is its `label` followed by its groups ("in Trust
boundary"). `nodeAriaLabel?: (node, { groups }) => string` on
`ExplorerViewport` replaces it.

Two live regions: the match count, and the inspected node's label when the
drawer opens.

## Search

Tokens are the query split on whitespace and lowercased. A node matches when
every token appears in its `searchText`. An empty query matches nothing and
dims nothing.

`Enter` in the field inspects the first match and flies the camera to it.
`Escape` clears the query. Choosing a result does the same as `Enter` for that
result. The result list stays mounted while a node is inspected, so its scroll
position survives.

## Drawer

- An overlay at every width. Opening it never resizes the graph.
- The body is a keyboard scroll stop and scrolls to the top when the inspected
  node changes.
- `Escape` closes the drawer and returns focus to whatever opened it. If that
  element is gone, focus goes to the search input.
- `Escape` precedence: in the search field with the drawer open, the first
  press closes the drawer and the second clears the query. Inside the graph,
  it closes the drawer and releases graph focus without restoring focus into
  the graph, which would silently re-enable wheel zoom.
- Connection buttons inspect the adjacent node and keep the original opener.

## Server rendering

Layout is pure, so the server renders the shell and the base layer. The camera
and the overlay start at hydration, when the viewport has a size. The plane is
hidden until the first fit so no unscaled frame is painted. The viewport's
height is fixed, so nothing shifts.

## Errors

`ExplorerDataError` carries a `code`, the `id` of what it is about (a view,
node, edge or group), and the `viewId` it was found in, which is absent when
the error is about a view itself. A host can highlight the offender without
parsing the message, which names both as well.

Codes are UPPER_SNAKE and their type is `DagrExplorerErrorCode`, as in every
sibling package:

| Code | When |
| --- | --- |
| `INVALID_ID` | a view, node, edge or group has an empty id |
| `DUPLICATE_VIEW_ID` | two views share an id |
| `DUPLICATE_NODE_ID` | two nodes in one view share an id |
| `DUPLICATE_EDGE_ID` | two edges in one view share an id |
| `DUPLICATE_GROUP_ID` | two groups in one view share an id |
| `INVALID_NODE_SIZE` | a node's resolved width or height is not finite and greater than zero |
| `INVALID_LAYOUT_OPTION` | a view's layout spacing is not finite and zero or greater, or its `direction` or `edgeStyle` is not an allowed value |
| `MISSING_EDGE_ENDPOINT` | an edge names a node its view lacks |
| `MISSING_GROUP_MEMBER` | a group names a node its view lacks |
| `EMPTY_GROUP` | a group has no members |
| `GROUP_ENCLOSES_NON_MEMBER` | `strictGroups` only: an outline overlaps a non-member's box |

They are thrown during render, so an error boundary catches them.

`ExplorerContextError` is thrown by a part outside `ExplorerRoot`, with code
`OUTSIDE_EXPLORER`, and by a second `ExplorerViewport`, with code
`SECOND_VIEWPORT`.

A view with no nodes renders `labels.emptyView`. No views renders `labels.noViews`.
Neither is an error.

## Tests

Test first, per the charter.

**Pure core, in Node:**

- validation: every error code, and the absence of one for valid data;
- layout: both directions, declared and default sizes, parallel-edge bowing,
  group rectangles, strict groups, shape-key stability across re-created data;
- search: tokens, the accessor, the empty query;
- visible set: culling, both gates, cap order, pins, unchanged membership
  across a pan inside the overscan margin;
- spatial navigation: each direction, ties, no candidate;
- camera arithmetic: fit, anchored zoom, limits, reveal.

**Components, vitest with jsdom, on React 18 and React 19:**

- the parts composed without `DagrExplorer`;
- controlled and uncontrolled view and selection;
- mounting follows the visible set, and stays under the cap;
- drawer focus restoration and `Escape` precedence;
- roving `tabIndex` and arrow navigation onto an unmounted node;
- `labels`, and slot types inferred from `views`.

The React 18 run uses aliased `react@18` and `react-dom@18` installs. The
package claims both majors, so the gate runs both.

**Guards:**

- `renderToString` succeeds with no DOM globals;
- importing the built entry in Node with `three` unresolvable succeeds;
- the same for `@prnt/dagr-render/core`.

**Packaging gate:** the explorer is the seventh tarball it packs and inspects,
from M5.6b on and while the package is still private, so a broken `exports`
map is found on the day it is written. The packed-consumer type check compiles
against `@types/react` 18 and 19.

**Bench:** visible-set computation at 1,000 and 10,000 nodes, and layout at
1,000. New entries report as `new`. Recording them in `bench/baseline.json` is
the maintainer's call, per `bench/README.md`.

**Browser validation,** in Chromium and WebKit at desktop width and 390 CSS
pixels, on the docs demo: focus-gated wheel zoom, first-tap touch, drag,
keyboard navigation, drawer, reduced motion, and the mounted node count
staying under the cap while panning a 2,000 node graph. Screenshots and a
report are shared. This repo has no browser runner on CI and this spec adds none.

## Docs

Docs land with the feature:

- `docs/docs/explorer.md`: guide, the parts, theming, the tier and
  virtualization model, the measured SVG ceiling;
- API reference for the package;
- a docs demo with an architecture-style graph and a 2,000 node synthetic graph;
- package `README.md` and `CHANGELOG.md`;
- `ROADMAP.md`: M5.6 and its slices.

## Increments

One pull request per slice, each through the full local gate and both reviews.

| Slice | Contents |
| --- | --- |
| M5.6a | `@prnt/dagr-render/core` and its no-three guard |
| M5.6b | package scaffold, types, validation, layout, search |
| M5.6c | camera, viewport, SVG base, visible set, overlay tiers, pins |
| M5.6d | root state, remaining parts, `labels`, `DagrExplorer`, `styles.css` |
| M5.6e | roving focus, spatial navigation, reveal, server rendering |
| M5.6f | docs, demos, bench, browser validation, measured ceiling |

## Release posture

The package is `"private": true` through M5.6e, so a lockstep release cannot
ship it half-built. M5.6f removes the flag. That edit is publish configuration
in an existing manifest, which `AGENTS.md` reserves for the maintainer, so
approving this spec is the approval for that one edit, and the M5.6f pull
request calls it out. Publishing is the maintainer's, as it always is.

It does not join the `@prnt/dagr` umbrella. The umbrella requires React 19 and
`three`, which contradicts the explorer's React 18 support. That is a
release-time decision for the maintainer.

## Deferred

Each of these is its own spec and plan.

- **Docs migration.** Move `SystemAtlas` and the docs `GraphViewport` onto the
  explorer. It is the second consumer, and it retires two of the three copies.
  Unblocked by M5.6f.
- **Native base,** `@prnt/dagr-explorer/native`. `DagrCanvas` draws marks and
  edges, and the overlay in this spec mounts the same `renderNode` output on
  top. Optional peers `@prnt/dagr-react`, `three`, React 19. Unblocked by
  M5.6c, and it settles the `ExplorerBase` types.
- **Mytra wrapper.** `@mytraai/architecture-map` becomes `DagrExplorer` plus
  its node schema, copy, `strictGroups`, and a stylesheet mapping
  `--dagr-explorer-*` to its host's tokens. Unblocked by a publish.
- **Shared gesture machine.** Move the framework-free pointer machine to where
  both `@prnt/dagr-react` and the explorer can use it. Until then the gesture
  logic exists in both.
- **Animated relayout** through `createLayout` deltas, **ports,** and **edge
  hit targets.** M6.3a owns port hits.
- **Self-loop drawing.** A loop needs a route the router does not produce.
- **A spatial index** for the visible set, if the M5.6f bench asks for one.
- **`createExplorer<N, E>()`,** parts bound to the node and edge types, if a
  host composing by hand asks for the check the context cannot give.

## Amendments

Changes made after the maintainer approved the written spec on 2026-10-03, in
the order they were made. Each is in the text above. This list is so a reader
can see what moved without diffing.

1. **`INVALID_NODE_SIZE`.** Found while measuring the layout engine for the
   M5.6b plan: it accepts a zero-size node and reports `NaN` as a fault in its
   own config. Approved by the maintainer with the plans.
2. **Self loops are kept and not drawn.** Found the same way: the router gives
   one a zero-length line. Approved by the maintainer with the plans.
3. **The core entry's declarations must not reach three's types.** Found by
   the whole-branch review of M5.6a. The geometry types moved to a leaf
   module, and "nothing existing moves" became "no public name moves".
4. **Error codes are UPPER_SNAKE, typed `DagrExplorerErrorCode`, and the error
   carries `id` and `viewId`.** Found by the API design review: every sibling
   package uses UPPER_SNAKE codes and the graph's errors expose the offending
   id. Renaming codes after a release is a break.
5. **Controlled selection and view semantics are stated,** and
   `defaultSelectedId` is a true default, read once at mount.
   `selectOnViewChange` is the new prop for reselecting on a view switch. API
   design review: the spec did not say what a controlled value does when the
   explorer itself wants to change it, and a `default*` prop that re-evaluates
   is not what React users expect.
6. **The data props are a union with `never` guards,** and the shorthand's
   view has a defined id and label. API design review.
7. **`ExplorerApi` gains `selectView`, `setQuery` and `setTrace`,** and the
   second-viewport error is raised from a registration effect. API design
   review: the State section already promised the first three through
   `apiRef`, and counting viewports in render misfires under StrictMode.
8. **Type parameters on hand-composed parts are documented as unchecked,**
   with defaults and a deferred `createExplorer<N, E>()`. API design review.
9. **The layout's fixed spacing constants and its shape key are internal.**
   API design review: a public constant cannot change value or become an
   option without a break.

10. **Only parallel edges the router draws on one line are separated.**
    Found by the algorithms review of M5.6b, and checked against the router's
    own contract in `packages/layout/src/route.ts`: a parallel pair spanning
    more than one rank is already apart. The spec had said every parallel pair
    bows.

11. **`INVALID_LAYOUT_OPTION`.** Found by the API design review of M5.6b as
    built: a bad `nodeSep`, `rankSep`, `direction` or `edgeStyle` escaped as
    the layout engine's or the renderer's own error, with no view id. The
    explorer now rejects them itself.
12. **A layout's group rectangles are a map keyed by group id,** like its
    boxes and routes. Same review: a consumer looked a group up with `find`.
13. **`INVALID_ID`.** Found by the whole-branch review of M5.6b: an empty id
    passed validation and then failed in the graph package with its own error.

Amendments 3 to 13 were made by the agent executing the plans and have not
been separately approved. 3 to 9 rode in the M5.6a pull request and 10 to 13
ride in the M5.6b one, for the maintainer to accept or reverse.
