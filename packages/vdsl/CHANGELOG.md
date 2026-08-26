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
  `defineRegistry` refuses a value that is not a positive integer, and M6.2's
  `checkConnection` is what enforces the cap.

  `checkConfig` takes the node's whole attribute bag and returns strings,
  because which keys are configuration is the consumer's question and a
  structured issue type would be a schema format of Dagr's invention by another
  name.

- `NodeRegistry<K>`: `kinds`, `kindKey`, `has`, `get`, `port`, `kindOf`,
  `resolve`, `tryResolve`, `checkConfig` and `nodeInit`. `resolve` throws,
  `tryResolve` and `kindOf` report, and `nodeInit` builds a `NodeInit` for
  `graph.addNode` with the declared ports and the kind attribute written last,
  so a caller's own attributes cannot mislabel the node.

- `PortSpec.type`, `NodeSpecInit.canConnect` and `sameType`: port type tokens
  and the rule that reads them (M6.2). The token is a string this package
  stores and never interprets, because the obvious comparison (equal tokens
  connect) is wrong for every language with a subtype relation, an `any`, or a
  coercion. `sameType` is that comparison written out as a value, so a consumer
  who wants it names it.

  `canConnect` is asked at BOTH ends of a proposed connection, source first,
  and returns one string rather than `checkConfig`'s list, because a connection
  is a decision and a config is a report. It is handed no graph and no node
  ids, which is forced by `checkPorts` existing at all.

- `NodeRegistry.checkPorts` and `NodeRegistry.checkConnection`, plus
  `RegistryOptions.rejectCycles` and `NodeRegistry.rejectsCycles` (M6.2).
  `checkPorts` answers the port, direction and `canConnect` questions from the
  kinds alone; `checkConnection` adds the two only a graph can answer, the
  `maxEdges` cap and the cycle. First refusal wins, and the graph is not
  mutated to find out.

  Cycle rejection is a policy the adapter declares rather than a default:
  `Graph` permits cycles by design and M6.6 mandates a reference language with
  feedback. The question is `source === target || graph.canReach(target,
  source)` and not add-then-`findCycle`-then-remove, which emits two patches
  and pollutes an undo stack.

- `ConnectionCheck`, `ConnectionEnd`, `ConnectionEnds`, `ConnectionAllowed`,
  `ConnectionRefused`, `ConnectionRefusalCode`, `ConnectionCheckResult`,
  `PortRef` and `ProposedConnection`: the types the above are written in. A
  refusal carries a `code` a caller branches on and a `reason` it shows, where
  a config check carries only strings, because every refusal but `incompatible`
  is authored by Dagr and an English sentence is not something a consumer can
  localise.

- `DagrVdslError` and the three errors under it: `InvalidSpecError`,
  `NodeKindMissingError` and `UnknownNodeKindError`, plus `DagrVdslErrorCode`,
  `DagrVdslErrorLike` and `isDagrVdslError`. Its own family rather than a
  subclass of `DagrGraphError`, on that module's instruction.
