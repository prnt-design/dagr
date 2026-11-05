# @prnt/dagr-chart

## Unreleased

- Draw GPU chart lines above bars, matching SVG, so overlaps do not hide the line.

- New package, private until it joins the packaging checks and the umbrella.
  `DagrChart` draws bar and line series over a category axis with
  `@prnt/dagr-render`: one or two y-axes scaled by `d3-scale`, marks matched
  across renders by id so a change glides, grows in or shrinks out on the
  renderer's springs, a GPU-picked tooltip, a hidden data table, and
  reduced-motion support. `layoutChart` is the pure layout it draws from.

- Select GPU or SVG rendering with the same layout, spring animation and picking.
- Add DOM and SVG part classes, root inline styles, Tailwind-compatible CSS layers,
  and CSS-variable colour bindings that refresh with application theme changes.
- Bound repeated context recovery, preserve inline-data identity by content,
  ignore unchanged resize notifications and stale picks, retain grids during
  exit animations, and centre crowded bar groups.
