# @dagr/vdsl

A toolkit for building a node-graph language on [Dagr](https://dagr.prnt.design):
the node spec adapter, its registry, and the rules that decide whether two ports
may be connected.

It is a toolkit and **not a language**. Dagr does not define what a node means,
what types exist, or how they relate. You declare your kinds and your rules; this
package makes them typed and asks them in the right order.

```sh
pnpm add @dagr/vdsl @dagr/graph
```

`@dagr/graph` is a types-only `peerDependency`. This package has **no runtime
dependencies at all**.

```ts
import { Graph } from '@dagr/graph';
import { defineRegistry } from '@dagr/vdsl';

const registry = defineRegistry({
  source: { ports: [{ id: 'out', direction: 'out', type: 'number' }] },
  filter: {
    ports: [
      { id: 'in', direction: 'in', type: 'number', maxEdges: 1 },
      { id: 'out', direction: 'out', type: 'number' },
    ],
    checkConfig: (attrs) =>
      typeof attrs.threshold === 'number' ? [] : ['threshold must be a number'],
  },
  sink: { ports: [{ id: 'in', direction: 'in', type: 'number' }] },
});

const graph = new Graph();
const filter = graph.addNode(registry.nodeInit('filter', { attrs: { threshold: 0.5 } }));

registry.resolve(filter).kind; // 'filter'
registry.checkConfig(filter); // []
```

## The kinds are the keys

`defineRegistry` takes an object literal whose keys are your kinds and infers the
union of them once, here. Everything the registry hands back is typed against
that union, so a callback given a `NodeSpec<'source' | 'filter' | 'sink'>` can
switch on `kind` and have the compiler tell it when a case is missing.

That is why the entry point is a factory taking a literal rather than a predicate
you write. A node's attributes are `Readonly<Partial<A>>`, so `attrs.kind` is
`string | undefined` however carefully you typed your graph, and a predicate
reading it erases your union at the boundary. The read happens inside the
registry, once, guarded by a real membership test.

## Read this first: Dagr never compares two type tokens

A port carries a `type`, and this package **stores it without ever deciding what
equality means**. Equal-tokens-connect is wrong for every language with a subtype
relation, an `any`, or a coercion, so comparing tokens by default would be the
ontology this package exists not to define, arriving by the back door.

`sameType` is that rule written out as a value you name, declared on the kind
that wants it rather than on the registry, because a connection rule is a rule
about a pair and either end may hold one:

```ts
import { defineRegistry, sameType } from '@dagr/vdsl';

const registry = defineRegistry({
  source: { ports: [{ id: 'out', direction: 'out', type: 'number' }] },
  sink: { ports: [{ id: 'in', direction: 'in', type: 'number' }], canConnect: sameType },
});
```

Write your own predicate instead and it decides. It is handed two kinds and two
ports and **no graph and no node ids**, which is forced rather than tasteful: it
has to be answerable for a drag aimed at a node that does not exist yet.

## Asking, rather than trying

Two entry points, and the split is derived from that same case:

- `checkPorts` takes two kinds and no graph. The cap and the cycle rule are
  vacuous for a node about to be created, so this is the whole answer for a drag
  in flight.
- `checkConnection` adds `maxEdges` and the cycle check against a real graph.

Both ask **source first, and the first refusal wins**, in a fixed order that is
part of the contract: `no-such-port`, `wrong-direction`, `incompatible`,
`port-full`, `would-cycle`.

The line between a refusal and a thrown error is not how bad it is, it is **whose
fact it is**. A port a kind does not declare comes back as a refusal, because a
miss is an ordinary outcome of a hit test. A node the graph does not hold, or one
carrying an undeclared kind, throws: that is a bug in your own data.

`maxEdges` caps the edges **at** a port, not the edges through it in one
direction, which is only visible on an `inout` port.

## Documentation

The full registry surface, the refusal codes and the reasoning are on the
[visual languages](https://dagr.prnt.design/docs/vdsl) page.

MIT © prnt.design
