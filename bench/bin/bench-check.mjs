// @ts-check

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { machineInfo, mergeBaseline } from '../src/baseline.mjs';
import { normaliseRuns } from '../src/collect.mjs';
import { compareReports } from '../src/gate.mjs';

/**
 * The benchmark gate's command line entry point.
 *
 * `pnpm bench:check` compares the last `pnpm bench` run against the committed
 * baseline and exits non-zero on a regression. `pnpm bench:baseline` records
 * the run as the new baseline instead.
 *
 * Plain `.mjs` rather than TypeScript because this runs under bare `node` in
 * CI, in a job that has deliberately not built anything yet. `checkJs` in
 * `bench/tsconfig.json` keeps it under the same strict compiler as the rest of
 * the workspace.
 */

/** @typedef {import('../src/gate.mjs').BaselineReport} BaselineReport */
/** @typedef {import('../src/gate.mjs').BaselineEntry} BaselineEntry */
/** @typedef {import('../src/collect.mjs').PackageRun} PackageRun */

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselinePath = join(root, 'bench', 'baseline.json');
const REPORT_NAME = 'bench-report.json';
const WORKSPACE_DIRS = ['packages', 'apps'];

/**
 * A run older than this almost certainly means `pnpm bench` was not run before
 * `pnpm bench:check`, and stale numbers would be gated as if they were fresh.
 */
const MAX_REPORT_AGE_MS = 30 * 60 * 1000;

/**
 * Find every package that wrote a benchmark report.
 *
 * @returns {{ runs: PackageRun[], stale: string[] }}
 */
function collectRuns() {
  /** @type {PackageRun[]} */
  const runs = [];
  /** @type {string[]} */
  const stale = [];
  const now = Date.now();

  for (const workspace of WORKSPACE_DIRS) {
    const workspacePath = join(root, workspace);
    if (!existsSync(workspacePath)) continue;
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageDir = join(workspacePath, entry.name);
      const reportPath = join(packageDir, REPORT_NAME);
      const manifestPath = join(packageDir, 'package.json');
      if (!existsSync(reportPath) || !existsSync(manifestPath)) continue;

      const age = now - statSync(reportPath).mtimeMs;
      if (age > MAX_REPORT_AGE_MS) {
        stale.push(`${workspace}/${entry.name} (${String(Math.round(age / 60_000))} minutes old)`);
        continue;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      runs.push({
        packageName: typeof manifest.name === 'string' ? manifest.name : `${workspace}/${entry.name}`,
        report: JSON.parse(readFileSync(reportPath, 'utf8')),
      });
    }
  }

  return { runs, stale };
}

/**
 * @param {number} value
 * @returns {string}
 */
function percent(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function main() {
  const update = process.argv.includes('--update');
  const { runs, stale } = collectRuns();

  /** @type {string[]} */
  const errors = [];
  for (const entry of stale) {
    errors.push(`${entry} report is stale. Run \`pnpm bench\` before \`pnpm bench:check\``);
  }
  if (runs.length === 0 && stale.length === 0) {
    errors.push('no package wrote a benchmark report. Run `pnpm bench` first');
  }

  const normalised = normaliseRuns(runs);
  errors.push(...normalised.errors);

  if (Object.keys(normalised.controls).length > 0) {
    console.log('Control workload, median milliseconds per iteration:');
    for (const [key, median] of Object.entries(normalised.controls)) {
      console.log(`  ${key.padEnd(52)} ${median.toFixed(4)}`);
    }
    console.log('');
  }

  if (update) {
    if (errors.length > 0) {
      for (const error of errors) console.error(`  error  ${error}`);
      console.error('\nRefusing to record a baseline from a run the harness rejected.');
      process.exit(1);
    }
    const previous = existsSync(baselinePath)
      ? /** @type {BaselineReport} */ (JSON.parse(readFileSync(baselinePath, 'utf8')))
      : undefined;
    const baseline = mergeBaseline(previous, normalised.benchmarks, new Date().toISOString());
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    const count = Object.keys(baseline.benchmarks).length;
    console.log(`Recorded ${String(count)} benchmarks to bench/baseline.json on ${baseline.machine?.cpu ?? 'unknown'}.`);
    console.log('Commit it, and say in the message what changed to justify the new numbers.');
    return;
  }

  if (!existsSync(baselinePath)) {
    console.error('No bench/baseline.json. Run `pnpm bench && pnpm bench:baseline` and commit it.');
    process.exit(1);
  }

  const baseline = /** @type {BaselineReport} */ (JSON.parse(readFileSync(baselinePath, 'utf8')));
  const gate = compareReports(baseline, {
    schema: 1,
    machine: machineInfo(),
    benchmarks: normalised.benchmarks,
  });

  const symbols = {
    pass: '  ok  ',
    regressed: ' FAIL ',
    improved: ' fast ',
    inconclusive: ' noisy',
    missing: ' GONE ',
    new: ' new  ',
    exempt: ' skip ',
  };

  const order = ['regressed', 'missing', 'inconclusive', 'new', 'improved', 'exempt', 'pass'];
  const sorted = [...gate.results].sort(
    (left, right) => order.indexOf(left.status) - order.indexOf(right.status),
  );

  for (const result of sorted) {
    const change =
      result.delta === undefined
        ? ''
        : `${percent(result.delta).padStart(7)} of ${percent(result.tolerance ?? 0).padStart(6)} allowed`;
    console.log(`${symbols[result.status]}  ${result.key.padEnd(64)} ${change}`);
    if (result.detail !== undefined) console.log(`        ${result.detail}`);
  }

  for (const note of gate.notes) console.log(`\n  note   ${note}`);
  for (const error of [...errors, ...gate.errors]) console.error(`\n  error  ${error}`);

  // Two failure kinds, two exit codes, because they want different responses. A
  // regression is a red build. A run too noisy to read says nothing about the
  // code either way, and the answer to a bad measurement is to measure again,
  // which is what `bin/bench-ci.mjs` does with exit code 2. Passing an
  // unreadable run instead would be the silent no-op this harness exists to
  // prevent, so it is still not a pass.
  const regressed = gate.results.some(
    (result) => result.status === 'regressed' || result.status === 'missing',
  );
  const onlyNoise = gate.measuredNothing && !regressed && errors.length === 0 && gate.errors.length === 1;

  if (onlyNoise) {
    console.error('\nBenchmark gate could not read this run. Re-measure before drawing a conclusion.');
    process.exit(2);
  }
  if (!gate.ok || errors.length > 0) {
    console.error('\nBenchmark gate failed.');
    process.exit(1);
  }
  console.log('\nBenchmark gate passed.');
}

main();
