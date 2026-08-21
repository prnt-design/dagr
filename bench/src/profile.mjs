// @ts-check

/**
 * Comparing the machine the baseline was captured on against the machine the
 * gate is running on, by measurement rather than by name.
 *
 * `gate.mjs` normalises every benchmark against a control workload so that a
 * slower machine does not read as a regression. That works, and it works for
 * exactly one shape of difference: a machine that is uniformly slower runs the
 * control uniformly slower too, and the ratio does not move. A NORMALISATION
 * CANCELS THE DIMENSION IT WAS MEASURED ALONG AND NO OTHER, which is the whole
 * of the problem this module exists for. When a box's arithmetic is 13% slower
 * and its memory latency has doubled, the control moves 13%, every
 * pointer-chasing benchmark moves 100%, and the gate prints a table of
 * regressions in packages nobody has touched.
 *
 * Recording the machine's IDENTITY does not catch it. The identity fields are
 * what the operating system says the hardware is, and on 2026-08-21 this box
 * reported the same platform, arch, CPU model, core count and node version as
 * `bench/baseline.json` records, while unmodified `main` failed the gate 2 of 2
 * at a 1-minute load of 0.10 with all fifteen entries between 14% and 139%
 * slower in absolute milliseconds. A name is not a measurement.
 *
 * So the probes are measured, recorded and compared as raw milliseconds, and
 * what is read out of them is not how much slower the machine is, which the
 * ratio already handles, but WHETHER THE PROBES AGREE ABOUT HOW MUCH SLOWER IT
 * IS. Agreement means one machine differing from the other in speed, which the
 * gate can see past. Disagreement means the two machines differ in kind, and no
 * single control can normalise that away.
 *
 * This module deliberately does not fail anything. It produces a sentence,
 * because the four runs this cost were spent on diagnosis and not on the exit
 * code: the gate was always going to be red, and what was missing was the
 * harness saying which of the two things it was red about. A profile mismatch
 * is also a measurement rather than a deterministic harness fact, so it can be
 * wrong once, and `bench:ci` takes up to three measurements for precisely that
 * reason. A mismatch that repeats across them is the confirmation.
 */

/** Probe name to median milliseconds per iteration. */
/** @typedef {Record<string, number>} ProbeMedians */

/** Bench file key, `"<package> > <file>"`, to that file's probe medians. */
/** @typedef {Record<string, ProbeMedians>} MachineProfile */

/**
 * @typedef {object} ProbeComparison
 * @property {string} name
 * @property {number} baselineMs
 * @property {number} currentMs
 * @property {number} slowdown `currentMs / baselineMs`. Above 1 is slower now.
 */

/**
 * @typedef {object} FileComparison
 * @property {string} file
 * @property {ProbeComparison[]} probes
 * @property {number} nonUniformity The widest slowdown over the narrowest.
 */

/**
 * @typedef {object} ProfileReport
 * @property {boolean} comparable
 *   Whether any bench file had two probes on both sides. False is not a pass:
 *   it means the question was not asked, which is a different fact from the
 *   machines matching and is printed as one.
 * @property {boolean} mismatched
 * @property {FileComparison[]} files
 * @property {number} [nonUniformity] The widest across the comparable files.
 * @property {string} [note] One sentence for whoever is reading a red gate.
 */

/**
 * How far the probes may disagree before the machines differ in kind.
 *
 * Set from measurement rather than chosen, and measured through the harness
 * that reads it rather than in a scratch loop beside it. It is placed between
 * two figures, both taken on the dispatch box on 2026-08-21 with no code
 * changing.
 *
 * THE NOISE, measured: six gate-sized runs at 1-minute loads between 0.2 and
 * 3.0, compared every way round, put the widest of the fifteen pairs at 1.215.
 * THE SIGNAL, estimated: the same day, the control workload was 1.134 times
 * the value `bench/baseline.json` records for it while `2.5k outEdges`, which
 * `bench/README.md` describes as almost pure pointer chasing, was 2.083 times
 * its own, which is a non-uniformity of 1.84 between two things standing in for
 * these two probes.
 *
 * 1.5 is the geometric midpoint of those, 1.495 rounded, which is the placement
 * that treats a missed diagnosis and a wrong one as costing the same. IT IS A
 * FIRST NUMBER AND ITS EVIDENCE IS ONE-SIDED, said here rather than left to be
 * discovered: the noise figure is measured directly and the signal figure is
 * inferred, because no baseline carrying probes exists on a second machine yet.
 * The first recapture makes a direct measurement possible, and that is when
 * this constant is worth revisiting.
 */
export const MAX_NON_UNIFORMITY = 1.5;

/**
 * Compare a baseline's probes against this run's.
 *
 * @param {MachineProfile | undefined} baseline
 * @param {MachineProfile | undefined} current
 * @param {number} [maxNonUniformity]
 * @returns {ProfileReport}
 */
export function compareMachineProfile(baseline, current, maxNonUniformity = MAX_NON_UNIFORMITY) {
  if (baseline === undefined || Object.keys(baseline).length === 0) {
    return {
      comparable: false,
      mismatched: false,
      files: [],
      note: 'the committed baseline carries no machine profile, so this run cannot tell a different machine from a slower one. A recapture records one, and this comparison starts working with it',
    };
  }

  /** @type {FileComparison[]} */
  const files = [];
  for (const [file, baselineProbes] of Object.entries(baseline)) {
    const currentProbes = current?.[file];
    if (currentProbes === undefined) continue;

    /** @type {ProbeComparison[]} */
    const probes = [];
    for (const [name, baselineMs] of Object.entries(baselineProbes)) {
      const currentMs = currentProbes[name];
      // A probe measuring zero is a probe measuring nothing, and dividing by it
      // would turn that into an infinitely faster machine. The collector
      // already refuses a run that produces one; this is the other end, for a
      // baseline captured before it did.
      if (currentMs === undefined || baselineMs <= 0 || currentMs <= 0) continue;
      probes.push({ name, baselineMs, currentMs, slowdown: currentMs / baselineMs });
    }

    // One probe measures how much slower, which the ratio already cancels.
    // Non-uniformity needs two to disagree with each other.
    if (probes.length < 2) continue;

    const slowdowns = probes.map((probe) => probe.slowdown);
    files.push({
      file,
      probes,
      nonUniformity: Math.max(...slowdowns) / Math.min(...slowdowns),
    });
  }

  if (files.length === 0) {
    return {
      comparable: false,
      mismatched: false,
      files,
      note: 'no bench file has two probes in both the baseline and this run, so the machines were not compared. A recapture on this machine records them',
    };
  }

  // The widest rather than the mean: the probes run in separate workers, one
  // per bench file, and a difference the machine shows in one worker is a
  // difference the machine has.
  const nonUniformity = Math.max(...files.map((file) => file.nonUniformity));
  const mismatched = nonUniformity > maxNonUniformity;

  return {
    comparable: true,
    mismatched,
    files,
    nonUniformity,
    ...(mismatched ? { note: mismatchNote(files, nonUniformity) } : {}),
  };
}

/**
 * The sentence a red gate wants: which dimension moved, by how much, and what
 * that means for the table above it.
 *
 * @param {FileComparison[]} files
 * @param {number} nonUniformity
 * @returns {string}
 */
function mismatchNote(files, nonUniformity) {
  const widest = files.reduce((left, right) => (right.nonUniformity > left.nonUniformity ? right : left));
  const sorted = [...widest.probes].sort((left, right) => left.slowdown - right.slowdown);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spelt = sorted.map((probe) => `${probe.name} ${times(probe.slowdown)}`).join(', ');
  const dimension = last?.name === 'chase' ? 'memory latency' : `the ${last?.name ?? 'slowest'} probe`;

  return [
    `the machine profile does not match the baseline's: measured on ${widest.file}, ${spelt}.`,
    `That is ${times(nonUniformity)} between ${first?.name ?? 'the fastest'} and ${last?.name ?? 'the slowest'}, so this box differs from the capture machine in ${dimension} and not only in speed.`,
    'A control workload normalises the dimension it was measured along and no other, so every regression printed above is unexplained by this run rather than confirmed by it.',
    'Recapture the baseline on this machine before reading the table as a statement about the code. See bench/README.md, "The machine it measures like"',
  ].join(' ');
}

/**
 * @param {number} value
 * @returns {string}
 */
function times(value) {
  return `${value.toFixed(2)}x`;
}
