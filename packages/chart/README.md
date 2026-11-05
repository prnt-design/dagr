# @prnt/dagr-chart

Animated bar and line charts for React, drawn by
[Dagr](https://dagr.prnt.design)'s WebGPU renderer. D3 does the math
(`d3-scale`, `d3-array`), `@prnt/dagr-render` draws the marks as instanced
shapes and ribbons, and every change glides on the renderer's springs.

Not published yet: the package is private to this workspace until its
packaging checks land. Inside the workspace, depend on it as `workspace:*`.

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
- **A tooltip** for the bar or marker under the pointer, picked on the GPU.

## Motion

Marks are matched across renders by series `id` and category index. A mark in
both renders glides from where it is, a new one grows in, and one that left
shrinks out before it is dropped, so changing a series from bars to a line is
one transition and not a cut. A resize does not animate. Neither does
anything when `animate` is `false` or the reader prefers reduced motion.

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
| `onBackend` | Called once per renderer with the backend it came up on. |
| `className` | Added to the root beside `dagr-chart`. |
| `scheduler` | Where frames come from, for a host that already runs a frame loop. Keep it stable. |

Invalid data throws a `RangeError` from render: two series sharing an id, a
series without one value per category, or a value that is not finite.

`layoutChart(data, size)` is the pure half, exported for a caller who wants
the same positions without the canvas.

## Styling

The marks are drawn in the series colours and the `theme`. The text is DOM,
styled by `styles.css`, which is optional. Its colours are custom properties
on `.dagr-chart`: `--dagr-chart-text`, `--dagr-chart-tooltip-text`,
`--dagr-chart-tooltip-surface` and `--dagr-chart-font`.

## Accessibility

The canvas is hidden from assistive technology. The root is a group named by
`label`, and it holds a visually hidden table with the same numbers, one row
per category and one column per series, formatted by `formatValue`. Keep
`styles.css`, or hide `.dagr-chart__table` yourself, or the table is visible.

## Limits

- React 19. `three` (0.180 or newer) is a peer, because the chart uses the
  renderer's GPU entry.
- One chart is one canvas and one GPU context. A page of many small charts
  wants SVG.
- Category x-axis only: no time, log or continuous x scale, no stacked bars,
  no areas, no legend.
- The win over an SVG chart is motion and mark count. For a few dozen static
  marks, an SVG chart library is the simpler choice.
