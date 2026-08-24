import { describe, expect, it } from 'vitest';

import type { GateReport, GateResult } from '../src/gate.mjs';
import { decide, sharedFailures, summarise } from '../src/repeat.mjs';
import type { RunSummary } from '../src/repeat.mjs';

/**
 * Two of three is the part of the gate that decides whether a red run means
 * anything, so it is tested the same way the gate itself is: against
 * hand-written reports, because the numbers a live run produces are exactly the
 * thing that cannot be pinned. That is not a convenience here, it is the
 * subject. The reason this module exists is that live numbers on this box
 * disagreed with themselves across runs of identical code.
 */

function gate(over: Partial<GateReport> = {}): GateReport {
  return { ok: true, results: [], errors: [], notes: [], measuredNothing: false, ...over };
}

function result(key: string, status: GateResult['status']): GateResult {
  return { key, status };
}

function run(outcome: RunSummary['outcome'], failing: string[] = []): RunSummary {
  return { outcome, failing };
}

describe('reading one run', () => {
  it('reads a clean gate as a pass', () => {
    expect(summarise(gate({ results: [result('a', 'pass')] }), [])).toEqual({
      outcome: 'pass',
      failing: [],
    });
  });

  it('names the entries that regressed', () => {
    const report = gate({
      ok: false,
      results: [result('a', 'pass'), result('b', 'regressed'), result('c', 'regressed')],
    });
    expect(summarise(report, [])).toEqual({ outcome: 'regressed', failing: ['b', 'c'] });
  });

  it('counts a vanished baseline entry as a failing entry', () => {
    // A rename is a decision, and it fails the same way twice, so it belongs in
    // the comparison across runs rather than beside it.
    const report = gate({ ok: false, results: [result('a', 'missing')] });
    expect(summarise(report, [])).toEqual({ outcome: 'regressed', failing: ['a'] });
  });

  it('reads a run that measured nothing as inconclusive', () => {
    const report = gate({
      ok: false,
      measuredNothing: true,
      noiseError: '8 of 10 benchmarks were too noisy to read',
      results: [result('a', 'inconclusive')],
    });
    expect(summarise(report, []).outcome).toBe('inconclusive');
  });

  it('reads a harness error beside the noise as an error', () => {
    // The unreadable-run message lives in `noiseError`, so anything in `errors`
    // is about the harness and repeating the run cannot fix it. However many
    // noise messages the gate grows, they cannot be miscounted as one of these.
    const report = gate({
      ok: false,
      measuredNothing: true,
      noiseError: '8 of 10 benchmarks were too noisy to read',
      errors: ['x is exempt but records no reason'],
    });
    expect(summarise(report, []).outcome).toBe('error');
  });

  it('reads a package that stopped benchmarking as an error, not as a regression', () => {
    // The gate raises the error; this pins that the error outranks the missing
    // entries under it, so `bench:ci` says "that package is not benchmarking"
    // once instead of "the same entries failed every run" twice.
    const report = gate({
      ok: false,
      errors: ['@dagr/layout produced no benchmarks at all'],
      results: [result('@dagr/layout > f > g > a', 'missing')],
    });
    expect(summarise(report, []).outcome).toBe('error');
  });

  it('reads a machine mismatch as an error rather than as the entries it moved', () => {
    // The case this ordering was written for a second time. A baseline captured
    // on another CPU moves whole families of entries at once, so a run against
    // it looks like several regressions that reproduce every time, which is the
    // shape of the strongest evidence this gate has. It is a fact about the
    // baseline, and one measurement is enough to say so.
    const report = gate({
      ok: false,
      errors: ['the baseline was captured on a different machine (cpu ...)'],
      results: [result('a', 'regressed'), result('b', 'regressed')],
    });
    expect(summarise(report, []).outcome).toBe('error');
  });

  it('reads a stale package as an error rather than as a regression', () => {
    // This is the ordering that matters. A stale report drops its whole package
    // from the run, so every baseline entry under it reads as `missing`, which
    // has a regression's shape and none of its meaning. Repeating it would
    // report the same phantom regression three times.
    const report = gate({ ok: false, results: [result('a', 'missing'), result('b', 'missing')] });
    const summary = summarise(report, ['packages/graph report is stale']);
    expect(summary.outcome).toBe('error');
    expect(summary.failing).toEqual(['a', 'b']);
  });
});

describe('two of three', () => {
  it('passes on two passing runs', () => {
    expect(decide([run('pass'), run('pass')]).status).toBe('pass');
  });

  it('fails on two failing runs', () => {
    expect(decide([run('regressed', ['a']), run('regressed', ['a'])]).status).toBe('fail');
  });

  it('keeps measuring while no two runs agree', () => {
    expect(decide([run('pass')]).status).toBe('pending');
    expect(decide([run('pass'), run('regressed', ['a'])]).status).toBe('pending');
    expect(decide([run('inconclusive'), run('pass')]).status).toBe('pending');
  });

  it('lets a third run settle a disagreement either way', () => {
    const runs = [run('pass'), run('regressed', ['a'])];
    expect(decide([...runs, run('pass')]).status).toBe('pass');
    expect(decide([...runs, run('regressed', ['a'])]).status).toBe('fail');
  });

  it('does not count an unreadable run towards either side', () => {
    // One pass and two unreadable runs is one measurement, not two agreeing
    // ones, and the property this gate claims is a repeatable pass.
    expect(decide([run('pass'), run('inconclusive'), run('inconclusive')]).status).toBe(
      'undecided',
    );
    expect(decide([run('regressed', ['a']), run('inconclusive'), run('inconclusive')]).status).toBe(
      'undecided',
    );
  });

  it('says plainly when nothing was measured at all', () => {
    const verdict = decide([run('inconclusive'), run('inconclusive'), run('inconclusive')]);
    expect(verdict.status).toBe('undecided');
    expect(verdict.reason).toContain('Nothing was measured');
  });

  it('is undecided when three runs never agree', () => {
    const verdict = decide([run('pass'), run('regressed', ['a']), run('inconclusive')]);
    expect(verdict.status).toBe('undecided');
  });
});

describe('the same entry twice', () => {
  it('reads a repeated entry as a real regression', () => {
    const analysis = sharedFailures([
      run('regressed', ['2k updateNodeAttrs, unwatched']),
      run('regressed', ['2k updateNodeAttrs, unwatched', 'descendants, 10k']),
    ]);
    expect(analysis.repeated).toEqual(['2k updateNodeAttrs, unwatched']);
    expect(analysis.varied).toEqual(['descendants, 10k']);
    expect(analysis.verdict).toContain('real regression');
  });

  it('reads a different entry each run as noise', () => {
    const analysis = sharedFailures([
      run('regressed', ['descendants, 10k']),
      run('regressed', ['rank > 1k']),
    ]);
    expect(analysis.repeated).toEqual([]);
    expect(analysis.verdict).toContain('noise');
  });

  it('does not let one run vote twice for the same entry', () => {
    const analysis = sharedFailures([run('regressed', ['a', 'a']), run('regressed', ['b'])]);
    expect(analysis.repeated).toEqual([]);
  });

  it('has nothing to compare when only one run failed', () => {
    const analysis = sharedFailures([run('pass'), run('regressed', ['a'])]);
    expect(analysis.verdict).toContain('nothing to compare');
  });
});
