# @prnt/dagr-chart

Animated bar and line charts for React, drawn by
[Dagr](https://dagr.prnt.design)'s WebGPU renderer or SVG. D3 does the math
(`d3-scale`, `d3-array`), `@prnt/dagr-render` draws the marks as instanced
shapes and ribbons, and every change glides on the renderer's springs.

Not published yet: the package is private to this workspace until it joins
the packaging checks and the umbrella package. Inside the workspace, depend on
it as `workspace:*`.

## The chart

```tsx
import { DagrChart } from '@prnt/dagr-chart';
import '@prnt/dagr-chart/styles.css';

<div style={{ height: 360 }}>
  <DagrChart
    label="Orders by month"
    categories={['Jan', 'Feb', 'Mar', 'Apr']}
    series={[
      { id: 'orders', label: 'Orders', color: 0xffb703, values: [17, 32, 38, 35] },
      {
        id: 'total',
        label: 'Running total',
        color: 0xe6edf3,
        values: [17, 49, 87, 122],
        mark: 'line',
        axis: 'right',
      },
    ]}
  />
</div>;
```

The chart fills the element it is given and has no height of its own.

## What it draws

- **Categories on x**, one slot each. Labels thin out when the slots get
  narrow.
- **A series is bars or a line** (`mark`, default `'bar'`). Bar series sit side
  by side within a category; a line runs through the category centres with a
  marker on each value.
- **One or two y-axes** (`axis`, default `'left'`). Each is scaled from its own
  series. An axis that carries a bar includes zero. An axis of lines alone
  fits its data, which keeps a large, slowly moving total readable beside
  small daily bars. Negative values hang below the zero line.
- **A tooltip** for the bar or marker under the pointer, picked on the GPU
  or against the SVG mark geometry. During a glide, its value and anchor use
  the target layout rather than following the interpolated frame.

## Motion

Marks are matched across renders by series `id` and category index. A mark in
both renders glides from where it is, a new one grows in, and one that left
shrinks out before it is dropped. Changing a series from bars to a line is
therefore two overlapping motions: the bars sink while the line rises. Data is compared by content, so an inline `series={[...]}` that says
the same thing as the last render changes nothing. A resize does not animate.
Neither does anything when `animate` is `false` or the reader prefers reduced
motion.

## Props

| Prop | What it is |
| --- | --- |
| `categories` | The x-axis labels, one per value. |
| `series` | `{ id, label, color, values, mark?, axis? }[]`. `color` is `0xRRGGBB`. `values` holds one finite number per category. |
| `label` | What the chart shows. It names the chart and captions its data table. |
| `animate` | Whether a change glides. Default `true`. |
| `formatValue` | Formats tick labels, the tooltip and the data table. Default: D3's tick format, and the plain number. |
| `theme` | `{ background, grid, baseline }` as `0xRRGGBB`. Changing one rebuilds the renderer. |
| `backend` | `'auto'` (default), `'webgpu'` or `'webgl2'`, as `createRenderer` takes it. |
| `rendering` | `'gpu'` (default) or `'svg'`. SVG acquires no GPU context. |
| `onBackend` | Called once per renderer with `'webgpu'`, `'webgl2'`, `'unknown'` or `'svg'`. |
| `className` | Added to the root beside `dagr-chart`. |
| `classNames` | Classes for DOM parts and SVG marks, listed below. |
| `style` | Root inline styles, including typed CSS custom properties. |
| `cssColors` | Map background, grid, baseline and series ids to CSS variable names. |
| `scheduler` | Where frames come from, for a host that already runs a frame loop. Keep it stable. |

Invalid data throws a `RangeError` from render: two series sharing an id, a
series without one value per category, or a value that is not finite.

`layoutChart(data, size)` is the pure half, exported for a caller who wants
the same positions without the canvas.

## Styling and Tailwind

There is no Tailwind runtime dependency. Pass utilities with `className` for
its root, and `classNames` for `canvas` (either drawing surface), `axes`,
`tick`, `leftTick`, `rightTick`, `category`, `tooltip`, `tooltipLabel`,
`tooltipValue`, `failure` and `table`. SVG also exposes `bar`, `point`, `line`
and `gridline`. Classes append to stable `dagr-chart__*` names. SVG marks carry
`data-mark-id` and nodes carry `data-hovered="true"` while hovered.

Import `styles.css` for positioning and the hidden table. Its defaults live in
`@layer components`, so Tailwind's utilities override them regardless of import
order. Unlayered application CSS also overrides them. Keep structural positioning
and the table's visually hidden treatment if replacing these defaults.

Use `style` for root styles or custom properties. Text defaults read
`--dagr-chart-text`, `--dagr-chart-tooltip-text`, `--dagr-chart-tooltip-surface`
and `--dagr-chart-font`; these can be inherited from an application wrapper.

### Sharing Tailwind colours with the GPU

GPU pixels cannot read utility classes. `cssColors` binds them to CSS variables
on the root or its ancestors. Tailwind 4 exposes its palette as `--color-*`
variables, including OKLCH colours. The chart converts opaque colours to sRGB.
The arbitrary-property utilities in the example also tell Tailwind to retain
the palette tokens they reference; alternatively define tokens in `@theme static`.
Missing, unsupported, invalid or translucent values retain the numeric `theme`
or series `color` fallback. The same bindings work in SVG mode.

```tsx
import { DagrChart } from '@prnt/dagr-chart';
import '@prnt/dagr-chart/styles.css';

<DagrChart
  label="Monthly orders"
  categories={['Jan', 'Feb', 'Mar']}
  series={[{ id: 'orders', label: 'Orders', values: [17, 32, 38], color: 0x6366f1 }]}
  className="rounded-xl [--chart-bg:var(--color-white)] dark:[--chart-bg:var(--color-slate-950)] [--chart-grid:var(--color-slate-200)] [--chart-baseline:var(--color-slate-400)] [--chart-orders:var(--color-indigo-500)]"
  style={{ height: 360 }}
  classNames={{
    tick: 'font-sans text-xs text-slate-500 dark:text-slate-400',
    category: 'font-sans text-xs',
    tooltip: 'rounded-lg bg-white text-slate-950 shadow-lg dark:bg-slate-900 dark:text-white',
  }}
  cssColors={{
    background: '--chart-bg',
    grid: '--chart-grid',
    baseline: '--chart-baseline',
    series: { orders: '--chart-orders' },
  }}
/>
```

Colours refresh on ancestor or root `class`, `style` and `data-theme` changes,
OS colour-scheme changes and window resize. This covers class-based dark mode,
data-theme switches and responsive palette tokens without polling. Arbitrary
stylesheet edits or continuously animated CSS colours are not observed. Use
React numeric props for frame-by-frame colour control. In Tailwind 3, expose
your palette as CSS variables in application CSS and bind those variable names
through the same API. Keep utility strings literal in your application source
so Tailwind can discover them; no package source scanning is required.

### SVG

Set `rendering="svg"` for ordinary DOM marks, with the same layout, spring
transitions, reduced motion, tooltip and data table. No WebGPU or WebGL context
is acquired. This is useful for smaller charts and environments without GPU
support. Choose the mode explicitly; a GPU failure reports an error rather than
silently switching rendering modes.

```tsx
<DagrChart
  rendering="svg"
  label="Monthly orders"
  categories={['Jan', 'Feb', 'Mar']}
  series={[{ id: 'orders', label: 'Orders', values: [17, 32, 38], color: 0x6366f1 }]}
  style={{ height: 360 }}
  classNames={{
    bar: 'fill-indigo-500 dark:fill-indigo-400 data-[hovered=true]:fill-indigo-300',
    point: 'fill-violet-500',
    line: 'stroke-violet-500',
  }}
/>
```

SVG colours use presentation attributes, so fill and stroke utilities take
precedence. Use `cssColors` when the tooltip border should also follow those
colours. Lines use linear segments in both modes, so they do not invent extrema between
observations. SVG uses a CSS shadow for hover, so its pixels
need not match the GPU's ribbons and glow exactly. The SVG contains the marks;
axis labels and tooltips remain DOM siblings, so it is not a standalone chart
export. SVG shares the half-pixel bar threshold with GPU rendering.

## Accessibility

The canvas is hidden from assistive technology. The root is a group named by
`label`, and it holds a visually hidden table with the same numbers, one row
per category and one column per series, formatted by `formatValue`. Keep
`styles.css`, or hide `.dagr-chart__table` yourself, or the table is visible.
The tooltip is pointer and touch only: there is no keyboard path to a single
mark yet, and the table is what carries every value.

## Limits

- React 19. `three` (0.180 or newer) is a peer, because the chart uses the
  renderer's GPU entry.
- GPU mode uses one canvas and one GPU context per chart. For many small
  charts, select SVG.
- Category x-axis only: no time, log or continuous x scale, no stacked bars,
  no areas, no legend.
- A bar shorter than half a pixel is not drawn, so a value tiny against its
  axis has no mark and no tooltip. The data table still carries it.
- GPU mode suits large mark counts; SVG suits smaller charts and direct CSS
  styling. Both use the same animation model.

## Narrow charts and correctness

Category labels use measured DOM widths, an 8px gap, and deterministic thinning.
The first and last categories are retained together when they fit, then interior
labels fill the available space in order. Labels wider than the container are
ellipsized. Font loads, resize and label size changes trigger measurement.
Full category names remain in tooltips and the data table, including skipped
labels. The pure layout's `labelEvery` is a legacy count-based hint for custom
renderers, not the component's measured visibility policy.

Grouped bars shrink their gaps and widths to stay inside each category band.
Very dense bars can be subpixel and hard to pick individually. Filter, aggregate
or provide a wider container for detailed inspection; the table retains all
observations. Linear interpolation is the safe default in SVG and GPU, replacing
the previous mandatory smoothing. There is no smoothing option in this release.

Tooltips measure their wrapped content, prefer above the mark, flip below when
needed, and clamp to the chart's actual content bounds with an 8px inset.
Content larger than the chart is capped and clipped; the table retains the full
text and values. Give charts enough height for readable content.

Follow-up work is staged separately: split SVG/layout import boundaries from GPU
dependencies; add per-axis domains, units and formatting; add keyboard inspection
and controlled active data; define missing-value gaps and stable observation keys.
Stacking and additional chart families follow those contracts.
