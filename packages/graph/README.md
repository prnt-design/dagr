# @dagr/graph

The typed directed graph model everything else in [Dagr](https://dagr.prnt.design)
is built on: stable node identity, adjacency, attributes, ports, patches,
traversal and serialization, with **zero runtime dependencies**.

```sh
pnpm add @dagr/graph
```

```ts
import { Graph, NodeNotFoundError } from '@dagr/graph';

const graph = new Graph();

graph.addNode({ id: 'ingest', attrs: { label: 'Ingest' } });
graph.addNode({ id: 'parse', ports: [{ id: 'in', direction: 'in' }] });
graph.addNode('layout'); // shorthand for { id: 'layout' }
const generated = graph.addNode(); // id 'n1'

graph.addEdge({ source: 'ingest', target: 'parse', id: 'first', targetPort: 'in' });
graph.addEdge('parse', 'layout'); // shorthand for { source, target }

graph.successors('parse'); // ['layout']
graph.removeNode('parse'); // takes its incident edges with it

try {
  graph.successors('parse');
} catch (error) {
  if (error instanceof NodeNotFoundError) {
    // error.code === 'NODE_NOT_FOUND'
  }
}
```

## Read this first: `Graph` is nominally typed

`Graph` carries `#private` fields, so **two copies of `@dagr/graph` in one
dependency tree are not interchangeable**. Passing one copy's `Graph` where the
other's is expected does not merely behave oddly, it fails to compile with
`separate declarations of a private property '#nodes'`.

That is why `@dagr/layout` and `@dagr/vdsl` declare this package as a
`peerDependency` rather than a dependency: a caret range on a 0.x package does
not cross a minor, so `^0.1.0` and `^0.2.0` would resolve to two installed
copies and every call that hands a graph across the boundary would stop
compiling. If you see that error, run your package manager's dedupe and check
you have one `@dagr/graph`, not a version mismatch in your own code.

## Mutations are observable, and that is the point

Every mutation emits a patch, and `subscribe` returns the function that stops
watching, which is the shape `useSyncExternalStore` wants:

```ts
const stop = graph.subscribe((patch) => {
  // A Patch IS the frozen list of ops, in the order they happened.
  for (const op of patch) {
    switch (op.op) {
      case 'add-node':
        break;
      default:
        break; // PatchOp is an OPEN union: always take a default arm
    }
  }
});

graph.batch(() => {
  graph.addNode('a');
  graph.addNode('b');
}); // one patch, at the close
```

`PatchOp` is an open union by declaration. New op kinds arrive in minor
releases, so write `default:` rather than a `never` exhaustiveness check, or a
future member breaks your build. `batch` bodies must be synchronous: the patch
is emitted when the callback returns.

`apply` and `invert` are exported beside them, which is what makes undo a
property of the model rather than something a caller reimplements.

## Containment

A node may carry `parent`, at most one, and containment is acyclic. `@dagr/layout`
currently ignores it: the field is the model, not the layout. Inline compound
layout is M7 on the [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md).

## Documentation

The full model, every error code, and the serialization format are on the
[graph model](https://dagr.prnt.design/docs/graph-model) page.

MIT © prnt.design
