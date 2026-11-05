// @ts-check

/**
 * Which diffs the benchmark gate has to measure.
 *
 * The gate compares gated baseline entries, so a diff can change a verdict
 * only by touching what those entries run: the packages they name, the
 * workspace packages those depend on, the harness, or the toolchain. A diff
 * outside that is not measured, because on a shared machine a measurement the
 * diff cannot affect can still fail it. Between PRs #150 and #219, 15 of the
 * 23 that recorded a failing gate changed no package source at all.
 *
 * There is a middle case. `pnpm bench` runs every package with a `bench`
 * script, gated or not, and one that throws fails the gate for every branch
 * after it. A diff that reaches such a package without reaching a gated one is
 * a SMOKE: its benchmarks are run once to show they still run, and their
 * timings are read by nothing.
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
 * @property {boolean} benched Whether it has a `bench` script, so `pnpm bench` runs it.
 */

/**
 * @typedef {object} Scope
 * @property {string[]} measure The changed paths a gated entry runs. Any at all means the gate runs.
 * @property {string[]} smoke The ungated, benched package directories the diff reaches, sorted.
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
  '.tool-versions',
  '.pnpmfile.cjs',
]);

/**
 * The directories of `names` and of everything they depend on in the workspace.
 *
 * @param {readonly string[]} names
 * @param {readonly Manifest[]} manifests
 * @returns {Set<string>}
 */
function closure(names, manifests) {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const queue = [...names];
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
  const names = Object.entries(benchmarks)
    .filter(([, entry]) => entry.gate !== 'off')
    .map(([key]) => key.split(' > ')[0] ?? key);
  return closure(names, manifests);
}

/**
 * Each benched package no gated entry runs, with the directories its
 * benchmarks reach that the gate does not already cover.
 *
 * @param {readonly Manifest[]} manifests
 * @param {ReadonlySet<string>} gated From {@link gatedDirs}.
 * @returns {Map<string, Set<string>>} Keyed by the package's directory.
 */
export function smokeReach(manifests, gated) {
  const reach = new Map();
  for (const manifest of manifests) {
    if (!manifest.benched || gated.has(manifest.dir)) continue;
    const dirs = closure([manifest.name], manifests);
    reach.set(manifest.dir, new Set([...dirs].filter((dir) => !gated.has(dir))));
  }
  return reach;
}

/**
 * @param {readonly string[]} paths Every path the branch changes, repo-relative.
 * @param {ReadonlySet<string>} gated From {@link gatedDirs}.
 * @param {ReadonlyMap<string, ReadonlySet<string>>} smoke From {@link smokeReach}.
 * @returns {Scope}
 */
export function scopeOf(paths, gated, smoke) {
  const measure = [];
  const smoked = new Set();
  for (const path of paths) {
    if (path.endsWith('.md')) continue;
    if (ROOT_FILES.has(path) || path.startsWith('patches/')) {
      measure.push(path);
      continue;
    }
    if (path.startsWith('bench/')) {
      // The browser harnesses are run by hand and write no report the gate reads.
      if (!path.startsWith('bench/browser/')) measure.push(path);
      continue;
    }
    const [workspace, pkg, area] = path.split('/');
    if (workspace === undefined || pkg === undefined || !WORKSPACE_DIRS.includes(workspace)) continue;
    if (area === 'test') continue;
    const dir = `${workspace}/${pkg}`;
    if (gated.has(dir)) {
      measure.push(path);
      continue;
    }
    for (const [target, reach] of smoke) {
      if (reach.has(dir)) smoked.add(target);
    }
  }
  return { measure, smoke: [...smoked].sort() };
}
