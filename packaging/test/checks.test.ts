/**
 * The checks shown failing, on packages constructed to be wrong.
 *
 * `pack.test.ts` runs the same predicates over the five real tarballs, where
 * they pass and are expected to keep passing. A guard whose only evidence is
 * a green run against a tree already known to be correct has never
 * demonstrated that it can go red, so each check gets a case here that makes
 * it fail and a case that makes it pass.
 */

import { describe, expect, it } from 'vitest';

import type { Manifest, PackedPackage } from '../src/checks.js';
import {
  danglingSourceMaps,
  missingConsumerFiles,
  publishesPublic,
  unresolvedEntryPoints,
  workspaceRanges,
} from '../src/checks.js';

function pkg(files: Record<string, string>, manifest: Manifest = {}): PackedPackage {
  return {
    name: manifest.name ?? '@dagr/example',
    manifest,
    files: Object.keys(files),
    text: (file) => files[file],
  };
}

function map(sources: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 3, sources, mappings: '', ...extra });
}

describe('workspace ranges a consumer cannot resolve', () => {
  it('reports the range npm pack leaves behind', () => {
    // The exact shape of packages/layout before this task: @dagr/graph is a
    // peer, and `npm pack` publishes the protocol string verbatim.
    const found = workspaceRanges({ peerDependencies: { '@dagr/graph': 'workspace:^' } });
    expect(found).toEqual(['peerDependencies.@dagr/graph is "workspace:^"']);
  });

  it('accepts the range pnpm pack rewrites it to', () => {
    expect(workspaceRanges({ peerDependencies: { '@dagr/graph': '^0.1.0' } })).toEqual([]);
  });

  it('reads dependencies and optionalDependencies too', () => {
    const found = workspaceRanges({
      dependencies: { '@dagr/layout': 'workspace:^' },
      optionalDependencies: { '@dagr/render': 'workspace:*' },
    });
    expect(found).toEqual([
      'dependencies.@dagr/layout is "workspace:^"',
      'optionalDependencies.@dagr/render is "workspace:*"',
    ]);
  });

  it('ignores devDependencies, which no consumer install reads', () => {
    // @dagr/bench is private and will never be on npm, and its range survives
    // into the published manifest of @dagr/graph and @dagr/layout. It reaches
    // nobody: npm installs no devDependencies for a package it is installing
    // as a dependency. Asserted rather than left implicit, because the natural
    // reading of "no workspace ranges in the manifest" would fail here for a
    // reason that costs a consumer nothing.
    expect(workspaceRanges({ devDependencies: { '@dagr/bench': 'workspace:*' } })).toEqual([]);
  });
});

describe('entry points the tarball does not carry', () => {
  it('reports a types condition pointing at a missing file', () => {
    const found = unresolvedEntryPoints(
      pkg(
        { 'dist/index.js': '' },
        { exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } },
      ),
    );
    expect(found).toEqual(['./dist/index.d.ts is not in the tarball']);
  });

  it('walks a nested condition map rather than only the first branch', () => {
    // A bundler reading `browser` and a node reading `default` resolve
    // different strings, so the branch nobody checked is the branch that
    // breaks for exactly one consumer.
    const found = unresolvedEntryPoints(
      pkg(
        { 'dist/index.js': '' },
        { exports: { './sub': { browser: { default: './dist/browser.js' } } } },
      ),
    );
    expect(found).toEqual(['./dist/browser.js is not in the tarball']);
  });

  it('accepts main, module and types when every one is carried', () => {
    const found = unresolvedEntryPoints(
      pkg(
        { 'dist/index.js': '', 'dist/index.d.ts': '' },
        {
          main: './dist/index.js',
          module: './dist/index.js',
          types: './dist/index.d.ts',
          exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        },
      ),
    );
    expect(found).toEqual([]);
  });
});

describe('source maps pointing outside the tarball', () => {
  it('reports the dangling map a files list without src produces', () => {
    // The state all five packages were in: `files: ["dist", "CHANGELOG.md"]`
    // against a build emitting declarationMap and sourceMap, so every map
    // climbed out of the tarball into a `src` nobody installed.
    const found = danglingSourceMaps(
      pkg({ 'dist/index.js.map': map(['../src/index.ts']), 'dist/index.js': '' }),
    );
    expect(found).toEqual(['dist/index.js.map points at ../src/index.ts']);
  });

  it('accepts the same map once src is shipped beside it', () => {
    const found = danglingSourceMaps(
      pkg({
        'dist/index.js.map': map(['../src/index.ts']),
        'dist/index.js': '',
        'src/index.ts': '',
      }),
    );
    expect(found).toEqual([]);
  });

  it('accepts a package that emits no maps at all', () => {
    // The other half of the decision M5.4a had to make. Stating it as a
    // property of the tarball rather than as "ship src" keeps this check
    // correct if the maps are ever dropped instead.
    expect(danglingSourceMaps(pkg({ 'dist/index.js': '' }))).toEqual([]);
  });

  it('accepts a map carrying its source inline', () => {
    const found = danglingSourceMaps(
      pkg({
        'dist/index.js.map': map(['../src/index.ts'], { sourcesContent: ['export {};'] }),
        'dist/index.js': '',
      }),
    );
    expect(found).toEqual([]);
  });

  it('reports an absolute source path, which resolves inside no tarball', () => {
    const found = danglingSourceMaps(pkg({ 'dist/index.js.map': map(['/home/someone/src/index.ts']) }));
    expect(found).toEqual(['dist/index.js.map points at /home/someone/src/index.ts']);
  });

  it('reports a map that is not readable JSON', () => {
    expect(danglingSourceMaps(pkg({ 'dist/index.js.map': 'not json' }))).toEqual([
      'dist/index.js.map is not readable JSON',
    ]);
  });
});

describe('the files an npm page and a licence audit need', () => {
  it('reports all three when the tarball is dist alone', () => {
    expect(missingConsumerFiles(pkg({ 'dist/index.js': '' }))).toEqual([
      'README.md is not in the tarball',
      'LICENSE is not in the tarball',
      'CHANGELOG.md is not in the tarball',
    ]);
  });

  it('accepts a tarball carrying every one', () => {
    const found = missingConsumerFiles(
      pkg({ 'README.md': '', LICENSE: '', 'CHANGELOG.md': '', 'dist/index.js': '' }),
    );
    expect(found).toEqual([]);
  });
});

describe('whether a scoped package would publish public', () => {
  it('refuses a manifest with no publishConfig', () => {
    expect(publishesPublic({})).toBe(false);
  });

  it('refuses an explicit restricted', () => {
    expect(publishesPublic({ publishConfig: { access: 'restricted' } })).toBe(false);
  });

  it('accepts public', () => {
    expect(publishesPublic({ publishConfig: { access: 'public' } })).toBe(true);
  });
});
