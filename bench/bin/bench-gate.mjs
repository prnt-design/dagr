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
import { gatedDirs, scopeOf } from '../src/scope.mjs';

const BASE = 'origin/main';
const SHOWN = 5;

const root = fileURLToPath(new URL('../../', import.meta.url));
const ci = fileURLToPath(new URL('./bench-ci.mjs', import.meta.url));

/**
 * @param {string[]} args
 * @returns {string[] | null} The output's lines, or null when git failed.
 */
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').filter((line) => line !== '');
}

/**
 * Every path the branch changes against its merge base with {@link BASE}:
 * committed, staged, unstaged and untracked. `--no-renames` lists both ends of
 * a move, so a file moved out of scope still counts.
 *
 * @returns {string[] | null}
 */
function changedPaths() {
  const mergeBase = git(['merge-base', 'HEAD', BASE])?.[0];
  if (mergeBase === undefined) return null;
  const tracked = git(['diff', '--name-only', '--no-renames', mergeBase]);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
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
      const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
      found.push({
        dir: `${workspace}/${entry.name}`,
        name: String(manifest.name),
        workspaceDeps: Object.keys(deps).filter((name) => String(deps[name]).startsWith('workspace:')),
      });
    }
  }
  return found;
}

/** @param {string} reason */
function measure(reason) {
  console.log(`Benchmark gate required: ${reason}.\n`);
  const result = spawnSync(process.execPath, [ci], { cwd: root, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const paths = changedPaths();
if (paths === null) measure(`could not read this branch's diff against ${BASE}`);

let dirs;
try {
  const baseline = JSON.parse(readFileSync(join(root, 'bench/baseline.json'), 'utf8'));
  dirs = gatedDirs(baseline.benchmarks, manifests());
} catch (cause) {
  measure(`could not work out what the baseline gates (${cause instanceof Error ? cause.message : String(cause)})`);
}

const scope = scopeOf(paths ?? [], dirs ?? new Set());
if (scope.measure) {
  const shown = scope.because.slice(0, SHOWN).join(', ');
  const more = scope.because.length - SHOWN;
  measure(`this branch changes ${shown}${more > 0 ? ` and ${String(more)} more in scope` : ''}`);
}

console.log(
  `Benchmark gate skipped: none of the ${String(paths?.length ?? 0)} paths this branch changes against ${BASE} can move a gated benchmark.`,
);
console.log(`In scope: ${[...(dirs ?? [])].sort().join(', ')}, any package's bench files, bench/ outside bench/browser, and the root toolchain files.`);
