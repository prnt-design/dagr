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
ports for edges to attach to. Every mutation emits a patch, the flat and
invertible description of what that call did, so a consumer can follow the
graph instead of polling it. All three are described below.

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

## Patches

Every state-changing call emits exactly one patch: an ordered, flat array of
ops saying what that call did. A call that changes nothing emits nothing at
all, not an empty patch.

That second half is the emission-side twin of the copy-on-write identity rule
the attributes section sets out. There, a merge that changes nothing hands back
the record already held, so `updateNodeAttrs(id, patch) === previousNode` is a
real "nothing happened" test. Here, the same comparison decides whether a patch
is emitted, so a listener never has to filter no-ops out for itself. No change,
no new record, no patch: one rule, seen from the store and from the wire.

Flat means the array is ops and nothing else, with no nesting and no grouping.
Cascade-free means an op names one thing and does one thing. `removeNode` takes
its incident edges with it, so it emits a `remove-edge` op per edge followed by
the `remove-node` op, rather than one op a consumer would have to expand for
itself. Two things follow, and both are load bearing. Replaying such a patch
never re-triggers the cascade, because the edges are already gone by the time
the node op runs. And reversing the array is the right undo order, because the
node comes back before the edges that need it to exist.

| Function | Behaviour |
| --- | --- |
| `graph.subscribe(listener)` | Registers a patch listener and returns the function that unregisters it. O(1). |
| `apply(graph, patch)` | Replays a patch onto a graph, op by op, in order. O(op count). |
| `invert(patch)` | The patch that undoes `patch`. Pure. O(op count). |

```ts
type Patch<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> = readonly PatchOp<NodeAttrs, EdgeAttrs, GraphAttrs>[];

type PatchListener<
  NodeAttrs extends object = Attrs,
  EdgeAttrs extends object = Attrs,
  GraphAttrs extends object = Attrs,
> = (patch: Patch<NodeAttrs, EdgeAttrs, GraphAttrs>) => void;
```

`Patch` takes the same three attribute type parameters `Graph` does, in the
same order and with the same defaults, so a `Graph<NodeAttrs, EdgeAttrs,
GraphAttrs>` hands its listeners a `Patch<NodeAttrs, EdgeAttrs, GraphAttrs>`
and the attribute bags inside the ops are typed rather than `unknown`. A patch
is frozen, ops included, so it can be handed to several listeners and kept by
any of them.

### Subscribing

`subscribe` returns its own unsubscribe function, so a caller never has to hold
the listener to stop it. Nothing is journalled: a graph nobody subscribed to
builds no ops at all, so watching is a cost you opt into.

The clearest use is a second graph kept in step with the first, which is what
incremental layout will do with the patches it is handed:

```ts
import { Graph, apply } from '@dagr/graph';

const graph = new Graph();
const mirror = new Graph();

const stop = graph.subscribe((patch) => {
  apply(mirror, patch);
});

graph.addNode({ id: 'ingest', attrs: { label: 'Ingest' } });
graph.addNode({ id: 'parse', ports: [{ id: 'in', direction: 'in' }] });
graph.addEdge({ source: 'ingest', target: 'parse', id: 'first', targetPort: 'in' });
graph.updateNodeAttrs('ingest', { label: 'Ingest v2' });

mirror.nodeCount; // 2
mirror.edgeCount; // 1
mirror.requireNode('ingest').attrs.label; // 'Ingest v2'
mirror.requireNode('parse').ports; // [{ id: 'in', direction: 'in' }]

graph.removeNode('parse'); // one patch: remove-edge, then remove-node
mirror.nodeCount; // 1
mirror.edgeCount; // 0

stop(); // the mirror stops tracking here
```

`apply` is an ordinary caller of the public API, so the mirror emits its own
patches as it is written to and can be subscribed to in turn. Nothing is
transactional either: an op the graph rejects throws that graph error out of
`apply`, with the ops before it already applied.

### The ops

`PatchOp` is a discriminated union on `op`, ten tags in all. Every op object,
and every bag inside it, is frozen. On the add and remove ops the bags and port
arrays are the same frozen references the records already hold; the four
`update-*` ops carry diff bags built fresh for the emission, holding only the
keys that moved. Either way an op costs a small object and no deep copy, since
the values inside are the caller's own references.

| `op` | Payload | Emitted by |
| --- | --- | --- |
| `add-node` | `id`, `attrs`, `ports` | `addNode` |
| `remove-node` | `id`, `attrs`, `ports` | `removeNode`, last in its patch |
| `add-edge` | `id`, `source`, `target`, `attrs`, `sourcePort?`, `targetPort?` | `addEdge` |
| `remove-edge` | `id`, `source`, `target`, `attrs`, `sourcePort?`, `targetPort?` | `removeEdge`, and `removeNode` once per incident edge |
| `add-port` | `nodeId`, `port`, `index` | `addPort` |
| `remove-port` | `nodeId`, `port`, `index` | `removePort` |
| `update-node-attrs` | `id`, `after`, `before` | `updateNodeAttrs` |
| `update-edge-attrs` | `id`, `after`, `before` | `updateEdgeAttrs` |
| `update-graph-attrs` | `after`, `before` | `updateAttrs` |
| `update-edge-ports` | `id`, `after`, `before` | `updateEdgePorts` |

Each remove op carries everything its matching add op needs, which is what lets
`invert` swap the tag and keep the payload. An unbound edge end is an absent
key on `add-edge` and `remove-edge`, never a key present and `undefined`, the
same distinction the edge records draw.

Ports declared in `addNode({ ports })` ride along on the `add-node` op rather
than arriving as separate `add-port` ops: one call, one op. `add-port` is what
`addPort` emits, and its `index` is always the last position, because a new
port goes last. `remove-port` records the index the port sat at before it went.

Within a `removeNode` patch the edge ops come in detachment order, out-edges
before in-edges and each group in edge insertion order, and then the node op.
A self loop is incident to its node twice but is detached once, so it
contributes one `remove-edge` op, not two.

### Normalisation

The four `update-*` ops carry two bags of the same shape. `after` names exactly
the keys that moved and holds their new values; `before` names the same keys
and holds their prior values. A key present with the value `undefined` means
"was absent", which is exactly what that value already means to
`updateNodeAttrs` and friends: setting it deletes the key.

The pair is named for the states it spans rather than for the argument it came
from, which is the whole contract in two words: `before` is what those keys held
going in, `after` is what they hold coming out, and inverting is visibly the
swap of one for the other.

```ts
graph.updateNodeAttrs('a', { width: 120 });
// { op: 'update-node-attrs', id: 'a', after: { width: 120 }, before: { width: undefined } }

graph.updateNodeAttrs('a', { width: 160, label: 'A' });
// after: { width: 160, label: 'A' }, before: { width: 120, label: undefined }

graph.updateNodeAttrs('a', { width: undefined });
// after: { width: undefined }, before: { width: 160 }

graph.updateNodeAttrs('a', { width: undefined }); // nothing changes, nothing emitted
```

Two halves matter here and both are enforced. Only keys that actually moved
appear: a patch key set to the value already stored is left out of both bags,
and if that leaves nothing, no op and no patch is emitted at all. And absence
is spelled out rather than left out, so the two bags always name the same keys.

That is what makes `invert` a swap. Exchanging `after` and `before` gives an op
that restores the prior state exactly, absences included, without anything
having to consult the graph. `update-edge-ports` is normalised the same way
over `sourcePort` and `targetPort`: an end that did not move is in neither bag,
and an unbound end is named with an explicit `undefined`.

### Inverting

`invert(patch)` reverses the array and inverts each op. Adds and removes swap
their tag and keep their payload; the four `update-*` ops swap their two bags.
It is pure: the patch handed in is not touched, and the one handed back is
frozen, ops included. `invert(invert(patch))` is structurally the patch you
started with.

The reversal is what makes an undo of a cascade land in the right order.
`removeNode('b')` on a node with two incident edges emits three ops, the two
`remove-edge`s first and `remove-node b` last. The inverse leads with
`add-node b` and puts the two `add-edge`s after it: the node first, then the
edges that need it to exist. An unreversed inverse would try to add an edge to
a node that is not there yet.

```ts
import { apply, invert } from '@dagr/graph';
import type { Patch } from '@dagr/graph';

const undo: Patch[] = [];
const stop = graph.subscribe((patch) => {
  undo.push(invert(patch));
});

graph.removeNode('parse'); // takes its incident edges with it

stop(); // so that undoing does not record its own undo

const last = undo.pop();
if (last !== undefined) apply(graph, last); // the node and its edges are back
```

### Applying, and what replay does not restore

`apply` restores content exactly. Every node, edge, port, and attribute comes
back with the same ids and the same values, and edges keep their endpoints and
their port bindings. It does not restore insertion order.

A replayed element takes its place at the end of iteration order, exactly as it
would if the caller had re-added it by hand, because that is what happened.
Iteration order is a function of insertion history, the determinism section
says so already ("a node or edge that is removed and added again counts as a
new insertion, so it moves to the end of iteration order"), and a replayed or
inverted patch is new insertion history. Undoing `removeNode('a')` on a graph
of `a`, `b`, `c` therefore gives you a graph of `b`, `c`, `a`.

```ts
const patches: Patch[] = [];
const stop = graph.subscribe((patch) => {
  patches.push(patch);
});

graph.nodes().map((node) => node.id); // ['a', 'b', 'c']
graph.removeNode('a');
stop();

const removal = patches[0];
if (removal !== undefined) apply(graph, invert(removal));

graph.nodes().map((node) => node.id); // ['b', 'c', 'a'], same content, new order
```

`remove-port` records the `index` the port sat at anyway, and that is not an
oversight. The index is part of an honest description of what the mutation did,
and a consumer tracking positions (a renderer holding a port row per node, say)
needs it whether or not `apply` uses it. Today `apply` appends. Whether replay
should become order faithful is a decision for the first milestone that needs
it, which is incremental layout, and it is recorded on the roadmap rather than
guessed at here.

### Listener semantics

**Patches arrive after the call is committed.** A listener reads a graph that
already shows everything the patch describes, and the ops it is handed describe
the transition it just missed, not one about to happen.

**Every listener runs, in subscription order, even if one throws.** The errors
are collected and rethrown after the walk as a single `PatchListenerError`,
whatever the count: `errors` holds them in listener order and `cause` is the
first of them. The mutation stays committed either way. A throwing listener is
a broken listener, not a rolled back mutation.

That wrapper is not decoration, and it is deliberately not a `DagrGraphError`:
`isDagrGraphError` answers `false` for it. The graph accepted and committed the
call before any listener ran, so a listener's own error arriving unwrapped from
the mutating call would be indistinguishable from the graph having refused that
call. Mirroring makes the collision routine rather than exotic. `apply` is not
transactional, so a mirror that has drifted throws a `DuplicateNodeError` at the
listener, and `source.addNode('a')` would report a duplicate for a node the
source was perfectly happy to take. One wrapper, one meaning: a `DagrGraphError`
out of a mutation means the graph refused it, a `PatchListenerError` means it
did not.

**Emission runs over a snapshot of the listener set.** A listener that
subscribes or unsubscribes during an emission changes who is called from the
next patch, not from the middle of this one, so a listener list edited mid
emission can neither skip a listener nor call one twice. Subscribing the same
function twice registers it once.

**A listener that mutates the graph is served depth first.** This one is worth
tracing, because the ordering surprises. A mutation made from inside a listener
is an ordinary mutation: it commits, and then it emits, immediately, inside the
call the listener is still sitting in. The nested patch reaches every listener,
the mutating one included, before the outer emission resumes. So with listeners
`A` then `B`, where `A` responds to `add-node a` by adding `b`:

```
A sees add-node a      the outer patch
A sees add-node b      the nested patch, delivered inside A's own call
B sees add-node b      the nested patch, still inside A's call
A returns
B sees add-node a      the outer patch, last
```

`B` sees the effect before the cause. Nothing queues, coalesces, or defers, and
there is no re-entrancy guard, so a listener that mutates on every patch will
recurse until the stack gives out. Two smaller consequences fall out of the
same trace: a listener subscribed during the outer emission misses the outer
patch but does receive the nested one, since the nested emission takes its own
snapshot, and an error thrown during a nested emission propagates out of the
mutating call, which means an uncaught one is collected by the outer emission
and rethrown from the outer mutation.

Mirroring is unaffected by all of this, because the listener mutates a
different graph. If you do have to mutate the graph you are listening to, and
the order other listeners observe matters, record the work and do it after the
emission rather than inline.

**A listener must be synchronous, and nothing stops you passing one that is
not.** `PatchListener` returns `void`, so an `async` function is assignable with
no cast and no warning, and then the graph never sees the promise it hands back.
Three things follow, and the first is the one that bites. A failure inside an
async listener becomes an unhandled rejection rather than being collected: the
mutation does not throw, `PatchListenerError` never happens, and depending on
the host the process either logs it somewhere you are not looking or exits.
Anything after the first `await` runs against a graph that may have moved on by
several mutations, so the patch in hand no longer describes the transition just
made. And ordering is gone, since a listener that returns at its first `await`
has not finished when the next one starts. If the work has to be asynchronous,
make the listener itself synchronous: push the patch onto a queue and drain the
queue outside the emission.

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

Every error the graph throws to refuse a call extends `DagrGraphError`, so one
`catch` with one `instanceof` test covers the family. The one exported error
class outside it is `PatchListenerError`, which is thrown after a call is
committed rather than instead of committing it, and the listener semantics
section above says why that distinction is worth a class of its own.

`DagrGraphError` declares a `code` field, typed as the
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

Traversal (topological sort, cycle detection, reachability) and
`toJSON`/`fromJSON` are separate tasks. See
[ROADMAP.md](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for the
order they arrive in. Until then the graph is identity, shape, adjacency,
attributes, ports, and patches.

Patches describe single calls. There is no batching or transaction API, so
several mutations cannot be coalesced into one patch, and no listener sees a
half-finished edit: each call commits and emits on its own. That is deliberate
rather than pending. Nothing needs the coalesced form yet, and incremental
layout is what will say what shape it wants, so inventing it now would be
guessing in the same way a port attribute bag would have been.

Ports carry an id and a direction, and nothing else. Port attribute bags are a
deliberate later decision rather than an omission: layout is what will first
know what a port has to carry (which side of the node it sits on, its offset
along that side, a label), and inventing the bag before then would be guessing.
The addition is source compatible when it comes, so waiting costs nothing.
