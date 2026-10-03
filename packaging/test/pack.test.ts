/**
 * The six published packages, packed and read back.
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

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PackedPackage } from '../src/checks.js';
import {
  danglingSourceMaps,
  missingConsumerFiles,
  publishesPublic,
  unresolvedEntryPoints,
  workspaceRanges,
} from '../src/checks.js';
import { PUBLISHED_PACKAGES, REPO_ROOT, packPublishedPackages } from '../src/pack.js';

let packed: PackedPackage[] = [];
let roots: ReadonlyMap<string, string> = new Map();
let dispose = () => {};

beforeAll(() => {
  const result = packPublishedPackages();
  packed = result.packages;
  roots = result.roots;
  dispose = result.dispose;
  // A tsc run for six packages, six packs and six extractions. Explicit
  // rather than left to the default, because a default vitest timeout is not
  // a constant on a shared box (M4.8a).
}, 300_000);

afterAll(() => dispose());

function each(): PackedPackage[] {
  // Guards against a beforeAll that silently produced nothing. Every
  // assertion below is over a LIST, so an empty list satisfies each one of
  // them: without this, a pack that produced nothing would read as a green
  // gate rather than as a broken one.
  expect(packed).toHaveLength(PUBLISHED_PACKAGES.length);
  return packed;
}

describe('the tarball a consumer installs', () => {
  it('packs one tarball per published package', () => {
    expect(each().map((p) => p.name).sort()).toEqual([
      '@prnt/dagr',
      '@prnt/dagr-graph',
      '@prnt/dagr-layout',
      '@prnt/dagr-react',
      '@prnt/dagr-render',
      '@prnt/dagr-vdsl',
    ]);
  });

  it('resolves every dependency range a consumer install reads', () => {
    // @prnt/dagr-layout, @prnt/dagr-react and @prnt/dagr-vdsl each declare @prnt/dagr-graph with
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
    // Against the repo's own LICENSE and not merely against each other: six
    // identical copies that have all drifted from the root would satisfy a
    // pairwise check and still be the repo asserting a licence it did not
    // ship. This is the only assertion here that reads a file outside the
    // tarballs, and that is exactly the point of it.
    const root = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');
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

  it('loads @prnt/dagr-render/core from its tarball where three cannot be resolved', () => {
    // The extracted tarball sits in the OS temp directory with no
    // `node_modules` above it, so `three` is unresolvable from here. That is
    // the condition a server with externalized dependencies and no three
    // installed would be in.
    const root = roots.get('@prnt/dagr-render');
    if (root === undefined) throw new Error('@prnt/dagr-render was not packed');
    const load = (entry: string): string =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(pathToFileURL(join(root, entry)).href)});`,
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' },
      );

    expect(() => load('dist/core.js')).not.toThrow();
    // The control: the full entry must fail here, and on three. If it loaded,
    // three was resolvable after all and the line above proved nothing.
    expect(() => load('dist/index.js')).toThrow(/three/);
  });

  it(
    'typechecks shared interaction from extracted packages without workspace aliases',
    () => {
      const consumer = mkdtempSync(join(tmpdir(), 'dagr-interaction-consumer-'));
      try {
        const localPackages = Object.fromEntries(
          [...roots].map(([name, root]) => [name, `file:${root}`]),
        );
        writeFileSync(
          join(consumer, 'package.json'),
          JSON.stringify({
            private: true,
            type: 'module',
            dependencies: {
              ...localPackages,
              react: '19.2.8',
              'react-dom': '19.2.8',
              three: '0.185.1',
            },
            devDependencies: {
              '@types/react': '19.2.17',
              '@types/react-dom': '19.2.3',
              '@types/three': '0.185.1',
              typescript: '5.9.3',
            },
            pnpm: { overrides: localPackages },
          }),
        );
        try {
          execFileSync(
            'pnpm',
            ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'],
            {
              cwd: consumer,
              encoding: 'utf8',
              stdio: 'pipe',
            },
          );
        } catch (error) {
          const output = error as { readonly stdout?: string; readonly stderr?: string };
          throw new Error(`${output.stdout ?? ''}${output.stderr ?? ''}`, { cause: error });
        }
        writeFileSync(
          join(consumer, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              exactOptionalPropertyTypes: true,
              noEmit: true,
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              target: 'ES2022',
              lib: ['ES2022', 'DOM'],
            },
            include: ['consumer.ts'],
          }),
        );
        writeFileSync(
          join(consumer, 'consumer.ts'),
          `import type { RefObject } from 'react';
import {
  useGraphInteraction,
  type GraphHitProvider,
  type GraphHitTarget,
} from '@prnt/dagr-react';
import {
  Camera2D as CoreCamera,
  shapeEdgePath as coreShapeEdgePath,
  type EdgePathOptions as CoreEdgePathOptions,
  type WorldBounds as CoreWorldBounds,
} from '@prnt/dagr-render/core';

const coreBounds: CoreWorldBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const coreOptions: CoreEdgePathOptions = { style: 'smooth' };
new CoreCamera().fitBounds(coreBounds);
coreShapeEdgePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], coreOptions);

declare const surfaceRef: RefObject<HTMLElement | null>;
declare const svgSurfaceRef: RefObject<SVGSVGElement | null>;
const node: GraphHitTarget = { kind: 'node', nodeId: 'checkout' };
const port: GraphHitTarget = { kind: 'port', nodeId: 'checkout', portId: 'event' };
const provider: GraphHitProvider<number> = (query) => ({
  target: query.css.x < 10 ? node : port,
  displayedRevision: query.displayedRevision,
});
useGraphInteraction({
  surfaceRef,
  displayedRevision: 1,
  devicePixelRatio: 2,
  screenToWorld: ({ x, y }) => ({ x, y: -y }),
  hitTarget: provider,
  selection: node,
  onSelectionChange: (_target) => undefined,
  onPanBy: (_delta) => undefined,
});
useGraphInteraction({
  surfaceRef: svgSurfaceRef,
  displayedRevision: 1,
  devicePixelRatio: 2,
  screenToWorld: ({ x, y }) => ({ x, y }),
  hitTarget: provider,
  selection: port,
  onSelectionChange: (_target) => undefined,
  onPanBy: (_delta) => undefined,
});
`,
        );
        try {
          execFileSync(join(REPO_ROOT, 'node_modules', '.bin', 'tsc'), ['-p', consumer], {
            cwd: consumer,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch (error) {
          const output = error as { readonly stdout?: string; readonly stderr?: string };
          throw new Error(`${output.stdout ?? ''}${output.stderr ?? ''}`, { cause: error });
        }
      } finally {
        rmSync(consumer, { recursive: true, force: true });
      }
    },
    // This test starts an external package install and tsc process. It takes
    // about three seconds alone and seven while workspace tests run in
    // parallel, so Vitest's five-second unit-test default is not applicable.
    30_000,
  );
});
