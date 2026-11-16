import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const source = fileURLToPath(new URL('../', import.meta.url));
let root: string;
function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
function write(path: string, value: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
function manifest(version = '1.0.0', extra = {}): string {
  return JSON.stringify({ name: 'graph', version, scripts: { bench: 'unused' }, ...extra });
}
function run(): string {
  const result = spawnSync(process.execPath, ['bench/bin/bench-gate.mjs'], { cwd: root, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return result.stdout;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dagr-scope-'));
  cpSync(join(source, 'src'), join(root, 'bench/src'), { recursive: true });
  mkdirSync(join(root, 'bench/bin'), { recursive: true });
  cpSync(join(source, 'bin/bench-gate.mjs'), join(root, 'bench/bin/bench-gate.mjs'));
  // A sentinel proves selection without running any timing workload.
  write('bench/bin/bench-ci.mjs', 'console.log("MEASURE SENTINEL");');
  write('bench/baseline.json', JSON.stringify({ benchmarks: { 'graph > case': {} } }));
  write('package.json', manifest());
  write('packages/graph/package.json', manifest());
  write('packages/explorer/package.json', JSON.stringify({ name: 'explorer', version: '1.0.0', scripts: { bench: 'node -e "console.log(12345)"' } }));
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each(['committed', 'staged', 'unstaged'])('skips %s version-only manifests and docs', (state) => {
  for (const path of ['package.json', 'packages/graph/package.json']) write(path, manifest('1.1.0-rc.1+build.2'));
  write('packages/explorer/package.json', JSON.stringify({ name: 'explorer', version: '1.1.0', scripts: { bench: 'node -e "console.log(12345)"' } }));
  write('CHANGELOG.md', 'release');
  if (state !== 'unstaged') git('add', '.');
  if (state === 'committed') git('commit', '-qm', 'versions');
  expect(run()).toContain('Benchmark gate skipped:');
  expect(run()).not.toContain('SENTINEL');
});
it.each([
  ['packages/graph/src/index.ts', 'export const x = 1;'],
  ['packages/graph/vitest.config.ts', 'export default {};'],
  ['pnpm-lock.yaml', 'changed'],
  ['packages/graph/package.json', manifest('1.1.0', { dependencies: { foo: '2' } })],
  ['packages/graph/package.json', manifest('1.1.0', { scripts: { bench: 'changed' } })],
  ['packages/graph/package.json', manifest('1.1.0', { exports: './other.js' })],
  ['package.json', manifest('1.1.0', { engines: { node: '>=24' } })],
])('measures mixed version and %s changes', (path, value) => {
  write('packages/graph/package.json', manifest('1.1.0'));
  git('add', '.');
  git('commit', '-qm', 'version');
  write(path, value);
  expect(run()).toContain('MEASURE SENTINEL');
});
it.each(['deleted', 'renamed', 'untracked', 'malformed', 'missing-base'])('fails closed for %s manifests', (kind) => {
  if (kind === 'deleted') rmSync(join(root, 'packages/graph/package.json'));
  if (kind === 'renamed') git('mv', 'packages/graph', 'packages/moved');
  if (kind === 'untracked') write('packages/new/package.json', manifest('1.1.0'));
  if (kind === 'malformed') write('packages/graph/package.json', '{');
  if (kind === 'missing-base') git('update-ref', '-d', 'refs/remotes/origin/main');
  expect(run()).toContain('MEASURE SENTINEL');
});

it('retains ungated smoke for mixed version and source changes', () => {
  write('package.json', manifest('1.1.0'));
  write('packages/explorer/src/index.ts', 'export {};');
  const output = run();
  expect(output).toContain("ungated benchmarks run");
  expect(output).toContain('12345');
  expect(output).not.toContain('MEASURE SENTINEL');
});
it('does not hide an unstaged dependency edit behind a staged version bump', () => {
  write('packages/graph/package.json', manifest('1.1.0'));
  git('add', '.');
  write('packages/graph/package.json', manifest('1.1.0', { dependencies: { foo: '2' } }));
  expect(run()).toContain('MEASURE SENTINEL');
});

it.each(['exports', 'imports'])('measures reordered %s conditions with a version bump', (field) => {
  const path = 'packages/graph/package.json';
  const key = field === 'exports' ? '.' : '#entry';
  write(path, manifest('1.0.0', { [field]: { [key]: { node: './node.js', default: './default.js' } } }));
  git('add', '.');
  git('commit', '-qm', 'conditional entry');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(path, manifest('1.1.0', { [field]: { [key]: { default: './default.js', node: './node.js' } } }));
  expect(run()).toContain('MEASURE SENTINEL');
});

it.each(['packages/react/src/interaction.ts', 'packages/render/src/index.ts'])('smokes diagnostic React benchmarks for %s while retaining mixed gated reach', (path) => {
  write('packages/react/package.json', JSON.stringify({ name: 'react', version: '1.0.0', dependencies: { render: 'workspace:*', graph: 'workspace:*' }, scripts: { bench: 'node -e "console.log(67890)"' } }));
  write('packages/render/package.json', JSON.stringify({ name: 'render', version: '1.0.0' }));
  write('bench/baseline.json', JSON.stringify({ benchmarks: {
    'graph > case': {},
    'react > bench/interaction.bench.ts > CPU rectangle pointer query > 1k nodes': { gate: 'off', reason: 'diagnostic scan' },
    'react > bench/interaction.bench.ts > CPU rectangle pointer query > 10k nodes': { gate: 'off', reason: 'diagnostic scan' },
  } }));
  git('add', '.');
  git('commit', '-qm', 'diagnostic React baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(path, 'export {};');
  const output = run();
  expect(output).toContain('ungated benchmarks run');
  expect(output).toContain('67890');
  expect(output).not.toContain('MEASURE SENTINEL');
  write('packages/graph/src/index.ts', 'export {};');
  expect(run()).toContain('MEASURE SENTINEL');
});
