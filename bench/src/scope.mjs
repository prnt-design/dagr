// @ts-check

/**
 * Which diffs the benchmark gate has to measure.
 *
 * The gate compares gated baseline entries, so a diff can change its verdict
 * only by touching what those entries run: the packages they name, the
 * workspace packages those depend on, the harness, or the toolchain. A diff
 * outside that is skipped, because on a shared machine a measurement the diff
 * cannot affect can still fail it. Between PRs #150 and #219, 15 of the 23
 * that recorded a failing gate changed no package source at all.
 *
 * Derived from the baseline and the manifests rather than listed, so a package
 * whose benchmarks join the baseline comes into scope without an edit here.
 * Pure functions, like `gate.mjs` and `repeat.mjs`: the CLI does the reading.
 */

import { WORKSPACE_DIRS } from './names.mjs';

/**
 * @typedef {object} Manifest
 * @property {string} dir Repo-relative directory, with `/` separators.
 * @property {string} name
 * @property {string[]} workspaceDeps Names of the workspace packages it depends on.
 */

/**
 * @typedef {object} Scope
 * @property {boolean} measure Whether the gate has to run.
 * @property {string[]} because The changed paths that put it in scope.
 */

/** Root files that change what every package is built or run with. */
const ROOT_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  '.npmrc',
  '.nvmrc',
  '.node-version',
]);

/**
 * The directories whose source a gated entry runs: each package a gated
 * baseline key names, and its workspace dependencies, transitively.
 *
 * An exempt entry (`gate: "off"`) does not count, because it cannot fail.
 *
 * @param {Record<string, { gate?: string }>} benchmarks `baseline.benchmarks`.
 * @param {readonly Manifest[]} manifests
 * @returns {Set<string>}
 */
export function gatedDirs(benchmarks, manifests) {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const queue = Object.entries(benchmarks)
    .filter(([, entry]) => entry.gate !== 'off')
    .map(([key]) => key.split(' > ')[0] ?? key);
  const dirs = new Set();
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const manifest = byName.get(name);
    if (manifest === undefined || dirs.has(manifest.dir)) continue;
    dirs.add(manifest.dir);
    queue.push(...manifest.workspaceDeps);
  }
  return dirs;
}

/**
 * Whether one changed path can move a gated number.
 *
 * @param {string} path Repo-relative, with `/` separators.
 * @param {ReadonlySet<string>} dirs From {@link gatedDirs}.
 */
export function inScope(path, dirs) {
  if (path.endsWith('.md')) return false;
  if (ROOT_FILES.has(path)) return true;
  // The browser harnesses are run by hand and write no report the gate reads.
  if (path.startsWith('bench/')) return !path.startsWith('bench/browser/');
  const [workspace, pkg, area] = path.split('/');
  if (workspace === undefined || pkg === undefined || !WORKSPACE_DIRS.includes(workspace)) {
    return false;
  }
  // Any package's bench files, gated or not: `pnpm bench` runs them all, and
  // one that throws fails the gate for every branch after it.
  if (area === 'bench') return true;
  return dirs.has(`${workspace}/${pkg}`) && area !== 'test';
}

/**
 * @param {readonly string[]} paths Every path the branch changes.
 * @param {ReadonlySet<string>} dirs From {@link gatedDirs}.
 * @returns {Scope}
 */
export function scopeOf(paths, dirs) {
  const because = paths.filter((path) => inScope(path, dirs));
  return { measure: because.length > 0, because };
}
