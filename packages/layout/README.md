# @dagr/layout

The headless Sugiyama layout pipeline behind [Dagr](https://dagr.prnt.design),
and the reason the project exists: a dagre successor designed for **animation
and incremental relayout from the start**, not retrofitted with them.

```sh
pnpm add @dagr/layout @dagr/graph
```

`@dagr/graph` is a `peerDependency`, so you install it yourself. See "one copy
of `@dagr/graph`" below, which is not a formality.

```ts
import { Graph } from '@dagr/graph';
import { layout } from '@dagr/layout';

const graph = new Graph();
graph.addNode('ingest');
graph.addNode('parse');
graph.addNode('render');
graph.addEdge('ingest', 'parse', 'a');
graph.addEdge('parse', 'render', 'b');

const result = layout({ graph, config: { nodeSep: 20, rankSep: 60 } });
result.nodes.get('parse'); // { id, x, y, width, height }, where x and y are the centre
result.edges.get('a'); // a routed polyline
```

Headless means headless: this package returns geometry and draws nothing. It
names no renderer, and the y-down to y-up conversion belongs to whoever owns
the drawing.

## What it is for: the edit, not the first draw

A cold layout is the easy half. What a node-graph UI actually does is edit a
graph that is already on screen, and the question is how much of the drawing
moves when one node is added.

Bind the stages and the config once with `createLayout`, then feed it patches:

```ts
import { createLayout } from '@dagr/layout';

const engine = createLayout({ config: { nodeSep: 20, rankSep: 60 } });
const first = engine.run(graph);

const again = engine.relayout(patch); // patch from graph.subscribe
again.ran; // which stages actually ran
again.influence; // exactly which nodes were entitled to move
again.delta; // absolute positions for what changed, and nothing else
```

Over six scripted editing sessions measured against the shipped default
pipeline, the incremental path moves **4.1x to 38.4x less of the drawing per
patch** than a cold relayout, with **order churn of exactly zero** on every
session and every step, for 3.1% to 13.8% more crossings. The tables, the
sessions and what the warm start costs are on the
[incremental layout](https://dagr.prnt.design/docs/incremental-layout) page,
committed as a golden corpus rather than quoted from memory.

A patch that no stage reads runs no stage at all: an inert relayout on a
10,000-node drawing costs 1.955ms against 3,317ms for a full one.

## Read this first: one copy of `@dagr/graph`

`Graph` uses `#private` fields, which makes it **nominally typed**. Two copies
in your tree fail to compile with `separate declarations of a private property
'#nodes'`, and `@dagr/graph` is all over this package's surface
(`LayoutInput.graph`, `LayoutConfig.nodeSize`). It is a peer dependency for
exactly that reason, and a caret range on a 0.x package does not cross a minor,
so a version skew between the two is a resolution with two copies in it rather
than a warning.

## The delta contract

Three rules the whole package is written against, and a consumer animating a
relayout relies on all three:

- **Absent means unchanged.** A node not named in a delta did not move.
- **Absolute only.** Positions are where the node now is, never an offset.
- **Removals apply before additions.**

`applyDelta` is exported so the meaning ships as code rather than as prose.
`@dagr/render`'s `createNodeMotion` is the consumer that springs between two of
them.

## Choosing stages

`layout()` is sugar over the same runner the engine uses. The defaults are
`defaultStages`; override one at a time:

```ts
import { layout, longestPathRankStage, networkSimplexRankStage } from '@dagr/layout';

layout({ graph }, { rank: longestPathRankStage }); // fewest layers
layout({ graph }, { rank: networkSimplexRankStage }); // least total edge length
```

`serveLayout` is the worker side, exported from the package root rather than a
subpath, because the two halves are not separately loadable.

## Documentation

The pipeline, every stage boundary, the stability contract and the measurements
are on the [layout pipeline](https://dagr.prnt.design/docs/layout) page.

MIT © prnt.design
