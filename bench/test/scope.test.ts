import { describe, expect, it } from 'vitest';

import { gatedDirs, inScope, scopeOf } from '../src/scope.mjs';
import type { Manifest } from '../src/scope.mjs';

const MANIFESTS: Manifest[] = [
  { dir: 'packages/graph', name: '@x/graph', workspaceDeps: ['@x/bench'] },
  { dir: 'packages/layout', name: '@x/layout', workspaceDeps: ['@x/graph'] },
  { dir: 'packages/render', name: '@x/render', workspaceDeps: [] },
  { dir: 'packages/react', name: '@x/react', workspaceDeps: ['@x/layout', '@x/render'] },
  { dir: 'packages/explorer', name: '@x/explorer', workspaceDeps: ['@x/graph'] },
  { dir: 'apps/demo', name: 'demo', workspaceDeps: ['@x/react'] },
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

  it('ignores a key naming a package with no manifest', () => {
    expect(gatedDirs({ [key('@x/gone')]: {} }, MANIFESTS)).toEqual(new Set());
  });
});

describe('whether a path can move a gated number', () => {
  const dirs = new Set(['packages/graph', 'packages/layout']);

  it.each([
    ['packages/graph/src/graph.ts', true],
    ['packages/graph/package.json', true],
    ['packages/graph/vitest.config.ts', true],
    ['packages/graph/test/graph.test.ts', false],
    ['packages/graph/README.md', false],
    ['packages/graph/CHANGELOG.md', false],
    ['packages/explorer/src/outline.tsx', false],
    ['packages/explorer/bench/explorer.bench.ts', true],
    ['apps/demo/src/App.tsx', false],
    ['bench/baseline.json', true],
    ['bench/src/gate.mjs', true],
    ['bench/README.md', false],
    ['bench/browser/frame-profile.mjs', false],
    ['pnpm-lock.yaml', true],
    ['package.json', true],
    ['tsconfig.base.json', true],
    ['ROADMAP.md', false],
    ['docs/docs/render.md', false],
    ['.github/workflows/ci.yml', false],
    ['eslint.config.js', false],
  ])('%s: %s', (path, expected) => {
    expect(inScope(path, dirs)).toBe(expected);
  });
});

describe('reading a whole diff', () => {
  const dirs = new Set(['packages/graph']);

  it('skips a diff with nothing in scope', () => {
    expect(scopeOf(['ROADMAP.md', 'apps/demo/src/App.tsx'], dirs)).toEqual({ measure: false, because: [] });
  });

  it('skips an empty diff', () => {
    expect(scopeOf([], dirs)).toEqual({ measure: false, because: [] });
  });

  it('measures when one path is in scope, and names it', () => {
    expect(scopeOf(['ROADMAP.md', 'packages/graph/src/graph.ts'], dirs)).toEqual({
      measure: true,
      because: ['packages/graph/src/graph.ts'],
    });
  });
});
