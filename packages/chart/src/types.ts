/** How a series is drawn. */
export type ChartMark = 'bar' | 'line';

/** Which y-axis a series is measured against. */
export type ChartAxis = 'left' | 'right';

export interface ChartSeries {
  /** Stable across renders: it is what a mark's motion is keyed by. */
  readonly id: string;
  readonly label: string;
  /** `0xRRGGBB`, the renderer's colour convention. */
  readonly color: number;
  /** One finite value per category. */
  readonly values: readonly number[];
  /** Default `'bar'`. */
  readonly mark?: ChartMark | undefined;
  /** Default `'left'`. */
  readonly axis?: ChartAxis | undefined;
}

export interface ChartData {
  readonly categories: readonly string[];
  readonly series: readonly ChartSeries[];
}

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

/** The colours the GPU draws. Text is styled in CSS; see `styles.css`. */
export interface ChartTheme {
  /** The canvas clear colour, `0xRRGGBB`. */
  readonly background: number;
  readonly grid: number;
  /** The gridline at zero. */
  readonly baseline: number;
}

export const DEFAULT_THEME: ChartTheme = {
  background: 0x11161b,
  grid: 0x222a32,
  baseline: 0x3a4653,
};
