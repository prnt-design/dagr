import { mkdtemp, copyFile, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadArchive } from './archive.js';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function archive() { const d = await mkdtemp(join(tmpdir(), 'dagr-reader-')); directories.push(d); return d; }
describe('private archive boundary', () => {
  it('validates the named baseline and keeps invalid latest distinct from missing data', async () => {
    const d = await archive();
    await copyFile(new URL('../../reports/fixtures/day-1.json', import.meta.url), join(d, '2026-10-28.json'));
    await copyFile(new URL('../../reports/fixtures/day-2.json', import.meta.url), join(d, '2026-10-29.json'));
    await writeFile(join(d, '2026-10-30.json'), '{}');
    await writeFile(join(d, 'ignored.json'), '{}');
    const feed = await loadArchive(d);
    expect(feed.reports.map(r => r.date)).toEqual(['2026-10-28', '2026-10-29']);
    expect(feed.dates.at(-1)).toBe('2026-10-30');
    expect(feed.errors['2026-10-30']?.length).toBeGreaterThan(0);
    expect(feed.errors['2026-10-31']).toBeUndefined();
  });
  it('rejects a missing named baseline even when every comparison status is unknown', async () => {
    const d = await archive();
    const report = JSON.parse(await readFile(new URL('../../reports/fixtures/day-2.json', import.meta.url), 'utf8'));
    for (const node of report.nodes) node.previousStatus = 'unknown';
    await writeFile(join(d, '2026-10-29.json'), JSON.stringify(report));
    const feed = await loadArchive(d);
    expect(feed.reports).toEqual([]);
    expect(feed.errors['2026-10-29']).toEqual(['Named baseline report is missing or unreadable']);
  });
  it('rejects escaping symlinks and missing comparison baselines', async () => {
    const d = await archive();
    await symlink(new URL('../../reports/fixtures/day-1.json', import.meta.url).pathname, join(d, '2026-10-28.json'));
    await copyFile(new URL('../../reports/fixtures/day-2.json', import.meta.url), join(d, '2026-10-29.json'));
    const feed = await loadArchive(d);
    expect(feed.reports).toEqual([]);
    expect(feed.errors['2026-10-28']).toEqual(['Unreadable report']);
    expect(feed.errors['2026-10-29']?.join(' ')).toContain('baseline');
  });
});
