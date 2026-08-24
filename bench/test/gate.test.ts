import { describe, expect, it } from 'vitest';

import { GATE_DEFAULTS, compareReports } from '../src/gate.mjs';
import type { BaselineReport, BenchReport, MachineInfo } from '../src/gate.mjs';

/**
 * The gate is the only part of the harness with real logic, and it is the part
 * that decides whether a red CI run means anything. It is tested against
 * hand-written reports rather than against a live `vitest bench` run, because
 * the numbers a live run produces are exactly the thing that cannot be pinned.
 */

/** A quiet, well-behaved measurement. Overridden per test where it matters. */
function stat(ratio: number, rme = 1): BenchReport['benchmarks'][string] {
  return { medianMs: ratio * 0.5, meanMs: ratio * 0.52, rme, samples: 5000, ratio };
}

function baseline(benchmarks: BaselineReport['benchmarks']): BaselineReport {
  return { schema: 1, benchmarks };
}

function current(benchmarks: BenchReport['benchmarks']): BenchReport {
  return { schema: 1, benchmarks };
}

function statusOf(report: ReturnType<typeof compareReports>, key: string): string {
  const result = report.results.find((candidate) => candidate.key === key);
  if (result === undefined) throw new Error(`no result for ${key}`);
  return result.status;
}

describe('the 10% gate', () => {
  it('passes a benchmark that did not move', () => {
    const report = compareReports(baseline({ a: stat(4) }), current({ a: stat(4) }));
    expect(statusOf(report, 'a')).toBe('pass');
    expect(report.ok).toBe(true);
  });

  it('passes a regression inside the tolerance', () => {
    // 4 -> 4.2 is 5%, comfortably inside 10% plus the noise allowance.
    const report = compareReports(baseline({ a: stat(4) }), current({ a: stat(4.2) }));
    expect(statusOf(report, 'a')).toBe('pass');
    expect(report.ok).toBe(true);
  });

  it('fails a regression outside the tolerance', () => {
    // 4 -> 4.8 is 20%, outside 10% plus 2% of noise allowance.
    const report = compareReports(baseline({ a: stat(4) }), current({ a: stat(4.8) }));
    expect(statusOf(report, 'a')).toBe('regressed');
    expect(report.ok).toBe(false);
  });

  it('reports a large improvement without failing', () => {
    const report = compareReports(baseline({ a: stat(4) }), current({ a: stat(2) }));
    expect(statusOf(report, 'a')).toBe('improved');
    expect(report.ok).toBe(true);
  });

  it('compares ratios and ignores wall-clock milliseconds', () => {
    // A CI runner half the speed of the baseline machine: every raw number
    // doubles, the control doubles with them, so the ratio is untouched. This
    // is the whole reason the gate reads `ratio` rather than `medianMs`.
    const slow = { medianMs: 4, meanMs: 4.2, rme: 1, samples: 5000, ratio: 4 };
    const report = compareReports(baseline({ a: stat(4) }), current({ a: slow }));
    expect(statusOf(report, 'a')).toBe('pass');
  });
});

describe('noise handling', () => {
  it('widens the tolerance by the measured noise of both runs', () => {
    // 4 -> 4.9 is 22.5%. Outside the quiet allowance, inside one widened by 5%
    // and 4% of measured margin of error.
    const noisyBaseline = baseline({ a: stat(4, 5) });
    const noisyCurrent = current({ a: stat(4.9, 4) });
    expect(statusOf(compareReports(noisyBaseline, noisyCurrent), 'a')).toBe('pass');
    // The same 22.5% move on a quiet pair of runs is a real regression.
    expect(statusOf(compareReports(baseline({ a: stat(4) }), current({ a: stat(4.9) })), 'a')).toBe(
      'regressed',
    );
  });

  it('allows for the drift the control cannot cancel', () => {
    // A benchmark can be measured cleanly twice and still move against the
    // control, because one control cannot normalise arithmetic, allocation and
    // cache behaviour at once. Observed at up to 9.9% on `2.5k outEdges` with
    // its own margin of error steady near 0.7%. Without this term that
    // benchmark gates at about 11% and flakes.
    const quiet = 0.7;
    const drifted = compareReports(baseline({ a: stat(4, quiet) }), current({ a: stat(4.4, quiet) }));
    expect(statusOf(drifted, 'a')).toBe('pass');
    expect(GATE_DEFAULTS.controlDrift).toBeGreaterThan(0);
  });

  it('caps how far noise can widen the tolerance', () => {
    // Without a cap, a noisy enough benchmark could never fail. 4 -> 6 is 50%,
    // beyond the cap, so it fails even though the noise allowance is huge.
    const report = compareReports(baseline({ a: stat(4, 14) }), current({ a: stat(6, 14) }));
    expect(statusOf(report, 'a')).toBe('regressed');
  });

  it('calls a measurement too noisy to read inconclusive rather than passing it', () => {
    const report = compareReports(
      baseline({ a: stat(4), b: stat(4), c: stat(4) }),
      current({ a: stat(4, GATE_DEFAULTS.maxRme + 1), b: stat(4), c: stat(4) }),
    );
    expect(statusOf(report, 'a')).toBe('inconclusive');
    expect(report.ok).toBe(true);
  });

  it('fails when most of the run is too noisy to read', () => {
    // A gate that quietly degrades to measuring nothing is the failure mode
    // this whole task exists to fix, so it is a hard error and not a warning.
    const noise = GATE_DEFAULTS.maxRme + 1;
    const report = compareReports(
      baseline({ a: stat(4), b: stat(4), c: stat(4) }),
      current({ a: stat(4, noise), b: stat(4, noise), c: stat(4) }),
    );
    expect(report.ok).toBe(false);
    expect(report.noiseError).toMatch(/too noisy/i);
    // Reported apart from `errors`, which means "the harness rejected this run
    // and would reject the next one the same way". An unreadable run is the
    // opposite of that, and `bin/bench-ci.mjs` measures again on it.
    expect(report.errors).toEqual([]);
  });

  it('separates an unreadable run from a regression', () => {
    // The two want different responses: a regression is a red build, and a bad
    // measurement is a reason to measure again. `bin/bench-ci.mjs` retries on
    // the second and never on the first.
    const noise = GATE_DEFAULTS.maxRme + 1;
    const unreadable = compareReports(
      baseline({ a: stat(4), b: stat(4) }),
      current({ a: stat(4, noise), b: stat(4, noise) }),
    );
    expect(unreadable.measuredNothing).toBe(true);

    const regression = compareReports(baseline({ a: stat(4) }), current({ a: stat(8) }));
    expect(regression.measuredNothing).toBe(false);
    expect(regression.ok).toBe(false);
  });

  it('does not call a readable run unmeasured just because one entry was noisy', () => {
    const report = compareReports(
      baseline({ a: stat(4), b: stat(4), c: stat(4) }),
      current({ a: stat(4, GATE_DEFAULTS.maxRme + 1), b: stat(4), c: stat(4) }),
    );
    expect(report.measuredNothing).toBe(false);
  });
});

describe('the no-op guards', () => {
  it('fails when the run produced no benchmarks at all', () => {
    const report = compareReports(baseline({ a: stat(4) }), current({}));
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/no benchmarks/i);
  });

  it('fails when the baseline has nothing to gate against', () => {
    const report = compareReports(baseline({}), current({ a: stat(4) }));
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/nothing to gate/i);
  });

  it('fails when a benchmark in the baseline vanished from the run', () => {
    const report = compareReports(baseline({ a: stat(4), b: stat(4) }), current({ a: stat(4) }));
    expect(statusOf(report, 'b')).toBe('missing');
    expect(report.ok).toBe(false);
  });

  it('calls a whole package vanishing a harness fault rather than N regressions', () => {
    // One entry gone is a rename. Every entry of one package gone is that
    // package not benchmarking at all, and the two want different responses:
    // the second is deterministic, so `bench:ci` must fail on it at once
    // instead of reproducing it twice and reporting the same entries both
    // times, which is its strongest evidence for a REAL regression.
    const report = compareReports(
      baseline({ '@dagr/graph > f > g > a': stat(4), '@dagr/layout > f > g > b': stat(4) }),
      current({ '@dagr/graph > f > g > a': stat(4) }),
    );
    expect(statusOf(report, '@dagr/layout > f > g > b')).toBe('missing');
    expect(report.errors.join(' ')).toMatch(/@dagr\/layout produced no benchmarks/i);
    expect(report.ok).toBe(false);
  });

  it('does not call one missing entry a vanished package', () => {
    const report = compareReports(
      baseline({ '@dagr/graph > f > g > a': stat(4), '@dagr/graph > f > g > b': stat(4) }),
      current({ '@dagr/graph > f > g > a': stat(4) }),
    );
    expect(statusOf(report, '@dagr/graph > f > g > b')).toBe('missing');
    expect(report.errors).toEqual([]);
  });

  it('reports a benchmark the baseline has never seen without failing', () => {
    const report = compareReports(baseline({ a: stat(4) }), current({ a: stat(4), b: stat(4) }));
    expect(statusOf(report, 'b')).toBe('new');
    expect(report.ok).toBe(true);
  });
});

describe('the exemption path', () => {
  it('skips a benchmark that is explicitly exempt', () => {
    const report = compareReports(
      baseline({ a: stat(4), gpu: { gate: 'off', reason: 'measured by hand on one GPU' } }),
      current({ a: stat(4) }),
    );
    expect(statusOf(report, 'gpu')).toBe('exempt');
    expect(report.ok).toBe(true);
  });

  it('does not require an exempt benchmark to appear in the run', () => {
    // M4.10's GPU baseline is recorded by hand and never runs under
    // `pnpm bench`, so an exemption has to survive the missing-entry guard.
    const report = compareReports(
      baseline({ a: stat(4), gpu: { gate: 'off', reason: 'recorded locally, no comparable CI GPU' } }),
      current({ a: stat(4) }),
    );
    expect(report.ok).toBe(true);
  });

  it('rejects a gate value that is not exactly "off"', () => {
    // The baseline is hand-edited, so "on" is the natural thing to write
    // meaning "do gate this". Reading it as an exemption would leave the build
    // green over a benchmark nobody compared, which is the one outcome this
    // guard exists to prevent.
    for (const gate of ['on', 'offf', true, false, '']) {
      const report = compareReports(
        baseline({ a: stat(4), b: { gate, reason: 'looks deliberate' } as never }),
        current({ a: stat(4), b: stat(4) }),
      );
      expect(report.ok).toBe(false);
      expect(report.errors.join(' ')).toMatch(/only value that turns the gate off/i);
    }
  });

  it('rejects an exemption with no reason written down', () => {
    // An exemption is a decision. Without this, `gate: "off"` becomes the
    // quiet way to make a failing benchmark stop failing.
    const report = compareReports(
      baseline({ a: stat(4), gpu: { gate: 'off' } as never }),
      current({ a: stat(4) }),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/reason/i);
  });

  it('still fails a regression on a benchmark that is not exempt', () => {
    const report = compareReports(
      baseline({ a: stat(4), gpu: { gate: 'off', reason: 'no comparable CI GPU' } }),
      current({ a: stat(6) }),
    );
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'a')).toBe('regressed');
  });
});

describe('the machine the baseline names', () => {
  /** The machine `bench/baseline.json` was captured on, as `machineInfo` records it. */
  function machine(over: Partial<MachineInfo> = {}): MachineInfo {
    return {
      platform: 'linux',
      arch: 'x64',
      cpu: 'AMD EPYC-Rome Processor',
      cores: 8,
      node: 'v22.23.2',
      ci: false,
      loadAverageAtCapture: 1.3,
      ...over,
    };
  }

  /** Generic over the report, because both sides of a comparison record one. */
  function on<T extends { machine?: MachineInfo }>(report: T, info: MachineInfo): T {
    return { ...report, machine: info };
  }

  it('rejects a comparison against a baseline captured on a different CPU', () => {
    // Measured, not supposed. The dispatch box was an AMD EPYC-Rome VM when
    // PR #48 captured the baseline on 2026-08-16 and an Intel Xeon Skylake two
    // days later, and unmodified `main` then failed its own gate twice at a
    // 1-minute load of 0.54: six entries over +20%, concentrated in the
    // memory-latency-bound ones the allocation-heavy control cannot normalise.
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine()),
      on(current({ a: stat(4) }), machine({ cpu: 'Intel Xeon Processor (Skylake, IBRS, no TSX)' })),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toMatch(/different machine/i);
    expect(report.errors.join(' ')).toMatch(/EPYC-Rome/);
    expect(report.errors.join(' ')).toMatch(/Skylake/);
  });

  it('says which fields differ, all of them rather than the first', () => {
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine()),
      on(current({ a: stat(4) }), machine({ arch: 'arm64', cores: 10, node: 'v24.0.0' })),
    );
    const said = report.errors.join(' ');
    for (const field of ['arch', 'cores', 'node']) expect(said).toMatch(new RegExp(field));
    expect(said).not.toMatch(/cpu/);
  });

  it('is a harness error rather than a regression, so the gate stops measuring', () => {
    // The distinction is the whole value of this check. A different machine
    // reproduces on the next run by construction, so `bench:ci` must fail on
    // the first measurement instead of spending three reproducing it and then
    // reporting the same entries every time, which is its strongest evidence
    // for a REAL regression. `summarise` reads anything in `errors` that way,
    // which is why the message goes there and not into `notes`.
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine()),
      on(current({ a: stat(4) }), machine({ cpu: 'Intel Xeon Processor (Skylake, IBRS, no TSX)' })),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.measuredNothing).toBe(false);
    expect(statusOf(report, 'a')).toBe('pass');
  });

  it('still prints what the entries did, because those numbers are the evidence', () => {
    // Rejecting the comparison does not mean hiding it. A human deciding
    // whether to recapture wants to see how far the entries moved and which
    // ones, so the mismatch fails the run without suppressing the table.
    const report = compareReports(
      on(baseline({ a: stat(4), b: stat(4) }), machine()),
      on(current({ a: stat(8), b: stat(4) }), machine({ cpu: 'Intel Xeon' })),
    );
    expect(statusOf(report, 'a')).toBe('regressed');
    expect(statusOf(report, 'b')).toBe('pass');
  });

  it('passes the same machine through untouched', () => {
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine()),
      on(current({ a: stat(4) }), machine({ loadAverageAtCapture: 4.1 })),
    );
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('ignores the fields that describe conditions rather than identity', () => {
    // `ci` says who started the run and `loadAverageAtCapture` says how busy
    // the box was, and neither changes whether two numbers are comparable.
    // Gating on them would block a merge over a neighbour's build.
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine({ ci: false, loadAverageAtCapture: 0.2 })),
      on(current({ a: stat(4) }), machine({ ci: true, loadAverageAtCapture: 7.9 })),
    );
    expect(report.errors).toEqual([]);
  });

  it('does not read cosmetic whitespace in a CPU model as a different machine', () => {
    // `os.cpus()` pads some models to a fixed width, and a merge blocked by two
    // spaces would teach the next reader to distrust the check.
    const report = compareReports(
      on(baseline({ a: stat(4) }), machine({ cpu: 'Intel Xeon  CPU @ 2.10GHz ' })),
      on(current({ a: stat(4) }), machine({ cpu: 'Intel Xeon CPU @ 2.10GHz' })),
    );
    expect(report.errors).toEqual([]);
  });

  it('notes rather than fails when a report records no machine at all', () => {
    // `machine` is optional in schema 1, and a hand-written baseline without it
    // is not evidence of a mismatch. Saying so once beats either failing a run
    // over a missing field or checking nothing without mentioning it.
    const report = compareReports(baseline({ a: stat(4) }), on(current({ a: stat(4) }), machine()));
    expect(report.errors).toEqual([]);
    expect(report.notes.join(' ')).toMatch(/no machine/i);
    expect(report.ok).toBe(true);
  });
});
