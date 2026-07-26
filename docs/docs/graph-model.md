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

Nodes, edges, and the graph itself also carry attributes, and nodes may declare
ports for edges to attach to. Both are described below.

## Usage

The object init is the main entry point. `addNode` and `addEdge` also take a
plain string form as shorthand when an id is all you have to say.

```ts
import { Graph, NodeNotFoundError } from '@dagr/graph';

const graph = new Graph();

graph.addNode({ id: 'ingest', attrs: { label: 'Ingest' } });
graph.addNode({ id: 'parse', ports: [{ id: 'in', direction: 'in' }] });
graph.addNode('layout'); // shorthand for { id: 'layout' }
const generated = graph.addNode(); // id 'n1'

graph.addEdge({ source: 'ingest', target: 'parse', id: 'first', targetPort: 'in' });
graph.addEdge('parse', 'layout'); // shorthand for { source, target }
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
type PortId = string;

type Attrs = Record<string, unknown>;
type ReadAttrs<A extends object> = Readonly<Partial<A>>;
type AttrsPatch<A extends object> = { readonly [K in keyof A]?: A[K] | undefined };

type PortDirection = 'in' | 'out' | 'inout';

interface Port {
  readonly id: PortId;
  readonly direction: PortDirection;
}

interface PortInit {
  readonly id: PortId;
  readonly direction?: PortDirection; // defaults to 'inout'
}

interface Node<A extends object = Attrs> {
  readonly id: NodeId;
  readonly attrs: ReadAttrs<A>;
  readonly ports: readonly Port[];
}

interface NodeInit<A extends object = Attrs> {
  readonly id?: NodeId; // generated when absent
  readonly attrs?: AttrsPatch<A>;
  readonly ports?: readonly PortInit[];
}

interface Edge<A extends object = Attrs> {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly attrs: ReadAttrs<A>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}

interface EdgeInit<A extends object = Attrs> {
  readonly source: NodeId;
  readonly target: NodeId;
  readonly id?: EdgeId; // generated when absent
  readonly attrs?: AttrsPatch<A>;
  readonly sourcePort?: PortId;
  readonly targetPort?: PortId;
}
```

The `Init` types are what `addNode`, `addEdge`, and `addPort` take, so they are
the names to annotate a helper that builds one with. `direction` is optional on
`PortInit` and required on `Port`: a declaration may leave it out, and a stored
port always has one.

Node and edge records are the graph's own objects, frozen with `Object.freeze`
before the graph stores them. They are values: read them, pass them around,
hold on to them. Writing through one is not merely discouraged, it fails, and
it fails for JavaScript callers too, not just under the TypeScript `readonly`
markers. That is what keeps a stray write from desynchronising the adjacency
indexes.

Because records are frozen, record identity is meaningful. Attribute updates
are copy on write: an updated record is a new object, and a record that did not
change keeps its identity, so `getNode(id) === previousNode` is a valid
"nothing changed here" test.

## Attributes

Nodes, edges, and the graph each carry an attribute bag: string keys, values of
whatever type you say. The graph never reads one. It stores what it is given
and hands it back, so layout, rendering, and application code can keep their
own facts on the same records without the model growing a field per consumer.

The `Graph` class takes three type parameters, one bag each, all defaulting to
`Attrs`. `new Graph()` and a bare `Graph` annotation therefore still mean what
they always did. The constraint on each is `object` rather than `Attrs`, so an
attribute shape can be a `type` alias or an `interface`; only an alias picks up
an implicit index signature, and nothing here needs one.

```ts
type NodeAttrs = { label: string; width: number; height: number };
type EdgeAttrs = { weight: number };
type GraphAttrs = { rankdir: string };

const graph = new Graph<NodeAttrs, EdgeAttrs, GraphAttrs>();

const node = graph.addNode({ id: 'a', attrs: { label: 'A', width: 120 } });
node.attrs.width; // number | undefined

graph.updateAttrs({ rankdir: 'LR' });
graph.updateNodeAttrs('a', { width: 160 }); // label is untouched
graph.updateNodeAttrs('a', { width: undefined }); // width is deleted
```

| Method | Behaviour |
| --- | --- |
| `attrs` | The graph's own bag. The frozen object, not a copy. O(1). |
| `updateAttrs(patch)` | Merges into the graph's bag and returns it. |
| `updateNodeAttrs(id, patch)` | Merges into a node's bag and returns the node record that now answers for the id. Throws `NodeNotFoundError`. |
| `updateEdgeAttrs(id, patch)` | Merges into an edge's bag and returns the edge record that now answers for the id. Throws `EdgeNotFoundError`. |

All three follow the same rules.

**Merge, not replace.** Keys the patch does not name are left alone.

**An explicit `undefined` deletes.** `{ width: undefined }` removes the key, so
`'width' in attrs` becomes false. A bag never holds an `undefined` value, which
is why a read is honestly `T | undefined` and why `ReadAttrs` makes every key
optional. The `| undefined` in `AttrsPatch`'s value position is what makes the
delete form expressible at all under `exactOptionalPropertyTypes`.

**Copy on write, with identity preserved.** If the merge changes something, the
record is replaced by a new frozen record and the old one is left intact and
still holding the old values. If the merge changes nothing, the record already
held comes back, same object. So `updateNodeAttrs(id, patch) === previousNode`
is a real "nothing happened" test, and so is comparing `getNode(id)` across a
sequence of edits. That is the property React memoisation will lean on, so it
is enforced rather than merely likely: an empty patch, a set to the value
already there, and a delete of a key that is not there all return the same
record. Values are compared with `Object.is`, so `NaN` matches itself and `0`
does not match `-0`.

**One record at a time.** Changing a node's attributes never changes any edge
record's identity, and the reverse holds too. Adjacency, degrees, ports, and
iteration order are all untouched: the adjacency indexes hold ids, not records,
so nothing has to be reindexed. The node's `ports` array is handed through to
the new record rather than rebuilt, so it keeps its identity too, and an
attribute update costs O(size of the bag plus size of the patch) with no term
in the port count. That matters because layout will write geometry back through
`updateNodeAttrs` for every node on every run, and a fresh array each time
would invalidate every consumer memoising on `node.ports`.

**Bags are copied in and frozen shallowly.** The object you pass is copied, so
mutating it afterwards cannot reach into the graph. The freeze is one level
deep: a nested object value is stored by reference and stays yours to keep
immutable. If you put a mutable array in an attribute and then mutate it, the
graph will show the change and no record identity will have moved, which is
exactly the situation copy on write cannot help with.

The identity rule is easier to hold as `===` than as prose:

```ts
const before = graph.updateNodeAttrs('a', { width: 160 });

graph.updateNodeAttrs('a', {}) === before;                    // true, empty patch
graph.updateNodeAttrs('a', { width: 160 }) === before;        // true, same value
graph.updateNodeAttrs('a', { height: undefined }) === before; // true, key was absent

graph.updateNodeAttrs('a', { width: 200 }) === before;        // false, a new record
before.attrs.width;                                           // still 160
```

That last line is the half prose carries worst: the record you were holding
keeps its old values rather than being updated underneath you.

## Ports

A port is an attachment point on a node. Layout and routing aim edges at ports
rather than at node centres, so ports are structure, not decoration.

```ts
const graph = new Graph();

graph.addNode({
  id: 'filter',
  ports: [
    { id: 'in', direction: 'in' },
    { id: 'pass', direction: 'out' },
    { id: 'fail', direction: 'out' },
  ],
});
graph.addNode('sink');

graph.addPort('sink', { id: 'in', direction: 'in' });
graph.addEdge({ source: 'filter', target: 'sink', sourcePort: 'fail', targetPort: 'in' });

graph.ports('filter').map((port) => port.id); // ['in', 'pass', 'fail']
graph.hasPort('filter', 'pass'); // true
```

Ports can be declared up front through `addNode({ ports })` or added later with
`addPort`. Either way the order is declaration order and it is stable: a new
port goes last, and removing one does not reorder the rest. `direction`
defaults to `'inout'`, the permissive end of the range, so a port constrains an
edge only once its author says it should. Port ids are unique within their
node, not across the graph, so every port error names both.

| Method | Behaviour |
| --- | --- |
| `addPort(nodeId, init)` | Declares a port and returns the node record that now answers for the id. Copy on write. O(port count). |
| `removePort(nodeId, portId)` | Removes a port and returns the node record that now answers for the id. O(degree plus port count). |
| `hasPort(nodeId, portId)` | Whether the node declares the port. O(1). |
| `getPort(nodeId, portId)` | The port record, or `undefined`. O(1). |
| `ports(nodeId)` | The node's ports, in declaration order. The same frozen array the record carries. O(1). |

All five throw `NodeNotFoundError` for an unknown node: the node is the context
of the question, not part of the answer. Lookups are indexed, not scanned, so
`hasPort` and `getPort` are O(1) however many ports a node has.

`addPort` and `removePort` are copy on write on the node record with the same
identity rules as attributes. Neither has a no-op case: adding a duplicate
throws and removing a port that is not there throws, so both always produce a
new record when they return at all.

### Edges and ports

An edge may name a port at either end, both ends, or neither. When it names
one, the graph checks it:

- the port must be declared on the node that end refers to, or
  `PortNotFoundError`;
- a `sourcePort` must be `'out'` or `'inout'`, since an edge leaves its source,
  or `PortDirectionError`;
- a `targetPort` must be `'in'` or `'inout'`, since an edge arrives at its
  target, or `PortDirectionError`;
- an empty port id is `InvalidIdError` with kind `'port'`.

A self loop may name a port at each end, either two different ports or the same
`'inout'` port twice: such a port passes the source check and the target check
alike, which is part of what earns the `'inout'` default its keep. When no port
is named the key is absent from the record rather than present and `undefined`,
so `'sourcePort' in edge` answers honestly.

Validation runs before anything is written and before the id counter moves, so
a rejected `addEdge` leaves the graph exactly as it was and does not spend a
generated id. The same is true of a rejected `addNode`, port list included.

An edge's port bindings are not write-once. `updateEdgePorts` moves an endpoint
from one port to another, or detaches it, without the edge losing anything:

```ts
graph.updateEdgePorts('e1', { sourcePort: 'pass' }); // rebind the source end
graph.updateEdgePorts('e1', { targetPort: undefined }); // detach the target end
graph.updateEdgePorts('e1', {}); // same record back, nothing named
```

It follows the attribute setters exactly: a key the argument does not name
leaves that end alone, an explicit `undefined` detaches it, every check runs
before anything is written, and it is copy on write with identity preserved
when nothing changes. The edge keeps its id, its endpoints, its attributes, and
its place in edge insertion order, which is the point of having it rather than
removing and re-adding. Same errors as `addEdge`'s port checks, plus
`EdgeNotFoundError`. O(1).

### Why `removePort` refuses rather than cascades

`removePort` throws `PortInUseError` when any live edge still references that
port, and the error carries the ids of those edges. It does not remove them.

Silently deleting edges the caller did not name is a bigger surprise than an
error they can act on, and the error hands back exactly the list they need to
rewire or remove before retrying: `updateEdgePorts` to move an edge off the
port, `removeEdge` to drop it. The cascade already exists where it is
unambiguous: `removeNode` takes the node, its ports, and every incident edge
together, because there is no coherent graph left if it does not.

## Methods

### Counts

| Method | Behaviour |
| --- | --- |
| `nodeCount` | Number of nodes. O(1). |
| `edgeCount` | Number of edges. O(1). |

### Nodes

| Method | Behaviour |
| --- | --- |
| `addNode(init?)` | Adds a node and returns it. `init` is `{ id?, attrs?, ports? }`, or a plain id string as shorthand, or nothing at all. With no id the id is generated. Throws on an empty or duplicate id, and on a duplicate port in the list. |
| `hasNode(id)` | Whether the node is in the graph. O(1). |
| `getNode(id)` | The node record, or `undefined`. O(1). |
| `requireNode(id)` | The node record. Throws `NodeNotFoundError` if the node is unknown. O(1). |
| `removeNode(id)` | Removes the node and every edge incident to it, in-edges, out-edges, and self loops alike. Throws if the node is unknown. O(degree). |
| `nodes()` | Every node, in insertion order, as a fresh array. O(nodeCount). |

### Edges

| Method | Behaviour |
| --- | --- |
| `addEdge(init)` | Adds a directed edge and returns it. `init` is `{ source, target, id?, attrs?, sourcePort?, targetPort? }`, or the positional `(source, target, id?)` as shorthand. With no `id` the id is generated. Throws if either endpoint is unknown, on an empty or duplicate id, and on an unusable port reference. |
| `hasEdge(id)` | Whether the edge is in the graph. O(1). |
| `getEdge(id)` | The edge record, or `undefined`. O(1). |
| `requireEdge(id)` | The edge record. Throws `EdgeNotFoundError` if the edge is unknown. O(1). |
| `updateEdgePorts(id, ports)` | Rebinds the edge's port references and returns the edge record that now answers for the id. `ports` is `{ sourcePort?, targetPort? }`; an absent key leaves that end alone, an explicit `undefined` detaches it. Copy on write. O(1). |
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
      // ... the other eight codes
    }
  }
}
```

`DagrGraphError` is abstract, so every member of the family has a `code`.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `DagrGraphError` | abstract | Base class, abstract, never thrown directly. |
| `InvalidIdError` | `INVALID_ID` | An explicit id is the empty string. Carries `kind` (`'node'`, `'edge'`, or `'port'`) and the offending `id`. |
| `DuplicateNodeError` | `DUPLICATE_NODE` | `addNode` is given an id already in the graph. |
| `NodeNotFoundError` | `NODE_NOT_FOUND` | An operation names a node the graph does not hold. |
| `DuplicateEdgeError` | `DUPLICATE_EDGE` | `addEdge` is given an id already in the graph. |
| `EdgeNotFoundError` | `EDGE_NOT_FOUND` | `removeEdge` names an edge the graph does not hold. |
| `DuplicatePortError` | `DUPLICATE_PORT` | A port id is declared twice on one node. Carries `nodeId` and `portId`. |
| `PortNotFoundError` | `PORT_NOT_FOUND` | An operation names a port the node does not declare. Carries `nodeId` and `portId`. |
| `PortInUseError` | `PORT_IN_USE` | `removePort` names a port live edges still reference. Carries `nodeId`, `portId`, and `edgeIds`. |
| `PortDirectionError` | `PORT_DIRECTION` | An edge asks a port to be an end it does not face. Carries `nodeId`, `portId`, `direction`, and `end`. |

Switching on `code` through `DagrGraphError` narrows the code but not the
object, because an abstract base cannot know its subclasses. `isDagrGraphError`
closes that gap: it narrows a caught value to `DagrGraphErrorLike`, a
discriminated union of the nine concrete classes, so an arm can read the fields
only its own class carries. It tests `instanceof DagrGraphError` and then that
`code` is one of the nine, so the runtime check is as closed as the type it
narrows to.

`DagrGraphError` is a catch base, not an extension point. A subclass declared
outside this package is correctly rejected by `isDagrGraphError`, because the
union it narrows to does not contain it. A package that wants the same
ergonomics should declare its own root class, its own code union, and its own
predicate, so that each package's exhaustive switch stays exhaustive.

```ts
import { isDagrGraphError } from '@dagr/graph';

try {
  graph.removePort('filter', 'fail');
} catch (error) {
  if (isDagrGraphError(error)) {
    switch (error.code) {
      case 'PORT_IN_USE':
        error.edgeIds; // readonly string[], no cast needed
        break;
      // ... the other eight codes
    }
  }
}
```

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
  halves are enforced, not conventions. The one exception is `ports(id)`, which
  hands back the frozen array the node record already carries rather than
  copying it, because that array cannot be written to in the first place.
- Ports are listed in declaration order, and attribute updates never move
  anything: a node keeps its place in iteration order, its ports, and its
  adjacency when its bag changes.

The same sequence of calls therefore always produces the same graph, with the
same ids in the same order.

## Not here yet

Patches and undo, traversal (topological sort, cycle detection, reachability),
and `toJSON`/`fromJSON` are all separate tasks. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in. Until then the graph is identity, shape, adjacency,
attributes, and ports.

Ports carry an id and a direction, and nothing else. Port attribute bags are a
deliberate later decision rather than an omission: layout is what will first
know what a port has to carry (which side of the node it sits on, its offset
along that side, a label), and inventing the bag before then would be guessing.
The addition is source compatible when it comes, so waiting costs nothing.
