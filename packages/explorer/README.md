# @prnt/dagr-explorer

An interactive graph explorer for [Dagr](https://dagr.prnt.design): views,
search, connection tracing, groups and a details drawer, with node content
virtualized by on-screen size.

## Read this first: it is not published yet

The package is built in slices, M5.6a to M5.6f in `ROADMAP.md`, and stays
`"private": true` until the last. Today it has the headless core, the
React parts below, keyboard navigation and server rendering. Docs, demos
and browser validation arrive in M5.6f.

It runs on React 18 and React 19 (`react` and `react-dom` `>=18.2.0 <20.0.0`).

## The explorer

```tsx
import { DagrExplorer } from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css'; // optional

<DagrExplorer
  label="Architecture"
  views={[
    {
      id: 'overview',
      label: 'Overview',
      nodes: [
        { id: 'app', label: 'Application', team: 'web' },
        { id: 'store', label: 'Store', team: 'data' },
      ],
      edges: [{ id: 'read', source: 'app', target: 'store' }],
    },
  ]}
  renderNode={(node) => `${node.label} (${node.team})`}
/>;
```

`label` is required: it is the accessible name of the graph, and the parts
derive theirs from it. For one graph, pass `nodes`, `edges` and optionally
`groups` and `layout` instead of `views`. That is one view with the id
`'default'` and `label` as its label. Passing both shapes is a type error.

The node type is inferred from your data, so `renderNode` above sees `team`.
`DagrExplorer` takes the root's props (below) plus `renderNode`,
`renderDetails`, `renderConnection`, `renderViews`, `tiers`,
`maxOverlayNodes`, `base` and `nodeAriaLabel`, which it forwards to the parts.

### The parts

`DagrExplorer` is built only from these, with no private access, so a host
that owns its layout can rebuild it, or arrange them differently:

```tsx
import {
  ExplorerDetails,
  ExplorerRoot,
  ExplorerSearch,
  ExplorerToolbar,
  ExplorerViewport,
  type ExplorerNode,
  type ExplorerView,
} from '@prnt/dagr-explorer';

interface MyNode extends ExplorerNode {
  readonly title: string;
}

const views: ExplorerView<MyNode>[] = [
  {
    id: 'overview',
    label: 'Overview',
    nodes: [
      { id: 'app', label: 'Application', title: 'App' },
      { id: 'store', label: 'Store', title: 'Store' },
    ],
    edges: [{ id: 'read', source: 'app', target: 'store' }],
  },
];

export function Architecture() {
  return (
    <ExplorerRoot label="Architecture" views={views}>
      <ExplorerSearch />
      <ExplorerViewport<MyNode> renderNode={(node) => node.title}>
        <ExplorerDetails />
      </ExplorerViewport>
      <ExplorerToolbar />
    </ExplorerRoot>
  );
}
```

| Part | Owns |
| --- | --- |
| `ExplorerRoot` | the data, its validation and layout, and the state below. Renders one element around its children |
| `ExplorerViews` | the view switcher. Renders nothing for a single view. Children `({ views, activeView, selectView })` replace it |
| `ExplorerSearch` | the search field, a live match count, and the matches as buttons, at most `maxResults` (default 50) |
| `ExplorerTraceToggle` | trace on and off |
| `ExplorerViewport` | the graph: pan and zoom, the SVG base, node elements for nodes large enough to read. Takes `renderNode`, `nodeAriaLabel`, `tiers`, `maxOverlayNodes`, `base`. Its children, such as `ExplorerDetails`, share a positioned stage with the graph, and the graph's hint comes after the stage, where an overlay cannot cover it |
| `ExplorerDetails` | the drawer: an overlay with a close button and a scrolling body. Children `({ node, connections, inspect })` replace the body, and `renderConnection(edge, otherNode)` draws one connection in the default body |
| `ExplorerToolbar` | zoom out, the zoom readout, zoom in, fit, and zoom to the selected node |

Every part takes `className` and `style`, and your `style` wins over the
part's own: `<ExplorerViewport style={{ height: 600 }} />` sets the graph's
height, which is otherwise `--dagr-explorer-height`. The one exception is
the viewport's `position` and `overflow`: they stay the viewport's own
(`relative` and `hidden`), because the graph's nodes are positioned against
it and clipped by it.

One `ExplorerViewport` per root: a second throws `ExplorerContextError` with
the code `SECOND_VIEWPORT`. A part outside a root throws it with
`OUTSIDE_EXPLORER`, naming the part.

**A part's type parameters are a claim, not a check.** The parts talk through
a context, which erases them, so `ExplorerViewport<MyNode>` asserts the node
type and nothing verifies it against the root's data. Unannotated, a part
sees only `id` and `label`. `DagrExplorer` has no such gap: it infers the
types from `views`.

### The root's props and state

`viewId` and `selectedId` are controllable (with `defaultViewId`,
`defaultSelectedId`, `onViewChange` and `onSelectedChange`), because they are
what a host syncs to a URL. Under a controlled value, every change the
explorer starts calls the callback and changes nothing on screen until the
prop does. A controlled id the data lacks renders as no selection, or as the
first view, with no corrective callback.

The query, trace, the drawer and the camera are internal. Changing view
resets all four, and sets the selection to what `selectOnViewChange(view)`
returns, or clears it. If the selected node leaves the data, the selection
clears and the drawer closes.

The other props: `searchText` (what search reads from a node, default the id
and label), `strictGroups`, `labels`, `apiRef`, `className` and `style`.

### `useExplorer`, `useExplorerApi` and `apiRef`

`useExplorer()` returns the explorer's state (`views`, `activeView`,
`layout`, `selectedId`, `selectedNode`, `query`, `matches`, `trace`,
`detailsOpen`, `dimmed`, `labels`, and `camera` for a readout of your own) and
the same methods `apiRef` hands out. It re-renders its caller on every change
of state.

`useExplorerApi()` returns the methods alone, the same stable functions, and
never re-renders its caller: use it in a component that only calls them, such
as a button of your own. Called twice in one tick, the methods see each other,
so `select('a'); select(null)` ends with nothing selected.

| Method | Does |
| --- | --- |
| `fit()`, `zoomBy(factor)` | the camera. No-ops before the viewport has a size |
| `focusNode(id)` | flies the camera to fit the node |
| `reveal(id)` | pans the least distance that brings the node into view |
| `select(id \| null)` | sets the current node, without opening the drawer |
| `inspect(id, trigger?)` | selects and opens the drawer. Focus returns to `trigger` when it closes |
| `closeDetails()` | closes the drawer |
| `selectView(id)` | switches view |
| `setQuery(query)`, `setTrace(on)` | search and trace |

### Search, drawer and Escape

Search matches nodes whose text contains every whitespace-separated token,
case ignored. `Enter` inspects the first match and flies to it, and choosing a
result does the same. The result list stays mounted while a node is
inspected. Search is the complete way to every node: a node too small on
screen to read has no element, and the graph's accessible description says
so. The list shows the first `maxResults` matches in data order, then a line
saying how many more there are. The count and `Enter` cover every match, and
a longer query narrows the list.

When the drawer closes with focus inside it, focus returns to what opened
it, or to the search field if that element is gone, or to the root element
if there is no search field. A control of yours that closes the drawer keeps
its focus. A connection button in the drawer inspects its neighbor and keeps
the original opener. `Escape` closes the drawer from anywhere in the root,
with two exceptions that keep their own order. In the search field it closes
the drawer first and clears the query second. Inside the graph it closes the
drawer and releases graph focus, without moving focus back into the graph,
which would re-enable wheel zoom. A control of yours that handles `Escape`
and calls `preventDefault()` keeps it.

### Keyboard

The graph is one tab stop. Exactly one node is in the tab order: the
selected node, else the last node you focused from the keyboard, else the
node nearest the center of the view. That node always has an element, at
any zoom, so once the graph is on screen Tab always lands on a node. Tab
again leaves the graph. The
graph's surface takes focus when you click it, and is not in the tab order.

With a node focused:

| Key | Does |
| --- | --- |
| Arrow keys | move focus to the nearest node in that direction, on screen or not |
| `Shift` with an arrow | pans |
| `Enter`, `Space` | inspect the node |

With the surface focused, the arrow keys pan. In both cases `+` and `=` zoom
in, `-` zooms out, `0` fits, and `Escape` leaves the graph (and closes the
drawer). A key with `Ctrl`, `Command` or `Alt` is left to the browser.

A node that takes focus from the keyboard is brought into view by the
least pan, at the current zoom. A node you click is not moved to.

Only the nodes on screen and large enough to read have elements, so a
screen reader finds only those in the graph. Search is the way to every
node: it reaches all of them whatever is on screen, and the graph's
accessible description says so and gives the node and edge counts.

The node in the tab order, the focused node and the selected node are
mounted outside `maxOverlayNodes`, so the page can hold a few more node
elements than the cap.

### Server rendering

Every part renders on a server, with no DOM: layout is pure, so the HTML
carries the shell and the base layer, every node as a mark and every routed
edge. The camera and the node elements start on the client, once the
viewport is measured. Until then the plane is hidden, so no unscaled frame
is painted, and the graph has no tab stop. The viewport's height is fixed by
`--dagr-explorer-height` (or your `style`), so nothing shifts when it fits.
A data error throws `ExplorerDataError` on the server as it does on the
client.

### Labels

Every string the parts show comes from `labels`, an `ExplorerLabels` object
whose neutral English defaults are `DEFAULT_EXPLORER_LABELS`. Pass any subset
to `ExplorerRoot` or `DagrExplorer`. Counts and names are formatters, such as
`matches(count)`, `moreMatches(count)` (the matches the capped list does not
show), `stats({ nodes, edges })`, `zoomLevel(percent)`, `zoomTo(label)` and
`inGroup(groupLabel)` (one group in a node's default accessible name, as in
"Store, in Data tier").

An inline object is fine: `labels={{ search: 'Find' }}` is kept by value,
so re-creating it on every render with the same contents changes nothing.
An inline formatter is a new function each time, and so a change; define it
outside the component to keep it stable.

### Styling

The parts work with no stylesheet: what they need to function is inline. Each
carries a `data-dagr-explorer` hook (`root`, `views`, `search`, `trace`,
`viewport`, `node`, `details`, `toolbar` and others), and state hooks
`data-tier`, `data-selected`, `data-dimmed`, `data-dragging` and
`data-active`. Nothing names a host framework.

`@prnt/dagr-explorer/styles.css` is the optional default look, for a light
page. No module imports it. It reads these variables, which you set anywhere
above the explorer:

| Variable | For |
| --- | --- |
| `--dagr-explorer-accent` | selection and pressed controls |
| `--dagr-explorer-fg` | text |
| `--dagr-explorer-fg-muted` | secondary text, marks and edges |
| `--dagr-explorer-border` | borders |
| `--dagr-explorer-bg` | nodes, controls and the drawer |
| `--dagr-explorer-bg-subtle` | the graph's background, hover |
| `--dagr-explorer-focus` | focus rings |
| `--dagr-explorer-font-mono` | the zoom readout |

Its selectors are wrapped in `:where()`, so they have no specificity and any
rule of yours wins. The exceptions are the `:hover`, `:focus` and
`:focus-visible` rules, whose pseudo-class sits outside the `:where()`: each
weighs as one class, so override it with a class that comes later or with a
more specific selector.
`--dagr-explorer-height` sets the graph's height, 480px by default, with or
without the stylesheet.

### The base layer is experimental

Nodes too small to read, edges and group outlines are drawn by a base layer,
SVG by default. `ExplorerViewport`'s `base` swaps it, through the
`ExplorerBase`, `ExplorerBaseProps`, `ExplorerCameraSource`,
`ExplorerEmphasis` and `ExplorerVisibleSet` types. They are exported and
experimental: a seam with one implementation is a guess, and they may change
when a native base over `DagrCanvas` lands and confirms or corrects them.
`ExplorerCamera` (`{ x, y, scale }`), what `camera.get()` returns, is
exported as a type too.

## The core

```ts
import { layoutView, searchNodes } from '@prnt/dagr-explorer';
import type { ExplorerView } from '@prnt/dagr-explorer';

const view: ExplorerView = {
  id: 'overview',
  label: 'Overview',
  nodes: [
    { id: 'app', label: 'Application' },
    { id: 'store', label: 'Store' },
  ],
  edges: [{ id: 'read', source: 'app', target: 'store' }],
};

const layout = layoutView(view);
layout.boxes.get('app'); // { x: 40, y: 40, width: 240, height: 120 }
layout.routes.get('read'); // [{ x: 280, y: 100 }, { x: 400, y: 100 }]

searchNodes(view.nodes, 'sto'); // [{ id: 'store', label: 'Store' }]
```

These functions touch no DOM and render nothing, so they run on a server.

## A node is an id and a label

Those two fields are all the explorer reads. Everything else about a node is
your own fields on a type that extends `ExplorerNode`, and that type flows
through to every function and every slot.

## Sizes are declared, never measured

A node's size is its own `size`, else the view's `layout.nodeSize` (a value or
a function of the node), else 240 by 120. The explorer virtualizes node
content, and a node with no element cannot be measured.

A width or height that is not finite and greater than zero throws
`INVALID_NODE_SIZE`, naming the node.

## Layout

`layoutView(view, options)` returns boxes, routes and group rectangles in world
space: y-down CSS pixels at zoom 1, padded 40 off the origin.

| `view.layout` | Default | |
| --- | --- | --- |
| `direction` | `'right'` | or `'down'` |
| `nodeSize` | 240 by 120 | a size, or a function of the node |
| `nodeSep` | 40 | gap between neighbors across the flow |
| `rankSep` | 120 | gap between ranks along the flow |
| `edgeStyle` | `'smooth'` | or `'orthogonal'` |

Three behaviors are the explorer's, not the layout engine's:

- **Parallel edges on one line bow apart.** Edges joining the same two nodes,
  in either direction, are drawn on one line when they span a single rank.
  Those are separated by 16, with both ends left on their nodes. A pair that
  spans more ranks is left as the layout engine routed it, which is already
  apart.
- **A self loop is not drawn.** An edge from a node to itself stays in your
  data and has an empty route. It moves nothing.
- **A group moves no node.** It is the padded hull of its members with a band
  above for its label. Pass `{ strictGroups: true }` to throw
  `GROUP_ENCLOSES_NON_MEMBER` when an outline would overlap a node that is not
  a member, even partly, for a diagram where that would be a false statement.
  An outline that only touches a neighbor is not an overlap.

## Search

`searchNodes(nodes, query, searchText)` returns the nodes whose text contains
every whitespace-separated token of the query, case ignored, in data order. The
text is the id and label unless you pass `searchText`, an accessor over your
own node type. An empty query matches nothing. The query is literal text, not a
pattern.

## Errors

A malformed view throws `ExplorerDataError`. `ExplorerRoot` validates every
view and lays out the active one during render, so an error boundary
catches it. Switch on its `code`. Its `id` is
the view, node, edge or group the error is about, and its `viewId` is the view
that was found in (`undefined` when the error is about a view itself), so a
host can point at the offender without parsing the message.

`layoutView` validates its view first, so it throws these too. `validateView`
and `validateViews` run the same checks without laying out. Only
`validateViews` can raise `DUPLICATE_VIEW_ID`, since it is the only one that
sees more than one view.

| `code` | When |
| --- | --- |
| `INVALID_ID` | a view, node, edge or group has an empty id |
| `DUPLICATE_VIEW_ID` | two views share an id |
| `DUPLICATE_NODE_ID` | two nodes in one view share an id |
| `DUPLICATE_EDGE_ID` | two edges in one view share an id |
| `DUPLICATE_GROUP_ID` | two groups in one view share an id |
| `INVALID_NODE_SIZE` | a node's width or height is not finite and greater than zero |
| `INVALID_LAYOUT_OPTION` | a view's `nodeSep` or `rankSep` is not finite and zero or greater, or its `direction` or `edgeStyle` is not one of the allowed values |
| `MISSING_EDGE_ENDPOINT` | an edge names a node its view lacks |
| `MISSING_GROUP_MEMBER` | a group names a node its view lacks |
| `EMPTY_GROUP` | a group has no members |
| `GROUP_ENCLOSES_NON_MEMBER` | `strictGroups` only |

Ids may repeat across views.

MIT © prnt.design
