import { bench, describe } from 'vitest';

import { controlWorkload } from './control.js';
import { CONTROL_GROUP, CONTROL_NAME } from './names.mjs';

/**
 * Register the control workload in a bench file.
 *
 * Every bench file calls this exactly once, at the top level. The collector
 * refuses a file without it, because a file with no control produces raw
 * milliseconds, and raw milliseconds measured on whichever runner CI handed out
 * that morning cannot be compared to a baseline captured anywhere else.
 */
export function registerControl(): void {
  describe(CONTROL_GROUP, () => {
    bench(CONTROL_NAME, controlWorkload);
  });
}
