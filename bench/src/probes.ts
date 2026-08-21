/**
 * The machine probes: two workloads that measure the box rather than the code,
 * so the harness can tell "this branch got slower" from "this is not the
 * machine the baseline was captured on".
 *
 * `control.ts` explains why every recorded number is a ratio against a control
 * workload, and states the limit that makes this file necessary: one control
 * normalises the dimension it was measured along and no other. A machine that
 * is uniformly slower runs the control uniformly slower too and the ratio does
 * not move, which is the case the gate was designed for. A machine whose
 * arithmetic is 5% slower and whose memory latency has doubled moves every
 * benchmark by a different amount, the control cancels one number of the
 * several that moved, and what comes out is a table of regressions in packages
 * nobody touched. That is not a hypothetical: it cost this project four
 * consecutive runs, see `bench/README.md` under "The machine it measures like".
 *
 * So the probes are deliberately SINGLE-DIMENSIONAL, which is the opposite of
 * the control's design. The control mixes arithmetic, a typed-array write and
 * short-lived allocation so as to be wrong in a middling way for everything;
 * each probe here does one kind of work and nothing else, so that comparing
 * them tells you WHICH dimension moved. They are never gated and never
 * normalised: they are recorded as raw milliseconds, and only ever compared
 * against the raw milliseconds a baseline capture recorded for the same probe.
 *
 * THERE WAS A THIRD, AND MEASURING IT IS WHY THERE ISN'T. A pure-arithmetic
 * probe, registers only, is the obvious floor to measure the other two against
 * and it is useless on a shared virtual machine. Four gate-sized runs on the
 * dispatch box on 2026-08-21, three of which started at 1-minute loads of 1.47,
 * 3.03 and 1.46, put its widest per-file band at 65.9%, against 14.8% for
 * `alloc` and 14.4% for `chase` over the same four. A workload doing nothing
 * but issuing instructions is the one a hypervisor's stolen cycles hit hardest,
 * while one waiting on memory was going to wait anyway.
 *
 * It was removed rather than resized, because the swing is the machine's and
 * not the measurement's, and it does not merely add noise: WITH IT, THE NOISE
 * ALONE EXCEEDS ANY THRESHOLD THAT WOULD STILL SIT UNDER THE SIGNAL. Six pairs
 * of runs scored up to 1.583 against each other with the third probe in, and
 * fifteen pairs over six runs top out at 1.215 without it, against a signal
 * estimated at 1.84. See `profile.mjs` for where those three numbers go.
 *
 * Unlike the control, these MAY be changed without recapturing every baseline,
 * because no benchmark's ratio is expressed in terms of them. Changing one does
 * invalidate the profile comparison against any baseline captured before the
 * change, which the comparison detects for itself: a probe the baseline does
 * not carry is skipped, and a file left with fewer than two probes is reported
 * as not comparable rather than as a match.
 */

/**
 * A sink for every probe's result, for the reason `controlSink` exists: an
 * optimiser that can prove nothing reads the answer is free to delete the loop,
 * and a probe that measures nothing would read as a machine whose memory got
 * infinitely fast.
 */
export let probeSink = 0;

const ALLOC_ROUNDS = 60_000;

/**
 * Short-lived objects and nothing else. Scales with the allocator and the young
 * generation's collector, which is what most of this repo's hot paths actually
 * spend their time on and what the control is already weighted towards.
 */
export function allocProbe(): void {
  let sum = 0;
  for (let index = 0; index < ALLOC_ROUNDS; index += 1) {
    const cell = { index, value: index * 0.5 };
    const wrapper = { cell, tag: index & 7 };
    sum += wrapper.cell.value + wrapper.tag;
  }
  probeSink = sum;
}

/**
 * How many `Int32Array` words the chase walks: 16,777,216, which is 64 MiB.
 *
 * Sized against the largest cache it has to defeat rather than against a round
 * number. The dispatch box the baseline was captured on has 16 MiB of L3, and a
 * table that merely matched it would hit on about half its loads: that reads as
 * a memory probe on a machine with a small cache and as a cache probe on one
 * with a large cache, which would make the probe report a profile difference
 * that is really a difference in how well the probe fits. Four times L3 leaves
 * the hit rate low enough that what is being timed is the miss.
 */
export const CHASE_WORDS = 1 << 24;

const CHASE_STEPS = 10_000;
const CHASE_MASK = CHASE_WORDS - 1;

/**
 * The successor of an index in the chase.
 *
 * A linear congruential step, `(a * index + c) mod 2^k`, which visits every
 * index of a power-of-two table exactly once: Hull and Dobell's conditions hold
 * for a modulus of 2^k when `a - 1` is a multiple of 4 and `c` is odd, and both
 * constants are chosen so. That matters twice over. A walk that closed early
 * would circle a subset small enough to sit in cache, so the probe would time a
 * cache hit while claiming to time a miss. And a walk with a CONSTANT stride
 * would be exactly what a hardware prefetcher is built to recognise, so the
 * loads would be issued ahead of time and the latency would never be paid.
 *
 * Exported so that the full-period property can be checked at a size a test can
 * walk, rather than being asserted about sixteen million entries.
 *
 * @param index Where the walk currently is.
 * @param mask One less than the table size, which must be a power of two.
 */
export function nextChaseIndex(index: number, mask: number): number {
  return (Math.imul(1664525, index) + 1013904223) & mask;
}

/**
 * Built once per worker rather than per call: filling 64 MiB costs about 60ms,
 * and paying that inside the timed function would measure a sequential write,
 * which is the opposite of what the probe is for.
 */
const chaseTable = ((): Int32Array => {
  const table = new Int32Array(CHASE_WORDS);
  for (let index = 0; index < CHASE_WORDS; index += 1) {
    table[index] = nextChaseIndex(index, CHASE_MASK);
  }
  return table;
})();

/**
 * A dependent pointer chase over 64 MiB. Scales with memory latency, and with
 * nothing else: each load's address is the previous load's result, so the
 * processor cannot run two of them at once and the loop's cost is the number of
 * steps times the latency of a miss.
 *
 * This is the dimension the control cannot see, and it is the one that moved
 * when this project's box changed underneath it.
 */
export function chaseProbe(): void {
  let at = 0;
  for (let step = 0; step < CHASE_STEPS; step += 1) {
    // The `?? 0` is the index signature's and cannot be taken: every value in
    // the table is `nextChaseIndex(_, CHASE_MASK)`, which is masked into range
    // by construction, so `at` is always a valid index. It is worth naming
    // because if it ever COULD be taken the walk would restart at 0 and the
    // probe would silently become a walk over a handful of cache lines, which
    // is the one failure that would leave a profile comparison looking healthy
    // while measuring nothing about memory.
    at = chaseTable[at] ?? 0;
  }
  probeSink = at;
}
