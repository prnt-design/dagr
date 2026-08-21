// @ts-check

/**
 * The benchmark gate: what "within 10% of baseline" actually means once the
 * numbers are measured on a busy machine rather than on a quiet desk.
 *
 * The quality bar in the charter asks for benchmarks within 10% of baseline.
 * Taken literally, against wall-clock milliseconds recorded on one machine and
 * re-measured on another, that rule fails constantly and for reasons that have
 * nothing to do with the code under test. A gate that cries wolf gets muted,
 * and a muted gate is worth less than no gate, because it also looks like
 * coverage. Three decisions keep the 10% honest:
 *
 * 1. It gates on a RATIO, never on milliseconds. Every bench file runs a fixed
 *    control workload alongside its real ones, and each benchmark is recorded
 *    as `median / control median` measured in the same worker. A runner twice
 *    as slow as the baseline machine runs the control twice as slow too, and
 *    the ratio does not move. See `control.ts` for what the control is and
 *    where the approximation breaks, and `probes.ts` for the measurement that
 *    says whether it broke on the machine you are standing on.
 *
 * 2. It gates on the MEDIAN, not the mean. A single GC pause or a scheduler
 *    hiccup drags the mean a long way: in the run that motivated this, a
 *    0.016ms operation recorded a 12ms maximum, which put 4.9% of relative
 *    margin of error on the mean while the median barely moved.
 *
 * 3. The tolerance WIDENS BY THE MEASURED NOISE of the two runs being
 *    compared. A quiet pair gates at about 10%; a noisy runner gates wider, on
 *    evidence, rather than failing at random. That would let an arbitrarily
 *    noisy benchmark pass anything, so the widening is capped, and past
 *    `maxRme` a measurement is reported as inconclusive rather than passed. An
 *    unreadable measurement is a fact worth printing, not a green tick.
 *
 * The rest of this module is guards against the gate quietly becoming a no-op,
 * which is the exact disease it was written to cure: `pnpm bench` was
 * `pnpm -r --if-present bench` with no package defining one, so it passed
 * forever while measuring nothing.
 */

/**
 * @typedef {object} BenchStat
 * @property {number} medianMs Median time per iteration, in milliseconds.
 * @property {number} meanMs Mean per iteration. Recorded for humans, never gated on.
 * @property {number} rme Relative margin of error, as a percentage, as vitest reports it.
 * @property {number} samples How many iterations the measurement is drawn from.
 * @property {number} ratio `medianMs` over the control's `medianMs` in the same file.
 */

/**
 * A baseline entry that is deliberately outside the gate. Stats are optional
 * because an exempt number need not come from `pnpm bench` at all: ROADMAP
 * M4.10's GPU frame time is measured by hand on a named machine, and there is
 * no automated way to re-measure it, even on that same machine.
 *
 * @typedef {object} ExemptEntry
 * @property {'off'} gate
 * @property {string} reason Why this benchmark cannot be gated. Required.
 * @property {string} [note] Anything a later reader needs, such as the machine.
 */

/** @typedef {BenchStat | ExemptEntry} BaselineEntry */

/**
 * @typedef {object} MachineInfo
 * @property {string} platform
 * @property {string} arch
 * @property {string} cpu
 * @property {number} cores
 * @property {string} node
 * @property {boolean} ci
 * @property {number} [loadAverageAtCapture]
 */

/**
 * @typedef {object} BenchReport
 * @property {1} schema
 * @property {Record<string, BenchStat>} benchmarks
 * @property {MachineInfo} [machine]
 * @property {string} [capturedAt]
 */

/**
 * @typedef {object} BaselineReport
 * @property {1} schema
 * @property {Record<string, BaselineEntry>} benchmarks
 * @property {MachineInfo} [machine]
 * @property {import('./profile.mjs').MachineProfile} [machineProfile]
 *   What the machine MEASURED like when the file was captured, as distinct
 *   from what `machine` says it was called. `profile.mjs` explains why a name
 *   is not enough. Optional because every baseline captured before the probes
 *   existed lacks it.
 * @property {string} [capturedAt]
 */

/**
 * @typedef {'pass' | 'regressed' | 'improved' | 'inconclusive' | 'missing' | 'new' | 'exempt'} GateStatus
 */

/**
 * @typedef {object} GateResult
 * @property {string} key
 * @property {GateStatus} status
 * @property {number} [delta] Fractional change in ratio against the baseline.
 * @property {number} [tolerance] The allowance this comparison was given.
 * @property {number} [baselineRatio]
 * @property {number} [currentRatio]
 * @property {string} [detail]
 */

/**
 * @typedef {object} GateReport
 * @property {boolean} ok
 * @property {GateResult[]} results
 * @property {string[]} errors Hard failures that are about the harness, not the code.
 * @property {string[]} notes
 * @property {boolean} measuredNothing
 *   The run was too noisy to read, so it says nothing either way about the
 *   code. Separated from `ok` because the two want different responses: a
 *   regression is a red build, and an unreadable measurement is a reason to
 *   measure again. `bin/bench-ci.mjs` is what acts on the difference.
 * @property {string} [noiseError]
 *   What to print when `measuredNothing` is set. It is NOT in `errors`, and
 *   that separation is load bearing rather than tidy: `errors` means the
 *   harness rejected the run and repeating it would reject it the same way,
 *   which is what makes `bench:ci` stop measuring. An unreadable run is the
 *   opposite of deterministic. Counting it among `errors` and subtracting it
 *   back out again worked only while the gate raised exactly one such message,
 *   and a second one would have turned a noisy run into a merge block.
 */

/** @typedef {{ tolerance: number, controlDrift: number, maxRme: number, maxTolerance: number, maxInconclusiveFraction: number }} GateOptions */

/** @type {GateOptions} */
export const GATE_DEFAULTS = {
  /** The headline rule from the charter, applied to control-normalised ratios. */
  tolerance: 0.1,
  /**
   * What the control cannot cancel, which the per-run margin of error does not
   * see.
   *
   * `rme` describes sampling noise within one measurement. Control drift is a
   * different and systematic error: one control workload cannot normalise
   * arithmetic, allocation and cache behaviour at once, so a benchmark whose
   * mix differs from the control's moves relative to it between runs even when
   * both were measured cleanly. Measured here on `2.5k outEdges`, which is
   * almost pure pointer chasing against an allocation-heavy control: five runs
   * on one idle machine, with no code change and its own margin of error steady
   * near 0.7%, landed between -9.5% and +9.9%.
   *
   * So the effective floor is nearer 15% than 10%, and it is written down here
   * rather than folded quietly into `tolerance`, because the honest reading of
   * the charter's 10% is "10% of a number this harness can actually resolve".
   * Shrinking this is earned by making the control track better, most likely a
   * second control for low-allocation work, and not by asserting a tighter
   * number than the measurement supports.
   */
  controlDrift: 0.05,
  /**
   * Above this relative margin of error a measurement is not read as a pass or
   * a fail. Chosen so that the widened tolerance can never exceed
   * `maxTolerance` through noise alone: 10% + 15% + 15% is over the cap, so a
   * benchmark that noisy is reported rather than silently made unfailable.
   */
  maxRme: 15,
  /** However noisy the run, a change this large is a regression. */
  maxTolerance: 0.25,
  /** Past this share of unreadable benchmarks the run has measured nothing. */
  maxInconclusiveFraction: 0.5,
};

/**
 * Whether an entry is exempt, testing the VALUE and not just the key.
 *
 * Presence alone is not enough, and the difference is the whole point of the
 * guard. The baseline is hand-edited by design, so `"gate": "on"` (the natural
 * thing to write meaning "do gate this"), `"gate": false`, or a typo like
 * `"gate": "offf"` would all take the exempt branch, never be compared, and
 * leave the build green over an unmeasured benchmark. Anything that is not
 * exactly `"off"` is rejected loudly by the caller instead.
 *
 * @param {BaselineEntry} entry
 * @returns {entry is ExemptEntry}
 */
function isExempt(entry) {
  return 'gate' in entry && entry.gate === 'off';
}

/**
 * The `gate` an entry declares, as whatever JSON actually held.
 *
 * Read through `unknown` deliberately. The typedef says the only legal value is
 * `'off'`, so narrowing on the declared type would make every other value
 * unreachable to the compiler, and those are exactly the values this has to
 * catch: the file is hand-edited and nothing validates it on the way in.
 *
 * @param {BaselineEntry} entry
 * @returns {unknown}
 */
function declaredGate(entry) {
  return /** @type {{ gate?: unknown }} */ (entry).gate;
}

/**
 * Compare a run against the committed baseline.
 *
 * Returns a report rather than throwing or printing, so the same logic backs
 * the CLI, the tests, and anything later that wants to render it.
 *
 * @param {BaselineReport} baselineReport
 * @param {BenchReport} currentReport
 * @param {Partial<GateOptions>} [overrides]
 * @returns {GateReport}
 */
export function compareReports(baselineReport, currentReport, overrides = {}) {
  const options = { ...GATE_DEFAULTS, ...overrides };
  /** @type {GateResult[]} */
  const results = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const notes = [];

  if (baselineReport.schema !== 1) {
    errors.push(`baseline schema ${String(baselineReport.schema)} is not readable by this gate`);
  }

  const baselineEntries = Object.entries(baselineReport.benchmarks);
  const currentKeys = Object.keys(currentReport.benchmarks);

  if (currentKeys.length === 0) {
    errors.push(
      'no benchmarks were collected. `pnpm bench` measured nothing, which is a harness failure, not a pass',
    );
  }

  let gated = 0;
  let inconclusive = 0;

  for (const [key, entry] of baselineEntries) {
    // A `gate` spelled any way other than "off" is a mistake, not an
    // exemption, and it must not be read as either one silently.
    const declared = declaredGate(entry);
    if (declared !== undefined && declared !== 'off') {
      errors.push(
        `${key} records gate ${JSON.stringify(declared)}. The only value that turns the gate off is "off"`,
      );
      continue;
    }
    if (isExempt(entry)) {
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        errors.push(`${key} is exempt from the gate but records no reason`);
      }
      // An exempt benchmark is not required to appear in the run: some are
      // measured by hand and only recorded here.
      results.push({ key, status: 'exempt', detail: entry.reason });
      continue;
    }

    const observed = currentReport.benchmarks[key];
    if (observed === undefined) {
      results.push({
        key,
        status: 'missing',
        detail: 'in the baseline but not in this run. Rename or removal is a decision, so record it',
      });
      continue;
    }

    gated += 1;

    if (observed.rme > options.maxRme || entry.rme > options.maxRme) {
      inconclusive += 1;
      results.push({
        key,
        status: 'inconclusive',
        baselineRatio: entry.ratio,
        currentRatio: observed.ratio,
        detail: `margin of error ${observed.rme.toFixed(1)}% against a ${String(options.maxRme)}% ceiling`,
      });
      continue;
    }

    const tolerance = Math.min(
      options.tolerance + options.controlDrift + entry.rme / 100 + observed.rme / 100,
      options.maxTolerance,
    );
    const delta = (observed.ratio - entry.ratio) / entry.ratio;

    /** @type {GateStatus} */
    let status = 'pass';
    if (delta > tolerance) status = 'regressed';
    else if (delta < -tolerance) status = 'improved';

    if (status === 'improved') {
      notes.push(
        `${key} is ${(-delta * 100).toFixed(1)}% faster than baseline. Refresh the baseline so the gain is protected`,
      );
    }

    results.push({
      key,
      status,
      delta,
      tolerance,
      baselineRatio: entry.ratio,
      currentRatio: observed.ratio,
    });
  }

  // A WHOLE PACKAGE MISSING IS A HARNESS FAULT, NOT N REGRESSIONS.
  //
  // A key is `package > file > group > name`, so one absent entry is a rename
  // and every entry of one package absent is that package not benchmarking at
  // all: its `bench` script renamed, `--if-present` skipping it, a filter
  // dropping it. Both report as `missing` per entry, and the difference is what
  // the operator should go and look at. Without this the run summarises as a
  // regression, fails twice because it is deterministic, and the failure names
  // the same entries both times, which reads as the strongest evidence the gate
  // has for a REAL regression while the code is untouched.
  //
  // Only keys carrying the separator take part. `normaliseRuns` builds every
  // real key with it, and a key without one cannot be split into a package and
  // a benchmark, so guessing at where it divides would invent a package.
  const packagesGated = new Set();
  const packagesSeen = new Set();
  for (const result of results) {
    if (result.status === 'missing' && result.key.includes(' > ')) {
      packagesGated.add(result.key.split(' > ')[0]);
    }
  }
  for (const key of currentKeys) {
    if (key.includes(' > ')) packagesSeen.add(key.split(' > ')[0]);
  }
  for (const name of packagesGated) {
    if (packagesSeen.has(name)) continue;
    errors.push(
      `${String(name)} produced no benchmarks at all, so every entry it holds reads as missing. That is the package not benchmarking rather than a regression in it`,
    );
  }

  for (const [key, observed] of Object.entries(currentReport.benchmarks)) {
    if (key in baselineReport.benchmarks) continue;
    results.push({
      key,
      status: 'new',
      currentRatio: observed.ratio,
      detail: 'not in the baseline, so nothing to compare against. Run `pnpm bench:baseline`',
    });
  }

  if (gated === 0 && errors.length === 0) {
    errors.push('the baseline holds nothing to gate against');
  }

  const measuredNothing = gated > 0 && inconclusive / gated > options.maxInconclusiveFraction;
  const noiseError = measuredNothing
    ? `${String(inconclusive)} of ${String(gated)} benchmarks were too noisy to read. The gate measured nothing this run`
    : undefined;

  const failed = results.some(
    (result) => result.status === 'regressed' || result.status === 'missing',
  );

  return {
    ok: errors.length === 0 && !failed && !measuredNothing,
    results,
    errors,
    notes,
    measuredNothing,
    ...(noiseError === undefined ? {} : { noiseError }),
  };
}
