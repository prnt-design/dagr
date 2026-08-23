---
id: vdsl
title: Node spec toolkit
sidebar_position: 7
---

# Node spec toolkit

`@dagr/vdsl` is the layer where your node graph stops being a graph and starts
being a language: what kinds of node exist, what ports they have, and what
counts as a valid configuration for one. [Visual languages](./visual-languages.md)
is the design brief for the milestone. This page is what exists today, which is
the first piece of it: the adapter interface and the registry that resolves a
node to a spec.

Dagr defines that interface and nothing behind it. There is no built-in node
kind, no opinion about what a `source` or a `transform` is, and no config
schema format of Dagr's invention. A kind is whatever you say it is, and its
configuration is checked by a function you supply.

## Usage

```ts
import { Graph } from '@dagr/graph';
import { defineRegistry } from '@dagr/vdsl';

const registry = defineRegistry({
  source: { ports: [{ id: 'out', direction: 'out' }] },
  filter: {
    ports: [
      { id: 'in', direction: 'in', maxEdges: 1 },
      { id: 'out', direction: 'out' },
    ],
    checkConfig: (attrs) =>
      typeof attrs.threshold === 'number' ? [] : ['threshold must be a number'],
  },
  sink: { ports: [{ id: 'in', direction: 'in' }] },
});

const graph = new Graph();
const filter = graph.addNode(registry.nodeInit('filter', { attrs: { threshold: 0.5 } }));

registry.resolve(filter).kind; // 'filter'
registry.checkConfig(filter); // []
registry.port('filter', 'in'); // { id: 'in', direction: 'in', maxEdges: 1 }
```

## The kinds are the keys

`defineRegistry` takes an object literal whose keys are your kinds, and infers
the union of them once, here. Everything the registry hands back is typed
against that union, so a hover or drag callback given a `NodeSpec<'source' |
'filter' | 'sink'>` can switch on `kind` and have the compiler tell it when a
case is missing.

That is why the entry point is a factory taking a literal, rather than a
predicate you write that reads a node and returns a spec. A node's attributes
are `Readonly<Partial<A>>`, because any attribute can be absent, so
`attrs.kind` is `string | undefined` however carefully you typed your graph. A
predicate reading it erases your kind union at the boundary and every callback
downstream lands on a cast.

Reading the attribute still has to happen somewhere, and it happens inside the
registry, once, guarded by a real membership test:

```ts
const fromTheUrlBar: string = readSomewhere();

if (registry.has(fromTheUrlBar)) {
  registry.get(fromTheUrlBar); // narrowed to your kind union
}
```

`has` is the one door from `string` into the union, and it answers by looking
in a `Map` rather than with `in`, so `'toString'` is not a kind.

## Resolving a node

Three methods read a node, and they differ only in what they do when the answer
is not there.

| Method | A node of a declared kind | Anything else |
| --- | --- | --- |
| `kindOf` | the kind | `undefined` |
| `tryResolve` | the spec | `undefined` |
| `resolve` | the spec | throws |

`resolve` throws two different errors, because the two failures have different
causes and different fixes. `NodeKindMissingError` means the node does not
legibly declare a kind: the attribute is absent, or it holds something that is
not a string. `UnknownNodeKindError` means it named a kind this registry was
never given, and it carries the kinds that were, which is the list a consumer
wants in the message.

The attribute read is `kind` by default and configurable, because a consumer
with an existing attribute vocabulary should not have to rename it:

```ts
const registry = defineRegistry({ source: {} }, { kindKey: 'type' });
```

## Ports and arity

A `PortSpec` is what every node of a kind is promised to have, where
`@dagr/graph`'s `Port` is what one node does have. They differ by `maxEdges`,
which is a rule about a port rather than a property of one, and which the graph
model deliberately does not enforce: `Graph` permits any topology by design.

`maxEdges` is a cap rather than the usual `'single' | 'multiple'` word. A
number is the general case and the word is its two useful values, so nothing is
lost, and a union declared here is a union your exhaustive `switch` breaks on
when a third case arrives. Absent means unbounded, rather than `Infinity`,
because `Infinity` does not survive `JSON.stringify` and a spec you cannot
serialise is a spec you cannot ship a fixture of.

`defineRegistry` refuses a `maxEdges` that is not a positive integer, along
with an empty kind, an empty port id, and a port id declared twice in one kind.
It refuses at define time rather than reporting at use time, because a registry
is built once from a literal, usually at module scope, and a bad spec is a bug
in your source rather than in your data. The same port id in two different
kinds is fine: port ids are unique within a node, not across a graph.

`registry.port(kind, portId)` returns `undefined` for a port the kind does not
declare, and throws `UnknownNodeKindError` for a kind the registry does not
hold, which is what `get` does and for the same reason: an undeclared kind has
no ports for a port to be absent from. The compiler stops both being called
that way, and JavaScript reaches them with any string at all.

Enforcing the cap is not here. A spec says what the rule is; validating a
proposed connection against it is M6.2's task, and what this package does today
is refuse a value M6.2 could not act on.

## Config is yours

`checkConfig` is handed the node's whole attribute bag and returns a list of
problems. An empty list is a valid config, and every string is something to put
in front of a user.

```ts
const registry = defineRegistry({
  filter: {
    checkConfig: (attrs) => {
      const issues: string[] = [];
      if (typeof attrs.threshold !== 'number') issues.push('threshold must be a number');
      if (attrs.mode !== 'high' && attrs.mode !== 'low') issues.push('mode must be high or low');
      return issues;
    },
  },
});
```

The whole bag, rather than a `config` sub-object, because which keys are
configuration is your question and not Dagr's: deciding it here would be
defining the ontology this package exists not to define. Strings, rather than a
structured issue type, for the same reason at one remove: a structured form is
a schema format of Dagr's invention by another name, and you already have one.
This is where `zod`'s issues, `valibot`'s, or a hand-written check hands its own
message across.

`registry.checkConfig(node)` resolves the node first, so a node of an
undeclared kind throws rather than passing validation by having no validator. A
kind that declared no check reports nothing.

## Building a node from a kind

`nodeInit` returns a `NodeInit` for `graph.addNode`: the ports the kind
declares, the kind attribute, and whatever you add.

```ts
type NodeAttrs = { kind: 'source' | 'filter' | 'sink'; label: string };

const graph = new Graph<NodeAttrs>();
const node = graph.addNode(registry.nodeInit('filter', { attrs: { label: 'Threshold' } }));
```

The attribute type comes from you, inferred from the graph the init is handed
to, so `label` is checked against your own type. Declaring the kind key in that
type (`kind: 'source' | 'filter' | 'sink'` above) is worth doing and is not
required: the registry writes the attribute either way, because `Graph` stores
what it is given.

Two things it will not do. The kind attribute is written last, so your `attrs`
cannot mislabel the node they are building. And ports are not takeable from the
caller, because the spec is what says which ports a kind has, and a node that
quietly gained one would resolve to a spec that does not describe it.

## Errors

Every error extends `DagrVdslError` and carries a `code`, so one `instanceof`
catches the family and a `switch` over `code` stays exhaustive.
`isDagrVdslError` narrows a caught value to the closed union of the three.

| Class | `code` | Thrown when |
| --- | --- | --- |
| `InvalidSpecError` | `INVALID_SPEC` | a declared kind is one the toolkit could not act on |
| `NodeKindMissingError` | `NODE_KIND_MISSING` | a node declares no legible kind |
| `UnknownNodeKindError` | `UNKNOWN_NODE_KIND` | a node names a kind this registry does not hold |

This is a separate family from `@dagr/graph`'s rather than a subclass of it,
on that package's own instruction: each package keeps its own root, its own
code union and its own predicate, so each one's exhaustive switch stays
exhaustive over its own errors.

## Not here yet

- **Port type tokens and connection validation** (M6.2). A type token per port,
  a compatibility predicate you supply, and a proposed connection checked
  against it and against `maxEdges`. Cycle rejection is a policy your adapter
  declares rather than a default: `Graph` permits cycles by design.
- **Drag-to-connect** (M6.3), on top of the interaction hooks and GPU picking.
  That is the task where this package first needs React, which is why
  `@dagr/react` is not a peer dependency yet.
- **Subgraph nodes and drill-down** (M6.4), on the containment M5.5 reserves in
  the graph model.
- **Collapse and expand** (M6.5), and **two reference languages** built on the
  toolkit (M6.6), which is the cheapest available test of whether any of this
  generalises past one consumer.

There is also no per-kind payload of your own on a `NodeSpec`: no label, no
colour, no category. That is a real want and the shape it should take is
decided by what M6.3's callbacks actually need to read, so it waits for a
consumer to ask, the way `@dagr/graph` keeps `traversal.ts` unexported and
`@dagr/layout` keeps every stage but `defaultStages` internal. Until then,
`registry.kinds` is typed and exhaustive, so a
`Record<Kind, YourPayload>` of your own is checked for completeness by the
compiler.
