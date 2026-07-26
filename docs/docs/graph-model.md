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

Node and edge records are read-only views of the graph's own state. Treat them
as values: read them, pass them around, do not try to write through them.

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
| `removeNode(id)` | Removes the node and every edge incident to it, in-edges, out-edges, and self loops alike. Throws if the node is unknown. O(degree). |
| `nodes()` | Every node, in insertion order, as a fresh array. |

### Edges

| Method | Behaviour |
| --- | --- |
| `addEdge(source, target, id?)` | Adds a directed edge and returns it. With no `id` the id is generated. Throws if either endpoint is unknown, or on an empty or duplicate id. |
| `hasEdge(id)` | Whether the edge is in the graph. O(1). |
| `getEdge(id)` | The edge record, or `undefined`. O(1). |
| `removeEdge(id)` | Removes the edge and leaves both endpoints in place. Throws if the edge is unknown. O(1). |
| `edges()` | Every edge, in insertion order, as a fresh array. |

### Adjacency

Adjacency is indexed per node, so these cost O(degree) rather than a scan of
every edge in the graph. All of them throw `NodeNotFoundError` when given an id
the graph does not hold.

| Method | Behaviour |
| --- | --- |
| `successors(id)` | Distinct targets of the node's out-edges, ordered by the first edge that connects to each one. Parallel edges collapse to one entry. |
| `predecessors(id)` | Distinct sources of the node's in-edges, same ordering and deduplication. |
| `outEdges(id)` | Edges leaving the node, in insertion order. |
| `inEdges(id)` | Edges arriving at the node, in insertion order. |
| `edgesBetween(source, target)` | Every edge from `source` to `target`, in insertion order. Direction matters, so this is not symmetric. |
| `outDegree(id)` | Number of edges leaving the node. |
| `inDegree(id)` | Number of edges arriving at the node. |
| `degree(id)` | `outDegree(id) + inDegree(id)`. |

Degrees are counted in edges, not in neighbours. Two parallel edges from `a` to
`b` give `a` an out-degree of 2. A self loop on `a` counts once as an out-edge
and once as an in-edge, so it contributes 1 to `outDegree`, 1 to `inDegree`,
and 2 to `degree`.

A node the graph does not hold is always an error, never an empty result. If
you want the tolerant version, check `hasNode` first.

## Errors

Every error extends `DagrGraphError`, so one `catch` with one `instanceof` test
covers the family. Each subclass also carries a `code` field for callers that
would rather switch on a value.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `DagrGraphError` | none | Base class, not thrown directly. |
| `InvalidIdError` | `INVALID_ID` | An explicit id is the empty string. |
| `DuplicateNodeError` | `DUPLICATE_NODE` | `addNode` is given an id already in the graph. |
| `NodeNotFoundError` | `NODE_NOT_FOUND` | An operation names a node the graph does not hold. |
| `DuplicateEdgeError` | `DUPLICATE_EDGE` | `addEdge` is given an id already in the graph. |
| `EdgeNotFoundError` | `EDGE_NOT_FOUND` | `removeEdge` names an edge the graph does not hold. |

## Determinism

Layout reproducibility depends on the graph iterating the same way every time,
so the model makes these promises:

- `nodes()`, `edges()`, and every adjacency query return elements in insertion
  order. Nothing is sorted, and nothing depends on hashing or on the text of an
  id.
- A node or edge that is removed and added again counts as a new insertion, so
  it moves to the end of iteration order.
- `successors` and `predecessors` order neighbours by the first edge that
  connects them, and later parallel edges do not move an existing entry.
- Generated ids are `n1`, `n2`, ... for nodes and `e1`, `e2`, ... for edges,
  from counters that only move forward. A generated id never collides with an
  existing one: if you claimed `n3` yourself, generation skips past it. Ids are
  never recycled after a removal.
- Returned arrays are fresh copies. Mutating one cannot corrupt the graph, and
  it will not be updated by later mutations either.

The same sequence of calls therefore always produces the same graph, with the
same ids in the same order.

## Not here yet

This is the M1.1 core and deliberately small. Attributes and ports, patches and
undo, traversal (topological sort, cycle detection, reachability), and
`toJSON`/`fromJSON` are all separate tasks. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in. Until then the graph is structure only: identity, shape,
and adjacency.
