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

- Serialization: `graph.toJSON()` and the static `Graph.fromJSON(doc)`, with
  `GraphDocument`, `NodeDocument`, `EdgeDocument`, and `PortDocument` exported
  as types (M1.5). Additive, and `toJSON` is named for the hook, so
  `JSON.stringify(graph)` is the document with no method to reach for first.

  Three parts of the contract are decisions rather than consequences. The
  document describes CONTENT, not history: the id generation counters are not
  in it, so two graphs holding the same elements in the same order write the
  same document whatever built them, which is what makes one usable as a golden
  file. The cost is that a generated suffix the original spent on a
  since-removed element is free again after a round trip, so a round trip does
  not continue the original's generation sequence. Replay is ORDER FAITHFUL,
  unlike `apply`: a document holds the whole graph at once, so array order is
  insertion order and node order, edge order, and each node's port declaration
  order all come back. And `fromJSON` replays through the public mutators, so a
  well-formed document describing an impossible graph fails with the error the
  equivalent call would throw (`NodeNotFoundError`, `DuplicateNodeError`,
  `PortDirectionError`) rather than a second set of checks that can drift.

  Attribute bags are handed back by reference and never inspected, so a value
  `JSON.stringify` cannot express behaves exactly as it would in any other
  object, and values are not validated on the way back in either. Every
  document carries `"version": 1`, constant so it does not disturb a golden
  file, and an unknown version is refused with a message that says so.

- `InvalidDocumentError`, exported, `code: 'INVALID_DOCUMENT'`, the eleventh
  member of the `DagrGraphError` family. Carries `path`, the offending field in
  the notation you would use to reach it (`nodes[3].ports[1].direction`, empty
  for the document itself), and `detail`. Thrown only by `Graph.fromJSON`, and
  only for a value that is not a graph document: a document that is well formed
  but describes a graph that does not hold together is refused by the mutators
  instead.

  This widens `DagrGraphErrorCode` and `DagrGraphErrorLike` again. An exhaustive
  `switch` over either that was previously complete now has a missing arm, which
  is a compile error rather than a silent fallthrough, and is the only way this
  release can break a build.

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
