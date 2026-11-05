/**
 * The chart's dataset: twelve months of two series, seeded so a reload draws
 * the same picture and a "shuffle" draws a different one on purpose.
 */

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export interface Series {
  readonly id: string;
  readonly label: string;
  /** `0xRRGGBB`, the renderer's colour convention. */
  readonly color: number;
  readonly values: readonly number[];
}

export interface ChartData {
  readonly categories: readonly string[];
  readonly series: readonly Series[];
}

const SERIES_META = [
  { id: 'orders', label: 'orders', color: 0xffb703 },
  { id: 'returns', label: 'returns', color: 0x4ebdc4 },
] as const;

/** mulberry32: small, deterministic, and plenty for a demo. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random walk per series rather than independent draws, so the line has a
 * shape worth following and neighbouring bars relate to each other.
 */
export function generateData(seed: number): ChartData {
  const random = prng(seed);
  const series = SERIES_META.map((meta, seriesIndex) => {
    const values: number[] = [];
    let value = 30 + random() * 40 - seriesIndex * 15;
    for (let i = 0; i < MONTHS.length; i += 1) {
      value += (random() - 0.5) * 30;
      value = Math.min(100, Math.max(8, value));
      values.push(Math.round(value));
    }
    return { ...meta, values };
  });
  return { categories: MONTHS, series };
}
