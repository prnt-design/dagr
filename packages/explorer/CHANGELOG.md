# @prnt/dagr-explorer

## Unreleased

Not published. The package is private until M5.6f.

- Add the headless core (M5.6b): the `ExplorerView` data model, `validateView`
  and `validateViews` with `ExplorerDataError`, `layoutView`, and
  `searchNodes`.
- Layout flows `'right'` by default or `'down'`, in y-down world pixels padded
  40 off the origin. Parallel edges that span one rank bow 16 apart. A self
  loop has an empty route. A group is the padded hull of its members and
  moves no node.
