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

  it('keeps an exemption on a key the run did produce, refreshing its stats', () => {
    // An exemption is a decision someone wrote down, so lifting it takes a
    // hand edit rather than being a side effect of the next capture. The entry
    // that motivated this rule (`2.5k successors` on the dispatch box) is
    // produced by every run and flakes anyway, and a capture that silently
    // re-gated it would re-arm the flake with the reasoning deleted. This
    // reverses the original rule, which let a run reclaim the key.
    const previous: BaselineReport = {
      schema: 1,
      benchmarks: {
        a: { gate: 'off', reason: 'was unmeasurable', note: 'dispatch box, 2026-08-14' },
      },
    };
    const merged = mergeBaseline(previous, { a: stat(3) }, AT);
    expect(merged.benchmarks['a']).toEqual({
      gate: 'off',
      reason: 'was unmeasurable',
      note: 'dispatch box, 2026-08-14',
      ...stat(3),
    });
  });

  it('sorts keys so a baseline diff shows the numbers that moved', () => {
    const merged = mergeBaseline(undefined, { b: stat(1), a: stat(1) }, AT);
    expect(Object.keys(merged.benchmarks)).toEqual(['a', 'b']);
  });

  it('records what it was measured on', () => {
    const merged = mergeBaseline(undefined, { a: stat(1) }, AT);
    expect(merged.capturedAt).toBe(AT);
    expect(merged.machine?.node).toBe(process.version);
    // `bench/README.md` now tells a reader to consult this field when a number
    // looks wrong, so a refactor of `machineInfo` that dropped it would make
    // that instruction a lie without failing anything else.
    expect(typeof merged.machine?.loadAverageAtCapture).toBe('number');
  });
});

/**
 * The profile is the run's own or it is absent. Carrying a previous capture's
 * probes forward beside fresh benchmarks would describe one machine with
 * another machine's measurements, which is the exact confusion the field is
 * being added to end.
 */
describe('the machine profile', () => {
  it('records the probes the run measured', () => {
    const merged = mergeBaseline(undefined, { a: stat(1) }, AT, {
      '@dagr/graph > graph.bench.ts': { alloc: 0.09, chase: 1 },
    });
    expect(merged.machineProfile?.['@dagr/graph > graph.bench.ts']?.chase).toBe(1);
  });

  it('omits the field rather than keeping the previous capture, probes and all', () => {
    const previous: BaselineReport = {
      schema: 1,
      benchmarks: {},
      machineProfile: { '@dagr/graph > graph.bench.ts': { alloc: 0.09, chase: 1 } },
    };
    const merged = mergeBaseline(previous, { a: stat(1) }, AT, {});
    expect(merged.machineProfile).toBeUndefined();
  });
});
