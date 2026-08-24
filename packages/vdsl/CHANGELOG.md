# Changelog

All notable changes to `@dagr/vdsl`. Nothing is published yet, so everything
below is unreleased and the version in `package.json` has never been cut.

The file starts with the package for the reason `@dagr/graph`'s gives: this
surface grows a milestone at a time, M6 has six of them, and M5.4's pre-publish
checklist is where a changelog tool gets picked. Starting now is what stops the
v0.2 notes from having to be reconstructed by diffing six milestones of doc
prose.

## Unreleased

### Added

- `defineRegistry(specs, options?)`: the node spec adapter and its registry
  (M6.1). The keys of `specs` are the consumer's node kinds, `K` is inferred
  from them once, and every spec the registry hands back is a `NodeSpec<K>`, so
  a downstream callback can switch on `kind` exhaustively.

  A factory over a literal rather than an `attrs -> spec` predicate, because
  `Node.attrs` is `Readonly<Partial<A>>` and `attrs.kind` is therefore
  `string | undefined` however carefully a consumer typed their graph. Reading
  the attribute still happens, once, inside the registry, guarded by
  `has(kind): kind is K`, which answers out of a `Map` so an inherited property
  name is not a kind.

- `NodeSpec<K>`, `NodeSpecInit`, `PortSpec` and `ConfigCheck`: what a consumer
  declares. A `PortSpec` carries `maxEdges`, absent meaning unbounded, and
  `defineRegistry` refuses a value that is not a positive integer so M6.2 can
  act on what it reads. ENFORCING the cap is M6.2's, not this package's today.

  `checkConfig` takes the node's whole attribute bag and returns strings,
  because which keys are configuration is the consumer's question and a
  structured issue type would be a schema format of Dagr's invention by another
  name.

- `NodeRegistry<K>`: `kinds`, `kindKey`, `has`, `get`, `port`, `kindOf`,
  `resolve`, `tryResolve`, `checkConfig` and `nodeInit`. `resolve` throws,
  `tryResolve` and `kindOf` report, and `nodeInit` builds a `NodeInit` for
  `graph.addNode` with the declared ports and the kind attribute written last,
  so a caller's own attributes cannot mislabel the node.

- `DagrVdslError` and the three errors under it: `InvalidSpecError`,
  `NodeKindMissingError` and `UnknownNodeKindError`, plus `DagrVdslErrorCode`,
  `DagrVdslErrorLike` and `isDagrVdslError`. Its own family rather than a
  subclass of `DagrGraphError`, on that module's instruction.
