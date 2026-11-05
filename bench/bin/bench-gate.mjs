// @ts-check

/**
 * `pnpm bench:gate`: `bench:ci`, when the branch's diff can move a gated
 * benchmark, and a printed reason when it cannot. See `src/scope.mjs`.
 *
 * It fails closed. A diff it cannot read, or a baseline it cannot parse, runs
 * the gate, so the only way to skip a measurement is for git to say plainly
 * that nothing in scope changed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACE_DIRS } from '../src/names.mjs';
import { gatedDirs, scopeOf, smokeReach } from '../src/scope.mjs';

const BASE = 'origin/main';
const SHOWN = 5;

const root = fileURLToPath(new URL('../../', import.meta.url));
const ci = fileURLToPath(new URL('./bench-ci.mjs', import.meta.url));

/**
 * @param {string[]} args
 * @param {string} [separator]
 * @returns {string[] | null} The output's records, or null when git failed.
 */
function git(args, separator = '\n') {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split(separator).filter((record) => record !== '');
}

/**
 * Every path the branch changes against its merge base with {@link BASE}:
 * committed, staged, unstaged and untracked. `--no-renames` lists both ends of
 * a move, so a file moved out of scope still counts, and `-z` keeps git from
 * quoting a path into something no rule would recognise.
 *
 * @returns {string[] | null}
 */
function changedPaths() {
  const mergeBase = git(['merge-base', 'HEAD', BASE])?.[0];
  if (mergeBase === undefined) return null;
  const tracked = git(['diff', '--name-only', '--no-renames', '-z', mergeBase], '\0');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], '\0');
  if (tracked === null || untracked === null) return null;
  return [...new Set([...tracked, ...untracked])];
}

/** @returns {import('../src/scope.mjs').Manifest[]} */
function manifests() {
  const found = [];
  for (const workspace of WORKSPACE_DIRS) {
    const workspacePath = join(root, workspace);
    if (!existsSync(workspacePath)) continue;
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      const manifestPath = join(workspacePath, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const deps = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      };
      found.push({
        dir: `${workspace}/${entry.name}`,
        name: String(manifest.name),
        workspaceDeps: Object.keys(deps).filter((name) => String(deps[name]).startsWith('workspace:')),
        benched: typeof manifest.scripts?.bench === 'string',
      });
    }
  }
  return found;
}

/**
 * @param {string} reason
 * @returns {never}
 */
function measure(reason) {
  console.log(`Benchmark gate required: ${reason}.\n`);
  const result = spawnSync(process.execPath, [ci], { cwd: root, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

/** @returns {{ gated: Set<string>, smoke: Map<string, Set<string>> }} */
function reach() {
  try {
    const baseline = JSON.parse(readFileSync(join(root, 'bench/baseline.json'), 'utf8'));
    const all = manifests();
    const gated = gatedDirs(baseline.benchmarks, all);
    return { gated, smoke: smokeReach(all, gated) };
  } catch (cause) {
    return measure(
      `could not work out what the baseline gates (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}

const paths = changedPaths() ?? measure(`could not read this branch's diff against ${BASE}`);
const { gated, smoke } = reach();
const scope = scopeOf(paths, gated, smoke);

if (scope.measure.length > 0) {
  const more = scope.measure.length - SHOWN;
  measure(
    `this branch changes ${scope.measure.slice(0, SHOWN).join(', ')}${more > 0 ? ` and ${String(more)} more in scope` : ''}`,
  );
}

console.log(
  `Benchmark gate skipped: none of the ${String(paths.length)} paths this branch changes against ${BASE} is run by a gated benchmark.`,
);
console.log(
  `Gated: ${[...gated].sort().join(', ')}, bench/ outside bench/browser, and the root toolchain files.`,
);

for (const dir of scope.smoke) {
  console.log(`\nThe branch changes what ${dir}'s ungated benchmarks run, so running them once to show they still do.\n`);
  const result = spawnSync('pnpm', ['--filter', `./${dir}`, 'bench'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n${dir}'s benchmarks no longer run, which would fail the gate for every branch after this one.`);
    process.exit(result.status ?? 1);
  }
}
