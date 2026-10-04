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
  `useExplorer` and an `apiRef` for the same methods, and `useExplorerApi`
  for the methods alone, which never re-renders its caller. The methods see
  each other's writes, so two calls in one tick end where the last asked.
- `ExplorerRoot` validates every view and lays out the active one, memoized
  by shape. The view and the selection are controllable, and a controlled
  value is never rendered past: the explorer calls back and waits for the
  prop. The query, trace, drawer and camera are internal, and a view switch
  resets them. Data that arrives after mount is not a switch, so a
  deep-linked selection survives data that starts empty.
- `ExplorerViewport` renders its children, such as `ExplorerDetails`, in a
  positioned stage with the graph, and the graph's hint after it. Its
  surface renders only when what it draws changes. Every part's `style`
  wins over its own, so `style={{ height: 600 }}` sizes the graph.
- `ExplorerSearch` lists at most `maxResults` matches (default 50), then a
  line saying how many more. The count and Enter cover every match.
- The drawer returns focus to what opened it, or to the search field, or to
  the root, never to the page. Escape closes it from anywhere in the root.
  In the search field it closes the drawer before it clears the query, and
  inside the graph it closes the drawer without moving focus back in.
- Every string comes from `labels`, with neutral English defaults in
  `DEFAULT_EXPLORER_LABELS`, including the `moreMatches` and `inGroup`
  formatters. An inline `labels` object is kept by value. A part outside a
  root, or a second viewport in one, throws `ExplorerContextError`.
- Add `@prnt/dagr-explorer/styles.css`, the optional default look, themed by
  eight `--dagr-explorer-*` variables. The parts work without it.
- Export the base-layer seam types (`ExplorerBase`, `ExplorerBaseProps`,
  `ExplorerCameraSource`, `ExplorerEmphasis`, `ExplorerVisibleSet`) as
  experimental, until a native base confirms them, and `ExplorerCamera` as a
  type.
- The test suite runs under React 18 and React 19. The React 18 run needs
  Node 22.15 or later, for `module.registerHooks`.
- Add keyboard navigation (M5.6e). The graph is one tab stop: the selected
  node, else the last node focused from the keyboard, else the node nearest
  the center, always mounted. Arrow keys on a focused node move focus to the
  nearest node in that direction, mounted or not; Shift with an arrow pans,
  and Enter and Space inspect. A node focused from the keyboard is revealed
  by the least pan at the current zoom; a click moves nothing. The default
  `hint` now names the arrow keys. The tab target and the focused node are
  pinned outside `maxOverlayNodes`, so the page can hold a few more node
  elements than the cap.
- Every part renders on a server (M5.6e): the shell and the base layer, with
  every node as a mark, the plane hidden and no node elements until the
  client measures the graph. It hydrates without a mismatch. No part needed
  a change for it.
