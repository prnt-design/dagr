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

### Changed

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
