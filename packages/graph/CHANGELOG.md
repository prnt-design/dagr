# Changelog

All notable changes to `@dagr/graph`. Nothing is published yet, so everything
below is unreleased and the version in `package.json` has never been cut.

`@dagr/layout` keeps one of these because its milestones change what it returns
without changing a type. This package's reason is different and simpler: it is
the one every other package depends on, its surface grows a milestone at a time,
and M5.4's pre-publish checklist is where a changelog tool gets picked. Starting
the file now is what stops the v0.1 notes from having to be reconstructed by
diffing five milestones of doc prose.

## Unreleased

### Added

- Serialization: `graph.toJSON()` and the static `Graph.fromJSON(json)`, with
  the document types `GraphJSON`, `NodeJSON`, `EdgeJSON`, and `PortJSON` (M1.5).
  Additive again, so nothing under a caller moves.

  `toJSON` is named for the standard protocol, so `JSON.stringify(graph)` is the
  whole file. The document is `{ version: 1, attrs?, nodes, edges }`, both
  listings always present and everything empty left out.

  The round trip is order preserving, which is a stronger promise than `apply`
  makes: `fromJSON` replays both arrays in document order, so iteration order,
  port declaration order, neighbour order, and the `topologicalOrder` tie-break
  all come back. Three things do not survive and are documented rather than
  quietly true. Generated-id counters are re-derived from content, which lands
  the counter one past the highest surviving id in generated shape, so a higher
  suffix spent by a removed element is free again. Absolute insertion ranks are
  compacted, which nothing can observe. Attribute values pass through by
  reference and are neither validated nor cloned, so a value `JSON.stringify`
  cannot represent is the caller's problem.

- `InvalidGraphJSONError`, exported, `code: 'INVALID_GRAPH_JSON'`, the eleventh
  member of the `DagrGraphError` family. Carries `path`, where the offending
  field sits in the document (`nodes[3].ports[1].direction`), and `expected`.
  Thrown only by `Graph.fromJSON`, and only for shape.

  It covers shape alone on purpose. Content that the graph itself has an opinion
  about (a duplicate id, an unknown endpoint, a port facing the wrong way, an
  empty id) comes back as the family member it always was, because `fromJSON`
  builds through the same public constructors and so cannot construct a graph
  the public API could not.

  This widens `DagrGraphErrorCode` and `DagrGraphErrorLike` for the second
  release running. An exhaustive `switch` over either now has a missing arm,
  which is a compile error rather than a silent fallthrough, and is the only way
  this release can break a build.

- Traversal on `Graph`: `topologicalOrder`, `isAcyclic`, `findCycle`, `sources`,
  `sinks`, `descendants`, `ancestors`, and `canReach` (M1.4). Additive, so the
  compiler tells a caller nothing changed under them.

  Three parts of the contract are decisions rather than consequences and are
  worth reading before relying on them. `topologicalOrder` breaks ties by node
  insertion rank, so its answer never depends on the order edges were added,
  which costs a heap and makes it `O((V + E) log V)`. It throws on a cyclic
  graph rather than returning a partial order. And `descendants`/`ancestors`
  exclude their own node even when a cycle leads back to it, while
  `canReach(a, a)` stays true in exactly that case, which is the one place the
  two disagree and is how you ask whether a node sits on a cycle.

- `CycleError`, exported, `code: 'CYCLE'`, the tenth member of the
  `DagrGraphError` family. Carries `cycle`, the nodes on one cycle in traversal
  order with the endpoint listed once. Thrown only by `topologicalOrder`.

  This widens `DagrGraphErrorCode` and `DagrGraphErrorLike`. An exhaustive
  `switch` over either that was previously complete now has a missing arm, which
  is a compile error rather than a silent fallthrough, and is the only way this
  release can break a build.
