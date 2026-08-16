// @ts-check

/**
 * The names the bench files and the collector agree on.
 *
 * Their own module because they are the one thing both halves of this package
 * need. The bench-file half is TypeScript, compiled by vitest; the collector
 * and gate half is plain `.mjs`, run by bare `node` before anything is
 * built. Plain JS is the only form both halves can import without a build step.
 */

/** The group name a bench file must register its control under. */
export const CONTROL_GROUP = 'control';

/** The benchmark name inside that group. */
export const CONTROL_NAME = 'mixed';

/** What each package's `bench` script writes its run to. */
export const REPORT_NAME = 'bench-report.json';

/** Where a package that writes one can live. */
export const WORKSPACE_DIRS = ['packages', 'apps'];
