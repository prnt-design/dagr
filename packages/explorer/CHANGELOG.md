# @prnt/dagr-explorer

## 0.1.4

- A pan or a zoom no longer selects text: the viewport sets
  `user-select: none`. The drawer's text stays selectable.
- `api.focusViewport()` gives the graph keyboard focus. The toolbar's zoom-to
  button calls it, so the wheel and the camera keys apply right after.
- The open drawer no longer covers what the camera shows: fit, focus, reveal
  and zoom work in the part of the graph beside it, a node under it can be
  panned out, and the node it opens on is revealed. A camera at fit eases to
  the new fit as the drawer opens and closes. `ExplorerViewport` and
  `DagrExplorer` take `inset` for a host's own overlays, typed by the new
  `ExplorerInset` export, and `contentPadding` (default 0.05).
- A connection in the drawer follows its edge: it inspects the neighbor and
  pans it into view at the current zoom. Each shows its direction (`→`, `←`,
  `↻`), read out through the new `connectionTo` and `connectionFrom` labels.
  The drawer's slot context gains `follow(id)`. `renderConnection` still
  draws the whole button, and gets the direction (`'to'`, `'from'` or
  `'self'`) as a third argument.
- Zoom out, zoom in, fit and the drawer's close button are icon buttons,
  named and titled by their labels. Zoom to selected keeps its text and
  gains an icon.

### Upgrading from 0.1.3

- `ExplorerLabels` gains the required `connectionTo` and `connectionFrom`. A
  full value typed `ExplorerLabels` adds them. A partial `labels` override is
  unaffected.
- `ExplorerApi` gains `focusViewport`. A hand-written mock adds it.
- `ExplorerDetailsContext` gains `follow`. Code that builds one by hand adds
  it.
- Close, zoom in, zoom out and fit render an icon, not text. Query them by
  role and name, not by text. A custom label still reaches `aria-label` and
  `title`.
- A default connection button starts with an arrow and a visually hidden
  "to X" or "from X", and a click pans the camera to the node. A test that
  matched its text matches the new text.

## 0.1.3

The first release. Built in slices M5.6a to M5.6f; the entries below are in
the order they landed.

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
  on a node or the graph's surface it closes the drawer before it leaves
  the graph (see the M5.6f-2 entry below).
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
- Add the docs page, `/docs/explorer`, with two live demos, an
  architecture graph and a 2,000 node synthetic graph, and Node benches
  for the visible set at 1,000 and 10,000 nodes and for layout at 1,000
  (M5.6f-1). No package code changed.
- Validate the explorer in real browsers (M5.6f-2): the docs demos in
  Chromium 153 and WebKit 26.6, at 1440 by 900 and at 390 by 844 with
  touch, with `bench/browser/explorer-check.mjs`. Every check passes in
  both. The README's "Known browser differences" records what differs.
- Fix: `Escape` on a node or the graph's surface with the drawer open
  closes the drawer and keeps focus where it is, and a second `Escape`
  leaves the graph. One `Escape` used to do both, which left focus on the
  page body. An `Escape` that content inside a node handles is left to it.
- Fix: the graph holds its wheel listener only while it has focus. WebKit
  does not scroll a page whose root sets `overscroll-behavior: none` while
  the pointer is over any non-passive wheel listener, so the page would not
  scroll past an unfocused graph there.
- Measure the SVG base's ceiling: smooth (a 95th percentile frame within
  one 16.7 ms frame) to about 4,000 nodes and 5,400 edges, panned at one and
  a half times the fit zoom in Chromium on an Apple M4. The table is in the
  README.
- This is the first published version. The umbrella package re-exports it
  as `@prnt/dagr/explorer`.
