// @ts-check

import os from 'node:os';

/**
 * Recording a run as the committed baseline.
 *
 * @typedef {import('./gate.mjs').BaselineReport} BaselineReport
 * @typedef {import('./gate.mjs').BaselineEntry} BaselineEntry
 * @typedef {import('./gate.mjs').BenchStat} BenchStat
 * @typedef {import('./gate.mjs').MachineInfo} MachineInfo
 */

/**
 * What the numbers were measured on. Never gated against, because the gate
 * reads control-normalised ratios and nothing else. Recorded so that a human
 * reading a raw millisecond figure a year from now knows what it was measured
 * on, which is the question the raw figures exist to answer.
 *
 * @returns {MachineInfo}
 */
export function machineInfo() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    node: process.version,
    ci: process.env['CI'] === 'true' || process.env['CI'] === '1',
  };
}

/**
 * Fold a fresh run into the committed baseline.
 *
 * Exempt entries the run did not produce are carried over rather than dropped.
 * Some are measured by hand and only ever live here: ROADMAP M4.10's GPU frame
 * time is the first, and it never runs under `pnpm bench` at all, so a naive
 * overwrite would delete it on the next capture. Everything else is replaced,
 * so a benchmark deleted on purpose leaves the baseline the same way.
 *
 * @param {BaselineReport | undefined} previous
 * @param {Record<string, BenchStat>} benchmarks
 * @param {string} capturedAt
 * @returns {BaselineReport}
 */
export function mergeBaseline(previous, benchmarks, capturedAt) {
  /** @type {Record<string, BaselineEntry>} */
  const merged = { ...benchmarks };
  for (const [key, entry] of Object.entries(previous?.benchmarks ?? {})) {
    if ('gate' in entry && !(key in merged)) merged[key] = entry;
  }

  // Sorted so a baseline diff reads as the numbers that moved rather than as a
  // reordering, whatever order the packages happened to finish in.
  /** @type {Record<string, BaselineEntry>} */
  const sorted = {};
  for (const key of Object.keys(merged).sort()) {
    const entry = merged[key];
    if (entry !== undefined) sorted[key] = entry;
  }

  return { schema: 1, capturedAt, machine: machineInfo(), benchmarks: sorted };
}
