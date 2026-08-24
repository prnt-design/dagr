import { describe, expect, it } from 'vitest';

import { MAX_NON_UNIFORMITY, compareMachineProfile } from '../src/profile.mjs';
import type { MachineProfile } from '../src/profile.mjs';

const FILE = '@dagr/graph > graph.bench.ts';

/** A profile for one bench file, in the order the probes are registered. */
function profile(alloc: number, chase: number): MachineProfile {
  return { [FILE]: { alloc, chase } };
}

/**
 * What the ratio gate can and cannot cancel, stated as a comparison rather
 * than as a claim about a CPU name.
 *
 * The control normalises the dimension it was measured along and no other, so
 * a machine that is uniformly slower is already handled and must not be
 * reported, while a machine whose arithmetic is barely slower and whose memory
 * latency has doubled breaks every ratio in the file and has to be.
 */
describe('a uniformly slower machine', () => {
  it('is not a profile mismatch, because that is exactly what the ratio cancels', () => {
    const report = compareMachineProfile(profile(0.09, 1.0), profile(0.18, 2.0));
    expect(report.comparable).toBe(true);
    expect(report.nonUniformity).toBeCloseTo(1, 6);
    expect(report.mismatched).toBe(false);
  });

  it('is still not a mismatch when the probes disagree by as much as this box makes them', () => {
    // The widest of the fifteen pairs of six gate-sized runs taken on the
    // dispatch box on 2026-08-21 with no code changing: 1.215. Pinned as a
    // case rather than only as a constant, because a threshold that drifts
    // under the measured noise turns the note into a permanent false alarm and
    // nothing else in the suite would notice.
    const report = compareMachineProfile(profile(0.0943, 0.2991), profile(0.0875, 0.3372));
    expect(report.nonUniformity).toBeCloseTo(1.215, 3);
    expect(report.mismatched).toBe(false);
    expect(MAX_NON_UNIFORMITY).toBeGreaterThan(1.215);
  });
});

describe('a machine with a different profile', () => {
  it('is reported when one dimension moves and another does not', () => {
    const report = compareMachineProfile(profile(0.09, 1.0), profile(0.102, 1.85));
    expect(report.mismatched).toBe(true);
    expect(report.nonUniformity).toBeGreaterThan(MAX_NON_UNIFORMITY);
    expect(report.note).toContain('memory');
  });

  it('names the probe that moved and the one that did not', () => {
    const report = compareMachineProfile(profile(0.09, 1.0), profile(0.102, 1.85));
    const chase = report.files[0]?.probes.find((probe) => probe.name === 'chase');
    const alloc = report.files[0]?.probes.find((probe) => probe.name === 'alloc');
    expect(chase?.slowdown).toBeCloseTo(1.85, 6);
    expect(alloc?.slowdown).toBeCloseTo(1.1333, 4);
  });

  it('takes the widest non-uniformity across bench files, not the first', () => {
    const baseline: MachineProfile = {
      '@dagr/graph > graph.bench.ts': { alloc: 0.09, chase: 1.0 },
      '@dagr/layout > layout.bench.ts': { alloc: 0.09, chase: 1.0 },
    };
    const current: MachineProfile = {
      '@dagr/graph > graph.bench.ts': { alloc: 0.09, chase: 1.0 },
      '@dagr/layout > layout.bench.ts': { alloc: 0.09, chase: 2.0 },
    };
    const report = compareMachineProfile(baseline, current);
    expect(report.nonUniformity).toBeCloseTo(2, 6);
    expect(report.mismatched).toBe(true);
  });
});

/**
 * A guard that is vacuous by design needs a second test showing it can fail,
 * and this one is vacuous on the committed baseline by construction: that file
 * predates the probes, so the comparison has nothing to compare and says so
 * rather than passing.
 */
describe('a baseline that carries no profile', () => {
  it('is not comparable, and not a pass either', () => {
    const report = compareMachineProfile(undefined, profile(0.09, 1.0));
    expect(report.comparable).toBe(false);
    expect(report.mismatched).toBe(false);
    expect(report.note).toContain('recapture');
  });

  it('is not comparable when the run and the baseline share no bench file', () => {
    const report = compareMachineProfile(profile(0.09, 1.0), {
      '@dagr/render > render.bench.ts': { alloc: 0.09, chase: 1.0 },
    });
    expect(report.comparable).toBe(false);
  });

  it('is not comparable when only one probe survives on both sides', () => {
    const report = compareMachineProfile({ [FILE]: { chase: 1.0 } }, { [FILE]: { chase: 2.0, alloc: 0.09 } });
    expect(report.comparable).toBe(false);
  });

  it('drops a probe that measured zero rather than dividing by it', () => {
    // Which leaves one probe, and one probe measures how much slower rather
    // than whether the machines differ in kind.
    const report = compareMachineProfile({ [FILE]: { alloc: 0, chase: 1.0 } }, profile(0.18, 2.0));
    expect(report.comparable).toBe(false);
  });
});
