---
id: graph-model
title: Graph model
sidebar_position: 2
---

# Graph model

`@dagr/graph` holds the structure everything else in Dagr reads: a mutable
multi-digraph with stable string identity, no dependencies, and no opinion
about how it is drawn.

Multi-digraph means edges are directed and there can be more than one of them
between the same ordered pair. Each edge carries its own id, so two edges from
`a` to `b` stay distinguishable, and a self loop from `a` to `a` is a normal
edge. Identity is a plain string you choose, or one the graph generates. It
never changes while the node or edge is in the graph, which is what lets a
later layout pass say "this is the same node, it moved" instead of handing the
renderer a fresh set of coordinates.

## Usage

```ts
import { Graph, NodeNotFoundError } from '@dagr/graph';

const graph = new Graph();

graph.addNode('ingest');
graph.addNode('parse');
graph.addNode('layout');
const generated = graph.addNode(); // id 'n1'

graph.addEdge('ingest', 'parse', 'first');
graph.addEdge('parse', 'layout');
graph.addEdge('parse', generated.id);

graph.nodeCount; // 4
graph.edgeCount; // 3
graph.successors('parse'); // ['layout', 'n1']
graph.outDegree('parse'); // 2

graph.removeNode('parse'); // takes its three incident edges with it
graph.edgeCount; // 0

try {
  graph.successors('parse');
} catch (error) {
  if (error instanceof NodeNotFoundError) {
    // error.code === 'NODE_NOT_FOUND'
  }
}
```

## Types

```ts
type NodeId = string;
type EdgeId = string;

interface Node {
  readonly id: NodeId;
}

interface Edge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
}
```

Node and edge records are the graph's own objects, frozen with `Object.freeze`
before the graph stores them. They are values: read them, pass them around,
hold on to them. Writing through one is not merely discouraged, it fails, and
it fails for JavaScript callers too, not just under the TypeScript `readonly`
markers. That is what keeps a stray write from desynchronising the adjacency
indexes.

Because records are frozen, record identity is meaningful. When attribute
updates arrive in a later milestone they will be copy on write: an updated
record is a new object, and a record that did not change keeps its identity,
so `getNode(id) === previousNode` is a valid "nothing changed here" test.

## Methods

### Counts

| Method | Behaviour |
| --- | --- |
| `nodeCount` | Number of nodes. O(1). |
| `edgeCount` | Number of edges. O(1). |

### Nodes

| Method | Behaviour |
| --- | --- |
| `addNode(id?)` | Adds a node and returns it. With no argument the id is generated. Throws on an empty or duplicate id. |
| `hasNode(id)` | Whether the node is in the graph. O(1). |
| `getNode(id)` | The node record, or `undefined`. O(1). |
| `requireNode(id)` | The node record. Throws `NodeNotFoundError` if the node is unknown. O(1). |
| `removeNode(id)` | Removes the node and every edge incident to it, in-edges, out-edges, and self loops alike. Throws if the node is unknown. O(degree). |
| `nodes()` | Every node, in insertion order, as a fresh array. O(nodeCount). |

### Edges

| Method | Behaviour |
| --- | --- |
| `addEdge(source, target, id?)` | Adds a directed edge and returns it. With no `id` the id is generated. Throws if either endpoint is unknown, or on an empty or duplicate id. |
| `hasEdge(id)` | Whether the edge is in the graph. O(1). |
| `getEdge(id)` | The edge record, or `undefined`. O(1). |
| `requireEdge(id)` | The edge record. Throws `EdgeNotFoundError` if the edge is unknown. O(1). |
| `removeEdge(id)` | Removes the edge and leaves both endpoints in place. Throws if the edge is unknown. O(1). |
| `edges()` | Every edge, in insertion order, as a fresh array. O(edgeCount). |

`getX` and `requireX` are the same lookup with different answers to absence.
Reach for `getX` when "it is not here" is a normal outcome you plan to handle,
and for `requireX` when it would be a bug. The second one exists so that
resolving ids the graph just handed you, the output of `successors` for
instance, does not need a `!`:

```ts
const names = graph.successors('parse').map((id) => graph.requireNode(id).id);
```

### Adjacency

Adjacency is indexed per node, so the listings cost O(degree) rather than a
scan of every edge in the graph, and the degree accessors cost O(1): they read
the size of an index rather than walking it. All of them throw
`NodeNotFoundError` when given an id the graph does not hold.

| Method | Behaviour |
| --- | --- |
| `successors(id)` | Distinct targets of the node's out-edges, in node insertion order. Parallel edges collapse to one entry. O(out-degree), plus a sort over the distinct neighbours. |
| `predecessors(id)` | Distinct sources of the node's in-edges, same ordering and deduplication. O(in-degree), plus the same sort. |
| `outEdges(id)` | Edges leaving the node, in insertion order. O(out-degree). |
| `inEdges(id)` | Edges arriving at the node, in insertion order. O(in-degree). |
| `edgesBetween(source, target)` | Every edge from `source` to `target`, in insertion order. Direction matters, so this is not symmetric. O(out-degree of `source`). |
| `outDegree(id)` | Number of edges leaving the node. O(1). |
| `inDegree(id)` | Number of edges arriving at the node. O(1). |
| `degree(id)` | `outDegree(id) + inDegree(id)`. O(1). |

Degrees are counted in edges, not in neighbours. Two parallel edges from `a` to
`b` give `a` an out-degree of 2. A self loop on `a` counts once as an out-edge
and once as an in-edge, so it contributes 1 to `outDegree`, 1 to `inDegree`,
and 2 to `degree`.

A node the graph does not hold is always an error, never an empty result. If
you want the tolerant version, check `hasNode` first.

Those bounds describe the work, not the allocation. Every listing returns a
fresh array, and `successors` and `predecessors` also build a set to
deduplicate and sort the result by node insertion order, so a sweep that
queries adjacency once per node per pass allocates once per node per pass. That
is deliberate for now: it keeps the API small and the results safe to keep. If
the layout benchmarks show the churn matters, a non-allocating traversal form
(a visitor over the same indexes) will be added alongside these, which is a
purely additive change.

## Errors

Every error extends `DagrGraphError`, so one `catch` with one `instanceof` test
covers the family. `DagrGraphError` declares a `code` field, typed as the
`DagrGraphErrorCode` union, so callers who would rather switch on a value than
on a class can do it through the base class and have the switch checked for
exhaustiveness:

```ts
import { DagrGraphError } from '@dagr/graph';

try {
  graph.removeEdge('nope');
} catch (error) {
  if (error instanceof DagrGraphError) {
    switch (error.code) {
      case 'EDGE_NOT_FOUND':
        break;
      // ... the other four codes
    }
  }
}
```

`DagrGraphError` is abstract, so every member of the family has a `code`.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `DagrGraphError` | abstract | Base class, abstract, never thrown directly. |
| `InvalidIdError` | `INVALID_ID` | An explicit id is the empty string. Carries `kind` (`'node'` or `'edge'`) and the offending `id`. |
| `DuplicateNodeError` | `DUPLICATE_NODE` | `addNode` is given an id already in the graph. |
| `NodeNotFoundError` | `NODE_NOT_FOUND` | An operation names a node the graph does not hold. |
| `DuplicateEdgeError` | `DUPLICATE_EDGE` | `addEdge` is given an id already in the graph. |
| `EdgeNotFoundError` | `EDGE_NOT_FOUND` | `removeEdge` names an edge the graph does not hold. |

## Determinism

Layout reproducibility depends on the graph iterating the same way every time,
so the model makes these promises:

- `nodes()`, `edges()`, `outEdges`, `inEdges`, and `edgesBetween` return
  elements in insertion order. Nothing depends on hashing or on the text of an
  id.
- A node or edge that is removed and added again counts as a new insertion, so
  it moves to the end of iteration order.
- `successors` and `predecessors` return the distinct neighbours in node
  insertion order. The result is a function of which neighbours exist right
  now, never of which edge connected one first, so removing a redundant
  parallel edge (one of two edges from `a` to `b`, with the other still there)
  leaves the listing unchanged. Removing the last edge to a neighbour drops
  that entry and moves nothing else. This is the one listing that is ordered
  rather than raw insertion order, and it exists because layout ordering seeds
  from adjacency: neighbour order has to depend only on the shape of the graph,
  or untouched nodes would move on a redundant edit.
- Generated ids are `n1`, `n2`, ... for nodes and `e1`, `e2`, ... for edges,
  from counters that only move forward. A generated id never collides with an
  existing one, and claiming `n3` yourself spends that suffix: the counter
  moves past it, so generation never hands it out even after you remove the
  node. Generation never recycles a suffix, whatever you remove; claiming a
  removed id again yourself is still allowed, that is your call to make. An
  explicit id outside the generated shape, `n007` or `node-3`, leaves the
  counter alone.
- Returned arrays are fresh copies: mutating one cannot corrupt the graph, and
  it will not be updated by later mutations either. The records inside are not
  copies, they are the graph's own objects, frozen at construction, so a write
  attempt through one fails rather than desynchronising the indexes. Both
  halves are enforced, not conventions.

The same sequence of calls therefore always produces the same graph, with the
same ids in the same order.

## Not here yet

This is the M1.1 core and deliberately small. Attributes and ports, patches and
undo, traversal (topological sort, cycle detection, reachability), and
`toJSON`/`fromJSON` are all separate tasks. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in. Until then the graph is structure only: identity, shape,
and adjacency.
