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
