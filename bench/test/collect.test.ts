import { describe, expect, it } from 'vitest';

import { benchKey, normalisePackageRun, normaliseRuns } from '../src/collect.mjs';
import type { PackageRun, VitestBenchmark, VitestReport } from '../src/collect.mjs';

function benchmark(name: string, median: number): VitestBenchmark {
  return { name, mean: median * 1.05, median, rme: 1.2, sampleCount: 4000 };
}

/** A vitest report for one file holding a control and whatever else is asked for. */
function report(
  file: string,
  groups: Record<string, VitestBenchmark[]>,
  options: { control?: number } = {},
): VitestReport {
  const built = Object.entries(groups).map(([group, benchmarks]) => ({
    fullName: `${file} > ${group}`,
    benchmarks,
  }));
  if (options.control !== undefined) {
    built.unshift({
      fullName: `${file} > control`,
      benchmarks: [benchmark('mixed', options.control)],
    });
  }
  return { files: [{ filepath: `/abs/${file}`, groups: built }] };
}

function run(packageName: string, vitestReport: VitestReport): PackageRun {
  return { packageName, report: vitestReport };
}

describe('control normalisation', () => {
  it('records each benchmark as a ratio against the control in its own file', () => {
    const normalised = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 2)] }, { control: 0.5 })),
    );
    const key = benchKey('@dagr/graph', 'graph.bench.ts > attrs', 'update');
    expect(normalised.benchmarks[key]?.ratio).toBe(4);
    expect(normalised.benchmarks[key]?.medianMs).toBe(2);
    expect(normalised.errors).toEqual([]);
  });

  it('produces the same ratio on a machine that is uniformly slower', () => {
    const fast = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 2)] }, { control: 0.5 })),
    );
    const slow = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 6)] }, { control: 1.5 })),
    );
    const key = benchKey('@dagr/graph', 'graph.bench.ts > attrs', 'update');
    expect(slow.benchmarks[key]?.ratio).toBe(fast.benchmarks[key]?.ratio);
  });

  it('does not record the control as a gated benchmark', () => {
    const normalised = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 2)] }, { control: 0.5 })),
    );
    expect(Object.keys(normalised.benchmarks)).toHaveLength(1);
    expect(normalised.controls['@dagr/graph > graph.bench.ts']).toBe(0.5);
  });

  it('normalises each file against its own control', () => {
    // vitest isolates each bench file into its own worker, so one file's
    // control describes conditions the other file never ran under.
    const merged: VitestReport = {
      files: [
        ...report('a.bench.ts', { g: [benchmark('x', 2)] }, { control: 0.5 }).files,
        ...report('b.bench.ts', { g: [benchmark('x', 2)] }, { control: 2 }).files,
      ],
    };
    const normalised = normalisePackageRun(run('@dagr/graph', merged));
    expect(normalised.benchmarks[benchKey('@dagr/graph', 'a.bench.ts > g', 'x')]?.ratio).toBe(4);
    expect(normalised.benchmarks[benchKey('@dagr/graph', 'b.bench.ts > g', 'x')]?.ratio).toBe(1);
  });
});

describe('guards against measuring nothing', () => {
  it('rejects a bench file with no control', () => {
    const normalised = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 2)] })),
    );
    expect(normalised.errors.join(' ')).toMatch(/registers no control/);
    expect(normalised.benchmarks).toEqual({});
  });

  it('rejects a control that measured zero', () => {
    const normalised = normalisePackageRun(
      run('@dagr/graph', report('graph.bench.ts', { attrs: [benchmark('update', 2)] }, { control: 0 })),
    );
    expect(normalised.errors.join(' ')).toMatch(/control median of zero/);
  });

  it('rejects two packages reporting the same key', () => {
    const same = report('shared.bench.ts', { g: [benchmark('x', 1)] }, { control: 1 });
    const normalised = normaliseRuns([run('@dagr/graph', same), run('@dagr/graph', same)]);
    expect(normalised.errors.join(' ')).toMatch(/reported twice/);
  });

  it('keeps benchmarks from different packages apart', () => {
    const shape = report('same.bench.ts', { g: [benchmark('x', 1)] }, { control: 1 });
    const normalised = normaliseRuns([run('@dagr/graph', shape), run('@dagr/layout', shape)]);
    expect(normalised.errors).toEqual([]);
    expect(Object.keys(normalised.benchmarks)).toHaveLength(2);
  });
});
