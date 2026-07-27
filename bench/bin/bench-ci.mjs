// @ts-check

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The single step CI runs: measure, gate, and re-measure once if the runner was
 * too busy to produce a readable measurement.
 *
 * The retry is not a way to let a regression through. `bench-check.mjs` exits 1
 * for a regression and 2 only when the run was too noisy to read, and a real
 * regression reproduces on the second measurement, so only exit 2 is retried. A
 * regression fails on the first attempt and never reaches here.
 *
 * This exists because the noise is predictable rather than hypothetical. CI
 * runs `pnpm build` immediately before this step, and a run started while the
 * machine was still busy with it put 7 of 10 benchmarks past the readability
 * ceiling, where the same benchmarks on a settled machine a few seconds later
 * came back with all 10 readable and inside tolerance. Failing a pull request
 * over that would make the gate a flake generator, which is the thing the
 * design set out to avoid; passing it silently would make the gate a no-op,
 * which is the thing the harness was written to fix. Measuring again is the
 * only answer that is neither.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const check = fileURLToPath(new URL('./bench-check.mjs', import.meta.url));

/** Let the machine settle before measuring, so the retry is not a repeat. */
const SETTLE_MS = 5_000;

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {number}
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error !== undefined) {
    console.error(`failed to run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** @returns {number} */
function measure() {
  const benched = run('pnpm', ['bench']);
  if (benched !== 0) return benched;
  return run('node', [check]);
}

const first = measure();
if (first !== 2) process.exit(first);

console.error(
  `\nThe run was too noisy to read. Letting the machine settle for ${String(SETTLE_MS / 1000)}s and measuring once more.`,
);
// A synchronous sleep, because there is nothing else for this process to do and
// the whole point is to stop competing with whatever made the last run noisy.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);

const second = measure();
if (second === 2) {
  console.error(
    '\nTwo runs in a row were too noisy to read. That is a fact about this runner, not about the code: nothing was measured, so nothing is being claimed. Re-run the job, or look at whether a benchmark has become too allocation-heavy to measure here.',
  );
  process.exit(1);
}
process.exit(second);
