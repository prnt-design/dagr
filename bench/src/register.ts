import { bench, describe } from 'vitest';

import { controlWorkload } from './control.js';
import { CONTROL_GROUP, CONTROL_NAME, MACHINE_GROUP } from './names.mjs';
import { allocProbe, chaseProbe } from './probes.js';

/**
 * Register the control workload and the machine probes in a bench file.
 *
 * Every bench file calls this exactly once, at the top level. The collector
 * refuses a file without it, because a file with no control produces raw
 * milliseconds, and raw milliseconds measured on whichever machine happens to
 * run it cannot be compared to a baseline captured anywhere else.
 *
 * The name is still `registerControl` after it grew the probes, because the
 * control is what a bench file's numbers depend on and the probes are what
 * says whether that dependence is being honoured. Renaming it would be a
 * change to every bench file in the workspace for a word.
 */
export function registerControl(): void {
  describe(CONTROL_GROUP, () => {
    bench(CONTROL_NAME, controlWorkload);
  });

  // The probes ride along with the control rather than being registered by
  // hand, so that a bench file cannot acquire benchmarks without also
  // acquiring the measurements that say whether the machine under them is the
  // one the baseline was captured on. They are registered here and nowhere
  // else for the same reason the control is: they must run in the same worker
  // as the benchmarks they describe, and vitest gives each bench file its own.
  describe(MACHINE_GROUP, () => {
    bench('alloc', allocProbe);
    bench('chase', chaseProbe);
  });
}
