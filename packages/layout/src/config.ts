import { LayoutError } from './errors.js';
import type { LayoutErrorCode } from './errors.js';

/**
 * Direction ranks grow in, read as "from, to".
 *
 * `TB` puts rank 0 at the top and later ranks below it, `BT` puts rank 0 at
 * the bottom, `LR` puts rank 0 on the left, `RL` puts rank 0 on the right.
 */
export type RankDir = 'TB' | 'BT' | 'LR' | 'RL';

/** The four legal {@link RankDir} values, in documentation order. */
export const RANK_DIRS: readonly RankDir[] = ['TB', 'BT', 'LR', 'RL'];

/**
 * Caller-facing layout options. Every field is optional: anything left out
 * takes its default from {@link resolveConfig}.
 *
 * All distances are in abstract layout units, the same space node `width`
 * and `height` are given in. The engine never assumes pixels, so a caller
 * is free to treat one unit as one pixel, one millimetre, or one cell.
 */
export interface LayoutOptions {
  /** Direction ranks grow in. Default `'TB'`. */
  readonly rankDir?: RankDir;
  /** Gap between two adjacent ranks, measured along the rank axis. Default `50`. */
  readonly rankSpacing?: number;
  /** Gap between two adjacent nodes inside one rank, measured across the rank axis. Default `30`. */
  readonly nodeSpacing?: number;
  /** Padding added on the left and right of the laid-out content. Default `0`. */
  readonly marginX?: number;
  /** Padding added above and below the laid-out content. Default `0`. */
  readonly marginY?: number;
}

/**
 * A fully resolved configuration: the same fields as {@link LayoutOptions},
 * with every default applied and every value validated. Stages receive this,
 * never the raw options, so a stage never has to re-apply a default.
 */
export interface ResolvedLayoutConfig {
  /** Direction ranks grow in. */
  readonly rankDir: RankDir;
  /** Gap between two adjacent ranks, measured along the rank axis, in layout units. */
  readonly rankSpacing: number;
  /** Gap between two adjacent nodes inside one rank, in layout units. */
  readonly nodeSpacing: number;
  /** Padding on the left and right of the laid-out content, in layout units. */
  readonly marginX: number;
  /** Padding above and below the laid-out content, in layout units. */
  readonly marginY: number;
}

/** Defaults applied by {@link resolveConfig} when an option is omitted. */
export const DEFAULT_LAYOUT_CONFIG: ResolvedLayoutConfig = {
  rankDir: 'TB',
  rankSpacing: 50,
  nodeSpacing: 30,
  marginX: 0,
  marginY: 0,
};

function requireNonNegative(value: number, field: string, code: LayoutErrorCode): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LayoutError(code, `${field} must be a finite non-negative number, got ${String(value)}`);
  }
  return value;
}

/**
 * Apply defaults to `options` and validate the result.
 *
 * @throws {LayoutError} `INVALID_RANK_DIR` when `rankDir` is not one of the
 * four legal values, `INVALID_SPACING` when a spacing is negative or not
 * finite, `INVALID_MARGIN` when a margin is negative or not finite.
 */
export function resolveConfig(options?: LayoutOptions): ResolvedLayoutConfig {
  const rankDir = options?.rankDir ?? DEFAULT_LAYOUT_CONFIG.rankDir;
  if (!RANK_DIRS.includes(rankDir)) {
    throw new LayoutError(
      'INVALID_RANK_DIR',
      `rankDir must be one of ${RANK_DIRS.join(', ')}, got ${JSON.stringify(rankDir)}`,
    );
  }

  return {
    rankDir,
    rankSpacing: requireNonNegative(
      options?.rankSpacing ?? DEFAULT_LAYOUT_CONFIG.rankSpacing,
      'rankSpacing',
      'INVALID_SPACING',
    ),
    nodeSpacing: requireNonNegative(
      options?.nodeSpacing ?? DEFAULT_LAYOUT_CONFIG.nodeSpacing,
      'nodeSpacing',
      'INVALID_SPACING',
    ),
    marginX: requireNonNegative(options?.marginX ?? DEFAULT_LAYOUT_CONFIG.marginX, 'marginX', 'INVALID_MARGIN'),
    marginY: requireNonNegative(options?.marginY ?? DEFAULT_LAYOUT_CONFIG.marginY, 'marginY', 'INVALID_MARGIN'),
  };
}
