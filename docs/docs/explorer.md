---
id: explorer
title: Graph explorer
sidebar_position: 9
---

import ArchitectureDemo from '@site/src/components/ExplorerDemo/ArchitectureDemo';
import LargeGraphDemo from '@site/src/components/ExplorerDemo/LargeGraphDemo';

# Graph explorer

`@prnt/dagr-explorer` is a React component for reading a graph rather than
drawing one: views of the same system, search, connection tracing, groups and
a details drawer, over a pannable, zoomable surface. It draws with DOM and
SVG, not WebGPU, and gives a DOM element only to the nodes large enough on
screen to read, so a graph of thousands of nodes stays a page of a few
hundred elements. Layout is Dagr's own, and runs anywhere, a server included.

## Install

:::note[Available on npm]

`@prnt/dagr-explorer` is available on npm from version 0.1.3.

:::

```bash
npm install @prnt/dagr-explorer
```

It runs on React 18 and React 19 (`react` and `react-dom` `>=18.2.0 <20.0.0`).
The umbrella package re-exports it as `@prnt/dagr/explorer`, but the umbrella
requires React 19, so a React 18 site installs `@prnt/dagr-explorer`
directly. It does not depend on `@prnt/dagr-react`, and it never loads
three.js at runtime: from `@prnt/dagr-render` it imports only the
three-free `core` entry, and `@prnt/dagr-render` declares `three` an optional
peer, so it is not installed either.

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

A node is an `id` and a `label`, and those are all the explorer reads.
Everything else is your own fields, and the node type is inferred from your
data, so `renderNode` above sees `team`. `label` on the explorer is required:
it is the graph's accessible name, and the parts derive theirs from it.

For one graph, pass `nodes`, `edges`, and optionally `groups` and `layout`,
instead of `views`. Passing both shapes is a type error.

A view's `layout` sets `direction` (`'right'` by default, or `'down'`), a
`nodeSize` (240 by 120 by default, a size or a function of the node),
`nodeSep`, `rankSep` and `edgeStyle`. Sizes are declared, never measured: a
node with no element cannot be measured.

## Try it

Tidewater is an invented ferry booking system in two views. The overview
flows right and outlines four groups. The deployment view flows down,
outlines what runs on devices and what runs at the edge, and dashes every
edge that crosses from one place to another. Both
bow the parallel edges between Booking and its database, and between
Payments and the card processor, apart.

Search for a name or a kind (try `store`), press `Enter` to fly to the first
match, and open a node to see its details and connections. Turn on trace to
dim everything not joined to the selected node. Zoom in and the nodes go from
marks to labels to cards showing the kind, the label and a sentence: that is
`renderNode` at the `summary` and `rich` tiers.

<ArchitectureDemo />

What the demo passes, beyond `views`:

```tsx
<DagrExplorer
  label="Tidewater architecture"
  views={architectureViews}
  searchText={(node) => `${node.id} ${node.label} ${node.kind}`}
  renderNode={(node, { tier }) =>
    tier === 'rich' ? (
      <>
        <span className="kind">{node.kind}</span>
        <span className="label">{node.label}</span>
        <span className="summary">{node.summary}</span>
      </>
    ) : (
      node.label
    )
  }
  renderDetails={({ node, connections, follow }) => (
    <>
      <p>{node.label}</p>
      <dl>
        <dt>Kind</dt>
        <dd>{node.kind}</dd>
        <dt>Owner</dt>
        <dd>{node.owner}</dd>
      </dl>
      <ul>
        {connections.map(({ edge, node: other }) => (
          <li key={edge.id}>
            <button type="button" onClick={() => follow(other.id)}>
              {other.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  )}
/>
```

`searchText` is what search reads from a node, by default the id and label.
`renderNode`'s output sits inside the explorer's own node button, so it must
not be interactive. `renderDetails` replaces the drawer's body. `inspect`
opens another node while keeping the drawer's original opener for focus to
return to, and `follow` does the same and pans the node into view at the
current zoom, which is what the default list's connection buttons do. Those
buttons show an arrow for the edge's direction, read out through
`labels.connectionTo` and `labels.connectionFrom`.

## The parts and your own layout

`DagrExplorer` is built only from public parts, with no private access, so a
host that owns its layout can rebuild it or arrange the parts differently:

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
| `ExplorerRoot` | the data, its validation and layout, and the state. Renders one element around its children |
| `ExplorerViews` | the view switcher. Renders nothing for a single view |
| `ExplorerSearch` | the search field, a live match count, and up to `maxResults` matches as buttons (default 50) |
| `ExplorerTraceToggle` | trace on and off |
| `ExplorerViewport` | the graph: pan and zoom, the base layer, and node elements for nodes large enough to read |
| `ExplorerDetails` | the drawer: an overlay with a close button and a scrolling body |
| `ExplorerToolbar` | zoom out, the zoom readout, zoom in, fit, and zoom to the selected node. Zoom out, zoom in, fit and the drawer's close button are icons, named and titled by their labels |

Children of `ExplorerViewport`, such as `ExplorerDetails`, share a positioned
stage with the graph, so the drawer overlays the graph and not the hint below
it. The camera frames the part the drawer leaves uncovered: fit, focus,
reveal and zoom work beside it, and a node under it can be panned out. Pass
`inset={{ right: 320 }}` (CSS pixels per side) for an overlay of your own,
and `contentPadding` (default 0.05, in [0, 0.45]) for how far content may be
panned past the frame's edge. One viewport per root: a second throws `ExplorerContextError` with the
code `SECOND_VIEWPORT`, and a part outside a root throws it with
`OUTSIDE_EXPLORER`.

Every part takes `className` and `style`, and your `style` wins over the
part's own: `<ExplorerViewport style={{ height: 600 }} />` sets the graph's
height. The viewport keeps its own `position` and `overflow`, which place and
clip its nodes, and `user-select: none`, so a pan never selects their text.

**A part's type parameters are a claim, not a check.** The parts talk through
a context, which erases them, so `ExplorerViewport<MyNode>` asserts the node
type and nothing verifies it. `DagrExplorer` has no such gap: it infers the
types from `views`.

The view and the selection are controllable (`viewId`, `selectedId`, their
`default*` props and `onViewChange`, `onSelectedChange`), because they are what
a host syncs to a URL. Under a controlled value, the explorer calls back and
changes nothing on screen until the prop does. The query, trace, the drawer
and the camera are internal, and switching view resets them.

## `useExplorer` and `useExplorerApi`

Inside a root, `useExplorer()` returns the explorer's state (`views`,
`activeView`, `layout`, `selectedId`, `selectedNode`, `query`, `matches`,
`trace`, `detailsOpen`, `dimmed`, `labels`, and `camera` for a readout of your
own) and its methods. It re-renders its caller on every change of state.

`useExplorerApi()` returns the methods alone and never re-renders its caller.
Use it for a control that only acts, such as a button of your own:

```tsx
import { useExplorerApi } from '@prnt/dagr-explorer';

function ShowStore() {
  const { inspect } = useExplorerApi();
  return (
    <button type="button" onClick={(event) => inspect('store', event.currentTarget)}>
      Show the store
    </button>
  );
}
```

The same methods reach a host outside the root through `apiRef`: `fit()`,
`zoomBy(factor)`, `focusNode(id)`, `reveal(id)`, `focusViewport()`,
`select(id)`, `inspect(id, trigger)`, `closeDetails()`, `selectView(id)`,
`setQuery(query)` and `setTrace(on)`. Two calls in one tick see each other,
so `select('a'); select(null)` ends with nothing selected.

## Labels

Every string the parts show or announce comes from `labels`, whose neutral
English defaults are `DEFAULT_EXPLORER_LABELS`. Pass any subset to
`ExplorerRoot` or `DagrExplorer`. Counts and names are formatters, so a
language with other plural rules is a function, not a template:

```tsx
const labels = {
  search: 'Find a component',
  matches: (count: number) => (count === 1 ? 'One match' : `${count} matches`),
};

<DagrExplorer label="Architecture" views={views} labels={labels} />;
```

An inline object is kept by value, so re-creating it with the same contents
changes nothing. An inline formatter is a new function each render, and so a
change: define formatters outside the component, as above.

## Theming

The parts work with no stylesheet: what they need to function is inline.
`@prnt/dagr-explorer/styles.css` is the optional default look, and no module
imports it. Every part carries a `data-dagr-explorer` hook (`root`, `search`,
`viewport`, `node`, `details`, `toolbar` and others), with state in
`data-tier`, `data-selected`, `data-dimmed`, `data-dragging` and
`data-active`.

The stylesheet reads eight variables, which you set anywhere above the
explorer:

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

`--dagr-explorer-height` sets the graph's height, 480px by default, with or
without the stylesheet.

The demos on this page follow the site's light and dark modes with nothing
but this mapping onto Docusaurus's Infima variables, which already swap per
theme:

```css
.theme {
  --dagr-explorer-accent: var(--ifm-link-color);
  --dagr-explorer-fg: var(--ifm-color-content);
  --dagr-explorer-fg-muted: var(--ifm-color-content-secondary);
  --dagr-explorer-border: var(--ifm-color-emphasis-300);
  --dagr-explorer-bg: var(--ifm-background-surface-color);
  --dagr-explorer-bg-subtle: var(--ifm-color-emphasis-100);
  --dagr-explorer-focus: var(--ifm-color-primary);
  --dagr-explorer-font-mono: var(--ifm-font-family-monospace);
}

/* A plain rule wins over the stylesheet: the site's typeface. */
.theme [data-dagr-explorer='root'] {
  font-family: var(--ifm-font-family-base);
}
```

The stylesheet's selectors are wrapped in `:where()`, so they have no
specificity and any rule of yours wins, as the second rule shows. The
exceptions are its `:hover`, `:focus` and `:focus-visible` rules, which weigh
as one class each: override those with a class that comes later or a more
specific selector.

## Tiers and virtualization

A node's tier comes from its width on screen, in CSS pixels:

| Tier | Width on screen | What is on the page |
| --- | --- | --- |
| `mark` | below `summary` (56) | no element: the base layer draws it |
| `summary` | from `summary` to below `rich` (200) | a node element, `renderNode` with `tier: 'summary'` |
| `rich` | `rich` and above | a node element, `renderNode` with `tier: 'rich'` |

The gates are per node, so a large node becomes readable before a small one.
Change them with `tiers`, as `{ summary, rich }`. At the `summary` tier the
default stylesheet counter-scales text, through `--dagr-explorer-inv-zoom`, so
a label stays legible as the node shrinks.

On every camera frame the viewport works out which nodes get an element:

- the nodes whose box meets the viewport, widened by a quarter of its width
  and height on each side, and whose tier is `summary` or `rich`;
- at most `maxOverlayNodes` of those (default 200), nearest the center of the
  view first, ties broken by id. The rest stay marks;
- plus the pinned nodes, which always have an element, outside the cap and at
  least at the `summary` tier: the selected node, the node in the tab order,
  and the node with keyboard focus. So the page can hold a few more node
  elements than the cap.

Everything else in that widened view is drawn by the base layer: the other
nodes as marks, the edges and the group outlines. React renders only when
which nodes are mounted, or at what tier, changes. A pan inside the widened
margin moves the plane with one style write and no React work.

The overlay cap is what keeps a large graph a light page. The live demo at
the end of this page counts the node elements it has mounted as you pan.

## Keyboard and screen readers

The graph is one tab stop. Exactly one node is in the tab order: the
selected node, else the last node you focused from the keyboard, else the
node nearest the center of the view. That node always has an element, at
any zoom. Tab again leaves the graph.

| Key, with a node focused | Does |
| --- | --- |
| Arrow keys | move focus to the nearest node in that direction, on screen or not |
| `Shift` with an arrow | pans |
| `Enter`, `Space` | inspect the node |

With the graph's surface focused (click it), the arrow keys pan. Either way
`+` and `=` zoom in, `-` zooms out and `0` fits. `Escape` closes the drawer
if it is open, keeping focus where it is, and otherwise leaves the graph. Wheel zoom only works while the graph has focus, so
the page scrolls past it untouched.

Only nodes on screen and large enough to read have elements, so a screen
reader finds only those in the graph. **Search is the way to every node.** It
reaches all of them whatever is on screen, its match count is live, and the
graph's accessible description says so and gives the node and edge counts.
`Enter` in the search field inspects the first match and flies to it.

When the drawer closes, focus returns to what opened it, else to the search
field, else to the root. `Escape` closes the drawer from anywhere in the root.

## Server rendering

Every part renders on a server, with no DOM. Layout is pure, so the HTML
carries the shell and the base layer: every node as a mark and every routed
edge. The camera and the node elements start on the client, once the
viewport is measured, and until then the plane is hidden, so no unscaled
frame is painted. The graph's height is fixed by `--dagr-explorer-height`
(or your `style`), so nothing shifts when it fits.

The architecture demo above is rendered this way, when this site is built.
The large one is not, for weight rather than safety: 2,000 marks in the HTML
for a graph below the fold.

The core touches no DOM at all, and `layoutView`, `searchNodes`,
`validateView` and `validateViews` are exported for use on their own. A
malformed view throws `ExplorerDataError` with a `code` and the offending
`id`, on the server as on the client.

## The base layer is experimental

Nodes too small to read, edges and group outlines are drawn by a base layer,
SVG by default. `ExplorerViewport`'s `base` prop swaps it, through the
exported `ExplorerBase`, `ExplorerBaseProps`, `ExplorerCameraSource`,
`ExplorerEmphasis` and `ExplorerVisibleSet` types. They are a seam with one
implementation, which is a guess: they may change when a native base over
`DagrCanvas` lands and confirms or corrects them.

## A 2,000 node graph

A generated system of 40 layers of 50 nodes and 2,661 edges, 123 of them
dashed and skipping a layer or two, laid out in your browser. Fitted, every node is
a mark except the one in the tab order, which always has an element. Zoom in
and the readout shows node elements arriving, and staying within a few of the
cap of 200 however far you pan.

<LargeGraphDemo />

## Limits

- **The SVG base is smooth to about 4,000 nodes.** Measured by panning
  graphs of 500 to 8,000 nodes at one and a half times the fit zoom, where
  every node and edge is in the base, in Chromium 153 on an Apple M4 (macOS,
  16 GB, device pixel ratio 1), on 2026-10-04. A size is smooth when its 95th
  percentile frame stays within one 16.7 ms frame. Above the ceiling the
  answer is a native base, which is not built yet.

  | Nodes | Edges | Median frame | 95th percentile | Frames dropped |
  | --- | --- | --- | --- | --- |
  | 500 | 643 | 16.7 ms | 18.3 ms (1 frame) | 0% |
  | 1,000 | 1,314 | 16.7 ms | 18.3 ms (1 frame) | 0% |
  | 2,000 | 2,661 | 16.7 ms | 18.1 ms (1 frame) | 0% |
  | 4,000 | 5,407 | 16.7 ms | 18.4 ms (1 frame) | 1% |
  | 8,000 | 10,826 | 16.7 ms | 33.4 ms (2 frames) | 11% |

  The 95th percentile is counted in frames, because frame timestamps jitter
  by a millisecond or two: a page moving one div measures 18.2 ms on the same
  machine. How it was taken is in `bench/browser/README.md`, and the harness
  beside it reruns it.
- **A self loop is not drawn.** An edge from a node to itself stays in your
  data, appears in the node's connections, and has an empty route.
- **A group moves no node.** It is the padded hull of its members, with a band
  above for its label, so an outline can cover a node that is not a member.
  Pass `strictGroups` to throw `GROUP_ENCLOSES_NON_MEMBER` instead, for a
  diagram where that would be a false statement. The demo's groups are chosen
  so none does, and a test lays them out with `strictGroups` to keep it so.
  The canvas's [node groups](./node-groups.md) behave the same way.
- **Parallel edges bow apart only on one rank.** Edges joining the same two
  nodes are separated by 16 when they span a single rank. Across more ranks
  the layout already routes them apart.
