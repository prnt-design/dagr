#!/usr/bin/env node
/**
 * The three checks `pnpm test` deliberately cannot run, because each of them
 * needs the network.
 *
 * 1. `publint` over every tarball.
 * 2. `arethetypeswrong` over every tarball, under the `esm-only` profile.
 * 3. A scratch project OUTSIDE the workspace that installs the tarballs and
 *    typechecks an `import { layout } from '@dagr/layout'`.
 *
 * The vitest suite beside this is the gate: it runs on every `pnpm test`, needs
 * no registry, and checks the things that go wrong silently. This script is the
 * independent cross-check on that gate, and it is run by hand whenever the
 * packaging changes and before a publish. Run it with:
 *
 *     pnpm --filter @dagr/packaging verify:tools
 *
 * WHY THE PROFILE IS `esm-only` AND NOT THE DEFAULT `strict`. Every one of these
 * packages is `"type": "module"` with no CommonJS build, on purpose. Under
 * `strict`, attw reports `CJSResolvesToESM` on all five, which is not a defect:
 * it is the accurate description of an ESM-only package, and the profile exists
 * to say so. If a CommonJS build is ever added, this profile is the line that
 * has to change.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGES = ['graph', 'layout', 'render', 'react', 'vdsl'];

const workDir = mkdtempSync(join(tmpdir(), 'dagr-verify-'));
let failures = 0;

function run(command, args, cwd, label) {
  try {
    execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    console.log(`  PASS  ${label}`);
    return true;
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    console.log(String(error.stdout ?? '') + String(error.stderr ?? ''));
    return false;
  }
}

try {
  console.log('Building and packing the published packages...');
  execFileSync('pnpm', [...PACKAGES.flatMap((p) => ['--filter', `@dagr/${p}`]), 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  for (const name of PACKAGES) {
    execFileSync('pnpm', ['pack', '--pack-destination', workDir], {
      cwd: join(REPO_ROOT, 'packages', name),
      stdio: 'pipe',
    });
  }
  const tarballs = readdirSync(workDir)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => join(workDir, f))
    .sort();

  console.log('\npublint:');
  for (const tarball of tarballs) run('pnpm', ['exec', 'publint', tarball], REPO_ROOT, tarball);

  console.log('\narethetypeswrong (profile esm-only):');
  for (const tarball of tarballs) {
    run('pnpm', ['exec', 'attw', '--profile', 'esm-only', tarball], REPO_ROOT, tarball);
  }

  console.log('\nA scratch project outside the workspace:');
  const scratch = join(workDir, 'scratch');
  // `node_modules` and no lockfile, installed with npm rather than pnpm, so the
  // install resolves the tarballs the way a consumer's would rather than
  // through anything this workspace set up.
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'dagr-scratch', private: true, type: 'module', version: '0.0.0' }, null, 2),
  );
  writeFileSync(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'bundler', noEmit: true, target: 'ES2022', skipLibCheck: true } },
      null,
      2,
    ),
  );
  writeFileSync(
    join(scratch, 'index.ts'),
    [
      "import { Graph } from '@dagr/graph';",
      "import { layout } from '@dagr/layout';",
      "import { defineRegistry } from '@dagr/vdsl';",
      '',
      'const graph = new Graph();',
      "graph.addNode('a');",
      "graph.addNode('b');",
      "graph.addEdge('a', 'b');",
      '',
      'const result = layout({ graph });',
      "export const where = result.nodes.get('a');",
      "export const registry = defineRegistry({ box: { ports: [{ id: 'out', direction: 'out' }] } });",
      '',
    ].join('\n'),
  );

  const pick = (name) => {
    const found = tarballs.find((t) => t.includes(`dagr-${name}-`));
    if (found === undefined) throw new Error(`no tarball was packed for @dagr/${name}`);
    return found;
  };
  const graphTarball = pick('graph');
  const layoutTarball = pick('layout');
  const vdslTarball = pick('vdsl');
  run('npm', ['install', '--no-audit', '--no-fund', graphTarball, layoutTarball, vdslTarball, 'typescript'], scratch, 'npm install of the tarballs');
  run('npx', ['tsc', '--noEmit'], scratch, "tsc over import { layout } from '@dagr/layout'");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nEverything passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
