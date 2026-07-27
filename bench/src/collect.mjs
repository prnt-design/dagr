// @ts-check

import { CONTROL_GROUP, CONTROL_NAME } from './names.mjs';

/**
 * Turning `vitest bench --outputJson` into the control-normalised report the
 * gate reads.
 *
 * Kept as pure functions over already-parsed JSON so the interesting rules,
 * every one of which is a way the harness could quietly stop measuring, are
 * testable without running a benchmark. The file reading lives in
 * `bin/bench-check.mjs`.
 */

/**
 * @typedef {object} VitestBenchmark
 * @property {string} name
 * @property {number} mean
 * @property {number} median
 * @property {number} rme
 * @property {number} sampleCount
 */

/**
 * @typedef {object} VitestGroup
 * @property {string} fullName
 * @property {VitestBenchmark[]} benchmarks
 */

/** @typedef {{ filepath: string, groups: VitestGroup[] }} VitestFile */

/** @typedef {{ files: VitestFile[] }} VitestReport */

/** @typedef {import('./gate.mjs').BenchStat} BenchStat */
/** @typedef {import('./gate.mjs').BenchReport} BenchReport */

/**
 * @typedef {object} PackageRun
 * @property {string} packageName
 * @property {VitestReport} report
 */

/**
 * @typedef {object} NormalisedRun
 * @property {Record<string, BenchStat>} benchmarks
 * @property {Record<string, number>} controls Control median per bench file, for humans.
 * @property {string[]} errors
 */

/**
 * The key a benchmark is recorded and gated under. It carries the package
 * because two packages may reasonably benchmark things with the same name, and
 * it carries the file so a reader can find it.
 *
 * @param {string} packageName
 * @param {string} groupFullName
 * @param {string} benchName
 * @returns {string}
 */
export function benchKey(packageName, groupFullName, benchName) {
  return `${packageName} > ${groupFullName} > ${benchName}`;
}

/**
 * The group `fullName` vitest reports is `<file> > <group>`. Strip the group to
 * get back a file identity that groups within one file share.
 *
 * @param {string} groupFullName
 * @returns {string}
 */
function fileOf(groupFullName) {
  const cut = groupFullName.indexOf(' > ');
  return cut === -1 ? groupFullName : groupFullName.slice(0, cut);
}

/**
 * Normalise one package's vitest report.
 *
 * Every bench file must register the control, and the control is read from the
 * same file as the benchmarks it normalises rather than once per run. vitest
 * isolates each bench file into its own worker, so a control measured in a
 * different worker would be normalising against different conditions, which is
 * most of what it exists to cancel out.
 *
 * @param {PackageRun} run
 * @returns {NormalisedRun}
 */
export function normalisePackageRun(run) {
  /** @type {Record<string, BenchStat>} */
  const benchmarks = {};
  /** @type {Record<string, number>} */
  const controls = {};
  /** @type {string[]} */
  const errors = [];

  for (const file of run.report.files) {
    /** @type {Map<string, VitestGroup[]>} */
    const byFile = new Map();
    for (const group of file.groups) {
      const key = fileOf(group.fullName);
      const existing = byFile.get(key);
      if (existing === undefined) byFile.set(key, [group]);
      else existing.push(group);
    }

    for (const [fileName, groups] of byFile) {
      const controlGroup = groups.find((group) => group.fullName === `${fileName} > ${CONTROL_GROUP}`);
      const control = controlGroup?.benchmarks.find((bench) => bench.name === CONTROL_NAME);

      if (control === undefined) {
        errors.push(
          `${run.packageName} > ${fileName} registers no control. Call registerControl() in the file: without it the numbers cannot be compared across machines`,
        );
        continue;
      }
      if (control.median <= 0) {
        errors.push(`${run.packageName} > ${fileName} measured a control median of zero`);
        continue;
      }

      controls[`${run.packageName} > ${fileName}`] = control.median;

      for (const group of groups) {
        if (group === controlGroup) continue;
        for (const bench of group.benchmarks) {
          benchmarks[benchKey(run.packageName, group.fullName, bench.name)] = {
            medianMs: bench.median,
            meanMs: bench.mean,
            rme: bench.rme,
            samples: bench.sampleCount,
            ratio: bench.median / control.median,
          };
        }
      }
    }
  }

  return { benchmarks, controls, errors };
}

/**
 * Merge every package's run into the single report the gate compares.
 *
 * @param {PackageRun[]} runs
 * @returns {NormalisedRun}
 */
export function normaliseRuns(runs) {
  /** @type {Record<string, BenchStat>} */
  const benchmarks = {};
  /** @type {Record<string, number>} */
  const controls = {};
  /** @type {string[]} */
  const errors = [];

  for (const run of runs) {
    const normalised = normalisePackageRun(run);
    errors.push(...normalised.errors);
    Object.assign(controls, normalised.controls);
    for (const [key, stat] of Object.entries(normalised.benchmarks)) {
      if (key in benchmarks) {
        errors.push(`${key} was reported twice. Benchmark keys must be unique across the workspace`);
        continue;
      }
      benchmarks[key] = stat;
    }
  }

  return { benchmarks, controls, errors };
}
