/**
 * `@prnt/dagr-chart`: animated bar and line charts for React, drawn by
 * `@prnt/dagr-render`.
 *
 * {@link DagrChart} is the component. {@link layoutChart} is the pure half of
 * it, exported for a caller who wants the same positions without the canvas:
 * a test, a server-rendered fallback, or their own marks. The scene that
 * drives the renderer stays internal.
 */

export { DagrChart } from './DagrChart.js';
export type { DagrChartProps, ChartBackend } from './DagrChart.js';
export { GRID_SLOTS, layoutChart } from './layout.js';
export type {
  BarTarget,
  ChartLayout,
  Gridline,
  LineTarget,
  PlotArea,
  PointTarget,
  Tick,
} from './layout.js';
export { DEFAULT_THEME } from './types.js';
export type { ChartAxis, ChartData, ChartMark, ChartSeries, ChartSize, ChartTheme } from './types.js';

export type { ChartClassNames, ChartCssColors, ChartStyle } from './styling.js';
