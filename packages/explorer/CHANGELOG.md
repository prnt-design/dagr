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
- Add the viewport's pure core (M5.6c-1), internal for now: camera arithmetic
  with limits from `Camera2D`, and the visible set that decides which nodes
  get a DOM element at which tier, capped, with pinned nodes always mounted.
- Add the viewport (M5.6c-2), internal for now: a pannable, zoomable surface
  with an SVG base layer and a windowed DOM overlay. Pan and zoom by wheel,
  keys, drag, trackpad pinch and two-finger touch. A drag tracks the pointer
  exactly, and a resize or a relayout keeps the user's place. The base layer
  is a seam that is told of every drawn camera, for a native base later.
- Add the React parts (M5.6d), the first public exports beyond the core:
  `DagrExplorer`, preassembled, and the parts it is built from,
  `ExplorerRoot`, `ExplorerViews`, `ExplorerSearch`, `ExplorerTraceToggle`,
  `ExplorerViewport`, `ExplorerDetails` and `ExplorerToolbar`, with
  `useExplorer` and an `apiRef` for the same methods.
- `ExplorerRoot` validates every view and lays out the active one, memoized
  by shape. The view and the selection are controllable, and a controlled
  value is never rendered past: the explorer calls back and waits for the
  prop. The query, trace, drawer and camera are internal, and a view switch
  resets them.
- The drawer returns focus to what opened it, or to the search field. Escape
  in the search field closes the drawer before it clears the query, and
  inside the graph it closes the drawer without moving focus back in.
- Every string comes from `labels`, with neutral English defaults in
  `DEFAULT_EXPLORER_LABELS`. A part outside a root, or a second viewport in
  one, throws `ExplorerContextError`.
- Add `@prnt/dagr-explorer/styles.css`, the optional default look, themed by
  eight `--dagr-explorer-*` variables. The parts work without it.
- Export the base-layer seam types (`ExplorerBase`, `ExplorerBaseProps`,
  `ExplorerCameraSource`, `ExplorerEmphasis`) as experimental, until a native
  base confirms them.
- The test suite runs under React 18 and React 19. The React 18 run needs
  Node 22.15 or later, for `module.registerHooks`.
