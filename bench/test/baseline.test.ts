import { describe, expect, it } from 'vitest';

import { mergeBaseline } from '../src/baseline.mjs';
import type { BaselineReport } from '../src/gate.mjs';

const AT = '2026-07-27T00:00:00.000Z';

function stat(ratio: number) {
  return { medianMs: ratio, meanMs: ratio, rme: 1, samples: 100, ratio };
}

describe('recording a baseline', () => {
  it('replaces the numbers a run produced', () => {
    const previous: BaselineReport = { schema: 1, benchmarks: { a: stat(1) } };
    const merged = mergeBaseline(previous, { a: stat(2) }, AT);
    expect(merged.benchmarks['a']).toEqual(stat(2));
  });

  it('drops a benchmark the run no longer has', () => {
    const previous: BaselineReport = { schema: 1, benchmarks: { a: stat(1), gone: stat(1) } };
    const merged = mergeBaseline(previous, { a: stat(1) }, AT);
    expect(merged.benchmarks['gone']).toBeUndefined();
  });

  it('carries over an exempt entry the run never produces', () => {
    // ROADMAP M4.10's GPU frame time is measured by hand on a named machine and
    // never runs under `pnpm bench`. A capture that dropped it would delete the
    // record the moment anyone refreshed the baseline.
    const gpu = { gate: 'off' as const, reason: 'no comparable CI GPU', note: 'M2 Max, Chrome 141' };
    const previous: BaselineReport = { schema: 1, benchmarks: { a: stat(1), gpu } };
    const merged = mergeBaseline(previous, { a: stat(1) }, AT);
    expect(merged.benchmarks['gpu']).toEqual(gpu);
  });

  it('lets a run reclaim a key that used to be exempt', () => {
    const previous: BaselineReport = {
      schema: 1,
      benchmarks: { a: { gate: 'off', reason: 'was unmeasurable' } },
    };
    const merged = mergeBaseline(previous, { a: stat(3) }, AT);
    expect(merged.benchmarks['a']).toEqual(stat(3));
  });

  it('sorts keys so a baseline diff shows the numbers that moved', () => {
    const merged = mergeBaseline(undefined, { b: stat(1), a: stat(1) }, AT);
    expect(Object.keys(merged.benchmarks)).toEqual(['a', 'b']);
  });

  it('records what it was measured on', () => {
    const merged = mergeBaseline(undefined, { a: stat(1) }, AT);
    expect(merged.capturedAt).toBe(AT);
    expect(merged.machine?.node).toBe(process.version);
  });
});
