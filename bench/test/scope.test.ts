import { describe, expect, it } from 'vitest';

import { gatedDirs, scopeOf, smokeReach } from '../src/scope.mjs';
import type { Manifest } from '../src/scope.mjs';

function manifest(dir: string, name: string, workspaceDeps: string[] = [], benched = false): Manifest {
  return { dir, name, workspaceDeps, benched };
}

const MANIFESTS: Manifest[] = [
  manifest('packages/graph', '@x/graph', ['@x/bench'], true),
  manifest('packages/layout', '@x/layout', ['@x/graph'], true),
  manifest('packages/render', '@x/render', [], true),
  manifest('packages/react', '@x/react', ['@x/layout', '@x/render'], true),
  manifest('packages/shapes', '@x/shapes'),
  manifest('packages/explorer', '@x/explorer', ['@x/graph', '@x/shapes'], true),
  manifest('apps/demo', 'demo', ['@x/react']),
];

const key = (name: string): string => `${name} > bench/a.bench.ts > group > case`;

describe('which packages the baseline gates', () => {
  it('takes the package a gated entry names', () => {
    expect(gatedDirs({ [key('@x/graph')]: {} }, MANIFESTS)).toEqual(new Set(['packages/graph']));
  });

  it('follows workspace dependencies transitively', () => {
    expect(gatedDirs({ [key('@x/react')]: {} }, MANIFESTS)).toEqual(
      new Set(['packages/react', 'packages/layout', 'packages/render', 'packages/graph']),
    );
  });

  it('leaves out a package only an exempt entry names', () => {
    expect(gatedDirs({ [key('@x/explorer')]: { gate: 'off' } }, MANIFESTS)).toEqual(new Set());
  });

  it('leaves out a dependent of a gated package', () => {
    expect(gatedDirs({ [key('@x/graph')]: {} }, MANIFESTS).has('apps/demo')).toBe(false);
  });

  it('ignores a key naming a package with no manifest, or with no separator', () => {
    expect(gatedDirs({ [key('@x/gone')]: {}, plain: {} }, MANIFESTS)).toEqual(new Set());
  });

  it('terminates on a dependency cycle', () => {
    const cycle = [manifest('packages/a', 'a', ['b']), manifest('packages/b', 'b', ['a'])];
    expect(gatedDirs({ [key('a')]: {} }, cycle)).toEqual(new Set(['packages/a', 'packages/b']));
  });
});

describe('which ungated benchmarks a diff can break', () => {
  const gated = gatedDirs({ [key('@x/react')]: {} }, MANIFESTS);

  it('reaches a benched, ungated package and its ungated dependencies', () => {
    expect(smokeReach(MANIFESTS, gated)).toEqual(
      new Map([['packages/explorer', new Set(['packages/explorer', 'packages/shapes'])]]),
    );
  });

  it('is empty once every benched package is gated', () => {
    const all = gatedDirs({ [key('@x/react')]: {}, [key('@x/explorer')]: {} }, MANIFESTS);
    expect(smokeReach(MANIFESTS, all)).toEqual(new Map());
  });
});

describe('reading a diff', () => {
  const gated = gatedDirs({ [key('@x/layout')]: {} }, MANIFESTS);
  const smoke = smokeReach(MANIFESTS, gated);
  const read = (...paths: string[]) => scopeOf(paths, gated, smoke);

  it.each([
    'packages/graph/src/graph.ts',
    'packages/graph/package.json',
    'packages/graph/vitest.config.ts',
    'packages/layout/bench/layout.bench.ts',
    'bench/baseline.json',
    'bench/src/gate.mjs',
    'bench/test/gate.test.ts',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    '.npmrc',
    '.nvmrc',
    'patches/vitest@4.1.10.patch',
  ])('measures for %s', (path) => {
    expect(read(path)).toEqual({ measure: [path], smoke: [] });
  });

  it.each([
    'packages/graph/test/graph.test.ts',
    'packages/graph/README.md',
    'packages/graph/CHANGELOG.md',
    'apps/demo/src/App.tsx',
    'apps/demo/bench/unrun.bench.ts',
    'bench/README.md',
    'bench/browser/frame-profile.mjs',
    'ROADMAP.md',
    'docs/docs/render.md',
    '.github/workflows/ci.yml',
    'eslint.config.js',
  ])('does nothing for %s', (path) => {
    expect(read(path)).toEqual({ measure: [], smoke: [] });
  });

  it.each([
    'packages/explorer/src/outline.tsx',
    'packages/explorer/bench/explorer.bench.ts',
    'packages/explorer/package.json',
    'packages/shapes/src/index.ts',
  ])('smokes the explorer for %s', (path) => {
    expect(read(path)).toEqual({ measure: [], smoke: ['packages/explorer'] });
  });

  it('does not smoke for a test or a document in an ungated package', () => {
    expect(read('packages/explorer/test/a.test.tsx', 'packages/explorer/README.md')).toEqual({
      measure: [],
      smoke: [],
    });
  });

  it('reads an empty diff as nothing to do', () => {
    expect(read()).toEqual({ measure: [], smoke: [] });
  });

  it('names every path in scope, and each smoked package once', () => {
    expect(
      read(
        'ROADMAP.md',
        'packages/graph/src/graph.ts',
        'packages/explorer/src/a.ts',
        'packages/explorer/src/b.ts',
        'bench/baseline.json',
      ),
    ).toEqual({
      measure: ['packages/graph/src/graph.ts', 'bench/baseline.json'],
      smoke: ['packages/explorer'],
    });
  });
});
