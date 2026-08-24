// @ts-check

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPORT_NAME, WORKSPACE_DIRS } from '../src/names.mjs';
import { MAX_ATTEMPTS, decide, sharedFailures } from '../src/repeat.mjs';

/**
 * The single step the agent runs locally before opening a pull request:
 * measure, repeat, and gate on whether two runs agreed.
 *
 * TWO OF THREE, since 2026-08-16. The gate measures up to three times and
 * passes when two runs pass; it fails when two runs fail; and three runs that
 * never agree are reported as undecided, which is not green either. It used to
 * measure once and re-measure only an unreadable run, and the reason that
 * stopped being enough is on the record rather than suspected. On this box,
 * with several agent sessions resident and some of them in an unrelated
 * checkout that cannot read the gate lock: unmodified `main` failed one run and
 * passed the next a minute later; a markdown-only branch passed at a 1-minute
 * load of 4.56, failed at 5.07, and passed again at a HIGHER 6.18; a branch
 * whose diff was zero bytes against `packages/graph`, `packages/layout` and
 * `bench` reported `descendants, 10k` at +94.9%. Sessions coped by re-running
 * until green, by hand, which is precisely the habit that hides a real
 * regression: the gate now does the repeating itself and says what it saw.
 *
 * The repetition is not a way to let a regression through, and the arithmetic
 * is the argument. A regression fails the SAME entry every run, because the
 * extra work is in the code, so it fails twice and the gate fails with it. Noise
 * picks a different entry each run, which is exactly what the sessions above
 * observed, so it rarely fails the same one twice. On a failure this prints
 * which of the two it saw, because that sentence is what a reader needs and it
 * costs nothing beyond runs already taken.
 *
 * The readability rules are unchanged. `bench-check.mjs` exits 2 when the run
 * was too noisy to read, and such a run is neither a pass nor a fail: it does
 * not count towards either two. What used to be "retry once on exit 2"
 * generalises into the attempt budget below.
 *
 * A harness error is not re-measured. A stale report, a missing baseline, a
 * malformed exemption or a baseline captured on a different machine reproduces
 * on the next run by construction, so spending two more measurements on it buys
 * nothing. The machine case is the one that most needs saying: it moves whole
 * families of entries at once, so re-measuring it produces the same failing
 * entries every run, which is precisely the signature this command reports as
 * the strongest evidence for a real regression.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const check = fileURLToPath(new URL('./bench-check.mjs', import.meta.url));

/** Let the machine settle between measurements, so a repeat is not a repeat of the load. */
const SETTLE_MS = 5_000;

/** @typedef {import('../src/repeat.mjs').RunSummary} RunSummary */

/**
 * Run a command, reporting whether it CHOSE its exit code or was killed.
 *
 * The signal is the part that matters and the part `status` cannot carry: a
 * process killed by SIGKILL reports a null status, and reading that as an exit
 * 1 makes a machine that ran out of memory look exactly like a gate that
 * rejected the run. Those two want opposite responses.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {{ status: number, signal: NodeJS.Signals | null }}
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error !== undefined) {
    console.error(`failed to run ${command}: ${result.error.message}`);
    return { status: 1, signal: null };
  }
  return { status: result.status ?? 1, signal: result.signal };
}

/**
 * Delete every package's benchmark report before measuring again.
 *
 * Without this the attempts are not independent, and independence is the whole
 * claim. `pnpm bench` is `pnpm -r --if-present bench`, so a package that stops
 * writing a report while pnpm still exits zero (its bench script renamed or
 * removed) leaves the PREVIOUS attempt's file on disk, minutes old and well
 * inside the staleness ceiling `bench-check.mjs` enforces. The gate would then
 * read one measurement twice and call it two agreeing runs. Deleting first
 * turns that into the missing-report error it actually is.
 */
function clearReports() {
  for (const workspace of WORKSPACE_DIRS) {
    const workspacePath = join(root, workspace);
    if (!existsSync(workspacePath)) continue;
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      rmSync(join(workspacePath, entry.name, REPORT_NAME), { force: true });
    }
  }
}

/**
 * One measurement: benchmark, then gate, then read back what the gate concluded.
 *
 * `benchFailed` is separated from the gate's own verdict because `pnpm bench`
 * exiting non-zero means the benchmarks did not run, which is a broken workspace
 * rather than a slow one.
 *
 * @param {string} summaryPath
 * @returns {{ benchFailed: number } | { summary: RunSummary }}
 */
function measure(summaryPath) {
  clearReports();
  const benched = run('pnpm', ['bench']);
  if (benched.status !== 0) return { benchFailed: benched.status };

  const gated = run('node', [check, '--summary', summaryPath]);
  if (existsSync(summaryPath)) {
    return { summary: /** @type {RunSummary} */ (JSON.parse(readFileSync(summaryPath, 'utf8'))) };
  }

  // No summary means the gate never reached the point where it writes one, and
  // WHY it did not is the whole question. Killed by a signal is the machine
  // running out of something, which is the transient this command exists to
  // absorb, so it reads as an unreadable run: it counts towards neither two and
  // the next attempt still happens. Any chosen exit code is the gate refusing
  // the run before it could read it, which is what a missing or malformed
  // bench/baseline.json does, and repeating that three times would spend ten
  // minutes to print "nothing was measured" over a file with a conflict marker
  // in it.
  if (gated.signal !== null) {
    console.error(
      `\nThe gate was killed by ${gated.signal} before it could write a summary. Reading that as an unreadable run rather than a verdict, and measuring again.`,
    );
    return { summary: { outcome: 'inconclusive', failing: [] } };
  }
  console.error(
    `\nThe gate exited ${String(gated.status)} without writing a summary, which means it refused the run before it could read it. Check bench/baseline.json.`,
  );
  return { summary: { outcome: 'error', failing: [] } };
}

/** A synchronous sleep: there is nothing else for this process to do, and the
 * point is to stop competing with whatever made the last run noisy. */
function settle() {
  console.error(`\nLetting the machine settle for ${String(SETTLE_MS / 1000)}s before measuring again.`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
}

const summaryDir = mkdtempSync(join(tmpdir(), 'dagr-bench-ci-'));
// Registered rather than wrapped in a `finally`, because every exit below goes
// through `process.exit`, which skips a `finally` and runs this.
process.on('exit', () => {
  rmSync(summaryDir, { recursive: true, force: true });
});

/** @type {RunSummary[]} */
const runs = [];
let verdict = decide(runs);

for (let attempt = 1; attempt <= MAX_ATTEMPTS && verdict.status === 'pending'; attempt += 1) {
  if (attempt > 1) settle();
  console.error(`\nBenchmark gate, measurement ${String(attempt)} of at most ${String(MAX_ATTEMPTS)}.`);

  const measured = measure(join(summaryDir, `run-${String(attempt)}.json`));
  if ('benchFailed' in measured) process.exit(measured.benchFailed);
  if (measured.summary.outcome === 'error') {
    console.error(
      '\nThe harness rejected this run, which is a fact about the harness rather than about the code. It would reject the next one the same way, so the gate is not measuring again.',
    );
    process.exit(1);
  }

  runs.push(measured.summary);
  verdict = decide(runs);
}

console.log('\nWhat the runs concluded:');
for (const [index, summary] of runs.entries()) {
  const failing = summary.failing.length > 0 ? `: ${summary.failing.join(', ')}` : '';
  console.log(`  run ${String(index + 1)}  ${summary.outcome}${failing}`);
}
console.log(`\n${verdict.reason}.`);

if (verdict.status === 'pass') {
  console.log('\nBenchmark gate passed.');
  process.exit(0);
}

if (runs.some((summary) => summary.outcome === 'regressed')) {
  console.log(`\n${sharedFailures(runs).verdict}.`);
}
console.error(
  verdict.status === 'fail'
    ? '\nBenchmark gate failed.'
    : '\nBenchmark gate is undecided, which is not a pass. Re-run it, and if it stays undecided look at whether the box will go quiet at all and whether a benchmark has become too allocation-heavy to measure here.',
);
process.exit(1);
