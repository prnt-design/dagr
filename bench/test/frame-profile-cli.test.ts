import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each([1, 2, 3].flatMap((size) => ['edges', 'all,edges'].map((parts) => [size, parts] as const)))('rejects an empty size %s, parts %s plan before launching Chrome', (size, parts) => {
  const deps = mkdtempSync(join(tmpdir(), 'dagr-frame-cli-'));
  try {
    mkdirSync(join(deps, 'node_modules/playwright-core'), { recursive: true });
    writeFileSync(join(deps, 'package.json'), '{}');
    writeFileSync(join(deps, 'node_modules/playwright-core/index.js'),
      'exports.chromium = { launch() { throw new Error("unexpected browser launch"); } };');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../browser/frame-profile.mjs', import.meta.url)),
      `--sizes=${size}`, `--parts=${parts}`,
    ], { encoding: 'utf8', env: { ...process.env, DAGR_BROWSER_DEPS: deps } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--parts=edges requires --sizes of at least 4 nodes');
    expect(result.stderr).not.toContain('unexpected browser launch');
    expect(result.stderr).not.toContain('canvas presented nothing');
  } finally {
    rmSync(deps, { recursive: true, force: true });
  }
});
