import type { CSSProperties } from 'react';

/** Classes are appended to stable structural classes. Utilities win over the optional stylesheet. */
export interface ChartClassNames {
  readonly canvas?: string;
  readonly axes?: string;
  readonly tick?: string;
  readonly leftTick?: string;
  readonly rightTick?: string;
  readonly category?: string;
  readonly tooltip?: string;
  readonly tooltipLabel?: string;
  readonly tooltipValue?: string;
  readonly failure?: string;
  readonly table?: string;
  /** SVG marks only. GPU colours use cssColors instead. */
  readonly bar?: string;
  readonly point?: string;
  readonly line?: string;
  readonly gridline?: string;
}

export type ChartStyle = CSSProperties & { readonly [name: `--${string}`]: string | number | undefined };

/** Names of opaque CSS colour variables, resolved on the chart root. Missing or invalid colours retain numeric defaults. */
export interface ChartCssColors {
  readonly background?: `--${string}`;
  readonly grid?: `--${string}`;
  readonly baseline?: `--${string}`;
  readonly series?: Readonly<Record<string, `--${string}`>>;
}

export const classes = (base: string, extra?: string): string => extra ? `${base} ${extra}` : base;
