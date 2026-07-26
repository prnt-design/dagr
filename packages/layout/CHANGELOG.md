# Changelog

All notable changes to `@dagr/layout`. Nothing is published yet, so everything
below is unreleased and the version in `package.json` has never been cut.

This file exists because the milestones through M2 change what `layout` returns
without changing a single type or exported name. A caller upgrading past one of
them sees different coordinates, and no compiler tells them. "Behaviour changed,
types did not" is the category this file has a heading for, so that the v0.1
release notes do not have to be reconstructed by diffing five milestones' worth
of doc prose.

## Unreleased

### Added

- `InternalLayoutError`, exported, `code: 'INTERNAL'`. The pipeline's own
  invariant failures were bare `Error`s, outside the family the docs promise one
  `instanceof` check covers; every one of them is now this. It is always a bug
  in this package, never in the caller and never in a caller-supplied stage,
  which is why it is not a `StageContractError`: that class names a stage.
  (M2.2 review)

### Changed

- **Breaking for an exhaustive `switch`:** the exported `DagrLayoutErrorCode`
  union gains `'INTERNAL'`. A caller switching over every member without a
  default case stops compiling until they add it. Free today, because nothing is
  published, which is the point of doing it now. (M2.2 review)
- **A route stage that used to pass may now throw.** The runner checks route
  direction at the route boundary: a polyline's first point has to be at least
  as close to its edge's `source` as to its `target`, and its last point at
  least as close to the `target`. A third-party router that emits its points
  target-first for an edge the ranker reversed is rejected with a
  `StageContractError` naming it, where before M2.2 it silently produced
  arrowheads on the wrong end. The check is proximity rather than endpoint
  equality so that it survives M2.8's border attachment and obstacle detours,
  and it is not strict, so a self loop passes. The default router is unaffected.
  (M2.2 review)

- The default rank stage is now `longest-path-rank`. It breaks cycles with a
  greedy feedback arc set (Eades, Lin and Smyth 1993) and ranks by longest path,
  replacing `single-rank`, which put every node on rank 0. **Every layout of a
  graph with more than one rank of structure now returns different coordinates,
  different bounds, and more than one layer.** No type and no exported name
  changed. (M2.2)

### Notes

- `@dagr/graph` is a peer dependency, not a regular one. Its `#private` fields
  make `Graph` nominally typed, so two copies in a tree are not interchangeable.

## 0.1.0

Not yet released.
