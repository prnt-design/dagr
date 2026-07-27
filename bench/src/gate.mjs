// @ts-check

/**
 * The benchmark gate: what "within 10% of baseline" actually means once the
 * numbers are measured on a shared CI runner rather than on a quiet desk.
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
 *    the ratio does not move. See `control.mjs` for what the control is and
 *    where the approximation breaks.
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
 * no comparable CI GPU to re-measure it against.
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
 */

/** @typedef {{ tolerance: number, maxRme: number, maxTolerance: number, maxInconclusiveFraction: number }} GateOptions */

/** @type {GateOptions} */
export const GATE_DEFAULTS = {
  /** The headline rule from the charter, applied to control-normalised ratios. */
  tolerance: 0.1,
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
 * @param {BaselineEntry} entry
 * @returns {entry is ExemptEntry}
 */
function isExempt(entry) {
  return 'gate' in entry;
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
      options.tolerance + entry.rme / 100 + observed.rme / 100,
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

  if (gated > 0 && inconclusive / gated > options.maxInconclusiveFraction) {
    errors.push(
      `${String(inconclusive)} of ${String(gated)} benchmarks were too noisy to read. The gate measured nothing this run`,
    );
  }

  const failed = results.some(
    (result) => result.status === 'regressed' || result.status === 'missing',
  );

  return { ok: errors.length === 0 && !failed, results, errors, notes };
}
