// @ts-check

import os from 'node:os';

/**
 * Recording a run as the committed baseline.
 *
 * @typedef {import('./gate.mjs').BaselineReport} BaselineReport
 * @typedef {import('./gate.mjs').BaselineEntry} BaselineEntry
 * @typedef {import('./gate.mjs').BenchStat} BenchStat
 * @typedef {import('./gate.mjs').MachineInfo} MachineInfo
 * @typedef {import('./profile.mjs').MachineProfile} MachineProfile
 */

/**
 * What the numbers were measured on. Never gated against, because the gate
 * reads control-normalised ratios and nothing else. Recorded so that a human
 * reading a raw millisecond figure a year from now knows what it was measured
 * on, which is the question the raw figures exist to answer.
 *
 * `loadAverageAtCapture` is here because its absence cost a run. Four
 * `@dagr/graph` entries read 26% to 41% faster than the committed baseline
 * across M2.4c, M2.6d, M2.8 and M2.9 with no commit to `packages/graph/src`
 * between them, and answering "was that baseline taken on a busy machine" meant
 * inferring it from the margins of error the entries happened to record. See
 * `bench/README.md`, "The third reason to recapture".
 *
 * READ IT FOR WHAT IT IS, WHICH IS LESS THAN THE NAME `loadAverage` WOULD
 * PROMISE, and that is why it is not called that. It is sampled HERE, in
 * `bench:baseline`, which is a separate process that runs after the benchmarks
 * and only reads their reports. So it includes the benchmark run's own load,
 * and if a capture happens long after the run it describes an unrelated moment.
 * What it can settle is whether a capture was taken on an otherwise idle
 * machine; what it cannot settle on its own is what the machine was doing while
 * the numbers were being measured. Recording it at run start instead would need
 * the load carried through the vitest report, which is a change to the
 * collection path rather than to this function.
 *
 * @returns {MachineInfo}
 */
export function machineInfo() {
  const cpus = os.cpus();
  const [oneMinute] = os.loadavg();
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    node: process.version,
    ci: process.env['CI'] === 'true' || process.env['CI'] === '1',
    loadAverageAtCapture: Math.round((oneMinute ?? 0) * 100) / 100,
  };
}

/**
 * Fold a fresh run into the committed baseline.
 *
 * An exemption survives a capture whether or not the run produced its key. A
 * key the run never produces keeps its whole entry: some are measured by hand
 * and only ever live here, ROADMAP M4.10's GPU frame time being the first,
 * and a naive overwrite would delete it on the next capture. A key the run
 * DID produce keeps its `gate` and `reason` while the stats beneath refresh,
 * because an exemption is a decision someone wrote down and lifting it should
 * take a hand edit, not be a side effect of the next capture: the first
 * produced-and-exempt entry (`2.5k successors` on the dispatch box) flakes on
 * the capture machine while measuring fine, and a capture that silently
 * re-gated it would re-arm the flake with the reasoning deleted. This
 * reverses the original rule, which let a run reclaim the key. Everything
 * else is replaced, so a benchmark deleted on purpose leaves the baseline the
 * same way.
 *
 * The `gate` field is preserved verbatim rather than validated here: a typo
 * like `"offf"` is `isExempt`'s problem to surface at gate time, and a merge
 * that dropped it would hide the file's error instead.
 *
 * The machine profile is the RUN'S OWN OR ABSENT, which is the one place this
 * function does not merge. Every other field folds a fresh run into what was
 * there because the two describe the same thing measured twice; the profile
 * describes the machine the benchmarks beside it were measured on, so carrying
 * a previous capture's probes forward would pair one machine's numbers with
 * another machine's fingerprint, and the comparison that reads it would confirm
 * a match that nobody measured. A capture taken by a harness too old to produce
 * probes therefore drops the field, and `profile.mjs` reports the absence as a
 * question it could not ask.
 *
 * @param {BaselineReport | undefined} previous
 * @param {Record<string, BenchStat>} benchmarks
 * @param {string} capturedAt
 * @param {MachineProfile} [machineProfile]
 * @returns {BaselineReport}
 */
export function mergeBaseline(previous, benchmarks, capturedAt, machineProfile) {
  /** @type {Record<string, BaselineEntry>} */
  const merged = { ...benchmarks };
  for (const [key, entry] of Object.entries(previous?.benchmarks ?? {})) {
    if (!('gate' in entry)) continue;
    const fresh = merged[key];
    merged[key] =
      fresh === undefined
        ? entry
        : {
            gate: entry.gate,
            ...('reason' in entry ? { reason: entry.reason } : {}),
            ...('note' in entry ? { note: entry.note } : {}),
            ...fresh,
          };
  }

  // Sorted so a baseline diff reads as the numbers that moved rather than as a
  // reordering, whatever order the packages happened to finish in.
  /** @type {Record<string, BaselineEntry>} */
  const sorted = {};
  for (const key of Object.keys(merged).sort()) {
    const entry = merged[key];
    if (entry !== undefined) sorted[key] = entry;
  }

  const profile = machineProfile !== undefined && Object.keys(machineProfile).length > 0 ? machineProfile : undefined;

  return {
    schema: 1,
    capturedAt,
    machine: machineInfo(),
    ...(profile === undefined ? {} : { machineProfile: profile }),
    benchmarks: sorted,
  };
}
