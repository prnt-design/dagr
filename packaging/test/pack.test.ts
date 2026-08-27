/**
 * The five published packages, packed and read back.
 *
 * This is the only check in the gate that resolves a package the way a
 * consumer does. `pnpm typecheck` reads siblings through tsconfig `paths`,
 * `pnpm test` through a vitest alias and `pnpm build` through the workspace
 * symlink, so a missing `dist` in `files` or an `exports.types` pointing at
 * nothing passes all three.
 *
 * It builds and packs in `beforeAll`, which costs about fifteen seconds. The
 * alternative is a check nobody runs until the publish fails.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PackedPackage } from '../src/checks.js';
import {
  danglingSourceMaps,
  missingConsumerFiles,
  publishesPublic,
  unresolvedEntryPoints,
  workspaceRanges,
} from '../src/checks.js';
import { PUBLISHED_PACKAGES, packPublishedPackages } from '../src/pack.js';

let packed: PackedPackage[] = [];
let dispose = () => {};

beforeAll(() => {
  const result = packPublishedPackages();
  packed = result.packages;
  dispose = result.dispose;
  // A tsc run for five packages, five packs and five extractions. Explicit
  // rather than left to the default, because a default vitest timeout is not
  // a constant on a shared box (M4.8a).
}, 300_000);

afterAll(() => dispose());

function each(): PackedPackage[] {
  // Guards against a beforeAll that silently produced nothing, which would
  // otherwise make every `it.each` below vacuous.
  expect(packed).toHaveLength(PUBLISHED_PACKAGES.length);
  return packed;
}

describe('the tarball a consumer installs', () => {
  it('packs one tarball per published package', () => {
    expect(each().map((p) => p.name).sort()).toEqual([
      '@dagr/graph',
      '@dagr/layout',
      '@dagr/react',
      '@dagr/render',
      '@dagr/vdsl',
    ]);
  });

  it('resolves every dependency range a consumer install reads', () => {
    // @dagr/layout, @dagr/react and @dagr/vdsl each declare @dagr/graph with
    // pnpm's workspace protocol. This passing is what makes `pnpm publish`
    // the command: `npm pack` on the same tree leaves the protocol string in
    // and each of these would ship a range resolving to nothing.
    const found = each().flatMap((p) => workspaceRanges(p.manifest).map((r) => `${p.name}: ${r}`));
    expect(found).toEqual([]);
  });

  it('carries every file its own manifest points at', () => {
    const found = each().flatMap((p) => unresolvedEntryPoints(p).map((r) => `${p.name}: ${r}`));
    expect(found).toEqual([]);
  });

  it('resolves every source map it ships', () => {
    // 128 maps across the five pointed at a `../src/*.ts` no tarball carried,
    // which is what shipping `src` fixed. See ROADMAP M5.4a for why the maps
    // were kept rather than dropped.
    const found = each().flatMap((p) => danglingSourceMaps(p).map((r) => `${p.name}: ${r}`));
    expect(found).toEqual([]);
  });

  it('carries a README, a LICENSE and a CHANGELOG', () => {
    const found = each().flatMap((p) => missingConsumerFiles(p).map((r) => `${p.name}: ${r}`));
    expect(found).toEqual([]);
  });

  it('would publish public rather than restricted', () => {
    const restricted = each().filter((p) => !publishesPublic(p.manifest)).map((p) => p.name);
    expect(restricted).toEqual([]);
  });

  it('ships a LICENSE with the same text the repo licences under', () => {
    // A `license: "MIT"` field with no text beside it, or with text that has
    // drifted from the root, is the repo asserting a licence it did not ship.
    const root = each()[0]?.text('LICENSE');
    expect(root).toBeTypeOf('string');
    for (const p of each()) expect(p.text('LICENSE')).toBe(root);
  });

  it('ships the source every declaration map resolves to, and no test file', () => {
    // `src` is shipped for the maps and for go-to-definition. The tests are
    // in `test/`, so nothing here is a test, and asserting that keeps a
    // future `src/**/*.test.ts` from quietly doubling the tarball.
    for (const p of each()) {
      expect(p.files.filter((f) => f.startsWith('src/')).length).toBeGreaterThan(0);
      expect(p.files.filter((f) => /\.(test|bench)\.tsx?$/.test(f))).toEqual([]);
    }
  });
});
