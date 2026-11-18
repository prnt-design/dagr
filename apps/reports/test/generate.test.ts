import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
