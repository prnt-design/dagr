# M5.6e keyboard navigation and server rendering implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development`. This plan is a design brief: it
> fixes the decisions and the tests that must exist, and the implementer
> writes the code test first.

**Goal:** Make the graph navigable from the keyboard without mounting every
node, and make every part render on a server.

**Architecture:** A pure function picks the next node in an arrow's
direction. The surface keeps one roving tab target, pins it so it is always
mounted, and reveals it on keyboard focus. Server rendering needs no new
mechanism: the root's layout is pure, and the tests prove nothing touches the
DOM before an effect runs.

**Tech Stack:** TypeScript, React 18 and 19, Vitest (jsdom and node
environments)

**Spec:** `docs/superpowers/specs/2026-10-03-dagr-explorer-design.md`, sections
"Keyboard and accessibility" and "Server rendering". They are the
requirements. Read them first; this brief adds only what they leave open.

## Global constraints

- No new public runtime export. `test/index.test.ts` keeps pinning 22 names.
  `nearestInDirection` lives in `src/navigation.ts` and is internal.
- `src/camera.ts` and `src/visible-set.ts` keep their behavior.
- React 18 and 19. Never import the full renderer entry, `@prnt/dagr-react`,
  or `three`.
- No em-dashes in any prose. Commits: author `Dagr Agent <agent@prnt.design>`,
  trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Decisions this brief makes

- **`nearestInDirection(index, fromId, direction)`** in `src/navigation.ts`,
  pure, over the `LayoutIndex` from `visible-set.ts`. `direction` is
  `'up' | 'down' | 'left' | 'right'` in screen terms, which are world terms
  because the world is y-down. Candidates are nodes whose center is strictly
  in the arrow's half-plane from the focused node's center. Score: distance
  along the axis plus twice the distance across it; lowest wins; ties by id.
  Returns `null` when there is no candidate. It scans every node in the view,
  mounted or not.
- **The roving tab target** is, in order: the selected node; else the last
  node that had keyboard focus, if it is still in the layout; else the node
  nearest the viewport center (`nearestToCenter`). Exactly one node button has
  `tabIndex={0}`; every other has `-1`. The target is added to the pins, so it
  is always mounted. Before the first fit, with no camera, the target is the
  selected node or the first node in data order.
- **The surface element** keeps `tabIndex={-1}`: focusable by click, not in the
  tab order. When the view is empty there is no target and nothing in the
  graph is tabbable.
- **Arrow keys on a focused node** move focus with `nearestInDirection`: pin the
  target, wait for it to mount, focus it, then `revealBox` it. Focus must not
  be lost to `document.body` in between. No candidate is a no-op.
  `Shift` with an arrow pans, as on the surface. Keys with `Ctrl`, `Command`
  or `Alt` stay the browser's.
- **Keyboard focus reveals.** A node that receives focus from the keyboard
  (`:focus-visible`, or focus that followed a key) is revealed by the least
  pan at the current zoom. A pointer focus does not move the camera.
- **The accessible description.** The viewport region's description (the
  existing hint) states the node and edge counts and that search reaches every
  node, from `labels`.
- **Server rendering.** `renderToString(<DagrExplorer ... />)` in a `node`
  vitest environment (no `window`, no `document`) succeeds and its HTML
  contains: the root, the search field, the viewport region with its accessible
  name, the plane with `visibility: hidden`, the SVG base with one mark per node
  and one path per routed edge, and no overlay node buttons. No part reads a
  DOM global during render; anything that does moves into an effect. The same
  test hydrates that HTML with `hydrateRoot` in jsdom with no hydration
  mismatch warning.
- **The packaging smoke** renders `DagrExplorer` with `renderToString` from the
  installed tarball, with `three` absent.

## Tests that must exist

`navigation.test.ts`: each of the four directions on a grid; the half-plane
excludes nodes level with the focused one; the across-axis weight picks a
straight neighbor over a nearer diagonal one; ties by id; no candidate returns
`null`; a node that is not mounted (off screen) is still found.

Surface and parts (both React configs): one tab stop in the graph, and Tab
enters it on the selected node, else the nearest to center; Tab again leaves
the graph; arrows move focus to the expected node and reveal it; an arrow onto
an off-screen node mounts, focuses and reveals it, and focus is never on
`document.body` between; `Shift` with an arrow pans and does not move focus;
`Enter` and `Space` inspect; pointer focus does not move the camera; the tab
target survives a pan that would otherwise unmount it; the last-focused node
is remembered when the selection is cleared; removing the tab target from the
data moves the target and does not throw; an empty view has nothing tabbable.

Server (`// @vitest-environment node`): the `renderToString` assertions above,
for `DagrExplorer` and for a hand-composed root with each part; a data error
during server render throws `ExplorerDataError`.

Hydration (jsdom): hydrating the server HTML produces no warning and the
explorer then fits and becomes interactive.

Packaging: the smoke renders on the server from the tarball.

## Out of scope

Docs pages, demos, the bench, browser verification, making the package public,
and the umbrella subpath are M5.6f.

---

## Amendments during execution

Choices the implementer made where this brief was silent, all judged sound by
the review and recorded in the spec's amendment 16:

- The nearest-to-center tab target is recomputed at each scan of the visible
  set, not every frame.
- Keyboard focus is "the last input on the page was a key", from document
  listeners, not `:focus-visible`.
- The focused node and an arrow's target are pinned as well as the tab target,
  outside the cap, so tests that counted buttons under a cap expect one more.
- `Enter` and `Space` inspect on key down; repeats are ignored; an arrow with no
  candidate still prevents the page from scrolling.
- The viewport element's scroll is reset to zero.
- The camera hook ignores a plain arrow on a node, which the surface handles.
- `useIsomorphicLayoutEffect` is shared from a leaf module.
- The React 18 config gained a `react-dom/server` alias.
- The hint names the arrow keys.

