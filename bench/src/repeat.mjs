// @ts-check

/**
 * Reading one gate run as a measurement, and several of them as a verdict.
 *
 * `gate.mjs` answers "did this run land inside tolerance". This module answers
 * the question that turned out to matter more on a shared machine: "did two
 * runs agree". They are separate because a single run stopped being evidence
 * here. Measured on this box between 2026-08-14 and 2026-08-16, on branches
 * that changed no code the gate can see: unmodified `main` failed one run and
 * passed the next a minute later; a markdown-only branch passed at a 1-minute
 * load of 4.56, failed at 5.07 and passed again at a HIGHER 6.18; a branch with
 * a zero-byte diff against `packages/graph`, `packages/layout` and `bench`
 * reported `descendants, 10k` at +94.9% and layout `rank > 1k` at +59.9% while
 * the pipeline entry that RUNS ranking came in at -5.5% on the same run.
 *
 * A different entry failing each time is noise's signature, and it is also the
 * lever: a real regression fails the SAME entry every run, because the extra
 * work is in the code rather than in the scheduler. So the gate repeats itself
 * and reads the agreement, rather than widening a tolerance until the noise
 * fits inside it. A wider tolerance hides the drift and the regression
 * together; two agreeing runs separate them.
 *
 * Kept as pure functions over already-summarised runs, like `gate.mjs`, so the
 * decision that gates a merge is testable without measuring anything.
 */

/** @typedef {import('./gate.mjs').GateReport} GateReport */

/**
 * What one `bench:check` run concluded.
 *
 * - `pass`: measured, inside tolerance.
 * - `regressed`: measured, outside tolerance, or a baseline entry vanished.
 * - `inconclusive`: too noisy to read. Neither a pass nor a fail, and it does
 *   not count towards either total.
 * - `error`: the harness rejected the run (stale reports, no baseline, a
 *   duplicate key, a malformed exemption). Not a measurement at all.
 *
 * @typedef {'pass' | 'regressed' | 'inconclusive' | 'error'} RunOutcome
 */

/**
 * @typedef {object} RunSummary
 * @property {RunOutcome} outcome
 * @property {string[]} failing Keys that regressed or went missing, in report order.
 */

/** How many times `bench:ci` measures before it gives up on an agreement. */
export const MAX_ATTEMPTS = 3;

/** How many runs have to agree before the gate says anything about the code. */
export const AGREEING_RUNS = 2;

/**
 * Reduce a gate report to the two facts repetition needs.
 *
 * The exit code of `bench:check` is derived from this too, so there is one
 * definition of what a run concluded rather than two that can drift.
 *
 * The order of the branches is the contract. A harness error outranks
 * everything, including a regression, because it says the run itself is not
 * readable evidence: a stale package report drops its whole package from the
 * run, and every baseline entry under it then reads as `missing`, which is a
 * regression's exit code for a measurement that never happened. Below that, a
 * regression outranks an unreadable run, because a run that measured a
 * regression and lost half its remaining entries to noise still measured the
 * regression.
 *
 * `measuredNothing` accounts for exactly one of `gate.errors`, which is what
 * lets that one be subtracted out and the rest be read as hard errors.
 *
 * @param {GateReport} gate
 * @param {string[]} harnessErrors Errors raised outside the gate, such as stale reports.
 * @returns {RunSummary}
 */
export function summarise(gate, harnessErrors) {
  const failing = gate.results
    .filter((result) => result.status === 'regressed' || result.status === 'missing')
    .map((result) => result.key);

  const hardErrors = harnessErrors.length + gate.errors.length - (gate.measuredNothing ? 1 : 0);
  if (hardErrors > 0) return { outcome: 'error', failing };
  if (failing.length > 0) return { outcome: 'regressed', failing };
  if (gate.measuredNothing) return { outcome: 'inconclusive', failing };
  return { outcome: 'pass', failing };
}

/**
 * @typedef {object} Verdict
 * @property {'pass' | 'fail' | 'undecided' | 'pending'} status
 *   `pending` means neither side has two runs yet and there are attempts left.
 * @property {string} reason A sentence for the operator, stating what was seen.
 */

/**
 * Decide a gate from the runs taken so far.
 *
 * Two passes pass it, two failures fail it, and anything else after the last
 * attempt is `undecided`: three runs that never agreed have demonstrated
 * nothing about the code, which is a different fact from a regression and is
 * said as one. `undecided` is still not green, because the property the gate
 * claims is a repeatable pass and that is exactly what is missing.
 *
 * An `error` run is not handled here. The harness rejecting a run is
 * deterministic (a stale report is stale on the next run too), so `bench:ci`
 * fails on the first one rather than spending two more measurements
 * reproducing it.
 *
 * @param {RunSummary[]} runs
 * @param {number} [maxAttempts]
 * @returns {Verdict}
 */
export function decide(runs, maxAttempts = MAX_ATTEMPTS) {
  const passes = runs.filter((run) => run.outcome === 'pass').length;
  const failures = runs.filter((run) => run.outcome === 'regressed').length;
  const unreadable = runs.filter((run) => run.outcome === 'inconclusive').length;
  const attempts = runs.length;

  if (passes >= AGREEING_RUNS) {
    return {
      status: 'pass',
      reason: `${String(passes)} of ${String(attempts)} runs passed. Two agreeing runs are what this gate claims`,
    };
  }
  if (failures >= AGREEING_RUNS) {
    return {
      status: 'fail',
      reason: `${String(failures)} of ${String(attempts)} runs failed`,
    };
  }
  if (attempts < maxAttempts) return { status: 'pending', reason: 'no two runs agree yet' };

  if (passes + failures === 0) {
    return {
      status: 'undecided',
      reason: `all ${String(unreadable)} runs were too noisy to read. Nothing was measured, so nothing is being claimed about the code`,
    };
  }
  return {
    status: 'undecided',
    reason: `${String(maxAttempts)} runs never agreed (${String(passes)} passed, ${String(failures)} failed, ${String(unreadable)} unreadable). A repeatable pass is the property this gate claims, and it was not shown`,
  };
}

/**
 * What the failing runs failed on, read for whether it is the same thing twice.
 *
 * This is the cheapest real-versus-noise test the project has, and it costs
 * nothing beyond runs already taken. A regression is in the code, so it fails
 * the same entry every run; noise picks a different entry each time. Across
 * five sessions on this box the noisy failures were `descendants, 10k`,
 * `updateNodeAttrs, watched`, `build > 1k`, layout `rank > 1k`, `isAcyclic` and
 * `topologicalOrder`, each on a branch that could not have touched them.
 *
 * @param {RunSummary[]} runs
 * @returns {{ repeated: string[], varied: string[], verdict: string }}
 */
export function sharedFailures(runs) {
  const failingRuns = runs.filter((run) => run.outcome === 'regressed');
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const run of failingRuns) {
    // A key counted once per run, so a run cannot vote twice for an entry.
    for (const key of new Set(run.failing)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= AGREEING_RUNS)
    .map(([key]) => key);
  const varied = [...counts.entries()]
    .filter(([, count]) => count < AGREEING_RUNS)
    .map(([key]) => key);

  if (failingRuns.length < AGREEING_RUNS) {
    return {
      repeated,
      varied,
      verdict: 'Only one run failed, so there is nothing to compare it against',
    };
  }
  if (repeated.length > 0) {
    return {
      repeated,
      varied,
      verdict: `The same ${repeated.length === 1 ? 'entry' : 'entries'} failed every failing run: ${repeated.join(', ')}. That is what a real regression looks like, so read this as one until the code says otherwise`,
    };
  }
  return {
    repeated,
    varied,
    verdict: `No entry failed twice (${varied.join(', ')}). A different entry each run is what noise on this box looks like, so measure again on a quieter machine before believing it`,
  };
}
