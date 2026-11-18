import { expect, it } from 'vitest';
import { mkdirSync, rmdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, save } from '../src/generate.js';
const capture = { repository: 'prnt-design/dagr', revision: 'a'.repeat(40), commitSubject: 'Report contract', capturedAt: '2026-11-18T12:00:00Z', prs: [{ number: 187, title: 'Report contract', state: 'MERGED', url: 'https://github.com/prnt-design/dagr/pull/187' }] };
it('saves once, compares the next day and recovers past an interrupted temporary file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dagr-report-'));
  try {
    writeFileSync(join(dir, 'interrupted.tmp'), 'partial');
    const first = save(dir, capture);
    const bytes = readFileSync(first, 'utf8');
    expect(save(dir, { ...capture, prs: [] })).toBe(first);
    expect(readFileSync(first, 'utf8')).toBe(bytes);
    const next = save(dir, { ...capture, capturedAt: '2026-11-19T12:00:00Z' });
    const report = JSON.parse(readFileSync(next, 'utf8'));
    expect(report.previousDate).toBe('2026-11-18');
    expect(report.nodes[0].previousStatus).toBe('unchanged');
    expect(() => save(dir, { ...capture, capturedAt: '2026-11-20T12:00:00Z', prs: [] })).toThrow('No PR records');
    expect(readdirSync(dir).filter(f => f.endsWith('.json'))).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rejects unsafe source links before saving', () => {
  expect(() => generate({ ...capture, prs: [{ ...capture.prs[0]!, url: 'http://example.com' }] })).toThrow();
});
it('serializes all dates and recovers only after an interrupted lock is explicitly removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dagr-report-lock-'));
  try {
    mkdirSync(join(dir, '.save-lock'));
    for (const capturedAt of ['2026-11-18T12:00:00Z', '2026-11-19T12:00:00Z']) {
      expect(() => save(dir, { ...capture, capturedAt })).toThrow('writer lock unavailable');
    }
    expect(readdirSync(dir)).toEqual(['.save-lock']);
    rmdirSync(join(dir, '.save-lock'));
    save(dir, { ...capture, capturedAt: '2026-11-19T12:00:00Z' });
    expect(() => save(dir, capture)).toThrow('Cannot insert historical');
    expect(readdirSync(dir)).toEqual(['2026-11-19.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rejects renamed same-day and baseline reports and releases the lock on failure', () => {
  for (const filename of ['2026-11-18.json', '2026-11-17.json']) {
    const dir = mkdtempSync(join(tmpdir(), 'dagr-report-dates-'));
    try {
      const report = generate({ ...capture, capturedAt: '2026-11-16T12:00:00Z' });
      writeFileSync(join(dir, filename), JSON.stringify(report));
      expect(() => save(dir, capture)).toThrow(/date|invalid/);
      expect(readdirSync(dir)).toEqual([filename]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
