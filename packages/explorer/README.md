# @prnt/dagr-explorer

An interactive graph explorer for [Dagr](https://dagr.prnt.design): views,
search, connection tracing, groups and a details drawer, with node content
virtualized by on-screen size.

## Read this first: it is not published yet

The package is built in slices, M5.6a to M5.6f in `ROADMAP.md`, and stays
`"private": true` until the last. What exists today is the headless core
below. The React parts arrive in M5.6c to M5.6e.

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

None of it touches the DOM or imports React at runtime, so it runs on a server.

## A node is an id and a label

Those two fields are all the explorer reads. Everything else about a node is
your own fields on a type that extends `ExplorerNode`, and that type flows
through to every function and, later, every slot.

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

A malformed view throws `ExplorerDataError`. Switch on its `code`. Its `id` is
the view, node, edge or group the error is about, and its `viewId` is the view
that was found in (`undefined` when the error is about a view itself), so a
host can point at the offender without parsing the message.

| `code` | When |
| --- | --- |
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
