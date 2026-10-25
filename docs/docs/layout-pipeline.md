---
id: layout-pipeline
title: Layout pipeline
sidebar_position: 3
---

# Layout pipeline

`@dagr/layout` is a headless Sugiyama layout engine. It takes a list of sized
nodes and a list of edges, and hands back node centers, edge polylines, and a
bounding box. It draws nothing, it knows nothing about the DOM, and it has no
runtime dependencies.

Layout runs as four stages, in this order:

| Stage | Responsibility | Fills in |
| --- | --- | --- |
| `rank` | Which layer does each node belong to | `node.rank` |
| `order` | Where in its layer does each node sit | `node.order` |
| `position` | Actual coordinates for each node | `node.x`, `node.y` |
| `route` | The polyline for each edge | `edge.points` |

A rank is a finite integer. Negative ranks and gaps between ranks are fine,
fractions and `NaN` are not: later stages reason about integer slack and about
the integers strictly between two ranks.

Each stage is a plain function of `(state, config)` that mutates the shared
pipeline state. That is the whole contract, so any stage can be replaced with
your own: a ranking that respects a hand-authored layer, a positioner that
snaps to a grid, a router that produces splines. The stages you do not supply
fall back to the built in defaults.

## Structural input, no graph dependency

The input types are structural on purpose:

```ts
interface LayoutNodeInput {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

interface LayoutEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}
```

`@dagr/layout` never imports `@dagr/graph`. Anything that can produce sized
nodes and id-referencing edges (a `@dagr/graph` instance, a plain JSON blob,
someone else's graph library) can be laid out. An adapter from `@dagr/graph`
lands on top of these types later, not underneath them.

Edges carry their own id, matching `@dagr/graph`, so the input is a
multi-digraph: parallel edges between the same pair of nodes are legal, and so
are self loops.

## Coordinates are node centers

`PositionedNode.x` and `PositionedNode.y` are the center of the node, not its
top-left corner. This matches dagre, and it keeps rank-direction flips and
rotations cheap. If your renderer wants a top-left origin, subtract half the
size:

```ts
const left = node.x - node.width / 2;
const top = node.y - node.height / 2;
```

Every distance in the engine, node sizes, spacings, margins, and the result
coordinates, is in the same abstract layout unit. The engine never assumes
pixels.

## The result box, and why it is not normalized

A result carries four numbers describing where the drawing ended up:

```ts
result.minX; // left edge: leftmost node edge minus marginX
result.minY; // top edge: topmost node edge minus marginY
result.width; // content width plus 2 * marginX
result.height; // content height plus 2 * marginY
```

The drawing occupies the rectangle `minX, minY, width, height`. It is not
guaranteed to start at the origin. With the built in `position` stage it does,
because that stage starts the content at (`marginX`, `marginY`), so `minX` and
`minY` come out as 0. Margins are the position stage's job, though, and a
stage you wrote owes the caller nothing: if it ignores the margins or emits
negative coordinates, `minX` and `minY` report that rather than letting the
size quietly disagree with where the content is.

An empty graph has no content to measure, so its `minX` and `minY` are 0: the
degenerate `2 * marginX` by `2 * marginY` box sits at the origin.

Feeding a viewport is then direct, and translating to a top-left origin is one
subtraction:

```ts
svg.setAttribute('viewBox', `${result.minX} ${result.minY} ${result.width} ${result.height}`);

const left = node.x - node.width / 2 - result.minX;
const top = node.y - node.height / 2 - result.minY;
```

dagre normalizes instead: `translateGraph` shifts everything so the drawing
starts at the origin. Dagr deliberately does not, and this is the one place
the two engines disagree about the result. Normalizing means the whole drawing
jumps whenever the extreme node changes, so adding a single node off to the
left animates every other node sideways. Incremental relayout (roadmap M3)
promises the opposite: nodes that did not change do not move. Reporting the
origin keeps that promise, and costs a caller one offset.

## Configuration

Every option is optional. `resolveConfig` applies these defaults and validates
the result.

| Option | Default | Meaning |
| --- | --- | --- |
| `rankDir` | `'TB'` | Direction ranks grow in: `TB`, `BT`, `LR` or `RL` |
| `rankSpacing` | `50` | Gap between two adjacent ranks, along the rank axis (the default `rank` stage makes only one rank, see below) |
| `nodeSpacing` | `30` | Gap between two adjacent nodes inside one rank |
| `marginX` | `0` | Padding left and right of the content |
| `marginY` | `0` | Padding above and below the content |

Spacings and margins must be finite and non-negative. Zero is allowed.

Coming from dagre, the option names are camelCase and two of them are spelled
out:

| dagre | dagr |
| --- | --- |
| `rankdir` | `rankDir` (same four values) |
| `ranksep` | `rankSpacing` |
| `nodesep` | `nodeSpacing` |
| `marginx` / `marginy` | `marginX` / `marginY` |

## Laying out a graph

```ts
import { layout } from '@dagr/layout';

const result = layout(
  {
    nodes: [
      { id: 'a', width: 120, height: 40 },
      { id: 'b', width: 120, height: 40 },
    ],
    edges: [{ id: 'a->b', source: 'a', target: 'b' }],
  },
  { nodeSpacing: 24 },
);

result.nodes;
// [
//   { id: 'a', x: 60,  y: 20, width: 120, height: 40 },
//   { id: 'b', x: 204, y: 20, width: 120, height: 40 },
// ]
result.edges[0].points;
// [{ x: 60, y: 20 }, { x: 204, y: 20 }]
result.width; // 264
result.height; // 40
result.minX; // 0
result.minY; // 0
```

Note that `a` and `b` sit side by side, not stacked, even though `rankDir`
defaults to `'TB'` and the edge runs `a -> b`. The default `rank` stage puts
every node on rank 0 (see below), so there is only ever one rank today and
`rankSpacing` has nothing to separate. Ranking arrives in M2.2: the
coordinates here will change, the shape of the result will not.

The call never mutates the input: nodes and edges are validated and copied
into fresh pipeline state first. Two runs over the same input produce deeply
equal results, because nothing in the pipeline sorts by id or invents ids.

## Swapping a stage

`runPipeline` takes the same arguments as `layout` plus a partial stage
bundle. Anything you leave out keeps its default:

```ts
import { runPipeline } from '@dagr/layout';
import type { RankStage } from '@dagr/layout';

// Rank by path depth: "a/b/c" is deeper than "a/b".
const rankByDepth: RankStage = (state) => {
  for (const node of state.nodes) {
    node.rank = node.id.split('/').length - 1;
  }
};

const result = runPipeline(input, { rankSpacing: 60 }, { rank: rankByDepth });
```

The state a stage receives is exported too (`LayoutState`, `LayoutNodeState`,
`LayoutEdgeState`), along with `createLayoutState`, so third-party stages can
be written and unit tested against the same types the built in stages use.
State carries the adjacency a stage needs (`nodesById`, `outEdges`,
`inEdges`), all in input order.

## What a stage may add, and what the caller sees

A stage does not just fill in slots. Real Sugiyama stages grow the graph:
ranking reverses edges to break cycles, and long edges are cut into one node
per rank they cross. None of that is the caller's business, so state records
where each node and edge came from and the result emits only the caller's own:

| Field | Meaning | Reaches the result |
| --- | --- | --- |
| `node.kind` | `'real'` for an input node, `'dummy'` for a synthesized one | real only |
| `edge.of` | `undefined` for an input edge, otherwise the id of the input edge this record is a piece of | `undefined` only |

The bounding box (`minX`, `minY`, `width`, `height`) measures real nodes only,
so scaffolding never inflates the drawing.

Add a dummy node with `addDummyNode`, never by pushing a record yourself. It
invents an id that cannot collide with a caller id (a caller is free to name a
node `dummy:3`), marks it `'dummy'`, and registers it in `nodesById`,
`outEdges` and `inEdges` so the state stays consistent:

```ts
import { addDummyNode } from '@dagr/layout';

const bend = addDummyNode(state, { width: 0, height: 0, rank: 2 });
bend.id; // synthesized, guaranteed free
```

The search for a free name resumes where the previous call stopped, so a
caller who has already named a block of nodes `dummy:<integer>` is walked past
once for the whole run rather than once per node added. Which number you get
is an implementation detail: only "this id is free" is promised.

Segment edges are yours to push, onto `state.edges`, `state.outEdges[source]`
and `state.inEdges[target]`, with `of` set to the edge being split and
`index` set to `state.edges.length` at the moment you create the record:

```ts
const segment: LayoutEdgeState = {
  id: `${edge.id}/0`,
  index: state.edges.length, // its place in input order, set once
  source: edge.source,
  target: bend.id,
  of: edge.id,
  reversed: false,
  points: [],
};
state.edges.push(segment);
```

`edge.index` is the record's position in `state.edges` when it was created,
which is the order the caller listed the edges in. It is assigned once and
never renumbered, so it stays a stable sort key while edges are reversed and
segments are appended, and it is what keeps the adjacency lists orderable
without rescanning the graph.

## Reversing an edge

Edges are reversible in place, because that is how cycle breaking works
(roadmap M2.2). `reverseEdge` swaps `source` and `target`, toggles
`edge.reversed`, and moves the record between the adjacency lists, keeping
them in input order by `index`. That costs the degree of the two nodes
involved, not the size of the graph, so breaking every cycle of a graph stays
linear in the total degree:

```ts
import { reverseEdge } from '@dagr/layout';

reverseEdge(state, edge); // edge.reversed === true
reverseEdge(state, edge); // back exactly where it started
```

Reversal is private to the pipeline. The result reports a reversed edge with
its input `source` and `target`, and with `points` running from the input
source, so a caller never sees an edge pointing backwards.

## Driving the pipeline yourself

`runPipeline` is four calls in a row, and each one is exported:

```ts
import { buildResult, createLayoutState, resolveConfig, runStages } from '@dagr/layout';

const config = resolveConfig(options);
const state = createLayoutState(input);
runStages(state, config, stages);
const result = buildResult(state, config);
```

`runStages(state, config, stages?)` runs rank, order, position and route over
a state you already hold, filling in defaults for the stages you leave out.
`buildResult(state, config)` reads a finished state out as a `LayoutResult`,
copying everything, so the state stays usable afterwards.

This is the seam incremental relayout (roadmap M3) needs: `runPipeline` always
starts from a fresh state, while an incremental caller wants to hand the
pipeline a warm one, carrying the previous run's order and coordinates, so
stages that reuse them can keep the drawing stable instead of recomputing it
from nothing.

## Errors

Every rejection is a `LayoutError` with a stable `code`. Match on the code,
never on the message text.

| Code | Thrown when |
| --- | --- |
| `EMPTY_NODE_ID` | A node id is the empty string |
| `DUPLICATE_NODE_ID` | Two nodes share an id |
| `DUPLICATE_EDGE_ID` | Two edges share an id |
| `INVALID_NODE_SIZE` | A node width or height is negative, `NaN` or infinite |
| `UNKNOWN_EDGE_SOURCE` | An edge source names no node in the input |
| `UNKNOWN_EDGE_TARGET` | An edge target names no node in the input |
| `INVALID_RANK_DIR` | `rankDir` is not `TB`, `BT`, `LR` or `RL` |
| `INVALID_SPACING` | `rankSpacing` or `nodeSpacing` is negative or not finite |
| `INVALID_MARGIN` | `marginX` or `marginY` is negative or not finite |

```ts
import { layout, LayoutError } from '@dagr/layout';

try {
  layout(input);
} catch (error) {
  if (error instanceof LayoutError && error.code === 'UNKNOWN_EDGE_TARGET') {
    // The edge list references a node that was never added.
  }
}
```

## What is not implemented yet

This is the pipeline skeleton (roadmap M2.1). The plumbing, the types, the
config, the validation and the stage contract are real. The algorithms are
not: the default stages produce a valid but deliberately naive result.

- `rank` puts every node on rank 0.
- `order` keeps input order inside each rank.
- `position` lays each rank out as one line, packed in order, honoring
  `nodeSpacing`, `rankSpacing`, the margins and `rankDir`. There is no
  cross-rank alignment.
- `route` draws a straight two point line from the source center to the
  target center. A self loop becomes a degenerate two point line, both points
  at the node center, so every route has at least two points and consumers
  never have to special case an empty one.

`addDummyNode`, `reverseEdge`, `node.kind` and `edge.of` are real and tested,
but no built in stage uses them yet: today's defaults never break a cycle and
never split an edge. They are here so the stages that will do both can drop in
without changing the public result, and so a stage you write today can already
rely on them.

Landing next, per the roadmap: cycle breaking and longest-path ranking
(M2.2), rank tightening (M2.3), dummy-node chains for long edges (M2.4),
barycenter ordering with a transpose pass (M2.5 and M2.6), Brandes-Koepf
coordinate assignment (M2.7), and polyline edge routing (M2.8). Each drops
into the stage it belongs to, so the API on this page is meant to survive
them.
