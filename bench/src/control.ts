/**
 * The control workload, and the reason the 10% gate can survive a busy machine.
 *
 * Every bench file runs this alongside its real benchmarks, in the same worker,
 * and every recorded number is a ratio against it. A machine twice as slow runs
 * the control twice as slow too, so the ratio is what stays comparable across
 * the desk a baseline was captured on and whatever machine is running the gate
 * that morning. `gate.mjs` explains what is done with the ratio.
 *
 * WHAT THIS IS NOT. One control cannot normalise every kind of work. Pure
 * arithmetic scales with clock speed, allocation-heavy code scales with
 * allocator and GC behaviour, and pointer chasing scales with cache size; those
 * three do not move together between machines. This workload deliberately mixes
 * arithmetic, a typed-array write, and short-lived string and Map allocation,
 * so that it is wrong in a middling way for everything rather than badly wrong
 * for one class. If a benchmark turns out to track it poorly, and the evidence
 * for that is a ratio that drifts between machines while the code under it is
 * untouched, the fix is a second control matching that class of work, not a
 * wider tolerance. A wider tolerance hides the drift and the regression alike.
 *
 * IT MUST NEVER CHANGE without recapturing every baseline. The recorded ratios
 * are all relative to this function, so editing it silently rebases the whole
 * committed baseline and every comparison against it stops meaning anything. If
 * it has to change, treat it as a baseline migration: change it and run
 * `pnpm bench:baseline` in the same commit, and say so in the message.
 */

/**
 * A sink for the workload's result. Without somewhere observable to put the
 * answer, an optimiser is free to notice that nothing reads it and delete the
 * loop, which would turn the control into a measurement of nothing and quietly
 * rescale every ratio in the baseline.
 */
export let controlSink = 0;

const SCALAR_ITERATIONS = 4096;
const ALLOC_ITERATIONS = 512;

const scratch = new Float64Array(SCALAR_ITERATIONS);

/**
 * Fixed work, identical on every call, with no dependence on the clock, the
 * platform, or any random source. Two runs of the harness on one machine must
 * do exactly the same amount of work here.
 */
export function controlWorkload(): void {
  // Arithmetic and a typed-array write: scales with clock speed.
  let state = 0x9e3779b9;
  let sum = 0;
  for (let index = 0; index < SCALAR_ITERATIONS; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    scratch[index] = value;
    sum += value;
  }

  // Short-lived strings and a Map: scales with allocator and GC behaviour,
  // which is the half of the work a pure arithmetic control would miss and
  // which most of this repo's hot paths actually do.
  const table = new Map<string, { index: number; value: number }>();
  for (let index = 0; index < ALLOC_ITERATIONS; index += 1) {
    table.set(`k${String(index)}`, { index, value: scratch[index] ?? 0 });
  }
  for (let index = 0; index < ALLOC_ITERATIONS; index += 1) {
    const entry = table.get(`k${String(index)}`);
    if (entry !== undefined) sum += entry.index * 1e-9;
  }

  controlSink = sum;
}
