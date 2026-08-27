/**
 * Packing the published packages and reading the tarballs back.
 *
 * `pnpm pack` rather than `npm pack`, and that is the point rather than a
 * preference: npm leaves `workspace:^` in the published manifest where it
 * resolves to nothing, and pnpm rewrites it to the sibling's real version.
 * Packing with the command the publish will not use would check a tarball
 * nobody is going to install.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Manifest, PackedPackage } from './checks.js';

/** The packages this repo publishes, in dependency order. */
export const PUBLISHED_PACKAGES = ['graph', 'layout', 'render', 'react', 'vdsl'] as const;

/** The repo root, from this file rather than from `process.cwd()`. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Builds the published packages, then packs each one and extracts it.
 *
 * The build is not optional and not conditional on `dist` already existing.
 * CI runs `pnpm test` BEFORE `pnpm build`, so on a fresh checkout there is no
 * `dist` to pack at all; and a `dist` that does exist may be stale, which
 * would have this gate pass on a tarball that is not the one the next publish
 * would produce. Ten seconds of `tsc` is the price of checking the real thing.
 *
 * The caller owns the returned directory and must `dispose()` it.
 */
export function packPublishedPackages(): { packages: PackedPackage[]; dispose: () => void } {
  const workDir = mkdtempSync(join(tmpdir(), 'dagr-packaging-'));
  try {
    run('pnpm', [...PUBLISHED_PACKAGES.flatMap((p) => ['--filter', `@dagr/${p}`]), 'build'], REPO_ROOT);

    const packages = PUBLISHED_PACKAGES.map((name) => {
      const packageDir = join(REPO_ROOT, 'packages', name);
      const tarball = run('pnpm', ['pack', '--pack-destination', workDir], packageDir).trim().split('\n').pop();
      if (tarball === undefined || tarball === '') {
        throw new Error(`pnpm pack printed no tarball path for @dagr/${name}`);
      }

      const extracted = mkdtempSync(join(workDir, 'x-'));
      run('tar', ['-xzf', tarball, '-C', extracted], workDir);
      return readExtracted(join(extracted, 'package'));
    });

    return { packages, dispose: () => rmSync(workDir, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

function readExtracted(root: string): PackedPackage {
  const files = listFiles(root, root).sort();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;

  return {
    name: manifest.name ?? '(unnamed)',
    manifest,
    files,
    text: (file) => {
      // Confined to the extracted root: a tarball is untrusted input as far as
      // this reader is concerned, and a path with `..` in it should read
      // nothing rather than something outside the package.
      const target = join(root, file);
      if (target !== root && !target.startsWith(root + sep)) return undefined;
      try {
        return readFileSync(target, 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}

function listFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
