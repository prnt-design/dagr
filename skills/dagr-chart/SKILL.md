---
name: dagr-chart
description: Build or improve a bar, line, or combined chart with Dagr's React chart component, DagrChart. Use for agent-authored charts of categorical data, such as monthly totals, a comparison across groups, or bars with a running-total line, not for graph or Explorer work, time or log scales, or stacked and area charts.
license: MIT
---

# Build a chart a reader can read

Start from the one comparison the reader should make, then choose the fewest
series that show it. Take every number from the supplied data. Do not invent,
smooth or extrapolate values, and say so when the data is illustrative.

## Shape the data

- `categories` are the x-axis labels and each series holds exactly one finite
  number per category. Missing values are not supported: drop the category or
  ask, rather than writing a zero the source does not contain. Invalid data
  throws a `RangeError` from render.
- Give each series a unique, stable `id` and a `label` a reader would recognise. Motion
  is keyed by `id` and category index, so keep ids fixed when the data updates
  and keep categories in a stable order.
- Use bars for amounts compared across categories and a line for a trend or a
  running total (`mark`, default `'bar'`). Bars sit side by side; there is no
  stacking.
- Put a series on `axis: 'right'` only when its unit or magnitude differs from
  the left axis, and say which series reads against which axis in the `label`
  or the surrounding text. An axis that carries a bar includes zero; an axis of
  lines alone fits its data, so a line's slope there is not comparable to bar
  heights.
- The component draws no legend. With more than one series, name the series
  and their colours next to the chart, using the same variable and fallback
  the chart resolves.

## Use the shipped chart API

Check that `@prnt/dagr-chart` is installed, or installable from the consumer's
registry, and read its installed types before coding. Versions before 0.2.0
were private to the Dagr workspace and never published, so do not assume it
is on npm. If the package cannot be installed, say so instead of copying its
source. Adapt the example in
[references/chart.tsx](references/chart.tsx) to the requested data and host;
do not assume features the installed types do not export.

- Install `@prnt/dagr-chart` with its peers: `react` and `react-dom` 19, and
  `three` 0.180 or newer. `three` is a declared peer, so install it even when
  rendering SVG.
- Import `@prnt/dagr-chart/styles.css`. It positions the parts and hides the
  data table visually; without it the table is visible.
- The chart has no height of its own. With `styles.css` it fills its parent,
  so give the parent, or the root through `style`, an explicit height.
- Always pass a `label` that says what the chart shows. It names the chart for
  assistive technology and captions the data table.
- Pass `formatValue` when the numbers have a unit or need rounding. It formats
  the ticks, the tooltip and the table, so a single formatter must suit both
  axes.
- Choose `rendering` deliberately. `'svg'` suits a few small charts and direct
  CSS styling. `'gpu'` (the default) suits large mark
  counts and uses one canvas and one GPU context per chart, so do not put many
  GPU charts on one page. A GPU failure reports an error; it does not fall
  back to SVG.
- `color` is a `0xRRGGBB` number. To follow the host's theme or Tailwind
  palette, bind `cssColors` to opaque CSS colour variables, read on the chart
  root, instead of hardcoding per-theme numbers. A missing, invalid or
  translucent value keeps the numeric colour.
- When a line crosses bars, give the line clear contrast against the bars it
  crosses, for example subdued bars and a brighter line. Matching hues can
  signal related data but make the line hard to trace.
- Motion is on by default and already respects reduced motion. Leave `animate`
  alone unless the host asks for a static chart.

## Check the result

Typecheck against the installed package and render the chart at the sizes the
host will use, including a phone-width container. Category labels thin out
when slots get narrow, so check the labels a reader needs are still shown, and
shorten them if not. Confirm the hidden table carries every value: the tooltip
is pointer and touch only, and the table is the keyboard and screen reader
path. A bar shorter than half a pixel is not drawn, so a value tiny against
its axis appears only in the table; change the axis assignment or say so.

State the limits plainly when a request exceeds them: category x-axis only, no
time, log or continuous x scale, linear y-axes, no stacked bars, no areas, no legend, no
per-axis formatter. Offer the nearest supported chart instead of imitating the
missing feature with fabricated series.
